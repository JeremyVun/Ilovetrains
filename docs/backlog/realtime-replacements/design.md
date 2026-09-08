# Realtime replacement trips across web, Android and iOS

Stage: ready for build. Execution: [build_plan.md](build_plan.md).

## Scope

Owner ruling, 2026-09-08: “ok, then lets do replacement trips. web,
android, ios”. This follows the decision to implement replacements first;
new `ADDED` services are outside this item.

Changed platforms must become the platforms shown to the rider. Replacement
stopping patterns determine where a locally planned train can be boarded and
left. A pinned journey follows its selected service without silently choosing
another train or claiming it still reaches a removed stop.

Keep the existing architecture and online-first authority: web uses Trip
Planner and cached answers; native clients also construct routes from the
bundled timetable and shared snapshots. No new web timetable, cross-feed
identity guess, setting, feature flag or server-side personal state.

Read [native-data](../../contracts/native-data.md), [API](../../contracts/api.md),
[storage](../../contracts/client-storage.md) and [UI](../../contracts/ui.md).
Concurrent `persistent-travel-tracker` work touches native models, refreshes,
presentation and these contracts. Preserve its partial-focus freshness and
tracker session behavior; do not revert or commit that work incidentally.

## Verified starting point

- `internal/native/realtime.go` preserves replacement status, stop array order,
  IDs and absolute event times. It drops individually invalid stops, which is
  unsafe if the remaining array becomes a replacement route.
- Both `OfflineRealtime` implementations only modify static connections. They
  cancel replacements with absent endpoints and resolve platform changes only
  through `assignedStopId`.
- `OfflinePlanner` queries a static time window before overlaying updates.
  Replacing only those connections misses services moved into the window.
- Native focus and cache keys use line plus scheduled departure;
  `focusAfterRefresh` rejects changed keys. Retained boards can resurrect a
  static journey that replacement routing has excluded.
- Web `journeyKey` uses every leg's line and scheduled departure. Focus refresh
  replaces the entire matching snapshot, including platforms. The backend maps
  returned endpoints/platforms but publishes no exact GTFS identity for an
  online leg. A missing result does not prove cancellation or a changed route.

## Evidence and correction

Source: `tools/fixtures/gtfs_realtime_sydneytrains_20260906.pb`; the adjacent
JSON records its SHA-256 and capture time. Rechecked 2026-09-08 against the
bundled SQLite package after verifying the protobuf hash:

- 88 raw replacements; 39 trip IDs occur in the passenger package. Of those,
  15 introduce a stop ID absent from the static trip pattern. None supplies
  `stop_sequence`; all referenced stops resolve in the package. One update
  has only one stop. These are membership counts, not usable-route counts.
- Passenger trip `535U.442.149.128.A.8.91065455` (T5) changes Clarendon from
  platform 2 (`2756432`) to 1 (`2756431`). The update ends there with arrival
  only; the static route continues to East Richmond and Richmond. Preserve
  that combined platform/termination shape in the real fixture.
- `N785.442.149.128.D.4.91064470` (CCN) changes Gosford platform 2
  (`2250792`) to 3 (`2250793`), supplying a suffix of its static pattern.
  `N675.442.149.128.D.10.91511020` changes Gosford to platform 1.
- The previous Wyong example `Y476.442.149.128.D.10.91066680` is excluded
  from the passenger package. Its static stops prohibit pickup/drop-off
  throughout; its update has one arrival. Use it as an exclusion test, never
  as the positive passenger-routing gate.

