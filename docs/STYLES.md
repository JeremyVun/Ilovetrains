# Visual design language

Status: **decided** — comps round run 2026-08-31, owner verdict recorded.

## Verdict (binding)

**Calibration exemplar: "B · Editorial"** —
`docs/backlog/v1-core-loop/comps/shots/b-editorial-390x844.png` and its
stress variants (`-delayed`, `-cancelled`, `-scheduled`, `-long`). Build
against the exemplar image; judge every later screen side-by-side with it.
Full exploration and rejected concepts: `docs/backlog/v1-core-loop/comps/OPTIONS.md`.

The language: a printed timetable page. One column measure, one scale ladder,
letterspaced small-caps labels (10px / 600 / 0.14–0.16em uppercase), a single
heavy rule under the masthead, hairlines between rows, colour per the Board v2
amendment below (originally "once per screen as accent"). System font stack
only — no webfont may sit between cold open and the answer. Tabular figures
for all numerals.

Palette (dark, the primary scheme): `#0A0B0D` ground, `#F4F5F7` ink (17.6:1),
ink-2 at 66% (~8:1), ink-3 at 46% (labels only), `#FF7A5C` coral for
delay/cancellation (7.4:1). TfNSW line colours as badge accents: T1 `#F99D1C`,
T2 `#0098CD`, T4 `#005AA3`, T5 `#C4258F`, T8 `#00954C`, T9 `#D11F2F`, M1
`#168388` **[verify M1 + intercity against an official TfNSW source before
relying]**, Blue Mountains `#F99D1C`. The light scheme is below.

Binding rules from the round (each found by breaking it):
- **Three lines per row, in every state.** The slot under the minutes figure
  states that figure's provenance — `MIN`, `DEPARTING`, `SCHEDULED`,
  `6 MIN LATE`, `CANCELLED`, and (owner ruling 2026-09-01, journey-focus
  round) `TO CHANGE`, `ON BOARD`, `MIN TO GO` — so no state change can reflow
  a row or push the sixth service below the fold. That list is the whole
  vocabulary; adding to it is an owner's call. The three-line invariant binds
  the BOARD; the journey DETAIL view is exempt (same owner ruling) — its rows
  may run longer, its figures still always state their provenance.

## Journey focus & detail verdict (owner, 2026-09-01)

Exemplars: `docs/backlog/journey-focus/comps/shots/a1-ledger-390x844-hero.png`
(detail view — legs in the board's own row grammar, the change bracketed by
heavy rules with the station at headline scale) and
`…/b2-footerrail-390x844-board.png` (focused strip — a bottom band absorbing
the footer, MIN TO GO figure, in thumb reach). Full exploration:
`docs/backlog/journey-focus/comps/OPTIONS.md`. Transplants ruled in:
- A3's tight-connection treatment VERBATIM (coral change figure, both times,
  `PRINTED CHANGE WAS 7 MIN`, no prediction, arrival figure never coloured)
  and its `Platform 3 → Platform 5` pair construction.
- A2's station-printed-once and its `ON BOARD` minutes label.
- B3's departed-lead copy for the strip after departure and its second kicker.
- A focused board pays for the strip by SCROLLING (the short-frame mechanic),
  never by hiding a service.
- **Cancelled lead never silently skips** (transplant from concept C): when
  the first service is cancelled, the row says
  `22:48 CANCELLED · NEXT TRAIN` in the same breath, at the full label idiom
  (owner ruling 2026-09-01 A, below — the copy was `NEXT RUNNING SERVICE`).
- **Unconfirmed figures are not set with the same confidence** (from A):
  scheduled-only numerals render lighter, labelled `SCHEDULED`.
- **Delay is shown as both numbers** — timetabled time struck through beside
  the live one. Optional experiment (from D): a coral margin hairline whose
  length is proportional to the delay.
