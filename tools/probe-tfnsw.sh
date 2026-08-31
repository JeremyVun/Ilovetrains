#!/usr/bin/env bash
# Probe TfNSW Trip Planner API and save raw responses to tools/fixtures/.
# Usage: tools/probe-tfnsw.sh
# Reads TFNSW_API_KEY from env, falling back to .env at the repo root.
# Makes ~5 requests per run (quota-cheap). Never prints the key.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXDIR="$ROOT/tools/fixtures"
mkdir -p "$FIXDIR"

if [[ -z "${TFNSW_API_KEY:-}" && -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
fi
[[ -n "${TFNSW_API_KEY:-}" ]] || { echo "TFNSW_API_KEY not set" >&2; exit 1; }

BASE="https://api.transport.nsw.gov.au/v1/tp"

req() { # req <fixture-name> <url>
  local name="$1" url="$2" code
  code=$(curl -sS -o "$FIXDIR/$name.json" -w '%{http_code}' \
    -H "Authorization: apikey $TFNSW_API_KEY" "$url")
  echo "$name: HTTP $code ($(wc -c < "$FIXDIR/$name.json" | tr -d ' ') bytes)"
}

# type_sf=stop returns "stop invalid" on the current platform (verified
# 2026-08-31); use type_sf=any and filter results to type=="stop".
req stop_finder_central \
  "$BASE/stop_finder?outputFormat=rapidJSON&type_sf=any&name_sf=Central%20Station&coordOutputFormat=EPSG%3A4326&TfNSWSF=true"

req stop_finder_parramatta \
  "$BASE/stop_finder?outputFormat=rapidJSON&type_sf=any&name_sf=Parramatta%20Station&coordOutputFormat=EPSG%3A4326&TfNSWSF=true"

CENTRAL=$(jq -r '[.locations[] | select(.type=="stop")][0].id' "$FIXDIR/stop_finder_central.json")
PARRA=$(jq -r '[.locations[] | select(.type=="stop")][0].id' "$FIXDIR/stop_finder_parramatta.json")
echo "resolved stop ids: central=$CENTRAL parramatta=$PARRA"

NOW_DATE=$(date +%Y%m%d) NOW_TIME=$(date +%H%M)

# Trains/metro only: EFA product classes — exclude light rail(4), bus(5),
# coach(7), ferry(9), school bus(11). Probe verifies these class numbers.
EXCL="excludedMeans=checkbox&exclMOT_4=1&exclMOT_5=1&exclMOT_7=1&exclMOT_9=1&exclMOT_11=1"

req trip_central_parramatta \
  "$BASE/trip?outputFormat=rapidJSON&coordOutputFormat=EPSG%3A4326&depArrMacro=dep&itdDate=$NOW_DATE&itdTime=$NOW_TIME&type_origin=any&name_origin=$CENTRAL&type_destination=any&name_destination=$PARRA&calcNumberOfTrips=6&$EXCL&TfNSWTR=true"

req departure_mon_central \
  "$BASE/departure_mon?outputFormat=rapidJSON&coordOutputFormat=EPSG%3A4326&mode=direct&type_dm=stop&name_dm=$CENTRAL&depArrMacro=dep&itdDate=$NOW_DATE&itdTime=$NOW_TIME&TfNSWDM=true"

echo "fixtures written to tools/fixtures/"
