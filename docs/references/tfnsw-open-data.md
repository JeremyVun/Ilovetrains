# TfNSW Open Data — API reference notes

Verified 2026-08-31 by live probes (`tools/probe-tfnsw.sh`, raw responses in
`tools/fixtures/`) against platform version **10.6.21.17**. Remaining
**[verify]** items are noted inline.

## Access

- Sign up (free) at https://opendata.transport.nsw.gov.au → application →
  API key. Key lives in `.env` as `TFNSW_API_KEY` (gitignored).
- Auth header (verified): `Authorization: apikey <API_KEY>`
- Gateway base (verified): `https://api.transport.nsw.gov.au/v1/tp`
- License: Creative Commons Attribution (attribute TfNSW in the app).
- Quota **[verify — portal login needed]**: believed ~60k requests/day,
  ~5 req/s per application. Probe runs cost ~5 requests.

## Trip Planner API — verified behavior

Common params: `outputFormat=rapidJSON&coordOutputFormat=EPSG:4326`.
All timestamps in responses are **UTC** (`2026-08-31T12:48:00Z`) — convert
to Australia/Sydney for our API. `systemMessages` may contain error entries
(e.g. code -8011, empty text) even on successful responses — judge success
by payload content, not systemMessages.

### stop_finder
`GET /v1/tp/stop_finder?outputFormat=rapidJSON&type_sf=any&name_sf=<text>&coordOutputFormat=EPSG:4326&TfNSWSF=true`

- **`type_sf=stop` is broken** on the current platform ("stop invalid",
  code -2000). Use `type_sf=any` and filter `locations[]` to
  `type=="stop"`; rank by `isBest` / `matchQuality`.
- Stop fields: `id` (global stop ID), `name`, `modes` (product classes
  served), `coord`. Verified IDs: Central `200060`, Parramatta `215020`.
- **`coord` is `[latitude, longitude]`** (verified 2026-09-01 from the
  fixtures, not assumed from the CRS name): Central is
  `[-33.884024, 151.206203]` and the Adelaide coach stop `G50001` is
  `[-34.927477, 138.595501]`. Read the other way round those are points in
  Lebanon and the Southern Ocean. Every station in the captured fixtures has
  a `coord`, but POI/street results do too, so presence is not a stop filter.
- Prefix matching works (`parra`, `strathf` → the right stations, verified
  2026-09-01) but very short queries can lose to exact word matches on
  streets/bus stops (`parr` → only "Parr Pde" bus stops, which the
  train/metro filter then removes → empty result). Client autocomplete
  should not treat an empty result on a short query as "no such station".

### trip
`GET /v1/tp/trip?outputFormat=rapidJSON&coordOutputFormat=EPSG:4326&depArrMacro=dep&itdDate=YYYYMMDD&itdTime=HHMM&type_origin=any&name_origin=<stopId>&type_destination=any&name_destination=<stopId>&calcNumberOfTrips=6&TfNSWTR=true&<exclusions>`

- **Past windows work, and carry realtime actuals** (verified 2026-09-01,
  five probes Central `200060` → Parramatta `215020`, all HTTP 200). An
  `itdDate`/`itdTime` in the past with `depArrMacro=dep` returns journeys
  departing at or after that time — it does not snap to now — and for the
  recent past those journeys carry genuine realtime data, not the timetable:

  | window | realtime legs | estimates vs planned |
  |---|---|---|
  | 20 min ago | 6/6 MONITORED | every leg differs: +3m18s … +3m48s on departure, and its own delay on arrival |
  | 1 h ago | 5/6 MONITORED | departures all on time to the second; 5 arrivals differ (−12s … +180s) |
  | 3 h ago | 1/6 | none differ |
  | 6 h ago | 0/6 | none differ |

  So **realtime survives about an hour and is gone by three**. As it ages out,
  `isRealtimeControlled` and `realtimeStatus` go false/absent while
  `departureTimeEstimated` stays present as a copy of the planned time — the
  same trap as the live board, and the existing realtime gate is what makes
  an old window degrade honestly to `estimated: null` instead of claiming
  every train from this morning ran exactly on time.
  Fixture: `trip_central_parramatta_past.json` (the 20-min window).
  Consequence for caching: a settled window fetched soon after it passes is
  BETTER data than the same window refetched hours later, so caching it hard
  preserves the actuals rather than merely saving quota.
