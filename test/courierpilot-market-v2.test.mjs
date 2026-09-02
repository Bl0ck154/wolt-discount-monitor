import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  computeMarketProfile,
  courierPilotMarketHistory,
  courierPilotMarketProfile,
  ingestCourierPilotMarket,
} from "../src/courierpilot-market.mjs";

function requestFor(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const request = Readable.from([body]);
  request.headers = { "content-length": String(body.length) };
  return request;
}

function observation({
  id,
  capturedAt = Date.now(),
  city = "lt-vilnius",
  cityName = "Vilnius",
  country = "LT",
  platform = "Wolt",
  currency = "EUR",
  fractionDigits = 2,
  priceMinor = 500,
  distanceM = 4_000,
  routeSource = "FULL_valhalla_mean",
  hour = 17,
  weekday = 3,
} = {}) {
  return {
    id,
    captured_at: capturedAt,
    city_key: city,
    city_name: cityName,
    country_code: country,
    platform,
    currency_code: currency,
    currency_fraction_digits: fractionDigits,
    price_minor: priceMinor,
    full_route_distance_m: distanceM,
    route_source: routeSource,
    delivery_count: 1,
    local_hour: hour,
    local_weekday: weekday,
  };
}

async function withMarketDb(prefix, fn) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  process.env.COURIERPILOT_MARKET_DB = join(dir, "market.sqlite3");
  try {
    await fn();
  } finally {
    delete process.env.COURIERPILOT_MARKET_DB;
    await rm(dir, { recursive: true, force: true });
  }
}

async function ingestV2(installId, offers) {
  return ingestCourierPilotMarket(requestFor({
    schema: 2,
    install_id: installId,
    app_version: "0.16.0",
    version_code: 60,
    offers,
  }), { schema: 2 });
}

