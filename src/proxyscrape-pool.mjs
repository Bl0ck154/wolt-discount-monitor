import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const PROXYSCRAPE_API_URL = "https://api.proxyscrape.com/v4/free-proxy-list/get";
const DEFAULT_PROBE_URL = "https://consumer-api.wolt.com/v1/pages/restaurants?lat=0&lon=0";

const state = {
  entries: new Map(),
  healthy: [],
  cursor: 0,
  sourceCount: 0,
  lastRefreshAt: 0,
  lastRefreshDurationMs: 0,
  lastError: null,
  refreshPromise: null,
  cacheLoaded: false,
};

let undiciPromise = null;

export async function fetchViaHealthyProxy(url, {
  headers = {},
  timeoutMs = 30_000,
  proxyFetchImpl,
  proxyList,
  sourceFetchImpl = globalThis.fetch,
  listTimeoutMs,
  listLimit,
  country,
  anonymity,
  maxTries,
  perProxyTimeoutMs,
  cooldownMs,
  healthTimeoutMs,
  healthConcurrency,
  targetHealthy,
  minHealthy,
  healthTtlMs,
  refreshMs,
  probeUrl,
  cacheFile,
  healthProbeImpl,
} = {}) {
  const explicit = proxyList !== undefined;
  const proxies = explicit
    ? normalizeProxyList(proxyList)
    : await ensureHealthyPool({
      sourceFetchImpl,
      listTimeoutMs,
      listLimit,
      country,
      anonymity,
      healthTimeoutMs,
      healthConcurrency,
      targetHealthy,
      minHealthy,
      healthTtlMs,
      refreshMs,
      probeUrl,
      cacheFile,
      headers,
      healthProbeImpl,
    });

  if (!proxies.length) throw retryableError("ProxyScrape healthy pool is empty");

  const triesLimit = positiveInteger(maxTries ?? process.env.WOLT_PROXYSCRAPE_MAX_TRIES, 6);
  const requestTimeoutMs = nonNegativeNumber(
    perProxyTimeoutMs ?? process.env.WOLT_PROXYSCRAPE_PROXY_TIMEOUT_MS,
    4_000,
  );
  const effectiveTimeoutMs = timeoutMs > 0
    ? Math.min(timeoutMs, requestTimeoutMs || timeoutMs)
    : requestTimeoutMs;
  const failureCooldownMs = nonNegativeNumber(
    cooldownMs ?? process.env.WOLT_PROXYSCRAPE_COOLDOWN_MS,
    10 * 60_000,
  );

  const { ProxyAgent, fetch: undiciFetch } = await getUndici();
  const proxiedFetch = proxyFetchImpl ?? undiciFetch;
  const attempted = new Set();
  let lastError;

  for (let tries = 0; tries < Math.min(triesLimit, proxies.length); tries += 1) {
    const proxy = explicit ? proxies[tries] : takeNextHealthyProxy(attempted);
    if (!proxy) break;
    attempted.add(proxy);
    const started = Date.now();
    const dispatcher = createProxyAgent(proxy, ProxyAgent);
    try {
      const response = await proxiedFetch(url, {
        headers,
        dispatcher,
        signal: effectiveTimeoutMs > 0 ? AbortSignal.timeout(effectiveTimeoutMs) : undefined,
      });
      if (response.ok) {
        // Buffer the body before destroying the per-proxy dispatcher. Returning
        // the original streaming Response and closing ProxyAgent here would
        // terminate large Wolt JSON bodies while the caller is still reading.
        const body = await response.arrayBuffer();
        const bufferedResponse = new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        markProxySuccess(proxy, Date.now() - started);
        maybeScheduleRefresh({
          sourceFetchImpl,
          listTimeoutMs,
          listLimit,
          country,
          anonymity,
          healthTimeoutMs,
          healthConcurrency,
          targetHealthy,
          minHealthy,
          healthTtlMs,
          refreshMs,
          probeUrl,
          cacheFile,
          headers,
          healthProbeImpl,
        });
        return bufferedResponse;
      }

      const text = await response.text();
      const error = new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
      error.statusCode = response.status;
      error.retryAfter = response.headers.get("retry-after");
      error.retryable = response.status === 403 || response.status === 407 || response.status === 429 || response.status >= 500;
      throw error;
    } catch (error) {
      lastError = error;
      markProxyFailure(proxy, failureCooldownMs);
      if (!shouldTryAnotherProxy(error)) throw error;
    } finally {
      destroyDispatcher(dispatcher);
    }
  }

  maybeScheduleRefresh({
    sourceFetchImpl,
    listTimeoutMs,
    listLimit,
    country,
    anonymity,
    healthTimeoutMs,
    healthConcurrency,
    targetHealthy,
    minHealthy,
    healthTtlMs,
    refreshMs,
    probeUrl,
    cacheFile,
    headers,
    healthProbeImpl,
  }, true);
  if (lastError) throw lastError;
  throw retryableError("ProxyScrape healthy pool has no available proxies");
}

