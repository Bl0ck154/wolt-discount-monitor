import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CACHE_TTL_MS, CITY, PATHS, cityDataPaths, cityKey, cityLabel, isDefaultCity } from "./config.mjs";
import { diffSnapshots, interestingOfferIndex, offerIndex } from "./diff.mjs";
import { fetchCityData, isSnapshotFresh } from "./wolt-api.mjs";
import { fetchWoltCityCatalog } from "./wolt-cities.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { formatTelegramMessage, sendTelegramMessage } from "./telegram.mjs";

async function main() {
  const catalog = await loadOrFetchCityCatalog();
  const cities = catalog.cities ?? [];
  const selectedCityIds = cityIdsToCheck(cities);
  const results = [];

  for (const cityId of selectedCityIds) {
    const city = findCity(cities, cityId);
    if (!city) {
      throw new Error(`Unknown city "${cityId}". Use country/slug like "ltu/vilnius" or a city key like "ltu-vilnius".`);
    }
    results.push(await checkCity(city));
  }

  await writeCatalog(catalog);
  await writeCitiesIndex(catalog, results);

  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), cacheTtlMs: CACHE_TTL_MS, cities: results }, null, 2));
}

async function checkCity(city) {
  const paths = cityDataPaths(city);
  const previous = (await readJsonIfExists(paths.latest)) ?? (isDefaultCity(city) ? await readJsonIfExists(PATHS.latest) : null);
  const notified = (await readJsonIfExists(paths.notified)) ?? { activeOffers: [] };

  if (process.env.FORCE_WRITE !== "true" && isSnapshotFresh(previous)) {
    return cityResult(city, previous, {
      cacheHit: true,
      appeared: 0,
      disappeared: 0,
      interestingAppeared: 0,
      interestingEnded: 0,
      wroteFiles: false,
      telegram: { skipped: true, reason: `Cached data is fresh for ${Math.round(CACHE_TTL_MS / 60000)} minutes` },
    });
  }

  const current = normalizeSnapshot(await fetchCityData(city));
  const changes = diffSnapshots(previous, current);
  const currentOffers = offerIndex(current);
  const currentInteresting = interestingOfferIndex(current);
  const notifiedByKey = new Map((notified.activeOffers ?? []).filter((offer) => offer.stableKey).map((offer) => [offer.stableKey, offer]));
  const newInteresting = changes.interestingAppeared.filter((offer) => !notifiedByKey.has(offer.stableKey));
  const endedNotified = [...notifiedByKey.values()].filter((offer) => !currentOffers.has(offer.stableKey));
  const hasChanges =
    process.env.FORCE_WRITE === "true" ||
    !previous ||
    changes.appeared.length > 0 ||
    changes.disappeared.length > 0 ||
    previous.counts?.promotionsUniqueVenues !== current.counts.promotionsUniqueVenues ||
    previous.counts?.restaurantsUniqueVenues !== current.counts.restaurantsUniqueVenues;

  await writeJson(paths.latest, current);

  if (hasChanges) {
    await writeJson(paths.changes, {
      ...changes,
      newInteresting,
      endedNotified,
      notifiedSummary: {
        newInteresting: newInteresting.length,
        endedNotified: endedNotified.length,
      },
    });
    await appendChangeLog(paths.log, changes, { newInteresting, endedNotified });
  }

  const shouldNotify = city.notificationsEnabled === true && Boolean(previous) && (newInteresting.length > 0 || endedNotified.length > 0);
  let telegram = {
    skipped: true,
    reason: city.notificationsEnabled === true
      ? previous ? "No new interesting offers" : "Baseline created; no previous snapshot"
      : "Notifications are enabled only for the default Vilnius monitor",
  };

  if (shouldNotify) {
    telegram = await sendTelegramMessage(formatTelegramMessage({
      appeared: newInteresting,
      ended: endedNotified,
      allAppeared: changes.appeared.length,
      allDisappeared: changes.disappeared.length,
    }));
  }

  if (shouldNotify && telegram.skipped === false) {
    await writeJson(paths.notified, buildNotifiedState({
      previous: notified,
      currentInteresting,
      appeared: newInteresting,
      ended: endedNotified,
      generatedAt: current.generatedAt,
    }));
  } else if (!shouldNotify && notifiedByKey.size) {
    await writeJson(paths.notified, buildNotifiedState({
      previous: notified,
      currentInteresting,
      appeared: [],
      ended: [],
      generatedAt: current.generatedAt,
    }));
  }

  return cityResult(city, current, {
    cacheHit: false,
    appeared: changes.appeared.length,
    disappeared: changes.disappeared.length,
    interestingAppeared: newInteresting.length,
    interestingEnded: endedNotified.length,
    wroteFiles: true,
    telegram,
  });
}

