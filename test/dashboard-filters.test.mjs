import test from "node:test";
import assert from "node:assert/strict";

import { isLikelyAcquisitionOffer, isExplicitlyClosed, shouldDisplayVenue } from "../docs/offer-filters.mjs";
import { isLikelyAcquisitionOffer as isLikelyAcquisitionAlert } from "../src/diff.mjs";

test("generic acquisition offers are hidden by default in dashboard and excluded from alerts", () => {
  for (const text of ["10 € off (spend 15 €)", "10 EUR off (spend 15 EUR)", "10\u202f€ off (spend 15\u202f€)", "5 € off (spend 12 €)", "20% off for new customers", "20% Rabatt für Neukunden", "Zniżka dla nowych klientów", "Sleva pro nové zákazníky"]) {
    assert.equal(isLikelyAcquisitionOffer(text), true, text);
    assert.equal(isLikelyAcquisitionAlert({ text }), true, text);
  }
});

test("real, different promotions are not mistakenly classified as acquisition offers", () => {
  for (const text of ["10 € off (spend 20 €)", "6 € off (spend 12 €)", "30% off the entire menu", "Get €6.50 off"]) {
    assert.equal(isLikelyAcquisitionOffer(text), false, text);
    assert.equal(isLikelyAcquisitionAlert({ text }), false, text);
  }
});

test("closed and offline venues are excluded when toggled, with unknown status preserved", () => {
  const open = { opening: { isOpen: true } };
  const closed = { opening: { isOpen: false } };
  const offline = { isOpen: false };
  const unknown = { opening: { isOpen: null } };
  assert.equal(isExplicitlyClosed(closed), true);
  assert.equal(isExplicitlyClosed(offline), true);
  assert.equal(isExplicitlyClosed(unknown), false);
  assert.equal(shouldDisplayVenue(closed, [{ text: "30% off" }], { hideClosed: true }), false);
  assert.equal(shouldDisplayVenue(offline, [{ text: "30% off" }], { hideClosed: true }), false);
  assert.equal(shouldDisplayVenue(open, [{ text: "30% off" }], { hideClosed: true }), true);
  assert.equal(shouldDisplayVenue(unknown, [{ text: "30% off" }], { hideClosed: true }), true);
  assert.equal(shouldDisplayVenue(closed, [{ text: "30% off" }], { hideClosed: false }), true);
});

test("venues with only hidden campaigns disappear unless user opts in", () => {
  const venue = { opening: { isOpen: true } };
  const filtered = [];
  assert.equal(shouldDisplayVenue(venue, filtered, { offersOnly: true }), false);
  assert.equal(shouldDisplayVenue(venue, filtered, { offersOnly: false }), true);
  assert.equal(shouldDisplayVenue(venue, [{ text: "30% off" }], { offersOnly: true }), true);
});
