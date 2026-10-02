# commute-reliability adversarial review (branch `cr-review`, base `636eacb`)

Running log. Each probe: file, invariant, expected (per design/contract), observed, status.
Product code is untouched; probes live in each client's test tree under `review-*`.

## Probes

| Probe | Invariant | Expected (design/contract) | Observed | Status |
| --- | --- | --- | --- | --- |
| `web/test/review-inference.test.js` "a platform sighting after departure retires the departed train from the snapshot too" (pure focus.js) | Rule 3 / ruling 2, lead suspect 1 | after a same-origin sighting 60 s past D replaces the stored record, a moving fix enters the stored (next) train | enters the departed train from the snapshot (`T9 08:00` instead of `08:08`) | FAIL (defect confirmed) |
| `web/test/review-snapshot-stack-probe.mjs` (real stack: stub + server + headless Chrome + main.js) | same | same, with a quick app switch before the sighting | `{"first":"23:03","snapshot":"23:03","stored":"23:12","entered":"23:03","by":"inferred"}` | FAIL (defect confirmed, real stack) |
| `web/test/review-inference.test.js` 0.24 / 0.249 / 0.26 progress-window probes | Rule 5 step 4, fixture gap 2 | 0.24 and 0.249 match, 0.26 misses | as expected | pass (boundary now pinned; fixture proposal below) |
| `web/test/review-inference.test.js` "the decline hour alone holds entry…" | Rule 6 decline, fixture gap 1 | held at at+59 min with arrival+30 passed; resumes at at+60 | as expected | pass (fixture proposal below) |
| `android/app/src/test/.../ReviewInferenceTest.kt` `aPlatformSightingAfterDepartureRetiresTheDepartedTrainFromTheSnapshotToo` (pure Inference.kt) | Rule 3 / ruling 2 | enters the stored next train | `expected T9:…6080000 but was T9:…5600000` (departed train) | FAIL (defect confirmed) |
| `ReviewInferenceTest.kt` window and decline probes | as web | as web | as expected | pass |
| `ios/ILoveTrainsTests/ReviewInferenceTests.swift` `testAPlatformSightingAfterDepartureRetiresTheDepartedTrainFromTheSnapshotToo` (pure Inference.swift) | Rule 3 / ruling 2 | enters the stored next train | `("T9:1790805600000") is not equal to ("T9:1790806080000")` (departed train) | FAIL (defect confirmed) |
| `ReviewInferenceTests.swift` window and decline probes | as web | as web | as expected | pass |
| `ios/ILoveTrainsTests/ReviewCommuteReliabilityControllerTests.swift` `testAPlatformSightingAfterDepartureRetiresTheDepartedTrainFromTheSnapshotToo` (real TrainViewModel, offline, bundled timetable, injected clock) | Rule 3 / ruling 2 | after a quick app switch and a platform fix 70 s past D (which did record the next train, `T1 …181000`), the moving fix enters that next train | entered the departed `T1 …001000` from the snapshot | FAIL (defect confirmed, real stack) |
| `ReviewCommuteReliabilityControllerTests.swift` `testAFixArrivingOffHomeDoesNotEnterTripMode` (real TrainViewModel) | Inferred entry "is evaluated when a valid fix arrives on home"; "an older request resolving after navigation cannot alter the current screen" | a fix received on the Board screen does not enter trip mode (web `useFix` and Android `location()` return before inferring) | iOS `receiveLocation` infers on any screen: entered `T2:…|T1:…` while on `.board` | FAIL (iOS-only defect) |
| `android/app/src/androidTest/.../ReviewCommuteReliabilityTest.kt` `aPreferenceChangeWithinTheVisitDoesNotExtendTheEvidenceWait` (real TrainViewModel, emulator `ilt-cr-android`) | Rule 1 evidence wait: once per focus and visit, not extended by restarts | overdue armed focus: Checking at +44 s, Arrived at +46 s despite `setMode` at +31 s | `expected:<Arrived> but was:<CheckingArrival>`: `resetArrivalTracking()` clears `evidenceWaitFor` and restarts the 45 s | FAIL (Android-only defect, low) |

