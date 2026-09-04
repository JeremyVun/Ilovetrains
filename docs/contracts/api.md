# Contract: Backend JSON API

The backend is a **stateless** cache/proxy in front of TfNSW Open Data. It
never receives, stores, or varies on user identity. Every response is a pure
function of the query string (plus time), so it is CDN-cacheable and shared
across all users.

Invariants:
- No cookies, no auth, no `Vary` beyond `Accept-Encoding`.
- CORS: `Access-Control-Allow-Origin: *`.
- All success responses carry `Cache-Control: public, s-maxage=<n>,
  stale-while-revalidate=<m>` as specified per endpoint.
- The TfNSW API key exists only server-side.
- In-memory cache + single-flight per cache key upstream of TfNSW, so a CDN
  miss storm costs at most one upstream request per key per TTL. TfNSW quota
  is a hard budget (see `docs/references/tfnsw-open-data.md`).
- Timestamps are ISO 8601 with offset (e.g. `2026-08-31T17:42:00+10:00`),
  always in `Australia/Sydney` local offset.

## GET /api/v1/departures?from={stopId}&to={stopId}&limit={n}&at={t}

`at` is an optional ISO 8601 time with an offset
(`2026-09-01T17:30:00+10:00` or the same instant as `...Z`). Absent means now
and the response carries `at: null`. Present means journeys departing at or
after time `t`, which the server rounds DOWN to a 10-minute bucket; the rounded
value is echoed as `at` in the response so clients page on stable keys, and
bucketing keeps the response a pure function of the query string. Upstream
behavior for past windows is recorded in `docs/references/tfnsw-open-data.md`.

Upstream answers past windows properly: it returns the journeys that departed
in that window, and **for the recent past it returns realtime actuals, not the
timetable** — a past row can honestly show that the 17:34 left at 17:37:18 and
arrived 4½ minutes late. Realtime survives roughly an hour and has aged out by
three, after which upstream serves the timetable with the realtime flags
cleared; the usual gate then applies and `estimated` comes back `null`, so an
old row degrades to scheduled-only rather than claiming every train ran exactly
on time. Both registers are normal and a client must render both.

Cache: a bucket more than 20 minutes in the past is settled — every journey in
it has departed — and gets `s-maxage=3600, stale-while-revalidate=86400` with a
matching 1-hour in-memory TTL. Buckets nearer to now, ahead of now, or absent
keep the live policy. Caching a settled window hard is not only cheap but more
truthful: the cached copy was taken while the actuals still existed upstream.

`at` is rejected with `400` when it is unparseable, further than 24 hours in
the past, or more than 2 hours in the future. This bounds the key space, which
is a quota decision rather than a usability one: every reachable bucket is a
distinct cache key and a possible upstream request, and 26 hours of 10-minute
buckets is at most 157 keys per (`from`, `to`, `limit`). Bounds are applied to
the bucket, so `now - 24h` exactly is inside the window.

Paging into the past = requesting earlier buckets; clients dedupe rows across
pages by (line.name, departure.scheduled). **Where a row appears on both a past
page and the live board, the live board's copy wins.** A page returns `limit`
journeys *from* its bucket, not journeys *inside* it, so a settled page whose
station pair runs every 15 minutes reaches over an hour past its own bucket —
and those rows are held under the settled page's 1-hour cache, so their
`estimated` can be up to an hour behind. The overlap is a duplicate to resolve,
never a reason to show a countdown from a past page.

Note that `+` means a space in a URL query, so the offset must be
percent-encoded as `%2B` — the server also accepts the un-encoded spelling,
since its meaning is not in doubt, but a client should not rely on that.

Next journeys from origin station to destination station. Backed by the TfNSW
Trip Planner `trip` endpoint (not `departure_mon`, which cannot filter to
services that actually reach the destination).

- `from`, `to`: TfNSW global stop IDs (e.g. Central = `200060`). Required, and
  must differ from each other.
- `limit`: max journeys, default 6, max 10. Non-numeric or outside 1–10 is a
  `400`, not silently clamped.
- `at`: optional departure window, as above.
- Cache: `s-maxage=30, stale-while-revalidate=60`, except for a settled past
  `at` window — see the `at` paragraph above.

