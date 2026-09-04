# The phone died on the train

**Persona.** Priya, focused on the 09:24, phone at 2%.

**Situation.** Phone dies at 09:35, charged from a power bank, back on at
09:55, on the T4 out of Town Hall.

**Goal.** Fuzzy: "pick up where I was."

## What happens

1. She opens the app. The focus snapshot is in localStorage, so the header
   is directions again, with the marker where the clock says it should be.
2. The refresh runs and re-matches the focused journey in fresh data if it
   is still on the live board. It is not; it departed. The snapshot stands.
3. Directions count `TO GO` from the snapshot's last known estimate.

## Success looks like

- Cold open lands straight in directions with no re-selection.
- The instruction names the arrival platform from the snapshot.

## Pressure points

- The snapshot's estimates are from before the phone died. A delay that
  grew since is invisible. There is no "as of 09:34" on the header; the only
  age is the footer's on other screens.
- If the service worker was never installed (first day), the cold open with
  no network shows nothing at all.
- The tick timer runs from page load with the real clock; the render is
  correct, but there is no cheap "we are in the middle of your trip" cue for
  someone who just got their screen back.
