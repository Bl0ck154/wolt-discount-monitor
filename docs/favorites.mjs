// Saved venues are browser-only, never sent to a server.
export function favoriteKey(cityId, venueId) {
 const city = String(cityId ?? "").trim(), venue = String(venueId ?? "").trim();
 return city && venue && city.length < 100 && venue.length < 160 ? city + "|" + venue : "";
}
export function parseFavorites(raw) {
 try { const data = JSON.parse(raw);
  return new Set(Array.isArray(data) ? data.filter((v) => typeof v === "string" && v.length < 280).slice(0,300) : []);
 } catch { return new Set(); }
}
export const serializeFavorites = (value) => JSON.stringify([...value].slice(0,300));