| `ReviewCommuteReliabilityTest.kt` `aPlatformSightingAfterDepartureRetiresTheDepartedTrainFromTheSnapshotToo` (real TrainViewModel, offline, bundled timetable, emulator) | Rule 3 / ruling 2 | after a quick app switch and a platform fix 70 s past D, the record stops naming the departed train and the moving fix enters the next one | offline Home keeps the retained answer, so the sighting re-recorded the **departed** train with `at = D + 70 s` (`T9:1788731658000 at 70000 ms past its departure`), and the moving fix entered it | FAIL (defect confirmed, real stack; see finding 2) |

Probe invocations (all through `/private/tmp/ilt-cr-gate.sh` where Gradle/xcodebuild):
`cd web && node --test test/review-inference.test.js`; `node web/test/review-snapshot-stack-probe.mjs` (exit 1 = defect);
`tools/build-android.sh --unit ReviewInferenceTest`; `cd android && ANDROID_SERIAL=emulator-5590 ../tools/check-log.sh android-review-instrumented ./gradlew :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.ilovetrains.app.ReviewCommuteReliabilityTest --console=plain`;
`ruby tools/generate-ios-project.rb && ILOVETRAINS_SIMULATOR_ID=B0D35236-B994-4A9B-AD23-7878CFF7BEC0 tools/build-ios.sh --unit ReviewInferenceTests ReviewCommuteReliabilityControllerTests`.

## Findings

### 1. The open snapshot enters the train the rider was seen not to board (all three clients) — medium

Owner-visible: standing on the platform, you check the app before the 08:00; you pocket it, let the 08:00 go (full), take it out again a minute later (the header moves to the 08:08), board the 08:08 and keep Home open. Trip mode starts on the 08:00, one service off, with its directions and arrival time.