test("v2 endpoint contract rejects a v1 payload", async () => {
  await withMarketDb("courierpilot-v2-schema-", async () => {
    await assert.rejects(
      () => ingestCourierPilotMarket(requestFor({ schema: 1, install_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", offers: [] }), { schema: 2 }),
      /Expected market schema 2/,
    );
  });
});

test("v2 accepts ISO currencies with 0, 2 and 3 fraction digits", async () => {
  await withMarketDb("courierpilot-v2-currency-", async () => {
    const now = Date.now();
    const result = await ingestV2("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", [
      observation({ id: "eur", capturedAt: now, currency: "EUR", fractionDigits: 2, priceMinor: 438 }),
      observation({ id: "jpy", capturedAt: now - 1_000, city: "jp-tokyo", cityName: "Tokyo", country: "JP", currency: "JPY", fractionDigits: 0, priceMinor: 620 }),
      observation({ id: "kwd", capturedAt: now - 2_000, city: "kw-kuwait", cityName: "Kuwait City", country: "KW", currency: "KWD", fractionDigits: 3, priceMinor: 1250 }),
      observation({ id: "czk", capturedAt: now - 3_000, city: "cz-prague", cityName: "Prague", country: "CZ", currency: "CZK", fractionDigits: 2, priceMinor: 12500 }),
    ]);
    assert.deepEqual(new Set(result.accepted), new Set(["eur", "jpy", "kwd", "czk"]));
  });
});

test("v2 rejects incorrect currency fraction digits and pickup-only routes", async () => {
  await withMarketDb("courierpilot-v2-invalid-", async () => {
    await assert.rejects(
      () => ingestV2("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", [
        observation({ id: "wrong-digits", currency: "JPY", fractionDigits: 2, priceMinor: 620 }),
      ]),
      /No valid market offers/,
    );
    await assert.rejects(
      () => ingestV2("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", [
        observation({ id: "pickup", platform: "Bolt", routeSource: "PICKUP_ONLY" }),
      ]),
      /No valid market offers/,
    );
  });
});

test("v2 profile is exact city currency platform cohort with no fake defaults", async () => {
  await withMarketDb("courierpilot-v2-cohort-", async () => {
    const now = Date.now();
    const install = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const woltEur = Array.from({ length: 9 }, (_, i) => observation({
      id: `wolt-eur-${i}`,
      capturedAt: now - i * 1_000,
      platform: "Wolt",
      currency: "EUR",
      priceMinor: 400 + i * 10,
    }));
    const boltEur = Array.from({ length: 12 }, (_, i) => observation({
      id: `bolt-eur-${i}`,
      capturedAt: now - 20_000 - i * 1_000,
      platform: "Bolt",
      currency: "EUR",
      priceMinor: 900 + i * 10,
    }));
    const woltPln = Array.from({ length: 12 }, (_, i) => observation({
      id: `wolt-pln-${i}`,
      capturedAt: now - 40_000 - i * 1_000,
      city: "pl-warsaw",
      cityName: "Warsaw",
      country: "PL",
      platform: "Wolt",
      currency: "PLN",
      fractionDigits: 2,
      priceMinor: 1600 + i * 20,
    }));
    await ingestV2(install, [...woltEur, ...boltEur, ...woltPln]);

    const thin = courierPilotMarketProfile(new URLSearchParams({ city: "lt-vilnius", currency: "EUR", platform: "Wolt" }), now, { schema: 2 });
    assert.equal(thin.sampleCount, 9);
    assert.equal(thin.ready, false);
    assert.equal(thin.confidence, "NOT_READY");
    assert.equal(thin.bandEdges, null);

    const bolt = courierPilotMarketProfile(new URLSearchParams({ city: "lt-vilnius", currency: "EUR", platform: "Bolt" }), now, { schema: 2 });
    assert.equal(bolt.sampleCount, 12);
    assert.equal(bolt.ready, true);
    assert.equal(bolt.requestedPlatform, "Bolt");
    assert.ok(bolt.medianNativeMoneyPerKm > thin.medianNativeMoneyPerKm);

    const pln = courierPilotMarketProfile(new URLSearchParams({ city: "pl-warsaw", currency: "PLN", platform: "Wolt" }), now, { schema: 2 });
    assert.equal(pln.sampleCount, 12);
    assert.equal(pln.currencyCode, "PLN");
    assert.ok(pln.medianNativeMoneyPerKm > 3);
  });
});

test("v2 profile exposes effective sample size and bounded per-install influence", () => {
  const now = Date.now();
  const heavy = Array.from({ length: 100 }, (_, i) => ({
    installId: "heavy-install",
    capturedAt: now - i * 1_000,
    nativeMoneyPerKm: 1.0,
  }));
  const diverse = Array.from({ length: 10 }, (_, i) => ({
    installId: `light-${i}`,
    capturedAt: now - i * 1_000,
    nativeMoneyPerKm: 2.0,
  }));
  const profile = computeMarketProfile([...heavy, ...diverse], now);
  assert.equal(profile.sampleCount, 110);
  assert.equal(profile.uniqueInstallations, 11);
  assert.ok(profile.effectiveSampleCount < profile.sampleCount);
  assert.ok(profile.medianNativeMoneyPerKm > 1.0, "one prolific install must not fully dominate the city profile");
});

test("v2 profile ignores observations outside the 30-day live window when queried", async () => {
  await withMarketDb("courierpilot-v2-window-", async () => {
    const now = Date.now();
    const recent = Array.from({ length: 10 }, (_, i) => observation({ id: `recent-${i}`, capturedAt: now - i * 60_000, priceMinor: 500 }));
    await ingestV2("dddddddd-dddd-dddd-dddd-dddddddddddd", recent);
    const profile = courierPilotMarketProfile(new URLSearchParams({ city: "lt-vilnius", currency: "EUR", platform: "Wolt" }), now + 31 * 86_400_000, { schema: 2 });
    assert.equal(profile.sampleCount, 0);
    assert.equal(profile.ready, false);
  });
});

test("v2 history is built from persisted daily aggregates and groups day week month", async () => {
  await withMarketDb("courierpilot-v2-history-", async () => {
    const now = Date.now();
    const day = 86_400_000;
    const offers = [
      ...Array.from({ length: 6 }, (_, i) => observation({ id: `d0-${i}`, capturedAt: now - i * 1_000, priceMinor: 500 + i * 10 })),
      ...Array.from({ length: 5 }, (_, i) => observation({ id: `d1-${i}`, capturedAt: now - day - i * 1_000, priceMinor: 600 + i * 10 })),
    ];
    await ingestV2("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", offers);

    for (const period of ["day", "week", "month"]) {
      const history = courierPilotMarketHistory(new URLSearchParams({ city: "lt-vilnius", currency: "EUR", platform: "Wolt", period }), now);
      assert.equal(history.schema, 2);
      assert.equal(history.currencyCode, "EUR");
      assert.equal(history.platform, "Wolt");
      assert.ok(history.buckets.length >= 1);
      assert.equal(history.buckets.reduce((sum, bucket) => sum + bucket.sampleCount, 0), 11);
      assert.ok(history.buckets.every((bucket) => bucket.medianNativeMoneyPerKm > 0 && bucket.p25 > 0 && bucket.p75 > 0));
    }
  });
});

test("v2 payload allow-list never surfaces private fields in profile or history", async () => {
  await withMarketDb("courierpilot-v2-privacy-", async () => {
    const now = Date.now();
    const offers = Array.from({ length: 10 }, (_, i) => ({
      ...observation({ id: `private-${i}`, capturedAt: now - i * 1_000 }),
      address: "Secret street 1",
      customer_name: "Private Person",
      ocr_text: "raw screen",
      latitude: 54.0,
      longitude: 25.0,
      screenshot: "secret.png",
    }));
    await ingestV2("ffffffff-ffff-ffff-ffff-ffffffffffff", offers);
    const profile = courierPilotMarketProfile(new URLSearchParams({ city: "lt-vilnius", currency: "EUR", platform: "Wolt" }), now, { schema: 2 });
    const history = courierPilotMarketHistory(new URLSearchParams({ city: "lt-vilnius", currency: "EUR", platform: "Wolt", period: "day" }), now);
    const output = JSON.stringify({ profile, history }).toLowerCase();
    for (const forbidden of ["secret street", "private person", "raw screen", "secret.png", "latitude", "longitude", "ocr_text", "customer_name"]) {
      assert.equal(output.includes(forbidden), false, `response leaked ${forbidden}`);
    }
  });
});
