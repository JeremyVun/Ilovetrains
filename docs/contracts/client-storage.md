# Contract: Client-side storage & trip prediction

All personal state lives in `localStorage` on the device. Nothing here is
ever sent to the server. This is a product guarantee, not an implementation
detail — see PROJECT.md principles.

## localStorage schema

Single key `trains.v1` holding one JSON document (single key keeps
read/write atomic and migration simple):

```json
{
  "schemaVersion": 1,
  "trips": [
    {
      "id": "uuid",
      "from": {"id": "200060", "name": "Central"},
      "to":   {"id": "215020", "name": "Parramatta"},
      "createdAt": "2026-08-31T17:00:00+10:00"
    }
  ],
  "history": [
    {"tripId": "uuid", "direction": "forward", "t": "2026-08-31T08:12:00+10:00"}
  ],
  "lastViewed": {"tripId": "uuid", "direction": "forward"},
  "cache": {
    "<from>-<to>": {"fetchedAt": "...", "body": {"…": "last departures response"}}
  }
}
```

- A saved trip is an ordered station pair; `direction: "reverse"` means
  to→from. Users never save the same pair twice in both directions.
- `history` records a view event each time a departure board is shown for
  ≥ 5 seconds or interacted with (prevents the prediction itself from
  polluting history on a mispredict the user immediately flips away from).
- `history` is capped at 500 events, oldest evicted.
- `cache` holds the last successful departures response per pair, used for
  instant first paint and offline; capped at saved pairs only.

## Focused journey (added 2026-09-01)

The document gains an optional `focus` field — "I'm on this train":

```json
"focus": {
  "tripId": "uuid",
  "direction": "forward",
  "focusedAt": "2026-09-01T09:07:00+10:00",
  "journey": { "…": "verbatim snapshot of the focused journey object" }
}
```

- Set when the user focuses a journey from its detail view; cleared by the
  user, or automatically once now > the journey's effective arrival + 30 min.
- `journey` is a full snapshot so the focused journey stays viewable after
  it departs (and offline) — the board no longer carries it, the snapshot
  does. On each refresh the client re-matches the focused journey in fresh
  data by (first leg's line.name, departure.scheduled) and updates the
  snapshot when matched (live delays keep flowing); unmatched (departed)
  keeps the last snapshot.
- At most one focused journey. Focusing another replaces it.
- Deleting the trip deletes its focus, like its history and its cache: nothing
  outlives the trip it describes.
- The auto-clear is a WRITE, so it happens where writes happen — on the next
  successful refresh, not during a render. An expired focus stops being drawn
  immediately either way; rendering never touches storage, because the client
  paints once with the real clock before anything can pin it.

## Prediction heuristic (v1 — keep it this simple)

On app open, score every (trip, direction) candidate:

```
score = Σ over history events e matching (trip, direction):
          dayTypeMatch(e) × hourProximity(e) × recencyDecay(e)

dayTypeMatch: 1.0 if same day-type (weekday/weekend) as now, else 0.2
hourProximity: 1.0 if |eventHour − nowHour| ≤ 1 (mod 24),
               0.5 if ≤ 2, else 0
recencyDecay: 0.97 ^ ageInDays
```

Pick the highest score. Tie/all-zero fallback: `lastViewed`, then first
saved trip `forward`.

### Geolocation term (added 2026-09-01, board-v2)

Saved trip stations MAY carry `location: {lat, lon}` (captured from
`/api/v1/stops` at save time; older trips are backfilled lazily by
re-querying the stops API and matching on id). When the user has granted
geolocation and a fix ≤5 min old exists:

```
locationFactor(candidate) =
  2.5  if distance(fix, origin(candidate)) ≤ 2 km
  1.0  if 2–10 km (or origin has no coords, or no fix/permission)
  0.3  if > 10 km
score = base score × locationFactor
```

Deterministic given (storage document, current time, fix). The fix never
leaves the device and is never persisted beyond the session. Permission is
requested contextually (user has ≥2 saved trips), never on first load;
denial degrades silently to time+history. Wherever trips are listed
(switcher, trip management), they are ordered by current score with the
predicted one visually highlighted at the top.

Invariants:
- Deterministic given (storage document, current time) — testable.
- Any change to the formula bumps no schema version (history format is
  stable) but must update this doc in the same change.
- The UI always shows *which* trip was predicted and offers one-tap flip
  and one-tap trip switch; the heuristic must never hide other trips.
