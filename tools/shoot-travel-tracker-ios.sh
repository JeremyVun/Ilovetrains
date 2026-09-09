#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
size="${1:-402x874}"
simulator="${ILOVETRAINS_SIMULATOR_ID:-}"
derived="${ILOVETRAINS_IOS_BUILD_DIR:-$project_dir/ios/build}"
out="${OUT:-/tmp/ilovetrains-tracker-ios-${size}}"
cases="${TRACKER_CASES:-ride,transfer,final,unknown-platform,tight-transfer,offline-stale,long-content,missed-connection,first-leg-cancelled,final-leg-cancelled}"
schemes="${SCHEMES:-dark,light}"
surfaces="${SURFACES:-notification-center,compact,expanded}"
content_size="${CONTENT_SIZE:-large}"
bundle="com.ilovetrains.ios"
competitor_bundle="com.codex.ilovetrains.trackerprobe.competitor"
competitor_app="${MINIMAL_COMPETITOR_APP:-}"
lock_dir="/tmp/ilovetrains-tracker-ios-${simulator}.lock"

case "$size" in 402x874|390x844) ;; *) echo "usage: $0 [402x874|390x844]" >&2; exit 2;; esac
[[ "$simulator" =~ ^[A-F0-9-]+$ ]] || { echo "ILOVETRAINS_SIMULATOR_ID must name the dedicated iPhone simulator" >&2; exit 2; }
case "$content_size" in large|accessibility-medium) ;; *) echo "CONTENT_SIZE must be large or accessibility-medium" >&2; exit 2;; esac
IFS=',' read -r -a requested_schemes <<< "$schemes"
IFS=',' read -r -a requested_cases <<< "$cases"
IFS=',' read -r -a requested_surfaces <<< "$surfaces"
for scheme in "${requested_schemes[@]}"; do
  case "$scheme" in dark|light) ;; *) echo "SCHEMES must contain dark or light" >&2; exit 2;; esac
done
for surface in "${requested_surfaces[@]}"; do
  case "$surface" in notification-center|compact|expanded|minimal) ;; *) echo "SURFACES contains unsupported surface: $surface" >&2; exit 2;; esac
done
if [[ ",$surfaces," == *,minimal,* ]] && [ -z "$competitor_app" ]; then
  echo "SURFACES=minimal requires MINIMAL_COMPETITOR_APP" >&2
  exit 2
