#!/usr/bin/env bash
# Capture seeded SwiftUI states on one booted iPhone simulator.
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="${ILOVETRAINS_IOS_APP:-$project_dir/ios/build/Build/Products/Debug-iphonesimulator/ILoveTrains.app}"
out="${OUT:-/tmp/ilovetrains-ios}"
settle="${SETTLE_SECONDS:-3}"
content_size="${CONTENT_SIZE:-}"
bundle="com.ilovetrains.ios"

default_states=(
  home board detail detail-two-change setup settings ferry
  home-pinned home-active home-inferred board-delayed detail-cancelled
  home-light board-light detail-light settings-light
  home-offline board-offline detail-offline home-deleted
)
if [ "$#" -gt 0 ]; then states=("$@")
else states=("${default_states[@]}")
fi

if [ ! -d "$app" ]; then
  echo "simulator app not found: $app" >&2
  echo "build it with tools/build-ios.sh --simulator or set ILOVETRAINS_IOS_APP" >&2
  exit 1
fi
if [ -d "$out" ] && [ -n "$(find "$out" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "output directory is not empty: $out" >&2
  exit 2
fi
mkdir -p "$out"

simulator="${ILOVETRAINS_SIMULATOR_ID:-}"
if [ -z "$simulator" ]; then
  simulator="$(xcrun simctl list devices booted -j | python3 -c '
import json, sys
devices = [d for group in json.load(sys.stdin)["devices"].values() for d in group if "iPhone" in d["name"]]
if len(devices) != 1:
    raise SystemExit("set ILOVETRAINS_SIMULATOR_ID unless exactly one iPhone simulator is booted")
print(devices[0]["udid"])
')"
fi
xcrun simctl list devices booted | grep -q "$simulator" || {
  echo "iPhone simulator is not booted: $simulator" >&2
  exit 1
}
for state in "${states[@]}"; do
  [[ "$state" =~ ^[a-z0-9-]+$ ]] || { echo "invalid state name: $state" >&2; exit 2; }
done

cleanup() {
  xcrun simctl status_bar "$simulator" clear >/dev/null 2>&1 || true
  if [ -n "$content_size" ] && [ -n "${old_content_size:-}" ]; then
    xcrun simctl ui "$simulator" content_size "$old_content_size" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

xcrun simctl install "$simulator" "$app"
old_content_size="$(xcrun simctl ui "$simulator" content_size)"
if [ -n "$content_size" ]; then
  xcrun simctl ui "$simulator" content_size "$content_size"
fi
xcrun simctl status_bar "$simulator" override \
  --time '9:41' --batteryLevel 100 --batteryState charged \
  --wifiBars 3 --cellularBars 4

# The warm-up absorbs first-install system banners and SpringBoard transitions.
xcrun simctl launch --terminate-running-process "$simulator" "$bundle" --calibration home >/dev/null
sleep 6

# A frame is settled when two shots half a second apart are byte-identical;
# the launch transition alone takes over two seconds and `settle` is the cap.
for state in "${states[@]}"; do
  destination="$out/$state.png"
  xcrun simctl launch --terminate-running-process "$simulator" "$bundle" --calibration "$state" >/dev/null
  sleep 1
  xcrun simctl io "$simulator" screenshot "$destination" >/dev/null 2>&1
  waited=1
  while awk -v w="$waited" -v s="$settle" 'BEGIN{exit !(w < s)}'; do
    sleep 0.5
    waited="$(awk -v w="$waited" 'BEGIN{print w + 0.5}')"
    xcrun simctl io "$simulator" screenshot "$out/.next.png" >/dev/null 2>&1
    if cmp -s "$destination" "$out/.next.png"; then rm -f "$out/.next.png"; break; fi
    mv "$out/.next.png" "$destination"
  done
done

first="$out/${states[0]}.png"
width="$(sips -g pixelWidth "$first" | awk '/pixelWidth/{print $2}')"
height="$(sips -g pixelHeight "$first" | awk '/pixelHeight/{print $2}')"
device="$(xcrun simctl getenv "$simulator" SIMULATOR_DEVICE_NAME 2>/dev/null || true)"
{
  printf 'simulator=%s\n' "$simulator"
  printf 'device=%s\n' "$device"
  printf 'capture_pixels=%sx%s\n' "$width" "$height"
  printf 'settle_seconds=%s\n' "$settle"
  printf 'content_size=%s\n' "${content_size:-$old_content_size}"
  printf 'states=%s\n' "${states[*]}"
} > "$out/metrics.txt"

printf 'Captured %s iOS frames at %sx%s px: %s\n' "${#states[@]}" "$width" "$height" "$out"
