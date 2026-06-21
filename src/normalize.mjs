import { CITY, cityLabel } from "./config.mjs";

export function normalizeSnapshot({ city = CITY, urls, restaurantRows, promoRows }) {
  const generatedAt = new Date().toISOString();
  const venues = promoRows
    .map((row) => normalizeVenueRow(row, urls.promotions, city))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  return {
    generatedAt,
    city: publicCity(city),
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

function normalizeVenueRow(row, sourceEndpoint, city) {
  const venue = row.venue;
  const offers = extractOffers(venue);
  const best = bestDiscount(offers);
  const coordinates = extractCoordinates(venue) ?? extractCoordinates(row.item);
  const opening = extractOpening(venue, row.item);

  return {
    id: venue.id ?? null,
    slug: venue.slug ?? null,
    name: venue.name ?? "",
    productLine: venue.product_line ?? null,
    address: formatAddress(venue.address),
    coordinates,
    mapUrl: buildMapUrl(venue, coordinates, city),
    link: row.item?.link?.target ?? buildWoltLink(venue, city),
    imageUrl: venue.image?.url ?? venue.brand_image?.url ?? row.item?.image?.url ?? null,
    brandImageUrl: venue.brand_image?.url ?? null,
    rating: venue.rating ?? null,
    deliveryPrice: venue.delivery_price ?? null,
    deliveryPriceInt: venue.delivery_price_int ?? null,
    estimateRange: venue.estimate_range ?? venue.estimate_box?.title ?? null,
    opening,
    isOpen: opening.isOpen,
    openingStatus: opening.label,
    openingHours: opening.hours,
    section: {
      name: row.sectionName,
      template: row.sectionTemplate,
    },
    offers,
    bestDiscount: best,
    bestAmount: best?.amount ?? null,
    bestLabel: best?.label ?? null,
    offerTexts: [...new Set(offers.map((offer) => offer.text).filter(Boolean))],
    sourceEndpoint,
    raw: {
      promotions: venue.promotions ?? [],
      badges_v2: venue.badges_v2 ?? [],
      promotions_for_telemetry: venue.promotions_for_telemetry ?? [],
    },
  };
}

function publicCity(city) {
  return {
    id: city.id,
    key: city.key,
    woltCityId: city.woltCityId,
    slug: city.slug,
    name: city.name,
    country: city.country,
    countryEmoji: city.countryEmoji,
    countryCode: city.countryCode,
    countryCode2: city.countryCode2,
    countryCode3: city.countryCode3,
    lat: city.lat,
    lon: city.lon,
    locale: city.locale ?? "en",
    timezone: city.timezone,
    label: cityLabel(city),
    notificationsEnabled: city.notificationsEnabled === true,
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
    category: classifyOffer(text),
    isDeliveryRelated: isDeliveryRelated(text),
    isUtilityBadge: isUtilityOfferText(text),
    score: scoreOffer({ text, amount: discount?.amount ?? null, amountType: discount?.type ?? null }),
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

  return result.filter((offer) => !offer.isUtilityBadge);
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
    .filter((offer) => !offer.isDeliveryRelated)
    .filter((offer) => !offer.isUtilityBadge)
    .filter((offer) => Number.isFinite(offer.amount))
    .sort((a, b) => scoreOffer(b) - scoreOffer(a));

  if (!discounts.length) {
    return null;
  }

  const best = discounts[0];
  return {
    amount: best.amount,
    type: best.amountType,
    label: best.amountLabel,
    sourceText: best.text,
    score: scoreOffer(best),
  };
}

function classifyOffer(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (isNewUserZeroDelivery(normalized)) {
    return "new-user-delivery";
  }
  if (isDeliveryRelated(normalized)) {
    return "delivery";
  }
  if (/%/.test(normalized)) {
    return "percent";
  }
  if (/€|eur|euro/.test(normalized)) {
    return "money";
  }
  if (/free|deal|discount|off|save|nuolaid/i.test(normalized)) {
    return "deal";
  }
  return "other";
}

function isNewUserZeroDelivery(text) {
  return /(?:0\s*€|€\s*0|0\s*(?:eur|euro))/.test(text) && /delivery/.test(text) && /new users?/.test(text);
}

function isDeliveryRelated(text) {
  return /delivery/i.test(normalizeText(text));
}

function isUtilityOfferText(text) {
  return /^\d+\s+more$/i.test(normalizeText(text));
}

function formatAddress(address) {
  if (!address) {
    return null;
  }
  if (typeof address === "string") {
    return address;
  }
  return [address.street_address, address.formatted_address, address.address, address.city]
    .filter(Boolean)
    .join(", ") || null;
}

function extractCoordinates(source) {
  const candidates = [
    source?.location,
    source?.coordinates,
    source?.address?.location,
    source?.venue?.location,
  ];

  for (const candidate of candidates) {
    const coordinates = normalizeCoordinates(candidate);
    if (coordinates) {
      return coordinates;
    }
  }

  return normalizeCoordinates(source);
}

function normalizeCoordinates(value) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value) && value.length >= 2) {
    return finiteCoordinates(value[1], value[0]);
  }

  if (Array.isArray(value.coordinates) && value.coordinates.length >= 2) {
    return finiteCoordinates(value.coordinates[1], value.coordinates[0]);
  }

  return finiteCoordinates(
    value.lat ?? value.latitude,
    value.lon ?? value.lng ?? value.longitude,
  );
}

