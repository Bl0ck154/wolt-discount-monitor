const DEFAULT_API_BASE_URL = "https://wolt-api.zivkr.pp.ua";

const state = {
  snapshot: null,
  citiesIndex: null,
  selectedCity: null,
  apiBaseUrl: apiBaseUrl(),
  snapshotSourceUrl: null,
  snapshotSourceLabel: null,
  cityPickerOpen: false,
  loadRequestId: 0,
  ubiquitousOfferKeys: new Set(),
  ubiquitousOfferLabels: [],
  rows: [],
  sortKey: "best",
  sortDir: "desc",
};

const elements = {
  cityLabel: document.querySelector("#cityLabel"),
  cityMapLink: document.querySelector("#cityMapLink"),
  cityPicker: document.querySelector("#cityPicker"),
  citySearch: document.querySelector("#citySearch"),
  cityOptions: document.querySelector("#cityOptions"),
  promoCount: document.querySelector("#promoCount"),
  restaurantCount: document.querySelector("#restaurantCount"),
  updatedAt: document.querySelector("#updatedAt"),
  searchInput: document.querySelector("#searchInput"),
  productFilter: document.querySelector("#productFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  hideNewUserDelivery: document.querySelector("#hideNewUserDelivery"),
  hideDeliveryDiscounts: document.querySelector("#hideDeliveryDiscounts"),
  hiddenCitywideOffers: document.querySelector("#hiddenCitywideOffers"),
  shownCount: document.querySelector("#shownCount"),
  venueRows: document.querySelector("#venueRows"),
  sortHeaders: document.querySelectorAll(".sort-header"),
};

init().catch((error) => {
  elements.venueRows.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
});

async function init() {
  state.citiesIndex = await loadCitiesIndex();
  bindCityPicker();
  renderCityOptions();

  const cityId = requestedCityId();
  await loadSnapshotForCity(cityId);
  bindControls();
}

async function loadSnapshotForCity(cityId) {
  const requestId = ++state.loadRequestId;
  const city = cityById(cityId) ?? defaultCity();
  showLoading(city);

  let staticResult;
  try {
    staticResult = await loadStaticSnapshot(city);
  } catch (error) {
    if (!isCurrentLoad(requestId)) {
      return;
    }
    throw error;
  }
  if (!isCurrentLoad(requestId)) {
    return;
  }

  const shouldUseApi = state.apiBaseUrl && (!staticResult.ok || isSnapshotStale(staticResult.snapshot));

  if (shouldUseApi) {
    try {
      const apiResult = await loadApiSnapshot(city);
      if (!isCurrentLoad(requestId)) {
        return;
      }
      applySnapshot(city, apiResult.snapshot, apiResult.url, "live API cache");
      return;
    } catch (error) {
      if (!isCurrentLoad(requestId)) {
        return;
      }
      if (!staticResult.ok) {
        throw error;
      }
      console.warn("Live API failed; falling back to static cache", error);
      applySnapshot(city, staticResult.snapshot, staticResult.url, "stale static cache");
      return;
    }
  }

  if (!staticResult.ok) {
    throw new Error(apiDisabledMessage(city));
  }

  applySnapshot(city, staticResult.snapshot, staticResult.url, "static cache");
}

function isCurrentLoad(requestId) {
  return requestId === state.loadRequestId;
}

async function loadStaticSnapshot(city) {
  const url = dataPathForCity(city);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return { ok: false, status: response.status, url };
  }
  return { ok: true, url, snapshot: await response.json() };
}

