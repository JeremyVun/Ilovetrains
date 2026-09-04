# Delayed before she has even left, and the change is now tight

**Persona.** Priya, at home, 09:15, focused on the 09:24.

**Situation.** The T9 is running six minutes late. The change at Town Hall
was seven minutes; it is now one. She has not left the house.

**Goal.** Hard: "do I still take the 09:24, or the 09:39?"

## What happens

1. She opens the app. The status line reads `RUNNING LATE`; the countdown
   is in the warning colour with `6 MIN LATE` beneath it.
2. The journey axis shows the change gap unpainted. The instruction is the
   headsign, `Gordon via Lindfield`.
3. She goes to the board. The 09:24 row's dwell segment *is* painted in the
   warning colour, and detail says `1 min change`.
4. She realises the header hid the most important fact and picks the 09:39.

## Success looks like

- The header shows the tight change before departure: painted gap, and a
  line she can act on.
- The alternative is one tap away and obviously better.

## Pressure points

- The directions model returns before it computes the risk when the journey
  has not departed, so `tight` is always false pre-departure. The board row
  and detail compute it from the same numbers and get it right.
- The pre-departure instruction line is the headsign. There is room for one
  sentence that says "Change at Town Hall is now 1 min" without claiming she
  will miss it.
- A one-minute printed change is below the server's three-minute planning
  floor, so this journey would never have been *offered* at these times. It
  is offered because it was planned at seven. The header is the only screen
  that does not say so.
