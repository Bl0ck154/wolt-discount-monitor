# Wolt Vilnius discounts

Public Wolt web endpoint research plus a small scheduled monitor for Vilnius discounts.
It does not depend on the old project files.

## Findings

The Wolt web page `https://wolt.com/en/ltu/vilnius/promotions-near-you` calls:

```text
GET https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=25.2682558&lat=54.6901231
```

Required header:

```text
Platform: Web
```

Without `Platform: Web`, the endpoint still returns HTTP 200, but the body is `no-content`.
With `Platform: Web`, it returns a `venue-vertical-list` section with venues that have offer fields.

Useful JSON paths:

```text
Venue list: sections[0].items[*].venue
Offer data: sections[0].items[*].venue.promotions[*]
UI badge data: sections[0].items[*].venue.badges_v2[*]
Telemetry-only offers: sections[0].items[*].venue.promotions_for_telemetry[*]
```

For `lukiskiu-kalejimas-20`, the promo endpoint includes:

```json
{
  "campaign_id": "69c5251b0c0b699093092ff2",
  "icon": "coupon-fill",
  "is_offer_stackable": false,
  "text": "2.50 EUR off",
  "variant": "discount"
}
```

The actual API text uses the euro symbol and a narrow non-breaking space; the text above is normalized for readability.

The venue page also has a lightweight dynamic endpoint for one venue:

```text
GET https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/lukiskiu-kalejimas-20/dynamic/?lat=54.6901231&lon=25.2682558&selected_delivery_method=homedelivery
```

Useful JSON path:

```text
Venue banner offers: venue.banners[*].discount.formatted_text
```

For this venue it returns normalized banner texts equivalent to `2.50 EUR off`, `0 EUR delivery for new users`, and `0 EUR delivery fee`.

## Run

```bash
npm run check
```

Target venue plus dynamic endpoint check:

```bash
npm run target
```

Custom slug:

```bash
node src/wolt-promotions-poc.mjs --slug caffeine-gedimino-pr --dynamic
```

No package install is required. The script only uses Node's built-in `fetch`.

## GitHub Actions

The workflow in `.github/workflows/check-discounts.yml` runs on a fixed cron schedule.
There is no random sleep inside the script.

Required repository secrets for Telegram notifications:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

Optional repository variables:

```text
MIN_DISCOUNT_EUR=2
INCLUDE_ZERO_DELIVERY=false
```

The checker writes:

```text
docs/data/latest.json
docs/data/changes.json
docs/data/changes-log.json
```

GitHub Pages is deployed by `.github/workflows/deploy-pages.yml` from the `docs/` folder.
