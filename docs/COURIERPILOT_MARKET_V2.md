# CourierPilot Market API v2

The v2 API is currency-aware and cohort-isolated. Rates are native-currency major units per full Valhalla route kilometre; currencies and platforms are never mixed.

## Upload

`POST /courierpilot/v2/market/observations`

```json
{"schema":2,"install_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","offers":[{"id":"offer-1","captured_at":1700000000000,"city_key":"lt-vilnius","city_name":"Vilnius","country_code":"LT","platform":"Wolt","currency_code":"EUR","currency_fraction_digits":2,"price_minor":438,"route_distance_m":4750,"route_source":"FULL_valhalla_mean","delivery_count":1,"local_hour":12,"local_weekday":2}]}
```

Only aggregate economics and coarse city/time fields are accepted. Names, addresses, OCR, screenshots and exact GPS are not part of the schema. A v2 observation must have a positive FULL route and is rejected for Bolt `PICKUP_ONLY`.

## Profile

`GET /courierpilot/v2/market/profile?city=lt-vilnius&currency=EUR&platform=Wolt`

The response contains `ready`, sample/effective counts, unique installations, native median, `percentileEdges` (`P15`, `P35`, `P65`, `P85`), P25/P75, confidence, trend and generation time. Thin cohorts return `ready:false`, `bandEdges:null`; no monetary defaults are invented.

## History

`GET /courierpilot/v2/market/history?city=lt-vilnius&currency=EUR&platform=Wolt&period=day`

History is aggregate day/week/month data retained independently of the rolling 30-day live profile. Raw server rows are bounded to 90 days; aggregate history can be retained longer.

Schema v1 uploads and profiles remain readable during migration. Existing EUR rows are interpreted as EUR with two fraction digits, but v1 fallback edges are not used by v2 scoring.
