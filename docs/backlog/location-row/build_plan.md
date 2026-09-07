# Build plan: Settings location row

Brief every phase with `design.md`, the exemplar `comps/c1-verb-390x844-ask.png`
and the four `comps/zoom-row-c1-verb-*.png` clips, plus the contracts named
below. The build stage starts in a fresh context. Phases 1, 2 and 3 are
independent and may run in parallel worktrees created under `/private/tmp`
from the current `main` (verify with a landmark: `docs/backlog/location-row/`
must exist). Phase 4 runs after all three land on one tree.

Global rules for every phase: no new strings beyond the design's table and
`Blocked in browser`; the row keeps its height in every state; no explanatory
sentence anywhere; `web/sw.js` `VERSION` bumps in the same change as any edit
to `web/js/settings.js` or `web/app.css`.

## Phase 1: web reference and contracts

Owns `web/js/settings.js`, `web/app.css`, `web/sw.js`, `web/test/settings.test.js`,
`tools/check-settings-browser.js`, `docs/contracts/ui.md`,
`docs/contracts/ios-deviations.md`, `docs/contracts/android-deviations.md`.

- `personal()`: one row, four states from `prefs.useLocation × permission`.
  Subtitle and mark per the design table; web blocked = `Blocked in browser`
  (`.warn`) + `TURN OFF`. Delete `.st-location-note` markup and CSS. `data-act`
  becomes state-specific: `toggle-location` in `off`/`on`,
  `request-location` in `ask`, `toggle-location` in `blocked`. `aria-pressed`
  only in `off`/`on`. The `ask` handler awaits `ctx.requestLocation()` and
  repaints, as the strip did. The `off` tap keeps today's turn-on-then-ask.
- Mark ink `--ink` in every state; drop the `[aria-pressed="true"] .st-state`
  rule for this row. Chevron (`icon('next')`) is not used on the web row since
  the web has no `OPEN SETTINGS`.
- `check-settings-browser.js` `permission-prompt`: assert `Location needs
  permission` and `[data-act="request-location"]` on the row itself, and that
  no `.st-location-note` exists; `permission-denied`: assert `Blocked in
  browser` and the `TURN OFF` mark; add a `permission-granted` assertion of
  `Nearby trips use location` / `TURN OFF` and `off` of `Location is not used`
  / `TURN ON`. Row height equal across the four states (measure it).
- Contracts as listed in `design.md`, "Contract changes".

Verify: `(cd web && npm test)`; `CDP_PORT=9571 node tools/check-settings-browser.js
--url http://127.0.0.1:<port> --frames /tmp/location-row-web-frames` against a
private static server over `web/`; `node tools/visual-regression.js --platform web
--screens settings,settings-light,settings-412` and judge the diff: the only
change is the row.

Done marker: `[ ] phase 1 done`.

## Phase 2: iOS

Owns `ios/ILoveTrains/UI/SettingsView.swift`, `ios/ILoveTrains/Core/TrainViewModel.swift`
(only if a new action is needed), `ios/ILoveTrainsUITests/AppFlowTests.swift`,
`ios/ILoveTrainsTests/ControllerTests.swift`.

- `SettingsMain`: delete the `HStack` strip. `personalRow` for location takes
  subtitle, mark and action from the state: `off` → `TURN ON` / `setUseLocation(true)`;
  `ask` → `ALLOW` / `requestLocation()`; `blocked` → `OPEN SETTINGS ›` /
  `requestLocation()` (which already opens the Settings URL when denied or
  restricted); `on` → `TURN OFF` / `setUseLocation(false)`. Subtitles per the
  table; `Location is blocked` in `colors.warning`.
- Mark ink `colors.ink` in every state; chevron only on `OPEN SETTINGS ›`.
  Row height identical across states; accessibility label title, subtitle, mark.
- UI test: `AppFlowTests` launches with `--calibration settings`; extend that
  calibration seam (or add `settings-ask` / `settings-blocked` variants) so the
  four states can be driven, then assert the strip is absent and the mark text
  per state.

Verify: `tools/build-ios.sh --test`; `node tools/visual-regression.js --platform ios
--screens settings,settings-light` (export `ILOVETRAINS_SIMULATOR_ID` from
`tools/baselines/manifest.json` first; one simulator booted).

Done marker: `[ ] phase 2 done`.

## Phase 3: Android

Owns `android/app/src/main/java/com/ilovetrains/app/UiSettings.kt`,
`MainActivity.kt`, `android/app/src/androidTest/.../UiCalibrationTest.kt`, and a
JVM test for the blocked rule if it is extracted into a pure function.

- `MainActivity`: `locationDenied` = `locationAsked && !hasLocation() &&
  !shouldShowRequestPermissionRationale(ACCESS_COARSE_LOCATION)` in both
  `onResume` and the launcher callback. Everything else in `onLocationRequest`
  stays.
- `SettingsMain`: delete the strip `Row`. `SettingsPersonalRow` for location
  takes subtitle, mark and click per state: `off` → `TURN ON` /
  `setUseLocation(true)`; `ask` → `ALLOW` / `requestLocation()`; `blocked` →
  `OPEN SETTINGS ›` / `requestLocation()`; `on` → `TURN OFF` /
  `setUseLocation(false)`. `Location is blocked` in the warning colour. Mark
  ink `c.ink` in every state; chevron only on `OPEN SETTINGS ›`. 72dp row,
  same height in every state. Content description title, subtitle, mark.
- `UiCalibrationTest`: the Settings capture states stay; the comment at line
  ~261 about the "compact status glyph" is now wrong and goes with the glyph.
  Add an assertion that no `Use my location` node exists on Settings.

Verify: `tools/build-android.sh`; `node tools/visual-regression.js --platform
android --screens settings,settings-light` (check `pgrep -fl "shoot-android|shoot-ios"`
first; one emulator).

Done marker: `[ ] phase 3 done`.

## Phase 4: verification wave and calibration

Runs on one tree with phases 1–3 landed. Owns `tools/baselines/`,
`assets/comps/latest/`.

- `go test ./...`, `(cd web && npm test)`, `tools/build-android.sh`,
  `tools/build-ios.sh --test`.
- `node tools/visual-regression.js` for all platforms; judge every DIFF from
  its composite (the `visual-regression` skill). The Settings frames must
  differ only at the row; accept and commit the baselines.
- Replace the Settings frames in `assets/comps/latest/` (web, Android, iOS)
  with the accepted shots, and compare the web `ask` state against
  `comps/c1-verb-390x844-ask.png` with `node tools/comps/diff.js`: the row band
  is the only permitted difference beyond the fixture data.
- Confirm `web/sw.js` `VERSION` bumped.

Done marker: `[ ] phase 4 done`. Then the `backlog-item` close stage.

## Build coordination (2026-09-07)

Implementation uses disjoint file ownership in the existing checkout, preserving
the owner's service-note edits. Native code and browser verification are assigned
to gpt-5.6-sol under the owner's model defaults. Browser action and accessibility
regressions live in the real-client checker rather than source-matching unit tests.
Release 1.2.4 increments Android versionCode to 4 and iOS build number to 5;
service-worker cache version is v43. Closeout and deployment follow the repository
AGENTS.md standing instruction after all gates pass.
