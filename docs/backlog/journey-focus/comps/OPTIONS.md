# Journey detail & focused journey — six design directions

Throwaway comps for the two new surfaces in `docs/backlog/journey-focus/DESIGN.md`.
Nothing here is product code; the whole workshop lives in `/tmp/trains_comps2/`
and the repo was never touched (another agent was editing `web/` concurrently).

- Contact sheet: `/tmp/trains_comps2/index.html` (open in a browser)
- Frames: `/tmp/trains_comps2/shots/<concept>-<size>-<scenario>[-light].png`
- Sources: `a1-ledger.html`, `a2-spine.html`, `a3-changefirst.html`,
  `b1-standfirst.html`, `b2-footerrail.html`, `b3-lead.html`,
  shared `base.css` + `detail.css` + `data.js` + `onboard.js`, shot by `shoot.js`

**Recommendation: A1 · Ledger for the detail view, B2 · Footer rail for the
strip**, with transplants from A2, A3 and B3. Reasoning at the bottom.

---

## Ground rules this round was held to

**Frozen IA.** `docs/backlog/journey-focus/DESIGN.md` was treated as
untouchable: board row → detail; masthead idiom with trip name and a back
affordance; legs in order; transfer(s) between legs showing station and change
minutes; a focus action; a focused state visibly different from unfocused; the
board carries one compact strip that survives the journey leaving the board.
Only composition was explored.

**Borrowed, not invented.** `base.css` is a straight port of the real values in
`web/app.css` — palette (both schemes), the 10px/600/0.14–0.16em label idiom,
the 86px + 1fr row grid, the 29px/300 masthead, the 2px masthead rule, the
hairline, `.dep` / `.meta` / `.dest`, the stale and cancelled treatments. Every
concept is assembled from those parts. Three new parts were needed and each is
named as an owner call below.

**Real data, no invention.** Every value comes from
`tools/fixtures/trip_rhodes_bondijunction.json`. The fixture returns 11
journeys; five route via an "On Demand — Inner West" bus (upstream product
class 10) and are excluded server-side per `api.md`, so what a client actually
sees is six T9 → T4 journeys. Their real ladder at a 09:21 clock is
**3 / 18 / 33 / 48 / 63 / 78**, with the last two `SCHEDULED` because the
fixture genuinely returns `isRealtimeControlled: null` on their first legs.

The hero journey is the fixture's first: **09:24 Rhodes Platform 1 → 09:51 Town
Hall Platform 3, change, 09:58 Town Hall Platform 5 → 10:08 Bondi Junction
Platform 2**, T9 Northern Line (headsign *Gordon via Lindfield*) then T4 Eastern
Suburbs & Illawarra Line (headsign *Bondi Junction*).

Two things had to be synthesised, because the fixture was captured on a day with
no delays (`estimated == planned` on every leg): the `tight` scenario runs the
first leg **5 minutes late**, and the `cancelled` scenario cancels the second
leg. Both are deltas applied to real times, and the cancellation's replacement
is the real next T4 out of Town Hall Platform 5 — **10:12, arriving Bondi
Junction Platform 1 at 10:22** (fixture journey index 2). Nothing else moved.

**Minute arithmetic is `web/js/time.js`'s, exactly.** `minutesUntil()` floors
both sides to the clock minute "so the figure always agrees with the two clock
times printed beside it". This matters here: the hero's change is 6 min 24 s of
wall clock, but the page prints 09:51 and 09:58, so the page must say **7**. All
change windows were computed that way: 7 / 6 / 11 / 6 / 11 / 4 across the six
journeys. Note the last one — **the fixture already contains a 4-minute change**
on the 10:39, with no delay applied at all. Tight connections are the normal
case on this corridor, not the edge case.

---

## Instrument note

`shoot.js` drives CDP directly and uses `Emulation.setDeviceMetricsOverride`
(not clamped), then asserts `document.documentElement.clientWidth` **and**
`clientHeight` equal the requested size and refuses to save otherwise — the
`chrome --headless --window-size` trap from the first round (silent clamp to
500 CSS px on macOS, then a crop) is still live. It also reports two things per
shot: any element overflowing the right edge, and **any element whose bottom
edge falls past the fold**. That second probe was added this round and it is
what produced the round's biggest finding (below); the first round's instrument
would not have seen it.

Light mode is `Emulation.setEmulatedMedia` with `prefers-color-scheme: light`,
so the comps exercise the same `@media` block the product ships — no CSS fork,
and the light shots are directly comparable to `shots/light-on-time-390x844.png`.

---

# Surface A — journey detail

## A1 · Ledger

