# Board v2 — playtest round

Owner playtest feedback 2026-09-01, verbatim (each is a binding complaint;
designs are judged against these words):

1. "I don't see past trips still. Id like for infinite scroll / pagination
   e.g. the view always lands at current time, but the user can scroll up to
   see past times."
2. "the big number for minutes is often confused as the platform."
3. "the usability isn't great, and the colour coding for different lines is
   not visible enough. I.e. blue, orange, red lines etc."
4. "the primary view is mobile. the buttons are small and not in the
   intuitive place for mobile. also, it's not intuitive to press edit to go
   back."
5. "I also want smarts in the app so it knows where you are, what the likely
   trip on your list is, and then highlights it at the top."
6. Process: "iterate until we get a really good design and usability for
   humans."

## Scope

- **Past departures**: the board is a timeline that LANDS at now and scrolls
  UP into the past (see api.md `at` addition). Past rows render in their own
  honest register (they ran; show scheduled/actual clock times, no
  countdowns). The "now" anchor must be unmissable and the board must never
  open scrolled into the past.
- **Board v2 composition**: fix the figure/platform ambiguity (complaint 2) —
  candidates include labelling weight, position exchange, or making the
  platform the figure — comps decide, complaint decides the winner. Line
  colour must be VISIBLE (complaint 3): the line's colour as a first-class
  element per row (rail/bar/badge at real size), not a 10px letterspaced
  code. Still the B·Editorial language (STYLES.md) unless a comp proves the
  language itself is the problem — flag that as an owner call, don't decide
  it.
- **Mobile-first navigation** (complaint 4): thumb-reach primary actions,
  obvious back affordance everywhere (EDIT is not a back button — detail
  view's BOARD label and trips' DONE have the same disease). Propose a
  navigation model: where flip/switch/edit/back live on a phone held in one
  hand. Tap targets ≥44px.
- **Location smarts** (complaint 5): geolocation term in the prediction
  (client-storage.md), station coords via the stops API (api.md). When
  multiple trips are saved, the predicted one is HIGHLIGHTED AT THE TOP of
  any trip list/switcher, and the board announces which trip it chose and
  why-lite ("nearest: Rhodes"). Permission asked contextually (when the user
  has ≥2 trips), never on first load; degrade silently to time+history.

## Constraints carried forward

- All existing binding rules (STYLES.md) hold on the board unless a comp
  explicitly proposes an amendment as an owner call.
- Focus strip (B2) and journey detail (A1) exist; v2 composition must keep
  them coherent (the strip rides the board; detail is one tap from a row).
- Zero-tap answer, honest states, speed budget — unchanged product law.

## Out of scope

- Server-side user state (still forbidden), native app, other modes.

## Round 2 verdict — Opus rework of C1–C4 (owner, 2026-09-01)

Comps: `/tmp/trains_comps4/` (verdict sheet `verdict.html`), to be committed
beside this doc. **No direction ships as-is; the owner ruled a synthesis.**
His words (near-verbatim, binding):

- **Row grammar:** "I basically want to be able to tell three pieces of
  information by looking only at one general area of a row: 'x min' or time
  until, 'platform', 'line colour'. 'Station' as a secondary piece of
  information that needs to be close by."
- **Ordering (corrected in the same session):** ranked by when you'd
  DEPART — "I misspoke… the time for when you arrive is important, but not
  the primary piece of information. Earliest departure is a pretty good
  proxy." Only on tap should the row show the actual transit stops within
  the trip (the journey detail view).
- **Row scanning groups:** "departure station & departure time" and
  "arrival station & arrival time" should each read as a visual grouping
  when a human scans the row — "doesn't have to be too literally as a
  group", it's about perceived grouping, not boxes.
- **Colour device:** likes how C1/C2 show different colours based on the
  transits involved, "and if they could be to scale (e.g. 20% one line, 50%
  one line, 30% another line or whatever the transits are) that would be
  great." (C1's reworked rail already draws legs/dwell to scale — keep.)
- **Number discipline:** "justify every number that is shown (too many
  numbers can make things hard to visually scan)."
- **Smart header (new):** the location/time smarts live in "a dedicated
  section up the top" of the HOME screen where saved trips are — C4's top
  section is the liked reference. The smart header shows only on home,
  never on route search.
- **Home-station reversal (new scope):** heuristically figure out the user's
  "home" station; for the whole day, every open shows the next train from
  the closest station to "home" in the smart header. Business rules iterate
  "in a way that makes it feel like the app is reading the user's mind";
  detect a possible home change and surface it ("to Y station instead" —
  experience and copy to be iterated). Detect whether the current trip is
  over before making the smart reversal suggestion. "Users only need to find
  their way from A to B, and we smartly suggest the route back from B to A
  every time they open the app."
