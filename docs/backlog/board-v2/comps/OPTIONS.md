# BOARD V2 — four board directions

Throwaway comps for `docs/backlog/board-v2/DESIGN.md`. Nothing here is product
code and **the repo was never touched** (a backend agent was working in it
concurrently). The whole workshop lives in `/tmp/trains_comps3/`.

- Contact sheet: `/tmp/trains_comps3/index.html` — open it in a browser.
- Frames: `/tmp/trains_comps3/shots/<concept>-<size>-<scenario>[-light].png`
- Sources: `c1-platformtab.html`, `c2-departureclock.html`, `c3-nowspine.html`,
  `c4-answerledger.html`, shared `base.css` + `data.js`, shot by `shoot.js`.

**Recommendation: C4 · Answer & ledger**, with named transplants from all three
losers. Reasoning at the bottom. Three findings outrank the concepts and are in
their own section — read those first if you read nothing else.

---

## Ground rules this round was held to

**The complaints are the spec, verbatim.** Every direction had to answer all five
in one composition; divergence was forced into HOW, not into which complaint gets
skipped. A direction that solved four and shrugged at the fifth was not shipped.

**Borrowed, not invented.** `base.css` is `web/app.css` verbatim — the live file,
copied, not re-typed — so every palette value, the 10px/600/0.14–0.16em label
idiom, the 2px masthead rule, the hairline, the scheduled/cancelled/stale
treatments and the whole light scheme are the product's own. Each concept adds
its own block on top. Where a concept needed something the house does not own, it
is named as an owner call below rather than smuggled in.

**Real data, no invention.** Every clock time, platform, line code and headsign is
read out of `tools/fixtures/` and converted UTC→AEST. Two deltas are synthetic and
are named in `data.js` where they are applied, because both fixtures were captured
on days with no disruption (`estimated === planned` on every leg) and a delayed
board cannot otherwise be photographed:

- `delayed` / `deep`: the 09:24 runs 6 min late, the 09:54 runs 2 min late.
- `cancelled`: the 09:24 is cancelled.

**The two boards used, and why each.**

| board | source | why |
|---|---|---|
| Rhodes → Bondi Junction | `trip_rhodes_bondijunction.json` | The hero. Six T9→T4 journeys at 15-min headway: 09:24 / 09:39 / 09:54 / 10:09 / 10:24 / 10:39, all Platform 1, all changing at Town Hall (P3→P5). The last two return `isRealtimeControlled: null`, so they are genuinely `SCHEDULED`. Every row is a two-colour journey, which is what lets the colour devices be tested honestly. |
| Central → Parramatta | `trip_central_parramatta.json` | The `long` stress. Six single-leg journeys; the longest real headsign in the repo (*Mount Victoria via Parramatta*), the only two-digit platforms (7 / 8 / 12 / 13), a second line code (BMT), and **it is the board the owner was looking at when he said the big number reads as the platform** — `3` against `PLATFORM 12`. `c4-answerledger-390x844-long.png` is the direct before/after of the original complaint. |

Minute arithmetic is `web/js/time.js`'s: both sides floored to the clock minute,
so the figure always agrees with the clock times printed beside it.

**Frozen.** Zero-tap answer, honest states, no server-side user state. The focus
strip and journey detail exist and each direction had to show the
strip coexisting with its new navigation — see the `focused` frames.

---

## Three findings that outrank the concepts

### 1. The timeline retires "six services above the fold"

That rule was written for a board that does not scroll. Complaint 1 asks for one
that does, and the moment the board is a timeline the rule stops being a rule and
becomes a density budget. Measured at 390×844 and 412×732, whole future services
visible without scrolling:

| direction | 390×844 | 412×732 | row height |
|---|---|---|---|
| C1 · Platform block | 5 (+ a 6th part-visible) | 4 | 111px (lead 132) |
| C2 · Departure clock | 5 | 4 | 126px (lead 146) |
| C3 · Now spine | 6 | 5 | 101px (lead 105) |
| **C4 · Answer & ledger** | **1 answer + 5 ledger = 6** | **1 + 5 = 6** | **46px** |

**C4 is the only direction whose service count does not change between the two
phones.** That is not a tie-break, it is the defect the owner personally hit last
round — "the owner lost the sixth train on a real phone" — and only
one of these four designs is structurally immune to it. Everything else on this
page is a matter of taste; this is a measurement.

