import { CITY } from "./config.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { fetchCityData } from "./wolt-api.mjs";
import { compactSnapshot, jsonText } from "./public-snapshot.mjs";

const snapshot = compactSnapshot(normalizeSnapshot(await fetchCityData(CITY)));
process.stdout.write(jsonText(snapshot));
