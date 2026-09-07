# Native review C/D verification

Read-only audit on 2026-09-07. No application source, baselines, or contracts were changed. The rejected custom-rendered round at `/tmp/trains-comps-native-review-r1` was excluded from evidence.

## Evidence rules

- **Confirmed** means the complete material claim is proven by reachable source and its callers. A screenshot is listed only where an existing real client capture shows the state.
- **Corrected narrower** means part of the original claim is true but its scope, platform, or user impact was overstated.
- **Explicit decision** means the owner has already chosen the desired behavior, while implementation still remains subject to group approval.
- Existing screenshots are compared across clients only where they use the same calibration fixture, clock, and screen/scroll state. Otherwise they are shown as a single-client observation with the limitation stated.
- A source difference is not automatically a defect. Native retained/offline presentation remains governed by the native retention contracts.

## Verdict index

| ID | Verdict | Approval group | Pre-fix visual gate? |
|---|---|---|---|
| C1 | Confirmed, iOS | Group 8 | No; no metro fixture |
| C2 | Confirmed, Android | Group 8 | No; deterministic formatter bug |
| C3 | Explicit decision, both | Group 6 | Width/stress capture during implementation |
| C4 | Confirmed, both | Group 7 | No; iOS real frame exists, pairing unavailable |
| C5 | Confirmed, Android | Group 7 | No; source and iOS/web tests establish the model |
| C6 | Corrected narrower, mixed | Group 11 | **Yes: state matrix before choosing scope** |
| C7 | Confirmed, both | Group 8 | No; reachable message fallback |
| C8 | Confirmed, both | Group 7 | No; pure formatter behavior |
| C9 | Confirmed, both, with native exception | Group 4 | Setup capture during implementation |
| C10 | Open policy, both | Group 11 | **Yes: decide displayed slice and footer first** |
| C11 | Confirmed, both; locale subclaim narrowed | Group 8 | No; pure formatter behavior |
| D1 | Confirmed, Android; explicit decision | Group 6 | Existing matched native pair |
| D2 | Confirmed, Android; explicit decision | Group 6 | Existing matched native pair |
| D3 | Confirmed, Android | Group 6 | Source proof sufficient; screenshot treatment is subtle |
| D4 | Corrected narrower, iOS | Group 11 | **Yes: matched retained state if change is desired** |
| D5 | Confirmed width-rule mismatch, both; rejected large-H claim removed | Group 7 | Matched `Now` pair; 10H/elapsed source-only |
| D6 | Confirmed, Android | Group 9 | Capture focus/navigation behavior during implementation |
| D7 | Corrected narrower cleanup | Group 12 | No separate approval or visual gate |
| D8 | Corrected to Android-only | Group 6 | Existing Android retained frame plus source proof |

## Per-finding verification

### C1 — Confirmed, iOS

**Source proof.** `ios/ILoveTrains/UI/HomeView.swift:384` maps Metro to `metro` and every unknown mode to `train`. That helper is used by the following-service rail (`:209`), header (`:241`), and cancelled replacement copy (`:252`), and by the detail action at `ios/ILoveTrains/UI/DetailView.swift:52`. Web deliberately separates generic journey words (`web/js/journey.js:106-109`, train/ferry only) from the explicit next-service label (`web/js/home.js:27-33`, train/metro/ferry/service). Android already has the generic train/ferry wording plus an unknown `service` branch in its rail.

**What users see.** An iOS Metro journey can say `Next metro` and `Pin this metro`; an unknown rail mode is labelled as a train.

**Minimal change.** Split the iOS generic journey noun from the following-service noun and route each caller to the matching helper.

**Impact/tradeoff.** Copy becomes consistent and unknown data stays honest. No layout or data behavior changes. No existing Metro calibration frame, so this is source-verified without visual evidence.

### C2 — Confirmed, Android

**Source proof.** `platformText(..., full = true)` returns an unnumbered ferry value verbatim (`android/app/src/main/java/com/ilovetrains/app/UiCommon.kt:123-133`). `placeClause` then adds `Wharf ` unless that value starts with Wharf (`UiHome.kt:392-395`). `Balmain Wharf` therefore becomes `Wharf Balmain Wharf`, and `Side A` becomes `Wharf Side A`. iOS inserts the full helper result unchanged (`ios/ILoveTrains/UI/HomeView.swift:405-407`). Web preserves raw values containing the place word or beginning with Side (`web/js/journey.js:112-118`).

**What users see.** During a ferry change, Android can give a duplicated or misleading wharf instruction.

