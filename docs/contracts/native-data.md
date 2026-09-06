# Native timetable and realtime data

This contract applies to native clients. The web client continues to use the
Trip Planner API. Native timetable packages and realtime snapshots contain
public transport data only; saved trips, location, history, rides and focus
never leave the device.

## Timetable manifest and package

`GET /api/v1/timetable/manifest` returns schema version 1:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-05T15:33:58.947978Z",
  "expiresAt": "2026-10-04T23:59:59+11:00",
  "serviceDateFrom": "20260905",
  "serviceDateTo": "20261004",
  "packages": [{
    "source": "network",
    "schemaVersion": 1,
    "sha256": "64 lowercase hexadecimal characters",
    "url": "/api/v1/timetable/packages/{sha256}.zip",
    "bytes": 123,
    "serviceDateFrom": "20260905",
    "serviceDateTo": "20261004"
  }]
}
```

There is one aggregate `network` package so trips can transfer between source
feeds in one indexed query. Compact dates are Sydney service dates in
`YYYYMMDD`. `generatedAt` records capture time and never becomes fresh merely
because a client downloaded or queried the package. The common coverage range
is the intersection of all five source ranges. The app reports dates outside
that range as unavailable.

The immutable URL returns a ZIP containing exactly `timetable.sqlite3`.
`sha256` and `bytes` cover the ZIP bytes. The database has SQLite
`application_id=0x494c5452` and `user_version=1`. The Android APK includes the
same ZIP and manifest, so a first install can plan without a network request.

Android downloads to a temporary file, enforces the declared size, verifies
SHA-256, extracts only the exact database entry with a 300 MiB ceiling, then
runs `PRAGMA quick_check`, schema-version and coverage checks. Each database
and manifest is stored under its content hash. The active manifest is the
atomic pointer and is replaced last. A failed or interrupted update leaves the
old generation active; the previous complete generation is retained for
recovery from a corrupt active generation. Initialization can also recover a
complete staged generation from its retained versioned manifest.

The compiler invocation for the captured evidence is:

```sh
python3 tools/compile-timetable.py \
  --input-dir /tmp/trains-gtfs-20260906-design \
  --output-dir native-data/bootstrap \
  --android-assets android/app/src/main/assets