### 2. Complaint 3 cannot be satisfied without amending a binding rule

The inherited design rules said *"colour used once per screen as accent"* and *"a filled chip would
be the only filled shape in a system made entirely of hairlines"*. Both were
written deliberately and both are what the owner is now complaining about. Every
direction in this round breaks one of them, and there is no version that does not:

- C1 spends colour twice per row (rail + platform underline).
- C2 spends it once per row but at 3px across the full measure — six coloured
  rules on one screen.
- C3 and C4 introduce **filled** shapes (discs, pills) into a hairline system.

**This is an owner call and it should be made explicitly, not absorbed.** The
recommendation is to amend the rule to *"colour is the line's, it appears once per
service, and it may be filled"* — but that is the owner's sentence to write.

Two measured consequences if a filled chip is chosen:

- **The knocked-out ink flips per line, and again per scheme.** On the dark
  ground, white loses on T1 (1.95:1), T2 (3.02), T3 (2.69), T7 (3.70), T8 (3.56)
  and M1 (4.15), and wins on T4 (6.44), T5 (4.80), T9 (4.88), HUN (7.84) — so the
  chip's ink is a per-line table, which is a deliberate divergence from TfNSW's
  own always-white roundels. On **paper** every darkened light-scheme line value
  was already tuned to clear 4.5:1 against `#FAF9F5` (4.61–8.12), so the correct
  ink there is the ground, for every line, with no table. Carrying the dark table
  into light printed near-black on red at 3.52:1 — caught in
  `c4-answerledger-390x844-hero-light.png`, not by reading the CSS.
- **M1 teal cannot carry small knocked-out text in the dark scheme at all**:
  4.35:1 with the ground, 4.15:1 with the ink, and 4.5 is the bar for text under
  18.66px bold. Either the chip's code is set at ≥14px bold (large-text
  threshold, 3:1, which all lines clear) or M1 gets a chip-only darkened variant.
  Owner call. The comps set it at 10px and are therefore *knowingly* 0.15 short
  on one line out of fourteen; do not copy that number into the build.

### 3. On a single-trip board, line colour is IDENTITY, not differentiation

This is the finding most likely to be missed, because it makes a per-row colour
device look redundant until you understand what it is for. Measured across both
fixtures:

- Rhodes → Bondi Junction: **all six** rows are T9 → T4. Identical colours.
- Central → Parramatta: five T1 and one BMT — **and `--line-T1` and `--line-BMT`
  are the same hex**, `#F99D1C`. Six identical orange marks on one board.