**Minimal change.** Port the web boarding-label normalization into the Android full-label path and remove the second prefixing step.

**Impact/tradeoff.** Clearer active directions; no persistence or routing change. No matched native ferry instruction frame exists.

### C3 — Explicit owner decision, both

**Source proof.** Both axes call their compact platform helper for the first cap: Android `UiCommon.kt:176-179`, iOS `Common.swift:189-193`. A raw `Wharf 2, Side A` becomes `2A`, then is rebuilt as `Wharf 2A`; side-only text degrades to `Wharf`. Web's cap helper preserves the full label whenever a number or side is present (`web/js/journey.js:121-125`). The owner ruled that both native clients show the full label, for example `Wharf 4, Side A`.

**What users see.** Ferry departure caps can omit the word `Side` or the whole side value.

**Minimal change.** Give the departure cap a full-label helper; keep transfer pin chips compact.

**Impact/tradeoff.** Better boarding guidance. A longer cap reduces remaining axis width, so 390/412 widths, long side labels, and enlarged Android text need capture during implementation. Existing ferry images do not share a fixture/clock and are not parity evidence.

### C4 — Confirmed, both

**Source proof.** Before departure, both focused headers use numeric `N min late` (`android/.../UiHome.kt:126-133`; `ios/.../HomeView.swift:230-237`). Web `focusStatus` uses `Running late` for any fresh positive active-leg delay (`web/js/focus.js:176-184`), leaving the number to the figure provenance.

**What users see.** A pinned late trip says the delay twice in two UI roles and changes from `N min late` to `Running late` after departure.

**Minimal change.** Use one focus-status presenter for the header and saved row; leave `N MIN LATE` beneath the figure.

**Impact/tradeoff.** Status remains stable across departure and is easier to scan. The existing iOS pinned-delayed frame shows the current wording, but there is no matched Android/web capture.

### C5 — Confirmed, Android

**Source proof.** Android hard-codes `Running · Pinned` / `Running` in `UiHome.kt:322-324`, regardless of late, cancelled, or complete state. iOS already derives the row status in `HomeView.swift:341-349`, covered by `ios/ILoveTrainsTests/HomeStatusTests.swift:9-18`. Web renders the same focus-status object in header and row (`web/js/home.js:333-337,381-389`).

**What users see.** The Android saved-trip row can say `Running` while the header says late, cancelled, or over.

**Minimal change.** Port the pure saved-row focus-status function and reuse it.

**Impact/tradeoff.** Removes contradictory state copy; no data-model change.

### C6 — Corrected narrower, mixed

**Source proof.** Android freshness treats offline or age over 90 seconds as stale (`UiCommon.kt:56-72`); iOS uses `!scheduled && !isLive` (`Common.swift:50-72`). Consequently a recent `serverStale` live response can read `Updated ...` on Android and `Last updated ...` on iOS. Web permits recent degraded data to keep counting down while removing the confident live dot (`web/js/rowmodel.js:24-75`; `docs/contracts/ui.md:388-390`). Web age wording also rounds and spells out `min`/`h` (`web/js/time.js:42-50`), whereas both native clients abbreviate. The broad error-copy claim was overstated: both board screens already share their primary visible empty strings (`android/.../UiBoard.kt:66-74`; `ios/.../BoardView.swift:36-42`). A narrower synthesized fallback differs in the view models (`android/.../TrainViewModel.kt:194`; `ios/.../TrainViewModel.swift:185`).

**What users see.** The same recent degraded response can carry different freshness wording/dot meaning. A particular no-cache fallback can differ. Native scheduled and retained boards also intentionally say things the web cannot say.

**Minimal change.** First specify a state matrix for fresh live, recent server-stale, aged, failed request, schedule-only, and retained. Then align only shared states and the one synthesized error. Preserve native timetable coverage and `LAST KNOWN` behavior.

**Impact/tradeoff.** Improves trust in whether times are current. A careless web port would erase explicit native retention semantics. This group is capture/spec gated before fix scope is approvable.

### C7 — Confirmed, both

**Source proof.** Transient `state.message` is rendered as body fallback in Android Home (`UiHome.kt:64`), Board (`UiBoard.kt:37`), and Detail (`UiDetail.kt:25`), and iOS Home (`HomeView.swift:57`), Board (`BoardView.swift:13`), and Detail (`DetailView.swift:62`). Both apps also render the message in their bottom bars (`android/.../UiApp.kt:43`; `ios/.../AppView.swift:46`). Web empty copy is derived from board status only (`web/js/board.js:56-62`).

