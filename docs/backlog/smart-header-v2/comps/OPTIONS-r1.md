# shv2-r1 — options

Workshop: `/tmp/trains-comps-shv2-r1` · sheet: `index.html` · shots: `shots/`

Recommendation, in one line: **A2** (the question in the header's receipt slot,
CHANGE on the same line) or, if a control may not sit inside the header,
**A3 carrying A2's words**; and **B6** ("Just added" in the sub line's status
slot, the distance kept beside it).

The findings that outrank the concepts are in section 2; read them first.

## 1 Ground rules held to

The spec, from the owner: the strip must ask, in the shortest possible words,
whether the inferred destination is right, and carry one button that opens the
new-trip sheet; the copy may only ever speak of the trip, never of the person
travelling or being aboard. The row mark is "just added" in small italics just
above `DEPARTURES ›`, once only, on the open that saved the trip.

Borrowed, not invented. Every concept is built from parts already on the home
screen: `.hm-offer` with its `.r` hairline, `.k` kicker and `.hm-acts` buttons
(A1); the header's `.hm-rec` receipt slot and the `.hm-acts` button type (A2);
the `.hm-offer p` size and weight beside the `.hm-acts` label idiom (A3, A6);
the row's `.route-cue` idiom (A4); the row sub line's bold status slot (B6);
the freshness pill's dot (B5). The only new CSS in the round is placement and
one italic; no new type size, colour or weight was introduced.

Data. Every clock time, platform, line code, headsign and change on the sheet is
the fixture's own 09:24 Rhodes → Bondi Junction service, through the catalogue's
`hdata.js`. The header, the journey device and the trip rows are rebuilt from
`web/js/home.js`'s and `web/js/journeybar.js`'s own markup in
`home-render.js`; the axis probe reports zero deviation on every shot, so the
device is the product's, not an approximation.

Frozen and kept: header geometry, type ladder, two-clock baseline, journey
device, instruction line, the 20/12/12/8/12 receipt rhythm, the 214px heavy
rule (A3, A4 and A6 keep it exactly; A2, A5 and A1 move it and say so), rows at
72px with 106px reserved for the cue, 44px tap floor, both schemes, no cards, no
chrome.

Synthetic deltas beyond the catalogue's own `D1`–`D8` (all declared in the head
of `home-render.js`, in the sheet's lede and here):

- **The owner's Burwood → Rhodes pair exists in no fixture.** The just-added
  trip is drawn as the real Rhodes → Bondi Junction, so every B frame differs
  from the shipped screen *only* by the mark. The story (the app saved a trip
  from where you are toward where your days start) is unchanged; the names are
  the fixture's.
- **`longdest`** renames the header's destination to `Sydney Olympic Park` — a
  real station, the longest name worth stressing — for the A stress frames only.
  Times, platforms, lines and the change are untouched.
- **`longrow`** renames the marked row to `Sydney Olympic Park → Mount
  Victoria` for the B stress frames only. Both names are real; the pair is not.
- **`manyfive`** is the catalogue's five-trip list (`many`'s `TRIPS_MANY`, delta
  `D5`) on the unfocused 09:09 header, because `many` is a mid-ride state and B
  is judged on an unfocused header.

## 2 Findings that outrank the concepts

1. **The row's name line has 33px of slack, and the mark needs 71.** At 390 the
   name track is 318px and `T9 Rhodes → T4 Bondi Junction` needs 285.6px.
   "Just added" is 62.8px at 12px italic, 74.2px in the 9px label idiom, plus a
   gap. So the owner's requested position — right of the name, above
   `DEPARTURES ›` — truncates the destination to "Bondi …" at 390 **and** at
   412 (54px of slack) and at 360 (10px). That is an ordinary saved trip, not a
   stress case. B1, B2 and B7 are the three answers to it: pay with the name,
   pay more with the name, or give the mark its own line and lose the list's
   baseline.
2. **The sub line has room; the name line does not.** The sub line is 212px of
   track before the 106px reserved for the cue. "Just added · 120 M AWAY" needs
   170px, so B6 truncates nothing at any of the three widths in either scheme.
   The contract already says the sub line's ellipsis is the one allowed to fall
   on metadata.
