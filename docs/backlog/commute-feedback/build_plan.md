# Commute feedback — build plan

Status: implementation and verification complete; release and closeout in progress.
Read [design.md](design.md) first; it contains the behavior, numbers, scope and
owner rulings. The existing cab patch is partial implementation, not a passed
release gate. It still needs the owner's eight-car and passenger-door revision.
Do not treat the design-session comp captures as built-client
verification.

Final Astra verification: web 436 unit tests plus real controller/C1, Settings, cab,
full 42-frame matrix and recorded v56→v58 offline shell upgrade pass. Android 131
unit tests, full debug/release gates, six real-timetable planner cases, controller
integration, 39 app frames, 32 C1 frames and full notification/system lifecycle pass.
The overnight route completes in 9.279s under the unchanged 12s limit. Signed
Android 1.6.0/code 6 installs and preserves Direct only through relaunch.
iOS fullgate plus corrected targeted reruns, notification denial, final cab 5-unit
and 2-UI checks, 31 app frames, 20 C1/large-text frames and 20 ActivityKit captures pass.
Static ActivityKit fixtures keep host expiry future; the separate wall-clock
lifecycle still tests actual OS staleness. No ignored tracker baselines imported.
Astra owns the reviewed final code. Release source is isolated from unrelated
website/icon/deletion work; the deferred transfer-recovery design stays separate.

## Execution rules

- Follow current AGENTS.md, PROJECT.md, the referenced contracts and
  tools/README.md. Never load/source `.env` or print an API key. Use captured
  fixtures for development; this plan requires no live upstream probe.
- Inspect the checkout before editing. Other work overlaps native controllers,
  Settings, tracker integration, contracts and visual baselines. Preserve it;
  use an isolated checkout containing the intended starting changes if needed.
  Record which cab changes were carried forward. Do not reset or bulk-stage.
- Use current project model guidance over stale/unavailable models named in
  generic skills. Owner ruling (2026-09-10): Astra owns implementation, code review and fixes.
  Existing sol implementation must receive Astra review before release; sol
  is limited to explicitly scoped verification or computer use. Parallelize only
  independent platform work after shared seams are fixed. Each worker owns its
  platform files; one integrator owns shared fixtures, contracts and baselines.
- Comments are rare and short: one line of why where non-obvious, never a
  narration of the code. Keep code waves separate from device/calibration waves.
- Put any changed design assumption into design.md before briefing dependent
  work. Threshold tuning must preserve the owner's core rule: neither a timer
  nor missing location can override an armed, unresolved trip's arrival guard.
- Final contract changes accompany their implementation in the release change.
  Leave deferred transfer recovery in its own backlog folder.

Owner correction (2026-09-10): sol implementation and verification workers
were stopped. Astra now reviews and fixes each platform before release. Existing
passing receipts are retained; changed code receives the affected gates again.
The Android device test exposed a new cold-load settlement race; initialization
now waits for permission and arms known-granted monitoring before settlement.
Four focused device tests pass, including permission-before-load and lifecycle
callback rejection. Full post-fix gate and final visual receipts remain open.

## Phase 0 — establish the starting state and fixtures

Build-session note (2026-09-09): the initial checkout contains uncommitted
tracker/controller, Android Settings/deletion, website/icon, documentation and
baseline work. The tracked starting diff and status are saved in
`/tmp/commute-feedback-starting.patch` and
`/tmp/commute-feedback-starting-status.txt` for attribution. Carry forward all
three rear-cab patches, then replace their six-car geometry with the accepted
eight-car target. No reset or bulk staging is permitted.

Release isolation: a separate candidate index and `/tmp/commute-feedback-release`
contain only changes since the starting snapshot, plus the approved cab and
Settings composition and cached recommendation route-colour publication that
the feature now depends on. The pre-existing website, icons, Android deletion
UI/tests and tracker-only work remain outside this release. The primary
checkout and its original changes are preserved.

