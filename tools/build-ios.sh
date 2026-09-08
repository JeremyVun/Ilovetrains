#!/bin/bash
# Build/test iOS or prepare a device archive. Never reads credentials or .env.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:---simulator}"
[ "$#" -eq 0 ] || shift
selection=()
case "$mode" in
  --unit|--ui)
    target=ILoveTrainsTests
    [ "$mode" != --ui ] || target=ILoveTrainsUITests
    if [ "$#" -eq 0 ]; then selection=( "-only-testing:$target" )
    else
      for test in "$@"; do
        [[ "$test" =~ ^[A-Za-z0-9_]+(/[A-Za-z0-9_]+)?$ ]] || { echo "expected TestClass[/testMethod], got $test" >&2; exit 2; }
        selection+=( "-only-testing:$target/$test" )
      done
    fi
    ;;
  *) [ "$#" -eq 0 ] || { echo "$mode takes no arguments" >&2; exit 2; } ;;
esac
derived="${ILOVETRAINS_IOS_BUILD_DIR:-$PWD/ios/build}"
project=( -project ios/ILoveTrains.xcodeproj -scheme ILoveTrains -derivedDataPath "$derived" )
case "$mode" in
  --simulator|--test|--unit|--ui)
    simulator="${ILOVETRAINS_SIMULATOR_ID:-$(xcrun simctl list devices available -j | python3 -c 'import json,sys; d=json.load(sys.stdin)["devices"]; a=[x for k,v in d.items() for x in v if "iPhone" in x["name"]]; b=[x for x in a if x["state"]=="Booted"]; print((b or a)[-1]["udid"])')}"
    if [ "$mode" != --simulator ]; then
      xcrun simctl boot "$simulator" 2>/dev/null || true
      tools/check-log.sh ios-boot xcrun simctl bootstatus "$simulator" -b
      tools/check-log.sh "ios-${mode#--}" xcodebuild "${project[@]}" -destination "platform=iOS Simulator,id=$simulator" -parallel-testing-enabled NO ${selection[@]+"${selection[@]}"} test CODE_SIGNING_ALLOWED=NO
    else
      tools/check-log.sh ios-build xcodebuild "${project[@]}" -destination "platform=iOS Simulator,id=$simulator" build CODE_SIGNING_ALLOWED=NO
    fi
    ;;
  --device)
    tools/check-log.sh ios-device xcodebuild "${project[@]}" -destination 'generic/platform=iOS' -configuration Release -allowProvisioningUpdates build
    ;;
  --unsigned-archive)
    mkdir -p ios/releases
    tools/check-log.sh ios-archive xcodebuild "${project[@]}" -destination 'generic/platform=iOS' -configuration Release -archivePath "$PWD/ios/releases/ILoveTrains.xcarchive" archive CODE_SIGNING_ALLOWED=NO
    ;;
  --testflight)
    # An App Store Connect API key makes the upload non-interactive; without one xcodebuild uses the account signed into Xcode.
    auth=()
    if [ -n "${ILOVETRAINS_ASC_KEY_ID:-}" ]; then
      key_path="${ILOVETRAINS_ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${ILOVETRAINS_ASC_KEY_ID}.p8}"
      [ -n "${ILOVETRAINS_ASC_ISSUER_ID:-}" ] || { echo "ILOVETRAINS_ASC_ISSUER_ID is required with ILOVETRAINS_ASC_KEY_ID" >&2; exit 2; }
      [ -r "$key_path" ] || { echo "App Store Connect key not readable: $key_path" >&2; exit 2; }
      auth=( -authenticationKeyPath "$key_path" -authenticationKeyID "$ILOVETRAINS_ASC_KEY_ID" -authenticationKeyIssuerID "$ILOVETRAINS_ASC_ISSUER_ID" )
    fi
    version="$(sed -n 's/.*MARKETING_VERSION = \(.*\);/\1/p' ios/ILoveTrains.xcodeproj/project.pbxproj | sort -u)"
    build="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \(.*\);/\1/p' ios/ILoveTrains.xcodeproj/project.pbxproj | sort -u)"
    [ "$(printf '%s\n' "$version" | wc -l)" -eq 1 ] && [ "$(printf '%s\n' "$build" | wc -l)" -eq 1 ] || { echo "app and extension versions differ; align MARKETING_VERSION and CURRENT_PROJECT_VERSION" >&2; exit 2; }
    archive="$PWD/ios/releases/TestFlight-$version-$build.xcarchive"
    mkdir -p ios/releases
    tools/check-log.sh ios-testflight-archive xcodebuild "${project[@]}" -destination 'generic/platform=iOS' -configuration Release -archivePath "$archive" -allowProvisioningUpdates ${auth[@]+"${auth[@]}"} archive
    tools/check-log.sh ios-testflight-upload xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist ios/TestFlight-ExportOptions.plist -exportPath "$PWD/ios/releases/TestFlight-upload" -allowProvisioningUpdates ${auth[@]+"${auth[@]}"}
    echo "Uploaded $version ($build) from $archive; Apple still has to process it before it appears in TestFlight."
    ;;
  *) echo "Usage: tools/build-ios.sh [--simulator|--test|--unit [TestClass[/testMethod]...]|--ui [TestClass[/testMethod]...]|--device|--unsigned-archive|--testflight]" >&2; exit 2 ;;
esac
