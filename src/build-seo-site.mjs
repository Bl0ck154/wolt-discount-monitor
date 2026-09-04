import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SITE_BASE = "https://bl0ck154.github.io/wolt-discount-monitor/";
export const DEFAULT_SEO_FRESH_HOURS = 48;

const DOCS_DIR = fileURLToPath(new URL("../docs/", import.meta.url));
const HOME_PATH = join(DOCS_DIR, "index.html");
const CITIES_INDEX_PATH = join(DOCS_DIR, "data", "cities.json");
const GENERATED_CITY_DIR = join(DOCS_DIR, "cities");
const GENERATED_COUNTRY_DIR = join(DOCS_DIR, "countries");
const LIVE_START = "<!-- GENERATED_LIVE_CITIES_START -->";
const LIVE_END = "<!-- GENERATED_LIVE_CITIES_END -->";

export async function buildSeoSite({
  docsDir = DOCS_DIR,
  siteBase = normalizeSiteBase(process.env.WOLT_PUBLIC_BASE_URL || DEFAULT_SITE_BASE),
  now = new Date(),
  freshHours = readFreshHours(),
} = {}) {
  const citiesIndex = await readJson(join(docsDir, "data", "cities.json"));
  const cityRecords = [];

  for (const city of citiesIndex.cities ?? []) {
    const snapshot = city.latestPath ? await readJsonIfExists(join(docsDir, city.latestPath)) : null;
    cityRecords.push({
      city,
      snapshot,
      indexable: isSnapshotIndexable(snapshot, now, freshHours),
    });
  }

  const countries = groupByCountry(cityRecords);
  await rm(join(docsDir, "cities"), { recursive: true, force: true });
  await rm(join(docsDir, "countries"), { recursive: true, force: true });

  for (const record of cityRecords) {
    const countryRecords = countries.get(record.city.country) ?? [];
    await writeText(
      cityOutputPath(docsDir, record.city),
      cityPageHtml({ ...record, countryRecords, siteBase, freshHours }),
    );
  }

  const countrySummaries = [];
  for (const [country, records] of countries) {
    const liveRecords = records.filter((record) => record.indexable);
    const code = countryCode(records[0]?.city);
    const indexable = liveRecords.length > 0;
    countrySummaries.push({ country, code, indexable, liveRecords, records });
    await writeText(
      join(docsDir, "countries", code, "index.html"),
      countryPageHtml({ country, code, records, liveRecords, indexable, siteBase }),
    );
  }

  const liveRecords = cityRecords.filter((record) => record.indexable);
  await writeText(join(docsDir, "cities", "index.html"), cityDirectoryPageHtml({ cityRecords, liveRecords, siteBase }));
  await writeText(join(docsDir, "countries", "index.html"), countryDirectoryPageHtml({ countrySummaries, liveRecords, siteBase }));
  await writeText(join(docsDir, "methodology", "index.html"), methodologyPageHtml({ siteBase }));
  await updateHomepageLiveCities(join(docsDir, "index.html"), liveRecords);
  await writeText(join(docsDir, "sitemap.xml"), sitemapXml({ siteBase, liveRecords, countrySummaries, includeDirectories: liveRecords.length > 0 }));
  await writeText(join(docsDir, "robots.txt"), robotsText(siteBase));
  await writeText(join(docsDir, "llms.txt"), llmsText(siteBase));

  return {
    totalCities: cityRecords.length,
    indexableCities: liveRecords.length,
    totalCountries: countrySummaries.length,
    indexableCountries: countrySummaries.filter((country) => country.indexable).length,
    freshHours,
  };
}

export function isSnapshotIndexable(snapshot, now = new Date(), freshHours = DEFAULT_SEO_FRESH_HOURS) {
  if (!snapshot?.generatedAt || !Array.isArray(snapshot.venues) || snapshot.venues.length === 0) return false;
  const generatedAt = Date.parse(snapshot.generatedAt);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(nowMs)) return false;
  const ageMs = Math.max(0, nowMs - generatedAt);
  return ageMs <= freshHours * 60 * 60 * 1000;
}

