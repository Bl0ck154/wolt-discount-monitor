import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/wolt-city-refresh/worker.mjs";

test("Worker has a public health check but refuses cross-origin refresh", async () => {
  const health = await worker.fetch(new Request("https://example.test/health"), {});
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const blocked = await worker.fetch(new Request("https://example.test/api/refresh", {
    method: "POST", headers: { Origin: "https://attacker.example" }, body: "{}",
  }), {});
  assert.equal(blocked.status, 403);
});

test("Worker requires a server-only GitHub credential for dispatch", async () => {
  const result = await worker.fetch(new Request("https://example.test/api/refresh", {
    method: "POST",
    headers: { Origin: "https://bl0ck154.github.io", "Content-Type": "application/json" },
    body: JSON.stringify({ cityId: "deu/nuremberg" }),
  }), {});
  assert.equal(result.status, 503);
});

test("Browser loads cached city data and requests a refresh in background", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
  assert.match(app, /function isCitySnapshotExpired/);
  assert.match(app, /const isUsableCache = cached\.ok/);
  assert.match(app, /CITY_MAX_DISPLAY_AGE_MS/);
  assert.match(app, /void requestAndWatchCity/);
  assert.match(app, /cache: "no-store"/);
  assert.doesNotMatch(app, /window\.WOLT_API_BASE_URL\s*=\s*"https:/);
});
