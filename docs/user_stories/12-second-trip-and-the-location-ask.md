# The second trip and the location question

**Persona.** Priya, adding a weekend trip: Rhodes → Circular Quay.

**Situation.** Saturday 09:30 at home. After saving, home shows a panel:
`Open on the right trip. With several trips saved, your location helps
choose the right one. It never leaves this phone.`

**Goal.** Fuzzy: "sure, if it helps, but I don't want to be nagged."

## What happens

1. Priya taps `Use my location`. The browser prompt appears. She allows it.
2. The fix arrives. Prediction re-runs. The header may switch trips.
3. The `+ New trip` rail returns.

Alternative: she taps `Not now`. The panel disappears for this page load
and returns on the next open.

## Success looks like

- One clear ask, at a moment when the benefit is visible, then silence.
- Denial is respected: no repeat prompt, no degraded copy.

## Pressure points

- `Not now` is remembered only in memory. Every reload with two or more
  trips and no fix shows the panel again. That is a nag by another name.
- While the panel is up it *replaces* the `+ New trip` rail. She just added
  a trip and may want to add another; the affordance has vanished.
- The panel appears the moment there are two trips, whether or not the two
  trips share an origin. Two trips from Rhodes gain nothing from location.
- On a desktop browser the geolocation prompt is browser chrome far from
  the panel, and a denial there is permanent per site. Does the copy prepare
  her for that?
