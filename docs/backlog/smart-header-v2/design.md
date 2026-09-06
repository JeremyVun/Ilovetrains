# Smart header v2: location first

Design session 2026-09-05. Rulings are dated and binding; the mechanism is
what satisfies them. The item is ready to build only when "Open questions"
is empty and `build_plan.md` exists.

## The owner's words

- "as a user I would want the app to know that I'm at Bondi Junction, and if
  my home station tends to be Rhodes, it should suggest it to me in the
  smart header. There's probably two different states - in the 'travel
  mode' state, and outside of the travel mode state."
- "why do we need to do it based on what they have in their saved trips?
  What if I have nothing in my trips? new user experience should work out
  of the box too for smart header."
- "why is there a hardcoded time of 14:00? I could go somewhere and want to
  go back home before 14:00 - that seems like a silly rule."
- "The user's intent for opening the app is to travel somewhere from where
  they currently are. To prevent this messing things up if they are already
  in a trip, we'll need this concept of a 'travel mode' where we don't pull
  them out into new trips if they are in the travel mode. Then we'll need
  conditions for entry and exit from travel mode. based on geolocation,
  speed of travel, user action in the app, historical trends. Whatever
  information we can get, weighted appropriately. All local ofcourse."
- On correcting a wrong inferred entry: "'take this train' is like 3 clicks
  away if the inferred entry is wrong. is there a way to get it down to 1 or
  2 clicks? tapping another trip row to exit isn't good i think - the user
  might be genuinely browsing. and besides, if we are inferring based on
  their location, we have pretty strong confidence about the departure
  location. So maybe we just need to place a 'change destination?' button
  or something? It'll take them to the new trips screen with the departure
  station already filled in."
- On a one-field setup screen: "can't we just re-use the existing new trip
  screen and prefill the 'from' station. why do we need a new screen? Just
  use what is already familiar to the user."

## What it is

Today the header chooses among saved trips by view history, hour, day type
and a small location multiplier on saved origins. A station in no saved
trip is invisible to it, the way home needs the location floor to win, and
home is inferred from focused rides through two clock windows (before
11:00, from 16:00), the same kind of rule as the rejected 14:00.

After this item, outside travel mode the header starts where the user is.
The device carries an index of every train and metro station with
coordinates, so a fix names the nearest station even when no saved trip
mentions it. The origin is that station. The destination is the usual place
from there when history says so, home when the user is away from home, and
the familiar new-trip sheet with the origin filled in when the app knows
nothing yet. Home is inferred from where the phone is at the first open of
each day. Travel mode, today only the hand-focused journey, gains inferred
entry and exit so a user in the middle of a trip is never pulled out into a
new one. Inside travel mode the header is directions, as today.

## Rulings (all 2026-09-05)

1. **Origin is location first.** At or near a station, the header always
   starts there. With no fix, or more than 2 km from every station, today's
   predictor answers unchanged.
2. **Destination: history first, home when silent.** Among trips that start
   here, real view history near this hour outranks the home rule. With no
   such history the destination is home. No clock rule anywhere.
3. **Home is inferred from daily first-open votes, silently.** Each day the
   station nearest the phone at the first open with a fix casts one vote.
   Home is the station with the most votes among the last 7 daily votes and
   needs at least 3. It re-infers itself; the "Home may have moved" offer,
   the accept-home action and the 11:00/16:00 ride votes are deleted. With
   no location, home stays the first saved trip's origin. Station ids are
   persisted, never coordinates.
4. **An unsaved pair is auto-saved as a normal trip, on show.** When the
   answer is a pair no saved trip covers (at Burwood, home Rhodes:
   Burwood → Rhodes) it joins the saved list the moment it becomes the
   header's answer, and the ten-trip LRU governs it. No suggested slot, no
   new row grammar. A receipt says the app saved it.
5. **Travel mode has inferred entry**, from the minimal inputs: the clock
   (the last shown journey is under way), geometry (left the origin, nearer
   the destination) and a speed reading. No history waiver.
6. **The app persists the previous home open** (station id, shown journey
   snapshot, time; never a coordinate) and may take one high-accuracy fix
   while the last shown journey is under way by the clock.
7. **Correction of an inferred entry is `Change destination` only.** It
   opens the existing new-trip sheet with the origin filled in and re-enters
   travel mode on the same departure toward the new destination. Browsing
   other trips never exits travel mode. There is no "not on it" control;
   a wrong entry that is not a redirect ends by expiry or by
   `Take this train`.