So a colour rail down every row does not tell rows apart; it tells you *this board
is the orange line*, which is exactly the sentence the owner said out loud ("blue,
orange, red lines"). Design it to be read as a property of the board, not as a
diff between rows. Colour genuinely differentiates in only two places, and both
are photographed: a journey with a **change** (T9 red then T4 blue, every row on
the Rhodes board — see the split rails and split pills) and the **trips list**
(T9 / T1 / M1 — `*-390x844-trips.png`, where the three roundels do real work).

---

## The past, in two registers

Binding, from the backend agent mid-round, and it changed every direction:

1. **Recent past (~the last hour).** Realtime actuals survive, so a row may say
   what actually happened — the time it really left, the timetabled time struck if
   they differ, and how late that was. A backed claim.
2. **Older past, and anything never monitored.** Realtime has aged out to
   `estimated:null`. The row may state the timetable and nothing else. *"The
   timetable says it ran"* is not *"it ran on time"*, and the two must not look
   alike.

Rendered as: an actuals row prints its real departure in the live ink with
`ON TIME` / `2 MIN LATE`; a timetable-only row prints the **timetabled** time
(never the estimate) in the `SCHEDULED` idiom — lighter numerals, ink-3, colour
device dimmed — labelled `TIMETABLE ONLY`. An elapsed marker is printed only on an
actuals row; on a timetable-only row it would assert a departure the data cannot
back. No countdown on any past row, ever.

`*-390x844-deep.png` is the frame that proves it: clock 10:42, and one page
carries all three real cases — two rows whose record aged out, one that actually
left two minutes late, one that actually left on time, and two that were **never
monitored** (the fixture returns `isRealtimeControlled: null` on the 10:24 and
10:39, so they are timetable-only for a second, permanent reason).

**This found a live honesty bug in C2's first cut**: the aged-out 09:24 was
printing `TIMETABLE ONLY` *and* `6 MIN LATE` in the same row, in coral. The
punctuality chip was built from the delay field without asking which register the
row was in. It is fixed, and it is exactly the class of error the two-register
rule exists to prevent — worth a unit test in the build, not just a code review.

Also carried forward from the same steer, for the build brief: past pages cache
for 1h, so where a service appears both in a past page and on the live board, the
live board's copy wins.

---

# C1 · Platform block

`c1-platformtab-*.png`

**The idea.** Keep the board's row grammar and answer the confusion by *species*:
the minutes figure wears its unit welded to the numeral — the same rounded-hours lockup
already invented for `3H`, promoted to every row — and the platform is lifted out
of the 10.5px meta line into a labelled block of its own at the right edge, at
28–32px under a `PLATFORM` label. Line colour becomes a 6px rail down the left of
**every** row, split into two segments at the real ride split where the journey
changes trains. Nothing else about the row moves, so every shipped state
treatment — delayed, cancelled, scheduled-only, stale — arrives for free.

**Where the complaints land.** *(2)* Two figures, two species: one wears "min",
the other wears "PLATFORM", and they sit at opposite ends of the row. *(3)* The
rail, plus a 4px line-coloured underline anchoring the platform block. *(4)* A
bottom band under a heavy rule: `⇄ REVERSE` … `TRIPS`, 52px targets, with
`↓ NOW` appearing in the middle slot only when you have scrolled. *(1)* Past rows
collapse to one dense line — the log register — above a now-anchor which **is** the
masthead's heavy rule (the old one is deleted; the anchor replaces it rather than
adding to it). *(5)* Kicker `● NEAREST · RHODES`; the trips sheet prints the
predicted trip above a heavy rule under `● NEAREST YOU · 120 M`.

**Motion.** Figures count down in place. On departure the row does *not* dissolve
and close up: it re-renders into the past register and the now-anchor travels down
past it, and the timeline scrolls by one row to keep now where it was.

**Build cost. S.** It is the shipped row with one column added and one label moved.

**Why this might be wrong.** The platform block costs the body column 64px, and it
shows: *Mount Victoria via Parram…* truncates on the `long` board where the shipped
design fits it whole. It is also the least brave answer in the round — it accepts
the premise that the big number must stay minutes and then decorates around it, so
if the owner's instinct is that the *composition* is the problem, C1 cannot tell
him. And `ON TIME` printed four times down one board is a lot of reassurance for a
screen whose whole argument is subtraction.

**Passes.** *Pass 1 → 2:* the welded `min` collided with the body column and ran
through the T9 badge; figure column and figure size cut, unit reduced to 0.23em.
`MIN` was printing under a figure that already said "min" — the slot was freed to
carry the service's state instead, which is where `ON TIME` came from. The hero
had no now-anchor at all, so nothing taught the scroll-up gesture. *Pass 2 → 3:*
past rows rebuilt for the two registers; the elapsed marker deleted (the anchor
already states the reference clock, so "46 min ago" beside 09:56 was arithmetic
the page had already done); past rail changed from a hairline outline, which
rendered as a blob, to a dimmed bar.

---

# C2 · Departure clock

`c2-departureclock-*.png`

**The idea.** Answer the confusion by deleting the thing that can be confused: the
headline figure becomes the **departure time**, which has a colon in it and can
never be read as a platform — and which is the station-board grammar the user
imported in the first place. Minutes-until survive as the phrase beside it (`in
3 min`), which is the fact the app adds over the station's own board. The
hairline between rows becomes the **line's colour at 3px**, split left-to-right in
ride order, so the rule under a row is the journey drawn as a bar; and the whole
masthead moves to the bottom edge, leaving the top of the screen as nothing but
timeline.

**Where the complaints land.** *(2)* Structurally impossible: a clock time is not
a platform, and `Platform 1` is set at 16.5px sentence case where it reads as a
place rather than a numeral. *(3)* Six full-measure coloured rules per screen —
the loudest colour answer in the round without introducing a filled shape.
*(4)* The trip name is at the bottom **and is the switch-trip target**, with the
reverse glyph beside it and `TRIPS` under it; nothing the thumb needs is above the
midline. *(1)* Past and future are **the same row object** — a clock time does not
expire, so only the register changes. This is the cheapest and most honest past
timeline in the round. *(5)* `● NEAREST` in the bottom band; the predicted trip
takes the top of the trips sheet under its own colour rule.

