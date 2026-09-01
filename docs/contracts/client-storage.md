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
      "from": {"id": "200060", "name": "Central",
               "location": {"lat": -33.8840, "lon": 151.2062}},
      "to":   {"id": "215020", "name": "Parramatta",
               "location": {"lat": -33.8173, "lon": 151.0053}},
      "createdAt": "2026-08-31T17:00:00+10:00"
    }
  ],
  "history": [
    {"tripId": "uuid", "direction": "forward", "t": "2026-08-31T08:12:00+10:00"}
  ],
  "rides": [
    {
      "tripId": "uuid", "direction": "forward",
      "scheduledDeparture": "2026-08-31T08:10:00+10:00",
      "departedAt": "2026-08-31T08:12:00+10:00",
      "arrivedAt": "2026-08-31T08:41:00+10:00",
      "from": {"id": "200060", "name": "Central"},
      "to": {"id": "215020", "name": "Parramatta"}
    }
  ],
  "searches": {
    "from": [{"id": "213820", "name": "Rhodes",
              "location": {"lat": -33.8308, "lon": 151.0879}}],
    "to": [{"id": "202210", "name": "Bondi Junction"}]
  },
  "home": {
    "station": {"id": "213820", "name": "Rhodes"},
    "confidence": 4,
    "inferredAt": "2026-08-31T20:00:00+10:00"
  },
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
- `trips` is capped at 10. Adding an eleventh evicts the least recently viewed
  saved trip (creation time breaks a never-viewed tie). This is the web
  management policy; deletion becomes swipe-to-delete in the native app.
- `cache` holds the last successful departures response per pair, used for
  instant first paint and offline; capped at saved pairs only.
- `searches.from` and `searches.to` each hold the three most recently selected
  stations for that field, newest first and deduplicated by stop id. They store
  useful station answers, not raw keystrokes. Add-trip shows them before a
  query and ranks returned stops fuzzily, so a prefix such as `Rhode` ranks
  `Rhodes` first.
- A station's optional `location` is captured from `/api/v1/stops` at save
  time. Existing trips are backfilled lazily by stop id. Missing coordinates
  disable only the location term.

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
- `journey` is a full snapshot so directions and detail stay viewable after
  departure and offline. On each refresh the client re-matches it in fresh
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

## Completed rides and home-station heuristic

`rides` records a focused journey once its effective arrival has passed. It is
capped at 100 and deduplicated by trip, direction and `scheduledDeparture`;
`departedAt` and `arrivedAt` retain the effective times. A ride stores both
endpoint snapshots so later trip edits or deletion do not rewrite the evidence.
Completed rides therefore survive deletion or LRU eviction of their saved-trip
entry; prediction history and cached boards do not.

Home evidence is intentionally small and tuneable:

- an origin used before 11:00 adds one morning vote;
- a destination reached from 16:00 adds one evening vote;
- three votes establish a candidate; the stored `home` keeps the station,
  evidence count and inference time;
- until three votes exist, the first saved trip's origin is the low-confidence
  fallback and the UI makes no behavioural-history claim;
- if the last three completed evening rides all end at another station, home
  surfaces “Home may have moved” in place. It changes only after the user
  accepts.

A focused trip is OVER once `now` is later than its effective arrival. Home may
then offer the opposite direction, but accepting the offer clears the finished
focus and fetches a real return journey. Transfer platforms therefore come
from that return response; they are never produced by reversing the outbound
snapshot. Focusing a journey is the user's consent to directions mode, and
focusing another is the correction—there is no separate “I’m not on this”
state.

Invariants:
- Deterministic given (storage document, current time) — testable.
- Any change to the formula bumps no schema version (history format is
  stable) but must update this doc in the same change.
- The UI always shows *which* trip was predicted and offers one-tap flip
  and one-tap trip switch; the heuristic must never hide other trips.
