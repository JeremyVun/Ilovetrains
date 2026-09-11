#!/usr/bin/env bash
# Boots the fixture stub (with Town Hall → Bondi Junction answered) and the
# server, then runs web/test/recovery-stack-probe.mjs against them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d /tmp/recovery-stack-XXXXXX)"
cd "$ROOT"
go build -o "$WORK/tfnsw-stub" ./tools/tfnsw-stub
go build -o "$WORK/server" ./cmd/server
python3 - "$ROOT/tools/fixtures/stub-routes.json" "$WORK/routes.json" <<'PY'
import json, sys
routes = json.load(open(sys.argv[1]))
extra = [
  {"path": "/trip", "query": {"name_origin": "200070", "name_destination": "202210"}, "fixture": "trip_central_parramatta.json"},
  {"path": "/trip", "query": {"name_origin": "213820", "name_destination": "202210"}, "fixture": "trip_central_parramatta.json"},
]
json.dump(extra + routes, open(sys.argv[2], "w"), indent=1)
PY
free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }
STUB_PORT=$(free_port); SERVER_PORT=$(free_port)
"$WORK/tfnsw-stub" --port "$STUB_PORT" --fixtures "$ROOT/tools/fixtures" --routes "$WORK/routes.json" >"$WORK/stub.log" 2>&1 &
STUB_PID=$!
env -u TFNSW_API_KEY TFNSW_API_KEY=stub PORT="$SERVER_PORT" WEB_DIR="$ROOT/web" \
  TFNSW_BASE_URL="http://127.0.0.1:$STUB_PORT" TFNSW_FEED_BASE_URL="http://127.0.0.1:$STUB_PORT" \
  NATIVE_DATA_DIR="$WORK/native-runtime" NATIVE_BOOTSTRAP_DIR="$ROOT/native-data/bootstrap" \
  TIMETABLE_COMPILER="$ROOT/tools/compile-timetable.py" \
  "$WORK/server" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $STUB_PID $SERVER_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$SERVER_PORT/healthz" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:$SERVER_PORT/healthz" >/dev/null
echo "stub $STUB_PORT server $SERVER_PORT"
SERVER_PORT="$SERVER_PORT" node web/test/recovery-stack-probe.mjs
