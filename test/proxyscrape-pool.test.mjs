import test from "node:test";
import assert from "node:assert/strict";

import {
  healthCheckProxyCandidates,
  normalizeProxyList,
  resetProxyScrapeStateForTests,
} from "../src/proxyscrape-pool.mjs";
import { fetchJson } from "../src/wolt-api.mjs";

test("health checker keeps only proxies that pass the Wolt probe", async () => {
  const calls = [];
  const result = await healthCheckProxyCandidates(
    ["1.1.1.1:80", "2.2.2.2:80", "3.3.3.3:80", "4.4.4.4:80"],
    {
      concurrency: 2,
      targetHealthy: 2,
      probe: async (proxy) => {
        calls.push(proxy);
        if (proxy.startsWith("2.") || proxy.startsWith("4.")) {
          return { ok: true, latencyMs: proxy.startsWith("2.") ? 120 : 80 };
        }
        return { ok: false, latencyMs: 50, error: "429" };
      },
    },
  );

  assert.deepEqual(result.healthy.map((entry) => entry.proxy).sort(), ["2.2.2.2:80", "4.4.4.4:80"]);
  assert.ok(result.checked.length >= 2);
  assert.ok(calls.length >= 2);
});

test("proxy normalization deduplicates equivalent URL and host forms", () => {
  assert.deepEqual(
    normalizeProxyList(["http://1.2.3.4:8080", "1.2.3.4:8080", "5.6.7.8:3128", "bad"]),
    ["1.2.3.4:8080", "5.6.7.8:3128"],
  );
});

test("proxy-first mode uses ProxyScrape before direct Wolt transport", async () => {
  resetProxyScrapeStateForTests();
  let directCalls = 0;
  let proxyCalls = 0;
  const directFetch = async () => {
    directCalls += 1;
    return new Response('{"direct":true}', { status: 200 });
  };
  const proxyFetch = async (_url, options) => {
    proxyCalls += 1;
    assert.ok(options.dispatcher);
    return new Response('{"ok":true,"via":"proxy-first"}', { status: 200 });
  };

  const result = await fetchJson("https://example.test", {
    maxAttempts: 1,
    timeoutMs: 1000,
    fetchImpl: directFetch,
    proxyMode: "proxy-first",
    proxyScrapeEnabled: true,
    proxyScrapeList: ["127.0.0.1:8080"],
    proxyFetchImpl: proxyFetch,
    proxyDispatcher: null,
    scraperApiKey: "",
  });

  assert.deepEqual(result, { ok: true, via: "proxy-first" });
  assert.equal(proxyCalls, 1);
  assert.equal(directCalls, 0);
});