```json
{
  "from": {"id": "200060", "name": "Central Station"},
  "to":   {"id": "215020", "name": "Parramatta Station"},
  "generatedAt": "2026-08-31T17:42:00+10:00",
  "at": null,
  "journeys": [
    {
      "departure": {
        "scheduled": "2026-08-31T17:48:00+10:00",
        "estimated": "2026-08-31T17:50:00+10:00",
        "platform": "Platform 18"
      },
      "arrival": {
        "scheduled": "2026-08-31T18:19:00+10:00",
        "estimated": "2026-08-31T18:21:00+10:00"
      },
      "line": {"name": "T1", "mode": "train"},
      "destinationHeadsign": "Penrith via Parramatta",
      "stopsAway": null,
      "cancelled": false,
      "legs": 1
    }
  ]
}
```

Semantics:
- `estimated` is `null` when no realtime data; clients must fall back to
  `scheduled` and may indicate "scheduled only". A service counts as realtime
  only when the upstream leg is realtime-controlled — upstream fills the
  estimated fields with (near-)copies of the planned times for schedule-only
  services too, and serving those would fake a live estimate.
- `estimated` reflects realtime even when it equals `scheduled` (on time).
- `platform` is `null` when unknown. `mode` is `"train"` or `"metro"`.
- `name` on `from`/`to` is the station name without its platform or suburb
  suffix ("Central Station"), matching the names `/api/v1/stops` returns. It
  is `""` when no journey was found to take it from.
- `stopsAway` is always `null` in v1: the Trip Planner carries no live vehicle
  position. Reserved for a later data source.
- `legs > 1` means a transfer is required; v1 clients may show a transfer
  badge but journeys are still ordered by departure time. `legs` counts
  services only — a walking transfer between platforms is not a leg.
- `legDetail` lists the service legs in order, one entry per train/metro
  service; same length as `legs`. Walking legs (upstream
  product class 99/100) are folded into the gap between service legs, never
  listed. Each leg:

  ```json
  {
    "line": {"name": "T9", "mode": "train"},
    "headsign": "Gordon via Lindfield",
    "from": {"id": "213820", "name": "Rhodes Station", "platform": "Platform 1"},
    "to":   {"id": "200070", "name": "Town Hall Station", "platform": "Platform 3"},
    "departure": {"scheduled": "…", "estimated": "…"},
    "arrival":   {"scheduled": "…", "estimated": "…"},
    "cancelled": false
  }
  ```

  Same time semantics as the journey level, gated per leg: `estimated` is
  null unless THAT leg is realtime-controlled, so one journey can have a
  scheduled-only first leg and a live second one. `platform` is null when
  upstream does not say. Transfer wait is derivable: next leg's effective
  departure minus previous leg's effective arrival (any walking time is
  inside that gap — often there is no walking leg at all for a
  platform-to-platform change, so the gap is the only transfer signal).
  For single-leg journeys `legDetail` has one entry mirroring the journey's
  own fields. Leg detail comes from the same upstream `trip` call with no
  extra upstream request, so the response remains a pure cached function of
  the query string.
- Journeys containing any non-train/metro SERVICE leg, such as a product
  class 10 "On Demand" bus, are EXCLUDED entirely — v1 plans trains and metro
  only, and a journey you cannot take by train is not an answer to this
  board's question. They are
  dropped before `limit` is applied, so a board still fills with up to
  `limit` takeable journeys. The upstream request also sends `exclMOT_10=1`;
  the server-side drop guards against any excluded class that upstream still
  returns.
- Cancelled services are included with `cancelled: true` (clients render
  struck-through), never silently dropped. Detection is deliberately loose
  (any upstream realtime status containing "cancel"): the exact upstream shape
  is still unverified, and over-reporting a cancellation is safer than
  showing a train that will not run.
- Journeys are sorted by effective departure (estimated, else scheduled).
- Multi-service journeys must meet the server's planned connection floor at
  every transfer. The default is 3 minutes and deployment may tune it with
  `MIN_CONNECTION_TIME` (a non-negative Go duration such as `4m`). The floor
  uses scheduled arrival→departure times: a journey that was sane when planned
  may still shrink in realtime, which the client shows with its tight-change
  treatment. The proxy asks upstream for spare candidates, drops unsafe
  journeys before applying the public `limit`, and never rewrites times.
