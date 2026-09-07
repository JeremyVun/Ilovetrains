# iOS deviations

These are deliberate differences from the web reference, reviewable after the
iOS implementation requested on 2026-09-07.

- SwiftUI uses San Francisco and iOS safe areas around the status bar, camera
  cutout and home indicator. Browser chrome is not reproduced. Most typography
  uses fixed point sizes; changing Dynamic Type currently does not scale that
  text. Accessibility-size layout checks do not establish full Dynamic Type
  support. Content remains scrollable rather than clipping a fixed web frame.
- Location uses the native When In Use permission sheet after an explicit
  action in setup or Settings. There is no footer permission popup and no
  background tracking. Denied or restricted permission is labelled
  `Location is blocked`; the
  row’s `OPEN SETTINGS ›` action opens the app's iOS Settings page.
- Station search uses the native keyboard and Return chooses the first match.
  System keyboard avoidance resizes the available content area.
- A saved trip row carries trailing swipe actions: a short swipe reveals a
  destructive `Delete` button and a full swipe commits without the tap. The
  native context menu still offers `Delete trip`. Either deletion is reversible
  for four seconds from the bottom bar, which reads `{from} → {to} deleted`
  with an `Undo` label, wrapping to a second line rather than losing its verb;
  the trip's cached boards are purged when the window ends
  ([client-storage.md](client-storage.md#ios-storage)). The trips list is a
  native `List` with plain style, zero insets and hidden separators so the row
  at rest matches the previous stack. The row otherwise opens departures. `assets/comps/latest/ios-home-390x844-deleting.png` and
  `ios-home-390x844-deleted.png` are the exemplars. iOS follows the web's
  ten-trip LRU policy, including history and cache cleanup on eviction,
  instead of Android's unlimited saved list.
- New offline trips route over the same bundled SQLite package as Android.
  Conservative same-hub transfers and no cross-hub walking graph can produce
  different routes from the online planner. The app uses online Trip Planner
  results when available and has scheduled local results while it waits.
- Offline timetable coverage and a manual update action appear in Settings.
  The bootstrap covers 5 September–4 October 2026. Its coverage is finite;
  packages must be republished and downloaded to plan beyond that date.
- Settings uses 72pt minimum personal rows with 10pt vertical padding. Service
  choices show only `On`/`Off`; appearance keeps the selected checkmark without
  an underline. The `Transfer limit` row, shown inside Services only while the
  `transferLimit` flag is on, is one of those 72pt rows without its icon
  column, so it stands taller than the web row it ports; its words, values,
  action mark and behaviour are the web's. Journey lines round only their final destination end by 3pt,
  preserving square transfer joins (owner ruling, 2026-09-07).
- The shared journey-line layout measures origin and transfer chips before
  placement. Caps, markers and ride/dwell bars share a vertical center. Bars
  paint behind every marker, with 3pt ground separators. Alighting markers
  end at the dwell start and boarding markers begin at its end; boxes may
  shift to avoid overlap and stay within the device, while service-time coordinates
  stay proportional. Each transfer station sits beneath its dwell midpoint,
  clamped within the device and wrapped or stacked when names collide.
- The promoted Detail row is plain content, not a disabled button. Its chips
  keep their full fill and text colours; cancellation fades the composited
  journey device once so underlying bars cannot bleed through the labels.
- Expired or unavailable realtime makes new local plans use scheduled times;
  previously displayed boards and pins retain their last-known observations
  under the [native cache rules](native-data.md#cached-boards-and-departed-services).
  Timetable generation time and realtime observation time are never renewed
  merely by loading a cache. A focused service's alternatives retain their own
  source evidence, independently of its cancellation or delay update.
- Anonymous analytics remain disabled for native v1, as on Android. User-written
  feedback still sends only after tapping Send feedback. Drafts live in memory
  across navigation and clear after a successful submission. The success banner
  dismisses after four seconds; errors remain manually dismissible.
- User state uses atomic app-private files excluded from iCloud backup. iOS
  and the web have separate local trip lists; no account or sync is introduced.

The shared behavior remains defined by [ui.md](ui.md),
[client-storage.md](client-storage.md) and [native-data.md](native-data.md).

Current Settings exemplars are `assets/comps/latest/ios-settings.png` and
`ios-settings-light.png`, reproduced with `tools/shoot-ios.sh settings
settings-light`. The additional `settings-off`, `settings-blocked` and
`settings-on` calibration states (and their `-light` variants) exercise every
location-row action.
