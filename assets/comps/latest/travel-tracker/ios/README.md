# iOS tracker — native captures

[Open the screenshot gallery](index.html). Each card links to its unchanged
full system frame; card crops use bounds reported by XCTest and preserve all
tracker content. These are actual ActivityKit surfaces from the implemented
app, using the accepted fixed-clock journey fixtures.

Current default-text frames cover all ten states in both simulator appearances.
Enlarged-text verification remains open: the simulator publishes an activity
but exposes an invisible host instead of the tracker card. Notification Center frames are labelled as such; they do not
claim a locked-device drive. The system uses a dark activity surface in both
simulator appearances.

- Device: iPhone 17 Pro, iOS 26.4, 402×874 points / 1206×2622 pixels.
- Every card carries the worded `■ Stop trip` capsule at the end of its
  headline row; the long-content headline scales on its one line beside it.
  The expanded Island carries the round `stop.fill` button inward of the
  countdown, in [dark](26.4-402x874-default/tracker-ride-dark-island-expanded.png)
  and [light](26.4-402x874-default/tracker-ride-light-island-expanded.png)
  appearance, with every row where it was before the button. The
  [compact Dynamic Island](26.4-402x874-default/tracker-ride-dark-island-compact.png)
  has no button. All recaptured on 2026-10-03 with `CAPTURE_ONLY=1`.
- Actual locked-screen rendering was separately observed during integration.
  Its earlier frames preceded the final always-visible source time and are not
  retained as current calibration.

Separate wall-clock tests observed timer advancement and clamping with the app
absent, same-activity recovery, foreground transfer publication and removal.
The marker shows the last published timetable position. Instructions do not
advance without app execution; source time remains visible from publication.
Cold-tap routing is verified by the UI suite on a fresh simulator. The
390-point phone drive, enlarged-text rendering, minimal
Island and actual VoiceOver traversal remain unverified. Simulator captures do not establish physical-device delivery or
power use.
