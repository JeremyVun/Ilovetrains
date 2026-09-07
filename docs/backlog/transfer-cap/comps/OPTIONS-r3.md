# transfer-cap · round 3 — the transfer-limit row

## 1 Where everything is

- Workshop: `/tmp/trains-comps-transfer-cap-r3`, scaffolded
  `--from /tmp/trains-comps-transfer-cap-r2`
- Owner sheet: `index.html` (`sheet.js`, then `node postprocess-sheet.js`)
- 84 frames at 2× and 13 magnifications in `shots/`; probe results in
  `shots/report.json`; numbers in `measure.json` (`node measure.js`)
- Variants: `v1-switch`, `v2-specimen`, `v3-set`, `v4-pins`
- `r2-beside` is round 2's refused row, kept renderable so the before column is
  a real frame from this workshop rather than an image carried in

**Recommendation:** **v1, the switch.**

## 2 The rulings this round is built on

Verbatim, and frozen: *"try again, you can do better"*; *"it should be called
'transfer limit', not changes"*; *"Hide the line, keep the words"* for the
all-services-off state; the board and Home journey lines are untouched.

Held: one row inside Services under the services note, carrying a journey-line
preview; title `Transfer limit`; values `Up to 2` and `Any number`; no note; the
mark shows the other value in caps; the row does not break the screen's left
margin; the preview is drawn by the product's own journey-bar code. `v1` also
carries `No limit` as the one allowed copy deviation, on the `nolimit` scenario,
so the word can be ruled on beside its own shape.

`base.css` is inherited unchanged from round 1 and is byte-identical to today's
`web/app.css` apart from the generator's header, so all three rounds share one
cascade.

**Synthetic deltas.** S1: the `Any number` line is the round-1 three-change
journey — the captured Rhodes → Bondi Junction service cut at Strathfield and at
Central, keeping its real departure and Town Hall arrival. The `Up to 2` line is
`web/test/fixture.js`'s own two-change journey, unaltered; `v3`'s upper rung is
the same. S5: the Settings states are ordinary states of an unbuilt control.

## 3 Findings that outrank the variants

1. **A change has to be marked once, not twice.** The board brackets each
   change with the platform you leave and the platform you board. At preview
   size that pair collides: the two-change line drew three chips and one of
   them was painted over, so the picture could not be counted. Every preview
   here hides the alighting chip, which is the rule the board already applies
   to a two-change row, generalised. With it, `Up to 2` is two chips and
   `Any number` is three, at every width on the sheet.
2. **Round 2's bars carried no count at all.** Its 108px line has zero chips;
   the two values differ only by an extra stripe. That is the most likely
   reason the row read as decoration.
3. **Height is the only price, and it buys legibility.** Row height and the
   scroll it costs at 412×732: v4 56px/9px, v1 68px/21px, v3 78px/31px, v2
   88px/41px. Round 2's row was 56px/9px, today's screen 0px. The narrowest
   drawn leg of the journey goes the other way: v1 6.6px, v4 9px, v2 11.4px,
   v3 17.9px.
4. **The frozen words fit every shape.** `ANY NUMBER` fits the switch cell at
   390 with no overflow and no change in scroll, so the copy question and the
   shape question are independent.
5. **A row that reserves room for a picture leaves a hole without one.** With
   every service off, v2 and v3 close to 56px; v1 keeps 68px because its two
   cells are still the control. No frame overflows, spills or clips, and the
   smallest tap target in all 84 frames is 44px.
6. **v2's preview would have changed width when tapped.** It fills its column,
   and the mark is `ANY NUMBER` in one state and `UP TO 2` in the other, so the
   line grew 33px on the switch. The mark now reserves the wider of the two.

## 4 The variants

### v1 · the switch — recommended

Both values on the row, each with its own journey, the current one in full ink
under the 2px rule every other choice on this screen uses.

- **Build cost: S.** Two radio buttons in the row's right column.
- **Why this might be wrong:** it is the only row on the screen with two tap
  targets, so it reads slightly heavier than Location and Home; and at 96px the
  narrowest drawn leg is 6.6px, the smallest on the sheet.
- **Passes:** the cells began at 96px wide with 76px lines, where the chips
  bunched at the right end and the legs disappeared. Widening to 112px cells
  and 96px lines separated them. `ANY NUMBER` was then checked against the
  cell and fits, so the deviation word is a preference, not a constraint.

### v2 · the specimen

The journey is the row's main object: boarding platform, legs and every change
at 165px, drawn exactly as a board row draws them, with the words above it.

