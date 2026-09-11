# tcr-review report — transfer-completion-recovery, review wave (final)

Worktree /private/tmp/trains-tcr-review, branch tcr-review, base fe10039. Probe commits:
c33e469 (web), ef8cad9 (Android), 7c5a466 (iOS), 7d3bd7d (web real stack). Builders' own suites pass on
all three clients today (web 484/487 with only my probes failing; Android conformance/lifecycle/state/storage/
prediction/presentation green; iOS conformance/controller/state/storage/home 52/52). Review simulator deleted.

Probe files: web/test/tcr-review-probes.test.js (node), web/test/tcr-review-stack.sh + tcr-review-stack-probe.mjs
(real stack: stub + server + headless Chromium), android/app/src/test/.../TcrReviewProbeTest.kt (JVM),
ios/ILoveTrainsTests/TcrReviewProbeTests.swift (XCTest, registered in project.pbxproj).

## Findings

### F1 — the recovery record is re-picked, not re-matched (inv 2, 8) — DEFECT, Android and iOS
Contract (client-storage.md Recovery): the record's journey "is re-matched on every refresh by the ordered
(line.name, departure.scheduled) pairs … exactly like focus.journey"; ui.md: a composed change "that is itself tight
keeps the tight-change paint and instruction, and the recovery receipt stands".
- Android `TrainViewModel.settleRecovery` always takes `recoveryCandidate(board.journeys…)` (earliest qualifying).
  Probes (FAIL): `aHeldCandidateIsKeptWhenAnEarlierTrainBecomesEligible` (told 10:08, re-told a 10:04 whose estimate
  moved to 10:05), `aHeldCandidateWhoseWindowShrinksToTightIsKeptNotSwapped` (10:08 → est 10:02, w=2, swapped to 10:15).
  Also `fetchedAt = now` makes the record differ every refresh, so `persist()`, `settleFocus()` and `syncPersonal()`
  run on every refresh while recovering.
- iOS `recoveryRecord` re-matches by key but only keeps the held train if it still clears the floor; otherwise it
  takes the earliest qualifying. Probe `testAHeldCandidateWhoseWindowShrinksToTightIsKeptNotSwapped` FAIL (10:15);
  `testAHeldCandidateIsKeptWhenAnEarlierTrainBecomesEligible` PASS.
- Web keeps the held train (both web probes PASS).

### F2 — a moved-anchor record alternates between two tails on successive refreshes (inv 2, 8) — DEFECT, Android and iOS
After fixture case `candidate-change-lost` the record is {0, [T1 10:05, T4 10:19]}. The next refresh composes a
connecting journey, the anchor falls back to `changeIndex 0`, the search is Town Hall @10:00 again, and both native
clients replace the record with [T1 10:05, T4 10:11] (own change lost) → the refresh after searches Central → 10:19 →
and so on. Probes (FAIL): Android `aMovedAnchorRecordIsStableAcrossTheRefreshesThatFollowIt`
("refresh 2 re-told … T4 10:11"), iOS `testAMovedAnchorRecordIsStableAcrossTheRefreshesThatFollowIt` (refreshes 2 and
4 show T4 10:11, 3 shows 10:19). Web PASS (held record stands), but see F6b.

### F3 — the iOS recovery request carries no transfer cap (inv 4) — DEFECT, iOS
Real view-model probe `testTheRecoveryRequestCarriesTheTransferCap` (FAIL) with `transferLimit: .direct`:
`GET /api/v1/departures?from=200070&to=202210&limit=10&modes=ferry,metro,train&at=…` — no `transferLimit`, all
modes; `recoveryCandidate` applies modes client-side but no cap, so a direct-only rider can be offered a candidate
with changes. Android passes `data.maxTransfers`; web passes `transferLimit()` and filters with `journeyAllowed`.
Contract: "under the followed journey's mode allow-list and transfer cap".