function finiteCoordinates(lat, lon) {
  const numericLat = Number(lat);
  const numericLon = Number(lon);
  if (Number.isFinite(numericLat) && Number.isFinite(numericLon)) {
    return { lat: numericLat, lon: numericLon };
  }
  return null;
}

function buildMapUrl(venue, coordinates, city) {
  if (coordinates) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${coordinates.lat},${coordinates.lon}`)}`;
  }

  const query = [venue.name, formatAddress(venue.address), cityLabel(city)].filter(Boolean).join(" ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

function extractOpening(venue, item) {
  const rawStatus = [
    venue.online_status,
    venue.opening_status,
    venue.status,
    venue.status_label,
    item?.overlay_v2?.primary_text,
    item?.overlay_v2?.secondary_text,
    item?.overlay,
  ]
    .filter(Boolean)
    .join(" ");
  const lowerStatus = rawStatus.toLowerCase();

  let isOpen = null;
  if (venue.is_open === true || venue.online === true || venue.is_online === true) {
    isOpen = true;
  }
  if (venue.is_open === false || venue.online === false || venue.is_online === false) {
    isOpen = false;
  }
  if (/open|available|accepting/i.test(lowerStatus)) {
    isOpen = true;
  }
  if (/closed|offline|unavailable|not accepting/i.test(lowerStatus)) {
    isOpen = false;
  }

  const hours = venue.opening_hours?.text ?? venue.opening_times?.text ?? venue.opening_time ?? null;
  const rawLabel = humanStatusLabel(rawStatus);
  const label = isOpen === true ? "Open now" : rawLabel || (isOpen === false ? "Closed" : hours ?? "No status");

  return { isOpen, label, hours };
}

function humanStatusLabel(value = "") {
  const normalized = String(value)
    .replace(/\s+/g, " ")
    .replace(/\bSchedule order\b/gi, "")
    .replace(/\bClosed\b/gi, "")
    .trim();

  if (!normalized || normalized.toLowerCase() === "min") {
    return null;
  }

  return normalized;
}

function scoreOffer(offer) {
  const text = normalizeText(offer.text).toLowerCase();
  const amount = Number(offer.amount);
  if (!Number.isFinite(amount) || isDeliveryRelated(text) || isUtilityOfferText(text)) {
    return -1;
  }

  const selectedItems = /selected items?|selected products?|specific items?/i.test(text);
  const hasMinimumSpend = /\bspend\b|minimum|min\.?\s*(?:order|spend|basket)|from\s+\d|over\s+\d|orders?\s+over/i.test(text);

  if (offer.amountType === "percent") {
    if (/basket|menu|entire|everything|all items?|whole order|order discount/i.test(text)) {
      return 5000 + amount;
    }
    if (selectedItems) {
      return 1000 + amount;
    }
    return 4000 + amount;
  }

  if (offer.amountType === "money") {
    if (hasMinimumSpend) {
      return 2000 + amount;
    }
    return 3000 + amount;
  }

  return -1;
}

function buildWoltLink(venue, city) {
  if (!venue.slug) {
    return null;
  }

  const kind = venue.product_line === "restaurant" ? "restaurant" : "venue";
  return `https://wolt.com/${city.locale ?? "en"}/${city.countryCode}/${city.slug ?? city.id}/${kind}/${venue.slug}`;
}

function countBy(items, keyFn) {
  const counts = {};

  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
