# Home-screen widgets on iOS and Android

Stage: design. Visual direction: comps round 1 pending. No build plan yet.

## Owner's words (the spec)

1. 2026-09-23: "build the home screen widget for ios and android."
2. 2026-09-23, which trip it shows: "Header, by time of day": the pinned
   train when there is one, otherwise the trip the app predicts for this hour
   and day (the header's prediction without location), so mornings show the
   way to work and evenings the way home.
3. 2026-09-23, sizes: small and medium on iOS plus the iOS lock screen; on
   Android one resizable widget showing the same content at 2×2 and 4×2.

Why: the product promises an answer with zero taps (`docs/PROJECT.md`,
principle 1). A widget answers without opening the app at all. `docs/ROADMAP.md`
lists widgets under native work.

## What the rider sees

- **Small (iOS) and 2×2 (Android):** the trip (from → to) and the next train
  for it: departure clock time and a countdown that stays true without the
  app running, the boarding platform, the line colour, and the delay or
  provenance word when there is one.
- **Medium (iOS) and 4×2 (Android):** the same, plus the two following
  departures.
- **Lock screen (iOS, accessory):** the trip's destination and the next
  departure, compressed to what fits a glance.
- **Pinned train:** the widget follows the pinned service, as the header does.
- **Tap:** opens the app on home, which then answers with location as usual.

The widget is a glance at the header, never a second header: no receipts,
no controls, no configuration. The visual composition is decided by comps
(round 1 below) and then passes through the real OS renderers before the
owner's final verdict.

## Mechanism

### Which trip

The answer is, in order: the visible focused journey (the shared displayed
focus predicate in `client-storage.md`, including expiry); otherwise the
no-location prediction for the current time, `predict(data, stations,
fix: nil, now)`, over compatible saved trips. The widget never uses location,
never requests it, and never writes history, votes or rides. With no
compatible saved trip it shows an empty state that opens setup.

History scoring works on the hour of day and weekday/weekend
(`historyEvidence`), so the answer for any future hour can be computed ahead
of time: the app precomputes a **schedule** of the predicted trip and
direction for each of the next 168 hour boundaries (one week) whenever its
personal document, service preferences or station index change. A widget
reads the entry for the current hour. After a week without opening the app
it repeats the last week's entry for the same weekday and hour.

### Departures

The widget fetches the chosen trip's departures from the app's existing
stateless API (the same station-pair request the app makes, with the current
service modes and transfer cap), from its own timeline refresh. It never runs
the offline planner: an offline plan can take close to a minute
(`OfflinePlannerTests`, Sunday metro gap: 57 s on 2026-09-23), far beyond a
widget's budget. When the fetch fails it shows the app's last board for that
pair, which the app shares with each schedule write, with the same honest
provenance the app uses for a retained board. With neither, it shows the trip
without departures and a line saying the app will show them.

### Staying true without refreshes

The countdown must never be stale. iOS uses WidgetKit timeline entries at
each departure boundary and a system-ticking relative text; Android uses a
system-ticking countdown view or, where one is unavailable, prints only the
clock time. Refresh live data at most every 15 minutes and at the next
schedule change; the app also asks the system to reload widgets when it
writes a new schedule or its focus changes.

### iOS plumbing

A new home-screen and accessory widget joins the existing
`TravelTrackerWidget` extension's `WidgetBundle`. The app and extension share
an App Group container (new entitlement on both targets) holding one
`widget-v1.json`: compatible trips (ids, station ids and names, modes), the
hourly schedule, the visible focus snapshot with its expiry, the service
modes and transfer cap, and at most the last board per scheduled pair. No
history, votes, rides, location or preferences beyond those. The extension
reads it; only the app writes it.

### Android plumbing

A Jetpack Glance app widget in the app module, `SizeMode.Responsive` for 2×2
and 4×2. It reads the same facts through the app's existing storage owner (no
second writable copy of the personal document). The app requests
`updateAll` on schedule or focus changes; periodic refresh uses WorkManager
at its 15-minute floor and a one-off update at the next departure.

### Contracts touched at build

`client-storage.md` (widget snapshot and schedule), `ui.md` (widget section
and exemplars), `ios-deviations.md` and `android-deviations.md` (widget
limits: no location, refresh budget), `docs/operations/ios.md` (App Group
entitlement for signing). The privacy page already covers station-pair
departure requests; the build confirms no other wording changes.

## Comps round 1

Pending: see `comps/` once the round runs.

## Open questions

- Visual composition of every size (comps round 1, owner verdict).
- Any new copy the comps need (empty state, no more services tonight) is
  drafted by Astra and ruled by the owner before the build.