**Motion.** Almost nothing moves: the phrase beside each time re-renders, the
times never do. When a service departs, its row recedes in place and the now-line
crosses it. The only travelling element on the screen is `NOW`.

**Build cost. M.** One row renderer for both tenses (a genuine simplification), a
new bottom masthead, and the row-rule-as-colour device.

**Why this might be wrong — and it is the strongest objection in the round.** It
contradicts the inherited intent: *"The primary read is one number: minutes
until the next train"*. The comp demotes that number to 27px
beside a 50px clock. It may well be that the owner's complaint is *"I confused the
big number"*, not *"stop making a number big"*, in which case this direction
answers a question he did not ask, at the cost of the thing he liked. Second
objection: with the masthead at the bottom, a glance at the top of the screen tells
you six departure times and **not which trip they belong to** — on a phone with
three saved trips that is a real failure mode.

**Passes.** *Pass 1 → 2:* only 4.5 rows fitted; the clock came down 40→34px (lead
54→50), body sizes and paddings tightened, and it reached 5 whole rows plus a peek.
The bottom band's copy wrapped onto two lines in both slots — `NEAREST · UPDATED
4S AGO` and the instructional `TAP TITLE TO SWITCH`, which was deleted outright
(a label that explains a gesture is a design admitting it failed) and replaced
with an explicit `TRIPS` button. *Pass 2 → 3:* the two past registers, and the
honesty bug above.

---

# C3 · Now spine

`c3-nowspine-*.png`

**The idea.** The board is drawn as one continuous line down the page, painted in
the line's own colour, and NOW is a place on it: above the crossing the rail goes
hollow — nothing is carrying you through there any more — and below it, solid. The
platform moves **onto** the rail as a filled disc with its number knocked out,
which is the roundel grammar the network already uses on its own signage, and the
minutes figure takes the far-right column, so the two numbers sit on opposite
edges of the row in different species. The spine runs off the bottom of the
timeline into the control band, which is where the `NOW` target lives.

**Where the complaints land.** *(2)* The platform is a coloured disc on an axis;
the minutes are a bare numeral in a right-hand column. Nothing about them is
alike. *(3)* The spine is the largest coloured object the product would own, and
it is continuous down the whole page. *(4)* `⇄ REVERSE` / `↓ NOW` / `TRIPS` on
the bottom edge, the spine terminating into them. *(1)* The rail changes species
at the crossing — the strongest now-anchor in the round, because the anchor is not
a label, it is the point where the drawing changes. Past services become plain
stops on a dashed line. *(5)* As C1, plus the trips sheet uses the same roundel,
which is where it finally differentiates (T9 / T1 / M1).

**Motion.** The one direction where **nothing moves except the present**: nodes
never reposition (the axis is nominal), so a departing service is not a reflow —
the crossing simply slides past it. A delayed service does not move down the rail;
its figure goes coral.

**Build cost. M.** Absolute-positioned rail per row with a per-row `--stem`, a
crossing block, a per-line ink table for the discs, and two node species.

**Why this might be wrong.** The spine is the one device in the round that carries
no information the clock times do not already carry — round 2 made exactly this
objection to the earlier decorative route spine and it stands. **It is explicitly NOT proportional**, and
that matters: round 1 measured true-position spacing at ~9px/min on an 844px
screen and found the claim survives only above ~8-minute headways, collapsing at
peak (`d-river-390x844-long.png`). So this is a time axis that is not to scale —
a diagram making a promise it deliberately does not keep, which is a fair thing to
call decorative. And six filled discs plus a full-height rail is the busiest
screen here; on the `long` board it is six identical orange discs on an orange
line, which is the finding above biting hardest.

**Passes.** *Pass 1 → 2:* the comp rendered broken — **`.rail` collided with the
shipped `.rail` in `base.css`** (the footer focus band, `padding: 0 22px`), and with
`box-sizing: border-box` a `width: 4px` rail was forced to 44px. Renamed to
`.spine`. The `PLAT` label was being struck through by its own rail, so it now
knocks the rail out behind it. *Pass 2 → 3:* past discs lost their platform digit
— a 13px numeral inside a 26px hollow ring with a dashed rail behind it was simply
unreadable, and you are not catching that train anyway; they became plain stops and
the platform moved into the body line. Registers added.

---

# C4 · Answer & ledger  *(the brave one — it re-litigates the row grammar)*

`c4-answerledger-*.png`

**The idea.** Six equal three-line rows spend the whole frame restating a question
the user asked once, so this direction splits the board in two: **one answer** at
the top — MINUTES and PLATFORM side by side, the same size, each under its own
label, divided by a hairline — and everything else as a **one-line ledger**
beneath. Complaint 2 is answered by symmetry rather than by species: you cannot
mistake the big number for the platform when the platform is the other big number
and both are named, and nothing else on the board carries a big number at all.
The ledger's density (46px per service against 101–126px) is what pays for
everything else in the round.

**Where the complaints land.** *(2)* `3 min` / `PLATFORM 12` at 84px each on the
`long` board — the direct answer to the frame the complaint came from; compare
`c4-answerledger-390x844-long.png` with `exemplar-board-390x844.png` side by side
and the complaint is simply gone. *(3)* A filled line pill per ledger row, split
red/blue in ride order, plus a 7px full-measure colour band closing the answer.
*(4)* `⇄ REVERSE` / `↓ NOW` / `TRIPS`, 54px targets on the bottom edge; `EDIT`
lives inside the trips sheet where editing belongs, so it is never a back button,
and the way out of every sheet is `← BOARD` — named after where it goes, in the
same place, every time. *(1)* Scrolling up replaces the answer with past ledger
rows and a `NOW` rule; the answer block **is** the now-anchor, which is why it can
be unmissable without a device being invented for it. *(5)* Kicker
`● NEAREST · RHODES`; the trips sheet prints the predicted trip above a heavy rule
with `120 M AWAY · NEXT TRAIN 3 MIN`.

**Motion.** Two elements move: the answer's minutes figure counts down in place,
and at departure the whole answer block cross-fades to the next service while the
ledger's top row is consumed upward into it (~240ms). The ledger itself never
reflows, because every ledger row is the same height in every state.

**Build cost. M.** Two new renderers (answer block, ledger row) replacing one, plus
the pill and the per-line/per-scheme ink table. It is the largest departure from
what is shipped, and the only one that deletes code rather than adding to it.

**Why this might be wrong.** The three-line row is the product's identity — the
whole B·Editorial verdict is *"a printed timetable page"*, and a dense one-line
ledger is a different document: a listing, not a page. Six services now come at
two levels of detail rather than one, which means the second-best train — the one
you actually fall back to when the first is cancelled — is demoted to a 46px line
with no headsign on it, and the board's answer to *"is that the train to Penrith
or to Mount Victoria?"* now costs a tap. That is a real loss and it is not
hypothetical on the `long` board, where two different lines run the same corridor.

**Passes.** *Pass 1 → 2:* two overlapping roundels clipped the first line's code
(`T9` rendered as `T(`) — replaced by one split pill. `PLATFORM 1 · ARRIV…`
truncated, so the answer took a second body line and the ledger dropped the `ARR`
prefix. Figures went 76→84px into the slack. *Pass 2 → 3:* the cancelled lead was
presenting a cancelled service **as the answer** — corrected so the answer takes
the next *running* train and states `09:24 CANCELLED · THIS IS THE NEXT TRAIN` in
coral, with the cancelled service keeping its struck place in the ledger so
nothing is hidden. The light-scheme chip ink was fixed (see finding 2). *Pass 3
→ 4:* the `deep` frame put a struck timetabled time into a 58px column and it
ran through the pill; the time column went to 96px, which then squeezed
`PLAT 1` into `PLA…` on past rows — so the platform was **deleted** from past
ledger rows entirely, which is the right answer anyway (you are not catching that
train, and the register word is the only thing on the line a reader can use).

---

## The permission ask (complaint 5)

Identical in all four, photographed as `*-390x844-ask.png`. It is a band on the
bottom edge under a heavy rule, printed in place — the board stays visible and
readable behind it. No dialog, no scrim, no modal.

> **OPEN ON THE RIGHT TRIP**
> You have three trips saved. If the app can see where you are, it opens on the
> one you are standing near.
> **USE MY LOCATION**   NOT NOW

It says what it wants, what it will do with it, and what you get — in three
clauses, in the product's voice, with a real verb on the button. It appears only
when the user has ≥2 trips (per `DESIGN.md`), never on first load, and `NOT NOW`
is a real answer: the prediction degrades silently to time-and-history.

---

## Additions to house vocabulary these comps need

Each requires a vocabulary change in `docs/contracts/ui.md`.

1. **`TIMETABLE ONLY`** — the provenance for a past row whose realtime record has
   aged out or never existed. Non-negotiable given the two-register finding;
   without it the board asserts punctuality it cannot back.
2. **`ON TIME` / `LEFT ON TIME` / `2 MIN LATE`** — the actuals register. `ON TIME`
   is also proposed for *future* rows by C1, where welding the unit to the numeral
   frees the slot; it states the fact the board currently only implies
   (realtime-controlled and `estimated == planned`).
3. **`DEPARTED`** as a past-tense provenance, if a direction keeps a figure slot on
   past rows.
4. **The welded unit on every figure**, not just on `3H`. The rounded-hours rule introduced the
   lockup for the hours case; C1 and C4 argue it was always the answer to the
   confusion and the hours case just found it first.
5. **A filled colour shape** (finding 2) and **colour more than once per screen**
   (also finding 2).

---

## Recommendation

**Ship C4 · Answer & ledger**, with these transplants:

- **From C2 — the two-register past, verbatim, including the row grammar.** C2's
  insight that a clock time does not expire, so past and future are the same
  object with a different tense, is the cleanest past timeline in the round and it
  transfers to C4's ledger unchanged (it already does — the ledger row is one
  renderer for both tenses). Keep the rule that produced it: **the register is
  decided by the data, not by how old the row looks**, and a punctuality chip is
  only ever printed on an actuals row.
- **From C2 — the trip name as the switch-trip target, in the bottom band.** C4's
  bottom bar has three word-targets and no trip identity in thumb reach; C2 puts
  the trip name itself down there and makes tapping it the switcher. That is one
  fewer control for one more affordance, and it is the most subtractive idea in
  the round.
- **From C1 — the welded unit and the freed provenance slot.** C4's answer block
  already welds `min`; extend it to the ledger's minutes column and let the slot
  under a figure state the service's status rather than repeat the unit.
- **From C1 — the past row as a log line, and the deletion of the elapsed
  marker.** The now-anchor states the reference clock; "46 min ago" beside 09:56 is
  arithmetic the page has already done.
- **From C3 — the now-anchor as a change of species, not a label.** C4's answer
  block is a strong anchor at rest but a thin rule when scrolled. Borrow C3's move:
  make the colour device itself change state across the crossing (solid below,
  hollow or dimmed above) so the boundary is visible before a word is read.
- **From C3 — "nothing moves except the present".** A departing service should not
  dissolve and close the list upward (the shipped motion); on a timeline it should
  recede in place while the now-marker travels past it. This is a better motion
  story *and* a cheaper one, and it is the only way the past can be scrolled to
  without the board rearranging itself under the user's thumb.

**Why C4 over C1**, which is the close call: C1 is the safe, cheap, S-cost answer
and it does genuinely fix the confusion. But it fixes it by *addition* — a new
column, a new label, a new rail, an extra state word on every row — on a screen
whose stated law is subtraction, and it still loses a service between the two
phone sizes. C4 fixes the same complaint by *deletion*: it takes the big number
away from five of the six services entirely, and the one that keeps it gets a
twin. If the owner wants C1's safety, the cheapest path is C1 plus C4's answer
block replacing its first row — but at that point it is C4.

**Why C4 over C2**, which is the interesting call: C2 is the more beautiful frame
and makes the braver argument about the complaint itself. It is also the only
direction that contradicts the product's own written intent, and it does so in
the largest type on the screen. Recommend it to the owner **only** if his reaction
to complaint 2 is "then stop making a number that big" rather than "then make it
obvious what the number is". Its past timeline and its bottom masthead should be
taken either way.

**Why C4 over C3:** C3 is the best-looking hero in the round and the worst board
on the `long` fixture, where its whole device collapses to six identical orange
discs on an orange line. Its spine is decorative by its own admission, it is the
busiest screen, and it costs M for an effect C4 gets from one 7px band.

---

## Open questions for the owner

1. **Finding 2 — the colour rule.** Amend `"colour used once per screen as
   accent"` and `"no filled shapes"`, or keep them and accept that complaint 3
   cannot be fully answered? Nothing else in this round is blocked on anything
   else.
2. **The second-best train.** C4's ledger drops the headsign. On a corridor where
   two lines share a board (T1 / BMT to Parramatta) that is a real loss. Restore
   it at 12px and lose the arrival time, or leave it to the tap?
3. **M1's chip.** Set every chip code at ≥14px bold (large-text threshold), or
   give M1 a darkened chip-only variant? The comps ship 10px and are knowingly
   0.15 of a contrast point short on that one line.
4. **`ON TIME` on future rows.** Genuinely useful, or four lines of reassurance on
   a screen arguing for subtraction? C1 prints it; C4 prints it once, in the
   answer.
5. **The elapsed marker.** Deleted from the past rows here. Confirm it is not
   wanted — it is the one place a "counting" number survives on a past row.
6. **Scroll-up discoverability.** All four print `↑ EARLIER` on the now-anchor. The
   stronger device is a *peek* — leaving the last past row's bottom edge visible
   at rest — but that is arguably "opening scrolled into the past". Owner's call
   which side of that line it falls on.

---

## What the next agent must know

- **Shoot with `node /tmp/trains_comps3/shoot.js [concept] [scenario]`.** It
  asserts viewport width AND height and throws `VIEWPORT LIE` rather than saving a
  wrong frame — believe it and fix the instrument, not the CSS. The
  `chrome --headless --window-size` trap (silent clamp to 500 CSS px on macOS,
  then a crop) is still live; this drives CDP.
- **Scenarios** (`?s=<name>`): `hero`, `past`, `deep`, `delayed`, `cancelled`,
  `long`, `focused`, `trips`, `ask`. All defined in `data.js`.
- **The comps are classic scripts, not modules** — `file://` blocks module loading
  with an opaque origin, so `data.js` defines globals on purpose.
- **`base.css` is `web/app.css` copied verbatim**, which means **every class name
  in the shipped app is live in your comp**. This cost a shoot cycle: `.rail` is
  the legacy focused strip and carries `padding: 0 22px`, so a 4px `.rail` of your own
  is forced to 44px by `border-box`. Prefix or rename. `.row`, `.mins`, `.dep`,
  `.meta`, `.dest`, `.legs`, `.tail`, `.sheet`, `.field`, `.trip`, `.act` are all
  taken too.
- **Three new probes this round, and one of them was itself wrong first.**
  `shoot.js` reports (a) anything past the right edge, (b) anything past the fold,
  (c) any tap target under 44px, and (d) **how many whole services stand inside
  the scroller**. (b) compares against the *viewport*, which means a row clipped by
  an `overflow:auto` ancestor whose bottom still falls inside the viewport is
  invisible to it — every direction here puts services in a scroller, so (d)
  measures against the **scroller's own box** instead, and rows are tagged
  `data-svc` / `data-past` so the probe does not have to guess selectors. The
  first version of (d) silently counted C1's `<span class="n">` figures as
  services and reported 11. If you add a direction, tag its rows.
- **The current sweep is clean**: 52 shots, zero right-edge overflows, zero tap
  targets under 44px, and every board opens at `scrollTop 0` — the board never
  opens scrolled into the past, which is complaint 1's hard requirement and is not
  visible in a PNG.
- **The fixtures' windows are ~1 hour long each**, which is also roughly the
  realtime retention window. That is why the `deep` frame has no future services:
  to get a page where the record has aged out at the top, the clock has to be
  pushed past the end of the fixture. The absence of future rows there is the
  fixture, not a design claim — do not "fix" it by inventing services.
- **`c4-answerledger-390x844-long.png` next to
  `exemplar-board-390x844.png` is the round's decisive frame.** Same trip, same
  clock, same data; `3` against `PLATFORM 12` in the shipped board, and `3 min` /
  `PLATFORM 12` at the same size and both labelled in the comp. If the owner sees
  one pair of images, make it that one.
