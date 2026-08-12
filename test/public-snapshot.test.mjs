import test from "node:test";
import assert from "node:assert/strict";
import {
  compactChangeLog,
  compactChangesDocument,
  compactCitiesIndex,
  compactSnapshot,
} from "../src/public-snapshot.mjs";

test("compactSnapshot removes raw and duplicate public fields", () => {
  const input = {
    generatedAt: "2026-08-06T00:00:00.000Z",
    source: { promotionsEndpoint: "private", restaurantsEndpoint: "private" },
    city: {
      id: "ltu/vilnius",
      key: "ltu-vilnius",
      slug: "vilnius",
      name: "Vilnius",
      country: "Lithuania",
      countryCode: "ltu",
      countryCode2: "LT",
      countryCode3: "LTU",
      timezone: "Europe/Vilnius",
      lat: 54.68,
      lon: 25.28,
      label: "Vilnius, Lithuania",
    },
    counts: { promotionsUniqueVenues: 1, restaurantsUniqueVenues: 1 },
    venues: [{
      id: "venue-1",
      slug: "venue-1",
      name: "Venue 1",
      productLine: "restaurant",
      imageUrl: "https://images.example/1.jpg",
      brandImageUrl: "https://images.example/1.jpg",
      offerTexts: ["20% off"],
      bestAmount: 20,
      bestLabel: "20%",
      isOpen: true,
      openingStatus: "Open now",
      openingHours: "10:00-22:00",
      section: { name: "Promotions" },
      sourceEndpoint: "private",
      raw: { promotions: [{ huge: "x".repeat(5000) }] },
      offers: [{
        key: "duplicated-key",
        sourcePath: "venue.promotions",
        campaignId: "campaign-1",
        text: "20% off",
        amount: 20,
        amountType: "percent",
        amountLabel: "20%",
        valueVersion: 3,
        valueScore: 71,
        valueTier: "great",
        scope: "broad",
        effectiveDiscountPercent: 20,
        score: 71,
        raw: { huge: "y".repeat(5000) },
        value: {
          version: 3,
          score: 71,
          tier: "great",
          scope: "broad",
          effectiveDiscountPercent: 20,
          isDelivery: false,
          isPerk: false,
          isSelectedItems: false,
          isUpToPercent: false,
        },
      }],
      bestDiscount: { amount: 20, type: "percent", label: "20%", score: 71, tier: "great" },
    }],
  };

  const output = compactSnapshot(input);
  const venue = output.venues[0];
  const offer = venue.offers[0];

  assert.equal(output.source, undefined);
  assert.equal(output.city.timezone, undefined);
  assert.equal(venue.raw, undefined);
  assert.equal(venue.offerTexts, undefined);
  assert.equal(venue.bestAmount, undefined);
  assert.equal(venue.sourceEndpoint, undefined);
  assert.equal(venue.brandImageUrl, undefined);
  assert.deepEqual(venue.opening, { isOpen: true, label: "Open now", hours: "10:00-22:00" });
  assert.equal(offer.raw, undefined);
  assert.equal(offer.valueScore, undefined);
  assert.equal(offer.value.score, 71);
  assert.ok(JSON.stringify(output).length < JSON.stringify(input).length * 0.25);
});

test("compactChangesDocument keeps totals while bounding large arrays", () => {
  const offer = { stableKey: "v|c", venue: { name: "V" }, text: "20% off", amount: 20, amountType: "percent" };
  const changes = compactChangesDocument({
    appeared: Array.from({ length: 500 }, () => offer),
    disappeared: Array.from({ length: 400 }, () => offer),
    interestingAppeared: Array.from({ length: 150 }, () => offer),
    interestingDisappeared: Array.from({ length: 120 }, () => offer),
    newInteresting: Array.from({ length: 130 }, () => offer),
    endedNotified: Array.from({ length: 110 }, () => offer),
  });

  assert.equal(changes.changeSummary.appeared, 500);
  assert.equal(changes.changeSummary.disappeared, 400);
  assert.equal(changes.appeared.length, 250);
  assert.equal(changes.disappeared.length, 250);
  assert.equal(changes.interestingAppeared.length, 100);
  assert.equal(changes.newInteresting.length, 100);
});

test("compactChangeLog retains only recent bounded history", () => {
  const entries = Array.from({ length: 150 }, (_, index) => ({ generatedAt: String(index), interesting: [], ended: [] }));
  assert.equal(compactChangeLog(entries).length, 100);
});

test("compactCitiesIndex keeps fields required by the dashboard", () => {
  const output = compactCitiesIndex({
    generatedAt: "now",
    defaultCityId: "ltu/vilnius",
    cacheTtlMs: 7200000,
    countries: [{ name: "Lithuania" }],
    cities: [{
      id: "ltu/vilnius",
      key: "ltu-vilnius",
      woltCityId: "ignored",
      slug: "vilnius",
      name: "Vilnius",
      country: "Lithuania",
      countryCode: "ltu",
      countryCode2: "LT",
      countryCode3: "LTU",
      locale: "en",
      timezone: "Europe/Vilnius",
      label: "Vilnius, Lithuania",
      lat: 54.68,
      lon: 25.28,
      dataPath: "data/latest.json",
    }],
  });

  assert.equal(output.countries, undefined);
  assert.equal(output.cities[0].woltCityId, undefined);
  assert.equal(output.cities[0].timezone, undefined);
  assert.equal(output.cities[0].latestPath, "data/latest.json");
  assert.equal(output.cities[0].countryCode2, "LT");
});
