# Transfer completion and recovery — build plan

Design: [design.md](design.md). Binding frames: [`comps/`](comps/)
(`d1-time-390x844-lost-riding.png`, `-lost-dwell`, `-lost-none`,
`flow-d1-time.mp4`). Contracts touched: `docs/contracts/ui.md`,
`client-storage.md`, `native-data.md`, `analytics.md` (no new events; the
existing focus/arrival vocabulary is enough unless a builder finds a gap).

Rules for every phase: read `AGENTS.md`, the design doc and the frames before
code. Owner copy verdicts are in design.md; any string not there is drafted
with `codex exec -m gpt-6-astra … < /dev/null`, never by the builder. Web is
the reference; native ports match its composed-journey semantics exactly.
No location evidence anywhere in this item.

## Shared seam: the composed journey

Every client derives one value per refresh from the focus, in this order:

1. **Connection state per change** of the followed journey, from printed
   clock minutes of effective times (`floor(dep(i+1)) − floor(arr(i))`):
   `w ≥ 5` ordinary, `0 < w < 5` or shrunk below printed → tight,
   `w ≤ 0` → lost. A cancelled leg on either side is broken, never tight or
   lost. This is today's `journey.js` change model plus the lost branch.
2. **Recovery anchor**: the earliest lost change of the *composed* journey
   (see 4). None → no recovery.
