// Explicit Wolt link clicks only. Aggregate by day and city at the edge.
// No URL, IP, basket, account or visitor identifier is sent.
export const METRICS_URL = "https://wolt-click-analytics.bl0ck-c1b.workers.dev/api/click";
export function isWoltLink(href) {
  try {
    const parsed = new URL(href);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "wolt.com" || parsed.hostname.endsWith(".wolt.com"));
  } catch { return false; }
}
export function pageCityId(urlString, saved = "") {
  try {
    const url = new URL(urlString);
    const path = url.pathname.match(/\/(?:de\/|lt\/|pl\/|cs\/)?cities\/([a-z]{3})\/([a-z0-9-]+)\/?$/);
    const value = path ? path[1] + "/" + path[2] :
      (url.searchParams.get("city") || saved);
    return /^[a-z]{3}\/[a-z0-9-]{2,70}$/.test(value) ? value : null;
  } catch { return null; }
}
export function trackOutboundClick(cityId, {send = (url,body) => navigator.sendBeacon(url,body)} = {}) {
  if (!/^[a-z]{3}\/[a-z0-9-]{2,70}$/.test(cityId ?? "")) return false;
  try { return send(METRICS_URL, JSON.stringify({ cityId })) === true; }
  catch { return false; }
}
export function attachOutboundTracking(doc = document) {
  doc.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a[href]");
    if (!link || !isWoltLink(link.href)) return;
    const url = doc.defaultView?.location ?? location;
    let saved = "";
    try { saved = doc.defaultView?.localStorage?.getItem("WOLT_SELECTED_CITY") ?? ""; } catch {}
    const cityId = pageCityId(url.href, saved || "ltu/vilnius");
    if (cityId) trackOutboundClick(cityId);
  }, { capture: true });
}
if (typeof document !== "undefined") attachOutboundTracking(document);
