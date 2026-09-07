# Swipe to delete a saved trip (Android and iOS)

Design opened 2026-09-07. The owner accepted the swipe-plus-undo
recommendation the same day ("Create the backlog item for this") after asking
what best practice is, and ruled on the gesture split, the undo window, the
bar and the copy the same day. No open questions remain; the item is ready
to build in a fresh context.

## What and why

A saved trip on the native home screens can only be deleted through a hidden
gesture: long-press on Android, the context menu on iOS. Users on both
platforms expect to swipe a row they created, and a list that ignores the
swipe reads as broken. `docs/contracts/client-storage.md` already says
"deletion becomes swipe-to-delete in the native app"; this item builds it.

The web reference has no deletion at all (ten-trip LRU only), so this is a
native deviation and is recorded in both deviation contracts. The web app does
not change.

The safety net is undo, not a confirmation dialog. A saved trip is a from/to
pair the user can rebuild in a few taps, so a dialog would punish every
deliberate delete to protect the rare accidental one. Both platforms treat a
short reversible window as the correct pattern for low-stakes user data.

## As built today (verified against the repo, 2026-09-07)

- **Android list and row.** `UiHome.kt` renders a keyed `LazyColumn`
  (`items(state.trips, key = { it.id })`). `SavedTripRow` is a `Row` with
  `combinedClickable` (tap opens departures, long-press opens a
  `DropdownMenu` with `Delete trip`) and a TalkBack custom action
  `Trip actions` that opens the same menu. A `Rule()` follows every row.
- **iOS list and row.** `HomeView.swift` renders a `ScrollView` around a
  `LazyVStack`; `SavedTripRow` is a plain-style `Button` with
  `.contextMenu { Delete trip }`, accessibility identifier `trip-<id>`, then
  `TrainRule()`.
- **Delete path.** `TrainViewModel.deleteTrip(id)` on both platforms removes
  the trip, its history events, and any focus, last answer and last trip id
  that point at it; persists; purges the trip's cached boards (both
  directions, every mode variant) on a background task; clears the board if
  the deleted trip was selected; then runs `choosePrediction`,
  `syncPersonal` and `refresh`. Persist is already coalesced (Android write
  channel, iOS write task), so nothing on the delete path blocks the UI.
- **Bottom message bar.** Both apps already have one global bar
  (`UiApp.kt`, `AppView.swift`): ink background, 52 minimum height, message
  text on the left, an uppercase `Dismiss` label on the right, the whole bar
  tappable. It shows `state.message`. The feedback success message dismisses
  itself after 4 s; Android extends that by the accessibility recommended
  timeout, iOS does not.
- **Frameworks.** Material3 is a dependency, so `SwipeToDismissBox` costs no
  new library. Compose BOM 2025.10.01 provides `Modifier.animateItem()`. iOS
  deploys to 17.0, so `List` with `.swipeActions(allowsFullSwipe:)` is
  available.
- **Calibration.** Android frames come from `UiCalibrationTest.capture()`
  through `tools/shoot-android.sh`; iOS frames from `--calibration <state>`
  seeding through `tools/shoot-ios.sh`; `tools/visual-regression.js` compares
  every frame with `tools/baselines/`.

## Mechanism

### The gesture

Each platform uses its own default, because that is what its users already
know (owner ruling, 2026-09-07). Neither is a custom gesture.

- **iOS: reveal, then full swipe.** The trips section moves from
  `ScrollView` + `LazyVStack` to `List` so the row can carry
  `.swipeActions(edge: .trailing, allowsFullSwipe: true)` with one
  destructive `Delete` button. A short swipe reveals the red button and
  tapping it commits; a long swipe commits without the tap. The `List` is
  `.plain`, with zero row insets, hidden separators (the existing `TrainRule`
  stays), hidden scroll content background and no section header chrome, so a
  row at rest is pixel-identical to today. That identity is a verify gate,
  not a hope. `contextMenu` stays.
- **Android: dismiss with undo.** `SavedTripRow` and its `Rule` are wrapped in
  a `SwipeToDismissBox` that allows only end-to-start. The background is the
  theme warning colour with a `Delete` label aligned to the end, uncovered as
  the row moves. Releasing past the box's positional threshold commits;
  releasing earlier springs back. There is no reveal-and-stop button on
  Android; the Material pattern is swipe to dismiss, then undo. The removed
  row animates out with `animateItem()`. The long-press menu and the
  `Trip actions` TalkBack action stay exactly as they are, because
  `SwipeToDismissBox` exposes nothing to TalkBack; the menu is the accessible
  path and the discoverable fallback.
