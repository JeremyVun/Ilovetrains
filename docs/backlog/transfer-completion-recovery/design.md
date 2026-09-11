# Transfer completion and recovery

Status: design complete 2026-09-11, build plan in `build_plan.md`. Separate from the shipped
[final-arrival guards](../../contracts/client-storage.md#final-arrival-decision).

## Owner request

2026-09-09: “We need to apply the same ‘trip finished’ guards and semantics to
transfers, but maybe with a tighter buffer. Or something to help users with
trips where the transfer no longer works because the trains are annoyingly
late.”

2026-09-10, the spec in the owner's words:

1. “If its lateness impacts my ability to catch the intended connection, I'd
   want to know about it.”
2. “First of all, make sure the delay is visualised to the user and that they
   know about it through any of the current mechanisms we have.”
3. “Search for another way to get to where the user wants to go from their
   current location (maybe from the trip) and suggest it instead if there is
   one.”
4. “The smart header should automatically and dynamically recover to take the
   posture of ‘ok, based on your current location, here's the best way to
   continue your journey to your destination’.”

## Problem

A late incoming train can make the planned connection uncatchable. Today:

- Web prints the change window unclamped, so a connection the train now
  arrives after reads `Tight change · -3 min`; `minutesUntil` in
  `web/js/time.js` has no floor and `journey.js` treats any window under five
  as tight.
- Once the incoming leg's effective arrival passes, the web directions ladder
  in `web/js/focus.js` moves to the next leg and says `Get off at <destination>
  · TO GO`, as if the rider boarded a train that left before they arrived.
- The Android and iOS trackers already refuse this: an incoming effective
  arrival later than the onward departure shows a broken connection, never
  advances into the onward leg, and labels the destination `Planned`
  ([native-data](../../contracts/native-data.md#native-travel-tracker-data)).
  They offer nothing to do about it.
- No client suggests how to continue.

## Decisions

- **Time only, no location evidence** (owner ruling 2026-09-10). The rider's
  position for recovery is inferred from the clock and the focused journey's
  effective times, exactly as the directions ladder and the native trackers
  already do. The anchor for recovery is the change station and the incoming
  leg's effective arrival there, not a GPS fix. This works identically with
  location on or off, has no tunnel or interchange GPS problem, and leaves the
  final-arrival guard as the only location consumer. Alighting and boarding
  are never claimed.
- **Recovery is a re-anchored search, not a new planner.** The onward part of
  a lost journey is “next journeys from the change station to the destination
  at or after the incoming leg's effective arrival”. Online that is
  `GET /api/v1/departures?from=<change stop>&to=<destination>&at=<incoming
  effective arrival>`, filtered client-side to departures no earlier than the
  incoming effective arrival plus the connection floor. Offline, Android and
  iOS use the local planner with the same anchor; web has no planner and shows
  the lost state honestly with no alternative.
- **Recovery lives in the smart header** and the native trackers project it;
  journey detail carries no recovery control (extends the 2026-09-03 ruling on
  cancelled legs). No new settings or routing surface.
- **Not in scope:** getting off earlier or at a different change station. The
  API returns each leg's boarding and alighting stop only, so there is nothing
  to search from mid-leg.

## Mechanism (draft, refined by the comps round)

Connection states for the change after leg *i*, from printed clock minutes of
effective times, matching `journey.js`:

| Window `w = dep(i+1) − arr(i)` | State | Today |
| --- | --- | --- |
| `w ≥ 5` | ordinary | unchanged |
| `0 < w < 5` (or shrunk below printed) | at risk | existing tight change |
| `w ≤ 0` | lost | new; web currently prints a negative window |

Proposed and awaiting an owner number: lost at `w ≤ 0`. Rationale: a false
“lost” is worse than a false “tight”. If the app says the connection is gone
and the rider stops trying, they miss a cross-platform change they could have
made. The owner's “tighter buffer” instinct maps to where at-risk starts, not
to where lost starts.

- At risk: header unchanged (warn paint, `Tight change · n min · Platform p`),
  plus the existing next-service rail re-anchored to the change station,
  showing the fallback's departure and arrival. The rail answers “and if I
  miss it?” without being asked.
- Lost, still riding leg *i*: status carries a missed-connection word. The
  instruction stays honest about the train the rider is on (`Get off at
  <change> · Platform p`), with the platform, countdown and arrival figure
  taken from the recovery journey. A receipt explains the leap. The axis
  redraws its tail with the recovery legs.
- Lost, dwelling at the change station: countdown and instruction are the
  recovery journey's first leg; the same composition as an ordinary dwell.
- Lost with no candidate (web offline, or nothing found): the lost state is
  shown, no rail, no invented alternative, destination arrival becomes
  `Planned` as the native trackers do.
- Storage: the focus snapshot is re-matched per refresh by every leg's
  `(line.name, departure.scheduled)`, so recovery legs cannot be spliced into
  it. Recovery is a sibling record on the focus (change index, the recovery
  journey snapshot, its own source freshness), refreshed by its own request
  on the recovery pair. This is two requests per refresh while recovering and
  a contract change to the “fetch only for the selected trip” rule in ui.md,
  which guards saved-trip fan-out rather than the focused journey's tail.
- Preserve explicit choices: an explicitly pinned service stays pinned; a
  recovery journey is never labelled `PINNED`. Cancellation presentation keeps
  priority over lost.

## Journey alerts (owner ruling 2026-09-11)

Journey alerts shipped 2026-09-10 ([ui.md](../../contracts/ui.md#journey-alerts)):
four live cues (get off, change, missed connection, cancelled), one buzz each,
native only, never pre-scheduled. The missed-connection cue already fires on
the transition into the tracker's missed-transfer stage.

Owner ruling 2026-09-11: **a delay itself must buzz.** “People rely on
arrival times for whatever they are doing.” Threshold suggested by the owner:
more than 5 minutes late. Recommended shape, pending the owner's number:

- The measured quantity is the delay of the rider's effective arrival at their
  destination against its scheduled arrival, in printed clock minutes, since
  that is what a rider plans against. A late first leg with slack in the
  change does not move the arrival and does not cue.
- Cue once per focus identity generation when that delay first reaches the
  threshold; an estimate that grows further does not cue again, an estimate
  that recovers below the threshold and crosses it again does. Same baseline
  and silence rules as the existing four cues.
- TfNSW's own punctuality definition counts a Sydney Trains service as on time
  within 5 minutes of schedule (intercity within 6), so 5 minutes is the
  operator's own line between on time and late. Recommendation: cue at
  `arrival delay ≥ 5 min`.
- Add a tight-change cue when a still-catchable window drops under 5 minutes,
  and carry the recovery plan in the missed-connection alert body once
  recovery exists. Copy via Codex; owner verdicts.

## Flow recordings (2026-09-11)

The owner could not read the flows from static comps and asked for a
recording. Round 1 is extended with a timeline per concept: the header at
09:20, 09:33 (delay lands, buzz), 09:45, 10:00 (get off), 10:03 (dwell),
10:08 (board) and 10:18 (arrive), rendered as video with a clock and cue
marker, plus a side-by-side of all concepts. Verdict pending.

## Copy

All user-facing strings (status word, instruction, receipt, rail label) are
drafted through Codex `gpt-6-astra` and verdicted by the owner; candidates
appear first in the comps round.

### Alert copy candidates (Codex gpt-6-astra, 2026-09-11, owner verdict pending)

Build default in bold; the owner may overrule and the string is changed in
the contract and the clients. Placeholders are filled from the composed
journey. Codex wrote `platform` in lower case; the clients print `Platform n`
as everywhere else.

Delayed cue (title / body):
- **`Running late` / `The train is now due at <destination> at <HH:MM>.`**
  (title changed from Codex's `Delayed` so the alert uses the same word as
  the `RUNNING LATE` status; body is Codex candidate 1 verbatim)
- `Delayed` / `The train is expected to reach <destination> about <n> minutes late.`
- `Delayed` / `Arrival at <destination> is now expected at <HH:MM>, about <n> minutes late.`

Tight change cue (title / body):
- **`Tight change` / `The train is expected at <station> about <n> minutes before <service> leaves.`**
- `Tight change` / `The estimated change time at <station> is now about <n> minutes.`
- `Tight change` / `The estimated gap between trains at <station> is now about <n> minutes. The connecting train leaves from platform <platform>.`

Missed connection body with a candidate (title stays `Connection missed`;
without a candidate the shipped body is unchanged):
- **`The planned trains no longer connect. Another option is <service> at <HH:MM> from <station>.`**
- `The train is too late for the planned connection. Another train on <service> is due to leave <station> at <HH:MM> from platform <platform>.`
- `The planned trains no longer connect. The replacement connection is <service> at <HH:MM> from platform <platform> at <station>.`

`<service>` is the line code with its article, `the T4`.

## Comps

Round 1 (2026-09-10): workshop and verdict recorded below when the round
closes. Question: how the header shows an at-risk change with a fallback, and
a lost connection with and without a recovery journey, on both frames and
schemes, against the current change/late/next-service exemplars.

### Round 1 verdict (2026-09-11)

Workshop `/tmp/trains-comps-transfer-recovery-r1`, sheet `index.html`, flow
recordings in `flows/` (five columns synchronised on the clock; the shipped
web client as the before). Owner watched the recordings and refused all four
directions: “they all fail the usability test. If the connection is missed,
why would the connection from platform 5 still show? It just looks strange to
have the connection just stay there. The user is already trained to read the
trip line as a continuous journey over time.”

Diagnosis: the replacement is the next T4 from the same Platform 5, which is
the common real case, and nothing on the axis distinguishes it from the train
that was missed. The percentage axis rescales, so the leg stretching and the
onward leg sliding later are invisible. A struck clock and a receipt do not
carry the swap.

What carries forward: the re-plan posture (figure, arrival and instruction
follow the journey the rider can still make), the receipt naming the two
times, `Planned` and no rail when there is no candidate. Refused: the hollow
ghost chip (rail direction), the ghost bar above the axis (drawing
direction), the promoted `PLATFORM 5` cap while riding (anchor direction).

Findings from the recording that need rulings or contract changes:
- `RUNNING LATE` is granted only on a departure delay (ui.md), so a train
  that leaves on time and loses nine minutes en route is never called late.
  The rule must include arrival delay on the relevant leg.
- Every direction dropped `PINNED` while the lost word was shown; the ruling
  that an explicit pin stays labelled needs a composition or a change.
- Once the replacement is boarded the lost word retires and the header is an
  ordinary ride (comp agent's choice, orchestrator agrees, owner to confirm).

Round 2 brief: the owner's complaint verbatim; directions must make the
re-plan legible on a continuous time axis (time-labelled change, motion at
the moment of loss, axis ending at the change with a “then” clause until the
rider is there, a notch in the ride where the missed departure fell). Every
direction is judged from its flow recording, not stills.

### Round 2 verdict (2026-09-11)

Workshop `/tmp/trains-comps-transfer-recovery-r2`, flows in `flows/`. Five
directions recorded against the refused round 1 re-plan. Owner: “Replanning
is ok. Are we overcomplicating this?” Ruling: **the re-plan header plus a time
on the change label** (direction “the change carries a time”). The exemplar
frames and the flow recording are copied to [`comps/`](comps/):
`d1-time-390x844-lost-riding.png` is the binding composition while riding,
`d1-time-390x844-lost-dwell.png` at the change, `d1-time-390x844-lost-none.png`
with no candidate, `flow-d1-time.mp4` the whole timeline. Numbers and words
in those frames are the spec.

Refused: the line stopping at the change with a “then” clause, the stretch
animation, the notch where the missed train left. They add a drawing mode or
motion to three clients for a gain the label already delivers.

What the chosen frames fix, as rulings:

- Status while lost: `LATE · CONNECTION GONE` in the warning colour, with the
  pin icon (no word) beside it when the focus is an explicit pin. The saved
  row carries the same string; corrected measurement 168px in a 212px track.
- Change label: `<STATION> · <LINE> <HH:MM>` (`TOWN HALL · T4 10:08`) under
  the change whenever the boarded service is a recovery. When the label
  exceeds its track (`MACQUARIE UNIVERSITY · T4 10:08` is 202px in 201px) drop
  the line code before wrapping; the station name is never ellipsised.
- Arrival figure: the original effective arrival struck, the recovery's
  effective arrival beside it in the arrival clock's own size.
- Instruction while riding: unchanged `Get off at <change> · Platform n`.
  At the change: `Board the <HH:MM> at <station> · Platform n`. Receipt:
  `The <line> arrives at <HH:MM>, but the <line> left at <HH:MM>.`
- After the recovery service is boarded the lost word retires and the header
  is an ordinary ride (`RUNNING`, `TO GO`).
- No candidate: the lost status, the instruction line
  `The <line> arrives too late for the <HH:MM>` in the warn idiom, receipt
  `Check the station boards.`, arrival `Planned` under the original time, no
  rail, dead connection chips drawn as today. Copy is a Codex draft; owner
  may overrule.
- `RUNNING LATE` (and the lost pair) is granted on a positive departure OR
  arrival delay of the relevant leg; today's departure-only rule never calls
  a train late that left on time and lost nine minutes en route.
- A recovery hours away draws its true wait; the axis is a time axis and
  stays honest rather than special-cased. Chips clamp as today.

Defaults taken to keep the item small, each overrulable by the owner:

- Lost threshold: printed-minute window `w ≤ 0` (arrival at or after the
  onward departure). At risk stays `0 < w < 5` with today's tight-change
  presentation; the re-anchored rail from round 1 is dropped.
- The recovery search uses the followed journey's mode allow-list and
  transfer cap.
- Journey detail renders the composed journey (ridden legs, then the recovery
  legs) with the same change label and the receipt as its summary line, and
  no recovery control.

## Build log

- 2026-09-11, orchestrator, from the web seam survey: while a recovery
  record exists, focus expiry and the final-arrival decision use the
  composed journey's effective arrival, and the focus identity stays the
  original journey's (`tripId:direction:journeyKey(focus.journey)`), so the
  arrival-guard window and the followed request are not reset by recovery.
  The displayed-focus predicate (modes, transfer cap) is evaluated on the
  followed journey only; the candidate was already searched under the same
  allow-list and cap, and the composed journey may exceed the cap without
  hiding the header. Web caches the recovery response in memory beside the
  focus body, not in the saved-trip cache, whose keys are saved pairs only.

- 2026-09-11, orchestrator, from the native seam surveys: the Android and
  iOS trackers today decide a missed transfer by a strict millisecond compare
  (`effectiveArrival > effectiveDeparture`, `TravelTrackerState.derive`), while
  their copy layer already uses printed minutes. The shared seam's
  printed-minute rule (`w ≤ 0` lost) replaces the millisecond compare in both
  trackers, so a change printed `09:59 → 09:59` is lost on every client.
  Journey-alert cue identity `(kind, legIndex)` uses composed-journey leg
  indices; a replaced recovery record is a new tail and may cue again.

- 2026-09-11, phase 0 agent, decisions the frames implied and the plan did
  not state, all overrulable: the status is `CONNECTION GONE` with the
  `LATE · ` prefix only while `RUNNING LATE` is also granted (the dwell frame
  prints `CONNECTION GONE` alone because the candidate is on time); a
  recovery change was never printed together, so only `w` decides it and the
  shrunk clause does not apply; a tight change of the composed journey keeps
  the tight-change instruction while the status stays lost; the candidate
  floor `w ≥ 3` is inclusive; the receipt retires with the status when the
  candidate is boarded, the struck arrival and change label stay; six-cue
  precedence is cancellation, missed connection, lead cue, tight change,
  delay; broken (cancelled) never triggers a recovery search.

- 2026-09-11, orchestrator, from the iOS build (tcr-p3 8c7eaf4): the fixture
  exposed three undocumented iOS divergences from ui.md that the port now
  corrects, none of them in `ios-deviations.md`: the riding tight-change
  clause named the alighting platform (ui.md: the boarding place), the final
  leg said `Stay on to <destination>` (ui.md: `Get off at <destination> ·
  Platform n`), and a later cancelled leg lacked the `<HH:MM> from <station>
  cancelled` instruction and struck arrival; the `Printed change was <n> min.`
  receipt was also missing. Android carries the first two (`UiHome.kt`
  `focusedInstruction`). These are contract fixes, shown to the owner as
  before/after frames in the verification wave, not regressions.
  Contract gaps for closeout: the missed-connection cue fires when a followed
  change first becomes lost (with or without a candidate), not only on the
  tracker's `MissedTransfer` stage; the no-candidate comp shows `OFFLINE`
  beside `LATE`, which the `RUNNING LATE` freshness rule forbids, so the
  fixture's `fresh` no-candidate case (status with `LATE`, pill `LIVE`) is
  the spec and an offline no-candidate reads `CONNECTION GONE` alone.

- 2026-09-11, orchestrator, from the web build (tcr-p1 f70b80c): the
  no-candidate axis. The contract (from the round 2 words "dead connection
  chips drawn as today") draws both legs with the `3` and `5` chips touching
  at the change; the binding frame `comps/d1-time-390x844-lost-none.png`
  drew only the ridden leg with a single `3` chip. Web and iOS both follow
  the contract; the owner picks from the two frames at verification. The
  shoot-states sweep has 7 invariant failures and 2 aborts that reproduce
  identically at the base commit 36d9ad7 (`mascot-stale-before`,
  `home-over`, `home-five-trips`, `home-arrived`, `past-register`,
  `past-register-scrolled`, `focus-returns-home`,
  `mascot-next-focus-source-handoff`, `reverse-real-platforms`); they are
  pre-existing and out of this item's scope.

- 2026-09-11, orchestrator, from the Android build (tcr-p2 b47701a): Android
  corrected the same undocumented divergences as iOS (tight-change boarding
  platform, final-leg `Get off at`, later-cancelled-leg instruction and
  struck arrival, `Printed change` receipt) plus: the shrunk clause now
  applies on Android, detail clamps a negative window to `0 min`, the saved
  row drops `· Pinned` beside a lost connection, and two instrumented
  fixtures whose changes were seconds wide were corrected (real fixture
  bugs the printed-minute rule exposed). Android has no per-cue alert
  title/body (recorded in android-deviations.md: the notification states the
  next event from the tracker state), so the ui.md alert strings bind the
  iOS Live Activity; on Android the recovery is carried by the composed
  projection in the notification. Closeout must say so in ui.md.

- 2026-09-11, orchestrator, from the Fable review (tcr-review 7d3bd7d,
  report `/tmp/tcr-review-report.md`): seven defects go to the fix wave with
  the review's probes as acceptance tests. Two contract gaps ruled by the
  orchestrator on web's reading, overrulable by the owner: (F6) when the
  candidate's own change becomes lost and the search from that change finds
  nothing, every client shows the no-candidate composition anchored at that
  change (the composed journey up to it, `The <line> arrives too late for
  the <HH:MM>`, `Check the station boards.`, `Planned` under the original
  time), never a struck arrival beside a time the rider cannot make; a
  fixture case is added for it. (F9) the ride recorded at the end is the
  followed journey's own record, as web and Android do; iOS aligns. Also
  ruled from the contract's existing words: a held candidate is re-matched
  by key and kept while its change is tight (the tight-change instruction
  shows), and re-picked only when the record is cleared or its change is
  lost; while a record is held, the refresh searches from the record's own
  anchor, so the tail cannot oscillate; the recovery request is made on
  every refresh while recovering, re-matching the held journey, so the
  candidate's estimates stay live; the candidate's first leg must board at
  the change stop.

## Still open

Owner verdict on the no-candidate axis (both legs with touching chips, as built, or the ridden leg alone, as the comp): see the build log. Nothing blocks the build plan. Overrulable defaults are listed under the
round 2 verdict; alert copy for the two new cues (`Delayed`, `Tight change`)
was drafted by Codex on 2026-09-11 (see "Alert copy candidates" under Copy); the build uses the bold defaults until the owner verdicts.

## Verification cases

Delayed incoming train with onward still catchable; onward departure missed;
recovery train itself late; recovery journey with its own change; lost change
on a two-change journey; resume during a transfer; offline on web (no
candidate); offline on native (local planner candidate); explicit pin
retained; cancelled leg outranks lost.

