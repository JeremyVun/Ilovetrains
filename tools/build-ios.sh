#!/bin/bash
# Build/test iOS or prepare a device archive. Never reads credentials or .env.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:---simulator}"
derived="${ILOVETRAINS_IOS_BUILD_DIR:-$PWD/ios/build}"
project=( -project ios/ILoveTrains.xcodeproj -scheme ILoveTrains -derivedDataPath "$derived" )
case "$mode" in
  --simulator|--test)
    simulator="${ILOVETRAINS_SIMULATOR_ID:-$(xcrun simctl list devices available -j | python3 -c 'import json,sys; d=json.load(sys.stdin)["devices"]; a=[x for k,v in d.items() for x in v if "iPhone" in x["name"]]; b=[x for x in a if x["state"]=="Booted"]; print((b or a)[-1]["udid"])')}"
    if [ "$mode" = --test ]; then
      xcrun simctl boot "$simulator" 2>/dev/null || true
      xcrun simctl bootstatus "$simulator" -b
      xcodebuild "${project[@]}" -destination "platform=iOS Simulator,id=$simulator" -parallel-testing-enabled NO test CODE_SIGNING_ALLOWED=NO
    else
      xcodebuild "${project[@]}" -destination "platform=iOS Simulator,id=$simulator" build CODE_SIGNING_ALLOWED=NO
    fi
    ;;
  --device)
    xcodebuild "${project[@]}" -destination 'generic/platform=iOS' -configuration Release -allowProvisioningUpdates build
    ;;
  --unsigned-archive)
    mkdir -p ios/releases
    xcodebuild "${project[@]}" -destination 'generic/platform=iOS' -configuration Release -archivePath "$PWD/ios/releases/ILoveTrains.xcarchive" archive CODE_SIGNING_ALLOWED=NO
    ;;
  *) echo "Usage: tools/build-ios.sh [--simulator|--test|--device|--unsigned-archive]" >&2; exit 2 ;;
esac
