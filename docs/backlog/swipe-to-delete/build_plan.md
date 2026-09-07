# Build plan: swipe to delete

Read `design.md` first; it is the spec and every ruling is there. The build
runs in a fresh context. Phases 1 and 2 own disjoint files and run in
parallel after phase 0. Phase 3 is the verification wave and runs alone.

Standing rules for every phase:

- Never source `.env`. No phase needs an API key.
- `go test ./...` and `(cd web && npm test)` are untouched but must stay
  green; nothing under `web/` changes, so `web/sw.js` `VERSION` does not bump.
- `docs/ROADMAP.md` is owned by another session on 2026-09-07; do not edit it.
- Copy is only what `design.md` "Copy" records after the owner's verdict. A
  string not there is raised as a question, never written.
- Every existing frame in `assets/comps/latest/` and `tools/baselines/` must
  still match after this item. The gesture adds behaviour; a row at rest does
  not change.
- User-facing strings are drafted by Codex, never by the build agent.

## Phase 0 — rulings and contracts — DONE marker: `swipe-to-delete phase 0` commit

**DONE 2026-09-07.**

Orchestrator work, no agent. Every ruling is already in `design.md`
"Decisions" (all dated 2026-09-07).

Owns: `docs/contracts/client-storage.md`, `docs/contracts/android-deviations.md`,
`docs/contracts/ios-deviations.md`.

