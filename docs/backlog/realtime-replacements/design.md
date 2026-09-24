# Replacement trips: stop false cancellations on phones

Stage: ready for build. Execution: [build_plan.md](build_plan.md).

## Owner rulings

- 2026-09-08: “ok, then lets do replacement trips. web, android, ios”.
- 2026-09-13: TfNSW replacement patterns must be accurately reflected to avoid
  incorrect travel advice.
- 2026-09-14: “yea it probably does make sense to do a smaller scoped change
  here. proceed carefully”. This replaced the earlier design, which built
  full replacement routing across seven phases. Git holds that version.
- 2026-09-14: when a replaced train no longer reaches a pinned stop, the
  pinned trip keeps the existing `Cancelled` wording. The alternative line
  “No longer stops at {station}” was declined.
- 2026-09-14: when a replaced train now ends early, the destination it shows
  becomes the station where it now ends.
- 2026-09-14, after adversarial review: the server flags a replacement it
  had to shorten, and phones treat that train exactly as they do today.

## What changes for the rider

On the day, Sydney Trains sometimes changes a train: it moves the train to
another platform, ends it early, starts it later on its route, or reroutes it.
The live feed announces each change as a replacement stop list for that train.

The website and online phone boards use Trip Planner, which already reflects
these changes. The phones also plan from their bundled timetable when offline
or before the online answer arrives, and they refresh a locally planned pinned
trip from the live feed. Those phone paths are wrong today:

- A platform change at any station on a rider's trip makes the train vanish
  from the phone's own results. If it happens at the rider's pinned boarding
  or alighting station, the pinned trip shows `Cancelled` and Home offers a
  different train.
- Replacement stop lists omit the stations an express runs through without
  stopping. The phone treats each omitted station as a break, so the train
  vanishes for any ride through one of them.

After this change, the phone shows the train at its new platform. It keeps
riders on express trains through stations the train passes, and shows the new
end station as the destination. A train that no longer reaches the rider's
station still counts as cancelled for that rider, as it does today.

## Evidence

Source: `tools/fixtures/gtfs_realtime_sydneytrains_20260906.pb` (SHA-256
`2994403111f2dfa78a50002f1a4b8777d8973ce09c49cc34419b3a2398ad5dd7`, received
2026-09-05T15:33:59Z, which is 01:33 Sunday in Sydney), compared with the
bundled package `native-data/bootstrap/b17e6a59…d8fadd.zip`. Verified
2026-09-14. One late-night weekend capture cannot tell us how often this
happens on a weekday.

- 86 replacement updates carry stops. 39 of them are trips in the passenger
  package, and 23 of those are not `Empty Train` runs. No update supplies a
  stop sequence or `assignedStopId`. Every stop's relationship is
  `SCHEDULED`, and every stop ID resolves in the package.
- The stop list is in travel order. Sort it by nothing.
- 21 listed stops are another platform of a station on the timetabled trip.
  Examples: T5 `535U.442.149.128.A.8.91065455` Clarendon 2 → 1; CCN
  `N785.442.149.128.D.4.91064470` Gosford 2 → 3; T1
  `149M.442.149.128.A.8.91064550` Lidcombe 2 → 4 and Parramatta 2 → 4.
- 192 omitted timetable stops are stations the timetabled train runs through
  without stopping (no pickup and no drop-off). Every one of the 62 omitted
  stops where passengers could board or alight lies beyond the first or last
  station the update still serves. These are the Richmond trains
  ending at Clarendon, `140M…`/`152R…` rerouted round the City Circle instead
  of reaching Milsons Point and North Sydney, and Newcastle trains starting at
  Gosford or Wyong.
- The only new stations are Circular Quay, St James and Museum on the two City
  Circle reroutes. Here Central appears twice (platforms 17 and 22).
- Updates in this capture keep stops the train has already passed. For
  example, `N785…` still lists Gosford at 00:18 at the 01:33 capture.
  GTFS-realtime still lets a producer drop past stop updates, so pinned
  trips guard against it (pinned rule 3).
- Only Sydney Trains' replacements were checked. In the same capture, NSW
  TrainLink, Metro and Ferries carried 2, 3 and 4 replacements
  (`tools/fixtures/gtfs_realtime_summary.json`), and those feeds supply stop
  sequences.
