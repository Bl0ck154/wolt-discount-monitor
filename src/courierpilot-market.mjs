import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CACHE_DIR = process.env.WOLT_API_CACHE_DIR ?? ".cache/wolt-api";
const DEFAULT_DB_PATH = join(CACHE_DIR, "courierpilot", "market.sqlite3");
const MAX_BODY_BYTES = 96 * 1024;
const MAX_OFFERS = 80;
const RAW_RETENTION_DAYS = 90;
const HISTORY_RETENTION_DAYS = 730;
const PROFILE_DAYS = 30;
const V1_MIN_PROFILE_SAMPLES = 20;
const V2_MIN_PROFILE_SAMPLES = 10;
const MIN_DAYPART_SAMPLES = 40;
const HALF_LIFE_DAYS = 10;
const ID_RE = /^[a-z0-9:_-]{3,96}$/i;
const INSTALL_RE = /^[a-f0-9-]{8,64}$/i;
const CITY_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const VALID_PLATFORMS = new Map([["wolt", "Wolt"], ["bolt", "Bolt"]]);
const ISO_CURRENCIES = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [],
);

let dbState = null;
let lastCleanupAt = 0;

export async function ingestCourierPilotMarket(request, options = {}) {
  const payload = await readJsonBody(request, MAX_BODY_BYTES);
  if (payload?.schema !== 1 && payload?.schema !== 2) throw httpError(400, "Unsupported market schema");
  if (options.schema != null && payload.schema !== options.schema) {
    throw httpError(400, `Expected market schema ${options.schema}`);
  }

  const installId = safeText(payload.install_id, 64);
  if (!INSTALL_RE.test(installId)) throw httpError(400, "Invalid market identity");

  const offers = Array.isArray(payload.offers) ? payload.offers : [];
  if (offers.length === 0 || offers.length > MAX_OFFERS) throw httpError(400, "Invalid market offer batch");

  const appVersion = safeText(payload.app_version, 32);
  const versionCode = safeInteger(payload.version_code);
  const now = Date.now();
  const rows = [];
  for (const offer of offers) {
    const row = normalizeOffer(offer, { installId, appVersion, versionCode, now, schema: payload.schema });
    if (row) rows.push(row);
  }
  if (rows.length === 0) throw httpError(400, "No valid market offers");

  const db = marketDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO market_offers
      (received_at, offer_id, install_id, captured_at, city_key, city_name, country_code,
       platform, price_cents, price_minor, currency_code, fraction_digits, route_distance_m,
       eur_per_km, native_money_per_km, route_source, delivery_count, local_hour, local_weekday,
       app_version, version_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const accepted = [];
  const affectedDailyCohorts = new Map();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const result = insert.run(
        row.receivedAt, row.offerId, row.installId, row.capturedAt, row.cityKey, row.cityName,
        row.countryCode, row.platform, row.priceMinor, row.priceMinor, row.currencyCode,
        row.fractionDigits, row.routeDistanceM,
        row.currencyCode === "EUR" ? row.nativeMoneyPerKm : null,
        row.nativeMoneyPerKm, row.routeSource, row.deliveryCount, row.localHour, row.localWeekday,
        row.appVersion, row.versionCode,
      );
      if (Number(result.changes ?? 0) > 0) accepted.push(row.offerId);
      const day = utcDay(row.capturedAt);
      affectedDailyCohorts.set(`${day}|${row.cityKey}|${row.currencyCode}|${row.platform}`, {
        day,
        cityKey: row.cityKey,
        currencyCode: row.currencyCode,
        platform: row.platform,
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }

  for (const cohort of affectedDailyCohorts.values()) rebuildDailyAggregate(db, cohort, now);
  maybeCleanup(db, now);
  closeMarketDb();
  return { ok: true, accepted };
}

export function courierPilotMarketProfile(searchParams, now = Date.now(), options = {}) {
  const schema = options.schema === 2 ? 2 : 1;
  const cityKey = normalizeCityKey(searchParams.get("city"));
  if (!cityKey) throw httpError(400, "Invalid city");

  const requestedPlatform = normalizePlatform(searchParams.get("platform"));
  const currencyCode = schema === 2
    ? normalizeCurrency(searchParams.get("currency") || searchParams.get("currencyCode"))
    : normalizeCurrency(searchParams.get("currency") || searchParams.get("currencyCode") || "EUR");
  if (!currencyCode) throw httpError(400, "Invalid currency");

  const requestedHour = optionalHour(searchParams.get("hour"));
  const cutoff = now - PROFILE_DAYS * 86_400_000;
  const db = marketDb();
  let rows = loadRows(db, cityKey, requestedPlatform, cutoff, currencyCode);
  let source = requestedPlatform ? "city_platform" : "city";

  if (schema === 1 && requestedPlatform && rows.length < V1_MIN_PROFILE_SAMPLES) {
    rows = loadRows(db, cityKey, null, cutoff, "EUR");
    source = "city_all_platforms";
  }

  if (requestedHour != null && rows.length >= MIN_DAYPART_SAMPLES) {
    const part = daypartForHour(requestedHour);
    const samePart = rows.filter((row) => daypartForHour(row.local_hour) === part);
    if (samePart.length >= MIN_DAYPART_SAMPLES) {
      rows = samePart;
      source += "_daypart";
    }
  }

  const profile = computeMarketProfile(rows, now, { minSamples: schema === 2 ? V2_MIN_PROFILE_SAMPLES : V1_MIN_PROFILE_SAMPLES });
  const meta = rows[0] ?? loadLatestCityMeta(db, cityKey, currencyCode);
  const common = {
    schema,
    city: { key: cityKey, name: meta?.city_name ?? cityKey, countryCode: meta?.country_code ?? "" },
    requestedPlatform: requestedPlatform ?? null,
    currencyCode,
    source,
    generatedAt: now,
  };
  const result = schema === 2
    ? {
        ...common,
        ready: profile.ready,
        sampleCount: profile.sampleCount,
        effectiveSampleCount: profile.effectiveSampleCount,
        uniqueInstallations: profile.uniqueInstallations,
        medianNativeMoneyPerKm: profile.medianNativeMoneyPerKm,
        p15: profile.p15,
        p35: profile.p35,
        p65: profile.p65,
        p85: profile.p85,
        p25: profile.p25,
        p75: profile.p75,
        percentileEdges: profile.percentileEdges,
        bandEdges: profile.ready ? profile.percentileEdges : null,
        confidence: profile.confidence,
        trend: profile.trend,
        windowStart: cutoff,
      }
    : {
        ...common,
        ready: profile.ready,
        sampleCount: profile.sampleCount,
        uniqueInstallations: profile.uniqueInstallations,
        medianEurPerKm: profile.medianNativeMoneyPerKm,
        percentileEdges: profile.percentileEdges,
        bandEdges: profile.ready ? profile.percentileEdges : null,
        confidence: profile.confidence.toLowerCase(),
        trend: profile.trend ? {
          ...profile.trend,
          recentMedianEurPerKm: profile.trend.recentMedianNativeMoneyPerKm,
          baselineMedianEurPerKm: profile.trend.baselineMedianNativeMoneyPerKm,
        } : null,
      };
  closeMarketDb();
  return result;
}

export function courierPilotMarketHistory(searchParams, now = Date.now()) {
  const cityKey = normalizeCityKey(searchParams.get("city"));
  const currencyCode = normalizeCurrency(searchParams.get("currency") || searchParams.get("currencyCode"));
  const platform = normalizePlatform(searchParams.get("platform"));
  const period = normalizeHistoryPeriod(searchParams.get("period"));
  if (!cityKey || !currencyCode || !platform) throw httpError(400, "Invalid market history cohort");

  const cutoffDay = utcDay(now - HISTORY_RETENTION_DAYS * 86_400_000);
  const db = marketDb();
  const daily = db.prepare(`
    SELECT * FROM market_daily_aggregates
    WHERE bucket_day >= ? AND city_key = ? AND currency_code = ? AND platform = ?
    ORDER BY bucket_day ASC
  `).all(cutoffDay, cityKey, currencyCode, platform);

  const grouped = new Map();
  for (const row of daily) {
    const key = historyBucketKey(row.bucket_day, period);
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  const buckets = [...grouped.entries()].map(([bucket, rows]) => aggregateHistoryRows(bucket, rows));
  const result = { schema: 2, city: cityKey, currencyCode, platform, period, generatedAt: now, buckets };
  closeMarketDb();
  return result;
}

export function courierPilotMarketCities(now = Date.now()) {
  const cutoff = now - 7 * 86_400_000;
  const db = marketDb();
  const rows = db.prepare(`
    SELECT city_key, city_name, country_code, install_id, captured_at,
           COALESCE(native_money_per_km, eur_per_km) AS native_money_per_km, local_hour
    FROM market_offers
    WHERE captured_at >= ? AND currency_code = 'EUR'
    ORDER BY captured_at DESC
  `).all(cutoff);
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.city_key) ?? [];
    list.push(row);
    grouped.set(row.city_key, list);
  }
  const result = {
    schema: 1,
    generatedAt: now,
    cities: [...grouped.entries()].map(([key, samples]) => {
      const profile = computeMarketProfile(samples, now, { minSamples: 10 });
      if (profile.sampleCount < 10) return null;
      const first = samples[0];
      return {
        key,
        name: first.city_name,
        countryCode: first.country_code,
        sampleCount: profile.sampleCount,
        uniqueInstallations: profile.uniqueInstallations,
        medianEurPerKm: profile.medianNativeMoneyPerKm,
        trend: profile.trend,
      };
    }).filter(Boolean).sort((a, b) => b.sampleCount - a.sampleCount),
  };
  closeMarketDb();
  return result;
}

export function computeMarketProfile(rows, now = Date.now(), options = {}) {
  const minSamples = options.minSamples ?? V2_MIN_PROFILE_SAMPLES;
  const valid = rows.map((row) => ({
    installId: String(row.install_id ?? row.installId ?? ""),
    capturedAt: Number(row.captured_at ?? row.capturedAt ?? 0),
    value: Number(row.native_money_per_km ?? row.nativeMoneyPerKm ?? row.eur_per_km ?? row.eurPerKm ?? 0),
  })).filter((row) => row.installId && row.capturedAt > 0 && Number.isFinite(row.value) && row.value > 0);

  const uniqueInstallations = new Set(valid.map((row) => row.installId)).size;
  if (valid.length === 0) return emptyProfile();

  const weighted = weightedValues(valid, now);
  const p15 = weightedQuantile(weighted, 0.15);
  const p35 = weightedQuantile(weighted, 0.35);
  const p65 = weightedQuantile(weighted, 0.65);
  const p85 = weightedQuantile(weighted, 0.85);
  const ready = valid.length >= minSamples;
  return {
    ready,
    sampleCount: valid.length,
    effectiveSampleCount: round3(effectiveSampleSize(weighted.map((row) => row.weight))),
    uniqueInstallations,
    medianNativeMoneyPerKm: round3(weightedQuantile(weighted, 0.5)),
    p15: round3(p15), p35: round3(p35), p65: round3(p65), p85: round3(p85),
    p25: round3(weightedQuantile(weighted, 0.25)),
    p75: round3(weightedQuantile(weighted, 0.75)),
    percentileEdges: [p15, p35, p65, p85].map(round3),
    confidence: confidenceFor(valid.length, uniqueInstallations, minSamples),
    trend: computeTrend(valid, now),
  };
}

function emptyProfile() {
  return {
    ready: false,
    sampleCount: 0,
    effectiveSampleCount: 0,
    uniqueInstallations: 0,
    medianNativeMoneyPerKm: null,
    p15: null, p35: null, p65: null, p85: null, p25: null, p75: null,
    percentileEdges: null,
    confidence: "NOT_READY",
    trend: null,
  };
}

function normalizeOffer(offer, metadata) {
  if (!offer || typeof offer !== "object") return null;
  const offerId = safeText(offer.id ?? offer.offer_id, 96);
  const capturedAt = safeInteger(offer.captured_at);
  const cityKey = normalizeCityKey(offer.city_key);
  const cityName = safeText(offer.city_name, 80);
  const countryCode = safeText(offer.country_code, 2).toUpperCase();
  const platform = normalizePlatform(offer.platform);
  const currencyCode = normalizeCurrency(offer.currency_code ?? offer.currencyCode ?? (metadata.schema === 1 ? "EUR" : ""));
  const expectedDigits = currencyCode ? currencyFractionDigits(currencyCode) : null;
  const fractionDigits = safeInteger(
    offer.currency_fraction_digits ?? offer.currencyFractionDigits ?? (metadata.schema === 1 ? 2 : -1),
  );
  const priceMinor = safeInteger(offer.price_minor ?? offer.priceMinor ?? offer.price_cents);
  const routeDistanceM = safeInteger(offer.full_route_distance_m ?? offer.fullRouteDistanceM ?? offer.route_distance_m);
  const localHour = safeInteger(offer.local_hour);
  const localWeekday = safeInteger(offer.local_weekday);
  const deliveryCount = boundedInteger(offer.delivery_count, 1, 20, 1);
  const routeSource = safeText(offer.route_source, 32) || (metadata.schema === 1 ? "valhalla" : "");

  if (!ID_RE.test(offerId) || !cityKey || !cityName || !COUNTRY_RE.test(countryCode) || !platform || !currencyCode) return null;
  if (expectedDigits == null || fractionDigits !== expectedDigits || fractionDigits < 0 || fractionDigits > 6) return null;
  if (capturedAt <= 0 || Math.abs(metadata.now - capturedAt) > 14 * 86_400_000) return null;
  if (priceMinor <= 0 || routeDistanceM < 200 || routeDistanceM > 100_000) return null;
  if (localHour < 0 || localHour > 23 || localWeekday < 1 || localWeekday > 7) return null;
  if (metadata.schema === 2 && (!/^FULL(?:$|[_.:-])/i.test(routeSource) || /PICKUP_ONLY/i.test(routeSource))) return null;

  return {
    receivedAt: metadata.now,
    offerId, installId: metadata.installId, capturedAt, cityKey, cityName, countryCode, platform,
    priceMinor, currencyCode, fractionDigits, routeDistanceM,
    nativeMoneyPerKm: priceMinor / (10 ** fractionDigits) * 1000 / routeDistanceM,
    routeSource, deliveryCount, localHour, localWeekday,
    appVersion: metadata.appVersion, versionCode: metadata.versionCode,
  };
}

function loadRows(db, cityKey, platform, cutoff, currencyCode) {
  const sql = `
    SELECT city_key, city_name, country_code, install_id, captured_at,
           COALESCE(native_money_per_km, eur_per_km) AS native_money_per_km,
           local_hour, price_minor, price_cents, route_distance_m
    FROM market_offers
    WHERE city_key = ? AND captured_at >= ? AND currency_code = ?${platform ? " AND platform = ?" : ""}
    ORDER BY captured_at DESC
    LIMIT 30000
  `;
  return platform
    ? db.prepare(sql).all(cityKey, cutoff, currencyCode, platform)
    : db.prepare(sql).all(cityKey, cutoff, currencyCode);
}

function loadLatestCityMeta(db, cityKey, currencyCode) {
  return db.prepare(`
    SELECT city_name, country_code FROM market_offers
    WHERE city_key = ? AND currency_code = ?
    ORDER BY captured_at DESC LIMIT 1
  `).get(cityKey, currencyCode);
}

function weightedValues(rows, referenceTime) {
  const installCounts = new Map();
  for (const row of rows) installCounts.set(row.installId, (installCounts.get(row.installId) ?? 0) + 1);
  return rows.map((row) => {
    const ageDays = Math.max(0, referenceTime - row.capturedAt) / 86_400_000;
    const recencyWeight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const installWeight = 1 / Math.sqrt(installCounts.get(row.installId) ?? 1);
    return { value: row.value, weight: recencyWeight * installWeight };
  });
}

function weightedQuantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, row) => sum + row.weight, 0);
  if (total <= 0) return sorted[Math.floor((sorted.length - 1) * q)]?.value ?? null;
  const target = total * q;
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= target) return row.value;
  }
  return sorted.at(-1)?.value ?? null;
}