3. **Only A3, A4 and A6 leave the heavy rule where it is.** Measured rule top on
   390×844: 214.3px today and in A3/A4/A6; 235.9 in A5; 258.3 in A2; 307.3 in
   A1. First saved row: 261.3px today; 282.9 (A5), 305.3 (A2), 309.3 (A4, A6),
   310.3 (A3), 354.3 (A1). With the ten-trip list the storage contract caps at,
   that is seven whole rows above the fold today, six for every direction except
   A1, which leaves five.
4. **A5 fails its stress frame.** At 360 with `Sydney Olympic Park?` the
   destination wraps to two lines (`fitStationNames` has no rule that shortens
   it), the two clocks lose their shared baseline and the departure clock spills
   2px into its neighbour — the shooter's only probe failure in the round.
5. **The longest one-line question still fits.** A2's line prints
   "Is this trip to Sydney Olympic Park? CHANGE" whole at 360px, with no
   ellipsis. A3's and A6's lines do the same.
6. **Contrast.** Every value is a product value: the mark at `--ink-3`
   (4.3:1 dark, 4.83:1 light), the strip's question at `--ink-2` (8:1 / 8.13:1),
   its action at `--ink` (17.6:1 / 17.8:1). Nothing new was mixed.
7. **Five saved trips need no scrolling at 390×844**, with or without a mark, so
   the mark was judged in a full list rather than a scrolled one.

## 3 The concepts

Each is on the sheet with its own note, its stress frames and its honest
objection; only the build costs and the passes log are collected here.

| | idea | cost | build |
|---|---|---|---|
| A1 | the house offer block, kicker asks | +93px, 2 rows | S |
| A2 | the header's receipt slot asks, CHANGE inline | +44px, 1 row | S |
| A3 | one line under the rule, question left, CHANGE right | +49px, 1 row | S |
| A4 | no question, the cue idiom, action only | +48px, 1 row | S |
| A5 | "?" on the destination, CHANGE under the clock | +22px, 1 row | M |
| A6 | the owner's own "Change destination?" as the control | +48px, 1 row | S |
| B0 | control, no mark | — | — |
| B1 | 12px italic, right of the name | destination truncates | S |
| B2 | 9px label idiom, right of the name | truncates, 11px worse | S |
| B3 | mark leads the sub line | distance truncates | S |
| B4 | mark replaces the sub line | loses SHOWN ABOVE and distance | S |
| B5 | a 5px dot, no words | unreadable | S |
| B6 | mark takes the status word's slot | loses SHOWN ABOVE only | S |
| B7 | mark on its own line above the name | row loses the list baseline | S |

Passes log. Pass 1 shot A1–A5 and B1–B5 and found three things: a class
collision (`mk-dot` named both the row and the dot, so the row inherited
`position:absolute` and the probes reported a 181px overflow and a 5px tap
target); the name-track truncation in B1/B2; and that `many` is a mid-ride
state, wrong for B. Pass 2 renamed the row classes, added `manyfive`, added B6
(the status slot) and B7 (its own line) as the two ways to keep the whole name,
added B0 as the control and A6 so the owner's own wording has a frame, and
reworked the magnifications from 4× crops to whole-line 3× clips because the
4× crops cut the action off the end of the line.

## 4 Vocabulary and contract additions needed

Each is an owner call.

1. **A control inside the smart header** (A2 and A5). `ui.md` "Core flow" says
   the header is read-only and not a tap target. A2 puts one 44px button in the
   receipt slot; A5 puts one under the arrival clock. If the answer is no, A2's
   words move to A3's position and nothing else about the round changes.
2. **A second offer grammar below the rule** (A3, A4, A6). `ui.md` names one
   offer block, above the rule. These three add a one-line kind that lives
   below it.
3. **"Just added" borrows the row-status slot** (B6). The slot holds
   `SHOWN ABOVE`, `RUNNING`, `TRIP OVER` — states of the trip. For one open it
   would hold a fact about the row instead.