Execution adjustment: the numeric/null cap table and optional arrival metadata
are already fully specified in design.md. Platform owners may migrate their
own models while the integrator establishes shared fixtures and the pure web
reference, avoiding overlapping ownership of native models. They must consume
the same fixtures before reporting completion; semantic changes are recorded
here before integration. Platform code waves precede final device verification.

- [x] Complete

**Owner:** integrator. **Files:** this folder; new
`tools/fixtures/conformance/commute-feedback.json`; fixture loader wiring in
web/Android/iOS tests only. No broad refactor or unrelated baseline acceptance.

Read relevant diffs and record a concise starting-state note here. Inventory
current sources, available session-owned devices and exact helpers. Confirm
that the three cab renderers still contain the intended first/last car change.
The eight-car port must replace the native hardcoded 197-unit consist width,
iOS -201/+205 animation endpoints, six-iteration loops and terminal index 5.
Derive width as `carWidth * count + gap * (count - 1)` and terminal index as
`count - 1`. The revised cab target uses 40-unit cars with one-unit gaps,
so eight cars span 327 units. Update the rear reflection to the new width
(40-unit translation / 20-unit center), not the old 32/16-unit values.
Web measures the consist already, but its centered reduced-motion transform
does not currently scale to a narrow lane. Add uniform fit-to-lane scaling
there and in native; center horizontally and keep the train on its baseline.
Update the six-car assertions in `tools/check-tiny-train.js` and add doorway
and cab-role checks rather than blindly replacing every numeric six in tests.
Do not repeat old complete suites solely to rediscover the previous turn's
results; run affected baseline checks when overlapping changes make them
unreliable, and retain attributable failures.

Create one hand-authored fixture file containing the cases below. Use a fixed
UTC epoch in integer milliseconds; encode directions, service-leg identities,
source times, accuracy and optional speed explicitly. Include named synthetic
clock/location deltas. Tests read the same expected values across clients;
do not generate the answer from the implementation being tested. iOS may copy
this resource via its existing project generator; keep the source authoritative.

**Seam:** score uses effective service times and changes × 300,000 ms;
nullable maximum changes distinguishes null from zero; arrival reducer inputs
include explicit identity, clock, metadata and an evidence sequence. Action
outputs distinguish record/correct/withdraw/expire from render-only state.

**Verify:** fixture JSON parses; named expected score arithmetic is checked;
loaders retain assertion failures (never place assertions inside Android's
exception-swallowing JSON helper). Build-plan case IDs below all have fixtures
or an explicitly named device-flow owner.

Receipt so far: `commute-feedback.json` parses; the hand-authored shared
recommendation/preferences and arrival evidence cases pass in 60 web tests. Remaining request/device cases have named flow
owners in the fixture. Existing `internal/api/flags_test.go` and
`internal/tfnsw/map_test.go` already cover valid direct-only cap zero. The
browser cab checker now asserts eight cars, terminal-only cabs, all 16 paired
passenger doorways, square middle ends, window separation and reduced fit.
Native fixture loaders are wired through the Android resource source set and
iOS project generator. Both assert in ordinary loops rather than exception-
swallowing JSON callbacks. Their execution belongs to Phase 1/native gates. Read-only device inventory
shows no Android devices attached and the iOS worker's
`Codex-commute-feedback-01` (76C645EC-79B4-426F-B73F-6B6B6A3C79C4, iOS 26.4).
The unrelated booted iOS 26.3 iPhone remains untouched.


Integrator verification: `go test ./...` passed on unchanged server sources.
Reference web helper suites now pass 60 tests, including completed-focus expiry
and rejecting future confirmation metadata. Temporary source mutations proved
the timer-guard and completion-expiry assertions fail when their guards are
removed; production source was not mutated. Platform integrations and the
real-controller browser verifier are in progress. Independent sol review
confirmed three score defects, now fixed with permanent regressions: final-leg
estimate precedence, legacy numeric leg counts and overlapping connections.
The review's isolated seven probes pass. Native routing review found
open implementation gaps in visited-state dominance, cooperative cancellation,
eligible seed accounting, cached recommendation/source persistence, detail/pin
and last-answer provenance, retained observations and iOS source/horizon rules.
These are assigned to the platform owners before their final gates; moving
snapshot findings must be rechecked against their latest sources.
Added a previous-shell upgrade/offline
checker; browser execution is pending the integrated shell.