function effectiveSampleSize(weights) {
  const positive = weights.filter((weight) => Number.isFinite(weight) && weight > 0);
  const sum = positive.reduce((a, b) => a + b, 0);
  const squares = positive.reduce((a, b) => a + b * b, 0);
  return squares > 0 ? (sum * sum) / squares : 0;
}

function computeTrend(rows, now) {
  const recentStart = now - 7 * 86_400_000;
  const baselineStart = now - 14 * 86_400_000;
  const recent = rows.filter((row) => row.capturedAt >= recentStart);
  const baseline = rows.filter((row) => row.capturedAt >= baselineStart && row.capturedAt < recentStart);
  if (recent.length < 5 || baseline.length < 5) return null;
  const recentMedian = weightedQuantile(weightedValues(recent, now), 0.5);
  const baselineMedian = weightedQuantile(weightedValues(baseline, recentStart), 0.5);
  if (!(baselineMedian > 0) || recentMedian == null) return null;
  const percent = round1((recentMedian / baselineMedian - 1) * 100);
  return {
    percent,
    direction: percent >= 3 ? "up" : percent <= -3 ? "down" : "flat",
    recentMedianNativeMoneyPerKm: round3(recentMedian),
    baselineMedianNativeMoneyPerKm: round3(baselineMedian),
    recentSamples: recent.length,
    baselineSamples: baseline.length,
  };
}

