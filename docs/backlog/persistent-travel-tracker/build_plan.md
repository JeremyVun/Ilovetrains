# Persistent travel tracker — build handoff

Status: Android integration and emulator verification are complete. The owner
has instructed implementation of the already-selected iOS design; its native
integration is in progress. Use the accepted offline card for retained content,
with bounded system timers and explicit source provenance as recorded in
[design.md](design.md). Do not substitute the whole-itinerary engineering probe
or reopen concept selection. Read the [accepted frames](../../../assets/comps/latest/travel-tracker/README.md)
and linked contracts before building.

## Phase 0 — prove native execution and resolve lifecycle

- [ ] Complete.
- [x] Android execution mechanism and lifecycle policy resolved; native
  integration may proceed. API 36.1 promoted and API 35 ordinary notifications
  rendered. Locked updates, phase changes, sticky restart, dismissal and denial
  were exercised in the isolated probe.
- [x] iOS local-only implementation policy recorded after owner continuation.
  Preserve the accepted offline card; no whole-itinerary replacement. Lock-screen and compact
  rendering, bounded timers/progress, suspension/process death, stale recovery
  and foreground updates/end are proven. Expanded island pixels were captured
  with a scratch XCUITest long press; the probe needs width-aware leading content
  and the accepted ETA/line before becoming product calibration. Two distinct
  scratch apps established actual minimal island selection (attached train glyph
  and detached competitor glyph). Product integration must still verify the
  accepted composition and lifecycle against these native capabilities.

Own: isolated native prototypes and this backlog's design/plan; update
`docs/references/native-travel-surfaces.md` with verified platform findings.
Existing optional scratch paths and capture failures are in the design doc.

Prove the accepted sentence/line composition through ActivityKit's actual
renderer. Verify compact, minimal, expanded and lock-screen constraints;
Android must retain the same useful facts in its supported template. Keep
ordinary Android notifications useful without promotion and on older versions.

Separately prove what advances while the app is foregrounded, suspended,
terminated and relaunched: numeric timer, progress, instruction/leg, retained
delay, freshness, cancellation and completion. Existing `pause()` methods cancel
refresh loops. A ticking system timer does not prove a phase transition.
Do not acquire location just to keep a service alive or introduce server-side
personal state/APNs registration as an implicit implementation detail.

Record the chosen execution mechanism, its limits and exact stale/boundary
fallback. Resolve permission timing, dismissal suppression/restart, completion
retention and privacy defaults from the design's lifecycle table. If evidence
requires changing the promised behavior or a binding contract, present the
concrete fallback for an owner ruling; otherwise continue within accepted scope.

Gate: real OS pixels, an execution-state evidence table, and documented lifecycle
decisions. No claim of reliable background updates based on static fixtures.
Update the subsequent phases with any discovered platform constraints before
integrating them into the app.

## Phase 1 — derive presentation from the existing focus

- [ ] Complete.
- [x] Shared presentation and fixture gate: Android 8/8 targeted JVM tests;
  iOS 6/6 targeted runtime XCTest tests. Independent source review found no
  remaining issues after missed-connection, non-monotonic timeline and ferry
  side-label corrections. A deliberately wrong shared countdown was observed
  to fail the Android fixture assertion before restoration.
- [x] Android no-update/boundary policy integrated and exercised through the
  production service while backgrounded and locked.
- [x] iOS native policy integrated: bounded system countdown, stale fallback
  at the earlier source/instruction boundary, and last-published trip marker.
  Native countdown/clamp/stale behavior was observed with the app process absent.

Own: proposed `TravelTrackerState.kt` beside Android's `Models.kt` and
`TravelTrackerState.swift` in iOS `Core/`; corresponding pure presentation tests.
Names are proposed, not existing files.

Inputs: existing focused journey identity, chosen service/legs, effective times,
platforms, current clock and source freshness. Output: next event/deadline,
instruction, relevant platform roles, change window/departure, destination ETA,
segment lengths/progress and provenance. No separate route selection or new
server API. Derive labels and colours from the real legs, not the T8/M1 fixture.

Seam: identify the same chosen service across realtime changes without treating
a changed ETA/platform as a new journey. Carry a focus identity and update
generation so old async results cannot overwrite a replacement focus. Browsing
another board cannot change the tracker. Use the binding minute arithmetic and
retain last-known delays/countdowns offline. Implement the Phase-0 boundary
policy explicitly; never count upward beside an expired get-off instruction.

Gate: matching fixture tables on both clients, including ride/transfer/final,
unknown platforms, tight changes, retained delay, cancellation, midnight,
multiple legs, focus replacement and late updates. Test distinct behavior and
seams rather than repeating the implementation in assertions.