**The idea.** The journey printed in the board's own row grammar: three blocks
in the same 86px + 1fr ladder — leg, change, leg — so the detail view is
visibly the same page as the board rather than a new screen. The first leg keeps
the board's first-row treatment (78px figure, colour stem) because it is still
the number you came for. The change is made unmissable *structurally* rather
than by out-shouting it: it is bracketed above and below by the masthead's own
2px rule — the loudest gesture the house owns, and still a hairline gesture —
and its station name is set at the h1 step, the only h1 below the masthead.

**Where the frozen IA lands.** Masthead: kicker `JOURNEY`, trip name at 29px,
standfirst `1 change at Town Hall · arrives 10:08`, then `BOARD` (back) and
`FOCUS THIS TRAIN` as words. Legs in order with the transfer between them
carrying station + change minutes + both platforms. A closing 2px rule pinned to
the bottom edge carries `10:08 Bondi Junction PLATFORM 2` — the arrival platform
is stated nowhere else, and the closing rule answers the masthead's.

**Motion.** All three figures count down in place; nothing reflows because every
block's height is state-independent. Focusing swaps `FOCUS THIS TRAIN` to
`UNFOCUS` and the kicker to `ON THIS TRAIN`; no other movement.

**Build cost.** S. It is the board's own components with one new block type.

**Why this might be the wrong choice.** It is the safe answer again, and it
spends ~250px of the frame on bottom margin at 390×844 — defensible as a printed
page (the desktop rule in `app.css` already argues exactly that) but it is the
one place the design is *not* dense. And the change figure at 54px is smaller
than the leg figure at 78px, so the design's stated heart is the second-largest
thing on its own screen.

## A2 · Spine

