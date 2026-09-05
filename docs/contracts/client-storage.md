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
  "homeVotes": [
    {"day": "2026-09-05",
     "station": {"id": "213820", "name": "Rhodes",
                 "location": {"lat": -33.8308, "lon": 151.0879}}}
  ],
  "lastOpen": {
    "at": "2026-09-05T08:05:12+10:00",
    "station": {"id": "213820", "name": "Rhodes"},
    "tripId": "uuid", "direction": "forward",
    "journey": {"…": "verbatim snapshot of the header's lead journey"}
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
- `homeVotes` holds at most seven daily votes for where the phone's days start,
  newest last, at most one per LOCAL calendar day. A malformed vote is dropped,
  not repaired, and a second vote on a day already voted is ignored.
- `lastOpen` is the header's previous unfocused answer: when, which station the
  phone was at (tier 1 only, or null), which trip and direction, and a verbatim
  snapshot of the lead journey. It is what makes inferred travel mode possible
  after the service has left the live board. Deleting the trip deletes it.
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
  "by": "focus",
  "journey": { "…": "verbatim snapshot of the focused journey object" }
}
```

- `by` is `"focus"` when the user tapped `Take this train` and `"inferred"`
  when the app entered travel mode from a fix. A focus written before `by`
  shipped reads as `"focus"`; any other value drops the focus.
- Written by `Take this train` on journey detail and by inferred entry below;
  nothing else writes it. There is no unfocus control: it clears itself once
  now > the journey's effective arrival + 30 min, and accepting the return
  offer that a finished focus produces clears it too.
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

### Travel mode

Travel mode IS the focused journey, whichever way it was entered. Every rule
above applies to both kinds: the header is directions, the status line
describes the train, browsing another trip never replaces it, refresh
re-matches the snapshot, expiry is effective arrival + 30 min, and the way-back
offer follows a finished journey.

**Inferred entry** is evaluated when a valid fix arrives on home and `lastOpen`
exists and nothing is focused. With `J = lastOpen.journey`, `D` its effective
departure, `A` its effective arrival, and `O` and `Z` the origin and
destination of `leg(trip, lastOpen.direction)` on the saved trip:

1. under way: `D ≤ now ≤ A + 30 min`;
2. seen at the platform: `lastOpen.station.id == O.id` and
   `D − lastOpen.at ≤ 15 min`;
3. moved toward: `distance(fix, O) ≥ 1 km` and
   `distance(fix, Z) ≤ distance(O, Z) − 1 km`;
   or instead of 3: the fix reports `speed ≥ 8 m/s` (about 30 km/h) and
   `distance(fix, O) ≥ 200 m`.

All of 1, 2 and (3 or speed) must hold. A deleted trip, or an endpoint with no
coordinates, is no entry. Entry sets `focus` from the snapshot with
`by: "inferred"`, and `refreshFocus` then re-matches it in fresh data exactly
as it does a hand-focused journey. Condition 3 is what stops a walk back home
for a forgotten laptop reading as a ride. There is no history term: a waiver
would buy wrong entries for people whose days vary.

Inference attaches to the journey that was SHOWN, so a rider who missed it and
took the next one gets directions one service off. That is a known and accepted
gap, not a defect.

**Exits** are the expiry above, the way-back acceptance above, and one more: a
fix within 200 m of `Z` when `now ≥ A − 5 min` marks the trip over
immediately, so the return offer arrives as the rider steps off rather than up
to half an hour later.

**Correction.** An inferred header carries one control, `Change destination`,
which opens the new-trip sheet with From set to `O`. Saving there re-enters
travel mode on the same departure toward the new destination when a journey
matches, and opens that pair's board when none does. Browsing another trip
never exits travel mode, and there is no "not on it" control: a wrong entry
that is not a redirect ends by expiry or by `Take this train`.

## Where the header starts: `locate`

Outside travel mode the header starts where the user is. `locate(doc, now,
{fix, stations})` is pure and returns one of three answers:

- `{kind: "trip", tripId, direction, leap}` — a saved trip, `leap` being
  `"usual"` or `"home"` (it chooses the receipt, below);
- `{kind: "pair", from, to}` — a pair no saved trip covers. The controller
  saves it with `addTrip` and selects it, and the ten-trip LRU governs it like
  any other; the row it creates carries a once-only `Just added` mark on that
  open;
- `{kind: "setup", from}` — nothing saved yet; the controller opens the
  new-trip sheet with From filled, or empty when `from` is null.

`here` is the station the user is standing at, from the baked station index
(`web/stations.json`, fetched once per page load, never written to the
document) and a fix at most 5 minutes old. It is the first of: any index
station within 200 m; the nearest end of a saved trip within 2 km; the nearest
index station within 2 km; none. The saved end outranks a nearer stranger so a
user whose own origin is a kilometre away is not handed a station they have
never used. Without the index, or without a fix, there is no `here`.

```
here = above, or none
if no here:
  no trips → setup with no origin
  else → today's formula below