- Mode exclusions (verified working):
  `excludedMeans=checkbox&exclMOT_4=1&exclMOT_5=1&exclMOT_7=1&exclMOT_9=1&exclMOT_10=1&exclMOT_11=1`
  → journeys came back all class 1.
- **`exclMOT_N` takes the product class number** (verified 2026-09-01 for
  class 10). Rhodes `213820` → Bondi Junction `202210` with the original five
  exclusions returned 11 journeys (22 class-1 legs, 5 class-10 legs, 5
  class-99 legs); adding `exclMOT_10=1` to the same query in the same minute
  returned 6 journeys, 12 legs, all class 1. Fixture
  `trip_rhodes_bondijunction.json` is the unfiltered response.
- Product classes observed: 1 = train (Sydney Trains + Intercity),
  2 = metro ("Sydney Metro Network", verified Tallawong→Chatswood),
  4 = light rail, **10 = On Demand** (`product.id` 23, e.g. "On Demand -
  Inner West", line "D400" — a booked minibus, not a service you can walk up
  to), **99 = footpath** (`product.name` "footpath"), 100 = connection per EFA
  convention. 5 bus, 7 coach, 9 ferry, 11 school bus per EFA convention.
  Verified metro-relevant IDs: Tallawong `2155384`, Chatswood `206710`.
- Walking legs (class 99) carry a `transportation` object with only a
  `product` — no `name`, `number` or `destination` — plus `footPathInfo` with
  turn-by-turn `footPathElem` entries (ELEVATOR / LEVEL / RAMP). Their
  endpoints are the concourse stop and the platform, so a walk shows as
  Strathfield Station → Strathfield Station, Platform 4. **A platform-to-
  platform change inside one station may have no walking leg at all**
  (verified: Town Hall Platform 3 → Platform 5 is just a gap between two
  service legs), so a client cannot rely on a walk leg to detect a transfer.
- **Waiting is free to the planner, and the trip count is a maximum, not a
  promise** (observed 2026-09-03, Rhodes `213820` → Bondi Junction `202210`
  at 21:16 with buses excluded, the night the T4 branch closed at 21:32).
  `calcNumberOfTrips=20` returned 5 journeys: the last T9 out at 23:54 with a
  4 h 21 min wait at Town Hall, the last T9 north at 00:31 with a 3 h 18 min
  wait at Epping for the first Central Coast train, then the three sane
  morning trips from 04:24. Each successive journey departs after the
  previous one and optimises its own arrival; nothing penalises the wait at a
  change. The server's connection ceiling (`docs/contracts/api.md`) exists
  for this. Direct pairs asked for 20 and got 4, so a board is short, not
  padded, once the search crosses into the next service day.
