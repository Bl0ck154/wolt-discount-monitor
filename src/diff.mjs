import { NOTIFY_RULES } from "./config.mjs";
import { isNotificationWorthy, normalizeOfferText, sortOffersByValue } from "./offer-value.mjs";
import { isLikelyAcquisitionOffer as isLikelyAcquisitionBanner } from "../docs/offer-filters.mjs";

export function diffSnapshots(previous, current) {
  const previousOffers = offerIndex(previous);
  const currentOffers = offerIndex(current);
  const appeared = [];
  const disappeared = [];

  for (const [key, offer] of currentOffers) {
    if (!previousOffers.has(key)) {
      appeared.push(offer);
    }
  }

  for (const [key, offer] of previousOffers) {
    if (!currentOffers.has(key)) {
      disappeared.push(offer);
    }
  }

  return {
    generatedAt: current.generatedAt,
    previousGeneratedAt: previous?.generatedAt ?? null,
    counts: current.counts,
    appeared,
    disappeared,
    interestingAppeared: sortOffersByValue(appeared.filter(isInterestingOffer)),
    interestingDisappeared: sortOffersByValue(disappeared.filter(isInterestingOffer)),
  };
}

export function isInterestingOffer(offer) {
  return !offer.isUtilityBadge &&
    !isLikelyAcquisitionOffer(offer) &&
    isNotificationWorthy(offer, NOTIFY_RULES);
}

export function interestingOfferIndex(snapshot) {
  return new Map([...offerIndex(snapshot)].filter(([, offer]) => isInterestingOffer(offer)));
}

export function offerIndex(snapshot) {
  const map = new Map();

  for (const venue of snapshot?.venues ?? []) {
    for (const offer of venue.offers ?? []) {
      if (offer.sourcePath === "venue.badges_v2") {
        continue;
      }

      const stableKey = offerStableKey(venue, offer);

      map.set(stableKey, {
        venue: {
          id: venue.id,
          slug: venue.slug,
          name: venue.name,
          productLine: venue.productLine,
          currency: venue.currency,
          link: venue.link,
          imageUrl: venue.imageUrl,
        },
        stableKey,
        ...offer,
      });
    }
  }

  return map;
}

// Use the same account-eligibility heuristic in alerts and the dashboard.
export function isLikelyAcquisitionOffer(offer) {
  return isLikelyAcquisitionBanner(offer?.text);
}

// The campaign ID may disappear or change when Wolt switches between its
// promotions and telemetry feed. Offer text is deduped per venue already.
export function offerStableKey(venue, offer) {
  const venueId = String(venue?.slug ?? venue?.id ?? "");
  const offerText = normalizeOfferText(offer?.text).toLowerCase();
  return [venueId, offerText || String(offer?.campaignId ?? "")].join("|");
}
