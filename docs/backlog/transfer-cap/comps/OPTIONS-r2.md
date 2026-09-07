# transfer-cap · round 2 — the combined row

## 1 Where everything is

- Workshop: `/tmp/trains-comps-transfer-cap-r2`, scaffolded with
  `node tools/comps/new-round.js transfer-cap-r2 --from /tmp/trains-comps-transfer-cap-r1`
- Owner sheet: `index.html` (build with `sheet.js`, then `node postprocess-sheet.js`)
- 84 frames at 2× and 10 magnifications in `shots/`; probe results in
  `shots/report.json`; targeted numbers in `measure.json` (`node measure.js`)
- Variants: `v1-left`, `v2-under`, `v3-beside` (`.html` + `.js`), all rendered
  by the inherited `cap-common.js` / `cap-common.css`
- Kept for the before/after columns: `c2-row` (round 1's winner, no picture)
  and `c4-lines` (the band its picture comes from)

**Recommendation:** **v3 — the line on the value's own line, beside it.**

## 2 The rulings this round is built on

Frozen, from the round-1 verdict:

1. *"Combination of C2 and C4."* The single row inside Services, under the
   services note, carrying c4's journey-line specimen. All three variants are
   that row; they differ only in where the line sits.
2. *"Keep shipped rendering. If you want to make a visual improvement, you must
   do a design comp and present first."* No board or header change is drawn
   here, and no three-change board or Home frame was re-shot. The concepts
   still carry round 1's `b` flags in their files, but every one is `false` in
   the three new variants, and the settings path never calls the code they
   gate.
3. *"No, header keeps drawing every numeral."* Nothing in this round touches
   the header.
4. Copy: title `Changes`, values `Up to 2` and `Any number`, no note, the mark
   showing the other value in caps. Rendered verbatim; nothing else is written
   on the control.

Held from round 1: the row is one 56px button read as title, subtitle, then
action (v2 excepted, at 78px, and its caption says so); the Grouped-buttons
composition is otherwise untouched; every frame's smallest tap target is 44px;
`base.css` is inherited from round 1 and is byte-identical to today's
`web/app.css` apart from the generator's four-line header, so the verdict frames
and these frames share one cascade.

**Synthetic deltas, and there are no others.** S1: the `Any number` specimen is
the round-1 three-change journey — the captured Rhodes → Bondi Junction service
cut at Strathfield and at Central, keeping its real departure and its real Town
Hall arrival. The `Up to 2` specimen is `web/test/fixture.js`'s own
`threeLegJourney()`, unaltered. S5: the Settings states (the other value, the
29-character home, every service off) are ordinary states of an unbuilt control.

## 3 Findings that outrank the variants

1. **The picture is free in two of the three.** Scroll extent at 412×732:
   today 0px; the row with no picture 9px; **v1 9px; v3 9px**; v2 31px; c4's
   band 79px. v1 and v3 add a journey line to the screen for nothing beyond
   what the row already cost.
2. **Width is the whole question, and it is measurable.** The narrowest drawn
   piece of the journey — the 4-minute Town Hall → Central leg — is 4.3px in
   v1 at 62px, 7.4px in v3 at 108px, and 10.2px in v2 at 148px. Below about
   5px the line reads as a coloured mark rather than a journey, which is the
   difference between a picture that explains the choice and a decoration.
3. **Row height is the only thing that costs the page.** v1 and v3 are 56px, v2
   is 78px, and those 22px are exactly the 22px of scroll v2 adds at 412×732.
4. **The left column breaks the screen's left edge.** In v1 the title starts
   74px from the margin while `SERVICES`, its note, `APPEARANCE`, `Send
   feedback` and `Version` all start at 22px. The Personal rows indent for a
   21px glyph; this indents for a 62px bar, and it is the only indent of its
   size on the screen.
5. **Every probe is clean.** 84 frames, no horizontal overflow, no text spill,
   no clipping, smallest tap target 44px, in both schemes at both frames.
6. **One thing to look at, not measure:** in the all-off state a red warning
   line sits directly above the specimen's red T9 leg. Two different reds, one
   above the other, in every variant.

## 4 The variants

### v1 · the line in the icon column

The line takes the place Location and Home give their glyph — the row's emblem,
same width every time.

- **Build cost: S.** One grid column on the existing row.
- **Why this might be wrong:** at 62px the shortest leg is 4.3px, so the two
  states differ by a mark most riders will not decode; and it is the only
  74px indent on a screen whose every other label starts at the margin.
- **Passes:** one. The line was first centred on the row and read as belonging
  to neither the title nor the value; it now sits level with the value it
  illustrates.

### v2 · the line under the value

The line gets a line of its own, and with it the room to be read rather than
recognised.

- **Build cost: S.**
- **Why this might be wrong:** 78px against 56px, and 31px of scroll at
  412×732 where the other two cost 9px. A picture on its own line also reads as
  a third fact rather than as the value's illustration.
- **Passes:** one, to stop the line running the full copy column — at the full
  width it read as a progress bar rather than a journey.

### v3 · the line beside the value — recommended

The line sits on the subtitle's own line, immediately left of the words it
illustrates. Nothing moves: the title stays at the margin with every other
label, and the row stays 56px.

- **Build cost: S.** One flex row inside the copy column.
- **Why this might be wrong:** the value's words shift right by 118px, so the
  subtitle no longer lines up with the subtitles of the Location and Home rows
  above it — though those are in a different group, with the four service
  buttons and the services note between.
- **Passes:** one, and it is the round's iteration. The line began at 64px,
  where its shortest leg was 4.4px and the two states were hard to tell apart.
  The copy column is 231px wide at 390 and the value only needs 78px of it, so
  the line was widened to 108px — the shortest leg went to 7.4px, the row
  stayed 56px and the page stayed at 9px of scroll. The widening cost nothing.

## 5 Recommendation

**v3.** It is the only variant where the picture and the words say the same
thing on the same line, and at 108px it is wide enough that the two states are
told apart without study (7.4px shortest leg, against 4.3px in v1). It keeps
the row at 56px and the whole Settings screen on one page at 412×732, so the
combination costs exactly what round 1's row cost and nothing more.

Transplant from v2: if the owner finds 108px still too small to read, v2's
148px is the next rung, and the price is 22px of row and 22px of scroll — the
sheet's "The three, on Any number" row is the frame that decides it. Transplant
from v1: nothing; its indent is the one thing this round found that the screen
should not take.

**It flips** if the owner decides a coloured journey line does not belong on a
Settings screen at all. In that case the answer is round 1's c2 row unchanged,
which is already drawn on this sheet as the before in every pair.

## 6 Open questions for the owner

1. **Which variant** — v3 at 108px, v2 at 148px and 78px of row, or v1's small
   emblem?
2. **Does the picture belong on Settings at all?** Every frame here answers
   "where", none answers "whether". The before column is c2's row without it.
3. **Should the specimen be a real journey or a made-up one?** It is currently
   the Rhodes → Bondi Junction service the fixtures hold, so the colours are
   T9 red, T1 orange and T4 blue. A rider on another corridor sees lines they
   never travel.
4. **What does the specimen do when every service is off?** It currently keeps
   drawing train colours under a red "no services selected" warning.
5. **Does the line animate when the value changes**, or is the swap immediate
   like every other choice on the screen? Nothing here is animated.
6. **Android and iOS.** The line is 108px of a 56px row on the web; the native
   clients have their own row metrics and their own text scales, and this round
   photographed neither.

## 7 What the next agent must know

- Shoot: `node tools/comps/shoot.js /tmp/trains-comps-transfer-cap-r2`.
  Sheet: `node tools/comps/sheet.js /tmp/trains-comps-transfer-cap-r2 && node /tmp/trains-comps-transfer-cap-r2/postprocess-sheet.js`.
  Numbers: `node /tmp/trains-comps-transfer-cap-r2/measure.js`.
- **`postprocess-sheet.js` is not decoration**, and its file path is hardcoded
  per round. `sheet.js` prints the board catalogue's deltas under "What is
  synthetic"; this round uses none of them, so without the postprocess the
  owner is shown declarations that are not true of these frames.
- The variant is chosen by `window.CAP.a` (`left`, `under`, `beside`) in each
  concept's `.js`; `CAP.place === 'in-services'` is what injects the row after
  the services note. Round 1 keyed that injection on `CAP.a === 'row'`, which
  broke the moment the row had variants — the flag is the placement, not the
  shape.
- The specimen follows the current value through `specimenFor()`, so a new
  scenario gets the right journey automatically: `any` draws the three-change
  line, everything else draws the two-change one.
- `data.js` and `hdata.js` are the scaffold's catalogue tables and are unused;
  the journeys come from `web/test/fixture.js` through `product.js`.
- Regenerate `product.js` with `node bundle-product.js` after any change to the
  web client. Its header records the blob hash of every module it bundled.
