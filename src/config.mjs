export const DEFAULT_CITY_ID = "ltu/vilnius";
export const LEGACY_DEFAULT_CITY_ID = "vilnius";

export const CACHE_TTL_HOURS = Number(process.env.WOLT_CACHE_TTL_HOURS ?? 2);
export const CACHE_TTL_MS = Math.max(0, CACHE_TTL_HOURS) * 60 * 60 * 1000;

export const DEFAULT_CITY = {
  id: DEFAULT_CITY_ID,
  key: "ltu-vilnius",
  woltCityId: "59c4c2bd914ab56c99ad59bf",
  slug: "vilnius",
  name: "Vilnius",
  country: "Lithuania",
  countryCode: "ltu",
  countryCode2: "LT",
  countryCode3: "LTU",
  lat: 54.6901231,
  lon: 25.2682558,
  locale: "en",
  timezone: "Europe/Vilnius",
  notificationsEnabled: true,
};

export const CITY = DEFAULT_CITY;

export function cityLabel(city) {
  return [city.name, city.country].filter(Boolean).join(", ");
}

export function cityKey(city) {
  if (city.key) {
    return city.key;
  }
  const country = String(city.countryCode ?? city.countryCode3 ?? "").toLowerCase();
  return [country, city.slug ?? city.id].filter(Boolean).join("-").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

export function isDefaultCity(cityOrId) {
  const id = typeof cityOrId === "string" ? cityOrId : cityOrId?.id;
  const key = typeof cityOrId === "string" ? cityOrId : cityOrId?.key;
  return id === DEFAULT_CITY_ID || id === LEGACY_DEFAULT_CITY_ID || key === DEFAULT_CITY.key;
}

export const WOLT_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Client-Version": "1.16.114-PR22480",
  ClientVersionNumber: "1.16.114-PR22480",
  Platform: "Web",
  Referer: "https://wolt.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  "x-wolt-web-clientid": "104509f3-c07b-459a-b73c-67c8f54d1d22",
};

export const PATHS = {
  latest: "docs/data/latest.json",
  changes: "docs/data/changes.json",
  log: "docs/data/changes-log.json",
  notified: "docs/data/notified-offers.json",
  cities: "docs/data/cities.json",
  cityCatalog: "docs/data/city-catalog.json",
  cityDataDir: "docs/data/cities",
};

export function cityDataPaths(city) {
  const key = cityKey(city);
  return {
    latest: isDefaultCity(city) ? PATHS.latest : `${PATHS.cityDataDir}/${key}/latest.json`,
    changes: isDefaultCity(city) ? PATHS.changes : `${PATHS.cityDataDir}/${key}/changes.json`,
    log: isDefaultCity(city) ? PATHS.log : `${PATHS.cityDataDir}/${key}/changes-log.json`,
    notified: isDefaultCity(city) ? PATHS.notified : `${PATHS.cityDataDir}/${key}/notified-offers.json`,
  };
}

export const NOTIFY_RULES = {
  minDiscountEur: Number(process.env.MIN_DISCOUNT_EUR ?? 3),
  minDiscountPercent: Number(process.env.MIN_DISCOUNT_PERCENT ?? 20),
  includeZeroDelivery: process.env.INCLUDE_ZERO_DELIVERY === "true",
};