export async function warmProxyScrapePool(options = {}) {
  return ensureHealthyPool({ ...options, forceRefresh: true });
}

export function getProxyScrapeStatus() {
  const now = Date.now();
  const available = state.healthy.filter((proxy) => isEntryUsable(state.entries.get(proxy), now)).length;
  return {
    source: "proxyscrape",
    candidates: state.sourceCount,
    healthy: state.healthy.length,
    available,
    refreshInFlight: Boolean(state.refreshPromise),
    lastRefreshAt: state.lastRefreshAt ? new Date(state.lastRefreshAt).toISOString() : null,
    lastRefreshDurationMs: state.lastRefreshDurationMs,
    lastError: state.lastError,
  };
}

async function ensureHealthyPool(options = {}) {
  await loadCacheOnce(options.cacheFile);
  const now = Date.now();
  const healthTtl = nonNegativeNumber(options.healthTtlMs ?? process.env.WOLT_PROXYSCRAPE_HEALTH_TTL_MS, 10 * 60_000);
  const minHealthy = positiveInteger(options.minHealthy ?? process.env.WOLT_PROXYSCRAPE_MIN_HEALTHY, 8);
  const refreshEveryMs = nonNegativeNumber(options.refreshMs ?? process.env.WOLT_PROXYSCRAPE_REFRESH_MS, 15 * 60_000);
  const usable = usableHealthyProxies(now, healthTtl);
  const due = !state.lastRefreshAt || now - state.lastRefreshAt >= refreshEveryMs;

  if (!options.forceRefresh && usable.length >= minHealthy) {
    if (due) maybeScheduleRefresh(options);
    return usable;
  }

  await refreshHealthyPool(options);
  const refreshed = usableHealthyProxies(Date.now(), healthTtl);
  if (!refreshed.length) throw retryableError(state.lastError || "ProxyScrape health check found no working proxies");
  return refreshed;
}

function maybeScheduleRefresh(options = {}, force = false) {
  if (state.refreshPromise) return;
  const minHealthy = positiveInteger(options.minHealthy ?? process.env.WOLT_PROXYSCRAPE_MIN_HEALTHY, 8);
  const refreshEveryMs = nonNegativeNumber(options.refreshMs ?? process.env.WOLT_PROXYSCRAPE_REFRESH_MS, 15 * 60_000);
  const now = Date.now();
  const available = state.healthy.filter((proxy) => isEntryUsable(state.entries.get(proxy), now)).length;
  if (!force && available >= minHealthy && state.lastRefreshAt && now - state.lastRefreshAt < refreshEveryMs) return;
  refreshHealthyPool(options).catch((error) => {
    console.warn(`ProxyScrape background health refresh failed: ${error.message}`);
  });
}