- Journey shape: `interchanges` (transfer count), `legs[]`. Leg:
  - `origin.departureTimePlanned` / `departureTimeEstimated`,
    `destination.arrivalTimePlanned` / `arrivalTimeEstimated`
  - `origin.properties.platformName` ("Platform 12"); platform also embedded
    in `origin.name`
  - `isRealtimeControlled: true` + `realtimeStatus: ["MONITORED"]` when
    live; both null/absent for schedule-only services. **Realtime is per leg,
    not per journey** (verified 2026-09-01, `trip_rhodes_bondijunction.json`
    journeys 8 and 10): a schedule-only T9 into Town Hall connects to a
    MONITORED T4, so the same journey has a null departure estimate and a
    real arrival estimate.
  - Leg endpoints are `type: "platform"` with a `parent` of `type: "stop"`
    carrying the station's global ID (Rhodes `213820`, Town Hall `200070`,
    Bondi Junction `202210`). Both levels' `disassembledName` include the
    platform ("Town Hall Station, Platform 3"), so the station name must be
    taken from the parent AND stripped. `origin.properties.platformName`
    holds the platform on its own.
  - **Estimated fields are always present, realtime or not** (verified
    2026-08-31 in `trip_central_parramatta.json` journeys 5–6 and again in a
    live Phase 1 smoke): schedule-only legs still carry
    `departureTimeEstimated` / `arrivalTimeEstimated`, usually equal to
    planned but sometimes seconds apart. Field presence is therefore *not*
    evidence of realtime data — gate on `isRealtimeControlled` /
    `realtimeStatus`, or the API fabricates live estimates.
  - Cancellation signal **[verify — none observed]**: expect
    `realtimeStatus` to carry e.g. `TRIP_CANCELLED`; confirm during a real
    disruption before relying on it.
  - `transportation`: `number` ("T1 North Shore & Western Line"),
    `destination.name` (headsign, "Penrith via Parramatta"),
    `product.class`, `properties.RealtimeTripId` / `gtfsTripId`.

### departure_mon
`GET /v1/tp/departure_mon?outputFormat=rapidJSON&coordOutputFormat=EPSG:4326&mode=direct&type_dm=stop&name_dm=<stopId>&depArrMacro=dep&itdDate=YYYYMMDD&itdTime=HHMM&TfNSWDM=true`

Returns `stopEvents[]` (all modes at the stop, same time/platform field
shapes; realtime delay verified live). Not used by v1 — can't filter by
destination.

### add_info
Service alerts. Not probed yet **[verify when alerts UI is scheduled]**.

## Station index

Verified 2026-09-05, building `web/stations.json` and
`internal/stations/stations.json` (`tools/build-stations.js`).

Bundles, downloaded with `Authorization: apikey <key>`:

- `https://api.transport.nsw.gov.au/v1/gtfs/schedule/sydneytrains`
- `https://api.transport.nsw.gov.au/v1/gtfs/schedule/nswtrains`
- `https://api.transport.nsw.gov.au/v2/gtfs/schedule/metro`

Metro is **v2**. The v1 metro bundle answers 200 but is frozen at
`feed_version 17092024`: one route, "Metro North West Line", 13 stations,
none of the City section. v2 is current (2026-09-03) and carries all 21 M1
stations including Barangaroo, Gadigal, Waterloo, Victoria Cross and Crows
Nest, which appear in no v1 bundle. `v2/sydneytrains` and `v2/nswtrains` are
404; those two stay on v1.

Row filter: `stops.txt` rows with `location_type = 1`, kept only when
`stop_times.txt` → `trips.txt` → `routes.txt` shows a rail `route_type`
serving them (1, 2, 100–117 or 400–405). Sydney Trains is all `route_type`
2; NSW TrainLink is 100 and 106 for rail and 204/205 for its coaches; Metro
is 401. Without the join, NSW TrainLink alone contributes 274 coach stops
including Adelaide Central Bus Station.

`location_type = 1` on its own is only a station filter in these three
bundles. In the complete Greater Sydney bundle
(`/v1/publictransport/timetables/complete/gtfs`, 302 MB) every bus stop is
`location_type = 1`: 78,031 of them.

GTFS parent-station ids are the Trip Planner stop ids. Each name below was
put through `stop_finder` (`type_sf=any&name_sf=<name>`) and the first
`type == "stop"` result compared with the GTFS parent id:

| Station | GTFS | stop_finder | Match |
| --- | --- | --- | --- |
| Central Station | 200060 | 200060 | yes |
| Rhodes Station | 213820 | 213820 | yes |
| Bondi Junction Station | 202210 | 202210 | yes |
| Parramatta Station | 215020 | 215020 | yes |
| Tallawong Station | 2155384 | 2155384 | yes |

