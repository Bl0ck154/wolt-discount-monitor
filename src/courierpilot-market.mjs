import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CACHE_DIR = process.env.WOLT_API_CACHE_DIR ?? ".cache/wolt-api";
const DEFAULT_DB_PATH = join(CACHE_DIR, "courierpilot", "market.sqlite3");
const MAX_BODY_BYTES = 96 * 1024;
const MAX_OFFERS = 80;
const RETENTION_DAYS = 90;
const PROFILE_DAYS = 30;
const MIN_PROFILE_SAMPLES = 10;
const MIN_DAYPART_SAMPLES = 40;
const HALF_LIFE_DAYS = 10;
const ID_RE = /^[a-z0-9:_-]{3,96}$/i;
const INSTALL_RE = /^[a-f0-9-]{8,64}$/i;
const CITY_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const VALID_PLATFORMS = new Map([["wolt", "Wolt"], ["bolt", "Bolt"]]);

let dbState = null;
let lastCleanupAt = 0;

export async function ingestCourierPilotMarket(request, options = {}) {
  const payload = await readJsonBody(request, MAX_BODY_BYTES);
  if (payload?.schema !== 1 && payload?.schema !== 2) throw httpError(400, "Unsupported market schema");

  const installId = safeText(payload.install_id, 64);
  if (!INSTALL_RE.test(installId)) throw httpError(400, "Invalid market identity");

  const offers = Array.isArray(payload.offers) ? payload.offers : [];
  if (offers.length === 0 || offers.length > MAX_OFFERS) {
    throw httpError(400, "Invalid market offer batch");
  }

  const appVersion = safeText(payload.app_version, 32);
  const versionCode = safeInteger(payload.version_code);
  const now = Date.now();
  const rows = [];
  const accepted = [];

  for (const offer of offers) {
    const row = normalizeOffer(offer, { installId, appVersion, versionCode, now, schema: payload.schema });
    if (!row) continue;
    rows.push(row);
    accepted.push(row.offerId);
  }
  if (rows.length === 0) throw httpError(400, "No valid market offers");

  const db = marketDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO market_offers
    (received_at, offer_id, install_id, captured_at, city_key, city_name, country_code,
     platform, price_cents, currency_code, fraction_digits, route_distance_m, eur_per_km, native_money_per_km, route_source, delivery_count,
     local_hour, local_weekday, app_version, version_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      insert.run(
        row.receivedAt, row.offerId, row.installId, row.capturedAt, row.cityKey, row.cityName,
        row.countryCode, row.platform, row.priceCents, row.currencyCode, row.fractionDigits, row.routeDistanceM, row.nativeMoneyPerKm, row.nativeMoneyPerKm,
        row.routeSource, row.deliveryCount, row.localHour, row.localWeekday,
        row.appVersion, row.versionCode,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }

  maybeCleanup(now);
  closeMarketDb();
  return { ok: true, accepted };
}

export function courierPilotMarketProfile(searchParams, now = Date.now(), options = {}) {
  const cityKey = normalizeCityKey(searchParams.get("city"));
  if (!cityKey) throw httpError(400, "Invalid city");

  const requestedPlatform = normalizePlatform(searchParams.get("platform"));
  const currencyCode = normalizeCurrency(searchParams.get("currency") || searchParams.get("currencyCode"));
  if (options.schema === 2 && !currencyCode) throw httpError(400, "Invalid currency");
  const requestedHour = optionalHour(searchParams.get("hour"));
  const cutoff = now - PROFILE_DAYS * 86_400_000;
  const db = marketDb();

  let rows = loadRows(db, cityKey, requestedPlatform, cutoff, currencyCode);
  let source = requestedPlatform ? "city_platform" : "city";
  if (requestedPlatform && rows.length < (options.schema === 2 ? MIN_PROFILE_SAMPLES : 20) && options.schema !== 2) { rows = loadRows(db, cityKey, null, cutoff); source = "city_all_platforms"; }

  if (requestedHour != null && rows.length >= MIN_DAYPART_SAMPLES) {
    const part = daypartForHour(requestedHour);
    const samePart = rows.filter((row) => daypartForHour(row.local_hour) === part);
    if (samePart.length >= MIN_DAYPART_SAMPLES) {
      rows = samePart;
      source += "_daypart";
    }
  }

  const profile = computeMarketProfile(rows, now);
  const meta = rows[0] ?? loadLatestCityMeta(db, cityKey);
  const result = {
    schema: options.schema === 2 ? 2 : 1,
    city: {
      key: cityKey,
      name: meta?.city_name ?? cityKey,
      countryCode: meta?.country_code ?? "",
    },
    requestedPlatform: requestedPlatform ?? null,
    currencyCode: currencyCode ?? null,
    source,
    generatedAt: now,
    ...profile,
  };
  closeMarketDb();
  return result;
}

export function courierPilotMarketHistory(searchParams, now = Date.now()) {
  const city = normalizeCityKey(searchParams.get("city"));
  const currency = normalizeCurrency(searchParams.get("currency") || searchParams.get("currencyCode"));
  const platform = normalizePlatform(searchParams.get("platform"));
  const period = ["day", "week", "month"].includes(searchParams.get("period")) ? searchParams.get("period") : "day";
  if (!city || !currency) throw httpError(400, "Invalid city or currency");
  const rows = loadRows(marketDb(), city, platform, now - 730 * 86_400_000, currency);
  const buckets = new Map();
  for (const row of rows) { const d = new Date(row.captured_at); const key = period === "month" ? d.toISOString().slice(0,7) : period === "week" ? `${d.getUTCFullYear()}-W${String(Math.ceil((d.getUTCDate()+6)/7)).padStart(2,"0")}` : d.toISOString().slice(0,10); const list = buckets.get(key) ?? []; list.push(row); buckets.set(key,list); }
  const result = { schema: 2, city, currencyCode: currency, platform: platform ?? null, period, buckets: [...buckets].sort().map(([bucket, data]) => { const p=computeMarketProfile(data, now); return { bucket, sampleCount:p.sampleCount, medianNativeMoneyPerKm:p.medianNativeMoneyPerKm, p25:p.p25, p75:p.p75 }; }) };
  closeMarketDb();
  return result;
}

export function courierPilotMarketCities(now = Date.now()) {
  const cutoff = now - 7 * 86_400_000;
  const rows = marketDb().prepare(`
    SELECT city_key, city_name, country_code, install_id, captured_at, eur_per_km, local_hour
    FROM market_offers
    WHERE captured_at >= ?
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
    cities: [...grouped.entries()]
      .map(([key, samples]) => {
        const profile = computeMarketProfile(samples, now);
        if (profile.sampleCount < 10) return null;
        const first = samples[0];
        return {
          key,
          name: first.city_name,
          countryCode: first.country_code,
          sampleCount: profile.sampleCount,
          uniqueInstallations: profile.uniqueInstallations,
          medianEurPerKm: profile.medianEurPerKm,
          trend: profile.trend,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.sampleCount - a.sampleCount),
  };
  closeMarketDb();
  return result;
}

function closeMarketDb() {
  try { dbState?.db?.close?.(); } catch {}
  dbState = null;
}

export function computeMarketProfile(rows, now = Date.now()) {
  const valid = rows
    .map((row) => ({
      installId: String(row.install_id ?? row.installId ?? ""),
      capturedAt: Number(row.captured_at ?? row.capturedAt ?? 0),
      value: Number(row.native_money_per_km ?? row.nativeMoneyPerKm ?? row.eur_per_km ?? row.eurPerKm ?? 0),
    }))
    .filter((row) => row.installId && row.capturedAt > 0 && Number.isFinite(row.value) && row.value > 0);

  const uniqueInstallations = new Set(valid.map((row) => row.installId)).size;
  if (valid.length === 0) {
    return {
      ready: false,
      sampleCount: 0,
      uniqueInstallations: 0,
      medianEurPerKm: null, medianNativeMoneyPerKm: null,
      percentileEdges: null,
      bandEdges: null,
      confidence: "NOT_READY",
      trend: null,
    };
  }

  const weighted = weightedValues(valid, now);
  const percentileEdges = [0.15, 0.35, 0.65, 0.85].map((q) => weightedQuantile(weighted, q));
  const median = weightedQuantile(weighted, 0.5);
  const ready = valid.length >= MIN_PROFILE_SAMPLES;
  const blend = ready ? dynamicBlend(valid.length, uniqueInstallations) : 0;
  return {
    ready,
    sampleCount: valid.length,
    uniqueInstallations,
    medianEurPerKm: round3(median),
    medianNativeMoneyPerKm: round3(median),
    percentileEdges: percentileEdges.map(round3),
    p25: round3(weightedQuantile(weighted, .25)), p75: round3(weightedQuantile(weighted, .75)),
    bandEdges: percentileEdges.map(round3),
    confidence: confidenceFor(valid.length, uniqueInstallations),
    trend: computeTrend(valid, now),
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
  const fractionDigits = safeInteger(offer.currency_fraction_digits ?? offer.currencyFractionDigits ?? (currencyCode === "EUR" ? 2 : -1));
  const priceCents = safeInteger(offer.price_minor ?? offer.priceMinor ?? offer.price_cents);
  const routeDistanceM = safeInteger(offer.full_route_distance_m ?? offer.fullRouteDistanceM ?? offer.route_distance_m);
  const localHour = safeInteger(offer.local_hour);
  const localWeekday = safeInteger(offer.local_weekday);
  const deliveryCount = boundedInteger(offer.delivery_count, 1, 20, 1);
  const routeSource = safeText(offer.route_source, 24) || "valhalla";

  if (!ID_RE.test(offerId) || !cityKey || !cityName || !COUNTRY_RE.test(countryCode) || !platform || !currencyCode || fractionDigits < 0 || fractionDigits > 3) return null;
  if (capturedAt <= 0 || Math.abs(metadata.now - capturedAt) > 14 * 86_400_000) return null;
  if (priceCents <= 0) return null;
  if (routeDistanceM < 200 || routeDistanceM > 100_000) return null;
  if (localHour < 0 || localHour > 23 || localWeekday < 1 || localWeekday > 7) return null;
  if (metadata.schema === 2 && (!/^FULL(?:$|[_.:-])/i.test(routeSource) || /PICKUP_ONLY/i.test(routeSource))) return null;

  const nativeMoneyPerKm = priceCents / Math.pow(10, fractionDigits) * 1000 / routeDistanceM;

  return {
    receivedAt: metadata.now,
    offerId,
    installId: metadata.installId,
    capturedAt,
    cityKey,
    cityName,
    countryCode,
    platform,
    priceCents,
    currencyCode, fractionDigits,
    routeDistanceM,
    nativeMoneyPerKm,
    routeSource,
    deliveryCount,
    localHour,
    localWeekday,
    appVersion: metadata.appVersion,
    versionCode: metadata.versionCode,
  };
}

function loadRows(db, cityKey, platform, cutoff, currency = null) {
  const sql = `
    SELECT city_key, city_name, country_code, install_id, captured_at,
      COALESCE(native_money_per_km, eur_per_km) AS eur_per_km, local_hour
    FROM market_offers
    WHERE city_key = ? AND captured_at >= ?${platform ? " AND platform = ?" : ""}${currency ? " AND currency_code = ?" : ""}
    ORDER BY captured_at DESC
    LIMIT 30000
  `;
  const args=[cityKey,cutoff]; if(platform) args.push(platform); if(currency) args.push(currency); return db.prepare(sql).all(...args);
}

function loadLatestCityMeta(db, cityKey) {
  return db.prepare(`
    SELECT city_name, country_code
    FROM market_offers
    WHERE city_key = ?
    ORDER BY captured_at DESC
    LIMIT 1
  `).get(cityKey);
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
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, row) => sum + row.weight, 0);
  if (total <= 0) return sorted[Math.floor((sorted.length - 1) * q)]?.value ?? 0;
  const target = total * q;
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= target) return row.value;
  }
  return sorted.at(-1)?.value ?? 0;
}

function computeTrend(rows, now) {
  const recentStart = now - 3 * 86_400_000;
  const baselineStart = now - 10 * 86_400_000;
  const recent = rows.filter((row) => row.capturedAt >= recentStart);
  const baseline = rows.filter((row) => row.capturedAt >= baselineStart && row.capturedAt < recentStart);
  if (recent.length < 10 || baseline.length < 20) return null;

  const recentMedian = weightedQuantile(weightedValues(recent, now), 0.5);
  const baselineMedian = weightedQuantile(weightedValues(baseline, recentStart), 0.5);
  if (baselineMedian <= 0) return null;
  const percent = round1((recentMedian / baselineMedian - 1) * 100);
  return {
    percent,
    direction: percent >= 3 ? "up" : percent <= -3 ? "down" : "flat",
    recentMedianEurPerKm: round3(recentMedian),
    baselineMedianEurPerKm: round3(baselineMedian),
    recentSamples: recent.length,
    baselineSamples: baseline.length,
  };
}

function dynamicBlend(sampleCount, uniqueInstallations) {
  const sampleFactor = Math.min(1, Math.max(0.25, sampleCount / 150));
  const installFactor = Math.min(1, 0.5 + Math.max(0, uniqueInstallations - 1) * 0.125);
  return Math.min(1, sampleFactor * installFactor);
}

function confidenceFor(sampleCount, uniqueInstallations) {
  if (sampleCount < MIN_PROFILE_SAMPLES) return "NOT_READY";
  if (sampleCount >= 100 && uniqueInstallations >= 8) return "HIGH";
  if (sampleCount >= 30 && uniqueInstallations >= 3) return "MEDIUM";
  return "LOW";
}

function ensureAscending(values) {
  const out = [];
  for (const value of values) {
    const previous = out.at(-1);
    out.push(round3(previous == null ? value : Math.max(value, previous + 0.05)));
  }
  return out;
}

function daypartForHour(hour) {
  if (hour == null || hour < 0 || hour > 23) return "unknown";
  if (hour <= 5 || hour === 23) return "late";
  if (hour <= 10) return "morning";
  if (hour <= 14) return "lunch";
  if (hour <= 17) return "afternoon";
  return "dinner";
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
    CREATE INDEX IF NOT EXISTS idx_market_received ON market_offers(received_at);
  `);
  for (const sql of ["ALTER TABLE market_offers ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'EUR'", "ALTER TABLE market_offers ADD COLUMN fraction_digits INTEGER NOT NULL DEFAULT 2", "ALTER TABLE market_offers ADD COLUMN native_money_per_km REAL"]) { try { db.exec(sql); } catch {} }
  try { db.exec("UPDATE market_offers SET native_money_per_km = eur_per_km WHERE native_money_per_km IS NULL"); } catch {}
  dbState = { path, db };
  return db;
}

function maybeCleanup(now) {
  if (now - lastCleanupAt < 6 * 60 * 60 * 1000) return;
  lastCleanupAt = now;
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  marketDb().prepare("DELETE FROM market_offers WHERE received_at < ?").run(cutoff);
}

function normalizeCityKey(value) {
  const key = safeText(value, 64).toLowerCase();
  return CITY_RE.test(key) ? key : null;
}

function normalizeCurrency(value) {
  const code = safeText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(code) && ["EUR","PLN","SEK","GBP","USD","JPY","HUF","KWD"].includes(code) ? code : null;
}

function normalizePlatform(value) {
  const key = safeText(value, 24).trim().toLowerCase();
  return VALID_PLATFORMS.get(key) ?? null;
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Invalid JSON");
  }
}

function safeText(value, maxLength) {
  return String(value ?? "").replace(/[\0\r\n]/g, " ").trim().slice(0, maxLength);
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

function boundedInteger(value, min, max, fallback) {
  const number = safeInteger(value);
  return number >= min && number <= max ? number : fallback;
}

function round1(value) { return Math.round(value * 10) / 10; }
function round3(value) { return Math.round(value * 1000) / 1000; }

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}
