export const CITY = {
  name: "Vilnius",
  country: "Lithuania",
  lat: 54.6901231,
  lon: 25.2682558,
};

export const WOLT_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Platform: "Web",
  Referer: "https://wolt.com/",
};

export const PATHS = {
  latest: "docs/data/latest.json",
  changes: "docs/data/changes.json",
  log: "docs/data/changes-log.json",
};

export const NOTIFY_RULES = {
  minDiscountEur: Number(process.env.MIN_DISCOUNT_EUR ?? 2),
  includeZeroDelivery: process.env.INCLUDE_ZERO_DELIVERY === "true",
};