## Phase 1 — shared types, cap migration and web pure behavior

- [x] Complete

**Owner:** integrator/reference implementation. **Files:**
`web/js/preferences.js`, `storage.js`, `journey.js`, `focus.js`; new
`web/js/recommendation.js` and `arrival.js`; relevant web tests;
Android `Models.kt`, `Storage.kt`; iOS `AppState.swift`, `DeviceStore.swift`,
`TransitModels.swift`; existing `internal/api/server_test.go` and
`internal/tfnsw/map_test.go` only if cap-zero coverage is absent.

Do the cross-client boolean-to-numeric cap migration before platform workers
fork. Update every caller that would otherwise treat zero as absent. Add
`direct` parsing, serialization, cycle order and nullable cap helpers. Keep
flag-off and uncapped followed-service behavior from the design table.

Define backward-compatible arrival metadata and candidate-page envelopes in
all three storage/model layers. Native implementation can introduce dedicated
files, but field semantics must match the design. Keep new fields optional;
no destructive cache/personal-data migration or schema-version reset.

Implement the pure web score selector and arrival reducer first. The reducer
owns guard arming, sample validation, rolling evidence, completion basis,
retention, identity invalidation and write proposals. Pass time explicitly;
no DOM, provider, fetch or wall-clock reads in these helpers. Preserve old
ride identity and endpoint snapshots.

**Seam:** platform adapters receive one arrival result; no downstream consumer
may OR it with `now >= ETA`. The chosen journey travels with its own source.
The candidate list is not the board's display prefix. Freshness is never
inferred from a different response's timestamp.

**Verify:** relevant web unit suites and native storage/cap unit filters.
Shared cases R1–R7, P1–P4 and A1–A12 pass in the reference helpers. Existing
native code compiles against the migrated types before platform integration.

## Phase 2 — complete web behavior and UI

- [x] Complete

**Owner:** web worker. **Files:** `web/js/main.js`, `api.js`, `home.js`,
`focus.js`, `storage.js`, `recommendation.js`, `arrival.js`, `settings.js`,
`journeybar.js`, `journey.js`, `rowmodel.js`, `web/app.css`, `web/sw.js`;
corresponding `web/test/*`; web-only integration hooks as needed.

Integrate incremental three-page search with generation guards, deadlines and
per-key throttle. Preserve immediate cached/first-page paint, chronology,
current row count and independent source freshness. Persist bounded candidate
pages with raw cache entries. Wire the actual recommended journey through
`lastOpen`, detail lookup, cancellation alternatives and the earlier/next rail.
Do not change saved-pair prediction scoring.

Add one foreground location subscription owner and retain `coords.accuracy`.
Coordinate it with existing one-shot setup/inference requests. Arm before
settlement; cancel on lifecycle/identity/preference changes and ignore late
callbacks. Sequence matching refresh, evidence reduction, storage writes, then
render. Route Home, detail final-step state, expiry and ride settlement through
that decision. Keep mutation out of renders and service-worker code.

Implement C1 route/chip overlay, uncertainty copy and three Settings values.
Extend the cab patch to eight cars and paired passenger doors on every car.
Port the durable `commute-feedback/cab/` reference; update consist width,
animation endpoints and narrow-lane reduced-motion fitting.
Bump SW VERSION from the value actually present
and add any new imported module to SHELL. Add the changed behavior to the
existing browser harness rather than relying only on model-level fixtures.

**Seam:** lifecycle callback identity includes focus generation and location
subscription generation. Request identity includes pair, direction, modes,
cap and generation. Abort is cleanup; identity checks provide correctness
when cancellation races a callback. Background means no GPS watch.