- **The board fills the frame** (from A): fewer than six services distribute,
  never a short list in a void. **The frame does not get to eat a service,
  though** — refined 2026-09-01 after the owner lost the sixth train on a real
  phone. The rule as built assumed a frame tall enough for six three-line rows,
  and a 412px Android with its browser chrome on screen is not one: 696px of
  board in 567px of frame, with the sixth row cut through the middle of its
  figure and no way to reach it. So: where the board fits, nothing scrolls and
  nothing moves; where it does not, the rows scroll — the way the trips sheet
  scrolls — and the footer keeps its own line beneath them, never painted over
  a service. The frame is measured in dynamic viewport units so that collapsing
  browser chrome cannot fold part of the board somewhere unreachable. The hero
  viewport was quietly losing 17px of the sixth row's hairline to the same
  cause, which no screenshot ever showed.
- **Stale board tells the truth** (owner ruling 2026-08-31): past ~2 min
  beyond refresh cadence, countdown figures are dropped — absolute clock
  times only, rows already departed removed, board dimmed with
  `OFFLINE · LAST UPDATED X AGO`. A countdown computed from an old cache is
  a lie; a clock time is not.
- Motion: figures count down in place; a departed service dissolves and the
  list closes upward (~240ms); the freshness dot is the only always-live
  element. Rows never reflow.

## Board v2 verdict (owner, 2026-09-01/02) — new exemplars

Exemplars, binding for the board, the home screen and the directions header.
Build against these images; judge every later screen side by side with them.
Full exploration, all rejected directions and the round-by-round owner rulings:
`docs/backlog/board-v2/DESIGN.md` and `docs/backlog/board-v2/comps-final/` (round 1 exploration: `…/comps/`).

- **Board:** `docs/backlog/board-v2/comps-final/shots/board-390x844-hero.png`
  (+ `-long`, `-past`, `-deep`, `-delayed`, `-cancelled`, `-landing`, the
  412×732 pair and `-hero-light`).
- **Home:** `docs/backlog/board-v2/comps-final/shots/home-390x844-out.png` is the resting state;
  `…/shots/home-390x844-change.png` is the directions hero.
- **The state ladder:** `home-390x844-{before,leave,board,change,final,
  arrive,done,tight,cxl,back,nofix}.png`.

What the exemplars make binding, beyond the amendment below:

- **The row's three facts in one area** — minutes (unit welded to the
  numeral), platform, line colour — with departure station/time and arrival
  station/time reading as two scanning groups. Rows rank by departure.
- **The journey bar is a time axis**: 0% departure, 100% arrival, every mark a
  percentage of that journey's own minutes. The change is drawn as a real gap,
  bracketed by the alight numeral in leg 1's colour and the boarding numeral
  in leg 2's colour. Measured deviation from the true ratio is **0.0px** and a
  build must hold that; there is no minimum gap width (owner ruling — the true
  scale ships first).
- **Six whole services at 390×844 AND 412×732, in every state.** Row height is
  a fraction of the scroller, never a pixel constant; past and future rows are
  identical in height at any given width (118.7px at 390×844, 100.0px at
  412×732). A frozen pixel row height is what broke this once and it is the
  same defect recorded under "the frame does not get to eat a service".
- **Past rows are future rows, dimmed** — same grammar, figure counting up,
  `AGO`. Dimming is in type colour, never container opacity.
- **No "on time" verb.** The provenance slot prints only exceptions:
  `SCHEDULED`, `CANCELLED`, `n MIN LATE`, `DEPARTING`, `TIMETABLE ONLY`, and
  the directions words `TO CHANGE` / `TO GO` / `AGO` (owner ruling, 2026-09-02).
  The slot keeps its reserved height so nothing reflows.
- **Line codes stay deleted from board rows**; they return on home's saved-trip
  rows as coloured `T` badges, alongside the stacked vertical colour lines
  (owner: "why not both?").
- **The boarding platform cap leaves the bar once you have boarded**, and the
  bar takes the full measure — a `PLATFORM 1` cap beside an instruction reading
  `Platform 5` is the same ambiguity the round exists to kill.
- **The B2 focus strip is deleted** (owner ruling 2026-09-02). Its reason —
  "once you are on the train the only copy of it left is the one in
  localStorage" — stopped being true when the board gained past departures.
  The home header carries the tracked trip instead.
- **The progress marker is continuous** (owner ruling 2026-09-02), driven by
  timetable and live estimates, never by continuous location.

## Board v2 amendment (owner ruling 2026-09-01, comps round 2)

