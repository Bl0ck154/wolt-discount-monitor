import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extended } from "../docs/i18n-extra.mjs";
import { normalizeLanguage, translate, formatMessage } from "../docs/i18n.mjs";
import { offerFeedbackUrl } from "../docs/feedback.mjs";

test("the five supported consumer languages provide the same translation keys", () => {
 for (const lang of ["en","de","lt","pl","cs"]) {
  assert.equal(normalizeLanguage(lang + "-XX"), lang);
  assert.deepEqual(Object.keys(extended[lang]).sort(), Object.keys(extended.en).sort());
  assert.equal(translate(lang, "reportOffer").length > 5, true);
  assert.equal(formatMessage(lang, "loadingCity", {city:"Nürnberg"}).includes("Nürnberg"), true);
 }
});
test("opt-in feedback link safely URL-encodes a public venue and does not send anything automatically", () => {
 const link = new URL(offerFeedbackUrl({city:"Vilnius", venue:'A&B <shop>', offer:"20% off"}));
 assert.equal(link.hostname, "github.com");
 assert.equal(link.pathname, "/Bl0ck154/wolt-discount-monitor/issues/new");
 assert.match(link.searchParams.get("body"), /Vilnius/);
 assert.match(link.searchParams.get("body"), /20% off/);
 assert.doesNotMatch(link.href, /javascript:/);
});
test("dashboard and Pages build include the localization and feedback modules", async () => {
 const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
 const workflow = await readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
 const app = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
 assert.match(html, /data-i18n-placeholder="citySearchPlaceholder"/);
 assert.match(workflow, /docs\/i18n-extra\.mjs/);
 assert.match(workflow, /docs\/feedback\.mjs/);
 assert.match(workflow, /docs\/feeds/);
 assert.match(app, /offerFeedbackUrl/);
});

test("shopper page shows scan availability and a safe RSS subscription link", async () => {
 const app = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
 const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
 const mobile = await readFile(new URL("../docs/mobile.css", import.meta.url), "utf8");
 assert.match(html, /id="cityRssLink"/);
 assert.match(app, /hasRecentSnapshot/);
 assert.match(app, /scanNeeded/);
 assert.match(mobile, /min-height: 44px/);
});

test("city results handoff and venue metadata are present", async () => {
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../docs/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="dealsJumpLink"/);
  assert.match(app, /waitingForFirstScan/);
  assert.match(app, /dealsSection.scrollIntoView/);
  assert.match(app, /ratingScore/);
  assert.match(app, /venue-address-link/);
  assert.match(css, /has-selected-city/);
});

test("venue layout keeps actions secondary and favorites anchored to image", async () => {
  const app = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../docs/styles.css", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../docs/mobile.css", import.meta.url), "utf8");
  assert.match(app, /class="venue-photo"/);
  assert.match(app, /class="venue-rating venue-rating-missing"/);
  assert.match(app, /class="venue-actions"/);
  assert.match(css, /\.venue-photo \.bookmark \{/);
  assert.match(css, /\.venue-actions-panel/);
  assert.match(mobile, /\.venue-photo \{ width: 52px/);
});

test("legacy snapshots trigger one background refresh for real Wolt ratings", async () => {
  const source = await readFile(new URL("../docs/app.js", import.meta.url), "utf8");
  const scan = await readFile(new URL("../src/check-discounts.mjs", import.meta.url), "utf8");
  assert.match(source, /cached\.snapshot\.schemaVersion !== 2/);
  assert.match(scan, /previous\?\.schemaVersion === 2/);
});

test("desktop uses explicit table proportions while mobile uses venue cards", async () => {
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../docs/styles.css", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../docs/mobile.css", import.meta.url), "utf8");
  assert.match(html, /class="col-venue"/);
  assert.match(html, /class="col-map"/);
  assert.match(css, /\.col-offers \{ width:/);
  assert.match(mobile, /colgroup \{ display: none;/);
});