**Verify:** `(cd web && npm test)` plus one real-browser smoke for direct-only
reload, a later-departing recommendation, and delayed guarded focus. Full
geometry/service-worker/device matrix belongs to Phase 5. Handoff names any
new fixture/test hooks and the SW version, without claiming full verification.

Web code receipt: all 432 web tests and the complete real-controller
`check-commute-feedback.js` flow suite passed against final web code. This
includes permission changes, refresh ordering, atomic settlement, recommendation
paging/deadlines/generations, direct-only reload and C1 geometry. Captures:
`/tmp/ilovetrains-commute-feedback-check`. Full visual and returning-shell
checks remain in Phase 5.

## Phase 3 — Android routing, lifecycle and UI

- [x] Complete

**Owner:** Android worker, after Phase 1; consume settled web reducer semantics.
**Files:** Android `OfflineRouter.kt`, `OfflinePlanner.kt`, `TransitApi.kt`,
`BoardRetention.kt`, `Models.kt`, `Storage.kt`, `Prediction.kt`,
`TrainViewModel.kt`, `MainActivity.kt`, `UiHome.kt`, `UiPresentation.kt`,
`UiCommon.kt`, `UiSettings.kt`, `UiDetail.kt`, `TinyTrain.kt`; new focused
arrival/recommendation helper files; existing `TravelTrackerState.kt`,
`TravelTrackerLifecycle.kt`, `AndroidTravelTrackerRuntime.kt`,
`TravelTrackerService.kt`, `TravelTrackerNotification.kt` only where required
for shared completion semantics; associated JVM tests.

Add the bounded weighted offline pass and separate recommendation envelope.
Retain the chronological board pass and existing feasibility/long-wait rules.
Wire online paging and native source precedence without overwriting known
realtime delays with timetable values. Use nullable cap zero at API and
planner boundaries and filter all presentation paths before first paint.

Port the fixture-backed arrival reducer. The Activity owns foreground provider
updates and passes accepted samples to the existing shared controller; the
tracker service does not acquire background GPS or a separate storage writer.
Route all completion, history, expiry, notification projection and suppression
through the shared result. Resume/provider errors and permission changes must
not replay stale callback evidence. Keep existing notification permission and
dismissal behavior.

Port C1 exactly, including both platform numeral overlays, one Change action
and honest delayed/missing-location copy. Preserve native layout units and the
rear cab's mirrored transform, while extending the consist to eight cars and
porting the corrected passenger-door geometry on every car.

**Seam:** app and service publish the same focus identity and arrival state;
background refresh can revise ETA but cannot fabricate location confirmation.
The weighted result remains available for Home/detail even outside board rows.

**Verify:** `tools/build-android.sh --unit` with targeted router, storage,
retention, ride, presentation and tracker tests during iteration. Add controller
and provider-adapter integration cases for Phase 5. One smoke drive is enough
here; full native gate/calibration remains a separate phase.

Android code receipt: `tools/build-android.sh --unit`,
`compileDebugAndroidTestKotlin` and the full `tools/build-android.sh` gate passed.
Unit log: `/var/folders/2w/krx53_8d0wz9bnc02rvllb8w0000gn/T/ilovetrains-android-unit.7YWFcG`;
full gate log: `/var/folders/2w/krx53_8d0wz9bnc02rvllb8w0000gn/T/ilovetrains-android-debug.3yhnqC`.
Device integration and visual verification remain in Phase 5.

## Phase 4 — iOS routing, lifecycle and UI

- [x] Complete