export function cityPageHtml({ city, snapshot, indexable, countryRecords = [], siteBase = DEFAULT_SITE_BASE, freshHours = DEFAULT_SEO_FRESH_HOURS }) {
  const canonical = cityUrl(city, siteBase);
  const dashboardUrl = `${siteBase}?city=${encodeURIComponent(city.id)}`;
  const countryUrl = `${siteBase}countries/${countryCode(city)}/`;
  const label = city.label || `${city.name}, ${city.country}`;
  const promoCount = snapshot?.counts?.promotionsUniqueVenues ?? null;
  const restaurantCount = snapshot?.counts?.restaurantsUniqueVenues ?? null;
  const updated = snapshot?.generatedAt ? formatDateTime(snapshot.generatedAt) : "Not cached yet";
  const status = indexable
    ? `Fresh snapshot · ${updated}`
    : snapshot?.generatedAt
      ? `Snapshot is older than ${freshHours} hours · last captured ${updated}`
      : "No stored snapshot yet";
  const title = `Wolt Discounts in ${city.name} | Live Deals & Promotions`;
  const description = indexable
    ? `Compare ${formatNumber(promoCount)} current Wolt promoted venues in ${city.name}, ${city.country}. See restaurant and grocery deals ranked by estimated value.`
    : `Wolt deal tracking page for ${city.name}, ${city.country}. Open the interactive monitor or check back when a fresh city snapshot is available.`;
  const topDeals = topDealVenues(snapshot, 12);
  const peerLinks = countryRecords
    .filter((record) => record.city.id !== city.id)
    .sort((a, b) => a.city.name.localeCompare(b.city.name, "en"))
    .slice(0, 12)
    .map((record) => `<a class="directory-link${record.indexable ? " is-live" : ""}" href="${escapeHtml(cityRelativeUrl(record.city))}"><strong>${escapeHtml(record.city.name)}</strong><span>${record.indexable ? "Fresh deal page" : "Catalog page"}</span></a>`)
    .join("");

  const dealMarkup = topDeals.length
    ? `<div class="deal-grid">${topDeals.map((venue) => {
        const offer = seoOfferText(venue);
        return `<article class="landing-deal"><div class="landing-deal-name"><a href="${escapeHtml(venue.link || dashboardUrl)}" target="_blank" rel="noreferrer">${escapeHtml(venue.name)}</a><span>${escapeHtml([offer, venue.address].filter(Boolean).join(" · "))}</span></div><strong class="landing-deal-value">${escapeHtml(bestValueLabel(venue))}</strong></article>`;
      }).join("")}</div>`
    : `<div class="stale-note">There is no fresh crawlable deal list for this city yet. Use the interactive dashboard to check whether a snapshot is available.</div>`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Wolt discounts in ${city.name}`,
    url: canonical,
    description,
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", name: "Wolt Discount Monitor", url: siteBase },
    about: { "@type": "City", name: city.name, containedInPlace: { "@type": "Country", name: city.country } },
    ...(indexable && topDeals.length ? {
      mainEntity: {
        "@type": "ItemList",
        itemListElement: topDeals.slice(0, 10).map((venue, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: venue.name,
          url: venue.link || dashboardUrl,
        })),
      },
    } : {}),
  };

  return pageShell({
    title,
    description,
    canonical,
    robots: indexable ? "index,follow,max-image-preview:large,max-snippet:-1" : "noindex,follow",
    siteBase,
    jsonLd,
    body: `
      <main class="landing-main">
        <section class="landing-hero shell">
          <nav class="landing-breadcrumbs" aria-label="Breadcrumb"><a href="${siteBase}">Home</a><span>›</span><a href="${countryUrl}">${escapeHtml(city.country)}</a><span>›</span><span>${escapeHtml(city.name)}</span></nav>
          <span class="eyebrow"><span class="live-dot" aria-hidden="true"></span> ${escapeHtml(status)}</span>
          <h1>Wolt discounts in ${escapeHtml(city.name)}</h1>
          <p>Compare Wolt promotions in ${escapeHtml(label)} without scanning every venue manually. Fresh pages show stored deals ranked by estimated value; final prices and eligibility should always be confirmed in Wolt.</p>
          <div class="landing-actions"><a class="primary-link" href="${dashboardUrl}">Open interactive dashboard</a>${city.url ? `<a class="secondary-link" href="${escapeHtml(city.url)}" target="_blank" rel="noreferrer">Open Wolt ${escapeHtml(city.name)} ↗</a>` : ""}</div>
        </section>
        <section class="landing-stats shell" aria-label="City deal summary">
          <div class="landing-stat"><span>Promoted venues</span><strong>${formatNumber(promoCount)}</strong></div>
          <div class="landing-stat"><span>Restaurants</span><strong>${formatNumber(restaurantCount)}</strong></div>
          <div class="landing-stat"><span>Snapshot</span><strong>${escapeHtml(updated)}</strong></div>
        </section>
        <section class="landing-section shell">
          <h2>${indexable ? `Best Wolt deals in ${escapeHtml(city.name)}` : `Deal tracking for ${escapeHtml(city.name)}`}</h2>
          <p>${indexable ? `This static snapshot is recent enough to be published for search. The list below highlights strong currently stored promotions; use the dashboard for the full filterable view.` : `This page exists as part of the city catalog, but its stored snapshot is not fresh enough to publish as current deal content. It is intentionally excluded from the sitemap and search index until fresh data is available.`}</p>
          ${dealMarkup}
        </section>
        ${peerLinks ? `<section class="landing-section shell"><h2>Other Wolt cities in ${escapeHtml(city.country)}</h2><p>Browse other city pages from the same country. Fresh deal pages are marked separately.</p><div class="city-directory">${peerLinks}</div></section>` : ""}
      </main>`,
  });
}

export function countryPageHtml({ country, code, records, liveRecords, indexable, siteBase = DEFAULT_SITE_BASE }) {
  const canonical = `${siteBase}countries/${code}/`;
  const title = `Wolt Deals in ${country} | Cities & Discounts`;
  const description = indexable
    ? `Browse Wolt deal pages in ${country}. ${liveRecords.length} city${liveRecords.length === 1 ? " has" : " pages have"} a fresh searchable promotion snapshot.`
    : `Browse Wolt cities in ${country}. Fresh city deal pages are published automatically when recent promotion data is available.`;
  const links = records
    .sort((a, b) => a.city.name.localeCompare(b.city.name, "en"))
    .map((record) => `<a class="directory-link${record.indexable ? " is-live" : ""}" href="${siteBase}${cityRelativeUrl(record.city)}"><strong>${escapeHtml(record.city.name)}</strong><span>${record.indexable ? "Fresh deal page" : "Catalog page · noindex"}</span></a>`)
    .join("");

  return pageShell({
    title,
    description,
    canonical,
    robots: indexable ? "index,follow,max-image-preview:large,max-snippet:-1" : "noindex,follow",
    siteBase,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `Wolt deals in ${country}`,
      url: canonical,
      description,
      inLanguage: "en",
      about: { "@type": "Country", name: country },
    },
    body: `
      <main class="landing-main">
        <section class="landing-hero shell">
          <nav class="landing-breadcrumbs" aria-label="Breadcrumb"><a href="${siteBase}">Home</a><span>›</span><span>${escapeHtml(country)}</span></nav>
          <span class="eyebrow">Country directory</span>
          <h1>Wolt deals in ${escapeHtml(country)}</h1>
          <p>Browse ${records.length} Wolt ${records.length === 1 ? "city" : "cities"} in ${escapeHtml(country)}. City pages become search-indexable only when the monitor has a recent stored promotion snapshot.</p>
          <div class="landing-actions"><a class="primary-link" href="${siteBase}">Open deal explorer</a></div>
        </section>
        <section class="landing-stats shell"><div class="landing-stat"><span>Catalog cities</span><strong>${records.length}</strong></div><div class="landing-stat"><span>Fresh deal pages</span><strong>${liveRecords.length}</strong></div><div class="landing-stat"><span>Indexing</span><strong>${indexable ? "Active" : "Waiting for fresh data"}</strong></div></section>
        <section class="landing-section shell"><h2>Wolt cities in ${escapeHtml(country)}</h2><p>Fresh pages contain crawlable deal content and are included in the sitemap. Catalog-only pages remain available to users but use noindex until their data is fresh.</p><div class="city-directory">${links}</div></section>
      </main>`,
  });
}

export function cityDirectoryPageHtml({ cityRecords = [], liveRecords = [], siteBase = DEFAULT_SITE_BASE }) {
  const liveIds = new Set(liveRecords.map((record) => record.city.id));
  const links = [...cityRecords]
    .sort((a, b) => a.city.country.localeCompare(b.city.country, "en") || a.city.name.localeCompare(b.city.name, "en"))
    .map((record) => `<a class="directory-link${liveIds.has(record.city.id) ? " is-live" : ""}" href="${siteBase}${cityRelativeUrl(record.city)}"><strong>${escapeHtml(record.city.name)}</strong><span>${escapeHtml(record.city.country)} · ${liveIds.has(record.city.id) ? "Fresh deal page" : "Catalog page"}</span></a>`)
    .join("");
  const canonical = `${normalizeSiteBase(siteBase)}cities/`;
  const description = `Browse ${cityRecords.length} Wolt city pages. Fresh promotion snapshots are indexed automatically and catalog-only pages remain noindex until current data is available.`;
  return pageShell({
    title: "Wolt Deals by City | City Directory",
    description,
    canonical,
    robots: liveRecords.length ? "index,follow,max-image-preview:large,max-snippet:-1" : "noindex,follow",
    siteBase,
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: "Wolt deals by city", url: canonical, description, inLanguage: "en" },
    body: `
      <main class="landing-main">
        <section class="landing-hero shell"><nav class="landing-breadcrumbs" aria-label="Breadcrumb"><a href="${siteBase}">Home</a><span>›</span><span>Cities</span></nav><span class="eyebrow">City directory</span><h1>Wolt deals by city</h1><p>Browse the complete Wolt city catalog used by the monitor. Fresh pages contain static crawlable deal content; catalog pages stay out of search until a recent snapshot exists.</p><div class="landing-actions"><a class="primary-link" href="${siteBase}#deals">Open interactive explorer</a><a class="secondary-link" href="${siteBase}countries/">Browse countries</a></div></section>
        <section class="landing-stats shell"><div class="landing-stat"><span>Catalog cities</span><strong>${cityRecords.length}</strong></div><div class="landing-stat"><span>Fresh deal pages</span><strong>${liveRecords.length}</strong></div><div class="landing-stat"><span>Publishing rule</span><strong>Fresh data only</strong></div></section>
        <section class="landing-section shell"><h2>All Wolt cities</h2><p>Use the city pages below for stable URLs. A green status means the page currently has a recent stored promotion snapshot and is eligible for search indexing.</p><div class="city-directory">${links}</div></section>
      </main>`,
  });
}

export function countryDirectoryPageHtml({ countrySummaries = [], liveRecords = [], siteBase = DEFAULT_SITE_BASE }) {
  const canonical = `${normalizeSiteBase(siteBase)}countries/`;
  const description = `Browse Wolt deal coverage by country. The monitor currently knows ${countrySummaries.length} countries and publishes indexable country pages only where fresh city data exists.`;
  const links = [...countrySummaries]
    .sort((a, b) => a.country.localeCompare(b.country, "en"))
    .map((summary) => `<a class="directory-link${summary.indexable ? " is-live" : ""}" href="${siteBase}countries/${summary.code}/"><strong>${escapeHtml(summary.country)}</strong><span>${summary.records.length} cities · ${summary.liveRecords.length} fresh</span></a>`)
    .join("");
  return pageShell({
    title: "Wolt Deals by Country | Country Directory",
    description,
    canonical,
    robots: liveRecords.length ? "index,follow,max-image-preview:large,max-snippet:-1" : "noindex,follow",
    siteBase,
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: "Wolt deals by country", url: canonical, description, inLanguage: "en" },
    body: `
      <main class="landing-main">
        <section class="landing-hero shell"><nav class="landing-breadcrumbs" aria-label="Breadcrumb"><a href="${siteBase}">Home</a><span>›</span><span>Countries</span></nav><span class="eyebrow">Country directory</span><h1>Wolt deals by country</h1><p>Browse countries and their Wolt cities from one crawlable directory. Search indexing is enabled only where recent promotion data makes the page genuinely useful.</p><div class="landing-actions"><a class="primary-link" href="${siteBase}cities/">Browse all cities</a><a class="secondary-link" href="${siteBase}#deals">Open deal explorer</a></div></section>
        <section class="landing-stats shell"><div class="landing-stat"><span>Countries</span><strong>${countrySummaries.length}</strong></div><div class="landing-stat"><span>Fresh city pages</span><strong>${liveRecords.length}</strong></div><div class="landing-stat"><span>Language</span><strong>English</strong></div></section>
        <section class="landing-section shell"><h2>Countries in the Wolt catalog</h2><p>Country pages group their cities and clearly distinguish fresh searchable deal pages from catalog-only pages.</p><div class="city-directory">${links}</div></section>
      </main>`,
  });
}

export function methodologyPageHtml({ siteBase = DEFAULT_SITE_BASE }) {
  const canonical = `${normalizeSiteBase(siteBase)}methodology/`;
  const description = "How Wolt Discount Monitor classifies promotions, estimates deal value, handles minimum spend and multibuy offers, and decides what is worth surfacing.";
  return pageShell({
    title: "How Wolt Deals Are Ranked | Methodology",
    description,
    canonical,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    siteBase,
    jsonLd: { "@context": "https://schema.org", "@type": "TechArticle", headline: "How Wolt Discount Monitor ranks deals", url: canonical, description, inLanguage: "en", about: "Wolt promotion ranking methodology" },
    body: `
      <main class="landing-main">
        <section class="landing-hero shell"><nav class="landing-breadcrumbs" aria-label="Breadcrumb"><a href="${siteBase}">Home</a><span>›</span><span>Methodology</span></nav><span class="eyebrow">Transparent scoring</span><h1>How Wolt Discount Monitor ranks deals</h1><p>The value score is a practical comparison heuristic, not a promise of savings. It tries to make unlike Wolt promotion formats easier to compare while keeping conditions and uncertainty visible.</p><div class="landing-actions"><a class="primary-link" href="${siteBase}#deals">Open the deal explorer</a><a class="secondary-link" href="https://github.com/Bl0ck154/wolt-discount-monitor/blob/main/src/offer-value.mjs" target="_blank" rel="noreferrer">Read scoring source ↗</a></div></section>
        <section class="landing-section shell"><h2>Value score tiers</h2><p>The current scoring model is version 4. Scores of 75+ are classified as exceptional, 60–74 as great, 45–59 as good, 30–44 as fair and lower scores as low-value. The score is used for sorting and filtering; the actual checkout price in Wolt remains authoritative.</p><div class="feature-grid"><article class="feature-card"><span class="feature-number">BROAD DEALS</span><h3>Discount size matters</h3><p>Broad percentage and cash discounts receive stronger scores when the benefit is meaningful and the conditions are not overly restrictive.</p></article><article class="feature-card"><span class="feature-number">CONDITIONS</span><h3>Minimum spend matters</h3><p>Cash discounts are normalized against minimum spend when that condition is present. High spend requirements reduce the relative value of an offer.</p></article><article class="feature-card"><span class="feature-number">SCOPE</span><h3>Noise is demoted</h3><p>Delivery-only, selected-item and “up to” promotions are treated differently from broad basket discounts so they do not dominate the ranking.</p></article></div></section>
        <section class="landing-section shell"><h2>Notification thresholds</h2><p>The monitor uses stricter rules for notifications than for display. Broad restaurant percentage discounts generally need at least 15%, grocery deals 10%, and other categories 20%, while the overall value score must normally reach 45. Multibuy offers use their own confidence checks and a default score threshold of 52.</p><div class="stale-note">These are ranking defaults from the open-source code, not Wolt rules. They can evolve as the parser and scoring model improve.</div></section>
        <section class="landing-section shell"><h2>Freshness and search indexing</h2><p>Interactive monitoring uses a one-hour cache for actively monitored cities. Static city pages are more conservative: by default a page must have a non-empty snapshot no older than 48 hours to become indexable and enter the sitemap. Stale or empty city pages remain usable but are emitted with noindex,follow.</p></section>
        <section class="landing-section shell"><h2>Limitations</h2><p>Promotions can be account-specific, location-specific, temporary or conditional. Parsing promotion text is imperfect, and the value score cannot know your basket contents or personal preferences. Always verify the final price, eligibility and terms in Wolt before placing an order.</p></section>
      </main>`,
  });
}

export function sitemapXml({ siteBase = DEFAULT_SITE_BASE, liveRecords = [], countrySummaries = [], includeDirectories = false }) {
  const newestLiveDate = newestDate(liveRecords.map((record) => record.snapshot?.generatedAt));
  const urls = [{ loc: siteBase, lastmod: newestLiveDate }];
  if (includeDirectories) {
    urls.push({ loc: `${siteBase}cities/`, lastmod: newestLiveDate });
    urls.push({ loc: `${siteBase}countries/`, lastmod: newestLiveDate });
  }
  urls.push({ loc: `${siteBase}methodology/`, lastmod: null });
  for (const country of countrySummaries.filter((item) => item.indexable)) {
    urls.push({ loc: `${siteBase}countries/${country.code}/`, lastmod: newestDate(country.liveRecords.map((record) => record.snapshot?.generatedAt)) });
  }
  for (const record of liveRecords) {
    urls.push({ loc: cityUrl(record.city, siteBase), lastmod: dateOnly(record.snapshot?.generatedAt) });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((entry) => `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""}\n  </url>`).join("\n")}\n</urlset>\n`;
}

