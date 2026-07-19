#!/usr/bin/env bash
set -euo pipefail

repo="Bl0ck154/wolt-discount-monitor"
cities="${1:-ltu/vilnius}"
residential_runner="vivobook-wolt-local"
target="windows"

runner_status="$(
  gh api "repos/${repo}/actions/runners" \
    --jq ".runners[] | select(.name == \"${residential_runner}\") | .status" \
    2>/dev/null || true
)"

if [[ "${runner_status}" != "online" ]]; then
  http_status="$(
    curl --max-time 30 --silent --show-error --output /dev/null \
      --write-out '%{http_code}' \
      'https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=25.2682558&lat=54.6901231' \
      -H 'Accept: application/json, text/plain, */*' \
      -H 'Accept-Language: en-US,en;q=0.9' \
      -H 'Platform: Web' \
      -H 'Referer: https://wolt.com/' \
      -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' \
      || true
  )"

  if [[ "${http_status}" != "200" ]]; then
    printf '%s Windows runner is %s and Netcup Wolt preflight returned HTTP %s; dispatch skipped.\n' \
      "$(date --iso-8601=seconds)" "${runner_status:-unknown}" "${http_status:-request-error}" >&2
    exit 1
  fi

  target="netcup"
fi

printf '%s dispatching cities=%s runner=%s (Windows status=%s)\n' \
  "$(date --iso-8601=seconds)" "${cities}" "${target}" "${runner_status:-unknown}"

gh workflow run check-discounts.yml \
  --repo "${repo}" \
  --ref main \
  -f "cities=${cities}" \
  -f "runner=${target}"
