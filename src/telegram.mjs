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
  const lines = [
    "<b>Wolt discount monitor · Vilnius</b>",
    `New valuable offers: <b>${appearedGroups.length}</b>`,
    `Ended tracked offers: <b>${endedGroups.length}</b>`,
    notification.allAppeared !== undefined
      ? `All appeared: ${notification.allAppeared}, disappeared: ${notification.allDisappeared}`
      : null,
    "",
  ].filter((line) => line !== null);

  if (appeared.length) {
    lines.push("<b>New:</b>");
    for (const group of appearedGroups.slice(0, 30)) {
      lines.push(formatOfferGroupLine("•", group));
    }
    if (appearedGroups.length > 30) {
      lines.push(`...and ${appearedGroups.length - 30} more new grouped offers.`);
    }
  }

  if (ended.length) {
    if (appeared.length) {
      lines.push("");
    }
    lines.push("<b>Ended:</b>");
    for (const group of endedGroups.slice(0, 30)) {
      lines.push(formatOfferGroupLine("✖", group));
    }
    if (endedGroups.length > 30) {
      lines.push(`...and ${endedGroups.length - 30} more ended grouped offers.`);
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
  const venueName = escapeHtml(group.rootName);
  const offerText = escapeHtml(offer.text);
  const amount = offer.amountLabel ? ` (${escapeHtml(offer.amountLabel)})` : "";
  const locationCount = group.offers.length > 1 ? ` · ${group.offers.length} locations` : "";
  const link = offer.venue.link ? `\n${escapeHtml(offer.venue.link)}` : "";
  return `${prefix} <b>${venueName}</b>${locationCount}: ${offerText}${amount}${link}`;
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
