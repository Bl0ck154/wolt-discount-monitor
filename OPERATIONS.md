# Operations guide

This document describes the production configuration without storing personal hostnames, provider names, device names, IP addresses, private filesystem paths, or exact schedules in the public repository.

## Runtime topology (VPS-independent production)

1. GitHub Actions runs `.github/workflows/check-discounts.yml` five times daily, using the GitHub-hosted `ubuntu-latest` runner. No external scheduler or self-hosted runner is required.
2. The check reads Wolt's public endpoints, uses the repository's secret `SCRAPERAPI_API_KEY` as a fallback for blocked GitHub egress, runs tests, updates cached snapshots, and sends relevant Vilnius Telegram alerts.
3. Only when the updater commits changed `docs/` data, the `publish` job calls the reusable GitHub Pages workflow `.github/workflows/deploy-pages.yml`. This avoids the limitation where pushes authenticated by `GITHUB_TOKEN` do not trigger other `push` workflows.
4. GitHub Pages publishes the latest committed data with an explicitly empty `WOLT_API_BASE_URL`. Browsers load snapshots from GitHub Pages, not the previous VPS API.
5. The city picker indexes discovered cities; only cities with published snapshots can show venue data. Production scheduled checks currently refresh **Vilnius (`ltu/vilnius`) and Nuremberg (`deu/nuremberg`)** five times daily. Telegram alerts remain Vilnius-only until explicitly enabled for another city. The optional standalone Node server remains separate and can serve other clients, but it is **not** in the production Pages/Telegram path.

No Wolt-specific cron or Linux/Windows self-hosted runner should be scheduled externally: doing so duplicates scans. The old `scripts/dispatch-check.sh` and `scripts/trigger-wolt-monitor.sh` are legacy and are not used in production.

## GitHub Actions secrets

Configure under **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Required | Purpose |
|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | Yes for production alerts | Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | Yes for production alerts | Target Telegram chat or channel id |

Never commit secret values to Git.

## GitHub Actions variables

Configure under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Recommended value | Purpose |
|---|---:|---|
| `WOLT_API_BASE_URL` | unset (deprecated) | Ignored by VPS-free GitHub Pages deployment |
| `WOLT_API_CACHE_TTL_HOURS` | `1` | Live API per-city refresh floor |
| `WOLT_CACHE_TTL_HOURS` | `1` | Scheduled updater snapshot cache lifetime |
| `WOLT_API_TIMEOUT_MS` | `30000` | Timeout for one Wolt request attempt |
| `WOLT_API_MAX_ATTEMPTS` | `7` | Maximum request attempts |
| `WOLT_API_RETRY_BASE_MS` | `30000` | Base retry delay |
| `WOLT_API_RETRY_JITTER_MS` | `5000` | Maximum random retry jitter |
| `WOLT_PRIMARY_RUNNER_LABEL` | `wolt` | Generic project label used to identify self-hosted project runners |
| `WOLT_FALLBACK_RUNNER_INPUT` | `windows` | Workflow runner value used by the fallback dispatcher |
| `TELEGRAM_ALLOW_SKIP` | leave empty in production | Set to `true` only for intentional non-alert runs |
| `MIN_VALUE_SCORE` | `45` | Minimum general notification score |
| `MIN_GROCERY_PERCENT` | `10` | Grocery percentage threshold |
| `MIN_RESTAURANT_PERCENT` | `15` | Restaurant percentage threshold |
| `MIN_OTHER_PERCENT` | `20` | Other product-line percentage threshold |
| `MIN_CASH_VALUE_RATIO` | `0.20` | Conditioned cash discount threshold |
| `MIN_UNCONDITIONAL_CASH_REFERENCE` | `0.60` | Unconditional cash reference threshold |

A blank or missing numeric variable falls back to the application default. In particular, a blank `WOLT_CACHE_TTL_HOURS` remains one hour instead of becoming zero.

### Public configuration warning

`WOLT_API_BASE_URL` is not a secret. GitHub Pages writes it into the public `config.js` delivered to browsers. A browser cannot call an API without learning its public origin. To avoid exposing a private server address, publish the API through an appropriate public HTTPS endpoint.

## API server environment

Configure these on the API host, not in the public repository:

```text
WOLT_API_HOST=127.0.0.1
WOLT_API_PORT=3000
WOLT_API_CACHE_DIR=<private cache path>
WOLT_API_ALLOWED_ORIGINS=https://bl0ck154.github.io
WOLT_API_RATE_LIMIT_REQUESTS=60
WOLT_API_RATE_LIMIT_WINDOW_MS=60000
WOLT_API_CACHE_TTL_HOURS=1
WOLT_CACHE_TTL_HOURS=1
WOLT_API_TIMEOUT_MS=30000
WOLT_API_MAX_ATTEMPTS=7
WOLT_API_RETRY_BASE_MS=30000
WOLT_API_RETRY_JITTER_MS=5000
WOLT_API_REFRESH_CONCURRENCY=4
WOLT_API_REFRESH_QUEUE_LIMIT=1000
WOLT_API_BETWEEN_ENDPOINTS_MS=1000
```

Bind Node to loopback and publish HTTPS through a reverse proxy. Do not expose the Node port directly.

Transport is configured only on the API/runner host. `WOLT_PROXY_MODE` accepts `direct-first` (default), `proxy-first`, or `proxy-only`. With `WOLT_PROXYSCRAPE_ENABLED=1`, ProxyScrape first downloads HTTPS-capable anonymous/elite candidates, then health-checks them in parallel against `consumer-api.wolt.com` using a deliberately tiny `lat=0&lon=0` response. Only passing IPs enter the request pool. The default target is 20 healthy proxies, minimum usable pool is 8, health TTL is 10 minutes, source refresh is 15 minutes, health-check concurrency is 20, health timeout is 4 seconds, and failed request proxies cool down for 10 minutes. Useful variables are `WOLT_PROXYSCRAPE_TARGET_HEALTHY`, `WOLT_PROXYSCRAPE_MIN_HEALTHY`, `WOLT_PROXYSCRAPE_HEALTH_CONCURRENCY`, `WOLT_PROXYSCRAPE_HEALTH_TIMEOUT_MS`, `WOLT_PROXYSCRAPE_HEALTH_TTL_MS`, `WOLT_PROXYSCRAPE_HEALTH_MAX_CANDIDATES`, `WOLT_PROXYSCRAPE_REFRESH_MS`, `WOLT_PROXYSCRAPE_LIMIT`, `WOLT_PROXYSCRAPE_COUNTRY`, `WOLT_PROXYSCRAPE_MAX_TRIES`, and `WOLT_PROXYSCRAPE_PROXY_TIMEOUT_MS`. Set `WOLT_PROXYSCRAPE_HEALTH_CACHE_FILE` to a writable cache path to preserve the last healthy pool across restarts; the process uses it for fast warm start and schedules a fresh verification. ScraperAPI forwards the original Wolt headers with `keep_headers=true`; optional `SCRAPERAPI_COUNTRY_CODE` selects a country. Keep `WOLT_PROXY_URL` credentials and `SCRAPERAPI_API_KEY` in a root-only environment file or secret store, never in Git.

## Scheduling and manual verification

The only production scheduler is the `schedule` trigger in `check-discounts.yml`. GitHub cron expressions use UTC and might run late; all five runs use GitHub-hosted infrastructure.

You can manually run `Update Wolt discount monitor` under GitHub Actions, choosing a limited set of city IDs. Manual runs also use `ubuntu-latest` and publish changed snapshots. Avoid `all_cities=true` unless intentionally budgeting the large Wolt and ScraperAPI request volume.

The old VPS scheduler should be disabled independently on its host if it still exists. Do not remove shared Node/API services without checking other consumers.

## Verification

1. `Test` workflow passes on the default branch.
2. `Update Wolt discount monitor` scheduled run executes job `cloud` on `ubuntu-latest`; no self-hosted job exists.
3. When data changes, the `publish` reusable workflow completes and reports the latest GitHub Pages URL.
4. View the deployed `/config.js`: it must contain `window.WOLT_API_BASE_URL = "";` and must not point at the old VPS.
5. Verify the site's `/data/latest.json` timestamp advances after a committed Vilnius scan. Telegram alerts continue to come from the GitHub workflow.
6. Cached browser `WOLT_API_BASE_URL` is cleared when Pages provides an empty API configuration; old visitors should not call the former VPS origin.

## Privacy boundary

Keep the following outside Git:

- private server hostnames and IP addresses;
- provider and device names;
- private schedules outside this repository; public GitHub Actions cron times live in the workflow;
- private paths and service names;
- access tokens, chat ids, keys, and credentials.

Self-hosted runner metadata is printed by GitHub before workflow steps run. Use generic machine names, runner names, and service-account names on hosts attached to a public repository so system logs do not reveal personal device or account names.

Public project identifiers, GitHub Pages URLs, generic runner labels, and documented environment-variable names are not secrets.