- **Footer:** nothing about "earlier" or "now" — scrolling up/down into the
  past "is natural mobile phone language", no affordance needed (supersedes
  this doc's "the 'now' anchor must be unmissable" only as regards a labelled
  scroll affordance; the board still lands at now and never opens scrolled).
  Probably no REVERSE button either ("I would never use it") — reversal is
  the smart header's job.
- **Colour rules:** amend both binding STYLES.md rules — recorded there
  ("Board v2 amendment").
- **Trip management defects (build scope):** the add-trip search must show
  the past 3 searches for the "from" and "to" fields (retyping is a bad
  experience); the station typeahead needs proper fuzzy ranking ("Rhode"
  currently matches nothing while "Rhodes" does); the "save trip" button is
  too small at the bottom and needs a rethink.

- **Open state (owner ruling):** the app OPENS on HOME — smart header +
  saved trips. The smart header IS the zero-tap answer (next train, closest
  station → home station); tapping it or a trip opens that trip's board.
  This supersedes "the departure board is the screen" as the open state;
  the board remains one tap away and unchanged in purpose.

Next step ruled by process: a synthesis comp round (Opus 5) — the board per
the row grammar above plus the HOME screen with the smart header — before
any build brief.

## Round 3 verdict — synthesis comps (owner, 2026-09-01)

Comps: `/tmp/trains_comps5/` (sheet `verdict.html`), committed beside this
doc after the round-4 home rework.

**BOARD: Synth A ships** — uniform rows, no lead answer
(`/tmp/trains_comps5/board/synth-a.html`, hero
`shots/synth-a-390x844-hero.png`). It becomes the board's calibration
exemplar once re-shot with the amendment below. Confirmed as ruled: line
codes stay DELETED from board rows (colour + headsign carry identity; the
codes return in journey detail), the row's four justified numbers stand, and
the colour device stays filled, once per service, split to scale.

**Amendment — the transfer platform joins the colour bar** (owner, verbatim):
"On the line that shows the different line colours, the first line colour
label should stay as e.g. 'Platform 1', but then the next transfer (if there
is one), it should have a coloured number representing the transfer platform
e.g. if it was red to blue, it would have 'platform X' in red, and then '2'
in blue at the head of the blue line." So the boarding platform keeps its
named cap in leg 1's colour, and every subsequent leg opens with its own
platform NUMERAL in that leg's colour at the head of that leg's run. The
change platform stops being detail behind a tap and becomes part of the bar.

**HOME: none of H1/H2/H3 ships** (owner, verbatim): "I need the visual
language of the 'smart home' header to be similar to the rows in the board,
just slightly modified to look more prominent, and the from and to stations
displayed above their respective from and to times. Right now, the Home
screen comps are too noisy and look too different to the rows in synth A."
Home is therefore re-comped FROM Synth A's row: the smart header IS that row,
promoted — the from-station sitting above the departure time, the to-station
above the arrival time. What H1–H3 earned and what carries forward: the
smart-header copy system (all states), the state list, and device-only trip
facts.

**Trip rows carry device-only facts** (owner ruling): distance + last-ridden,
never a live next-departure per row — no upstream fetch per saved trip on
open.

## Round 4 verdict — transfer device, past rows, home (owner, 2026-09-01)

Comps: `/tmp/trains_comps6/`. Board = `synth-a`, home = `home-a` / `home-b`.

**The transfer is drawn as two joined platform boxes, and the wait disappears
from the bar** (owner, verbatim): "for a transfer, the tail of the red line
should have a red box… there shouldn't be an empty line segment for the
transfer time. What this means is that the red tail number and blue head
number should be joined together to indicate the platform transfers. Our trip
planning algorithm should simply be smart enough to allow enough time for the
transfer so that the user never needs to really see it at the top level. Only
if they click on the trip… will they see the transfer / wait time." So the
bar is `PLATFORM 1` cap · leg-1 run · **alight-platform numeral in leg 1's
colour, joined to boarding-platform numeral in leg 2's colour** · leg-2 run.
The grey dwell segment is deleted; the bar's scale is ride minutes only. The
change wait lives in journey detail. **Same device on the home smart header.**

**No "on time" verb anywhere** (owner): "We don't need an on time verb, only
show verbs for exceptions e.g. `<x> min late`." `ON TIME` is deleted from the
provenance slot on board and home; `SCHEDULED`, `CANCELLED`, `n MIN LATE`,
`DEPARTING` and the timetable-only register survive because each marks an
exception. This settles the round-2/3 open question by refusing it.

**Past rows are future rows, dimmed** (owner): "past trip rows that sit above
the 'current time' white line when you scroll up don't have the same visual
representation as future trip rows. They should look the same, but just be
greyed out with the verb 'ago' underneath the time. e.g. `18 min ago`." The
log-line past register is therefore retired. The two-register honesty rule
still binds: a row whose realtime record aged out may state elapsed time but
must never assert punctuality, and must stay distinguishable from a row with
actuals.