fi
if [ -d "$out" ] && [ -n "$(find "$out" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "output directory is not empty: $out" >&2
  exit 2
fi
mkdir "$lock_dir" 2>/dev/null || { echo "tracker drive already owns $simulator ($lock_dir)" >&2; exit 1; }
mkdir -p "$out/logs" "$out/results" "$out/attachments" "$out/dumps"

cleanup() {
  xcrun simctl terminate "$simulator" "$bundle" >/dev/null 2>&1 || true
  xcrun simctl terminate "$simulator" "$competitor_bundle" >/dev/null 2>&1 || true
  for name in TRACKER_CASES TRACKER_SCHEME TRACKER_SURFACES TRACKER_MINIMAL_COMPETITOR TRACKER_EXPECT_PERMISSION_PROMPT; do
    xcrun simctl spawn "$simulator" launchctl unsetenv "$name" >/dev/null 2>&1 || true
  done
  xcrun simctl status_bar "$simulator" clear >/dev/null 2>&1 || true
  if [ -n "${old_appearance:-}" ]; then xcrun simctl ui "$simulator" appearance "$old_appearance" >/dev/null 2>&1 || true; fi
  if [ -n "${old_content_size:-}" ]; then xcrun simctl ui "$simulator" content_size "$old_content_size" >/dev/null 2>&1 || true; fi
  rmdir "$lock_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

xcrun simctl list devices -j | jq -e --arg id "$simulator" '
  [.devices[][] | select(.udid == $id and .state == "Booted")] | length == 1
' >/dev/null || { echo "dedicated iPhone simulator is not booted: $simulator" >&2; exit 1; }
old_appearance="$(xcrun simctl ui "$simulator" appearance)"
old_content_size="$(xcrun simctl ui "$simulator" content_size)"
xcrun simctl ui "$simulator" content_size "$content_size"
xcrun simctl status_bar "$simulator" override --time '9:41' --batteryLevel 100 \
  --batteryState charged --wifiBars 3 --cellularBars 4

if [ -n "$competitor_app" ]; then
  [ -d "$competitor_app" ] || { echo "minimal-island competitor app not found: $competitor_app" >&2; exit 1; }
  xcrun simctl install "$simulator" "$competitor_app"
fi

project=(
  -project "$project_dir/ios/ILoveTrains.xcodeproj"
  -scheme ILoveTrains
  -derivedDataPath "$derived"
  -destination "platform=iOS Simulator,id=$simulator"
  -parallel-testing-enabled NO
  CODE_SIGNING_ALLOWED=NO
)

export_attachments() {
  local result="$1" lane="$2" exported="$out/attachments/.export-$lane"
  [ -d "$result" ] || { echo "missing result bundle: $result" >&2; return 1; }
  mkdir -p "$exported"
  xcrun xcresulttool export attachments --path "$result" --output-path "$exported" \
    >"$out/logs/export-$lane.log" 2>&1 || return 1
  [ -f "$exported/manifest.json" ] || { echo "attachment export has no manifest: $lane" >&2; return 1; }
  while IFS=$'\t' read -r file suggested; do
    [ -n "$file" ] && [ -f "$exported/$file" ] || continue
    name="$(printf '%s' "$suggested" | sed -E 's/_[0-9]+_[A-F0-9-]+(\.[^.]+)$/\1/')"
    case "$name" in
      *.png) cp "$exported/$file" "$out/$name" ;;
      *.txt) cp "$exported/$file" "$out/dumps/$name" ;;
      *) cp "$exported/$file" "$out/attachments/$name" ;;
    esac
  done < <(jq -r '.[] | .attachments[] | [.exportedFileName, .suggestedHumanReadableName] | @tsv' "$exported/manifest.json")
  cp "$exported/manifest.json" "$out/attachments/manifest-$lane.json"
}

run_ui_test() {
  local lane="$1" method="$2" scheme="$3" expect_permission_prompt="${4:-0}"
  local result="$out/results/$lane.xcresult" log="$out/logs/$lane.log" status export_status=0
  rm -rf "$result"
  xcrun simctl spawn "$simulator" launchctl setenv TRACKER_CASES "$cases"
  xcrun simctl spawn "$simulator" launchctl setenv TRACKER_SCHEME "$scheme"
  xcrun simctl spawn "$simulator" launchctl setenv TRACKER_SURFACES "$surfaces"
  xcrun simctl spawn "$simulator" launchctl setenv TRACKER_MINIMAL_COMPETITOR \
    "$([ -n "$competitor_app" ] && printf 1 || printf 0)"
  xcrun simctl spawn "$simulator" launchctl setenv TRACKER_EXPECT_PERMISSION_PROMPT "$expect_permission_prompt"
  set +e
  env TRACKER_CASES="$cases" TRACKER_SCHEME="$scheme" TRACKER_SURFACES="$surfaces" \
    TRACKER_MINIMAL_COMPETITOR="$([ -n "$competitor_app" ] && printf 1 || printf 0)" \
    TRACKER_EXPECT_PERMISSION_PROMPT="$expect_permission_prompt" \
    xcodebuild "${project[@]}" -resultBundlePath "$result" \
      "-only-testing:ILoveTrainsUITests/TravelTrackerFlowTests/$method" test 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  set -e
  export_attachments "$result" "$lane" || export_status=$?
  [ "$status" -eq 0 ] || return "$status"
  [ "$export_status" -eq 0 ] || return "$export_status"
}

capture_status=0
for scheme in "${requested_schemes[@]}"; do
  xcrun simctl ui "$simulator" appearance "$scheme"
  run_ui_test "capture-$scheme" testCaptureSystemSurfaces "$scheme" || capture_status=$?
  [ "$capture_status" -eq 0 ] || break
done
[ "$capture_status" -eq 0 ] || exit "$capture_status"