**The idea.** The journey drawn as a route: a time gutter, a rail, stops. The
rail is painted in the line's own colour, so a two-train journey is legible as
two trains before a word is read, and **the transfer is not a labelled row but a
break in the rail** — the one place on the page where the line stops. Town Hall
is printed once, spanning the break, because it is one station; printing it
twice is what makes every other route diagram hard to read. Hollow rings mark
the two ends of the gap (a donation from the rejected D·River: hollow means "no
train is carrying you through this point").

**Where the frozen IA lands.** Same masthead, with the standfirst carrying
`Leaves in 3 min · arrives 10:08`. Four stops; two ride segments each naming
line, headsign and minutes on board; the break carrying the change figure in the
time gutter — between the two clock times it is the difference of — and the
station and platform pair in the body column.

**Motion.** The change figure counts down in the gutter. When the first leg goes
late, its two gutter times move together and the break's figure shrinks; the
rail lengths do not change (they are not proportional, deliberately — see the
first round's measurement of D·River).

**Build cost.** M. Absolute positioning for the rail and rings, a per-segment
`--stem`, and a break block that is structurally unlike anything shipped.

**Why this might be the wrong choice.** It spends the accent colour twice on one
screen, against `STYLES.md`'s "colour used once per screen as accent" — and the
rails are the largest coloured objects the product would then own. It is also
the only concept whose central metaphor is decorative: the rail carries no
information the times and the break do not already carry, and a route diagram
for a journey with exactly two legs is a diagram of almost nothing. Its cost is
real (M vs S) and its payoff is aesthetic.

## A3 · Change first  *(the brave one)*

**The idea.** Promotes C·Countdown's rejected premise — "the answer *is* the
screen" — into this context, then makes a harder claim: on a journey detail the
answer is not the departure, it is the change, and at the change the thing you
can get wrong is not the station (you are standing in it) but the platform. So
**`Platform 3 → Platform 5` is set at 40px as the page's headline** and the
station name is demoted to a 10px kicker. The change owns the whole middle
between two heavy rules; the second leg loses its countdown entirely.

**Where the frozen IA lands.** Masthead, then the leave block in the board's
verbatim first-row grammar (78px `3` / `MIN`), then the change hero, then a
one-line arrival ledger pinned to the bottom edge with the destination platform
and the T4 badge.

**Motion.** Two figures only: the departure count and the change count. The
change hero is the one element that changes colour, and only when the window
shrinks.

**Build cost.** M — the hero has genuinely distinct states and each needs copy.

**Why this might be the wrong choice — and it is the strongest objection in the
round.** The platform pair is the most volatile datum on the page. Sydney
reassigns platforms at short notice, and heroing a value that can change while
you are reading it, above the station name that gives it any meaning, is a
worse failure than heroing a time. It also has no answer for a single-leg
journey: the screen's whole middle is a fact that does not exist, and the board
returns single-leg journeys on most trips.

**Its best moment,** and the strongest single frame in surface A:
`a3-changefirst-390x844-tight.png`. The coral `2 / TO CHANGE`, `09:56 09:51 in ·
09:58 out`, and `PRINTED CHANGE WAS 7 MIN` beneath it. Two times, two windows,
no prediction.

**Considered and rejected: ticket / itinerary framing.** A perforation rule
between two coupons, the transfer riding the tear. It is a costume, and the
first round already paid for that lesson with A·Solari: heritage that is not
load-bearing costs real information. The perforation would also be the only
non-hairline rule species in a system made entirely of hairlines, and it would
have to exist in both schemes.

---

# Surface B — focused strip, and the journey after departure

All three render the same departed-journey detail (`onboard.js`, A1's grammar)
so the axis under test is the strip, not the detail. In that view the figure
column keeps its job — it is always minutes — and the provenance slot keeps its:
a leg you are riding says **`ON BOARD`**, which is the same kind of word as
`DEPARTING` (owner ruling D), because "4 MIN" under a leg you are already on is
a count of the wrong thing. The row also swaps the boarding platform for the
**arrival** platform: on a train you are already on, Platform 3 is the one that
matters, not Platform 1.

## B1 · Standfirst

**The idea.** The focused journey is a dek. It lives inside the masthead,
between the tools and the heavy rule, in the slot an editorial page keeps for
the standfirst: `FOCUSED · THE 09:24` on the left, `10:08  47 min to go →` on
the right. The quietest of the three — the board is still the screen and the
focus is a line of type about it.

**Where the IA lands.** One line, above the rule, tappable, board rows entirely
untouched. After departure the label becomes `ON THIS TRAIN` and the figures
keep counting.

**Motion.** The minutes count down in place. Nothing else moves.

**Build cost.** S. One flex row inside the existing masthead.

**Why this might be the wrong choice.** It is at the top of the screen, out of
thumb reach, on a surface whose entire premise is one-handed use on a platform.
And it is quiet enough that a user who focused a journey twenty minutes ago may
simply not see it. It also costs the most board (see the finding below): 44px at
the top pushes 43px of the sixth service past the fold in every state.

## B2 · Footer rail

**The idea.** The focused journey is a board row that has moved to the bottom
edge, under a second printing of the masthead's heavy rule. It sits in thumb
reach, it **absorbs** the freshness footer rather than adding to it, and it is
loud: `47` at the board's secondary figure size with `MIN TO GO` beneath, then
`10:08 arrives Bondi Junction`, `THE 09:24 · 1 CHANGE`, `Change 09:58 ·
Platform 5`. Everything above it is the shipped board, untouched.

**Where the IA lands.** Bottom band, three body lines exactly like a board row,
the pulse dot and `UPDATED 4S AGO` inside it. Tappable to detail. It survives
the journey leaving the board unchanged — `boarddeparted` is the same band with
`ON BOARD T9` in the meta line.

**Motion.** `47` counts down to `0`; the band never changes height, because all
three body lines are present in every state (the third line is the state line:
`Change 09:58 · Platform 5`, or coral `2 MIN TO CHANGE · TOWN HALL`, or coral
`09:58 CANCELLED · NEXT TRAIN`).

**Build cost.** S–M. A new bottom region that owns the footer.

**Why this might be the wrong choice.** It is a persistent bottom bar, which is
exactly the chrome `STYLES.md` says this product does not have ("no banners, no
cards-within-cards, no chrome"), and once one exists everything else will want
to live there. It also puts the loudest secondary figure on the screen at the
furthest point from the primary one, so the eye has to travel the full frame to
compare "when does the next train leave" with "when do I arrive".

## B3 · Lead  *(the brave one)*

**The idea.** A focused journey **re-headlines the board**. It takes the lead
slot in the board's own first-row grammar, the masthead kicker becomes `FOCUSED
JOURNEY` / `ON THIS TRAIN`, and the remaining departures are re-kickered `NEXT
DEPARTURES` beneath a second heavy rule. After it leaves it stays in that slot
and its figure quietly changes meaning — minutes-to-departure becomes
minutes-to-arrival — with the provenance slot saying which (`MIN` → `MIN TO
GO`). The board stops being a list of departures and becomes: your train, then
the alternatives.

**Where the IA lands.** Lead block + rule + kicker + the rest of the board. The
focused journey is not also listed below: after departure the API has already
dropped it, and before departure printing it twice would be the same train
answering the same question in two places.

**Motion.** The one concept where a figure changes meaning on screen. At the
moment of departure the lead's figure jumps from `Now` to `47` and its
provenance from `DEPARTING` to `MIN TO GO`; the row below it does not move,
because the lead never left the slot.

**Build cost.** M. Two board renderers (with and without a lead), a second
masthead kicker, and the departed-lead state.

**Why this might be the wrong choice.** A figure that changes what it counts is
the exact thing the provenance rule was invented to prevent, and this concept
does it deliberately, in the largest type on the screen. It also contradicts the
masthead: a board headed "next departures" whose first row is a train that left
twenty minutes ago is a lie the second kicker only half repairs. And it is the
one design that cannot be turned off — an unfocused board and a focused board
are two different screens.

**Its best moment:** `b3-lead-390x844-boarddeparted.png`. `21 / MIN TO GO`,
`10:08 you arrive Bondi Junction`, `ON BOARD T9 · OFF 09:51`, and beneath the
rule, the four services you could still fall back to. That frame answers the
owner's original complaint ("once I'm on a trip, I can't go back and view that
trip again") more completely than anything else in the round.

---

## The finding that outranks the concepts

**A strip anywhere in the frame costs the sixth service, in all three designs.**
Measured, not estimated, by the fold probe:

| concept | 390×844 | 412×732 |
|---|---|---|
| B1 · Standfirst | 6th row clipped by 26px (43px in the delayed/cancelled states) | clipped by 138px |
| B2 · Footer rail | 6th row clipped to zero | clipped by 84px |
| B3 · Lead | 6th row clipped by 16px | clipped by 128px |

The board's binding rule is six services above the fold. The strip is ~44–100px
and the frame has no slack — this is not a composition problem any of the three
can design around, and it needs an **owner ruling**:

- **(a)** A focused board shows five services and distributes them
  (`.rows.sparse` already exists and does exactly this). Cheapest, honest, and
  it means the focus costs you one alternative — which is arguably right, since
  you have already chosen.
- **(b)** The rows region scrolls when focused. Contradicts "the board is the
  screen" and introduces the product's first scroll surface.
- **(c)** The strip is dismissible. Then it is not a persistent focus.

Every shot in `shots/` renders the clipped truth rather than papering over it,
so the cost is visible in the contact sheet.

## Three additions to house vocabulary these comps need

Each is an owner's call per `STYLES.md` ("that list is the whole vocabulary;
adding to it is an owner's call"):

1. **`TO CHANGE`** as a provenance under a change figure. Used by A1, A2, A3.
   Fits the 86px column at the full label idiom on one line (measured).
2. **`ON BOARD`** as a provenance for a leg in progress, and **`MIN TO GO`** for
   a figure counting to arrival rather than departure. Both are state words in
   the same family as `DEPARTING`.
3. **The three-line invariant is relaxed on the third line, in the detail view
   only.** The invariant exists to stop a state change pushing the sixth service
   past the fold; a journey has two legs, not six, so `T4 Eastern Suburbs &
   Illawarra Line to Bondi Junction` is allowed to wrap to two lines rather than
   be truncated. Verified at 390×844 and 412×732 in the `long` shots — the
   longest real string on this corridor never truncates and never pushes the
   arrival band off.

---

## Recommendation

**Ship A1 · Ledger for the detail view and B2 · Footer rail for the strip**,
with these transplants:

- **From A3 — the tight-connection treatment, verbatim.** The coral change
  figure, both times printed with the timetabled one struck, and
  `PRINTED CHANGE WAS 7 MIN` in the label idiom beneath. A1 already carries it
  (`a1-ledger-390x844-tight.png`); keep the copy exactly, and keep the rule that
  produced it: **the design states two times and two windows and makes no claim
  about whether you make it.** The app has no data that could support such a
  claim, and a wrong "you'll miss it" is the worst error this screen can make.
  Corollary, also from A3: the *arrival* figure is never coloured coral — only
  the change is, because only the change is at risk.
- **From A3 — the platform pair as a first-class object.** Not as the headline,
  but the `Platform 3 → Platform 5` construction with the arrow at h1 weight is
  better than any prose rendering of a transfer, and A1 already uses it in the
  change band's meta line.
- **From A2 — "the station is printed once".** A1's change band names Town Hall
  a single time, spanning the two platforms and the two times. This is A2's best
  idea and it survives the loss of the rail.
- **From A2 — `27 MIN ON BOARD` per leg** as a label. A1 currently implies leg
  duration from the two clock times; stating it is one cheap label and it is the
  fact a rider actually wants ("how long am I on this thing").
- **From B3 — the departed lead, as the *fallback* when there is no room for
  both.** If the owner rules (a) above, B2's rail and B3's lead converge: the
  focused journey is one row, the board has five. Keep B2's placement (thumb
  reach, absorbs the footer) and B3's copy (`ON BOARD T9 · OFF 09:51`,
  `you arrive Bondi Junction`).
- **From B3 — the second kicker.** Whatever the strip's position, the board's
  masthead kicker should change from `NEXT DEPARTURES` to `ON THIS TRAIN` when a
  focus is active and departed. It costs nothing and it is the only element that
  tells a returning user, before they read a number, which state the app is in.

**Why A1 over A2**, which is the close call: A2 is the more beautiful frame and
the worse product. Its rail carries no information the gutter and the break do
not already carry, it spends the accent colour twice, and it costs M against
A1's S for an aesthetic payoff. A1 also inherits every state treatment the board
already ships — delayed, cancelled, scheduled-only, stale — for free, because it
*is* the board's row. If the owner wants A2's drama cheaply, the move is to give
A1's change band a hairline in the left margin the way `STYLES.md`'s D-transplant
suggests, not to adopt the rail.

**Why B2 over B1**, which is the other close call: they cost the board the same
sixth service, so the tiebreak is reach and loudness. B1 is out of thumb reach on
a one-handed screen and quiet enough to be missed; B2 is where the thumb already
is, and it absorbs a region (the footer) rather than adding one. B1's placement
is still the right answer if the owner rules that the strip must be visually
subordinate to the board at all times — in which case take B1 and move the
tap target to the whole masthead.

---

## Open questions for the owner

1. **The sixth service.** The ruling above — (a), (b) or (c). Nothing else in
   this round is blocked on anything else.
2. **Does the second leg deserve a countdown?** A1 prints `37 / MIN` on the
   second leg (minutes until the T4 leaves Town Hall). It is honest and it
   becomes genuinely useful once you are on the first train, but at Rhodes at
   09:21 it is a number about something 37 minutes away sitting at the same
   weight as the change. A3 deletes it entirely. Cheap either way.
3. **Journey duration.** Dropped from A1's standfirst deliberately: with a
   5-minute delay on the first leg and an unchanged arrival, the "44 min"
   journey becomes a "39 min" journey, which is arithmetically true and reads
   as though the delay made it faster. `1 change at Town Hall · arrives 10:08`
   is the version that cannot be misread. Worth confirming duration is not
   wanted.
4. **Single-leg journeys.** Every comp here has exactly one change, because the
   owner's corridor does. A1 degrades to one leg block and no change band (and
   should then distribute, not leave a hole); A3 has no design at all in that
   case. Not photographed — no single-leg journey exists in this fixture.
5. **Where the arrival platform lives.** A1 puts it in the closing band
   (`10:08 Bondi Junction PLATFORM 2`), which is the only place it appears.
   Confirm it earns a whole band; the alternative is deleting it, since you are
   getting off there.
6. **The replacement service's platform.** When the second leg is cancelled the
   real 10:12 T4 arrives at Bondi Junction **Platform 1**, not Platform 2 — the
   comps track this correctly, but it means a cancellation can silently change
   the arrival platform, and the detail view is the only surface that could say
   so.

## What the next agent must know

- Shoot with `node /tmp/trains_comps2/shoot.js [concept] [scenario]`. It asserts
  the viewport width AND height; if it throws `VIEWPORT LIE`, believe it and fix
  the instrument, not the CSS. `BELOW FOLD +Npx` in the output is real and is
  the finding above — do not silence it.
- Scenarios live in `data.js` and are appended as `?s=<name>`: `hero`, `tight`,
  `cancelled`, `long` (surface A), and `board`, `boarddeparted`, `onboard`
  (surface B, which also accept `tight` and `cancelled`).
- The comps are plain classic scripts, not ES modules: `file://` blocks module
  loading with an opaque origin, so `data.js` and `onboard.js` define globals on
  purpose.
- `base.css` is a port of `web/app.css` and carries its one non-obvious rule —
  `body > *, #app > * { width: 100%; min-width: 0 }` — without which a single
  nowrap string (the full T4 line name) inflates the flex line's cross size and
  shoves right-aligned content outside the viewport clip. It looks like content
  is missing rather than overflowing.
- `detail.css` is A1's grammar and is shared by `a1-ledger.html` and by
  `onboard.js` (the departed-journey detail all three surface-B comps render).
  If the owner picks A2 or A3 for the detail view, `onboard.js` is the file that
  changes, not the B comps.
- Two non-obvious layout traps found this round: a `display:flex` `.meta` eats
  the space between "PLATFORM" and its number (it becomes `PLATFORM1`), and a
  `1fr` grid row will let a 54px figure overlap its neighbours in a
  content-height container unless the container carries a `min-height` — both
  cost a shoot cycle.
