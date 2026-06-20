import { CITY, WOLT_HEADERS } from "./config.mjs";

export function endpoints({ lat = CITY.lat, lon = CITY.lon } = {}) {
  return {
    restaurants: `https://consumer-api.wolt.com/v1/pages/restaurants?lat=${lat}&lon=${lon}`,
    promotions: `https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=${lon}&lat=${lat}`,
  };
}

export async function fetchJson(url) {
  const response = await fetch(url, { headers: WOLT_HEADERS });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text);
}

export function collectVenueItems(payload) {
  const rows = [];

  for (const [sectionIndex, section] of (payload.sections ?? []).entries()) {
    for (const [itemIndex, item] of (section.items ?? []).entries()) {
      if (item?.venue?.slug || item?.venue?.id) {
        rows.push({
          sectionIndex,
          itemIndex,
          sectionName: section.name,
          sectionTemplate: section.template,
          item,
          venue: item.venue,
        });
      }
    }
  }

  return rows;
}

export function uniqueByVenue(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const key = row.venue.slug || row.venue.id;
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()];
}

export async function fetchVilniusData() {
  const urls = endpoints();
  const [restaurantsPayload, promotionsPayload] = await Promise.all([
    fetchJson(urls.restaurants),
    fetchJson(urls.promotions),
  ]);

  const restaurantRows = uniqueByVenue(collectVenueItems(restaurantsPayload));
  const promoRows = uniqueByVenue(collectVenueItems(promotionsPayload));

  return {
    urls,
    restaurantsPayload,
    promotionsPayload,
    restaurantRows,
    promoRows,
  };
}