**Owner:** iOS worker; independent of Android after Phase 1.
**Files:** iOS `Core/OfflineRouter.swift`, `OfflinePlanner.swift`,
`TransitAPI.swift`, `TransitModels.swift`, `DeviceStore.swift`, `Prediction.swift`,
`TrainViewModel.swift`, `AppState.swift`, `LocationService.swift`; new arrival/
recommendation helpers; `UI/HomeView.swift`, `SettingsView.swift`, `Common.swift`,
`JourneyAxisLayout.swift`, `DetailView.swift`, `TinyTrain.swift`;
`Core/TravelTrackerState.swift`,
`TravelTrackerController.swift` and `ios/TravelTrackerWidget/*` only as needed
for completion consistency; associated XCTest files and Xcode project wiring.

Port the same weighted routing/search, nullable cap and arrival behavior as
web/Android. Match tuple ties and all numeric/time encodings in fixtures.
Keep the same chronological board and source-precedence contract.

Extend the existing LocationService with an explicit foreground monitoring
mode, without accidentally stopping it after each useful fix or creating a
second manager for setup. Clear windows on suspension and reconcile accepted
refresh/evidence before completion when the app resumes. Validate optional
Core Location speed and accuracy separately.

ActivityKit publication consumes the shared decision; it does not turn its
last published countdown endpoint into arrival. Preserve existing absolute
clocks, stale fallback, dismissal generations and app-execution limits.
Avoid promising a punctual background UI transition. Port C1 and the Settings
row through the existing native grammar. Extend the train to eight cars and
port the corrected passenger doors, including on both driving cars, from the
durable cab target.

**Seam:** the app is the sole personal-state writer; widget state is a display
payload. A new ETA cannot reverse a location-confirmed arrival, but can withdraw
an estimate-only completion for the same identity.

**Verify:** `tools/build-ios.sh --unit` with affected storage, router,
controller, Home, axis and tracker tests during iteration. Regenerate the
Xcode project with `tools/generate-ios-project.rb` if files/resources are added.
Use only the build session's simulator. Full gate/calibration remains Phase 5.

Astra web review receipt: 436 unit tests and the complete controller/C1,
marker, tiny-train and Settings checks pass. Exact returning-shell upgrade
from the recorded v56 shell to v58 passes offline with Direct only and saved
trips preserved. Full 42-frame capture plus final affected Home recaptures
were inspected. Seven intended Settings changes and the platform-chip rounded
edge change were accepted from those captures. Four freshness differences
were traced to the visual seed retaining an old recommendation source; the
corrected seed recaptures match their original baselines. Receipts:
`/tmp/commute-feedback-web-astra-review.md`,
`/tmp/commute-feedback-web-astra-visual/full-verification.html`,
`/tmp/commute-feedback-web-astra-home-final/final-home-verification.html`, and
`/tmp/commute-feedback-web-astra-freshness-final/report.html`.

## Phase 5 — integration and real-client verification

- [x] Complete

**Owner:** verification wave, independent platform lanes. **Files:**
`tools/shoot-states.js`, `tools/check-settings-browser.js`, relevant browser
flow instrument/new focused checker, `tools/visual-regression.js`,
`tools/fixtures/conformance/*`; Android `src/androidTest/...` controller/
calibration tests; iOS `ILoveTrainsUITests/*`; `tools/README.md` for new seams.
No implementation changes outside findings handed back to their owner.

Use real controller entry points: a fixture that assigns a final UI state
cannot prove permission handling, callback cancellation or ride settlement.
Drive before/during/after ETA and transfer, plus reload/background/resume.
Native tracker checks exercise real notification/ActivityKit publication and
storage, not just formatted state. Do not touch another session's device or
wipe an emulator for routine app reset.

Required final gates, once on final sources:

```sh
go test ./...
(cd web && npm test)
tools/build-android.sh
tools/build-ios.sh --test
```

Also run the affected Android instrumentation and iOS system-integration flows
using operations runbooks. Extend rather than bypass the existing trackers'
verification lanes. The OS ending/removing a surface never counts as a ride.

Run the full affected web/Android/iOS visual-regression matrix on final UI
sources. During iteration select affected screens; final shared styling needs
all affected screens/platforms. Check 390×844 and 412×732, dark/light, and
native large text. Compare C1 before/during/after against the accepted PNGs;
uncertain states must preserve destination/last estimate without zero/finished
copy. Numerals cannot bleed saturated route paint through their chips.

