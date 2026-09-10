# Travel tracker — native calibration

Real system-rendered surfaces from the shipped clients, judged against the
composition in [ui.md](../../../../docs/contracts/ui.md): short prose with the
countdown emphasised in the sentence, one instruction with platform roles, the
change window or departure with provenance, destination and arrival fixed in
place, and a quiet proportional trip line with one marker.

- [Android notification cards](android/README.md): API 35 and 36.1, 390×844,
  default and enlarged text, both schemes. Reproduce with
  `tools/shoot-travel-tracker-android.sh`.
- [iOS Live Activity surfaces](ios/README.md): iPhone 17 Pro, iOS 26.4,
  402×874, default text, both appearances, plus compact and expanded Dynamic
  Island. Reproduce with `tools/shoot-travel-tracker-ios.sh`.

The fixture journey is Mascot 04:38 → Central 04:49 on Platform 21 → M1 04:56
from Platform 26 → Kellyville 05:46 on Platform 2, reviewed at 04:44, 04:52 and
05:39. Stress cases remove the final platform, tighten the change to 04:53,
retain the 04:44 state offline with a 04:42 update, break the connection, cancel
a leg, or substitute long station names purely to test fit. They are timetable
states, not physical tracking.

Verification limits accepted at closeout are recorded in
[android-deviations](../../../../docs/contracts/android-deviations.md#persistent-travel-tracker)
and [ios-deviations](../../../../docs/contracts/ios-deviations.md#persistent-travel-tracker).