1. `client-storage.md`: in the Android storage paragraph ("Android retains
   trips until the user deletes them...") and the iOS paragraph, add: swiping
   a saved trip deletes it immediately; the deletion is reversible from the
   bottom bar for the undo window; the cached boards are purged when the
   window ends; one deletion is pending at a time and a second commits the
   first. Replace "deletion becomes swipe-to-delete in the native app" in
   the `trips` cap bullet with a pointer to those paragraphs.
2. `android-deviations.md`: rewrite the long-press bullet per `design.md`
   "Contracts and comps this item changes". Add the two new exemplar frames
   to the exemplar list at the end of the file.
3. `ios-deviations.md`: extend the context-menu bullet with the swipe
   actions and the undo window; name the two new frames.

Verify: the three contract diffs read as one rule stated three times, not
three rules. Done when committed.

## Phase 1 — Android — DONE marker: `swipe-to-delete phase 1` commit

**DONE 2026-09-07.** JVM gate green (51 unit tests, 7 new in `TripDeletionTest`, lint clean); `swipeDeletesRowAndUndoRestoresIt` and `tripListStillScrollsVertically` pass on the booted emulator at 390x844.

Owns: `android/app/src/main/java/com/ilovetrains/app/UiHome.kt`,
`UiApp.kt`, `Models.kt`, `TrainViewModel.kt`, new `TripDeletion.kt`, new
`android/app/src/test/java/com/ilovetrains/app/TripDeletionTest.kt`,
`android/app/src/androidTest/java/com/ilovetrains/app/UiCalibrationTest.kt`.

Seam contract:

- `AppState` gains `undoAvailable: Boolean = false`. `UiActions` gains
  `undoDelete()`. `deleteTrip(id)` keeps its signature and now means
  "commit with undo window"; the long-press menu calls the same path, so a
  menu delete is also undoable.
- `TripDeletion.kt` holds the pure logic, mirroring `BoardRetention.kt`:
  `fun UserData.beginDeletion(id: String): Pair<UserData, PendingDeletion>?`
  and `fun UserData.restore(pending: PendingDeletion): UserData`.
  `PendingDeletion` carries the trip, its index, its history events in order,
  and the focus, last answer and last trip id it displaced. Restore reinserts
  at `index.coerceAtMost(trips.size)`, re-appends the events in order, and
  restores focus, last answer and last trip id only where the current value
  is null.
- `TrainViewModel`: `deleteTrip` calls `beginDeletion`, purges the previous
  pending trip's cache if one exists, stores the new pending, sets
  `message = "<from> → <to> deleted"` (the exact string from `design.md`)
  and `undoAvailable = true`, runs the existing post-delete sequence, and
  starts a `viewModelScope` timer of
  `accessibilityManager.getRecommendedTimeoutMillis(WindowMillis,
  FLAG_CONTENT_TEXT or FLAG_CONTENT_CONTROLS)`, where `WindowMillis` is the
  owner's window and the constructor accepts an override for tests. Expiry
  purges the cache, clears `pendingDeletion`, and clears the message and
  `undoAvailable` only if the message is still the deletion message.
  `undoDelete` cancels the timer, restores, persists, runs
  `choosePrediction`, `syncPersonal`, `refresh`, and clears the bar.
  `dismissMessage` on a deletion message does not undo; it only hides the
  bar and leaves the timer running.
- `UiApp.kt` bar: label is `Undo` when `state.undoAvailable`, else
  `Dismiss`; the bar's click calls `undoDelete` when `undoAvailable`, else
  `dismissMessage`. The feedback `LaunchedEffect` is unchanged.
- `UiHome.kt`: wrap `SavedTripRow` + `Rule` in `SwipeToDismissBox` with
  `enableDismissFromStartToEnd = false`, `positionalThreshold = { it * 0.5f }`
  (half the row width, so a short horizontal flick springs back), background
  `c.warning` with a `Delete` `Label` aligned `CenterEnd` inside the page
  padding, and `Modifier.animateItem()` on the item. Confirm the dismiss in
  `confirmValueChange` by calling `actions.deleteTrip(trip.id)` and returning
  true only for `EndToStart`. The `DropdownMenu`, `combinedClickable` and
  `Trip actions` semantics are untouched.

Verify gate:

- `tools/build-android.sh` green (JVM tests including `TripDeletionTest`,
  lint). `TripDeletionTest` covers: deletion removes trip, history, focus,
  last answer, last trip id; restore puts them back at the original index
  with history order preserved; restore does not overwrite a focus set in
  between; restore after the list shrank clamps the index.
- `UiCalibrationTest` gains `swipeDeletesRowAndUndoRestoresIt`: swipe the
  first row left past half its width, assert `deleteTrip` was called with
  its id and the bar shows `Undo`; a swipe of a quarter width calls nothing.
  It also gains `tripListStillScrollsVertically` with eight seeded trips.
- `UiCalibrationTest.captureCanonicalScreens` adds `home-deleting`
  (a `down` + `moveBy` past the threshold without `up`, so the red background
  and `Delete` are visible) and `home-deleted` (after commit, bar visible).
  Frames are shot in phase 3; phase 1 only makes them capturable.

Done when the gate is green on the JVM and the two new instrumented tests
pass on one booted emulator at 390x844.

## Phase 2 — iOS — DONE marker: `swipe-to-delete phase 2` commit

**DONE 2026-09-07.** `tools/build-ios.sh --test` green: 59 tests (27 unit including the three new controller tests, 4 UI flows including the swipe drive) on the booted iPhone 17 simulator. The one earlier red was `OfflinePlannerTests` killed by signal while Gradle and the emulator ran alongside; it passed alone and in the final full run.

Owns: `ios/ILoveTrains/UI/HomeView.swift`, `ios/ILoveTrains/UI/AppView.swift`,
`ios/ILoveTrains/Core/AppState.swift`, `ios/ILoveTrains/Core/TrainViewModel.swift`,
`ios/ILoveTrainsTests/ControllerTests.swift`,
`ios/ILoveTrainsUITests/AppFlowTests.swift`, `tools/shoot-ios.sh` (the
`default_states` list only). Regenerate the Xcode project with
`tools/generate-ios-project.rb` if a file is added; do not hand-edit the
pbxproj.

Seam contract:

- `AppState` gains `undoAvailable = false`. `TrainViewModel` gains
  `undoDelete()` and `pendingDeletion`, `undoTask` and an `undoWindow:
  Duration` initialiser parameter defaulting to the owner's window.
  `deleteTrip(id:)` becomes the commit: snapshot per `design.md`, purge the
  previous pending trip's cache if any, remove via the existing `removeTrip`
  minus its purge, persist, run the existing post-delete sequence, set
  `message` to the design string and `undoAvailable = true`, start
  `undoTask`. Expiry, undo and dismiss semantics are identical to the Android
  seam above. The ten-trip cap runs after a restore with the standard rule.
- `AppView.swift` bar: label `Undo` and action `undoDelete` when
  `undoAvailable`; the `feedbackSuccessMessage` task is unchanged.
  Accessibility identifier stays `message-dismiss` when dismissing and is
  `message-undo` when undoing.
- `HomeView.swift`: the `ScrollView` + `LazyVStack` becomes a `List` with
  `.listStyle(.plain)`, `.scrollContentBackground(.hidden)`,
  `.scrollIndicators(.hidden)`, every row `.listRowInsets(EdgeInsets())`,
  `.listRowSeparator(.hidden)`, `.listRowBackground(colors.ground)`, and the
  anchor and end labels as non-swipeable rows. `SavedTripRow` gains
  `.swipeActions(edge: .trailing, allowsFullSwipe: true) { Button("Delete",
  role: .destructive) { model.deleteTrip(id: trip.id) } }`. The
  `contextMenu`, accessibility label and `trip-<id>` identifier are
  untouched. Horizontal page padding moves from the stack to the rows so
  the swipe background reaches the screen edge.
- `--calibration home-deleted` seeds `pendingDeletion` for the calibration
  trip with the bar showing; add `home-deleted` to `default_states`.
  `home-deleting` cannot be seeded because it is a gesture mid-flight; the
  UI test below captures it.

Verify gate:

- `tools/build-ios.sh --test` green. `ControllerTests` gains
  `testSwipeDeleteThenUndoRestoresTripHistoryAndFocus`,
  `testUndoWindowExpiryPurgesCacheAndClearsBar` (window shortened to
  50 ms through the initialiser) and
  `testSecondDeletionCommitsTheFirst`.
- `AppFlowTests` gains `testSwipeRevealsDeleteAndUndoRestoresRow`: swipe
  `trip-calibration-trip` left, assert a `Delete` button appears, attach a
  screenshot named `home-deleting`, tap Delete, assert the row is gone and
  `message-undo` exists, tap it, assert the row is back. It also asserts a
  vertical `swipeUp` on the list still scrolls.
- The home frame at rest (`tools/baselines/ios/home.png` and every other
  home baseline) must still pass `tools/visual-regression.js`. This is the
  proof the `List` conversion changed nothing at rest.

Done when the gate is green on one booted iPhone simulator.

## Phase 3 — verification wave and owner verdict — DONE marker: `swipe-to-delete phase 3` commit

Owns: `assets/comps/latest/` (four new frames), `tools/baselines/`
(accepted frames), `tools/README.md` (how the iOS `home-deleting` frame is
exported from the xcresult, and the Android partial-drag capture).

1. `tools/shoot-android.sh 390x844`, `tools/shoot-android.sh 412x732`, and
   390x844 at font scale 1.3. Check the bar text fits one line at 1.3 with
   the calibration trip's names and clips rather than wraps when it cannot.
2. `tools/shoot-ios.sh` for the default states plus `home-deleted`; export
   `home-deleting` from the UI test's xcresult with `xcrun xcresulttool`.
3. `tools/visual-regression.js` for all three clients. Every pre-existing
   frame passes unchanged. The three new baseline frames (`home-deleting`
   and `home-deleted` on Android, `home-deleted` on iOS) are the only
   additions; the iOS `home-deleting` frame is a comp only (see `design.md`
   "Build decisions").
4. Accessibility drive: Android with TalkBack on the emulator, confirm
   `Trip actions` still opens the menu and the bar announces the deletion
   text and `Undo`; iOS with VoiceOver in the simulator or Accessibility
   Inspector, confirm the row's actions rotor lists `Delete` and the bar is
   reachable.
5. Present the four new frames to the owner as a comp sheet in the style
   `memory` records: concise prose, one measurement where it decides. Owner
   verdict on the revealed-state look. A rejected frame reopens phase 1 or
   2 for that platform only.
6. On approval, copy the four frames into `assets/comps/latest/`, accept the
   baselines, and commit.

Done when the owner has approved the frames and the baselines are committed.
Closeout then follows the `backlog-item` close stage: migrate the surviving
rules (already in the contracts from phase 0), delete this folder, build and
distribute both native apps per `docs/operations/android.md` and
`docs/operations/ios.md`.
