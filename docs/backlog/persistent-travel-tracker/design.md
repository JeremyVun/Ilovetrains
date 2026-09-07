# Persistent travel tracker

Status: design exploration, opened 2026-09-08. Round 1 needs rework; C1 is the
closest starting point. Round 2 explores stage-specific usefulness. Implementation
is not ready to start. Write the phased
`build_plan.md` after the composition and lifecycle decisions below are settled.

## Owner intent

1. “When you order something on uber, it shows some kind of progress tracker
   in your notifications screen on your phone so you dont have to actually
   open up the app to see it.”
2. “That kind of widget for the ilovetrains app when the user is in travel mode.”
3. “Create the backlog item and do some design comps.”
4. “I said travel mode... it should feel magical the moment it detects you're
   travelling.” (2026-09-08 clarification.)
5. “It can also appear if you pin it, but that is something to a/b test as a
   nice to have follow up.” (2026-09-08 clarification.)
6. “Think about it from a user's perspective at each stage of the journey.
   What key piece of information do they need at each point?”
7. “If their next action is a transfer, they want to know what platform to
   get off and onto. If they have alighted, they want to know what platform
   to go to.”
8. “They probably also want to know how much time they have, and approximately
   when they'll get to their destination.”
9. “C1 is probably the closest, but it still needs a rethink about what would
   actually be usable for a user.”
10. “The visual trip line is nice, but it's also a bit thin.”
11. “It shouldnt change too much. i.e. the user should be able to scan it and
    understand the general pattern.”
12. “Giving directions as a narrative in standard short prose might also be
    a direction worth exploring more.”
13. “We already have some of those directions in the trip details screen if
    thats a comp you want to try out as well.”
14. “It might be worth also thinking about reusing the trip line and platform
    numbers we already have. Anyway, I leave it to you to explore some comps.”

The roadmap recorded the original request on 2026-09-07. This item makes it
an active design workspace. The outcome is the next useful travel instruction,
arrival and progress visible outside the native app.

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

## Proposed behavior to evaluate

Entry is owner-approved. The remaining rows are recommendations for this round.

| Situation | Proposed behavior |
| --- | --- |
| Entry (owner-approved) | Appear immediately when existing travel mode automatically detects travel, with no extra tap. Respect OS permission. Pin-triggered entry is deferred to a follow-up A/B test. |
| Riding before a change | Show change station, time until alighting, and BOTH the alighting and onward boarding platforms with explicit roles. Keep destination and estimated arrival visible. |
| Changing | Lead with the platform to go to, onward line and time until its departure; keep destination arrival visible. Distinguish this deadline from time until alighting. Never imply observed alighting from clock time alone. |
| Final leg | Lead with get-off station and time remaining; keep final arrival readable. |
| Offline or stale | Retain observed times with honest provenance. A stopped app must not leave “live” on screen indefinitely. |
| Disruption | Keep the focused service identity and cancellation visible. Do not silently switch the tracker to an unchosen train. Coordinate with focused-journey disruption recovery. |
| Tap | Open the matching focused journey without selecting a different service or trip. |
| Dismiss | Hide this journey's tracker and suppress automatic recreation for the same focus; preserve in-app focus and history. Explicitly restarting it is a separate action. |
| Completion | End active tracking when the client completes or replaces focus. Clock-based arrival must not claim observed arrival. Retention of a final summary remains open. |

The instruction for an inferred journey must carry the same honesty and
correction affordance as in-app travel mode.
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
Before a build plan, prove what each OS can update while the app is suspended
or terminated. Design the no-update state at the same time as the ideal state.
On iOS, investigate system timers and `staleDate` for a readable fallback;
do not promise punctual refresh or automatic phase changes from background tasks.
On Android, verify a justified execution mechanism and notification fallback
without acquiring location simply to keep a service alive. The selected design
must be useful through a whole trip, not only while the app stays open.

## Round 1