- Replay of every timetabled ride on the 23 trips: 6,527 boarding/alighting
  pairs, 4,968 of which the replacement still serves in order. Today's planner
  refuses 1,099 of the served pairs; today's pinned-trip refresh marks 266 of
  them cancelled. Under the rules below, no unserved pair is offered and no
  served pair is marked cancelled. The only served pairs still refused are
  the 370 whose ride crosses the time fault on `N782…` or `N601…` (below).
  Today's planner refuses those too. The replay used the real timetable
  times, carrying and clamping delays through passed stations (rule 3). The
  only connections that run backwards are the two feed faults. On `N782…`
  that is Gosford → Point Clare. On `N601…` it is the run after Strathfield,
  because the feed puts Strathfield's departure after Epping's arrival. No
  hand-off between connections breaks. Of the served pairs, pinned trips are
  usable for 4,915 and unconfirmed for 53, whose departure is after their
  arrival. The 1,559 unserved pairs are all cancelled.
- Trip Planner already reports live platforms. In
  `tools/fixtures/trip_central_parramatta.json`, Central shows `platformName`
  Platform 13 against `plannedPlatformName` Platform 12. The mapper prefers
  `platformName` (`internal/tfnsw/map.go`, `platformName`).
- Separate finding, out of scope: 2 of 86 replacements have times that run
  backwards. `N782.442.149.128.D.6.91065721` lists Ourimbah to Gosford about an
  hour late, then Point Clare earlier. `N601…` has a 1–2 minute reversal.
  No scheduled update runs backwards by more than 60 seconds. Phones already
  show those feed times for exactly matched stops. The router skips any
  connection whose arrival precedes its departure (`OfflineRouter.kt`,
  `routeSeed`), so this change cannot offer a ride across the fault.

## Current behaviour

Both `OfflineRealtime` implementations join an update stop to a connection
endpoint only by exact stop ID or sequence (`StopUpdate.matches`). A
`replacement` update with either endpoint absent sets `cancelled`, in the
planning overlay and in the pinned-trip overlay. The router ignores cancelled
connections and continues a trip only from the previous connection's
`toSequence`. One cancelled connection therefore makes the train unusable
across it. Local boards contain only routed journeys, so the train vanishes.
`refreshFocused` applies the journey overlay to a pinned local trip. A
cancelled pinned trip before departure makes Home show the next working train.
`docs/contracts/native-data.md` states the current rule: “A replacement trip
uses only static connections whose two stops remain explicitly present in its
update.”

## Rules

Only `replacement` updates from the `sydneytrains` source change. Replacements
from other sources keep today's exact matching until they are captured and
checked. Scheduled, added, unscheduled and cancelled handling stays as it
is. So do stored data, copy and layout. The server gains one flag, described
below. Android and iOS implement the same rules.

### Server flag for shortened replacements

`NormalizeRealtime` drops a supplied stop that `normalizeStop` rejects: one
with neither stop ID nor sequence, or an unknown relationship. The rules
below read meaning into what is missing, so a shortened list could, for
example, name the wrong end station. For a `replacement` update that lost
any supplied stop, publish an optional `stopsDropped: true`, and count such
updates in `RealtimeCounts` so the refresh log shows whether it ever happens.
Omit the field otherwise. Schema version 1 stays; the field is additive, and
current clients ignore it.

Phones apply today's exact matching to a trip whose update carries the flag:
- no platform moves
- no passed stations
- no clamping
- no new headsign

An old server sends no flag, and phones then apply the rules below. The
capture has no dropped stops.

### Stations of update stops

An update stop's station and platform come from looking up its `stopId` with
the existing stop-assignment lookup of the same source (`assignmentFor`),
memoized per plan or refresh as today. A stop without a `stopId`, or one the
timetable cannot resolve, matches nothing. Matching never uses
`assignedStopId`. After a match, an `assignedStopId` replaces only the
platform. As today, it cancels the connection or leg if it resolves to a
different station.

### New plans

Apply per replaced trip, to its complete timetabled stop list. Read that
list from the database once per replaced trip, not from the loaded window.
Each loaded connection then takes its stops' outcomes by sequence.

1. Walk the trip's stops in order with a cursor into the update's stop list.
   For each stop, take the first update stop at or after the cursor that is at
   the same station, on any platform. Then move the cursor past it. Never
   search backwards or reorder the list.
