# Wolt promotions endpoint findings

Date checked: 2026-06-20. Initial research used Vilnius as the test city; the
same coordinate-based endpoints are now used by the universal city monitor.

## Short conclusion

Found the public web endpoint used by Wolt city promotions pages:

```text
GET https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=25.2682558&lat=54.6901231
```

It returns a seed list of venues with active offer/promotion fields for the
requested coordinates. For the checked Vilnius run it returned 1359 unique
venues.

The required header is:

```text
Platform: Web
```

No authorization, private API, captcha bypass, or full menu/assortment crawl is needed. No cookies were required in direct fetch tests.

Without `Platform: Web`, the endpoint returns HTTP 200 with a `no-content` section.

## Promotions endpoint

Example URL:

```text
https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=25.2682558&lat=54.6901231
```

Method: `GET`

Required query params:

```text
lat=54.6901231
lon=25.2682558
```

For any other Wolt city, replace `lat` and `lon` with coordinates from the city
catalog endpoint (`https://restaurant-api.wolt.com/v1/cities`).

Required headers:

```text
Platform: Web
```

Useful optional headers:

```text
Accept: application/json, text/plain, */*
Accept-Language: en-US,en;q=0.9
Referer: https://wolt.com/
```

Cookies/session: not required in direct tests.

Minimal curl:

```bash
curl 'https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=25.2682558&lat=54.6901231' \
  -H 'Platform: Web' \
  -H 'Accept: application/json, text/plain, */*'
```

Response structure:

```text
sections[0].name = promotions-near-you
sections[0].template = venue-vertical-list
sections[0].items[*].venue = venue objects
```

Promotion paths:

```text
sections[0].items[*].venue.promotions[*]
sections[0].items[*].venue.badges_v2[*]
sections[0].items[*].venue.promotions_for_telemetry[*]
```

Example for `lukiskiu-kalejimas-20`, normalized:

```json
{
  "name": "Lukiskiu kalejimas 2.0",
  "slug": "lukiskiu-kalejimas-20",
  "id": "6523eba65669eb446c20ed9b",
  "promotions": [
    {
      "campaign_id": "69c5251b0c0b699093092ff2",
      "icon": "coupon-fill",
      "is_offer_stackable": false,
      "text": "2.50 EUR off",
      "variant": "discount"
    }
  ]
}
```

Pagination:

No pagination was observed in the tested response. The payload arrived as one `venue-vertical-list` section. There was no visible `cursor`, `limit`, `offset`, `next`, or equivalent pagination field in the page payload.

## Restaurants endpoint

Example URL:

```text
https://consumer-api.wolt.com/v1/pages/restaurants?lat=54.6901231&lon=25.2682558
```

Method: `GET`

Required header for offer fields:

```text
Platform: Web
```

Minimal curl:

```bash
curl 'https://consumer-api.wolt.com/v1/pages/restaurants?lat=54.6901231&lon=25.2682558' \
  -H 'Platform: Web' \
  -H 'Accept: application/json, text/plain, */*'
```

With `Platform: Web`, this endpoint also returned offer fields for the tested
venue. Without it, the same venue was present but `promotions`,
`promotions_for_telemetry`, and `badges_v2` were empty.

Use this endpoint as an all-restaurants seed. Use the promotions endpoint as the smaller direct seed for active promo venues.

## Venue dynamic endpoint

Full URL:

```text
https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/lukiskiu-kalejimas-20/dynamic/?lat=54.6901231&lon=25.2682558&selected_delivery_method=homedelivery
```

Method: `GET`

Required query params:

```text
lat=54.6901231
lon=25.2682558
selected_delivery_method=homedelivery
```

Required header:

```text
Platform: Web
```

Minimal curl:

```bash
curl 'https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/lukiskiu-kalejimas-20/dynamic/?lat=54.6901231&lon=25.2682558&selected_delivery_method=homedelivery' \
  -H 'Platform: Web' \
  -H 'Accept: application/json, text/plain, */*'
```

Offer path:

```text
venue.banners[*].discount.formatted_text
```

This endpoint is useful for one-venue validation and richer banner data. It is not needed to find promo venues globally.

## Candidate endpoints tested

```text
200 https://consumer-api.wolt.com/v1/pages/restaurants?lat=54.6901231&lon=25.2682558
200 https://consumer-api.wolt.com/v1/pages/front?lat=54.6901231&lon=25.2682558
200 https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lat=54.6901231&lon=25.2682558
200 https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you:vilnius?lat=54.6901231&lon=25.2682558
404 https://consumer-api.wolt.com/v1/pages/promotions-near-you?lat=54.6901231&lon=25.2682558
200 https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/lukiskiu-kalejimas-20/dynamic/?lat=54.6901231&lon=25.2682558&selected_delivery_method=homedelivery
200 https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/lukiskiu-kalejimas-20/assortment
```

`consumer-assortment` can identify item-level discounts, but it is not the main solution for venue/order-level offer badges.

## Cross-country promotion ranking (2026-07-21)

Live promotion payloads were sampled from 11 cities before implementing value
ranking: Vilnius, Helsinki, Berlin, Warsaw, Prague, Budapest, Tbilisi, Baku,
Copenhagen, Stockholm, and Tel Aviv. The sample covered EUR, PLN, CZK, HUF, GEL,
AZN, DKK, SEK, and ILS.

Observed recurring forms included:

- broad percentages (`10% off`, `Get 30% off`, `-25% off the basket`);
- capped percentages (`15% off (up to 10 EUR)`);
- fixed cash without a minimum (`5 EUR off`, `15 PLN off`, `12 GEL off`);
- fixed cash with a minimum (`50 DKK off (spend 120 DKK)`,
  `750 HUF off (spend 5,000 HUF)`);
- selected-item discounts;
- gifts, free drinks/desserts, `2 for 1`, and free delivery.

### Value model

`src/offer-value.mjs` computes a `0..100` value score:

1. A percentage starts with its face value.
2. Fixed cash with a minimum spend becomes
   `discount / minimum spend * 100`; no exchange rate is needed.
3. Fixed cash without a minimum uses a local campaign reference. The references
   are calibrated from recurring Wolt amounts, not used as foreign-exchange
   rates: EUR 5, PLN 15, CZK 100, HUF 1500, GEL 12, AZN 6, DKK/SEK/NOK 50,
   ILS 20, ISK 700, KZT 2000, RON 20, RSD 500, BGN 10, ALL 500, MKD 300.
4. Broad scope adds value. Grocery receives a larger category bonus because even
   a broad 10% discount is useful across a basket.
5. A high minimum spend lowers percentage-off value. Caps and `up to N%` lower
   certainty and score.
6. Selected items are heavily demoted. Delivery, gifts, free products, and
   `2 for 1` score zero for notification purposes.

Default alert eligibility requires broad scope and score `>=45`. Percentage
floors are `10%` for grocery, `15%` for restaurants, and `20%` for other product
lines. Conditioned fixed cash must save at least `20%` of the minimum basket.
Unconditional cash must be at least `60%` of its currency reference.

The score is universal, but production Telegram delivery remains intentionally
limited to Vilnius. Other cities are useful for research, dashboard browsing,
and regression testing without creating notification spam.
