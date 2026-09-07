# Superseded review/design record

Historical record only. Use ../design.md and ../build_plan.md for current authorization.

# Native code review: Android and iOS findings

**Start with [the approval groups](approval-groups.md) and
[the corrected audit](audit.md).** They supersede the original claims,
severity labels and proposed remedies below. The latest implementation authorization below supersedes the prior pending state.
The old comps are rejected and the old build phases are not executable.

## Implementation authorization, 2026-09-07

The owner now authorizes the explicit D1/D2/D3/D5/D8, C9 and feedback-draft repairs, and other obvious improvements that align the clients. Android geometry/spacing follows iOS; Now handling follows web on both. Retained rows must retain the standard numerical time rather than replacing it with Last known. The failed-request future-countdown distinction is under active clarification because the owner's always-numeric statement and existing web behavior differ. C10 has no established fix; retain current policy. Non-obvious changes need the owner's alignment and concrete images/descriptions (technical-only choices can use text).

The [current build plan](build_plan.md) is the execution authority. Prior “no group approved” text in historical evidence describes the previous review stage, not this new authorization. Existing rejected comps remain rejected. The user's instruction to do the repairs now supersedes the skill's usual fresh-thread handoff; builders receive fresh, bounded briefs.

Candidate review opened 2026-09-07 against the working tree of that day.
The original claim that every finding was verified end to end was not
established by this session and is withdrawn. The entries below are claims
to audit, not 63 approved fixes. D8 was added later. No code was changed by
the review.

Owner instruction, 2026-09-07: "Please verify and group them so that I can
review and approve each group for fixing. I need to understand what the
fixes are about, and the impact on users before i approve anything."
Current work is verification and an approval packet only. Every proposed
group needs an explicit owner verdict before implementation. Existing broad
web-parity rulings do not approve the new groups by implication.

Three files were being edited concurrently by the swipe-to-delete build
(`TrainViewModel.kt`, `UiHome.kt`, `UiApp.kt`, `TrainViewModel.swift`,
`HomeView.swift`). Findings cite symbol names first and line numbers second;
expect the numbers to drift. Nothing in the deletion or undo paths is reviewed
here.

## Owner rulings, 2026-09-07

After seeing `comps/review-sheet.png` the owner ruled:

1. **D1 / D2.** iOS is correct: each change names its station at the right
   place on the line and the second change's alighting pin stays hidden.
   Android aligns to iOS. The wider usability problem (several transfers
   cannot all name their station on one line) is a separate item,
   `docs/backlog/transfer-cap/`, opened the same day with the owner's
   starting position: cap the maximum transfers at 2 and add a setting so
   users can choose their own limit.
2. **C3.** Both platforms show the full departure label, `Wharf 4, Side A`,
   wherever that information is available as the departure platform.
3. **Everything else.** Check how the web does it and align both platforms
   to the web. Each finding below now carries a **Web:** line recording what
   the reference does; where the web has no rule (native-only surfaces such
   as the offline timetable line and `LAST KNOWN`), the line says so and
   gives the recommendation.

Design stage is **open**. The owner rejected the entire native-review-r1
round on 2026-09-07. Its recommendations are withdrawn and none of its images
is an approved exemplar. The build draft requires a web-parity audit and the
sequencing corrections below before execution.

## Owner rejection and corrections, 2026-09-07

Owner statements, verbatim:

- "I do not approve any of the changes in the design comp. you have given me."
- "As for the row spacing, again, look at web and follow that."
- "Your 'longer board' that adds in a 7th row sacrifices one of the most
  important things, which is the 'now' time."
- "I do not approve your recommendation of C for the longer board, nor the
  changes to the offline indicator."
- "The '2H' has H the same size as the 2. This is not at all the same as
  what's shown on web."
- "why do the 3rd and 4th screens only say 'scheduled'? This is not correct.
  again, refer web for how it's supposed to display."
- The owner also identified the next-platform `5` starting to the right of
  the blue ride segment, leaving blue exposed to its left.

Owner evidence: `comps/owner-rejection-web-hours.png` is the live web hours
example; `comps/owner-rejection-native-sheet.png` is the rejected comparison
sheet. The overhang is in the existing Android retained baseline copied to
the rejected workshop as `exemplars/native-android-retained.png`.

Consequences:

1. No A/B/C policy, dynamic-count footer, added coverage line, seven-row
   composition or changed offline indicator is approved. Preserve web row
   rhythm and Now landing/context. Do not infer a new request limit from this
   rejection; request depth, displayed rows and scroll landing are separate.
2. The large H was a workshop bug introduced by this session, not an approved
   native deviation. `web/js/dom.js:figureHtml` splits the `2H` data string
   into numeral and unit. `ui.md` explicitly requires a 12px H; native board
   renderers already use a separate 12sp/pt unit. Future parity work must
   trace formatting through the renderer and stylesheet, not copy the model
   string as typography.
