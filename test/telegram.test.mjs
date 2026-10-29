import test from "node:test";
import assert from "node:assert/strict";

import { formatTelegramMessage, sendTelegramMessage } from "../src/telegram.mjs";

function offer({ venue, campaignId, text, score, tier = "good" }) {
  return {
    venue: {
      name: venue,
      link: "https://wolt.example/venue",
      productLine: "restaurant",
    },
    campaignId,
    text,
    valueScore: score,
    valueTier: tier,
  };
}

test("Telegram starts with grouped added/ended summary and ranks best first", () => {
  const text = formatTelegramMessage({
    city: { id: "ltu/vilnius", name: "Vilnius" },
    appeared: [
      offer({ venue: "Chain (North)", campaignId: "cash", text: "5 € off", score: 81, tier: "exceptional" }),
      offer({ venue: "Chain (South)", campaignId: "another-internal-id", text: "5 € off", score: 81, tier: "exceptional" }),
      offer({ venue: "Market", campaignId: "grocery", text: "10% off", score: 46 }),
    ],
    ended: [
      offer({ venue: "Old Place", campaignId: "old", text: "20% off", score: 51 }),
    ],
  });

  assert.ok(text.startsWith('📍 <a href="https://bl0ck154.github.io/wolt-discount-monitor/?city=ltu%2Fvilnius"><b>Vilnius</b></a>\n' + "➕ <b>2 нові</b> · ➖ <b>1 завершилась</b>"));
  assert.ok(text.indexOf("Chain") < text.indexOf("Market"));
  assert.match(text, /2 локацій/);
  assert.doesNotMatch(text, /(?:рейтинг за реальною вигодою|81\/100|дуже вигідно)/);
  assert.ok(text.indexOf("Нові вигідні пропозиції") < text.indexOf("Завершилися"));
});

test("Nuremberg Telegram alerts are identified by city", () => {
  const message = formatTelegramMessage({
    city: { id: "deu/nuremberg", name: "Nuremberg" },
    appeared: [offer({ venue: "Rice Spot", campaignId: "lunch", text: "20% off", score: 65 })],
    ended: [],
  });
  assert.match(message, /^📍 <a href="https:\/\/bl0ck154\.github\.io\/wolt-discount-monitor\/\?city=deu%2Fnuremberg"><b>Nuremberg<\/b><\/a>\n➕/);
});

test("Telegram escapes venue and offer HTML", () => {
  const text = formatTelegramMessage({
    city: { id: "ltu/vilnius", name: "Vilnius" },
    appeared: [offer({ venue: "A&B <Shop>", campaignId: "x", text: "20% <off>", score: 50 })],
    ended: [],
  });
  assert.match(text, /A&amp;B &lt;Shop&gt;/);
  assert.match(text, /20% &lt;off&gt;/);
  assert.match(text, /<b>Vilnius<\/b><\/a>/);
});

test("Telegram refuses to silently drop a pending production notification", async () => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousChatId = process.env.TELEGRAM_CHAT_ID;
  const previousAllowSkip = process.env.TELEGRAM_ALLOW_SKIP;

  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_ALLOW_SKIP;
    await assert.rejects(sendTelegramMessage("test"), /refusing to lose a pending notification/);

    process.env.TELEGRAM_ALLOW_SKIP = "true";
    const result = await sendTelegramMessage("test");
    assert.equal(result.skipped, true);
  } finally {
    restoreEnv("TELEGRAM_BOT_TOKEN", previousToken);
    restoreEnv("TELEGRAM_CHAT_ID", previousChatId);
    restoreEnv("TELEGRAM_ALLOW_SKIP", previousAllowSkip);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
