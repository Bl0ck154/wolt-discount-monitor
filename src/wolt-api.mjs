import { CACHE_TTL_MS, CITY, WOLT_HEADERS } from "./config.mjs";

export function endpoints({ lat = CITY.lat, lon = CITY.lon } = {}) {
  return {
    restaurants: `https://consumer-api.wolt.com/v1/pages/restaurants?lat=${lat}&lon=${lon}`,
    promotions: `https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=${lon}&lat=${lat}`,
  };
}

export async function fetchJson(url, options = {}) {
  const maxAttempts = positiveInteger(options.maxAttempts ?? process.env.WOLT_API_MAX_ATTEMPTS, 7);
  const retryBaseMs = nonNegativeNumber(options.retryBaseMs ?? process.env.WOLT_API_RETRY_BASE_MS, 30_000);
  const retryJitterMs = nonNegativeNumber(options.retryJitterMs ?? process.env.WOLT_API_RETRY_JITTER_MS, 5_000);
  const timeoutMs = nonNegativeNumber(options.timeoutMs ?? process.env.WOLT_API_TIMEOUT_MS, 30_000);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: WOLT_HEADERS,
        signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      const text = await response.text();

      if (response.ok) {
        try {
          return JSON.parse(text);
        } catch (error) {
          const invalidJson = new Error(`Invalid JSON from Wolt API: ${error.message}; body: ${text.slice(0, 200)}`);
          invalidJson.retryable = true;
          throw invalidJson;
        }
      }

      const httpError = new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
      httpError.statusCode = response.status;
      httpError.retryAfter = response.headers.get("retry-after");
      httpError.retryable = response.status === 429 || response.status >= 500;
      throw httpError;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableFetchError(error)) {
        throw error;
      }

      const delayMs = retryDelayMs({
        attempt,
        retryBaseMs,
        retryJitterMs,
        retryAfter: error.retryAfter,
      });
      console.warn(
        `Wolt API request failed; retrying attempt ${attempt + 1}/${maxAttempts} in ${Math.round(delayMs / 1000)}s: ${error.message}`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
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
    promotionsPayload = await fetchJson(urls.promotions, { maxAttempts: 1 });
  } catch (error) {
    console.warn(`Could not fetch promotions endpoint; falling back to restaurant venues: ${error.message}`);
  }

  await sleep(5000);

  try {
    restaurantsPayload = await fetchJson(urls.restaurants, {
      maxAttempts: promotionsPayload.sections?.length ? 2 : 3,
      retryBaseMs: 15000,
    });
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

function isRetryableFetchError(error) {
  return error?.retryable === true ||
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    error instanceof TypeError;
}

function retryDelayMs({ attempt, retryBaseMs, retryJitterMs, retryAfter }) {
  const retryAfterSeconds = Number(retryAfter);
  const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
    ? retryAfterSeconds * 1000
    : 0;
  const jitterMs = retryJitterMs > 0 ? Math.round(Math.random() * retryJitterMs) : 0;
  return Math.max(retryAfterMs, retryBaseMs * attempt + jitterMs);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