3. The supplied overhang frame is the Android retained baseline. Android
   `JourneyAxis` draws the next ride at `nextStart` but places its boarding
   chip at `nextStart + 3.dp`; the uncovered strip is a real defect. Audit
   iOS independently on the same journey. Its station-label layout remains
   the earlier reference, but that never approves every pin geometry detail.
4. Compare identical source/freshness cases before deciding status parity.
   Web fresh scheduled future rows retain countdowns and `SCHEDULED`; stale
   or failed-request future rows omit countdowns. Past rows use elapsed time
   and `AGO`. Native currently blanks figures whenever `board.offline` or
   `journey.retained` is true, before considering past rows. The existing
   native retention exception preserves observations; it does not make the
   rejected screenshots an approved presentation of every state. Audit
   fresh scheduled, server-stale, failed-request, retained past and retained
   future separately against web and the owner's supplied screenshots.
5. The original item contains 63 findings across A–G. This round addressed
   only a narrow presentation subset and did not complete that review.
   Any next evidence sheet must distinguish shipped defects, proposed fixes
   and unchanged web reference, using the same data, time, viewport and
   source state. Use the actual web renderer; the custom workshop renderer
   did not establish parity. Automated overflow checks alone did not verify
   typography, source semantics, axis geometry or Now visibility.

## Design follow-up, 2026-09-07

Earlier owner instruction, verbatim: "i can't make a decision without images
or design comps". The four text questions were not approved. Present the
board depth/footer and offline coverage choices as measured, side-by-side
comps before asking again. Explain startup validation and routing scope with
visual comparisons of their consequences; do not invent app controls for
implementation choices.

The rejected visual round is `/tmp/trains-comps-native-review-r1/index.html`
(report: `OPTIONS.md` beside it). A caps future display at six and shows
coverage dates; B keeps ten online / 24 local with a neutral footer and
coverage; C keeps that depth with an accurate count and the shorter status.
Board depth/footer and coverage were presented as independent choices. All
three proposals and the recommended synthesis were rejected; none may be used
as an approved build input. The workshop used a custom renderer with web CSS,
native baseline references and declared fixture deltas, but drifted from the
actual web rendering and was inadequate as parity evidence.

- Phases 2–7 share view models, UI helpers, planners and storage files. They
  cannot run as independent worktrees. Regroup global copy/type changes first
  and serialize ownership of shared files before declaring the plan ready.
- Web `fetchPast` pages backward in one-hour steps with a 24-hour bound;
  forward services come from the normal refresh. There is no forward paging
  mechanism to port. C10/F7 must preserve that distinction.
- Changing the online request to six does not by itself fix the offline
  footer: the local request still returns up to 24 mixed past/future rows.
  The final page-size decision must define the displayed future slice and
  footer for online, scheduled offline and retained boards separately.
- Recheck B10 against the concurrent `location-row` work before building;
  that item owns the Settings permission row. `timetable-realtime` owns
  source service-date/freshness repairs, and `realtime-replacements` owns
  replacement stop patterns. A1–A6 must preserve their settled contracts.
- Contract mapping can precede code, but changed behavioral contracts must
  commit with their implementation, not in a standalone advance phase.

Evidence for the pending technical choices, rechecked 2026-09-07:

- Three read-only `PRAGMA quick_check` runs on a fresh extraction of the
  bundled 93,155,328-byte SQLite database took 273.8, 279.4 and 276.7 ms on
  this Mac; all returned `ok`. The OS cache was uncontrolled. These are
  database-scan timings, not app-launch timings or measured phone savings.
- The bundled station and served-route tables give Circular Quay only
  `train` and `ferry`. Both proposed transfer rules therefore give the same
  routes for this package. Their difference concerns a hypothetical third
  mode, not a current metro service at Circular Quay.

## What and why

The two native clients were ported from the web reference within days of
each other. They share the same contracts and the same offline planner
design, so every place they disagree is either an unrecorded deviation or a
bug on one side. This item collects the surviving defects, contract gaps,
performance costs and duplication so they can be fixed as one planned pass
instead of rediscovered one at a time. Fixing them changes several
calibration frames, so the visual-regression baselines are part of the
verify gates.

## Comps

`comps/review-sheet.png` shows the defects that have a screen: D1/D2, C3,
C4, D5, D4 and C10, each as an Android and iOS crop from the committed
baselines or from three extra iOS states captured on the baseline simulator
on 2026-09-07 (`comps/ios-*.png`, seeded with `--calibration` and no fixture
changes). C1 (metro wording) has no fixture with a metro journey; C5 and D6
need Android states the calibration test does not seed; everything in
sections A, B, E, F and G is logic with no frame to photograph.

