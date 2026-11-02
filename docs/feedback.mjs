// Only opens GitHub's issue composer on an explicit click. No data is sent by this app.
export function offerFeedbackUrl({ city, venue, offer } = {}) {
  const normalize = (value, max = 120) => String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, max);
  const title = "Incorrect Wolt offer: " + normalize(venue);
  const body = [
    "City: " + normalize(city),
    "Venue: " + normalize(venue),
    "Observed offer: " + normalize(offer, 180),
    "",
    "What is incorrect? (Please describe the issue.)",
    "",
    "Do not include order details, personal data, addresses or access tokens.",
  ].join("\n");
  return "https://github.com/Bl0ck154/wolt-discount-monitor/issues/new?" +
    new URLSearchParams({ title, body }).toString();
}
