export function compactSnapshot(snapshot = {}) {
  return cleanObject({
    generatedAt: snapshot.generatedAt,
    city: compactSnapshotCity(snapshot.city),
    counts: snapshot.counts,
    venues: (snapshot.venues ?? []).map(compactVenue),
  });
}

export function compactVenue(venue = {}) {
  return cleanObject({
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    productLine: venue.productLine,
    currency: venue.currency,
    address: venue.address,
    coordinates: compactCoordinates(venue.coordinates ?? venue.location),
    mapUrl: venue.mapUrl,
    link: venue.link,
    imageUrl: venue.imageUrl,
    brandImageUrl: venue.brandImageUrl && venue.brandImageUrl !== venue.imageUrl ? venue.brandImageUrl : undefined,
    estimateRange: venue.estimateRange,
    opening: compactOpening(venue.opening, venue),
    offers: (venue.offers ?? []).map(compactOffer),
    bestDiscount: compactBestDiscount(venue.bestDiscount),
  });
}

export function compactOffer(offer = {}) {
  const value = compactOfferValue(offer.value ?? {
    version: offer.valueVersion,
    score: offer.valueScore ?? offer.score,
    tier: offer.valueTier,
    scope: offer.scope,
    currencyCode: offer.currencyCode,
    minimumSpend: offer.minimumSpend,
    maxSavings: offer.maxSavings,
    effectiveDiscountPercent: offer.effectiveDiscountPercent,
    isDelivery: offer.isDeliveryRelated,
    isPerk: offer.isLowValuePerk,
  });

  return cleanObject({
    sourcePath: offer.sourcePath,
    campaignId: offer.campaignId,
    text: offer.text,
    amount: finiteOrUndefined(offer.amount),
    amountType: offer.amountType,
    amountLabel: offer.amountLabel,
    currencyCode: offer.currencyCode ?? value?.currencyCode,
    value,
    isUtilityBadge: offer.isUtilityBadge === true ? true : undefined,
  });
}

export function compactOfferRecord(record = {}) {
  return cleanObject({
    stableKey: record.stableKey,
    firstNotifiedAt: record.firstNotifiedAt,
    lastSeenAt: record.lastSeenAt,
    venue: compactOfferVenue(record.venue),
    ...compactOffer(record),
  });
}

export function compactChangesDocument(changes = {}) {
  const appeared = changes.appeared ?? [];
  const disappeared = changes.disappeared ?? [];
  const interestingAppeared = changes.interestingAppeared ?? [];
  const interestingDisappeared = changes.interestingDisappeared ?? [];
  const newInteresting = changes.newInteresting ?? [];
  const endedNotified = changes.endedNotified ?? [];
  return cleanObject({
    generatedAt: changes.generatedAt,
    previousGeneratedAt: changes.previousGeneratedAt,
    counts: changes.counts,
    changeSummary: {
      appeared: appeared.length,
      disappeared: disappeared.length,
      interestingAppeared: interestingAppeared.length,
      interestingDisappeared: interestingDisappeared.length,
      newInteresting: newInteresting.length,
      endedNotified: endedNotified.length,
    },
    appeared: appeared.slice(0, 250).map(compactOfferRecord),
    disappeared: disappeared.slice(0, 250).map(compactOfferRecord),
    interestingAppeared: interestingAppeared.slice(0, 100).map(compactOfferRecord),
    interestingDisappeared: interestingDisappeared.slice(0, 100).map(compactOfferRecord),
    newInteresting: newInteresting.slice(0, 100).map(compactOfferRecord),
    endedNotified: endedNotified.slice(0, 100).map(compactOfferRecord),
    notifiedSummary: changes.notifiedSummary,
    fetchError: changes.fetchError,
  });
}

export function compactChangeLog(entries = [], limit = 100) {
  return entries.slice(0, limit).map((entry) => cleanObject({
    generatedAt: entry.generatedAt,
    previousGeneratedAt: entry.previousGeneratedAt,
    appeared: entry.appeared,
    disappeared: entry.disappeared,
    interestingAppeared: entry.interestingAppeared,
    notifiedNew: entry.notifiedNew,
    notifiedEnded: entry.notifiedEnded,
    fetchError: entry.fetchError,
    interesting: (entry.interesting ?? []).slice(0, 25).map(compactOfferRecord),
    ended: (entry.ended ?? []).slice(0, 25).map(compactOfferRecord),
  }));
}