## Original candidate findings — superseded by audit.md

The original labels below are retained for traceability, not as verified
conclusions. In particular, a `perf` label does not establish a measured user
impact, `both` can overstate platform scope, and a missing test is not a bug.
Use the per-ID audit verdict and group scope instead of these remedies.

### A. Routing and realtime correctness

- **A1 (bug, Android). A `skipped` stop cancels the whole through-connection.**
  `OfflineRealtime.overlay(List)` sets `cancelled = … || from.relationship == "skipped" || to.relationship == "skipped"`, and `OfflineRouter.routeSeed` drops every cancelled connection. An A→B→C service whose B stop is skipped loses the A→C leg entirely. iOS only sets `pickupType`/`dropOffType = 1` for the skipped stop and keeps the connection traversable, which is what `native-data.md` ("`skipped` prevents boarding or alighting"; iOS section: "remain traversable by an already-boarded passenger") requires. iOS proves it in `OfflineRealtimeTests` (A→C routes, A→B and B→C do not); Android has no such test. Fix Android to match iOS and add the test.
- **A2 (consistency, Android). Realtime snapshots have no ordering guard.** `OfflineRealtime.accept` overwrites `snapshots[source]` whenever `expiresAt > now`; the five source fetches run concurrently. iOS rejects a header older than the stored one and guards overlapping refreshes with `realtimeRefreshing` and `dataGeneration`. `native-data.md` states the rule in the iOS section, but it is a freshness guarantee, not a platform choice. Fix Android to reject older headers; move the sentence into the shared realtime section.
- **A3 (consistency, both). Snapshot expiry is taken from the payload.** Both clients store `expiresAt` verbatim and gate only on `expiresAt > now`. `native-data.md` defines expiry as header timestamp plus 90 s. The server is trusted, so this is low risk, but deriving `min(payload.expiresAt, headerTimestamp + 90_000)` costs one line and makes the contract true. iOS additionally has no bound on a far-future header, which would then block that source for the process lifetime. Android also accepts any `scheduleRelationship` string (`optString(…, "scheduled")`) where iOS rejects unknown values.
- **A4 (bug, Android). A timetable update that fails at `open()` strands the session.** `OfflinePlanner.update` closes the active database, activates the new manifest, then opens; if `open` throws, `database` stays null and every later `plan` fails until restart, with the new manifest already pointed at. iOS re-activates and reopens the previous validated generation before rethrowing (`OfflinePackageStoreTests` covers it). `native-data.md`: "A failed or interrupted update leaves the old generation active."
- **A5 (consistency, Android). Package validation is thinner than the contract.** Android checks `user_version`, `quick_check` and coverage; it skips the `application_id = 0x494c5452` check the contract names, and its `parseManifest` does not bound `bytes` (iOS caps at 300 MiB) or parse and order the service dates.
- **A6 (simplify, both). Three near-duplicate realtime overlays, one dead.** Each `OfflineRealtime` has list, single-connection and journey overlays repeating the stop match and cancellation logic with drifted details: only the list form carries the previous stop's delay forward and falls back between departure and arrival delay; the single-connection form has no production caller on either platform (tests only). Delete the single-connection form, re-point its tests at the list form, and factor the stop-match/cancellation block into one function.
- **A7 (consistency, both). Circular Quay's 10-minute floor applies to any cross-mode pair at stop `200020`.** `native-data.md` scopes it to rail↔ferry. No metro serves Circular Quay today, so this is contract wording versus code; align one or the other.
- **A8 (consistency, both). `readConnections` scans four service days (offsets −1…2).** `native-data.md` says "prior, current and following". The fourth day is needed when the 30-hour horizon crosses two midnights, so the contract text is what should change.

### B. Travel mode, focus and prediction

