import { CACHE_TTL_MS, CITY, WOLT_HEADERS } from "./config.mjs";

const PROXYSCRAPE_API_URL = "https://api.proxyscrape.com/v4/free-proxy-list/get";
const SCRAPERAPI_API_URL = "https://api.scraperapi.com/";

let proxyAgent = null;
let proxyAgentUrl = null;
let proxyFetchImpl = null;
let proxyScrapePool = [];
let proxyScrapePoolFetchedAt = 0;
let proxyScrapeCursor = 0;
const proxyScrapeCooldownUntil = new Map();

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
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
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
        if (!shouldTryProxyFallback(directError)) {
          throw directError;
        }

        return await tryConfiguredFallbacks(url, {
          directError,
          fetchImpl,
          timeoutMs,
          headers: options.headers,
          options,
        });
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

async function tryConfiguredFallbacks(url, { directError, fetchImpl, timeoutMs, headers, options }) {
  let lastError = directError;
  let attemptedFallback = false;

  const staticProxyTransport = options.proxyDispatcher !== undefined
    ? (options.proxyDispatcher ? { dispatcher: options.proxyDispatcher, fetchImpl } : null)
    : await configuredStaticProxyTransport();

  if (staticProxyTransport?.dispatcher) {
    attemptedFallback = true;
    console.warn(`Direct Wolt request failed; trying configured static proxy: ${directError.message}`);
    try {
      return await fetchJsonOnce(url, {
        fetchImpl: staticProxyTransport.fetchImpl ?? fetchImpl,
        timeoutMs,
        headers,
        dispatcher: staticProxyTransport.dispatcher,
      });
    } catch (error) {
      lastError = error;
      if (!shouldTryAnotherProxy(error)) throw error;
      console.warn(`Static proxy failed; continuing to another fallback: ${error.message}`);
    }
  }

  const proxyScrapeEnabled = options.proxyScrapeList !== undefined || parseBoolean(
    options.proxyScrapeEnabled ?? process.env.WOLT_PROXYSCRAPE_ENABLED,
    false,
  );

  if (proxyScrapeEnabled) {
    attemptedFallback = true;
    try {
      return await tryProxyScrapeFallback(url, { headers, timeoutMs, options });
    } catch (error) {
      lastError = error;
      if (!shouldTryAnotherProxy(error)) throw error;
      console.warn(`ProxyScrape fallback exhausted; continuing: ${error.message}`);
    }
  }

  const scraperApiKey = String(options.scraperApiKey ?? process.env.SCRAPERAPI_API_KEY ?? "").trim();
  if (scraperApiKey) {
    attemptedFallback = true;
    console.warn("Trying ScraperAPI fallback after direct/proxy failure.");
    try {
      return await fetchViaScraperApi(url, {
        apiKey: scraperApiKey,
        fetchImpl: options.scraperApiFetchImpl ?? fetchImpl,
        timeoutMs,
        headers,
        countryCode: options.scraperApiCountryCode ?? process.env.SCRAPERAPI_COUNTRY_CODE,
      });
    } catch (error) {
      lastError = error;
      console.warn(`ScraperAPI fallback failed: ${error.message}`);
    }
  }

  if (!attemptedFallback) throw directError;
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
  return parseJsonResponse(response, "Wolt API");
}