if [ "${CAPTURE_ONLY:-0}" != 1 ]; then
  xcrun simctl ui "$simulator" appearance "${requested_schemes[0]}"
  run_ui_test lifecycle-inference testAutomaticTravelModeStartsTracker "${requested_schemes[0]}"
  run_ui_test lifecycle-clock testWallClockStaleBoundaryAndForegroundLifecycle "${requested_schemes[0]}"
  run_ui_test lifecycle-routing testDismissalReplacementAndColdTap "${requested_schemes[0]}"
  xcrun simctl uninstall "$simulator" "$bundle"
  run_ui_test lifecycle-permission testLiveActivityDenialPreservesFocus "${requested_schemes[0]}" 1
fi

for scheme in "${requested_schemes[@]}"; do
  for capture_case in "${requested_cases[@]}"; do
    if [[ ",$surfaces," == *,notification-center,* ]]; then
      [ -f "$out/tracker-$capture_case-$scheme-notification-center.png" ] || { echo "missing requested Notification Center capture: $capture_case/$scheme" >&2; exit 1; }
    fi
    [ "$capture_case" = ride ] || continue
    for surface in compact expanded minimal; do
      [[ ",$surfaces," == *,$surface,* ]] || continue
      [ -f "$out/tracker-ride-$scheme-island-$surface.png" ] || { echo "missing requested island capture: $surface/$scheme" >&2; exit 1; }
    done
  done
done

first="$(find "$out" -maxdepth 1 -name '*.png' -type f ! -name 'failure-*' -print -quit)"
[ -n "$first" ] || { echo "tracker UI tests produced no screenshots" >&2; exit 1; }
case "$size" in
  402x874) expected_width=1206; expected_height=2622 ;;
  390x844) expected_width=1170; expected_height=2532 ;;
esac
while IFS= read -r capture; do
  width="$(sips -g pixelWidth "$capture" | awk '/pixelWidth/{print $2}')"
  height="$(sips -g pixelHeight "$capture" | awk '/pixelHeight/{print $2}')"
  [ "$width" = "$expected_width" ] && [ "$height" = "$expected_height" ] || {
    echo "capture pixel size ${width}x${height} does not match requested $size at 3x: $capture" >&2
    exit 1
  }
done < <(find "$out" -maxdepth 1 -name '*.png' -type f ! -name 'failure-*' -print)
width="$expected_width"
height="$expected_height"
device="$(xcrun simctl list devices -j | jq -r --arg id "$simulator" '.devices[][] | select(.udid == $id) | .name')"
runtime="$(xcrun simctl list devices -j | jq -r --arg id "$simulator" '.devices | to_entries[] | select(any(.value[]; .udid == $id)) | .key')"
{
  printf 'simulator=%s\n' "$simulator"
  printf 'device=%s\n' "$device"
  printf 'runtime=%s\n' "$runtime"
  printf 'requested_size=%s\n' "$size"
  printf 'capture_pixels=%sx%s\n' "$width" "$height"
  printf 'content_size=%s\n' "$content_size"
  printf 'schemes=%s\n' "$schemes"
  printf 'cases=%s\n' "$cases"
  printf 'surfaces=%s\n' "$surfaces"
  printf 'capture_only=%s\n' "${CAPTURE_ONLY:-0}"
  printf 'fixture=tools/fixtures/conformance/travel-tracker.json\n'
  printf 'capture_clock=fixed DEBUG presentation; real ActivityKit system surface\n'
  printf 'lifecycle_clock=wall relative through production ActivityKit controller\n'
  if [ -n "$competitor_app" ]; then
    printf 'minimal_island=real cross-app contention with %s\n' "$competitor_bundle"
  else
    printf 'minimal_island=not run; set MINIMAL_COMPETITOR_APP to a distinct ActivityKit app\n'
  fi
  printf 'limits=simulator evidence does not establish physical-device suspension, delivery, power, or island selection\n'
} > "$out/device.txt"

count="$(find "$out" -maxdepth 1 -name '*.png' -type f | wc -l | tr -d ' ')"
printf 'Captured and checked %s iOS system frames for %s on %s: %s\n' "$count" "$size" "$simulator" "$out"
