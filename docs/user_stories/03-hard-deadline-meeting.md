# A meeting she cannot be late for

**Persona.** Priya, on a day that matters. Interview at 10:00 near Bondi
Junction.

**Situation.** 08:40 at home. She wants to be at Bondi Junction by 09:35 to
walk over calmly. She is anxious and will re-check the app several times.

**Goal.** Hard: "which train gets me to Bondi Junction before 09:35, and what
is the latest one that still does?"

## What happens

1. She opens the app. The header shows the next train and its arrival time.
2. The arrival time is what she cares about, not the countdown. She reads
   `10:08`-style arrival on the right.
3. She taps the trip row for the board and scans the arrival column down the
   six rows to find the last one arriving before 09:35.
4. She opens journey detail on that row to check the change at Town Hall.
5. She taps `Take this train` so the header becomes directions.

## Success looks like

- The arrival column is scannable as a column: same x-position, same size,
  every row.
- The board reaches far enough into the future to contain a train arriving
  at 09:35 when it is 08:40 now.
- Detail shows the change window and both platforms so she can plan the walk
  at Town Hall.

## Pressure points

- The board shows six services. At 15-minute headways that is 90 minutes of
  future; at 3-minute headways it is 18. Can she find a train that leaves in
  50 minutes on a busy corridor? There is no way to page forward.
- The arrival time is the smallest, quietest figure on the row (16px,
  secondary ink). On a deadline day it is the most important one.
- Once focused, the status line says `RUNNING` while she is still at home.
  Does "running" read as "your train is fine" or as "you are on it"?
- She re-checks five times in twenty minutes. Each open re-predicts. Does the
  header stay on the focused train every time, even if a location fix arrives?