2. A matched stop takes its times from that update stop exactly as an exact
   match does today: absolute events, stop delays, `noData` and the carried
   delay. When the matched stop ID differs from the timetabled one, the
   platform becomes the matched stop's platform. An `assignedStopId` is then
   applied as described above. Timetable pickup/drop-off restrictions are
   kept; `skipped` keeps its meaning.
3. An unmatched stop between the first and last matched stops is passed
   without stopping. Nobody boards or alights there; set pickup and drop-off
   to unavailable, as `skipped` does. Connections through it stay usable. Its
   times follow the carried delay, as for a stop missing from a scheduled
   update. Then clamp them: never earlier than the previous matched stop's
   effective departure, and never later than the next matched stop's
   effective arrival. Effective means the update's estimate when there is
   one. Otherwise it is the timetable time, as when `noData` or a missing
   event leaves no estimate. Nobody
   uses these times except to stay on board, so the clamp only keeps a train
   that made up time from looking backwards. When the feed's own times at the
   two matched stops run backwards, the clamp leaves that fault in place, and
   the router still refuses the ride.
4. An unmatched stop before the first or after the last matched stop is no
   longer served. Every connection touching it is cancelled. With no matched
   stop, every connection of the trip is cancelled.
5. The new end is the update's last stop that is not `skipped`. It may be at
   a different station from the trip's timetabled last stop. Then every
   connection of the trip takes that station's `shortName` as its headsign.
   If the new end's stop does not resolve to a station, keep the timetable
   headsign.

When a station repeats, the walk can pick a different visit than intended.
Any match it makes pairs real visits in travel order. So the choice can only
change which true visit a rider is shown, or leave the train unoffered, as in
a timetabled loop whose earlier visit the replacement removes. It never
offers a train that does not go there.

### Pinned trips

Apply per leg, using the leg's boarding and alighting stations and timetabled
stop IDs.

1. A valid pair is an update stop at the boarding station listed before an
   update stop at the alighting station. If there are several valid pairs,
   use the one where both stop IDs match exactly.
2. With one pair chosen, the leg takes that pair's times and platforms, as an
   exact match does today, including a moved platform. Apply the headsign rule
   above; the refresh supplies the trip's timetabled last station.
3. The leg is `Cancelled` if the update lacks the boarding or alighting
   station, lists them only in the wrong order, or marks either `skipped`.
   Home then moves the rider to the next working train, as it already does.
   The exception is a missing boarding station on a leg whose retained
   effective departure is before the snapshot's header. That may be history
   the producer dropped, so the leg is unconfirmed instead (rule 4). It keeps
   its last known values, including any cancellation an earlier refresh
   applied. So a dropped prefix can neither cancel a ride under way nor
   revive a cancelled one.
4. Several valid pairs without a unique exact pair leave the leg unconfirmed.
   So does a resolved departure later than the resolved arrival. Treat an
   unconfirmed leg as having no fresh update: leave it out of
   `matchedLegIndices`. The existing partial-refresh rules then keep its last
   known values and show it as `LAST KNOWN`.

Platform and headsign are not part of the journey key or the tracker identity
(`journey.key` is line plus scheduled departure). So a platform move or new
end cannot unpin a train, create another ride, or restart or dismiss the
tracker. Both values are already stored with each leg. A pinned trip keeps the
last observed platform and headsign when the update expires or disappears. New
plans return to timetable values, as the contract already requires for
platforms.

### Web and online answers

No production change. Add proof: a Go mapping test that the Central leg of
`trip_central_parramatta.json` shows Platform 13; a web test that a pinned
trip refreshed with the same lines and scheduled departures takes a new
platform; and a check that a journey with a different onward service still
cannot take the pin.

## Not in this item

- Boarding at stations a replacement adds, such as the City Circle stations
  on a reroute; services whose new times move them into the search window;
  `ADDED` and `UNSCHEDULED` trips.
- The “No longer stops at {station}” wording (declined 2026-09-14).
- A retained cached board row that outlives a train cancelled by a
  replacement. This is the same existing behaviour as for a real
  cancellation.
- Replacement updates whose times run backwards: a separate roadmap
  candidate.

## Contracts

In `native-data.md`, replace the replacement sentence and the matching
platform paragraph with the rules above. Record the headsign rule, the
`sydneytrains`-only scope and the known limit on backwards times there. Add `stopsDropped` to the snapshot
shape in `native-data.md` and to the realtime section of `api.md`. Check `ui.md` wherever it names the
headsign's source. `client-storage.md` and the deviation documents need no
change unless the builds diverge.
