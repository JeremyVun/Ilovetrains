#!/usr/bin/env bash
# Replay the checked-in journey regressions against the fixture stub with no
# model reachable, so a drifted case fails instead of healing or re-recording.
# Usage: tools/playtest-regressions.sh [--fresh]
#        tools/playtest-regressions.sh --record [case-id]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUITE="$ROOT/playtest/regressions"
# Fixed, because the seeds under state/ are keyed by browser origin.
PORT="${PLAYTEST_REGRESSIONS_PORT:-8460}"
STUB_PORT="${PLAYTEST_REGRESSIONS_STUB_PORT:-8461}"
RUNS_ROOT="${PLAYTEST_REGRESSIONS_RUNS_ROOT:-${TMPDIR:-/tmp}/ilovetrains-playtest-runs}"
RECORD_GATEWAY="${PLAYTEST_REGRESSIONS_GATEWAY:-http://127.0.0.1:8900}"

RECORD=""
RECORD_CASE=""
FRESH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --record)
      RECORD=1
      shift
      if [[ $# -gt 0 && "$1" != --* ]]; then
        RECORD_CASE="$1"
        shift
      fi
      ;;
    --fresh)
      FRESH="--fresh"
      shift
      ;;
    *)
      echo "playtest-regressions: unknown argument $1" >&2
      exit 2
      ;;
  esac
done

python3 - "$SUITE" <<'PY' || exit 2
import pathlib, re, sys

replayable = {"element_exists", "url_matches", "api_called", "console_errors",
              "accessibility_violations", "invariant"}
bad = []
for path in sorted(pathlib.Path(sys.argv[1], "stories").rglob("*.yaml")):
    lines = path.read_text().splitlines()
    in_gate = False
    for line in lines:
        if re.match(r"^(success|observe):\s*$", line):
            in_gate = True
            continue
        if in_gate and re.match(r"^\S", line):
            in_gate = False
        if not in_gate:
            continue
        kind = re.match(r"^\s*-\s*([A-Za-z_]+)\s*:", line)
        if kind and kind.group(1) not in replayable:
            bad.append(f"{path.name}: {kind.group(1)} is not a replayable check")
    if any(re.match(r"^\s*-?\s*assert\s*:", line) for line in lines):
        bad.append(f"{path.name}: assert calls the grader, which this gate cannot reach")
if bad:
    sys.exit("playtest-regressions: " + "; ".join(sorted(set(bad))))
PY

require_free_port() {
  # SO_REUSEADDR matches how the stub and the server bind, so a port is only
  # refused when something is really listening on it.
  python3 -c 'import socket, sys
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    s.close()' "$1" || {
    echo "playtest-regressions: $2 port $1 is already in use; free it or set $3" >&2
    exit 2
  }
}
require_free_port "$PORT" server PLAYTEST_REGRESSIONS_PORT
require_free_port "$STUB_PORT" stub PLAYTEST_REGRESSIONS_STUB_PORT

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ilovetrains-regressions-XXXXXX")"
STUB_PID=""
SERVER_PID=""
cleanup() {
  if [[ -n "$STUB_PID" ]]; then kill "$STUB_PID" 2>/dev/null || true; fi
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

go build -o "$WORK/tfnsw-stub" ./tools/tfnsw-stub
go build -o "$WORK/server" ./cmd/server

TZ=Australia/Sydney "$WORK/tfnsw-stub" --port "$STUB_PORT" --fixtures "$ROOT/tools/fixtures" \
  --routes "$ROOT/tools/fixtures/stub-routes.json" >"$WORK/stub.log" 2>&1 &
STUB_PID=$!

env -u TFNSW_API_KEY \
  TZ=Australia/Sydney \
  TFNSW_API_KEY=stub \
  PORT="$PORT" \
  WEB_DIR="$ROOT/web" \
  TFNSW_BASE_URL="http://127.0.0.1:$STUB_PORT" \
  TFNSW_FEED_BASE_URL="http://127.0.0.1:$STUB_PORT" \
  NATIVE_DATA_DIR="$WORK/native-runtime" \
  NATIVE_BOOTSTRAP_DIR="$ROOT/native-data/bootstrap" \
  TIMETABLE_COMPILER="$ROOT/tools/compile-timetable.py" \
  "$WORK/server" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 || {
  echo "playtest-regressions: server never answered /healthz on port $PORT" >&2
  cat "$WORK/server.log" >&2
  echo "playtest-regressions: stub log:" >&2
  cat "$WORK/stub.log" >&2
  exit 2
}

TARGET="$SUITE"
if [[ -n "$RECORD_CASE" ]]; then TARGET="$SUITE/stories/$RECORD_CASE.yaml"; fi

set +e
if [[ -n "$RECORD" ]]; then
  PLAYTEST_LLM_BASE_URL="$RECORD_GATEWAY" \
    ${PLAYTEST_BIN:-playtest} "$TARGET" --base-url "http://127.0.0.1:$PORT" \
    --runs-root "$RUNS_ROOT" --no-grade --json --fresh
  CODE=$?
else
  env -u PLAYTEST_LLM_BASE_URL -u PLAYTEST_LLM_API_KEY -u ANTHROPIC_API_KEY -u OPENAI_API_KEY \
    ${PLAYTEST_BIN:-playtest} "$TARGET" --base-url "http://127.0.0.1:$PORT" \
    --runs-root "$RUNS_ROOT" --no-grade --json $FRESH
  CODE=$?
fi
set -e

if [[ -n "$RECORD" ]]; then
  echo "playtest-regressions: saved paths are in $SUITE/results; commit them with the case:" >&2
  ls -1 "$SUITE/results" >&2 || true
fi
exit "$CODE"
