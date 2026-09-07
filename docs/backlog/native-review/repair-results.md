# Native-review repair results

Implementation is in the working tree; this is not a release notice.
The owner subsequently identified three missed Detail defects and rejected a
3px masking workaround (2026-09-08). The corrections below replace that
workaround with measured ride geometry. The original 63 entries plus D8
were 64 review claims, not 64 verified defects.
The [historical audit](audit.md) records the evidence and corrected claims;
the [build plan](build_plan.md) records current authorization and test gates.

| Group | Implemented behavior | Effect on users |
| --- | --- | --- |
| Journey layout — D1/D2/D3/D5/D8, C3 | Android follows iOS transfer-label placement, marker visibility, alignment and row rhythm; removes the blue overhang. Both use compact Now handling and preserve full departure wharf labels. | Transfer names and platform numbers belong to the correct part of the journey. Now remains visible without compressing the board for another row. |
| Time and status — C4/C5/C8, D4 | Header and saved-row focus statuses agree; Next uses ordinary countdown rounding and freshness rules. Countdowns stay visible on all three clients when stale or offline. Departed rows retain elapsed time with Ago. | A delayed/cancelled/completed trip is described consistently. A connection failure does not erase the time figure; the existing freshness indicator still describes the data. |
| Automatic and saved trips — C9, B1–B7, F3/F10 | Adds web's one-open Just added mark. Inference and redirected trips use located saved endpoints; browsing retains previous answer evidence; manual setup choices are protected. | Automatically added trips are identifiable, and missing API coordinates or unrelated navigation do not corrupt the trip being followed. |
| Refresh — B8/B9/E12/F7 | Focused service and alternatives keep independent sources. A successful alternatives refresh survives a failed focus match. Earlier preserves observations on duplicate services and falls back locally when needed. | Refresh cannot make an old focused observation appear newly observed or discard usable alternatives. |
| Feedback — D6 | Unsent message/category survive navigation. Android field focus follows the reference. Editing pauses during submission; successful send clears the sent draft. | Users can leave Settings to inspect a screen and return without retyping. Nothing sends automatically. |
| Directions and saved-line presentation — C1/C2/C7/C11, F6 | Uses reference mode/wharf grammar and distance rounding; empty views do not borrow unrelated notices. Known saved lines retain journey order; absent lines produce no invented T badge. | Boarding instructions remain intelligible, and unavailable data does not show a misleading success message or guessed line. |
| Realtime and timetable — A1–A5 | Skipped intermediate stops remain traversable without allowing boarding/alighting. Rejects older or invalid realtime and bad package metadata; stages a new Android database before replacing the usable generation. | A through train does not disappear because it skips a stop; stale data or a failed update cannot replace usable observations or timetable state. |
| Saved-data recovery — F4/F8, E2/E3 | Malformed journey evidence cannot discard valid saved trips. Focused alternatives survive restart. iOS follows web's history-based ten-trip eviction; identical writes are avoided. | Corrupt incidental journey data does less damage, and the same trip-use history produces the same iOS/web eviction choice. |

## Detail corrections after owner inspection

- Freshness now appears at the top right beside Back on Android, iOS and web,
  using the existing status text and colours.
- Android departure/arrival step clocks align right within the same column as
  iOS.
- Platform chips retain their rounded corners. Each coloured ride joins inside
  the measured chip body; ground-colour masks and separator borders are removed.
  This closes the red slit and removes blue overhang without changing the
  underlying service-time and transfer-wait positions.

Android passes 78 JVM tests, rendered dark/light corner/join/header/alignment
checks and both 44-frame phone capture sets. iOS passes its four axis tests;
web passes 345 tests. Final iOS Detail captures cover 390×844 and 402×874 in
both schemes. The comparison page and verification record identify
current screenshots separately from historical references.

## Specific questions from the owner

**C10:** the original footer allegation was overstated. Native already uses
“Six services shown” only for six services and “End of board” otherwise.
No new depth, footer or seventh-row design is implemented.

**D6:** the defect was Android losing feedback text on navigation, plus its
missing reference focus treatment. This was not a proposal to redesign
feedback. Android production-controller navigation tests and the existing
iOS UI navigation test exercise draft preservation without sending feedback.

**Large H:** this was a mistake in the rejected comp renderer. Native H/min
already use separate small text; it was not an approved native deviation.

**D4:** the owner confirmed that countdowns must always appear, including on
web. All three clients now keep future numerical figures through stale,
offline and retained states. The existing offline indicator is unchanged.
In-progress Home and Detail keep To change/To go figures; a transfer wait
counts to the next departure. The final images and regression tests include
this ruling.

## Excluded work

No rejected A/B/C comp, coverage composition, extra-row compression, saved-line
schema, Android cache-eviction redesign or unmeasured performance rewrite is
included. Concurrent setup-location, server/realtime and web feature work in
the shared repository is separately owned; native-review test evidence must
state which integrated source was built.

The [real-client comparison page](comps/repairs/index.html) groups images by
problem, proposed repair and user impact. The [verification record](comps/repairs/verification.md) contains the completed
checks and their limits. Baseline acceptance and release remain pending.
