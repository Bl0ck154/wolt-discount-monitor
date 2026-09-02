import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  computeMarketProfile,
  courierPilotMarketProfile,
  ingestCourierPilotMarket,
} from "../src/courierpilot-market.mjs";

function requestFor(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const request = Readable.from([body]);
  request.headers = { "content-length": String(body.length) };
  return request;
}

test("market profile adapts to recent city payouts and reports trend", () => {
  const now = Date.UTC(2026, 8, 2, 12);
  const rows = [];
  for (let i = 0; i < 40; i++) {
    rows.push({
      installId: `install-${i % 4}`,
      capturedAt: now - (4 + (i % 5)) * 86_400_000,
      eurPerKm: 0.82 + (i % 6) * 0.025,
    });
  }
  for (let i = 0; i < 30; i++) {
    rows.push({
      installId: `install-${i % 5}`,
      capturedAt: now - (i % 3) * 86_400_000 - i * 1_000,
      eurPerKm: 1.15 + (i % 6) * 0.03,
    });
  }

  const profile = computeMarketProfile(rows, now);
  assert.equal(profile.ready, true);
  assert.equal(profile.sampleCount, 70);
  assert.equal(profile.uniqueInstallations, 5);
  assert.ok(profile.medianEurPerKm > 1.0);
  assert.ok(profile.bandEdges[2] > 1.0, "dynamic OK threshold should move with the city market");
  assert.equal(profile.trend?.direction, "up");
  assert.ok((profile.trend?.percent ?? 0) > 10);
});

test("market ingest stores only aggregate offer economics and serves a city profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "courierpilot-market-"));
  process.env.COURIERPILOT_MARKET_DB = join(dir, "market.sqlite3");
  try {
    const now = Date.now();
    const offers = Array.from({ length: 24 }, (_, i) => ({
      id: `offer-${i}`,
      captured_at: now - i * 60_000,
      city_key: "lt-vilnius",
      city_name: "Vilnius",
      country_code: "LT",
      platform: i % 2 ? "Wolt" : "Bolt",
      price_cents: 500 + i * 10,
      route_distance_m: 4_000,
      route_source: "valhalla_mean",
      delivery_count: 1,
      local_hour: 17,
      local_weekday: 3,
    }));
    const payload = {
      schema: 1,
      install_id: "12345678-1234-1234-1234-123456789abc",
      app_version: "0.15.15",
      version_code: 56,
      offers,
    };

    const result = await ingestCourierPilotMarket(requestFor(payload));
    assert.equal(result.ok, true);
    assert.equal(result.accepted.length, offers.length);

    const params = new URLSearchParams({ city: "lt-vilnius", platform: "Wolt", hour: "17" });
    const profile = courierPilotMarketProfile(params, now);
    assert.equal(profile.city.name, "Vilnius");
    assert.equal(profile.requestedPlatform, "Wolt");
    assert.equal(profile.sampleCount, 24, "falls back to city-wide data when one platform is sparse");
    assert.equal(profile.ready, true);
    assert.ok(profile.medianEurPerKm > 1.0);
  } finally {
    delete process.env.COURIERPILOT_MARKET_DB;
    await rm(dir, { recursive: true, force: true });
  }
});

test("market ingest rejects payloads carrying no valid city economics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "courierpilot-market-invalid-"));
  process.env.COURIERPILOT_MARKET_DB = join(dir, "market.sqlite3");
  try {
    const payload = {
      schema: 1,
      install_id: "12345678-1234-1234-1234-123456789abc",
      app_version: "0.15.15",
      version_code: 56,
      offers: [{
        id: "offer-bad",
        captured_at: Date.now(),
        city_key: "",
        city_name: "",
        country_code: "",
        platform: "Wolt",
        price_cents: 500,
        route_distance_m: 4_000,
        local_hour: 17,
        local_weekday: 3,
      }],
    };
    await assert.rejects(() => ingestCourierPilotMarket(requestFor(payload)), /No valid market offers/);
  } finally {
    delete process.env.COURIERPILOT_MARKET_DB;
    await rm(dir, { recursive: true, force: true });
  }
});
