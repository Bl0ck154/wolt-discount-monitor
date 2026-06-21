import { CITY } from "./config.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { fetchCityData } from "./wolt-api.mjs";

const snapshot = normalizeSnapshot(await fetchCityData(CITY));
console.log(JSON.stringify(snapshot, null, 2));
