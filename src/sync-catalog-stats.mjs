import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function syncCatalogStats({
  indexPath = fileURLToPath(new URL("../docs/data/cities.json", import.meta.url)),
  readmePath = fileURLToPath(new URL("../README.md", import.meta.url)),
} = {}) {
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const totalCities = index.cities?.length;
  const countries = new Set((index.cities ?? []).map((city) => city.countryCode2)).size;
  if (!Number.isInteger(totalCities) || totalCities <= 0 || countries <= 0) {
    throw new Error("Cannot update README from empty city catalog");
  }
  const input = await readFile(readmePath, "utf8");
  const output = input
    .replace(/discovered_cities-\d+-/, "discovered_cities-" + totalCities + "-")
    .replace(/countries-\d+-/, "countries-" + countries + "-")
    .replace(/Search a discovered catalog of \*\*\d+ Wolt cities across \d+ countries\*\*/,
      "Search a discovered catalog of **" + totalCities + " Wolt cities across " + countries + " countries**");
  if (output === input && !input.includes("discovered_cities-" + totalCities + "-")) {
    throw new Error("README count markers changed; refusing silent drift");
  }
  if (output !== input) await writeFile(readmePath, output);
  return { totalCities, countries, changed: output !== input };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  syncCatalogStats().then((summary) => console.log(JSON.stringify(summary)))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
