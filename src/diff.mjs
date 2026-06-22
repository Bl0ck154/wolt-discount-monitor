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
  const isSelectedItem = isSpecificItemOffer(text);
  const minSpend = minimumSpendAmount(text);

  if (offer.isUtilityBadge || isSelectedItem || (!NOTIFY_RULES.includeZeroDelivery && isDelivery)) {
    return false;
  }

  if (offer.amountType === "percent" && Number.isFinite(offer.amount)) {
    return offer.amount >= NOTIFY_RULES.minDiscountPercent && isWholeMenuOffer(text) && isAllowedMinimumSpend(minSpend);
  }

  if (
    offer.amountType === "money" &&
    Number.isFinite(offer.amount) &&
    offer.amount >= NOTIFY_RULES.minDiscountEur &&
    isAllowedMinimumSpend(minSpend)
  ) {
    return true;
  }

  return false;
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

function isAllowedMinimumSpend(amount) {
  return amount === null || amount <= NOTIFY_RULES.maxMinimumSpendEur;
}

function isWholeMenuOffer(text) {
  return /\b(?:all|entire|whole|everything)\b.*\b(?:menu|basket|order|items?)\b/i.test(text) ||
    /\b(?:menu|basket|whole order|entire order|order discount|all items?|everything)\b/i.test(text);
}

function isSpecificItemOffer(text) {
  return /selected\s+(?:item|items|product|products)|specific\s+(?:item|items|product|products)/i.test(text) ||
    /\b(?:burger|burgers|tortilla|tortillas|meal|meals|combo|combos|set|sets|pizza|pizzas|sushi set)\b/i.test(text);
}

function minimumSpendAmount(text) {
  const normalized = String(text).replace(/,/g, ".");
  const patterns = [
    /\bspend\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)?/i,
    /\bminimum\s*(?:order|spend|basket)?\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)?/i,
    /\bmin\.?\s*(?:order|spend|basket)?\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)?/i,
    /\bfrom\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)/i,
    /\borders?\s+over\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)?/i,
    /\bover\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const amount = Number(match[1]);
      return Number.isFinite(amount) ? amount : null;
    }
  }

  return null;
}
