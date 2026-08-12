import test from "node:test";
import assert from "node:assert/strict";

import { diffSnapshots } from "../src/diff.mjs";
import { compactSnapshot } from "../src/public-snapshot.mjs";
import { rescoreSnapshot } from "../src/rescore-snapshot.mjs";

test("legacy bundled offers are rescored with value model version four", () => {
  const rescored = rescoreSnapshot({
    generatedAt: "2026-08-06T00:00:00.000Z",
    city: { id: "ltu/vilnius", name: "Vilnius" },
    venues: [
      {
        id: "dessert",
        name: "Dessert",
        productLine: "restaurant",
        currency: "EUR",
        offers: [{ text: "Free dessert", value: { version: 3, score: 0, scope: "perk" } }],
      },
      {
        id: "unknown",
        name: "Unknown",
        productLine: "restaurant",
        currency: "EUR",
        offers: [{ text: "Buy 2, Pay for 1", value: { version: 3, score: 0, scope: "perk" } }],
      },
      {
        id: "pizza",
        name: "Pizza",
        productLine: "restaurant",
        currency: "EUR",
        offers: [{ text: "Buy 2 pizzas, Pay for 1", value: { version: 3, score: 0, scope: "perk" } }],
      },
      {
        id: "cola",
        name: "Cola",
        productLine: "restaurant",
        currency: "EUR",
        offers: [{ text: "2 for 1 cola", value: { version: 3, score: 0, scope: "perk" } }],
      },
    ],
  });

  assert.deepEqual(rescored.venues.map((venue) => venue.name), ["Pizza", "Unknown", "Cola", "Dessert"]);

  const byName = new Map(rescored.venues.map((venue) => [venue.name, venue]));
  const pizza = byName.get("Pizza").offers[0];
  const unknown = byName.get("Unknown").offers[0];
  const cola = byName.get("Cola").offers[0];
  const dessert = byName.get("Dessert").offers[0];

  for (const offer of [pizza, unknown, cola, dessert]) {
    assert.equal(offer.value.version, 4);
    assert.ok(offer.value.score > 0);
  }

  assert.equal(pizza.value.scope, "multibuy");
  assert.equal(pizza.value.effectiveDiscountPercent, 50);
  assert.equal(pizza.notificationEligible, true);
  assert.equal(unknown.notificationEligible, false);
  assert.equal(cola.notificationEligible, false);
  assert.equal(dessert.notificationEligible, false);
  assert.equal(byName.get("Dessert").bestDiscount.label, "Free dessert");
});

test("rescored compact snapshot keeps production notification behavior", () => {
  const snapshot = compactSnapshot(rescoreSnapshot({
    generatedAt: "2026-08-06T00:00:00.000Z",
    city: { id: "ltu/vilnius", name: "Vilnius" },
    venues: [
      {
        id: "pizza",
        name: "Pizza",
        productLine: "restaurant",
        currency: "EUR",
        offers: [{ text: "Buy 2 pizzas, Pay for 1", value: { score: -1 } }],
      },
      {
        id: "unknown",
        name: "Unknown",
        productLine: "restaurant",
        currency: "EUR",
        offers: [{ text: "Buy 2, Pay for 1", value: { score: -1 } }],
      },
    ],
  }));

  const changes = diffSnapshots({ generatedAt: null, venues: [] }, snapshot);
  assert.deepEqual(changes.interestingAppeared.map((offer) => offer.venue.name), ["Pizza"]);
  assert.equal(snapshot.venues[0].offers[0].value.multibuy.isSubstantialItem, true);
});

test("rescoring is idempotent", () => {
  const original = {
    generatedAt: "2026-08-06T00:00:00.000Z",
    city: { id: "ltu/vilnius", name: "Vilnius" },
    venues: [{
      id: "pizza",
      name: "Pizza",
      productLine: "restaurant",
      currency: "EUR",
      offers: [{ text: "2 for 1 pizza" }],
    }],
  };

  const once = compactSnapshot(rescoreSnapshot(original));
  const twice = compactSnapshot(rescoreSnapshot(once));
  assert.deepEqual(twice, once);
});
