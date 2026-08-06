# Wolt Discount Monitor

**[Open the live dashboard](https://bl0ck154.github.io/wolt-discount-monitor/)**

An unofficial Wolt promotions dashboard and scheduled data updater. It discovers the public Wolt city catalog, fetches city-level venue and promotion data, ranks offers with a currency-independent value score, tracks changes, and publishes a searchable GitHub Pages dashboard.

The current catalog contains **958 cities across 30 countries**. Telegram notifications are intentionally limited to the default Vilnius monitor; other cities can be browsed and cached without sending alerts.

> This is an independent open-source project and is not affiliated with or endorsed by Wolt.

## Use the dashboard

1. Open the live dashboard.
2. Use the city field to search by city, country, country code, or Wolt city id.
3. Search venues by name, offer, address, or slug.
4. Filter by venue type and sort by estimated offer value, name, opening status, or type.
5. Keep the default toggles enabled to hide repeated citywide delivery campaigns and ordinary delivery discounts.
6. Open a venue on Wolt or use the map button to view its location.

Cities can be linked directly:

```text
https://bl0ck154.github.io/wolt-discount-monitor/?city=ltu/kaunas
https://bl0ck154.github.io/wolt-discount-monitor/?city=lva/riga
```

## What it does

- Fetches the public Wolt city catalog.
- Normalizes city ids as `country/city-slug`, for example `ltu/vilnius`.
- Fetches city promotion and restaurant snapshots from public Wolt web endpoints.
- Caches snapshots in `docs/data/` and avoids refreshing fresh city data.
- Scores promotions from `0` to `100` using the same model for the dashboard and Telegram.
- Tracks new and ended campaigns while deduplicating repeated chain locations.
- Publishes a static country-grouped dashboard through GitHub Pages.
- Optionally uses a live API for cities without a fresh bundled snapshot.

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

Requirements: Node.js 20 or newer. No package installation is required because the project uses Node's built-in `fetch` and test runner.

```bash
npm test
npm run cities
npm run check
WOLT_CITY=deu/berlin node src/check-discounts.mjs
WOLT_CITIES=ltu/vilnius,ltu/kaunas,lva/riga node src/check-discounts.mjs
WOLT_ALL_CITIES=true node src/check-discounts.mjs
```

Open `docs/index.html` locally. The committed `docs/config.js` contains an empty API value, so local and static use do not contact a private backend by default.

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

## Cache and request reliability

Each city has its own cache. If its snapshot is newer than `WOLT_CACHE_TTL_HOURS`, the updater reuses it instead of calling Wolt again. The default is two hours.

Blank numeric GitHub Variables use their application defaults. A blank `WOLT_CACHE_TTL_HOURS` therefore remains two hours instead of becoming zero.

Wolt requests use timeouts and retry transient network failures, HTTP `429`, invalid temporary responses, and server-side `5xx` errors. Permanent client errors such as `404` are not retried.

Recommended variables:

```text
WOLT_CACHE_TTL_HOURS=2
WOLT_API_TIMEOUT_MS=30000
WOLT_API_MAX_ATTEMPTS=7
WOLT_API_RETRY_BASE_MS=30000
WOLT_API_RETRY_JITTER_MS=5000
```

Use `FORCE_WRITE=true` to bypass snapshot freshness locally.

## Optional live API

GitHub Pages is static. The optional Node API can fetch and cache cities that do not yet have a fresh bundled snapshot.

```bash
npm run server
```

Useful endpoints:

```text
GET /health
GET /api/cities
GET /api/cities/ltu/vilnius/latest
GET /api/cities/deu/berlin/latest
```

The API binds to loopback by default:

```text
WOLT_API_HOST=127.0.0.1
WOLT_API_PORT=3000
```

Do not commit a private server hostname or IP. Configure the public HTTPS API origin as the GitHub Actions repository variable `WOLT_API_BASE_URL`. The Pages workflow writes that value into the deployed `config.js` without storing it in the Git tree.

The API origin is still visible to every browser using the dashboard. Put the API behind a reverse proxy or CDN when the server IP must remain hidden.

The dashboard also accepts a temporary browser override:

```text
?api=https://your-public-api.example.com
?api=off
```

## Telegram notifications

Production alerts use GitHub Actions secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

If a qualifying notification is pending but credentials are missing, the updater fails before committing the new snapshot. This prevents a new offer from being silently marked as already processed.

Intentional local or notification-free runs can explicitly opt out:

```text
TELEGRAM_ALLOW_SKIP=true
```

Do not set `TELEGRAM_ALLOW_SKIP=true` for the production alert workflow.

## GitHub Actions

- `.github/workflows/test.yml` runs `npm test` on relevant pushes and pull requests.
- `.github/workflows/check-discounts.yml` runs tests before every update, has a 30-minute job timeout, refreshes data on self-hosted runners, sends alerts, and commits changed dashboard data.
- `.github/workflows/deploy-pages.yml` deploys only from relevant pushes or manual runs and injects `WOLT_API_BASE_URL` at artifact-build time.
- `scripts/dispatch-check.sh` selects the primary runner and a generic Linux fallback without storing provider or device names in Git.

The runner input remains backward-compatible: `windows` selects Windows; any other non-empty value selects Linux. This allows an older external scheduler value to continue working while new configurations use `linux`.

See [`OPERATIONS.md`](OPERATIONS.md) for the complete privacy-safe list of GitHub Secrets, Variables, API environment settings, scheduler requirements, and verification steps.

## Privacy

The public repository intentionally excludes personal portfolio links, author profile links, private hostnames, server IPs, provider names, device names, exact schedules, private filesystem paths, tokens, chat ids, and credentials.

## Research notes

Endpoint observations and promotion-scoring research are kept in `FINDINGS.md`.
