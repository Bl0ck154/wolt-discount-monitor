import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeOffer,
  extractDiscount,
  isNotificationWorthy,
  sortOffersByValue,
} from "../src/offer-value.mjs";

function analyze(text, productLine = "restaurant", currencyCode = null) {
  return analyzeOffer({ text, productLine, currencyCode });
}

test("unconditional EUR cash discount ranks as exceptional", () => {
  const result = analyze("€5 off — claim at checkout", "restaurant", "EUR");
  assert.equal(result.discount.amount, 5);
  assert.equal(result.discount.currencyCode, "EUR");
  assert.equal(result.value.scope, "broad");
  assert.ok(result.value.score >= 75);
  assert.equal(result.notificationEligible, true);
});

test("cash discount is normalized by minimum spend in any currency", () => {
  const strong = analyze("5 € off (spend 10 €)", "restaurant", "EUR");
  const weak = analyze("5 € off (spend 30 €)", "restaurant", "EUR");
  assert.equal(strong.value.effectiveDiscountPercent, 50);
  assert.equal(weak.value.effectiveDiscountPercent, 16.7);
  assert.ok(strong.value.score > weak.value.score);
  assert.equal(strong.notificationEligible, true);
  assert.equal(weak.notificationEligible, false);
});

test("broad percentages use category-specific thresholds", () => {
  assert.equal(analyze("10% off", "grocery", "EUR").notificationEligible, true);
  assert.equal(analyze("10% off", "restaurant", "EUR").notificationEligible, false);
  assert.equal(analyze("15% off", "restaurant", "EUR").notificationEligible, true);
  assert.equal(analyze("20% off", "general_merchandise", "EUR").notificationEligible, true);
});

test("high minimum spend lowers broad percentage value", () => {
  const unconditional = analyze("30% off", "restaurant", "EUR");
  const conditioned = analyze("30% off (spend 30 €)", "restaurant", "EUR");
  assert.ok(unconditional.value.score > conditioned.value.score + 15);
  assert.equal(unconditional.notificationEligible, true);
  assert.equal(conditioned.notificationEligible, false);
});

test("selected items, gifts, 2-for-1 and delivery never notify", () => {
  const cases = [
    ["50% off selected items", "pharmacy"],
    ["2000 HUF item discount", "restaurant"],
    ["Free dessert", "restaurant"],
    ["2 Free garlic sauces!", "restaurant"],
    ["Buy 2, Pay for 1", "restaurant"],
    ["0 € delivery fee", "restaurant"],
    ["14 days of €0 delivery fees", "restaurant"],
  ];
  for (const [text, productLine] of cases) {
    const result = analyze(text, productLine, "EUR");
    assert.equal(result.notificationEligible, false, text);
    assert.ok(result.value.score < 45, text);
  }
});

test("international currencies parse and compare by relative value", () => {
  const cases = [
    ["15 zl off", "PLN", null],
    ["50 CZK off selected items", "CZK", false],
    ["750 HUF off (spend 5,000 HUF)", "HUF", false],
    ["12 ₾ off", "GEL", true],
    ["6 AZN off (spend 20 AZN)", "AZN", true],
    ["50 DKK off (spend 120 DKK)", "DKK", true],
    ["50 SEK off (spend 150 SEK)", "SEK", true],
    ["20 ₪ off (spend 60 ₪)", "ILS", true],
  ];

  for (const [text, currencyCode, eligible] of cases) {
    const result = analyze(text, "restaurant", currencyCode);
    assert.equal(result.discount.currencyCode, currencyCode, text);
    if (eligible !== null) {
      assert.equal(result.notificationEligible, eligible, text);
    }
  }
});

test("off-over wording is treated as a minimum spend", () => {
  const result = analyze("₪20 off over ₪249", "pet_supply", "ILS");
  assert.equal(result.value.minimumSpend, 249);
  assert.equal(result.value.effectiveDiscountPercent, 8);
  assert.equal(result.notificationEligible, false);
});

test("caps are parsed without confusing them with minimum spend", () => {
  const result = analyze("15% off (up to 10 €)", "restaurant", "EUR");
  assert.equal(result.discount.amount, 15);
  assert.equal(result.value.minimumSpend, null);
  assert.equal(result.value.maxSavings, 10);
  assert.equal(result.notificationEligible, true);
});

test("up-to percentages are demoted and do not notify", () => {
  const result = analyze("Nuolaida iki 20%", "restaurant", "EUR");
  assert.equal(result.value.isUpToPercent, true);
  assert.equal(result.notificationEligible, false);
});

test("money parser supports observed symbol and code placement", () => {
  assert.deepEqual(extractDiscount("€5 off", { currencyCode: "EUR" }), {
    amount: 5,
    type: "money",
    currencyCode: "EUR",
    label: "5 EUR",
  });
  assert.equal(extractDiscount("20 ₪ off", { currencyCode: "ILS" }).amount, 20);
  assert.equal(extractDiscount("12₾ off", { currencyCode: "GEL" }).currencyCode, "GEL");
});

test("offers sort by value score descending", () => {
  const low = { venue: { name: "Low" }, text: "10% off", ...analyze("10% off", "restaurant", "EUR").value };
  low.value = { version: 2, score: 10 };
  const high = { venue: { name: "High" }, text: "50% off", value: { version: 2, score: 80 } };
  assert.deepEqual(sortOffersByValue([low, high]).map((offer) => offer.venue.name), ["High", "Low"]);
});

test("stored version-two analysis is accepted by eligibility", () => {
  const analyzed = analyze("20% off", "restaurant", "EUR");
  const offer = {
    text: "20% off",
    amount: 20,
    amountType: "percent",
    productLine: "restaurant",
    value: analyzed.value,
  };
  assert.equal(isNotificationWorthy(offer), true);
});
