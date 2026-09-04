# In the tunnel with no signal

**Persona.** Priya, focused, on the T4 out of Town Hall toward Bondi
Junction, underground the whole way.

**Situation.** 10:01. No data at all for eight minutes. She checks the phone
twice out of habit.

**Goal.** Fuzzy: "where am I on the trip, and is it still on track?"

## What happens

1. She opens the app. The service worker paints the shell; the last board is
   in localStorage; the focus snapshot is intact.
2. The refresh fails. The freshness dot goes to the warning colour and reads
   `OFFLINE`.
3. The header shows the focused journey with the progress marker moving on
   the clock. Countdown figures are withheld because the data is stale.
4. The status line reads `RUNNING` because late needs fresh data.

## Success looks like

- Directions survive the tunnel: station to get off at, platform, marker.
- Staleness is visible but not alarming: she knows the *plan* is still
  shown, just not the live estimate.

## Pressure points

- The `TO GO` figure disappears when the data is stale. The plan's own
  arithmetic (scheduled arrival minus now) is still honest as a *scheduled*
  figure. Is an empty figure slot better than `8 min · SCHEDULED`?
- The footer says `OFFLINE · LAST UPDATED 8 MIN AGO` on the board, but home
  says only `OFFLINE`. The two screens grade staleness differently.
- If the train was running late before the tunnel, the status silently drops
  from `RUNNING LATE` to `RUNNING` because the rule requires fresh data. The
  train did not get less late.
- When signal returns at Bondi Junction the arrival has passed and the
  ride is recorded, but only on a *successful* refresh. If she closes the
  app before one lands, the completed ride is never written.