- **B1 (bug, Android). Inferred travel mode enters toward a destination with no coordinates.** In `inferredFocus`, `distanceMetres` returns `+∞` for a (0,0) station, and `∞ <= ∞ − 1000` is true in Kotlin, so condition 3 passes on distance alone; only the origin is checked with `isFinite()`. `client-storage.md`: "an endpoint with no coordinates, is no entry." iOS computes the origin→destination distance separately and requires both finite.
- **B2 (bug, iOS). The 200 m destination exit never fires for online journeys.** `receiveLocation` measures `distanceMetres(fix, focus.journey.legs.last.to)`. Leg stations come from the API, whose `LegPlace` carries no `location`, so `TransitWire.station` gives them lat/lon 0 and the distance is `+∞`. Only local-planner journeys (stations from SQLite) can complete this way. Android measures against the saved trip's destination (`ends(f.tripId, f.reverse).second`), which is what `client-storage.md` defines (`Z` is the destination of the saved trip's leg). Fix iOS to use the trip endpoint.
- **B3 (bug, Android). `Change destination` never re-enters travel mode.** `newTrip` prefills From from the inferred focus, but `saveTrip` neither clears `data.focus` nor matches the first leg's line and scheduled departure in the new pair's board, so Home keeps showing the old journey to the old destination. iOS implements the contract's redirect (`redirect`, `redirectTargetId`, `resolveRedirect`; focus by first-leg line + departure, board fallback otherwise). `ui.md` and `client-storage.md` ("Correction") make this binding.
- **B4 (bug, both). Cancellation replacements and the "Next …" rail ignore the service allow-list.** Both clients fetch the focused pair with all modes (correct: the followed journey must stay refreshable), but then choose the replacement and the next-service row from that all-mode board with no per-leg mode filter. `client-storage.md`: "An eligible cancellation replacement … still respects the current service allow-list." With ferries off, a cancelled train's replacement can be a ferry and the rail is tappable into its detail. **Web:** `home.js` takes `candidateReplacement` from the allow-listed candidate source first and falls back to the focus source only for the same pair.
- **B5 (consistency, both). `lastOpen` evidence differs between the clients and from the web.** Android records `lastAnswer` only from the online response and stores that raw response; iOS accepts a realtime-matched local plan as evidence and stores the merged board. Both clear `lastAnswer` on `openTrip` and `reverseTrip`. **Web:** `lastOpen` is written by the ordinary refresh from the shown answer and cleared only on release (`main.js` `delete released.lastOpen`) and trip deletion (`storage.js`); browsing another trip never clears it. Both clients align to that: record from any fresh answer, store the shown board and lead, clear only on release and deletion.
- **B6 (bug, Android). A home vote can be cast from the add-trip sheet.** `location()` accepts fixes on Setup and votes whenever trips exist. `client-storage.md`: the vote comes from "the first home open". iOS gates the vote on `screen == .home`. **Web:** votes only on the home open.
- **B7 (bug, iOS). A late fix overwrites a cleared origin in Setup.** `receiveLocation` sets `setupFrom = here` whenever the screen is Setup and From is empty, including after the user cleared it and on every resume while the sheet is open. Android guards with `setupOriginEdited` and first-run only (`android-deviations.md`: "A manually selected or cleared origin cannot be overwritten by a late fix"). **Web:** the fix fills From only through the `NEAREST STATION` group the user taps; it never writes the field.
- **B8 (consistency, both). Android strips alternatives to scheduled on every shared refresh; iOS keeps them as a separate planned board.** Android's `refreshSharedData` maps every non-focused row of `focus.board` through `scheduledOnly()`, erasing observed delays and cancellations the contract says retained rows keep. iOS keeps `alternatives` with their own provenance (`ios-deviations.md`). Align Android to iOS. **Web:** each row keeps its own source's realtime; nothing rewrites rows to scheduled.
- **B9 (bug, Android). A background local replan relabels a fresh server-stale board as offline.** `refreshSharedData` replans whenever `board.isLive(now) != true`, which includes a successful `X-Data-Stale: true` response, and `mergeBoardResults(prior, local, null)` then takes `previous.copy(offline = true)` as the base. `figureFor` treats `offline` as stale, so every countdown blanks and the freshness line says "Offline". **Web:** `X-Data-Stale` alone only removes the live dot; `Offline` appears once a request has failed. Only mark the base offline when the online request actually failed.
- **B10 (bug, iOS, low). Granting location from Settings loses the fix.** The system permission alert moves the scene to `.inactive`, `pause()` calls `location.stop()`, and the grant callback is dropped because `manager !== self.manager`. `resume()` only re-requests on Home and Setup, so nothing arrives until the user navigates. Harmless on Home and Setup (resume re-requests), a dead end from Settings.
- **B11 (simplify, iOS, low). `LocationService.request` calls `requestLocation()` twice when already authorised.** Once directly, then again from `locationManagerDidChangeAuthorization`, which iOS delivers on delegate assignment. `pending` stops the second fix from being used, but the second request is wasted work.

### C. Copy and status vocabulary

