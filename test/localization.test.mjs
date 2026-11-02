import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLanguage, translate } from "../docs/i18n.mjs";
test("consumer languages preserve full regional locale tags and default to English", () => {
 assert.equal(normalizeLanguage("de-DE"), "de");
 assert.equal(normalizeLanguage("lt-LT"), "lt");
 assert.equal(normalizeLanguage("cs-CZ"), "cs");
 assert.equal(normalizeLanguage("unknown"), "en");
 assert.match(translate("de", "closed"), /geschlossen/i);
 assert.match(translate("pl", "search"), /Szukaj/);
 assert.equal(translate("xx", "deals"), translate("en", "deals"));
});
