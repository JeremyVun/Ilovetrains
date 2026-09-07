# Native review visual verification — 2026-09-08

Status: final owner-review evidence prepared. Baselines have not been accepted, committed, or deployed.

## Review artifact

- Owner page: `docs/backlog/native-review/comps/repairs/index.html`
- Durable images: `docs/backlog/native-review/comps/repairs/images/`
- Durable verification record: `docs/backlog/native-review/comps/repairs/verification.md`
- Every phone image is an actual web, Android Compose, or iOS SwiftUI capture. No rendered comp is included.

## Capture truth

| Client | Configured/true viewport | Actual pixels | Scale/schemes | Source |
|---|---:|---:|---|---|
| Web | 390×844 and 412×732 CSS px | 780×1688 and 824×1464 | 2×, dark/light | `/tmp/native-review-web-reference-20260908/final-alignment` |
| Android | dedicated `Location_Review`, 390×844 dp | 1024×2216 | density 2.625, font 1.0, dark/light | `/tmp/native-review-detail-final-android-390x844-fs1-v2` |
| Android | dedicated `Location_Review`, 412×732 dp | 1082×1922 | density 2.625, font 1.3, dark/light | `/tmp/native-review-detail-final-android-412x732-fs13` |
| iOS | iPhone 17, true 402×874 pt | 1206×2622 | dark/light | `/tmp/native-review-detail-final-ios-402x874` |
| iOS | iPhone 14, true 390×844 pt | 1170×2532 | dark/light | `/tmp/native-review-detail-final-ios-390x844` |

The Android root tag now wraps `windowInsetsPadding`, so the calibration capture records the full configured app root. The final 390 and 412 files have no resize, crop, or viewport relabelling.

## Final visual findings

- D1/D2: Android two-change Detail gives Rhodes, Town Hall, Central, and Bondi Junction distinct rows and dwells. The later alighting pin is suppressed; route order matches iOS.
- D3: cancelled transfers have no tight-change treatment. At Android font scale 1.3, every exact `CANCELLED` text leaf is one line with rendered extents inside its node. The original wrapped transfer label and a provenance constraint were both corrected.
- D5: Home and Board `Now` fit without touching the platform strip or times. `H` and `min` are separate small units; the native 3H treatment matches web.
- D8 final correction: native ride paint is trimmed only after measured marker placement and overlaps inside same-lane chips by the shared corner radius. The red ride meets its alighting chip continuously; the blue ride starts inside a rounded boarding chip with no left extrusion. Logical anchors and true transfer dwell gaps do not move.
- D4: every future source state keeps Now/minutes/rounded hours, including offline, aged, schedule-only, and retained data. Past rows keep rounded elapsed numbers plus Ago. In-progress Home/Detail figures keep To change/To go and target the next departure during a transfer dwell.
- C4/C8: recent degraded Home retains Next 18 min and a delayed focus retains Running late + Pinned. Source labels remain accurate: schedule-only data does not claim observed lateness.
- C3: full initial ferry caps remain visible (`Wharf 3, Side A` Android; `Wharf 2, Side A` iOS).
- C9: final native dark/light captures show 12 pt italic `Just added`, regular 10 pt uppercase distance metadata, and no `Never ridden`. Explicit Android selection clears the one-open mark.
- F6: unknown-line rows keep the reference 15+13 empty line-column gutter, names, and arrow, with no fabricated badge or coloured spine.
- D6: native focused fields show their drafts. Web browser, Android controller instrumentation, and iOS UI instrumentation prove navigation retention without a send.
- No seventh-row/Board-Now-marker removal, offline-indicator redesign, or C10 footer/depth change appears.

## Final gates

