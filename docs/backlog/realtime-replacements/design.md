# Native realtime: replacement trips, platform changes and added services

Stage: design. Opened 2026-09-07 from finding 2 of the
[timetable-realtime reliability investigation](../timetable-realtime/investigation-2026-09-07.md).
No build plan exists. Depends on the Sydney Trains service-date resolver and
the per-relationship freshness policy being repaired first under
`timetable-realtime`; without them the Sydney Trains feed normalizes to zero
updates and nothing here can be exercised on real data.

## What and why

The native Android and iOS apps route over a bundled timetable and overlay a
realtime snapshot. Today that overlay only knows how to adjust the times on
connections that already exist in the static timetable. TfNSW's Sydney Trains
feed expresses platform changes, added or skipped stops, reroutes, changed
origins and early terminations as `REPLACEMENT` trips whose stop list differs
from the static pattern, and adds trips that do not exist in the static data
at all ([Train v3.7, section 5.1](https://opendata.transport.nsw.gov.au/sites/default/files/2026-04/Real%20Time%20Train%20Technical%20Document%20v3_7_Open_Data.pdf)).

When the phone is online, Trip Planner already reflects these changes. The gap
shows offline and for a focused journey created by local routing: the app can
show a train at the wrong platform, keep showing a connection that now
terminates early, or omit a replacement service that is actually running.

## Evidence (captured 2026-09-06, replayed 2026-09-07)

- The Sydney Trains capture holds 88 `REPLACEMENT` updates. 15 include stop
  IDs absent from that trip's static stop pattern. None use `assigned_stop_id`.
- Example: `Y476.442.149.128.D.10.91066680` moves Wyong from platform 1
  (`2259941`) to platform 3 (`2259943`). Its trip timestamp equals the feed
  header, so it is fresh by any freshness rule.
- Two `ADDED` trips have no static trip row. Metro's capture has 11 `ADDED`
  updates, none in its static trip table.
- Captures and hashes: `tools/fixtures/gtfs_realtime_summary.json`; raw
  protobufs in `/tmp/trains-gtfs-20260906-design` while that directory
  survives. Replay with `go run tools/diagnose-realtime.go <dir>`.

## As built

- `internal/native/realtime.go` passes trip status and per-stop
  `assignedStopId` through to the snapshot. It does not distinguish a
  replacement that merely re-times stops from one that changes the stop list.
- `OfflineRealtime.kt` and `OfflineRealtime.swift` iterate existing static
  connections. A platform change is recognised only through `assignedStopId`,
  which Sydney Trains never sends. A replacement whose update lacks one of a
  connection's two stops cancels that connection. No connection is ever
  created from a replacement's own stop list, and added trips are dropped.
- `docs/contracts/native-data.md` records this as the current rule: "A
  replacement trip uses only static connections whose two stops remain
  explicitly present in its update. Added or unscheduled trips without a
  static stop pattern cannot be routed locally."

## Mechanism to design

1. **Replacement stop patterns.** A `REPLACEMENT` update carries a complete
   stop list. Build the trip's connections from that list, in the source's
   stop table, and use them instead of the static pattern for that service
   instance. A stop present in the static pattern but absent from the update
   is not served; a stop present in the update but absent statically is a
   new boarding or alighting point. A platform change is then just a stop ID
   swap within the same hub and needs no `assignedStopId`.
2. **Added trips.** An `ADDED` update with a full stop list and times is a
   routable trip with no static row. Decide whether local routing admits it
   (line and headsign must come from `route_id` and the feed, not the static
   trip table) or whether it stays the online fallback's job.
3. **Structural validity versus prediction freshness.** A changed stop list
   or cancellation stays true for the service day; a delay prediction ages in
   seconds. Apply the freshness policy settled under `timetable-realtime`
   so that a fresh snapshot never drops a platform change because its trip
   timestamp is old.
4. **Focused journeys.** A focus pinned to a static connection must follow
   its replacement: same trip identity, new platform or stop, or an honest
   "this train no longer stops here" state. Define the copy under the
   `user-facing-copy` skill when the states are known.
5. **Fixtures.** Real-source fixtures for the Wyong platform swap, a
   cancellation, a skipped stop, an early termination that breaks a transfer,
   and an added trip, on both native clients.

## Decisions

- 2026-09-07, owner: opened as its own backlog item, separate from the
  Sydney Trains date-gate and arrival-cache repairs in `timetable-realtime`.

## Open questions for the owner

- Should locally routed boards admit `ADDED` trips at all, or only re-time
  and re-platform trips that exist statically? Admitting them changes what a
  scheduled-only offline board can claim.
- Is the current online-first merge (an online answer wins over local future
  services) staying? If so this item only changes offline and local-focus
  behaviour, which bounds its verification scope.

## Rejected

- Treating a missing `assignedStopId` as "no platform change": the Sydney
  Trains feed never sends it, so this silently hides every platform change.
- Cancelling any replacement connection whose stops are not both present:
  correct as a safety floor, wrong as the final behaviour, because it turns
  a platform move into a phantom cancellation.

## Ready when

`design.md` names the admitted trip classes, the focus states and their
copy, and the fixture list; then a phased `build_plan.md` with backend
(normalizer), Android and iOS phases and captured-feed end-to-end gates.