async function loadApiSnapshot(city) {
  const url = apiUrlForCity(city);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Live API failed for ${city.label ?? city.name}: ${response.status} ${response.statusText}${message ? ` · ${message.slice(0, 200)}` : ""}`);
  }
  return { url, snapshot: await response.json() };
}

function applySnapshot(city, snapshot, sourceUrl, sourceLabel) {
  state.snapshot = snapshot;
  state.selectedCity = { ...(state.snapshot.city ?? {}), ...city };
  state.snapshotSourceUrl = sourceUrl;
  state.snapshotSourceLabel = sourceLabel;
  state.rows = state.snapshot.venues ?? [];
  const ubiquitousOffers = ubiquitousOfferIndex(state.rows);
  state.ubiquitousOfferKeys = ubiquitousOffers.keys;
  state.ubiquitousOfferLabels = ubiquitousOffers.labels;
  syncCityPickerValue();
  safeLocalStorageSet("WOLT_SELECTED_CITY", state.selectedCity.id);
  rememberCachedCity(state.selectedCity, state.snapshot);
  hydrateSummary();
  hydrateFilters();
  renderRows();
}

function showLoading(city) {
  state.selectedCity = city;
  state.snapshot = null;
  state.snapshotSourceUrl = null;
  state.snapshotSourceLabel = null;
  state.ubiquitousOfferKeys = new Set();
  state.ubiquitousOfferLabels = [];
  state.rows = [];
  elements.citySearch.value = cityLabelText(city);
  hydrateSummary();
  hydrateFilters();
  hydrateHiddenCitywideOffers();
  elements.venueRows.innerHTML = `<tr><td colspan="7" class="empty">Loading ${escapeHtml(city.label ?? city.name)}...</td></tr>`;
}

async function loadCitiesIndex() {
  const local = await loadLocalCitiesIndex();

  if (state.apiBaseUrl) {
    try {
      return mergeCityIndexes(local, await loadApiCitiesIndex());
    } catch (error) {
      console.warn("Failed to load live API city index", error);
    }
  }

  return local;
}

async function loadLocalCitiesIndex() {
  const response = await fetch("data/cities.json", { cache: "no-store" });
  if (response.ok) {
    return response.json();
  }

  return {
    defaultCityId: "ltu/vilnius",
    cities: [
      {
        id: "ltu/vilnius",
        key: "ltu-vilnius",
        slug: "vilnius",
        name: "Vilnius",
        country: "Lithuania",
        countryCode: "ltu",
        countryCode2: "LT",
        countryCode3: "LTU",
        lat: 54.6901231,
        lon: 25.2682558,
        locale: "en",
        label: "Vilnius, Lithuania",
        latestPath: "data/latest.json",
        dataPath: "data/latest.json",
      },
    ],
  };
}

async function loadApiCitiesIndex() {
  const response = await fetch(`${state.apiBaseUrl}/api/cities`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function mergeCityIndexes(local, remote) {
  const localById = new Map((local.cities ?? []).map((city) => [city.id, city]));
  return {
    ...local,
    apiGeneratedAt: remote.generatedAt,
    cities: (remote.cities ?? local.cities ?? []).map((city) => ({
      ...localById.get(city.id),
      ...city,
    })),
  };
}

function bindCityPicker() {
  elements.citySearch.addEventListener("focus", () => {
    openCityPicker();
    elements.citySearch.select();
  });
  elements.citySearch.addEventListener("input", () => {
    openCityPicker();
    renderCityOptions(elements.citySearch.value);
  });
  elements.citySearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCityPicker();
      syncCityPickerValue();
    }
    if (event.key === "Enter") {
      const first = elements.cityOptions.querySelector("[data-city-id]");
      if (first) {
        event.preventDefault();
        chooseCity(first.dataset.cityId);
      }
    }
  });
  elements.cityOptions.addEventListener("click", (event) => {
    const option = event.target.closest("[data-city-id]");
    if (option) {
      chooseCity(option.dataset.cityId);
    }
  });
  document.addEventListener("click", (event) => {
    if (!elements.cityPicker.contains(event.target)) {
      closeCityPicker();
      syncCityPickerValue();
    }
  });
}

function openCityPicker() {
  state.cityPickerOpen = true;
  elements.cityOptions.hidden = false;
  elements.citySearch.setAttribute("aria-expanded", "true");
}

function closeCityPicker() {
  state.cityPickerOpen = false;
  elements.cityOptions.hidden = true;
  elements.citySearch.setAttribute("aria-expanded", "false");
}

function chooseCity(cityId) {
  const city = cityById(cityId);
  if (!city) {
    return;
  }
  closeCityPicker();
  elements.citySearch.value = cityLabelText(city);
  setCityInUrl(city.id);
  safeLocalStorageSet("WOLT_SELECTED_CITY", city.id);
  loadSnapshotForCity(city.id).catch((error) => showError(error));
}

function syncCityPickerValue() {
  elements.citySearch.value = cityLabelText(state.selectedCity ?? defaultCity());
  renderCityOptions();
}

function renderCityOptions(query = "") {
  elements.cityOptions.innerHTML = groupedCityOptions(filteredCities(query)).join("") || `<div class="city-empty">No matching cities</div>`;
}

function filteredCities(query) {
  const normalized = query.trim().toLowerCase();
  const cities = state.citiesIndex.cities ?? [];
  if (!normalized || normalized === cityLabelText(state.selectedCity ?? {}).toLowerCase()) {
    return cities;
  }
  return cities.filter((city) => citySearchText(city).includes(normalized));
}

function groupedCityOptions(cities) {
  const groups = new Map();
  for (const city of cities) {
    const country = city.country ?? "Other";
    if (!groups.has(country)) {
      groups.set(country, []);
    }
    groups.get(country).push(city);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([country, countryCities]) => {
      const options = countryCities
        .sort((a, b) => a.name.localeCompare(b.name, "en"))
        .map((city) => {
          const selected = city.id === state.selectedCity?.id ? " is-selected" : "";
          const status = city.updatedAt ? "Cached" : "Not cached";
          return `<button class="city-option${selected}" type="button" role="option" data-city-id="${escapeHtml(city.id)}" aria-selected="${city.id === state.selectedCity?.id}">
            <span>${escapeHtml(city.name)}</span>
            <small>${escapeHtml([city.country, status].filter(Boolean).join(" · "))}</small>
          </button>`;
        })
        .join("");
      return `<div class="city-group"><div class="city-group-title">${escapeHtml(country)}</div>${options}</div>`;
    });
}

function hydrateSummary() {
  const city = state.selectedCity ?? {};
  const label = city.label ?? [city.name, city.country].filter(Boolean).join(", ");
  elements.cityLabel.textContent = label || "Unknown city";
  elements.cityMapLink.href = cityMapUrl(city);
  elements.cityMapLink.title = `Open ${label} coordinates in Maps`;
  elements.cityMapLink.setAttribute("aria-label", `Open ${label} coordinates in Maps`);
  elements.promoCount.textContent = formatNumber(state.snapshot?.counts?.promotionsUniqueVenues);
  elements.restaurantCount.textContent = formatNumber(state.snapshot?.counts?.restaurantsUniqueVenues);
  elements.updatedAt.textContent = state.snapshot?.generatedAt ? new Date(state.snapshot.generatedAt).toLocaleString() : "not cached";
}

function hydrateFilters() {
  const productLines = Object.keys(state.snapshot?.counts?.productLines ?? {});
  elements.productFilter.innerHTML = [
    `<option value="">All types</option>`,
    ...productLines.map((line) => `<option value="${escapeHtml(line)}">${escapeHtml(label(line))}</option>`),
  ].join("");
}

function bindControls() {
  if (bindControls.bound) {
    return;
  }
  bindControls.bound = true;

  elements.searchInput.addEventListener("input", renderRows);
  elements.productFilter.addEventListener("change", renderRows);
  elements.hideNewUserDelivery.addEventListener("change", renderRows);
  elements.hideDeliveryDiscounts.addEventListener("change", renderRows);
  elements.sortSelect.addEventListener("change", () => {
    setSortFromSelect(elements.sortSelect.value);
    renderRows();
  });
  elements.sortHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      setSortFromHeader(header.dataset.sortKey);
      renderRows();
    });
  });
}

function showError(error) {
  elements.venueRows.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
}

function renderRows() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const productLine = elements.productFilter.value;

  const rows = state.rows
    .map((venue) => ({ venue, visibleOffers: visibleOffers(venue) }))
    .filter(({ venue }) => !productLine || venue.productLine === productLine)
    .filter(({ venue }) => matchesQuery(venue, query))
    .sort(sorter());
  const groups = groupRows(rows).slice(0, 1000);
  const rowsWithVisibleOffers = rows.filter(({ visibleOffers }) => visibleOffers.length > 0).length;

  elements.shownCount.textContent = `${formatNumber(rows.length)} shown venues · ${formatNumber(rowsWithVisibleOffers)} with visible offers · ${formatNumber(state.rows.length)} total venues`;
  hydrateHiddenCitywideOffers();
  syncSortUi();

  if (!groups.length) {
    elements.venueRows.innerHTML = `<tr><td colspan="7" class="empty">No matching venues</td></tr>`;
    return;
  }

  elements.venueRows.innerHTML = groups.map((group, index) => renderVenueGroup(group, index + 1)).join("");
}

function renderVenueGroup(group, index) {
  const main = renderVenueRow(group.primary.venue, group.primary.visibleOffers, index, group.rows.length);
  if (group.rows.length === 1) {
    return main;
  }

  const detailRows = group.rows
    .map(({ venue, visibleOffers }, locationIndex) => renderGroupDetailRow(venue, visibleOffers, locationIndex + 1))
    .join("");

  return `${main}
    <tr class="group-details-row">
      <td></td>
      <td colspan="6">
        <details class="group-details">
          <summary>▸ ${escapeHtml(group.rootName)} locations (${group.rows.length})</summary>
          <table class="nested-table">
            <tbody>${detailRows}</tbody>
          </table>
        </details>
      </td>
    </tr>`;
}

function renderVenueRow(venue, visibleOffers, index, groupSize = 1) {
  const image = venue.imageUrl
    ? `<img class="venue-image" src="${escapeHtml(venue.imageUrl)}" alt="" loading="lazy" />`
    : `<div class="venue-image" aria-hidden="true"></div>`;
  const offers = visibleOffers.length
    ? visibleOffers.map((offer) => `<span class="offer ${offerClass(offer)}">${escapeHtml(offer.text)}</span>`).join("")
    : "";
  const best = bestDiscount(venue);
  const mapUrl = mapLink(venue);
  const hours = openingLabel(venue);

  return `
    <tr>
      <td class="num-col row-num">${index}</td>
      <td>
        <div class="venue-cell">
          ${image}
          <div>
            <a class="venue-title" href="${escapeHtml(venue.link ?? "#")}" target="_blank" rel="noreferrer">
              ${escapeHtml(venue.name)}
            </a>
            <div class="venue-meta">${escapeHtml([venue.address, venue.slug, groupSize > 1 ? `${groupSize} locations` : null].filter(Boolean).join(" · "))}</div>
          </div>
        </div>
      </td>
      <td><span class="pill">${escapeHtml(label(venue.productLine ?? "unknown"))}</span></td>
      <td><div class="offer-list">${offers}</div></td>
      <td class="amount">${escapeHtml(best?.label ?? "-")}</td>
      <td><span class="hours ${hours.className}">${escapeHtml(hours.icon)} ${escapeHtml(hours.text)}</span></td>
      <td>${mapUrl ? `<a class="map-link" href="${escapeHtml(mapUrl)}" target="_blank" rel="noreferrer" title="Open in Google Maps">🗺️</a>` : "-"}</td>
    </tr>
  `;
}

function renderGroupDetailRow(venue, visibleOffers, index) {
  const best = bestDiscount(venue);
  const hours = openingLabel(venue);
  const mapUrl = mapLink(venue);
  const offers = visibleOffers.length
    ? visibleOffers.map((offer) => `<span class="offer ${offerClass(offer)}">${escapeHtml(offer.text)}</span>`).join("")
    : "";

  return `<tr>
    <td class="nested-num">${index}</td>
    <td>
      <a class="venue-title" href="${escapeHtml(venue.link ?? "#")}" target="_blank" rel="noreferrer">${escapeHtml(venue.name)}</a>
      <div class="venue-meta">${escapeHtml([venue.address, venue.slug].filter(Boolean).join(" · "))}</div>
    </td>
    <td><div class="offer-list">${offers}</div></td>
    <td class="amount">${escapeHtml(best?.label ?? "-")}</td>
    <td><span class="hours ${hours.className}">${escapeHtml(hours.icon)} ${escapeHtml(hours.text)}</span></td>
    <td>${mapUrl ? `<a class="map-link" href="${escapeHtml(mapUrl)}" target="_blank" rel="noreferrer" title="Open in Google Maps">🗺️</a>` : "-"}</td>
  </tr>`;
}

function groupRows(rows) {
  const chainIndex = buildChainIndex(rows);
  const groups = [];
  const byKey = new Map();

  for (const row of rows) {
    const root = chainRootName(row.venue, chainIndex);
    const rootName = root.label;
    const key = root.key;
    let group = byKey.get(key);
    if (!group) {
      group = { key, rootName, primary: row, rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }

  return groups.map((group) => ({
    ...group,
    rows: group.rows.sort((a, b) => a.venue.name.localeCompare(b.venue.name)),
  }));
}

const MIN_CHAIN_LOCATIONS = 2;
const MAX_CHAIN_PREFIX_TOKENS = 5;
const LOCATION_SUFFIX_TOKENS = new Set([
  "praha",
  "prague",
  "vilnius",
  "kaunas",
  "riga",
  "tallinn",
  "berlin",
  "warsaw",
  "wroclaw",
  "krakow",
]);
const FORMAT_SUFFIX_TOKENS = new Set([
  "express",
  "expres",
  "hypermarket",
  "supermarket",
  "market",
  "kiosk",
  "kiosek",
  "restaurant",
  "restaurace",
  "oc",
  "tc",
  "pc",
  "cc",
  "mall",
]);
const COMMON_SINGLE_TOKEN_ROOTS = new Set([
  "bar",
  "bistro",
  "burger",
  "cafe",
  "coffee",
  "doner",
  "food",
  "grill",
  "kebab",
  "pizza",
  "poke",
  "ramen",
  "restaurant",
  "restaurace",
  "sushi",
  "thai",
  "wok",
]);

function buildChainIndex(rows) {
  const candidates = new Map();
  const rowsByBrandImage = new Map();

  rows.forEach((row, rowIndex) => {
    const imageKey = brandImageKey(row.venue);
    if (!imageKey) {
      return;
    }
    if (!rowsByBrandImage.has(imageKey)) {
      rowsByBrandImage.set(imageKey, []);
    }
    rowsByBrandImage.get(imageKey).push(rowIndex);
  });

  for (const [imageKey, rowIndexes] of rowsByBrandImage.entries()) {
    if (rowIndexes.length < MIN_CHAIN_LOCATIONS) {
      continue;
    }

    for (const rowIndex of rowIndexes) {
      const row = rows[rowIndex];
      const venue = row.venue;
      const sources = [tokensFromText(venue.slug), tokensFromText(venue.name)];
      const rowCandidateKeys = new Set();

      for (const tokens of sources) {
        for (const prefix of chainPrefixes(tokens)) {
          const prefixKey = prefix.join("-");
          const key = `${imageKey}|${prefixKey}`;
          if (!key || rowCandidateKeys.has(key)) {
            continue;
          }
          rowCandidateKeys.add(key);

          if (!candidates.has(key)) {
            candidates.set(key, {
              key,
              tokens: prefix,
              rowIndexes: new Set(),
              displayCounts: new Map(),
            });
          }

          const candidate = candidates.get(key);
          candidate.rowIndexes.add(rowIndex);
          const display = displayRootForPrefix(venue.name, prefix);
          candidate.displayCounts.set(display, (candidate.displayCounts.get(display) ?? 0) + 1);
        }
      }
    }
  }

  const valid = new Map();
  for (const candidate of candidates.values()) {
    if (isValidChainCandidate(candidate, rows)) {
      valid.set(candidate.key, {
        ...candidate,
        label: bestCandidateLabel(candidate),
      });
    }
  }

  return valid;
}

function chainRootName(venue, chainIndex) {
  const imageKey = brandImageKey(venue);
  const candidates = [tokensFromText(venue.slug), tokensFromText(venue.name)]
    .flatMap((tokens) => chainPrefixes(tokens))
    .map((tokens) => imageKey ? chainIndex.get(`${imageKey}|${tokens.join("-")}`) : null)
    .filter(Boolean)
    .sort((a, b) => b.tokens.length - a.tokens.length || b.rowIndexes.size - a.rowIndexes.size);

  const best = candidates[0];
  if (best) {
    return { key: best.key, label: best.label };
  }

  const label = singleVenueRootName(venue.name);
  return { key: `venue:${normalizeForGrouping(label)}`, label };
}

function brandImageKey(venue) {
  return String(venue?.brandImageUrl ?? "").trim();
}

function chainPrefixes(tokens) {
  const prefixes = [];
  const maxLength = Math.min(MAX_CHAIN_PREFIX_TOKENS, tokens.length - 1);
  for (let length = 1; length <= maxLength; length += 1) {
    const prefix = trimChainPrefix(tokens.slice(0, length));
    if (prefix.length) {
      prefixes.push(prefix);
    }
  }

  return uniqueTokenLists(prefixes);
}

function trimChainPrefix(tokens) {
  const result = [...tokens];
  while (result.length > 1 && (LOCATION_SUFFIX_TOKENS.has(last(result)) || FORMAT_SUFFIX_TOKENS.has(last(result)))) {
    result.pop();
  }
  return result;
}

function isValidChainCandidate(candidate, rows) {
  if (candidate.rowIndexes.size < MIN_CHAIN_LOCATIONS) {
    return false;
  }

  if (candidate.tokens.length === 1) {
    const token = candidate.tokens[0];
    if (token.length < 3 || COMMON_SINGLE_TOKEN_ROOTS.has(token)) {
      return false;
    }
  }

  return !isMostlyAddressPrefix(candidate, rows);
}

function isMostlyAddressPrefix(candidate, rows) {
  if (candidate.tokens.length < 2) {
    return false;
  }

  const suffixTokens = candidate.tokens.slice(1);
  let addressMatches = 0;
  for (const rowIndex of candidate.rowIndexes) {
    const addressTokens = new Set(tokensFromText(rows[rowIndex].venue.address));
    if (suffixTokens.some((token) => addressTokens.has(token))) {
      addressMatches += 1;
    }
  }

  return addressMatches / candidate.rowIndexes.size >= 0.6;
}

function bestCandidateLabel(candidate) {
  return [...candidate.displayCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? candidate.tokens.join(" ");
}

function displayRootForPrefix(name, prefixTokens) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const display = [];
  const normalized = [];

  for (const word of words) {
    display.push(word.replace(/[,:;]+$/g, ""));
    normalized.push(...tokensFromText(word));

    const stillMatches = normalized.every((token, index) => prefixTokens[index] === token);
    if (!stillMatches) {
      break;
    }

    if (normalized.length >= prefixTokens.length) {
      return display.join(" ").trim();
    }
  }

  return titleCaseTokens(prefixTokens);
}

function singleVenueRootName(name = "") {
  return String(name)
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+-\s+[^-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim() || String(name);
}

function tokensFromText(value) {
  return normalizeForGrouping(value).split(" ").filter(Boolean);
}

function normalizeForGrouping(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function uniqueTokenLists(lists) {
  const seen = new Set();
  return lists.filter((tokens) => {
    const key = tokens.join("-");
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function titleCaseTokens(tokens) {
  return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ");
}

function last(items) {
  return items[items.length - 1];
}

function visibleOffers(venue) {
  const seen = new Set();
  const offers = sourceOffers(venue).filter((offer) => {
    const key = normalizeOfferText(offer.text).toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);

    if (isUtilityOfferText(offer.text)) {
      return false;
    }

    if (elements.hideNewUserDelivery.checked && isNewUserZeroDelivery(offer.text)) {
      return false;
    }
    if (elements.hideNewUserDelivery.checked && state.ubiquitousOfferKeys.has(key)) {
      return false;
    }
    if (elements.hideDeliveryDiscounts.checked && isDeliveryDiscount(offer.text)) {
      return false;
    }
    return true;
  });

  return offers;
}

function ubiquitousOfferIndex(venues) {
  const counts = new Map();
  const labels = new Map();
  let venuesWithOffers = 0;

  for (const venue of venues) {
    const keys = new Set();

    for (const offer of sourceOffers(venue)) {
      const label = normalizeOfferText(offer.text);
      const key = label.toLowerCase();
      if (!key || isUtilityOfferText(key)) {
        continue;
      }
      keys.add(key);
      if (!labels.has(key)) {
        labels.set(key, label);
      }
    }

    if (!keys.size) {
      continue;
    }

    venuesWithOffers += 1;
    for (const key of keys) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  if (venuesWithOffers < 10) {
    return { keys: new Set(), labels: [] };
  }

  const threshold = Math.max(10, Math.ceil(venuesWithOffers * 0.75));
  const entries = [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1] || labels.get(a[0]).localeCompare(labels.get(b[0]), "en"));

  return {
    keys: new Set(entries.map(([key]) => key)),
    labels: entries.map(([key]) => labels.get(key)),
  };
}

function hydrateHiddenCitywideOffers() {
  if (!elements.hiddenCitywideOffers) {
    return;
  }

  if (!state.ubiquitousOfferLabels.length) {
    elements.hiddenCitywideOffers.textContent = "";
    elements.hiddenCitywideOffers.title = "";
    return;
  }

  const prefix = elements.hideNewUserDelivery.checked ? "Hidden citywide" : "Detected citywide";
  const labels = state.ubiquitousOfferLabels;
  const visible = labels.slice(0, 4).join(" · ");
  const suffix = labels.length > 4 ? ` · +${labels.length - 4} more` : "";
  elements.hiddenCitywideOffers.textContent = `${prefix}: ${visible}${suffix}`;
  elements.hiddenCitywideOffers.title = labels.join(" · ");
}

function sourceOffers(venue) {
  if (Array.isArray(venue.offers) && venue.offers.length) {
    return venue.offers.map((offer) => ({
      text: normalizeOfferText(offer.text),
      amount: offer.amount,
      amountType: offer.amountType,
      amountLabel: offer.amountLabel,
      isUtilityBadge: offer.isUtilityBadge,
      score: offer.score,
      sourcePath: offer.sourcePath,
    }));
  }

  return (venue.offerTexts ?? []).map((text) => ({ text: normalizeOfferText(text) }));
}

function matchesQuery(venue, query) {
  if (!query) {
    return true;
  }

  return [venue.name, venue.slug, venue.productLine, venue.address, ...(venue.offerTexts ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function sorter() {
  const dir = state.sortDir === "asc" ? 1 : -1;

  if (state.sortKey === "rank") {
    return () => 0;
  }
  if (state.sortKey === "name") {
    return (a, b) => dir * a.venue.name.localeCompare(b.venue.name);
  }
  if (state.sortKey === "type") {
    return (a, b) =>
      dir * (String(a.venue.productLine).localeCompare(String(b.venue.productLine)) || a.venue.name.localeCompare(b.venue.name));
  }
  if (state.sortKey === "hours") {
    return (a, b) => dir * (openScore(a.venue) - openScore(b.venue)) || a.venue.name.localeCompare(b.venue.name);
  }
  return (a, b) => dir * (bestSortValue(a.venue) - bestSortValue(b.venue)) || a.venue.name.localeCompare(b.venue.name);
}

function bestSortValue(venue) {
  return bestDiscount(venue)?.score ?? -1;
}

function bestDiscount(venue) {
  const discounts = sourceOffers(venue)
    .filter((offer) => !isDeliveryRelated(offer.text))
    .filter((offer) => !isUtilityOfferText(offer.text))
    .map((offer) => ({ ...offer, discount: offerDiscount(offer) }))
    .filter((offer) => Number.isFinite(offer.discount?.amount))
    .sort((a, b) => offerScore(b) - offerScore(a));

  if (!discounts.length) {
    return null;
  }

  const best = discounts[0];
  return {
    label: best.discount.label,
    score: offerScore(best),
  };
}

function offerDiscount(offer) {
  if (Number.isFinite(offer.amount)) {
    return {
      amount: offer.amount,
      type: offer.amountType,
      label: offer.amountLabel ?? formatDiscountLabel(offer.amount, offer.amountType),
    };
  }

  return extractDiscount(offer.text);
}

function extractDiscount(text = "") {
  const normalized = normalizeOfferText(text);
  const percent = normalized.match(/(-?\d+(?:[.,]\d+)?)\s*%/);
  if (percent) {
    const amount = Math.abs(Number(percent[1].replace(",", ".")));
    return { amount, type: "percent", label: `${amount}%` };
  }

  const money = normalized.match(/(?:€\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:€|eur|euro))/i);
  if (money) {
    const amount = Number((money[1] ?? money[2]).replace(",", "."));
    return { amount, type: "money", label: `${amount} EUR` };
  }

  return null;
}

function offerScore(offer) {
  const text = normalizeOfferText(offer.text).toLowerCase();
  const discount = offer.discount ?? offerDiscount(offer);
  const amount = Number(discount?.amount);
  if (!Number.isFinite(amount) || isDeliveryRelated(text) || isUtilityOfferText(text)) {
    return -1;
  }

  const selectedItems = isSpecificItemOffer(text);
  const minSpend = minimumSpendAmount(text);
  const hasMinimumSpend = minSpend !== null;
  const smallMinimumSpend = minSpend !== null && minSpend <= 15;
  const wholeMenu = isWholeMenuOffer(text);

  if (selectedItems) {
    return 500 + amount;
  }

  if (discount.type === "money") {
    if (!hasMinimumSpend) {
      return 7000 + amount;
    }
    if (smallMinimumSpend) {
      return 6500 + amount;
    }
    return 2500 + amount;
  }

  if (discount.type === "percent") {
    if (wholeMenu && !hasMinimumSpend) {
      return 6000 + amount;
    }
    if (wholeMenu && smallMinimumSpend) {
      return 5500 + amount;
    }
    if (wholeMenu) {
      return 2000 + amount;
    }
    return 1500 + amount;
  }
  return -1;
}

function isWholeMenuOffer(text) {
  return /\b(?:all|entire|whole|everything)\b.*\b(?:menu|basket|order|items?)\b/i.test(text) ||
    /\b(?:menu|basket|whole order|entire order|order discount|all items?|everything)\b/i.test(text);
}

function isSpecificItemOffer(text) {
  return /selected\s+(?:item|items|product|products)|specific\s+(?:item|items|product|products)/i.test(text) ||
    /\b(?:burger|burgers|tortilla|tortillas|meal|meals|combo|combos|set|sets|pizza|pizzas|sushi set)\b/i.test(text);
}

function minimumSpendAmount(text) {
  const normalized = String(text).replace(/,/g, ".");
  const patterns = [
    /\bspend\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)?/i,
    /\bminimum\s*(?:order|spend|basket)?\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)?/i,
    /\bmin\.?\s*(?:order|spend|basket)?\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)?/i,
    /\bfrom\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)/i,
    /\borders?\s+over\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)?/i,
    /\bover\s*(?:€\s*)?(\d+(?:\.\d+)?)\s*(?:€|eur|euro)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const amount = Number(match[1]);
      return Number.isFinite(amount) ? amount : null;
    }
  }

  return null;
}

function formatDiscountLabel(amount, type) {
  if (type === "percent") {
    return `${amount}%`;
  }
  if (type === "money") {
    return `${amount} EUR`;
  }
  return String(amount);
}

function offerClass(offer) {
  const text = offer.text.toLowerCase();
  if (isNewUserZeroDelivery(text)) {
    return "offer-new-user";
  }
  if (isDeliveryDiscount(text)) {
    return "offer-delivery";
  }
  if (/%/.test(text)) {
    return "offer-percent";
  }
  if (/€|eur|euro/.test(text)) {
    return "offer-money";
  }
  if (/free|0\s*€|0eur|0 eur/i.test(text)) {
    return "offer-free";
  }
  return "offer-other";
}

function isNewUserZeroDelivery(text = "") {
  const normalized = normalizeOfferText(text).toLowerCase();
  return /(?:0\s*€|€\s*0|0\s*(?:eur|euro))/.test(normalized) && /delivery/.test(normalized) && /new users?/.test(normalized);
}

function isDeliveryDiscount(text = "") {
  const normalized = normalizeOfferText(text).toLowerCase();
  return !isNewUserZeroDelivery(normalized) && /delivery/.test(normalized) && (/\boff\b|discount|save|fee|free|€|eur|euro/.test(normalized));
}

function isDeliveryRelated(text = "") {
  return /delivery/i.test(normalizeOfferText(text));
}

function isUtilityOfferText(text = "") {
  return /^\d+\s+more$/i.test(normalizeOfferText(text));
}

function openingLabel(venue) {
  const opening = venue.opening ?? {};
  if (opening.isOpen === true || venue.isOpen === true) {
    return { icon: "🟢", text: humanOpeningText(opening.label ?? venue.openingStatus, "Open now"), className: "hours-open" };
  }
  if (opening.isOpen === false || venue.isOpen === false) {
    return { icon: "🔴", text: humanOpeningText(opening.label ?? venue.openingStatus, "Closed"), className: "hours-closed" };
  }
  if (venue.estimateRange) {
    return { icon: "🟢", text: "Open now", className: "hours-open" };
  }
  return { icon: "⚪", text: opening.label ?? venue.openingStatus ?? venue.openingHours ?? "No status", className: "hours-unknown" };
}

function humanOpeningText(text, fallback) {
  const normalized = normalizeOfferText(text)
    .replace(/\bSchedule order\b/gi, "")
    .replace(/\bClosed\b/gi, "")
    .trim();
  if (!normalized || normalized.toLowerCase() === "min") {
    return fallback;
  }
  return normalized;
}

function openScore(venue) {
  const opening = venue.opening ?? {};
  if (opening.isOpen === true || venue.isOpen === true) {
    return 0;
  }
  if (opening.isOpen === false || venue.isOpen === false) {
    return 2;
  }
  if (venue.estimateRange) {
    return 0;
  }
  return 1;
}

function mapLink(venue) {
  if (venue.mapUrl) {
    return venue.mapUrl;
  }
  const lat = venue.coordinates?.lat ?? venue.location?.lat;
  const lon = venue.coordinates?.lon ?? venue.location?.lon;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
  }
  if (venue.address || venue.name) {
    const city = state.selectedCity ?? {};
    const cityText = city.label ?? [city.name, city.country].filter(Boolean).join(", ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue.name, venue.address, cityText].filter(Boolean).join(" "))}`;
  }
  return null;
}

