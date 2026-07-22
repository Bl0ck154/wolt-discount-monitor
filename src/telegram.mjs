const MAX_NEW_GROUPS = 15;
const MAX_ENDED_GROUPS = 10;

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
  const appearedGroups = groupOffers(notification.appeared ?? notification.interestingAppeared ?? []);
  const endedGroups = groupOffers(notification.ended ?? []);
  const lines = [
    `➕ <b>${newCountLabel(appearedGroups.length)}</b> · ➖ <b>${endedCountLabel(endedGroups.length)}</b>`,
  ];

  if (appearedGroups.length) {
    lines.push("", "<b>🔥 Нові вигідні пропозиції</b>");
    for (const group of appearedGroups.slice(0, MAX_NEW_GROUPS)) {
      lines.push(formatOfferGroup(group, false));
    }
    if (appearedGroups.length > MAX_NEW_GROUPS) {
      lines.push(`…і ще ${appearedGroups.length - MAX_NEW_GROUPS} нових.`);
    }
  }

  if (endedGroups.length) {
    lines.push("", "<b>Завершилися</b>");
    for (const group of endedGroups.slice(0, MAX_ENDED_GROUPS)) {
      lines.push(formatOfferGroup(group, true));
    }
    if (endedGroups.length > MAX_ENDED_GROUPS) {
      lines.push(`…і ще ${endedGroups.length - MAX_ENDED_GROUPS} завершених.`);
    }
  }

  if (!appearedGroups.length && !endedGroups.length) {
    lines.push("", "Нових пропозицій, що проходять поріг вигоди, немає.");
  }

  return lines.join("\n");
}

function groupOffers(offers) {
  const groups = new Map();

  for (const offer of offers) {
    const rootName = chainRootName(offer.venue?.name);
    const key = [rootName.toLowerCase(), offer.campaignId ?? offer.text].join("|");
    const group = groups.get(key) ?? { rootName, offer, offers: [], score: offerValueScore(offer) };
    group.offers.push(offer);
    if (offerValueScore(offer) > group.score) {
      group.offer = offer;
      group.score = offerValueScore(offer);
    }
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) =>
    b.score - a.score || a.rootName.localeCompare(b.rootName, "en"));
}

function formatOfferGroup(group, ended) {
  const offer = group.offer;
  const venueName = formatVenueLink(group.rootName, offer.venue?.link);
  const offerText = escapeHtml(offer.text);
  const locationCount = group.offers.length > 1 ? ` · ${group.offers.length} локацій` : "";
  const score = offerValueScore(offer);
  const icon = ended ? "❌" : tierIcon(offer.valueTier ?? offer.value?.tier, score);

  return `${icon} ${venueName}${locationCount}\n   ${offerText}`;
}

function offerValueScore(offer) {
  const score = Number(offer?.valueScore ?? offer?.value?.score ?? offer?.score);
  return Number.isFinite(score) ? score : 0;
}

function tierIcon(tier, score) {
  if (tier === "exceptional" || score >= 75) return "💎";
  if (tier === "great" || score >= 60) return "🔥";
  return "✅";
}

function newCountLabel(count) {
  if (count === 1) return "1 нова";
  if (count >= 2 && count <= 4) return `${count} нові`;
  return `${count} нових`;
}

function endedCountLabel(count) {
  if (count === 1) return "1 завершилась";
  return `${count} завершились`;
}

function formatVenueLink(name, link) {
  const escapedName = escapeHtml(name);
  if (!link) {
    return `<b>${escapedName}</b>`;
  }
  return `<a href="${escapeHtml(link)}"><b>${escapedName}</b></a>`;
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