`200080` is **Wynyard Station** in every bundle and upstream. The client
fixtures that label it Bondi Junction are wrong; Bondi Junction is `202210`.

The dropped Bankstown-line stations (Belmore, Campsie, Canterbury, Dulwich
Hill, Hurlstone Park, Lakemba, Marrickville, Punchbowl, Wiley Park) are
correctly dropped: `stop_finder` reports their modes as `[5, 11]`, bus and
school bus only, while the line is converted to Metro.

Olympic Park's name is `Olympic Park Station`, not "Sydney Olympic Park
Station" — the same `disassembledName` the Trip Planner gives.

23 of the 386 entries sit outside NSW: the NSW TrainLink long-distance
terminals (Southern Cross, Broadmeadows, Seymour, Benalla, Wangaratta,
Albury, Brisbane, Perth, Broken Hill, Casino, Kyogle and the stops between).
They are real rail stations on `route_type` 106 services and `stop_finder`
returns them today, so the index keeps them.

## Ferries

Verified 2026-09-05 with `tools/probe-tfnsw.sh --ferries`. The Sydney
Ferries bundle at `/v1/gtfs/schedule/ferries/sydneyferries` returned HTTP
200, 893,137 bytes, `feed_version 05092026-010132`, and only `route_type 4`.
`ferries_gtfs_summary.json` captures the feed metadata and all 75 stops:
13 parents, 26 parented children and 36 standalone `location_type = 0`
stops. The rail index's parent-only keep rule does not work for ferries.

GTFS and Trip Planner do **not** share ferry parent IDs:

| Place | GTFS | Trip Planner stop | Observed shape |
| --- | --- | --- | --- |
| Circular Quay | `20004` (Wharf 3 parent), `2000216` / `2000217` (sides) | `200020` | Shared with Circular Quay railway; modes `[1,4,5,9]` |
| Manly | `20951`, `209525`, `209593` (standalone wharves 1–3) | `209573` | `Manly Wharf`, modes `[9]` |
| Parramatta | `21501` (standalone `Parramatta Wharf`) | `2150112` | `Parramatta Wharf`, modes `[9]` |

Stop-finder fixtures: `stop_finder_manly_wharf.json`,
`stop_finder_circularquay_wharf.json`, `stop_finder_circularquay_wharf3.json`
and `stop_finder_parramatta_wharf.json`. Searching `Circular Quay` names
`200020` as Station; searching `Circular Quay Wharf 3` names the same ID
as Wharf. GTFS `20004` used as an endpoint gives no journeys in either
direction (`trip_gtfs_circularquay_manly.json` and
`trip_manly_gtfs_circularquay.json`). These findings invalidate the ferry
design's separate-parent and ID-equality premises; the replacement index
policy was revised by the owner to use verified Trip Planner hubs.

`tools/probe-ferry-stops.py` subsequently queried every boarding stop served
by ferry routes (54 IDs) using `name_sf=<GTFS boarding ID>`. Every query
returned one best class-9 stop. `ferry_stop_mapping.json` retains these raw
responses and feed provenance: 38 distinct Trip Planner hubs. Circular Quay
is the only ID shared with the rail index, producing 423 total entries
(386 rail/metro plus 37 ferry-only). Barangaroo Wharf is `2000441`, separate
from Barangaroo metro `200046`. Only GTFS-served boarding IDs seed the
index, so Manly Fast Ferry does not expand the searchable wharf network.

With Trip Planner IDs and exclusions 4, 5, 7, 10 and 11:

- `trip_circularquay_manly.json`: 16 journeys, 11 F1 and 5 MFF legs.
- `trip_wynyard_manly.json`: 15 journeys, each T8 then F1 or MFF.
  All 15 station-to-wharf changes omit walking legs. No class-99/100 leg
  occurs in any of these three fixtures, so their walk duration and time
  fields cannot be observed here.
- `trip_manly_circularquay.json`: 15 journeys, 9 F1 and 6 MFF legs.

