# Android deviations

This file records deliberate differences between the native Android app and the web reference.

- System bars use Android edge-to-edge insets. The content starts below display cutouts and status icons and ends above gesture navigation rather than reproducing browser chrome or CSS safe-area behavior.
- Location permission uses Android's native permission sheet. Settings says `Blocked in Android settings` after denial and offers the app's normal location action while a decision is still available. Android does not show the web footer permission panel.
- Android system Back performs the same navigation as each visible back control. The Compose screens do not add a second browser-style history mechanism.
- Long-pressing a saved trip opens a native menu with a separate `Delete trip` choice. TalkBack exposes the same menu as `Trip actions`, keeping the ordinary row visually identical to the web composition while preventing an accidental long-press from deleting data.
- Station search uses a native text field and keyboard action. Results and ranking remain local; the keyboard can resize the sheet rather than overlaying it as mobile browsers sometimes do.
- Offline timetable status and its manual update action appear as a quiet Settings row beside feedback and version. The web app's service worker has no corresponding packaged-timetable lifecycle.
- New offline journeys use the bundled timetable and conservative transfers within a station or wharf hub. Routes may differ from the online Trip Planner; cross-hub walks such as Wynyard–Barangaroo require the online fallback. Coverage gaps and realtime identity limits are recorded in [native-data.md](native-data.md).
- Native v1 leaves anonymous analytics counters off. This avoids mixing native renderer adoption and prediction behavior into the existing web-only experiment; functional feedback submission still works.
- Android stores user state in app-private atomic files and excludes it from cloud backup and device transfer. The native trip list is not capped at the web client’s ten-trip LRU, and each trip has the explicit native deletion menu described above.
