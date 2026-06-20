export const CITY = {
  name: "Vilnius",
  country: "Lithuania",
  lat: 54.6901231,
  lon: 25.2682558,
};

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
};

export const NOTIFY_RULES = {
  minDiscountEur: Number(process.env.MIN_DISCOUNT_EUR ?? 2),
  includeZeroDelivery: process.env.INCLUDE_ZERO_DELIVERY === "true",
};
