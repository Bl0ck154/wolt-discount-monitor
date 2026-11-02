import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncCatalogStats } from "../src/sync-catalog-stats.mjs";

test("catalog counts are synced into README markers without hard-coded numbers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wolt-catalog-"));
  try {
    const indexPath = join(dir, "cities.json");
    const readmePath = join(dir, "README.md");
    await writeFile(indexPath, JSON.stringify({ cities: [
      { countryCode2: "DE" }, { countryCode2: "LT" }, { countryCode2: "DE" },
    ] }));
    await writeFile(readmePath, "![Cities](discovered_cities-964-blue)\n![Countries](countries-30-green)\nSearch a discovered catalog of **964 Wolt cities across 30 countries**.");
    const updated = await syncCatalogStats({ indexPath, readmePath });
    assert.deepEqual(updated, { totalCities: 3, countries: 2, changed: true });
    const result = await readFile(readmePath, "utf8");
    assert.match(result, /discovered_cities-3-blue/);
    assert.match(result, /countries-2-green/);
    assert.match(result, /\*\*3 Wolt cities across 2 countries\*\*/);
    assert.equal((await syncCatalogStats({ indexPath, readmePath })).changed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
