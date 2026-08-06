# Operations guide

This document describes the production configuration without storing personal hostnames, provider names, device names, IP addresses, private filesystem paths, or exact schedules in the public repository.

## Runtime topology

1. An external scheduler runs `scripts/dispatch-check.sh` at the desired times.
2. The dispatcher checks whether the primary self-hosted runner is online.
3. If the primary runner is unavailable, the dispatcher performs a Wolt HTTP preflight and selects a Linux fallback runner only when Wolt is reachable.
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
| `WOLT_CACHE_TTL_HOURS` | `2` | Snapshot cache lifetime |
| `WOLT_API_TIMEOUT_MS` | `30000` | Timeout for one Wolt request attempt |
| `WOLT_API_MAX_ATTEMPTS` | `7` | Maximum request attempts |
| `WOLT_API_RETRY_BASE_MS` | `30000` | Base retry delay |
| `WOLT_API_RETRY_JITTER_MS` | `5000` | Maximum random retry jitter |
| `WOLT_PRIMARY_RUNNER_LABEL` | `wolt-residential` | Generic label used to detect the primary runner |
| `WOLT_FALLBACK_RUNNER_INPUT` | `linux` | Workflow runner value used by the fallback dispatcher |
| `TELEGRAM_ALLOW_SKIP` | leave empty in production | Set to `true` only for intentional non-alert runs |
| `MIN_VALUE_SCORE` | `45` | Minimum general notification score |
| `MIN_GROCERY_PERCENT` | `10` | Grocery percentage threshold |
| `MIN_RESTAURANT_PERCENT` | `15` | Restaurant percentage threshold |
| `MIN_OTHER_PERCENT` | `20` | Other product-line percentage threshold |
| `MIN_CASH_VALUE_RATIO` | `0.20` | Conditioned cash discount threshold |
| `MIN_UNCONDITIONAL_CASH_REFERENCE` | `0.60` | Unconditional cash reference threshold |

A blank or missing numeric variable falls back to the application default. In particular, a blank `WOLT_CACHE_TTL_HOURS` now remains two hours instead of becoming zero.

### Public configuration warning

`WOLT_API_BASE_URL` is not a secret. GitHub Pages writes it into the public `config.js` delivered to browsers. A browser cannot call an API without learning its public origin. To avoid revealing the server IP, place the API behind a reverse proxy or CDN and expose only a public HTTPS hostname.

## API server environment

Configure these on the API host, not in the public repository:

```text
WOLT_API_HOST=127.0.0.1
WOLT_API_PORT=3000
WOLT_API_CACHE_DIR=<private cache path>
WOLT_API_ALLOWED_ORIGINS=https://bl0ck154.github.io
WOLT_API_RATE_LIMIT_REQUESTS=60
WOLT_API_RATE_LIMIT_WINDOW_MS=60000
WOLT_CACHE_TTL_HOURS=2
WOLT_API_TIMEOUT_MS=30000
WOLT_API_MAX_ATTEMPTS=7
WOLT_API_RETRY_BASE_MS=30000
WOLT_API_RETRY_JITTER_MS=5000
```

Bind Node to loopback and publish HTTPS through a reverse proxy. Do not expose the Node port directly.

## External scheduler

The scheduler host needs:

- an authenticated `gh` CLI with permission to dispatch workflows;
- a checkout containing the current `scripts/dispatch-check.sh`;
- an exact schedule stored outside this public repository.

Run manually:

```bash
./scripts/dispatch-check.sh ltu/vilnius
```

The workflow accepts `windows` as the primary value. Any other non-empty runner value is treated as Linux, which keeps older external dispatcher values backward-compatible while allowing the repository to use the generic `linux` value going forward.

## Verification

Check the system in this order:

1. `npm test` passes locally or in `.github/workflows/test.yml`.
2. The primary and fallback self-hosted runners are online and have labels `self-hosted`, `X64`, `wolt`, plus the correct OS label.
3. A manual `Update Wolt discount monitor` run completes.
4. `docs/data/cities.json` reports a non-zero `cacheTtlMs` after the next updater run.
5. The Pages workflow completes and the dashboard loads bundled data.
6. When `WOLT_API_BASE_URL` is configured, the deployed `config.js` contains that public origin and uncached cities can use the live API.
7. The API `/health` endpoint returns `200` and CORS allows the GitHub Pages origin.

## Privacy boundary

Keep the following outside Git:

- personal portfolio links and author profile links;
- private server hostnames and IP addresses;
- provider and device names;
- exact cron schedules;
- private paths and service names;
- access tokens, chat ids, keys, and credentials.
