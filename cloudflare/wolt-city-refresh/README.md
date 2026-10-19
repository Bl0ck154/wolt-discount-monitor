# On-demand Wolt cities

The GitHub Pages frontend uses published JSON snapshots for all cities. A user
can pick any city from Wolt's catalog. If that city's snapshot is missing or
older than four hours, the browser requests an asynchronous refresh and
automatically shows the published snapshot after it becomes available.

The Cloudflare Worker coordinates requests in D1. It validates city IDs,
deduplicates refreshes for four hours and limits dispatches to 8 globally and 3
per visitor each UTC day. GitHub Actions fetches Wolt data with the existing
ScraperAPI fallback, commits the new city snapshot and publishes Pages.

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

Database schema:

```sql
CREATE TABLE city_jobs(city_id TEXT PRIMARY KEY,requested_at INTEGER NOT NULL,dispatch_status TEXT NOT NULL);
CREATE TABLE daily_budget(day TEXT PRIMARY KEY,scans INTEGER NOT NULL DEFAULT 0);
CREATE TABLE visitor_budget(day TEXT NOT NULL,visitor_hash TEXT NOT NULL,scans INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,visitor_hash));
```

This implementation intentionally avoids direct Worker calls to Wolt, because
the promotions API has returned HTTP 429 from Cloudflare. On an uncached city
the first load can take minutes while GitHub scans and republishes Pages.
