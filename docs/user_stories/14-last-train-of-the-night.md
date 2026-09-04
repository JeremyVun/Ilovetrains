# The last train of the night

**Persona.** Sam, at Central after a gig, slightly drunk, cold.

**Situation.** 00:35. Trains to Epping are thinning out. Sam needs to know
if there is still one, and if it involves a wait at Strathfield that is
better spent in a taxi.

**Goal.** Hard: "is there a train, when, and how long is the change?"

## What happens

1. Sam opens the app. The header shows the next Central → Epping journey,
   which may be a one-change trip with a long wait.
2. Sam taps the row to see the board: two or three services, then
   `— END OF BOARD` and `Nothing scheduled after 00:48.`
3. Sam opens detail on the last one and reads the change: `34 min` at
   Strathfield.

## Success looks like

- The board is honest about the end of service: it says there is nothing
  after, and Sam trusts it.
- Long changes are stated as minutes so the taxi decision is easy.

## Pressure points

- The server prunes journeys whose change exceeds sixty minutes only when a
  later journey arrives sooner. Late at night the survivor can be a
  three-hour wait, shown as a normal row. Is a 180-minute change on the
  board, or is the row silently a trap?
- `Nothing scheduled after 00:48.` is printed only when the board has three
  or fewer rows and the data is live. On a stale board Sam gets the
  ambiguous `No services on the last board we could load`.
- Sunday-night trackwork often replaces the whole line with buses. The
  server excludes buses, so the board is empty with no explanation. `No
  services in the next few hours` is technically true and useless.
- At 00:35 the day-type and hour logic is on the far side of midnight from
  the evening history. Does prediction still pick the way home?