- **C1 (bug, iOS). "metro" leaks into copy the contract reserves for "train".** `modeName` returns "metro", producing `NEXT METRO` in the header, `Pin this metro`, and `… cancelled · next metro`. iOS also cannot print `Next service` for an unknown mode; Android's rail can. **Web:** `journey.js` `modeWords` returns only `train`/`ferry`; `home.js` yields `metro`/`service` only in the next-service rail. Both platforms use the web's two functions.
- **C2 (bug, Android). `placeClause` prints `Wharf Balmain Wharf` and `Wharf Side A`.** `platformText(full = true)` returns an unnumbered ferry label verbatim, then `placeClause` prefixes "Wharf " unless the string starts with it. iOS returns the value verbatim. **Web:** `boardingLabel` keeps the raw label when the place word appears anywhere in it or it starts with `Side`. Android ports `boardingLabel`.
- **C3 (bug, both). The initial ferry cap is compacted.** Both `JourneyAxis` implementations build the cap from `platformText(full = false)`, so `Wharf 2, Side A` renders as `Wharf 2A`; a side-only value collapses to bare `Wharf`. **Owner ruling 2:** both show the full departure label, `Wharf 4, Side A`, wherever it is available. **Web:** `boardingCapLabel` does exactly that, degrading to `Wharf` only when there is no number or side.
- **C4 (bug, both). Focused status prints `N MIN LATE` before departure.** Both headers use `"\(n) min late"` when focused and late. **Web:** `focus.js` `focusStatus` returns `Running late` (fresh data, positive delay on the active leg), `Running`, `Cancelled` or `Trip over`; `N MIN LATE` is only the provenance label under the figure. Both platforms port `focusStatus` and use it for the header line and the saved row.
- **C5 (bug, Android). The focused saved-trip row always reads "Running".** `SavedTripRow` prints `Running · Pinned` / `Running` / `Shown above`. iOS has `savedTripFocusStatus` with tests (`HomeStatusTests`). **Web:** `home.js` `selectedStatusHtml` prints the same `focusStatus` string as the header, plus the pin. Android aligns.
- **C6 (consistency, both). Freshness line and board error copy differ.** Android: "Offline · last updated 13m ago", `stale` is age-based; iOS: `stale = !scheduled && !live`, so a fresh server-stale board reads "Last updated …" on iOS and "Updated …" on Android. Board error copy: Android "No saved board for this trip yet", iOS "No timetable available for this trip". **Web:** `time.js` `ageLabel` prints `Offline · last updated 13 min ago`, `Updated 12s ago` under a minute, `Last updated 5 min ago` / `2 h ago` beyond, all rounded; the board's empty copy is `board.js` `emptyCopy`: `Turn on a service in Settings`, `No journeys with these services`, `Getting the next trains…`, `No board saved for this trip yet`, `No services on the last board we could load`, `No services in the next few hours`. Both platforms adopt those strings and the web's `stale` predicate. The offline-timetable line has no web equivalent. The owner rejected the proposed indicator/coverage changes on 2026-09-07; do not port a new composition from the rejected round.
- **C7 (bug, both, low). Transient bottom-bar text leaks into empty-state slots.** Board, Home (no compatible trips) and Detail fall back to `state.message` as body copy, so "Feedback sent. Thank you." can appear as the explanation for an unavailable board. **Web:** empty copy derives only from the board status (`emptyCopy`), never from a notice. Give those slots status-derived text and keep `message` bottom-bar only.
- **C8 (consistency, both, low). Next-service rail figure disagrees with the board.** Both rails truncate hours (`119 min → 1H`), blank the figure for a scheduled-but-fresh candidate, and Android's rail ignores `retained`. **Web:** the rail uses the shared `countdownFigure` (rounded hours) and blanks only when stale. Both reuse `figureFor` for the rail.
- **C9 (consistency, both). Two contract requirements neither client implements.** The once-only `Just added` row mark after an automatic pair save, and the `NEAREST STATION` group in setup once a fix exists. **Web:** implements both (`home.js` `subHtml` `justAdded`; setup nearest group). Both platforms implement both.
- **C10 (consistency, both, low). Board footer counts merged rows.** `— Six services shown` and `Nothing scheduled after HH:MM.` are decided on the merged board (local rows, retained past rows, online rows). **Web:** `board.js` `endMark` prints `Six services shown` when the page holds ≥ 6 rows and `Nothing scheduled after` at ≤ 3, and the web's page is `LIMIT = 6`. Native requests 10 online and 24 local, so a literal port prints "Six" over a ten-row page. See Decisions.
- **C11 (bug, both, low). Header distance truncates.** Both `distanceText` implementations use `(metres / 10) * 10`; Android's copy also uses the default locale. **Web:** `home.js` `formatDistance` rounds to 10 m with a 10 m floor, one decimal under 10 km, whole km beyond, and the header strips ` away`. Both platforms share one formatter with the web's rule.

### D. Layout and visual rules