Both ferry operators use class 9: `Sydney Ferries Network` has code `F1`,
number `F1 Manly`; `Private ferry and fast ferry services` has code `MFF`,
number `MFF Manly Fast Ferry`. Headsigns are `Manly` outbound and
`Circular Quay` inbound. F1 includes monitored and schedule-only legs;
MFF is schedule-only in this capture. Monitored legs carry
`isRealtimeControlled: true` and `realtimeStatus: ["MONITORED"]`.

Every captured ferry origin has `platformName`. Circular Quay returns
`Wharf 2, Side A`, `Wharf 3, Side A` or `Wharf 3, Side B`; Manly returns
`Wharf 1` or `Wharf 2`. Leg parent names also carry the wharf/side suffix,
so the rail-only platform suffix stripping is insufficient. Side labels
must be included in the browser verification; `Wharf 3` alone understates
the actual content width.

Additional live coverage, 2026-09-05:

- `trip_circularquay_balmaineast.json` includes T2 from Circular Quay to
  Wynyard, a class-99 walk from Wynyard to Barangaroo Wharf (`duration 600`
  seconds; planned `06:05:18Z` → `06:15:18Z`), then F4 to Balmain East.
  The service endpoints on either side
  of the walk are different stops and must both be named in a change.
- Balmain East and Cockatoo Island publish `platformName: "Side A"`;
  their parent names append `, Side A` to the wharf name. Balmain publishes
  `platformName: "Balmain Wharf"`. These are real boarding labels without a
  number, not missing data. The client preserves the complete supplied
  label and leaves the compact numeric chip as an em dash.
- `trip_barangaroo_balmain.json` also offers a leading nine-minute walk
  from Barangaroo to Wynyard before boarding a train (planned `06:30:30Z`
  → `06:39:30Z`, `duration 540`). The current response
  has no outer-walk leg, so that route is excluded instead of presenting
  the Wynyard train as a departure from Barangaroo. Walks between services
  remain supported; walks within the selected endpoint hub are retained.

## GTFS / GTFS-realtime

Native clients use bundled static schedules and normalized GTFS-R snapshots;
web retains Trip Planner. Trip Updates, Vehicle Positions and Alerts for
Sydney Trains and Metro exist on the portal. Portal guidance:
poll realtime feeds ≥10–15s apart, static bundles at most daily.

### Native Sydney Trains service-date gap — 2026-09-07

Read `GET https://ilovetrains.jeremyvun.com/api/v1/realtime/sydneytrains`
at 09:01:23 UTC with curl: HTTP 200, source header `2026-09-07T09:01:06Z`,
expiry `2026-09-07T09:02:36Z`, and `updates: []`. This is a fresh but empty
normalized snapshot, not proof that Sydney Trains has no realtime services.

The reviewed 6 September capture in
`tools/fixtures/gtfs_realtime_summary.json` has 308 Sydney Trains updates,
all without `start_date`; 254 exactly match a static trip ID. The current
`internal/native/realtime.go` rejects every missing service date before mapping
stop updates. Fixing this needs a verified trip-instance/service-day join,
including overnight runs and old per-trip observations, not a default to the
current date. These observations explain a native coverage gap; they do not
establish which estimate was shown on the owner's earlier Rhodes trip.

## Budget math for v1 caching

One station pair at 30s TTL ≈ 2,880 upstream calls/day worst case; the
believed quota supports ~20 hot pairs even with zero CDN hit-rate.

Past windows (`at`) add at most 157 further keys per station pair and limit
(26 hours of 10-minute buckets), but each is fetched at most once an hour and
in practice once ever, since what ran does not change. Scrolling the board
back a day is ~144 upstream calls in the worst case and, after the first
rider does it, none.

## Sources

- Live probes 2026-08-31 and 2026-09-01: `tools/fixtures/*.json`
- https://opendata.transport.nsw.gov.au/developers/documentation
- https://opendata.transport.nsw.gov.au/dataset/trip-planner-apis
