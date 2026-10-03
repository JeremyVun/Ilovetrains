# iOS C1, arrival and cab

Built SwiftUI calibration at 402×874 pt, iOS 26.4, in both schemes. The two
`commute-after-large` frames use the system's `accessibility-medium` content
size. Journey clocks and overdue evidence are declared Debug fixtures;
system status-bar time does not represent the fixture clock.

These frames predate the trip-control line: their status still reads
`PINNED` and they carry no `■ STOP TRIP` line, so they calibrate the C1
progress line only. The overdue state is the `home-checking-arrival`
visual-regression baseline (iOS state `home-commute-checking`).

Reproduce with `tools/shoot-ios.sh`, passing `commute-before`,
`commute-during`, `commute-after`, `settings-direct-only` and their `-light`
variants as positional arguments. Set `CONTENT_SIZE=accessibility-medium` for the
large pair, select the owned simulator, and write `OUT` to a temporary path.
The complete reduced-motion train comes from `TinyTrainVisualTests`; both
filled terminal cabs and all sixteen paired passenger doorways must fit.