- **Arbitration.** Vertical scroll, tap to open departures, long-press and
  the horizontal swipe all coexist on the same row using framework gesture
  arbitration. The build proves this with a drive, not by inspection.

### Commit, window, undo

Committing a swipe runs the existing delete path immediately, with one
change: the cache purge is deferred to the end of the undo window. So the
list, the smart header, prediction and persisted state all behave exactly as
a menu delete does today, and undo is a restore.

1. **Commit.** The view model takes a snapshot of what it is about to
   remove: the trip, its index in `trips`, its history events in order, and
   whichever of focus, last answer and last trip id pointed at it. It then
   removes them as `deleteTrip` does now, persists, resets the board if the
   trip was selected, runs prediction, sync and refresh, sets the bar message
   and starts the window. The snapshot is `pendingDeletion`.
2. **Window.** 4 s (owner ruling, 2026-09-07), the same rule the feedback success bar
   uses, extended on Android by the accessibility recommended timeout. One
   timing rule for the bar instead of two. The timer lives in the view model
   (`viewModelScope` on Android, a `Task` on iOS), not in the view, so expiry
   runs whether or not the bar is on screen. The window length is a
   parameter with that default so tests can shorten it.
3. **Undo.** Tapping the bar restores the snapshot: the trip returns at its
   original index (clamped to the current count), the history events are
   re-appended in order, and focus, last answer and last trip id are restored
   only where they are still empty. Then persist, prediction, sync and
   refresh run, and the bar and `pendingDeletion` clear. On iOS the ten-trip
   cap applies after the restore with the normal eviction rule.
4. **Expiry.** The cache purge runs, `pendingDeletion` clears, and the bar
   clears if it still shows the deletion message.
5. **One at a time.** A second commit before expiry purges the first trip's
   cache immediately, drops its snapshot and starts a fresh window for the
   new trip. The bar text changes to the new trip.
6. **Kill during the window.** The trip is already deleted in persisted
   state, so nothing resurrects. Only the purge is skipped; the orphaned
   board files are bounded (Android's OS-evictable app cache, iOS's 64-file
   cap) and are overwritten if the same pair is saved again. Accepted.
7. **Navigation during the window.** The bar is global, so undo works from
   any screen. The existing `refresh` re-syncs whichever screen is showing.

### The bar

The undo bar is the existing bottom message bar (owner ruling, 2026-09-07) with its
action label swapped, not a new snackbar or toast. `AppState` gains
`undoAvailable: Boolean` (false by default). When it is true the bar's label
is the undo verb and tapping anywhere on the bar calls `undoDelete()`;
otherwise the bar behaves as today. Using the whole bar as the target keeps
the current 52-height tap area; a mistaken undo is harmless because the
trip can be swiped again. The bar keeps its current look; the only visual
difference is the label.

### Copy

Drafted by Codex on `gpt-5.6-sol`, 2026-09-07; the owner chose the
recommended pair the same day. The other candidates are kept so a later
reader knows what was rejected.

| Slot | Candidates | Ruling |
| --- | --- | --- |
| Bar text | `Trip deleted` · `Saved trip deleted` · `{from} → {to} deleted` | `{from} → {to} deleted` |
| Bar action | `Undo` · `Restore` | `Undo` |

`{from}` and `{to}` are the trip's short station names, the same strings the
row shows. The iOS swipe button and the Android revealed background both say
`Delete`, the plain verb, matching the existing menu's `Delete trip` without
the noun because the row itself is the noun. The bar text is truncated to
one line with the trailing station clipped if a name is too long at the
largest supported text size.

### Contracts and comps this item changes

- `docs/contracts/client-storage.md`: the Android and iOS storage paragraphs
  gain the undo window, deferred purge and one-pending rule.
- `docs/contracts/android-deviations.md`: the long-press bullet is rewritten.
  Its current justification, "preventing an accidental long-press from
  deleting data", becomes "swipe deletes; the deletion is reversible for the
  undo window; the long-press menu remains the TalkBack and fallback path".
- `docs/contracts/ios-deviations.md`: the context-menu bullet gains the swipe
  actions and the undo window.