- **D1 (bug, Android). Board rows collapse change names into one centred line.** `BoardRow` joins every change with " · " under the axis; the large axis positions the name column with a fixed `offset(x = maxWidth * at − 48.dp).width(96.dp)` that can start off-screen and does no collision handling. **Owner ruling 1:** iOS is correct (`JourneyAxisLayout`: each name under its dwell midpoint, clamped, wrapped, stacked on collision, with tests). Android ports that geometry. The layout of many names is `docs/backlog/transfer-cap/`.
- **D2 (bug, Android). The second change's alighting pin is drawn on two-change results.** `JourneyAxis` draws `leg.toPlatform` for every change; iOS draws it only for the first. **Web:** `app.css` `.sy-row.two .sy-bar .sy-p.a[data-transfer-index="1"] { display: none }`. Android aligns (ruling 1).
- **D3 (bug, Android). Tight-change warning painted on cancelled rows.** `JourneyAxis` colours the dwell by wait alone; iOS adds `!journey.cancelled`. **Web:** `rowmodel.js` `tight: change.tight && !cancelled`. Android aligns.
- **D4 (consistency, iOS, low). `LAST KNOWN` wraps to two lines.** `BoardRow` gives the provenance label two lines and a 24 pt minimum only for `Last known`; Android keeps one line at 7 sp. The captured `board-delayed-retained` frame shows the two-line label but no visible row reflow at default text size. **Web:** no `LAST KNOWN` (native exception); the provenance slot is one reserved line. iOS keeps one line and shrinks like Android.
- **D5 (consistency, both, low). `Now` figure size.** Board: Android 27 sp for `NOW`, 40 sp for `10H`; iOS 40 pt for both. Home: Android 36 sp for `NOW`, 50 sp above three characters; iOS 64 pt for `NOW`, 50 pt above three. **Web:** `rowmodel.js` marks any figure of three or more characters `wide`; `app.css` sizes wide board figures at 27.9 px and wide home figures at 50 px. Both platforms use the three-character rule with 28 (board) and 50 (home), while keeping `min` and `H` as separate small units. The data string `2H` must pass through the equivalent of web `figureHtml`; it is not one large text run. The native BoardRow implementations already use separate 12sp/pt units; the rejected workshop introduced the large H.
- **D6 (bug, Android). Feedback field has no focus treatment and the draft dies with the screen.** `Label("Message")` is always `ink3` and the heavy rule is unconditional. The draft lives in `rememberSaveable` inside `SettingsScreen`, which leaves the composition when the screen changes, so leaving Settings discards it. **Web:** `settings.js` keeps one module-level `feedbackDraft` for the page lifetime and shows focus with the strong rule and primary-ink label; iOS matches (`feedbackDraft` on the model, `focused` treatment). Android aligns.
- **D7 (simplify, both). Unreachable figure branches.** `figureFor` only yields `""`, `—`, `Now`, one to three digits, or hours; the `length >= 5 → 28 sp`, `length > 3 → 50 sp` and `cancelled && contains(':')` branches never fire on Android, and the `count >= 5` branch never fires on iOS. Replaced by the D5 rule.

- **D8 (bug, Android; iOS comparison required). Boarding pin starts after its ride segment.** In `UiCommon.kt` `JourneyAxis`, the next ride begins at `nextStart`, but its boarding chip begins at `nextStart + 3.dp` without a ground-colour mask covering the exposed strip. The owner’s retained screenshot shows blue to the left of the `5`. Web anchors the boarding marker at the ride start and supplies the separator through the marker’s styling. Fix the visible-edge relationship without shifting timetable geometry; measure the same transfer on iOS before accepting its pin layout as a reference. This finding was added after the original 63-item review.

### E. Performance

