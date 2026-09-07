# Audit of the native-review candidates

Historical audit, 2026-09-07, before implementation approval. This ledger
corrects the original finding descriptions and severity labels. The original
63 entries plus later D8 make 64 claims to account for, not 64 independent
bugs. The owner subsequently authorized bounded repairs; current scope and
verification are in [build_plan.md](build_plan.md). The original review
groups are in [approval-groups.md](approval-groups.md).

Evidence refers to the working tree based on commit
`4ece84156c85be20fdf68fb4d3e233b4ad9ac190`, including existing uncommitted
changes. Symbols are cited because concurrent work can move line numbers.

**Reproduced** means an executable probe exercised the current implementation;
it does not establish how frequently users encounter it. **Source confirmed**
means the implementation and relevant caller/contract establish the mechanism,
but this audit did not reproduce it in a running phone. **Narrowed** corrects
an overstatement or separates a real issue from an unsupported claim.
**Maintenance**, **measurement needed**, **decision** and **test gap** are not
counts of user-facing bugs. Visual evidence has its own stated limitations.

## Executable evidence

- [Five Android probes](audit-evidence/AuditClaimsTest.kt),
  [JUnit result](audit-evidence/android-probes.xml),
  [build log](audit-evidence/android-probes.log): all five passed. These tests
  deliberately assert the current defective behavior for A1, A2, A3, B1 and
  B9. They belong to this audit, not the permanent product suite.
- [Swift probe](audit-evidence/main.swift) compiled against seven unchanged
  production Core files; [output](audit-evidence/swift-probes.log) confirms
  two A3 acceptance problems, B2's endpoint-distance mismatch and F8's empty
  journey decode, and disproves F8's default non-finite-number claim. It did
  not deliberately crash the UI.
- The five Android probes ran through `:app:testDebugUnitTest` with an
  external source directory added by [init.gradle](audit-evidence/init.gradle).
  The first attempt had mistakes in the audit harness's list-return API usage;
  those were corrected before the recorded successful run. No app source or
  repository test source changed.
- These are targeted probes, not a claim that all app tests or the full native
  visual matrix passed. No `.env` was read and no live upstream requests were
  made. Package failure injection, OS permission callbacks and phone profiling
  remain explicitly unproven where noted below.

Paths below are relative to the repository. `Android` means
`android/app/src/main/java/com/ilovetrains/app`; `iOS Core` means
`ios/ILoveTrains/Core`. Each record names the production symbols inspected.

## A. Routing and realtime

### A1 — Reproduced · group 1

Android `OfflineRealtime.overlay(List)` cancels both connections adjacent to
a skipped intermediate stop. `OfflineRouter.route` then loses a valid A→C
through service. The probe returns one route before the overlay and none
after it. iOS's list overlay preserves traversability while forbidding pickup
and drop-off, with a corresponding existing test. Fix Android's list path;
do not remove cancellation of an actual cancelled trip or boarding at a
skipped origin. Evidence: [overlay](../../../android/app/src/main/java/com/ilovetrains/app/OfflineRealtime.kt),
[router](../../../android/app/src/main/java/com/ilovetrains/app/OfflineRouter.kt).

### A2 — Reproduced, explanation narrowed · group 1

Android `accept` lets an older, unexpired header overwrite newer observations.
The probe replaces a five-minute delay with an older one-minute delay. The
original explanation involving five concurrent feeds was wrong: those feeds
have different source keys, and the view model guards overlapping refreshes.
A sequential stale response is sufficient. iOS rejects older headers.
Evidence: Android `OfflineRealtime.accept`, `TrainViewModel.refreshSharedData`;
iOS `OfflineRealtime.accept`, `OfflinePlanner.refreshRealtime`.

### A3 — Reproduced defensive gap · group 2

Both parsers accept an hour-old header if the supplied expiry is still future.
Android also accepts an unknown stop relationship. iOS accepts a day-future
header, then rejects the valid current one as older. The shipped backend
already emits header+90s expiry and rejects headers beyond receipt+5 minutes
(`internal/native/realtime.go:NormalizeRealtime`), so this is defense against
bad/cached input, not evidence of current bad live feed output. Cap expiry at
header+90s, retain earlier payload expiry, apply the existing five-minute
future tolerance and validate Android's enum. Do not invent a new tolerance.
Evidence: both `OfflineRealtime.accept`/decoders; executable probes above.

