# Commute reliability: build plan

Design: [design.md](design.md). Every rule number below refers to its
"Rules" section. The web is built first and is the reference; its tests and
the shared fixtures define the behaviour the native phases match.

## Execution

- The build runs in a fresh context through the `backlog-item` skill.
- Phase 2 is split (lead's decision, 2026-10-02). Phase 2a, Android rules 8
  and 9 (board paging and location plumbing), depends on nothing in phase 1
  and runs in parallel with it on branch `cr-android`. Phase 4 needs the comp
  verdict recorded in design.md. Phase 5 closes the item.
- Phase 1's agent ended at about 676k context, past the 650k ceiling, so the
  remaining native work is split along the logic/actions seam (lead's
  decision, 2026-10-02):
  - 2b: Android rules 1-5, plus the decline record and its suppression in
    inference, on `cr-android` after 2a.
  - 2c: Android rules 6 (actions) and 7, on 2b's branch.
  - 3a: iOS rules 1-5, the decline record and suppression, and rule 8.
  - 3b: iOS rules 6 (actions, `LiveActivityIntent`) and 7, on 3a's branch.

  2b and 3a run together, then 2c and 3b.
- Concurrent Android and iOS agents serialise every Gradle and `xcodebuild`
  run through `/private/tmp/ilt-cr-gate.sh <command…>`, a lock the lead made.
- At most two build agents at a time alongside peer sessions. Each agent
  works in its own worktree under `/private/tmp` created by the lead (verify
  with a landmark file), commits after every step, runs gates in the
  foreground, and reports once.
- Nonvisual phases go to Opus. Phase 4 is visual and goes to Opus (owner,
  2026-10-02: “Opus (Recommended)”).
- Adversarial review (owner, 2026-10-02: “Yes, one Fable reviewer”): after
  phases 2 and 3 land, one Fable reviewer attacks the hold rule, the
  auto-start regressions, on-board matching and arrival settlement across the
  three clients in its own worktree, committing probe tests as soon as they
  compile and flagging contract contradictions for an owner ruling. An Opus
  fix agent then takes those probes as its acceptance suite and keeps them as
  permanent regressions. Opus is the fallback if Fable is cut off. The lead
  names these suspects for it:
  - Snapshot first can enter the earlier train. Within one open, a rider
    seen at the origin at least 60 s after the shown train left replaces the
    stored record, as ruling 2 intends. If they then board the next train,
    the snapshot still names the departed one and enters it, one service off.
    This happens on all three clients. Ruling 2 says being seen at the
    platform again "means you didn't board it", so that sighting should also
    retire the snapshot.
  - Fixture gaps: no shared case makes the decline's hour the deciding bound,
    and the nearest progress-window case misses by 0.36, so any window below
    that passes.
- iOS gates run one at a time and never in loops (see the
  `no-unattended-test-loops` memory). Android and iOS gates never run
  concurrently.

## Constraining arithmetic

Builders check their work against these. The owner set the 400 m, 300 m and
10 min figures; the rest are design choices.

- 400 m saved radius: Gadigal is 152 m from Town Hall's index point
  (`-33.873596, 151.206899`), so an unsaved station can win within 200 m while
  the rider stands inside Town Hall's own footprint.
- 300 m sighting: Town Hall's platforms reach about 150 m from its point, and
  single Home fixes are accepted up to 200 m accuracy.
- 60 s after departure before a same-origin sighting replaces a held record:
  a train accelerating at about 0.8 m/s² needs about 27 s to cover 300 m.
- 5 min fix window after a shown departure: by then a train is several
  kilometres out at line speed, so a fix in that window either reads train
  speed or finds the rider still on the platform.
- 45 s evidence wait: sustained movement needs three speed samples spanning
  30 s, and the first provider fix can take up to 15 s.
- 0.25 progress window: on a 25-minute ride with 8-minute headways,
  neighbouring services differ by 0.32 in `f_t`.
- 1.5 corridor ratio: measured 1.27 for Rhodes → Redfern and 1.2 for
  Town Hall → Rhodes, both through Strathfield.

## Phase 1 — Web reference, shared fixtures, contracts

Owns: `web/js/arrival.js`, `focus.js`, `stations.js`, `predict.js`,
`main.js`, `storage.js` (decline record, schema reading), `analytics.js`
(event vocabulary), `web/test/**`, `web/sw.js` (`VERSION` bump),
`tools/fixtures/conformance/commute-feedback.json`, `prediction.json`, new
`inference.json`, the conformance export script if it generates them,
`docs/contracts/client-storage.md`, `ui.md`, `analytics.md`.

Work:

1. Rule 1 in `reduceArrival`: the settled-estimate row, the moving row, the
   checking row (`A + 3 min`, permission pending, evidence wait), estimate
   settlement for armed guards, and the settled-focus deadline. The evidence
   wait is 45 s and is set whenever monitoring starts. Update and extend
   `commute-feedback.json` exactly as design.md lists.
2. Rule 2 in `here()` and a shared `trainSpeed(fix, previousFix)` helper;
   the sighting at 300 m in `noteLastOpen`; votes, pairs and the location
   term skip a train-speed fix. Regenerate `prediction.json` with the new
   cases.
3. Rule 3: the hold rule inside the `lastOpen` writer (`recordLastOpen` or
   its caller), taking the sighting fix's timestamp as an argument. Keep
   `previousOpen` exactly as it is; `useFix` evaluates the snapshot and then
   the stored record, and either may enter.
4. Rule 4: the 30 s tick takes a fix (high accuracy, `maximumAge: 0`) under
   the three conditions, keeping the visit's displayed leads in memory;
   `useFix` then refreshes instead of the tick.
5. Rule 5: on-board entry as a pure function in `focus.js`. It takes the doc,
   the fix, the previous fix, the clock and the fetched boards per candidate,
   and returns a focus or null. The controller gathers candidates, fetches at
   most three boards, and calls it. `inference.json` holds the cases.
6. Rule 6 behaviour without its final visuals: `stopTrip()` (unpin for every
   focus, plus the decline and `declined_inferred` for a guessed one), the
   `inferenceDeclined` record and its suppression check in both inference
   paths, `startTrip(journey)` (today's pin), the Home start window predicate
   (`0 ≤ D − now ≤ 15 min`), the running-row predicate and the board's
   running-row tap starting the trip, and `entered_inferred`. Phase 4 draws
   the line and the new words and removes the experiment; until then the
   existing strip and rail stay on screen, and new controls exist only behind
   test hooks, never in a shipped build.
7. Rule 7: record the hidden time; on a visible return after 10 minutes or
   more, route to `#/` with the selection cleared and run the open path.
8. Rule 8: the first past page at `now − 30 min`, limit 10.
9. Contracts: every `client-storage.md`, `ui.md` and `analytics.md` change
   listed in design.md, in the same commit as the behaviour.

Seams the native phases rely on:

- `inference.json` case shape: a doc (trips with coordinates, history,
  `lastOpen`, rides, `inferenceDeclined`), `nowMs`, `fix` and optional
  `previousFix` (lat, lon, at, accuracy, speed, heading), `boards` keyed by
  `"<tripId>|<direction>"`, and the expected result (`null`, or tripId,
  direction and the journey key). The hold-rule cases give `stored`,
  `incoming`, `sightingAt` and the expected kept record (`stored` or
  `incoming`).
- Every number in "Constraining arithmetic" appears once as a named constant
  in each client.
- Android reads the whole `tools/fixtures/conformance/` directory as test
  resources (`android/app/build.gradle.kts`), so `inference.json` reaches it
  automatically. iOS bundles a fixed list in `tools/generate-ios-project.rb`;
  phase 3 adds `inference.json` there and regenerates the project.
  `prediction.json` is written by `tools/export-android-conformance.mjs`.

Gate: `(cd web && npm test)`; `tools/playtest-regressions.sh` (exit 0); and a
browser drive with `tools/shoot-states.js` or a dedicated checker. The drive
shows (a) the board's first past page reaching the services of the last
30 minutes, (b) a seeded overdue armed focus reading `Checking arrival` and
then settling to the estimate copy, and (c) a return after 10 simulated
minutes landing on Home. Record the commands and outputs in the commit
message.

Done marker: `Phase 1 done: <commit>` appended here.

Phase 1 done: `00bfa19`, merged to main as `51fea60`; ruling 22 (setup keeps
200 m, web `setupHere`) followed on main as `397cb58` and `df823a4`. The
readings it made are folded into design.md rules 1, 2, 5 and 6. Its handoff for
the native phases:

- `inference.json` (authored in `tools/export-android-conformance.mjs`,
  expectations declared by hand and checked against the web). Top-level times
  (`nowMs`, `sightingAt`, `writes[].nowMs`, `fix.at`) are epoch ms; inside
  `doc`, records and journeys, times are API ISO strings. Unknown fix fields
  are omitted, never zero. `journeyKey` is `[[line, scheduledIso], …]`.
  `doc.inferenceDeclined.departure` is the web departureKey (a JSON string).
  Sections: `holdCases` (15) `{name, doc, nowMs, incoming, sightingAt,
  expectedKept}`; `entryCases` (35) `{name, doc, snapshot, writes[{nowMs,
  record, sightingAt}], nowMs, fix, previousFix, boards{"tripId|direction"},
  cached{same key}, expectedRequests?[{tripId, direction, from, to, at,
  limit}], expected: null | {via: platform|onBoard, tripId, direction,
  journeyKey}}`; `startCases` (6) `{name, nowMs, journey,
  expectedStartable}`; `runningCases` (7) `{name, nowMs, journey,
  enabledModes|null, expectedRunning}`. Each section's `run` field states the
  evaluation order.
- `prediction.json`: every case now carries `expected.here {stationId,
  tier}|null` and `expected.sighting`; seven new cases use the real Town Hall
  and Gadigal points, reported and derived speed, a walking pair and a stale
  previous fix. Native prediction tests must read fix `speed/at/accuracy` and
  `previousFix`; Android's `HeaderKindTest` expects "predicted" for the new
  cases unless its map gains them.
- `commute-feedback.json`: new cases `A10-permission-pending-past-buffer` and
  `A13-*`; `A1-delayed-beyond-thirty` and `A11-moving-retains` gained a
  `resumeWaitUntilDelta` input (not a new expectation).
- Ordering the natives must match: platform inference (snapshot, then stored
  record) runs before on-board, and on-board only on a train-speed fix; entry
  evaluates at the fix-handling clock; re-handling the same fix must not start
  a second search; a matching focus refresh in flight still holds settlement
  as permission-pending.
- Web named constants: `ARRIVAL.evidenceWait` 45000; `SAVED_STATION_KM` 0.4,
  `SIGHTING_KM` 0.3, `AT_STATION_KM` 0.2, `TRAIN_SPEED_MPS` 8,
  `PREVIOUS_FIX_MIN_MS`/`MAX_MS` 15 s/120 s; `HOLD_SIGHTING_AFTER_MS` 60 s,
  `SHOWN_DEPARTURE_FIX_MS` 5 min, `MOVING_FIX_FRESH_MS` 2 min,
  `CORRIDOR_RATIO` 1.5, `HEADING_WINDOW_DEG` 90, `CLOSING_KM` 0.2,
  `ON_BOARD_CANDIDATES` 3, `ON_BOARD_LIMIT` 10, `ON_BOARD_LOOKBACK_MARGIN_MS`
  10 min, `ON_BOARD_DEFAULT_RIDE_MS` 60 min, `PROGRESS_WINDOW` 0.25,
  `DECLINE_HOLD_MS` 60 min, `NEW_OPEN_AFTER_MS` 10 min, `FIRST_PAST_PAGE_MS`
  30 min, `FIRST_PAST_PAGE_LIMIT` 10; reused `TRAVEL_MOVED_KM` 1,
  `TRAVEL_SEEN_MS` 15 min, `TRAVEL_LATE_MS` 30 min.
- Contracts done in phase 1: `client-storage.md`, `ui.md` (new open,
  running-row starts, past paging) and `analytics.md` (`declined_inferred`,
  `entered_inferred` on all platforms). Left for phase 4: the trip-control
  line, Start/Stop words and rails, `PINNED`, `strip-placement` removal
  (including `x.*` in the client-storage queue example), the guarded-arrival
  presentation table's stopped row, lock-screen Stop trip presentation.
- Web test hooks on localhost: `__trains.startTrip()` / `stopTrip()`;
  `lastHome.startable` is computed for phase 4.
- Instruments: `tools/check-commute-reliability.js` (new; drives the three
  gate checks plus running-row start, Stop trip, held-record and on-board
  entry). Pre-existing failures identical at `9a3f8b3`:
  `check-controller-lifecycle.js` arrival persistence, and `shoot-states`
  states mascot-stale-before, mascot-next-focus-source-handoff, home-over,
  home-five-trips, home-arrived, past-register, past-register-scrolled,
  detail-unpin-flow, focus-returns-home, reverse-real-platforms (the sweep
  stops at the first failure, so run states one at a time).
  `tools/check-commute-feedback.js --only screens` still asserts the removed
  stopped state; its recapture is phase 4's.

## Phase 2 — Android

Owns: `android/app/src/main/java/com/ilovetrains/app/{Arrival,Prediction,
TrainViewModel,MainActivity,UiBoard,UiPresentation,BoardRetention,Models,
Storage,Analytics,TravelTrackerState,TravelTrackerLifecycle,
TravelTrackerNotification}.kt`, the new shared logic file for on-board entry
if one is cleaner, `android/app/src/test/**`, `android/app/src/androidTest/**`
and the copied fixtures under test resources.

Work: rules 1-9 for Android, with the decline as a view-model action (no
visual control yet). Phase 2a builds rules 8 and 9, with the instrumented
board test and the setup-cancellation test. Phase 2b builds rules 1-5, the
`inferenceDeclined` record and its suppression, the commute-feedback,
prediction and inference (hold and entry) fixture tests and the open-race
test. Phase 2c builds rule 6's actions (start, stop, decline write, running-row
tap, notification Stop action, `entered_inferred`/`declined_inferred`), rule
7, the start and running fixture cases, the 10-minute reset test, and runs the
full Android gate. Setup's location pick keeps the 200 m order (ruling 22).
2c also drops the native `0 ≤ D − at` bound in platform entry (design rule 3).

- Rule 1: the reducer and `focusExpiry`, and the 45 s timer replacing the
  15 s `arrivalLookupComplete` post, also set whenever monitoring starts.
- Rules 2-5: `stationHere`, sighting, train speed, the hold rule in the
  `lastAnswer` write (`TrainViewModel.refresh`), the tick fix in the refresh
  loop, and on-board entry.
- Rule 6: `stopTrip`/`startTrip` in the view model, the decline record in
  `Storage`/`Wire`, the board's running-row tap, and a `Stop trip` action on
  the tracker notification (a new `TravelTrackerService` action and
  `PendingIntent` beside open and dismiss, honoured only for the current
  revision, ending the focus through the shared state owner).
- Rule 7: wire the new open through `backgrounded()`/`resume()`. The
  tracker and widget open paths must still win: an `onNewIntent` that
  arrives before `onResume` must not be reset.
- Rule 8: board paging — load on open, retry at the top, refresh-safe merge,
  online + timetable merge — in `UiBoard` and the view model.
- Rule 9: provider choice, separate listeners and `Fix.bearing`.

Tests:

- JVM tests run every case in the three shared fixtures.
- View-model tests cover the open race: the refresh completes before the fix,
  the held record survives, and inference enters. They also cover the
  10-minute reset with a tracker intent present.
- An instrumented board test seeds a board with no past rows and asserts that
  a past page loads and that scrolling up reaches it.
- A test that cancelling setup location leaves arrival monitoring running.

Gate: `tools/build-android.sh --unit` during iteration; the full
`tools/build-android.sh` once on final sources, on the agent's own AVD started
with `tools/start-android-emulator.sh` and a distinct port.

Done markers: `Phase 2a done: <commit>`, `Phase 2b done: <commit>`, then
`Phase 2 done: <commit>`.

Phase 2a done: `473e1f6` on `cr-android`. Beyond its brief it
made the board's NOW item, future rows and footer one list item at least a
screen tall (the web's `.sy-fwd { min-height: 100% }`), so NOW stays put as
past rows arrive. Lead reviewed the before/after frames on 2026-10-02 and
accepted it. Phase 4 re-accepts the Android `board-transfer`,
`board-transfer-light` (now opening at NOW), `board-now`, `board-now-light`
and `board-light` (12 px tuck under the rule gone) baselines on the baseline
device.

Phase 2b done: `6e83e7e` on `cr-android`. Pure logic for
rules 2-5 and the decline is in `Inference.kt`; `InferenceConformanceTest`
runs every hold and entry case, and `CommuteReliabilityControllerTest`
drives the view model offline on the bundled timetable (Rhodes → Central:
this package routes Rhodes → Town Hall through Central). Its seams were consumed by 2c, and its findings are folded into design rule 3 and the review suspects.

Phase 2 done: `6fc02d8` on `cr-android` (2c: Start/Stop, the running-row tap,
the notification Stop action, `declined_inferred`, the 10-minute reopen and the
platform-entry parity fix). Gates: `tools/build-android.sh` passed with 272 JVM
tests. The instrumented `CommuteReliabilityControllerTest` (11),
`ControllerParity` (13), `BoardPastPaging` (3) and `SetupLocationController`
(1) passed; `TravelTrackerIntegrationTest` failed only the two tests known to
fail at base outside its capture script. Its `systemUiSwipeDismissesAndSuppressesTheFocus`
failed once in three full runs; the new action row may make it flakier, so
watch it in phase 5. For phase 4: draw from `state.startableJourney`; the line
calls `startTrip(it)`/`stopTrip()`; rows already go through
`boardRowTapped`; the notification action is
`TravelTrackerNotification.StopTripTitle` with no icon; the Android tracker
system-surface captures will show the new action row; `PINNED` and the rail
words are at `UiHome.kt:140` and `UiDetail.kt:97`. Ordering the reviewer should
attack: rule 7 relies on `onNewIntent` arriving before `onResume` and on
`activityResumed` running before `resume()`.

## Phase 3 — iOS

Owns: `ios/ILoveTrains/Core/{Arrival,Prediction,TrainViewModel,
LocationService,DeviceStore,Analytics,TravelTrackerState,
TravelTrackerController}.swift`, `ios/ILoveTrains/UI/BoardView.swift` (paging
merge only), `ios/ILoveTrainsTests/**`, `ios/ILoveTrainsUITests/**` where an
existing guarded-arrival UI test asserts the removed state, and
`tools/generate-ios-project.rb` (add `inference.json`, then regenerate).

Work: rules 1-8 for iOS. Rule 8 is the online + timetable merge, the first
page anchored at `now − 30 min`, and pull-to-refresh kept as the gesture.
Rule 9 is Android only. The 10-minute reset hooks scene phase and must not
override `onOpenURL` tracker or widget routes. Rule 6 adds `stopTrip` and
`startTrip`, the running-row tap, and a `LiveActivityIntent` that the Live
Activity's Stop trip button will invoke. The intent runs in the app process,
checks the session identity, and ends the focus through the controller.
Phase 4 draws the button. Phase 3a builds rules 1-5, the
`inferenceDeclined` record and suppression, rule 8, the three-fixture XCTest
runs (hold and entry cases) and the open-race and evidence-wait tests. Phase
3b builds rule 6's actions and the `LiveActivityIntent`, rule 7, the start
and running cases, the 10-minute reset test, the `TravelTrackerFlowTests`
update, and runs `tools/build-ios.sh --test`. Setup's location pick keeps the
200 m order (ruling 22). 3b also drops the native `0 ≤ D − at` bound in
platform entry (design rule 3).

Tests: XCTest runs every case in the three shared fixtures, plus controller
tests for the open race, the 10-minute reset with a tracker URL, and the
evidence wait. The UI tests that asserted `arrival=arrivalUnconfirmed` for a
stopped, overdue focus (`TravelTrackerFlowTests`) are updated to the new
state, not deleted.

Gate: `tools/build-ios.sh --unit` during iteration (one at a time, no loops);
`tools/build-ios.sh --test` once on final sources.

Done markers: `Phase 3a done: <commit>`, then `Phase 3 done: <commit>`.

Phase 3a done: `03c1bea` on `cr-ios` (not yet merged). 287 unit tests pass.
Pure logic is in `Core/Inference.swift`; `CommuteReliabilityControllerTests`
drives the controller offline over the bundled timetable with an injected
clock and `tick()`/`refreshTick()` hooks. Its readings: permission denial
still clears the evidence wait (monitoring never started); a matching focus
refresh in flight now holds settlement for armed guards too, per the web's
ordering. iOS decline encoding (`reverse`, ms times, `departure` as
`line:scheduledMillis`) and the pull-to-refresh deviation are in the branch's
contracts. Seams for 3b: `declineInferred(_:)` writes a decline (no-op for a
started trip); `forgetLastAnswer()` clears `lastAnswer` and the snapshot;
`resume()`/`pause()` from `ILoveTrainsApp.swift`; `openURL` routes widget Home,
setup and tracker links (pending until ready); the 10-minute reset must take
the snapshot as `openHomeFromWidget` does.

3a ended at about 662k context. 3b is therefore code and unit tests plus only
the UI test classes it changes (`TravelTrackerFlowTests`). The full
`tools/build-ios.sh --test` runs once after the fix wave, on final sources.

Found in 3a, for the fix wave:
- The on-board lookback used the longest cached duration, and an offline plan
  holds itineraries up to 99 min, so ten online services never reached the
  train. Design rule 5 now says median (lead's decision); the web, the
  `inference.json` cases that pin `expectedRequests[].at`, Android and iOS all
  change.
- Pre-existing on iOS: with no connection, the 30 s tick never refreshes the
  board once the realtime fetch starts. Check whether rule 4's tick fix still
  runs offline.
- The bundled timetable has no direct Rhodes → Town Hall service; every
  offline plan changes, often via the M1 (2b saw the same through Central).
  Diagnosed as its own item, `docs/backlog/offline-through-running/`.

Phase 3 done: `226c812` on `cr-ios` (3b: Start/Stop, the running-row tap,
`StopTripIntent` in `ios/Shared/`, `declined_inferred`, the 10-minute reopen,
the parity fix, and `TravelTrackerFlowTests` updated to Checking arrival, then
the estimate). Gates: `tools/build-ios.sh --unit` passed with 297 tests, and
`--ui TravelTrackerFlowTests` passed 6, with one skipped by its own
`XCTSkip`. For phase 4: the startable line shows when
`model.state.startableLead != nil` and calls `model.startTrip(lead)`; guessed
STOP TRIP and started ■ STOP TRIP call `model.stopTrip()`; the Live Activity
button is `Button(intent: StopTripIntent(session:
context.attributes.sessionId))` with `import AppIntents`. Found in 3b:
- Simulator trap: two rebuilt unit runs executed test code one or two edits
  old. `xcrun simctl uninstall` and deleting the built `ILoveTrainsTests.xctest`
  before a run fixed it. Fix the instrument or document it in
  `tools/README.md`.
- `AppFlowTests.testBoardDetailPinAndSettingsFlow` and the offline setup flow
  tap the first `service-*` row and expect `pin-this-train`. A running first
  row now starts the trip, so they probably fail in the full UI suite.
- 3a's controller tests call `planner.initialize()` right after a fresh install,
  which races the model's own bootstrap.

## Review and fix wave

Runs after the Android and iOS stacks merge to main. The Fable reviewer (owner
approval in Execution) attacks the named invariants: the hold rule, the
ruling-13 auto-start regressions, on-board matching and arrival settlement. It
also covers the lead's suspects (Execution), rule 7's ordering on both phones
and the lock-screen stops. It commits probes and reports defects and contract
contradictions.

Fix work known before the review, all three clients unless named:
- Rule 5's median `Δ`: the web, the `inference.json` `expectedRequests[].at`
  cases, Android and iOS.
- Ruling 23: Stop writes the decline for any trip that belongs to a saved trip;
  only a guessed stop sends `declined_inferred`. Shared fixture cases plus
  each client's tests.
- Ruling 24 (Android and iOS): the offline board plans the next 24 from `now`
  plus the last 15 minutes, merged.
- The iOS offline tick refresh check (above), the simulator stale-bundle trap
  and `AppFlowTests`.
- The reviewer's confirmed defects, with its probes kept as permanent
  regressions.

The web and the fixtures go first, as the reference. Then Android and iOS fix
agents run in parallel through the gate lock. The full `tools/build-ios.sh
--test` and Android instrumented suites run once in phase 5, after phases 4b
and 4c change the UI.

Fable review done: `fb77a14` on `cr-review` (probes only; `REVIEW.md` at its
root). The lead's decisions on its findings are folded into design.md rule 3:
- Finding 1: the open snapshot entered the train the rider was seen not to
  board, on all three clients. The same-origin sighting 60 s or more after
  `D` now retires the snapshot too.
- Finding 2: offline Android re-recorded the departed train at `D + 70 s` and
  entered it. The `0 ≤ D − at` bound is restored on every client (a reversal
  of the 2c/3b parity change); invert 2c's
  `aRecordWrittenAfterItsTrainLeftCanStillEnter` and 3b's
  `testAPlatformSightingRecordedAfterTheTrainLeftStillEnters`.
- Finding 3 (iOS only): a fix landing off Home started trip mode; entry is
  evaluated only on Home, as the contract and the other clients do.
- Finding 4 (Android only): a preference change, flag read or trip deletion
  within the visit restarted the 45 s evidence wait through
  `resetArrivalTracking()`; the wait is per focus identity and visit.
- Wording and alignment: Stop clears `lastOpen` and the snapshot
  unconditionally; native expiry clears the record only on a trip, direction
  and journey match, like the web.
- Fixture cases proposed in `REVIEW.md`: the decline held by the hour alone,
  progress 0.24 match and 0.26 miss, and the snapshot case for finding 1.
- Refuted, with evidence in `REVIEW.md`: rule 7 ordering on all clients, the
  hold-rule writers, the two-hour `Arrival unconfirmed` (every reducer settles
  at `A + 3 min` unless moving), and lock-screen identity.
- Noted, no action: the web's ISO departure keys change offset on the
  2026-10-04 DST day, but each journey's key is stable, and natives use epoch
  ms.

The fix agents base on `cr-review`, keep its probes as permanent regressions
(renaming or moving them into the suites they belong to is fine) and make them
pass.

Web fix done: `74e224b` on `cr-fix-web` (based on `cr-review`, not yet merged).
633 web tests pass, the exporter is byte-stable, the playtest exits 0, and
`check-commute-reliability.js` passes all 7 checks, including the new
`snapshot` check that replaced the review's stack probe. The native fixes
match this:
- Snapshot retirement runs at every `lastAnswer` write attempt in the
  refresh, before the hold rule decides, and applies even when the write is
  skipped. It compares the incoming record's sighting station with the origin
  of `leg(saved trip snapshot.tripId, snapshot.direction)`; the record's own
  trip does not matter. The clock is the sighting fix's time, and the rule is
  `sightingAt ≥ D + 60 s` inclusive, with `D` the snapshot journey's effective
  first-leg departure. An unsighted record, or a snapshot whose trip is gone,
  never retires it. A retired snapshot stays null until the next open, return
  or back-to-Home. The review's Android and iOS probes must apply retirement at
  the write step, as the web's does.
- Platform entry rejects `D − at < 0` and `D − at > 15 min`.
- Median `Δ` is `durations[floor((n − 1) / 2)]` over effective durations
  `A − D ≥ 0`, sorted, with 60 min when there are none.
- Ruling 23: a guessed focus declines its own trip and direction. A started
  focus looks up the saved trip whose `from → to` equals
  `focus.board.from → focus.board.to` (forward) or its reverse (reverse), and
  declines nothing when none matches, leaving any older decline in place. The
  record holds that trip and direction, the first service leg's departure key,
  the composed effective arrival and the stop time. Only a guessed stop sends
  `declined_inferred`, and lock-screen stops take the same path. Android's
  `withTripStopped` and iOS's `declineInferred` skip pinned focuses today.
- `inference.json`: `entryCases` 35 → 47 (median, two cases; snapshot
  retirement, five; lower bound, three including the review's
  re-recorded-departed-train case; progress 0.24/0.26; the decline held by
  the hour alone). The `run` text adds the retirement step and the median
  request time. The new `stopCases` (6) has the shape `{name, doc, focus,
  nowMs, expectedDecline: null | {tripId, direction, departure, arrival, at},
  expectedEvent}`, with the focus pair as its journey's first-leg `from` to
  last-leg `to`. Native harnesses apply retirement on each write and run
  `stopCases`.
- Native expiry clears `lastAnswer` only on a trip, direction and journey-key
  match.
- `web/sw.js` is at v73; reconcile it with 4a's bump at merge.

## Phase 4 — The trip-control line, new words and the removed state, on screen (visual)

Needs: the round 3 verdict (design.md rulings 17-20) and the round 3b
exemplars in `docs/backlog/commute-reliability/comps/`. The visual agent is
briefed against those images, not this prose.

Owns: the trip-control line and header status (`web/js/home.js`,
`web/app.css`, `UiHome.kt`, `HomeView.swift`); the experiment row and A2
paths (`web/js/analytics.js`, `web/js/main.js`, `docs/contracts/analytics.md`); the journey-screen rails
(`web/js/detail.js`, `UiDetail.kt`, `DetailView.swift`); the guarded-arrival
copy branches being removed (`focus.js`, `UiPresentation.kt`,
`Common.swift`, `HomeView.swift`, tracker notification and Live Activity
copy); the Live Activity view in `ios/TravelTrackerWidget/` and the Android
notification action label; `assets/comps/latest/` (commute-feedback
missing-telemetry frames, the new line exemplars replacing
`home-*-inferred-a2*`, the travel-tracker exemplar); and `tools/baselines/`
for accepted changes.

Work: remove the `strip-placement` experiment (the A2 code paths, the `x.*`
dimension and the `EXPERIMENTS` row, keeping the bucket, plus the
`home-*-inferred-a2*` exemplars and baselines). Then draw the trip-control
line in its four states from the round 3b
exemplars on all three clients, wired to the phase 1-3 actions. Port the
web concept patch (`comps/concepts.patch`) as reference only; it is comp
code with test-hook states and is not merged. Remove
`PINNED` from the status line, and rename the journey-screen rails to
`Start trip` / `Stop trip`. Add the Live Activity button and the notification
action label. Remove the stopped `Arrival unconfirmed` presentation.
Recapture the commute-feedback missing-telemetry frames with
`tools/check-commute-feedback.js`, and update the comps README and
`verification.json`. Ruling 21: on an estimate ending, the trip-over offer
drops `You’ve arrived.` (location endings keep it), and the Home sign wraps
instead of cutting `The last arrival estimate has passed. The return trip is
ready.` (web cut it at 390 px; check every client). Re-accept the five
Android board baselines phase 2a changed.

Gate: the `visual-regression` skill for every affected screen on web,
Android and iOS, with every reported difference judged from its composite.
The lead then checks a handful of frames against the exemplar.

Split per client after the context overruns (lead's decision, 2026-10-02).
4a is the web, run beside the Fable review on `cr-web`: the experiment removal,
the line, the words, the stopped-state removal, ruling 21, the commute-feedback
recapture and the line exemplars. 4b (Android) and 4c (iOS, including the
Live Activity button and its exemplar) follow, briefed from 4a's report and in
parallel through the gate lock.

Phase 4a done: `62ad264` on `cr-web`, merged to main as `20752f2`.

Results:
- At 375×667 and 390×844, dark and light, every shipped Home state and both
  rails are pixel-identical to the round 3b exemplars. The lead checked the
  guessed, startable, started and estimate-ending frames.
- 614 web tests pass, the playtest exits 0, and `check-commute-reliability.js`
  and `check-commute-feedback.js` pass.
- Visual regression run `/tmp/ilt-cr-web-vr/r2` accepted 29 frames, each
  judged; `r3` was 52 same on final sources.
- `shoot-states` gained the line's invariants and nine states. Five states
  that failed at base now pass. `mascot-next-focus-source-handoff`,
  `home-arrived`, `mascot-stale-before`, `past-register` and
  `past-register-scrolled` still fail, as at base.

Decisions the lead accepted:
- A started trip under a cancellation replacement shows ■ STOP TRIP.
- There is no line once the trip is over.
- Every Home sign the app writes wraps; only upstream headsigns can still be
  cut off.

Two fixes outside the brief: "Show the way back" clears the stale arrival
decision (the return journey flashed `Now AGO`), and the commute-feedback
missing-telemetry frames are now `c1-fade-*-checking-arrival*`.

`*.png` is gitignored repo-wide. Tracked frames stay tracked, but new ones
need `git add -f`. The round 3b exemplars in this folder are untracked and
live only in the main checkout,
`/Users/jeremy/projects/ilovetrains/docs/backlog/commute-reliability/comps/exemplar/`.

Left for 4b and 4c:
- the lock-screen Stop trip in `ui.md`'s tracker section;
- `PINNED` in `ui.md`'s widget section;
- the `transfer-recovery.json` `pinIcon` field (drop it from the fixture and
  all three tests once both natives drop the icon);
- checking whether the natives flash the stale arrival decision on "Show the
  way back".

For 4b and 4c:
- **Line:** 48 px plus a 1 px hairline, with the page margin at both ends
  (22 px, or 18 px at 375 and below).
- **Text:** the question is 15 px, weight 300, `--ink-2`. Actions are 12 px,
  weight 600, .14em tracking, uppercase, with 48 px targets.
- **Guessed:** STOP TRIP in `--ink-2`, a 1×14 `--rule-2` hairline, then
  CHANGE in `--ink`. STOP and CHANGE sit 22 px apart, and the question gives
  up 1 px of its gap (13 px minimum).
- **Lone actions:** in `--ink`, at the right. The 11 px ■/▶ glyph is
  `--ink-2`, sits 9 px before the word and is centred on the cap height
  (native `Icons.Filled.Stop`/`PlayArrow`, `stop.fill`/`play.fill`).
- **Startable:** reads the header lead's effective departure clock. The line
  moves MY TRIPS down 49 px.
- **Exemplar fonts:** the 360 and 412 exemplars are Android's Roboto
  reference; 375 and 390 in SF are iOS's.

At merge, `cr-fix-web` overlaps on the `web/js/main.js` import list: keep
`retiresSnapshot` and `stoppedTrip`, drop `startable`. Both branches set
`web/sw.js` to v73, so the combined result needs v74.

Done marker: `Phase 4 done: <commit>`.

## Phase 5 — Full gates, closeout, release

Run once on final sources, one platform at a time: `go test ./...`,
`(cd web && npm test)`, `tools/playtest-regressions.sh`,
`tools/build-android.sh`, `tools/build-ios.sh --test`, and the full
visual-regression matrix. Then the `backlog-item` close stage: confirm every
contract change in design.md landed, then add the deviations entries.
Migrate the exemplar, delete this folder, and release and deploy by
`docs/operations/deploy.md`, `android.md` and `ios.md`. The bundled bootstrap
timetable expires `2026-10-04T23:59:59+11:00`. The owner's iPhone rides
offline, so regenerate the bootstrap (compiler in `native-data.md`) before
building the release, if it has not already been done.

Done marker: the folder's deletion.

Android fix done: `9cefe11` on `cr-fix-android`.
- Every reviewer probe passes. `tools/build-android.sh` passes with 281 unit
  tests, and the instrumented `ReviewCommuteReliabilityTest` (2),
  `CommuteReliabilityControllerTest` (12), `ControllerParity` (13),
  `BoardPastPaging` (3), `SetupLocationController` (1) and
  `TravelTrackerIntegrationTest` (25) all pass.
- Ruling 24's old single plan showed 0 upcoming services on Central →
  Parramatta at 08:00, so Android had the defect.
- Offline Home still keeps the departed train as its lead and re-records it
  after departure; the restored lower bound is what stops it entering. Do not
  change that lead without revisiting finding 2.
- Each board refresh now runs two timetable plans; phase 5 checks
  `OfflinePlannerPerformanceInstrumentedTest`.
- `am instrument` exits 0 even when tests fail, so grep its output for `OK (`.

Integration branch `cr-int` (`5e70222`, worktree `/private/tmp/ilt-cr-int`):
main with 4a, plus `cr-fix-android`, which carries the review probes and the
web fix. `web/js/main.js` keeps `retiresSnapshot`/`stoppedTrip`, and
`web/sw.js` is at v74. On it: web 637 pass, the playtest exits 0 and
`check-commute-reliability.js` passes all seven checks. Phase 4b runs on
`cr-android4`, branched from `cr-int`. `cr-fix-ios` merges into `cr-int` when
it lands, then `cr-int` merges to main.

iOS fix done: `c567b8e` on `cr-fix-ios`. Merged through `cr-int` (with the
`native-data.md` ruling-24 text deduplicated) to main as `3850a5f`; web 637
pass on main.
- Every reviewer probe passes. `tools/build-ios.sh --unit` passes with 309
  tests, and `--ui TravelTrackerFlowTests` passes 6, with 1 skipped by its own
  `XCTSkip`.
- The offline tick stall was real: a failed realtime fetch never refreshed
  the board. A tick now refreshes the board unless a followed journey's
  request is in flight.
- Outside its brief, it serialised `OfflinePlanner.initialize()` through a
  process-wide queue. The fresh install on every test run made the
  test-host/test planner install race hit every run; production has one
  planner. The focused Home's later-trains plan also uses the two-plan board.
- `tools/build-ios.sh` now deletes built test bundles and uninstalls the app
  and the UI runner before every `--unit`/`--ui`/`--test` run (documented in
  `tools/README.md`). Phase 5 runs tests through the helper only.
- Still open for 4c/5: `AppFlowTests` (`testBoardDetailPinAndSettingsFlow` and
  the offline setup flow expect `pin-this-train` after tapping a first row that
  may be running). Any UI test that stops a started trip and then expects a
  guess will now meet the decline.
- The median lookback's lower-end limit is accepted (design rule 5).
