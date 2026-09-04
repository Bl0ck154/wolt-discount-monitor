# Operations guide

This document describes the production configuration without storing personal hostnames, provider names, device names, IP addresses, private filesystem paths, or exact schedules in the public repository.

## Runtime topology

1. An external scheduler runs `scripts/dispatch-check.sh` at the desired times.
2. The dispatcher checks whether the primary Linux VPS self-hosted runner is online and whether Wolt is reachable directly from the VPS.
3. If the Linux runner or direct Wolt preflight is unavailable, the dispatcher selects the Windows self-hosted runner as the residential fallback when it is online.
4. `.github/workflows/check-discounts.yml` runs tests, refreshes Wolt data, sends Telegram notifications when needed, and commits changed files under `docs/data/`.
5. `.github/workflows/deploy-pages.yml` generates `docs/config.js` from a repository variable and deploys `docs/` to GitHub Pages.

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
| `WOLT_API_BASE_URL` | Public HTTPS API origin | Injected into the deployed dashboard at Pages build time |
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

Optional transport fallbacks are configured only on the API/runner host. Direct VPS requests remain primary. After direct `403`, `429`, timeout, or network failure the order is: `WOLT_PROXY_URL` (if set), ProxyScrape (if `WOLT_PROXYSCRAPE_ENABLED=1`), then ScraperAPI (if `SCRAPERAPI_API_KEY` is set). ProxyScrape uses HTTPS-capable anonymous/elite HTTP proxies from its free API, refreshes the pool every 15 minutes by default, tries up to 8 candidates, and cools failed IPs for 10 minutes. Useful tuning variables are `WOLT_PROXYSCRAPE_MAX_TRIES`, `WOLT_PROXYSCRAPE_PROXY_TIMEOUT_MS`, `WOLT_PROXYSCRAPE_REFRESH_MS`, `WOLT_PROXYSCRAPE_LIMIT`, and `WOLT_PROXYSCRAPE_COUNTRY`. ScraperAPI forwards the original Wolt headers with `keep_headers=true`; optional `SCRAPERAPI_COUNTRY_CODE` selects a country. Keep `WOLT_PROXY_URL` credentials and `SCRAPERAPI_API_KEY` in a root-only environment file or secret store, never in Git.

## External scheduler

The scheduler host needs:

- an authenticated `gh` CLI with permission to dispatch workflows;
- a checkout containing the current `scripts/dispatch-check.sh`;
- an exact schedule stored outside this public repository.

Run manually:

```bash
./scripts/dispatch-check.sh ltu/vilnius
```

The workflow defaults to `linux`. The dispatcher automatically switches to `windows` only when the Linux runner or direct Wolt preflight is unavailable. Manual runs can still explicitly select either runner.

## Verification

Check the system in this order:

1. `npm test` passes locally or in `.github/workflows/test.yml`.
2. The Linux primary and Windows fallback self-hosted runners are online and have labels `self-hosted`, `X64`, `wolt`, plus the correct OS label.
3. A manual `Update Wolt discount monitor` run completes.
4. `docs/data/cities.json` reports a non-zero `cacheTtlMs` after the next updater run.
5. The Pages workflow completes and the dashboard loads bundled data.
6. When `WOLT_API_BASE_URL` is configured, the deployed `config.js` contains that public origin and uncached cities can use the live API.
7. The API `/health` endpoint returns `200`, reports refresh-pool status, and CORS allows the GitHub Pages origin.

## Privacy boundary

Keep the following outside Git:

- private server hostnames and IP addresses;
- provider and device names;
- exact cron schedules;
- private paths and service names;
- access tokens, chat ids, keys, and credentials.

Self-hosted runner metadata is printed by GitHub before workflow steps run. Use generic machine names, runner names, and service-account names on hosts attached to a public repository so system logs do not reveal personal device or account names.

Public project identifiers, GitHub Pages URLs, generic runner labels, and documented environment-variable names are not secrets.
