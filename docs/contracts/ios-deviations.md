# iOS deviations

These are deliberate differences from the web reference, reviewable after the
iOS implementation requested on 2026-09-07.

- SwiftUI uses San Francisco and iOS safe areas around the status bar, camera
  cutout and home indicator. Browser chrome is not reproduced. Most typography
  uses fixed point sizes; changing Dynamic Type currently does not scale that
  text. Accessibility-size layout checks do not establish full Dynamic Type
  support. Content remains scrollable rather than clipping a fixed web frame.
- Location uses the native When In Use permission sheet after an explicit
  action in setup or Settings. There is no footer permission popup. The only
  background use is the followed-journey keepalive below, which asks for no
  further permission. Denied or restricted permission is labelled
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
- The 40 minute live horizon in [ui.md](ui.md#past-stale-and-exceptional-data)
  reads the first leg's departure estimate, while the rest of the row's live
  register reads `journey.realtime`, which is true for an estimate on any leg.
  A journey whose first leg has only a timetable departure but whose later leg
  carries an estimate therefore keeps the live register on iOS, where the web
  reference labels it `SCHEDULED`; the departure the rider acts on is
  timetable-only in both. Owner ruling 2026-09-11: keep the divergence rather
  than change what `journey.realtime` means.
- Release builds send the anonymous header, pin and ride counters in
  [analytics.md](analytics.md) with `pl: "ios"`, as on Android: no web-only
  setup, panel or strip-experiment events, an open is a user-visible
  foreground entry, and debug builds never send. User-written
  feedback still sends only after tapping Send feedback. Drafts live in memory
  across navigation and clear after a successful submission. The success banner
  dismisses after four seconds; errors remain manually dismissible.
- User state uses atomic app-private files excluded from iCloud backup. iOS
  and the web have separate local trip lists; no account or sync is introduced.

While a focused journey is `RUNNING LATE`, iOS paints the departure clock and
the `TO CHANGE` / `TO GO` label in the warning colour as well as the figure and
status; web keeps them neutral. Because late is granted on an arrival delay,
this shows whenever the ridden leg loses time en route.

## Home-screen widget

- The widget joins the Live Activity's extension (`TravelTrackerWidget`) and
  shares the App Group `group.com.ilovetrains.ios` with the app. Unsigned
  simulator builds (`CODE_SIGNING_ALLOWED=NO`, every helper script) embed no
  entitlements, so the app publishes nothing and the widget shows its empty
  state; renderer checks use the locally signed simulator build in
  `docs/operations/ios.md`. Device builds need the group registered to the
  team.
- Timeline entries fall on every minute boundary plus each departure and
  arrival, so the minutes and steps advance without reloads. Live data
  reloads at most every 15 minutes, within WidgetKit's daily budget.
- iOS 26 draws a sheen over the top of every widget and places lock-screen
  widgets below the clock at the bottom of the screen.

## Foreground arrival evidence

While a stored focus is under way, the existing foreground location owner can
monitor it across Home, detail and Settings with already-granted permission.
Provider updates target ten seconds; accepted evidence is at least five seconds
apart. Setup lookups share the owner. Backgrounding, disabling location,
permission loss, unpinning, deleting or replacing focus stops collection and
clears the raw window; late callbacks cannot cross generations. The tracker's
background keepalive runs a separate provider whose fixes are discarded, so no
background position reaches the guard and no location payload leaves the
phone. Persist only the identity-bound guard,
retention checkpoint and optional completion basis/time described in
[client-storage.md](client-storage.md#final-arrival-decision).

The app, history and existing tracker consume the same arrival result. A
clock reaching the last estimate cannot complete an armed unresolved focus or
suppress its tracker. Reconcile matching refreshed service times before arrival
on resume. OS dismissal remains surface suppression, never ride completion.

## Persistent travel tracker

Entering travel mode, inferred or by pinning a train, starts a local Live
Activity when the app can request one and iOS permits it (owner ruling,
2026-09-23); replacing an already-tracked focus also replaces its activity. The containing
app publishes focused journey updates through ActivityKit, and the widget
extension renders the lock-screen and Dynamic Island surfaces. No push token,
`Always` location permission or personal server state is introduced.

The accepted short sentence, platform roles, destination arrival and quiet trip
line remain the visual target. Native system countdowns show a bounded clock
interval, rather than promising a freshly computed minute label while the app
is absent. The quiet context row includes last-update provenance from
publication onward, including while source data is fresh. This avoids relying
on the system to redraw stale presentation exactly at `staleDate`; the
authorization host was observed showing zero before switching that state.
Stale content retains the same card and its observed times. Its current
instruction is last known; it does not
assert that the person is still on that leg. Freshness expires at the earlier
of source expiry and the next instruction boundary.

The system timer stops at zero. The trip marker shows the last published
timetable position; it updates with app publications, not autonomously while
the app is absent, and never represents live location. A missed connection
with overlapping leg times omits the trip line and labels the destination ETA
as planned, including before the current train reaches the change station.
New platform/cancellation information, journey
stage changes and completion require app execution: they happen at the real
moment while the keepalive below runs, and otherwise reconcile when the app
resumes. The activity may remain after expected arrival until the app or
iOS ends it. A timer reaching zero never records a ride. Dismissal suppresses
recreation for that focus without clearing the journey, and an old activity's
tap cannot restore a replaced focus. Session persistence is defined in
[client-storage.md](client-storage.md#native-tracker-sessions).

Calibration exemplars are the real ActivityKit captures in
`assets/comps/latest/travel-tracker/ios/`, reproduced with
`tools/shoot-travel-tracker-ios.sh` on a freshly created simulator. They cover
the ten fixture states at default text on a 402-point iPhone 17 Pro in both
appearances, plus compact and expanded Dynamic Island frames. The UI suite
proves automatic entry, denial, wall-clock stale boundaries, dismissal,
replacement, stale-link rejection and a Live Activity tap cold-launching the
matching journey. Accepted verification limits (owner ruling 2026-09-10):
enlarged accessibility text, the 390-point phone width, the minimal Dynamic
Island beside a competing activity and VoiceOver traversal of the card are
unverified, as is delivery on a physical iPhone. Treat a defect found there as
a bug to fix, not a contract exception.

While a tracker session is active for the visible focus, the location
preference is on and permission is granted, backgrounding starts coarse
location updates (hundred-metre accuracy, a 100 m distance filter, no
automatic pausing, the system background indicator shown) purely to keep the
refresh, reconcile and publish loop scheduled. The arrival guard's own monitoring stops as it
always did. The keepalive stops when the app returns and when the session
ends, is dismissed or expires. Without permission, with the location
preference off or with no session it never starts, and the app suspends and
reconciles on resume as before.

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
