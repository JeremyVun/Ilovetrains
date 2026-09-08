# Travel tracker — accepted visual target

Reviewed Android implementation cards are in [native calibration](android/README.md).
Initial real iOS lock-screen and Dynamic Island frames are in
[iOS native captures](ios/README.md); its full verification is still in progress.
The browser illustrations below are the approved iOS visual target. Native
ActivityKit integration is in progress under the owner continuation.

Owner accepted round-4 Option 1 with the quiet trip line on 2026-09-08.
These are **browser illustrations of the intended native surface**, not
screenshots of a shipped client or proof of background updates. Platform boxes
on the line are a requested, non-blocking follow-up; they are not in this baseline.

[Design and build handoff](../../../../docs/backlog/persistent-travel-tracker/design.md)
· [Reproduction source](../../../../tools/comps/persistent-travel-tracker/README.md).
The build is judged against these pixels. Preserve the plain sentence hierarchy,
platform roles, arrival anchor and quiet proportional line; replace these
illustrations with native capture exemplars when the implementation is verified.

All images are unchanged 2× PNGs: 780 × 1688 or 824 × 1464 pixels. The card is
160 pt high; the 7 pt line and 11 pt marker fit inside it. The wallpaper/clock
are illustrative system context, not app-owned UI. Dark is the unsuffixed file.

## Selected stages and stress cases

| State | 390 × 844 dark | 390 × 844 light | 412 × 732 dark | 412 × 732 light |
| --- | --- | --- | --- | --- |
| Before the change | [View](c1-sentence-390x844-ontrain.png) | [View](c1-sentence-390x844-ontrain-light.png) | [View](c1-sentence-412x732-ontrain.png) | [View](c1-sentence-412x732-ontrain-light.png) |
| Changing | [View](c1-sentence-390x844-transfer.png) | [View](c1-sentence-390x844-transfer-light.png) | [View](c1-sentence-412x732-transfer.png) | [View](c1-sentence-412x732-transfer-light.png) |
| Final leg | [View](c1-sentence-390x844-final.png) | [View](c1-sentence-390x844-final-light.png) | [View](c1-sentence-412x732-final.png) | [View](c1-sentence-412x732-final-light.png) |
| Offline / last update | [View](c1-sentence-390x844-offline-stale.png) | [View](c1-sentence-390x844-offline-stale-light.png) | [View](c1-sentence-412x732-offline-stale.png) | [View](c1-sentence-412x732-offline-stale-light.png) |
| Unknown platform | [View](c1-sentence-390x844-unknown-platform.png) | [View](c1-sentence-390x844-unknown-platform-light.png) | [View](c1-sentence-412x732-unknown-platform.png) | [View](c1-sentence-412x732-unknown-platform-light.png) |
| Tight transfer | [View](c1-sentence-390x844-tight-transfer.png) | [View](c1-sentence-390x844-tight-transfer-light.png) | [View](c1-sentence-412x732-tight-transfer.png) | [View](c1-sentence-412x732-tight-transfer-light.png) |
| Long-name fit | [View](c1-sentence-390x844-long-content.png) | [View](c1-sentence-390x844-long-content-light.png) | [View](c1-sentence-412x732-long-content.png) | [View](c1-sentence-412x732-long-content-light.png) |

## Review data and limits

The current Mascot seed in `tools/shoot-states.js` supplies the schedule:
04:38 → Central 04:49 on Platform 21 → M1 at 04:56 on Platform 26 → Kellyville
05:46 on Platform 2. Review clocks 04:44, 04:52 and 05:39 give line fractions
6/68, 14/68 and 61/68. They are inferred timetable states, not physical tracking.

Declared stresses remove the final platform; move M1 departure to 04:53
(11/4/53-minute segments); retain the 04:44 state offline with a 04:42 update;
or substitute Bondi Junction solely to test text fit. The synthetic long-name
and tight fixtures do not describe a real alternative route.

All 28 browser frames passed geometry, text overlap and clipping checks; segment
deviation was 0.0 px. This does not cover every legal name, accessibility size,
number of transfers or system presentation. The original selected SwiftUI
scratch built and launched, but its lock-screen framebuffer was black. Later
native probes are recorded in
[platform evidence](../../../../docs/references/native-travel-surfaces.md);
they do not turn these browser illustrations into implementation screenshots.
Actual Android cards are indexed separately above. iOS product integration
and real-client verification are in progress; the accepted layout is settled.