function pageShell({ title, description, canonical, robots, siteBase, jsonLd, body }) {
  const json = JSON.stringify(jsonLd).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${escapeHtml(siteBase)}" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="${escapeHtml(robots)}" />
  <meta name="theme-color" content="#07161b" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml" />
  <meta property="og:site_name" content="Wolt Discount Monitor" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(siteBase)}assets/og-card.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(siteBase)}assets/og-card.png" />
  <script type="application/ld+json">${json}</script>
  <link rel="stylesheet" href="styles.css" />
  <link rel="stylesheet" href="mobile.css" />
</head>
<body class="landing-page">
  <header class="topbar"><div class="shell topbar-inner"><a class="brand" href="${escapeHtml(siteBase)}"><span class="brand-mark" aria-hidden="true">%</span><span class="brand-copy"><strong>Wolt Discount Monitor</strong><small>Independent deal tracker</small></span></a><nav class="topnav" aria-label="Primary navigation"><a href="${escapeHtml(siteBase)}#deals">Deals</a><a href="${escapeHtml(siteBase)}#live-cities">Cities</a><a href="${escapeHtml(siteBase)}#how-it-works">How it works</a></nav></div></header>
  ${body}
  <footer class="site-footer"><div class="shell footer-inner"><div><strong>Wolt Discount Monitor</strong><span>Unofficial open-source project. Not affiliated with Wolt.</span></div><div class="footer-links"><a href="${escapeHtml(siteBase)}sitemap.xml">Sitemap</a><a href="https://github.com/Bl0ck154/wolt-discount-monitor" target="_blank" rel="noreferrer">Source code ↗</a></div></div></footer>
