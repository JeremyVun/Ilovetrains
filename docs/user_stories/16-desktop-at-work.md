# On the work laptop with a mouse

**Persona.** Priya at her desk, 17:10, laptop browser, scroll-wheel mouse.

**Situation.** Deciding when to leave. Wants to browse the board freely: up
into the past to see what has been running late, down the future.

**Goal.** Fuzzy: "scan the evening's trains."

## What happens

1. She opens the site. Home renders in a 940px measure.
2. She clicks the trip row. The board lands at `NOW`.
3. She flicks the wheel up. The board scrolls a bit, then stops responding;
   a moment later it jumps.
4. A scrollbar sits on the right edge of the timeline.
5. Past rows read `TIMETABLE ONL` under an empty figure.

## Success looks like

- Wheel scrolling feels like any other page: smooth, no jumps, no dead
  spells.
- No scrollbar drawn over a design that is otherwise all hairlines, or a
  scrollbar that looks intended.
- Every past row's provenance word fits and means something.

## Pressure points

- The whole board is rebuilt with `innerHTML` every second by the tick
  timer. Each rebuild discards the element the wheel is scrolling, cancels
  the browser's smooth scroll and restores a stored `scrollTop`. Fast
  wheeling lands between rebuilds and is thrown away.
- The same rebuild makes text unselectable and drops keyboard focus every
  second, which matters most on a desktop.
- The timeline is an ordinary `overflow-y: auto` box, so a mouse user's
  browser draws its classic scrollbar. Nothing in the stylesheet addresses
  it.
- `TIMETABLE ONLY` overflows the 72px figure column by 24px and reads as a
  typo. Worse, it is a word about *data provenance* on a row whose figure
  slot is empty; the reader has nothing to attach it to.
