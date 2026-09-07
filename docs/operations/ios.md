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
tools/build-ios.sh --test
tools/build-ios.sh --unsigned-archive
```

The default output directory is `ios/build`. Set `ILOVETRAINS_IOS_BUILD_DIR` to
use another location and `ILOVETRAINS_SIMULATOR_ID` to select a simulator UUID.
Tests disable parallel execution because they drive real app state. Core tests
cover the bundled timetable, calendars/DST, realtime identities and expiry,
package recovery, persistent state and web-generated conformance. UI tests
create and reopen a new Mascot–Kellyville trip with network transport disabled,
then verify pinning, preferences and feedback-draft navigation.

The checked-in project is ready to build. After adding files, regenerate it
with `ruby tools/generate-ios-project.rb` (requires the `xcodeproj` Ruby gem).
It reads the app version from `web/js/version.js` and references the shared
conformance fixtures. No script reads or sources `.env`.

`ios/releases/ILoveTrains.xcarchive` from `--unsigned-archive` is an **unsigned
Release archive**, useful for inspection and later signing. It cannot be
installed on a phone in that form. A simulator `.app` also cannot run on a
physical iPhone.

## Install on Jeremy's iPhone

The project selects Jeremy Vun's existing development team `6TTZ5U96V9` with
automatic signing. On 2026-09-07, Xcode rejected the saved login for
`jeremy.vun@outlook.com`; no provisioning profile for this new app could be
created. The phone was unavailable and the owner approved simulator verification
for this session.

1. In Xcode → Settings → Apple Accounts, sign back into the Apple Account.
2. Connect and unlock the iPhone, trust the Mac if prompted, and enable Developer
   Mode under iPhone Settings → Privacy & Security. Restart when iOS requests it.
3. Open `ios/ILoveTrains.xcodeproj`, choose `ILoveTrains` and the connected iPhone
   as the run destination. Keep Automatically manage signing enabled for the
   configured team, then press Run.
4. If iOS asks to trust the developer, follow its Settings instruction. Reinstall
   an update with the same bundle/team to preserve saved trips.

After fixing the account, `tools/build-ios.sh --device` builds a signed Release
application. Xcode's Run action is the simplest installation path; it handles
the phone's registration and profile. Development provisioning expires, so its
renewal depends on the Apple account's membership. TestFlight/App Store delivery
has not been configured or published.

Apple's instructions cover [running on a device](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
and [registered-device signing](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices).

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
