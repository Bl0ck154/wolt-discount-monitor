type Args = {
  lat: number;
  lon: number;
  slug: string;
  dynamic: boolean;
  limit: number;
};

type EndpointArgs = Args;

type Venue = {
  id?: string;
  name?: string;
  slug?: string;
  promotions?: Array<Record<string, unknown> & { text?: string }>;
  promotions_for_telemetry?: Array<Record<string, unknown> & { text?: string }>;
  badges_v2?: Array<Record<string, unknown> & { text?: string }>;
};

type VenueItem = {
  item: Record<string, unknown>;
  venue: Venue & { slug: string };
  sectionName?: string;
  sectionTemplate?: string;
};

const DEFAULT_LAT = 54.6901231;
const DEFAULT_LON = 25.2682558;
const DEFAULT_SLUG = "lukiskiu-kalejimas-20";

const endpoints = {
  restaurants: ({ lat, lon }: EndpointArgs) =>
    `https://consumer-api.wolt.com/v1/pages/restaurants?lat=${lat}&lon=${lon}`,
  promotions: ({ lat, lon }: EndpointArgs) =>
    `https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=${lon}&lat=${lat}`,
  dynamic: ({ lat, lon, slug }: EndpointArgs) =>
    `https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/${encodeURIComponent(
      slug,
    )}/dynamic/?lat=${lat}&lon=${lon}&selected_delivery_method=homedelivery`,
};

const headers = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Platform: "Web",
  Referer: "https://wolt.com/",
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    lat: DEFAULT_LAT,
    lon: DEFAULT_LON,
    slug: DEFAULT_SLUG,
    dynamic: false,
    limit: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--lat" && next) {
      args.lat = Number(next);
      i += 1;
    } else if (arg === "--lon" && next) {
      args.lon = Number(next);
      i += 1;
    } else if (arg === "--slug" && next) {
      args.slug = next;
      i += 1;
    } else if (arg === "--limit" && next) {
      args.limit = Number(next);
      i += 1;
    } else if (arg === "--dynamic") {
      args.dynamic = true;
    }
  }

  return args;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}

function collectVenueItems(payload: Record<string, unknown>): VenueItem[] {
  const items: VenueItem[] = [];
  const sections = Array.isArray(payload.sections) ? payload.sections : [];

  for (const sectionValue of sections) {
    const section = sectionValue as Record<string, unknown>;
    const sectionItems = Array.isArray(section.items) ? section.items : [];

    for (const itemValue of sectionItems) {
      const item = itemValue as Record<string, unknown>;
      const venue = item.venue as Venue | undefined;

      if (venue?.slug) {
        items.push({
          item,
          venue: venue as Venue & { slug: string },
          sectionName: section.name as string | undefined,
          sectionTemplate: section.template as string | undefined,
        });
      }
    }
  }

  return items;
}

function uniqueVenueItems(items: VenueItem[]): VenueItem[] {
  const bySlug = new Map<string, VenueItem>();

  for (const item of items) {
    if (!bySlug.has(item.venue.slug)) {
      bySlug.set(item.venue.slug, item);
    }
  }

  return [...bySlug.values()];
}

function extractOfferRecords(venue: Venue) {
  const records = [];

  for (const promotion of venue.promotions ?? []) {
    records.push({
      sourcePath: "venue.promotions",
      text: promotion.text,
      amount: extractAmount(promotion.text),
      raw: promotion,
    });
  }

  for (const badge of venue.badges_v2 ?? []) {
    if (badge.text) {
      records.push({
        sourcePath: "venue.badges_v2",
        text: badge.text,
        amount: extractAmount(badge.text),
        raw: badge,
      });
    }
  }

  for (const promotion of venue.promotions_for_telemetry ?? []) {
    records.push({
      sourcePath: "venue.promotions_for_telemetry",
      text: promotion.text,
      amount: extractAmount(promotion.text),
      raw: promotion,
    });
  }

  return records;
}

function extractAmount(text = ""): number | null {
  const normalized = text.replace(/\u202f|\u00a0/g, " ");
  const match = normalized.match(/(?:EUR|euro|eur|€)?\s*(\d+(?:[.,]\d+)?)\s*(?:EUR|euro|eur|€)?/i);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function summarizeVenue(item: VenueItem, sourceEndpoint: string) {
  const offers = extractOfferRecords(item.venue);

  return {
    name: item.venue.name,
    slug: item.venue.slug,
    id: item.venue.id,
    sourceEndpoint,
    section: {
      name: item.sectionName,
      template: item.sectionTemplate,
    },
    offerText: offers.map((offer) => offer.text).filter(Boolean),
    discountAmount: offers.map((offer) => offer.amount).find((amount) => amount !== null) ?? null,
    rawPromotionObject:
      offers.find((offer) => offer.sourcePath === "venue.promotions")?.raw ?? null,
    rawBadgesV2: item.venue.badges_v2 ?? [],
    rawPromotionsForTelemetry: item.venue.promotions_for_telemetry ?? [],
  };
}

async function fetchDynamicOffer(args: Args) {
  const url = endpoints.dynamic(args);
  const payload = await fetchJson(url);
  const venue = payload.venue as Record<string, unknown> | undefined;
  const banners = Array.isArray(venue?.banners) ? venue.banners : [];

  return {
    sourceEndpoint: url,
    banners: banners.map((bannerValue) => {
      const banner = bannerValue as Record<string, unknown>;
      const discount = banner.discount as Record<string, unknown> | undefined;

      return {
        type: banner.type,
        discountId: discount?.discount_id ?? null,
        text: discount?.formatted_text ?? null,
        raw: banner,
      };
    }),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const restaurantsUrl = endpoints.restaurants(args);
  const promotionsUrl = endpoints.promotions(args);

  const [restaurantsPayload, promotionsPayload] = await Promise.all([
    fetchJson(restaurantsUrl),
    fetchJson(promotionsUrl),
  ]);

  const restaurantItems = uniqueVenueItems(collectVenueItems(restaurantsPayload));
  const promoItems = uniqueVenueItems(collectVenueItems(promotionsPayload));
  const promoBySlug = new Map(promoItems.map((item) => [item.venue.slug, item]));
  const targetPromo = promoBySlug.get(args.slug);
  const targetRestaurant = restaurantItems.find((item) => item.venue.slug === args.slug);

  const result: Record<string, unknown> = {
    request: {
      lat: args.lat,
      lon: args.lon,
      slug: args.slug,
      requiredHeaders: {
        Platform: headers.Platform,
      },
    },
    endpoints: {
      restaurants: restaurantsUrl,
      promotions: promotionsUrl,
    },
    counts: {
      restaurantsUniqueVenues: restaurantItems.length,
      promotionsUniqueVenues: promoItems.length,
    },
    target: {
      fromPromotionsEndpoint: targetPromo
        ? summarizeVenue(targetPromo, promotionsUrl)
        : null,
      fromRestaurantsEndpoint: targetRestaurant
        ? summarizeVenue(targetRestaurant, restaurantsUrl)
        : null,
    },
    samplePromotions: promoItems.slice(0, args.limit).map((item) =>
      summarizeVenue(item, promotionsUrl),
    ),
  };

  if (args.dynamic) {
    (result.target as Record<string, unknown>).dynamicEndpoint = await fetchDynamicOffer(args);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
