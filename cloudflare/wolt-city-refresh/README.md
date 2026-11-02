# On-demand city scanning

A visitor may select any city in the catalog. A new Wolt scan is requested only
for a selected city with missing/stale data. Every other city remains unscanned.

## Parallel batch architecture

Cloudflare `wolt-city-refresh` maintains a FIFO queue in D1
(`wolt-demand-cache`). `dispatchNext()` reserves up to
**3 queued cities** under a D1 dispatch lease, checks that the previous
GitHub workflow has finished, then starts **one** `check-discounts.yml`
run with `parallel_scan=true`. D1 `batch()` updates all
three jobs transactionally.

Inside the GitHub runner, `src/parallel-city-scans.mjs` processes up
to 3 cities concurrently using bounded asynchronous workers. Each city has its
own snapshot and change-log paths, so the fetches do not race on files.
After all finish, a single process rebuilds the shared catalog, RSS, SEO and
auto-generated README statistics, then makes **one Git commit** and starts one
GitHub Pages deployment.

The already existing GitHub `workflow_run.completed` handler
validates a real completed workflow and drains the next batch. No Cloudflare
Cron Trigger is needed. The GitHub concurrency group is intentionally shared
with scheduled scans so two writers do not push to `main` at once.
Scheduled checks of Vilnius/Nuremberg remain sequential (parallelism 1).

## User experience and limits

The browser displays a stage-based progress bar, time elapsed, and queued
cities ahead. It checks D1 status every 20 seconds and new JSON every five.
The fast endpoint fetches the committed JSON before Pages is finished.
The progress animation is **not an estimated percentage or ETA**.

- Batch size: at most 3 cities, one GitHub-hosted runner.
- Admission: 240 new cities/day globally, 20 per visitor/day (UTC).
- Four-hour deduplication for repeat requests for the same city.
- No bulk scan of all 967 catalog cities.
- One failed city does not erase successful scans in the same batch.
  The failure is logged; the affected city may require another scan later.
- Bursts larger than 3 wait for successive batches.
- On-demand data-only runs skip a redundant full test suite; PR CI and
  scheduled monitoring still run tests.
- Wolt/proxy requests still consume their own network quotas.

## Request lifecycle

`POST /api/refresh` validates the selected city and queues it in D1.
`GET /api/status?cityId=...` returns queued/dispatched and queue
position. `GET /api/snapshot?cityId=...` serves fresh committed
snapshot JSON. `POST /api/drain` accepts a verified recent GitHub
workflow completion only once. `GET /health` is public.

A Worker secret named `GITHUB_TOKEN` (GitHub Actions dispatch/read)
and a D1 binding named `DB` are required. The Worker never contacts
Wolt directly. Keep secrets outside GitHub Pages and the repository.

## Deployment and verification

1. Commit and merge after passing Node tests and README consistency checks.
2. Deploy `cloudflare/wolt-city-refresh/worker.mjs` to the **existing**
   Worker, strictly inheriting the `GITHUB_TOKEN` secret and DB
   binding. Do not replace or delete D1 or pending jobs.
3. Verify /health and /api/status, and that a foreign Origin is denied.
4. Request at most 1–2 uncached cities, then inspect the queue, workflow,
   committed JSON and the Pages deployment.
5. Ensure the auto-generated README coverage section still matches the
   committed snapshots.

No new D1 migration is needed: uses existing `city_jobs`,
`scan_dispatch_lease`, `scan_drain_events`,
`daily_budget` and `visitor_budget`. Existing migration
files remain available for a fresh deployment.

Source map:
- `src/check-discounts.mjs`: per-city tasks, one shared write.
- `src/parallel-city-scans.mjs`: bounded pool of 1–3.
- `.github/workflows/check-discounts.yml`: controls parallel mode.
- `cloudflare/wolt-city-refresh/worker.mjs`: D1 batching.
- `test/parallel-city-scans.test.mjs`: concurrency and failure tests.
