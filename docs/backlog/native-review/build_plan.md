# Native review: approved repair build

The [design](design.md) records the owner's binding rulings. The
[repair results](repair-results.md) group the changes and user impact;
[real-client comparisons](comps/repairs/index.html) show the visual evidence.
The original 64 claims are accounted for in [audit.md](audit.md), not treated
as 64 verified defects.

## Authorization

- D1/D2/D3: Android follows iOS geometry, spacing and alignment.
- D5: both follow web Now handling; Android row rhythm follows iOS.
- D8: remove Android blue overhang. Keep small H/min and Now context.
- C9: port web Just added. D6: preserve unsent message/category on navigation.
- D4, resolved 2026-09-08: “countdowns must always appear. if web doesnt show,
  then web needs to be fixed”. All three clients keep figures through stale,
  offline and retained states. Keep existing freshness indicators.
- Implement other proven, obvious parity/correctness improvements. Non-obvious
  design choices require owner alignment. No rejected A/B/C comp, seventh-row
  compression, indicator redesign or speculative performance rewrite.
- C10 established no footer defect: preserve current depth/footer policy.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| Data engines | A1–A5, safe A6 cleanup/G3 regressions: skipped-stop traversal, realtime validation/order, package validation and Android activation rollback | Implemented; engine tests passed |
| Android parity | Approved geometry/figures/line labels, controller inference and refresh safeguards, feedback, saved-data recovery | Implemented; scoped tests and final rendered checks passed |
| iOS parity | Approved figures/labels, controller inference and refresh safeguards, feedback, saved-data recovery/eviction | Implemented; final D4 tests and affected renders passed |
| Web parity | Countdown persistence, top-right Detail freshness and measured rounded-chip ride joins; service-worker bump | Implemented; 345 tests passed |
| Integration and evidence | Inspect real-client frames, classify intended baseline differences, verify actual viewport sizes and source states | Implemented; final Detail/rounded-chip captures inspected and comparison refreshed |
| Closeout | Preserve scoped evidence/contracts and prepare an isolated release without unrelated concurrent changes | Pending |

## Final verification

| Check | Result / evidence |
| --- | --- |
| Go | Passed; `/tmp/native-review-go-integration.log` |
| Web | 345/345 after final Detail/header and rounded-chip correction; full `npm test` |
| Android JVM | 78/78 after final rounded-chip geometry and Detail header/time changes; `/tmp/native-review-detail-rounded-final-jvm.log` |
| Android SQLite engine | 5/5; `/tmp/native-review-android-engine-instrumentation.log` |
| Android production controllers | 5/5; `/tmp/native-review-android-controller-final.log`. Includes draft navigation, inferred redirects, independent focused/alternative sources, last-answer retention and Just added clearing |
| iOS broad unit/UI | 78/79 unit + 5/5 UI; the single obsolete setup oracle was corrected and passed a targeted rerun. Logs `/tmp/native-review-ios-final-stable-gate-3.log` and `/tmp/native-review-ios-fresh-fix-targeted.log` |
| iOS final D4 | 10/10 row/Next/direction tests passed; `/tmp/native-review-ios-final-d4-rowconformance.log` |
| Real-client matrix | Web390×844/412×732, Android390×844/412×732 at font1.0/1.3, iOS402×874 and true390×844, both schemes. Final D4 images inspected; see the [verification record](comps/repairs/verification.md) |

The iOS broad failure was a test expecting automatic setup selection, while
concurrent owner-approved location-accuracy work can offer a station choice.
The corrected test asserts accepted fresh-location evidence and monotonic
receipt time; no product freshness guard was weakened. Later tests from that
separate task are outside this recorded broad gate.

## Verification boundaries

No .env was read or sourced. No feedback was sent. Source/identity guards and
inference freshness remain strict even though displayed countdowns now persist.
D4 also fixes the in-progress native fallback from To change/To go to Ago;
during a transfer wait the countdown targets the next effective departure.
Detail cancellation retains the dash.

The shared workspace is changing under separate setup-location, TinyTrain,
realtime and transfer-cap tasks. Final Android verification uses the preserved
source snapshot `/tmp/native-review-android-final-snapshot-20260908-0144` and
matching APKs. A dedicated emulator avoids external instrumentation collisions.
iOS uses a dedicated simulator and derived-data directory. Failed/colliding
captures are recorded as failures, not passing gates.

An Android screenshot semantics tag originally captured inside safe-area
padding; moving it before padding restores full-frame dimensions without
moving product content. Earlier shorter captures do not prove a full-frame
baseline match. Cancelled-label checks use actual rendered line extents and
single-line count; Compose's broader paragraph-overflow flag is logged because
it can remain true when the glyphs fit within the rendered node.

The [final verification record](comps/repairs/verification.md) records the
completed captures, raw regression differences and source fingerprints. Root
also inspected the final Android/web offline boards and iOS retained board
and in-progress Home; all current local comparison-page references resolve.
Baselines have not been accepted or released. The chronological investigation,
including superseded blank-future expectations and capture failures, remains
in [repair-build-record.md](audit-evidence/repair-build-record.md).

## Detail corrections after owner inspection — 2026-09-08

The owner found three missed defects in the final comparison: freshness at the
bottom instead of top right, Android step clocks aligned left instead of right,
and a dark slit before the red alighting marker. Root owns native Detail header
placement, Android clock alignment and contracts. The integration agent owns
matching web Detail placement and its service-worker bump. The visual agent
owns the axis-edge repair, rendered regressions and affected-state captures.
The bounded correction preserves existing freshness content and transfer gaps.
Final native/web captures supersede earlier images for these details; the
verification record distinguishes the two rounds.

The owner rejected the initial role-specific 3px mask proposal: the boarding
chip must retain rounded left corners. Both pin roles now require unmasked
rounded chips; ride paint must join inside their measured body using the same
corner radius. Verify the corner pixels, continuous red join, absence of blue
overhang, and unchanged temporal/dwell anchors. Do not accept a spacer or
background rectangle that merely conceals an incorrect segment endpoint.

Android's frozen-snapshot full JVM gate passes 78/78 after the measured rounded
marker geometry and header/time changes (`/tmp/native-review-detail-rounded-final-jvm.log`).
Android rendered dark/light corner/join/header/alignment checks pass; canonical
390×844/font1.0 and 412×732/font1.3 runs each pass 44/44. iOS axis tests pass
4/4 and affected Detail captures exist at 390×844 and 402×874 in both schemes.
Root inspected original Android390, iOS402 dark/offline-light and iOS390-light
Detail PNGs, confirming top freshness, clock alignment and rounded joins.

Web final correction passes 345/345 tests. Its 16 Chromium captures cover
390×844 and 412×732 in both schemes. All Detail captures pass; the 412 two-change
Board also reports an existing last-visible-target reachability warning, so
those frames establish marker joins only. Source and image hashes are in
`/tmp/native-review-web-reference-20260908/final-alignment/capture-evidence.json`.
