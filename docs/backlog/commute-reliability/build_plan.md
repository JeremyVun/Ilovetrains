# Commute reliability: build plan

Design: [design.md](design.md). Every rule number below refers to its
"Rules" section. The web is built first and is the reference; its tests and
the shared fixtures define the behaviour the native phases match.

## Execution

- The build runs in a fresh context through the `backlog-item` skill.
- Phase 2 is split (lead's decision, 2026-10-02). Phase 2a, Android rules 8
  and 9 (board paging and location plumbing), depends on nothing in phase 1
  and runs in parallel with it on branch `cr-android`. Phase 2b, Android rules
  1-7, continues on that branch after phase 1 merges, in parallel with
  phase 3. Phase 4 needs the comp verdict recorded in design.md. Phase 5
  closes the item.
- At most two build agents at a time alongside peer sessions. Each agent
  works in its own worktree under `/private/tmp` created by the lead (verify
  with a landmark file), commits after every step, runs gates in the
  foreground, and reports once.
- Nonvisual phases go to Opus. Phase 4 is visual and goes to Opus or Astra
  (Astra needs the owner's approval for that assignment).
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

## Phase 2 — Android

Owns: `android/app/src/main/java/com/ilovetrains/app/{Arrival,Prediction,
TrainViewModel,MainActivity,UiBoard,UiPresentation,BoardRetention,Models,
Storage,Analytics,TravelTrackerState,TravelTrackerLifecycle,
TravelTrackerNotification}.kt`, the new shared logic file for on-board entry
if one is cleaner, `android/app/src/test/**`, `android/app/src/androidTest/**`
and the copied fixtures under test resources.

Work: rules 1-9 for Android, with the decline as a view-model action (no
visual control yet). Phase 2a builds rules 8 and 9, with the instrumented
board test and the setup-cancellation test. Phase 2b builds rules 1-7 and
the remaining tests on top of 2a.

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

Done markers: `Phase 2a done: <commit>`, then `Phase 2 done: <commit>`.

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
Phase 4 draws the button.

Tests: XCTest runs every case in the three shared fixtures, plus controller
tests for the open race, the 10-minute reset with a tracker URL, and the
evidence wait. The UI tests that asserted `arrival=arrivalUnconfirmed` for a
stopped, overdue focus (`TravelTrackerFlowTests`) are updated to the new
state, not deleted.

Gate: `tools/build-ios.sh --unit` during iteration (one at a time, no loops);
`tools/build-ios.sh --test` once on final sources.

Done marker: `Phase 3 done: <commit>`.

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
`verification.json`.

Gate: the `visual-regression` skill for every affected screen on web,
Android and iOS, with every reported difference judged from its composite.
The lead then checks a handful of frames against the exemplar.

Done marker: `Phase 4 done: <commit>`.

## Phase 5 — Full gates, closeout, release

Run once on final sources, one platform at a time: `go test ./...`,
`(cd web && npm test)`, `tools/playtest-regressions.sh`,
`tools/build-android.sh`, `tools/build-ios.sh --test`, and the full
visual-regression matrix. Then the `backlog-item` close stage: confirm every
contract change in design.md landed, then add the deviations entries.
Migrate the exemplar, delete this folder, and release and deploy by
`docs/operations/deploy.md`, `android.md` and `ios.md`.

Done marker: the folder's deletion.
