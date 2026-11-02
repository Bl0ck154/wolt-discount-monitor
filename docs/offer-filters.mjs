// Shared browser/server predicate for anonymous Wolt banners whose eligibility
// cannot be verified for an existing customer. Keep the raw snapshot intact.
const GENERIC_ACQUISITION_BANNERS = new Set([
  "5 € off (spend 12 €)",
  "10 € off (spend 15 €)",
]);

export function isLikelyAcquisitionOffer(value) {
  const text = String(value ?? "").toLowerCase()
    .replace(/\u202f|\u00a0/gu, " ")
    .replace(/\b(?:eur|euros?)\b/gu, "€")
    .replace(/\s*€\s*/gu, " € ")
    .replace(/\s+/gu, " ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")")
    .trim();

  return GENERIC_ACQUISITION_BANNERS.has(text) ||
    /\b(?:new\s+(?:customers?|users?)|first[- ]time\s+(?:customers?|users?)|first\s+orders?|new\s+account|neukund\w*|nur\s+f[üu]r\s+neukund\w*|naujiems\s+klientams|tik\s+naujiems|nowych\s+klient\w*|pierwsz\w*\s+zam[oó]wieni\w*|nov[eé]\s+z[aá]kazn[ií]ky|prvn[ií]\s+objedn[aá]vk\w*)\b/iu.test(text);
}

export function isExplicitlyClosed(venue) {
  return venue?.opening?.isOpen === false || venue?.isOpen === false;
}

export function shouldDisplayVenue(venue, visibleOffers, { hideClosed = false, offersOnly = false } = {}) {
  if (hideClosed && isExplicitlyClosed(venue)) return false;
  if (offersOnly && !visibleOffers.length) return false;
  return true;
}
