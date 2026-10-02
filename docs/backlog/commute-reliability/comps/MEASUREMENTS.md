# Round 3b · the trip-control line, verdict exemplars · MEASUREMENTS

All values in CSS px from `probe.js` running in the drawn page (`measurements.json`), except glyph centring, which is read from 4× pixels (`glyphcheck.py`, `passes/zoom4b/`). 360 and 412 are Android widths and are set in Roboto (Android Studio layoutlib `Roboto-Regular.ttf`); 375 and 390 are iPhone widths in SF. Light geometry is identical to dark in every frame; only contrast differs. "Today" is HEAD `698d0ba` (A3 strip, `PINNED`) shot from the same worktree with `concept=` empty, same states and clocks.

Saved rows above the bar = whole 72 px trip rows that fit between the first row's top and the bar's top (capacity, not the fixture's count).

Contrast is the action or text ink composited on the page ground, dark / light. The glyphs (■ ▶) are `--ink-2`, decorative and `aria-hidden`: 8.03 / 8.17:1, the same ink as the question.

## The 360 fix (guessed line, Roboto)

- Round 3 measured E in Roboto at 360: the question drawn 155.6 of its 155.8 px and ellipsised (`Going somewhere els…`, `/private/tmp/ilt-tripline-r3/shots/E-rb/dark-home-inferred-360x780.png`).
- Fix: the question carries `margin-right: -1px`, so the gap before STOP TRIP has a 13 px minimum instead of 14. Wider, the auto margin before STOP TRIP absorbs the pixel: frames at 375, 390 and 412 are pixel-identical to round 2's and round 3's E (diffed: `identical`).
- Result at 360 Roboto: question box 155.8 px = natural 155.8 px, one line, no spill; the gap to STOP TRIP is 13.8 px (0.8 px of slack). STOP TRIP and CHANGE do not move (pixel diff against round 3's E-rb frame: only x 159.5-173.5, the question's last letters).
- SF at 360 is not a phone (iPhones start at 375). Measured for the record: the question is cut to 148.2 of 161.7 px (`shots/sf360/`). A build whose web visual regression shoots 360 in SF on macOS will see that ellipsis; it is not an exemplar.

## Lone STOP TRIP alignment

Right. ▶ START TRIP stands at the line's right end, so after the tap ■ STOP TRIP appears in the same place under the same thumb (`passes/p1-align-390.png`: startable, started-right, started-left); every action on the line then lives in E's right-hand column (CHANGE, STOP TRIP, START TRIP); at the left it stacks over MY TRIPS as a second caps heading, the label risk round 3 found.

## Per state and width

### home-guessed

Guessed trip, one change (`home-inferred`, Rhodes → Bondi Junction 09:24, 11 min to change).

| width | face | line h | line reads | targets | question drawn / natural | STOP↔CHANGE ink (box) | question→action ink | contrast dark | contrast light | MY TRIPS top, Today → now | saved rows above bar, Today → now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 360x780 | Roboto | 49 | Going somewhere else? · Stop trip · Change | STOP 74.5×48, CHANGE 58×48 | 155.8 / 155.8, 1 line | 22 (22) | 13.8 | Q 8.03, STOP 8.03, CHANGE 18.05 | Q 8.17, STOP 8.17, CHANGE 17.76 | 262.5 → 262.5 (+0) | 5 → 5 |
| 375x667 | SF | 49 | Going somewhere else? · Stop trip · Change | STOP 78.6×48, CHANGE 62.2×48 | 161.7 / 161.7, 1 line | 22 (22) | 14.5 | Q 8.03, STOP 8.03, CHANGE 18.05 | Q 8.17, STOP 8.17, CHANGE 17.76 | 262.5 → 262.5 (+0) | 4 → 4 |
| 390x844 | SF | 49 | Going somewhere else? · Stop trip · Change | STOP 78.6×48, CHANGE 62.2×48 | 161.7 / 161.7, 1 line | 22 (22) | 21.5 | Q 8.03, STOP 8.03, CHANGE 18.05 | Q 8.17, STOP 8.17, CHANGE 17.76 | 269.3 → 269.3 (+0) | 6 → 6 |
| 412x732 | Roboto | 49 | Going somewhere else? · Stop trip · Change | STOP 74.5×48, CHANGE 58×48 | 155.8 / 155.8, 1 line | 22 (22) | 57.8 | Q 8.03, STOP 8.03, CHANGE 18.05 | Q 8.17, STOP 8.17, CHANGE 17.76 | 269.3 → 269.3 (+0) | 4 → 4 |

### home-guessed-stress

Guessed trip, stress (`nt-stress`, lost connection, two saved trips).

| width | face | line h | line reads | targets | question drawn / natural | STOP↔CHANGE ink (box) | question→action ink | contrast dark | contrast light | MY TRIPS top, Today → now | saved rows above bar, Today → now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 360x780 | Roboto | 49 | Going somewhere else? · Stop trip · Change | STOP 74.5×48, CHANGE 58×48 | 155.8 / 155.8, 1 line | 22 (22) | 13.8 | Q 8.03, STOP 8.03, CHANGE 18.05 | Q 8.17, STOP 8.17, CHANGE 17.76 | 295.5 → 295.5 (+0) | 5 → 5 |
| 375x667 | SF | 49 | Going somewhere else? · Stop trip · Change | STOP 78.6×48, CHANGE 62.2×48 | 161.7 / 161.7, 1 line | 22 (22) | 14.5 | Q 8.03, STOP 8.03, CHANGE 18.05 | Q 8.17, STOP 8.17, CHANGE 17.76 | 295.5 → 295.5 (+0) | 3 → 3 |
| 390x844 | SF | 49 | Going somewhere else? · Stop trip · Change | STOP 78.6×48, CHANGE 62.2×48 | 161.7 / 161.7, 1 line | 22 (22) | 21.5 | Q 8.03, STOP 8.03, CHANGE 18.05 | Q 8.17, STOP 8.17, CHANGE 17.76 | 302.3 → 302.3 (+0) | 5 → 5 |
| 412x732 | Roboto | 49 | Going somewhere else? · Stop trip · Change | STOP 74.5×48, CHANGE 58×48 | 155.8 / 155.8, 1 line | 22 (22) | 57.8 | Q 8.03, STOP 8.03, CHANGE 18.05 | Q 8.17, STOP 8.17, CHANGE 17.76 | 302.3 → 302.3 (+0) | 4 → 4 |

### home-started-before

Started before departure (`tl-started`: the 09:24 at 09:16, after tapping ▶ START TRIP). Today: the same trip seeded as pinned (`tl-pinned-pre`).

| width | face | line h | line reads | targets | question drawn / natural | STOP↔CHANGE ink (box) | question→action ink | contrast dark | contrast light | MY TRIPS top, Today → now | saved rows above bar, Today → now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 360x780 | Roboto | 49 | Stop trip | STOP 94.5×48 | — | — | — | STOP 18.05 | STOP 17.76 | 238.3 → 287.3 (+49) | 5 → 5 |
| 375x667 | SF | 49 | Stop trip | STOP 98.6×48 | — | — | — | STOP 18.05 | STOP 17.76 | 238.3 → 287.3 (+49) | 4 → 3 |
| 390x844 | SF | 49 | Stop trip | STOP 98.6×48 | — | — | — | STOP 18.05 | STOP 17.76 | 244.3 → 293.3 (+49) | 6 → 6 |
| 412x732 | Roboto | 49 | Stop trip | STOP 94.5×48 | — | — | — | STOP 18.05 | STOP 17.76 | 244.3 → 293.3 (+49) | 5 → 4 |

### home-started-after

Started after departure (`nt-pinned`: Central → Parramatta T1 22:48, at 22:58).

| width | face | line h | line reads | targets | question drawn / natural | STOP↔CHANGE ink (box) | question→action ink | contrast dark | contrast light | MY TRIPS top, Today → now | saved rows above bar, Today → now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 360x780 | Roboto | 49 | Stop trip | STOP 94.5×48 | — | — | — | STOP 18.05 | STOP 17.76 | 205.5 → 254.5 (+49) | 6 → 5 |
| 375x667 | SF | 49 | Stop trip | STOP 98.6×48 | — | — | — | STOP 18.05 | STOP 17.76 | 205.5 → 254.5 (+49) | 4 → 4 |
| 390x844 | SF | 49 | Stop trip | STOP 98.6×48 | — | — | — | STOP 18.05 | STOP 17.76 | 212.3 → 261.3 (+49) | 7 → 6 |
| 412x732 | Roboto | 49 | Stop trip | STOP 94.5×48 | — | — | — | STOP 18.05 | STOP 17.76 | 212.3 → 261.3 (+49) | 5 → 5 |

### home-startable

Startable train (`tl-start`: the 09:24 at 09:16, 8 min out).

| width | face | line h | line reads | targets | question drawn / natural | STOP↔CHANGE ink (box) | question→action ink | contrast dark | contrast light | MY TRIPS top, Today → now | saved rows above bar, Today → now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 360x780 | Roboto | 49 | Taking the 09:24? · Start trip | START 102.1×48 | 114.4 / 114.4, 1 line | — | 107.5 | Q 8.03, START 18.05 | Q 8.17, START 17.76 | 238.3 → 287.3 (+49) | 5 → 5 |
| 375x667 | SF | 49 | Taking the 09:24? · Start trip | START 106.9×48 | 121.8 / 121.8, 1 line | — | 110.3 | Q 8.03, START 18.05 | Q 8.17, START 17.76 | 238.3 → 287.3 (+49) | 4 → 3 |
| 390x844 | SF | 49 | Taking the 09:24? · Start trip | START 106.9×48 | 121.8 / 121.8, 1 line | — | 117.3 | Q 8.03, START 18.05 | Q 8.17, START 17.76 | 244.3 → 293.3 (+49) | 6 → 6 |
| 412x732 | Roboto | 49 | Taking the 09:24? · Start trip | START 102.1×48 | 114.4 / 114.4, 1 line | — | 151.5 | Q 8.03, START 18.05 | Q 8.17, START 17.76 | 244.3 → 293.3 (+49) | 5 → 4 |

### home-startable-ferry

Startable ferry (`tl-start-ferry`: Pyrmont Bay 21:11, realtime 21:12, at 21:04).

| width | face | line h | line reads | targets | question drawn / natural | STOP↔CHANGE ink (box) | question→action ink | contrast dark | contrast light | MY TRIPS top, Today → now | saved rows above bar, Today → now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 360x780 | Roboto | 49 | Taking the 21:12? · Start trip | START 102.1×48 | 114.4 / 114.4, 1 line | — | 107.5 | Q 8.03, START 18.05 | Q 8.17, START 17.76 | 257.5 → 306.5 (+49) | 5 → 5 |
| 375x667 | SF | 49 | Taking the 21:12? · Start trip | START 106.9×48 | 121.8 / 121.8, 1 line | — | 110.3 | Q 8.03, START 18.05 | Q 8.17, START 17.76 | 257.5 → 306.5 (+49) | 4 → 3 |
| 390x844 | SF | 49 | Taking the 21:12? · Start trip | START 106.9×48 | 121.8 / 121.8, 1 line | — | 117.3 | Q 8.03, START 18.05 | Q 8.17, START 17.76 | 264.3 → 313.3 (+49) | 6 → 5 |
| 412x732 | Roboto | 49 | Taking the 21:12? · Start trip | START 102.1×48 | 114.4 / 114.4, 1 line | — | 151.5 | Q 8.03, START 18.05 | Q 8.17, START 17.76 | 264.3 → 313.3 (+49) | 4 → 4 |

### home-far

Far (`tl-far`: the 09:24 at 08:59, 25 min out): no line.

| width | face | line h | line reads | targets | question drawn / natural | STOP↔CHANGE ink (box) | question→action ink | contrast dark | contrast light | MY TRIPS top, Today → now | saved rows above bar, Today → now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 360x780 | Roboto | — | no line | — | — | — | — | — | — | 238.3 → 238.3 (+0) | 5 → 5 |
| 375x667 | SF | — | no line | — | — | — | — | — | — | 238.3 → 238.3 (+0) | 4 → 4 |
| 390x844 | SF | — | no line | — | — | — | — | — | — | 244.3 → 244.3 (+0) | 6 → 6 |
| 412x732 | Roboto | — | no line | — | — | — | — | — | — | 244.3 → 244.3 (+0) | 5 → 5 |

## Status band

| state | width | now | Today | above-rule pixel diff vs Today |
| --- | --- | --- | --- | --- |
| home-guessed | 360x780 | Running | Running | identical |
| home-guessed | 375x667 | Running | Running | identical |
| home-guessed | 390x844 | Running | Running | identical |
| home-guessed | 412x732 | Running | Running | identical |
| home-guessed-stress | 360x780 | Late · Connection gone | Late · Connection gone | identical |
| home-guessed-stress | 375x667 | Late · Connection gone | Late · Connection gone | identical |
| home-guessed-stress | 390x844 | Late · Connection gone | Late · Connection gone | identical |
| home-guessed-stress | 412x732 | Late · Connection gone | Late · Connection gone | identical |
| home-started-before | 360x780 | Running | Pinned | status x 18.5-82, y 16.5-27.5 |
| home-started-before | 375x667 | Running | Pinned | status x 18.5-85.5, y 16.5-27.5 |
| home-started-before | 390x844 | Running | Pinned | status x 22.5-89.5, y 16.5-27.5 |
| home-started-before | 412x732 | Running | Pinned | status x 22.5-86, y 16.5-27.5 |
| home-started-after | 360x780 | Running | Running · Pinned | dark: status x 82.5-155.5, y 16.5-27.5 (+1 px AA); light: status x 82.5-155.5, y 16.5-27.5 |
| home-started-after | 375x667 | Running | Running · Pinned | status x 87.5-164, y 16.5-27.5 |
| home-started-after | 390x844 | Running | Running · Pinned | status x 91.5-168, y 16.5-27.5 |
| home-started-after | 412x732 | Running | Running · Pinned | status x 86.5-159.5, y 16.5-27.5 |
| home-startable | 360x780 | Next train | Next train | identical |
| home-startable | 375x667 | Next train | Next train | identical |
| home-startable | 390x844 | Next train | Next train | identical |
| home-startable | 412x732 | Next train | Next train | identical |
| home-startable-ferry | 360x780 | Next ferry | Next ferry | identical |
| home-startable-ferry | 375x667 | Next ferry | Next ferry | identical |
| home-startable-ferry | 390x844 | Next ferry | Next ferry | identical |
| home-startable-ferry | 412x732 | Next ferry | Next ferry | identical |
| home-far | 360x780 | Next train | Next train | identical |
| home-far | 375x667 | Next train | Next train | identical |
| home-far | 390x844 | Next train | Next train | identical |
| home-far | 412x732 | Next train | Next train | identical |

Removing `PINNED` changes only the status words: `PINNED` → `RUNNING` before departure, `RUNNING · PINNED` → `RUNNING` after. At 360 one device pixel of the axis marker's anti-aliasing differs by 9/255 (as in round 3). No line height, rule or header position moves.

## Glyphs, centred on the caps (4×)

```
dark-tl-start-360x780        glyph 7.75x8.5  glyph centre 261.5  caps centre 261.75  offset -0.25  glyph x 242.25  caps x 260.25  target 102.1x48
dark-tl-start-390x844        glyph 7.75x8.5  glyph centre 268.5  caps centre 268.75  offset -0.25  glyph x 263.25  caps x 281.75  target 106.9x48
dark-tl-started-360x780      glyph 8.5x8.5  glyph centre 261.5  caps centre 261.75  offset -0.25  glyph x 249.25  caps x 268.0  target 94.5x48
dark-tl-started-390x844      glyph 8.5x8.5  glyph centre 268.5  caps centre 268.75  offset -0.25  glyph x 270.25  caps x 290.0  target 98.6x48
light-tl-start-360x780       glyph 7.75x9.0  glyph centre 261.5  caps centre 261.75  offset -0.25  glyph x 242.25  caps x 260.25  target 102.1x48
light-tl-start-390x844       glyph 7.75x9.0  glyph centre 268.5  caps centre 268.625  offset -0.12  glyph x 263.25  caps x 281.75  target 106.9x48
light-tl-started-360x780     glyph 8.5x8.5  glyph centre 261.5  caps centre 261.75  offset -0.25  glyph x 249.25  caps x 267.75  target 94.5x48
light-tl-started-390x844     glyph 8.5x8.5  glyph centre 268.5  caps centre 268.625  offset -0.12  glyph x 270.25  caps x 290.0  target 98.6x48
```
Offsets are glyph centre minus cap centre, in CSS px; ±0.25 is one 4× device row. Round 3's flex centring put the glyph on the line box, which in Roboto sits 0.75 px below the caps (`passes/zoom4/`); the comp now centres on the cap height (`top: calc(5.5px - .5cap)` on a baseline-aligned 11 px glyph), which leaves SF pixel-identical and moves Roboto up 1 px. Natively: centre `stop.fill` / `play.fill` and `Icons.Filled.Stop` / `PlayArrow` on the caps, not the text's line box.

## Journey screen action rail

| frame | words | box (x, y, w × h) | contrast | Today |
| --- | --- | --- | --- | --- |
| detail-rail-start-390x844 | Start trip | 22, 780, 346 × 56 | 18.05 | Pin this train, 22, 780, 346 × 56 |
| detail-rail-start-390x844-light | Start trip | 22, 780, 346 × 56 | 17.76 | Pin this train, 22, 780, 346 × 56 |
| detail-rail-start-412x732 | Start trip | 22, 668, 368 × 56 | 18.05 | Pin this train, 22, 668, 368 × 56 |
| detail-rail-start-412x732-light | Start trip | 22, 668, 368 × 56 | 17.76 | Pin this train, 22, 668, 368 × 56 |
| detail-rail-stop-390x844 | Stop trip | 22, 780, 346 × 56 | 18.05 | Unpin this train, 22, 780, 346 × 56 |
| detail-rail-stop-390x844-light | Stop trip | 22, 780, 346 × 56 | 17.76 | Unpin this train, 22, 780, 346 × 56 |
| detail-rail-stop-412x732 | Stop trip | 22, 668, 368 × 56 | 18.05 | Unpin this train, 22, 668, 368 × 56 |
| detail-rail-stop-412x732-light | Stop trip | 22, 668, 368 × 56 | 17.76 | Unpin this train, 22, 668, 368 × 56 |

Same box in every frame; a pixel diff against Today differs only inside the words.

## Shooter reports (expected)

- `[data-strip] button is 8:1 / 8.2:1 against its ground` on the guessed frames: E's STOP TRIP is `--ink-2` (8.03 / 8.17:1, AA), as round 2 drew it; the shooter's invariant expects `--ink` for strip buttons.
- `detail-focused: expected copy is missing: "Unpin this train"`: the rail now reads `Stop trip`.
- No frame spills its own copy, ellipsises, or overflows the right edge (0 px everywhere).
