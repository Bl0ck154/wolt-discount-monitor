import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSnapshot } from "../src/normalize.mjs";
import { diffSnapshots } from "../src/diff.mjs";

const city = {
  id: "test/city",
  key: "test-city",
  woltCityId: "test-city",
  slug: "city",
  name: "Test City",
  country: "Testland",
  countryEmoji: "",
  countryCode: "XX",
  countryCode2: "XX",
  countryCode3: "XXX",
  lat: 1,
  lon: 2,
  locale: "en",
  timezone: "UTC",
};

function row({ id, name, productLine, currency, promotions, badges = [] }) {
  return {
    sectionName: "Promotions",
    sectionTemplate: "venue",
    item: { link: { target: `https://wolt.example/${id}` } },
    venue: {
      id,
      slug: id,
      name,
      product_line: productLine,
      currency,
      promotions,
      badges_v2: badges,
      promotions_for_telemetry: [],
    },
  };
}

test("normalization stores universal value metadata, deduplicates and ranks venues", () => {
  const snapshot = normalizeSnapshot({
    city,
    urls: { promotions: "https://api.example/promotions", restaurants: "https://api.example/restaurants" },
    restaurantRows: [],
    promoRows: [
      row({
        id: "restaurant",
        name: "Restaurant",
        productLine: "restaurant",
        currency: "EUR",
        promotions: [{ campaign_id: "selected", text: "50% off selected items" }],
      }),
      row({
        id: "market",
        name: "Market",
        productLine: "grocery",
        currency: "EUR",
        promotions: [{ campaign_id: "grocery", text: "10% off" }],
        badges: [{ campaign_id: "duplicate", text: "10% off" }],
      }),
    ],
  });

  assert.deepEqual(snapshot.venues.map((venue) => venue.name), ["Market", "Restaurant"]);
  const marketOffer = snapshot.venues[0].offers[0];
  assert.equal(snapshot.venues[0].offers.length, 1);
  assert.equal(marketOffer.valueVersion, 2);
  assert.equal(marketOffer.valueTier, "good");
  assert.equal(marketOffer.notificationEligible, true);
  assert.equal(snapshot.venues[1].offers[0].notificationEligible, false);

  const changes = diffSnapshots({ generatedAt: null, venues: [] }, snapshot);
  assert.equal(changes.interestingAppeared.length, 1);
  assert.equal(changes.interestingAppeared[0].venue.name, "Market");
});

test("diff ranks strong cash before weaker conditional cash", () => {
  const snapshot = normalizeSnapshot({
    city,
    urls: { promotions: "https://api.example/promotions", restaurants: "https://api.example/restaurants" },
    restaurantRows: [],
    promoRows: [
      row({
        id: "weak",
        name: "Weak",
        productLine: "restaurant",
        currency: "EUR",
        promotions: [{ campaign_id: "weak", text: "5 EUR off (spend 30 EUR)" }],
      }),
      row({
        id: "strong",
        name: "Strong",
        productLine: "restaurant",
        currency: "EUR",
        promotions: [{ campaign_id: "strong", text: "5 EUR off" }],
      }),
    ],
  });

  const changes = diffSnapshots({ generatedAt: null, venues: [] }, snapshot);
  assert.deepEqual(changes.interestingAppeared.map((offer) => offer.venue.name), ["Strong"]);
  assert.ok(snapshot.venues[0].bestDiscount.score > snapshot.venues[1].bestDiscount.score);
});