- Invariant: rule 3 / ruling 2 ("seen at the platform again … means you didn't board it"); lead suspect 1.
- Clients: web, Android, iOS. Probes: web pure + real stack (`review-inference.test.js`, `review-snapshot-stack-probe.mjs`), Android pure (`ReviewInferenceTest`), iOS pure + real controller (`ReviewInferenceTests`, `ReviewCommuteReliabilityControllerTests`). All fail now; the stack probes run through the real controllers.
- Precondition (narrower than the lead's wording): the snapshot is taken at a Home open, a return to visibility/foreground or back-to-Home, *before* the sighting replaces the stored record. A single uninterrupted visit does not reproduce it (the record written during the visit is never the snapshot).
- Hypothesis: `inferFromRecords` evaluates `[snapshot, stored]` and the snapshot is never retired. The same-origin sighting ≥ 60 s after `D` should also clear the in-memory snapshot (`state.previousOpen`, `openSnapshot`) when it replaces the stored record, or the snapshot should be skipped when the stored record was replaced by a later sighting at the same origin.
- Contract note: client-storage.md "Inference attaches to the journey that was SHOWN … a known and accepted gap" predates ruling 2 and now contradicts it for this case. Owner ruling requested only if the fix wave wants to keep the snapshot path untouched.

### 2. Offline, no client can learn that the rider stayed on the platform; native re-records the departed train and enters it — medium, owner's offline rides

Owner-visible (Android, offline): same as finding 1 but it needs no snapshot: 70 s after the 08:00 left, the platform fix re-records the **08:00** (offline Home keeps the retained answer through arrival + 30 min), with `at = D + 70 s`; platform entry has no lower bound on `D − at`, so boarding the 08:08 enters the 08:00.

- Invariant: rule 3 (hold rule) and ruling 2 versus native-data.md "Offline Home preserves that answer, even after departure, until its last-known arrival plus 30 minutes. This does not pin the train, infer boarding or record a ride."
- Clients: Android confirmed through the real view model (`ReviewCommuteReliabilityTest`). iOS's controller probe moved its lead on offline and recorded the next train, so iOS differs from Android here (cross-client difference in offline lead retention, see below). Web offline cannot write at all (no successful refresh), so the departed sighted record stays held and enters on the next train.
- Hypothesis: `shownLeadEvidence` on Android takes `nextHomeJourney` → `retainedHomeJourney` (the departed retained answer) and the refresh's own timetable plan still contains that departed service, so the evidence is the departed train. Native-data's "does not infer boarding" is violated indirectly: the retained answer becomes `lastAnswer`, and `lastAnswer` is what infers.
- Needs an owner ruling: should a sighting at the origin ≥ 60 s after the shown train's `D` (a) clear the record outright when no later train can be recorded (offline), and (b) must a record whose `at > D` ever be enterable (the 2c/3b "parity" removal of `0 ≤ D − at` opened this path on native; the web never writes such a record because its recommendation requires `D ≥ now`)?

### 3. iOS infers trip mode from a fix that lands off Home — low (iOS only)

Owner-visible: browsing a board or Settings on the train, a location fix (Settings "Use my location", or a Home fix resolving after navigation) silently starts trip mode; back on Home the trip is already running.

- Invariant: client-storage.md Travel mode: inferred entry "is evaluated when a valid fix arrives on home … an older request resolving after navigation cannot alter the current screen". Web `useFix` and Android `location()` return before inferring; iOS `receiveLocation` guards only the on-board search with `state.screen == .home`.
- Probe: `ReviewCommuteReliabilityControllerTests.testAFixArrivingOffHomeDoesNotEnterTripMode` (real controller) fails now.
- Hypothesis: `TrainViewModel.receiveLocation` runs `inferFromRecords` for every screen except setup.

### 4. Android restarts the evidence wait on a preference change within the visit — low (Android only)

Owner-visible: on an overdue trip reading `Checking arrival`, toggling a service or the transfer cap in Settings (or deleting another trip) holds `Checking arrival` for another 45 s.

- Invariant: rule 1 evidence wait "starts once per focus identity per foreground visit … a restart within the visit does not extend it". Web keys the wait by identity+visit and iOS by identity+visit; Android's `resetArrivalTracking()` clears `evidenceWaitFor` and `arrivalResumeWaitUntil`, then `ensureArrivalMonitoring()` begins a new 45 s wait. Callers: `setMode`, `setTransferLimit`, `readFlags` (cap change), `deleteTrip`, `showReturn`, `stopTrip`, `enterInferred`, `startTrip` (not restarted).
- Probe: `ReviewCommuteReliabilityTest.aPreferenceChangeWithinTheVisitDoesNotExtendTheEvidenceWait` (real view model, emulator) fails now.

### Cross-client differences and contract contradictions for an owner ruling

- **Offline Home lead after departure**: Android keeps the retained answer (the departed train) as Home's lead and as `lastAnswer` evidence until arrival + 30 min (native-data.md); iOS's controller moved on to the next planned service in the same offline scenario; web's offline cache recommendation requires `D ≥ now`. Design rule 3 and ruling 2 assume the lead moves on so a platform sighting can record the next train. Quote both: native-data.md "Offline Home preserves that answer, even after departure … does not pin the train, infer boarding or record a ride" vs design.md rule 3 "A sighting at the origin a minute after the train left shows that the rider stayed on the platform".
- **Record with `at > D`**: design rule 3 "Platform-sighted entry's 'seen at the platform' condition is `D − at ≤ 15 min` with no lower bound" vs the hold rule's inferable condition `0 ≤ D − at` (a record seen after its own departure "is not held"). Finding 2 shows native writes such records offline and enters from them; the web never writes one. Ruling needed on whether the lower bound belongs in entry too (the pre-2c native behaviour).
- **"Clears a matching `lastOpen`"** (design rule 6, Stop trip) vs client-storage.md "clears … the persisted `lastOpen` evidence and the open snapshot": every client clears any record unconditionally (`forgetLastOpen`/`forgetLastAnswer`). Wording only; code agrees across clients.
- **Expiry clears `lastOpen`**: web `applyArrivalResult` clears only when trip, direction and journey key match; Android and iOS clear any record for the trip and direction. Contract says "Clear matching `lastOpen`". Low; no probe.
- **`inferenceDeclined` encoding** (web departureKey JSON vs native `line:scheduledMillis`): documented in client-storage.md for Android and iOS; the conformance tests translate the fixture's web key. No defect.
- **DST (2026-10-04 02:00 → 03:00)**: the clients compare epoch milliseconds everywhere a rule names `D` or `A`; the web's `departureKey` is the API's ISO string (the offset flips from `+10:00` to `+11:00` on the day; a journey's key is whatever one response says, so a decline written before the flip matches a later response only if the server keeps the same offset for the same instant). Not probed; raise if the server's offset handling at the changeover is unknown.

### Refuted suspects

- Web rule 7 on Home: `ctx.go('#/')` re-runs `route()` when the hash is unchanged, so a 10-minute return on Home does re-open (snapshot, silent fix, timers). Read, not probed.
- Android rule 7 ordering: `onNewIntent` (and `onCreate`) always precede `onResume`, and `openTrackedJourney` clears `backgroundedAt`; a cold process has no `backgroundedAt`. Existing `aTrackerTapBeforeTheResumeAfterTenMinutesStillOpensTheTrackedJourney` covers the only possible order.
- iOS rule 7 either order: `routedReturn` and the async tracker route; existing `testATrackerTapStillLandsOnItsJourneyAfterTenMinutesInEitherOrder`.
- Hold-rule writers: web `noteLastOpen`→`writeLastOpen` is the only writer; Android `refresh()`→`withLastAnswer` only; iOS `refresh()`→`replacesLastAnswer` only. Widget, tracker background refresh, realtime overlay, offline plans and preference changes do not write. Explicit clears present on all three for start, stop, return offer, deletion and expiry.
- Two-hour `Arrival unconfirmed`: every reducer settles at `A + 3 min` unless `moving`; `permissionPending` inputs are cleared on background/foreground transitions on both natives; `focusRefreshPending` (iOS) is cleared in the refresh task's defer. The remaining non-terminal path is `moving` (vehicle speed away from the destination), accepted by ruling 1. Not reproducible by reading.
- Lock-screen Stop: both natives honour only the current tracker identity (`tracker.accepts(revision) && trackerIdentity`, `tracker.focusIdentity(session:)`) and queue a stop that arrives before data has loaded; existing tests cover the iOS wrong-session case.
- Rule 5 `Δ` median, ruling 23, ruling 24, `AppFlowTests`, the iOS offline tick refresh: already scheduled; not re-reported.

### Fixture gaps (lead suspect 2) — confirmed

- Decline: every held case has both bounds ahead (`now − at` = 5 min, `now − arrival` = −9/−4 min); "a long ride holds it until its arrival plus 30 min" is held by the arrival bound alone; no case is held by the hour alone.
- Progress window: the nearest miss is 0.358 (`rt|forward T9 07:52`, `f_t` 0.667 vs `f_p` 0.309); the nearest match is 0.235 (the 08:08 in "closest progress wins"). Any window in (0.235, 0.358) passes.

### Probes that failed on their own fixture

- `review-inference.test.js` "exactly 0.25": the computed departure lost sub-millisecond precision in the ISO round trip, so the gap landed just above 0.25. Replaced by 0.249 with whole-second times (the window is inclusive; 0.249 and 0.24 match, 0.26 misses).
- `ReviewCommuteReliabilityTest` first version waited for a next-train record offline; Android never writes one offline (finding 2). Rewritten to record what the sighting wrote and still drive the boarding.
- iOS controller probe: two compile errors (`await` inside XCTest autoclosures), fixed before any run.

## Proposed fixture cases (`tools/fixtures/conformance/inference.json`, web owns the file)

Shapes follow the existing `entryCases`; `rt` is Rhodes → Town Hall with the fixture's coordinates; `nowMs` 1790806200000 is 2026-10-01T08:10:00+10:00; the fix is the fixture's `{lat: -33.87181, lon: 151.094427, accuracy: 10, speed: 14, heading: 90}` (position progress 0.309 for `rt`).

```json
{"name": "decline: the hour alone holds entry once the declined arrival plus 30 min has passed",
 "doc": {"…": "as 'decline: holds on-board entry for the declined trip', with",
   "inferenceDeclined": {"tripId": "rt", "direction": "forward", "at": "2026-10-01T07:11:00+10:00",
     "departure": "[\"T9\",\"2026-10-01T06:52:00+10:00\"]", "arrival": "2026-10-01T07:30:00+10:00"}},
 "snapshot": null, "writes": [], "nowMs": 1790806200000,
 "fix": {"lat": -33.87181, "lon": 151.094427, "at": 1790806200000, "accuracy": 10, "speed": 14, "heading": 90},
 "previousFix": null, "cached": {},
 "boards": {"rt|forward": ["the 07:52, 08:00 and 08:08 T9 journeys of 'decline: entry resumes an hour after the decline'"]},
 "expected": null}
```
A sibling with `"at": "2026-10-01T07:10:00+10:00"` (exactly 60 min) expects `{"via": "onBoard", "tripId": "rt", "direction": "forward", "journeyKey": [["T9", "2026-10-01T08:00:00+10:00"]]}` (already covered by "entry resumes an hour after the decline"; keep it as the pair).

```json
{"name": "on board: a service 0.24 off the position progress still matches",
 "doc": {"…": "trips [rt] only, no history, no rides"}, "snapshot": null, "writes": [], "nowMs": 1790806200000,
 "fix": {"lat": -33.87181, "lon": 151.094427, "at": 1790806200000, "accuracy": 10, "speed": 14, "heading": 90},
 "previousFix": null, "cached": {},
 "boards": {"rt|forward": [{"T9 Rhodes → Town Hall, scheduled = estimated": "departure 2026-10-01T07:53:32+10:00, arrival 2026-10-01T08:23:32+10:00"}]},
 "expected": {"via": "onBoard", "tripId": "rt", "direction": "forward", "journeyKey": [["T9", "2026-10-01T07:53:32+10:00"]]}}
{"name": "on board: a service 0.26 off the position progress is not a match",
 "boards": {"rt|forward": [{"T9": "departure 2026-10-01T07:52:56+10:00, arrival 2026-10-01T08:22:56+10:00"}]},
 "expected": null}
```
(`f_t` = (08:10 − D) / 30 min: 0.549 and 0.569 against `f_p` 0.309. The web probe derives the same numbers from `distanceKm`; regenerate through `tools/export-android-conformance.mjs` so all three clients compute `f_p` identically.)

```json
{"name": "snapshot: a same-origin sighting 60 s after departure retires the departed train from the snapshot too",
 "doc": {"…": "as 'regression: the stored record alone enters' (lastOpen = the 08:00 sighted at Rhodes at 07:58)"},
 "snapshot": {"…": "the same 08:00 record"},
 "writes": [{"nowMs": 1790805670000, "sightingAt": 1790805670000,
   "record": {"station": {"id": "213820", "name": "Rhodes Station"}, "tripId": "rt", "direction": "forward",
     "journey": {"T9": "departure 2026-10-01T08:08:00+10:00, arrival 2026-10-01T08:35:00+10:00"}}}],
 "nowMs": 1790806320000,
 "fix": {"lat": -33.87181, "lon": 151.094427, "at": 1790806320000, "accuracy": 10, "speed": 14},
 "expected": {"via": "platform", "tripId": "rt", "direction": "forward", "journeyKey": [["T9", "2026-10-01T08:08:00+10:00"]]}}
```
Today every client answers the 08:00 for this case (finding 1).
