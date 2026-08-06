# Wolt discount monitor

Unofficial Wolt promotions dashboard and scheduled data updater. The project keeps a public catalog of Wolt cities and countries, fetches discount snapshots per city, and serves a static GitHub Pages dashboard from `docs/`.

Telegram notifications are intentionally limited to the default Vilnius monitor. Other cities can be browsed and cached without sending notifications.

> This project is independent and is not affiliated with or endorsed by Wolt.

## Use the dashboard

1. Open the repository's GitHub Pages deployment.
2. Choose a city in the city selector.
3. Search venues by name, offer, address, or slug.
4. Filter by venue type and sort by discount value, name, opening status, or type.
5. Open a venue on Wolt or use the map button to view its location.

The dashboard uses static JSON snapshots committed under `docs/data/`. It does not require or contact a privately operated backend by default.

## What it does

- Fetches the public Wolt city catalog.
- Normalizes city ids as `country/city-slug`, for example `ltu/vilnius`.
- Fetches city promotion and restaurant snapshots from public Wolt web endpoints.
- Caches snapshots in `docs/data/`.
- Renders a static country-grouped city dashboard.
- Scores promotions from `0` to `100`.
- Tracks new and ended campaigns while deduplicating repeated chain locations.

## Wolt endpoints used

```text
GET https://restaurant-api.wolt.com/v1/cities
GET https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=<lon>&lat=<lat>
GET https://consumer-api.wolt.com/v1/pages/restaurants?lat=<lat>&lon=<lon>
```

Consumer API requests use:

```text
Platform: Web
```

## Run locally

Node.js 20 or newer is required. No package installation is needed.

```bash
npm test
npm run cities
npm run check
WOLT_CITY=deu/berlin node src/check-discounts.mjs
WOLT_CITIES=ltu/vilnius,ltu/kaunas,lva/riga node src/check-discounts.mjs
WOLT_ALL_CITIES=true node src/check-discounts.mjs
```

Open `docs/index.html` locally or use the GitHub Pages deployment.

## Data files

```text
docs/data/city-catalog.json
docs/data/cities.json
docs/data/latest.json
docs/data/changes.json
docs/data/changes-log.json
docs/data/notified-offers.json
docs/data/cities/<country-city-slug>/latest.json
docs/data/cities/<country-city-slug>/changes.json
docs/data/cities/<country-city-slug>/changes-log.json
```

## Cache behavior

Each city has its own cache. If its snapshot is newer than `WOLT_CACHE_TTL_HOURS`, the updater reuses it instead of requesting Wolt again. The default is two hours.

Use `FORCE_WRITE=true` to bypass the freshness check.

## Notifications

Telegram notifications are limited to Vilnius by design and use GitHub Actions secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

The same value scorer is used by normalization, diffs, Telegram, and the dashboard. Selected-item promotions, gifts, `2 for 1`, free delivery, and utility badges do not trigger alerts.

## Automation

`.github/workflows/check-discounts.yml` updates snapshots on self-hosted runners and commits changed files under `docs/data/`.

Manual workflow inputs:

- `cities`: comma-separated Wolt city ids;
- `all_cities`: check the full catalog;
- `runner`: select the Windows or Linux runner class.

`.github/workflows/deploy-pages.yml` publishes the static `docs/` directory.

Operational hostnames, provider names, device names, addresses, schedules, filesystem paths, tokens, chat ids, and private deployment details are intentionally not stored in this public repository.

## Research notes

Endpoint observations and promotion-scoring research are kept in `FINDINGS.md`.
