import { analyzeOffer } from "./offer-value.mjs";

export function rescoreSnapshot(snapshot = {}) {
  const venues = (snapshot.venues ?? [])
    .map(rescoreVenue)
    .sort((a, b) =>
      Number(b.bestDiscount?.score ?? 0) - Number(a.bestDiscount?.score ?? 0) ||
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "en"));

  return { ...snapshot, venues };
}

function rescoreVenue(venue = {}) {
  const offers = (venue.offers ?? [])
    .map((offer) => rescoreOffer(offer, venue))
    .sort((a, b) =>
      Number(b.value?.score ?? 0) - Number(a.value?.score ?? 0) ||
      String(a.text ?? "").localeCompare(String(b.text ?? ""), "en"));
  const bestDiscount = bestOffer(offers);

  return {
    ...venue,
    offers,
    bestDiscount,
    bestAmount: bestDiscount?.amount ?? null,
    bestLabel: bestDiscount?.label ?? null,
  };
}

function rescoreOffer(offer = {}, venue = {}) {
  const analysis = analyzeOffer({
    text: offer.text ?? "",
    productLine: venue.productLine,
    currencyCode: offer.currencyCode ?? venue.currency,
  });
  const discount = analysis.discount;

  return {
    ...offer,
    amount: discount?.amount ?? null,
    amountType: discount?.type ?? null,
    amountLabel: discount?.label ?? null,
    currencyCode: analysis.value.currencyCode,
    minimumSpend: analysis.value.minimumSpend,
    maxSavings: analysis.value.maxSavings,
    effectiveDiscountPercent: analysis.value.effectiveDiscountPercent,
    scope: analysis.value.scope,
    valueVersion: analysis.value.version,
    valueScore: analysis.value.score,
    valueTier: analysis.value.tier,
    value: analysis.value,
    notificationEligible: analysis.notificationEligible,
    isDeliveryRelated: analysis.value.isDelivery,
    isLowValuePerk: analysis.value.isPerk,
    isMultibuy: analysis.value.isMultibuy,
    score: analysis.value.score,
  };
}

function bestOffer(offers) {
  const best = offers
    .filter((offer) => offer.isUtilityBadge !== true)
    .filter((offer) => Number(offer.value?.score ?? 0) > 0)
    .sort((a, b) => Number(b.value?.score ?? 0) - Number(a.value?.score ?? 0))[0];

  if (!best) return null;

  return {
    amount: best.amount,
    type: best.amountType,
    label: best.amountLabel ?? best.text,
    sourceText: best.text,
    score: best.value.score,
    tier: best.value.tier,
    scope: best.value.scope,
    effectiveDiscountPercent: best.value.effectiveDiscountPercent,
    currencyCode: best.value.currencyCode,
    minimumSpend: best.value.minimumSpend,
  };
}
