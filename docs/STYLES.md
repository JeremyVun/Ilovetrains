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
heavy rule under the masthead, hairlines between rows, colour used once per
screen as accent. System font stack only — no webfont may sit between cold
open and the answer. Tabular figures for all numerals.

Palette (dark, the primary scheme): `#0A0B0D` ground, `#F4F5F7` ink (17.6:1),
ink-2 at 66% (~8:1), ink-3 at 46% (labels only), `#FF7A5C` coral for
delay/cancellation (7.4:1). TfNSW line colours as badge accents: T1 `#F99D1C`,
T2 `#0098CD`, T4 `#005AA3`, T5 `#C4258F`, T8 `#00954C`, T9 `#D11F2F`, M1
`#168388` **[verify M1 + intercity against an official TfNSW source before
relying]**, Blue Mountains `#F99D1C`. The light scheme is below.

Binding rules from the round (each found by breaking it):
- **Three lines per row, in every state.** The slot under the minutes figure
  states that figure's provenance — `MIN`, `DEPARTING`, `SCHEDULED`,
  `6 MIN LATE`, `CANCELLED` — so no state change can reflow a row or push the
  sixth service below the fold. That list is the whole vocabulary; adding to it
  is an owner's call.
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
  never a short list in a void.
- **Stale board tells the truth** (owner ruling 2026-08-31): past ~2 min
  beyond refresh cadence, countdown figures are dropped — absolute clock
  times only, rows already departed removed, board dimmed with
  `OFFLINE · LAST UPDATED X AGO`. A countdown computed from an old cache is
  a lie; a clock time is not.
- Motion: figures count down in place; a departed service dissolves and the
  list closes upward (~240ms); the freshness dot is the only always-live
  element. Rows never reflow.

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
