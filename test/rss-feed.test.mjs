import test from "node:test";
import assert from "node:assert/strict";
import { buildCityRss } from "../src/rss.mjs";

const city = { id: "deu/nuremberg", key: "deu-nuremberg", name: "Nuremberg" };
const siteBase = "https://bl0ck154.github.io/wolt-discount-monitor/";
const venue = { name: 'A&B <Kitchen>', link: "https://wolt.com/en/deu/nuremberg/venue/example" };
const offer = { stableKey: "aandb-20", venue, text: "20% off <today>", value: { score: 61 } };
const entry = { generatedAt: "2026-11-02T01:00:00Z", previousGeneratedAt: "2026-11-01T01:00:00Z", interesting: [offer] };

test("RSS includes genuinely newly detected eligible offers and escapes all user-visible text", () => {
 const feed = buildCityRss({ city, entries: [entry], siteBase, now: new Date("2026-11-02T02:00:00Z") });
 assert.match(feed, /<rss version="2.0">/);
 assert.match(feed, /<title>A&amp;B &lt;Kitchen&gt;: 20% off &lt;today&gt;<\/title>/);
 assert.match(feed, /guid isPermaLink='false'/);
 assert.match(feed, /https:\/\/wolt\.com\/en\/deu\/nuremberg\/venue\/example/);
 assert.doesNotMatch(feed, /<title>A&B <Kitchen>/);
});
test("RSS never announces first baseline import or repeated delivery and acquisition banners", () => {
 const initial = { ...entry, previousGeneratedAt: null };
 const repeats = { ...entry, interesting: [{ ...offer, text: "10 € off (spend 15 €)" },
    { ...offer, stableKey:"fee", text:"0 € delivery fee" }] };
 const feed = buildCityRss({ city, entries: [initial, repeats], siteBase, now: new Date("2026-11-02T02:00:00Z") });
 assert.equal((feed.match(/<item>/g) ?? []).length, 0);
});
test("RSS excludes repeated citywide campaigns and unsafe external venue links", () => {
 const snapshot = { venues: Array.from({ length: 11 }, () => ({ offers: [{text:"20% off <today>"}] })) };
 const suppressed = buildCityRss({ city, entries:[entry], snapshot, siteBase, now: new Date("2026-11-02T02:00:00Z") });
 assert.equal((suppressed.match(/<item>/g) ?? []).length, 0);
 const unsafe = buildCityRss({ city, entries:[{ ...entry, interesting: [{ ...offer, venue:{...venue, link:"javascript:alert(1)"} }] }],
   siteBase, now:new Date("2026-11-02T02:00:00Z") });
 assert.doesNotMatch(unsafe, /javascript:/);
 assert.match(unsafe, /wolt-discount-monitor/);
});
test("RSS drops expired changes and deduplicates the same stable offer", () => {
 const stale = { ...entry, generatedAt:"2026-08-01T01:00:00Z" };
 const feed = buildCityRss({ city, entries:[entry,entry,stale], siteBase, now:new Date("2026-11-02T02:00:00Z") });
 assert.equal((feed.match(/<item>/g) ?? []).length, 1);
});
