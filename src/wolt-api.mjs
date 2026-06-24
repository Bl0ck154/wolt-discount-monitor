import { CACHE_TTL_MS, CITY, WOLT_HEADERS } from "./config.mjs";

export function endpoints({ lat = CITY.lat, lon = CITY.lon } = {}) {
  return {
    restaurants: `https://consumer-api.wolt.com/v1/pages/restaurants?lat=${lat}&lon=${lon}`,
    promotions: `https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=${lon}&lat=${lat}`,
  };
}

export async function fetchJson(url, options = {}) {
  const maxAttempts = Number(options.maxAttempts ?? process.env.WOLT_API_MAX_ATTEMPTS ?? 7);
  const retryBaseMs = Number(options.retryBaseMs ?? process.env.WOLT_API_RETRY_BASE_MS ?? 30000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, { headers: WOLT_HEADERS });
    const text = await response.text();

    if (response.ok) {
      return JSON.parse(text);
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const jitterMs = Math.round(Math.random() * 5000);
      const delayMs = Math.max(
        Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
        retryBaseMs * attempt + jitterMs,
      );
      console.warn(`Wolt API returned 429; retrying attempt ${attempt + 1}/${maxAttempts} in ${Math.round(delayMs / 1000)}s: ${url}`);
      await sleep(delayMs);
      continue;
    }

    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
}

export function collectVenueItems(payload) {
  const rows = [];

  for (const [sectionIndex, section] of (payload.sections ?? []).entries()) {
    for (const [itemIndex, item] of (section.items ?? []).entries()) {
      if (item?.venue?.slug || item?.venue?.id) {
        rows.push({
          sectionIndex,
          itemIndex,
          sectionName: section.name,
          sectionTemplate: section.template,
          item,
          venue: item.venue,
        });
      }
    }
  }

  return rows;
}

export function uniqueByVenue(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const key = row.venue.slug || row.venue.id;
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()];
}

export async function fetchCityData(city = CITY) {
  const urls = endpoints(city);
  let promotionsPayload = { sections: [] };
  let restaurantsPayload = { sections: [] };

  try {
    promotionsPayload = await fetchJson(urls.promotions, { maxAttempts: 3 });
  } catch (error) {
    console.warn(`Could not fetch promotions endpoint; falling back to restaurant venues: ${error.message}`);
  }

  await sleep(5000);

  try {
    restaurantsPayload = await fetchJson(urls.restaurants, { maxAttempts: promotionsPayload.sections?.length ? 3 : 7 });
  } catch (error) {
    if (!promotionsPayload.sections?.length) {
      throw error;
    }
    console.warn(`Could not fetch restaurants endpoint; continuing with promotion venues only: ${error.message}`);
  }

  const restaurantRows = uniqueByVenue(collectVenueItems(restaurantsPayload));
  const promotionRows = uniqueByVenue(collectVenueItems(promotionsPayload));
  const promoRows = promotionRows.length ? promotionRows : restaurantRows.filter(hasRawOffers);

  return {
    city,
    urls,
    restaurantsPayload,
    promotionsPayload,
    restaurantRows: restaurantRows.length ? restaurantRows : promoRows,
    promoRows,
  };
}

function hasRawOffers(row) {
  const venue = row.venue ?? {};
  return Boolean(
    venue.promotions?.length ||
    venue.promotions_for_telemetry?.length ||
    venue.badges_v2?.some((badge) => badge?.text),
  );
}

export async function fetchDefaultCityData() {
  return fetchCityData(CITY);
}

export function isSnapshotFresh(snapshot, { now = Date.now(), ttlMs = CACHE_TTL_MS } = {}) {
  if (!snapshot?.generatedAt || ttlMs <= 0) {
    return false;
  }

  const generatedAt = Date.parse(snapshot.generatedAt);
  return Number.isFinite(generatedAt) && now - generatedAt < ttlMs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