**Home — three defects to fix before a prominence call** (owner):
1. "The biggest issue is the inconsistently large left margin / padding on the
   smart header, which makes it look very squished and out of line" — the
   header must sit on the page's own left margin like everything else.
2. "The division between the smart header and the saved trips section is not
   clear. The visual and spacing cues do not highlight the header from the
   saved trips." `home-b` at 412×732 is closest, and only because the spacing
   difference is maximal — a better, simpler mechanism is wanted.
3. "The coloured horizontal lines on each of the saved trips… fight with the
   visual language of the rest of the screens, and also make it really hard to
   distinguish exactly where a row starts and a row ends." Replace them:
   round-3's **vertical line at the left of each row** was best, and for a
   multi-leg trip the owner proposes either **stacked vertical lines**
   ("(red vertical line)(blue vertical line) … rest of the row") or a
   **coloured `T<number>` badge** per end ("(Red T9) Rhodes → (Blue T4) Bondi
   Junction"). Comp both; he leans to the stacked lines.

Prominence: **split the difference** between `home-a` (190px header) and
`home-b` (264px).

Home is **exempt from the three-lines-per-row invariant** (owner ruling), as
the journey detail view already is.

## Round 5 verdict — T2 ships, geometry corrections (owner, 2026-09-01)

Comps: `/tmp/trains_comps7/`.

**Transfer: T2, strictly to scale.** The dwell gap stays and is bracketed by
the alight numeral and the boarding numeral. No minimum gap width for now —
owner: "I want to play around with it first before thinking about adding a
minimum gap width later on down the line." The binding requirement instead is
geometric accuracy: "take great care for the head and tail to be correctly
positioned so that the transfer line gap shows accurately scaled to the user."
The tight-change treatment stays in the UI.

**Server-side transfer floor (build scope, new):** when journeys are planned,
apply "some kind of sane minimum that can be tweaked so that we don't show
unreasonably tight trips to the user." A tuneable minimum connection time, not
a UI device — the UI's tight-change treatment then only ever fires for
connections that were reasonable when planned and degraded since.

**Board geometry corrections:**
- The minutes figure column gives back **5–10% of its width**.
- The left margin/padding is **uneven against the right** and must match.
- **Past and future rows are identical in height**, landing between today's
  98px past and 128px future — "maybe like 120 px or something."

**Saved-trip rows: stacked vertical lines AND coloured `T` badges** — owner:
"why not both?" This re-admits line codes on home only; they stay deleted on
board rows. And: "the saved trip rows have way too much top and bottom
padding. They don't look like clickable rows" — tighten until they read as
tappable.

## Directions mode — the focused trip in the header (owner, 2026-09-01)

New direction, and it reframes the product (owner, verbatim): "the focus
should really be like google maps directions. based on the trip and the
current time, it'll tell you where to go next. The idea is that a person just
needs to follow what it tells you and you'll get to where you need to get to.
When a trip is focused, we'd need to show it in the smart header… So a user
just needs to open the app, and straight away it'll tell you what you need to
do next, and where you are in the trip. Maybe some nice progress icon on the
line."

**Focusing a trip is consent, and that settles the honesty question** (owner
ruling): "if a user has focused a trip, they probably want to track it, even
if they aren't on it. If they want to track something else, that is implicit
in their action to track something else… that intentional action itself is
enough to make assumptions about the user's actual trip." So there is **no
"I'm not on this" control** — switching to another trip IS the correction, and
it must therefore be cheap and obvious from the header. This is consistent
with the round's other deletions (REVERSE, EARLIER/NOW): a control that exists
to correct a rare inference is chrome.

Two refinements that survive that ruling and cost no UI:

- Sentences about the TRAIN are safe in every case ("the 09:24 arrives 10:08",
  "off at Town Hall · 09:51"); sentences about the PERSON are inferred. Where
  the difference is free, prefer the instruction to the assertion.
  `web/js/focus.js` already flips `arrives` / `you arrive` / `you arrived` at
  departure — the same discipline, already in the codebase.
- A trip the USER focused carries stronger warrant than one the SMART HEADER
  picked for them, and the header picks by default. The auto-picked case must
  be trivially swappable — but it needs **no new confidence device**, because
  the receipt slot already is one (owner: "I think we have some of that
  language for auto picked already"). The rule the existing copy implies, and
  which the directions states should follow: **the receipt appears in
  proportion to the size of the leap the app made.** Standing at Rhodes and
  being shown the Rhodes trip explains itself and gets nothing; being shown
  the reverse of a trip that was never saved earns "You rode out at 09:24.
  Here's the way back."; picking with no location fix earns "You ride this
  most weekday mornings." A trip the user focused by hand needs no receipt at
  all — they already know why it is there.

**Promote, don't rebuild.** `web/js/focus.js` already computes departed /
riding / arrived, the next change with its platform and minutes, the
tight-change flag (`TIGHT_CHANGE_MIN`), cancellation, and orders its third
line as *what is wrong → what you must do → where you are going*. That is
turn-by-turn logic; it currently renders as the B2 footer strip.

The progress marker travels the row's coloured bar, which is also why the
dwell gap is being reconsidered (Round 4): with a marker on it, the gap stops
being empty space and becomes the place the marker travels toward, waits in,
and leaves.

**Open, to be settled by the comp round:** whether the B2 focus strip survives
once the header carries the active trip — home header, focus strip and journey
detail would otherwise be three renderings of one object. Also whether the
progress marker is driven by timetable + live estimates only (keeping the
one-shot location posture already ruled for the nearest-station smarts) rather
than by continuous tracking.

## Round 6 verdict — design CLOSED (owner, 2026-09-02)

Comps committed at `docs/backlog/board-v2/comps/`; exemplars named in
`docs/STYLES.md` ("Board v2 verdict"). Four final calls:

- **The progress marker stays continuous.** The owner accepts that the
  position is inferred from the clock rather than observed. The known gap it
  leaves — right trip, wrong service (you miss the 09:24 and catch the 09:39,
  and the header tells you to alight eleven minutes early) — is accepted, not
  solved; switching trips does not correct it. Revisit only if it bites in
  real use.
- **The B2 focus strip is deleted.** Recorded in STYLES.md.
- **The empty page under three saved trips stays empty** (~230px above the
  thumb bar). The page ends when your trips end and "that's everything on this
  phone" says so; nothing is invented to fill it.
- **The boarding platform cap disappears once boarded**, and `TO CHANGE` /
  `TO GO` join the provenance vocabulary.

Corrections landed this round, with measurements: the journey bar was 24.3px
out of true (the end of leg 1 drawn at 43.3% where the real ratio is 61.4%,
the gap 30% narrow) because the platform numerals displaced the runs instead
of overlaying them — now a percentage time axis with **0.0px deviation** at
every width. The figure column gave back 8%; the page's *ink* is now even
(22|22) where only its containers had been; trip rows went 132px → 68px.

## Design LOCKED (owner, 2026-09-02)

"comps 8 looks fantastic… This is the one to lock in." Three final rulings and
one defect, all for implementation:

1. **The reversal state shows no platform transfer numbers.** This is a
   FIXTURE artifact, not a design decision: the repo has no B→A journey, so
   the comp's reversal is a named synthetic shift with no change platforms
   (delta D3). The build fetches a real return journey, which carries its own
   change platforms, and **must render them like any other transfer**. Treat a
   reversal with no transfer numbers as a bug.
2. **No `EDIT` control on home** — the only affordance is `+ New trip`.
   Deleting a saved trip is swipe-to-delete once there is a native app; on the
   web the list is instead capped at an **LRU of 10 saved trips**.
3. **Focusing a trip returns you to HOME**, and the smart header becomes that
   trip's status. The board is a browser you come back from; no strip is shown
   on it, ever.

## Carried into the build brief (from the comps rounds)

Contract work, to land in the same change as the interface it describes:

- `client-storage.md` gains a `searches` array — the past three searches per
  field (from / to), for the add-trip typeahead.
- `client-storage.md` gains the home-station heuristic: what constitutes
  "home", the history it needs to back a claim like "your last three evenings
  ended at Central", how a trip is judged OVER before the reversal is offered,
  and how a suspected home change is surfaced. Business rules iterate; the
  contract records what is stored on the device.
- Station typeahead needs fuzzy ranking (today "Rhode" matches nothing while
  "Rhodes" matches).
- The geolocation prediction term and the station-coordinate backfill for
  existing saved trips (coords now available from the stops API).

Invariants the build must carry, each earned by a defect found in comps:

- **The past register is decided by the DATA, never by row age or position.**
  A punctuality chip and an elapsed figure are printed ONLY on an actuals row.
  A timetable-only row that also carries a delay delta must print neither —
  this exact bug shipped in a comp and needs a unit test, not a code review.
- Where a service appears both in a past page and on the live board, the live
  board's copy wins (past pages cache for 1h).
- No countdown on any past row, ever; the board lands at now and never opens
  scrolled into the past.
- Every figure track is sized to the widest legal lockup in the vocabulary
  (`Now`, `12H`, `78min`), never to the hero value — right-aligned overflow
  start-aligns and silently invades the column to its left.
- `web/sw.js` `VERSION` bump (v5 → v6) is required by the shell change.
- Tap targets ≥44px (complaint 4), verified by instrument, not by eye.