8. **The location ask gains a row in the setup sheet's From field.**
   Never on load. (The home-panel half of this ruling was withdrawn by
   ruling 11.)
9. **Both sides share one baked station list.** The server answers
   `/api/v1/stops` from it (roadmap M6).
10. **No new screen.** First run with a fix, and the redirect, reuse the
    new-trip sheet with From prefilled, which needs no comps. The inferred
    strip's placement and wording, and the once-only "just added" mark on a
    trip row, DO go through a comps round (owner, on seeing the drafts:
    "can i see some comps first? i dont know where you're planning to put
    the strip"; "the trip row is already very very cluttered. The only
    thing i can see is 'just added' in small italics just above
    'departures >'. comps will be needed").
11. **The web location panel stays as it is.** The owner first asked
    whether the panel was justified chrome, then: "on web, we should still
    do the same thing as currently with the footer panel. I was talking
    about the mobile port (which will come later)." And: "descope this,
    just keep asking for now. i.e. web will always show the footer panel
    if there is no geolocation granted." No ask-again machinery; ruling 8's
    "from one saved trip" is withdrawn and the trigger stays at two.

## Mechanism

### 1. Station index

A baked list of every Sydney train and metro station (about 300 entries) in
the shape `/api/v1/stops` already returns: `{id, name, modes, location}`.
One source, two copies:

- `web/stations.json`, listed in the service-worker `SHELL` (bump
  `VERSION`), so the client names the nearest station offline and without
  a request. It is fetched once per page load and held in memory; it is not
  written into the storage document.
- `internal/stations/stations.json`, embedded in the Go server, which
  answers `/api/v1/stops` from it with the same fuzzy ranking
  `web/js/search.js` uses (prefix beats substring, `isBest` no longer
  exists). The upstream `Stops` client, the 24-hour stops cache and the
  7-day stale window go. `api.md` says the list is baked and how it is
  rebuilt.

A generator in `tools/` (documented in `tools/README.md`) downloads the
TfNSW static GTFS bundles for Sydney Trains, NSW TrainLink and Sydney
Metro, keeps `stops.txt` rows with `location_type = 1` (parent stations)
that a rail route actually serves, assigns `modes` by bundle, and writes
both copies. A Go test asserts the two copies are byte-identical. Verified
2026-09-05: GTFS parent-station ids are the Trip Planner stop ids, on all
five stations probed, so no `stop_finder` mapping step is needed; `200080`
is Wynyard, not Bondi Junction, and the client fixtures saying otherwise
are wrong (see `docs/references/tfnsw-open-data.md`, "Station index").

### 2. Where the user is: `here`

Given a fix at most 5 minutes old (`FIX_MAX_AGE_MS`) and the index, `here`
is the first of:

1. any index station within 200 m (the existing `AT` radius): the user is
   standing at it, saved or not. If several qualify, prefer a saved-trip
   endpoint, then the nearest (ferries ruling, 2026-09-05);
2. the nearest station that is an end of a saved trip, within 2 km;
3. the nearest index station within 2 km;
4. none.

Tier 2 sits above tier 3 so a user whose saved origin is 1.2 km away is not
handed a nearer station they have never used. 200 m and 2 km are the
numbers already in the contracts (`AT_ORIGIN_KM`, the 2.5 location band).

### 3. Home

`homeVotes`: at most 7 entries `{day: "2026-09-05", station: {id, name,
location}}`, one per local calendar day, written on the first home open of
that day that has a valid fix and a `here`. Older entries fall off the end.

Home is the station with the most votes; at least 3 are required; a tie goes
to the station of the most recent vote. With fewer than 3 votes, or no
location ever, home is the first saved trip's origin at confidence 0, as
today. A vote's `station.location` is the station's public coordinate, as
saved trips already carry; ruling 3's "never coordinates" is about the
user's fix, which is never written. The stored `home` object is removed: home is derived from the votes
on every read, so there is no stale copy. Rides no longer vote; `rides`
stays for receipts and the last-ridden line.

### 4. The answer outside travel mode

A pure function `locate(doc, nowMs, {fix, stations})` returns one of:

- `{kind: "trip", tripId, direction, leap}`,
- `{kind: "pair", from, to}`: no saved trip covers it; the controller
  saves it with `addTrip` and selects it (ruling 4),
- `{kind: "setup", from}`: no trips saved; the controller opens the sheet
  with From filled.

```
here = section 2, or none
if no here:
  no trips → setup with no origin
  else → today's predict(): history × time, location floor, lastViewed, first trip
home = section 3
candidates = every (trip, direction) whose origin is here, reverse included
if candidates:
  score each by today's base history score (day type, hour, recency)
  best > 0 and unique → that one, leap "usual"
  else if here ≠ home and one candidate ends at home → that one, leap "home"
  else → lastViewed among them, else the first, leap "usual"
else if here ≠ home → {pair: here → home}
else if trips → today's predict() (nothing starts here and here is home)
else → setup with From = here
```

`leap` drives the receipt (section 8). The location multiplier and floor
survive only inside today's `predict()`, which is the no-`here` branch.
The `setup` answers are unreachable from home in practice: the router sends
a trip-less document to the sheet before home renders, so first-run
prefilling is the sheet's own silent fix (section 7). The shape stays in the
contract.
Trip rows stay ordered by `rankTrips` with the header's trip first.

A fix arriving after the cached paint re-runs `locate` only when the
selection was predicted, as today. Auto-saving happens in that path too,
so a fix can add a trip; the write goes through `ctx.update`.

### 5. Travel mode

Travel mode is the focused journey. `focus` gains `by: "focus" | "inferred"`.
Every rule for a focused journey applies to both: the header is directions,
the status line describes the train, browsing never replaces it, refresh
re-matches the snapshot, expiry is effective arrival + 30 min, and the
way-back offer follows a finished journey. Inferred mode adds one strip
(section 7) and an earlier exit.

**Record of the previous open.** Whenever home renders an unfocused header
with a lead journey, at the write points only (home open from cache, and
each successful refresh), the document's `lastOpen` becomes:

```json
"lastOpen": {
  "at": "2026-09-05T08:05:12+10:00",
  "station": {"id": "213820", "name": "Rhodes Station"},
  "tripId": "uuid", "direction": "forward",
  "journey": { "…": "verbatim snapshot of the header's lead journey" }
}
```

`station` is the tier-1 `here` (within 200 m) at that open, or null. The
snapshot is what makes entry possible after the service has left the live
board. No coordinate is stored. Two consequences found in phase 3
(2026-09-05): inferred entry reads the record as it stood BEFORE this open
wrote it (the controller snapshots `lastOpen` on open and on visibility
return, since the cache-paint write lands before the fix does); and the
cache-paint write carries no station, because neither the index nor a fix
exists yet, so the fix's own refresh (write point 2) is what fills it. An
open whose refresh fails after the fix therefore leaves no platform
sighting, and the next open cannot infer entry from it.

**Inferred entry** is evaluated when a valid fix arrives on home (open, and
visibility return) and `lastOpen` exists. With `J = lastOpen.journey`,
`D` its effective departure, `A` its effective arrival, `O` its origin and
`Z` its destination:

1. under way: `D ≤ now ≤ A + 30 min`;
2. seen at the platform: `lastOpen.station.id == O.id` and
   `D − lastOpen.at ≤ 15 min`;
3. moved toward: `distance(fix, O) ≥ 1 km` and
   `distance(fix, Z) ≤ distance(O, Z) − 1 km`;
   or instead of 3: the fix reports `coords.speed ≥ 8 m/s` (about
   30 km/h) and `distance(fix, O) ≥ 200 m`.

All of 1, 2 and (3 or speed) must hold. Condition 3's first clause is
implied by its second (triangle inequality) and stays for readability; it
is load-bearing only in the speed clause, where the radius is 200 m. Entry
sets `focus` from the
snapshot with `by: "inferred"`, then `refreshFocus` re-matches it in fresh
data as it does for a hand-focused journey. Condition 3 is what stops a
return home for a forgotten laptop from reading as a ride. There is no
history term (ruling 5). Inference attaches to the journey shown, so a
rider who missed it and took the next one gets directions one service off:
the roadmap's accepted gap.

**Speed.** While `lastOpen.journey` is under way by the clock, the silent
fix on home is requested with `enableHighAccuracy: true`; otherwise it stays
low accuracy as today. **[verify, on a real phone]** whether Android Chrome
and iOS Safari fill `coords.speed` on such a fix; if neither does, the
speed clause is dead and the plan removes it rather than shipping it.

**Exit**, for both kinds of focus: the existing expiry, the way-back
acceptance, and a new one: a fix within 200 m of `Z` when
`now ≥ A − 5 min` marks the trip over immediately, so the offer arrives
when the rider steps off rather than up to 30 minutes later. Over means the
whole header: the status reads `TRIP OVER`, the directions take their done
treatment (the arrival figure, `AGO`, `You arrived at <Z>.`) and the offer
shows; a countdown may not stand under a `TRIP OVER` status (orchestrator
ruling 2026-09-05, phase 2 handoff).
Open for the owner (phase 3, 2026-09-05): a rider stepping off up to five
minutes early reads `Now` over `AGO` for those minutes, because
`countdownFigure(0)` is `Now`; the same pair already showed for the one
minute at the timetabled arrival. Ships as specified pending a verdict.

**Fixes.** The silent fix is taken on home open and on visibility return to
home when permission is granted (today: open only). Never persisted, never
sent.

### 6. Change destination

The inferred strip's one action opens the new-trip sheet (`#/trips/new`)
with From set to `O` and the To field focused. Before any query the To
results list the saved and recent destinations from `O`, newest first,
under the existing "You searched before" group. Saving:

1. adds the pair if new (ruling 4);
2. fetches `getDepartures(O, newZ, {at: D − 1 min, limit: 6})` and matches
   a journey by the existing key (first leg's `line.name`,
   `departure.scheduled`) to `J`;
3. matched: `focus` is replaced by that journey with `by: "inferred"` and
   home opens in directions for the train the rider is actually on;
4. unmatched: the board for the new pair opens with the explicit selection;
   the departed service is in its past rows and `Take this train` on it
   focuses by hand.

### 7. Setup sheet with location

`renderSetup(root, ctx, {origin})`. With an origin the From field is filled
and picked as if tapped, and focus moves to To. From stays editable.
Without an origin the sheet is today's. Two rows in the From results area
before any query, in the existing result-row grammar:

- permission `prompt`, no fix: a row that asks for the location. Tapping
  it requests a fix; granted, From fills with `here` (section 2, tier 3
  suffices); denied or failed, the row goes away silently.
- a valid fix and an empty From: a "near you" group with the one nearest
  index station.

First run with permission already granted (a returning user, or a PWA
installed after the site was granted) takes the silent fix and opens the
sheet with From filled. First run with `prompt` shows the row. Nothing
prompts on load. Auto-fill applies to first run only (no trips saved);
add-trip with a fix shows the `NEAREST STATION` group instead, so both
designed states are reachable and a returning user is not presumed upon
(phase 3 reading, 2026-09-05).

**The home panel is unchanged (ruling 11).** Trigger, copy and quiet
rules stay exactly as `playtest-fixes` shipped them: two or more saved
trips, `Not now` quiet for 30 days, a `denied` or `granted` permission
suppresses it. The setup row above is the only new ask. Ask-again
machinery is descoped.

**The setup lede is deleted** ("Save one direction only. When today's
ride is done, the way back is ready."). Owner: "stop putting in all this
extra copy. do we even need it? ... The user behaviour is visual scanning,
not novel reading."

### 8. Receipts

Classes, each with copy drafted by Codex and verdicted by the owner
(recorded under "Copy" once ruled):

- `usual`: from here to the usual place. No receipt: it explains itself.
- `home`, votes ≥ 3: the trip was chosen because it ends where the phone's
  days start. The copy names that evidence; it does not call the person's
  home their home, because votes are neither an action nor a ride.
- `home`, fallback: chosen because it ends at the first saved trip's origin.
- `pair`, this open: no header receipt (owner). The trip row the app just
  saved carries a once-only mark, "just added" in small italics just above
  the `DEPARTURES ›` cue, on the open that created it only (`createdAt`
  within this page load and the selection predicted). Placement goes
  through comps (ruling 10).
- inferred travel mode: the strip in section 6 is the receipt. Its
  placement and wording go through comps (ruling 10); the owner wants it
  shorter than "Is this trip going to <destination>?" and it may only speak
  of the trip, never of the rider travelling.
- unchanged: the ride-backed reverse receipt and the view-history receipts
  (they already require no fix).

### 9. Storage changes (client-storage.md)

- `homeVotes` added; `home` removed; ride votes and the moved rule removed.
- `lastOpen` added (section 5).
- `focus.by` added.
- The prediction section is rewritten around `locate` with today's formula
  kept as the no-`here` branch.
- The privacy sentence becomes: the fix is never persisted and never leaves
  the device; the document holds station ids and times derived from it, and
  never a coordinate.
- The location ask gains the setup-sheet row; the panel rules are
  unchanged.

### 10. Other contracts touched at closeout

- `ui.md`: smart home (top line unchanged; inferred strip; receipts; the
  location panel trigger and copy), setup (prefilled From, the two rows),
  calibration set (new exemplars for the inferred strip and the prefilled
  sheet, shot from the client).
- `api.md`: stops are baked; the rebuild procedure.
- `PROJECT.md` decisions: prediction description; "the progress marker is
  continuous" gains a sentence that travel mode may be entered from fixes.
- `ROADMAP.md`: M4 items landed here, M6 station index done.
- `docs/user_stories/`: 08, 09, 21 become boring; rewrite or delete.
- `tools/README.md`: the generator; `tools/shoot-states.js`: new states.

## Rejected alternatives

- A clock rule for the way home (14:00, or the 11:00/16:00 windows): the
  owner rejected clock rules for intent.
- Location as a weight only (today's multiplier): an unsaved station can
  never become the origin, which is the defect this item exists to fix.
- Home first over history when away from home: a freelancer with a record of
  going A → B from client A would be shown the way home instead.
- A replaceable "suggested" slot for an unsaved pair: auto-saving as a
  normal trip is simpler and the LRU already trims the list.
- Keeping the "Home may have moved" offer: the votes re-infer silently and
  the correction is the ordinary one-tap trip choice.
- A history waiver for inferred entry: more wrong entries for people whose
  day varies; revisit once the hit rate exists (roadmap M4, measure first).
- Tapping another trip row to exit inferred mode: the user may be browsing.
- A "not on it" control: the owner chose `Change destination` alone.
- A new one-field setup screen: the existing sheet with From prefilled is
  what the user already knows.
- Inferring entry from speed alone without a platform sighting: the app
  would not know which journey; guessing harder from weak signals.

## Copy (owner verdicts, 2026-09-05)

- `home` receipt, votes ≥ 3: `Your days usually start at <home>.`
- `home` receipt, fallback: the owner's own wording, `You usually travel
  from <home>.` (rejected both Codex drafts as unfriendly).
- Setup From row: `Use my location`. Nearest-station group label:
  `NEAREST STATION`.
- Inferred strip: `Going somewhere else?` with the action `CHANGE` (the
  owner's own words, 2026-09-05: "the copy should be 'Going somewhere
  else? CHANGE' or something like that"). This replaces every Codex
  candidate for the strip.
- Row mark: `Just added` in italics, in the sub line's status slot,
  followed by the distance (`Just added · 120 M AWAY`).
- Setup lede: deleted, not rewritten.

## Comps round 1 (2026-09-05)

Workshop `/tmp/trains-comps-shv2-r1`, sheet `index.html`, 78 shots, six
strip directions (A1–A6), eight mark treatments (B0–B7). The chosen frames
and the round's report are kept in `comps/` beside this file; the workshop
is disposable.

Findings that outranked taste: the row's name line has 33px of slack at 390
and "Just added" needs 63px, so a mark right of the name truncates "Bondi
Junction" on an ordinary trip at 360, 390 and 412; the sub line has 42px to
spare. Only the directions below the heavy rule (A3, A4, A6) keep it at
214px; A2 moves it to 258.

Rulings:

- **Strip: A3.** One line under the heavy rule and above `MY TRIPS`, the
  question at the left in the offer paragraph type (15px, weight 300,
  secondary ink), the action at the right in the offer button idiom
  (uppercase letterspaced, primary ink, 44px tap target), hairlines above
  and below, 49px tall. The owner: "I like either A2 or A3, but the copy
  should be 'Going somewhere else? CHANGE' or something like that." A3 is
  chosen over A2 because it keeps the header read-only (`ui.md`, Core
  flow) and the rule at 214px; A2 stays the first A/B candidate (see
  below). Exemplar: `comps/strip-a3-390x844-change.png` (its words are the
  round's candidate, not the ruled copy).
- **Mark: B6.** `Just added` in 12px italic in the sub line's status slot,
  the distance kept beside it; `SHOWN ABOVE` is dropped for that one open.
  Exemplar: `comps/mark-b6-390x844-before.png` and `-manyfive.png`.
- **A/B testing and analytics.** The owner: "we probably need to build a/b
  testing and analytics into this app from the get go. create backlog item
  for instrumenting this. The first use case will be a/b testing how to
  show this strip feature." Shipped: see `docs/contracts/analytics.md`.
  This item ships A3; the `strip-placement` experiment compares A2 and A3.

Contract additions the build makes: a second offer grammar below the rule
(one line, question and action), and the row-status slot may carry a fact
about the row for one open.

## Open questions

None. Ready to build once `build_plan.md`'s phases are read against this
file in a fresh context.


## Depends on

`playtest-fixes` landed 2026-09-05; its location floor is superseded in the
`here` branch and kept in the no-fix branch.
