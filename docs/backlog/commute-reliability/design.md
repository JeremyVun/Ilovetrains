# Commute reliability: trip mode that starts and ends when you ride

Stage: ready for build. Execution: [build_plan.md](build_plan.md).
Calibration exemplars: [comps/exemplar/](comps/exemplar/), with their
measurements in [comps/MEASUREMENTS.md](comps/MEASUREMENTS.md).

## Owner brief, verbatim (2026-10-01)

> Having many issues with the app. Android, but wouldn't be surprised if it was
> happening to ios and web too.
>
> - Had taken the train in the morning from rhodes to townhall. I have that as
>   a saved trip, but i didn't open the app. On the way home, I did open the app
>   near town hall but it didn't suggest the way back in the smart header. I
>   managed to search town hall to rhodes, and then it showed up in the smart
>   header, but then when i took the train, it never went into trip mode, and
>   when i tapped the smart header to go to "departures from townhall", i
>   couldn't scroll up to see past departures so i couldn't even find the trip
>   that i had taken and pin it to activate the smart header.
>
> - Also, i keep consistently getting an issue on my trips from rhodes to
>   redfern where it goes into trip mode just fine, but after getting off the
>   train, it never ends the trip. Infact, it get sstuck on something about
>   cannot confirm arrival for basically forever.

## Owner rulings

Rulings 1-7 are from 2026-10-01 and 8-24 from 2026-10-02, answering options
laid out in the design session (21-24 during the build). Quoted text is the option label and
description the owner chose, or the owner's own words.

