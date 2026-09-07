# Native review: approval groups

Updated 2026-09-07: the owner authorized explicit visual repairs and obvious web/native parity and correctness fixes. See [build_plan.md](build_plan.md) for current bounded scope. The pending labels below are the historical review packet, retained for traceability.
On 2026-09-08 the owner also resolved D4: countdowns must always appear on all
three clients, including stale/offline states; web must be repaired too.
See [current repair results](repair-results.md) and the
[real-client comparison page](comps/repairs/index.html) for the resulting work.
The list began as 63 review entries; D8 made it 64. They include defects,
duplicate claims, maintenance work, missing tests and hypotheses. They are
not 64 verified user-facing bugs or 64 separate fixes.

The [audit ledger](audit.md) records the evidence and corrections for every
entry. [Open the visual evidence catalog](comps/audit/index.html) for real
native comparisons and actual web references. Missing matched states are
labelled; these are evidence images, not new proposed design comps.
Five executable Android probes reproduce A1, A2, A3, B1 and B9.
Swift probes confirm A3, B2's coordinate mismatch and F8's empty-journey decode.
Other conclusions are labelled source-confirmed, visual evidence, policy or
unproven. No full end-to-end verification claim is made.

Review each group independently. Approval applies only to its stated scope;
it does not approve a redesign, the old A/B/C comps, or the discarded remedies.
Groups 11 and 13 are explicitly held, not proposed for implementation.

| Group | What users gain | Platforms | Recommendation |
|---|---|---|---|
| 1 | Valid through trains remain available; delays do not roll backward from an older response | Android | Fix |
| 2 | A bad timetable/update cannot displace usable data; bad realtime is rejected | Both, mainly Android | Fix |
| 3 | Travel mode follows the right destination and respects selected services | Both | Fix the bounded scope below |
| 4 | Setup respects manual choices and permits saving trips for disabled services | Both, mainly iOS | Fix |
| 5 | Refresh and Earlier preserve the right observations and source status | Both | Fix |
| 6 | Transfer labels, wharf caps and boarding pins describe the journey correctly | Both, mainly Android | Fix to the stated references |
| 7 | Home status and the Next countdown agree with the web | Both | Fix to the stated references |
| 8 | Boarding instructions, empty-state explanations and distances make sense | Both | Fix |
| 9 | An unsent feedback draft survives leaving Settings | Android | Fix |
| 10 | Saved-trip eviction, damaged-data recovery and cache growth are predictable | Both, mainly iOS | Fix; review eviction impact |
| 11 | Offline/retained presentation, board limits and saved-line accents | Both | Hold for matched evidence/decision |
| 12 | Less redundant work and fewer ways for future fixes to drift | Both | Optional maintenance |
| 13 | Possible launch, routing, memory and permission improvements | Both | Investigate only; no fix approval |
| 14 | The routing documentation describes the actual service-day scan | Both | Documentation only |

## 1. Keep valid services and newer realtime

**A1, A2 — Android.** If a train skips an intermediate station, Android can
remove the entire through journey. An older realtime response can also replace
a newer delay. Both mechanisms were reproduced with production code.

Proposed change: keep riding through a skipped stop possible, while forbidding
boarding/alighting there; reject a response older than the stored header for
that source. Riders retain valid route options and the latest observation.
Actual cancellations remain cancellations. This changes route results, so
verification must cover through travel, skipped endpoints, cancellation and
new/old/equal header ordering.

## 2. Protect the usable offline timetable and reject bad input

**A3, A4, A5, G3 — both; rollback/package gaps are Android.** A candidate
database can pass preliminary checks but fail while opening. Android currently
has no restoration path after closing the old database. Both clients can also
trust incorrect realtime expiry metadata longer than the documented window.

Proposed change: restore the previous usable generation on candidate-open
failure; reject wrong database IDs, malformed coverage dates and oversized
declared archives; enforce the existing expiry/future-time/relationship rules.
Keep the current package hash, integrity and size checks. Add malformed ZIP
tests on iOS and an actual planner-open failure injection.

Users keep offline routing when an update fails. Invalid realtime falls back
to scheduled/retained behavior instead of appearing live. A3 is reproduced;
rollback is source-confirmed, not failure-injected yet. This group does **not**
skip the startup integrity check or rewrite ZIP extraction.

## 3. Follow the correct trip

**B1–B5 — both.** Missing coordinates can falsely trigger Android travel
mode. iOS checks the wrong destination coordinates for arrival completion.
Android's Change destination can leave Home following the old destination.
Both can offer an alternative containing a disabled service mode.

Proposed change: validate saved endpoints before inference; use the saved
directional destination for arrival; redirect an inferred trip by the same
first service and scheduled departure, otherwise show the new pair's board;
filter replacement/Next candidates by every leg's enabled mode. Also record
the journey actually shown and preserve that evidence when merely browsing.

