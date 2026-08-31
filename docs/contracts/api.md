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

## GET /api/v1/departures?from={stopId}&to={stopId}&limit={n}

Next journeys from origin station to destination station. Backed by the TfNSW
Trip Planner `trip` endpoint (not `departure_mon`, which cannot filter to
services that actually reach the destination).

- `from`, `to`: TfNSW global stop IDs (e.g. Central = `200060`). Required, and
  must differ from each other.
- `limit`: max journeys, default 6, max 10. Non-numeric or outside 1–10 is a
  `400`, not silently clamped.
- Cache: `s-maxage=30, stale-while-revalidate=60`.

```json
{
  "from": {"id": "200060", "name": "Central Station"},
  "to":   {"id": "215020", "name": "Parramatta Station"},
  "generatedAt": "2026-08-31T17:42:00+10:00",
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
- `legDetail` (added 2026-09-01) lists the service legs in order, one entry
  per train/metro service; same length as `legs`. Walking legs (upstream
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
  own fields. This is an additive change: existing fields are unchanged and
  the response stays a pure cached function of the query string — leg detail
  comes from the same upstream `trip` call, no extra upstream cost.
- Journeys containing any non-train/metro SERVICE leg (e.g. product class 10
  "On Demand" buses, observed leaking past the exclMOT exclusions on
  2026-09-01, fixture `trip_rhodes_bondijunction.json` journey 2) are
  EXCLUDED entirely — v1 plans trains and metro only, and a journey you
  cannot take by train is not an answer to this board's question. They are
  dropped before `limit` is applied, so a board still fills with up to
  `limit` takeable journeys. The upstream request also sends `exclMOT_10=1`
  (verified 2026-09-01 to remove them at the source); the server-side drop is
  the guard for the next class that leaks.
- Cancelled services are included with `cancelled: true` (clients render
  struck-through), never silently dropped. Detection is deliberately loose
  (any upstream realtime status containing "cancel"): the exact upstream shape
  is still unverified, and over-reporting a cancellation is safer than
  showing a train that will not run.
- Journeys are sorted by effective departure (estimated, else scheduled).
- `generatedAt` is when the data was fetched from TfNSW, not when the response
  was written, so a client can always compute the age of what it is showing.

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
    {"id": "200060", "name": "Central Station", "modes": ["train", "metro"]}
  ]
}
```

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
the stale window is 7 days (owner ruling 2026-08-31): the station list is
near-static, so during a long TfNSW outage station search keeps working from
a stale index rather than returning 502.

## Static files

`/` serves `./web/` when that directory exists (`WEB_DIR` overrides). The API
routes always take precedence, and unknown `/api/` paths return the JSON error
envelope rather than falling through to the file server.

The client is a PWA, so two of those files are load-bearing:
`/manifest.webmanifest` must be served as `application/manifest+json` (the
server registers the type; Go's MIME table does not know it, and a manifest
served as `text/plain` is not installable), and `/sw.js` must be served from
the root so its scope covers the whole origin. Neither is cached by the server
beyond the file server's normal `Last-Modified` handling — the worker's own
`VERSION` is what governs client-side shell freshness.
