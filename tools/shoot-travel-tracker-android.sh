#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
size="${1:-390x844}"
serial="${ANDROID_SERIAL:-}"
font_scale="${FONT_SCALE:-1.0}"
out="${OUT:-/tmp/ilovetrains-tracker-android-${size}-${font_scale}}"
cases="${TRACKER_CASES:-ride,transfer,final,unknown-platform,tight-transfer,offline-stale,long-content,missed-connection,first-leg-cancelled,final-leg-cancelled}"
schemes="${SCHEMES:-dark,light}"
surfaces="${SURFACES:-shade,lock}"
adb_bin="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
package="com.ilovetrains.app"
runner="$package.test/androidx.test.runner.AndroidJUnitRunner"
test_class="$package.TravelTrackerIntegrationTest"
lock_dir="/tmp/ilovetrains-tracker-android-${serial}.lock"

case "$size" in 390x844|412x732) ;; *) echo "usage: $0 [390x844|412x732]" >&2; exit 2;; esac
case "$font_scale" in 1.0|1.3) ;; *) echo "FONT_SCALE must be 1.0 or 1.3" >&2; exit 2;; esac
[[ "$serial" == emulator-* ]] || { echo "ANDROID_SERIAL must name the dedicated emulator" >&2; exit 2; }
[ -x "$adb_bin" ] || { echo "adb not found: $adb_bin" >&2; exit 1; }
mkdir "$lock_dir" 2>/dev/null || { echo "tracker drive already owns $serial ($lock_dir)" >&2; exit 1; }
trap 'rmdir "$lock_dir" >/dev/null 2>&1 || true' EXIT INT TERM

adb() { "$adb_bin" -s "$serial" "$@"; }
setting() { adb shell settings get "$1" "$2" | tr -d '\r'; }
restore_setting() {
  local namespace="$1" name="$2" value="$3"
  if [ "$value" = null ] || [ -z "$value" ]; then adb shell settings delete "$namespace" "$name" >/dev/null 2>&1 || true
  else adb shell settings put "$namespace" "$name" "$value" >/dev/null 2>&1 || true; fi
}

[ "$(adb get-state 2>/dev/null)" = device ] || { echo "$serial is not ready" >&2; rmdir "$lock_dir"; exit 1; }
[ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1 ] || { echo "$serial is not an emulator" >&2; rmdir "$lock_dir"; exit 1; }
printf 'Using %s. This tool repeatedly clears com.ilovetrains.app data on that dedicated emulator.\n' "$serial"

size_state="$(adb shell wm size | tr -d '\r')"
old_size="$(printf '%s\n' "$size_state" | awk '/Override size/{print $3}')"
density="$(adb shell wm density | awk '/Physical density/{physical=$3} /Override density/{override=$3} END{print override ? override : physical}')"
old_font="$(setting system font_scale)"
old_night="$(adb shell cmd uimode night 2>/dev/null | awk '{print tolower($NF)}' | tr -d '\r')"
old_show="$(setting secure lock_screen_show_notifications)"
old_private="$(setting secure lock_screen_allow_private_notifications)"
old_lock_disabled="$(adb shell locksettings get-disabled | tr -d '\r')"

cleanup() {
  adb shell cmd statusbar collapse >/dev/null 2>&1 || true
  adb shell input keyevent WAKEUP >/dev/null 2>&1 || true
  adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
  adb shell input keyevent 82 >/dev/null 2>&1 || true
  if [ -n "$old_size" ]; then adb shell wm size "$old_size" >/dev/null 2>&1 || true
  else adb shell wm size reset >/dev/null 2>&1 || true; fi
  adb shell settings put system font_scale "$old_font" >/dev/null 2>&1 || true
  case "$old_night" in yes|no|auto|custom_yes|custom_no) adb shell cmd uimode night "$old_night" >/dev/null 2>&1 || true;; esac
  restore_setting secure lock_screen_show_notifications "$old_show"
  restore_setting secure lock_screen_allow_private_notifications "$old_private"
  adb shell locksettings set-disabled "$old_lock_disabled" >/dev/null 2>&1 || true
  rmdir "$lock_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