- **Build cost: S/M.**
- **Why this might be wrong:** 88px and 41px of scroll, and a full board device
  inside Settings reads as a result you could tap into. It also states a
  boarding platform, which is a fact with no meaning on this screen.
- **Passes:** the mark was given a fixed width so the line stops resizing when
  the value changes.

### v3 · the set — braver

Not a sample but the rule: the journey the limit keeps and the journey it takes
away, the excluded one struck through the way a cancelled time is struck. Only
the second rung changes between the two values.

- **Build cost: M.** Two previews and a state that is neither a value nor an
  action.
- **Why this might be wrong:** two full-width lines in a Settings row read as a
  chart before they read as journeys, and the row is carrying an argument the
  rider did not ask for.
- **Passes:** it began as three rungs (one, two and three changes) and came
  down to two, which is the boundary and nothing else. The excluded rung was
  dimmed only, which is state by colour; it is now struck as well. The rungs
  ran the full page width and now stop at 260px so they do not read as rules.

### v4 · the pins

The smallest change from round 2: the same row in the same place, with a real
journey line where the bars were.

- **Build cost: S.**
- **Why this might be wrong:** it fixes the picture and not the row. The value
  is still stated on the left and the action named on the right, which is the
  arrangement round 2 was refused for.
- **Passes:** the line went from 108px of bars to 130px with chips.

## 5 Recommendation

**v1, the switch.** It is the only one of the four where tapping the row plainly
does something: both values are present, the current one is marked the way
Appearance and Services mark theirs, and the two pictures are compared side by
side instead of one being remembered. It costs 21px of scroll at 412×732 against
9px for the two rows that only state a value, and 31–41px for the two larger
ones.

Transplant from v3: the struck rung is the clearest thing on the sheet and
should be the app's way of saying "excluded" wherever that has to be shown.
Transplant from v2: nothing structural, but its boarding cap is the detail that
makes a preview read as the product's own row rather than a diagram, and it
would fit v1's cells if the owner wants them louder.

**It flips** if the 21px matters more than the switch: v4 is the same picture on
a 56px row that costs nothing, and it is the honest cheap answer.

## 6 Open questions for the owner

1. **Which row** — the switch (68px, 21px of scroll), the specimen (88px, 41px),
   the set (78px, 31px), or the pins (56px, 9px)?
2. **`Any number` or `No limit`?** Both fit; `No limit` answers the title more
   directly now that the title is `Transfer limit`.
3. **Should the preview state a boarding platform**, as v2 does, or only the
   changes, as the other three do?
4. **Is a struck-out journey the right way to say "excluded"** (v3), and should
   that device exist anywhere else in the app?
5. **Whose journey is drawn?** It is the saved Rhodes → Bondi Junction trip, so
   the colours are T9 red, T1 orange and T4 blue. A rider whose only saved trip
   is a metro line would see colours from a corridor they never travel.
6. **With every service off**, should the taller rows close to 56px (as drawn)
   or hold their height so nothing moves?
7. **Android and iOS** have their own row metrics and text scales; neither was
   photographed this round.

## 7 What the next agent must know

- Shoot: `node tools/comps/shoot.js /tmp/trains-comps-transfer-cap-r3`.
  Sheet: `node tools/comps/sheet.js /tmp/trains-comps-transfer-cap-r3 && node /tmp/trains-comps-transfer-cap-r3/postprocess-sheet.js`.
  Numbers: `node /tmp/trains-comps-transfer-cap-r3/measure.js`.
- **`postprocess-sheet.js` hardcodes its own workshop path.** Change it when
  inheriting, or it will silently rewrite the previous round's sheet — that
  happened once in round 2.
- **Preview metrics are scoped to `.cap-prev`**, not to `.cap-mini`, so round
  2's row still renders exactly as round 2 drew it and the before column stays
  honest. Do not widen that scope.
- **The one preview rule that matters** is `.cap-prev .sy-p.a { display: none }`
  — one chip per change. Without it the two-change preview draws three chips
  and one is painted over by its neighbour.
- The variant is `window.CAP.a`: `switch`, `specimen`, `set`, `pins`, or `r2`
  for round 2's row. `CAP.place === 'in-services'` is what injects the row after
  the services note.
- Scenario names: `off` (flag off), `settings`, `any`, `all-off`, `long-home`,
  `nolimit` (the copy deviation). `all-off` is also the ruling's frame: the
  preview is suppressed by `showsLine()`, not by CSS.
- Regenerate `product.js` with `node bundle-product.js` after any change to the
  web client; its header records every bundled module's blob hash.
