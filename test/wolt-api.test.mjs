import test from "node:test";
import assert from "node:assert/strict";

import { fetchJson } from "../src/wolt-api.mjs";

test("fetchJson retries transient HTTP failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("temporary", { status: 503, statusText: "Service Unavailable" });
    }
    return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await fetchJson("https://example.test", {
      maxAttempts: 2,
      retryBaseMs: 0,
      retryJitterMs: 0,
      timeoutMs: 1000,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchJson retries network errors", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      throw new TypeError("network down");
    }
    return new Response('{"ok":true}', { status: 200 });
  };

  try {
    const result = await fetchJson("https://example.test", {
      maxAttempts: 2,
      retryBaseMs: 0,
      retryJitterMs: 0,
      timeoutMs: 1000,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchJson does not retry permanent HTTP failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response("missing", { status: 404, statusText: "Not Found" });
  };

  try {
    await assert.rejects(
      fetchJson("https://example.test", {
        maxAttempts: 3,
        retryBaseMs: 0,
        retryJitterMs: 0,
        timeoutMs: 1000,
      }),
      /404 Not Found/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