function requestedCityId() {
  const requested = new URLSearchParams(window.location.search).get("city");
  const stored = safeLocalStorageGet("WOLT_SELECTED_CITY");
  return cityById(requested)?.id ?? cityById(stored)?.id ?? defaultCity().id;
}

function setCityInUrl(cityId) {
  const url = new URL(window.location.href);
  if (cityId === defaultCity().id) {
    url.searchParams.delete("city");
  } else {
    url.searchParams.set("city", cityId);
  }
  window.history.replaceState({}, "", url);
}

function cityById(cityId) {
  const defaultCityId = state.citiesIndex?.defaultCityId ?? "ltu/vilnius";
  return (state.citiesIndex?.cities ?? []).find((city) => city.id === cityId || city.key === cityId || city.slug === cityId && city.id === defaultCityId);
}

function defaultCity() {
  return cityById(state.citiesIndex?.defaultCityId) ?? state.citiesIndex?.cities?.[0] ?? { id: "ltu/vilnius", key: "ltu-vilnius", slug: "vilnius", name: "Vilnius", country: "Lithuania" };
}

function cityLabelText(city) {
  return city?.label ?? [city?.name, city?.country].filter(Boolean).join(", ") ?? "";
}

function citySearchText(city) {
  return [city.name, city.country, city.countryCode, city.countryCode2, city.countryCode3, city.id, city.key, city.slug]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function dataPathForCity(city) {
  if (city?.latestPath) {
    return city.latestPath;
  }
  if (city?.dataPath) {
    return city.dataPath;
  }
  const key = city?.key ?? String(city?.id ?? "").replace("/", "-");
  return city?.id === "ltu/vilnius" || city?.id === "vilnius" ? "data/latest.json" : `data/cities/${key}/latest.json`;
}

function apiUrlForCity(city) {
  const cityId = city?.id ?? "";
  if (!state.apiBaseUrl || !cityId.includes("/")) {
    return null;
  }
  const [country, slug] = cityId.split("/", 2).map((part) => encodeURIComponent(part));
  return `${state.apiBaseUrl}/api/cities/${country}/${slug}/latest`;
}

function apiBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.has("api") ? params.get("api") : null;
  if (fromQuery && ["off", "none", "false", "0"].includes(fromQuery.trim().toLowerCase())) {
    safeLocalStorageRemove("WOLT_API_BASE_URL");
    safeLocalStorageSet("WOLT_API_DISABLED", "true");
    return "";
  }

  if (!fromQuery && safeLocalStorageGet("WOLT_API_DISABLED") === "true") {
    return "";
  }

  const fromWindow = window.WOLT_API_BASE_URL;
  const fromStorage = safeLocalStorageGet("WOLT_API_BASE_URL");
  const normalized = normalizeApiBaseUrl(fromQuery || fromWindow || fromStorage || DEFAULT_API_BASE_URL);

  if (fromQuery && normalized) {
    safeLocalStorageRemove("WOLT_API_DISABLED");
    safeLocalStorageSet("WOLT_API_BASE_URL", normalized);
  }

  return normalized;
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore browsers/storage modes that block localStorage.
  }
}

