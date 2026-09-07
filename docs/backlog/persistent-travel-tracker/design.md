# Persistent travel tracker

Status: **visual design accepted, 2026-09-08**. Build continues in a fresh
session using [build_plan.md](build_plan.md), starting with native lifecycle
and background execution evidence. No product implementation shipped here.
The accepted layout does not need another concept-selection round.

## Accepted design and owner ruling

The baseline is **round 4: Option 1, short prose with the quiet trip line**.

Owner: “im happy with this. id like to see what the line looks like with the
platform number boxes on it in keeping with the apps visual language, but
this is ok for now. can you update the docs please. i'll be continuing the
build in another session.”

**Platform-number boxes on the line are an optional visual follow-up.** The
owner wants to see that variation, but accepts the current line without them.
It is not a build prerequisite or an instruction to add boxes unreviewed.
Use the app's existing platform caps if exploring it, and preserve the calm
sentence hierarchy. Do not revive the rejected crowded card.

The accepted frames and reproduction source are in the repository, so the
next session does not depend on `/tmp`:

- [Selected calibration frames](../../../assets/comps/latest/travel-tracker/README.md)
  — all 28 accepted-composition frames, with the three journey stages first.
- [Frozen comp source](../../../tools/comps/persistent-travel-tracker/README.md)
  — reproduces the selected design using the existing comp harness.
- [Native constraints and evidence](../../references/native-travel-surfaces.md).

### Composition to build against

1. A short headline states the next event, with the countdown emphasized
   inside the sentence. It is not a detached number with several labels.
2. One smaller instruction gives platform roles. Emphasize the numbers in
   the text; before a transfer both the alighting and boarding platform matter.
3. The change window or onward departure follows. When offline, last-update
   provenance shares this row without replacing the numeric countdown.
4. Destination at left and approximate arrival at right stay in the same place.
5. A quiet proportional trip line sits underneath, with one progress marker.
   The accepted baseline has no platform boxes or additional line labels.

No added app/status header, repeated platform graphics, or caption stacks.
Maintain the same reading pattern through stage changes. The OS owns its
container; the illustrated lock-screen clock and wallpaper are not product UI.

The browser reference is 160 pt high, including the line and offline text,
versus 152 pt before adding the line. Its line is 7 pt high with an 11 pt
marker. Horizontal content insets are 20 pt; headline 23 pt, directions 15 pt,
connection 11 pt, arrival 12 pt, offline provenance 10 pt. Use the frozen CSS
and pixels for the remaining spacing/colour details. These are reference
measurements, not permission to clip large text or override Android's template.

### Journey stages and exact review fixture

Source: the Mascot seed in `tools/shoot-states.js`, transcribed from the
existing owner exemplar. Mascot departs 04:38; Central arrival is 04:49 on
Platform 21; M1 towards Tallawong departs Central 04:56 from Platform 26;
Kellyville arrival is 05:46 on Platform 2. The trip line is 11 / 7 / 50 minutes.
Review clocks are synthetic, not live position observations.

| Stage | Headline | Instruction and timing | Persistent arrival |
| --- | --- | --- | --- |
| Riding, 04:44 | Central in **5 min.** | Get off on Platform **21**, then take M1 from Platform **26**. 7 min to change. | Kellyville · about 05:46 |
| Transfer, 04:52 | M1 leaves in **4 min.** | Go to **Platform 26** for Tallawong. Departs 04:56. | Kellyville · about 05:46 |
| Final leg, 05:39 | Kellyville in **7 min.** | Get off on **Platform 2**. | Kellyville · about 05:46 |

Progress fractions are 6/68, 14/68 and 61/68. Timetable stage changes must not
claim the phone observed boarding/alighting. The transfer interval is time
between services, not a promise about walking time. Derive real content from
the focused journey; the comp's hardcoded numbers and T8/M1 colours are fixtures.

Accepted stress treatments: unknown platform names the get-off destination
without inventing a number; a tight transfer highlights the departure deadline;
offline retains the numeric countdown, both platforms, change window and ETA
with `Offline · Last updated 04:42`. The long-name fit case substitutes Bondi
Junction only; it is not a real alternative route. The tight fixture advances
M1 departure to 04:53 (11 / 4 / 53); it is a rendering stress, not new routing policy.

## Scope and inherited rules

**Owner ruling, 2026-09-08:** automatic travel-mode detection starts the tracker
immediately, with no extra tap. A pinned-only first version was rejected.
Automatic inferred travel mode is the initial trigger. Starting the tracker
from a pin is an optional follow-up A/B test, not part of the initial feature.
OS promotion eligibility must be solved around this requirement; it does not
narrow the entry behavior.
This uses existing travel-mode detection, not a new background GPS detector.

Android notification drawer and lock screen, with Live Updates where supported;
iOS Live Activity on the lock screen and in the Dynamic Island. Ordinary
Android notifications must remain useful when promotion is unavailable.
Home-screen widgets, new background ride detection and the web PWA are separate
work. This native-only system surface uses the web header as its design reference.