- Go: passed (root-owned final gate).
- Web: 345 tests passed. Final alignment matrix: 16/16 captures at 390×844 and 412×732, dark/light, with viewport, overflow, content, analytics, and state assertions. Evidence: `/tmp/native-review-web-reference-20260908/final-alignment/capture-evidence.json`.
- Android SQLite engine: `OfflinePlannerInstrumentedTest`, 5/5 passed. Log: `/tmp/native-review-android-engine-instrumentation.log`.
- Android controller: `ControllerParityInstrumentedTest`, 5/5 passed for D6, B3, B8, B5, and C9. Log: `/tmp/native-review-android-controller-final.log`.
- Android final frozen JVM: 78/78 passed after the rounded-marker geometry, Detail header/time alignment, D4 matrix, and transfer-dwell direction regression. Log: `/tmp/native-review-detail-rounded-final-jvm.log`.
- Android rendered geometry: `detailAxisJoinsAndHeaderGeometryAreRenderedCorrectly` passed dark/light pixel and layout checks for the continuous red join, rounded blue corner with zero extrusion, top freshness, and trailing-aligned step clocks. Log: `/tmp/native-review-detail-axis-rendered-android.log`.
- Android final calibration: 390×844/font 1.0 and 412×732/font 1.3 each passed `captureCanonicalScreens`, 44/44 frames, zero PixelCopy retry lines. Logs: `/tmp/native-review-detail-final-android-390x844-fs1-v2.log` and `/tmp/native-review-detail-final-android-412x732-fs13.log`.
- iOS final `RowConformanceTests`: 10/10 passed, including future source states, Next rounding, elapsed past rows, and transfer dwell direction. Log: `/tmp/native-review-ios-final-d4-rowconformance.log`; xcresult: `/tmp/native-review-ios-build-final-d4/Logs/Test/Test-ILoveTrains-2026.09.08_02-14-37-+1000.xcresult`.
- iOS earlier broad gate: 78/79 unit and 5/5 UI passed. Its only failure was a superseded setup-location auto-pick oracle; the corrected fresh receipt-time assertion passed separately. Logs: `/tmp/native-review-ios-final-stable-gate-3.log`, `/tmp/native-review-ios-fresh-fix-targeted.log`.
- iOS D6 UI drive `testFeedbackDraftSurvivesSettingsNavigationWithoutSending` passed in that broad gate.
- iOS final `JourneyAxisLayoutTests`: 4/4 passed, including unchanged dwell coordinates, chip overlap, and crowded-marker lane behavior. Log: `/tmp/native-review-ios-detail-axis-tests-final.log`; xcresult: `/tmp/native-review-ios-detail-final/Logs/Test/Test-ILoveTrains-2026.09.08_03-01-40-+1000.xcresult`.
- Final iOS affected-state captures contain 10/10 frames at both true 402×874 and true 390×844, dark/light. The inspected two-change, cancelled, ferry, and retained-offline Detail frames place freshness in the top row and preserve the rounded structural joins.

## Standard visual regression — no acceptance

The earlier Android standard report used the pre-final-correction full-root 390×844 capture and 28 selected screens. Raw result: **27 DIFF, 1 same, 0 NEW, 0 MISSING**. Report: `/tmp/native-review-visual-regression-android-full-final/report.html`; console: `/tmp/native-review-visual-regression-android-full-final.log`. The affected Detail frames were rebuilt and inspected separately; no baseline was accepted.

All 27 composites were inspected in `/tmp/native-review-visual-regression-android-full-final/contact-{1,2,3}.png`:

- Home diffs are the intended D5 figure/unit hierarchy, focused status/line-order work, C9/F6 row treatment, and D4 offline countdown behavior.
- Board diffs are the intended D1/D2 row rhythm, D5 figure hierarchy, D8 endpoints, and D4 countdown/provenance behavior.
- Detail diffs are the intended D1–D3 structure/cancellation behavior, D5 figures, and C3 ferry caps.
- Settings dark/light diffs are the concurrent setup-location row; excluded from native-review acceptance.
- Setup is the one exact same frame.

The earlier iOS standard report remains **8 DIFF, 12 same, 0 NEW, 0 MISSING** at `/tmp/native-review-visual-regression-ios-final/report.html`. Its eight composites were inspected: seven are D5/F6/C3 intended changes; Setup is concurrent calibration behavior and excluded. Final D4 and F6 iOS states were rebuilt and inspected separately in the final 10-frame affected-state set. No threshold/fuzz value changed and no `--accept` run occurred.

## Instrument ownership and failures retained