### A4 — Source confirmed, recovery claim narrowed · group 2

Android `OfflinePlanner.update` closes the active database and activates the
candidate before `open`; an open/read failure has no rollback. This can lose
the usable in-process planner until recovery. “Every later plan fails until
restart” was too absolute because later update/reinitialization paths exist.
iOS has explicit restore-and-reopen handling. Its package-store tests cover
staging/corrupt-generation selection, **not** an injected planner-open failure;
the original claim that this exact failure was tested is withdrawn. Add that
failure injection with the fix. Evidence: both `OfflinePlanner.update/open`,
iOS `OfflinePackageStoreTests`.

### A5 — Source confirmed defensive gap · group 2

Android validates SQLite version, integrity and coverage, but not its declared
application ID. `parseManifest` does not bound archive size or validate/order
dates. iOS does. Android already enforces hash/declared download size and a
300 MiB extraction ceiling: “unbounded package processing” would overstate
this finding. Reject malformed manifests before download and wrong databases
before activation. Evidence: Android `OfflinePlanner.parseManifest`,
`validateDatabase`, `extractDatabase`; iOS equivalents; native-data contract.

### A6 — Maintenance, with semantic caution · group 12

Both have list, single-connection and journey overlays. Searches of production
call sites in both planners find list and journey calls; the single form is
test-only. Delay propagation differs. A focused journey's endpoints and a
through connection legitimately have different skipped-stop semantics, so
blindly combining cancellation logic could recreate A1. Remove the test-only
path and share only semantics proved equivalent, retaining list and focused
journey coverage. This is not three additional bugs.

### A7 — Documentation decision; no current route defect · group 14

Both routers apply Circular Quay's ten-minute transfer floor to any differing
modes; the contract says rail↔ferry. The bundled data query found only train
and ferry there, so both expressions produce the same results for that
package. Do not broaden the contract to hypothetical modes as a bug fix.
Leave routing unchanged; clarify the current rule and revisit when another
mode actually needs a policy. Evidence: both `transferMillis`; native-data
“Transfer rules”; earlier read-only bundled-data evidence in `design.md`.

### A8 — Documentation correction · group 14

Both `readConnections` loops use offsets −1 through +2, whereas the contract
says prior/current/following. A 30-hour query beginning late in the evening
can reach the second following date. Document the four-date scan bounded by
the query horizon. No extra services, new search horizon or UI change is
proposed.

## B. Focus, prediction and location

### B1 — Reproduced · group 3

Android `inferredFocus` accepts movement with missing destination coordinates:
infinity compares equal to infinity after subtracting 1000. The probe uses
ordinary walking-distance movement without a speed override and still enters
travel mode. Require valid coordinates for both saved endpoints before either
entry branch, as the storage contract says. iOS checks a finite inter-endpoint
distance. Evidence: both `Prediction.inferredFocus`, Android probe.

### B2 — Reproduced endpoint mismatch; UI exit source confirmed · group 3

`LegPlace` in `internal/tfnsw/types.go` contains no coordinates. iOS
`TransitWire.station` therefore decodes an API leg endpoint at (0,0).
`receiveLocation` uses that endpoint for the 200 m completion check. The probe
measures infinity there and zero against the saved destination at the same
fix. Use the saved trip's directional endpoint. This repairs online-journey
completion near arrival; it does not change the five-minute time gate or
enable background tracking. A complete location-to-UI run was not performed.

### B3 — Source confirmed on Android · group 3

Android `newTrip` prefills the inferred origin but `saveTrip` leaves the old
focus, so Home continues following the old destination. Implement the
contract's same first-line/scheduled-departure redirect and board fallback.
iOS has the matching and fallback navigation already; its fallback retains
the old stored focus, so it is not evidence for a blanket focus-clearing
change. Evidence: both `TrainViewModel.newTrip/saveTrip`, iOS `resolveRedirect`,
client-storage “Correction”.

### B4 — Source confirmed · group 3

Focused refresh intentionally fetches all modes. Both Home renderers then
select cancellation replacements and the Next row without checking every
leg against enabled modes. A disabled ferry can be suggested after a train
cancellation. Filter candidate alternatives; retain all-mode refresh of the
already followed journey. Evidence: Android `HomeScreen/SmartHeader`, iOS
`HomeView.presentation/SmartHeader.nextJourney`, both `refreshFocus` callers;
client-storage cancellation-replacement rule.

