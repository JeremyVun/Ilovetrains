#!/usr/bin/env bash
# Capture the native calibration matrix at one logical phone size.
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
size="${1:-390x844}"
font_scale="${FONT_SCALE:-1.0}"
out="${OUT:-/tmp/ilovetrains-android-${size}-${font_scale}}"
adb="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"

case "$size" in 390x844|412x732) ;; *) echo "usage: $0 [390x844|412x732]" >&2; exit 2;; esac
[ "$($adb get-state 2>/dev/null)" = device ] || { echo "one booted Android device is required" >&2; exit 1; }

size_state="$($adb shell wm size | tr -d '\r')"
old_size="$(printf '%s\n' "$size_state" | awk '/Override size/{print $3}')"
density="$($adb shell wm density | awk '/Physical density/{physical=$3} /Override density/{override=$3} END{print override ? override : physical}')"
width_dp="${size%x*}"; height_dp="${size#*x}"
read -r width_px height_px < <(python3 - "$width_dp" "$height_dp" "$density" <<'PY'
import sys
w, h, density = map(float, sys.argv[1:])
print(round(w * density / 160), round(h * density / 160))
PY
)
old_font="$($adb shell settings get system font_scale | tr -d '\r')"
cleanup() {
  if [ -n "$old_size" ]; then "$adb" shell wm size "$old_size" >/dev/null 2>&1 || true
  else "$adb" shell wm size reset >/dev/null 2>&1 || true; fi
  "$adb" shell settings put system font_scale "$old_font" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

"$adb" shell wm size "${width_px}x${height_px}" >/dev/null
"$adb" shell settings put system font_scale "$font_scale" >/dev/null
if [ -d "$out" ] && [ -n "$(find "$out" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "output directory is not empty: $out" >&2
  exit 2
fi
mkdir -p "$out"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi
(
  cd "$project_dir/android"
  ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
)

main_apk="$project_dir/android/app/build/outputs/apk/debug/app-debug.apk"
test_apk="$project_dir/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
"$adb" install -r "$main_apk" >/dev/null
"$adb" install -r -t "$test_apk" >/dev/null
"$adb" shell rm -rf /sdcard/Android/data/com.ilovetrains.app/files/calibration
"$adb" shell am instrument -w \
  -e class com.ilovetrains.app.UiCalibrationTest \
  com.ilovetrains.app.test/androidx.test.runner.AndroidJUnitRunner
"$adb" pull /sdcard/Android/data/com.ilovetrains.app/files/calibration/. "$out" >/dev/null
count="$(find "$out" -name '*.png' -type f | wc -l | tr -d ' ')"
printf 'Captured %s frames at %s dp, font scale %s: %s\n' "$count" "$size" "$font_scale" "$out"
