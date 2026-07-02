const DEFAULT_DASHBOARD_URL = "https://bl0ck154.github.io/wolt-discount-monitor/";

export async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { skipped: true, reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set" };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body}`);
  }

  return { skipped: false };
}

export function formatTelegramMessage(notification) {
  const appeared = notification.appeared ?? notification.interestingAppeared ?? [];
  const ended = notification.ended ?? [];
  const appearedGroups = groupOffers(appeared);
  const endedGroups = groupOffers(ended);
  const lines = [formatCityLine(notification.city)];

  if (appeared.length) {
    for (const group of appearedGroups.slice(0, 30)) {
      lines.push(formatOfferGroupLine("🔥", group));
    }
    if (appearedGroups.length > 30) {
      lines.push(`...and ${appearedGroups.length - 30} more new offers.`);
    }
  }

  if (ended.length) {
    for (const group of endedGroups.slice(0, 30)) {
      lines.push(formatOfferGroupLine("❌", group));
    }
    if (endedGroups.length > 30) {
      lines.push(`...and ${endedGroups.length - 30} more ended offers.`);
    }
  }

  if (!appeared.length && !ended.length) {
    lines.push("No notification-worthy changes.");
  }

  return lines.join("\n");
}

function groupOffers(offers) {
  const groups = new Map();

  for (const offer of offers) {
    const rootName = chainRootName(offer.venue.name);
    const key = [rootName.toLowerCase(), offer.campaignId ?? offer.text].join("|");
    const group = groups.get(key) ?? { rootName, offer, offers: [] };
    group.offers.push(offer);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function formatOfferGroupLine(prefix, group) {
  const offer = group.offer;
  const venueName = formatVenueLink(group.rootName, offer.venue.link);
  const offerText = escapeHtml(offer.text);
  const locationCount = group.offers.length > 1 ? ` · ${group.offers.length} locations` : "";
  return `${prefix} ${venueName}${locationCount}: ${offerText}`;
}

function formatCityLine(city = {}) {
  const cityName = escapeHtml(city.name ?? "Vilnius");
  return `<a href="${escapeHtml(dashboardUrl(city))}"><b>${cityName}</b></a>`;
}

function formatVenueLink(name, link) {
  const escapedName = escapeHtml(name);
  if (!link) {
    return `<b>${escapedName}</b>`;
  }
  return `<a href="${escapeHtml(link)}"><b>${escapedName}</b></a>`;
}

function dashboardUrl(city = {}) {
  const baseUrl = String(process.env.WOLT_DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL).trim() || DEFAULT_DASHBOARD_URL;
  if (!city.id || city.id === "ltu/vilnius" || city.id === "vilnius") {
    return baseUrl;
  }

  const url = new URL(baseUrl);
  url.searchParams.set("city", city.id);
  return url.toString();
}

function chainRootName(name = "") {
  return String(name)
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+-\s+[^-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim() || String(name);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
