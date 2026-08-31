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

Palette: `#0A0B0D` ground, `#F4F5F7` ink (17.6:1), ink-2 at 66% (~8:1),
ink-3 at 46% (labels only), `#FF7A5C` coral for delay/cancellation (7.4:1).
TfNSW line colours as badge accents: T1 `#F99D1C`, T2 `#0098CD`, T4
`#005AA3`, T5 `#C4258F`, T8 `#00954C`, T9 `#D11F2F`, M1 `#168388`
**[verify M1 + intercity against an official TfNSW source before relying]**,
Blue Mountains `#F99D1C`.

Binding rules from the round (each found by breaking it):
- **Three lines per row, in every state.** The slot under the minutes figure
  states that figure's provenance — `MIN`, `SCHEDULED`, `6 MIN LATE`,
  `CANCELLED` — so no state change can reflow a row or push the sixth
  service below the fold.
- **Cancelled lead never silently skips** (transplant from concept C): when
  the first service is cancelled, the row says
  `22:48 CANCELLED · NEXT RUNNING SERVICE` in the same breath.
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
- Dark-mode first (commuters at 6am and 6pm), light mode supported.
