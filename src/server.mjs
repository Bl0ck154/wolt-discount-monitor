import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CITY, PATHS, cityKey } from "./config.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { fetchCityData, getWoltProxyStatus, hasConfiguredWoltProxy, isSnapshotFresh, warmWoltProxyPool } from "./wolt-api.mjs";
import { fetchWoltCityCatalog } from "./wolt-cities.mjs";
import { compactCitiesIndex, compactSnapshot, jsonText } from "./public-snapshot.mjs";
import { ingestCourierPilotTelemetry } from "./courierpilot-telemetry.mjs";
import {
  courierPilotMarketCities,
  courierPilotMarketHistory,
  courierPilotMarketProfile,
  ingestCourierPilotMarket,
} from "./courierpilot-market.mjs";
import { TaskPool } from "./refresh-pool.mjs";

const HOST = process.env.WOLT_API_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? process.env.WOLT_API_PORT ?? 3000);
const CACHE_DIR = process.env.WOLT_API_CACHE_DIR ?? ".cache/wolt-api";
const RATE_LIMIT_WINDOW_MS = Number(process.env.WOLT_API_RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_REQUESTS = Number(process.env.WOLT_API_RATE_LIMIT_REQUESTS ?? 60);
const API_CACHE_TTL_HOURS = nonNegativeNumber(process.env.WOLT_API_CACHE_TTL_HOURS, 1);
const API_CACHE_TTL_MS = API_CACHE_TTL_HOURS * 60 * 60 * 1000;
const REFRESH_CONCURRENCY = positiveInteger(process.env.WOLT_API_REFRESH_CONCURRENCY, 4);
const REFRESH_QUEUE_LIMIT = nonNegativeInteger(process.env.WOLT_API_REFRESH_QUEUE_LIMIT, 1000);
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.WOLT_API_ALLOWED_ORIGINS);

const inFlight = new Map();
const rateBuckets = new Map();
let catalogPromise = null;
const refreshPool = new TaskPool({
  concurrency: REFRESH_CONCURRENCY,
  maxQueue: REFRESH_QUEUE_LIMIT,
  name: "Wolt refresh",
});

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(error);
    sendJson(request, response, statusFromError(error), {
      error: error.publicMessage ?? error.message ?? "Internal server error",
      retryAfter: error.retryAfter,
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Wolt discount monitor API listening on http://${HOST}:${PORT}`);
  warmWoltProxyPool().then((pool) => {
    if (pool.length) console.log(`ProxyScrape health pool ready with ${pool.length} proxies`);
  }).catch((error) => {
    console.warn(`ProxyScrape warm-up failed; requests can retry/rebuild later: ${error.message}`);
  });
});

