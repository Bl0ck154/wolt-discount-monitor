import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cityPageHtml,
  isSnapshotIndexable,
  sitemapXml,
} from "../src/build-seo-site.mjs";

const city = {
  id: "ltu/vilnius",
  slug: "vilnius",
  name: "Vilnius",
  country: "Lithuania",
  label: "Vilnius, Lithuania",
  url: "https://wolt.com/en/ltu/vilnius",
};

function snapshotAt(iso) {
  return {
    generatedAt: iso,
    counts: { promotionsUniqueVenues: 12, restaurantsUniqueVenues: 8 },
    venues: [{
      name: "Test Venue",
      link: "https://wolt.com/test",
      address: "Test street",
      offers: [{ text: "-30% basket discount", value: { isDelivery: false } }],
      bestDiscount: { label: "30%", score: 61 },
    }],
  };
}

test("SEO freshness promotes only recent non-empty snapshots", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  assert.equal(isSnapshotIndexable(snapshotAt("2026-09-04T11:00:00Z"), now, 48), true);
  assert.equal(isSnapshotIndexable(snapshotAt("2026-09-01T11:00:00Z"), now, 48), false);
  assert.equal(isSnapshotIndexable({ generatedAt: now.toISOString(), venues: [] }, now, 48), false);
});

test("fresh city page has unique crawlable SEO metadata and static deal content", () => {
  const snapshot = snapshotAt("2026-09-04T11:00:00Z");
  const html = cityPageHtml({ city, snapshot, indexable: true, countryRecords: [], siteBase: "https://example.test/" });
  assert.match(html, /<title>Wolt Discounts in Vilnius/);
  assert.match(html, /name="robots" content="index,follow/);
  assert.match(html, /rel="canonical" href="https:\/\/example\.test\/cities\/ltu\/vilnius\/"/);
  assert.match(html, /<h1>Wolt discounts in Vilnius<\/h1>/);
  assert.match(html, /Test Venue/);
  assert.match(html, /application\/ld\+json/);
});

test("stale city page stays usable but noindex", () => {
  const snapshot = snapshotAt("2026-06-01T11:00:00Z");
  const html = cityPageHtml({ city, snapshot, indexable: false, countryRecords: [], siteBase: "https://example.test/" });
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.match(html, /intentionally excluded from the sitemap and search index/);
});

test("sitemap contains only explicitly indexable city and country URLs", () => {
  const snapshot = snapshotAt("2026-09-04T11:00:00Z");
  const xml = sitemapXml({
    siteBase: "https://example.test/",
    liveRecords: [{ city, snapshot, indexable: true }],
    countrySummaries: [{ code: "ltu", indexable: true, liveRecords: [{ city, snapshot }] }],
  });
  assert.match(xml, /https:\/\/example\.test\/countries\/ltu\//);
  assert.match(xml, /https:\/\/example\.test\/cities\/ltu\/vilnius\//);
  assert.doesNotMatch(xml, /berlin/);
});

test("homepage exposes the core SEO and accessibility structure without JavaScript", async () => {
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  assert.match(html, /<h1 id="page-title">/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /GENERATED_LIVE_CITIES_START/);
  assert.match(html, /<h2 id="how-title">/);
});

test("production updater stages regenerated SEO artifacts", async () => {
  const workflow = await readFile(new URL("../.github/workflows/check-discounts.yml", import.meta.url), "utf8");
  const stageLine = "git add -- docs/data docs/cities docs/countries docs/methodology docs/sitemap.xml docs/robots.txt docs/llms.txt docs/index.html";
  assert.equal(workflow.split(stageLine).length - 1, 3, "cloud, Windows and Linux commit paths must all stage SEO output");
});

test("Pages deploy payload includes generated SEO routes and social assets", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /cp docs\/sitemap\.xml docs\/robots\.txt docs\/llms\.txt \.pages-site\//);
  assert.match(workflow, /cp -a docs\/assets docs\/cities docs\/countries docs\/methodology \.pages-site\//);
});


test("grouped locations use a bounded responsive layout instead of a nested table", async () => {
  const app = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../docs/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(app, /nested-table/);
  assert.match(app, /<td colspan="6">/);
  assert.match(app, /group-location-list/);
  assert.match(app, /additionalRows = group\.rows\.filter/);
  assert.match(css, /\.group-location-card\s*\{/);
  assert.match(css, /\.group-location-map\s*\{\s*justify-self: end;/);
});

test("dashboard typography uses the neutral system UI stack", async () => {
  const css = await readFile(new URL("../docs/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /font-family:\s*Inter/);
  assert.match(css, /font-family:\s*-apple-system, BlinkMacSystemFont, "Segoe UI"/);
  assert.match(css, /font-size:\s*clamp\(36px, 4vw, 52px\)/);
});


test("consumer UI keeps internal value scores out of deal rows", async () => {
  const app = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /\$\{score\}\/100/);
  assert.match(app, /return \/\^\\d\+\(\?:\[\.,\]\\d\+\)\?%\$\/.+`-\$\{label\}`/s);
});

test("mobile UI keeps secondary controls quiet and non-sticky", async () => {
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../docs/mobile.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, />GitHub ↗<\/a>/);
  assert.doesNotMatch(html, />Map ↗<\/a>/);
  assert.doesNotMatch(html, /Snapshot updated/);
  assert.match(html, /class="summary-meta">Updated/);
  assert.match(mobile, /\.topbar \{ position: relative; \}/);
  assert.match(mobile, /\.topnav \{ display: none; \}/);
  assert.match(mobile, /"venue map"/);
  assert.match(mobile, /"status best"/);
});


test("deal rows hide implementation metadata and keep venue type beside the name", async () => {
  const app = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(app, /venue\.address, venue\.slug/);
  assert.doesNotMatch(app, /groupSize > 1/);
  assert.match(app, /venue-type-inline/);
  assert.doesNotMatch(html, /data-sort-key="type">Type/);
});


test("primary and grouped locations share the same venue presentation fragments", async () => {
  const app = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
  assert.match(app, /function renderVenueParts\(venue, visibleOffers\)/);
  assert.match(app, /function renderVenueRow[\s\S]*const parts = renderVenueParts\(venue, visibleOffers\)/);
  assert.match(app, /function renderGroupDetailRow[\s\S]*const parts = renderVenueParts\(venue, visibleOffers\)/);
  assert.match(app, /group-location-value">\$\{parts\.value\}/);
  assert.doesNotMatch(app, /<span>Best<\/span>/);
});