async function refreshHealthyPool(options = {}) {
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = (async () => {
    const started = Date.now();
    try {
      const candidates = await loadCandidateList(options);
      state.sourceCount = candidates.length;
      const targetHealthy = positiveInteger(options.targetHealthy ?? process.env.WOLT_PROXYSCRAPE_TARGET_HEALTHY, 20);
      const concurrency = positiveInteger(options.healthConcurrency ?? process.env.WOLT_PROXYSCRAPE_HEALTH_CONCURRENCY, 20);
      const probeTimeoutMs = nonNegativeNumber(options.healthTimeoutMs ?? process.env.WOLT_PROXYSCRAPE_HEALTH_TIMEOUT_MS, 4_000);
      const probeUrl = String(options.probeUrl ?? process.env.WOLT_PROXYSCRAPE_PROBE_URL ?? DEFAULT_PROBE_URL);
      const maxCandidates = Math.min(
        candidates.length,
        positiveInteger(process.env.WOLT_PROXYSCRAPE_HEALTH_MAX_CANDIDATES, 120),
      );

      const knownGood = candidates.filter((proxy) => state.entries.get(proxy)?.lastSuccessAt);
      const unknown = candidates.filter((proxy) => !state.entries.get(proxy)?.lastSuccessAt);
      shuffleInPlace(knownGood);
      shuffleInPlace(unknown);
      const ordered = [...knownGood, ...unknown].slice(0, maxCandidates);
      const results = await healthCheckProxyCandidates(ordered, {
        concurrency,
        targetHealthy,
        probe: options.healthProbeImpl ?? ((proxy) => probeWoltProxy(proxy, {
          timeoutMs: probeTimeoutMs,
          probeUrl,
          headers: options.headers,
        })),
      });

      const checkedAt = Date.now();
      for (const result of results.checked) {
        const previous = state.entries.get(result.proxy) ?? emptyEntry(result.proxy);
        if (result.ok) {
          state.entries.set(result.proxy, {
            ...previous,
            proxy: result.proxy,
            lastCheckedAt: checkedAt,
            lastSuccessAt: checkedAt,
            successes: previous.successes + 1,
            latencyMs: movingAverage(previous.latencyMs, result.latencyMs),
            cooldownUntil: 0,
          });
        } else {
          state.entries.set(result.proxy, {
            ...previous,
            proxy: result.proxy,
            lastCheckedAt: checkedAt,
            failures: previous.failures + 1,
          });
        }
      }

      state.healthy = results.healthy
        .map((result) => result.proxy)
        .sort((a, b) => proxyScore(state.entries.get(b)) - proxyScore(state.entries.get(a)));
      state.cursor = 0;
      state.lastRefreshAt = checkedAt;
      state.lastRefreshDurationMs = Date.now() - started;
      state.lastError = null;
      await persistCache(options.cacheFile);
      return state.healthy;
    } catch (error) {
      state.lastError = error.message;
      state.lastRefreshDurationMs = Date.now() - started;
      throw error;
    } finally {
      state.refreshPromise = null;
    }
  })();
  return state.refreshPromise;
}

