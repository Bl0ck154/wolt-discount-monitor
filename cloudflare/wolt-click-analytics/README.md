# Wolt click analytics

Independent Worker for aggregated outbound Wolt link clicks by city/day.
It has no GitHub token and does not affect the on-demand refresh Worker.

- Endpoint: https://wolt-click-analytics.bl0ck-c1b.workers.dev/api/click
- D1 DB binding: wolt-demand-cache (existing database)
- Stores only the day, city ID and click count in outbound_clicks.
- Does not save IP addresses, destination URLs, visitor IDs, order amounts, or delivery addresses.
- Counts are outbound clicks, not people; forged requests could skew them.
- POST accepts only GitHub Pages origin and validates city against the published catalog.
- Failed telemetry cannot block navigation to Wolt.
- GET /health is a public availability check.

Run schema.sql before deploying, then query the D1 aggregate table privately.
