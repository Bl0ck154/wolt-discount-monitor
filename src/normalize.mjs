export function normalizeSnapshot({ urls, restaurantRows, promoRows }) {
  const generatedAt = new Date().toISOString();
  const venues = promoRows
    .map((row) => normalizeVenueRow(row, urls.promotions))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  return {
    generatedAt,
    source: {
      promotionsEndpoint: urls.promotions,
      restaurantsEndpoint: urls.restaurants,
      requiredHeaders: { Platform: "Web" },
    },
    counts: {
      restaurantsUniqueVenues: restaurantRows.length,
      promotionsUniqueVenues: venues.length,
      productLines: countBy(venues, (venue) => venue.productLine || "unknown"),
    },
    venues,
  };
}

function normalizeVenueRow(row, sourceEndpoint) {
  const venue = row.venue;
  const offers = extractOffers(venue);

  return {
    id: venue.id ?? null,
    slug: venue.slug ?? null,
    name: venue.name ?? "",
    productLine: venue.product_line ?? null,
    address: venue.address ?? null,
    link: row.item?.link?.target ?? buildWoltLink(venue),
    imageUrl: venue.image?.url ?? venue.brand_image?.url ?? row.item?.image?.url ?? null,
    brandImageUrl: venue.brand_image?.url ?? null,
    rating: venue.rating ?? null,
    deliveryPrice: venue.delivery_price ?? null,
    deliveryPriceInt: venue.delivery_price_int ?? null,
    estimateRange: venue.estimate_range ?? venue.estimate_box?.title ?? null,
    section: {
      name: row.sectionName,
      template: row.sectionTemplate,
    },
    offers,
    bestDiscount: bestDiscount(offers),
    bestAmount: bestDiscount(offers)?.amount ?? null,
    bestLabel: bestDiscount(offers)?.label ?? null,
    offerTexts: [...new Set(offers.map((offer) => offer.text).filter(Boolean))],
    sourceEndpoint,
    raw: {
      promotions: venue.promotions ?? [],
      badges_v2: venue.badges_v2 ?? [],
      promotions_for_telemetry: venue.promotions_for_telemetry ?? [],
    },
  };
}

function extractOffers(venue) {
  const offers = [];

  for (const promotion of venue.promotions ?? []) {
    offers.push(normalizeOffer("venue.promotions", promotion));
  }

  for (const badge of venue.badges_v2 ?? []) {
    if (badge?.text) {
      offers.push(normalizeOffer("venue.badges_v2", badge));
    }
  }

  for (const promotion of venue.promotions_for_telemetry ?? []) {
    offers.push(normalizeOffer("venue.promotions_for_telemetry", promotion));
  }

  return dedupeOffers(offers);
}

function normalizeOffer(sourcePath, raw) {
  const text = normalizeText(raw.text ?? raw.formatted_text ?? "");
  const discount = extractDiscount(text);

  return {
    key: `${sourcePath}:${raw.campaign_id ?? raw.discount_id ?? text}`,
    sourcePath,
    campaignId: raw.campaign_id ?? raw.discount_id ?? null,
    text,
    amount: discount?.amount ?? null,
    amountType: discount?.type ?? null,
    amountLabel: discount?.label ?? null,
    variant: raw.variant ?? raw.type ?? null,
    raw,
  };
}

function dedupeOffers(offers) {
  const seen = new Set();
  const result = [];

  for (const offer of offers) {
    const key = `${offer.campaignId ?? ""}:${offer.text}:${offer.sourcePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(offer);
    }
  }

  return result;
}

export function normalizeText(text) {
  return String(text).replace(/\u202f|\u00a0/g, " ").trim();
}

export function extractAmount(text = "") {
  return extractDiscount(text)?.amount ?? null;
}

export function extractDiscount(text = "") {
  const normalized = normalizeText(text);
  const percent = normalized.match(/(-?\d+(?:[.,]\d+)?)\s*%/);

  if (percent) {
    const amount = Math.abs(Number(percent[1].replace(",", ".")));
    return { amount, type: "percent", label: `${amount}%` };
  }

  const money = normalized.match(/(?:€\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:€|eur|euro))/i);

  if (money) {
    const amount = Number((money[1] ?? money[2]).replace(",", "."));
    return { amount, type: "money", label: `${amount} EUR` };
  }

  return null;
}

function bestDiscount(offers) {
  const discounts = offers
    .filter((offer) => Number.isFinite(offer.amount))
    .sort((a, b) => discountScore(b) - discountScore(a));

  if (!discounts.length) {
    return null;
  }

  const best = discounts[0];
  return {
    amount: best.amount,
    type: best.amountType,
    label: best.amountLabel,
    sourceText: best.text,
  };
}

function discountScore(offer) {
  if (offer.amountType === "percent") {
    return offer.amount;
  }

  if (offer.amountType === "money") {
    return offer.amount;
  }

  return -1;
}

function buildWoltLink(venue) {
  if (!venue.slug) {
    return null;
  }

  const kind = venue.product_line === "restaurant" ? "restaurant" : "venue";
  return `https://wolt.com/en/ltu/vilnius/${kind}/${venue.slug}`;
}

function countBy(items, keyFn) {
  const counts = {};

  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
