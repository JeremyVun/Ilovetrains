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
  served). Verified IDs: Central `200060`, Parramatta `215020`.

### trip
`GET /v1/tp/trip?outputFormat=rapidJSON&coordOutputFormat=EPSG:4326&depArrMacro=dep&itdDate=YYYYMMDD&itdTime=HHMM&type_origin=any&name_origin=<stopId>&type_destination=any&name_destination=<stopId>&calcNumberOfTrips=6&TfNSWTR=true&<exclusions>`

- Mode exclusions (verified working):
  `excludedMeans=checkbox&exclMOT_4=1&exclMOT_5=1&exclMOT_7=1&exclMOT_9=1&exclMOT_11=1`
  → journeys came back all class 1.
- Product classes observed: 1 = train (Sydney Trains + Intercity),
  2 = metro ("Sydney Metro Network", verified Tallawong→Chatswood),
  4 = light rail. 5 bus, 7 coach, 9 ferry, 11 school bus per EFA
  convention. Verified metro-relevant IDs: Tallawong `2155384`,
  Chatswood `206710`.
- Journey shape: `interchanges` (transfer count), `legs[]`. Leg:
  - `origin.departureTimePlanned` / `departureTimeEstimated`,
    `destination.arrivalTimePlanned` / `arrivalTimeEstimated`
  - `origin.properties.platformName` ("Platform 12"); platform also embedded
    in `origin.name`
  - `isRealtimeControlled: true` + `realtimeStatus: ["MONITORED"]` when
    live; both null/absent for schedule-only services.
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

## Sources

- Live probes 2026-08-31: `tools/fixtures/*.json`
- https://opendata.transport.nsw.gov.au/developers/documentation
- https://opendata.transport.nsw.gov.au/dataset/trip-planner-apis