home = the votes, below
candidates = every (trip, direction) whose origin is here, reverse included
if candidates:
  score each by today's base history score (day type, hour, recency; no
    location term and no floor)
  best > 0 and unique → that one, leap "usual"
  else if here ≠ home and a candidate ends at home → that one, leap "home"
  else → lastViewed among them, else the first, leap "usual"
else if here ≠ home → {pair: here → home}
else if trips → today's formula below
else → setup with From = here
```

Real history from where the user is outranks the home rule: a freelancer with a
record of going A → B from client A is not shown the way home instead. There
is no clock rule anywhere in this.

A fix arriving after the cached paint re-runs `locate` only when the selection
was predicted, never over an explicit tap. Trip rows stay ordered by
`rankTrips`, with the header's trip first.

### The no-`here` branch: today's formula, unchanged

With no fix, no station index, or more than 2 km from every station, the
predictor answers as it always has. Score every (trip, direction) candidate:

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

Deterministic given (storage document, current time, fix). The fix is never
persisted and never leaves the device; the document holds station ids and times
derived from it, and never a coordinate. Permission is requested contextually
(user has ≥2 saved trips), never on first load; denial degrades silently to
time+history. Declining writes `locationAsk.declinedAt`,
which suppresses the panel for 30 days across reloads; a Permissions API state
of `granted` or `denied` suppresses it outright, because the question has
already been answered. A client whose permission is already granted takes one
silent fix when home opens, without a prompt. Wherever trips are
listed (switcher, trip management), they are ordered by current score with the
predicted one visually highlighted at the top.

## Home, from the daily first-open votes

Each day, the first home open with a valid fix and a `here` casts one vote for
that station into `homeVotes`. Home is then, on every read:

- the station with the most votes among the stored ones, needing at least
  three; a tie goes to the station of the most recent vote among the tied;
- otherwise the first saved trip's origin at confidence 0, which claims
  nothing;
- otherwise nothing at all, when no trip is saved either.

Seven days of votes is the whole memory, so home re-infers itself silently when
someone moves: no offer, no confirmation, no stored copy to go stale. The
correction for a wrong home is the ordinary one-tap trip choice.

Completed rides no longer vote, and there are no clock windows. The receipt the
`home` leap prints names the votes when there are three (`Your days usually
start at <home>.`) and the fallback when there are not (`You usually travel
from <home>.`); a `usual` leap prints no receipt, because it explains itself.

## Completed rides

`rides` records a focused journey once its effective arrival has passed. It is
capped at 100 and deduplicated by trip, direction and `scheduledDeparture`;
`departedAt` and `arrivedAt` retain the effective times. A ride stores both
endpoint snapshots so later trip edits or deletion do not rewrite the evidence.
Completed rides therefore survive deletion or LRU eviction of their saved-trip
entry; prediction history and cached boards do not. They are what the
last-ridden line and the reverse receipt cite.

A focused trip is OVER once `now` is later than its effective arrival, or once
a fix places the phone within 200 m of the destination from `A − 5 min`. Home
may then offer the opposite direction, and accepting that offer is the one path
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
