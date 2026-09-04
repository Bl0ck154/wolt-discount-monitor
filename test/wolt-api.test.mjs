import test from "node:test";
import assert from "node:assert/strict";

import { fetchJson } from "../src/wolt-api.mjs";

test("fetchJson retries transient HTTP failures", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("temporary", { status: 503, statusText: "Service Unavailable" });
    }
    return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await fetchJson("https://example.test", {
    maxAttempts: 2,
    retryBaseMs: 0,
    retryJitterMs: 0,
    timeoutMs: 1000,
    fetchImpl,
    proxyDispatcher: null,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test("fetchJson retries network errors", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      throw new TypeError("network down");
    }
    return new Response('{"ok":true}', { status: 200 });
  };

  const result = await fetchJson("https://example.test", {
    maxAttempts: 2,
    retryBaseMs: 0,
    retryJitterMs: 0,
    timeoutMs: 1000,
    fetchImpl,
    proxyDispatcher: null,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test("fetchJson does not retry permanent HTTP failures", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("missing", { status: 404, statusText: "Not Found" });
  };

  await assert.rejects(
    fetchJson("https://example.test", {
      maxAttempts: 3,
      retryBaseMs: 0,
      retryJitterMs: 0,
      timeoutMs: 1000,
      fetchImpl,
      proxyDispatcher: null,
    }),
    /404 Not Found/,
  );
  assert.equal(calls, 1);
});

test("fetchJson falls back to proxy dispatcher after a direct 403", async () => {
  const proxyDispatcher = { name: "proxy" };
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(options.dispatcher ?? null);
    if (!options.dispatcher) {
      return new Response("blocked", { status: 403, statusText: "Forbidden" });
    }
    return new Response('{"ok":true}', { status: 200 });
  };

  const result = await fetchJson("https://example.test", {
    maxAttempts: 1,
    retryBaseMs: 0,
    retryJitterMs: 0,
    timeoutMs: 1000,
    fetchImpl,
    proxyDispatcher,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [null, proxyDispatcher]);
});

test("ProxyScrape parser keeps unique host:port entries", async () => {
  const { parseProxyScrapeList } = await import("../src/wolt-api.mjs");
  assert.deepEqual(
    parseProxyScrapeList("1.2.3.4:8080\r\n5.6.7.8:3128\n1.2.3.4:8080\nnot-a-proxy\n"),
    ["1.2.3.4:8080", "5.6.7.8:3128"],
  );
});

test("ProxyScrape URL requests HTTPS-capable anonymous HTTP proxies", async () => {
  const { buildProxyScrapeListUrl } = await import("../src/wolt-api.mjs");
  const url = new URL(buildProxyScrapeListUrl({ limit: 25, country: "lt" }));
  assert.equal(url.hostname, "api.proxyscrape.com");
  assert.equal(url.searchParams.get("request"), "displayproxies");
  assert.equal(url.searchParams.get("protocol"), "http");
  assert.equal(url.searchParams.get("ssl"), "yes");
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(url.searchParams.get("country"), "lt");
});

test("fetchJson can fall back to ScraperAPI after a direct 403", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    if (String(url).startsWith("https://api.scraperapi.com/")) {
      return new Response('{"ok":true,"via":"scraperapi"}', { status: 200 });
    }
    return new Response("blocked", { status: 403, statusText: "Forbidden" });
  };

  const target = "https://consumer-api.wolt.com/v1/pages/restaurants?lat=54.69&lon=25.26";
  const result = await fetchJson(target, {
    maxAttempts: 1,
    timeoutMs: 1000,
    fetchImpl,
    proxyDispatcher: null,
    proxyScrapeEnabled: false,
    scraperApiKey: "test-key",
  });

  assert.deepEqual(result, { ok: true, via: "scraperapi" });
  assert.equal(calls.length, 2);
  const scraperUrl = new URL(calls[1].url);
  assert.equal(scraperUrl.searchParams.get("api_key"), "test-key");
  assert.equal(scraperUrl.searchParams.get("url"), target);
  assert.equal(scraperUrl.searchParams.get("keep_headers"), "true");
  assert.equal(calls[1].headers.Platform, "Web");
});

test("fetchJson can use an injected ProxyScrape pool", async () => {
  let directCalls = 0;
  let proxiedCalls = 0;
  const directFetch = async () => {
    directCalls += 1;
    return new Response("blocked", { status: 403, statusText: "Forbidden" });
  };
  const proxyFetch = async (_url, options) => {
    proxiedCalls += 1;
    assert.ok(options.dispatcher);
    return new Response('{"ok":true,"via":"proxyscrape"}', { status: 200 });
  };

  const result = await fetchJson("https://example.test", {
    maxAttempts: 1,
    timeoutMs: 1000,
    fetchImpl: directFetch,
    proxyDispatcher: null,
    proxyScrapeEnabled: true,
    proxyScrapeList: ["127.0.0.1:8080"],
    proxyFetchImpl: proxyFetch,
    scraperApiKey: "",
  });

  assert.deepEqual(result, { ok: true, via: "proxyscrape" });
  assert.equal(directCalls, 1);
  assert.equal(proxiedCalls, 1);
});
