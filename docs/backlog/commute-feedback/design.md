# Commute feedback

Status: ready for build handoff, 2026-09-09. Product implementation is unfinished.
Build from [build_plan.md](build_plan.md) in a fresh session. This document
specifies the change; existing contracts describe the shipped behavior until
updated alongside implementation. Engineering defaults below are selected to
complete this handoff, not presented as additional owner rulings.

## Outcome and scope

Home should recommend the service worth taking, show how much of the trip has
passed, and avoid declaring arrival while location contradicts it. Apply the
same behavior to web, Android and iOS. Keep the departures board chronological,
explicit service choices authoritative, personal evidence local, and existing
location permissions unchanged.

| Owner request / ruling, 2026-09-09 | Binding result |
| --- | --- |
| “Fix the missing rear-facing driver's cab on web, ios, and android.” | Outward-facing driver's cabs at both ends. Mirror the front cab. |
| “look at the train doors - is that right? Also, sydney trains tend to have 8 cabs.” | Interpret as eight cars, with two terminal driver's cabs and six square-ended middle cars. Correct passenger doors on every car. This supersedes the original six-car drawing. |
| Suggest lowest cost, not blindly the next departure; “Five minutes per transfer.” | Arrival time plus 300,000 ms for each service change. |
| “A ‘direct only’ option i.e. third choice on the settings toggle is definitely needed.” | Add Direct only to the existing transfer-limit row. |
| The marker moved but the line behind it remained solid; “use C1, and make sure the platform number carries the same lower contrast after the transfer.” | C1 full-width faded travelled line, including completed transfer chip fills and numerals. |
| Do not finish while away from the destination and speed still indicates train travel; consider 2–3 minutes. | Evidence guards completion. Three minutes is an uncertainty buffer, never a timeout overriding travel evidence. |
| Transfer guards, possibly a tighter buffer, and help with connections broken by delays can be separate. | Deferred to [transfer completion and recovery](../transfer-completion-recovery/design.md). |
| Ignore missing live travel tracker and buses feedback. | No new tracker feature or bus support. Existing tracker consumers must still agree with final-arrival decisions. |

No further visual choice is required. The remaining numbers below are explicit
implementation defaults with deterministic tests; they are not claims that
phone telemetry can prove which vehicle a person is riding.

## Verified starting points

- Web `home.js` takes the first running result; native `nextHomeJourney` in
  `BoardRetention.kt` / `TransitModels.swift` takes the next departure after
  honoring the retained offline answer. Both native routers stop after enough
  departure-ordered results; `routeSeed` optimizes arrival alone.
- The API defaults to six journeys and allows ten. `DeparturesWithOptions`
  requests `max(limit * 2, 10)` upstream candidates, then maps and truncates.
  Transfer caps are applied during mapping, not sent as an upstream search
  constraint. A second request with cap zero at the same time is therefore
  not a reliable way to discover a later direct service.
- `at` is floored to ten-minute buckets; requests may be at most two hours
  ahead or 24 hours behind. API fetches have a 12-second budget. Server cap
  zero is valid and has a distinct cache key; the flag can disable caps.
- Preferences currently accept `two` / `any`. Web `effectiveCap` and native
  `capped` are booleans. Zero must become an actual value, not falsy/absent.
- Native planners load six hours of connections, extending to 30 hours when
  needed. Their seed selection caps at 72, with 24 slots reserved sparsely
  for later hours. These are resource bounds, not exhaustive route coverage.
- Current focus completion uses ETA or a fix within 200 m from ETA minus
  five minutes. Focus expires at ETA plus 30 minutes. Several UI functions
  repeat the ETA test independently of controller completion.
- Providers normally stop after one fix. Web currently drops accuracy when
  converting its fix. No client has the rolling movement evidence specified here.
- Existing native trackers have their own projection and lifecycle code.
  Android background refresh shares the application state owner. iOS may not
  execute at an arrival boundary; its system timer is not a completion event.

## 1. Journey cost and candidate discovery

### Shared selection rule

For the selected saved pair and direction, choose the minimum tuple:

`(A + 300000 * changes, changes, A, D, stableJourneyKey)`

`A` and `D` are effective final arrival and initial departure, using each
leg's estimate when present, otherwise its timetable. Count service changes,
not stops or walking links. Existing mapped service-leg count minus one is
canonical; malformed times, negative duration, overlapping service legs, cancelled journeys and
incompatible modes/caps are ineligible. A new suggestion must have `D >= now`.
Do not invent a walking-to-origin threshold in this item.

