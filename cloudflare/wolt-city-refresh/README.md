# On-demand Wolt cities

The GitHub Pages frontend uses published JSON snapshots for all cities. A user
can pick any city from Wolt's catalog. If that city's snapshot is missing or
older than four hours, the browser requests an asynchronous refresh and
automatically shows the published snapshot after it becomes available.

The Cloudflare Worker **queues the city selected by a visitor** in D1 and
dispatches only one GitHub Actions scan at a time. Its one-minute cron
trigger starts the next city after the previous workflow finishes. This
prevents GitHub's single pending-workflow slot from cancelling requests
when multiple people select different cities.

The catalog lists 967 available cities, but it does not scan them all.
New on-demand requests are capped at 36 cities globally and 8 per visitor
per UTC day to bound costs and automated abuse. Repeat requests for the
same city within four hours share the same job without using new quota.
The browser waits up to 12 minutes and shows a clear queued status
when publication takes longer. All requests use the existing GitHub
Actions Wolt monitor with the same ScraperAPI fallback.

Infrastructure:
- Worker: `wolt-city-refresh` on Cloudflare
- D1: `wolt-demand-cache`
- Public endpoint: `https://wolt-city-refresh.bl0ck-c1b.workers.dev/api/refresh`
- GitHub workflow: `.github/workflows/check-discounts.yml`
- Public cache: `docs/data/cities/<city-key>/latest.json`

**Required deployment configuration:** configure the Worker secret named
`GITHUB_TOKEN` with a GitHub token authorized to dispatch Actions workflows in
`Bl0ck154/wolt-discount-monitor`. Set it in Cloudflare Dashboard under
Workers & Pages → wolt-city-refresh → Settings → Variables and Secrets.
Keep credentials out of the repo, website, and chat.

Database schema (plus the one-time additive migration in queue-migration.sql):

```sql
CREATE TABLE city_jobs(city_id TEXT PRIMARY KEY,requested_at INTEGER NOT NULL,dispatch_status TEXT NOT NULL);
CREATE TABLE daily_budget(day TEXT PRIMARY KEY,scans INTEGER NOT NULL DEFAULT 0);
CREATE TABLE visitor_budget(day TEXT NOT NULL,visitor_hash TEXT NOT NULL,scans INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,visitor_hash));
```

This implementation intentionally avoids direct Worker calls to Wolt, because
the promotions API has returned HTTP 429 from Cloudflare. On an uncached city
the first load can take minutes while GitHub scans and republishes Pages.
