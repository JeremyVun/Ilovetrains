# The second leg is cancelled while she is on the first

**Persona.** Priya, focused, on the T9 heading into Town Hall.

**Situation.** 09:45. The 09:58 T4 from Town Hall to Bondi Junction is
cancelled. She does not know yet. She is reading and glances at the phone
because it is a habit.

**Goal.** Hard: "what do I do now?"

## What happens

1. She opens the app. The header reads `CANCELLED` in the warning colour.
2. The instruction line says `09:24 CANCELLED · NEXT TRAIN` and the figure
   counts to the focused journey's departure, which has already passed.
3. She taps the trip row for the board. The board shows future journeys from
   Rhodes, where she is not.
4. She works out for herself that she should still get off at Town Hall and
   find the next T4.

## Success looks like

- The header tells her the change is broken, which leg is broken, and the
  next train from the station she is about to arrive at.
- She does not have to re-plan from Rhodes.

## Pressure points

- The cancelled instruction names the journey's *departure* time from
  Rhodes, not the cancelled leg. The 09:24 left fine; the 09:58 is the
  problem. The detail summary gets this right; the header does not.
- After departure, the header keeps the focused journey with warning copy
  and no alternative. The roadmap names this gap; the story shows what it
  costs: a rider in a tunnel with a dead plan.
- The board is for Rhodes → Bondi Junction. There is no way to ask for Town
  Hall → Bondi Junction without adding a new trip.
- Cancellation detection is loose upstream. A false cancellation here sends
  her off a perfectly good train. What does she see if the leg comes back?