- **E1 (perf, both). `PRAGMA quick_check` over the 93 MB database on every cold start.** `initialize()` re-validates the already active generation each launch, then re-activates it (rewriting `manifest-<sha>.json` and `active-manifest.json` although nothing changed), then loads all 132,836 trips and 854 stops into maps. Measured on this machine: 0.27 s warm, 0.52 s cold for `quick_check` alone; a phone is slower. `native-data.md` requires the check on install and update, not on every start. Record a "verified" marker per generation and skip `quick_check` when it is present.
- **E2 (perf, both). Personal state is rewritten every 30 s.** The refresh path assigns `trip.lines` from the lead journey and calls `persist()` unconditionally when a lead exists, so `personal-v1.json` is written on every cycle even when nothing changed. iOS also copies the previous file to `personal-v1.backup.json` on every save, so that is two file writes per cycle. Persist only when `data` changed.
- **E3 (perf, iOS). Every board cache write decodes the whole cache directory three times.** `DeviceStore.cache` calls `trimCache`, which calls `cacheEntries()` three times, each reading and JSON-decoding every file (up to 64 boards × 24 journeys), on every refresh. Trim on file attributes and decode nothing.
- **E4 (perf, iOS). `ScheduledConnection.tripKey` is a computed property in the router's innermost loop.** Every connection on every seed scan interpolates a three-part string (up to 72 seeds × tens of thousands of connections); Android stores it as a `val`. Store it, or intern an integer trip index.
- **E5 (perf, both). The realtime overlay copies, groups and re-sorts the whole window on every plan.** `connections(hours)` filters (copy), `overlay` copies and builds a `groupBy` over every trip in the window, then the result is sorted with a three-key comparator, although only trips present in a snapshot change. Overlay in place for those trips and re-sort only when an estimate moved a departure. The 6-hour weekday window holds about 32,000 connections and the 30-hour window about 68,000 (measured on the bundled package).
- **E6 (perf, both). Router costs that scale with candidates squared.** `filterConditionalLongWaits` runs inside the seed loop and walks every candidate's full path against every other candidate; `longWaitEnds` rebuilds the path array each call; the stop condition reads `candidates.take(limit)` rather than the `eligible` list computed one line earlier, so filtered-out candidates keep the loop running. A seed that cannot reach the destination scans to the end of the window because the early exit needs `best != null`, and an unroutable pair then repeats everything at 30 hours. Memoise long-wait ends per label, use `eligible`, and bound failed seeds.
- **E7 (perf, iOS). `sydneyCalendar` is a computed global that builds a `Calendar` per access.** Used by `clockTime` (every row, every second) and inside `historyScore`'s per-event loop (`Prediction.swift`). Make it a `let`. Trip sorting on both platforms also recomputes `historyScore` inside the comparator; precompute one score per trip.
- **E8 (perf, iOS). `ISO8601DateFormatter` allocated per timestamp.** `TransitWire.epoch` and `FlexibleMillis` build formatters for every parsed timestamp; a realtime snapshot holds thousands. Two static formatters.
- **E9 (perf, iOS). `OfflineZip` holds the whole 93 MB database in memory.** `Data(count: uncompressedSize)` plus the mapped archive during an update; Android streams. Decompress with `compression_stream` to a file handle.
- **E10 (perf, iOS, low). Repeated work in views.** `SetupView.matches` and `HomePickerContent.results` are computed properties read three times per body pass (three fuzzy scans per keystroke); `JourneyAxisLayout` recomputes geometry in both `sizeThatFits` and `placeSubviews` with the `cache` parameter unused; `Journey.key` (also `id`) rebuilds its string per list diff; `DeviceStore.lossyArray` and `stations()` round-trip every element through `JSONValue` with a fresh encoder and decoder each.
- **E11 (perf, Android, design). Whole `AppState` flows into every row composable.** `now` changes every second, so nothing that takes `state` can be skipped and the whole Home and Board trees recompose at 1 Hz. Pass the narrow values each row reads.
- **E12 (perf, iOS, low). `refreshSharedData` triggers a second full `refresh()` when the board is not live.** With a server-stale or offline board that is a second departures request per 30 s cycle. Android replans locally in that branch without a network call.

### F. Duplication, dead code and design

- **F1 (simplify, both). `reverseTrip()` is dead on both platforms and contradicts `ui.md`** ("no reverse control anywhere in the client"). It also mutates persisted state. Remove it from `UiActions` and both view models.
- **F2 (simplify, both). Unused members.** `AppState.shownBoard` and `AppState.selectedTrip` (both platforms), iOS `DeviceStore.removeCache` (alias of `purgeCache`), Android `JSONObject.longOrNull`, Android `readLimited` implemented twice (`TransitApi`, `OfflinePlanner`), `ACCESS_NETWORK_STATE` declared but never read, `localhost` exemptions in `requireSecure` unreachable under `usesCleartextTraffic="false"`.
- **F3 (simplify, Android). Two fuzzy scorers and two query thresholds.** `fuzzyScore` (setup) and `settingsFuzzyScore` (home picker) are the same algorithm and constants; iOS shares one. Both platforms use a 2-letter minimum in the home picker and 3 in setup. **Web:** one `MIN_QUERY = 3` in `search.js`, imported by both the setup sheet and the Settings home picker. One scorer on Android; three letters everywhere on both.
- **F4 (simplify, iOS). Two ten-trip LRU rules.** `addTrip` evicts by `lastViewed == 0 ? createdAt : lastViewed`; `UserData.normalized()` (run on every load and save) keeps the top ten by `max(lastViewed, latestHistory, createdAt)`. **Web:** `storage.js` `addTrip` evicts by the latest history event time, else `createdAt`. One owner of the policy on iOS, using the web's rule.
- **F5 (simplify, both). Feedback success string duplicated as a literal** in the view model and the app shell on each platform; renaming one silently disables the four-second auto-dismiss.
- **F6 (design, both). Saved-trip line colours guess mode from the first letter.** `SavedTrip.lines` stores names only, so rows re-derive mode with `startsWith("F")` (six sites on Android) and an empty list becomes the invented `"T"` (T7 grey). iOS also sorts the codes alphabetically, so a T9→F1 journey shows `F1 … T9` on iOS and `T9 … F1` on Android. **Web:** `home.js` `tripRowHtml` paints `lines[0]` and `lines[last]` in travel order with each line's own colour key. Store `(code, mode)` pairs in travel order on both.
- **F7 (design, both). `earlier()` is local-only, and unguarded on iOS.** Both page backwards through the planner alone, so a pair the planner cannot route shows no earlier services even when online. iOS keeps no task handle, its refresh control dismisses immediately, and it maps past rows through `scheduledOnly()`, erasing observed delays and cancellations by position. **Web:** `main.js` pages through the API with `at = earliest − PAST_STEP_MS`, `limit: LIMIT`, a 24-hour bound, generation and key guards, and keeps each page's realtime. Both platforms page through the API the same way and use the local planner only when the request fails.
- **F8 (design, iOS, low). Persisted `Journey` is not validated on decode.** Synthesised `Codable` accepts `legs: []` and non-finite times from a damaged file; `SmartHeader.first` is `journey.legs[0]` and `BoardRow` does `Int(journey.departure)`, both of which trap. The wire decoder validates; the storage decoder should too. Android's `Wire.journey` already requires non-empty legs.
- **F9 (consistency, Android, low). Board cache is unbounded.** iOS trims to 10 pairs × 8 mode sets and 64 files; Android writes `boards/<from>-<to>-<modes>.json` with no trim and relies on the OS cache directory. **Web:** at most eight mode sets per directed saved pair, deleted with the trip. Android trims like iOS.
- **F10 (consistency, iOS). Setup hides mode-incompatible stations and `saveTrip` silently refuses such pairs.** `SetupView` filters matches and recents by enabled modes and `saveTrip` guards both ends. **Web:** `search.js` applies no mode filter and `storage.js` `addTrip` saves any pair; incompatible trips are hidden from Home, never blocked. iOS reverts to the web behaviour (Android already matches).

