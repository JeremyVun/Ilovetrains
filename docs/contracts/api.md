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

- `from`, `to`: TfNSW global stop IDs (e.g. Central = `200060`). Required.
- `limit`: max journeys, default 6, max 10.
- Cache: `s-maxage=30, stale-while-revalidate=60`.

```json
{
  "from": {"id": "200060", "name": "Central"},
  "to":   {"id": "215020", "name": "Parramatta"},
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
  `scheduled` and may indicate "scheduled only".
- `estimated` reflects realtime even when it equals `scheduled` (on time).
- `platform` is `null` when unknown. `mode` is `"train"` or `"metro"`.
- `legs > 1` means a transfer is required; v1 clients may show a transfer
  badge but journeys are still ordered by departure time.
- Cancelled services are included with `cancelled: true` (clients render
  struck-through), never silently dropped.
- Journeys are sorted by effective departure (estimated, else scheduled).

## GET /api/v1/stops?q={text}

Station autocomplete for trip setup. Backed by TfNSW `stop_finder`, filtered
to train/metro stations only.

- `q`: search text, min 2 chars.
- Cache: `s-maxage=86400, stale-while-revalidate=604800` (station list is
  near-static).

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
- `502 upstream_unavailable` — TfNSW down/erroring after retry. `no-store`.
- `504 upstream_timeout` — TfNSW too slow. `no-store`.

On upstream failure the backend serves stale in-memory data up to 10 minutes
old (marked by response header `X-Data-Stale: true`) before returning 502.
Clients showing stale data must indicate its age.
