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

## Findings

(filled in at the end)

## Proposed fixture cases

(see end)
