const state = {
  snapshot: null,
  rows: [],
};

const elements = {
  promoCount: document.querySelector("#promoCount"),
  restaurantCount: document.querySelector("#restaurantCount"),
  updatedAt: document.querySelector("#updatedAt"),
  searchInput: document.querySelector("#searchInput"),
  productFilter: document.querySelector("#productFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  venueRows: document.querySelector("#venueRows"),
};

init().catch((error) => {
  elements.venueRows.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
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
  elements.sortSelect.addEventListener("change", renderRows);
}

function renderRows() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const productLine = elements.productFilter.value;
  const sort = elements.sortSelect.value;

  const rows = state.rows
    .filter((venue) => !productLine || venue.productLine === productLine)
    .filter((venue) => matchesQuery(venue, query))
    .sort(sorter(sort))
    .slice(0, 1000);

  if (!rows.length) {
    elements.venueRows.innerHTML = `<tr><td colspan="6" class="empty">No matching venues</td></tr>`;
    return;
  }

  elements.venueRows.innerHTML = rows.map(renderVenueRow).join("");
}

function renderVenueRow(venue) {
  const image = venue.imageUrl
    ? `<img class="venue-image" src="${escapeHtml(venue.imageUrl)}" alt="" loading="lazy" />`
    : `<div class="venue-image" aria-hidden="true"></div>`;
  const offers = venue.offerTexts.length
    ? venue.offerTexts.map((text) => `<span class="offer">${escapeHtml(text)}</span>`).join("")
    : `<span class="venue-meta">No text</span>`;

  return `
    <tr>
      <td>
        <div class="venue-cell">
          ${image}
          <div>
            <a class="venue-title" href="${escapeHtml(venue.link ?? "#")}" target="_blank" rel="noreferrer">
              ${escapeHtml(venue.name)}
            </a>
            <div class="venue-meta">${escapeHtml(venue.slug ?? "")}</div>
          </div>
        </div>
      </td>
      <td><span class="pill">${escapeHtml(label(venue.productLine ?? "unknown"))}</span></td>
      <td><div class="offer-list">${offers}</div></td>
      <td class="amount">${escapeHtml(venue.bestLabel ?? "-")}</td>
      <td>${escapeHtml(venue.deliveryPrice ?? "-")}</td>
      <td>${escapeHtml(venue.estimateRange ?? "-")}</td>
    </tr>
  `;
}

function matchesQuery(venue, query) {
  if (!query) {
    return true;
  }

  return [venue.name, venue.slug, venue.productLine, ...(venue.offerTexts ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function sorter(sort) {
  if (sort === "name-asc") {
    return (a, b) => a.name.localeCompare(b.name);
  }
  if (sort === "type-asc") {
    return (a, b) =>
      String(a.productLine).localeCompare(String(b.productLine)) || a.name.localeCompare(b.name);
  }
  if (sort === "delivery-asc") {
    return (a, b) =>
      (a.deliveryPriceInt ?? Number.MAX_SAFE_INTEGER) -
        (b.deliveryPriceInt ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
  }
  return (a, b) => bestSortValue(b) - bestSortValue(a) || a.name.localeCompare(b.name);
}

function bestSortValue(venue) {
  if (!venue.bestDiscount) {
    return -1;
  }

  return venue.bestDiscount.amount ?? -1;
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
