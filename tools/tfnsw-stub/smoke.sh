#!/usr/bin/env bash
# Boot the stub and the server with no TfNSW API key and prove the board is
# answered from a captured fixture.
# Usage: tools/tfnsw-stub/smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d /tmp/hillclimb-p2-smoke-XXXXXX)"
STUB_PID=""
SERVER_PID=""

cleanup() {
  [[ -n "$STUB_PID" ]] && kill "$STUB_PID" 2>/dev/null || true
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

free_port() {
  python3 - "$@" <<'PY'
import socket, sys
taken = set(sys.argv[1:])
for port in range(8400, 8500):
    if str(port) in taken:
        continue
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            continue
        print(port)
        break
else:
    sys.exit("no free port in 8400-8499")
PY
}

go build -o "$WORK/tfnsw-stub" ./tools/tfnsw-stub
go build -o "$WORK/server" ./cmd/server

STUB_PORT="$(free_port)"
SERVER_PORT="$(free_port "$STUB_PORT")"

"$WORK/tfnsw-stub" --port "$STUB_PORT" --fixtures "$ROOT/tools/fixtures" \
  --routes "$ROOT/tools/fixtures/stub-routes.json" >"$WORK/stub.log" 2>&1 &
STUB_PID=$!

env -u TFNSW_API_KEY \
  TFNSW_API_KEY=stub \
  PORT="$SERVER_PORT" \
  WEB_DIR="$ROOT/web" \
  TFNSW_BASE_URL="http://127.0.0.1:$STUB_PORT" \
  TFNSW_FEED_BASE_URL="http://127.0.0.1:$STUB_PORT" \
  NATIVE_DATA_DIR="$WORK/native-runtime" \
  NATIVE_BOOTSTRAP_DIR="$ROOT/native-data/bootstrap" \
  TIMETABLE_COMPILER="$ROOT/tools/compile-timetable.py" \
  "$WORK/server" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$SERVER_PORT/healthz" >/dev/null 2>&1; then
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "server exited:"; cat "$WORK/server.log"; exit 1; }
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$SERVER_PORT/healthz" >/dev/null

curl -fsS "http://127.0.0.1:$SERVER_PORT/api/v1/departures?from=200060&to=215020" >"$WORK/departures.json"

python3 - "$WORK/departures.json" <<'PY'
import json, sys
body = json.load(open(sys.argv[1]))
journeys = body["journeys"]
wanted = "2026-08-31T22:48:00+10:00"
assert journeys, "no journeys"
assert any(j["departure"]["scheduled"] == wanted for j in journeys), \
    "no journey departs at %s: %s" % (wanted, [j["departure"]["scheduled"] for j in journeys])
print("journeys:", len(journeys))
print("first departure:", journeys[0]["departure"]["scheduled"])
print("generatedAt (real wall clock, not pinned):", body["generatedAt"])
PY

echo "stub log:"
cat "$WORK/stub.log"
echo "smoke: pass"