Users should get directions for the selected destination, the return offer
near arrival, and suggestions respecting their service choices. Preserve
pinned journeys, all-mode refresh of the followed service, and the existing
offline inference safeguard. B5's broader eligibility policy for cached and
scheduled paints is **not** approved by this bounded repair; it needs explicit
state cases before any expansion. Verification must cover no coordinates,
reverse travel, match/no-match redirects, mixed modes and ordinary browsing.

## 4. Respect choices during setup

**B6, B7, C9, F3, F10 — both.** Android can use a setup visit as the day's
home-location vote. iOS can refill an origin the user deliberately cleared and
blocks saving a station pair when its service mode is disabled. Both lack the
web's nearest-station choice and once-only Just added marker after an automatic
pair save; home search begins one character earlier than web/setup.

Proposed change: vote only on Home; protect edited/cleared origins; let iOS
save a currently incompatible trip, hiding it on Home until its mode is enabled;
use three-character search consistently; add the web's nearest choice and
Just added behavior. Keep Android's documented first-run location prompt and
autofill exception. Do not enable disabled services automatically.

Users retain control of where a trip starts and can save a ferry trip even
while ferries are off. Search results appear after three letters. Location
permission lifecycle changes B10/B11 are held in group 13. Visual additions
must use the actual web reference and be captured in native clients before
acceptance, including permission denied/no fix and the one-time marker reset.

## 5. Preserve observations through refresh and Earlier

**B8, B9, E12, F7 — both.** Android can strip observed delays/cancellations
from focused alternatives or turn a successful server-stale response into
Offline during a local replan. iOS can restart a second network refresh and
rewrites earlier rows to scheduled-only. Both Earlier actions rely only on the
local planner, even when the online API could provide the services.

Proposed change: retain observations with their own provenance; distinguish
a failed request from a local-only refresh; coordinate one ordinary refresh
per cycle; fetch earlier pages from the API with local fallback, the existing
24-hour bound, cancellation and generation guards.

Users see fewer disappearing delays/cancellations and can reach earlier
online services where local routing is incomplete. Old observations must
never become fresh merely because the page refreshed. This does not change
the offline indicator's design, future board length, row spacing or Now
landing. Test fresh scheduled, live local, server-stale, failed requests,
retained past/future, rapid repeated Earlier and navigation during a request.

## 6. Make the journey axis accurate

**C3, D1, D2, D3, D8 — both; most geometry fixes Android.** Android joins
transfer names into one line, shows an extra alighting pin on a second change,
can paint a tight-change warning on a cancelled row, and leaves a blue strip
before the next boarding number. Both shorten a full departure wharf label.

Proposed change: apply the previously specified iOS station-label placement
and hidden second alighting pin to Android; suppress tight-change warning
when the journey is cancelled; anchor the boarding chip's visible edge at the
ride start; show the full departure label such as **Wharf 4, Side A**.

Users can associate platform numbers and transfer stations with the right
ride. The supplied blue-overhang screenshot is Android; this is not a proven
iOS overhang. Full wharf text needs phone-width and large-text verification.
Keep timetable geometry and row rhythm; the separate maximum-transfer setting
is outside this group. Compare identical two/three-leg journeys, long station
names, full/side-only/missing wharf labels and cancellation in both schemes.

## 7. Make status and countdowns consistent

**C4, C5, C8, D5 — both.** Android's focused saved row can say Running when
the journey is cancelled, late or finished. Focused header status differs
from web. Both Next rows can omit a fresh scheduled countdown and truncate
119 minutes to 1H while the board rounds to 2H. Now sizing also differs.

Proposed change: use the same web status meaning in header and selected row;
keep the numeric delay in its provenance slot; share countdown rounding and
source-state rules; use the web's compact sizing for wide figures.

Users get a consistent answer between the header, saved row, board and next
service. **H and min stay small.** The oversized H in the rejected comp was
our renderer mistake; fixing a supposed large-H native defect is not in scope.
No extra seventh row, spacing compression, removed Now marker or changed
offline treatment is approved. Verification must include Now, 99/100/119
minutes, multi-digit hours, late/cancelled/completed focus and source freshness.

## 8. Correct instructions and unrelated empty-state messages

**C1, C2, C7, C11 — both.** Android can say Wharf Balmain Wharf; iOS uses
metro in generic directions where web says train. A transient message such as
Feedback sent can occupy an unavailable-board explanation. Header distances
round differently from web.

Proposed change: port web boarding grammar and context-specific mode words;
derive empty explanations from state rather than the bottom notice; use the
web distance rounding. Preserve Next metro in the specific Next rail where
web uses it. This does not rename actual lines or stations.

Users get an intelligible boarding location and explanation of an unavailable
view. Check named/numbered/side-only wharves, unknown modes, successful feedback
while another screen is empty, and distance thresholds/locale. Broader offline
and empty-board wording C6 remains held in group 11.

## 9. Keep an unsent feedback draft

