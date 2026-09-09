# R9 transfer ActivityKit capture

`tracker-r9-transfer-dark-notification-center.png` is an unedited, complete
1206×2622 screenshot from the owned `Codex-r9-activity-47800` iPhone 17 Pro
simulator on iOS 26.4. The UI test exported the real Notification Center system
surface at 402×874 points (3×).

The scratch fixture was based on the repository iOS source and changed only the
files recorded in the three adjacent patch files. Apply those patches to an
isolated copy, boot an owned 402×874 simulator, clear unrelated system
notifications with a real Notification Center swipe, then run:

```sh
ILOVETRAINS_SIMULATOR_ID="$OWNED_SIMULATOR_ID" \
ILOVETRAINS_IOS_BUILD_DIR=/tmp/trains-r9-native-capture/build \
OUT=/tmp/trains-comps-site-r9/native-live-activity/final-clean-2 \
TRACKER_CASES=r9-transfer SCHEMES=dark SURFACES=notification-center \
CAPTURE_ONLY=1 tools/shoot-travel-tracker-ios.sh 402x874
```

The route data comes from `chatswood-bondi-transfer.json`: Chatswood platform 2
to Martin Place platform 3 on M1, then Martin Place platform 2 to Bondi Junction
platform 1 on T4. The frame shows 08:28, a four-minute countdown, a five-minute
transfer label, and an 08:45 arrival.

CoreSimulator accepts the full ISO presentation override
`2026-09-10T08:28:00.000+10:00`, but iOS 26.4 composites the lock-screen date as
`Sat 1 Jan`. The accessibility hierarchy still reports the host semantic date
(`Thursday 10 September`) and host clock. This is a simulator presentation
limitation; the screenshot was not retouched.
