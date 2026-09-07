# Native travel surfaces

Checked 2026-09-08 against the official sources below. These are platform
constraints for the persistent travel tracker, not a settled product design.

## Android

`Notification.ProgressStyle` arrived with Android 16. Points and segments
can represent milestones and durations. Title, content text, subtext,
progress and actions are system-template fields; do not assume arbitrary
Compose layout in the notification.
[Progress-centric notifications](https://developer.android.com/develop/ui/compose/notifications/progress-centric).

For the thicker-line comp, test `ProgressStyle.setStyledByProgress(false)`.
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
