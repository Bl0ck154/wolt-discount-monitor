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
