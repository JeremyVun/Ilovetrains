# Public website calibration

Real browser frames of the packaged website at 390×844 dark and 1440×900
light: landing, header detail, the F1 in-app tracker, the iPhone Live
Activity stage, privacy and support. `sleepers-springboard.png` is the real
iOS SpringBoard rendering of the Sleepers icon. The packaged site and the
public origin are judged against these frames; rules live in
`docs/contracts/app-website.md`.

The app screenshots inside the frames are complete 1206×2622 iOS simulator
captures with fixed example clocks. The Live Activity screen is one real
ActivityKit Notification Center capture reused in both schemes; its lock
screen reads “Sat 1 Jan” because CoreSimulator's time override does not
composite the date. No screenshot pixels were repainted.
