# Native review: build plan

Draft, 2026-09-07, updated the same day for the owner's rulings (iOS is the
reference for the journey axis, the full wharf label everywhere, and the web
decides every other divergence). Phases are ordered so that global passes
and shared contract text land before parallel platform work forks. Phases
2–7 are independent of each other once Phase 0 and Phase 1 are done and may
run in parallel worktrees; Phase 8 (tests) and Phase 9 (verification) close.

Finding letters (A1, C3, …) refer to `design.md`. Items marked **[ruling n]**
are blocked on the numbered decision under "Decisions still needed" in
`design.md`; everything else is buildable now. Do not start a blocked item
under an assumed answer.

Verify gates use the repository's four test commands (`go test ./...`,
`(cd web && npm test)`, `tools/build-android.sh`, `tools/build-ios.sh --test`)
plus `tools/visual-regression.js` for any phase that reaches a screen.
Accepted baselines are committed with the phase that changed them.

## Phase 0: contract text

Owns: `docs/contracts/native-data.md`, `docs/contracts/client-storage.md`,
`docs/contracts/ui.md`, `docs/contracts/android-deviations.md`,
`docs/contracts/ios-deviations.md`.

- Move the realtime ordering and in-flight guard sentence from the iOS
  section of `native-data.md` into the shared realtime section (A2).
- Reword the service-day scan and the Circular Quay floor to match the code
  **[ruling 3]** (A7, A8).
- Record in `ui.md` that the initial ferry cap and every boarding clause use
  the full departure label wherever it is available (owner ruling 2, C3).
- Record the native board page size and footer rule **[ruling 1]** (C10,
  F7), the `quick_check` marker **[ruling 2]** (E1), and the offline
  timetable freshness line **[ruling 4]** (C6).
- Remove from `ios-deviations.md` anything the web ruling now overrides
  (setup mode filtering, "metro" wording) and from `android-deviations.md`
  the `Now` size note that the shared three-character rule replaces (D5).

Verify: contract diff reviewed against `design.md`; no code. Done marker:
every ruling in `design.md` has a contract sentence.

## Phase 1: shared routing and realtime correctness

Owns Android: `OfflineRealtime.kt`, `OfflineRouter.kt`, `OfflinePlanner.kt`,
`OfflineRealtimeTest.kt`, `OfflineRouterTest.kt`.
Owns iOS: `OfflineRealtime.swift`, `OfflineRouter.swift`,
`OfflinePlanner.swift`, `OfflineRealtimeTests.swift`,
`OfflineRouterTests.swift`.

Seam contract: `overlay(List)` is the only production overlay of
connections; it never sets `cancelled` for a `skipped` stop, only
`pickupType`/`dropOffType = 1` (A1). `accept` rejects a header older than
the stored one and derives `expiresAt = min(payload, header + 90_000)` (A2,
A3). Android's `update()` restores the previous generation when `open`
fails (A4) and validates `application_id`, manifest `bytes ≤ 300 MiB` and
ordered dates (A5). The single-connection overlay is deleted on both
platforms and its tests re-target the list overlay (A6).

Verify: Android gains the A→B→C skipped-stop test mirrored from
`OfflineRealtimeTests`; both suites green; `OfflinePlannerInstrumentedTest`
unchanged. Done marker: `grep 'overlay(' ` finds only list and journey
forms on both platforms.

## Phase 2: Android travel mode and focus