### F4 — the web fetches the recovery pair once per anchor and never again (inv 1, 4) — DEFECT, web
`main.js refreshRecovery`: `if (state.recovery?.key === key …) return;`. Real-stack probe
(`web/test/tcr-review-stack.sh`): three refresh cycles → followed pair requested 3×, recovery pair 1×, `state.recovery`
held with 6 journeys and never refetched. The candidate's estimates are frozen at first fetch; the "recovery train
itself late" verification case cannot be shown live on web. Native refetches each refresh.

### F5 — the web accepts an out-of-range `changeIndex` (inv 2) — DEFECT (low), web
`storage.normalizeRecovery` checks only `>= 0`; `composedJourney` then appends the recovery legs after all followed
legs. Probe `probe inv2: a changeIndex past the last change …` FAIL (3 legs composed). Android (`recoveryApplies`)
and iOS (`recoveryPlan` held filter) ignore such a record (probes PASS).

### F6 — candidate's own change lost, nothing found from the later change (inv 8) — RULING needed
No fixture case. Web: instruction `The T1 arrives too late for the 10:11`, receipt `Check the station boards.`,
arrival `Planned`. Android and iOS: instruction `Get off at Town Hall · Platform 3`, receipt `The T9 arrives at
10:00, but the T4 left at 09:58.`, arrival struck 10:08 / shown 10:24 — an arrival the rider cannot make, unlabelled.
Probes assert the web reading: web PASS, Android `theCandidatesOwnChangeLostWithNothingFromTheLaterChangeReadsAsLost`
FAIL, iOS `testTheCandidatesOwnChangeLostWithNothingFromTheLaterChangeReadsAsLost` FAIL. Whichever the owner picks,
a fixture case should carry it.
F6b (observation, web): a moved-anchor record holds legs from two searches, so `matchJourney` can never re-match it
and its estimates never refresh (`probe inv2 (observation): a moved-anchor record is still re-matched …` FAIL).

### F7 — iOS shows `Printed change was n min.` before departure (inv 1, 8) — DEFECT, iOS
`HomeView.focusReceipt` has no `departed` guard. ui.md: the tight words and receipt appear "only once the journey is
under way". Probe `testTheShrunkChangeReceiptIsNotShownBeforeDeparture` FAIL ("Printed change was 7 min."). Android
gates on `departed`; web only in the riding branch.

### F8 — the Android tight-change cue fires in `Boarding` (inv 5, 8) — DEFECT (minor), Android
`trackerCues` accepts `Ride || Boarding`; iOS `.ride` only; ui.md "while the rider is riding toward it". Probe
`aChangeBecomingTightBeforeDepartureDoesNotCue` FAIL ("[TightChange]"); iOS `testAChangeBecomingTightBeforeDepartureDoesNotCue` PASS.

### F9 — the ride recorded at the end of a recovered journey (inv 3, 8) — RULING needed
Web `settleRide` and Android `List<Ride>.settled` record the followed journey's arrival (probes PASS); iOS
`settledRides` records the composed arrival (`testTheRideRecordedAtTheEndOfARecoveredJourneyIsTheFollowedJourneys`
FAIL: 10:18 vs 10:08). The contract is silent; rides feed prediction, so the owner should say which arrival a ride keeps.

### F10 — a record boarding at a station other than the change station is composed (inv 2) — observation, all three
Probes `… does not board at the change station …` FAIL identically on web, Android and iOS. The contract does not say
the splice must be checked; the three agree, so this is a hardening note, not a regression.

### F11 — `settleRecovery` re-runs `settleFocus()` with `matchingRefresh=false` (inv 3) — observation, Android
Arrival.kt:141 `legacy && (!matchingRefresh || now >= arrival)`: with a ride already recorded for this departure and
no guard, the recovery settle judges the focus Arrived right after the matching refresh said Travelling. Reachable only
via legacy data; no probe.

