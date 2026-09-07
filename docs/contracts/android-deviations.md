# Android deviations

This file records deliberate differences between the native Android app and the web reference.

- System bars use Android edge-to-edge insets. The content starts below display cutouts and status icons and ends above gesture navigation rather than reproducing browser chrome or CSS safe-area behavior.
- Location permission is requested only after an explicit setup or Settings action. Both native apps follow the setup location flow in [ui.md](ui.md#setup-and-station-search), including progress, accuracy-aware station choices and retry (owner ruling, 2026-09-08, superseding the automatic first-launch prompt). Android records `locationAsked` only for a non-empty permission result. Permission is blocked only when absent, a request has returned an answer, and `shouldShowRequestPermissionRationale(ACCESS_COARSE_LOCATION)` is false. A soft refusal or dismissed prompt remains retryable. Blocked permission opens `ACTION_APPLICATION_DETAILS_SETTINGS`; disabled device location opens `ACTION_LOCATION_SOURCE_SETTINGS`. Returning from Settings resumes the pending setup lookup if permission is granted. A foreground lookup listens to enabled network and GPS providers, stops after a useful fix, and ends within 15 seconds. Approximate fixes get up to two seconds for a more accurate provider before offering station choices. No web footer permission panel or background tracking is used.
- Android system Back performs the same navigation as each visible back control. The Compose screens do not add a second browser-style history mechanism.
- Swiping a saved trip row towards the start edge deletes it: the Material dismiss pattern, uncovering Gmail's red (`#D93025`) with a white trash icon at the page margin, committing past half the row width or on a flick. The deletion is reversible for the undo window from the bottom message bar, which reads `{from} → {to} deleted` and whose label becomes `Undo`; the cached boards go when the window ends ([client-storage.md](client-storage.md#android-storage)). Long-pressing the row still opens a native menu with a separate `Delete trip` choice, equally undoable, and TalkBack exposes the same menu as `Trip actions`; the menu is the TalkBack and fallback path because the swipe is not exposed to accessibility services. The ordinary row stays visually identical to the web composition.
- Station search uses a native text field and keyboard action. Results and ranking remain local; the keyboard can resize the sheet rather than overlaying it as mobile browsers sometimes do.
- Offline timetable status and its manual update action appear as a quiet Settings row beside feedback and version. The web app's service worker has no corresponding packaged-timetable lifecycle.
- New offline journeys use the bundled timetable and conservative transfers within a station or wharf hub. Routes may differ from the online Trip Planner; cross-hub walks such as Wynyard–Barangaroo require the online fallback. Coverage gaps and realtime identity limits are recorded in [native-data.md](native-data.md).
- Native v1 leaves anonymous analytics counters off. This avoids mixing native renderer adoption and prediction behavior into the existing web-only experiment; functional feedback submission still works.
- Android stores user state in app-private atomic files and excludes it from cloud backup and device transfer. The native trip list is not capped at the web client’s ten-trip LRU, and each trip has the explicit native deletion menu described above.

## Feedback fixes — 2026-09-07

- Settings gives Use location, Home and Transfer limit 72dp minimum rows with 10dp vertical padding, where the web composition is 56px. Transfer limit uses that row without its icon column, so its title sits at the page margin. Service choices show only `On` or `Off`, without checkmarks, circles or underlines. Appearance keeps the selected checkmark, removes the underline and reserves the System subtitle's space in every option so previews and labels align.
- Home and board figures keep `Now` on one line, including enlarged Android text. They must fit their allocated column without clipping or invading the adjacent station/time columns.
- Line and platform chips are sized in text units: enlarged text grows the chip, and the small journey axis with it, rather than clipping the glyphs (owner bug report, 2026-09-07). The bottom message bar's deletion text may wrap to two lines at enlarged text so its verb survives.
- Journey lines have 3dp rounded corners at the destination end in Home, Board and Detail. Internal ride/transfer joins remain square so the time axis stays continuous (owner ruling, 2026-09-07).
- Successful feedback confirmation dismisses after four seconds, extended by Android's accessibility timeout. Errors retain their manual dismissal and draft recovery.
- Offline boards retain departed services and last-known delays; the shared native retention rules are in [native-data.md](native-data.md#cached-boards-and-departed-services). Departed rows show elapsed time with `AGO`, including retained observations. Future retained estimates keep numerical countdowns, matching web/iOS; the unchanged freshness indicator distinguishes stale observations.

Current native exemplars are `assets/comps/latest/android-settings-390x844.png`
and its `-light` variant, the flag-on
`android-settings-390x844-transfer-limit.png` (capped, dark) and
`android-settings-390x844-transfer-limit-light.png` (uncapped, light),
`android-home-390x844-now.png`,
`android-board-390x844-now.png`, the Home/Board
`-390x844-offline-retained-t9.png` frames, and the swipe-to-delete pair
`android-home-390x844-deleting.png` (row dragged past the threshold) and
`android-home-390x844-deleted.png` (row gone, bar offering `Undo`). `tools/shoot-android.sh` reproduces
them, with the offline Board scrolled upward to reveal the retained service.
The same states are checked at 412×732 and font scale 1.3.

Native setup location exemplars are `assets/comps/latest/android-setup-location-`
`{idle,denied,failed,approximate}[-light].png`, captured on a 390×844 dp
display (the Compose frame excludes system navigation). Location states and
station choices are also checked at 412×732 dp. Real permission, autofill,
denial and disabled-device-location recovery are driven on an Android emulator.