A direct arriving at 10:04 beats a one-change arriving at 10:00. A direct
arriving at 10:10 loses to that one-change trip. At equal total cost, fewer
changes wins. Exact ties use the existing stable full-journey identity.
For cross-client ordering, compare that identity as an ordered sequence of
`(line name, scheduled departure milliseconds)` pairs: line names by Unicode
code point, timestamps numerically, then sequence length. Do not sort each
platform's serialized key string; JSON and delimiter encodings can order the
same services differently. Existing key encodings remain valid for matching
and deduplication.

Keep explicit/inferred focus and the existing retained offline answer ahead
of this selector. Choosing a different saved pair still follows existing
selection rules. Merely recommending a service does not pin it or infer a ride.
Cancellation replacements before departure use the same cost rule among
eligible alternatives; preserve the cancelled-service explanation. Post-
departure transfer recovery remains outside this item.

The board retains its current row count, chronology, past paging and scroll
behavior. Separate candidate data from board presentation. Home, its saved-trip
status, `lastOpen`, opening detail and pinning must all refer to the actual
chosen candidate, even if it is outside the visible six web board rows.

The pre-departure alternative rail uses the earliest catchable service with a
different first-service identity. It may leave before the recommendation:
label it `Earlier train` / `Earlier ferry` in that case, otherwise retain
`Next train` / `Next ferry`. Use its own times and freshness. The rail opens
that exact service; it must not silently pin another train. Preserve the
existing 44px rail composition and accessibility description.

### Online search: bounded, incremental, no new API

Only the active Home pair performs supplementary search. Explicitly focused
travel needs its normal exact-service refresh, not this lookahead. Boards,
past pages and background trackers do not trigger supplementary searches.

1. Request the normal first page with `limit=10` and the effective modes/cap.
   Paint cached data immediately; publish this first answer as soon as it
   arrives. Keep the board's existing presentation limit separately.
2. At most two further `limit=10` pages are allowed per search, sequentially.
   Set the next `at` to the ten-minute bucket immediately after the greatest
   effective departure returned on the previous page. Use the raw valid page
   times for the cursor, not just the filtered winning journey.
3. Stop on an empty page, no new full-journey identities, a nonadvancing cursor,
   an error, the page budget, or a cursor beyond the API's two-hour future
   window. Also stop when the next cursor is strictly later than the current
   best cost. Strictly later preserves all score tie-breakers.
4. Supplementary work has a total 12-second deadline from the first page's
   completion. Abort it when that deadline, navigation, a new selection,
   pinning, preference/flag changes or a new request generation supersedes it.
   Failure retains the best valid result already available.
5. Repeat supplementary search no more often than every 60 seconds per
   directed pair/modes/cap while Home is visible. Normal first-page refresh
   cadence remains unchanged. A user change may start one search for its new
   key. No all-saved-trips fan-out, background prefetch or retry loop.

Deduplicate full journey identity; a newer matching observation replaces the
older one. Choose among fresh eligible candidates first. A page is not made
fresh by a newer unrelated page. Apply existing retained/offline selection
when no fresh candidates exist, with the source's honest stale presentation.
No silent replacement by an older candidate just because its stale ETA has a
lower cost. A fresh successful empty search and a failed search remain distinct.

Persist up to two supplementary raw pages with the existing directed cache
entry as optional `recommendationPages`. Each carries `at`, raw body,
`serverStale`, and the numeric/null cap used to fetch it; modes come from the
parent cache key. Missing means none. Preserve each body's `generatedAt`.
Read/filter before painting. Cap mismatch makes a page incomplete for the new
search: eligible rows may be a provisional fallback, but cannot establish a
fresh completed search. Discard superseded pages on the next successful search
and delete them with their parent cache entry. Other clients may use their
native encoded equivalent; the bounded content and provenance are the seam.

The score is optimal over the eligible candidates actually found. Upstream
can omit services within a full bucket and post-filter away all its returned
routes; paging is not proof of exhaustive coverage. Do not claim a global
optimum or that no direct service exists. No undocumented upstream parameter
or quota increase is required by this design.

### Native offline search

Keep the chronological board route and its existing limits. Add a separate
recommendation result, with its source, to the planner/controller envelope so
it is not lost by the board's prefix limit. Reuse loaded connections and
realtime overlays; do not reload the timetable for each objective.