[TfNSW Train v3.7 §5.1](https://opendata.transport.nsw.gov.au/sites/default/files/2026-04/Real%20Time%20Train%20Technical%20Document%20v3_7_Open_Data.pdf)
lists changed platforms, stopping patterns, origins and termini among
replacement cases. Its example uses ordered stop IDs and absolute event times.
Retrieved 2026-09-08 with `curl` after web extraction returned 403. The capture
must drive tests rather than assumptions about optional GTFS fields. Missing
historical prefix stops must not retrospectively cancel a journey under way.

## Native pattern construction

### Admission, generation and ordering

Admit only exact `(source, tripId, serviceDate)` replacements of trips in the
active passenger timetable. Reuse the trip's line/mode; realtime route names
do not establish passenger eligibility. Keep service-date resolution, package
coverage, mode limits and transfer floors.

Capture an immutable snapshot view per plan/refresh and resolve against one
active database generation. Invalidate derived patterns and static reference
caches together on package activation. Enumerate fresh replacements independently
of the static query window and load their complete static patterns/metadata.
Remove every static connection for the affected instance, construct its
replacement, then apply the effective-time horizon and ordinary sort order.
Never mutate the cached static list. An invalid or one-stop replacement yields
no route and cannot restore a contradicted static service while fresh.

Array order is travel order. Do not sort by stop IDs, times or static sequence.
Supplied sequences must be coherent, increasing and unique. Missing sequences
use deterministic router ordinals; retain static occurrence matching separately.
Resolve stops through their own source's stop table, including station objects
and platform labels. Resolve sequence-only updates through an unambiguous
static occurrence. `assignedStopId` supplies the effective stop when present;
an unresolved assignment cannot silently retain the old platform.

Match a platform move to the original occurrence only through a unique,
order-preserving same-hub match. Repeated hubs/loops must never match the first
hub indiscriminately. Ambiguous static correspondence does not invalidate an
otherwise explicit route, but cannot supply scheduled baselines or authorize
a focused-endpoint match.

### Timing and passenger calls

- Absolute events win. Delay-only events need an exact or unambiguous same-hub
  static occurrence and its scheduled time. Preserve current `noData` and
  carried-delay behavior for matched stops. Never invent an inserted stop's
  time from a nearby stop or a trip-wide delay.
- Every edge needs origin departure and destination arrival. The first stop
  need not have arrival; the terminal need not have departure. Require finite
  times, nonnegative running/dwell times and monotonic travel. Unknown stops
  or missing required events make the pattern unavailable; do not stitch
  disconnected valid fragments together.
- Omitted stops are absent from the advertised pattern. `skipped` stops cannot
  be boarded/alighted at. A skipped timing point without times can be omitted
  between two explicitly timed served neighbours, because this is an explicit
  non-stop instruction. Fewer than two usable stops creates no connection.
- Preserve static pickup/drop-off restrictions for matched calls, including
  platform moves. A timing point must not become boardable merely because it
  appears in an update. Newly inserted calls require a real passenger hub,
  an explicit absolute event for the intended boarding/alighting, and neither
  `skipped` nor `noData`. Ambiguous correspondence to an existing restricted
  occurrence is not evidence of a new unrestricted call.
- When the terminal changes, use its station name as the headsign. Do not
  advertise Richmond on a train now ending at Clarendon.

Keep original scheduled times when a static occurrence is matched. Introduce
optional native per-endpoint schedule-known metadata, defaulting to true for
old stored data. A new call without a static time uses its explicit event as
the required numeric anchor and effective observation. Do not derive delay,
`SCHEDULED` provenance or punctuality from that artificial baseline. Subsequent
refreshes update its effective time, preserving an existing focus's initial
identity anchor. This avoids a global journey-key migration.

### Backend validity seam

Add optional `replacementPatternValid` to replacement updates. Publish false
if any supplied stop cannot be normalized or supplied ordering/event values
are invalid. Retain identity/status so clients suppress the static service;
never silently shorten an invalid replacement into a valid-looking pattern.
Other trip classes retain current normalization. True describes syntactic
integrity; passenger joins and usable timing remain client checks. A one-stop
pattern can be syntactically valid but unroutable.

Keep schema version 1; the field is additive. Clients accept its absence from
older servers and validate the supplied list locally, but cannot recover a
stop an old server discarded. Deploy the normalizer before or with clients
and document that compatibility limit. Update API/native-data contracts in
the implementation change.

## Focus, retained boards and freshness

Use the same prepared pattern for routing and focused endpoint resolution.
A focus keeps the user's selected hubs, service identity and scheduled/identity
anchors. Update platforms, effective stop IDs/occurrences, times and headsign.
Persist enough occurrence information to refresh again after restart. A platform
move cannot unpin a train, create another ride or restart/dismiss its tracker.

A removed/skipped future endpoint makes that leg unusable. Keep the selected
journey and a structured reason; never move the rider to another station or
choose another service. If a missing boarding endpoint's retained effective
departure is before the observation header, preserve that historical endpoint
and refresh the served destination. A missing historical prefix alone proves
neither cancellation nor boarding. Ambiguous matching or malformed data is
unconfirmed, not a definite removed-stop claim. Use the source observation
clock and retained effective times, not receipt time or scheduled time alone.

Recompute existing tight/broken-transfer behavior when the served destination
moves later than an onward departure. New planning can find another itinerary;
a pin retains the selected services and shows the problem. Apply matched updates
before ride settlement. A known unusable leg cannot imply successful arrival.

Before cache merge, project fresh replacement observations onto retained local
journeys with exact identities. Corrected structure/platforms must win even
without a numeric delay or when the new local board is empty. Do not resurrect
a removed endpoint as a usable cached future service. Retain clearly unusable
rows where history rules require them, excluding them from next-service
selection. Online journeys without GTFS identity retain online authority and
their existing retention rules.

Preserve header + 90-second expiry, old-header rejection and relationship-based
trip timestamp admission. An old trip timestamp cannot erase an accepted
structural update. Do not add a second service-day cache after snapshot expiry.
Expiry or removal from a newer snapshot restores scheduled values for new
plans; previously displayed journeys retain their last observation and stale
provenance. Partial focused updates retain unmatched legs and the conservative
source clock. Structure-only observations must not falsely certify arrival.

## Web and presentation

Web keeps Trip Planner. Verify returned platform, headsign, time and leg changes
through backend mapping, cached-to-live boards, focused home, detail and reload;
fix failures found. Preserve all-leg matching so a different onward service
cannot steal the focus. A stable scheduled-key platform/headsign change must
update the pin. Changed scheduled keys, changed leg count or absence of a
matching journey retain the last snapshot with stale provenance.

There is no verified cross-feed identity to do stronger matching on web or
online-native focuses. Do not add nearest-time matching or infer removal from
an empty response. This is the online path's explicit coverage boundary;
direct GTFS focus tracking in the browser is separate work.

Use existing exception/status slots and platform typography, without a new
screen or layout direction. Copy follows `user-facing-copy`:

| Evidence | Presentation |
| --- | --- |
| Platform move, selected endpoints served | New platform in its usual position |
| Future selected endpoint removed/skipped | `Service changed`; `No longer stops at {station}.` |
| Pattern cannot be resolved safely | `Service changed`; `Updated stops unavailable. Check another service.` |
| Actual cancellation | Existing `Cancelled` wording |
| No fresh matching observation | Existing stale/last-known wording |

Use optional native leg reason data, not persisted prose. Derive one unusable
predicate for selection, pin actions, progress, settlement and tracker projection.
Reserve `cancelled` for actual cancellation; a platform move is not cancellation.
Apply the reason in home, saved row, board, detail and existing tracker surfaces.
Use planned/unavailable arrival treatment rather than achievable directions for
unusable journeys. Persist reasons/schedule-known metadata with compatible
old-data defaults; update storage/UI contracts with the implementation.

## Verification and excluded work

Commit minimal extracted fixtures with capture/package hashes, exact service
dates and declared synthetic deltas. Use the production date resolver and
captured clock. Builds must not depend on surviving `/tmp` captures. Both
native clients consume identical expected connections and forbidden routes:

- Clarendon platform/termination; Gosford platform/suffix; cancellation;
  inserted call; skipped intermediate/endpoint; changed origin; broken transfer.
- Loop/repeated hub; unknown source/stop/trip; malformed/one-stop pattern;
  missing event; delay-only/noData; non-passenger and timing-point exclusions.
- Outside-static-window service; old trip timestamp/fresh header; expiry;
  snapshot removal; package switch; empty local result with retained board;
  persisted focus refreshed twice; partial-source refresh and tracker identity.

Web/API fixtures cover returned changed details, matching pin refresh, unmatched
stale pin, alternate onward service and cache reload. Synthetic Trip Planner
deltas test our consumers, not live upstream disruption behavior. Drive real
clients through cache → fresh replacement → stale → reload at documented phone
sizes and schemes, including affected native tracker projection. Follow
`tools/README.md` and existing calibration geometry.

`ADDED`/unmatched `UNSCHEDULED` services, general alerts, walking graphs, web
offline routing and cross-feed identity discovery remain separate work. No
owner scope questions remain; evidence and implementation failures are build
gates, not permission to silently weaken these rules.