### F12 — Android header figure now reads `focus.board` instead of the home board (inv 1) — observation, Android
`UiHome.SmartHeader`: `directionFigure = header?.figure ?: …` applies pre-departure too, and `focusHeader` computes
`figureFor(composed, focus.board, now)` where the old path used the displayed home board. `figureFor` reads the board's
`offline`/`generatedAt`/`source` for the figure's provenance, so a focus board and home board of different freshness
would print different figures pre-departure. The reshot Android home baselines differ from base by 1 px (`home-now`)
and 84 scattered px (`home-light`), so nothing visible moved in the captured states; worth one glance at a pinned
pre-departure frame with a stale home board.

## Probes that passed (regression guards now on tcr-review)
- inv 1 (web): header HTML byte-identical to the 36d9ad7 modules on 16 non-lost scenarios (pre-departure inferred/pinned,
  riding, tight, shrunk, leg-0 3 min late, leg-1 late, dwell, last leg, later leg cancelled, stale, offline, trip over,
  three legs riding/dwelling); the only difference is the documented arrival-only-delay exception. Journey detail steps
  and summary identical on all 16. Recovery seam inert (no search, no record, same journey) on all 16.
- inv 2 (web, Android, iOS): out-of-range `changeIndex` ignored — Android, iOS PASS (web FAIL, F5); moved-anchor
  stability — web PASS (native FAIL, F2); held candidate kept when an earlier train qualifies — web, iOS PASS (Android FAIL, F1).
- inv 3: ride recorded = followed journey — web, Android PASS (iOS FAIL, F9); web focus key unchanged with a record.
- inv 5: tight cue not in Boarding — iOS PASS (Android FAIL, F8).
- inv 6: a recovery change with an estimate earlier than its timetable is `ordinary` with no `Printed change` receipt —
  web, Android, iOS PASS. `w = 0`, `w = 1`, `09:59 → 09:59`, `w ≥ 3` floor, broken-never-lost: covered by the
  20-case fixture, which passes on all three clients today.
- inv 4/7 (real stack, web): the recovery request is exactly `from,to,limit,modes,at` (+`transferLimit` under the flag);
  nothing else leaves the client; no location anywhere in the seam (by reading, all three).
- inv 8: fallback change label keeps the separator on all three (`Town Hall · 10:08`: web `shortLabel`, Android
  `shortChangeLabel`, iOS `axisChangeLabel(withLine: false)`); the web unit test asserts the short attribute. **No test on
  any client proves the drop fires at layout**: the web DOM clamp, Android `wideLabels` measure and iOS `ViewThatFits`
  are only exercised by the shooters, and no shot uses a label wider than its track.

## What the fix agent must know
- Real defects with failing probes: F1 (Android both shapes, iOS tight shape), F2 (Android, iOS), F3 (iOS, real view
  model), F4 (web, real stack script — rerun `web/test/tcr-review-stack.sh` from the repo root; it needs the playwright
  under ~/projects/playtest and ports of its own), F5 (web), F7 (iOS), F8 (Android).
- Owner rulings before touching: F6 (which composition when the second search finds nothing; add a fixture case),
  F9 (which arrival a ride keeps). The probes for these encode the web reading and fail on native by design.
- Observations, no fix demanded: F6b, F10, F11, F12.
- Hazards: (1) fixing F1/F2 by re-matching on native must keep the record's *carried* legs (the moved-anchor record's
  journey holds the earlier candidate's legs plus the later tail), otherwise F6b's "never re-matched" becomes native
  too; a key-based re-match needs the tail from the *later* search, i.e. search from the record's own last anchor, not
  `changeIndex`. (2) Android's `fetchedAt`-driven persist-per-refresh disappears once the record is stable. (3) The
  web fix for F4 must still make at most one recovery request per refresh: drop the `key` early return but keep the
  in-flight abort. (4) `probe inv1` imports `web/js` from git at 36d9ad7 via `git archive`; it stays valid as long as
  that commit exists and the compared exports keep their names. (5) The iOS probe file is registered in
  project.pbxproj with ids 7C2E9A41B5D34F0A9E1C6B2D8F0A3E51/52. (6) The playtest case `home-recovers-lost-connection`
  cannot reach the live recovery path (its `at` is refused by the 24 h window, per tools/README); the stack probe is
  the only real-stack exercise of the web fetch path.