The recommendation pass examines the first 72 distinct eligible origin
services in effective-departure order, without the board pass's sparse hourly
sampling. Preserve the existing six/30-hour availability fallback. Within a
seed, retain labels by transfer count and the existing feasibility state;
select destination labels by the shared weighted tuple. Do not collapse
states with different transfer counts to the earliest arrival. Continue past
an earlier terminal arrival while another route can improve weighted cost.

A connection/next seed can only be pruned by time once its departure exceeds
the best cost, not the best arrival. Keep existing pickup/dropoff, transfer
floors, mode changes, loop exclusion and conditional long-wait rules. Resolve
long-wait exclusion before choosing the final result: the scan must also
reach the maximum unresolved long-wait endpoint among candidate paths, or
exhaust its resource bound. Enough board rows is not a recommendation stopping
condition. If 72 seeds or timetable coverage truncate the pass, return the
best eligible result found, not an empty answer or an exhaustive-search claim.

Use existing native source precedence: a successful online answer owns future
services; local recommendation is used when online is unavailable. Retained
observations must not lose known delays to an unobserved schedule result.

## 2. Direct only and stored preferences

The existing flag remains the rollout gate; this item creates no new flag and
does not change its remote setting. Add wire value `direct`, preserving schema
version 1 and all existing settings. Missing/invalid still means `two`.

| Flag | Stored choice | Request / display maximum changes | Native solver bound |
| --- | --- | --- | --- |
| On | `direct` | 0 | 0 |
| On | `two` | 2 | 2 |
| On | `any` | absent / null | 4, existing finite solver bound |
| Off | Any | absent / null | 2, existing fallback |

Replace boolean-cap APIs across clients with `maxTransfers: number?` (or
native equivalent). Absence means uncapped display/request; zero means zero.
Filter every affected surface, cache paint, recommendation page, replacement,
next-service rail and visible focus. Keep hidden focus's all-mode uncapped
refresh intact. Mode allow-lists still apply to every service leg.

Keep the row in Services, with the current value and one `Change` action.
Cycle `direct → two → any → direct`; an existing default `two` therefore
advances to `any` on its first tap. Subtitles are `Direct only`, `Up to 2`,
`No limit`. Read accessibility as title, value, Change. Use the accepted
Settings composition; no extra segmented control or explanatory paragraph.

Retain current directed/mode cache keys. Filter on every read and treat a
narrower cached result as incomplete when widening. Abort/invalidate both base
and supplementary generations on preference or flag changes, including an
A→B→A change. An excluded journey cannot flash or return after failure.
Empty direct search uses `No direct services found` in the existing empty
slot; stale/offline failures retain their existing provenance instead of
claiming a successful empty search.

## 3. One final-arrival decision

### Inputs and ownership

Introduce one pure arrival reducer per client, with the same constants and
cross-client fixtures. Inputs are focus identity, effective times, current
clock, persisted arrival metadata, permission/preference state, and the
in-memory evidence window. Output is an arrival state plus explicit proposed
writes. Rendering, tracker timers and location callbacks do not write rides.
The existing serialized controller applies writes and publishes one result to
Home, detail, expiry, ride history and tracker reconciliation.

States: `travelling`, `checkingArrival`, `arrivalUnconfirmed`, `arrived`, and
`expiredUnconfirmed`. `arrived` carries basis `location` or `estimate`.
Cancellation presentation retains priority and never creates a completed ride.

Arm the guard for this focus once the app begins permitted location sampling
while it is under way. A successful prior current-focus fix also arms it.
Persist that fact before clock settlement. A focus which never had permitted
location monitoring uses the existing estimate-based completion behavior;
this item does not leave every location-disabled trip permanently unfinished.
On restoring an old focus with no new metadata, initialize the guard before
settlement when permission is known granted. While permission is unresolved,
do not let an initial paint/clock tick settle it; query silently first.
Permission failure/denial permits the never-armed fallback, without prompting.

Once armed, loss of GPS, permission, app visibility or the location preference
never turns time alone into arrival. Turning location off immediately stops
collection and clears all raw evidence; the guard's boolean remains. An
already recorded legacy ride is not revoked merely by migration.

### Sampling and evidence constants