### B5 — Narrowed source-confirmed divergence · group 3

Android records only an online `isLive` answer and its raw lead; iOS permits a
live local answer and records the merged shown lead. Both clear this evidence
when merely opening a trip. Web `main.js:noteLastOpen` records the unfocused
shown answer without an `isLive` prerequisite and browsing preserves it.
“Any fresh answer” was an inaccurate description of web. Repair the shown
journey identity and browsing loss; retain the native prohibition on inferring
a ride from an offline retained refresh. Define tests for fresh scheduled,
live local, cached and preference-caused paints before changing recording
eligibility. No blanket removal of the native freshness safeguards is in scope.

### B6 — Source confirmed · group 4

Android `location` accepts Home and Setup and casts a home vote whenever trips
exist, without a Home screen gate. iOS gates on Home. A setup-time location
can consume the day's vote at an incidental station. Add the Home gate; keep
first-trip origin fallback. Evidence: both view-model location handlers;
client-storage explicitly says setup fixes cast no vote.

### B7 — Source confirmed · group 4

iOS `receiveLocation` fills an empty setup origin even after manual clearing.
Android tracks `setupOriginEdited`. Protect manual selections and clears in
iOS; keep the current native first-run location behavior unless separately
changed. Web's selectable nearest group is a related but distinct C9 scope.
No delayed callback was driven on a simulator in this audit.

### B8 — Source confirmed on Android; original “both” corrected · group 5

Android `refreshSharedData` maps all non-focused rows through `scheduledOnly`,
removing their observed estimates/cancellations. iOS stores alternatives with
their own board provenance. Preserve observed alternatives and separate them
from the focused service's refresh. Do not make old estimates fresh again.
Evidence: both view-model shared-refresh paths, iOS `FocusedJourney.alternatives`,
native-data retention contract.

### B9 — Reproduced merge mechanism, narrowed trigger · group 5

The background Android replan passes `online = null` even after a successful
server-stale response. If the local result is not live, `mergeBoardResults`
copies the previous board with `offline = true`; the probe confirms that
transition. A live local result avoids it, so this is not every server-stale
refresh. Preserve failed-request status separately from a local-only replan.
The visible countdown consequences depend on the source/age state; do not
assume all stale boards should have countdowns.

### B10 — Unproven runtime claim; not approved as a fix · group 13

`pause` stops the location manager and resume requests fixes only on Home or
Setup. But `receiveLocation` deliberately also accepts only those screens,
and resume refreshes permission state on Settings. Thus “Settings is a dead
end” is not established; navigating Home requests a fix. The alleged alert
callback loss needs an actual OS grant/deny/background/navigation drive after
the concurrent location-row change. Do not broaden coordinate collection to
Settings merely to satisfy this claim. Evidence: `LocationService`,
`TrainViewModel.pause/resume/silentLocation/receiveLocation`.

### B11 — Two code paths confirmed; duplicate runtime request unproven · group 13

iOS requests a fix directly when authorized and from the authorization
delegate. This audit did not establish the callback ordering needed to count
two OS requests. Keep as a permission-lifecycle measurement case with B10;
do not call it a verified battery bug. Evidence: `LocationService.request`,
`locationManagerDidChangeAuthorization`.

## C. Copy and status

