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
  };
}

export function isInterestingOffer(offer) {
  const text = offer.text.toLowerCase();

  if (!NOTIFY_RULES.includeZeroDelivery && /delivery/.test(text) && offer.amount === 0) {
    return false;
  }

  if (offer.amountType === "percent" && Number.isFinite(offer.amount)) {
    return true;
  }

  if (
    offer.amountType === "money" &&
    Number.isFinite(offer.amount) &&
    offer.amount >= NOTIFY_RULES.minDiscountEur
  ) {
    return true;
  }

  return /%|off|discount|deal|save|nuolaid/i.test(offer.text) && !/delivery/.test(text);
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
        offer.sourcePath,
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
        ...offer,
      });
    }
  }

  return map;
}