### Integration findings, 2026-09-08

- Both clients key the focused service by trip ID, direction and the ordered
  leg line/scheduled-departure key. Effective times and platforms must not enter
  tracker identity. Keep a separate generation for asynchronous publication.
- `syncPersonal()` derives the visible focus and its recorded completion on
  both clients. Use those same predicates: mode/cap-hidden focus must not leak
  into a system surface. Retain dismissal separately from temporary visibility.
- A completed focus can remain stored until effective arrival plus 30 minutes.
  Tracker completion must use the completion predicate and Phase-0 boundary
  policy, not merely wait for the stored focus to become null. Ending a tracker
  must not itself write a completed ride.
- Existing `openJourney()` assumes the current screen/selection supplies the
  trip context. A tracker tap needs its own identity-checked entry that restores
  the focus pair, direction and source before opening it, including cold launch.
  A tap from a replaced surface must never restore its old focus.
- Android `DeviceStore` writes an atomic personal document without shared
  ownership arbitration. A background service must not independently load,
  modify and save that document while the view model owns an in-memory copy.
  Use one state owner or an explicit serialized handoff; late refreshes cannot
  overwrite deletion, replacement or dismissal.
- Automatic inferred focus starts a tracking session. The accepted replacement
  rule applies while that session is active, including a deliberate replacement
  pin. A pin by itself, when no tracker is active, does not start a session.
  This distinguishes replacing an existing tracker from the deferred pin-entry
  experiment. Completion and dismissal end the session.

## Phase 2 — integrate native surfaces and lifecycle

- [ ] Complete.
- [x] Android integration compiles and passes the full
  `tools/build-android.sh` build/JVM/lint gate: 114 JVM tests across 18 suites,
  zero failures/errors/skips, including seven lifecycle and eight pure
  presentation tests. This run includes the final enlarged-text/ordinary-bar
  and missed-connection compact-card corrections.
- [x] Independent Android integration review: stale-intent races and per-leg
  realtime retention corrected; no remaining source findings. A fresh unsigned
  Release build contains the tracker service and strips the Debug clock and
  capture controls. An earlier Release artifact was stale and is not evidence.
- [x] Android actual-app system capture/lifecycle verification. API 35 and 36.1
  retained 444 full System UI frames and 444 card crops across 390×844 and
  412×732, font scales 1.0 and 1.3, ten fixtures, both schemes, and shade/lock
  surfaces. Pixel review found the required platforms, event/change times,
  destination arrival, provenance, cancellation and planned-arrival labels
  readable without product clipping. The API 35 full lane passed all 19
  lifecycle, process, permission, channel and ordinary-fallback checks. API 36.1
  also passed production inference, replacement, locked/background progression,
  completion, swipe dismissal, relaunch suppression, permission/channel denial
  and task-removed tap routing. A real production-process SIGKILL changed the
  PID, restarted the same persisted tracker as foreground service 4108, and
  posted a new active notification record without changing focus identity or
  effective leg times.
- [ ] iOS final integration gate. ActivityKit controller, protected session
  persistence, widget extension, app publication and exact deep links are
  implemented. All 131 unit tests passed, including nine controller tests and
  six presentation tests. Initial native ride/compact/expanded captures passed;
  full lifecycle and layout gates remain in progress.
- [x] iOS unsigned Release archive built with the embedded widget. Both app
  and extension declare iOS 17 minimum support; binary inspection found no
  DEBUG tracker arguments, status overlay or fixed-countdown hooks. The app's
  Live Activity declaration, URL scheme and WidgetKit extension point are
  present. This is an unsigned archive, not a phone installation.

Both clients now retain unmatched focused legs when only some realtime sources
match. Swift data changes passed 26 targeted tests and independent review; the
full iOS gate passed 122 unit and 10 UI tests before the final timestamp-floor
correction, followed by the 26 targeted tests on that correction. All 11 affected
existing iOS screen captures are pixel-identical to their baselines. These gates
cover the shared data/presentation work, not an ActivityKit integration.

Pre-implementation source audit and runtime verification, 2026-09-08: iOS had no
ActivityKit controller, widget extension, tracker lifecycle/persistence or
deep-link integration; `TrainViewModel` does not call `TravelTrackerState`.
No concrete defect was found in its derivation or partial-realtime retention.
On an isolated iOS 26.4 iPhone 17 Pro, two full `tools/build-ios.sh --test`
runs each passed 122/122 unit tests, including six tracker tests. Each passed
9/10 UI tests with a different navigation/AX failure; both failed methods
passed immediately in isolation and in the other full run. This is not a
single green full gate. Do not widen waits or change product behavior without
a reproducible failure. The owner subsequently authorized continuing the accepted iOS implementation.