Sample only while the app is foreground/visible, a stored focused journey has
departed, location is enabled and already permitted, and it is not complete
or expired. This applies while browsing detail/Settings as well as Home.
Use provider updates with a target interval of ten seconds; accept no more
than one sample per five seconds. Keep at most 24 samples over 120 seconds.
Use watchPosition/clearWatch on web and foreground update subscriptions on
native. Keep one provider owner so setup lookups and monitoring do not race.
Stop on background, replacement/unpin/deletion, completion, expiry or disabled
permission/preference; reject callbacks from earlier generations. Resume with
an empty window and a new generation. Never request background location.

A position needs finite in-range coordinates, a finite timestamp no more than
five seconds in the future and 30 seconds old, and accuracy in `(0, 100] m`.
Discard duplicate/out-of-order samples. Speed is independently optional:
accept finite values in `[0, 100] m/s`; an invalid speed does not discard an
otherwise useful position. Missing speed is never interpreted as zero.

Use a time-weighted mean of adjacent valid speed samples (trapezoidal average).
It needs at least three samples spanning 30 seconds, no adjacent gap over
30 seconds, and a last sample at most 30 seconds old. Missing/invalid speed
breaks the contiguous speed window. Mean speed at least 8 m/s is sustained
vehicle-like movement; at most 2 m/s is low speed. These thresholds classify
evidence, not a vehicle identity. Do not derive train speed from GPS jitter.

Let `d` be distance to the saved destination coordinate and `r` accuracy.
`d - r >= 300 m` is credible away evidence. Destination confirmation requires
all positions in its confirmation window to have `r <= 50 m` and
`d + r <= 200 m`. Between these regions is uncertain; passing through is not
arrival. A missing destination coordinate cannot confirm arrival.

Confirm with a contiguous 30-second near-destination window and low mean
speed, using at least three positions. When speed is unavailable, require
60 seconds near destination, at least four positions, no gap over 30 seconds,
and at most 50 m separation between any pair. A known speed above 2 m/s
breaks the stationary confirmation window. Evaluate the most recent contiguous
60-second window; older motion outside it does not prevent confirmation. Confirmation may start no earlier than
`max(D, A - 5 minutes)`; all counted samples must be within that interval.

### Clock, loss and completion transitions

Apply a successful matching service refresh before evaluating arrival on that
turn. Failed/unmatched refresh retains its snapshot and honest freshness.

| Situation | State / action |
| --- | --- |
| Already confirmed at destination | Remain arrived; a later ETA cannot undo physical arrival. |
| Destination confirmation window passes | Arrived with location basis, including before ETA. |
| Guard armed, `now < A`, no destination confirmation | Travelling. |
| Guard armed, `now >= A`, fresh credible away evidence | Arrival unconfirmed immediately, whether moving or stopped. |
| Guard armed, no decisive evidence, `A <= now < A + 3 min` | Checking arrival. |
| Guard armed, no decisive evidence, `now >= A + 3 min` | Arrival unconfirmed; no automatic completion. |
| Guard never armed, accepted snapshot's ETA passed | Arrived with estimate basis, preserving the existing refresh-before-settlement rule. |
| ETA moves back into future without location confirmation | Return to travelling; withdraw an estimate-only ride as existing correction does. |

The buffer gives location resolution a chance to settle; it is not a grace
period after which contradictory evidence is ignored. A stopped train away
from destination stays unconfirmed even without a high speed reading. Losing
fresh evidence changes the copy classification, never fabricates arrival.

### Persisted metadata, expiry and correction

Extend focus with optional `arrivalGuard` metadata: `armed`, `retainedAt`,
`basis` (`location` / `estimate`, only after completion), `confirmedAt`
(only for location completion). Use the existing platform time encoding;
these fields describe state/timing only. Do not persist raw coordinates,
speeds, an evidence window or motion classifications. Missing metadata is
backward compatible; malformed individual fields are discarded and cannot
create a completion. Keep metadata tied to the full focus identity.
Location basis requires a valid `confirmedAt` no later than the current clock
plus five seconds. A lone basis string cannot confirm arrival. If `armed` is
true but `retainedAt` is missing/invalid, use the earlier of the last effective
arrival and now as its fallback; do not renew a corrupt checkpoint on every
reload. Clamp a future retention checkpoint to now before using its deadline.

