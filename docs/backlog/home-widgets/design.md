# Home-screen widgets on iOS and Android

Stage: build. Visual direction ruled (B · Timetable, round 1); data layer built.

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

## Comps round 1 (2026-09-23/24)

Workshop `/private/tmp/ilt-5e0c1f-widget-comps-r1` (sheet `index.html`,
report `OPTIONS.md`; exemplar frames copied to `comps/round1/`). Four
directions: A · Header (countdown leads), B · Timetable (departure clock
leads, the medium is a miniature board), C · Tracker (the Live Activity's
sentence), D · Ruler (time ruler).

Owner rulings, 2026-09-24:

- **B · Timetable is the exemplar** for iOS small and medium and Android 2×2
  and 4×2, with C's tracker sentence on the iOS lock screen, as recommended.
- **Android countdown:** a system-ticking timer wrapped in the tracker's
  words, "T9 leaves in 02:24", because no Android widget view can count down
  in whole minutes by itself. iOS keeps the product's "3 min" through
  per-minute timeline entries.
- **Freshness:** every widget always shows "Last updated HH:MM" (offline:
  "Offline · Last updated HH:MM"), the Live Activity's wording, because a
  widget is almost never live.

Findings carried forward as build invariants (measured in the round):
iOS 26 widget sizes differ from Apple's published table (iPhone 17 Pro small
164.3 pt square, medium 349.7 × 164.3 pt; iPhone SE small 146 pt); the Pixel
launcher 2×2 is 179.4 × 203.8 dp and 4×2 373.7 × 203.8 dp, taller than the
iOS square; tinted, clear and lock-screen renderings drop line and warning
colour, so a line is named in text there and filled platform labels are drawn
as cut-outs; the two widest names in the station index overflow the SE small
in every direction.

Owner rulings, 2026-09-24, second set:

- **The lead train is the header's recommendation**, not simply the next
  departure, so the widget never names a different train from the app. The
  recommendation selection is shared with the widget on both platforms; the
  medium's following rows stay chronological, as a board is.
- **Text is at least 11 pt** everywhere (Apple's widget floor), including the
  platform label, SCHEDULED and "Last updated".
- **Gallery copy:** name "Next train"; description "The next train for the
  trip you usually take at this time."

Lead decisions on the round's remaining open points (the owner may overrule
at the real-render verdict):

- The medium labels scheduled-only rows `SCHEDULED`, as board rows do; the
  small follows the B frames.
- Monochrome renderings (tinted home screen, lock screen) name the line in
  text (`T9`), because colour is gone there.
- The empty state reuses setup's existing "New trip" / "Choose where you
  start"; no new copy.
- The lock screen offers the rectangular widget only (the owner chose it);
  no inline variant.
- The widget background is the app's own ground colour, as comped.
- A name too wide for the SE small is shortened by the contract's rule
  first; if it still does not fit, the origin line may scale down, never
  ellipsise.
- Tap opens the app on Home (the empty state opens setup), not whatever
  screen the app was last on.

## Data layer as built (phase 1, 2026-09-24)

Built and verified on both platforms (see build_plan.md). Deviations the
lead accepted: the widget redraws only when its answer changes (not on every
fresher board), so a 30-second app refresh never spends the widget's fetch
budget; Android computes content in a WorkManager worker and stores it in
Glance state; a focus uses the app's own focus request; stored boards keep up
to eight journeys with the fields the retained label needs. Unsigned
simulator builds carry no App Group, so widget verification needs the
locally signed simulator build in `docs/operations/ios.md`; signed device
builds need the group registered to the team on the next signed build.

Owner rulings at the real-render verdict, 2026-09-24 (sheets
`/private/tmp/ilt-5e0c1f-3-ios/index.html` and
`/private/tmp/ilt-5e0c1f-3-android/index.html`):

- **Lock screen freshness:** the three-line lock widget shows "Last updated"
  only when the data warns (offline, retained, timetable), replacing its third
  line; live data keeps the arrival line. This is the one exception to
  "always Last updated".
- **Tight change in monochrome:** tinted and lock renderings, which lose the
  warning colour, carry the product's existing words "Tight change" for a
  tight change still ahead. Colour renderings keep paint only.
- **Android early drop:** a departed train leaves the widget up to about 15
  seconds before its departure, because Android runs the redraw late and a
  countdown must never go negative.
- **iOS small arrival:** with 14 pt platform chips, the small shows the
  arrival only when a state has room (live, home); the medium always shows
  arrivals.

## Open questions

None.
