import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSnapshot } from "../src/normalize.mjs";
import { diffSnapshots } from "../src/diff.mjs";
import { compactSnapshot } from "../src/public-snapshot.mjs";

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
  assert.equal(marketOffer.valueVersion, 4);
  assert.equal(marketOffer.valueTier, "good");
  assert.equal(marketOffer.notificationEligible, true);
  assert.equal(snapshot.venues[1].offers[0].notificationEligible, false);

  const changes = diffSnapshots({ generatedAt: null, venues: [] }, compactSnapshot(snapshot));
  assert.equal(changes.interestingAppeared.length, 1);
  assert.equal(changes.interestingAppeared[0].venue.name, "Market");
});

test("multibuy and free perks survive production compaction and keep balanced priority", () => {
  const normalized = normalizeSnapshot({
    city,
    urls: { promotions: "https://api.example/promotions", restaurants: "https://api.example/restaurants" },
    restaurantRows: [],
    promoRows: [
      row({ id: "dessert", name: "Dessert", productLine: "restaurant", currency: "EUR", promotions: [{ campaign_id: "dessert", text: "Free dessert" }] }),
      row({ id: "cola", name: "Cola", productLine: "restaurant", currency: "EUR", promotions: [{ campaign_id: "cola", text: "2 for 1 cola" }] }),
      row({ id: "unknown", name: "Unknown", productLine: "restaurant", currency: "EUR", promotions: [{ campaign_id: "unknown", text: "Buy 2, Pay for 1" }] }),
      row({ id: "pizza", name: "Pizza", productLine: "restaurant", currency: "EUR", promotions: [{ campaign_id: "pizza", text: "Buy 2 pizzas, Pay for 1" }] }),
    ],
  });
  const snapshot = compactSnapshot(normalized);

  assert.deepEqual(snapshot.venues.map((venue) => venue.name), ["Pizza", "Unknown", "Cola", "Dessert"]);
  const pizza = snapshot.venues[0].offers[0];
  assert.equal(pizza.value.scope, "multibuy");
  assert.equal(pizza.value.isMultibuy, true);
  assert.equal(pizza.value.multibuy.isSubstantialItem, true);
  assert.equal(snapshot.venues[0].bestDiscount.label, "50%");
  assert.equal(snapshot.venues[3].bestDiscount.label, "Free dessert");
  assert.ok(snapshot.venues[3].bestDiscount.score > 0);

  const changes = diffSnapshots({ generatedAt: null, venues: [] }, snapshot);
  assert.deepEqual(changes.interestingAppeared.map((offer) => offer.venue.name), ["Pizza"]);
});

test("diff ranks strong cash before weaker conditional cash", () => {
  const snapshot = compactSnapshot(normalizeSnapshot({
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
  }));

  const changes = diffSnapshots({ generatedAt: null, venues: [] }, snapshot);
  assert.deepEqual(changes.interestingAppeared.map((offer) => offer.venue.name), ["Strong"]);
  assert.ok(snapshot.venues[0].bestDiscount.score > snapshot.venues[1].bestDiscount.score);
});
