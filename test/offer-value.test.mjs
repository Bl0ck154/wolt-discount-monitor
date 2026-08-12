import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeOffer,
  extractDiscount,
  extractMultibuy,
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

test("selected items and delivery stay excluded from notifications", () => {
  const cases = [
    ["50% off selected items", "pharmacy"],
    ["2000 HUF item discount", "restaurant"],
    ["20% for buns", "grocery"],
    ["-20% Wok", "restaurant"],
    ["70% off a wide selection", "grocery"],
    ["20% off buns in your basket", "grocery"],
    ["5 EUR off buns", "grocery"],
    ["0 € delivery fee", "restaurant"],
    ["14 days of €0 delivery fees", "restaurant"],
  ];
  for (const [text, productLine] of cases) {
    const result = analyze(text, productLine, "EUR");
    assert.equal(result.notificationEligible, false, text);
    assert.notEqual(result.value.scope, "broad", text);
  }
});

test("free perks receive useful non-zero site priority without noisy notifications", () => {
  const dessert = analyze("Free dessert", "restaurant", "EUR");
  const sauce = analyze("2 Free garlic sauces!", "restaurant", "EUR");
  const meal = analyze("Free meal", "restaurant", "EUR");

  assert.equal(dessert.value.scope, "perk");
  assert.equal(sauce.value.scope, "perk");
  assert.ok(dessert.value.score > 0);
  assert.ok(sauce.value.score > 0);
  assert.ok(meal.value.score > dessert.value.score);
  assert.ok(dessert.value.score > sauce.value.score);
  assert.equal(dessert.notificationEligible, false);
  assert.equal(sauce.notificationEligible, false);
  assert.equal(meal.notificationEligible, false);
});

test("2-for-1 gets a 50 percent equivalent and balanced priority", () => {
  const unknown = analyze("Buy 2, Pay for 1", "restaurant", "EUR");
  const pizza = analyze("Buy 2 pizzas, Pay for 1", "restaurant", "EUR");
  const cola = analyze("2 for 1 cola", "restaurant", "EUR");
  const allPizzas = analyze("2 for 1 on all pizzas", "restaurant", "EUR");

  for (const result of [unknown, pizza, cola, allPizzas]) {
    assert.equal(result.value.scope, "multibuy");
    assert.equal(result.value.isMultibuy, true);
    assert.equal(result.value.effectiveDiscountPercent, 50);
    assert.equal(result.discount.amount, 50);
    assert.ok(result.value.score > 0);
  }

  assert.equal(unknown.notificationEligible, false);
  assert.equal(pizza.notificationEligible, true);
  assert.equal(cola.notificationEligible, false);
  assert.equal(allPizzas.notificationEligible, true);
  assert.ok(allPizzas.value.score > pizza.value.score);
  assert.ok(pizza.value.score > unknown.value.score);
  assert.ok(unknown.value.score > cola.value.score);
});

test("2+1 and buy-one-get-one-free are converted mathematically", () => {
  const twoPlusOne = analyze("2 + 1 free pizza", "restaurant", "EUR");
  const bogo = analyze("Buy one get one free burger", "restaurant", "EUR");

  assert.equal(twoPlusOne.value.effectiveDiscountPercent, 33.3);
  assert.equal(twoPlusOne.value.multibuy.totalQuantity, 3);
  assert.equal(twoPlusOne.value.multibuy.paidQuantity, 2);
  assert.equal(twoPlusOne.notificationEligible, true);

  assert.equal(bogo.value.effectiveDiscountPercent, 50);
  assert.equal(bogo.value.multibuy.totalQuantity, 2);
  assert.equal(bogo.value.multibuy.paidQuantity, 1);
  assert.equal(bogo.notificationEligible, true);
});

test("multibuy parsing supports common international forms", () => {
  const cases = [
    ["2 už 1 pica", 50],
    ["2 za 1 pizza", 50],
    ["2x1 burger", 50],
    ["3 for 2 sushi", 33.3],
    ["Pirk 2, mokėk už 1 picas", 50],
    ["Kup 2, zapłać za 1 burgery", 50],
    ["Купи 2, заплати за 1 піци", 50],
  ];

  for (const [text, expected] of cases) {
    const result = extractMultibuy(text);
    assert.ok(result, text);
    assert.equal(result.effectiveDiscountPercent, expected, text);
  }
});

test("multibuy priority is currency-independent", () => {
  const eur = analyze("2 for 1 pizza", "restaurant", "EUR");
  const huf = analyze("2 for 1 pizza", "restaurant", "HUF");
  const pln = analyze("2 for 1 pizza", "restaurant", "PLN");

  assert.equal(eur.value.score, huf.value.score);
  assert.equal(eur.value.score, pln.value.score);
  assert.equal(eur.notificationEligible, true);
  assert.equal(huf.notificationEligible, true);
  assert.equal(pln.notificationEligible, true);
});

test("price wording is not mistaken for multibuy", () => {
  assert.equal(extractMultibuy("2 pizzas for 10 EUR"), null);
  assert.equal(extractMultibuy("Lunch for 2 people"), null);
});

test("only clearly broad percent wording is notification eligible", () => {
  const cases = [
    ["20% off", "restaurant"],
    ["Get 20% off", "restaurant"],
    ["-25% basket discount", "restaurant"],
    ["-25% off the basket", "restaurant"],
    ["15% off (up to 50 EUR)", "restaurant"],
    ["10% off", "grocery"],
  ];

  for (const [text, productLine] of cases) {
    const result = analyze(text, productLine, "EUR");
    assert.equal(result.value.scope, "broad", text);
    assert.equal(result.notificationEligible, true, text);
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

test("menu prices are not mistaken for cash discounts", () => {
  const priceOnly = [
    "Fan Zone Feast for 23.95 EUR",
    "Halftime Heroes combo 13.95 EUR",
    "Lunch menu 10 EUR",
  ];

  for (const text of priceOnly) {
    assert.equal(extractDiscount(text, { currencyCode: "EUR" }), null, text);
    assert.equal(analyze(text, "restaurant", "EUR").notificationEligible, false, text);
  }

  const reversed = extractDiscount("Spend 20 EUR, get 5 EUR off", { currencyCode: "EUR" });
  assert.equal(reversed.amount, 5);
  assert.equal(reversed.type, "money");
});

test("offers sort by value score descending", () => {
  const low = { venue: { name: "Low" }, text: "10% off", ...analyze("10% off", "restaurant", "EUR").value };
  low.value = { version: 2, score: 10 };
  const high = { venue: { name: "High" }, text: "50% off", value: { version: 2, score: 80 } };
  assert.deepEqual(sortOffersByValue([low, high]).map((offer) => offer.venue.name), ["High", "Low"]);
});

test("legacy analysis is re-evaluated with current scope rules", () => {
  const offer = {
    text: "20% for buns",
    amount: 20,
    amountType: "percent",
    productLine: "grocery",
    value: {
      version: 3,
      score: 56,
      tier: "good",
      scope: "broad",
      effectiveDiscountPercent: 20,
      isUpToPercent: false,
    },
  };
  assert.equal(isNotificationWorthy(offer), false);

  assert.equal(isNotificationWorthy({
    ...offer,
    text: "20% off",
    productLine: "restaurant",
  }), true);

  assert.equal(isNotificationWorthy({
    ...offer,
    text: "Lunch menu 10 EUR",
    amount: 10,
    amountType: "money",
    productLine: "restaurant",
  }), false);
});
