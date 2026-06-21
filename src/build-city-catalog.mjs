import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PATHS } from "./config.mjs";
import { fetchWoltCityCatalog } from "./wolt-cities.mjs";

const catalog = await fetchWoltCityCatalog();
await mkdir(dirname(PATHS.cityCatalog), { recursive: true });
await writeFile(PATHS.cityCatalog, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ wrote: PATHS.cityCatalog, totalCities: catalog.totalCities, totalCountries: catalog.totalCountries }, null, 2));