4. **Copy.** The strings on the sheet are the drafted candidates; the verdict on
   which one ships is the owner's, and it belongs in `design.md`'s "Copy"
   section with the other 2026-09-05 rulings.

## 5 Recommendation

**A2**, with **A3** as the fallback if a control may not sit inside the header.
A2 is the only direction where the question and its action read as one sentence
at the size the product reserves for exactly this — the receipt slot, which the
design already says this strip *is* — and it survives the longest legal
destination at the narrowest frame on one line. It costs 44px and one row of
the list. Take from A3 its position if ruling 1 goes the other way; take from
A6 the shorter action word (`CHANGE`, already in A2); take from A4 the
knowledge that no question at all is legible but says nothing about the guess.
It flips to A3 the moment the owner rules that the header stays untouchable, and
to A6 if he decides the destination never needs naming twice.

**B6**. The name-track measurement rules out the position the owner asked for,
and the sub line is where the product already allows metadata to give way. B6
loses only the words `SHOWN ABOVE`, on the one open where "Just added" is the
more specific thing to say. If keeping `SHOWN ABOVE` matters more than the
distance, B3. If the owner wants the mark in the asked-for position knowing the
cost, B1 (the italic, not the label: it is 11px narrower and reads as a note
rather than as a system label).

## 6 Open questions for the owner

1. May a control sit inside the smart header (A2, A5), or is the header
   untouchable and the strip therefore below the rule (A3, A4, A6)?
2. Which words: "Is this trip to Bondi Junction?", "Bondi Junction for this
   trip?", "Change destination?", or no question at all?
3. Is losing `SHOWN ABOVE` for one open acceptable (B6), or must the mark cost
   the distance (B3) or the destination name (B1)?
4. Should the mark appear on the row when the trip was saved on a *previous*
   open and merely predicted now? The design says once only, on the creating
   open; the comps show only that case.

## 7 What the next agent must know

- Shoot: `node tools/comps/shoot.js /tmp/trains-comps-shv2-r1`, then
  `node tools/comps/sheet.js /tmp/trains-comps-shv2-r1`. Scenario names used:
  `change`, `board`, `done`, `before`, `manyfive`, `longdest`, `longrow`. The
  last three are resolved by `home-render.js`, not by the catalogue.
- **`scenarioName()` in the generated data files matches `[a-z-]+` only.** A
  scenario name containing a digit silently falls back to a prefix that does
  parse — `?s=many5` rendered the catalogue's `many`, with a mid-ride header,
  and the shot looked plausible. That is why the five-trip scenario is called
  `manyfive`.
- **Class collisions with the copied stylesheet cost a pass.** A row class of
  `mk-dot` collided with the mark's own `.mk-dot`, which is absolutely
  positioned; the row inherited it and the probes reported a 181px overflow and
  a 5px tap target. Row-state classes here are `mkr-*`.
- The README says a manifest zoom is addressed by its bare name. It is not:
  `shots/report.json` keys manifest zooms as `zoom-<out>`, so `captions.json`
  must say `"zoom": "zoom-strip-a2"`. Referencing the bare name silently falls
  back to a missing `shots/strip-a2.png`.
- A 4× clip of a 250px-wide region is displayed at 430 or 640px on the sheet, so
  the effective magnification is under 2× anyway. Clipping the whole 362px
  measure at 3× and showing it at `zz` reads better and cannot cut the action
  off the end of the line.
- `home-render.js` is the whole product screen in one classic script: the
  header model (the phase branches of `directionsModel`), the journey device
  (`journeyBarHtml`'s percentages, verified by the axis probe at zero
  deviation), `fitStationNames`' shortening rules and `clampJourneyBars`. A
  concept is three lines on top of it. Inherit this workshop with
  `new-round.js <name> --from /tmp/trains-comps-shv2-r1` rather than rebuilding
  it.
- `measure.js` in the workshop prints the numbers this round's captions claim
  (rule top, first row top, strip height, intrinsic name width against its
  track, mark width, tap floor). Run it from anywhere:
  `node /tmp/trains-comps-shv2-r1/measure.js a2-receipt:change b6-slot:before:360x780`.