The Android capture instrument initially missed ordinary collapsed lock-screen
cards because it required the app-name field. It now scans System UI windows,
preserves collapsed evidence, retries expansion, checks the rendered row's
required facts and waits for stable pixels before saving the asserted frame.
Failure paths retain screenshots, accessibility trees and notification dumps.
Pixel review still checks truncation.
The missed-connection collapsed card now reserves its title for status and its
body for the destination's planned arrival; conflict details and provenance
remain in expanded content. Expanded lock-screen cards may open Android's locked
notification shade, rather than stay beside the large clock.
At font scale 1.3, the progress template exposed full accessibility strings but
visually ellipsized the destination/ETA. Enlarged text now uses BigText. A real
390×844 capture in both schemes shows all facts with Android's stock determinate
bar; overlapping missed-connection timelines intentionally omit that bar.
The 412×732 enlarged-text sweep also found that System UI strips the cancelled
ETA's strike span while retaining it in notification extras. Android now labels
the final destination `Cancelled (HH:mm)` explicitly. Earlier-leg-only
cancellation retains the ordinary ETA. The corrected states passed the final
pixel matrix and Android build gate.

Android ownership: `android/app/src/main/AndroidManifest.xml`, app lifecycle and
`TrainViewModel.kt`, storage only for necessary dismissal/lifecycle state, and
new notification/controller/service files chosen in Phase 0.

iOS ownership: `ios/ILoveTrains/Core/TrainViewModel.swift`, app lifecycle,
`DeviceStore.swift` only where persistence is needed, ActivityKit attributes/
controller, new widget extension, `Info.plist`, and
`tools/generate-ios-project.rb` plus its generated Xcode project.

Seam: automatic existing travel-mode entry creates one surface without a new
tap. Updates/replacements are idempotent; stale async callbacks cannot revive a
dismissed or replaced journey. Tapping opens the matching focus. Denial or
unsupported promotion preserves in-app travel mode and avoids repeated prompts.
Dismissal does not unpin inferred focus or fabricate a completed ride. Apply the
Phase-0 persistence, restart and completion decisions on each OS.

Keep the accepted prose hierarchy and quiet line. Android adapts to OS-owned
fields; do not promise SwiftUI geometry via an ineligible custom notification.
Platform boxes and pin-trigger experiments remain outside this baseline phase.
Do not copy static scratch timers or probe-only metadata into product code.

Gate: targeted native build/tests and actual system-rendered state captures on
each platform; verify automatic entry, tap routing, replacement, dismissal,
denial and background behavior from Phase 0 with the real app integration.

## Phase 3 — independent verification and durable contracts

- [ ] Complete.
- [x] Android verification and calibration. The build gate passed 114 debug JVM
  tests across 18 suites plus lint, 20 targeted tracker visual baselines were
  registered and then matched exactly, and TalkBack was bound while ride and
  missed-connection focus traversal was exercised. Emulator evidence does not
  establish physical-device delivery, Doze or OEM power behavior.

Own: native seeded capture/test tooling and `tools/README.md`, relevant
`tools/baselines/`, accepted calibration frames, and affected contracts in the
same change as their behavior. Review storage, UI, native data and platform
deviations; analytics only if agreed events or assignments are actually added.

Drive the real apps at supported phone sizes in both schemes, large text,
VoiceOver/TalkBack and reduced-luminance/system presentations. Include the seven
selected comp states plus cancellation, long/multiple-leg trips, expired
freshness, missed transfer boundaries, process death/relaunch, permission denial
and Android promotion unavailable/older-OS fallback. Measure text/line overlap;
never hide provenance or truncate a required platform to pass a height check.

Gate: appropriate checks from `tools/README.md` and native operations runbooks;
`tools/build-android.sh`, `tools/build-ios.sh --test`, and screen regression via
`tools/visual-regression.js`. Run Go/web gates if shared behavior changes.
Record physical-device limits honestly; simulator screenshots do not prove
delivery reliability or power behavior. Replace illustrative calibration with
verified native exemplars when implementation lands.

## Phase 4 — close and deploy after implementation

- [ ] Complete.

Migrate surviving design/seam rules into contracts, update the roadmap and
references, remove obsolete comp reproduction source once native instruments
replace it, then delete the backlog folder. Deploy using
`docs/operations/deploy.md` and follow the native distribution runbooks.
Do not mark complete from a visual verdict alone.