Check web throwaway-profile service-worker upgrade from the previous shell,
not just a clean load; include offline first paint with direct-only saved and
cached incompatible journeys. Check foreground sampling stops in background,
on off/unpin/delete and after completion, and cannot be restarted by old
callbacks. Keep performance measurement separate from build/UI contention.
The lookahead must not delay the first-page paint; route passes must cancel
when superseded and stay within the stated seed/request budgets.

**Done:** all case IDs below have passing receipts; final full gates pass;
intended visual changes are inspected. Reuse verified captures with
`--compare <existing-run> --accept` for intended baseline changes. Never accept
unrelated diffs merely to make the matrix green.

## Phase 6 — contracts, release and closeout

- [ ] Complete

**Owner:** integrator. **Files:** `docs/PROJECT.md`, relevant sections of
`docs/contracts/{api,client-storage,ui,native-data,android-deviations,ios-deviations}.md`,
`docs/ROADMAP.md`, `assets/comps/latest/commute-feedback/`, appropriate
`tools/baselines/` entries, canonical app version and release metadata.

Reconcile implementation with design.md and migrate only current contracts and
seams into durable docs. Replace accepted illustrative targets with reproducible
built-client exemplars where available, keeping synthetic deltas identified.
Keep the separate transfer-completion-recovery item and repair its links to
closed commute behavior. Do not claim transfer recovery was implemented.

Review the complete intended diff, especially independent `now >= ETA` exits,
cap truthiness, source mixing, location privacy and API/request budgets. Commit
only this work and required consciously integrated dependencies. Follow current
Android/iOS/deploy runbooks for signed builds and release; a source push is not
a deployment. Confirm release artifacts contain the final sources and that the
production web shell/download match the intended version. Use current release
instructions, not historical artifact versions from the design session.

After all gates and release checks, close this backlog item: migrate durable
facts, fix surviving references, and remove its disposable folder. Do not run
release or closeout merely because the design is ready. This handoff session
performs none of these build/release actions.

## Acceptance cases

