# A visitor with one trip to make

**Persona.** Lena, in Sydney for three days, staying near Central, going
to Manly via Circular Quay tomorrow. Found the app by searching.

**Situation.** Tonight in the hotel. Wants tomorrow's plan. Will delete
the app on Friday.

**Goal.** Fuzzy: "what's the train part of getting to the ferry?"

## What happens

1. Setup: Central → Circular Quay. Home shows the next train, tonight.
2. Lena wants tomorrow at 09:00. The board only shows the next six
   services from now.
3. She reads the headsign and platform and hopes tomorrow is similar.

## Success looks like

- She learns which line, which platform, roughly how often, and how long.
- She is not asked to save, focus or grant anything to get that.

## Pressure points

- There is no way to look at a time other than now. The API supports `at`
  up to two hours ahead; the client never uses it for the future.
- The receipt copy will call her a regular ("You often check this trip
  around now.") after one look, because the receipt fires on any history.
- Every row of the trip list says `NEVER RIDDEN`. For a visitor it is
  simply noise.
- The whole personalisation layer is dead weight for a one-off user. Does
  the app still feel like a good departure board with zero history?