function confidenceFor(sampleCount, uniqueInstallations, minSamples) {
  if (sampleCount < minSamples) return "NOT_READY";
  if (sampleCount >= 100 && uniqueInstallations >= 8) return "HIGH";
  if (sampleCount >= 30 && uniqueInstallations >= 3) return "MEDIUM";
  return "LOW";
}

function rebuildDailyAggregate(db, { day, cityKey, currencyCode, platform }, now) {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  const end = start + 86_400_000;
  const rows = db.prepare(`
    SELECT install_id, captured_at, COALESCE(native_money_per_km, eur_per_km) AS rate,
           COALESCE(price_minor, price_cents) AS price_minor, route_distance_m,
           city_name, country_code, fraction_digits
    FROM market_offers
    WHERE captured_at >= ? AND captured_at < ? AND city_key = ? AND currency_code = ? AND platform = ?
  `).all(start, end, cityKey, currencyCode, platform);
  if (rows.length === 0) return;

  const rates = rows.map((row) => Number(row.rate)).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (rates.length === 0) return;
  const prices = rows.map((row) => Number(row.price_minor)).filter(Number.isFinite).sort((a, b) => a - b);
  const distances = rows.map((row) => Number(row.route_distance_m)).filter(Number.isFinite).sort((a, b) => a - b);
  const first = rows[0];
  db.prepare(`
    INSERT INTO market_daily_aggregates
      (bucket_day, city_key, city_name, country_code, platform, currency_code, fraction_digits,
       sample_count, unique_installations, median_native_money_per_km, p25, p75,
       median_price_minor, median_distance_m, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bucket_day, city_key, currency_code, platform) DO UPDATE SET
      city_name=excluded.city_name, country_code=excluded.country_code,
      fraction_digits=excluded.fraction_digits, sample_count=excluded.sample_count,
      unique_installations=excluded.unique_installations,
      median_native_money_per_km=excluded.median_native_money_per_km,
      p25=excluded.p25, p75=excluded.p75, median_price_minor=excluded.median_price_minor,
      median_distance_m=excluded.median_distance_m, updated_at=excluded.updated_at
  `).run(
    day, cityKey, first.city_name, first.country_code, platform, currencyCode, first.fraction_digits,
    rows.length, new Set(rows.map((row) => row.install_id)).size,
    round3(simpleQuantile(rates, 0.5)), round3(simpleQuantile(rates, 0.25)), round3(simpleQuantile(rates, 0.75)),
    Math.round(simpleQuantile(prices, 0.5)), Math.round(simpleQuantile(distances, 0.5)), now,
  );
}

