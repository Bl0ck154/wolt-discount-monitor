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
  const lines = [
    "<b>Wolt Vilnius discounts</b>",
    `New valuable offers: <b>${appeared.length}</b>`,
    `Ended tracked offers: <b>${ended.length}</b>`,
    notification.allAppeared !== undefined
      ? `All appeared: ${notification.allAppeared}, disappeared: ${notification.allDisappeared}`
      : null,
    "",
  ].filter((line) => line !== null);

  if (appeared.length) {
    lines.push("<b>New:</b>");
    for (const offer of appeared.slice(0, 30)) {
      lines.push(formatOfferLine("•", offer));
    }
    if (appeared.length > 30) {
      lines.push(`...and ${appeared.length - 30} more new offers.`);
    }
  }

  if (ended.length) {
    if (appeared.length) {
      lines.push("");
    }
    lines.push("<b>Ended / акції більше немає:</b>");
    for (const offer of ended.slice(0, 30)) {
      lines.push(formatOfferLine("✖", offer));
    }
    if (ended.length > 30) {
      lines.push(`...and ${ended.length - 30} more ended offers.`);
    }
  }

  if (!appeared.length && !ended.length) {
    lines.push("No notification-worthy changes.");
  }

  return lines.join("\n");
}

function formatOfferLine(prefix, offer) {
  const venueName = escapeHtml(offer.venue.name);
  const offerText = escapeHtml(offer.text);
  const amount = offer.amountLabel ? ` (${escapeHtml(offer.amountLabel)})` : "";
  const link = offer.venue.link ? `\n${escapeHtml(offer.venue.link)}` : "";
  return `${prefix} <b>${venueName}</b>: ${offerText}${amount}${link}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