Workshop: `/tmp/ilovetrains-persistent-travel-tracker-r1/`.
Contact sheet: `index.html`; report: `OPTIONS.md`. These are disposable
exploration assets. Current exemplars in `assets/comps/latest/` remain the
calibration authority until the owner chooses a new direction.

Round output: three directions, 216 browser captures across the standard
frames/schemes and nine states per platform; separate visible-provenance
checks cover the corrected iOS degraded states. Android `ProgressStyle`
captures show all three text hierarchies through the real API 36 notification
renderer in dark and light. An isolated ActivityKit probe rendered a lock-screen
activity and compact Dynamic Island on iOS 26.4. The probe is feasibility
evidence, not an exact native rendering of all three iOS concepts. Its timers
are shifted to capture time while its arrival label stays at the fixture's
10:08; do not judge clock consistency or final copy from that probe.
Native evidence lives under `native-evidence/` and `native/ios-probe/` in the
workshop; the latter's `REPORT.md` records its limits. Real phone background
behavior remains unverified.

Brief: three distinct compositions answering every owner intent, including
one more adventurous direction. Inherit actual product CSS and captured
journeys; declare every synthetic timestamp or disruption delta. Compare
next-action emphasis, destination-arrival emphasis and whole-trip progress.

Directions: `c1-action` (Action first), `c2-route` (Route first), `c3-now`
(Only now). The initial review favours Action first because the next instruction
and its countdown read together; this is a recommendation, not a verdict.

Review constraints: iOS lock-screen/expanded content must fit the documented
160-point height budget; compact regions must respect camera space. Earlier
taller browser illustrations are not native layout evidence. Every compact
station/time pair must refer to the same event (Central in five minutes cannot
be labelled Kellyville). Progress segments must match the fixture's durations.
Do not hide stale/offline provenance to make the card shorter. Android's actual
renderer truncated the original long header; a short destination/arrival header
keeps `Kellyville · Arrive 05:46` visible. The round-1 compromise of hiding the
onward platform until the change phase is superseded by the owner verdict:
both platforms must be available while approaching the transfer.

Capture at 390×844 and 412×732, dark and light. Cover automatic entry,
on-train, change, final get-off, stale/offline, cancelled and longest names;
include compact and expanded system presentations. Real OS screenshots are
required before a platform visual verdict. Label any unverified illustration
as such. The comp agent must inspect every shot and make a second pass.
Any pre-departure/pin-start comp is explicitly a follow-up experiment, not the
initial flow.

Owner verdict, 2026-09-08: “Good first effort. I don't think they really work
though.” C1 is closest, but needs a rethink around what the rider needs at each
stage. The visual trip line is liked but too thin. Carry forward C1's explicit
instruction and the trip line; reject instructions that do not answer the
current stage, omitting the onward platform before a transfer, and the hairline treatment.
The composition is not approved.

Behavior ruling during round 1: “I said travel mode... it should feel magical
the moment it detects you're travelling.” Automatic entry carries forward into
every direction. Pinned-only entry is refused; there is no extra confirmation
step after detection.

Follow-up ruling in the same round: “It can also appear if you pin it, but
that is something to a/b test as a nice to have follow up.” Pin-triggered entry
is deferred. Do not introduce a new flag, experiment assignment or analytics
event in this design round. Define that experiment separately after the
automatic tracker has a usable baseline.

## Round 2: what the rider needs now

Workshop: `/tmp/ilovetrains-persistent-travel-tracker-r2/`, inheriting round 1.
Use round-1 C1 as the comparison image, not as an approved final layout.
Owner spec is items 6–14 above; every variation must answer all of them.

Keep the visual scaffold stable across stages. The user should learn once
where to find the instruction, its time, the destination arrival and the trip
line. Change content and emphasis inside those areas, not the general layout.
Explore short natural prose as well as structured C1. Reuse the actual
trip-details directions and their visual/copy conventions for one variation;
the existing detail screen is source material, not just inspiration.
Explore the existing integrated trip line and platform numbers directly in
the detail-derived variation, rather than merely adding a generic thicker bar.
The owner leaves the composition choices to this round's exploration.

