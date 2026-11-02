import { isLikelyAcquisitionOffer } from "./offer-filters.mjs";

// One definition of relevant offers for dashboard, SEO and Telegram.
// Never delete raw banners: a citywide campaign could still apply to some accounts.
export function offerTextKey(text) {
  return String(text ?? "").normalize("NFKC")
    .replace(/\u202f|\u00a0/g, " ").replace(/\s+/g, " ")
    .trim().toLowerCase();
}

export function venueOffers(venue) {
  return Array.isArray(venue?.offers) && venue.offers.length
    ? venue.offers
    : (venue?.offerTexts ?? []).map((text) => ({ text }));
}

export function isUtilityBadge(offer) {
  const key = offerTextKey(offer?.text);
  return Boolean(offer?.isUtilityBadge) ||
    !key || /^(?:\d+\s+more|new|popular|sponsored|featured)$/iu.test(key);
}

export function isDeliveryOffer(offer) {
  const key = offerTextKey(offer?.text);
  return Boolean(offer?.value?.isDelivery) ||
    /\b(?:delivery|deliveries|lieferung|dostawa|dostawy|pristatymas|doručení)\b|доставка/iu.test(key);
}

export function ubiquitousOfferIndex(venues, { minimumVenues = 10, fraction = 0.75 } = {}) {
  const counts = new Map(), labels = new Map();
  let venuesWithOffers = 0;
  for (const venue of venues ?? []) {
    const entries = new Set();
    for (const offer of venueOffers(venue)) {
      if (isUtilityBadge(offer)) continue;
      const key = offerTextKey(offer.text);
      entries.add(key);
      if (!labels.has(key)) labels.set(key, offer.text);
    }
    if (!entries.size) continue;
    venuesWithOffers++;
    for (const key of entries) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (venuesWithOffers < minimumVenues) return { keys: new Set(), labels: [] };
  const threshold = Math.max(minimumVenues, Math.ceil(venuesWithOffers * fraction));
  const repeated = [...counts.entries()].filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { keys: new Set(repeated.map(([key]) => key)), labels: repeated.map(([key]) => labels.get(key)) };
}

export function visibleVenueOffers(venue, {
  ubiquitousKeys = new Set(), hideAcquisition = true, hideDelivery = true,
} = {}) {
  const unique = new Set();
  return venueOffers(venue).filter((offer) => {
    if (isUtilityBadge(offer)) return false;
    const key = offerTextKey(offer.text);
    if (unique.has(key)) return false;
    unique.add(key);
    if (hideAcquisition && (isLikelyAcquisitionOffer(offer.text) || ubiquitousKeys.has(key))) return false;
    if (hideDelivery && isDeliveryOffer(offer)) return false;
    return true;
  });
}

export function visibleVenueCount(venues, score = () => 1) {
  const keys = ubiquitousOfferIndex(venues).keys;
  let visible = 0, ranked = 0;
  for (const venue of venues ?? []) {
    const offers = visibleVenueOffers(venue, { ubiquitousKeys: keys });
    if (!offers.length) continue;
    visible++;
    if (offers.some((offer) => Number(score(offer)) > 0)) ranked++;
  }
  return { visible, ranked, scanned: (venues ?? []).length };
}
