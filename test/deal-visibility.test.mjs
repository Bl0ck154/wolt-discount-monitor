import test from "node:test";
import assert from "node:assert/strict";
import { ubiquitousOfferIndex, visibleVenueOffers, visibleVenueCount } from "../docs/deal-visibility.mjs";
import { topDealVenues, isSnapshotIndexable } from "../src/build-seo-site.mjs";

function fixture() {
  return Array.from({ length: 12 }, (_, i) => ({
    name: "Restaurant " + i,
    link: "https://wolt.com/example/" + i,
    offers: [
      { text: "30% off (up to 180 CZK)", value: { score: 95 } },
      { text: "0 CZK delivery fee", value: { isDelivery: true } },
      { text: "New", isUtilityBadge: true },
      ...(i === 0 ? [{ text: "20% off selected items", value: { score: 55 }, amount: 20, amountType: "percent" }] : []),
    ],
  }));
}

test("same repeated citywide banner is hidden across the entire city", () => {
  const venues = fixture();
  const index = ubiquitousOfferIndex(venues);
  assert.ok(index.keys.has("30% off (up to 180 czk)"));
  assert.ok(index.keys.has("0 czk delivery fee"));
  const real = visibleVenueOffers(venues[0], { ubiquitousKeys: index.keys });
  assert.deepEqual(real.map((x) => x.text), ["20% off selected items"]);
  assert.deepEqual(visibleVenueOffers(venues[1], { ubiquitousKeys: index.keys }), []);
  assert.deepEqual(visibleVenueCount(venues, (o) => o.value?.score ?? 0), { visible: 1, ranked: 1, scanned: 12 });
});

test("SEO does not promote blanket offers as the best discounts", () => {
  const snapshot = { generatedAt: "2026-11-02T01:00:00Z", venues: fixture() };
  const best = topDealVenues(snapshot, 12);
  assert.equal(best.length, 1);
  assert.equal(best[0].seoBestOffer.text, "20% off selected items");
  assert.equal(isSnapshotIndexable(snapshot, new Date("2026-11-02T02:00:00Z")), true);
});

test("a city with only a blanket campaign should not be indexed as a meaningful deal page", () => {
  const venues = fixture().map((venue) => ({ ...venue, offers: venue.offers.slice(0, 2) }));
  const snapshot = { generatedAt: "2026-11-02T01:00:00Z", venues };
  assert.equal(visibleVenueCount(venues, (o) => o.value?.score ?? 0).ranked, 0);
  assert.equal(topDealVenues(snapshot, 12).length, 0);
  assert.equal(isSnapshotIndexable(snapshot, new Date("2026-11-02T02:00:00Z")), false);
});
