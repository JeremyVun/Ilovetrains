# Android verification

The Android client is calibrated against `assets/comps/latest/` with real mapped API fixtures exported by `tools/export-android-conformance.mjs`. Run the reproducible screenshot matrix on a booted `Medium_Phone` AVD:

```sh
OUT=/tmp/ilovetrains-android-390x844 tools/shoot-android.sh 390x844
OUT=/tmp/ilovetrains-android-412x732 tools/shoot-android.sh 412x732
OUT=/tmp/ilovetrains-android-font-1.3 FONT_SCALE=1.3 tools/shoot-android.sh 390x844
```

The instrument records its logical root, safe-drawing insets, content viewport and capture pixels in `metrics.txt`. Its edge-to-edge test window has no system decor, so all three runs reported zero safe-drawing insets and the full requested content viewport. Production app checks below use the real status and navigation bars.

## 7 September 2026 calibration

All 18 canonical frames passed at 390×844 dp, 412×732 dp, and 390×844 dp with Android font scale 1.3. The matrix covers dark and light Home, Board and Settings; live, scheduled, delayed and cancelled rows; pinned, inferred and completed focus; two-change detail; F1 Circular Quay–Manly; and the F4/F7 Pyrmont Bay Wharf–Double Bay Wharf transfer.

At 390×844 dp, six complete 96 dp Board rows and the end marker are visible below the 32 dp NOW anchor. At 412×732 dp, five complete rows and part of the sixth are visible initially; `board-end.png` proves the sixth row and end marker are reachable without reducing the contracted row size. A device test also inserts past rows after the future-only Board has rendered and verifies that reaching the top requests earlier services.

The 1.3× text run keeps long ferry endpoints, saved-trip metadata, service toggles and appearance choices readable. The Home transfer label gains vertical clearance at larger system text, and the saved-trip action moves below its complete metadata.

Durable review frames are in `assets/android/verification/`. Full run output remains reproducible with `tools/shoot-android.sh` rather than being checked in.

## Offline planner device gate

A clean API 36 `Medium_Phone` run passed the bundled timetable bootstrap, exact route assertions and transfer/platform stress cases. Measured offline planner times were 796 ms for first-install initialization, 1,604 ms cold, 19 ms warm, 15 ms for a new pair, and 29 ms for the default 24-service Board.

## Signed release drive

The signed `1.0.0` APK is 18,451,390 bytes with SHA-256
`258abd13d05582d1d329b370492fafb38d914bc13ae4003fc75af12cd2d3507e`.
It passed signature verification and installed cleanly on the API 36
`Medium_Phone` in 680 ms.

The public installer at
`https://ilovetrains.jeremyvun.com/downloads/ilovetrains-1.0.0.apk` returns
HTTP 200 with `application/vnd.android.package-archive`. A fresh download was
18,451,390 bytes, matched the release SHA-256 above byte for byte, and passed
APK Signature Scheme v2 verification.

The physical 1080×2400 px, 420 dpi display exposed a 411×914 dp window. The
production Compose content occupied pixels 63–2337: 24 dp below the status
bar and 24 dp above gesture navigation, leaving a 411×866 dp usable viewport.
No content or controls entered either system inset.

The release was driven through the following real flow:

1. Fuzzy-search and save Central → Parramatta.
2. Open its live Board, open a real two-change itinerary and pin it.
3. Force-stop and relaunch; the saved trip and pinned journey remain.
4. Enable airplane mode, force-stop and relaunch; the same journey opens from
   `OFFLINE · TIMETABLE`.
5. While still offline, create the previously uncached Circular Quay → Manly
   Wharf pair, open its six-service scheduled Board and detailed itinerary.
6. Force-stop and relaunch again; both saved trips, the pin and the new offline
   pair remain.
7. Advance the emulator clock past the pinned ferry's arrival. Home changes to
   `TRIP OVER`, records the ride and exposes `SHOW THE WAY BACK`; activating it
   loads Manly Wharf → Circular Quay from the offline timetable. Automatic time
   and network service were restored afterward.
8. Open Settings and invoke the offline timetable update after restoring the
   network. The verified package generation was already current, so its
   coverage remained 5 September–4 October 2026. A feedback draft survived
   Settings route navigation; no feedback was submitted.

Launch time was 317 ms after clean install, 189 ms for an initialized online
cold start, 168–177 ms for initialized offline cold starts and 4 ms to deliver
a warm launch intent. The running release used 83,930 KiB total PSS and
170,036 KiB total RSS after the navigation flow.

A warm Board scroll rendered 165 frames. Android's current deadline metric
reported 7 late frames (4.24%); the legacy jank metric reported 0, with 16 ms
p50, 18 ms p90, 19 ms p95 and 22 ms p99 frame times, and no missed vsync.
These figures exclude instrumentation screenshot time and use injected adb
swipes only for repeatability.

## Production delivery

Server release `1.2.1` at revision `d92aea0` was deployed to `syd1` by
deployctl job `d2ffbfeb973f6a5781e5209c5c359414`. Fresh and returning Chromium
profiles received `shell-v39` and cached web version `1.2.1`; static assets
and health retain `Cache-Control: no-store`. Public timetable package hashes,
immutable caching, source freshness, gzip, ETags and conditional requests were
verified after deployment. The public APK matches the signed artifact above.
