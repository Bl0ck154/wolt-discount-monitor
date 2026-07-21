# Operations guide

Last verified: 2026-07-21.

## Production topology

The repository is the source of truth for application code, generated dashboard data,
GitHub Actions workflows, and GitHub Pages. There is no continuously running bot
process on the VPS.

The production path is:

1. Netcup cron triggers `.github/workflows/check-discounts.yml` at exact
   `Europe/Vilnius` times.
2. The dispatch helper selects the residential Windows runner when it is online.
3. If the Windows runner is offline, the helper tests Wolt from Netcup and selects
   the Netcup Linux runner only when that preflight returns HTTP 200.
4. The selected runner checks Wolt, optionally sends Telegram notifications, and
   commits changed files under `docs/data/`.
5. `.github/workflows/deploy-pages.yml` publishes `docs/` to GitHub Pages.

GitHub-hosted runner IP ranges must not be used for Wolt checks because Wolt has
returned HTTP 429 from those ranges.

## Runner selection

Manual workflow dispatch accepts `runner=windows` or `runner=netcup`. The default
is `windows`.

The exact-schedule dispatcher is `scripts/dispatch-check.sh`. It queries the GitHub
runner API for `vivobook-wolt-local`:

- `online`: dispatch with `runner=windows`;
- not online: make a Wolt HTTP preflight from Netcup;
- preflight HTTP 200: dispatch with `runner=netcup`;
- any other response: do not dispatch and write an error to the cron log.

This fallback is intentional. Residential Windows remains primary; Netcup is only
a continuity path while its public IP is accepted by Wolt.

## Primary Windows runner

GitHub runner name: `vivobook-wolt-local`.

Required labels:

```text
self-hosted, Windows, X64, wolt, wolt-residential
```

The runner must start automatically after the Windows user logs in. Its Scheduled
Task is named `Wolt GitHub Actions Runner` and launches the runner with a hidden
PowerShell window. It runs with the normal user account, not SYSTEM.

Health checks:

```powershell
Get-ScheduledTask -TaskName 'Wolt GitHub Actions Runner'
Get-ScheduledTaskInfo -TaskName 'Wolt GitHub Actions Runner'
Get-Process | Where-Object ProcessName -Like 'Runner*'
```

GitHub-side status:

```bash
gh api repos/Bl0ck154/wolt-discount-monitor/actions/runners \
  --jq '.runners[] | {name,status,busy,labels:[.labels[].name]}'
```

If the PC is powered off or no user has logged in, the runner is expected to be
offline and the Netcup fallback should be selected by the next cron dispatch.

## Netcup scheduler and fallback runner

The VPS owns exact scheduling and the Linux fallback runner. Private connection,
service, and key details are kept in the local ignored `AGENTS.md`, not in Git.

Operational checkout:

```text
/opt/wolt-discount-monitor
```

Dispatcher:

```text
/opt/wolt-discount-monitor/scripts/dispatch-check.sh
```

Cron output:

```text
/var/log/wolt-monitor-cron.log
```

Production timezone and schedule:

```text
CRON_TZ=Europe/Vilnius
Monday:       10:15, 12:06, 14:44, 17:23, 19:10
Tuesday-Thu:  10:19, 11:49, 14:22, 17:29, 19:11
Friday:       10:18, 11:54, 14:33, 17:44, 19:33
Saturday-Sun: 10:33, 12:02, 14:11, 17:22, 20:11
```

The Linux runner currently retains a historical GitHub name/label containing
`contabo`; that string is not the current hosting provider. Do not infer the VPS
provider from the runner service name.

## Telegram behavior

Telegram notifications are enabled only for the default Vilnius monitor. A
successful workflow can legitimately send no message. Telegram is called only
when a previous snapshot exists and either:

- a new offer passes the configured notification filters; or
- a previously notified offer has ended.

The relevant configuration is stored as GitHub Actions secrets/variables. Never
copy bot tokens or chat IDs into this repository or VPS logs.

Ranking lives in `src/offer-value.mjs` and is shared by normalization, diffs,
Telegram, and dashboard data. Default alert thresholds are: score `45`, grocery
`10%`, restaurant `15%`, other product lines `20%`, conditioned cash value ratio
`20%`, and unconditional cash at `60%` of the local currency reference. Delivery,
gifts, `2 for 1`, selected-item, and `up to N%` offers never alert. Do not restore
the old EUR-only thresholds.

Telegram counts grouped chain/campaign offers, not raw venue locations. It starts
with added/ended counts and ranks each section by score.

## Git state

`main` on GitHub is authoritative. The checker routinely creates commits named
`Update Wolt discount monitor data`, so commit IDs change several times per day.
A local `origin/main` is only a cached ref and is not proof of current GitHub state
until `git fetch` has run.

Before editing:

```bash
git fetch origin main
git status --short
git pull --ff-only origin main
```

The operational VPS checkout may be behind GitHub without affecting Windows jobs,
but it must be updated before deploying a changed dispatch helper.

## Incident checks

When notifications stop, check in this order:

1. `crontab -l` and `/var/log/wolt-monitor-cron.log` on Netcup.
2. `gh run list --workflow check-discounts.yml` for queued/failed runs.
3. Both self-hosted runner statuses through the GitHub API.
4. The selected runner's `_diag` logs.
5. Workflow job logs, including the Wolt update and Telegram steps.
6. `docs/data/changes.json` to distinguish no qualifying changes from a failure.

Queued runs with zero jobs normally mean that no online runner matches `runs-on`.
A successful run with no Telegram message normally means there were no new
notification-worthy Vilnius changes.
