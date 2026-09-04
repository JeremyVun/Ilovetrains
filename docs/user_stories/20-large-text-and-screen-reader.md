# Large text and a screen reader

**Persona.** Rob, low vision, system text size at the largest setting,
sometimes uses VoiceOver.

**Situation.** Morning commute, Strathfield → Town Hall.

**Goal.** Hard: "next train, platform, in a form I can read or hear."

## What happens

1. The app uses px-sized type throughout and ignores the system text size.
   Rob sees the same 45px figure and 10px labels as everyone else.
2. With VoiceOver, the board rows are `role="button"` with no accessible
   name; the row's text is read in DOM order: figure, provenance, times,
   platform pin numerals, headsign.
3. The smart header is a `<section>` with no heading or label.

## Success looks like

- Labels at 9–10px scale with the system, or are never the only carrier of
  a fact.
- A row is announced as one sentence: "In 3 minutes, 09:24 to Bondi
  Junction, Platform 1, change at Town Hall."

## Pressure points

- Nine-pixel uppercase letterspaced labels carry `CANCELLED`, `5 MIN LATE`,
  `TIMETABLE ONLY`. At the largest system size they are still nine pixels.
- The tick rebuilds the DOM every second, which resets screen-reader focus
  and can re-announce the region.
- The trip rows have an `aria-label`; the board rows do not. The most
  information-dense element in the app has the least accessible name.
- The colour-only tight-change signal on the axis has no text on the board
  row by design. Is there a non-visual carrier at all?
