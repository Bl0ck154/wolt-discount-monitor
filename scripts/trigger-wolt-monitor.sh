#!/usr/bin/env sh
set -eu

# Trigger the Wolt monitor workflow from an exact external cron.
# Required: GH_TOKEN with permission to dispatch repository events.
# Optional: WOLT_CITIES="ltu/vilnius" WOLT_ALL_CITIES="false".

OWNER="${GITHUB_OWNER:-Bl0ck154}"
REPO="${GITHUB_REPO:-wolt-discount-monitor}"
EVENT_TYPE="${WOLT_DISPATCH_EVENT:-wolt-discount-monitor}"
CITIES="${WOLT_CITIES:-ltu/vilnius}"
ALL_CITIES="${WOLT_ALL_CITIES:-false}"

if [ -z "${GH_TOKEN:-}" ]; then
  echo "GH_TOKEN is required" >&2
  exit 1
fi

curl --fail --silent --show-error \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${OWNER}/${REPO}/dispatches" \
  -d "{\"event_type\":\"${EVENT_TYPE}\",\"client_payload\":{\"cities\":\"${CITIES}\",\"all_cities\":\"${ALL_CITIES}\"}}"

echo "Triggered ${OWNER}/${REPO} ${EVENT_TYPE} for ${CITIES}"
