import { WOLT_HEADERS, cityKey, cityLabel, isDefaultCity } from "./config.mjs";

const CITIES_URL = "https://restaurant-api.wolt.com/v1/cities";
const COUNTRY_LIST_URL = "https://wolt.com/v1/country_list?languageCode=en";

const FALLBACK_COUNTRY_NAMES = {
  AL: "Albania",
  AT: "Austria",
  AZ: "Azerbaijan",
  BG: "Bulgaria",
  CY: "Cyprus",
  CZ: "Czechia",
  DE: "Germany",
  DK: "Denmark",
  EE: "Estonia",
  FI: "Finland",
  GE: "Georgia",
  GR: "Greece",
  HR: "Croatia",
  HU: "Hungary",
  IS: "Iceland",
  IL: "Israel",
  JP: "Japan",
  KZ: "Kazakhstan",
  LT: "Lithuania",
  LU: "Luxembourg",
  LV: "Latvia",
  MT: "Malta",
  MK: "North Macedonia",
  NO: "Norway",
  PL: "Poland",
  RO: "Romania",
  RS: "Serbia",
  SE: "Sweden",
  SI: "Slovenia",
  SK: "Slovakia",
  UZ: "Uzbekistan",
  XK: "Kosovo",
};

export async function fetchWoltCityCatalog() {
  const [citiesPayload, countryPayload] = await Promise.all([
    fetchJson(CITIES_URL, { "App-Language": "en" }),
    fetchJson(COUNTRY_LIST_URL, { "Accept-Language": "en-US,en;q=0.9" }).catch(() => []),
  ]);

  const countryNames = countryNameIndex(countryPayload);
  const cities = (citiesPayload.results ?? [])
    .map((raw) => normalizeCity(raw, countryNames))
    .filter(Boolean)
    .filter((city) => city.hasFrontpage !== false && city.hidden !== true)
    .sort((a, b) => a.country.localeCompare(b.country, "en") || a.name.localeCompare(b.name, "en"));

  const countries = [...groupCountries(cities).values()].sort((a, b) => a.name.localeCompare(b.name, "en"));

  return {
    generatedAt: new Date().toISOString(),
    source: {
      citiesEndpoint: CITIES_URL,
      countryListEndpoint: COUNTRY_LIST_URL,
    },
    totalCities: cities.length,
    totalCountries: countries.length,
    countries,
    cities,
  };
}

function normalizeCity(raw, countryNames) {
  const countryCode2 = String(raw.country_code_alpha2 ?? "").toUpperCase();
  const countryCode3 = String(raw.country_code_alpha3 ?? "").toUpperCase();
  const countryCode = countryCode3.toLowerCase();
  const slug = raw.slug;
  const [lon, lat] = raw.location?.coordinates ?? [];

  if (!countryCode || !slug || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    return null;
  }

  const city = {
    id: `${countryCode}/${slug}`,
    key: `${countryCode}-${slug}`,
    woltCityId: raw.id,
    slug,
    name: raw.name,
    country: countryNames.get(countryCode2)?.name ?? fallbackCountryName(countryCode2),
    countryEmoji: countryNames.get(countryCode2)?.emoji ?? null,
    countryCode,
    countryCode2,
    countryCode3,
    lat: Number(lat),
    lon: Number(lon),
    locale: "en",
    timezone: raw.timezone ?? null,
    hasFrontpage: raw.has_frontpage !== false,
    hidden: raw.hidden === true,
    notificationsEnabled: countryCode === "ltu" && slug === "vilnius",
  };

  return {
    ...city,
    label: cityLabel(city),
    url: `https://wolt.com/en/${city.countryCode}/${city.slug}`,
    dataPath: isDefaultCity(city) ? "data/latest.json" : `data/cities/${cityKey(city)}/latest.json`,
    latestPath: isDefaultCity(city) ? "data/latest.json" : `data/cities/${cityKey(city)}/latest.json`,
  };
}

function countryNameIndex(payload) {
  const items = Array.isArray(payload) ? payload : payload?.countries ?? payload?.results ?? [];
  return new Map(items
    .filter((country) => country.alpha2)
    .map((country) => [String(country.alpha2).toUpperCase(), country]));
}

function groupCountries(cities) {
  const countries = new Map();
  for (const city of cities) {
    const key = city.countryCode3;
    if (!countries.has(key)) {
      countries.set(key, {
        code: city.countryCode,
        code2: city.countryCode2,
        code3: city.countryCode3,
        name: city.country,
        emoji: city.countryEmoji,
        cityCount: 0,
      });
    }
    countries.get(key).cityCount += 1;
  }
  return countries;
}

function fallbackCountryName(countryCode2) {
  if (FALLBACK_COUNTRY_NAMES[countryCode2]) {
    return FALLBACK_COUNTRY_NAMES[countryCode2];
  }

  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode2) ?? countryCode2;
  } catch {
    return countryCode2;
  }
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      ...WOLT_HEADERS,
      Accept: "application/json, text/plain, */*",
      ...headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}