async function loadCandidateList(options = {}) {
  const requestUrl = buildProxyScrapeListUrl({
    limit: options.listLimit,
    country: options.country,
    anonymity: options.anonymity,
  });
  const timeoutMs = nonNegativeNumber(options.listTimeoutMs ?? process.env.WOLT_PROXYSCRAPE_LIST_TIMEOUT_MS, 15_000);
  const response = await (options.sourceFetchImpl ?? globalThis.fetch)(requestUrl, {
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!response.ok) throw retryableError(`ProxyScrape list request failed: ${response.status} ${response.statusText}`);
  const parsed = parseProxyScrapeList(await response.text());
  if (!parsed.length) throw retryableError("ProxyScrape list response contained no usable proxies");
  return parsed;
}

export async function healthCheckProxyCandidates(candidates, {
  concurrency = 20,
  targetHealthy = 20,
  probe,
} = {}) {
  if (typeof probe !== "function") throw new TypeError("probe must be a function");
  const queue = normalizeProxyList(candidates);
  const checked = [];
  const healthy = [];
  const workerCount = Math.max(1, Math.min(positiveInteger(concurrency, 20), queue.length || 1));
  let cursor = 0;
  let stop = false;

  async function worker() {
    while (!stop) {
      const index = cursor;
      cursor += 1;
      if (index >= queue.length) return;
      const proxy = queue[index];
      let result;
      try {
        result = await probe(proxy);
      } catch (error) {
        result = { ok: false, error: error.message };
      }
      const normalized = { proxy, ok: Boolean(result?.ok), latencyMs: Number(result?.latencyMs) || null, error: result?.error ?? null };
      checked.push(normalized);
      if (normalized.ok) {
        healthy.push(normalized);
        if (healthy.length >= targetHealthy) stop = true;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { checked, healthy };
}

async function probeWoltProxy(proxy, { timeoutMs, probeUrl, headers = {} }) {
  const { ProxyAgent, fetch: undiciFetch } = await getUndici();
  const dispatcher = createProxyAgent(proxy, ProxyAgent);
  const started = Date.now();
  try {
    const response = await undiciFetch(probeUrl, {
      headers,
      dispatcher,
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    const body = await response.text();
    if (!response.ok) return { ok: false, latencyMs: Date.now() - started, error: `${response.status} ${response.statusText}` };
    try {
      JSON.parse(body);
    } catch {
      return { ok: false, latencyMs: Date.now() - started, error: "invalid JSON" };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error.message };
  } finally {
    destroyDispatcher(dispatcher);
  }
}

function takeNextHealthyProxy(excluded = new Set()) {
  if (!state.healthy.length) return null;
  const now = Date.now();
  for (let checked = 0; checked < state.healthy.length; checked += 1) {
    const index = state.cursor % state.healthy.length;
    state.cursor = (state.cursor + 1) % state.healthy.length;
    const proxy = state.healthy[index];
    if (!excluded.has(proxy) && isEntryUsable(state.entries.get(proxy), now)) return proxy;
  }
  return null;
}

function usableHealthyProxies(now = Date.now(), healthTtlMs = Infinity) {
  return state.healthy.filter((proxy) => {
    const entry = state.entries.get(proxy);
    return isEntryUsable(entry, now) && now - entry.lastCheckedAt <= healthTtlMs;
  });
}

function isEntryUsable(entry, now = Date.now()) {
  return Boolean(entry?.lastSuccessAt && (entry.cooldownUntil ?? 0) <= now);
}

function markProxySuccess(proxy, latencyMs) {
  const now = Date.now();
  const previous = state.entries.get(proxy) ?? emptyEntry(proxy);
  state.entries.set(proxy, {
    ...previous,
    successes: previous.successes + 1,
    lastSuccessAt: now,
    latencyMs: movingAverage(previous.latencyMs, latencyMs),
    cooldownUntil: 0,
  });
}

function markProxyFailure(proxy, cooldownMs) {
  const previous = state.entries.get(proxy) ?? emptyEntry(proxy);
  state.entries.set(proxy, {
    ...previous,
    failures: previous.failures + 1,
    cooldownUntil: Date.now() + cooldownMs,
  });
}

function emptyEntry(proxy) {
  return { proxy, successes: 0, failures: 0, latencyMs: null, lastCheckedAt: 0, lastSuccessAt: 0, cooldownUntil: 0 };
}

function proxyScore(entry) {
  if (!entry) return -Infinity;
  const total = Math.max(1, entry.successes + entry.failures);
  const successRate = entry.successes / total;
  return successRate * 10_000 - (entry.latencyMs ?? 10_000);
}

function movingAverage(previous, next) {
  if (!Number.isFinite(previous)) return next;
  return Math.round(previous * 0.7 + next * 0.3);
}

async function loadCacheOnce(cacheFile) {
  if (state.cacheLoaded) return;
  state.cacheLoaded = true;
  const path = String(cacheFile ?? process.env.WOLT_PROXYSCRAPE_HEALTH_CACHE_FILE ?? "").trim();
  if (!path) return;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    // Treat persisted entries as a fast warm start, but always schedule a fresh
    // source/health pass in the new process before considering the refresh current.
    state.lastRefreshAt = 0;
    state.sourceCount = Number(parsed.sourceCount) || 0;
    for (const raw of parsed.entries ?? []) {
      if (!raw?.proxy) continue;
      state.entries.set(raw.proxy, { ...emptyEntry(raw.proxy), ...raw });
    }
    state.healthy = (parsed.healthy ?? []).filter((proxy) => state.entries.has(proxy));
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`Could not load ProxyScrape health cache: ${error.message}`);
  }
}

async function persistCache(cacheFile) {
  const path = String(cacheFile ?? process.env.WOLT_PROXYSCRAPE_HEALTH_CACHE_FILE ?? "").trim();
  if (!path) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    const payload = {
      version: 1,
      lastRefreshAt: state.lastRefreshAt ? new Date(state.lastRefreshAt).toISOString() : null,
      sourceCount: state.sourceCount,
      healthy: state.healthy,
      entries: state.healthy.map((proxy) => state.entries.get(proxy)),
    };
    await writeFile(tmp, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    await rename(tmp, path);
  } catch (error) {
    console.warn(`Could not persist ProxyScrape health cache: ${error.message}`);
  }
}

export function buildProxyScrapeListUrl({ limit, country, anonymity } = {}) {
  const url = new URL(PROXYSCRAPE_API_URL);
  url.searchParams.set("request", "displayproxies");
  url.searchParams.set("protocol", "http");
  url.searchParams.set("ssl", "yes");
  url.searchParams.set("timeout", String(positiveInteger(process.env.WOLT_PROXYSCRAPE_SOURCE_TIMEOUT_MS, 5_000)));
  url.searchParams.set("limit", String(Math.min(2_000, positiveInteger(limit ?? process.env.WOLT_PROXYSCRAPE_LIMIT, 200))));
  url.searchParams.set("anonymity", String(anonymity ?? process.env.WOLT_PROXYSCRAPE_ANONYMITY ?? "elite,anonymous"));
  const selectedCountry = String(country ?? process.env.WOLT_PROXYSCRAPE_COUNTRY ?? "").trim();
  if (selectedCountry) url.searchParams.set("country", selectedCountry);
  return url.toString();
}

export function parseProxyScrapeList(value) {
  return normalizeProxyList(String(value ?? "").split(/\r?\n/));
}

export function normalizeProxyList(value) {
  const rows = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const proxies = [];
  for (const raw of rows) {
    const proxy = String(raw ?? "").trim();
    if (!proxy) continue;
    const withoutScheme = proxy.replace(/^https?:\/\//i, "");
    if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(withoutScheme)) continue;
    if (seen.has(withoutScheme)) continue;
    seen.add(withoutScheme);
    proxies.push(withoutScheme);
  }
  return proxies;
}

function createProxyAgent(proxy, ProxyAgent) {
  const uri = /^https?:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
  return new ProxyAgent(uri);
}

async function getUndici() {
  if (!undiciPromise) undiciPromise = import("undici");
  return undiciPromise;
}

function destroyDispatcher(dispatcher) {
  try {
    const destroyed = dispatcher?.destroy?.();
    destroyed?.catch?.(() => {});
  } catch {
    // Ignore cleanup failures from dead public proxies.
  }
}

function shouldTryAnotherProxy(error) {
  return error?.retryable === true ||
    error?.statusCode === 403 ||
    error?.statusCode === 407 ||
    error?.statusCode === 429 ||
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    error instanceof TypeError;
}

function retryableError(message) {
  const error = new Error(message);
  error.retryable = true;
  return error;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function shuffleInPlace(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

export function resetProxyScrapeStateForTests() {
  state.entries.clear();
  state.healthy = [];
  state.cursor = 0;
  state.sourceCount = 0;
  state.lastRefreshAt = 0;
  state.lastRefreshDurationMs = 0;
  state.lastError = null;
  state.refreshPromise = null;
  state.cacheLoaded = false;
}
