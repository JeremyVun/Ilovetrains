# iOS verification

Run `tools/build-ios.sh --test` for offline routing, realtime expiry, package
recovery, persistence and web-generated conformance. The three native UI flows
cover Home → Board → Detail → pin/unpin → Settings, fresh Mascot → Kellyville
creation and pin persistence with network transport disabled, and feedback-draft
preservation without submission.

## Capture native screens

Build the Debug simulator app before capturing. The screenshot instrument needs
one booted iPhone simulator, refuses a non-empty output directory, installs the
specified app, fixes the status-bar clock, and restores status-bar and content
size overrides when it exits.

```sh
ILOVETRAINS_SIMULATOR_ID=<udid> \
ILOVETRAINS_IOS_APP=/path/to/Debug-iphonesimulator/ILoveTrains.app \
OUT=/tmp/ilovetrains-ios-390 tools/shoot-ios.sh

ILOVETRAINS_SIMULATOR_ID=<udid> \
ILOVETRAINS_IOS_APP=/path/to/Debug-iphonesimulator/ILoveTrains.app \
CONTENT_SIZE=accessibility-medium \
OUT=/tmp/ilovetrains-ios-large tools/shoot-ios.sh \
settings home board detail detail-two-change setup home-offline board-offline
```

Each run writes PNGs and `metrics.txt`. Arguments after the script replace the
default 19-state matrix. Calibration arguments and fixtures exist only in Debug
builds; they do not seed Release builds or normal app launches.

Use these phone sizes and text settings, compared with `assets/comps/latest/`:

| Device | Logical size | Capture | Content size | States |
| --- | ---: | ---: | --- | ---: |
| iPhone 17 | 402×874 pt | 1206×2622 px | Large | 19 + 6 focused |
| iPhone 17 | 402×874 pt | 1206×2622 px | Accessibility Medium | 10 |
| iPhone 13 | 390×844 pt | 1170×2532 px | Large | 19 |
| iPhone 13 | 390×844 pt | 1170×2532 px | Accessibility Medium | 8 |
| iPhone SE (3rd generation) | 375×667 pt | 750×1334 px | Large | 8 |

The full matrix covers Home, Board, one- and two-change Detail, setup, Settings,
ferry, pinned, active and inferred focus, delayed and cancelled services, dark
and light appearance, and scheduled offline Home, Board and Detail. The focused
matrices repeat Settings, setup, both Detail shapes, Home, Board and their offline
states at compact height and enlarged text.

Acceptance criteria:

- At 390×844 pt, Board shows six 96 pt service rows and the end marker beneath
  the NOW anchor. At 375×667 pt, the remaining services are reachable by scrolling.
- Safe-area content stays below the status bar and above the home indicator or
  SE screen edge. Detail's masthead, arrival footer and pin rail stay visible
  while its itinerary scrolls. Multi-change platform chips remain distinct.
- Settings keeps service and appearance controls legible; feedback, timetable
  coverage and version remain reachable on compact screens.
- Enlarged text keeps journey titles, transfer instructions, offline mastheads
  and Settings controls within their containers.

Use XCUITest for repeatable native gestures and `simctl` for screenshots when
computer-use attachment to the Simulator window is unavailable. A screenshot
alone does not establish that an off-screen control is reachable.

## iPhone 17 regression — 2026-09-07

The initial version 1.2.3 (build 3) review missed visible journey-line defects.
The owner's screenshots showed the origin cap 9pt below the line and a later
ride segment painting over a transfer platform numeral. Multi-change markers
also lacked separators and station labels were combined. Its broad visual-pass
claim is withdrawn; passing navigation tests did not establish correct pixels.
Settings spacing/selection marks and the four-second success banner remain
verified separately.

The journey-line correction in build 4 uses measured chip placement and paints
all ride/dwell segments before markers. The origin cap and line now share the
same center (619.5 device px in the direct Home reference, previously 27px
apart). Platform 5 remains visible on the active transfer. Compact two-change
rows keep 3/5/13 distinct with 9 device px (3pt) ground separators and separate
Town Hall/Central label lanes. Three geometry regressions pass without changing
the proportional service-time coordinates.

Detail also rendered its noninteractive summary as a disabled button. Removing
that wrapper restores opaque platform chips; cancellation now fades the whole
composited axis once. The fixed dark/light and two-change Detail captures were
inspected after this correction, not inferred from the geometry test results.
Final capture uses a separate iPhone 17 on the same iOS 26.4 runtime and
402×874pt profile to avoid competing simulator drives from another task.
The targeted 11-frame pixel comparison was inspected and its intended changes
accepted into `tools/baselines/ios/`; comparison against those references then
returned 11 identical frames. Board dark/light remained pixel-identical to the
previous references. The final report is
`/tmp/ilovetrains-ios-axis-final/report.html`, with enlarged journey-line crops
beside it. This validates the selected line states, not every iOS screen.

In build 3, all three interaction flows passed individually: Board → Detail → pin →
Settings/services, offline Mascot → Kellyville creation/pinning/reopen, and
feedback keyboard/draft navigation without submission. The initial combined run
failed with an Xcode duplicate accessibility-loader warning; clean sequential
reruns passed. That warning does not establish the cause of the first failures.
No defensive calibration resets were retained to conceal them.

Accessibility Medium captures confirmed containment but did not enlarge most
text: fixed point fonts currently do not honor Dynamic Type. Do not describe
this sweep as full larger-text support. No live route was created in the final
normal launch; radio and physical-device behavior remain outside this check.

Session evidence is under `/tmp/ilovetrains-ios17-regression-20260907a`,
`/tmp/ilovetrains-ios17-focus-20260907a`,
`/tmp/ilovetrains-ios17-large-20260907a` and
`/tmp/ilovetrains-ios17-success-20260907a`. The final normal-launch frame is
`/tmp/ilovetrains-ios17-normal-installed-20260907.png`.

## Live transport and performance

Launch without `--calibration`, `--offline` or `ILOVETRAINS_TEST_DOMAIN`. Create
Central → Parramatta, open its Board, wait for `LIVE`, then open a journey and
check its platforms and pin action. This exercises native `URLSession` against
the public API; fixture decoding does not prove network transport works.
Do not make the normal test gate depend on public-service availability.

For routing measurements, run `OfflineRouterTests` on a simulator with
`SWIFT_OPTIMIZATION_LEVEL=-O`; its `CORE_TIMING` output separates package
initialization, cold routing and warm routing. The initial iPhone 17/iOS 26.4
reference is approximately 466 ms initialization, 964 ms cold Mascot–Kellyville,
77 ms warm same pair and 79 ms warm Central–Kellyville. Compare future changes
on the same simulator and optimization setting. These are routing measurements,
not app-launch or physical-device performance numbers.

## Physical-device checks

Follow [ios.md](ios.md) to restore signing and install when the phone is
available. Physical safe areas, thermal behavior, radio transitions, location
permission, background suspension and signed-device persistence still require
device verification. Simulator success does not establish those properties.
