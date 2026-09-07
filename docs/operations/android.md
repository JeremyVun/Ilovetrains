# Android builds and installation

The Kotlin/Compose project is `android/`, package `com.ilovetrains.app`.
Android 8.0 (API 26) or newer is supported. The app talks to the public HTTPS
API at `https://ilovetrains.jeremyvun.com`; there is no TfNSW key in the APK.

## Build

Install Java 17 and Android SDK platform/build-tools 36. The Gradle wrapper
pins the build; set `JAVA_HOME` and `ANDROID_HOME` as needed. The helper uses
the usual Homebrew Java 17 and macOS SDK locations when available.

```sh
tools/build-android.sh            # debug APK, JVM tests and Android lint
tools/build-android.sh --release  # signed/shrunk APK, release tests and lint
```

No build script reads or sources an `.env` file. The offline bootstrap is
bundled in the application, so installing and creating a trip does not require
a first online session. Its coverage is visible in Settings.

The release helper creates a local signing identity on first use in
`~/.local/share/ilovetrains/android-signing/`, restricted to the owner. Preserve
that directory in a secure backup: future updates require the same signing
key. `ILOVETRAINS_SIGNING_DIR` can select an existing signing directory.
Signing files and release outputs are excluded from git.

Release output is `android/releases/ilovetrains-<version>.apk`, with a SHA-256
sidecar. The helper also stages that APK in `web/downloads/` and renders
`web/downloads/index.html` from `index.template.html` with the version and
checksum, so `/downloads/` is the phone download page in the server image. Build the APK before the Docker image to include
the phone download. The PWA service worker does not cache the APK.
Android's display version and filename read the canonical `web/js/version.js`;
increment Android `versionCode` for each installable update. Building the APK
does not publish it: the server image must still be deployed.

## Install

Open `https://ilovetrains.jeremyvun.com/downloads/ilovetrains-<version>.apk` on
the phone after deployment, download it, and open the download. Android may
ask to allow installation from that browser. Alternatively, copy the APK
to the phone or install over USB debugging:

```sh
adb install -r android/releases/ilovetrains-1.2.4.apk
```

A debug APK has a different signing identity. Android cannot replace it with
the signed release; remove the debug installation first. That removes the
debug app's local data. Normal releases signed by the persistent key update
in place and preserve trips.

## Verification

The JVM suite covers domain/storage behavior and web-generated prediction
and departure-row conformance. Regenerate shared outputs with
`node tools/export-android-conformance.mjs` after an intentional web logic
change; the web suite reads the same committed cases.

Instrumented tests use the real bundled SQLite package and native renderer:

```sh
cd android
./gradlew :app:connectedDebugAndroidTest
```

Run on an Android emulator/device with no other instrumentation session.
`OfflinePlannerInstrumentedTest` verifies train, metro, mixed and ferry
journeys, calendars, midnight/DST and bounded planning. The UI calibration
test renders controlled states using the same Compose entry point as the
application. Screenshot and real-client verification commands are indexed in
`tools/README.md`. Test hooks live in `androidTest`, outside release code.
The measured release checks and reviewed captures are recorded in
[android-verification.md](android-verification.md).

The public shared-data API, source joins, timetable replacement and routing
boundaries are in [native-data.md](../contracts/native-data.md). Deliberate
platform differences are in [android-deviations.md](../contracts/android-deviations.md).