function normalizeApiBaseUrl(value) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore browsers/storage modes that block localStorage.
  }
}

function isSnapshotStale(snapshot) {
  const ttlMs = Number(state.citiesIndex?.cacheTtlMs ?? 0);
  if (!snapshot?.generatedAt || ttlMs <= 0) {
    return false;
  }
  const generatedAt = Date.parse(snapshot.generatedAt);
  return Number.isFinite(generatedAt) && Date.now() - generatedAt > ttlMs;
}

function apiDisabledMessage(city) {
  const label = city.label ?? city.name;
  return `No cached discount data yet for ${label}. Enable a live API backend with window.WOLT_API_BASE_URL or ?api=https://your-api-domain to fetch this city on demand.`;
}

function rememberCachedCity(city, snapshot) {
  if (!state.citiesIndex?.cities || !city?.id || !snapshot) {
    return;
  }

  const cached = state.citiesIndex.cities.find((candidate) => candidate.id === city.id);
  if (!cached) {
    return;
  }

  cached.updatedAt = snapshot.generatedAt ?? cached.updatedAt;
  cached.counts = snapshot.counts ?? cached.counts;
}

function cityMapUrl(city) {
  if (Number.isFinite(city?.lat) && Number.isFinite(city?.lon)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${city.lat},${city.lon}`)}`;
  }
  const label = city?.label ?? [city?.name, city?.country].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`;
}

function setSortFromSelect(value) {
  const [key, dir] = value.split("-");
  state.sortKey = key === "amount" ? "best" : key;
  state.sortDir = dir === "asc" ? "asc" : "desc";
}

function setSortFromHeader(key) {
  if (!key) {
    return;
  }
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDir = key === "best" ? "desc" : "asc";
  }
}

function syncSortUi() {
  const selectKey = state.sortKey === "best" ? "best" : state.sortKey;
  const selectValue = `${selectKey}-${state.sortDir}`;
  if ([...elements.sortSelect.options].some((option) => option.value === selectValue)) {
    elements.sortSelect.value = selectValue;
  }

  elements.sortHeaders.forEach((header) => {
    const active = header.dataset.sortKey === state.sortKey;
    header.classList.toggle("is-active", active);
    header.dataset.direction = active ? state.sortDir : "";
  });
}

function normalizeOfferText(value) {
  return String(value ?? "").replace(/\u202f|\u00a0/g, " ").trim();
}

function label(value) {
  return String(value).replace(/_/g, " ");
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