3. **Recovery search** at the anchor: journeys from `legs[i].to.id` to the
   followed destination with `at = effective arr(i)`, same mode allow-list
   and transfer cap as the followed journey's refresh. Online:
   `GET /api/v1/departures` (server buckets `at` down; client filters).
   Native offline: the local planner with the same anchor. Candidate = the
   earliest journey whose first-leg effective departure gives `w ≥ 3`
   against `arr(i)` (the server's own connection floor), every leg enabled,
   none cancelled. Web offline: no candidate.
4. **Composed journey** = followed legs `0..i` + candidate legs. It is what
   the header, axis, detail and trackers render. Re-evaluated on every
   refresh; if the original connection becomes catchable again the recovery
   clears; if the candidate's own change becomes lost, the anchor moves to
   that change and the record is replaced. At most one recovery record.
5. **Persisted record** beside the focus, never spliced into `focus.journey`:
   ```json
   "recovery": { "changeIndex": 0, "journey": {…snapshot…},
                 "fetchedAt": "…", "source": {"generatedAt": "…", "degraded": false} }
   ```
   Re-matched per refresh by its legs' `(line.name, departure.scheduled)`
   exactly like `focus.journey`; unmatched keeps the last snapshot with its
   own freshness. Cleared with the focus, on unpin/replacement, and when no
   change is lost. Malformed → dropped, never a crash.
6. **Status**: `LATE · CONNECTION GONE` (warn) while a lost change is ahead
   of the rider's current position in the composed journey; `RUNNING LATE`
   when the relevant leg has a positive departure *or arrival* delay (rule
   change); `CANCELLED`/`TRIP OVER` outrank both. Explicit pin shows the pin
   icon only beside the lost pair. After the candidate's first leg departs,
   the lost pair retires.
7. **Presentation** per design.md round 2 verdict: struck original arrival
   beside the composed arrival; change label `<STATION> · <LINE> <HH:MM>`
   on a recovery change, dropping the line code before wrapping; receipt
   naming both times; dwell instruction `Board the <HH:MM> at <station> ·
   Platform n`; no-candidate composition with `Planned`.
8. **Alerts (native)**: `Delayed` when the composed destination arrival's
   printed-minute delay first reaches 5; `Tight change` when the next
   change's state first becomes tight while riding toward it; the existing
   missed-connection cue's body carries the candidate (`… next is the
   <HH:MM> from Platform n`) when one exists. Once per leg per generation,
   same baseline/silence rules as the shipped four. `journeyAlerts` off
   silences all.

## Phase 0 — contracts, conformance fixture, copy (global, first)

Owns: `docs/contracts/ui.md`, `client-storage.md`, `native-data.md`,
`tools/fixtures/conformance/transfer-recovery.json`, design.md copy table.
- Write the seam above into the contracts in the same wording the clients
  will test against; amend the "fetch only for the selected trip" rule to
  allow the focused journey's recovery pair; extend `RUNNING LATE` to
  arrival delay; add the two cues and the alert body to Journey alerts.
- Conformance cases (inputs: legs with scheduled/estimated times, cancelled
  flags, candidate list, now; outputs: per-change state, anchor, composed
  legs, status, label, receipt): ordinary; tight; lost with candidate;
  lost without; lost then recovered by a later estimate; candidate's own
  change lost (anchor moves); two-change journey with second change lost;
  candidate under the 3-minute floor skipped; cancelled leg outranks lost;
  `w = 0` exactly is lost; `w = 1` is tight; arrival-only delay is late;
  after boarding the candidate the pair retires.
- Codex drafts alert copy for `Delayed`, `Tight change` and the extended
  missed-connection body; record candidates in design.md for the owner.
- Gate: fixture loads in all three test suites (empty test stubs are fine);
  `go test ./...` untouched. Done marker: `[ ] phase 0 done`.

## Phase 1 — web (reference)

Owns: `web/js/journey.js`, `focus.js`, `home.js`, `journeybar.js`,
`detail.js`, `storage.js`, `api.js`, `app.css`, `sw.js` (bump `VERSION`),
`web/test/*`, `tools/shoot-states.js` states, `playtest/regressions/`.
- `journey.js`: lost state; never print a negative window.
- `focus.js`: `directionsModel` over the composed journey, status rule,
  no advance into a leg the rider could not have boarded.
- `home.js`/`api.js`/`storage.js`: recovery fetch on each focus refresh
  while a change is lost, record persistence, re-match, clear rules.
- `journeybar.js`: change label with time, struck arrival beside the new.
- `detail.js`: composed journey steps, receipt as summary line.
- Gate: `(cd web && npm test)`; conformance cases pass; new shoot-states
  states `home-lost-riding`, `home-lost-dwell`, `home-lost-none` at 390 and
  412 both schemes match the binding frames within the existing tolerance;
  `tools/playtest-regressions.sh` with a new recorded case for the lost
  flow; visual regression on home/detail. Done marker: `[ ] phase 1 done`.

## Phase 2 — Android (parallel with 3)

Owns: `android/app/src/main/java/com/ilovetrains/app/` —
`TravelTrackerState.kt`, `TravelTrackerLifecycle.kt`,
`TravelTrackerNotification.kt`, `TrainViewModel.kt`, `Storage.kt`,
`UiHome.kt`, `UiDetail.kt`, `UiPresentation.kt`, tests.
- Composed journey and recovery record in the view model; online search
  through `TransitApi`, offline through `OfflinePlanner` with the anchor.
- Tracker projects the composed journey; `MissedTransfer` keeps its broken
  layout only with no candidate; two new cues in the lifecycle.
- Gate: `tools/build-android.sh --unit` with conformance cases; the
  instrumented tracker test for the lost flow with and without a candidate;
  `tools/shoot-android.sh` frames for the three lost states; visual
  regression. Done marker: `[ ] phase 2 done`.

## Phase 3 — iOS (parallel with 2)

Owns: `ios/ILoveTrains/Core/TravelTrackerState.swift`,
`TravelTrackerController.swift`, `TrainViewModel.swift`,
`DeviceStore.swift`, the Home/Detail views under `ios/ILoveTrains/UI/`,
`ios/TravelTrackerWidget/`, `ios/Shared/`, tests.
- Same as phase 2 on the iOS seams; Live Activity payload carries the
  composed journey; alert configuration for the two new cues.
- Gate: `tools/build-ios.sh --unit`; `--ui` tracker flow test for lost with
  and without candidate; `tools/shoot-ios.sh` frames; visual regression.
  Done marker: `[ ] phase 3 done`.

## Phase 4 — verification wave and closeout prep

- Full gates on final sources: `go test ./...`, `(cd web && npm test)`,
  `tools/playtest-regressions.sh`, `tools/build-android.sh`,
  `tools/build-ios.sh --test`, full `tools/visual-regression.js` matrix.
- Fable review agent over the three client diffs (owner grant 2026-09-07).
- Move the accepted frames from `comps/` to `assets/comps/latest/` as the
  exemplars for the new states; then closeout via the `backlog-item` close
  stage. Done marker: `[ ] phase 4 done`.
