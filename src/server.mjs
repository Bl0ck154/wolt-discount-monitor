import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CACHE_TTL_MS, PATHS, cityKey } from "./config.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { fetchCityData, isSnapshotFresh } from "./wolt-api.mjs";
import { fetchWoltCityCatalog } from "./wolt-cities.mjs";

const HOST = process.env.WOLT_API_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? process.env.WOLT_API_PORT ?? 3000);
const CACHE_DIR = process.env.WOLT_API_CACHE_DIR ?? ".cache/wolt-api";
const RATE_LIMIT_WINDOW_MS = Number(process.env.WOLT_API_RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_REQUESTS = Number(process.env.WOLT_API_RATE_LIMIT_REQUESTS ?? 60);
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.WOLT_API_ALLOWED_ORIGINS);

const inFlight = new Map();
const rateBuckets = new Map();
let catalogPromise = null;
let refreshQueue = Promise.resolve();

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
});

async function handleRequest(request, response) {
  if (handleCorsPreflight(request, response)) {
    return;
  }

  enforceRateLimit(request);

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (request.method === "GET" && pathname === "/health") {
    sendJson(request, response, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      cacheTtlMs: CACHE_TTL_MS,
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/cities") {
    const catalog = await loadCatalog();
    sendJson(request, response, 200, await citiesResponse(catalog));
    return;
  }

  const latestMatch = pathname.match(/^\/api\/cities\/([^/]+)\/([^/]+)\/latest$/);
  if (request.method === "GET" && latestMatch) {
    const [, country, slug] = latestMatch;
    const city = await findCity(`${country}/${slug}`);
    const { snapshot, cacheHit } = await latestSnapshot(city);
    response.setHeader("X-Wolt-Cache", cacheHit ? "HIT" : "MISS");
    sendJson(request, response, 200, snapshot);
    return;
  }

  throw httpError(404, "Not found");
}

async function latestSnapshot(city) {
  const key = cityKey(city);
  const cachePath = snapshotPath(city);
  const cached = await readJsonIfExists(cachePath);

  if (process.env.FORCE_WRITE !== "true" && isSnapshotFresh(cached)) {
    return { snapshot: cached, cacheHit: true };
  }

  if (!inFlight.has(key)) {
    inFlight.set(key, refreshSnapshot(city, cachePath).finally(() => inFlight.delete(key)));
  }

  return { snapshot: await inFlight.get(key), cacheHit: false };
}

async function refreshSnapshot(city, cachePath) {
  const snapshot = await enqueueRefresh(() => normalizeSnapshotFromWolt(city));
  await writeJson(cachePath, snapshot);
  return snapshot;
}

function enqueueRefresh(task) {
  const queued = refreshQueue.catch(() => {}).then(task);
  refreshQueue = queued.catch(() => {});
  return queued;
}

async function normalizeSnapshotFromWolt(city) {
  return normalizeSnapshot(await fetchCityData(city));
}

async function citiesResponse(catalog) {
  const cities = await Promise.all((catalog.cities ?? []).map(async (city) => {
    const cached = await readJsonIfExists(snapshotPath(city));
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
      label: city.label,
      apiPath: `/api/cities/${city.id}/latest`,
      updatedAt: cached?.generatedAt ?? null,
      stale: cached ? !isSnapshotFresh(cached) : true,
      counts: cached?.counts ?? null,
    };
  }));

  return {
    generatedAt: new Date().toISOString(),
    cacheTtlMs: CACHE_TTL_MS,
    totalCities: catalog.totalCities ?? cities.length,
    totalCountries: catalog.totalCountries,
    countries: catalog.countries,
    cities,
  };
}

async function findCity(id) {
  const catalog = await loadCatalog();
  const city = (catalog.cities ?? []).find((candidate) => candidate.id === id || candidate.key === id);
  if (!city) {
    throw httpError(404, `Unknown city "${id}"`);
  }
  return city;
}

async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = loadCatalogOnce();
  }
  return catalogPromise;
}

async function loadCatalogOnce() {
  if (process.env.WOLT_REFRESH_CITY_CATALOG !== "true") {
    const existing = await readJsonIfExists(PATHS.cityCatalog);
    if (existing?.cities?.length) {
      return existing;
    }
  }
  return fetchWoltCityCatalog();
}

function snapshotPath(city) {
  return join(CACHE_DIR, "cities", cityKey(city), "latest.json");
}

function enforceRateLimit(request) {
  if (RATE_LIMIT_REQUESTS <= 0 || RATE_LIMIT_WINDOW_MS <= 0) {
    return;
  }

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
    if (now >= bucket.resetAt) {
      rateBuckets.delete(ip);
    }
  }
}

function clientIp(request) {
  return String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "unknown")
    .split(",")[0]
    .trim();
}

function handleCorsPreflight(request, response) {
  if (request.method !== "OPTIONS") {
    return false;
  }

  setCorsHeaders(request, response);
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.writeHead(204);
  response.end();
  return true;
}

function sendJson(request, response, statusCode, value) {
  setCorsHeaders(request, response);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (value?.retryAfter) {
    response.setHeader("Retry-After", String(value.retryAfter));
  }
  response.writeHead(statusCode);
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  if (isAllowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
}

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has("*")) {
    return true;
  }
  if (ALLOWED_ORIGINS.has(origin)) {
    return true;
  }
  return /^https?:\/\/localhost(?::\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin);
}

function parseAllowedOrigins(value) {
  const origins = new Set(
    String(value ?? "https://bl0ck154.github.io")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  return origins;
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

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function statusFromError(error) {
  return Number.isInteger(error.statusCode) ? error.statusCode : 500;
}