width_dp="${size%x*}"; height_dp="${size#*x}"
read -r width_px height_px < <(python3 - "$width_dp" "$height_dp" "$density" <<'PY'
import sys
w, h, density = map(float, sys.argv[1:])
print(round(w * density / 160), round(h * density / 160))
PY
)
adb shell wm size "${width_px}x${height_px}" >/dev/null
adb shell settings put system font_scale "$font_scale" >/dev/null
adb shell settings put secure lock_screen_show_notifications 1 >/dev/null
adb shell settings put secure lock_screen_allow_private_notifications 1 >/dev/null
adb shell input keyevent WAKEUP >/dev/null
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb shell input keyevent 82 >/dev/null 2>&1 || true
adb shell locksettings set-disabled false >/dev/null

if [ -d "$out" ] && [ -n "$(find "$out" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "output directory is not empty: $out" >&2
  exit 2
fi
mkdir -p "$out/logs" "$out/dumps" "$out/cards"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi
(
  cd "$project_dir/android"
  env -u ILOVETRAINS_KEYSTORE -u ILOVETRAINS_KEYSTORE_PASSWORD_FILE \
    ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest --console=plain
) | tee "$out/logs/build.log"

main_apk="$project_dir/android/app/build/outputs/apk/debug/app-debug.apk"
test_apk="$project_dir/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
adb install -r "$main_apk" >/dev/null
adb install -r -t "$test_apk" >/dev/null

instrument() {
  local method="$1" log="$2"; shift 2
  adb shell am instrument -w "$@" -e class "$test_class#$method" "$runner" | tee "$log"
  grep -q '^OK (' "$log" || { echo "$method failed; see $log" >&2; return 1; }
  if grep -Eq 'INSTRUMENTATION_STATUS_CODE: -3|AssumptionViolatedException' "$log"; then
    echo "$method was skipped; see $log" >&2
    return 1
  fi
}

reset_granted() {
  adb shell cmd statusbar collapse >/dev/null 2>&1 || true
  adb shell input keyevent WAKEUP >/dev/null 2>&1 || true
  adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
  adb shell pm clear "$package" >/dev/null
  if [ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 33 ]; then
    adb shell pm grant "$package" android.permission.POST_NOTIFICATIONS >/dev/null
  fi
}

set_channel_enabled() {
  local wanted="$1" xml="$out/logs/channel-setting.xml"
  adb shell am start -a android.settings.CHANNEL_NOTIFICATION_SETTINGS \
    --es android.provider.extra.APP_PACKAGE "$package" \
    --es android.provider.extra.CHANNEL_ID current_journey >/dev/null
  sleep 1
  adb shell uiautomator dump /sdcard/ilovetrains-channel.xml >/dev/null
  adb pull /sdcard/ilovetrains-channel.xml "$xml" >/dev/null
  read -r current tap_x tap_y < <(python3 - "$xml" <<'PY'
import re, sys, xml.etree.ElementTree as ET
node = next((n for n in ET.parse(sys.argv[1]).getroot().iter('node') if n.attrib.get('resource-id') == 'android:id/switch_widget'), None)
if node is None:
    raise SystemExit('notification channel switch missing')
x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.attrib['bounds']))
print(node.attrib.get('checked'), (x1 + x2) // 2, (y1 + y2) // 2)
PY
)
  if { [ "$wanted" = true ] && [ "$current" != true ]; } || { [ "$wanted" = false ] && [ "$current" = true ]; }; then
    adb shell input tap "$tap_x" "$tap_y" >/dev/null
    sleep 1
  fi
  adb shell input keyevent HOME >/dev/null
}

active_tracker_notification() {
  adb shell dumpsys notification --noredact | awk -v package="$package" '
    /^  Notification List:/ { list = 1; next }
    list && /^  mArchive=/ { exit }
    list && /NotificationRecord/ {
      if (found) exit
      if (index($0, "pkg=" package " ") && index($0, " id=4108 ")) found = 1
    }
    found { print }
    END { if (!found) exit 1 }
  '
}

