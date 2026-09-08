#!/usr/bin/env bash
# Keep compiler chatter in an artifact; preserve the command's exit status.
set -euo pipefail
label="$1"; shift
log_dir="${TEST_LOG_DIR:-${TMPDIR:-/tmp}}"
mkdir -p "$log_dir"
log="$(mktemp "$log_dir/ilovetrains-${label}.XXXXXX")"
started=$SECONDS
printf '%s: running; log %s\n' "$label" "$log"
status=0
if [ "${TEST_VERBOSE:-0}" = 1 ]; then
  "$@" 2>&1 | tee "$log" || status=$?
else
  "$@" > "$log" 2>&1 || status=$?
fi
if [ "$status" -ne 0 ]; then
  [ "${TEST_VERBOSE:-0}" = 1 ] || tail -n 80 "$log"
  printf '%s: FAILED (%ss, exit %s); log %s\n' "$label" "$((SECONDS - started))" "$status" "$log" >&2
else
  grep -E 'Executed [0-9]+ tests?|BUILD SUCCESSFUL|\*\* (TEST|BUILD) SUCCEEDED \*\*|tests completed' "$log" | tail -n 6 || true
  printf '%s: passed (%ss); log %s\n' "$label" "$((SECONDS - started))" "$log"
fi
exit "$status"
