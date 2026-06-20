import { fetchVilniusData } from "./wolt-api.mjs";
import { normalizeSnapshot } from "./normalize.mjs";

const snapshot = normalizeSnapshot(await fetchVilniusData());
console.log(JSON.stringify(snapshot, null, 2));
