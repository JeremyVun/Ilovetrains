# iOS build and installation

The native SwiftUI project is `ios/ILoveTrains.xcodeproj`, scheme `ILoveTrains`,
bundle ID `com.ilovetrains.ios`. It supports iOS 17 and newer. Open it directly
in Xcode; no Swift package downloads or TfNSW credentials are needed. The public
HTTPS API remains `https://ilovetrains.jeremyvun.com`.

## Build and test

Verified toolchain: Xcode 26.4. Select the full Xcode installation with
`xcode-select` if command-line tools point elsewhere.

```sh
tools/build-ios.sh --simulator
tools/build-ios.sh --unit         # all core tests, including SQLite integration
tools/build-ios.sh --unit OfflinePlannerTests # optional class or class/method
tools/build-ios.sh --ui AppFlowTests/testCreatesNewTripAndReopensEntirelyOffline
tools/build-ios.sh --test
tools/build-ios.sh --unsigned-archive
tools/build-ios.sh --testflight   # signed archive + internal TestFlight upload, see below
```

The default output directory is `ios/build`. Set `ILOVETRAINS_IOS_BUILD_DIR` to
use another location and `ILOVETRAINS_SIMULATOR_ID` to select a simulator UUID.
Use `--unit` during logic iteration and `--ui` for affected app flows. Both
accept multiple `TestClass[/testMethod]` arguments in one invocation; without
filters they run their entire target. `--test` remains the complete core + UI
gate for final feature verification. Core tests are app-hosted and still need
a simulator. Keep independent Android/web work parallel, but give each iOS
drive its own simulator when running concurrently. Reuse build output and a
warm simulator between checks; shut down session-owned simulators afterward.
The helper prints elapsed time and a complete log path; `TEST_VERBOSE=1`
streams output and `TEST_LOG_DIR` selects the artifact directory.
Tests disable parallel execution because they drive real app state. Core tests
cover the bundled timetable, calendars/DST, realtime identities and expiry,
package recovery, persistent state and web-generated conformance. UI tests
create and reopen a new Mascot–Kellyville trip with network transport disabled,
then verify pinning, preferences and feedback-draft navigation.

The checked-in project is ready to build. After adding files, regenerate it
with `ruby tools/generate-ios-project.rb` (requires the `xcodeproj` Ruby gem).
It reads the app version from `web/js/version.js` and references the shared
conformance fixtures. No script reads or sources `.env`.

The app embeds `TravelTrackerWidget.appex`, bundle ID
`com.ilovetrains.ios.TravelTrackerWidget`. The generator compiles `ios/Shared/`
into both targets and `ios/TravelTrackerWidget/` only into the extension. Device
signing must cover both targets with the configured team. Live Activities use
local ActivityKit updates; no push entitlement or shared app group is needed.

`ios/releases/ILoveTrains.xcarchive` from `--unsigned-archive` is an **unsigned
Release archive**, useful for inspection and later signing. It cannot be
installed on a phone in that form. A simulator `.app` also cannot run on a
physical iPhone.

## Install on Jeremy's iPhone

The project selects Yee Vun's paid individual development team `8QYAPRZLHG`
with automatic signing. Xcode is signed in with the paid account
`perch.admin@gmail.com`; signed Release archiving was verified on 2026-09-08.

1. In Xcode → Settings → Apple Accounts, sign in with `perch.admin@gmail.com`,
   the account holding paid team `8QYAPRZLHG`.
2. Connect and unlock the iPhone, trust the Mac if prompted, and enable Developer
   Mode under iPhone Settings → Privacy & Security. Restart when iOS requests it.
3. Open `ios/ILoveTrains.xcodeproj`, choose `ILoveTrains` and the connected iPhone
   as the run destination. Keep Automatically manage signing enabled for the
   configured team, then press Run.
4. If iOS asks to trust the developer, follow its Settings instruction. Reinstall
   an update with the same bundle/team to preserve saved trips.

`tools/build-ios.sh --device` builds a signed Release
application. Xcode's Run action is the simplest installation path; it handles
the phone's registration and profile. Development provisioning expires, so its
renewal depends on the Apple account's membership. For installation through
TestFlight, use the distribution workflow below.

Apple's instructions cover [running on a device](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
and [registered-device signing](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices).

## TestFlight and App Store

The paid individual membership for Yee Vun (`perch.admin@gmail.com`), team
`8QYAPRZLHG`, renews on 2027-04-14. The owner accepted the updated Developer
Program agreement on 2026-09-08 and signed into Xcode with this account.
Xcode 26.4 successfully archived version 1.5.0 (5), signing both the app and
Live Activity extension. TestFlight requires an active paid membership.

