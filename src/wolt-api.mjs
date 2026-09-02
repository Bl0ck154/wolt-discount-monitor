import { ProxyAgent, fetch as undiciFetch } from "undici";
import { CACHE_TTL_MS, CITY, WOLT_HEADERS } from "./config.mjs";

let proxyAgent = null;
let proxyAgentUrl = null;

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
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  const proxyDispatcher = options.proxyDispatcher === undefined ? configuredProxyDispatcher() : options.proxyDispatcher;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      try {
        return await fetchJsonOnce(url, {
          fetchImpl,
          timeoutMs,
          headers: options.headers,
        });
      } catch (directError) {
        if (!proxyDispatcher || !shouldTryProxyFallback(directError)) {
          throw directError;
        }

        console.warn(`Direct Wolt request failed; trying configured proxy fallback: ${directError.message}`);
        try {
          return await fetchJsonOnce(url, {
            fetchImpl,
            timeoutMs,
            headers: options.headers,
            dispatcher: proxyDispatcher,
          });
        } catch (proxyError) {
          proxyError.directError = directError;
          throw proxyError;
        }
      }
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

async function fetchJsonOnce(url, { fetchImpl, timeoutMs, headers, dispatcher } = {}) {
  const requestOptions = {
    headers: {
      ...WOLT_HEADERS,
      ...headers,
    },
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
  };
  if (dispatcher) requestOptions.dispatcher = dispatcher;

  const response = await fetchImpl(url, requestOptions);
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
}

function configuredProxyDispatcher() {
  const url = String(process.env.WOLT_PROXY_URL ?? "").trim();
  if (!url) return null;
  if (!proxyAgent || proxyAgentUrl !== url) {
    proxyAgent = createProxyAgent(url);
    proxyAgentUrl = url;
  }
  return proxyAgent;
}

function createProxyAgent(proxyUrl) {
  const parsed = new URL(proxyUrl);
  if (!parsed.username && !parsed.password) return new ProxyAgent(parsed.toString());

  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  parsed.username = "";
  parsed.password = "";
  const token = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  return new ProxyAgent({ uri: parsed.toString(), token });
}

export function hasConfiguredWoltProxy() {
  return Boolean(String(process.env.WOLT_PROXY_URL ?? "").trim());
}

function shouldTryProxyFallback(error) {
  return error?.statusCode === 403 || error?.statusCode === 429 || isNetworkFetchError(error);
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

  const betweenEndpointsMs = nonNegativeNumber(process.env.WOLT_API_BETWEEN_ENDPOINTS_MS, 1_000);
  if (betweenEndpointsMs > 0) await sleep(betweenEndpointsMs);

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
  return error?.retryable === true || isNetworkFetchError(error);
}

function isNetworkFetchError(error) {
  return error?.name === "TimeoutError" ||
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
