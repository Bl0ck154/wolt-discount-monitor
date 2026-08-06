# Wolt Discount Monitor

**[Open the live dashboard](https://bl0ck154.github.io/wolt-discount-monitor/)** · [Source code](https://github.com/Bl0ck154/wolt-discount-monitor)

An unofficial Wolt promotions dashboard and scheduled data updater. It discovers the public Wolt city catalog, fetches city-level venue and promotion data, ranks offers with a currency-independent value score, tracks changes, and publishes a searchable GitHub Pages dashboard.

The catalog currently covers **958 cities across 30 countries**. Telegram notifications are intentionally limited to the default Vilnius monitor; other cities can be browsed, cached, and loaded through the optional live API.

> This is an independent open-source project and is not affiliated with or endorsed by Wolt.

## Use the dashboard

1. Open the **[live website](https://bl0ck154.github.io/wolt-discount-monitor/)**.
2. Use the city field in the top-right corner to search by city, country, country code, or Wolt city id.
3. Search venues by name, offer, address, or slug.
4. Filter by venue type and sort by estimated offer value, name, opening status, or type.
5. Keep the default toggles enabled to hide repeated citywide delivery campaigns and ordinary delivery discounts.
6. Open a venue on Wolt or use the map button to view its location.

A city can also be linked directly:

```text
https://bl0ck154.github.io/wolt-discount-monitor/?city=ltu/kaunas
https://bl0ck154.github.io/wolt-discount-monitor/?city=lva/riga
```

When bundled static data is missing or stale, the dashboard can fall back to the live API. Use `?api=off` to disable that fallback in the current browser.

## What it does

- Fetches the full public Wolt city catalog from:

  ```text
  https://restaurant-api.wolt.com/v1/cities
  ```

- Normalizes city ids as `country/city-slug`, for example:
  - `ltu/vilnius`
  - `deu/berlin`
  - `jpn/tokyo`

- Fetches city discount snapshots through public Wolt web endpoints using city coordinates.
- Caches snapshots in `docs/data/` and skips Wolt API calls while city data is fresh.
- Renders a static dashboard with country-grouped city selection.
- Scores promotions from `0` to `100` using the same rules for the dashboard and Telegram notifications.
- Tracks new and ended campaigns while deduplicating repeated chain locations.

## Wolt endpoints used

City catalog:

```text
GET https://restaurant-api.wolt.com/v1/cities
```

Promotion venues for any city coordinate:

```text
GET https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=<lon>&lat=<lat>
```

Restaurant seed for any city coordinate:

```text
GET https://consumer-api.wolt.com/v1/pages/restaurants?lat=<lat>&lon=<lon>
```

Required header for the consumer API endpoints:

```text
Platform: Web
```

Useful offer paths in the Wolt response:

```text
sections[*].items[*].venue.promotions[*]
sections[*].items[*].venue.badges_v2[*]
sections[*].items[*].venue.promotions_for_telemetry[*]
```

## Run locally

Requirements: Node.js 20 or newer. No package install is required because the scripts use Node's built-in `fetch` and test runner.

```bash
# Run the test suite
npm test

# Refresh the full Wolt city/country catalog
npm run cities

# Update the default city (Vilnius)
npm run check

# Update one city
WOLT_CITY=deu/berlin node src/check-discounts.mjs

# Update several cities
WOLT_CITIES=ltu/vilnius,ltu/kaunas,lva/riga node src/check-discounts.mjs

# Update every Wolt city from the catalog (large run)
WOLT_ALL_CITIES=true node src/check-discounts.mjs

# Override cache TTL in hours; default is 2
WOLT_CACHE_TTL_HOURS=4 node src/check-discounts.mjs
```

PowerShell example:

```powershell
$env:WOLT_CITY="deu/berlin"; node src/check-discounts.mjs; Remove-Item Env:\WOLT_CITY
```

Open `docs/index.html` locally or use the hosted GitHub Pages dashboard.

## Data files

The updater writes static JSON files consumed by the dashboard:

```text
docs/data/city-catalog.json
docs/data/cities.json
docs/data/latest.json                         # default Vilnius snapshot
docs/data/changes.json                        # default Vilnius diff
docs/data/changes-log.json                    # default Vilnius change log
docs/data/notified-offers.json                # Vilnius notification state
docs/data/cities/<country-city-slug>/latest.json
docs/data/cities/<country-city-slug>/changes.json
docs/data/cities/<country-city-slug>/changes-log.json
```

`docs/data/cities.json` contains the full dashboard city list plus cache status for cities that have already been fetched.

## Cache and request behavior

Each city has its own cache. If `latest.json` for a city is newer than `WOLT_CACHE_TTL_HOURS` (default `2`), the updater reuses it and does not call Wolt for that city.

Use `FORCE_WRITE=true` to bypass the freshness check.

Wolt requests use a default 30-second timeout and retry transient network failures, HTTP `429`, and server-side `5xx` responses. Relevant optional variables:

```text
WOLT_API_TIMEOUT_MS=30000
WOLT_API_MAX_ATTEMPTS=7
WOLT_API_RETRY_BASE_MS=30000
WOLT_API_RETRY_JITTER_MS=5000
```

## Optional live API backend

GitHub Pages is static, so the dashboard cannot write new JSON snapshots by itself. For on-demand city loading, run the optional Node API on your own VPS. The public dashboard can then fall back to that API when a city has no fresh static JSON cache.

Start locally:

```bash
npm run server
```

Default API bind is intentionally local-only:

```text
WOLT_API_HOST=127.0.0.1
WOLT_API_PORT=3000
```

Useful API endpoints:

```text
GET /health
GET /api/cities
GET /api/cities/ltu/vilnius/latest
GET /api/cities/deu/berlin/latest
```

The API uses a separate disk cache by default:

```text
.cache/wolt-api/cities/<country-city-slug>/latest.json
```

Important environment variables:

```text
WOLT_API_HOST=127.0.0.1
WOLT_API_PORT=3000
WOLT_API_CACHE_DIR=.cache/wolt-api
WOLT_API_ALLOWED_ORIGINS=https://bl0ck154.github.io
WOLT_API_RATE_LIMIT_REQUESTS=60
WOLT_API_RATE_LIMIT_WINDOW_MS=60000
WOLT_CACHE_TTL_HOURS=2
```

Recommended production shape:

```text
GitHub Pages dashboard
  -> https://your-api-subdomain.example.com
  -> nginx/Cloudflare
  -> 127.0.0.1:3000 Node API
  -> Wolt API + disk cache
```

Do not expose the Node port directly. Bind it to `127.0.0.1` and publish only HTTPS through nginx or another reverse proxy. The public dashboard uses the production API by default:

```text
https://wolt-api.zivkr.pp.ua
```

You can override it at runtime:

```text
https://bl0ck154.github.io/wolt-discount-monitor/?api=https://your-api-subdomain.example.com
```

Opening the dashboard with `?api=...` stores the override in that browser's local storage. Use `?api=off` to disable live API fallback for that browser. Alternatively, inject this before `app.js` from hosting-specific HTML/config:

```html
<script>
  window.WOLT_API_BASE_URL = "https://your-api-subdomain.example.com";
</script>
```

## Notifications

Telegram notifications remain limited to Vilnius by design:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

When a qualifying notification is pending, missing Telegram credentials now fail the updater instead of silently committing a snapshot and losing the alert. Local or intentionally notification-free runs can opt out explicitly:

```text
TELEGRAM_ALLOW_SKIP=true
```

Offers are ranked by a currency-independent value score from `0` to `100`. The same scorer is used for every city and for dashboard ordering. Telegram uses it only for Vilnius.

Default notification variables:

```text
MIN_VALUE_SCORE=45
MIN_GROCERY_PERCENT=10
MIN_RESTAURANT_PERCENT=15
MIN_OTHER_PERCENT=20
MIN_CASH_VALUE_RATIO=0.20
MIN_UNCONDITIONAL_CASH_REFERENCE=0.60
```

Fixed discounts with a minimum spend are compared as `discount / minimum spend`, so the calculation works without converting PLN, CZK, HUF, GEL, AZN, DKK, SEK, ILS, or other currencies. Unconditional fixed discounts use a per-currency Wolt campaign reference. Broad grocery discounts receive extra value; selected-item campaigns, gifts, `2 for 1`, and free delivery do not trigger notifications.

Percentage wording is classified conservatively: a promotion is broad only when it clearly applies to the basket/order/menu or is a plain form such as `20% off`. Product/category wording such as `20% for buns`, `-20% Wok`, or `wide selection` is treated as selected-item scope and never triggers Telegram.

Currency amounts count as cash discounts only when the wording explicitly uses `off`, `discount`, `save`, or `get`; an ordinary menu price is not a discount.

A Telegram message starts with grouped added/ended counts, then lists new and ended qualifying offers in descending value order. Multiple locations of the same chain/campaign count as one offer.

Non-Vilnius cities are cached, ranked, and displayed but skipped by Telegram. See `FINDINGS.md` for the observed international promotion patterns and the full scoring model.

## GitHub Actions

Workflow: `.github/workflows/check-discounts.yml`

- Tests run before every updater execution.
- Exact scheduled runs are triggered by external Netcup cron through `scripts/dispatch-check.sh`; GitHub's built-in schedule is intentionally unused.
- The residential Windows runner is primary. The Netcup Linux runner is selected only when Windows is offline and a Netcup Wolt preflight returns HTTP 200.
- Manual runs accept:
  - `cities`: comma-separated city ids, e.g. `deu/berlin,jpn/tokyo`
  - `all_cities`: large run over the full catalog
  - `runner`: `windows` (default) or `netcup`
- The job uses self-hosted runners because Wolt currently returns `429 Too Many Requests` from GitHub-hosted runner IP ranges.

```yaml
runs-on:
  - self-hosted
  - X64
  - wolt
  - Windows # or Linux when runner=netcup
```

A separate `.github/workflows/test.yml` runs the test suite on ordinary pushes and pull requests without calling Wolt.

See `OPERATIONS.md` for production topology, fallback behavior, recovery, and incident diagnostics.

Useful commands:

```bash
gh workflow run "Update Wolt discount monitor" --repo Bl0ck154/wolt-discount-monitor --ref main -f cities=deu/berlin
gh run list --repo Bl0ck154/wolt-discount-monitor --workflow "Update Wolt discount monitor" --limit 5
```

Production cron uses `Europe/Vilnius` and invokes the runner-aware dispatcher:

```cron
CRON_TZ=Europe/Vilnius
15 10 * * 1 /opt/wolt-discount-monitor/scripts/dispatch-check.sh ltu/vilnius >> /var/log/wolt-monitor-cron.log 2>&1
# The remaining production entries use the same command at the documented times.
```

The complete production schedule is maintained in `OPERATIONS.md`.

The production dispatcher uses the authenticated `gh` CLI on Netcup and accepts an optional city argument, defaulting to `ltu/vilnius`.

GitHub Pages is deployed by `.github/workflows/deploy-pages.yml` from the `docs/` folder after pushes that change the published site or generated dashboard data.

## Research notes

Historical endpoint research is kept in `FINDINGS.md`. It started with Vilnius as the first tested city, but the implementation now applies the same endpoint patterns to any Wolt city from the catalog.

## Author and related links

- [Illia Zabolotskyi — portfolio](https://zabolotskyi.com/)
- [GitHub profile](https://github.com/Bl0ck154)
- [Live Wolt Discount Monitor](https://bl0ck154.github.io/wolt-discount-monitor/)