### G. Tests

- **G1 (test, Android). Web conformance is weaker than iOS.** `WebConformanceTest` ignores `expected.noLocation` (all eight prediction fixtures carry it, and one case differs meaningfully); `RowConformanceTest` skips `depTime`/`arrTime`, the only check that Sydney clock rendering matches the web. iOS asserts both.
- **G2 (test, Android). No view-model tests.** `TrainViewModel` has no JVM test; iOS `ControllerTests` covers alternative sources, mode hide/restore, LRU and the fix-newer-than-tick case that Android fixed with an explanatory comment. Android also has no test for the platform/wharf grammar (`platformText`, `placeClause`, the cap), which produced C2 and C3, and none for inference with an uncoordinated endpoint (B1).
- **G3 (test, iOS). `OfflineZip` parses network bytes with no direct tests.** No test references it; only the valid bundled package exercises it. None of the rejection paths (EOCD bounds, multi-entry, stored or encrypted entries, wrong name, oversized entry, mismatched headers) has a case.
- **G4 (test, both). Regression tests for every bug above** are part of the fix, on the platform that had the bug, mirroring the other platform's test where one exists (A1, B2, C5, D1).

## Earlier proposed decisions — superseded by approval-groups.md

1. **Board parity (C10).** Owner rejected every r1 proposal, including C, and ruled to follow web row spacing and preserve Now context. Audit the actual web rendering, footer, initial landing and scroll preservation against the same native states. No A/B/C footer or page-size change is approved. Request depth and displayed slice remain separate implementation seams to settle from that audit, not from the rejected seven-row composition.
2. **`quick_check` per launch (E1).** Recommend: a per-generation "verified" marker, with the full check only on install, update, or a prior open failure. Alternative: keep the check and accept the cold-start cost as a safety margin.
3. **Contract wording (A7, A8).** Recommend: change `native-data.md` to match the code (rail↔ferry floor applies to any cross-mode pair at Circular Quay; four service days scanned).
4. **Offline presentation (C6).** Owner rejected the indicator changes and directed comparison with web. The proposed coverage composition is withdrawn. Audit matched fresh-scheduled, server-stale, failed-request and retained states, including numeral/provenance behavior; do not treat a baseline screenshot as approval of its defects.

## Earlier dropped claims — historical, not new audit conclusions

- "30-hour horizon risks out-of-memory": the bundled package holds about 68,000 connections per service day, so the 30-hour window is at most a few hundred thousand small objects. Not a defect.
- "iOS `LocationService` creates a manager per request": creating `CLLocationManager` per request is cheap and correct; only the double `requestLocation` (B11) survives.
- "Android `SetupScreen` `requestFocus()` can throw on an unattached requester": every reachable state has an active field when the effect runs.
- "`unresolvedUntil` uses the wrong list" as a correctness bug: it only prolongs the scan (folded into E6).
- "iOS `pinJourney` and `unpinJourney` guards differ from Android": the Android UI never offers those actions in the guarded states.
- "`LAST KNOWN` reflows iOS rows" and "`Now` clips on iOS": the captured frames show neither; both survive only as size and wrap divergences (D4, D5).
