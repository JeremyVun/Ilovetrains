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
  "locationAsk": {"declinedAt": "2026-09-01T09:21:00+10:00"},
  "telemetry": {"opens": 12, "bucket": 37},
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
- `locationAsk` is optional and holds only the time the user last declined the
  location panel. Absence means never declined; a malformed value is dropped,
  not repaired.
- `telemetry` is optional and holds only how many opens this device has
  reached an answer on and a bucket 0-99 drawn once at random. It is written
  only while analytics is enabled (the production origin, no Global Privacy
  Control, no Do Not Track), only by `web/js/analytics.js` and only through
  the normal document update. A malformed value is dropped whole and starts
  again. The counts themselves never leave the device: analytics derives only
  the usage bands `1`, `2-5`, `6-10`, `11-15`, `16-20`, `21-25`, `26-30`,
  `31-35`, `36-40`, `41-45`, `46-50`, and `51+`; `opened` also carries a
  milestone only when the count is 1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100,
  150, 200, or 250. The bucket selects the experiment arm.
- A station's optional `location` is captured from `/api/v1/stops` at save
  time. Trips without coordinates are backfilled lazily by stop id. Missing
  coordinates disable only the location term.

## Analytics queue

Anonymous counters wait for the network under their own key,
`trains.analytics.v1`, because they are transport state rather than the
user's and an event must never rewrite `trains.v1`:

```json
{"queue": [{"t": "shown_predicted",
            "d": {"u": "6-10", "x.strip-placement": "a3"}, "n": 5}]}
```

- Written only while analytics is enabled; on any other origin nothing is
  stored, no request is made, and every experiment answers with its control
  arm. A malformed value or entry is treated as an empty queue. Known-offline
  flushes preserve the queue without calling fetch or beacon.
- `t` is an event name, `d` its dimensions, `n` how many times it happened.
  An event whose `t` and `d` match a queued entry increments `n` instead of
  appending, so a week offline is a few dozen entries however many opens it
  held.
- Capped at 200 entries, oldest dropped.
- A flush posts the queue as one JSON array to the analytics service, each
  entry gaining `"p": "ilovetrains"`. Fetches clear sent counts only on a
  2xx; an accepted page-leave beacon clears them when the browser queues it.
  Overlapping flush triggers share one in-flight fetch, and anything
  recorded during that request survives.
  These counters are the one thing on the device that is sent anywhere, and
  they never go to this app's server.
- `d` carries at most three keys: the usage band `u`, a running experiment's
  variant `x.<experiment>`, and either a setup source word `f` or, on
  `opened` alone, its milestone `m`. Never a station, coordinate, trip, line,
  clock time, journey or anything typed into a field. A new event name or dimension value is a
  change to this contract, not a build decision.

## Trip selection

Three things can name the trip a screen is about, and the two sides of a tap
read them in a different order:

- Home shows the focused journey if one is live, else the explicit selection,
  else the prediction.
- The departure board and journey detail show the explicit selection if the
  user made one, else the focus, else the prediction.

The explicit selection is the trip whose saved-trip row the user tapped. It
lasts for the page load and is never persisted, and it never writes `focus`. A
location fix arriving afterwards re-predicts only when nothing explicit was
chosen.

## Focused journey

The document may contain an optional `focus` field — "I'm on this train":

```json
"focus": {
  "tripId": "uuid",
  "direction": "forward",
  "focusedAt": "2026-09-01T09:07:00+10:00",
  "journey": { "…": "verbatim snapshot of the focused journey object" }
}
```

- Set only by `Take this train` on journey detail; nothing else writes it.
  There is no unfocus control: it clears itself once now > the journey's
  effective arrival + 30 min, and accepting the return offer that a finished
  focus produces clears it too.
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

### Geolocation term

Saved trip stations MAY carry `location: {lat, lon}` (captured from
`/api/v1/stops` at save time; trips without it are backfilled lazily by
re-querying the stops API and matching on id). When the user has granted
geolocation and a fix ≤5 min old exists:

```
locationFactor(candidate) =
  2.5  if distance(fix, origin(candidate)) ≤ 2 km
  1.0  if 2–10 km (or origin has no coords, or no fix/permission)
  0.3  if > 10 km
score = (base score + 0.01) × locationFactor
```

The 0.01 floor is what lets location answer where history cannot. Standing at
a trip's destination with no history at all, the way back scores
0.01 × 2.5 = 0.025 against the way out's 0.01 × 1.0 = 0.01, or 0.003 when the
origin is more than 10 km away, so the reverse wins. With no fix every
candidate carries the same floor, so they tie and the fallback answers as
before. Any real history dwarfs the floor: a single view an hour off and a day
old scores about 0.97, which outranks it from any distance.

Deterministic given (storage document, current time, fix). The fix never leaves
the device: it is never persisted and never sent to the server. Permission is
requested contextually (user has ≥2 saved trips), never on first load; denial
degrades silently to time+history. Declining writes `locationAsk.declinedAt`,
which suppresses the panel for 30 days across reloads; a Permissions API state
of `granted` or `denied` suppresses it outright, because the question has
already been answered. A client whose permission is already granted takes one
silent fix when home opens, without a prompt. Wherever trips are
listed (switcher, trip management), they are ordered by current score with the
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
then offer the opposite direction, and accepting that offer is the one path
other than expiry that clears a focus; it then fetches a real return journey.
Transfer platforms therefore come from that return response; they are never
produced by reversing the outbound snapshot. Focusing a journey is the user's
consent to directions mode, and focusing another is the correction — there is
no separate “I’m not on this” state and no manual unfocus.

Invariants:
- Deterministic given (storage document, current time) — testable.
- Any change to the formula bumps no schema version (history format is
  stable) but must update this doc in the same change.
- The UI always shows *which* trip was predicted and switching trip is one tap;
  the heuristic must never hide other trips. There is no reversal control: the
  opposite direction is offered automatically once a focused trip is over.