**What users see.** A notice such as `Feedback sent. Thank you.` can briefly masquerade as the explanation for an unavailable page after navigation.

**Minimal change.** Remove message fallbacks from page bodies; use screen/status-specific empty copy and keep notices in the bottom bar.

**Impact/tradeoff.** Prevents unrelated, confusing error explanations. No visual redesign.

### C8 — Confirmed, both

**Source proof.** Android and iOS following-service rails perform their own integer hour conversion and require a realtime candidate (`android/.../UiHome.kt:223-235`; `ios/.../HomeView.swift:260-270`). Thus 119 minutes becomes `1H` rather than rounded `2H`, and a fresh schedule-only candidate has no figure. Android also lacks iOS's retained guard. The shared native `figureFor` functions already round hours and separate the unit (`android/.../UiCommon.kt:140-151`; `ios/.../Common.swift:156-169`). Web `countdownFigure` rounds at 100 minutes and the rail blanks only when stale (`web/js/time.js:35-38`; `web/js/home.js:20-33`).

**What users see.** The rail can understate a far-away service and can omit a useful scheduled countdown. Android can present a retained countdown more confidently than intended.

**Minimal change.** Reuse the shared countdown rule in the rail with explicit provenance/retained gating.

**Impact/tradeoff.** More accurate and consistent time scanning; no API change.

### C9 — Confirmed, both, with native exception

**Source proof.** Neither native `AppState` contains a once-per-open receipt field (`android/.../Models.kt:52-67`; `ios/.../AppState.swift:13-50`), and neither saved-row renderer emits `Just added`. Web records the load boundary and renders the receipt once (`web/js/home.js:94-99,190-203,381-387`), covered at `web/test/home.test.js:657`. Native setup only offers `Use my location` before permission is granted (`android/.../UiSetup.kt:63-71`; `ios/.../SetupView.swift:42-45`); there is no nearest-station result after a fix. Android's automatic first-launch fill is an explicit deviation (`docs/contracts/android-deviations.md:6`), while the iOS location handler currently fills more broadly (`ios/.../TrainViewModel.swift:306-310`).

**What users see.** An automatically saved pair gets no confirmation; after location is known, setup lacks a one-tap nearest origin choice.

**Minimal change.** Add a per-open receipt marker and a nearest result for add-trip/held-fix flows. Keep Android's first-launch auto-fill ruling. Audit the broader iOS auto-fill separately from this visual change.

**Impact/tradeoff.** Users understand why a trip appeared and can choose a nearby origin quickly. Location remains on-device. Setup captures should prove the first-run and add-trip paths separately.

### C10 — Open policy, both

**Source proof.** Both footers inspect the entire merged `board.journeys` array (`android/.../UiBoard.kt:44-81`; `ios/.../BoardView.swift:20-49`). Native online requests ask for 10 rows (`android/.../TransitApi.kt:12`; `ios/.../TransitAPI.swift:9-11`), and local planning can ask for 24 (`android/.../TrainViewModel.kt:173`; `ios/.../TrainViewModel.swift:172`). Web has `LIMIT = 6` (`web/js/main.js:35`) and its footer says six at six or more rows (`web/js/board.js:48-53`). Current native calibration boards hold six rows, so existing screenshots cannot reproduce the 10/24 ambiguity.

**What users see.** On longer merged boards, native may say `End of board` where the web describes a six-row displayed slice, and its `Nothing scheduled` rule is tied to merge results rather than a defined page.

**Minimal change.** None is safe until request depth, displayed slice, retained rows, Now anchoring, and footer semantics are specified independently. The owner rejected the longer-board composition from the prior round.

**Impact/tradeoff.** Affects scan length, scroll position, Now context, and whether the footer tells the truth. This is a product-policy group, not an approved consistency fix.

### C11 — Confirmed, both; locale subclaim narrowed

**Source proof.** Android and iOS floor metres to the previous 10 (`android/.../UiHome.kt:375`; `ios/.../HomeView.swift:385-388`), so 19 m becomes 10 m and 1–9 m becomes 0 m. Web rounds with a 10 m floor (`web/js/home.js:260-264`). Android's `String.format` is locale-sensitive, but Swift's `String(format:)` call is also not explicitly pinned to a locale; the original Android-only locale claim is not established.

**What users see.** Short distances can be understated or displayed as zero.

**Minimal change.** Share the web thresholds and rounding rule on both clients; explicitly choose locale behavior if decimal punctuation is meant to match.

**Impact/tradeoff.** Honest nearby distance with minimal visual impact.

### D1 — Confirmed, Android; explicit owner decision

