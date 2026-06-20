import { CITY, WOLT_HEADERS } from "./config.mjs";

export function endpoints({ lat = CITY.lat, lon = CITY.lon } = {}) {
  return {
    restaurants: `https://consumer-api.wolt.com/v1/pages/restaurants?lat=${lat}&lon=${lon}`,
    promotions: `https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=${lon}&lat=${lat}`,
  };
}

export async function fetchJson(url) {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, { headers: WOLT_HEADERS });
    const text = await response.text();

    if (response.ok) {
      return JSON.parse(text);
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Math.max(
        Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
        15000 * attempt,
      );
      await sleep(delayMs);
      continue;
    }

    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
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
  const restaurantsPayload = await fetchJson(urls.restaurants);
  await sleep(2500);
  const promotionsPayload = await fetchJson(urls.promotions);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