- Travel mode remains the existing focused journey. Browsing a different board
  does not change the tracked service. A replacement focus replaces the tracker.
- The server remains stateless; location, saved trips, focus, history and rides
  stay on the device. No push-token registration or per-person journey service
  is included in this design. Any such proposal needs a separate owner ruling.
- Progress is inferred from timetable and retained/live estimates. It is not
  observed vehicle position or continuous GPS. Do not invent intermediate stop
  counts, a moving map position, or confirmation that the person boarded.
- Preserve the chosen service and last-known delays through lost connectivity.
  Never reset a delayed arrival to the earlier schedule merely because it expired.
- Existing future countdowns remain numerical, including offline/retained
  observations; provenance accompanies the number. The 2026-09-08 ruling in
  [native-data.md](../../contracts/native-data.md#cached-boards-and-departed-services)
  applies. An OS-specific exception must be an explicit design decision.
- Explicit pins may be unpinned. Inferred focus has `Change destination`, not
  a new unpin or “not on it” action. Hiding a tracker is distinct from changing
  focus or recording a ride.
- Use the current station/line/platform vocabulary, house colours and hierarchy.
  System templates own their actual layout and typography. Both schemes and
  large text must remain legible; colour is never the only state cue.

Binding references: [product](../../PROJECT.md), [UI](../../contracts/ui.md),
[focus and travel mode](../../contracts/client-storage.md#travel-mode),
[native data](../../contracts/native-data.md),
[API](../../contracts/api.md), [Android deviations](../../contracts/android-deviations.md)
and [iOS deviations](../../contracts/ios-deviations.md).

## Existing implementation seams

Checked 2026-09-08:

- Android `Storage.kt` and iOS `Core/DeviceStore.swift` persist `FocusedJourney`
  with trip, direction, selected journey, board, explicit `pinned` flag and
  optional alternatives. Reuse that identity; a tracker is not another route planner.
- `TrainViewModel.resume()` on both clients advances the clock and refreshes
  foreground data. `pause()` cancels the loop and pending refresh publication.
  A persistent notification alone does not create background execution.
- `Models.kt` / `Core/TransitModels.swift` implement `BoardData.isLive`: live
  source, no offline/stale flags and observation age between zero and 90 seconds.
  New presentation code must use source freshness, not notification-posting time.
- The Android manifest has no notification permission/service declaration.
  The iOS app has no ActivityKit integration or widget extension. This is new
  platform integration, not exposure of an existing hidden tracker.

## Behavior and lifecycle defaults

Entry and the stage information hierarchy are owner-approved. The lifecycle
defaults below need engineering validation in Phase 0; they are not additional
visual approval requirements.

| Situation | Proposed behavior |
| --- | --- |
| Entry (owner-approved) | Appear immediately when existing travel mode automatically detects travel, with no extra tap. Respect OS permission. Pin-triggered entry is deferred to a follow-up A/B test. |
| Riding before a change | Show change station, time until alighting, and BOTH the alighting and onward boarding platforms with explicit roles. Keep destination and estimated arrival visible. |
| Changing | Headline names the onward departure deadline; the instruction names the platform to go to and direction. Keep destination arrival visible. Distinguish this deadline from time until alighting. Never imply observed alighting from clock time alone. |
| Final leg | Lead with get-off station and time remaining; keep final arrival readable. |
| Offline or stale | Retain observed times with honest provenance. A stopped app must not leave “live” on screen indefinitely. |
| Disruption | Keep the focused service identity and cancellation visible. Do not silently switch the tracker to an unchosen train. Coordinate with focused-journey disruption recovery. |
| Tap | Open the matching focused journey without selecting a different service or trip. |
| Dismiss | Hide this journey's tracker and suppress automatic recreation for the same focus; preserve in-app focus and history. Explicitly restarting it is a separate action. |
| Completion | End active tracking when the client completes or replaces focus. Clock-based arrival must not claim observed arrival. Retention of a final summary remains open. |

The instruction for an inferred journey must carry the same honesty as in-app
travel mode. Tapping reaches that focus and its existing destination-correction
affordance; the accepted card does not add an inline correction button.
Permission denial must not break in-app travel mode or repeatedly prompt.

## Background behavior is a design constraint

Platform research is in [native travel surfaces](../../references/native-travel-surfaces.md).
Android's promoted template is constrained; iOS permits custom SwiftUI content
but the Live Activity cannot fetch fresh transport data itself.

The engineering spike must distinguish an OS-rendered countdown from new
content. Ticking a timer does not advance the active leg, discover cancellation,
refresh platform assignments or end an activity. An arbitrary SwiftUI `Date.now`
condition is not evidence of reliable background phase transitions.

Proposed first implementation uses existing public data and device-local state.
In Phase 0, prove what each OS can update while the app is suspended
or terminated. Design the no-update state at the same time as the ideal state.
On iOS, investigate system timers and `staleDate` for a readable fallback;
do not promise punctual refresh or automatic phase changes from background tasks.
On Android, verify a justified execution mechanism and notification fallback
without acquiring location simply to keep a service alive. The selected design
must be useful through a whole trip, not only while the app stays open.

## Evidence and limits for the next session

All 28 browser frames passed viewport, text spill, clipping, text-range overlap
and proportional-axis checks: seven scenarios × two phone sizes (390 × 844,
412 × 732) × dark/light. Every card is 160 pt; segment deviation is 0.0 px.
Primary/secondary text contrast is 14.46/7.25 in dark and 17.76/6.45 in light.
The selected matrix does not prove arbitrary long names, multiple transfers,
large accessibility text, native layout, animation or background delivery.
Restate each discovered comp defect as a build test: overlapping instruction/
footer, lost offline provenance, ambiguous timer event, and truncated platform
or destination facts must not recur.

Android API 36.1 rendered a prior structured three-stage sequence containing
both transfer platforms, change time and ETA. `setStyledByProgress(false)`
produced filled segments with a visible point at the supplied progress.
Standard progress points cannot contain platform-number labels. Native text
had one subtext, title and body line, requiring shorter copy than the iOS comp.
This establishes template constraints, not native pixels for accepted Option 1.
A promotion request was observed; granted promotion was not independently proved.

The selected Option 1 SwiftUI scratch built, installed and launched on an
isolated iOS 26.4 simulator. The lock-screen capture attempt hit a black
framebuffer despite accessible lock-screen controls, and stopped after five
minutes. **No reviewable native screenshot of accepted Option 1 exists.** Earlier
rounds proved ActivityKit lock-screen/compact feasibility, not this composition.
The scratch also used static clocks/progress, so it proves no ticking or phase
updates. Retry in Phase 0 on a working simulator or phone; retain the accepted
visual direction while verifying the actual OS constraints.

Optional scratch locations (not required to understand or start the build):
`/tmp/ilovetrains-persistent-travel-tracker-r4/native/ios-probe/`, its
`native-evidence/NATIVE-NOTES.md`, and round 2's `native-evidence/ANDROID-REPORT.md`.
Do not copy probe-only `INFERRED FROM TIMETABLE` or `LIVE` rows into the design.
No rejected/black diagnostic image is promoted to calibration.

## Decisions and work carried into the build

The owner accepted the visual baseline and automatic entry. The native
background mechanism is unresolved engineering work, not a reason to repeat
visual exploration. Start with Phase 0 of the plan and document evidence for
refresh, phase changes, stale boundaries, completion and process death.

The lifecycle table above records recommended defaults, not separate owner
rulings. Verify permission timing, dismissal/restart suppression, final-summary
retention and lock-screen privacy behavior against real OS capabilities.
Resolve ordinary implementation details within the existing scope. Return a
concrete fallback for an owner decision only if native limits would materially
change the promise or require an exception to a binding contract.

Two independent follow-ups remain optional:

- Explore platform-number boxes on the trip line in the app's visual language;
  keep the accepted unboxed line until that variant has a verdict.
- A/B test pin-triggered entry later. Automatic travel-mode entry is the baseline;
  no flag or experiment assignment was added in this design session.

## Owner decision record

| Date / round | Ruling and effect |
| --- | --- |
| 2026-09-08 / entry | “It should feel magical the moment it detects you're travelling.” Reject pinned-only entry and extra confirmation taps. |
| 2026-09-08 / follow-up | Pin entry is “something to a/b test as a nice to have follow up.” Defer it. |
| 2026-09-08 / round 1 | “I don't think they really work”; C1 closest. Show stage-specific platform roles, time available and destination ETA; strengthen the thin trip line. |
| 2026-09-08 / refinement | “It shouldnt change too much”; explore short prose and existing trip-details directions/line/platform vocabulary. Preserve the scan pattern across stages. |
| 2026-09-08 / round 2 | “Its so cluttered... redesign it from the ground up”; seek a “minimalistic, modern, enjoyable” tracker. Reject repeated platform rows/markers and competing labels. |
| 2026-09-08 / round 3 | “Option 1 is fantastic. much better. Would love to see the trip line on it as well.” Choose the sentence composition and add the line. |
| 2026-09-08 / round 4 | “im happy with this” / “this is ok for now.” Accept Option 1 plus line; platform boxes are a non-blocking visual follow-up. Continue the build in another session. |

Rounds 1–4 lived in `/tmp/ilovetrains-persistent-travel-tracker-r{1,2,3,4}/`.
Only the accepted round-4 composition is preserved as repository calibration.
Rejected concepts are history, not alternative build specifications.

## Closeout boundary

This session records the design and build handoff only. With implementation,
update API/storage/UI/analytics/native contracts where behavior changes, add
native capture tooling and regression baselines, and run the relevant gates.
After shipping, migrate surviving rules, delete this backlog folder and deploy
using the operations runbook. Do not close or deploy this unbuilt feature now.
