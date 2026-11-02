// Approximate checkout using amounts the visitor reads in Wolt.
// We have no account or delivery address, so never infer live delivery fees.
export function canEstimateOffer(offer) {
  const value = offer?.value ?? {};
  return offer && !value.isDelivery && !value.isMultibuy &&
    !value.isSelectedItems && !value.isUpToPercent && !value.isPerk &&
    value.scope === "broad" &&
    (offer.amountType === "money" || offer.amountType === "percent") &&
    Number.isFinite(offer.amount) && offer.amount > 0 && (offer.amountType !== "percent" || offer.amount <= 100);
}
export function bestEstimatableOffer(offers = []) {
  return [...offers].filter(canEstimateOffer).sort((a,b) =>
    Number(b.value?.score ?? 0) - Number(a.value?.score ?? 0))[0] ?? null;
}
export function estimateCheckout({ basket, deliveryFee, serviceFee, offer, currency }) {
  const valid = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100000;
  if (![basket, deliveryFee, serviceFee].every(valid)) return { status: "missing" };
  if (!canEstimateOffer(offer)) return { status: "unsupported" };
  if (offer.amountType === "money" && offer.amount > basket) return { status: "unsupported" };
  if (currency && offer.currencyCode && offer.currencyCode !== currency) return { status: "unsupported" };
  const threshold = Number(offer.value?.minimumSpend);
  if (Number.isFinite(threshold) && threshold > basket) {
    return { status: "minimum", minimumSpend: threshold };
  }
  let savings = offer.amountType === "percent"
    ? basket * Math.min(offer.amount, 100) / 100
    : offer.amount;
  const cap = Number(offer.value?.maxSavings);
  if (Number.isFinite(cap) && cap > 0) savings = Math.min(savings, cap);
  savings = Math.max(0, Math.min(basket, savings));
  const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  return { status: "ok", subtotal: basket, savings: round(savings),
    deliveryFee, serviceFee, total: round(basket - savings + deliveryFee + serviceFee) };
}