Show one continuous Mascot → Central → Kellyville trip through its stages so
the owner can judge the change in emphasis without mentally changing trips.
The existing seeded schedule is 04:38 departure, Central arrival 04:49 on
Platform 21, M1 departure 04:56 from Platform 26, Kellyville arrival 05:46.
Review clocks below are declared fixture states, not live tracking evidence.

| Review state | Rider's question | Required information |
| --- | --- | --- |
| On train, 04:44 | Where do I change, and what happens there? | Central in 5 min; get off at Platform 21, board M1 from Platform 26; seven minutes between services; destination Kellyville, arrival about 05:46. |
| Transfer phase, 04:52 | Where do I go, and how much time have I got? | Go to Platform 26; M1 departs in 4 min at 04:56; Kellyville arrival about 05:46. Completed alighting information becomes secondary or disappears. |
| Final leg, 05:39 | When and where do I get off? | Kellyville in 7 min, Platform 2, arrival about 05:46; no obsolete Central transfer instruction. Unknown-platform stress must omit invented numbers. |

Time-based stage changes are existing travel-mode semantics; they do not prove
physical alighting or boarding. Copy must give the useful instruction without
claiming a location observation. A cancelled or stale journey must not silently
advance into confident directions. A transfer deadline is time until departure,
not a guarantee that walking between platforms will take that long.

Source seams: `web/js/detail.js`'s `actHtml` pairs an alighting platform chip
and `Get off` with an onward platform chip and boarding instruction.
`web/js/journey.js`'s `stepsOf` supplies both platforms and the change window.
`web/js/focus.js`'s `directionsModel` already distinguishes riding (count to
alighting) from dwelling (count to onward departure). Reuse those facts, while
making the countdown's event clear in the tracker. The existing shared
`TO CHANGE` label alone does not distinguish those two meanings.

The line must be visibly stronger and communicate journey structure, active
leg and transfer. Preserve true time proportions; make station/platform labels
readable without distorting a short leg. Compare its old/new thickness at native
scale and with a 4× detail, not only in a large contact-sheet thumbnail.

Build three variations of this stage-aware C1 approach: structured, short
prose, and a hybrid drawing on trip-details directions. These are exploration
briefs, not dictated layouts. Keep each variation's pattern stable as its
content advances. Keep the selection sheet focused on the
three stages and the relevant stress cases. Reuse the native scratch projects
and render the revised Android stage sequence through the actual OS; do not
hide a platform in truncated subtext to satisfy a browser mockup. iOS content
still has a 160-point height budget and real camera-split compact regions.

Round-2 visual verdict: pending.

## Decisions still needed

1. Composition: owner verdict on round 2 after viewing the system-rendered
   evidence. Recommendations and native rendering limits belong in `OPTIONS.md`.
2. Background execution: engineering evidence for refresh, timed phase changes,
   staleness and completion on both platforms. If the native limits change the
   promise, return to the owner with the concrete fallback.
3. Dismissal/restart controls, completion summary and lock-screen
   privacy treatment. Resolve with the chosen composition before planning.

## Build acceptance inputs

After design approval, phase the build around pure presentation state,
platform integration and independent real-device verification. Verify focus
replacement, late async updates, dismissal persistence, denied permissions,
offline/retained delays, cancellation, transfer boundaries, arrival, midnight,
process death/relaunch and long trips. Include Android promotion denied/older-OS
fallback, iOS stale content, compact/minimal Dynamic Island, large text,
VoiceOver/TalkBack and both schemes. Simulator render evidence does not prove
background delivery reliability or physical-device power behavior.

Update affected contracts and project generation tooling with implementation;
do not amend shipped behavior contracts for these exploratory proposals.
After shipping, migrate surviving rules, delete this folder and deploy using
the operations runbook.