Initialize `retainedAt` when armed. While foregrounded and guarded, checkpoint
it at most once a minute only on useful near/away position evidence or a
matching refresh whose ETA is still in the future. This is retention evidence,
not arrival evidence; an old/stale estimate or a render does not renew it.
An unconfirmed focus expires after both `A + 30 min` and `retainedAt + 2 h`
have passed. Use the later deadline. A continuing delayed train with useful
foreground evidence keeps its focus; reopening an old trip without evidence
does not renew it. Evaluate fresh evidence before expiry when available on
resume, allowing the normal provider lookup up to 15 seconds before applying
an overdue expiry. Expiry is silent removal, not “Arrived,” no return offer,
no ride record. Clear matching `lastOpen` so it cannot immediately reinfer.
Completed/never-guarded focus keeps the existing ETA-plus-30-minute expiry.

Location confirmation is persisted atomically with its ride write. Ride
identity/deduplication and endpoint snapshots stay unchanged. Existing ride
arrival fields retain the service's effective arrival estimate, not the phone
sample timestamp; `confirmedAt` separately supplies the location completion
latch. A matching refresh can update the ride's effective times after physical
arrival without removing it. Estimate-only rides remain revisable/withdrawable.
Guarded unconfirmed/expired trips never enter completed-ride history. An
existing same-identity recorded ride restores the old completion behavior when
there is no new metadata; migration does not rewrite past rides. A plain
restore preserves a legacy ride even before ETA; a successful matching refresh
that moves ETA into the future may withdraw it under the existing correction
rule. A stale render or unmatched/failed refresh cannot perform that withdrawal.

No new “I'm not on this” or “I've arrived” control. Explicit pins retain their
existing unpin action. Pinning another service, inferred Change destination,
and deletion keep their existing correction roles. New focus identity clears
the old guard/window and starts independently. Browsing another board does
not complete, replace or renew focus by itself.

### UI and existing native tracker consumers

Use C1's accepted composition and existing type hierarchy. Keep the last ETA
and destination instruction visible; the provenance is `Last estimate`.

| Arrival evidence | Header status | Main figure / instruction |
| --- | --- | --- |
| Checking arrival | `Checking arrival` | Dash; `Checking arrival at <destination>.` |
| Fresh away plus sustained movement | `Arrival uncertain` | Whole minutes `Past estimate`; `Still on the way to <destination>.` |
| Stopped away, ambiguous or missing position | `Arrival unconfirmed` | Dash; `Arrival time needs an update.` |

Minutes past estimate uses nonnegative floor elapsed minutes; in its first
minute use a dash rather than a misleading zero. Never print `0 min TO GO`,
`Trip over`, “You've arrived,” or a return offer for an unconfirmed trip.
Keep existing offline/stale source indication independently of arrival status.
For never-guarded estimate completion, replace the existing personal claim
“You've arrived” with `The scheduled trip has ended. The return trip is ready.`
when schedule-only, or `The last arrival estimate has passed. The return trip is ready.`
when an estimate exists. Location-confirmed completion keeps the existing
arrival/return composition and wording.

The shared arrival state must override all repeated UI `now >= A` tests.
Journey detail's final step does not become done solely from ETA for the
matching guarded focus; other timetable rows retain their normal time styling.
Native tracker lifecycle must not end/suppress the session, or settle a ride,
solely because its projection reaches the final endpoint. Publish the same
unconfirmed semantics using its existing quiet instruction/context rows.
In the background, no new GPS collection occurs: a guarded session remains
unconfirmed until permitted foreground evidence, correction or expiry.
iOS cannot promise a fresh transition while suspended; keep its published
absolute last estimate and established stale fallback, and reconcile before
publishing on resume. OS removal of a surface is not completion. Preserve
existing dismissal suppression, identity generations and serialized ownership.

## 4. C1 progress and cabs

Accepted references: [C1 calibration](../../../assets/comps/latest/commute-feedback/README.md).
The durable source lives beside the references; the original workshop was
`/tmp/trains-comps-commute-feedback-r1`. The final workshop checked 72 frames,
including transfer boundaries in both sizes/schemes. Those are comp checks,
not proof of product implementation.

Keep route widths, transfer gaps, pin geometry and marker shape unchanged.
Overlay 62% of the actual page ground on the travelled portion: the retained
route contribution is 38%. Composite the same overlay above completed transfer
chip fills AND numerals, keeping the chip opaque over the route underneath.
Both chips stay full contrast during the change and fade together when the
next leg starts according to existing timetable/live-estimate phase rules.
Upcoming chips and the active marker keep their normal contrast. Apply only
to progress-bearing active journey axes, not every historical board row.

