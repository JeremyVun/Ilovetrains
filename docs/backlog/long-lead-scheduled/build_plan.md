# Scheduled register beyond the live horizon: build plan

Status: ready. Binding behaviour: [design.md](design.md). Start in a fresh
context under `backlog-item`.

## Execution

Read repository instructions, `design.md`, `docs/contracts/ui.md` ("Past,
stale and exceptional data") and `tools/README.md` (conformance fixtures).
Check `coord status` and `git log main --since='1 day'` before forking:
`realtime-replacements` and `transfer-completion-recovery` touch the same
native presentation files. Phase 1 is the reference and must land before
phases 2 and 3 fork; 2 and 3 run in parallel. Record each exact gate and
result here.

Arithmetic every phase checks itself against: `mins` is the printed-minute
countdown the figure already shows; beyond the horizon is `mins > 40`
with `delay == 0`, so a row with `offset: 40` stays live and `offset: 41`
is scheduled; `delay: 6` at `offset: 41` stays `6 MIN LATE` with figure
`47`; `offset: 43, delay: -2` has a live countdown of 41 and stays live
with figure `41` and no label; a `cancelled` row at any offset stays `—`.
The rule never changes a figure's value or unit, only its provenance and
register.

## Phase 1 — Web reference, contract, shared fixture

- [x] Done (2026-09-11, built by the orchestrator on main). `journeyRow`
  gains `beyondHorizon` (realtime, fresh, future, not cancelled, `delayMin
  === 0`, `mins > LIVE_HORIZON_MIN`), exported as `LIVE_HORIZON_MIN = 40`
  from `rowmodel.js`; it joins the `!realtime || stale` branch so `kind`,
  `provenance` and `scheduledOnly` all read one predicate. The existing
  "far-future service" unit test changed expectation from `''` to
  `SCHEDULED` for the monitored 187-minute row (it cited the 2026-09-01 B
  ruling; the 2026-09-11 ruling supersedes it, noted in the test). Fixture
  regenerated with the exporter; `prediction.json` and `calibration.json`
  unchanged. `web/sw.js` `VERSION` v60 → v61. Gates: `(cd web && npm test)`
  446 pass, 0 fail, 20 todo (peer's transfer-recovery placeholders);
  `tools/playtest-regressions.sh` exit 0, 1 case pass. Trap: the gate
  needs `~/projects/playtest/node_modules`; it was missing and `npm ci`
  there restored it.
- Own: `web/js/rowmodel.js`, `web/test/rowmodel.test.js`,
  `tools/export-android-conformance.mjs`,
  `tools/fixtures/conformance/rows.json`, `web/sw.js` (`VERSION`),
  `docs/contracts/ui.md`.
- In `journeyRow`, compute `delayMin` as today, then decide the horizon
  predicate from `design.md`; when it holds, `kind` is `sched`,
  `provenance` is `SCHEDULED` and `scheduledOnly` is true. `figure`,
  `effective`, `depTime`, `arrTime` and `schedTime` are computed exactly as
  before.
- Add unit cases for both sides of the edge and the three exceptions.
- Add conformance deltas: `live at horizon` (offset 40, realtime), `beyond
  horizon on time` (41, realtime), `beyond horizon late` (41, delay 6),
  `early estimate at horizon` (offset 43, delay −2: the exporter applies
  the offset to the schedule and the delay to the estimate, so the live
  countdown is 41) and `beyond horizon cancelled` (41, cancelled). Do not
  add an arrival-only realtime case: it is a recorded web/native
  divergence (design, "Cross-client conformance"). Regenerate `rows.json`
  with the exporter; hand edits are not conformance evidence.
- Bump `VERSION` in `web/sw.js`: `rowmodel.js` is in `SHELL`.
- Contract: add the horizon rule to `ui.md` under "Past, stale and
  exceptional data", next to the `SCHEDULED` bullet, with the owner ruling
  and date. State that the label now also means "live estimate beyond the
  40 minute horizon with no delay".
- Gate: `(cd web && npm test)`; `tools/playtest-regressions.sh`.

## Phase 2 — Android

- [x] Done (2026-09-11, Opus 5 on `lls-android`, merged 3d4c5cf).
  `UiCommon.kt` gains `LIVE_HORIZON_MIN = 40`, `rowStale` (the 90 s
  staleness expression `figureFor` and `BoardRow` had duplicated) and
  `beyondLiveHorizon(journey, board, now)`: first-leg `estimatedDeparture`
  non-null, not cancelled, `source == "live"`, not stale, printed delay 0,
  `mins > 40`. `figureFor` labels it `Scheduled` below the untouched
  `late > 0` branch; `BoardRow.figureColor` maps it to `ink2`. New
  `LiveHorizonTest` (7 tests: both edges, late, early, cancelled, five
  already-scheduled source states, mixed-leg, `nextServiceFigure` format).
  Mixed-leg divergence recorded in `android-deviations.md`. Gate:
  `tools/build-android.sh --unit` exit 0, 155 tests, 0 failures; flipping
  `>` to `>=` failed `LiveHorizonTest` and the fixture's `live at horizon`
  case, then restored.
- Own: `android/app/src/main/java/com/ilovetrains/app/UiCommon.kt`,
  `UiBoard.kt`, `UiPresentation.kt` if it reads `journey.realtime` for a
  row, their unit tests, and `docs/contracts/android-deviations.md`.
- Record the mixed-leg divergence in `android-deviations.md`: a journey
  with a scheduled first-leg departure and a live later leg paints live on
  Android and `SCHEDULED` on web (owner ruling 2026-09-11). Pin in a JVM
  unit test that such a row 41 minutes out is unchanged by the horizon
  rule.
- One predicate on `legs.first().estimatedDeparture`, the printed delay and
  `mins`, used by `figureFor` for the label and by the board row's numeral
  colour, so label and register cannot disagree. No clock time, figure
  value or unit changes; the smart header and next-service rail must be
  byte-identical in their figure output before and after.
- Gate: `tools/build-android.sh --unit` including `RowConformanceTest`
  against the regenerated fixture.

## Phase 3 — iOS

- [x] Done (2026-09-11, Opus 5 on `lls-ios`, merged 132ebc2). `Common.swift`
  gains `liveHorizonMinutes = 40`, `staleRow` and `beyondLiveHorizon`, the
  same predicate as Android; `figureFor` folds it into a
  `scheduledRegister` flag below `late > 0`; `BoardRow.figureColor` maps it
  to `ink2`. Five new `RowConformanceTests` cases (edges, exceptions,
  already-scheduled states, mixed-leg, `nextServiceFigure` "40 min" vs
  "41 min"). Mixed-leg divergence recorded in `ios-deviations.md`. Gate:
  `tools/build-ios.sh --unit` on an agent-owned simulator (created and
  deleted), exit 0, 189 tests, 0 failures; the `>=` flip failed 3
  assertions including the fixture's `live at horizon` case, then restored.
  Trap: `build-ios.sh` auto-selects the last booted iPhone, which is a
  peer's device while several are booted; always pass
  `ILOVETRAINS_SIMULATOR_ID`.
- Own: `ios/ILoveTrains/UI/Common.swift`, `ios/ILoveTrains/UI/BoardView.swift`,
  their unit tests, and `docs/contracts/ios-deviations.md`.
- Record the same mixed-leg divergence in `ios-deviations.md` and pin it
  with an XCTest as on Android.
- Same single-predicate rule as Android; do not project the journey through
  `scheduledOnly()`, which would also drop the arrival estimate.
- Gate: `tools/build-ios.sh --unit` including `RowConformanceTests`.

## Phase 4 — Verification on final sources

- [x] Done (2026-09-11). One Opus 5 agent per platform, forked from
  f619995 after the orchestrator registered a shared `board-horizon` screen
  in `tools/visual-regression.js` so no two agents edited the same table
  line. Each platform now has a `board-horizon` calibration state (web
  `tools/shoot-states.js`, Android `UiCalibrationTest`, iOS
  `horizonCalibrationBoard()` behind DEBUG) seeding one fresh live board:
  40 on time, 41 on time, 41 late by 6, scheduled 43 with estimate 41,
  cancelled (Android's cancelled row sits at 44 because a row key is
  line + scheduled minute). Each asserts the five labels before shooting.
  Before/after frames from the pre-feature commit 575c35b and the feature
  are in `evidence/`; on every platform the diff is confined to the second
  row's numeral colour and its `SCHEDULED` label.
- Visual regression per platform on f619995 sources: web 8 DIFF, of which
  `board-two-change` (the transfer fixture's 48-minute on-time row) is the
  feature and accepted, and seven Settings frames were a pre-existing
  version-string change owned by the peer item; Android moved no existing
  frame (a before/after sweep of all 39 canonical frames on the same
  emulator differed only in the known setup keyboard-inset flake); iOS 31
  same, no DIFF. Home and smart header frames were `same` everywhere.
  Baselines added: `board-horizon` on all three platforms. The Android one
  was shot on AVD `Location_Review`; the other Android baselines came from
  a peer's AVD and differ from it by anti-aliasing rims, so a full Android
  matrix on either device reports those rims until one device owns all.
- Main moved during the wave: the transfer-completion-recovery item merged
  (192c423, 1bd4330). Its edits to `UiCommon.kt`, `Common.swift`,
  `UiBoard.kt`, `BoardView.swift`, `ui.md`, `shoot-states.js` and
  `visual-regression.js` were journey-axis and alert work and auto-merged;
  `manifest.json` conflicted three times and was resolved by keeping the
  peer's device blocks.
- Full gates on the merged main (0e40ea0): `go test ./...` ok;
  `(cd web && npm test)` 495 pass 0 fail; `tools/playtest-regressions.sh`
  exit 0, 2 cases pass; `tools/build-android.sh` exit 0 (unit 174 tests
  0 failures); `tools/build-ios.sh --test` exit 65 on the first attempt
  with one failure in the peer's `ControllerTests.
  testKeepaliveStopsWhenTheSessionEndsInTheBackground` under memory
  pressure, then exit 0 on retry (213 unit, 19 UI tests, 0 failures);
  `tools/visual-regression.js --platform web` 47 same exit 0;
  `--platform ios --screens board-horizon,board,board-delayed,home,detail`
  6 same exit 0. Android connected tests ran in the Android verification
  wave (61 tests, one timing flake per run, each green alone), not again on
  the merged tree. Trap: three platform gates in parallel on this Mac were
  killed for memory; run them one at a time.
- Open for the owner at closeout: 18 Android and 20 iOS `tracker-*`
  baselines exist on disk but were never force-added (blanket `*.png`
  ignore), so the tracker lane reports NEW/MISSING on every run.
- Evidence: on each platform, a before/after frame of a board with a
  41-minute on-time row and a 41-minute late row. Check the stub route
  anchors (`tools/README.md`) for a board that already holds such rows; if
  none does, seed one with `tools/shoot-states.js` and the native
  equivalents rather than editing captured fixtures.
- `tools/visual-regression.js` for board and journey-detail screens on all
  three platforms; accept only diffs that are a far-out on-time row moving
  to the scheduled register. The smart header frame must be unchanged.
- Full gates once: `go test ./...`, `(cd web && npm test)`,
  `tools/playtest-regressions.sh`, `tools/build-android.sh`,
  `tools/build-ios.sh --test`.
- Close out under `backlog-item close`, then deploy per
  `docs/operations/deploy.md`.
