# Reading the past register

**Persona.** Dev, second week, curious rather than in a hurry.

**Situation.** 22:57 on the board, scrolled up to see what ran earlier
tonight. Two kinds of past rows: one with `17 min AGO` and a struck
scheduled time, and five with an empty figure and `TIMETABLE ONLY`.

**Goal.** Fuzzy: "did trains run on time tonight?"

## What happens

1. Dev reads `22:40` with `22:39` struck and `17 min AGO`: the train left a
   minute late. Clear.
2. Dev reads `22:09 TIMETABLE ONL`: no figure, no strike, the same clock
   time it was always going to be.
3. Dev wonders whether the 22:09 ran at all, ran on time, or whether the app
   simply does not know.

## Success looks like

- Both registers read at a glance: "we saw this one run" versus "we only
  have the timetable for this one".
- Nothing on a past row claims punctuality it cannot back.

## Pressure points

- `TIMETABLE ONLY` is a word about provenance in a slot the reader expects
  to hold a figure. With the figure empty, it reads as an error message.
- It overflows the column by 24px on every such row, at every frame, and
  has done since the design was locked.
- The board's own vocabulary already has `SCHEDULED` for "we only have the
  timetable" on future rows. Two words for one fact, and the past one does
  not fit.
- Upstream drops actuals after roughly an hour. Every row older than that is
  timetable-only by construction, so the register is less "did it run" than
  "how long ago". Is the distinction worth its own word at all?