The App Store Connect record is [ilovetrains, Apple ID 6809801045](https://appstoreconnect.apple.com/apps/6809801045/testflight).
Both explicit identifiers are registered on the paid team. The record uses
English (Australia), SKU `ilovetrains-ios`, and Full Access.
The first internal-only upload succeeded on 2026-09-08 at 22:23 AEST using
`ios/releases/TestFlight-1.5.0-5.xcarchive`; Apple accepted the package for
processing. A successful upload alone does not mean the build is installable:
verify TestFlight processing and group assignment before announcing availability.
The session could not complete that final check because Brave stopped exposing
page controls to automation. The internal group, owner invitation, and build
assignment remain pending; create group `Jeremy`, add `perch.admin@gmail.com`,
and assign the latest processed 1.5.0 build. No tester invitation has been sent.

1. Register explicit identifiers for `com.ilovetrains.ios` and
   `com.ilovetrains.ios.TravelTrackerWidget` under the correct paid team;
   automatic signing can register these. Create the iOS app in App Store
   Connect using the app identifier, name `ilovetrains`, primary language
   English (Australia), and SKU `ilovetrains-ios`.
   The widget does not get a separate App Store Connect app record.
2. Choose the ILoveTrains scheme and a generic iOS device destination in
   Xcode, then Product → Archive. Use Organizer → Distribute App → TestFlight
   Internal Only for personal testing. Xcode manages signing for both targets.
3. After Apple processes the upload, create an internal TestFlight group,
   add the build and the owner's App Store Connect user, and send the owner's
   invitation. Install TestFlight on the iPhone and accept that invitation.
   Each TestFlight build expires after 90 days; upload a new build to renew it.

### Upload from the command line

`tools/build-ios.sh --testflight` is the agent path. It archives a signed
Release build of the app and Live Activity extension to
`ios/releases/TestFlight-<version>-<build>.xcarchive`, then exports it with
`ios/TestFlight-ExportOptions.plist`, whose `destination: upload` sends the
package to internal-only TestFlight. It refuses to run when the app and
extension versions differ. The command sends the build to Apple; it does not
publish a public App Store release.

Authentication has two forms. Without any variables, `xcodebuild` uses the
Apple account signed into Xcode, which can prompt for the login keychain and
so is unsuitable for an unattended agent run. With an App Store Connect API
key the whole run is non-interactive:

```sh
export ILOVETRAINS_ASC_KEY_ID=<key id>
export ILOVETRAINS_ASC_ISSUER_ID=<issuer id>
tools/build-ios.sh --testflight
```

The key file defaults to `~/.appstoreconnect/private_keys/AuthKey_<key id>.p8`;
`ILOVETRAINS_ASC_KEY_PATH` overrides that. The key, its ID and the issuer ID
are secrets in the same sense as `TFNSW_API_KEY`: keep them in the process
environment, never in the repository or `.env`, and never print them. Agents
must not read the `.p8` file's contents; the script only checks that it is
readable.

One-time key setup by the owner, once per Mac:

1. In [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api),
   generate a **Team** key with the App Manager role (Developer is enough for
   uploads but cannot manage TestFlight groups). Note the Issuer ID shown on
   that page and the Key ID of the new key.
2. Download the `.p8` once; Apple never offers it again. Store it as
   `~/.appstoreconnect/private_keys/AuthKey_<key id>.p8` with mode 600.
3. Export the two IDs in the shell profile or the session that runs the
   upload. Nothing in the repository reads them except `--testflight`.

Every upload needs a build number the app record has not seen. Bump
`CURRENT_PROJECT_VERSION` in all targets of `ios/ILoveTrains.xcodeproj` (or in
`tools/generate-ios-project.rb` and regenerate) before running the script; the
export options' `manageAppVersionAndBuildNumber` lets Xcode advance a
conflicting number itself, so inspect the processed build number in App Store
Connect rather than trusting the archive name. Keep `MARKETING_VERSION` equal
to `web/js/version.js`.

Apple processes the upload for a few minutes. Poll with the App Store Connect
API using a JWT minted from the same key; do not announce availability until a
build reports `VALID`:

```sh
jwt="$(xcrun altool --generate-jwt --apiKey "$ILOVETRAINS_ASC_KEY_ID" --apiIssuer "$ILOVETRAINS_ASC_ISSUER_ID")"
curl -s -H "Authorization: Bearer $jwt" \
  'https://api.appstoreconnect.apple.com/v1/builds?filter[app]=6809801045&sort=-uploadedDate&limit=3&fields[builds]=version,processingState,expirationDate' \
  | python3 -c 'import json,sys; [print(b["attributes"]) for b in json.load(sys.stdin)["data"]]'
```

The Xcode Organizer remains available for the same upload by hand: Product →
Archive, then Distribute App → TestFlight Internal Only.

The app declares `ITSAppUsesNonExemptEncryption=false`: its network encryption
is Apple's URLSession HTTPS, and CryptoKit is used only for SHA-256 timetable
integrity checks. Reassess this declaration if encryption dependencies change.
The app includes its privacy manifest and an opaque 1024 px icon. iPad declares
all four orientations, as required for its multitasking support.

Public App Store release is a separate submission: prepare the description,
screenshots for supported device families, support and privacy-policy URLs,
privacy answers, age rating, review contact and notes, and price/availability.
Upload a build using App Store Connect distribution: an Internal Only build
cannot be used for external testing or a public release. Submit for App Review
after device verification and the normal iOS gates pass.

Apple references: [TestFlight workflow](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/),
[internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/),
[encryption declaration](https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption).

## Data and verification

The 20.8 MB bootstrap ZIP, its manifest and the 423-station index are bundled.
First installation can create new trips offline. Downloads use validated hashes,
size limits, SQLite integrity checks and atomic generation activation. User
state, caches and the active timetable remain on the phone. Uninstalling deletes
saved trips; there is no cloud backup or account recovery.

Keep iOS `Resources/timetable.zip`, `timetable-manifest.json` and `stations.json`
identical to the corresponding Android assets when regenerating the shared
bootstrap. The compiler command is in [native-data.md](../contracts/native-data.md).

Deliberate differences are in [ios-deviations.md](../contracts/ios-deviations.md).
Simulator observations and remaining physical-device checks are in
[ios-verification.md](ios-verification.md). Use `tools/shoot-ios.sh` for seeded
captures; its debug hooks and fixtures are excluded from Release builds.