Owns: `Prediction.kt`, `TrainViewModel.kt` (focus, redirect, replan and
`lastAnswer` paths only; the deletion/undo code is bound by `client-storage.md`'s Android and iOS storage sections),
`BoardRetention.kt`, `PredictionTest.kt`, `BoardRetentionTest.kt`.

Seam contract: `inferredFocus` requires a finite origin→destination
distance (B1). `saveTrip` after `newTrip` from an inferred focus matches the
first leg's line and scheduled departure in the new pair's board and
re-focuses `pinned = false`, else opens the board (B3; iOS `resolveRedirect`
is the reference). Home votes only from Home (B6). Alternatives on the focus
board keep their observed values; no `scheduledOnly()` sweep (B8). The
background replan marks the base `offline` only when the online request
failed (B9). `lastAnswer` follows the web: recorded from any fresh shown
answer with the shown board and lead, cleared only on release and deletion
(B5). Replacement and next-service candidates are filtered so every leg's
mode is enabled (B4).

Verify: new `PredictionTest` case with an uncoordinated destination; new
JVM `TrainViewModel` test (see Phase 8) covering redirect, vote gating, the
server-stale replan and the `lastAnswer` lifecycle. Done marker: those tests
exist and pass.

## Phase 3: iOS travel mode, focus and location

Owns: `TrainViewModel.swift` (focus, location, alternatives, `lastAnswer`
and earlier paths only), `LocationService.swift`, `SetupView.swift` (origin
guard and mode filter), `ControllerTests.swift`, `PredictionTests.swift`.

Seam contract: destination proximity uses the saved trip's destination
station (B2). Replacement and next-service candidates are filtered so every
leg's mode is enabled (B4). `lastAnswer` follows the same web rule as
Android (B5). A cleared or chosen origin is never overwritten by a late fix;
the automatic prefill happens once on first run only (B7). `pause()` on
`.inactive` keeps an in-flight permission request alive, or `resume()`
re-requests after a grant regardless of screen (B10). `request(prompt:)`
issues one `requestLocation` (B11). Setup search and `saveTrip` apply no
mode filter (F10).

Verify: `ControllerTests` cases for B2 (online-sourced focus completes at
the trip destination), B4 and B5; simulator run of the setup flow with
`--calibration setup`. Done marker: tests exist and pass.

## Phase 4: copy and status parity with the web

Owns Android: `UiHome.kt` (status, placeClause, rail, distanceText),
`UiDetail.kt`, `UiCommon.kt` (Freshness, platformText, figure branches),
`UiBoard.kt` (footer, empty-state copy), `UiSetup.kt` (nearest group,
threshold), `UiSettings.kt` (threshold).
Owns iOS: `HomeView.swift` (modeName, status, rail, summary, `Just added`),
`DetailView.swift`, `Common.swift` (FreshnessView, platformText),
`BoardView.swift` (footer, empty-state copy), `SetupView.swift` (nearest
group), `SettingsView.swift` (threshold).

Seam contract, each item naming the web function it ports:

- `modeWords` (`journey.js`): `train` for everything but ferry; the
  next-service rail alone says `metro`/`service` (C1).
- `boardingLabel` / `boardingCapLabel` (`journey.js`): full label verbatim
  when it already carries the place word or starts with `Side`; the initial
  cap uses the full label, bare `Wharf` only when there is no number or
  side (C2, C3, owner ruling 2).
- `focusStatus` (`focus.js`): one function per platform feeding the header
  line and the saved row: `Trip over`, `Cancelled`, `Running late`,
  `Running`, plus the pin (C4, C5).
- `ageLabel` (`time.js`) and `emptyCopy` (`board.js`) strings and the web
  `stale` predicate (C6); the offline timetable line per **[ruling 4]**.
- Empty-state slots derive from board status, never `state.message` (C7).
- The rail uses `figureFor` (`countdownFigure`, rounded hours, blank only
  when stale) (C8).
- `Just added` on the automatic pair save's open, and the `NEAREST STATION`
  group in setup once a fix exists (C9).
- Footer per **[ruling 1]** (C10).
- `formatDistance` (`home.js`) shared by header and row (C11).
- `MIN_QUERY = 3` in both pickers (F3).
- Dead figure branches removed (D7).

Every string above already exists in `ui.md` or the web source; no new
copy is drafted. Any string that turns out to be new goes through the
`user-facing-copy` skill.

Verify: JVM table test for the platform/wharf grammar mirroring
`web/js/journey.js` cases (Android) and an XCTest twin; `HomeStatusTests`
gains the Android twin; visual regression at 390×844 and 412×732, font
scale 1.3 on Android. Done marker: baselines accepted for every frame that
changed and the diff explained in the commit.

## Phase 5: journey axis and layout

Owns Android: `UiCommon.kt` (`JourneyAxis`, figure sizes), `UiBoard.kt`
(`BoardRow`), `UiHome.kt` (header figure sizes), `UiSettings.kt` (feedback
focus), a new `JourneyAxisGeometry.kt` with its JVM test.
Owns iOS: `BoardView.swift` (`BoardRow` provenance line, figure size),
`HomeView.swift` (figure size).

Seam contract: Android ports iOS `JourneyAxisGeometry` as a pure function
(measured chip and label sizes in, frames out) and lays the axis out from
it, so change names sit beneath their dwell midpoint, clamped and wrapped,
colliding names stacked, and `JourneyAxisLayoutTests` has a Kotlin twin
(D1, owner ruling 1). Second-change alighting pin hidden on two-change
results (D2). Dwell warning never on a cancelled journey (D3). Provenance is
one reserved line on both (D4). Figures of three or more characters are
`wide`: 28 on the board, 50 on Home, on both platforms (D5). Android
feedback field shows focus with the strong rule and primary-ink label; the
draft lives on the view model for the process lifetime (D6). The transfer
cap and any change to how many names an axis must carry come from
`docs/backlog/transfer-cap/`, not from this phase.

Verify: Android `JourneyAxisGeometry` test equivalent to
`JourneyAxisLayoutTests`; visual regression on `detail-two-change`,
`board-transfer`, `home-active`, the offline-retained frames and the
feedback frames. Done marker: baselines accepted.

## Phase 6: performance

Owns Android: `OfflinePlanner.kt`, `OfflinePackageStore.kt`,
`OfflineRouter.kt`, `OfflineRealtime.kt`, `TrainViewModel.kt` (persist
gating), `UiHome.kt`/`UiBoard.kt` (row parameters), `Storage.kt` (cache
trim).
Owns iOS: `OfflinePlanner.swift`, `OfflinePackageStore.swift`,
`OfflineRouter.swift`, `OfflineRealtime.swift`, `DeviceStore.swift`,
`AppState.swift`, `TransitAPI.swift`, `TransitModels.swift`,
`OfflineZip.swift`, `SetupView.swift`, `SettingsView.swift`,
`JourneyAxisLayout.swift`.

Seam contract: a generation carries a verified marker written after a
successful full validation; start-up runs only `user_version` and coverage
when the marker exists **[ruling 2]** (E1); `initialize()` does not
re-activate an already active generation. `persist()` runs only when
`data` changed (E2). iOS cache trimming reads attributes only (E3); Android
trims to the same bounds (F9). `tripKey` is stored (E4). Overlay mutates in
place for snapshot trips and re-sorts only when a departure moved (E5).
Router memoises long-wait ends, uses `eligible` in the stop test and bounds
failed seeds (E6). `sydneyCalendar` is a `let`; trip scores are precomputed
before sorting (E7). Static formatters (E8). Streamed extraction (E9). One
computed `matches`/`results` per body pass; layout geometry cached by width
(E10). Row composables take narrow parameters (E11). iOS shared refresh
replans locally without a second departures request (E12).

Verify: `OfflinePlannerPerformanceInstrumentedTest` numbers before and
after recorded in the commit (extract/verify/open, first plan, cached
plan); iOS equivalent via `OfflinePlannerTests` timing; unit suites green.
Done marker: measured start-up and plan times in `native-data.md`'s
measurement section replaced with the new numbers.

## Phase 7: paging, simplification and dead code

Owns: `Models.kt`, `TrainViewModel.kt` (`earlier`), `TransitApi.kt`,
`Storage.kt`, `UiSetup.kt`, `UiSettings.kt`, `AndroidManifest.xml`,
`AppState.swift`, `DeviceStore.swift`, `TrainViewModel.swift` (`earlier`),
`TransitAPI.swift`, `AppView.swift`, `UiApp.kt`, `UiHome.kt`,
`HomeView.swift`, `TransitModels.swift`.

Seam contract: `earlier()` pages through the API exactly as `main.js` does
(`at = earliest − step`, the web page limit **[ruling 1]**, 24-hour bound,
generation and key guards, each page keeping its realtime), with one task
handle and the local planner only when the request fails (F7).
`reverseTrip` gone from `UiActions` and both models (F1). Unused members
removed (F2). One `fuzzyScore` on Android (F3). One LRU owner on iOS using
the web rule (F4). One feedback-success constant per platform (F5).
`SavedTrip.lines` holds `(code, mode)` in travel order on both platforms,
with a storage migration that reads the old string list (F6). Persisted
journeys validated on decode (F8).

Verify: `StorageTest`/`StorageTests` cover the `lines` migration; a paging
test per platform against a fake API; unit suites green;
`UiCalibrationTest` stub updated for the removed action. Done marker:
`grep reverseTrip` returns nothing under `android/` or `ios/`.

## Phase 8: tests

Owns: `android/app/src/test/**`, `ios/ILoveTrainsTests/**`.

- Android `WebConformanceTest` asserts `expected.noLocation`;
  `RowConformanceTest` asserts `depTime`/`arrTime` (G1).
- Android `TrainViewModelTest` with an injectable clock and dispatcher
  covering redirect, vote gating, server-stale replan, mode hide/restore,
  `lastAnswer` lifecycle and the fix-newer-than-tick case (G2).
- iOS `OfflineZipTests`: table of hand-built malformed archives for every
  rejection path (G3).
- Every fix in Phases 1–7 lands with its regression test (G4).

Verify: both unit suites green. Done marker: the four named test files
exist.

## Phase 9: verification wave

No code. Run the four gates and `tools/visual-regression.js` on web,
Android and iOS; drive the affected states on a real emulator and simulator
at 390×844 and 412×732 (font scale 1.3 on Android); accept baselines; run
the closeout in the `backlog-item` skill: migrate durable rules into the
contracts, delete this folder, deploy per `docs/operations/deploy.md`.
