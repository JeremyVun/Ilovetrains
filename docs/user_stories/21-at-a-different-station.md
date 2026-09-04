# Not at the saved station

**Persona.** Priya, after a dentist appointment near Burwood.

**Situation.** 11:20. Her saved trip starts at Rhodes; she is at Burwood,
also on a line to Town Hall. Location granted.

**Goal.** Hard: "train from here to Bondi Junction."

## What happens

1. She opens the app. The header shows Rhodes → Bondi Junction. The top
   line reads `3.1 KM TO RHODES`.
2. The prediction has scored her trips by distance to their *saved* origin.
   None start here.
3. She adds a new trip Burwood → Bondi Junction to get a board.

## Success looks like

- The app notices she is at a station and offers a board from it, at least
  as a one-off.
- She does not accumulate a permanent trip for a dentist visit.

## Pressure points

- The location term only weights saved origins. A station the app has never
  heard of is invisible to it, even when she is standing on its platform.
- A one-off trip costs a permanent slot in the ten-trip list, and without
  deletion (story 11) it stays.
- `3.1 KM TO RHODES` is honest and unhelpful. "You're at Burwood" is the
  fact that matters and the app has the data to say it, given a station
  index.