- Preserved inherited `tools/check-settings-browser.js` wait for `window.__trains`; added only four feedback frames and leave/return draft assertion.
- `tools/README.md` documents those frames, the exact Android SQLite instrumentation runner, and bounded PixelCopy retry behavior.
- Android capture retries only the exact `Failed waiting for PixelCopy` assertion, at most three total attempts; every other assertion and the final attempt remain fatal. Final captures used zero retries.
- The rendered cancellation regression reads exact `CANCELLED` leaves from the unmerged semantics tree, logs Compose paragraph diagnostics, and asserts one line, no height overflow, and every rendered line extent within its node. This avoids `hasVisualOverflow` false positives caused by wrap-content paragraph constraint rounding while still failing the original two-line wrap.
- Failed/interrupted evidence remains: `/tmp/native-review-android-final-snapshot-412x732-fs13-diagnostic.log` records the pre-provenance constraint overflow; `/tmp/native-review-android-final-snapshot-412x732-fs13-d4-final.log` was interrupted by a peer `am instrument` force-stop. Final Detail passes used dedicated emulator-5558.
- Concurrent TinyTrain/setup-location changes are excluded from claimed scope. The Android verification snapshot copied only final native-review hunks after it was frozen.

## Fingerprints

- Frozen Android source snapshot: `/tmp/native-review-android-final-snapshot-20260908-0144`; final app/src digest `c3103ac46fe88a3f66996014bf9ce4c23d35e3d8312e57a328c0f3972eb61463`.
- Final Android APK SHA-256: app `c59186f2e770f949d3948b15706d413bad59b37381d1b97cf187c58a923e4bce`; test `98853b2b0068505f639196fa44c033800ce2ea095a890e055615c2bca49b6927`.
- Final iOS source+tests digest: `2d186a5ee4fb62557989267640135e03b4dbccd3cce17ed8f28b4aa664135ca9`; derived app: `/tmp/native-review-ios-detail-final/Build/Products/Debug-iphonesimulator/ILoveTrains.app`; app binary SHA-256: `7e6e93adee5dee09a637525952ddcc7e3fe6f56d504791e72644c64a80783a44`.
- Final web alignment evidence SHA-256: `0ffdfc4de013f8f026cc97e3b06c0da9599800778ee94f633bb758a328fc3b2d`.

## Review boundary

C10 footer/depth is unchanged. The six-service marker, Board Now marker, and current offline indicator design remain. No baseline acceptance, commit, or deployment was performed.


## Final Detail and rounded-chip correction — 2026-09-08

This section supersedes earlier Detail/axis screenshots and gate claims for the
owner's follow-up. Freshness is now top right on all three clients; Android step
clocks align right. Chips have no ground-colour masks. Ride paint uses resolved
chip frames and their corner radius while temporal anchors/dwell frames stay fixed.

- Android JVM: 78/78 passed; `/tmp/native-review-detail-rounded-final-jvm.log`.
- Android rendered dark/light regression: passed; checks continuous red join,
  rounded blue left-corner pixels, absent blue overhang, header placement and
  right-aligned clocks. `/tmp/native-review-detail-axis-rendered-android.log`.
- Android canonical captures: 44/44 at each of 390×844/font1.0 and
  412×732/font1.3; `/tmp/native-review-detail-final-android-390x844-fs1-v2.log`
  and `/tmp/native-review-detail-final-android-412x732-fs13.log`.
- iOS axis tests: 4/4 passed; `/tmp/native-review-ios-detail-axis-tests-final.log`.
  Final affected Detail sets have 10 frames each, dark/light at true390×844 and
  402×874: `/tmp/native-review-detail-final-ios-390x844` and
  `/tmp/native-review-detail-final-ios-402x874`.
- Web: 345/345 tests. Final16 captures at390×844/412×732, dark/light; all12 Detail
  frames and both390 two-change Board frames pass the browser harness. The two412
  Board frames retain an existing last-visible-target reachability warning and
  establish pin-edge appearance only. Evidence:
  `/tmp/native-review-web-reference-20260908/final-alignment/capture-evidence.json`.

Root inspected the original Android390 two-change/ferry, iOS402 two-change and
light offline Detail, iOS390 light two-change, and web390 two-change PNGs.
The page's Android and both iOS two-change images match those final captures
byte-for-byte. Its local links resolve. The pixel zoom displays the original PNG;
no image synthesis, ground masking or pixel retouching is used.

Earlier standard visual-regression counts remain historical; the final correction
uses the affected-state captures and scoped rendered checks above. Baselines were
not accepted and no release was performed. Shared unrelated work remains excluded.
Current review-image hashes are in `final-detail-images.json`.