The [visual audit's source references](audit-evidence/visual-findings.md)
give exact native/web symbols and existing-test locations for every C/D entry.
The [image catalog](comps/audit/index.html) shows existing real renders,
with matched-pair limitations on each comparison. It contains no proposed
replacement UI and does not reinstate the rejected comp round.

### C1 — Source confirmed on iOS · group 8

iOS `modeName` is reused for generic instructions and the Next rail, where
web deliberately uses different vocabulary. Split those contexts: generic
train/ferry words, explicit train/metro/ferry/service for Next. There is no
metro calibration image; this is source proof, not a photographed defect.

### C2 — Source confirmed on Android · group 8

`platformText(full = true)` preserves an unnumbered wharf label, then
`placeClause` prefixes it again unless Wharf is at the start. Balmain Wharf
becomes Wharf Balmain Wharf; Side A becomes Wharf Side A. Web preserves a
label containing the place word or starting with Side. Port that grammar.

### C3 — Source confirmed; existing owner direction · group 6

Both initial axis caps use the compact helper, losing the full Wharf/Side
form. Use the full departure label where a number or side is provided;
keep transfer chips compact. The owner already specified the desired label,
but implementation still requires group approval. Longer caps need real
phone-width/large-text captures before acceptance; current ferry frames are
not matched comparisons.

### C4 — Source confirmed on both · group 7

Focused headers use numeric N min late before departure where web uses
Running late. The number belongs beneath the figure. Reuse one focus-status
meaning across the header and saved row. An existing iOS delayed-focus frame
shows the wording; no matched Android/web trio is available.

### C5 — Source confirmed on Android · group 7

The saved focused row hard-codes Running regardless of delay, cancellation or
completion. iOS's pure savedTripFocusStatus and web focusStatus distinguish
those cases. Reuse a state-derived presenter. Existing iOS tests support the
reference but do not reproduce the Android view dynamically.

### C6 — Narrowed; state/presentation decision · group 11

Freshness predicates and age wording differ, especially on recent server-stale
responses. But both board screens already share their main visible empty
strings: the broad claim that all empty copy differs was wrong. A synthesized
view-model fallback differs. Native retained/scheduled labels are explicit
exceptions, not automatic web-port defects. Hold changes until a matched
fresh/live, server-stale, aged, failed-request, schedule-only and retained
matrix defines the target. No coverage/indicator redesign is approved.

### C7 — Source confirmed on both · group 8

Home, Board and Detail can use transient `state.message` as empty body text,
while the same message also appears in the bottom notice. A feedback success
can therefore explain an unavailable screen. Remove that body fallback and
derive the explanation from screen state. No new notice wording is needed.

### C8 — Source confirmed on both · group 7

The Next rail independently truncates hours and requires realtime, unlike
the shared board countdown. Thus 119 minutes becomes 1H and fresh scheduled
rows lose the rail figure. Android also omits the retained-row gate. Share
rounding and explicit source-state gating, not an unconditional live countdown.

### C9 — Source confirmed; native exception retained · group 4

Neither native renderer provides Just added for the automatically saved pair
or a nearest-station result after a fix. Web has both. Add those affordances
while retaining Android's documented first-run prompt/autofill. B7 separately
handles iOS's overly broad refill behavior. First-run versus add-trip captures
are required; no supplied screenshot proves both states.

### C10 — Original footer allegation corrected; decision · group 11

Both native footers say Six only when the entire merged row count equals six.
They **do not** label a ten-row board Six as the original account implied;
other lengths show End of board. They still lack a defined relationship
between requested depth, displayed future slice, retained past and footer.
Six-row calibration images cannot prove a ten/24-row problem. Hold policy
and compare identical initial/scroll states; preserve Now and web row rhythm.

### C11 — Source confirmed rounding; locale claim narrowed · group 8

Both header distance helpers floor to ten metres, allowing 1–9 m to display
0 m. Web rounds with a ten-metre floor. Port the thresholds and rounding.
Both native decimal-format calls lack an explicit locale argument; the
original Android-only locale claim was not established. No locale runtime
matrix was exercised.

## D. Layout

### D1 — Source and matched native visual evidence · group 6

Android joins board change names into one centered label and uses unclamped
fixed-width boxes in the large axis. iOS positions/clamps labels at each dwell
and stacks collisions, with geometry tests. The real same-fixture two-change
detail pair shows the station association difference. Follow the owner's
iOS reference; collision handling can require height for long names, so
ordinary row rhythm and stress cases both need checking.

### D2 — Source and matched native visual evidence · group 6

Android draws the second transfer's alighting pin; iOS/web suppress it. The
same real two-change detail pair shows Android's extra 12 marker. Remove
that redundant marker, following the existing owner direction.

### D3 — Source confirmed on Android · group 6

Tight-dwell color depends on wait alone; web/iOS suppress it for cancelled
journeys. The cancelled frames are matched but the small treatment is too
subtle to serve as sole proof. Add cancellation gating; no routing change.

### D4 — Narrowed native-only choice · group 11

iOS permits LAST KNOWN to occupy two lines with a 24 pt slot, Android one
smaller line. The iOS frame shows wrapping but not a broken row height at
default text size. Available retained frames differ in journey/time, so they
cannot establish parity. Smaller one-line text is a readability tradeoff,
not an automatically approved fix. Hold pending a matched retained case.

### D5 — Source confirmed width rule; Now pictured · group 7

Matched native Now frames show different sizing. Source also confirms a width
rule mismatch for 10H and three/four-digit elapsed numerals. Web determines
width from the figure token: Now, 10H and 100 are wide, 2H and 3 are not.
Native stores numeral and unit separately. Reconstruct that token by adding
H **only for hours**; do not include the min suffix when testing width.
Use the three-character threshold while keeping H/min in separate small
12sp/pt runs. The large H was exclusively a rejected-comp renderer error.
10H/elapsed cases are source-verified, not in the matched Now images.

### D6 — Source confirmed on Android · group 9

Settings owns the draft/category in rememberSaveable; navigation removes the
composition and there is no cross-screen state holder. Label/rule styling
does not react to focus. iOS's model-owned draft and focused field are the
reference. Move session state out of the screen and verify leave/return and
focus with the real client; that navigation sequence was not driven here.

### D7 — Overbroad dead-code claim corrected · group 12

A 24-hour past window permits four-digit elapsed minutes. The original claim
that all >3-character branches are dead was wrong. Only the board >=5 length
case is unreachable under that bound, and cancelled-colon styling cannot fire
because the cancellation figure is a dash. Apply D5's correct width rule;
do not indiscriminately delete all longer-figure handling. No independent
user-facing bug or extra approval is counted here.

### D8 — Visual/source confirmed on Android; iOS source cleared · group 6

Android draws the next ride at nextStart but the boarding chip at
`nextStart + 3 dp` without masking the strip. The owner's real Android retained frame
shows the blue before 5. iOS places the ground-backed chip at the departure
coordinate and keeps its padding inside, covering that area. There is no
matched retained iOS photo; iOS is cleared by source, not by an unrelated
image. Repair Android's visible edge without shifting timetable coordinates.

## E. Performance candidates

Performance costs below are source observations unless explicitly measured.
They do not establish user-visible slowness, battery drain or a promised speedup.

### E1 — Measured isolated cost; optimization decision · group 13

Both initializers run `quick_check`, rewrite activation manifests and load
reference maps. Three checks on the extracted 93,155,328-byte database took
273.8–279.4 ms on this Mac with uncontrolled OS cache. The original “0.52 s
cold” and “a phone is slower” claims are withdrawn. This was not app startup
profiling. A verified marker changes corruption-detection behavior; defer
that proposal pending phone launch measurement and a recovery design.
Evidence: both planners' `initialize/validateDatabase/open`; measurements in
`design.md`. Reference-map loading is separate from skipping integrity scans.

### E2 — Source confirmed redundant-work opportunity · group 12

Both ordinary refresh paths persist personal state whenever a lead exists;
iOS additionally copies its prior file to backup. However last-answer evidence
and its timestamp can genuinely change each refresh, so “all these writes
are redundant” is false. Skip writes only when the resulting persisted value
is equal; preserve evidence timestamps and atomic/backup behavior. No battery
savings have been measured. Evidence: both view-model `refresh/persist`, both
stores' `save`.

### E3 — Source confirmed repeated reads · group 12

iOS `DeviceStore.trimCache` calls `cacheEntries` three times; each reads and
decodes cached boards. Reuse one inventory and update it as files are removed.
The original “attributes only” prescription omitted the pair/mode metadata
needed for eviction; do not discard that policy. No timing gain is claimed.

### E4 — Source confirmed allocation candidate · group 13

iOS `ScheduledConnection.tripKey` interpolates a string and the router accesses
it in repeated scans; Android stores it. Compiler optimization and actual
allocation/time were not measured. Profile before choosing stored keys or
integer interning; the latter is a larger refactor, not an automatic fix.

### E5 — Source confirmed work; optimization not validated · group 13

Both planners filter a cached connection window, overlay a copied/grouped list
and sort it. This is not necessarily a deep copy of every object (Swift uses
copy-on-write). The original count estimates do not prove a bottleneck, and
in-place mutation must not contaminate the cached static schedule. Profile
and preserve schedule immutability before selecting an optimization.
Evidence: both planner `plan` connection helpers and list overlays.

### E6 — Source confirmed algorithm cost; unsafe prescription withdrawn · group 13

Both routers repeatedly filter candidate paths and rebuild long-wait ends;
`unresolvedUntil` uses candidates rather than the eligible list. Unsuccessful
seeds scan the remaining window, but origin seeds are already capped at 72.
Arbitrarily bounding failed scans can omit valid late routes: withdraw that
proposed fix. Measure representative reachable/unreachable pairs, then prove
result equivalence for caching or stopping-condition changes.

### E7 — Source confirmed opportunity · group 13

iOS's global `sydneyCalendar` constructs a calendar on access. Both view models
recompute history scores inside sort comparators. Caching invariants may help,
but the claimed every-row/every-second cost depends on actual view evaluation;
no phone profile proves its impact. Evidence: iOS `AppState.swift`, both
`syncPersonal`, both prediction scorers. Preserve Sydney date behavior.

### E8 — Narrowed allocation candidate · group 13

iOS `TransitWire.epoch` makes a formatter for string timestamps;
`FlexibleMillis` makes two after its numeric fast path. Numeric stop estimates
do not allocate those formatters, so “thousands per realtime snapshot” is
unsupported for the actual wire shape. Profile parsing and use safe formatter
ownership if justified. Evidence: both named decoders and native-data format.

### E9 — Source confirmed memory allocation · group 13

iOS `OfflineZip.extractDatabase` allocates the full uncompressed database as
`Data` and maps the archive; Android streams extraction. This proves a roughly
93 MB output allocation for the current package, not an out-of-memory incident
or exact peak resident memory. Streaming is a candidate after peak-memory
measurement; retain all format, size and database validation and add G3 tests.

### E10 — Narrowed collection of small candidates · group 13

iOS computed setup matches/settings results are read more than once on some
branches; it is not always three scans. JourneyAxis calculates geometry in
measurement and placement, Journey builds its key, and lossy storage decoding
round-trips values through JSON. All code paths exist. None has a measured
user impact. Profile independently; preserve lossy recovery of valid entries
instead of replacing it with all-or-nothing decoding. Evidence: SetupView,
SettingsView, JourneyAxisLayout, Journey, DeviceStore.lossyArray/stations.

### E11 — Unproven rendering-cost claim · group 13

Android rows receive the changing AppState and the clock ticks at 1 Hz.
This alone does not prove that every subtree recomposes or redraws, or that
narrowing parameters improves frames. No Compose runtime counters/profile
were captured. Measure before a broad state-plumbing refactor. Evidence:
`TrainViewModel` tick and Home/Board composable signatures.

### E12 — Source confirmed duplicate-work path · group 5

iOS's periodic loop calls shared refresh and ordinary refresh; shared refresh
calls `refresh()` again when the board is not live. This can start/restart a
second departures request; cancellation timing decides whether both complete.
The original claim of exactly two completed requests per cycle was too strong.
Coordinate one ordinary refresh per cycle while retaining local updates.
Evidence: `TrainViewModel.resume/refreshSharedData/refresh`.

## F. Storage, setup and maintenance

### F1 — Maintenance; no shipped reverse control · group 12

Both `reverseTrip` actions have definitions but no UI caller. Remove dead
actions after a caller check. A dormant function is not evidence that users
can see a forbidden reverse control. No user-visible change is intended.

### F2 — Narrowed maintenance list · group 12

Production searches find no callers of AppState.shownBoard/selectedTrip, iOS
removeCache alias or Android JSONObject.longOrNull. Android declares
ACCESS_NETWORK_STATE without querying connectivity. There are **three**
bounded readers: TransitApi returns String and owns closing; planner/realtime
return ByteArray and their callers close. They are related, not drop-in
duplicates. Localhost exceptions exist under cleartext=false, but platform
reachability/test use was not reproduced: do not remove them under a blanket
“unused” approval. Retarget tests if consolidating readers; preserve limits,
stream ownership and transport restrictions.

### F3 — Source confirmed parity change plus cleanup · group 4

Android has two substantially equivalent fuzzy scorers, with small empty-query
and locale differences; both native home pickers start at two characters,
setup/web at three. Make the picker threshold three and share the Android
scorer with explicit locale handling. This changes when results first appear,
not which stations may be saved. Evidence: UiSetup/UiSettings, iOS SetupView/
SettingsView, web search.MIN_QUERY and Settings import.

### F4 — Source confirmed policy inconsistency · group 10

iOS `enforceTripCap` and `UserData.normalized` rank recency differently.
Web `storage.addTrip` uses latest history, otherwise creation time. An
inconsistent/imported history can make different trips survive. Unify the
ten-trip rule and test the eleventh save. This can change which old trip is
evicted; approval must explicitly include that consequence. Do not reduce
the cap or alter undo/deletion semantics.

### F5 — Maintenance · group 12

Both app shells compare the success notice text to a duplicated literal in
the view model to drive dismissal. Current text matches, so no current timeout
failure is established. Replace fragile duplicate coupling with one owned
event/value while preserving the four-second behavior and message.

### F6 — Source confirmed visual/data representation issue · group 11

SavedTrip stores line names without modes; native rows infer ferry from F and
invent T when empty. iOS's refresh alphabetically sorts a Set of line codes,
so it can reverse travel order (T9→F1 becomes F1,T9). Web paints first/last in
travel order. Preserve ordered line+mode values with backward-compatible
reading of existing trips; show an honest empty accent when unknown. A visual
comparison is required for that empty case; a specific migration or new
fallback color is not approved by this finding.

### F7 — Source confirmed, “unguarded” corrected · group 5

Both Earlier paths call only the local planner, unlike web's API-backed past
pages. iOS does have a generation guard and 24-hour bound; it lacks a retained
task/loading guard and rewrites past rows to scheduled-only. Android also
needs overlapping-request coverage. Add API past lookup with local fallback,
preserve observations and ignore obsolete results. No forward paging, new
display count or shorter retention window is proposed. Evidence: both
`earlier`, web `fetchPast`, native retention rules.

### F8 — Reproduced malformed-data acceptance, narrowed · group 10

iOS synthesized Journey decoding accepts `legs: []`, confirmed by the Swift
probe. However Home's current-time/focus gates and Detail's first/last guards
mean the original empty-journey-to-SmartHeader crash chain is not established.
A finite departure of 1e20 also round-trips through the real decoder and is
outside the Int range used by BoardRow; that conversion is unsafe (the trap
was not executed). Default JSONDecoder rejects overflowing/non-finite JSON
numbers, contrary to the original claim. Validate non-empty journeys and
safely bounded times while retaining other valid data. This is recovery
hardening, not evidence that normal saved trips are crashing.

### F9 — Source confirmed cache policy difference · group 10

Android cache writes have no global trim, but deleting a trip removes both
directions and files live in the OS-evictable cache directory. The original
“unbounded” wording omitted both protections. Bound residual pairs/mode files
without deleting personal data; recognize that evicting an old cache removes
that exact last-viewed offline board until fetched again. iOS's existing cap
is a reference, not proof that the same policy has been approved for Android.

### F10 — Source confirmed iOS/web divergence · group 4

iOS setup filters stations/recents by enabled modes and saveTrip rejects
incompatible endpoints. Android/web permit saving and hide incompatible trips
on Home until modes are enabled. Align iOS; do not turn disabled services on
or allow incompatible routes to be suggested. Evidence: SetupView.matches/
recent rendering, TrainViewModel.saveTrip; web search and storage.addTrip.

## G. Verification coverage

### G1 — Test gap confirmed · group 12

Android WebConformanceTest does not assert expected.noLocation; RowConformanceTest
does not assert depTime/arrTime. iOS counterparts do. Add the missing checks
against the existing web-generated fixtures. This is coverage, not proof of
wrong predictions or clock output.

### G2 — Test gap confirmed; fold into relevant fixes · group 12

No Android JVM test references TrainViewModel; current grammar and missing-
coordinate cases lack focused permanent tests. Existing Android UI/instrumented
tests are not “no tests.” Add controller seams/cases as groups 3–5 need them;
do not count each absent test as a separate user bug. The external B1 probe
does not replace a permanent desired-behavior regression test.

### G3 — Test gap confirmed · group 2

No iOS test directly references OfflineZip. The parser has explicit bounds,
entry-count/name/method/encryption and size checks, so lack of tests does not
prove it accepts bad archives. Add malformed-input tests with package
hardening, particularly before any E9 streaming rewrite.

### G4 — Not an independent finding · applies to each approved group

“Write regression tests for fixes” is a verification requirement. Fold
meaningful tests into each approved behavior change and use real-client
visual verification for screen changes. It contributes no additional bug or
standalone approval scope.
