import { NOTIFY_RULES } from "./config.mjs";

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
    interestingAppeared: appeared.filter(isInterestingOffer),
    interestingDisappeared: disappeared.filter(isInterestingOffer),
  };
}

export function isInterestingOffer(offer) {
  const text = offer.text.toLowerCase();
  const isDelivery = /delivery/.test(text);
  const isSelectedItem = /selected\s+(?:item|items|product|products)|specific\s+(?:item|items|product|products)/i.test(text);

  if (offer.isUtilityBadge || isSelectedItem || (!NOTIFY_RULES.includeZeroDelivery && isDelivery)) {
    return false;
  }

  if (offer.amountType === "percent" && Number.isFinite(offer.amount)) {
    return offer.amount >= NOTIFY_RULES.minDiscountPercent;
  }

  if (
    offer.amountType === "money" &&
    Number.isFinite(offer.amount) &&
    offer.amount >= NOTIFY_RULES.minDiscountEur
  ) {
    return true;
  }

  return /%|off|discount|deal|save|nuolaid/i.test(offer.text) && !isDelivery;
}

export function interestingOfferIndex(snapshot) {
  return new Map([...offerIndex(snapshot)].filter(([, offer]) => isInterestingOffer(offer)));
}

function offerIndex(snapshot) {
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
