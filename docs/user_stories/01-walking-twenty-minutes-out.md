# Walking to the station, twenty minutes out

**Persona.** Priya, daily commuter, trusts the app. One saved trip:
Rhodes → Bondi Junction.

**Situation.** 08:02, walking out of the house. It is a twenty-minute walk to
Rhodes if she leaves now, longer if she stops for coffee. Phone in one hand,
keys in the other, she looks at the screen for three seconds.

**Goal.** Fuzzy: "do I need to hurry, or can I get the coffee?"

## What happens

1. She opens the app on the way out the door.
2. The smart header shows the next Rhodes departure: a countdown, the two
   clock times, the platform cap, the headsign.
3. If location is granted, the top line reads `1.4 KM TO RHODES`.
4. She glances at the countdown and makes her decision.

## Success looks like

- In one glance she knows which train she can actually make, not just which
  train leaves next.
- Coffee or no coffee is decided without any tapping.

## Pressure points

- The header shows the *next* departure. If the next train leaves in 6
  minutes and she is 20 minutes away, the answer on screen is a train she
  cannot catch. The one she can catch is on the board, one tap away and
  several rows down. Does the header ever pick the first *reachable* train?
- `Leave now for Platform 1` fires only when the departure is inside the
  walk time. Twenty minutes out, there is no leave-by hint at all. What does
  she learn from a `6 min` figure while standing at her front door?
- The location fix is taken once on open and expires after five minutes.
  If she checks again mid-walk, the distance may be the old one.
- If location is denied, the top line is `NEXT TRAIN` and nothing on screen
  relates the countdown to her walk.