- Multi-service journeys also meet a planned connection ceiling, default 60
  minutes and tunable with `MAX_CONNECTION_TIME` (same duration format; `0`
  disables it). A journey whose longest planned change exceeds the ceiling is
  dropped when a later-departing journey that is itself served arrives
  before that wait would have ended. The rule exists because upstream
  answers "next departures" one train at a time and never charges for
  waiting: after a line closes for the night it offers the last train out
  with a three-hour wait at the change, arriving twenty minutes before the
  first sane trip of the morning (observed Rhodes → Bondi Junction,
  2026-09-03). The last train of the night keeps its long change when nothing
  later arrives in time, and a change under the ceiling is never judged.
  Dropped before `limit`, like the floor.
- `generatedAt` is when the data was fetched from TfNSW, not when the response
  was written, so a client can always compute the age of what it is showing.
  It is the fetch time even for a past window, so it is unrelated to `at`: a
  request for this morning answers with journeys hours old and a `generatedAt`
  of minutes ago. `at` says which window the journeys are from; `generatedAt`
  says how fresh the answer about it is.

## GET /api/v1/stops?q={text}

Station autocomplete for trip setup. Backed by TfNSW `stop_finder`, filtered
to train/metro stations only.

- `q`: search text, min 2 chars.
- Cache: `s-maxage=86400, stale-while-revalidate=604800` (station list is
  near-static).
- Results are ordered best match first. `modes` lists only `"train"` and/or
  `"metro"`; a station's other modes (bus, light rail, ferry) are not reported
  because v1 cannot plan them.

```json
{
  "stops": [
    {"id": "200060", "name": "Central Station", "modes": ["train", "metro"],
     "location": {"lat": -33.8832, "lon": 151.2069}}
  ]
}
```

`location` is the station's WGS84 coordinates from upstream's `coord` field,
whose axis order is `[latitude, longitude]` — Central is
`[-33.884024, 151.206203]` (see
`docs/references/tfnsw-open-data.md`). `null` when upstream omits the pair or
gives fewer than two values; never `{"lat": 0, "lon": 0}`, which is a point in
the Atlantic that would win any nearest-station comparison outright. Every
station in the captured fixtures carries coordinates, so `null` is a guard
rather than an expected case. It powers the client-side geolocation term in
trip prediction — the server never receives a user location, only publishes
where stations are.

## GET /healthz

`200 {"ok": true}`. `Cache-Control: no-store`. For deploy checks only, not
routed through the CDN cache.

## Errors

```json
{"error": {"code": "upstream_unavailable", "message": "..."}}
```

- `400 bad_request` — missing/invalid params. Cacheable (`s-maxage=60`).
- `404 not_found` — no such endpoint under `/api/`. Cacheable (`s-maxage=60`).
- `502 upstream_unavailable` — TfNSW down/erroring after retry. `no-store`.
- `504 upstream_timeout` — TfNSW too slow. `no-store`.

Error `message` is our own text; upstream error text is never echoed back.

On upstream failure the backend serves stale in-memory data up to 10 minutes
old (marked by response header `X-Data-Stale: true`) before returning 502.
The stale response keeps its endpoint's normal `Cache-Control`; the header and
`generatedAt` carry the truth. `Access-Control-Expose-Headers: X-Data-Stale`
is set so a cross-origin client can read it. Clients showing stale data must
indicate its age.

The 10-minute stale window applies to departures only. For `/api/v1/stops`
the stale window is 7 days: the station list is
near-static, so during a long TfNSW outage station search keeps working from
a stale index rather than returning 502.

## Static files

`/` serves `./web/` when that directory exists (`WEB_DIR` overrides). The API
routes always take precedence, and unknown `/api/` paths return the JSON error
envelope rather than falling through to the file server.

Every static response carries `Cache-Control: no-cache`. Without an explicit
header, Cloudflare can edge-cache static extensions for hours and delay a
service-worker update. `no-cache` means revalidate (`Last-Modified` 304s), not
don't-store; client-side speed comes from the service worker, and `sw.js` must
never be served stale by a proxy.

The client is a PWA, so two of those files are load-bearing:
`/manifest.webmanifest` must be served as `application/manifest+json` (the
server registers the type; Go's MIME table does not know it, and a manifest
served as `text/plain` is not installable), and `/sw.js` must be served from
the root so its scope covers the whole origin. Neither is cached by the server
beyond the file server's normal `Last-Modified` handling — the worker's own
`VERSION` is what governs client-side shell freshness.