**Source proof.** Android's board row joins all change names into one centred string (`android/.../UiBoard.kt:171-175`), while its large axis gives each name a fixed 96 dp box without clamping or collision handling (`UiCommon.kt:213-221`). iOS computes each dwell midpoint, clamps labels, and stacks collisions (`ios/.../JourneyAxisLayout.swift:81-95`), covered by `ios/ILoveTrainsTests/JourneyAxisLayoutTests.swift:30-58`. The owner ruled iOS correct.

**Runtime evidence.** `tools/baselines/android/detail-two-change.png` and `tools/baselines/ios/detail-two-change.png` are real native captures of the same three-leg calibration journey and clock. Android shows `TOWN HALL · CENTRAL` as one label; iOS associates each name with its transfer.

**What users see.** On Android, a multi-change journey does not clearly say which station belongs to which transfer and can place a label outside its useful bounds.

**Minimal change.** Port the iOS geometry and collision tests to Android.

**Impact/tradeoff.** More reliable change guidance; colliding names may require additional row height.

### D2 — Confirmed, Android; explicit owner decision

**Source proof.** Android draws the alighting pin for every change (`UiCommon.kt:193-205`). iOS suppresses later alighting pins on a three-leg journey (`Common.swift:207-215`). Web does the same for the second transfer (`web/app.css:380`). The owner ruled iOS correct.

**Runtime evidence.** The same matched `detail-two-change` captures show Android's extra second alighting pin (`12`) and its absence on iOS.

**What users see.** Android adds a redundant marker at the second change, crowding the axis and implying an extra action.

**Minimal change.** Suppress alighting markers after the first on two-change results.

**Impact/tradeoff.** Less clutter and clearer sequence; no timetable change.

### D3 — Confirmed, Android

**Source proof.** Android colours a tight dwell from wait time alone (`UiCommon.kt:193-200`). iOS explicitly excludes cancelled journeys (`Common.swift:202-204`), as does web (`web/js/rowmodel.js:198-215`).

**Runtime evidence.** Existing Android/iOS `detail-cancelled.png` frames share the cancelled transfer fixture and clock, but the small dwell treatment is too subtle to use as sole proof; classification rests on source.

**What users see.** A cancelled Android journey can still warn that its impossible change is tight.

**Minimal change.** Add the cancellation condition to the Android dwell colour.

**Impact/tradeoff.** Removes a conflicting warning; no geometry or routing change.

### D4 — Corrected narrower, iOS

**Source proof.** iOS gives `Last known` two lines and a 24 pt minimum (`ios/.../BoardView.swift:103-105`); Android gives the same provenance one 7 sp line (`android/.../UiBoard.kt:150-152`). `LAST KNOWN` is a native retention exception (`docs/contracts/ui.md:381-390`; native deviation contracts), so web offers no direct reference.

**Runtime evidence.** `docs/backlog/native-review/comps/ios-board-delayed-retained.png` is a real iOS capture and shows the two-line label. It does **not** show visible row reflow at default text size. The available Android retained capture uses a different route/delay/clock/scroll, so it is not a parity comparison.

**What users see.** iOS uses a taller two-line provenance slot in this state; the claimed broken row height was not reproduced.

**Minimal change.** If the owner prefers one line, reserve one provenance line and fit/shrink it. Otherwise keep the native divergence.

**Impact/tradeoff.** One line is more compact but uses smaller type. A matched retained capture is required before approving this as a defect rather than a presentation choice.

### D5 — Confirmed width-rule mismatch, both; rejected large-H claim removed

**Source proof.** Android Board specially reduces `Now` to 27 sp while iOS Board leaves it at 40 pt (`android/.../UiBoard.kt:138-152`; `ios/.../BoardView.swift:99-105`). Android Home uses 36 sp for `Now`; iOS Home leaves it at 64 pt (`android/.../UiHome.kt:157-169`; `ios/.../HomeView.swift:164-174`). Web tests the **figure token**: `2H` remains ordinary, while `10H`, `Now`, and three-digit elapsed numerals are wide (`web/test/rowmodel.test.js:281-306`; `web/js/rowmodel.js:158-160`). Native `Figure` stores `value` and `unit` separately, so current length checks do not see the `H`: `10H` is `value = "10", unit = "H"`. They also fail to reduce reachable three- and four-digit elapsed rows. The ordinary `min` label is not part of this width token: a one-digit minute remains narrow. Both native renderers already draw units in a separate small 12 sp/pt text element. The rejected custom renderer's large `H` was not an app defect.