- `assets/comps/latest/`: two new Android frames,
  `android-home-390x844-deleting.png` (row dragged past the threshold, red
  background and `Delete` visible) and `android-home-390x844-deleted.png`
  (row gone, bar showing the undo label); two matching iOS frames,
  `ios-home-390x844-deleting.png` (Delete button revealed) and
  `ios-home-390x844-deleted.png`. Existing home frames must not change.
- `tools/baselines/`: the new frames are accepted as baselines in the same
  change; every existing baseline must still pass.

## Decisions

| Date | Ruling | Status |
| --- | --- | --- |
| 2026-09-07 | Swipe to delete on both native apps, with undo and no confirmation dialog. | Owner ruling |
| 2026-09-07 | Platform-native gestures: iOS reveal + full swipe, Android dismiss + undo. Long-press and context menus stay. | Owner ruling |
| 2026-09-07 | Undo window 4 s, the feedback bar's rule, accessibility-extended on Android. | Owner ruling |
| 2026-09-07 | Undo bar reuses the existing bottom message bar with the label swapped. | Owner ruling |
| 2026-09-07 | Copy: `{from} → {to} deleted` / `Undo`. | Owner ruling |
| 2026-09-07 | Cache purge deferred to window expiry; everything else deletes immediately. | Owner ruling |

## Build decisions (orchestrator, 2026-09-07)

Made on the orchestrator's own authority during the build; each is subject
to the owner's phase 3 verdict on the frames.

- **Android background is full-bleed.** The horizontal page padding moved
  from the `LazyColumn` to each item, so the warning-coloured background
  reaches both screen edges like the iOS swipe button, while the `Delete`
  label and the row content keep the page inset. A row at rest is pixel
  identical; the visual-regression run is the proof.
- **A fast flick also commits.** `SwipeToDismissBox` has a fixed velocity
  threshold (Material's 125 dp/s) beside the positional one, so a short but
  quick flick dismisses, as in Gmail. The half-width positional threshold
  governs a slow drag. The instrumented test drags slowly to prove the
  positional rule.
- **Dismiss state is a plain `remember`.** `rememberSwipeToDismissBoxState`
  is saveable, and the lazy list keeps saved state by item key, so an undone
  row would return already dismissed and delete itself again. The state is
  constructed with `remember(trip.id)` instead.
- **Restore is a no-op if the same pair was saved again** during the window,
  so undo can never produce two rows for one station pair.
- **The comps use two trips.** Central → Parramatta stays and shows the
  header; Rhodes → Bondi Junction is the row deleted on both platforms, so
  the `deleted` frames keep a header and the bar reads
  `Rhodes → Bondi Junction deleted`. iOS seeds this as `--calibration
  home-two-trips` (at rest) and `home-deleted` (bar showing, no expiry timer,
  since a seeded frame is frozen).
- **The iOS `deleting` frame is a comp, not a baseline.** It is a gesture
  mid-flight that only the UI test can produce, exported from its xcresult;
  `tools/visual-regression.js` has no iOS column for it. The other three new
  frames are baselines.
- **The iOS UI test's vertical swipe checks arbitration, not scrolling:** two
  rows do not fill the screen, so the assertion is that a vertical swipe on
  the row reveals no `Delete` button and keeps the row. Android's eight-trip
  scroll test covers the scroll case.
- **Menu delete shares the path.** `Delete trip` in the Android long-press
  menu and the iOS context menu call the same `deleteTrip`, so both are
  undoable. iOS LRU eviction still purges immediately; it is not a deletion
  the user made.

## Rejected alternatives

- **Confirmation dialog.** Punishes every deliberate delete; both platforms
  treat undo as the safety net for recreatable data.
- **Hand-rolled drag gesture on the iOS `LazyVStack`.** Cheap on CPU but
  fights `ScrollView` arbitration, which is where hand-rolled swipe rows get
  janky, and loses the free VoiceOver actions and haptics `List` provides.
- **Reveal-and-stop button on Android.** Needs a custom `AnchoredDraggable`;
  Material's own pattern is dismiss then undo, and users know it from Gmail.
- **Deferring the whole deletion until the window ends.** The smart header
  would keep predicting a trip the user just deleted, and an app kill during
  the window would resurrect it.
- **Purging the cache immediately.** Undo would silently lose the trip's
  offline board.
- **A new snackbar or toast.** The bar already exists on both platforms with
  the right position, colour and timing rule.
- **Removing the long-press menu and context menu.** They are the TalkBack
  path on Android and the discoverable fallback on both.
- **Web swipe-to-delete.** Out of scope; the web keeps its LRU policy.