async function handleRequest(request, response) {
  if (handleCorsPreflight(request, response)) return;
  enforceRateLimit(request);

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (request.method === "GET" && pathname === "/health") {
    sendJson(request, response, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      cacheTtlMs: API_CACHE_TTL_MS,
      refresh: refreshPool.stats,
      proxyFallbackConfigured: hasConfiguredWoltProxy(),
      proxy: getWoltProxyStatus(),
    });
    return;
  }

  if (request.method === "POST" && pathname === "/courierpilot/v1/events") {
    sendJson(request, response, 200, await ingestCourierPilotTelemetry(request));
    return;
  }

  if (request.method === "POST" && pathname === "/courierpilot/v1/market/offers") {
    sendJson(request, response, 200, await ingestCourierPilotMarket(request, { schema: 1 }));
    return;
  }

  if (request.method === "POST" && pathname === "/courierpilot/v2/market/observations") {
    sendJson(request, response, 200, await ingestCourierPilotMarket(request, { schema: 2 }));
    return;
  }

  if (request.method === "GET" && pathname === "/courierpilot/v1/market/profile") {
    sendJson(request, response, 200, courierPilotMarketProfile(url.searchParams), {
      cacheControl: "public, max-age=120, stale-while-revalidate=300",
    });
    return;
  }

  if (request.method === "GET" && pathname === "/courierpilot/v2/market/profile") {
    sendJson(request, response, 200, courierPilotMarketProfile(url.searchParams, Date.now(), { schema: 2 }), { cacheControl: "public, max-age=120" });
    return;
  }

  if (request.method === "GET" && pathname === "/courierpilot/v2/market/history") {
    sendJson(request, response, 200, courierPilotMarketHistory(url.searchParams), { cacheControl: "public, max-age=300" });
    return;
  }

  if (request.method === "GET" && pathname === "/courierpilot/v1/market/cities") {
    sendJson(request, response, 200, courierPilotMarketCities(), {
      cacheControl: "public, max-age=300, stale-while-revalidate=900",
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/cities") {
    const catalog = await loadCatalog();
    sendJson(request, response, 200, await citiesResponse(catalog), {
      cacheControl: "public, max-age=300, stale-while-revalidate=900",
    });
    return;
  }

  const latestMatch = pathname.match(/^\/api\/cities\/([^/]+)\/([^/]+)\/latest$/);
  if (request.method === "GET" && latestMatch) {
    const [, country, slug] = latestMatch;
    const city = await findCity(`${country}/${slug}`);
    const { snapshot, cacheStatus, revalidation } = await latestSnapshot(city);
    response.setHeader("X-Wolt-Cache", cacheStatus);
    if (revalidation) response.setHeader("X-Wolt-Revalidate", revalidation);
    sendJson(request, response, 200, snapshot, {
      cacheControl: "public, max-age=60, stale-while-revalidate=300",
    });
    return;
  }

  throw httpError(404, "Not found");
}

async function latestSnapshot(city) {
  const cachePath = snapshotPath(city);
  const cached = await readJsonIfExists(cachePath);

  if (cached) {
    const compacted = compactSnapshot(cached);
    if (JSON.stringify(compacted).length < JSON.stringify(cached).length) {
      await writeJson(cachePath, compacted);
    }
    if (process.env.FORCE_WRITE !== "true" && isSnapshotFresh(compacted, { ttlMs: API_CACHE_TTL_MS })) {
      return { snapshot: compacted, cacheStatus: "HIT" };
    }

    const { promise, started } = ensureRefresh(city, cachePath);
    if (started) {
      promise.catch((error) => {
        console.error(`[wolt-refresh] background refresh failed for ${city.id}: ${error.message}`);
      });
    }
    return {
      snapshot: compacted,
      cacheStatus: "STALE",
      revalidation: started ? "STARTED" : "IN-FLIGHT",
    };
  }

  const { promise } = ensureRefresh(city, cachePath);
  return { snapshot: await promise, cacheStatus: "MISS" };
}

function ensureRefresh(city, cachePath) {
  const key = cityKey(city);
  if (inFlight.has(key)) return { promise: inFlight.get(key), started: false };

  const promise = refreshPool
    .run(() => refreshSnapshot(city, cachePath))
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return { promise, started: true };
}

async function refreshSnapshot(city, cachePath) {
  const snapshot = await normalizeSnapshotFromWolt(city);
  await writeJson(cachePath, snapshot);
  return snapshot;
}

async function normalizeSnapshotFromWolt(city) {
  return compactSnapshot(normalizeSnapshot(await fetchCityData(city)));
}

async function citiesResponse(catalog) {
  const cities = await Promise.all((catalog.cities ?? []).map(async (city) => {
    const cached = await readJsonIfExists(snapshotPath(city));
    return {
      id: city.id,
      key: cityKey(city),
      slug: city.slug,
      name: city.name,
      country: city.country,
      countryCode2: city.countryCode2,
      lat: city.lat,
      lon: city.lon,
      label: city.label,
      apiPath: `/api/cities/${city.id}/latest`,
      updatedAt: cached?.generatedAt ?? null,
      stale: cached ? !isSnapshotFresh(cached, { ttlMs: API_CACHE_TTL_MS }) : true,
      counts: cached?.counts ?? null,
    };
  }));

  return compactCitiesIndex({
    generatedAt: new Date().toISOString(),
    defaultCityId: CITY.id,
    cacheTtlMs: API_CACHE_TTL_MS,
    totalCities: catalog.totalCities ?? cities.length,
    cities,
  });
}

async function findCity(id) {
  const catalog = await loadCatalog();
  const city = (catalog.cities ?? []).find((candidate) => candidate.id === id || candidate.key === id);
  if (!city) throw httpError(404, `Unknown city "${id}"`);
  return city;
}

async function loadCatalog() {
  if (!catalogPromise) catalogPromise = loadCatalogOnce();
  return catalogPromise;
}

async function loadCatalogOnce() {
  if (process.env.WOLT_REFRESH_CITY_CATALOG !== "true") {
    const existing = await readJsonIfExists(PATHS.cityCatalog);
    if (existing?.cities?.length) return existing;
  }
  return fetchWoltCityCatalog();
}

function snapshotPath(city) {
  return join(CACHE_DIR, "cities", cityKey(city), "latest.json");
}

function enforceRateLimit(request) {
  if (RATE_LIMIT_REQUESTS <= 0 || RATE_LIMIT_WINDOW_MS <= 0) return;

  const ip = clientIp(request);
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    cleanupRateBuckets(now);
    return;
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_REQUESTS) {
    const error = httpError(429, "Rate limit exceeded");
    error.retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    throw error;
  }
}

function cleanupRateBuckets(now) {
  for (const [ip, bucket] of rateBuckets.entries()) {
    if (now >= bucket.resetAt) rateBuckets.delete(ip);
  }
}

function clientIp(request) {
  return String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "unknown")
    .split(",")[0]
    .trim();
}

function handleCorsPreflight(request, response) {
  if (request.method !== "OPTIONS") return false;
  setCorsHeaders(request, response);
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.writeHead(204);
  response.end();
  return true;
}

function sendJson(request, response, statusCode, value, { cacheControl = "no-store" } = {}) {
  setCorsHeaders(request, response);
  const body = jsonText(value);
  const etag = `W/"${createHash("sha1").update(body).digest("base64url").slice(0, 20)}"`;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", cacheControl);
  response.setHeader("ETag", etag);
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (value?.retryAfter) response.setHeader("Retry-After", String(value.retryAfter));

  if (statusCode === 200 && request.headers["if-none-match"] === etag) {
    response.writeHead(304);
    response.end();
    return;
  }

  response.writeHead(statusCode);
  response.end(body);
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin) return;
  if (isAllowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
}

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has("*")) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^https?:\/\/localhost(?::\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin);
}

function parseAllowedOrigins(value) {
  return new Set(
    String(value ?? "https://bl0ck154.github.io")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, jsonText(value), "utf8");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function statusFromError(error) {
  return Number.isInteger(error.statusCode) ? error.statusCode : 500;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