**Runtime evidence.** `tools/baselines/android/board-now.png` and `docs/backlog/native-review/comps/ios-board-now.png` are real native captures of the same Central board and `Now · 22:48` clock. Android visibly reduces `Now`; iOS does not. Neither shows 10H or a large H, so those subcases remain source-only.

**What users see.** `Now`, `10H`, and three-digit elapsed values use inconsistent fit rules. The H itself remains small in native; only the numeral run needs the width decision.

**Minimal change.** Determine width from `value + "H"` only for hour figures, otherwise from `value`, and apply the web's three-character threshold to the numeral font, with about 28 for Board and 50 for Home. Retain the separate small unit run; do not count `min`.

**Impact/tradeoff.** Consistent scanning and safer fit. No change to time values.

### D6 — Confirmed, Android

**Source proof.** Android feedback category/message are `rememberSaveable` inside `SettingsScreen` (`android/.../UiSettings.kt:35-40`). Navigating away removes that screen from composition, so the state is discarded. Its Message label and rule do not depend on focus (`UiSettings.kt:288-292`). iOS stores the draft on `TrainViewModel` (`ios/.../TrainViewModel.swift:7`) and binds it in Settings (`SettingsView.swift:52-60`); its label and rule respond to `@FocusState` (`SettingsView.swift:249-270`).

**What users see.** An Android user who leaves Settings loses typed feedback; keyboard focus has no visible field treatment.

**Minimal change.** Move the Android draft/category to the view model and make label/rule styling depend on focus.

**Impact/tradeoff.** Protects user input and clarifies the active field. No persistence beyond the app session is needed.

### D7 — Corrected narrower cleanup

**Source proof.** The 24-hour past-board window can produce four-digit elapsed numerals: Android asks for earlier rows down to 24 hours (`android/.../TrainViewModel.kt:411-420`), while iOS explicitly filters at 24 hours (`ios/.../TrainViewModel.swift:482-491`; `docs/contracts/native-data.md:208-209`). Therefore the Home `length > 3`/`count > 3` branches are not proven unreachable, and four-digit Board figures are reachable. Only Board `length/count >= 5` remains unreachable under the current 24-hour bound, and Android's cancelled-colon branch is unreachable because cancellation figure is always a dash (`UiCommon.kt:144`).

**What users see.** Nothing independently. The present thresholds still fail D5's reachable three/four-character cases, but not every old branch is dead.

**Minimal change.** Replace the Board five-character and cancelled-colon checks as part of D5. Retain or rewrite Home's four-character handling under the hour-aware token rule.

**Impact/tradeoff.** Maintenance cleanup only; it should not be a separate approval item.

### D8 — Corrected to Android-only

**Source proof.** Android paints the next ride at `nextStart` (`android/.../UiCommon.kt:185-192`) but offsets the boarding chip to `nextStart + 3.dp` with no ground mask (`:206-211`). iOS anchors the board frame at the next departure (`ios/.../JourneyAxisLayout.swift:42-47`) and puts the 3 pt spacing inside a ground-backed marker (`ios/.../Common.swift:233-237`), so the strip is covered. The original “iOS comparison required” is resolved: source geometry does not share the Android defect.

**Runtime evidence.** The owner's real Android retained board capture at `tools/baselines/android/board-offline-retained.png` visibly shows blue to the left of the `5`. There is no matched iOS retained frame; iOS is cleared by source rather than an unmatched screenshot.

**What users see.** Android makes the next line colour appear to begin before its boarding marker.

**Minimal change.** Start the chip's ground background at the ride boundary and keep its text padding internal; do not shift any timetable coordinate.

**Impact/tradeoff.** Removes a false visual extension with no schedule or axis-geometry change.

## Approval scopes

The authoritative groups and current holds are in [approval-groups.md](../approval-groups.md). Earlier visual-only grouping is superseded.

## Existing test coverage reviewed

- Web: `focus.test.js` covers focus/tight/cancelled behavior; `home.test.js` covers following service and `Just added`; row-model tests cover stale and figure rules.
- iOS: `HomeStatusTests.swift` covers saved-row focus states; `JourneyAxisLayoutTests.swift` covers axis clamping/collision; `RowConformanceTests.swift:32-36` covers compact/full platform parsing.
- Android: board-retention and row-conformance tests exist, but no equivalent platform/copy/status tests were found for C2/C3/C5, and no geometry test equivalent to iOS's D1 coverage.

The visual catalog at [comps/audit/index.html](../comps/audit/index.html) intentionally contains only existing real renderer captures. It does not contain proposed replacement UI.