async function fetchViaScraperApi(url, { apiKey, fetchImpl, timeoutMs, headers, countryCode } = {}) {
  const requestUrl = buildScraperApiUrl(url, apiKey, { countryCode });
  const response = await fetchImpl(requestUrl, {
    headers: {
      ...WOLT_HEADERS,
      ...headers,
    },
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const text = await response.text();

  if (response.ok) {
    try {
      return JSON.parse(text);
    } catch (error) {
      const invalidJson = new Error(`Invalid JSON from ScraperAPI/Wolt: ${error.message}; body: ${text.slice(0, 200)}`);
      invalidJson.retryable = true;
      throw invalidJson;
    }
  }

  const error = new Error(`ScraperAPI ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  error.statusCode = response.status;
  error.retryAfter = response.headers.get("retry-after");
  // Avoid burning credits by repeatedly retrying auth/quota/client errors.
  error.retryable = response.status >= 500;
  throw error;
}

async function parseJsonResponse(response, sourceLabel) {
  const text = await response.text();

  if (response.ok) {
    try {
      return JSON.parse(text);
    } catch (error) {
      const invalidJson = new Error(`Invalid JSON from ${sourceLabel}: ${error.message}; body: ${text.slice(0, 200)}`);
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

async function configuredStaticProxyTransport() {
  const url = String(process.env.WOLT_PROXY_URL ?? "").trim();
  if (!url) return null;

  if (!proxyAgent || proxyAgentUrl !== url) {
    const { ProxyAgent, fetch: undiciFetch } = await import("undici");
    proxyAgent = createProxyAgent(url, ProxyAgent);
    proxyAgentUrl = url;
    proxyFetchImpl = undiciFetch;
  }

  return { dispatcher: proxyAgent, fetchImpl: proxyFetchImpl };
}

async function tryProxyScrapeFallback(url, { headers, timeoutMs, options }) {
  const proxies = options.proxyScrapeList !== undefined
    ? normalizeProxyList(options.proxyScrapeList)
    : await loadProxyScrapePool({
      fetchImpl: options.proxyScrapeListFetchImpl ?? globalThis.fetch,
      timeoutMs: options.proxyScrapeListTimeoutMs,
      limit: options.proxyScrapeLimit,
      country: options.proxyScrapeCountry,
      anonymity: options.proxyScrapeAnonymity,
    });

  if (!proxies.length) {
    const error = new Error("ProxyScrape returned no usable HTTPS-capable HTTP proxies");
    error.retryable = true;
    throw error;
  }

  const maxTries = positiveInteger(
    options.proxyScrapeMaxTries ?? process.env.WOLT_PROXYSCRAPE_MAX_TRIES,
    8,
  );
  const perProxyTimeoutMs = nonNegativeNumber(
    options.proxyScrapeProxyTimeoutMs ?? process.env.WOLT_PROXYSCRAPE_PROXY_TIMEOUT_MS,
    10_000,
  );
  const cooldownMs = nonNegativeNumber(
    options.proxyScrapeCooldownMs ?? process.env.WOLT_PROXYSCRAPE_COOLDOWN_MS,
    10 * 60_000,
  );
  const effectiveTimeoutMs = timeoutMs > 0
    ? Math.min(timeoutMs, perProxyTimeoutMs || timeoutMs)
    : perProxyTimeoutMs;

  const { ProxyAgent, fetch: undiciFetch } = await import("undici");
  const proxiedFetch = options.proxyFetchImpl ?? undiciFetch;
  let lastError;
  let tries = 0;

  while (tries < Math.min(maxTries, proxies.length)) {
    const proxy = takeNextProxy(proxies);
    if (!proxy) break;
    tries += 1;

    const proxyUrl = /^https?:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
    const dispatcher = createProxyAgent(proxyUrl, ProxyAgent);
    try {
      const result = await fetchJsonOnce(url, {
        fetchImpl: proxiedFetch,
        timeoutMs: effectiveTimeoutMs,
        headers,
        dispatcher,
      });
      proxyScrapeCooldownUntil.delete(proxy);
      return result;
    } catch (error) {
      lastError = error;
      proxyScrapeCooldownUntil.set(proxy, Date.now() + cooldownMs);
      if (!shouldTryAnotherProxy(error)) throw error;
    } finally {
      try {
        const destroyed = dispatcher.destroy?.();
        destroyed?.catch?.(() => {});
      } catch {
        // Ignore cleanup failures from an already-dead free proxy connection.
      }
    }
  }

  if (lastError) throw lastError;
  const error = new Error("ProxyScrape pool has no currently usable proxies");
  error.retryable = true;
  throw error;
}

async function loadProxyScrapePool({ fetchImpl, timeoutMs, limit, country, anonymity } = {}) {
  const now = Date.now();
  const refreshMs = nonNegativeNumber(process.env.WOLT_PROXYSCRAPE_REFRESH_MS, 15 * 60_000);
  if (proxyScrapePool.length && now - proxyScrapePoolFetchedAt < refreshMs) {
    return proxyScrapePool;
  }

  const requestUrl = buildProxyScrapeListUrl({ limit, country, anonymity });
  const listTimeoutMs = nonNegativeNumber(
    timeoutMs ?? process.env.WOLT_PROXYSCRAPE_LIST_TIMEOUT_MS,
    15_000,
  );
  const response = await fetchImpl(requestUrl, {
    signal: listTimeoutMs > 0 ? AbortSignal.timeout(listTimeoutMs) : undefined,
  });
  if (!response.ok) {
    const error = new Error(`ProxyScrape list request failed: ${response.status} ${response.statusText}`);
    error.statusCode = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }

  const text = await response.text();
  const parsed = parseProxyScrapeList(text);
  if (!parsed.length) {
    const error = new Error("ProxyScrape list response contained no usable proxies");
    error.retryable = true;
    throw error;
  }

  shuffleInPlace(parsed);
  proxyScrapePool = parsed;
  proxyScrapePoolFetchedAt = now;
  proxyScrapeCursor = 0;
  pruneProxyCooldowns(now);
  return proxyScrapePool;
}

export function buildProxyScrapeListUrl({ limit, country, anonymity } = {}) {
  const url = new URL(PROXYSCRAPE_API_URL);
  url.searchParams.set("request", "displayproxies");
  url.searchParams.set("protocol", "http");
  url.searchParams.set("ssl", "yes");
  url.searchParams.set("timeout", String(positiveInteger(limitNumber(process.env.WOLT_PROXYSCRAPE_SOURCE_TIMEOUT_MS, 5_000), 5_000)));
  url.searchParams.set("limit", String(Math.min(2_000, positiveInteger(limit ?? process.env.WOLT_PROXYSCRAPE_LIMIT, 200))));
  url.searchParams.set("anonymity", String(anonymity ?? process.env.WOLT_PROXYSCRAPE_ANONYMITY ?? "elite,anonymous"));
  const selectedCountry = String(country ?? process.env.WOLT_PROXYSCRAPE_COUNTRY ?? "").trim();
  if (selectedCountry) url.searchParams.set("country", selectedCountry);
  return url.toString();
}

export function parseProxyScrapeList(value) {
  return normalizeProxyList(String(value ?? "").split(/\r?\n/));
}

function normalizeProxyList(value) {
  const rows = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const proxies = [];

  for (const raw of rows) {
    const proxy = String(raw ?? "").trim();
    if (!proxy || seen.has(proxy)) continue;
    const withoutScheme = proxy.replace(/^https?:\/\//i, "");
    if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(withoutScheme)) continue;
    seen.add(proxy);
    proxies.push(proxy);
  }

  return proxies;
}

export function buildScraperApiUrl(targetUrl, apiKey, { countryCode } = {}) {
  const url = new URL(SCRAPERAPI_API_URL);
  url.searchParams.set("api_key", String(apiKey));
  url.searchParams.set("url", String(targetUrl));
  url.searchParams.set("keep_headers", "true");
  const selectedCountry = String(countryCode ?? "").trim();
  if (selectedCountry) url.searchParams.set("country_code", selectedCountry);
  return url.toString();
}

function takeNextProxy(proxies) {
  if (!proxies.length) return null;
  const now = Date.now();

  for (let checked = 0; checked < proxies.length; checked += 1) {
    const index = proxyScrapeCursor % proxies.length;
    proxyScrapeCursor = (proxyScrapeCursor + 1) % proxies.length;
    const proxy = proxies[index];
    if ((proxyScrapeCooldownUntil.get(proxy) ?? 0) <= now) return proxy;
  }

  return null;
}

function pruneProxyCooldowns(now = Date.now()) {
  for (const [proxy, until] of proxyScrapeCooldownUntil) {
    if (until <= now || !proxyScrapePool.includes(proxy)) {
      proxyScrapeCooldownUntil.delete(proxy);
    }
  }
}

function shuffleInPlace(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

function limitNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createProxyAgent(proxyUrl, ProxyAgent) {
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
  return Boolean(
    String(process.env.WOLT_PROXY_URL ?? "").trim() ||
    parseBoolean(process.env.WOLT_PROXYSCRAPE_ENABLED, false) ||
    String(process.env.SCRAPERAPI_API_KEY ?? "").trim()
  );
}

function shouldTryProxyFallback(error) {
  return error?.statusCode === 403 || error?.statusCode === 429 || isNetworkFetchError(error);
}

function shouldTryAnotherProxy(error) {
  return error?.retryable === true ||
    error?.statusCode === 403 ||
    error?.statusCode === 407 ||
    error?.statusCode === 429 ||
    isNetworkFetchError(error);
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

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
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