```

It expects `sydneytrains.zip`, `nswtrains.zip`, `metro.zip`, `ferries.zip` and
`mff.zip`. Output is deterministic for identical inputs: the server directory
gets `{sha256}.zip` and `manifest.json`; Android assets get `timetable.zip` and
`timetable-manifest.json`.

## SQLite schema

- `meta(key,value)` carries `schema_version`, common coverage and JSON source
  coverage.
- `sources(id,name)` namespaces every upstream identifier. Source names are
  `sydneytrains`, `nswtrains`, `metro`, `ferries` and `mff`.
- `stations(id,name,lat,lon,modes)` contains the same 423 real Trip Planner hubs
  as the shared station index.
- `stops(id,source,stop_id,station_id,name,platform,lat,lon)` retains raw
  boarding stops and platforms separately from hubs.
- `routes(id,source,route_id,short_name,long_name,mode,color)` keeps Sydney
  Trains agency route type 2, NSW TrainLink route types 100 and 106, metro type
  401, and ferry type 4. NSW TrainLink coach types 204 and 205 are excluded.
  Duplicate NSW TrainLink and non-revenue routes embedded in the Sydney Trains
  bundle are excluded; their authoritative passenger services come from the
  separate NSW TrainLink source. CCN is retained from the Sydney bundle because
  the separate source does not publish that passenger line.
- `services(id,source,service_id,start_date,end_date,weekdays)` stores a
  Monday-first seven-bit weekday mask.
- `service_exceptions(service,service_date,exception_type)` applies GTFS added
  and removed dates before the weekly calendar.
- `trips(id,source,trip_id,route,service,headsign,direction_id)` preserves the
  exact source trip ID used by realtime.
- `connections(trip,from_sequence,to_sequence,from_stop,to_stop,
  departure_secs,arrival_secs,pickup_type,drop_off_type)` is one row per
  adjacent pair of GTFS stop times. It preserves raw pickup/drop-off values;
  only regular type 0 can start or end a planned leg. Remaining types may
  still be traversed while already aboard.

Primary and unique keys cover source IDs and trip order. Planning scans the
`connections_departure` index; stop, trip-service and exception-date indexes
support joins and exact realtime lookups.

Rail and metro boarding stops map through their GTFS parent hub. Sydney Ferry
boarding stops use the reviewed `ferry_stop_mapping.json`; MFF uses its parent
hubs. A regularly boardable or alightable stop without a real hub fails
compilation. A non-boarding timing point may use an internal namespaced key so
a through service is not broken; the current package has one such point at the
Queensland border.

## Local planning

`OfflinePlanner.initialize()` installs or recovers a validated generation.
`plan(from,to,at,modes,limit)` runs on `Dispatchers.IO`, scans active service
connections for the prior, current and following Sydney service days, and
handles GTFS times beyond 24:00. GTFS times are converted as Sydney civil time,
including daylight-saving transitions, rather than adding elapsed seconds to
midnight.

The connection scan retains up to 72 origin services, keeps Pareto states by
transfer count and incoming mode within each origin, and allows at most two
transfers. It starts with six hours of service and extends to 30 hours if it
finds no viable journey or a long transfer still needs a later-service
comparison. The result limit is a cap, not a promise to fill a board by reading
farther into the future. Connections, shared station objects and trip metadata
are cached for nearby requests. It keeps distinct later departures for the board while
selecting the earliest usable arrival for each origin service. New trips obey
the enabled mode set. Every leg carries exact
`TripIdentity(source,tripId,serviceDate,fromStopId,toStopId,fromSequence,
toSequence)` so loop trips can attach realtime to the right stop occurrence.

The captured GTFS feeds have no transfer or pathway tables. Until a reviewed
walking graph exists, offline routing transfers only between stops mapped to
the same hub. It assumes two minutes of movement plus the three-minute safety
floor for same-mode transfers, five plus three minutes between train, metro or
ferry, and seven plus three minutes between rail and ferry at Circular Quay.
This is deliberately conservative but does not establish that every platform
pair is reachable in that time. Cross-hub walks such as Wynyard–Barangaroo are
not constructed offline. The online Trip Planner fallback covers those routes.

## Realtime snapshots

`GET /api/v1/realtime/{source}` returns a complete schema-version-1 replacement
for one of the five source names:

```json
{
  "schemaVersion": 1,
  "source": "metro",
  "headerTimestamp": "2026-09-05T15:26:40Z",
  "generatedAt": "2026-09-05T15:26:41Z",
  "expiresAt": "2026-09-05T15:28:10Z",
  "updates": [{
    "tripId": "exact raw ID",
    "serviceDate": "20260906",
    "routeId": "optional raw ID",
    "startTime": "optional GTFS time",
    "directionId": 0,
    "status": "scheduled",
    "timestamp": "2026-09-05T15:26:40Z",
    "delaySeconds": 60,
    "stopUpdates": [{
      "stopId": "exact raw stop ID",
      "stopSequence": 7,
      "assignedStopId": "optional exact replacement stop ID",
      "arrivalMs": 1788610100000,
      "departureMs": 1788610160000,
      "arrivalDelaySeconds": 60,
      "departureDelaySeconds": 60,
      "scheduleRelationship": "scheduled"
    }]
  }]
}
```

Trip status is `scheduled`, `added`, `unscheduled`, `cancelled` or
`replacement`. Stop relationship is `scheduled`, `skipped`, `noData` or
`unscheduled`. Optional fields are omitted rather than sent as guessed values.
The backend omits invalid or duplicate `(tripId,serviceDate)` updates. An
explicit trip timestamp is accepted only from header minus 90 seconds through
header plus 5 seconds; an absent timestamp inherits header freshness only with
an explicit valid service date. Byte-identical upstream responses preserve the
previous `generatedAt` and strong ETag.

Clients use conditional requests and treat `X-Data-Stale: true` or an expired
snapshot as scheduled-only. Snapshot expiry is the source header timestamp
plus 90 seconds. A connection joins only on exact source, trip ID and service
date, then stop ID and/or sequence. Assigned stop IDs are resolved through the
same source's stop table. `noData` suppresses a stop estimate and the trip
default delay; `skipped` prevents boarding or alighting. A replacement trip
uses only static connections whose two stops remain explicitly present in its
update. Added or unscheduled trips without a static stop pattern cannot be
routed locally and remain the online fallback's responsibility.

Fresh delays, assignments and cancellations are applied before routing, so a
broken transfer causes a local replan. A focused journey is refreshed by its
exact identities even when its mode is later disabled. Missing or expired
realtime clears prior estimates and reverts to scheduled values. A mixed-source
journey's observation time is the oldest relevant source timestamp. A board is
`source="live"` only when a returned journey matched a fresh update; otherwise
it is an offline scheduled board and shows clock times.

## Captured package measurement

The 2026-09-05 capture compiles 423 stations, 854 served stops, 127 eligible
routes, 66,097 services, 10 calendar exceptions, 132,836 trips and 1,865,587
connections. Its common coverage is 5 September through 4 October 2026. The
MFF schedule is included, but its captured realtime feed was 66 days stale and
is rejected by the freshness rules. These measurements describe this capture,
not a stable network size or update cadence. Schema version 1 is 93,155,328
bytes extracted and 20,784,888 bytes as the deterministic ZIP.

The captured Metro calendar has no service on Sunday 6 September: its one-day
service ends on 5 September and the next daily service begins on 7 September.
This is an upstream schedule gap inside the aggregate date range, not inferred
service. The 30-hour next-service path covers it locally, while the normal
six-hour window remains fast.

On the API 36 Medium Phone emulator after clearing app data, one isolated
planner measured 796 ms to extract, verify and open the bundled package, 1,604
ms for the first Mascot–Kellyville mixed-mode plan, 19 ms for the same cached
plan, 15 ms for a new Central–Kellyville pair on that cache, and 29 ms for a
Central–Parramatta board capped at 24 results. These are emulator observations
for this package, not device performance guarantees.