**D6 — Android.** Feedback text lives inside the Settings composition, so
leaving that screen discards it. The field also lacks the web/iOS focused-label
treatment.

Proposed change: retain the draft for the app session and apply the existing
reference focus treatment. Users can check another screen and return without
retyping. Keep successful-send clearing; this does not store drafts permanently
or send anything automatically. Verify leave/return, keyboard focus and send
success. No feedback will be sent as part of this audit.

## 10. Make saved-data recovery and eviction predictable

**F4, F8, F9 — both, primarily iOS.** iOS has competing rules for which trip
to remove when an eleventh is saved, and accepts malformed persisted journeys,
including finite times outside safe UI conversion bounds. Android has no global bound for residual
board-cache files, although trip deletion already removes its cache and the
OS can evict cache files.

Proposed change: use the web's latest-history/creation rule consistently for
the ten-trip cap; discard malformed journey records while preserving valid
personal data; bound Android cache like the existing iOS policy: the ten most
recently written directed station pairs, at most eight mode combinations per
pair, and 64 files overall. Evict the oldest entries first. A return direction
counts as a separate pair for this cache cap.

The eviction rule can change **which old trip is removed** on an eleventh
save. Cache trimming can remove an old last-viewed offline board; it cannot
remove saved trips/history or the offline timetable. Those are the material
approval tradeoffs. Test the eleventh save, corrupted individual records,
active pairs, trip deletion/undo and offline cache fallback. F6's saved-line
representation and visual fallback are held in group 11.

## 11. Hold the rejected or unsettled presentation work

**C6, C10, D4, F6 — both. No implementation approval requested.** The old
offline-indicator/coverage proposal and longer-board recommendation remain
rejected. Fresh scheduled, server-stale, failed-request and retained rows
cannot be compared as if they were the same state. LAST KNOWN wrapping is
a native-only presentation difference; no row-height break was established.
The current native footer uses Six only at exactly six merged rows, not for
every longer board; merged count and future-page meaning still need review.

Next evidence must show actual web/native renders with the same journey,
clock, source state, viewport and scroll landing, including the Now marker.
Only then settle footer/display limits and retained numeral/provenance rules.
Do not introduce sticky Now unless that separately matches an approved rule.

F6 confirms iOS can alphabetize T9→F1 into F1,T9 and both store no mode with
saved line names. Preserve travel order in the eventual design, but show the
saved-row comparison and unknown-line fallback before approving its visual
or storage migration. No new fallback color is selected here.

## 12. Optional maintenance with no intended product change

**A6, D7, E2, E3, F1, F2, F5, G1, G2 — both.** These are not ten more
user-facing bugs. There is a test-only overlay, unused members, fragile notice
text coupling, repeated cache decoding and missing assertions. Some claimed
redundant writes contain legitimately changing last-answer timestamps.

Proposed scope: remove demonstrably unused paths; keep list/focused overlay
semantics distinct where needed; centralize feedback success state; reuse one
cache inventory; skip personal-state writes only when the resulting value is
unchanged; add missing conformance/controller checks. Do not blindly delete
all figure-length branches, localhost exceptions, or byte readers with
different limits/stream ownership. No speed or battery improvement is promised.

User impact is protection against future regressions; no deliberate visual,
routing, timing or saved-data behavior change. If an optimization cannot
preserve behavior, take it out of this group for separate review. G4 means
every approved fix gets meaningful regression verification; it is not a
separate work item to approve.

## 13. Hold unmeasured performance and permission claims

**B10, B11, E1, E4–E11. No implementation approval requested.**

The audit established repeated work and the full iOS extraction allocation,
but not user-visible launch delay, frame drops, battery waste or memory failure.
The isolated Mac SQLite scan is not a phone startup measurement. The alleged
Settings permission dead end and duplicate OS request need a lifecycle drive.

Before proposing fixes, measure representative phone launches, memory during
update, route timings and recomposition, and drive permission grant/deny and
navigation. Keep current integrity checks and route search coverage. The old
suggestion to bound failed route scans is withdrawn because it could remove
valid journeys. No arbitrary performance refactor or broader location
collection is approved through this list.

## 14. Correct the routing documentation

**A7, A8 — documentation only.** Document the four service dates actually
scanned for the existing 30-hour horizon. Circular Quay currently has train
and ferry in the bundled data, so the code's cross-mode condition and the
written rail↔ferry floor produce the same routes there.

No routing behavior changes. Keep the current rail/ferry policy; do not
approve hypothetical additional-mode transfer rules through wording cleanup.
Any future behavior change must land with its contract and tests.

## Historical approval record, before the owner's repair instruction

All groups: **pending**. Groups 11 and 13: **held**. No app code, deployed
client, design baseline or approved exemplar was changed by this audit.
After individual verdicts, replace the obsolete build phases with only the
approved scopes, serialize shared-file ownership, and verify each change
against the web and applicable native exceptions.
