# Android tracker — native calibration

These are real Android system notification cards, reviewed on 2026-09-08.
Each PNG is cropped to the notification row's observed accessibility bounds;
no product text or geometry is altered. The folder name records API version,
logical phone size and font scale. `device.txt` records the actual emulator.

| Capture set | States, in both schemes |
| --- | --- |
| [API 36.1, 390×844, default text](36.1-390x844-1.0/) | Ride, transfer, final cancellation |
| [API 36.1, 390×844, enlarged text](36.1-390x844-1.3/) | Ride, long name, missed connection |
| [API 35, 390×844, default text](35-390x844-1.0/) | Ride, offline, long name, missed connection |

Enlarged text and Android 15 use BigText with a stock determinate progress bar.
The missed-connection card omits the bar and labels arrival `Planned`. Expanded
cards preserve the platform roles, event/change clocks, destination arrival and
source timestamp. System-controlled collapsed presentations contain fewer facts.

Reproduce with [the tracker shooter](../../../../../tools/README.md), selecting
the recorded size/font/OS and cases. Its full output retains the original phone
frame, collapsed companion where offered, and System UI/notification dumps.
Fixed fixture clocks make captures repeatable; separate lifecycle tests use real
wall time. These images do not prove physical-device delivery or power behavior.
