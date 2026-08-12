# Contributing to Wolt Discount Monitor

Thanks for helping improve the project.

The most useful contributions are fixes for real Wolt response shapes, promotion-scoring improvements, support for edge cases in additional cities, dashboard usability improvements, tests and reliability work.

## Before opening an issue

- Check whether the problem still reproduces on the current `main` branch.
- Search existing issues for the same behavior.
- Remove tokens, chat ids, private hostnames, IP addresses, local paths and personal data from logs or payloads.
- When the problem is city-specific, include the normalized city id such as `ltu/vilnius` or `deu/berlin`.

## Local setup

Requires Node.js 20 or newer.

```bash
git clone https://github.com/Bl0ck154/wolt-discount-monitor.git
cd wolt-discount-monitor
npm test
```

No dependency install is required.

Useful commands:

```bash
npm run cities
npm run check
npm run dashboard
npm run server
```

Run a specific city with:

```bash
WOLT_CITY=deu/berlin node src/check-discounts.mjs
```

## Pull requests

Keep pull requests focused. If behavior changes, add or update tests whenever practical.

Before submitting:

```bash
npm test
```

For changes involving Wolt data parsing, a sanitized fixture is preferred over a large production response. Keep only the fields required to reproduce the behavior.

For dashboard changes, verify both a bundled city snapshot and the no-live-API path.

## Promotion scoring changes

Scoring is intentionally shared between the dashboard and alerting behavior. A scoring change can therefore affect both ranking and notifications.

When changing scoring logic, explain:

1. the promotion type being handled;
2. the old result;
3. the expected result;
4. why the change should generalize beyond one venue;
5. any tests added for the new behavior.

## Generated data

Avoid manually editing generated files under `docs/data/` unless the contribution specifically concerns generated-data maintenance. Source changes should generally be made in `src/` and verified through the relevant build/update command.

## Privacy

This repository intentionally keeps private operational details out of Git. Do not submit:

- credentials or API tokens;
- Telegram chat ids;
- private hostnames or server IPs;
- provider/device names used by private infrastructure;
- exact private scheduler details;
- personal filesystem paths;
- unrelated personal data.

If a security-sensitive report would expose credentials or private infrastructure, do not post the sensitive values publicly. Open a minimal issue describing the affected component without the secret itself.