1. Trip end: “End after estimate (Recommended)” — “3 min after the last arrival
   estimate, end the trip with the existing honest copy ('The last arrival
   estimate has passed. The return trip is ready.'), record the ride, offer the
   way back. Only a phone seen moving at train speed away from the destination
   keeps it going. Trade-off: a train stopped between stations with stale
   realtime could end early.” Rejected: confirming arrival from background
   location (Play policy and a bigger change) and shortening the 2-hour hold
   to 30 minutes.
2. App left open while boarding: “Yes (Recommended)” — “While Home is on screen
   and the train it showed has departed, take a location fix with each
   30-second refresh. Keep the departed train as the evidence until you're seen
   at the platform again, which means you didn't board it.”
3. Tapped trip: “After 10 min away (Recommended)” — “Returning after 10+
   minutes in the background counts as a new open: lands on Home with a fresh,
   location-aware answer. Quick app switches keep the board you were on.
   Applied to web, Android and iOS alike.”
4. At a station: “400 m saved, 300 m seen (Recommended)” — “A saved station
   within 400 m beats an unsaved one within 200 m (fixes the Gadigal case).
   'Seen at the platform', which trip mode needs, counts within 300 m instead of
   200 m.”
5. On a moving train, asked whether to stop auto-saving `<passing station> →
   home`, the owner answered: “if the user opens the app while thye have
   already boarded, i would like it to be able to enter trip mode, and we have
   no choice really but to enter trip mode based on whatever station they are
   passing no? I guess also as long as it's easy enough to exit trip mode.”
   This became rule 5 below; a passing station is never `here`.
6. On-board entry: “Yes, in this batch (Recommended)”.
7. Exit: “'Not on this train' control (Recommended)” — “A second quiet control
   beside 'Change destination' on inferred trips. It ends trip mode at once,
   records no ride, and stops that service being guessed again. Pinned trips
   keep 'Unpin'. Needs a quick visual comp first because it changes the
   header.” Superseded in part by rulings 8-15.
8. Words, after round 1: “I don't like any of them. Why not "stop trip" or
   something. surely there's a better place to put that?” and “stop trip”.
9. Placement, after round 2: “E: on CHANGE's line” — `Going somewhere else?
   STOP TRIP | CHANGE`.
10. Pinned trips: “Yes, both (Recommended)” — Stop trip ends a trip the rider
    started as well as a guessed one, in the same place.
11. Instead of an undo: “I think we need a "Start trip" button, and also i think
    that if you select another trip row from the trip results that is currently
    in progress, that should become your new trip. Have a think and investigate
    how we can do something like this.”
12. Board: “Starts trip at once (Recommended)” — tapping a train that has left
    but not arrived makes it the trip at once, replacing any current one;
    upcoming and arrived rows still open the journey screen.
13. Start trip on Home, verbatim: “if we show a "start trip" button on home, it
    should literally start whatever it's attached to, but obviously if the trip
    is in the future or the past (if that's even possible), we wouldn't show a
    "Start trip" button. Why would we have another "board" button? that's dumb.
    Also, i hope we aren't causing a regression on the auto smart header trip
    starts. thats the only thing that reliably works most of the time.” Then:
    “Leaves within 15 min (Recommended)” — shown when the header's train
    departs in the next 15 minutes, never for a train further off or one that
    has left; it starts exactly that train.
14. Words: “Yes, Start/Stop only (Recommended)” — `Pin this train` / `Unpin
    this train` become `Start trip` / `Stop trip`, and `PINNED` leaves the
    status line.
15. Experiment: “Close it now (Recommended)” — read `strip-placement` on the
    data so far and hard-code A3, the line under the heavy rule.
16. Lock screen: “Yes, in this batch” — the Android notification and the iOS
    Live Activity get a Stop trip button.
17. After round 3, guessed-trip line: “what was wrong with the normal E we
    picked last time? just do that” — round 2's E, `Going somewhere else?
    STOP TRIP | CHANGE`, unchanged.
18. Lone states: “▶ / ■ glyphs (Recommended)” — `▶ START TRIP` and
    `■ STOP TRIP` when the action stands alone on the line.
19. Start line: “Name it: 'Taking the 09:24?' (Recommended)” — the startable
    line reads `Taking the <HH:MM>?` with `▶ START TRIP`, naming the header's
    train so it is not read as the next-service row's train below it.
20. Status before departure: “Service status (Recommended)” — a started trip
    shows the service's own status (`RUNNING`, `RUNNING LATE`, `CANCELLED`)
    where it showed `PINNED`.
21. Estimate ending, asked during the build after the web drive showed the
    sign `The last arrival estimate has passed. The return t…` cut at 390 px
    above the offer `Trip over · You’ve arrived. The return trip is ready when
    you are.`: “Drop 'You've arrived' (Recommended)” — on an estimate ending
    the offer reads `The return trip is ready when you are.`; a
    location-confirmed ending keeps `You’ve arrived.` The sign wraps instead
    of cutting. No new words.
22. Setup, asked during the build: “Setup keeps nearest (Recommended)” —
    setup's “Use my location” keeps picking the nearest station within
    200 m, as before; the 400 m saved-station preference shapes only Home's
    answer and trip-mode inference.
23. Stop on a started trip, asked during the build after phase 2c showed that a
    rider who stops a trip they started while still riding is guessed back in
    by the next train-speed fix: “Always stick (Recommended)” — Stop trip
    records the decline for any trip that belongs to a saved trip, started or
    guessed. Guessing stays off for that trip for an hour or until the train's
    arrival + 30 min, whichever is later. Only a guessed stop sends
    `declined_inferred`.
24. Offline board, asked during the build after phase 3b found boards with no
    upcoming row: “Fix it in this item (Recommended)” — both phones plan the
    next 24 departures from now plus the last 15 minutes as today, and merge
    them, so the board always shows upcoming trains.

The owner's regression concern in ruling 13 is binding: automatic trip starts
that work today must keep working. Every rule below only adds ways in, and the
shared fixtures carry today's passing auto-start cases as regression cases.

## What changes for the rider

- Opening the app near the station you came in to offers the way back, even
  after you tapped a trip earlier that day, and even when another station
  (Gadigal is 152 m from Town Hall's point) is a little nearer.
- Trip mode starts when you open the app on the train, whether or not the app
  saw you on the platform, and when you keep the app open while boarding.
- One pair of words runs trip mode: `Start trip` and `Stop trip`. Home offers
  `Start trip` for the train it shows when that train leaves within 15
  minutes; `Stop trip` ends any trip mode, on Home and on the lock screen.
- On the departures board, tapping a train that is on its way makes it your
  trip, which also corrects a wrong guess.
- The departures board on Android always lets you scroll up to the trains that
  just left, so you can find the one you are on.
- A trip ends three minutes after its arrival estimate unless the phone is
  plainly still riding. `Arrival unconfirmed` no longer sits on screen and in
  the notification for two hours.

## Diagnosis, verified against the code on 2026-10-01

Each symptom has a code cause. File references are at commit `698d0ba`.

**No way back near Town Hall.** Two causes; which one hit the owner is unknown.

- A tapped trip never expires on native. `explicit` (Android
  `TrainViewModel.kt:43`, iOS `TrainViewModel.swift:25`) is set by a row tap,
  a saved search, `showReturn` and, on Android, a tracker notification tap
  (`TrainViewModel.kt:320`). It clears only on unpin or deleting the selected
  trip. While it holds, `choosePrediction` returns early
  (`TrainViewModel.kt:397`) and fixes never re-predict. Android's view model
  is application-scoped (`TrainApplication.kt:8`), and the tracker's
  foreground service keeps the process alive for hours, so a trip tapped
  yesterday can still own today's header. The screen also persists, so an open
  can land on an old board.
- `here` prefers any station within 200 m over a saved one further away
  (`Prediction.kt:58-65`, `web/js/stations.js:49-66`). Gadigal is 152 m from
  Town Hall's index point. Within 200 m of Gadigal but not Town Hall, `here`
  is Gadigal; no saved trip starts there; Android then auto-saves
  `Gadigal → home` and predicts that.

**No trip mode on the train.**

- Native inference reads the stored `lastAnswer` after the open's own board
  refresh may have overwritten it. On resume Android starts the refresh before
  the silent fix (`startForegroundWork`, `TrainViewModel.kt:450-457`); the
  refresh writes a new `lastAnswer` naming the next train
  (`TrainViewModel.kt:580-592`), and `location()` then infers from that
  (`TrainViewModel.kt:902`). The next train has not departed, so entry fails.
  iOS has the same order (`TrainViewModel.swift:323`, `:546-555`, `:982`).
  Web avoids this by snapshotting `previousOpen` (`web/js/main.js:591`).
- The platform sighting needs a fix within 200 m of the station point and no
  older than 5 minutes at every refresh (`TrainViewModel.kt:589`; web tier 1).
  Each 30-second refresh rewrites the record, so a stale fix erases the
  sighting, and once the shown train departs the next refresh replaces it
  with the following train. With the app open through boarding, nothing
  retains the departed train and no fix is taken, because fixes are taken
  only on open, return and back-to-Home.
- With no platform sighting at all (the app first opened on board), the
  current rules cannot enter.

**Cannot scroll to past departures (Android only).** The board calls
`earlier()` only when the list reaches index 0 *and* a past row exists
(`UiBoard.kt:45-53`). Past rows come only from the timetable plan starting 15
minutes ago (`TrainViewModel.kt:543`). More than 15 minutes into a ride
there is nothing above `NOW` and no way to page. A refresh also cancels an
in-flight past page (`TrainViewModel.kt:510`). Web loads a past page on open
(`web/js/main.js:1143`); iOS pages with pull-to-refresh.

**`Arrival unconfirmed` for about two hours.** The guard arms as soon as
foreground location sampling starts after departure, before any usable sample
(`Arrival.kt:107`). Once armed, only a destination confirmation ends the trip
before expiry at `max(A + 30 min, retainedAt + 2 h)`. Confirmation needs the
app open at the destination for 30-60 s. A matching background refresh renews
`retainedAt` until arrival, so expiry is about two hours after arrival. On
Android confirmation almost never succeeds even with the app open:
monitoring subscribes the network and GPS providers together
(`MainActivity.kt:184-212`). Network fixes carry no speed and poorer
accuracy, and they interleave with GPS fixes, which breaks both the
contiguous low-speed window and the contiguous near-destination window.
Separately, setup-location cancellation calls `stopLocation()`, which kills
the arrival listener while the view model still believes it is monitoring
(`TrainViewModel.kt:1111-1115`, `MainActivity.kt:130-136`).

## Rules

The web client stays the reference implementation. Rules 1-7 bind all three
clients; rules 8 and 9 name per-client work.

### 1. A trip ends after its estimate unless the phone is still riding

The final-arrival reducer changes; constants, sampling, destination
confirmation and the retention renewal rule are unchanged.

Let `A` be the composed journey's effective arrival. After the existing early
returns (cancelled, location-confirmed, legacy), destination confirmation,
`now < A` (travelling, with the existing estimate withdrawal) and expiry, an
armed guard resolves as follows:

| Situation | State / action |
| --- | --- |
| Guard already settled with basis `estimate` | `arrived`, basis `estimate`; `record`, or `correct` when the ride exists. Movement cannot revive it; only an ETA back in the future (the `now < A` rule) withdraws it. |
| Fresh away evidence and sustained vehicle-like movement (`moving`) | `arrivalUnconfirmed`, `moving: true` (`Arrival uncertain`). Retention renews as today. |
| `now < A + 3 min`, or permission pending, or inside the evidence wait | `checkingArrival` |
| Otherwise | `arrived`, basis `estimate`; guard basis becomes `estimate`; `record` (`correct` when the ride exists) |

Never-armed behaviour is unchanged: estimate completion at `A`. A never-armed
guard with permission pending reads `checkingArrival` at any time, since no
stopped `arrivalUnconfirmed` is left to fall to (web build reading).

`arrivalUnconfirmed` therefore always means moving. The stopped/ambiguous row
of the guarded-arrival table (`Arrival unconfirmed` / `Arrival time needs an
update.`) is removed from every client and the tracker surfaces. Estimate
completion of an armed trip uses the existing estimate copy (`The last arrival
estimate has passed. The return trip is ready.`, or the schedule-only
variant), the return offer and `rode_pin`/`rode_auto` with `b: estimate`.

**Evidence wait.** The existing `resumeWaitUntil` input becomes the evidence
wait: 45 s from the moment foreground arrival monitoring starts or restarts
for the focus (not only on resume), replacing the 15 s lookup. Android's
`arrivalLookupComplete` timer and the web/iOS equivalents move to 45 s. The
wait exists because sustained movement needs three speed samples spanning
30 s: without it a rider who opens the app on a late, still-moving train
would be settled before the evidence could show movement. The wait also
continues to hold an overdue expiry, as it does today. As built on the web:
the wait starts once per focus identity per foreground visit when monitoring
starts, and again at an open or return past `A`; a watch-error restart within
the visit does not extend it.

**Expiry.** The retention deadline `max(A + 30 min, retainedAt + 2 h)`
applies only while the guard is armed and unsettled (no basis). A settled
focus, by estimate or location, expires at `A + 30 min`. Android's
`focusExpiry` and every client's `deadline()` change accordingly.

Accepted trade-off (ruling 1): a train stopped away from the destination with
stale realtime ends three minutes after its last estimate. The copy is
already honest about this: it says the estimate passed, not that you arrived.

### 2. Where you are

`here(doc, stations, fix)` changes for every client:

- A fix at train speed has no `here` (see below). It casts no home vote,
  creates no pair, adds no location term, and records no sighting.
- Tier 1: the nearest saved endpoint within **400 m** (index coordinates
  when available, else the saved snapshot); otherwise the nearest eligible
  index station within 200 m.
- Tiers 2 and 3 are unchanged (nearest saved end within 2 km, then nearest
  index station within 2 km).

Setup's “Use my location” is not `here` (ruling 22): it keeps the previous
order, a saved end within 200 m, then any eligible station within 200 m,
then the 2 km tiers, with no train-speed rule (web `setupHere`).

**Sighting.** The station recorded in `lastOpen`/`lastAnswer` is `here`'s
station when the fix is within **300 m** of it, else null. This replaces both
"tier 1" (web) and the 200 m check (native).

**Train speed.** A fix is at train speed when its reported speed is finite
and at least 8 m/s. A negative speed counts as no speed, and an accuracy is
known when finite and non-negative. A fix without a usable speed is at train speed when the
previous Home fix, taken 15-120 s earlier with both accuracies known, is at
least `8 m/s × Δt + accuracy₁ + accuracy₂` away. That bound subtracts the
worst-case error of both positions, so GPS jitter cannot produce it. The
previous Home fix lives in memory only and is cleared with the in-memory fix.

### 3. The shown-train record survives until it can no longer be ridden

`lastOpen` (web) and `lastAnswer` (native) keep their schema and their
writers. A new write rule protects a record that inference could still use.

A stored record is **inferable** at `now` when its station is the origin `O`
of `leg(trip, direction)`, `0 ≤ D − at ≤ 15 min` and `now ≤ A + 30 min`
(with `D` and `A` the record journey's effective departure and arrival), and
its trip still exists.

While the stored record is inferable, a new record replaces it only when the
new record's sighting is that same station `O` and either the stored
journey has not departed (`now < D`), or the sighting fix was taken at least
60 s after `D`. Any other write is skipped and the stored record stays. A
sighting at the origin a minute after the train left shows that the rider
stayed on the platform. An unsighted record, or one sighted elsewhere
(including an intermediate station the train is stopped at), proves nothing,
so it cannot erase the evidence. Explicit clears are unchanged: starting or
stopping a trip, the return offer, deletion and expiry clear the record.

Inference evaluates two records, and either may enter: the snapshot taken when
this Home open began, before any write of this open, and the stored record.
The web already infers from its `previousOpen` snapshot; that stays exactly
as it is. Platform-sighted entry's "seen at the platform" condition is
`D − at ≤ 15 min` with no lower bound on every client, as `client-storage.md`
states and the web does. Both natives carried an extra `0 ≤ D − at`. Phase 2b
found it, and the lead removed it on 2026-10-02 for parity: it only adds
entries. Android and iOS gain the same snapshot, which is what fixes the
open race on its own. The hold rule protects the stored record for an app that
stays open. Keeping both is deliberate (ruling 13): today's working auto-start
path is untouched, and the new rule can only add entries. The 60 s margin
exists because a train pulling out is still within 300 m of the platform for
roughly its first 20-30 s.

### 4. Fixes while Home stays open

While the app is foreground on Home, nothing is focused, the location
preference is on and permission is granted, take one fix per 30-second
refresh tick when any of these holds:

- a journey Home displayed as its lead during this foreground visit departed
  within the last 5 minutes (kept in memory; this is the owner's "the train
  it showed has departed", sighted or not);
- the stored record is inferable and its journey has departed (`D ≤ now`); or
- the most recent Home fix, taken within the last 2 minutes, was at train speed.

Five minutes after a departure the train is well clear of the platform, so the
first or second fix in that window either sees train speed (rules 3 and 5
can enter) or sees the rider still standing there. A rider who waits for the
next train gets a fresh five-minute window when that one leaves.

The fix is handled like any Home fix (rules 2, 3 and 5 apply), and a tick
produces at most one board refresh: the fix's handling replaces the tick's
own refresh. Web requests these fixes with high accuracy and `maximumAge: 0`,
as its existing under-way rule already does. Location use is therefore
bounded to five minutes after each shown departure, the under-way window of
a sighted record, and the time the phone moves at train speed with Home on
screen.

### 5. On-board entry

Evaluated on every Home fix when nothing is focused, after platform-sighted
inference (the existing three conditions, now reading the held record) has
not entered, and only for a fix at train speed. Let `P` be the fix.

1. **Candidate trips.** Compatible saved trips whose endpoints both have
   coordinates, with `d(P, O) ≥ 1 km`, `d(P, Z) ≥ 1 km` and
   `d(P, O) + d(P, Z) ≤ 1.5 × d(O, Z)`. The corridor ratio bounds how far
   off the straight line a route may bend. Rhodes → Redfern through Strathfield
   is 1.27, and Town Hall → Rhodes through Strathfield is 1.2.
2. **Direction**, per candidate trip. With a finite heading (Android
   `bearing`, iOS `course ≥ 0`, web `coords.heading`) at train speed, the
   direction whose destination bears within 90° of the heading. Otherwise the
   previous Home fix taken 15-120 s earlier decides: the direction whose
   destination came at least 200 m closer. With neither, the candidate is
   undecided and waits for the next fix (rule 4 keeps fixes coming). Each
   test decides only when exactly one direction passes it; otherwise the next
   test applies.
3. **Running journeys** for each decided (trip, direction): request
   departures `O → Z` with `at = now − (Δ + 10 min)`, where `Δ` is the median
   effective duration in that pair's cached board (the lower middle value for
   an even count; else 60 min), limit 10,
   under the current modes and cap. Native also plans the same window from the
   offline timetable (limit 30) and merges by journey key, online first. Keep
   journeys with `D ≤ now ≤ A`, not cancelled, modes and cap allowed. At most
   one request per candidate; at most the three candidates with the smallest
   corridor ratio are evaluated, after trips under an active decline are
   removed.
4. **Match.** For each journey, time progress `f_t = (now − D) / (A − D)`.
   Position progress `f_p = d(O, P) / (d(O, P) + d(P, Z))`. A journey matches
   when `|f_t − f_p| ≤ 0.25`.
5. **Choice.** Among matching (trip, direction, journey) triples, the highest
   base history score for that trip and direction at this hour (the existing
   no-location score), then the smallest `|f_t − f_p|`, then the stable
   journey key, then saved-trip order, then forward before reverse. History breaks the case where two saved trips share a train
   (Rhodes → Town Hall and Rhodes → Redfern on the same T9).
6. **Exclusions.** A recorded ride for the same trip, direction and scheduled
   departure; and an active decline (rule 6).
7. **Entry** is the existing inferred entry: `focus` with `by: "inferred"`,
   that journey and its source board. Refresh, arrival monitoring, the
   tracker and `Change destination` then work as for any inferred focus.

`Δ` was first the longest duration. Phase 3a measured an iOS offline plan
with a 99-minute T9 → T9 → T1 itinerary, which pushed the request back past
everything ten online services could reach, so on-board entry never found the
train on frequent lines. The median (lead's decision, 2026-10-02) keeps the
window near a typical ride. On a very frequent line a rider a few minutes out
can fall after the tenth service; a later fix catches them as the train ages
into the window, and native's timetable plan of 30 covers it at once.

With trains eight minutes apart on a 25-minute ride, neighbouring services
differ by about 0.32 in `f_t`, so the 0.25 window separates them. Very
frequent services can match one service off, which is the gap trip mode
already accepts. `Change destination` corrects a wrong destination among
overlapping trips; `Stop trip` corrects everything else.

### 6. Start trip and Stop trip

Trip mode is started and stopped with one pair of words (rulings 8-16). The
internal `focus` model, its `by: "focus" | "inferred"` field and the
analytics event names stay as they are; only what the rider reads and taps
changes.

**The trip-control line.** The inferred strip under the heavy rule (A3 layout,
now the only layout) becomes the trip-control line. Its composition in each
state, settled in comp rounds 2 and 3:

| Home state | Line |
| --- | --- |
| Guessed trip mode (`by: "inferred"`) | `Going somewhere else?  STOP TRIP │ CHANGE` (rulings 9 and 17, round 2 concept E unchanged) |
| Trip mode the rider started (`by: "focus"`) | `■ STOP TRIP` (ruling 18) |
| No trip mode, and the header's train leaves within 15 minutes | `Taking the <HH:MM>?  ▶ START TRIP`, where `<HH:MM>` is the header train's departure clock (rulings 18-19) |
| Otherwise | no line |

The line is 49 px in every state, as today's strip. When the startable line
appears it moves MY TRIPS down by that height. That is one saved row fewer
above the bar at 375×667, and it follows from ruling 13. A started trip's status
band shows the service status (ruling 20).

`PINNED` leaves the status line, and with it the status button that unpinned.
The journey screen's action rail reads `Start trip` where it read `Pin this
train` / `Pin this ferry`, and `Stop trip` where it read `Unpin this train` /
`Unpin this ferry`. A guessed trip's journey screen keeps no action rail, as
today; its Stop trip lives on Home and the lock screen. The words are the same
for every mode.

**Start trip** starts exactly the journey it is attached to, as `Pin this
train` does today: it writes a focus with `by: "focus"`, replacing any focus,
and returns Home. On Home it is attached to the header's lead journey. It is
shown only while that journey has not departed and departs within 15 minutes
(`0 ≤ D − now ≤ 15 min`), the same window auto-start uses for "seen at the
platform", and is not cancelled. It is never shown for a later train or one
that has left. Starting the guessed journey itself only turns `by` into
`focus` and keeps its arrival guard. Starting any trip and accepting the
return offer clear `lastOpen` and the open snapshot (the explicit clears of
rule 3).

**Running rows on the board.** Tapping a board row whose journey is on its way
starts trip mode on it at once, exactly as `Start trip` would, and lands on
Home. On its way means `D ≤ now < A` with effective times, not cancelled, and
modes and cap allowed. It replaces any current trip mode, which is how a wrong
guess is corrected to the right train. Upcoming and arrived rows still open the
journey screen.

**Stop trip** ends trip mode on Home, on a started trip's journey screen, and on
the lock screen: an action on the Android tracker notification and a button on the iOS
Live Activity (iOS 17 `LiveActivityIntent`, running in the app process). For
every trip it does what unpin does today. It removes the focus without writing
a ride, clears a matching `lastOpen`, stops arrival monitoring and the tracker
session, and returns Home answering from the prediction where the phone is now
(the explicit selection is not kept). A lock-screen stop is honoured only for
the still-current tracker identity, like the existing open and dismiss
intents. It persists the decline below for any trip whose journey belongs to
a saved trip (ruling 23), and on a guessed trip it also sends
`declined_inferred`.

**The decline**, for every stopped trip that belongs to a saved trip: a
guessed focus names its trip, and a started focus belongs to the saved trip
whose endpoints match its pair in either direction. A started trip on an
unsaved pair writes none. `inferenceDeclined` in the personal
document: `{"tripId": "uuid", "direction": "forward", "at": "…ISO…",
"departure": "<departureKey of the declined journey>", "arrival": "…ISO…"}`,
where `arrival` is the declined journey's composed effective arrival when
stopped (added in the web build: without it the arrival + 30 min bound cannot
be computed). All five fields are required. Native documents use their
existing time encoding. While it is active, no inferred entry (platform
or on-board) happens for that saved trip in either direction until the later
of `at + 60 min` and the declined journey's effective arrival + 30 min. The
declined departure key is never inferred again for that trip. One record; a
new decline replaces it; deleting the trip deletes it; a malformed record is
dropped. The hour exists because a car following the line would otherwise be
matched to the next train along one fix later. A rider who stopped by
mistake restarts with `Start trip` or a running row; there is no undo bar
(ruling 11).

**The experiment** `strip-placement` closes (ruling 15): A3 is hard-coded, the
A2 code and the `x.strip-placement` dimension go, and `EXPERIMENTS` loses its
row while the bucket is retained, as `analytics.md` prescribes. The A2
lost-receipt defect found in round 1 disappears with A2.

### 7. A return after 10 minutes is a new open

A return to the foreground after at least 10 minutes in the background is a
new open on every client. On return the client lands on Home (setup when no
trip is saved). It clears the explicit selection and drops board, detail,
setup and settings navigation state. Then it runs the normal open path:
prediction, silent fix and refresh. A tracker notification, Live Activity or
widget tap that brought the app forward still lands where it points; the
reset never overrides it. Shorter absences keep today's behaviour.

"Background" means: Android `onStop` without a configuration change (the
existing `backgrounded()` call), iOS scene phase `.background`, web
`document.hidden`. The explicit selection otherwise still lasts for the
session, as the trip-selection contract says.

### 8. Past departures on the board

- **All clients**: the first past page of a board is anchored at
  `now − 30 min` with limit 10, so the services that just left are reached
  first. Later pages keep the existing `earliest − 60 min`.
- **Native**: every past page merges the online page with the offline
  timetable plan for the same `at` (limit 30). Online rows win by journey key;
  either one alone is used when the other fails. A timetable-only past row
  uses the existing scheduled register.
- **Android**: loads the first past page as the board opens, like the web.
  Reaching the top of the list requests the next page whenever none is in
  flight, including retrying after a failure, with or without past rows on
  the board. A board refresh never cancels or discards a past page in
  flight; the page merges into the current board for the same pair. The list
  still opens at the `NOW` anchor and keeps it in place as rows arrive above.
- **Native offline board** (ruling 24): a board's timetable plan is two
  plans merged by journey key: the next 24 departures from `now`, and the last
  15 minutes as today. Phase 3b found that the single plan from `now − 15 min`
  with limit 24 can fill with departed rows on a busy corridor. On Central →
  Parramatta at 08:00 every row had left between 07:45 and 07:59, so the board
  offered no train to take.
- **iOS** keeps pull-to-refresh at the top as its past-paging gesture. It is
  recorded as an iOS deviation, because loading on open would push the
  anchor. Web is unchanged apart from the first-page anchor.

### 9. Android location plumbing

- Arrival monitoring uses one stream: `LocationManager.FUSED_PROVIDER` when
  the device has it and it is enabled (API 31+), else GPS when enabled. A
  network fix is used only when no GPS fix arrived in the last 20 s.
- Single Home fixes prefer the fused provider the same way, so they carry
  speed and bearing.
- `Fix` gains an optional bearing; the setup lookup, single Home fixes and
  arrival monitoring use separate listeners. Cancelling setup location never
  stops arrival monitoring, and the view model's monitoring flag tracks the
  real listener.

## Analytics

`entered_inferred` is sent by all three clients (today web only), and a new
event `declined_inferred` is sent by all three when `Stop trip` ends a guessed
trip, from Home or the lock screen. Neither carries a dimension beyond the
standard ones. The decline rate `declined_inferred / entered_inferred` per
platform is the measure of wrong entries. Stopping a trip the rider started
emits nothing, as unpinning does today, though it still writes the decline
(ruling 23). `Start trip` on Home and a running-row
tap are explicit starts and emit `pinned_<kind>` under its existing rules (the
event name stays). The `strip-placement` experiment row and `x.*` dimension
are removed (rule 6). These are contract changes (`analytics.md`) recorded
here as design decisions; the owner may veto them at review.

## Shared fixtures

- `tools/fixtures/conformance/commute-feedback.json`: rule 1. Changed
  expectations are A2-stopped-away and A2-unknown-speed-away
  (`checkingArrival`), A3-buffer-boundary and A9-restored-armed (`arrived`,
  `estimate`, `record`), and A11-resume-lookup (`checkingArrival`). New cases
  cover: stopped away at `A + 3 min` settles; the evidence wait holds at
  `A + 5 min`; permission pending holds; settled estimate plus fresh moving
  samples stays `arrived`; settled estimate at `A + 30 min + 1` expires
  without a new ride.
- `tools/fixtures/conformance/prediction.json` (generated from web): rule 2
  cases. They cover a saved endpoint at 250-400 m beating an unsaved station
  within 200 m, using the real Town Hall and Gadigal coordinates; a
  train-speed fix with no `here`; and a derived train-speed fix.
- New `tools/fixtures/conformance/inference.json` consumed by web, Android and
  iOS tests. It covers the hold rule (unsighted, elsewhere-sighted,
  same-origin before departure, same-origin within and after 60 s),
  platform-sighted entry from a held record, and on-board entry. On-board
  cases: direction by heading, by previous fix and undecided; progress match
  and miss; the history tie-break between overlapping trips; ride and decline
  exclusions; corridor and 1 km bounds. Regression cases (ruling 13) replay
  today's passing auto-start: a platform-sighted record, the fix a few
  kilometres along, entry on the shown journey. One case uses the snapshot
  alone, one the stored record alone, and one has the open's refresh writing
  an unsighted record before the fix. Every case must enter exactly as today.
  Start trip cases cover the 15-minute window (shown at 15 min, hidden at
  15 min + 1 s and after departure) and the running-row predicate
  (`D ≤ now < A`, not cancelled).

## Not in this item

- Background location confirming arrival (rejected in ruling 1).
- Matching a vehicle against the offline timetable's stop-by-stop times;
  progress matching uses journey endpoints only so all three clients agree.
- Gapless backward paging beyond the recent past for very frequent services.
- Loading past rows on board open on iOS.
- A Start trip button on the lock screen: lock-screen surfaces exist only
  during trip mode.

## Contracts to change at closeout

- `client-storage.md`: `here` and the sighting radius; train speed;
  `lastOpen` hold rule and the open snapshot on every client; inferred entry
  adds on-board entry and the decline; `inferenceDeclined` schema (web
  document and both native stores); final-arrival table, evidence wait and
  expiry; trip selection lifetime (10-minute new open); the native
  `lastAnswer` description; "Pinned"/"Pin this train" wording in the focus
  sections becomes Start trip / Stop trip.
- `ui.md`: core flow (Start trip, running-row starts, Stop trip replacing
  `Pinned`/unpin); the trip-control line replacing the inferred strip and its
  A2 variant; the journey-screen rail words; the guarded-arrival table without
  the stopped row; board past paging; Home as the open state after 10
  minutes; lock-screen Stop trip in the tracker presentation.
- `analytics.md`: `entered_inferred` on all platforms, `declined_inferred`,
  the `strip-placement` experiment removed.
- `ios-deviations.md`: pull-to-refresh past paging. `android-deviations.md`:
  location provider choice, if it remains a visible difference.
- `assets/comps/latest/commute-feedback/`: the `missing-telemetry` frames
  show the removed `Arrival unconfirmed` state and are replaced by
  `Checking arrival` captures or removed; the trip-control line exemplars
  join `assets/comps/latest/` from the round 3 verdict, replacing the
  `home-*-inferred-a2*` frames, and the travel-tracker Live Activity
  exemplar gains the Stop trip button.

## Comp rounds

### Round 1 — Not on this train (2026-10-01, all refused)

Workshop `/private/tmp/ilt-notontrain-r1/` (sheet `index.html`, report
`OPTIONS.md`), worktree `/private/tmp/ilt-notontrain-r1-wt` at `698d0ba`.
Spec: rulings 5 and 7 verbatim; one tap, 44px, quiet, distinct from CHANGE,
both strip-placement arms (A3 ships on native), train and ferry wording.

Concepts: A, `× NOT ON THIS TRAIN` as a second row under the CHANGE strip
(+40 px to MY TRIPS); B, a last line of the header above the heavy rule
(+44 px); C, in the status band, `RUNNING · × NOT ON THIS TRAIN` (0 px, but
the words drop beside `LATE · CONNECTION GONE`). The literal reading,
"beside CHANGE" on one line, needs 400 px against a 339-368 px track.

Owner verdict, verbatim: “I don't like any of them. Why not "stop trip" or
something. surely there's a better place to put that?” Words: “stop trip”.

Carried forward:

- The control's words are `Stop trip` (uppercase in the house action idiom).
  This replaces `Not on this train` everywhere in this design; there is no
  train/ferry variant.
- Experiment: “Ship; read pre-release data (Recommended)” — ship in both
  strip-placement arms and read the experiment only on events before this
  release.
- A2 arm: “Inside header too (Recommended)” — in A2, the exit lives inside
  the header with the CHANGE correction. The existing A2 defect, where the
  strip hides the lost-connection receipt, is fixed in phase 4.
- Measurements that still hold: the quiet ink `--ink-3` fails AA for 12px
  control text (4.37:1 dark), so a control uses `--ink-2` or stronger.
- Refused: all three placements.

### Round 2 — Stop trip placement (2026-10-02)

Workshop `/private/tmp/ilt-stoptrip-r2/` (sheet `index.html`, report
`OPTIONS.md`, `concepts.patch`), worktree `/private/tmp/ilt-stoptrip-r2-wt`.
Concepts: D, a third bottom-bar item; E, on CHANGE's line as `Going somewhere
else?  STOP TRIP | CHANGE`; F, under the header's arrival time; G (the
agent's recommendation), the bar's left slot switching between `+ NEW TRIP`
and `■ STOP TRIP`.

Owner verdict: E (ruling 9), for pinned trips too (ruling 10), with Start trip
and running-row starts instead of an undo (rulings 11-14).

Carried forward, measured in round 2:

- E needs 338.5 px of the 339 px track at 375 px. At 360 px it cuts the frozen
  question to 147.2 of its 161.7 px. Round 3 must solve narrow widths.
- In E, STOP TRIP and CHANGE sit 22 px apart and at 14 px can read as one
  phrase. Round 3 must keep them distinct.
- The A2 receipt fix is moot: A2 closes (ruling 15).

### Round 3 — the trip-control line (2026-10-02)

Iterate on E as the exemplar. Spec: rulings 8-16 verbatim. The line's four
states are guessed (question, STOP TRIP, CHANGE), started (STOP TRIP),
startable (START TRIP for the header's train leaving within 15 minutes) and
absent. Frames are 360, 375, 390 and 412 px wide, dark and light. Also comp
the iOS Live Activity with a Stop trip button against
`assets/comps/latest/travel-tracker/`; the Android notification action is
drawn by the system.

Workshop `/private/tmp/ilt-tripline-r3/` (sheet `index.html`, report
`OPTIONS.md`, `concepts.patch`, `la/` Live Activity mocks), worktree
`/private/tmp/ilt-tripline-r3-wt`. Concepts: E1 (STOP TRIP in a ruled end
cell), E2 (`STOP TRIP   Going somewhere else?  CHANGE`, the agent's
recommendation), E3 (`■ STOP TRIP … CHANGE DESTINATION`).

Owner verdict: rulings 17-20. E stays as round 2 drew it. The lone states take
E3's glyphs, and the startable line borrows E1's `Taking the 09:24?`.

Carried forward, measured in round 3:

- E at 360 px in Roboto (Android) leaves the question 0.2 px short (155.6 of
  155.8 px). The build closes that without ellipsis or wrapping, for example
  by taking 1 px from the gap before STOP TRIP. E fits a 375 px iPhone with
  0.5 px spare.
- Glyphs: `■` and `▶` in the bar's glyph ink (`--ink-2`), `aria-hidden`,
  centred on the caps; native `stop.fill` / `play.fill` and
  `Icons.Filled.Stop` / `Icons.Filled.PlayArrow`.
- Removing `PINNED` changes only the status words in a pixel diff.
- Live Activity: the lock-screen card and expanded Dynamic Island are both
  at the 160 pt height limit. The card takes a worded `■ Stop trip` capsule in
  its headline row; the expanded island takes a round `stop.fill` button
  (28 pt, accessibility label "Stop trip") inward of the countdown. The
  compact and minimal islands take no button.

### Round 3b — synthesis exemplars (2026-10-02, done)

The verdict combines parts of three concepts, so it was shot once more as the
calibration exemplar the build is briefed against. Workshop
`/private/tmp/ilt-tripline-r3b/`. The durable copy is `comps/` in this
folder: 64 Home and rail frames at 360, 375, 390 and 412 px in both schemes,
the five Live Activity mocks, `MEASUREMENTS.md` and the comp-only
`concepts.patch` (`concept=r3b`).

- Lone `■ STOP TRIP` stands at the right, where `▶ START TRIP` was, so the stop
  appears under the same thumb after the tap. Every action on the line lives in
  E's right-hand column.
- 360 px fix: the question carries `margin-right: -1px` (a 13 px minimum
  gap before STOP TRIP). At 360 in Roboto it prints whole, 155.8 of 155.8 px.
  The 375, 390 and 412 frames are pixel-identical to round 2's E.
- Glyphs are centred on the caps within 0.25 px in both fonts; round 3's
  drawing sat 0.75 px low in Roboto.
- Web at 360 px in SF, which no phone uses, still cuts the question to 148.2 of
  161.7 px. A macOS visual-regression run at 360 will show it; that frame is
  not an exemplar and is not a defect.
- Defaults taken without a ruling, open to owner objection: the startable line
  moves MY TRIPS down 49 px (375×667 shows one saved row fewer); the expanded
  Dynamic Island carries an icon-only round stop button because it is at its
  160 pt height limit; the journey-screen rail stays words-only.
