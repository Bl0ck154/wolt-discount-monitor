import test from "node:test";
import assert from "node:assert/strict";

import {
  diffSnapshots,
  isInterestingOffer,
  isLikelyAcquisitionOffer,
  offerIndex,
  offerStableKey,
} from "../src/diff.mjs";

function snapshot(campaignId, text = "25% off", sourcePath = "venue.promotions") {
  return {
    city: { id: "ltu/vilnius", name: "Vilnius" },
    venues: [{
      id: "place-id",
      slug: "some-place",
      name: "Some Place",
      productLine: "restaurant",
      currency: "EUR",
      offers: [{ campaignId, text, sourcePath }],
    }],
  };
}

test("generic Wolt cash banners are omitted from alerts, not from snapshots", () => {
  const generic = ["5 € off (spend 12 €)", "5\u202f€ off (spend 12\u202f€)", "10 EUR off (spend 15 EUR)"];
  for (const text of generic) {
    const current = snapshot("acquisition", text);
    const offer = [...offerIndex(current).values()][0];
    assert.equal(isLikelyAcquisitionOffer(offer), true, text);
    assert.equal(isInterestingOffer(offer), false, text);
    assert.equal(diffSnapshots(null, current).interestingAppeared.length, 0, text);
    assert.equal(current.venues[0].offers[0].text, text, "offer remains on dashboard");
  }
});

test("explicitly new-customer-only promotions are not sent", () => {
  const offer = [...offerIndex(snapshot("new", "20% off for new customers")).values()][0];
  assert.equal(isLikelyAcquisitionOffer(offer), true);
  assert.equal(isInterestingOffer(offer), false);
});

test("genuinely different conditional cash discounts remain alert eligible", () => {
  for (const text of ["5 € off (spend 13 €)", "6 € off (spend 12 €)", "30% off"]) {
    const offer = [...offerIndex(snapshot("distinct", text)).values()][0];
    assert.equal(isLikelyAcquisitionOffer(offer), false, text);
    assert.equal(isInterestingOffer(offer), true, text);
  }
});

test("campaign-id and source changes do not create duplicate new and ended offers", () => {
  const previous = snapshot("old-internal-id", "25% off", "venue.promotions");
  const current = snapshot("new-internal-id", "25% off", "venue.promotions_for_telemetry");
  assert.equal(offerStableKey(previous.venues[0], previous.venues[0].offers[0]), "some-place|25% off");
  assert.equal(offerIndex(previous).size, 1);
  assert.equal(offerIndex(current).size, 1);
  const changes = diffSnapshots(previous, current);
  assert.equal(changes.appeared.length, 0);
  assert.equal(changes.disappeared.length, 0);
  assert.equal(changes.interestingAppeared.length, 0);
});

test("real offer changes still appear as updates", () => {
  const changes = diffSnapshots(snapshot("old", "25% off"), snapshot("new", "30% off"));
  assert.equal(changes.appeared.length, 1);
  assert.equal(changes.disappeared.length, 1);
});