function aggregateHistoryRows(bucket, rows) {
  const sampleCount = rows.reduce((sum, row) => sum + Number(row.sample_count || 0), 0);
  const weighted = (field) => sampleCount > 0
    ? rows.reduce((sum, row) => sum + Number(row[field] || 0) * Number(row.sample_count || 0), 0) / sampleCount
    : null;
  return {
    bucket,
    sampleCount,
    medianNativeMoneyPerKm: nullableRound3(weighted("median_native_money_per_km")),
    p25: nullableRound3(weighted("p25")),
    p75: nullableRound3(weighted("p75")),
    medianPriceMinor: nullableRound(weighted("median_price_minor")),
    medianDistanceM: nullableRound(weighted("median_distance_m")),
  };
}

function simpleQuantile(sorted, q) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos), f = pos - lo;
  return sorted[lo] * (1 - f) + sorted[hi] * f;
}

function marketDb() {
  const path = process.env.COURIERPILOT_MARKET_DB || DEFAULT_DB_PATH;
  if (dbState?.path === path) return dbState.db;
  dbState?.db?.close?.();
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at INTEGER NOT NULL,
      offer_id TEXT NOT NULL,
      install_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      city_key TEXT NOT NULL,
      city_name TEXT NOT NULL,
      country_code TEXT NOT NULL,
      platform TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      price_minor INTEGER,
      currency_code TEXT NOT NULL DEFAULT 'EUR',
      fraction_digits INTEGER NOT NULL DEFAULT 2,
      route_distance_m INTEGER NOT NULL,
      eur_per_km REAL,
      native_money_per_km REAL,
      route_source TEXT NOT NULL,
      delivery_count INTEGER NOT NULL,
      local_hour INTEGER NOT NULL,
      local_weekday INTEGER NOT NULL,
      app_version TEXT NOT NULL,
      version_code INTEGER NOT NULL,
      UNIQUE(install_id, offer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_market_city_time ON market_offers(city_key, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_market_city_platform_time ON market_offers(city_key, platform, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_market_cohort_time ON market_offers(city_key, currency_code, platform, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_market_received ON market_offers(received_at);

    CREATE TABLE IF NOT EXISTS market_daily_aggregates (
      bucket_day TEXT NOT NULL,
      city_key TEXT NOT NULL,
      city_name TEXT NOT NULL,
      country_code TEXT NOT NULL,
      platform TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      fraction_digits INTEGER NOT NULL,
      sample_count INTEGER NOT NULL,
      unique_installations INTEGER NOT NULL,
      median_native_money_per_km REAL NOT NULL,
      p25 REAL NOT NULL,
      p75 REAL NOT NULL,
      median_price_minor INTEGER NOT NULL,
      median_distance_m INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(bucket_day, city_key, currency_code, platform)
    );
    CREATE INDEX IF NOT EXISTS idx_market_history_cohort ON market_daily_aggregates(city_key, currency_code, platform, bucket_day);
  `);
  for (const sql of [
    "ALTER TABLE market_offers ADD COLUMN price_minor INTEGER",
    "ALTER TABLE market_offers ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'EUR'",
    "ALTER TABLE market_offers ADD COLUMN fraction_digits INTEGER NOT NULL DEFAULT 2",
    "ALTER TABLE market_offers ADD COLUMN native_money_per_km REAL",
  ]) { try { db.exec(sql); } catch {} }
  try { db.exec("UPDATE market_offers SET price_minor = price_cents WHERE price_minor IS NULL"); } catch {}
  try { db.exec("UPDATE market_offers SET native_money_per_km = eur_per_km WHERE native_money_per_km IS NULL"); } catch {}
  backfillDailyAggregatesIfNeeded(db);
  dbState = { path, db };
  return db;
}

function backfillDailyAggregatesIfNeeded(db) {
  const aggregateCount = Number(db.prepare("SELECT COUNT(*) AS count FROM market_daily_aggregates").get()?.count ?? 0);
  if (aggregateCount > 0) return;
  const cohorts = db.prepare(`
    SELECT DISTINCT date(captured_at / 1000, 'unixepoch') AS day, city_key, currency_code, platform
    FROM market_offers WHERE captured_at > 0
  `).all();
  const now = Date.now();
  for (const row of cohorts) {
    if (row.day) rebuildDailyAggregate(db, { day: row.day, cityKey: row.city_key, currencyCode: row.currency_code || "EUR", platform: row.platform }, now);
  }
}

function maybeCleanup(db, now) {
  if (now - lastCleanupAt < 6 * 60 * 60 * 1000) return;
  lastCleanupAt = now;
  db.prepare("DELETE FROM market_offers WHERE received_at < ?").run(now - RAW_RETENTION_DAYS * 86_400_000);
  db.prepare("DELETE FROM market_daily_aggregates WHERE bucket_day < ?").run(utcDay(now - HISTORY_RETENTION_DAYS * 86_400_000));
}

function closeMarketDb() {
  try { dbState?.db?.close?.(); } catch {}
  dbState = null;
}

function normalizeCityKey(value) {
  const key = safeText(value, 64).toLowerCase();
  return CITY_RE.test(key) ? key : null;
}

function normalizeCurrency(value) {
  const code = safeText(value, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  if (ISO_CURRENCIES.size > 0 && !ISO_CURRENCIES.has(code)) return null;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code }).format(1);
    return code;
  } catch {
    return null;
  }
}

function currencyFractionDigits(code) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
  } catch {
    return null;
  }
}

function normalizePlatform(value) {
  const key = safeText(value, 24).trim().toLowerCase();
  return VALID_PLATFORMS.get(key) ?? null;
}

function normalizeHistoryPeriod(value) {
  return value === "week" || value === "month" ? value : "day";
}

function historyBucketKey(day, period) {
  if (period === "day") return day;
  if (period === "month") return day.slice(0, 7);
  return isoWeekKey(day);
}

function isoWeekKey(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function utcDay(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }

function daypartForHour(hour) {
  if (hour == null || hour < 0 || hour > 23) return "unknown";
  if (hour <= 5 || hour === 23) return "late";
  if (hour <= 10) return "morning";
  if (hour <= 14) return "lunch";
  if (hour <= 17) return "afternoon";
  return "dinner";
}

function optionalHour(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) throw httpError(400, "Invalid hour");
  return parsed;
}

async function readJsonBody(request, maxBytes) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw httpError(413, "Request body too large");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw httpError(413, "Request body too large");
    chunks.push(chunk);
  }
  if (bytes === 0) throw httpError(400, "Empty request body");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw httpError(400, "Invalid JSON"); }
}

function safeText(value, maxLength) {
  return String(value ?? "").replace(/[\0\r\n]/g, " ").trim().slice(0, maxLength);
}
function safeInteger(value) { const number = Number(value); return Number.isSafeInteger(number) ? number : 0; }
function boundedInteger(value, min, max, fallback) { const number = safeInteger(value); return number >= min && number <= max ? number : fallback; }
function round1(value) { return Math.round(value * 10) / 10; }
function round3(value) { return value == null ? null : Math.round(value * 1000) / 1000; }
function nullableRound3(value) { return value == null || !Number.isFinite(value) ? null : round3(value); }
function nullableRound(value) { return value == null || !Number.isFinite(value) ? null : Math.round(value); }
function httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; error.publicMessage = message; return error; }