active_tracker_service() {
  adb shell dumpsys activity services "$package" | awk -v package="$package" '
    /^[[:space:]]*\* ServiceRecord\{/ {
      if (capture) exit
      capture = index($0, package "/.TravelTrackerService") > 0
      if (capture) found = 1
    }
    capture { print }
    END { if (!found) exit 1 }
  '
}

notification_identity() {
  python3 -c '
import re, sys
text = sys.stdin.read()
record = re.search(r"NotificationRecord\((0x[0-9a-f]+):", text)
created = re.search(r"mCreationTimeMs=(\d+)", text)
if record is None or created is None:
    raise SystemExit(1)
print(record.group(1), created.group(1))
'
}

focus_snapshot() {
  adb exec-out run-as "$package" cat files/personal-v1.json | python3 -c '
import json, sys
d = json.load(sys.stdin)
f = d["focus"]
legs = f["journey"]["legDetail"]
value = {
    "tripId": f["tripId"], "reverse": f["reverse"], "pinned": f["pinned"],
    "retained": f["journey"]["retained"], "rides": len(d.get("rides", [])),
    "legs": [{
        "line": leg["line"]["name"], "departure": leg["departure"], "arrival": leg["arrival"],
        "fromPlatform": leg["from"].get("platform"), "toPlatform": leg["to"].get("platform"),
        "cancelled": leg["cancelled"],
    } for leg in legs],
}
print(json.dumps(value, sort_keys=True, separators=(",", ":")))
'
}

reset_granted
adb shell rm -rf /sdcard/Android/data/com.ilovetrains.app/files/tracker-system
capture_status=0
set +e
instrument captureSystemSurfaceMatrix "$out/logs/capture-matrix.log" \
  -e trackerCases "$cases" -e trackerSchemes "$schemes" -e trackerSurfaces "$surfaces"
capture_status=$?
set -e
adb pull /sdcard/Android/data/com.ilovetrains.app/files/tracker-system/. "$out" >/dev/null
for bounds_file in "$out"/*.bounds; do
  [ -f "$bounds_file" ] || continue
  stem="$(basename "$bounds_file" .bounds)"
  read -r crop_x crop_y crop_right crop_bottom < "$bounds_file"
  crop_w=$((crop_right - crop_x)); crop_h=$((crop_bottom - crop_y))
  cp "$out/$stem.png" "$out/cards/$stem.png"
  sips -c "$crop_h" "$crop_w" --cropOffset "$crop_y" "$crop_x" "$out/cards/$stem.png" >/dev/null
  mv "$out/$stem.txt" "$out/dumps/$stem.txt"
  mv "$out/$stem-notification.txt" "$out/dumps/$stem-notification.txt"
  rm "$bounds_file"
  sips -g pixelWidth -g pixelHeight "$out/$stem.png" | tail -2 | tr '\n' ' ' >> "$out/logs/captures.log"
  printf ' %s\n' "$stem" >> "$out/logs/captures.log"
done
if [ "$capture_status" -ne 0 ]; then
  exit "$capture_status"
fi

sdk="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
if [ "${CAPTURE_ONLY:-0}" != 1 ]; then
integration_methods=(
  productionLocationInferenceStartsTrackerAutomatically
  lifecyclePinPolicyStartsInferredButNotPinAlone
  browsingDoesNotReplaceTrackerAndCurrentTapWins
  dismissalSuppressesTheExactFocusAndAllowsReplacement
  systemUiSwipeDismissesAndSuppressesTheFocus
  backgroundServiceAdvancesStagesAndCompletes
  lockedServiceAdvancesStagesAndCompletes
  retainedTimesAndCancellationStayOnChosenService
  everyAcceptedFixtureKeepsRequiredFacts
  progressMissedConnectionAndCancellationUseHonestTemplates
)
for method in "${integration_methods[@]}"; do
  reset_granted
  if [ "$method" = productionLocationInferenceStartsTrackerAutomatically ]; then
    instrument "$method" "$out/logs/test-$method.log" -e trackerDriverStep fresh-location-inference
  else
    instrument "$method" "$out/logs/test-$method.log"
  fi
done

reset_granted
instrument persistDismissedFocusForRelaunchCheck "$out/logs/test-dismiss-before-relaunch.log" -e trackerDriverStep persist-dismiss
instrument suppressionSurvivesRelaunch "$out/logs/test-dismiss-after-relaunch.log" -e trackerDriverStep verify-dismiss

reset_granted
instrument seedSystemSurface "$out/logs/test-process-death-seed.log" -e trackerCase ride
adb shell am start -n "$package/.MainActivity" >/dev/null
sleep 2
adb shell input keyevent HOME >/dev/null
for _ in $(seq 1 20); do
  if adb shell cmd notification list | grep -q "|$package|4108|" && \
      active_tracker_notification | grep -q 'Central in'; then
    break
  fi
  sleep 0.5
done
old_pid="$(adb shell pidof "$package" | tr -d '\r')"
[ -n "$old_pid" ] || { echo "tracker process missing before SIGKILL" >&2; exit 1; }
tracker_before="$(adb exec-out run-as "$package" sha256sum shared_prefs/tracker-v1.xml)"
focus_before="$(focus_snapshot)"
active_tracker_notification > "$out/logs/test-process-death-before-notification.txt"
grep -q 'Central in' "$out/logs/test-process-death-before-notification.txt"
grep -q 'Kellyville' "$out/logs/test-process-death-before-notification.txt"
read -r before_record before_created < <(notification_identity < "$out/logs/test-process-death-before-notification.txt")
set +e
adb shell run-as "$package" kill -9 "$old_pid" >/dev/null 2>&1
kill_status=$?
set -e
[ "$kill_status" -eq 0 ] || { echo "SIGKILL command failed with status $kill_status" >&2; exit 1; }
new_pid=""
for _ in $(seq 1 60); do
  new_pid="$(adb shell pidof "$package" 2>/dev/null || true)"
  new_pid="${new_pid//$'\r'/}"
  if [ -n "$new_pid" ] && [ "$new_pid" != "$old_pid" ]; then
    active_tracker_service > "$out/logs/test-process-death-after-service.txt" 2>/dev/null || true
    active_tracker_notification > "$out/logs/test-process-death-after-notification.txt" 2>/dev/null || true
    after_record=""
    after_created=""
    read -r after_record after_created < <(
      notification_identity < "$out/logs/test-process-death-after-notification.txt" 2>/dev/null || true
    ) || true
    if grep -Eq "app=ProcessRecord\\{[^ ]+ ${new_pid}:$package/" "$out/logs/test-process-death-after-service.txt" && \
        grep -q 'isForeground=true foregroundId=4108' "$out/logs/test-process-death-after-service.txt" && \
        grep -Eq 'restartCount=[1-9][0-9]*' "$out/logs/test-process-death-after-service.txt" && \
        [ -n "${after_record:-}" ] && [ "$after_record" != "$before_record" ] && \
        [ "${after_created:-0}" -gt "$before_created" ] && \
        grep -q 'Central in' "$out/logs/test-process-death-after-notification.txt" && \
        grep -q 'Kellyville' "$out/logs/test-process-death-after-notification.txt"; then
      break
    fi
  fi
  sleep 0.5
done
[ -n "$new_pid" ] && [ "$new_pid" != "$old_pid" ] || { echo "tracker process did not restart after SIGKILL" >&2; exit 1; }
grep -Eq "app=ProcessRecord\\{[^ ]+ ${new_pid}:$package/" "$out/logs/test-process-death-after-service.txt"
grep -q 'isForeground=true foregroundId=4108' "$out/logs/test-process-death-after-service.txt"
grep -Eq 'restartCount=[1-9][0-9]*' "$out/logs/test-process-death-after-service.txt"
read -r after_record after_created < <(notification_identity < "$out/logs/test-process-death-after-notification.txt")
[ "$after_record" != "$before_record" ]
[ "$after_created" -gt "$before_created" ]
grep -q 'Central in' "$out/logs/test-process-death-after-notification.txt"
grep -q 'Kellyville' "$out/logs/test-process-death-after-notification.txt"
tracker_after="$(adb exec-out run-as "$package" sha256sum shared_prefs/tracker-v1.xml)"
focus_after="$(focus_snapshot)"
[ "$tracker_before" = "$tracker_after" ] || { echo "tracker identity changed across SIGKILL" >&2; exit 1; }
[ "$focus_before" = "$focus_after" ] || { echo "focused journey identity or effective times changed across SIGKILL" >&2; exit 1; }
printf 'kill_status=%s\nold_pid=%s\nnew_pid=%s\nbefore_notification=%s %s\nafter_notification=%s %s\ntracker_hash=%s\nfocus=%s\n' \
  "$kill_status" "$old_pid" "$new_pid" "$before_record" "$before_created" "$after_record" "$after_created" \
  "$tracker_after" "$focus_after" > "$out/logs/test-process-death-restart.log"

reset_granted
instrument seedSystemSurface "$out/logs/test-coldstart-seed.log" -e trackerCase ride
instrument tapAfterTaskRemovalStartsMatchingDetail "$out/logs/test-task-removed-tap.log" -e trackerDriverStep cold-tap

if [ "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 33 ]; then
  adb shell pm clear "$package" >/dev/null
  adb shell pm revoke "$package" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
  adb shell pm clear-permission-flags "$package" android.permission.POST_NOTIFICATIONS user-set user-fixed >/dev/null
  instrument productionInferenceRequestsNotificationPermissionOnce "$out/logs/test-permission-prompt.log" -e trackerDriverStep permission-prompt

  adb shell pm clear "$package" >/dev/null
  adb shell pm revoke "$package" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
  adb shell pm clear-permission-flags "$package" android.permission.POST_NOTIFICATIONS user-set user-fixed >/dev/null
  instrument productionInferenceDenialDoesNotPromptAgain "$out/logs/test-permission-prompt-deny.log" -e trackerDriverStep permission-prompt-deny

  adb shell pm clear "$package" >/dev/null
  adb shell pm revoke "$package" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
  instrument deniedNotificationsKeepInAppFocusWithoutService "$out/logs/test-permission-denied.log" -e trackerDriverStep permission-denied
else
  echo "permission denial: skipped below API 33" | tee -a "$out/logs/limitations.log"
fi

reset_granted
adb shell am start -n "$package/.MainActivity" >/dev/null
sleep 1
set_channel_enabled false
instrument blockedChannelKeepsInAppFocusWithoutService "$out/logs/test-channel-blocked.log" -e trackerDriverStep channel-blocked
set_channel_enabled true

if [ "$sdk" -lt 36 ]; then
  reset_granted
  instrument olderAndroidUsesUsefulOrdinaryNotification "$out/logs/test-ordinary-fallback.log"
else
  echo "ordinary API 35 fallback: skipped on API $sdk; run this tool on the agreed API 35 emulator" | tee -a "$out/logs/limitations.log"
fi
fi

{
  printf 'serial=%s\n' "$serial"
  printf 'device=%s\n' "$(adb shell getprop ro.product.model | tr -d '\r')"
  printf 'build=%s\n' "$(adb shell getprop ro.build.fingerprint | tr -d '\r')"
  printf 'sdk=%s\n' "$sdk"
  printf 'size_dp=%s\n' "$size"
  printf 'size_px=%sx%s\n' "$width_px" "$height_px"
  printf 'density=%s\n' "$density"
  printf 'font_scale=%s\n' "$font_scale"
  printf 'schemes=%s\n' "$schemes"
  printf 'cases=%s\n' "$cases"
  printf 'surfaces=%s\n' "$surfaces"
  printf 'capture_only=%s\n' "${CAPTURE_ONLY:-0}"
  if [ "${CAPTURE_ONLY:-0}" = 1 ]; then
    printf 'capture_mode=deterministic system-surface capture only; lifecycle checks skipped\n'
  else
    printf 'capture_mode=deterministic system-surface capture followed by lifecycle checks\n'
  fi
  printf 'fixture=tools/fixtures/conformance/travel-tracker.json\n'
  printf 'capture_clock=fixed fixture review epoch through DEBUG-only model seam\n'
  if [ "${CAPTURE_ONLY:-0}" != 1 ]; then
    printf 'lifecycle_clock=wall-relative fixture shift through production clock\n'
    printf 'process_boundary=separate instrumentation processes, production-process SIGKILL/sticky restart, and notification tap after Activity task removal\n'
  fi
} > "$out/device.txt"

count="$(find "$out" -maxdepth 1 -name '*.png' -type f | wc -l | tr -d ' ')"
printf 'Captured and checked %s system frames at %s dp, font scale %s on %s: %s\n' "$count" "$size" "$font_scale" "$serial" "$out"
