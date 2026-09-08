# Native travel surfaces

Checked 2026-09-08 against the official sources below. These are platform
constraints for the persistent travel tracker. The accepted visual design and
build handoff are in [the backlog](../backlog/persistent-travel-tracker/design.md);
visual acceptance does not prove native execution behavior.

## Android

`Notification.ProgressStyle` arrived with Android 16. Points and segments
can represent milestones and durations. Title, content text, subtext,
progress and actions are system-template fields; do not assume arbitrary
Compose layout in the notification.
[Progress-centric notifications](https://developer.android.com/develop/ui/compose/notifications/progress-centric).

For a fuller line, `ProgressStyle.setStyledByProgress(false)` is available.
The default styles future segments as unfilled; disabling it gives every
segment the filled appearance. The app must then distinguish progress through
the tracker icon or segment colours. This is a supported styling choice, not
an arbitrary bar-height control. Verify its actual result in the OS renderer.
[ProgressStyle reference](https://developer.android.com/reference/android/app/Notification.ProgressStyle).

Live Updates require an ongoing notification with a title, a supported standard
style, the promoted-notification manifest permission and a promotion request.
Custom `RemoteViews`, group summaries, colourized notifications and minimum
importance channels are ineligible. Check eligibility and promotion permission;
manufacturers may impose further criteria. The user can demote or dismiss it.
Do not repost a dismissed update. Activities should be user-initiated,
ongoing/imminent and time-sensitive. This makes automatic inferred travel-mode
entry a product/platform question, not automatic eligibility. Status chips have
limited space; a complete station name cannot be assumed to fit.
[Live Update requirements](https://developer.android.com/develop/ui/views/notifications/live-update).

A notification is not a background execution grant. A foreground service needs
an appropriate declared type and permissions. `specialUse` requires a stated
use case and is reviewed for Play distribution; its existence is not proof that
this use will be accepted. A location service must not be selected to obtain
runtime when the feature does not need location.
[Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types).

## iOS

ActivityKit owns lifecycle; a WidgetKit extension renders SwiftUI content.
A Live Activity cannot itself access network or location. The app can update
it while it receives execution, or a server can send ActivityKit pushes.
Static and dynamic content together are limited to 4 KB. Active lifetime is
at most eight hours; the ended activity may remain on the lock screen up to
four more hours. Set `staleDate` and render `isStale` so missed updates do not
leave a false freshness claim. Ending and dismissal are distinct.
[Displaying live data](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities).

Prioritize the next useful fact. Provide coherent compact, minimal, expanded
and lock-screen presentations. The lock-screen standard margin is 14 points.
Apple's iOS sizing guidance gives 84–160-point lock-screen/expanded heights;
ActivityKit may truncate taller content. Compact leading/trailing regions sit
beside the camera; do not fill the central camera area with text in a mockup.
Test different appearances, wallpaper and reduced-luminance display. Tapping
must reach the relevant trip. System visibility makes trip details readable
by bystanders; the product must decide its privacy presentation.
[Live Activities design guidance](https://developer.apple.com/design/human-interface-guidelines/live-activities).

SwiftUI dynamic date text can update without running extension code. The
single-date `.timer` style counts down to its date and then counts up; it
must not be left beside a static “to change” label after that time passes.
Verify a bounded countdown and fallback in the real Live Activity renderer.
[Dynamic dates](https://developer.apple.com/documentation/widgetkit/displaying-dynamic-dates).

Ordinary ActivityKit requests start in the foreground. A `LiveActivityIntent`
can start an activity from background execution. Existing travel detection is
evaluated on foreground home fixes, so automatic entry need not add a user tap.
A future always-background detector would need a separate start mechanism.
[Activity lifecycle](https://developer.apple.com/documentation/activitykit/activity).

APNs updates use activity push tokens and server-originated messages.
Introducing that infrastructure would change this project's device-only
personal-state boundary and is outside the current proposal.
[ActivityKit push updates](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications).

Build API audit, 2026-09-08: `update(_:alertConfiguration:timestamp:)` uses
`timestamp` to reject older observations; it does not schedule future content.
The scheduled `request(...start:)` API starts a separate activity and requires
an alert configuration. Neither supplies a timeline of local instruction
updates for an existing activity. SwiftUI's `TimeDataSource` supports updating
date text, but that alone does not establish arbitrary phase selection.
[Update ordering](https://developer.apple.com/documentation/activitykit/activity/update(_:alertconfiguration:timestamp:)),
[scheduled start](https://developer.apple.com/documentation/activitykit/activity/request(attributes:content:pushtype:style:alertconfiguration:start:)),
[time data sources](https://developer.apple.com/documentation/swiftui/timedatasource).

## Engineering questions, not verified capabilities

- Can each OS keep the next instruction useful throughout a multi-leg trip
  without a new server-side personal service?
- What remains visible after suspension, process death, missed refresh,
  freshness expiry and the next scheduled phase boundary?
- Which countdown/progress primitives keep ticking without application code,
  and what must be replaced by an actual content update?
- What does the actual device render when promotion is unavailable, text is
  large, content becomes stale or the user dismisses the tracker?

Answer these with isolated native prototypes and real renderer captures before
treating a browser illustration as implementable system UI.

## Local renderer evidence, 2026-09-08

- Android 16 / SDK 36, API 36.1 system image revision 4, build
  `BE4B.251210.005`: the isolated `com.ilovetrains.trackerlab` probe rendered
  a complete three-stage structured sequence and two condensed prose examples.
  Both transfer platforms, seven-minute change and destination ETA fit in the
  system's subtext/title/body fields. These fields each rendered one line on
  that image; the full iOS prose layout is not an Android geometry promise.
- `setStyledByProgress(false)` produced filled 11/7/50 segments and a visible
  point at supplied positions 6/14/61. The notification dump confirmed the
  supplied lengths and styling flag; this is not a native pixel-proportion
  measurement. `requestPromotedOngoing=true` confirms a request, not independently
  verified granted promotion. Progress points carry position/colour, not the
  app's platform-number labels. System UI ANRs limited further capture; no
  unverified variant is counted as native evidence.
- Earlier iOS 26.4 ActivityKit probes exposed a real lock-screen activity and
  camera-separated compact regions. The exact accepted Option 1 adaptation
  subsequently built, installed and launched; after permission, its isolated
  simulator exposed lock-screen accessibility controls but returned black
  framebuffers. The attempt stopped after five minutes. No accepted-design
  native lock-screen image was obtained.
- All probes used static or shifted review clocks. None proves realtime
  refresh, reliable ticking/phase changes, freshness expiry, process-death
  recovery or physical-device power behavior. The build begins by proving
  these separately from layout. The accepted browser reference is preserved
  in [the calibration set](../../assets/comps/latest/travel-tracker/README.md).

## Build execution evidence, 2026-09-08

These later isolated probes used advancing wall clocks. They supersede the
design-session limitation above for the specific behaviors tested, not for
physical-device delivery or power use.

| Platform/state | Observed behavior |
| --- | --- |
| Android 16 QPR2 foreground | `specialUse` service entered foreground; the system applied `PROMOTED_ONGOING`, beyond merely accepting a promotion request. |
| Android background/locked | A 90-second synthetic journey crossed riding, transfer and final stages, then removed its notification and service. |
| Android process death | A locked-app SIGKILL was followed by a sticky-service restart about 4.5 seconds later. The new process resumed the saved wall-clock phase and completed the same fixture. This is one observation, not a restart SLA. |
| Android dismissal | Swiping the promoted card delivered `deleteIntent`; same-focus suppression survived force-stop and relaunch. |
| Android permission denial | No foreground service started; relaunch did not repeat the notification prompt. |
| Android 15 | The same APK used ordinary `BigTextStyle` and retained event, platform roles, change time, ETA and source timestamp. |
| iOS 26.4 lock screen | The sentence composition and stale fallback rendered in ActivityKit; bounded timer and system progress continued with the app process absent. |
| iOS compact/expanded island | Compact rendered a line label and bounded countdown. A scratch XCUITest long press opened the actual expanded surface; its leading place label clipped at the curved corner, and that prototype omitted destination ETA/progress. This is renderer evidence, not an accepted product exemplar. |
| iOS minimal island | Two activities from distinct scratch apps produced the original train glyph in the attached island and the competitor glyph in the detached bubble. Both used the native minimal regions. |
| iOS boundary/relaunch | Timer stopped at zero; no new leg instruction appeared without an update. Relaunch found the stale activity and could update or end it. |
| iOS custom date formatter | `TimeDataSource` with a custom `DiscreteFormatStyle` compiled but rendered placeholders in the activity; it did not establish a usable instruction timeline. |

Two concurrent same-app activities were accepted by ActivityKit but still
produced one compact island. Distinct app and extension bundle IDs were needed
to exercise minimal selection on this simulator; its image had no Clock app for
a timer-based contention check. Product verification must repeat the native
surface checks and fix expanded-region width/curvature before accepting
calibration.

The integrated app subsequently rendered the approved sentence, platform roles,
destination ETA and trip line on the actual lock screen and expanded island.
Expanded-region safe insets corrected the clipped leading label and line ends.
Its system countdown advanced with the app process absent, clamped at zero and
switched to last-update provenance. However, the custom timer-backed progress
style kept its marker at the origin: its configuration did not expose a usable
fraction. The production trip line therefore uses the last app-published
position. The earlier stock-progress probe does not establish autonomous motion
for this custom marker. Native product frames are in the
[iOS tracker gallery](../../assets/comps/latest/travel-tracker/ios/README.md).

Android QPR2 promotion methods require compile SDK 36.1 and a runtime full-SDK
36.1 guard. `ProgressStyle` itself works from API 36.0. The repository already
uses AGP 8.13.1, which supports the minor-SDK configuration. QPR2's first long
subtext clipped the offline timestamp: reserve that field for short provenance,
move ETA into the title/body, or choose an ordinary expanded template when the
required facts cannot fit. Android 16.0 itself was not captured by these probes.
[QPR2 SDK setup](https://developer.android.com/about/versions/16/qpr2/setup-sdk).

The later production-app capture exposed a further limit at font scale 1.3:
`ProgressStyle` ellipsized destination/arrival text even though accessibility
reported the full string. BigText with a stock determinate bar preserved all
facts at that scale and on Android 15 in both schemes. The ordinary collapsed
lock-screen template may omit the app-name field and truncate text; expanding
it can open the locked notification shade. Inspect actual pixels and preserve
collapsed evidence separately from the expanded content check.
The tested BigText renderer also discarded a final-arrival `StrikethroughSpan`
that remained present in notification extras. An explicit destination
cancellation label is required; span metadata is not visual evidence.

Do not use `setTimeoutAfter` to guarantee removal of a foreground-service
notification. Android 16's timeout handler passes `FLAG_FOREGROUND_SERVICE` in
the flags that prohibit cancellation. An unbounded countdown chronometer also
does not advance instruction text. Force-stop and Task Manager stop prevent
sticky restart until the user returns; deep sleep, OEM policy and battery use
need physical-device verification.
[NotificationManagerService](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/services/core/java/com/android/server/notification/NotificationManagerService.java),
[sticky service lifecycle](https://developer.android.com/reference/android/app/Service#START_STICKY).
