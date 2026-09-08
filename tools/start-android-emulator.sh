#!/usr/bin/env bash
# Start an existing, session-owned AVD without wiping it; reuse Quick Boot.
set -euo pipefail
avd="${1:?Usage: tools/start-android-emulator.sh AVD_NAME [EVEN_PORT]}"
port="${2:-5554}"
[[ "$avd" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "invalid AVD name" >&2; exit 2; }
[[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 5554 ] && [ "$port" -le 5682 ] && [ "$((port % 2))" -eq 0 ] || {
  echo "port must be even, from 5554 to 5682" >&2; exit 2;
}
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
adb="$sdk/platform-tools/adb"
emulator="$sdk/emulator/emulator"
serial="emulator-$port"
"$emulator" -list-avds | grep -Fxq "$avd" || { echo "unknown AVD: $avd" >&2; exit 2; }
existing="$("$adb" -s "$serial" emu avd name 2>/dev/null | head -n 1 | tr -d '\r' || true)"
if [ -n "$existing" ] && [ "$existing" != "$avd" ]; then
  echo "$serial already belongs to $existing; choose another port" >&2; exit 1
fi
pid=""
if [ -z "$existing" ]; then
  log="$(mktemp "${TMPDIR:-/tmp}/ilovetrains-emulator.XXXXXX")"
  # A separate session survives an agent tool call closing its process group.
  pid="$(python3 - "$log" "$emulator" -avd "$avd" -port "$port" -gpu host \
    -memory "${ANDROID_EMULATOR_MEMORY:-4096}" -no-window -no-audio -no-boot-anim <<'PY'
import subprocess, sys
with open(sys.argv[1], 'ab') as log:
    child = subprocess.Popen(sys.argv[2:], stdin=subprocess.DEVNULL, stdout=log,
                             stderr=log, start_new_session=True)
print(child.pid)
PY
)"
  echo "Starting $avd on $serial (host GPU, Quick Boot); log $log"
else
  echo "Reusing $avd on $serial; existing renderer and memory settings are unchanged"
fi
deadline=$((SECONDS + 180))
while [ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)" != 1 ]; do
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    tail -n 40 "$log" >&2; exit 1
  fi
  [ "$SECONDS" -lt "$deadline" ] || { echo "boot timed out for $serial" >&2; exit 1; }
  sleep 2
done
echo "Ready: export ANDROID_SERIAL=$serial"
echo "When your session finishes: $adb -s $serial emu kill"
