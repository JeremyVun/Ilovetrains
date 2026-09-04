# Location denied, forever

**Persona.** Sam, privacy-conscious, denied location at the browser level
the first time it was asked and will never grant it.

**Situation.** Every day, forever.

**Goal.** Fuzzy: "the app should still be smart without knowing where I am."

## What happens

1. The location ask panel appears on every open with two or more trips,
   because the dismissal is not persisted and the permission is denied, not
   granted.
2. Sam taps `Not now` every time, or taps `Use my location` and the browser
   denies silently.
3. Prediction runs on time and history only.

## Success looks like

- The app asks once and never again.
- The top line reads `NEXT TRAIN` and the rest of the header is as good as
  it can be from history.

## Pressure points

- A permanently denied permission is detectable through the Permissions API
  the app already queries for silent fixes. It could stop asking.
- `Not now` is session-scoped. On the second day it is a nag.
- With no location, the reverse-direction problem in story 08 is at its
  worst: the only signals are the hour and the day type.
