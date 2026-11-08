// A narrowly scoped internal RPC operation reusing this Worker's existing
// Github credential; no token is copied to another Worker or to Actions.
const TARGET =
  "https://api.github.com/repos/Bl0ck154/Wolt-Referral-Site/actions/workflows/referral-cloudflare.yml/dispatches";

export async function dispatchCourierstartWorkflow(env, fetcher = fetch) {
  if (!env?.GITHUB_TOKEN) {
    console.warn("courierstart_worker_dispatch", "missing_github_token");
    return false;
  }
  const result = await fetcher(TARGET, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "courierstart-cloudflare-dispatcher"
    },
    body: JSON.stringify({ ref: "master" })
  });
  if (result.status !== 204) {
    console.warn("courierstart_worker_dispatch", "http_" + result.status);
    return false;
  }
  return true;
}
