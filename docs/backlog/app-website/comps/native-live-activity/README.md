# iPhone Live Activity material

The two website PNGs are byte-identical copies of a complete 1206×2622 native
ActivityKit Notification Center screenshot, captured on an owned iPhone 17 Pro
iOS 26.4 simulator. The system appearance is reused in both website schemes.
No screenshot pixels were cropped, repainted or composited.

`route.json` records the verified TfNSW timetable example and fixed preview
clock. It shows Chatswood → Bondi Junction with the M1/T4 change at Martin
Place, platform 3 to platform 2, and arrival at 08:45. The native renderer
shows 4 minutes to Martin Place and 5 minutes to change; keep its rounding.

Source: `/tmp/trains-comps-site-r9/native-live-activity/final-clean-2/`.
The scratch-only `r9-transfer` fixture passed
`TravelTrackerFlowTests/testCaptureSystemSurfaces`. Production native files
were not modified for this capture. Unrelated notifications were cleared
through real system controls. Reproduction details accompany the capture.

CoreSimulator limitation: the 08:28 system time override leaves the visual
date as “Sat 1 Jan”, while accessibility reports the actual device date.
This is a named fixture artifact, not a claim that the website shows live
travel data. A production recapture may use the unmodified system clock.
Do not repaint the date or describe this Notification Center evidence as
proof of an actually locked device or continuous background instruction updates.