</body>
</html>\n`;
}

async function updateHomepageLiveCities(path, liveRecords) {
  let html = await readFile(path, "utf8");
  const start = html.indexOf(LIVE_START);
  const end = html.indexOf(LIVE_END);
  if (start < 0 || end < 0 || end <= start) throw new Error("Homepage live-city markers are missing");
  const cards = liveRecords
    .sort((a, b) => (b.snapshot?.counts?.promotionsUniqueVenues ?? 0) - (a.snapshot?.counts?.promotionsUniqueVenues ?? 0) || a.city.name.localeCompare(b.city.name, "en"))
    .slice(0, 24)
    .map((record) => `          <a class="city-link-card" href="${cityRelativeUrl(record.city)}"><span>${escapeHtml(record.city.label || `${record.city.name}, ${record.city.country}`)}</span><strong>${formatNumber(record.snapshot?.counts?.promotionsUniqueVenues)} promoted venues · View deals →</strong></a>`)
    .join("\n");
  const block = `${LIVE_START}\n        <div class="city-link-grid">\n${cards || "          <div class=\"stale-note\">No city currently has a fresh SEO snapshot.</div>"}\n        </div>\n        ${LIVE_END}`;
  html = html.slice(0, start) + block + html.slice(end + LIVE_END.length);
  await writeText(path, html);
}

function topDealVenues(snapshot, limit) {
  return [...(snapshot?.venues ?? [])]
    .filter((venue) => venue?.name && (venue.bestDiscount?.score ?? 0) > 0)
    .sort((a, b) => (b.bestDiscount?.score ?? 0) - (a.bestDiscount?.score ?? 0) || a.name.localeCompare(b.name, "en"))
    .slice(0, limit);
}

function seoOfferText(venue) {
  const offers = venue.offers ?? [];
  const preferred = offers.find((offer) => !offer?.value?.isDelivery && !/new users?/i.test(offer?.text ?? "")) ?? offers[0];
  return preferred?.text ?? "Current promotion";
}

function bestValueLabel(venue) {
  return venue.bestDiscount?.label || venue.bestDiscount?.amountLabel || (venue.bestDiscount?.amount ? `${venue.bestDiscount.amount}%` : "Deal");
}

function groupByCountry(records) {
  const groups = new Map();
  for (const record of records) {
    const country = record.city.country || "Other";
    if (!groups.has(country)) groups.set(country, []);
    groups.get(country).push(record);
  }
  return groups;
}

function cityOutputPath(docsDir, city) {
  const [country, slug] = city.id.split("/");
  return join(docsDir, "cities", safeSegment(country), safeSegment(slug || city.slug), "index.html");
}

function cityRelativeUrl(city) {
  const [country, slug] = city.id.split("/");
  return `cities/${encodeURIComponent(country)}/${encodeURIComponent(slug || city.slug)}/`;
}

function cityUrl(city, siteBase) { return `${normalizeSiteBase(siteBase)}${cityRelativeUrl(city)}`; }
function countryCode(city) { return safeSegment(String(city?.id ?? "other").split("/")[0] || city?.countryCode || "other"); }
function safeSegment(value) { return String(value ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "other"; }
function normalizeSiteBase(value) { return `${String(value).replace(/\/+$/, "")}/`; }
function readFreshHours() { const value = Number(process.env.SEO_FRESH_HOURS); return Number.isFinite(value) && value > 0 ? value : DEFAULT_SEO_FRESH_HOURS; }
function formatNumber(value) { return Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-US").format(Number(value)) : "—"; }
function formatDateTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC" : "Unknown"; }
function dateOnly(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null; }
function newestDate(values) { return values.map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime())).sort((a, b) => b - a)[0]?.toISOString().slice(0, 10) ?? null; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function escapeXml(value) { return escapeHtml(value); }

function robotsText(siteBase) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${normalizeSiteBase(siteBase)}sitemap.xml\n`;
}

function llmsText(siteBase) {
  return `# Wolt Discount Monitor\n\n> Independent open-source dashboard for comparing Wolt promotions by city and estimated deal value.\n\nCanonical: ${normalizeSiteBase(siteBase)}\nSource: https://github.com/Bl0ck154/wolt-discount-monitor\nSitemap: ${normalizeSiteBase(siteBase)}sitemap.xml\n\nThe site exposes a static interactive dashboard plus generated city and country pages. Search-indexable city pages are published only while a stored snapshot is fresh. The project is not affiliated with Wolt. Always verify final prices and eligibility in Wolt.\n`;
}

async function readJson(path) { return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")); }
async function readJsonIfExists(path) { try { return await readJson(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function writeText(path, content) { await mkdir(dirname(path), { recursive: true }); let previous = null; try { previous = await readFile(path, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; } if (previous !== content) await writeFile(path, content, "utf8"); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSeoSite().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
}
