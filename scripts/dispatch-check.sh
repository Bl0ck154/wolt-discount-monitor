#!/usr/bin/env bash
set -euo pipefail

repo="Bl0ck154/wolt-discount-monitor"
cities="${1:-ltu/vilnius}"

repo_variable() {
  local name="$1"
  gh variable get "${name}" --repo "${repo}" 2>/dev/null || true
}

runner_status() {
  local os_label="$1"
  gh api "repos/${repo}/actions/runners" \
    --jq ".runners[] | select(any(.labels[]; .name == \"${primary_runner_label}\")) | select(any(.labels[]; .name == \"${os_label}\")) | .status" \
    2>/dev/null | head -n 1 || true
}

wolt_preflight() {
  curl --max-time 30 --silent --show-error --output /dev/null \
    --write-out '%{http_code}' \
    'https://consumer-api.wolt.com/v1/pages/venue-list/promotions-near-you?lon=25.2682558&lat=54.6901231' \
    -H 'Accept: application/json, text/plain, */*' \
    -H 'Accept-Language: en-US,en;q=0.9' \
    -H 'Platform: Web' \
    -H 'Referer: https://wolt.com/' \
    -H 'User-Agent: Mozilla/5.0' \
    || true
}

primary_runner_label="${WOLT_PRIMARY_RUNNER_LABEL:-$(repo_variable WOLT_PRIMARY_RUNNER_LABEL)}"
primary_runner_label="${primary_runner_label:-wolt}"
fallback_runner_input="${WOLT_FALLBACK_RUNNER_INPUT:-$(repo_variable WOLT_FALLBACK_RUNNER_INPUT)}"
fallback_runner_input="${fallback_runner_input:-windows}"
if [[ "${fallback_runner_input}" != "windows" ]]; then
  fallback_runner_input="windows"
fi

target="linux"
linux_runner_status="$(runner_status Linux)"
http_status="not-tested"

if [[ "${linux_runner_status}" == "online" ]]; then
  http_status="$(wolt_preflight)"
fi

if [[ "${linux_runner_status}" != "online" || "${http_status}" != "200" ]]; then
  windows_runner_status="$(runner_status Windows)"
  if [[ "${windows_runner_status}" != "online" ]]; then
    printf '%s Linux primary unavailable (runner=%s, Wolt HTTP=%s) and Windows fallback is %s; dispatch skipped.\n' \
      "$(date --iso-8601=seconds)" "${linux_runner_status:-unknown}" "${http_status}" "${windows_runner_status:-unknown}" >&2
    exit 1
  fi
  target="${fallback_runner_input}"
fi

printf '%s dispatching cities=%s runner=%s (linux status=%s, Wolt HTTP=%s)\n' \
  "$(date --iso-8601=seconds)" "${cities}" "${target}" "${linux_runner_status:-unknown}" "${http_status}"

gh workflow run check-discounts.yml \
  --repo "${repo}" \
  --ref main \
  -f "cities=${cities}" \
  -f "runner=${target}"
