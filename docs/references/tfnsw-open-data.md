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

## GTFS / GTFS-realtime — not used in v1

Static GTFS bundles + GTFS-R v2 protobuf feeds (Trip Updates, Vehicle
Positions, Alerts) for Sydney Trains and Metro exist on the portal. Revisit
if Trip Planner quota or latency becomes the bottleneck. Portal guidance:
poll realtime feeds ≥10–15s apart, static bundles at most daily.

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
