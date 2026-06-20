# Wolt Vilnius promotions findings

Date checked: 2026-06-20.

## Short conclusion

Found the public web endpoint used by the Wolt promotions page:

```text
GET https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=25.2682558&lat=54.6901231
```

It returns a seed list of venues with active offer/promotion fields. For the checked run it returned 1359 unique venues.

The required header is:

```text
Platform: Web
```

No authorization, private API, captcha bypass, or full menu/assortment crawl is needed. No cookies were required in direct fetch tests.

Without `Platform: Web`, the endpoint returns HTTP 200 with a `no-content` section.

## Promotions endpoint

Full URL:

```text
https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=25.2682558&lat=54.6901231
```

Method: `GET`

Required query params:

```text
lat=54.6901231
lon=25.2682558
```

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

Full URL:

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

With `Platform: Web`, this endpoint also returned offer fields for `lukiskiu-kalejimas-20`. Without it, the same venue was present but `promotions`, `promotions_for_telemetry`, and `badges_v2` were empty.

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
