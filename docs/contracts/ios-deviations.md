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
  row’s `OPEN SETTINGS ›` action opens the app's iOS Settings page. Setup
  follows the shared native location flow in [ui.md](ui.md#setup-and-station-search).
  A permission sheet's inactive scene does not cancel its pending request;
  backgrounding stops the provider, and returning resumes a pending permitted
  lookup. A one-shot location request times out after 15 seconds.
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

## Foreground arrival evidence

While a stored focus is under way, the existing foreground location owner can
monitor it across Home, detail and Settings with already-granted permission.
Provider updates target ten seconds; accepted evidence is at least five seconds
apart. Setup lookups share the owner. Backgrounding, disabling location,
permission loss, unpinning, deleting or replacing focus stops collection and
clears the raw window; late callbacks cannot cross generations. No background
GPS or location payload is introduced. Persist only the identity-bound guard,
retention checkpoint and optional completion basis/time described in
[client-storage.md](client-storage.md#final-arrival-decision).

The app, history and existing tracker consume the same arrival result. A
clock reaching the last estimate cannot complete an armed unresolved focus or
suppress its tracker. Reconcile matching refreshed service times before arrival
on resume. OS dismissal remains surface suppression, never ride completion.

## Persistent travel tracker

Automatic inferred travel-mode entry starts a local Live Activity when the app
can request one and iOS permits it. Pinning alone does not start tracking;
replacing an already-tracked focus also replaces its activity. The containing
app publishes focused journey updates through ActivityKit, and the widget
extension renders the lock-screen and Dynamic Island surfaces. No push token,
background location permission or personal server state is introduced.

The accepted short sentence, platform roles, destination arrival and quiet trip
line remain the visual target. Native system countdowns show a bounded clock
interval, rather than promising a freshly computed minute label while the app
is absent. Stale content retains the same card and its observed times with
last-update provenance. Its current instruction is last known; it does not
assert that the person is still on that leg. Freshness expires at the earlier
of source expiry and the next instruction boundary.

The system timer stops at zero. The trip marker shows the last published
timetable position; it updates with app publications, not autonomously while
the app is absent, and never represents live location.
New platform/cancellation information, journey
stage changes and completion require app execution; they reconcile when the
app resumes. The activity may remain after expected arrival until the app or
iOS ends it. A timer reaching zero never records a ride. Dismissal suppresses
recreation for that focus without clearing the journey, and an old activity's
tap cannot restore a replaced focus. Session persistence is defined in
[client-storage.md](client-storage.md#native-tracker-sessions).

The shared behavior remains defined by [ui.md](ui.md),
[client-storage.md](client-storage.md) and [native-data.md](native-data.md).

Current Settings exemplars are `assets/comps/latest/ios-settings.png` and
`ios-settings-light.png`, reproduced with `tools/shoot-ios.sh settings
settings-light`. With the flag on they are `ios-settings-transfer-limit.png`,
`ios-settings-transfer-limit-no-limit.png` and
`ios-settings-transfer-limit-light.png`, from the calibration states of the
same names. The additional `settings-off`, `settings-blocked` and
`settings-on` calibration states (and their `-light` variants) exercise every
location-row action.

Native setup location exemplars are `assets/comps/latest/ios-setup-location-`
`{idle,denied,failed,approximate}[-light].png`, captured at 402×874 pt on
an iPhone 17. The idle frame includes the keyboard; result and recovery frames
keep it dismissed. Real permission, keyboard handoff and manual recovery are
also driven at 390×844 pt by `AppFlowTests` on an iPhone 13.