function cityIdsToCheck(cities) {
  if (process.env.WOLT_ALL_CITIES === "true") {
    return cities.map((city) => city.id);
  }

  return (process.env.WOLT_CITIES || process.env.WOLT_CITY || CITY.id)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function loadOrFetchCityCatalog() {
  if (process.env.WOLT_REFRESH_CITY_CATALOG !== "true") {
    const existing = await readJsonIfExists(PATHS.cityCatalog);
    if (existing?.cities?.length) {
      return existing;
    }
  }

  return fetchWoltCityCatalog();
}

function findCity(cities, id) {
  return cities.find((city) => city.id === id || city.key === id || city.slug === id && isDefaultCity(city));
}

async function writeCatalog(catalog) {
  await writeJson(PATHS.cityCatalog, catalog);
}

async function writeCitiesIndex(catalog, results) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const existing = (await readJsonIfExists(PATHS.cities)) ?? { cities: [] };
  const existingById = new Map((existing.cities ?? []).map((city) => [city.id, city]));

  const cities = (catalog.cities ?? []).map((city) => {
    const result = byId.get(city.id);
    const previous = existingById.get(city.id);
    const latestPath = isDefaultCity(city) ? "data/latest.json" : `data/cities/${cityKey(city)}/latest.json`;
    return {
      id: city.id,
      key: cityKey(city),
      woltCityId: city.woltCityId,
      slug: city.slug,
      name: city.name,
      country: city.country,
      countryEmoji: city.countryEmoji,
      countryCode: city.countryCode,
      countryCode2: city.countryCode2,
      countryCode3: city.countryCode3,
      lat: city.lat,
      lon: city.lon,
      locale: city.locale ?? "en",
      timezone: city.timezone,
      label: cityLabel(city),
      notificationsEnabled: city.notificationsEnabled === true,
      dataPath: latestPath,
      latestPath,
      updatedAt: result?.generatedAt ?? previous?.updatedAt ?? null,
      counts: result?.counts ?? previous?.counts ?? null,
    };
  });

  await writeJson(PATHS.cities, {
    generatedAt: new Date().toISOString(),
    defaultCityId: CITY.id,
    cacheTtlMs: CACHE_TTL_MS,
    totalCities: catalog.totalCities ?? cities.length,
    totalCountries: catalog.totalCountries,
    countries: catalog.countries,
    cities,
  });
}

function cityResult(city, snapshot, extra) {
  return {
    id: city.id,
    name: city.name,
    country: city.country,
    label: cityLabel(city),
    generatedAt: snapshot.generatedAt,
    counts: snapshot.counts,
    ...extra,
  };
}

function buildNotifiedState({ previous, currentInteresting, appeared, ended, generatedAt }) {
  const endedKeys = new Set(ended.map((offer) => offer.stableKey));
  const byKey = new Map();

  for (const offer of previous.activeOffers ?? []) {
    if (!endedKeys.has(offer.stableKey) && currentInteresting.has(offer.stableKey)) {
      byKey.set(offer.stableKey, {
        ...offer,
        lastSeenAt: currentInteresting.has(offer.stableKey) ? generatedAt : offer.lastSeenAt,
      });
    }
  }

  for (const offer of appeared) {
    byKey.set(offer.stableKey, {
      stableKey: offer.stableKey,
      firstNotifiedAt: generatedAt,
      lastSeenAt: generatedAt,
      venue: offer.venue,
      sourcePath: offer.sourcePath,
      campaignId: offer.campaignId,
      text: offer.text,
      amount: offer.amount,
      amountType: offer.amountType,
      amountLabel: offer.amountLabel,
    });
  }

  return {
    updatedAt: generatedAt,
    activeOffers: [...byKey.values()].sort((a, b) => a.venue.name.localeCompare(b.venue.name)),
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendChangeLog(path, changes, notification = {}) {
  const existing = (await readJsonIfExists(path)) ?? [];
  const newInteresting = notification.newInteresting ?? changes.interestingAppeared;
  const endedNotified = notification.endedNotified ?? [];
  const entry = {
    generatedAt: changes.generatedAt,
    previousGeneratedAt: changes.previousGeneratedAt,
    appeared: changes.appeared.length,
    disappeared: changes.disappeared.length,
    interestingAppeared: changes.interestingAppeared.length,
    notifiedNew: newInteresting.length,
    notifiedEnded: endedNotified.length,
    interesting: newInteresting.slice(0, 50),
    ended: endedNotified.slice(0, 50),
  };

  await writeJson(path, [entry, ...existing].slice(0, 200));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
