# Standing on the platform

**Persona.** Priya again, at Rhodes, on the platform she always uses.

**Situation.** 08:23. She is standing at Platform 1. A train is pulling in.
She wants to know if it is hers. She has under two seconds of attention: the
doors open for about twenty seconds.

**Goal.** Hard: "is this train the one that gets me to Bondi Junction, and if
not, how long until mine?"

## What happens

1. She unlocks the phone with the app already open from earlier.
2. The header shows the next departure with `Now` or a small countdown,
   `PLATFORM 1`, and the headsign `Gordon via Lindfield`.
3. She matches the headsign on the train's display to the one on screen.

## Success looks like

- The headsign and platform match or don't in one look.
- If this train is not hers, the header's figure tells her how long to wait.

## Pressure points

- The app was open in the background. Timers pause when hidden and resume
  on visibility, but the first paint on return is the *old* model until the
  refresh lands. For up to a second the screen can show a train that already
  left. Does the `Now` row dissolve quickly enough to avoid a wrong match?
- Two trains from Platform 1 within three minutes: the header names only one.
  If she just missed the 08:22, does the 08:25 appear instantly, or does the
  header show `Now` for the departed one for the rest of the minute?
- `Now` is shown for the whole departure minute. A train that left at
  08:22:10 still reads `Now` at 08:22:50, while the next one is pulling in.
- Text under the figure is empty on an ordinary live countdown. With no
  `MIN`, `DEPARTING` or `SCHEDULED` word, does a first-time reader know the
  figure is minutes?
