# Native review: approved parity repairs

The original review contained 63 entries; the reported Android overhang added D8, making 64. These were claims, duplicates, maintenance suggestions and hypotheses, not 64 verified user-facing bugs. The [audit](audit.md) accounts for every entry and distinguishes executable, visual and source evidence from unproven claims. The [approval groups](approval-groups.md) preserve the user-impact review packet; the [build plan](build_plan.md) records implementation and verification.

## Owner authorization

On 2026-09-07 the owner authorized D1/D2/D3/D5/D8, C9, feedback-draft retention and other obvious improvements that align Android, iOS and web. Non-obvious choices need the owner's alignment, with images and descriptions for visual changes. This direct instruction to proceed supersedes the backlog skill's usual fresh-thread handoff; builders received fresh, bounded briefs.

- Android D1/D2/D3 follow iOS: station labels belong beneath their own transfer, the second alighting pin remains hidden, and spacing/alignment follow the iOS reference.
- Both clients use web's compact Now handling. H and min stay small. Android ordinary board rows follow iOS's actual rendered height.
- Android D8 removes the blue strip exposed to the left of the boarding chip. Full departure wharf labels, including side information, remain intact on both clients.
- C9 follows web's one-open Just added behavior for an automatically created, predicted trip. Manually selected trips and focused journeys do not receive that mark.
- Unsent feedback message and category survive navigation in controller memory. Editing pauses during submission, as on web, and successful submission clears the sent draft.
- D4 must retain standard numerical time rather than replacing it with Last known. Departed services now show elapsed time and Ago even when retained/offline; beyond 99 minutes they use rounded hours as web does.

On 2026-09-08 the owner resolved D4 explicitly: “countdowns must always appear. if web doesnt show, then web needs to be fixed”. All three clients must keep future figures visible for stale, offline and retained data, using the existing Now/minutes/rounded-hours format and unchanged freshness indicators. Cancellation still uses its standard dash; past rows keep elapsed Ago figures. This supersedes the earlier pending future-row question.

On 2026-09-08, after inspecting the repaired Detail screenshots, the owner
identified three remaining visual defects: freshness belongs at the top right,
Android's first/last step clock text must align right like iOS, and the red
alighting marker must join its red ride without a dark slit. Move the existing
freshness component into the Detail navigation row on all three clients;
preserve its copy, data semantics and colours. Keep the 69dp Android time column
and align its text right. Remove the erroneous space at the alighting edge
without restoring the blue boarding-line overhang or erasing transfer gaps.
The owner then explicitly rejected the 3px mask approach and required rounded
left corners on the blue chip. Remove ground masks/spacers from both pin roles;
measure the rounded chip and constrain ride paint to meet its body while
preserving temporal anchors and dwell geometry. The corner radius is shared
with the chip shape, not a separate masking constant.
The earlier visual-completion claim missed these defects and is superseded
for Detail until new affected-state captures pass.

## Repairs and their seams

The data-engine repairs keep a through service usable when it skips an intermediate stop, while preventing boarding/alighting there and cancelling a focused skipped endpoint. Realtime cannot replace a newer header with an older one, extend expiry beyond header plus 90 seconds, or use a header beyond the existing five-minute future tolerance. Malformed timestamp, relationship, package metadata and SQLite identity checks follow the shared contracts. Android stages a candidate database and its references before replacing the usable in-memory generation; failed activation restores the old manifest.

Travel inference requires usable coordinates at both saved directional endpoints. Arrival completion and Change destination use those saved endpoints rather than coordinate-less API leg places. Browsing preserves the previously shown answer. Only an actually displayed, freshly observed Home lead may become new inference evidence; cached data and mode-driven repaint cannot manufacture an observation. Setup cannot overwrite a manually chosen or cleared origin, and only Home casts daily Home-location votes.

A focused service and its alternatives retain independent board sources and timestamps. An unsuccessful focused realtime match keeps the old observation while retaining a successful alternatives refresh; failure of the alternatives plan retains the previous alternatives. Tapping the focused service uses its own source even if alternatives contain the same service key. Generation and identity checks repeat after asynchronous planning. Earlier preserves current observations on duplicate services, uses the online response when available, and falls back to local planning on failure.

Home status, Next figures, distances, wharf grammar, search thresholds and enabled-mode filtering follow the established web behavior. Saved line badges preserve journey order; when no lines are known, names and the arrow remain without an invented T badge or colour rule. Feedback and empty-state notices keep their separate roles. Storage repairs protect valid trips from malformed journey evidence, preserve focused alternatives across restart and avoid identical writes; iOS eviction follows web's history-based use order.

## Rejected and held work

The entire native-review-r1 A/B/C comp round was rejected. None of its images is an approved exemplar. The oversized H was a workshop-renderer mistake, not an approved native deviation; native board units already used separate small text. The supplied overhang screenshot was Android, despite the initial iOS attribution.

No seventh-row compression, removed Now context, redesigned offline indicator, coverage composition or new board-depth/footer policy is approved. C10 was overstated: the native footer says six only when six rows are present; other counts use End of board. There is no established footer defect to fix.

The current work also excludes a new saved-line schema/fallback colour, Android cache-eviction policy, unproven permission lifecycle changes and unprofiled performance optimizations. Transfer limits/settings belong to the separate transfer-cap item. Audit entries without an established defect are not implemented merely to increase a fix count.

## Verification

Actual native/web renders are the evidence. Fixtures must state data, time, viewport and source state; resizing an image does not establish a matching viewport. The comparison must preserve the six-row calibration and Now landing, inspect both schemes and affected phone sizes, and include transfers, cancellation, ferry caps, wide figures, retained past/future, Just added and feedback navigation. Unit/helper tests do not substitute for controller or rendered-screen verification.

The current gates, ownership and remaining work are in [build_plan.md](build_plan.md). Baselines are accepted only after inspecting intended differences. No release may silently include concurrent unrelated work. The [superseded design record](audit-evidence/superseded-design.md) is retained solely for audit history.
