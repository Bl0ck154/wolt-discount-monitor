const state = {
  snapshot: null,
  rows: [],
  sortKey: "best",
  sortDir: "desc",
};

const elements = {
  promoCount: document.querySelector("#promoCount"),
  restaurantCount: document.querySelector("#restaurantCount"),
  updatedAt: document.querySelector("#updatedAt"),
  searchInput: document.querySelector("#searchInput"),
  productFilter: document.querySelector("#productFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  hideNewUserDelivery: document.querySelector("#hideNewUserDelivery"),
  hideDeliveryDiscounts: document.querySelector("#hideDeliveryDiscounts"),
  shownCount: document.querySelector("#shownCount"),
  venueRows: document.querySelector("#venueRows"),
  sortHeaders: document.querySelectorAll(".sort-header"),
};

init().catch((error) => {
  elements.venueRows.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
});

async function init() {
  const response = await fetch("data/latest.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No data yet. Run the checker first.");
  }

  state.snapshot = await response.json();
  state.rows = state.snapshot.venues ?? [];
  hydrateSummary();
  hydrateFilters();
  bindControls();
  renderRows();
}

function hydrateSummary() {
  elements.promoCount.textContent = formatNumber(state.snapshot.counts.promotionsUniqueVenues);
  elements.restaurantCount.textContent = formatNumber(state.snapshot.counts.restaurantsUniqueVenues);
  elements.updatedAt.textContent = new Date(state.snapshot.generatedAt).toLocaleString();
}

function hydrateFilters() {
  const productLines = Object.keys(state.snapshot.counts.productLines ?? {});
  elements.productFilter.innerHTML = [
    `<option value="">All types</option>`,
    ...productLines.map((line) => `<option value="${escapeHtml(line)}">${escapeHtml(label(line))}</option>`),
  ].join("");
}

function bindControls() {
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

function renderRows() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const productLine = elements.productFilter.value;

  const rows = state.rows
    .map((venue) => ({ venue, visibleOffers: visibleOffers(venue) }))
    .filter(({ venue }) => !productLine || venue.productLine === productLine)
    .filter(({ venue }) => matchesQuery(venue, query))
    .filter(({ visibleOffers }) => visibleOffers.length > 0)
    .sort(sorter());
  const groups = groupRows(rows).slice(0, 1000);

  elements.shownCount.textContent = `${formatNumber(groups.length)} groups / ${formatNumber(rows.length)} venues / ${formatNumber(state.rows.length)} total`;
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
    : `<span class="venue-meta">No text</span>`;
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
  const offers = visibleOffers.map((offer) => `<span class="offer ${offerClass(offer)}">${escapeHtml(offer.text)}</span>`).join("");

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
  const groups = [];
  const byKey = new Map();

  for (const row of rows) {
    const rootName = chainRootName(row.venue.name);
    const key = [rootName.toLowerCase(), offerSignature(row.visibleOffers)].join("|");
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

function chainRootName(name = "") {
  return String(name)
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+-\s+[^-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim() || String(name);
}

function offerSignature(offers) {
  return offers.map((offer) => normalizeOfferText(offer.text).toLowerCase()).sort().join("|");
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
    if (elements.hideDeliveryDiscounts.checked && isDeliveryDiscount(offer.text)) {
      return false;
    }
    return true;
  });

  return offers;
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
  if (Number.isFinite(offer.score)) {
    return offer.score;
  }

  const text = normalizeOfferText(offer.text).toLowerCase();
  const discount = offer.discount ?? offerDiscount(offer);
  const amount = Number(discount?.amount);
  if (!Number.isFinite(amount) || isDeliveryRelated(text) || isUtilityOfferText(text)) {
    return -1;
  }

  const selectedItems = /selected items?|selected products?|specific items?/i.test(text);
  const hasMinimumSpend = /\bspend\b|minimum|min\.?\s*(?:order|spend|basket)|from\s+\d|over\s+\d|orders?\s+over/i.test(text);

  if (discount.type === "percent") {
    if (/basket|menu|entire|everything|all items?|whole order|order discount/i.test(text)) {
      return 5000 + amount;
    }
    if (selectedItems) {
      return 1000 + amount;
    }
    return 4000 + amount;
  }
  if (discount.type === "money") {
    if (hasMinimumSpend) {
      return 2000 + amount;
    }
    return 3000 + amount;
  }
  return -1;
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
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue.name, venue.address, "Vilnius"].filter(Boolean).join(" "))}`;
  }
  return null;
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
