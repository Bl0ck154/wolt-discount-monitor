import test from "node:test";
import assert from "node:assert/strict";
import { favoriteKey, parseFavorites, serializeFavorites } from "../docs/favorites.mjs";
test("local favorites roundtrip and are scoped to a city", () => {
 const k = favoriteKey("deu/nuremberg","venue-x");
 assert.equal(k, "deu/nuremberg|venue-x");
 assert.notEqual(k, favoriteKey("ltu/vilnius","venue-x"));
 assert.deepEqual([...parseFavorites(serializeFavorites(new Set([k])))],[k]);
 assert.equal(parseFavorites("{broken").size,0);
 assert.equal(favoriteKey("","venue"),"");
});
