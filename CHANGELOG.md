# Changelog

## Unreleased\n\n- Count deliberate outbound clicks to Wolt by city and day in Cloudflare D1, without storing personal or basket information.\n\n## 0.2.0 — 2026-11-02

This release focuses on making the deal finder easier to use and keeping its documentation honest.

- Browse current city snapshots in a responsive mobile layout, with translated core controls and city landing pages.
- Save venues in your browser, review estimated deal value and report incorrect promotions through GitHub.
- Subscribe to recently observed city deals through RSS, without an account.
- Estimate a basket total using the actual delivery and service fees you enter from Wolt. The calculator supports broad basket-wide discounts with known terms; it does not guess your delivery price or verify personal eligibility.
- Hide repetitive citywide campaigns and likely new-customer-only offers by default.
- Automatically update README catalog badges and the coverage table from committed snapshots; CI checks generated documentation.
- Improve localized currency display and compact the mobile filter controls.

### Known limitations

- Wolt delivery fees depend on address and account. The public promotion snapshots do not contain an accurate personal delivery quote.
- Discount eligibility and the final checkout must be verified in Wolt. Some offer types cannot be estimated reliably.
- The catalog includes more cities than have recent snapshots; city coverage is shown separately.
- Traffic and outbound conversion measurement is not yet complete.