| ID | Input / event sequence | Required result |
| --- | --- | --- |
| R1 | One change arrives 10:00; direct arrives 10:04 / 10:05 / 10:10 | Direct wins first two; one change wins last. Cost penalty is exactly five minutes. |
| R2 | Equal cost and changes; varied arrival/departure/identity | Tuple tie order is deterministic in all clients. Invalid/cancelled/incompatible routes cannot win. |
| R3 | Six early multi-change results, later direct outside displayed rows and on page two | Header finds and opens/pins the direct; board stays chronological with its existing row limit. |
| R4 | Repeated/empty pages, bucket-boundary departures, nonadvancing cursor, best cost bound, >2h cursor | Search terminates correctly without claiming exhaustive upstream coverage. Max three calls/search; two supplementary calls total. |
| R5 | Slow/error page, navigation, pin, modes/cap A→B→A, late response | First paint is not blocked; no stale generation repaint/write. Supplementary deadline/throttle are enforced. |
| R6 | Same native seed: earlier-arrival transfer vs slightly later direct; later better seed beyond board limit | Weighted inner and outer search find the winner; a terminal arrival/board count cannot prematurely prune it. |
| R7 | 72-seed cap, conditional long wait, later invalidating service, overnight fallback, mixed-mode floors, realtime delay | Resource bounds hold, eligible best-found fallback survives, and route feasibility is preserved. |
| R8 | Recommended departure is later than earliest service | Earlier rail names/opens the actual earlier alternative; first-service duplicates excluded; source ages stay separate. |
| P1 | Missing/invalid/two/any/direct stored choice, reload | Existing defaults preserved; direct survives; cycle is direct→two→any→direct. |
| P2 | Flag on/off with every stored value; cap zero in query/filter/router | Numeric/null table holds, followed-service refresh remains uncapped, no new remote flag mutation. |
| P3 | Incompatible cached focus/rows/pages, offline, widen/narrow, failed replacement fetch | Nothing excluded flashes or resurrects; eligible fallback keeps its actual provenance. |
| P4 | Mode exclusions on later legs, all-off, no direct route, hidden saved pair | Every surface applies the same filter; correct empty copy; no location/history mutation from Settings. |
| A1 | Armed, ETA passes, fresh away positions and mean speed >=8 m/s | Unconfirmed, moving copy, no ride, no return, no tracker completion. Still true at ETA+30m while evidence continues. |
| A2 | Armed, fresh away positions with low/missing speed | Stopped short remains unconfirmed; absence of train-like speed does not imply arrival. |
| A3 | Armed, GPS lost at ETA; tick at +2:59 / +3:00 | Checking then unconfirmed. No clock completion at either boundary. |
| A4 | Near destination at speed; single noisy fix; accuracy overlaps radius; missing destination | No arrival. Only a complete valid confirmation window can settle. |
| A5 | Valid near/low-speed window; missing-speed stationary fallback; early before A−5m | Confirm at the valid boundary only; persist one location-basis ride atomically. |
| A6 | Negative/NaN/infinite speed, inaccurate/stale/future/out-of-order fixes, sampling gaps | Invalid speed is not zero; invalid evidence cannot confirm; gaps reset window; bounded samples retained only in memory. |
| A7 | Matching refresh postpones ETA before settlement, including failed/unmatched refresh | Accepted ETA applies first; failure keeps source truth; location confirmation stays complete. |
| A8 | Estimate-only ride, ETA moves future; location-confirmed ride, ETA moves future | First is withdrawn; second remains completed, with effective ride times corrected. |
| A9 | Suspend/kill/reload with armed unconfirmed focus, callback from old generation | No automatic ETA completion or old-window confirmation; metadata restores, raw samples do not. |
| A10 | Guard never armed, location off/denied/unavailable; legacy ride migration | Existing estimate completion works with honest copy. Old rides are not revoked by migration. |
| A11 | Both guarded expiry deadlines pass; fresh evidence just before resume lookup completes | Evidence-first bounded resume; otherwise silent expiry, no ride/return, no immediate reinference. |
| A12 | Unpin/delete/replace focus or disable location while callbacks/refreshes are in flight | Collection stops, generation checks reject writes, raw samples cleared, no old tracker resurrection. |
| V1 | C1 transfer before/during/after, short/long axes, both schemes/sizes | Both chips actionable/full during; pair and numerals fade after; marker/upcoming platforms stay distinct. |
| V2 | ETA overrun with motion vs missing evidence, corrected ETA, reduced motion | Pending-end fraction never claims continuous GPS position; no zero TO GO/finished state; marker hidden without fresh movement. |
| V3 | Eight-car cab animation on all clients, shortest lane, repeated tap, redraw, flag off, reduced motion | Exactly two outward-facing cab bodies and six square-ended middle bodies; two yellow paired passenger doorways on every visible car side, including both end cars (16 total); no middle-car nose/windscreen/headlight or window-door overlap; complete consist fits in reduced motion; existing lifecycle/accessibility behavior retained. |
| I1 | Android background/locked refresh, iOS suspended activity and resume, OS dismissal | Shared arrival authority; no GPS in background, no timer-created ride, no false completion suppression. |
| I2 | Browser upgrade/offline reload, native storage round trip, API transport capture | New shell loads, preferences/metadata survive, no personal telemetry or coordinates leave the device. |

## Build-session starting prompt

“Build docs/backlog/commute-feedback from its design.md and build_plan.md.
C1 and the five-minute transfer penalty are settled. Extend the existing cab
patch to the revised eight-car, paired-passenger-door reference and preserve
unrelated checkout work. Complete all three clients and the listed
verification gates. Keep transfer-completion recovery deferred.”