export function compactNotifiedState(state = {}) {
  return cleanObject({
    updatedAt: state.updatedAt,
    activeOffers: (state.activeOffers ?? []).map(compactOfferRecord),
  });
}

export function compactCitiesIndex(index = {}) {
  return cleanObject({
    generatedAt: index.generatedAt,
    defaultCityId: index.defaultCityId,
    cacheTtlMs: index.cacheTtlMs,
    totalCities: index.totalCities ?? index.cities?.length,
    cities: (index.cities ?? []).map(compactCityIndexEntry),
  });
}

export function compactCityIndexEntry(city = {}) {
  const latestPath = city.latestPath ?? city.dataPath;
  return cleanObject({
    id: city.id,
    key: city.key,
    slug: city.slug,
    name: city.name,
    country: city.country,
    countryCode2: city.countryCode2,
    lat: finiteOrUndefined(city.lat),
    lon: finiteOrUndefined(city.lon),
    label: city.label,
    latestPath,
    apiPath: city.apiPath,
    updatedAt: city.updatedAt,
    stale: typeof city.stale === "boolean" ? city.stale : undefined,
    counts: city.counts,
  });
}

export function jsonText(value, { pretty = false } = {}) {
  return `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
}

function compactSnapshotCity(city = {}) {
  return cleanObject({
    id: city.id,
    key: city.key,
    slug: city.slug,
    name: city.name,
    country: city.country,
    countryCode2: city.countryCode2,
    lat: finiteOrUndefined(city.lat),
    lon: finiteOrUndefined(city.lon),
    label: city.label,
  });
}

function compactOfferVenue(venue = {}) {
  return cleanObject({
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    productLine: venue.productLine,
    currency: venue.currency,
    link: venue.link,
    imageUrl: venue.imageUrl,
  });
}

function compactOpening(opening = {}, venue = {}) {
  const isOpen = typeof opening?.isOpen === "boolean"
    ? opening.isOpen
    : typeof venue.isOpen === "boolean"
      ? venue.isOpen
      : undefined;
  const label = opening?.label ?? venue.openingStatus;
  const hours = opening?.hours ?? venue.openingHours;
  if (isOpen === undefined && !label && !hours) {
    return undefined;
  }
  return cleanObject({ isOpen, label, hours });
}

function compactCoordinates(value) {
  if (!value) return undefined;
  const lat = finiteOrUndefined(value.lat ?? value.latitude);
  const lon = finiteOrUndefined(value.lon ?? value.lng ?? value.longitude);
  return lat === undefined || lon === undefined ? undefined : { lat, lon };
}

function compactBestDiscount(best = {}) {
  if (!best || typeof best !== "object") return undefined;
  return cleanObject({
    amount: finiteOrUndefined(best.amount),
    type: best.type,
    label: best.label,
    score: finiteOrUndefined(best.score),
    tier: best.tier,
    scope: best.scope,
    currencyCode: best.currencyCode,
    minimumSpend: finiteOrUndefined(best.minimumSpend),
  });
}

function compactOfferValue(value = {}) {
  if (!value || typeof value !== "object") return undefined;
  return cleanObject({
    version: finiteOrUndefined(value.version),
    score: finiteOrUndefined(value.score),
    tier: value.tier,
    scope: value.scope,
    currencyCode: value.currencyCode,
    minimumSpend: finiteOrUndefined(value.minimumSpend),
    maxSavings: finiteOrUndefined(value.maxSavings),
    effectiveDiscountPercent: finiteOrUndefined(value.effectiveDiscountPercent),
    normalizedCashReference: finiteOrUndefined(value.normalizedCashReference),
    isDelivery: typeof value.isDelivery === "boolean" ? value.isDelivery : undefined,
    isPerk: typeof value.isPerk === "boolean" ? value.isPerk : undefined,
    isSelectedItems: typeof value.isSelectedItems === "boolean" ? value.isSelectedItems : undefined,
    isUpToPercent: typeof value.isUpToPercent === "boolean" ? value.isUpToPercent : undefined,
  });
}

function finiteOrUndefined(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function cleanObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === "") continue;
    if (Array.isArray(item)) {
      result[key] = item;
      continue;
    }
    if (typeof item === "object") {
      const cleaned = cleanObject(item);
      if (Object.keys(cleaned).length) result[key] = cleaned;
      continue;
    }
    result[key] = item;
  }
  return result;
}
