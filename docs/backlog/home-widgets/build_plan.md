# Build plan: home-screen widgets

Design: [design.md](design.md). Branch `home-widgets` (based on
`header-ride-metrics`, because both touch the native view models). Comps
round 1 is ruled (B · Timetable); phases 2a and 2b build against its frames.

Every agent: comments are rare and short, one line of *why* where the reason
is non-obvious, never narrating what the code does. Commit after every step.
Hold `/private/tmp/ilt-5e0c1f-gate-lock` (`until mkdir …; do sleep 15; done`,
then `rmdir`) around every Gradle, Xcode or Chromium run. New iOS files are
added by rerunning `ruby tools/generate-ios-project.rb`; `ios/Shared/` compiles
into both the app and the widget extension.

## Seam contract

- **Snapshot (written by the app, read by the widget):** compatible saved
  trips (id, from/to station id, name, modes); `schedule`: 168 entries
  `{at, tripId, reverse}` for consecutive Sydney hour boundaries starting at
  the current hour, each the output of the no-location `predict` at that
  instant; `focus`: the visible focused journey snapshot with its expiry, or
  none; `modes` and the transfer cap as the departures request needs them;
  `boards`: the last board the app published per scheduled directed pair,
  journeys only, at most 8 each; `writtenAt`. Nothing else from the personal
  document.
- **Answer at time `t`:** an unexpired focus wins; otherwise the schedule
  entry whose hour contains `t`; past the schedule's end, the entry exactly
  one or more whole weeks earlier with the same weekday and hour. No compatible
  trip means the empty state.
- **Departures:** the widget fetches the answer's pair from the existing
  `/api/v1/departures` request shape. A failed fetch falls back to the
  snapshot's board for that pair, labelled with the provenance the app uses
  for a retained board. It never runs the offline planner.
- **Freshness:** timeline entries at each departure boundary and at the next
  schedule change; reload no sooner than 15 minutes for live data. The app
  requests a reload whenever it writes a changed snapshot.
- **Writes:** only the app writes the snapshot, from its existing serialized
  personal-document owner, debounced, after trips, history, focus, service
  modes, cap or the station index change.

## Phase 1: data layer, both platforms (Opus) — done marker: [x] 2026-09-24

Nonvisual. iOS: App Group entitlement on app and extension (update the
generator and `docs/operations/ios.md`), `ios/Shared/WidgetSnapshot.swift`
(model, pure answer and entry functions), the app-side writer in
`TrainViewModel.swift`, and a placeholder widget view that prints the answer
as plain text. Android: the same pure functions in `WidgetSnapshot.kt`, the
Glance receiver and widget registration with a placeholder view, WorkManager
refresh, `updateAll` on writes. Unit tests on both: schedule generation
across midnight and a weekend boundary, focus precedence and expiry, the
weekly fallback, fetch-failure fallback labelling, empty state. Verify:
`tools/build-ios.sh --unit`, `tools/build-android.sh --unit`, and one smoke
install on the session simulator and emulator showing the placeholder widget.

## Phase 1 results (2026-09-24)

`tools/build-ios.sh --unit` 265/265, `tools/build-android.sh --unit` 221/221,
full Android gate and `tools/build-ios.sh --simulator` green; 11 new
snapshot tests per platform, each platform's bitten once. Placeholder widgets
answered on the real iOS home screen (small, medium) and the Pixel launcher
(2×2, 4×2); smoke frames in `/private/tmp/ilt-5e0c1f-widgets-smoke/`.

## Phases 2a and 2b: visual build (Opus, one agent per platform, in parallel)

Exemplar: the B · Timetable frames in the round-1 workshop
(`/private/tmp/ilt-5e0c1f-widget-comps-r1/shots/b-timetable-*.png`, the
lock screen `c-tracker-ios-l-*.png`), its `OPTIONS.md`, and design.md's
rulings. 2a owns `ios/TravelTrackerWidget/HomeTripWidget.swift` and
`ios/Shared/` changes, worktree `/private/tmp/ilt-widgets-ios`, simulator
`9972F6A9-…`. 2b owns `android/…/HomeWidget.kt` and its resources, worktree
`/private/tmp/ilt-widgets-android`, emulator `emulator-5570`. Each also:
- makes the lead the header's recommendation (share the selection code with
  the widget; the following rows stay chronological);
- routes a tap to Home (the empty state to setup);
- sets the gallery name and description from design.md;
- keeps every text at 11 pt or larger and names the line in monochrome
  renderings.
Code plus unit verify plus one smoke frame per size; the empirical sweep is
phase 3. Verify: each platform's unit suite and full build.

## Phase 3: real-renderer verification and owner verdict (Opus + lead) — done marker: [ ]

One agent shoots every size on the real renderers (iOS home and lock
screens with the locally signed simulator build; the Pixel launcher) in dark,
light and, on iOS, tinted, across the round's scenarios: live, late,
cancelled, scheduled-only, stale/offline, pinned, riding, one change, ferry,
longest names, no more services, empty. It builds a sheet beside the B
frames with measured captions (text sizes, overflow, contrast). The lead
checks a handful of frames, then the owner rules. Findings become the
exemplars in `assets/comps/latest/` and a `ui.md` widget section at close.

## Phase 2 done markers

- 2a iOS: [ ]
- 2b Android: [x] 2026-09-24. 231/231 unit, full gate and lint green;
  `UiCalibrationTest` 17/17 and `ControllerParityInstrumentedTest` 12/12 on
  the emulator after the header's lead selection moved to a shared
  `homeAnswer`. Deviations accepted: `SizeMode.Exact` (names are fitted and
  bars drawn to scale); 14 sp chips, the contract's size for text on a line
  colour; late and cancelled words under the 4×2 bar; riding shows three
  steps (no ageing past row); minimum height 130 dp. Sweep seeder:
  `HomeWidgetScenarios` (instrumentation, `-e scenario <name>`).
