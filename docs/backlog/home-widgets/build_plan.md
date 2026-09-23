# Build plan: home-screen widgets

Design: [design.md](design.md). Branch `home-widgets` (based on
`header-ride-metrics`, because both touch the native view models). Not ready
to execute until comps round 1 has an owner verdict; the visual phases are
written against the exemplar that verdict produces.

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

## Phase 1: data layer, both platforms (Opus) — done marker: [ ]

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

## Phase 2: visual build (Opus) — done marker: [ ]

Against the round-1 exemplar. To be written after the verdict.

## Phase 3: real-renderer verification and owner verdict (lead + Opus) — done marker: [ ]

To be written after the verdict: widget screenshots from the real iOS home
and lock screens and the Android launcher, both schemes, every stress
scenario the comps used.
