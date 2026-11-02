-- Only daily aggregated click counts. No personal data or checkout details.
CREATE TABLE IF NOT EXISTS outbound_clicks(
  day TEXT NOT NULL,
  city_id TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day,city_id)
);