Both colour rules are amended — the owner's playtest complaint ("the colour
coding for different lines is not visible enough") cannot be answered under
them, measured across four comp directions:

- **"Colour used once per screen as accent" → "Colour is the line's; it
  appears once per service, and it may be filled."** On a single-trip board
  the device reads as identity ("this board is the orange line"), not as a
  per-row diff; it genuinely differentiates only at a change of trains and in
  the trips list. A multi-leg journey's colour device is split by leg **in
  ride order and to scale with the real leg durations** (owner: "20% one
  line, 50% one line, 30% another").
- **Filled shapes are permitted for the line-colour device** (pill, rail,
  roundel). Knocked-out ink on a fill is measured, not assumed: code text on
  a fill is set ≥14px/700 (large-text threshold, 3:1 — every line clears it,
  including M1 at 4.35:1, so no per-line darkened variant is needed for
  chips); on paper the fill's ink is the ground for every line. The light
  palette's "darkened per-line variants, not a filled chip" bullet below is
  superseded to that extent — the darkened values remain binding wherever a
  line colour is used as *text*.

## Owner rulings, 2026-09-01

Four calls on the questions `docs/backlog/v1-core-loop/VERIFICATION.md` raised
after the Phase 3 verification wave. All four are shipped; each is guarded by a
unit test in `web/test/` and by the in-browser invariants `shoot-states.js`
checks on every state, in both schemes.

**A. Cancelled-lead copy is `22:48 CANCELLED · NEXT TRAIN`, at the full label
idiom on every width.** The 9px/.05em stopgap is gone: it was the only type on
the board outside the ladder, bought to fit a longer string that still did not
fit a 360px phone. "Train" is the product's own noun where "running service" is
operator vocabulary. Measured at 10px/.14em: 205px of copy, against a body
column of 232px at 390px and 210px at 360px. The 360px column is 210 rather
than 202 because the page margin — not the type — flexes below 375px, from
22px to 18px, in the same proportion as the sheet it is printed on.

**B. Past 99 minutes the figure is rounded hours.** `187` becomes `3H`, to the
nearest hour (209 → `3H`, 210 → `4H`). The board's premise is one number read
at a glance; three digits of minutes is arithmetic, and the clock time beside
it (03:53) already said it better. The provenance slot is unchanged — a service
hours away is virtually always `SCHEDULED`, which is what the real late-night
board shows. The unit is set small on the numeral's baseline (0.40em, weight
300) rather than flat at the figure size: flat, `3H` is 91px in an 86px column,
and it reads as a code rather than as a quantity.

**C. Light mode ships.** Palette and reasoning below.

**D. The `Now` row's provenance is `DEPARTING`.** `Now / MIN` printed a unit
under a figure that is not a number of minutes. `DEPARTING` never displaces a
more specific word: a service leaving now that is six minutes late still says
`6 MIN LATE`, an unmonitored one still says `SCHEDULED`, a cancelled one
`CANCELLED`.

## Light palette (owner ruling 2026-09-01 C)

Derived by measurement, not by inversion: what carries over from dark is the
CONTRAST STRUCTURE, and dark ink on paper does not reach it at the same alphas
that light ink reaches it on black. Every value was computed as a WCAG relative
luminance ratio against its own ground, and `web/test/theme.test.js` recomputes
them from `app.css` on every run — including a ceiling per role, because a
"secondary" read at 15:1 is not secondary and the two schemes would stop reading
as the same page.

| role | dark | light | dark ratio | light ratio |
|---|---|---|---|---|
| ground | `#0A0B0D` | `#FAF9F5` | — | — |
| ink | `#F4F5F7` | `#14120E` | 18.1:1 | **17.8:1** |
| ink-2 | 66% ink | 75% ink (`#4E4C48`) | 8.0:1 | **8.1:1** |
| ink-3 (labels) | 46% ink | 60% ink (`#706E6A`) | 4.4:1 | **4.8:1** |
| rule | 10% ink | 11% ink | 1.24:1 | **1.25:1** |
| rule-2 | 20% ink | 25% ink | 1.73:1 | **1.74:1** |
| coral (delay/cancel) | `#FF7A5C` | `#BF3418` | 7.7:1 | **5.4:1** |
| live dot | `#4ADE80` | `#0F7A4A` | 11.3:1 | **5.1:1** |

