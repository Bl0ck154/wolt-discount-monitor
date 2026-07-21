import { NOTIFY_RULES } from "./config.mjs";
import { isNotificationWorthy, sortOffersByValue } from "./offer-value.mjs";

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
  return !offer.isUtilityBadge && isNotificationWorthy(offer, NOTIFY_RULES);
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

      const stableKey = [
        venue.slug ?? venue.id,
        offer.campaignId ?? offer.text,
      ].join("|");

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