Time-based progress remains a time inference. Before ETA use the existing
fraction, bounded below 100% while guarded and unconfirmed. At/past ETA, hold
at 98% until confirmed; this is a visual pending-end position, not a measured
location. Show the held marker only with fresh away/moving evidence; otherwise
hide it while retaining the faded route. The comp's illustrative 93% overdue
position is not the production algorithm. No reversal or acceleration animation
is required when an updated ETA changes the fraction. Respect reduced motion.

The selected completed-platform treatment intentionally reduces contrast;
keep full platform text available in accessible journey instructions/detail.
Do not apply it to a currently actionable platform. Before/during/after frames
must use correct action countdowns and instructions; the visual clock deltas
in comps must not accidentally redefine the product's next-action countdown.

The final tiny-train target is an eight-car Waratah-style set: two outward
driver's cabs and six square-ended middle cars. Each visible side has two
yellow paired passenger doorways per car, one near each end of its passenger
saloon, including the driving cars. Keep the two decks of saloon windows
between the doorways. Passenger doors must remain distinct from the driver's
windscreen and cannot disappear when a car has a cab. This is a small stylized
drawing, not an engineering-scale reproduction.

Reference: TfNSW's [Waratah driving and motor-car drawings](https://transportnsw.info/travel-info/ways-to-get-around/train/fleet-facilities/waratah-trains)
and the ATSB's [eight-car formation description](https://www.atsb.gov.au/investigations/ro-2018-004).
The revised reproducible cab target is in
`assets/comps/latest/commute-feedback/cab/`. Port its approved geometry and
palette consistently to SVG, Canvas and Compose; do not preserve the old grey
single-door slit or omit passenger doors on driving cars.

Retain the 18px lane, 2,600ms run, 650ms reduced-motion display, repeated-tap
and accessibility behavior. Derive consist width from eight cars and their
gaps; update animation endpoints and reduced-motion fitting so all eight fit
without clipping on the shortest legal lane. Do not shrink surrounding UI to
make the train fit. Only terminal cars may have a sloped cab body, nose,
windscreen or headlight. Verify all 16 visible passenger doorways, mirrored
rear cab, square middle ends and window/door separation in both schemes.

The original rear-cab-only patch exists locally in `web/js/tiny-train.js`,
Android `TinyTrain.kt` and iOS `TinyTrain.swift`, with SW v55 and UI-contract
text. It is uncommitted and unreleased, still has six cars and incomplete doors,
and needs the above revision. Earlier web 369 tests, Android unit gate, iOS
132 tests and web cab captures passed for that superseded geometry; they do
not verify the new eight-car target. Native captures and final gates remain.

Comp defect carried into verification: the first mockup reused a sloped body
path on its middle cars and made its windows one pixel too tall. The initial
comp-only correction fixed that mismatch; the subsequent owner door/count
steer intentionally changes the target beyond the old production geometry.

## 5. Build invariants and contract changes

The build plan owns concrete files, fixtures and gates. At implementation:

- Update PROJECT.md's next-departure/two-choice wording and the API contract's
  client-search description without changing its stateless interface.
- Update client-storage.md for numeric caps, candidate-page provenance, shared
  arrival state, optional metadata, retention and ride reconciliation.
- Update ui.md for C1, three Settings values, alternative-rail wording and
  arrival states; update native-data.md for the bounded recommendation pass.
- Update Android/iOS deviations for foreground sampling and tracker limits.
  No location, saved trips, rides or motion evidence enters API requests,
  analytics, logs or crash breadcrumbs. No analytics vocabulary change.
- Keep raw cache data separate from display filtering and source freshness.
  No render-time writes, secondary personal-document writer, fake arrival
  from a timer, or freshness inherited from another journey's response.
- Bump the current SW version when any shell-listed implementation changes.
  Do not assume v55 is still the latest in the build session.

Rejected shortcuts: sorting only six results; adding a direct-only server
post-filter probe at the same time and claiming it broadens search; choosing
one earliest-arrival native path before applying transfer cost; treating cap
zero as false; a Home-only arrival guard; letting missing GPS imply arrival;
using a fixed maximum delay to override continuing travel; and adding transfer
recovery or background location to this item.

## Handoff boundary

Design and plan are complete. This session changes documentation/calibration
packaging only; it does not implement the remaining features or release the
cab patch. The checkout contains unrelated tracker, Settings, deletion and
website work: inspect current diffs and coordinate overlapping files before
building; never reset, bulk-stage or accidentally ship that work. Never read
or source `.env`, directly or indirectly, without explicit owner permission.
