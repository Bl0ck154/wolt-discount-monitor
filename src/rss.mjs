import { isLikelyAcquisitionOffer } from "../docs/offer-filters.mjs";
import { offerTextKey, isDeliveryOffer, ubiquitousOfferIndex } from "../docs/deal-visibility.mjs";

const MAX_ITEMS = 50;
const MAX_AGE_DAYS = 21;

const xml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

function publicVenueLink(value, fallback) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && (url.hostname === "wolt.com" || url.hostname.endsWith(".wolt.com"))) return url.href;
  } catch {}
  return fallback;
}

export function buildCityRss({ city, entries = [], snapshot, siteBase, now = new Date() }) {
  const base = new URL(siteBase);
  const feedUrl = new URL("feeds/" + city.key + ".xml", base).href;
  const cityUrl = new URL("?city=" + encodeURIComponent(city.id), base).href;
  const minDate = now.getTime() - MAX_AGE_DAYS * 86400000;
  const repeated = ubiquitousOfferIndex(snapshot?.venues).keys;
  const items = [];
  const dedupe = new Set();

  for (const entry of [...entries].sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))) {
    const timestamp = Date.parse(entry.generatedAt ?? "");
    // The first scan is a baseline inventory, not a news event.
    if (!entry.previousGeneratedAt || !Number.isFinite(timestamp) ||
        timestamp > now.getTime() + 300000 || timestamp < minDate) continue;
    for (const offer of entry.interesting ?? []) {
      const text = String(offer?.text ?? "");
      const venue = String(offer?.venue?.name ?? "");
      const stableKey = String(offer?.stableKey ?? "");
      if (!text || !venue || !stableKey || dedupe.has(stableKey) ||
          offer.isUtilityBadge || isDeliveryOffer(offer) ||
          isLikelyAcquisitionOffer(text) || repeated.has(offerTextKey(text))) continue;
      dedupe.add(stableKey);
      const link = publicVenueLink(offer.venue?.link, cityUrl);
      const guid = city.id + ":" + stableKey + ":" + entry.generatedAt;
      items.push({ title: venue + ": " + text, text, link, pubDate: new Date(timestamp).toUTCString(), guid });
      if (items.length >= MAX_ITEMS) break;
    }
    if (items.length >= MAX_ITEMS) break;
  }
  const label = city.label || city.name;
  const itemMarkup = items.map((item) =>
    "<item><title>" + xml(item.title) + "</title><link>" + xml(item.link) +
    "</link><guid isPermaLink='false'>" + xml(item.guid) +
    "</guid><pubDate>" + xml(item.pubDate) +
    "</pubDate><description>" + xml(item.text + ". Check final price and terms in Wolt.") +
    "</description></item>").join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0"><channel>\n' +
    '<title>' + xml("Wolt offers in " + label) + '</title>\n' +
    '<link>' + xml(cityUrl) + '</link>\n' +
    '<description>Recently detected public Wolt deals. Check final terms and eligibility in Wolt.</description>\n' +
    '<language>en</language>\n' +
    '<atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="' + xml(feedUrl) +
      '" rel="self" type="application/rss+xml"/>\n' +
    itemMarkup + '\n</channel></rss>\n';
}
