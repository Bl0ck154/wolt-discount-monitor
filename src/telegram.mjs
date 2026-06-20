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

export function formatTelegramMessage(changes) {
  const offers = changes.interestingAppeared.slice(0, 20);
  const lines = [
    "<b>Wolt Vilnius discounts</b>",
    `New interesting offers: <b>${changes.interestingAppeared.length}</b>`,
    `All appeared: ${changes.appeared.length}, disappeared: ${changes.disappeared.length}`,
    "",
  ];

  for (const offer of offers) {
    const venueName = escapeHtml(offer.venue.name);
    const offerText = escapeHtml(offer.text);
    const amount = offer.amountLabel ? ` (${escapeHtml(offer.amountLabel)})` : "";
    const link = offer.venue.link ? `\n${escapeHtml(offer.venue.link)}` : "";
    lines.push(`• <b>${venueName}</b>: ${offerText}${amount}${link}`);
  }

  if (changes.interestingAppeared.length > offers.length) {
    lines.push(`...and ${changes.interestingAppeared.length - offers.length} more.`);
  }

  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