- **The ground is warm paper (`#FAF9F5`), not `#FFF`.** The exemplar's claim is
  a printed timetable page, and a page of hairlines and 250-weight numerals
  glares off pure white; a 5-point warm cast is the difference between paper
  and a lightbox, and it costs 0.6 of a contrast point.
- **The coral had to move, the hue did not.** `#FF7A5C` is 2.3:1 on this ground
  — unusable, and it is set at 10px in three places. `#BF3418` is the same hue
  (10° against 11°) at 5.4:1: a printed vermilion rather than a backlit one.
- **Line badges: darkened per-line variants, not a filled chip.** The badge is
  one word of letterspaced small caps inside the meta line. A filled chip would
  be the only filled shape in a system made entirely of hairlines, and it would
  exist in one scheme only — the two printings would no longer read as the same
  page. So the treatment is identical and the ink is darkened: hue and
  saturation held, lightness dropped only until the badge clears 4.5:1 as text.
  What survives is the hue, which is what tells lines apart on a board showing
  two or three of them at once; T1 lands on a dark amber, which is simply what
  a readable orange on paper looks like.

  | line | dark | on paper | light | light ratio |
  |---|---|---|---|---|
  | T1, BMT | `#F99D1C` | 2.0:1 | `#A46204` | 4.6:1 |
  | T2, SCO | `#0098CD` | 3.1:1 | `#0079A3` | 4.7:1 |
  | T3 | `#F37021` | 2.8:1 | `#BD4D0A` | 4.7:1 |
  | T4 | `#005AA3` | 6.7:1 | unchanged | 6.7:1 |
  | T5 | `#C4258F` | 5.0:1 | unchanged | 5.0:1 |
  | T7 | `#6F818E` | 3.8:1 | `#62727E` | 4.7:1 |
  | T8, SHL | `#00954C` | 3.7:1 | `#008041` | 4.8:1 |
  | T9, CCN | `#D11F2F` | 5.1:1 | unchanged | 5.1:1 |
  | M1 | `#168388` | 4.3:1 | `#157B7F` | 4.8:1 |
  | HUN | `#833134` | 8.1:1 | unchanged | 8.1:1 |

  The board paints `var(--line-T1)`, never a hex: `web/js/lines.js` maps the
  API's badge code to the variable and `web/test/theme.test.js` fails if the
  two lists ever drift, which no screenshot of a T1 board would have shown.
- **Two things had to change that are not colours.** `-webkit-font-smoothing:
  antialiased` stops light-on-dark type fattening; applied to dark-on-light it
  thins it, and this page is set in 250 and 300 weight — light mode uses the
  default smoothing so the two boards weigh the same. And the stale board's
  55% dim moved from the row container onto the rows: on the container it also
  dimmed the one-line hint that stands in for them, and 55% of the coral over
  paper is 2.6:1, a washed salmon. Nothing is more load-bearing than the only
  sentence on the screen.
- **Scheme plumbing.** `<meta name="color-scheme" content="dark light">` and a
  `theme-color` per scheme. `manifest.webmanifest` keeps its single dark
  `theme_color`/`background_color`: the manifest has no media-conditional
  fields, dark is the primary scheme, and the runtime meta tags win where a
  browser reads them.

## Intent

- **Glanceable above all.** The primary read is one number: minutes until
  the next train. It should be legible from a phone at arm's length on a
  station platform in sunlight. Platform number is the secondary read.
- **Calm, not busy.** No banners, no cards-within-cards, no chrome. The
  departure board is the screen.
- **Fast is beautiful.** Content renders instantly from cache; live updates
  slide in without layout shift. No spinners on the happy path; a subtle
  freshness indicator instead.
- **Honest states.** Delays, cancellations, stale/offline data are visually
  distinct, never buried. Scheduled-only (no realtime) is distinguishable
  from on-time.
- **Sydney, lightly.** Line identity (T1 orange, M1 teal, …) may be used as
  accent, using official TfNSW line colors; otherwise restrained palette.
- Dark-mode first (commuters at 6am and 6pm); light mode **shipped**
  2026-09-01 — see the light palette above, and `shots/light-*.png` for the
  whole state sweep printed on paper.
