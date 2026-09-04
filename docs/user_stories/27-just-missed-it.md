# Just missed it

**Persona.** Priya, running down the stairs at Rhodes as the doors close.

**Situation.** 09:24:40. The train is pulling out. She wants to know two
things: was that mine, and when is the next.

**Goal.** Hard: "next one, and how much time do I have."

## What happens

1. She opens the app. It is still 09:24; the header reads `Now`.
2. At 09:25:00 the tick re-renders. The 09:24 falls out of the future set.
   The header switches to the 09:39 with `14 min`.
3. She taps the row for the board. The 09:24 is not in the future and is
   only in the past register if a past page covers it.

## Success looks like

- The departed train visibly *becomes past*: it slides above the `NOW` rule,
  dimmed, with `1 min AGO`.
- The next train takes the header without a blank moment.

## Pressure points

- The contract says a departed service dissolves before the timeline closes
  upward; the code's `dissolveDeparted` is a stub. The row simply vanishes
  on the next second's rebuild.
- The initial past page is fetched from an hour ago with six rows. On a
  frequent corridor those six rows end long before now, so the train that
  left forty seconds ago is in neither the past nor the future. There is a
  hole around `NOW` exactly where the just-missed train belongs.
- `Now` covers the whole minute. For up to sixty seconds after a train has
  gone, the header still says it is here.
