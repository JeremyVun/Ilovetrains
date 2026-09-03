# Trip selection and journey readability

## Owner spec

These are the owner's 2026-09-02 and 2026-09-03 rulings, kept near-verbatim. They are the
spec for the comp round.

1. A cancelled journey must not still say it arrives normally or let the user
   select it.
2. Reversal controls are descoped. If the user needs to tap a reversal, the
   smart header has already failed.
3. Interchange copy needs to be better. Focused directions must name the
   station where the user changes, not only the next platform and train.
4. Replace internal terminology. There should not be separate “Start
   directions” and “Stop directions” actions; use one ordinary action such as
   “Select” or “Board”. “Board” must not mean going back to the trip-results
   screen.
5. Replace “Track another trip” with “My trips” or similarly plain copy. A
   saved-trip row is the primary tappable affordance and drills into that
   trip. The smart header is primarily for reading, not the primary action.
6. A focused journey must never trap the user. Every saved-trip row remains
   usable while one journey is selected; switching trips must not require
   finding the selected service and unfocusing it first.
7. Back navigation from journey detail needs clear copy and direction.
8. Do not change dark-mode contrast in this work.

## Findings that constrain the design

- A journey whose second leg is cancelled currently keeps an enabled `Focus
  this train` action and a normal arrival claim. Selecting it returns home with
  a countdown and cancellation copy for the broken journey.
- The current home header is one large button, while its saved-trip list is
  visually secondary. This is the opposite of the owner ruling above.
- The current header control labelled `Tracking · …` looks like a selector but
  only scrolls to the saved-trip list.
- `history` records qualified board views, not rides. Receipts based only on
  that history must say that the user checks or views a trip, not that they
  ride or take it.
- The app may still select the reverse direction automatically. The ruling
  removes manual reversal chrome; it does not remove prediction of the return
  direction or the automatic post-arrival return offer.

## Frozen

- The smart header remains the zero-tap answer and keeps the current timetable
  grammar, journey axis, exceptional-state vocabulary and dark/light schemes.
- The departure board remains the now-anchored timeline. A saved-trip row opens
  that trip's board; a board service opens journey detail.
- Saved trips, selection, focus and personal evidence remain on-device.
- No reversal control is added anywhere.
- The 390×844 and 412×732 phone frames, 44px tap minimum, six-service board
  reachability and current line palette remain binding.
- No product implementation starts until the owner rules on comps.

## Round 1 question

Find one composition that makes `My trips` the obvious route into departures,
makes the smart header read-first, and gives journey detail one plain boarding
action plus an explicit way back. It must also make interchange and cancellation
states safe at a glance without adding permanent explanatory chrome.

## Open owner calls

None. The design is closed after the round 5 owner verdict.

## Round 1 owner verdict — 2026-09-03

Workshop: `/tmp/trains-comps-home-interaction-r1/`; sheet: `index.html`.

14. **Restore coloured platform boxes in focused transfer directions.** The
    focused-change comps dropped an existing part of the smart-header grammar.
    A transfer must retain the coloured platform-number boxes; text such as
    `Change at Town Hall · Platform 5` is not enough by itself.
15. **Keep C2's ordinary-density saved-trip rows; reject C4's large-route
    layout.** The large light-scheme route treatment is buggy and out of spec
    and does not carry forward. Its `Take this train` wording may be used
    independently of that composition.
16. **`Take this train` is approved.** It is the sole positive action on a
    selectable journey detail. Its footer must use the same spacing and rail
    geometry as the home screen's `New trip` footer; the round-one concepts
    drifted between the two. Journey detail also needs more space between
    `1 change at Town Hall · arrives 10:08` and the first divider.
17. **Back names the departure station.** `<departure station> departures` is
    approved. `Trains to <destination station>` is rejected because it implies
    that the board combines multiple departure stations.
18. **Browsing does not replace the focused train.** Opening any other saved
    trip remains possible and preserves the current focus. Focus changes only
    when the user chooses `Take this train` on another service.
19. **Cancelled journeys offer no journey-selection or recovery action.** The
    top `<departure station> departures` back control is sufficient. The
    warning is only `The 09:58 from Town Hall is cancelled.`; do not append
    `Choose another departure` and do not add a `Choose another train` footer.
20. **Do not claim the user is physically aboard.** Replace `ON THIS TRAIN`
    with status copy that remains true when the user is only following the
    train. `Running`, `On the way` and `In route` were suggested for
    exploration, not yet approved.
21. **Defer mid-journey cancellation recovery.** If a later leg such as the
    Town Hall departure is cancelled after the journey is focused, the smart
    home should eventually switch to the next best alternative because the
    user may already be travelling. This is a separate smart-header problem,
    not a reason to add a recovery button to cancelled journey detail.

Round 2 must be a narrow correction pass on C2: platform boxes, shared footer
geometry, masthead spacing, non-presumptive focused status and cancelled detail
without an action rail. It must show like-for-like before/after frames and must
not revive C4's large route rows.

## Round 2 owner verdict — 2026-09-03

Workshop: `/tmp/trains-comps-home-interaction-r2/`; sheet: `index.html`.

22. **Use `RUNNING`, not `FOLLOWING`.** The owner preferred the round-two
    `RUNNING` variant. This replaces `ON THIS TRAIN` in both the focused smart
    header and the matching saved-trip row without claiming that the user is
    physically aboard.
23. **The status becomes `RUNNING LATE` when the train is late.** Use the
    appropriate existing warning colour scheme for the late state. Freshness
    remains a separate fact: a late train may still have a green `LIVE`
    indicator because the data is current.
24. **Round-two C2 corrections carry forward.** The focused transfer restores
    its coloured platform 3 and 5 boxes; detail uses `Rhodes departures`, an
    18px summary-to-divider gap, and a `Take this train` rail with the same
    geometry as `New trip`; cancelled detail has no bottom action rail. The
    unequal-but-baseline-aligned header clocks remain unchanged.

Round 3 is a focused calibration pass, not a reopened composition round. Show
`RUNNING` and `RUNNING LATE` together in dark and light schemes, in the smart
header and saved row, while keeping `LIVE` visually independent. The late state
must be derived from realtime delay on the relevant active service; stale,
scheduled-only or cancelled data must not manufacture `RUNNING LATE`.

## Round 3 owner verdict and round 4 brief — 2026-09-03

Workshop: `/tmp/trains-comps-home-interaction-r3/`; sheet: `index.html`.

25. **Use C3 for lateness.** The owner preferred C3. When the relevant active
    train is late, the complete `RUNNING LATE` status and the large active
    countdown use the existing warning colour. `RUNNING` remains quiet when the
    train is not late; green `LIVE` remains an independent freshness signal.
26. **Journey detail is hard to understand and has lost visual coherence with
    the trip-results screen.** The next round must redesign the two screens as
    one information system rather than styling detail in isolation.
27. **Trip-result rows are too large.** Reduce their generous top and bottom
    padding. Make the left `<x min>` figure about 10–15% smaller, vertically
    centred and cleanly right-aligned within a stable figure column.
28. **Separate departure time from the countdown.** The bold departure time and
    the large countdown currently carry similar weight, making them hard to
    distinguish at a glance. Rebuild the type hierarchy so the action figure is
    unmistakable and the clock remains easy to scan.
29. **Reconsider inset row dividers.** Their left and right margins make each
    result appear to leak into the next. Explore full-width ledger rules and
    other house-native grouping patterns. Material Design may inform tap and
    state behavior, but it is an option to test rather than a visual mandate.
30. **Show transfer station and destination platform during discovery.** For a
    journey with a transfer, the two critical facts are where to change and
    which platform to go to. The result row already shows coloured lines and
    platform boxes, but a user browsing results must also see the transfer
    station without opening detail.
31. **Journey detail must reveal the same transfer facts immediately.** Opening
    a result should preserve visual continuity and make the transfer station and
    boarding platform instantly legible. Limited phone space is a constraint,
    not a reason to omit either fact.

Round 4 explores 3–5 coherent result/detail systems using the current visual
language and real data. Each direction must solve density, figure alignment,
type hierarchy, row boundaries and transfer discovery together. It must show
direct, one-change, long-name, delayed, cancelled, scheduled-only, deep-scroll
and both-scheme states at 390×844 and 412×732. Six returned services remain
whole and reachable; no direction may hide transfer facts behind interaction.

## Round 4 owner verdict and lock corrections — 2026-09-03

Workshop: `/tmp/trains-comps-home-interaction-r4/`; sheet: `index.html`.

32. **Lock C1, the full-rule ledger.** Its 96px result rows, stable
    right-aligned countdown column, quieter departure clock, full-width row
    rules, transfer-station labels attached to the existing next-platform
    markers, and promoted-result detail bridge are the chosen composition.
    The reduced detail summary `1 change · arrives 10:08` is accepted as part
    of C1.
33. **Reject C3 and C4.** The continuous index and timetable bands are no-gos.
    C2 is also not carried forward; round 5 corrects C1 only and does not reopen
    the composition.
34. **Do not truncate a line name or headsign while usable row width remains.**
    The two-change C1 frame unnecessarily reduces `Gordon via Lindfield` to
    `Gordon…`. The correction must preserve the complete service name wherever
    it can fit by rebalancing the row, not by increasing its 96px height or
    hiding transfer station/platform facts. Ellipsis is only the last resort
    after all critical transfer information remains visible.
35. **Central to Parramatta must read as T1 yellow, not brown.** The existing
    light-scheme readable override makes the T1 journey bar look brown and
    weakens TfNSW line recognition. Correct the route-colour treatment while
    retaining legible platform numerals and the previously approved light-mode
    chip treatment.
36. **Restore the tight-transfer colour on the journey axis.** In a tight
    connection, the transfer segment between the alighting and boarding
    platform markers uses the warning colour. Round 4 left that segment grey in
    the promoted result on detail. The compact row and expanded detail must use
    the same tight-transfer semantics.

Round 5 is a like-for-like C1 correction pass. It must show the owner frames
beside corrected dark and light results, the two-change stress without
unnecessary service-name truncation, Central to Parramatta with a recognisable
T1 treatment, and tight result/detail frames with the warning-coloured transfer
gap. Re-run the 390×844 and 412×732 geometry, reachability, colour, contrast and
true-axis probes. These corrections may rebalance C1 internally but may not
increase row height, remove transfer facts, revive rejected concepts or change
the locked interaction and copy rules.

## Round 5 correction result — 2026-09-03

Workshop: `/tmp/trains-comps-home-interaction-r5/`; sheet: `index.html`.

- Removing C1's artificial 42% and 20% headsign width caps restores the full
  `Gordon via Lindfield` in every normal, North Strathfield and two-change
  sample. The minimum measured headsign-to-transfer-label gap is 5.09px; no
  sample clips. Row height remains 96px.
- Filled line devices and bare line-colour text need separate colour roles.
  The corrected light comp uses official `#F99D1C` for T1 and BMT fills and
  keeps the readable `#A46204` only for bare text. Official yellow with primary
  dark ink measures 8.79:1; with paper it measures 2.02:1 and fails the binding
  3:1 filled-device rule. Owner approval of the dark-ink exception remains the
  only open call.
- A tight transfer now paints only its dwell segment with the existing warning
  colour in both compact and promoted results. The adjoining ride segments keep
  their T9 and T4 colours. At the tested journey proportions the dwell is
  7.11px wide at 390px and 8.11px at 412px.
- The final 64-frame matrix covers sixteen states, two phone frames and both
  schemes. It has no viewport mismatch, overflow, clipping, track invasion or
  undersized targets; true-axis deviation is at most 0.1px and all six services
  remain reachable.

## Round 5 owner verdict — 2026-09-03

37. **Use paper-white text consistently on official T1/BMT yellow.** In light
    mode, filled T1 and BMT route devices use the official `#F99D1C` yellow with
    the same paper-white text treatment as the other light-scheme line devices.
    Do not introduce a dark-ink exception. This owner ruling knowingly prefers
    visual consistency and TfNSW line identity over the proposed contrast
    optimisation: paper on the exact yellow measures 2.02:1. If later device
    testing proves an adjustment necessary, the yellow may be darkened only by
    a tiny, visually imperceptible amount; it must never return to the visibly
    brown `#A46204` fill.

The full-rule ledger and all interaction, copy, density, transfer-discovery,
late-state, cancellation and focus-preservation rulings are approved. The
design phase is complete. The build must update the durable UI contract in the
same change as the implementation, replace the affected calibration exemplars,
and retain a regression check for the exact approved T1/BMT fill and foreground.

Final approved synthesis: `/tmp/trains-comps-home-interaction-r6/`; sheet:
`index.html`. Its 64 fresh captures apply exact `#F99D1C` with paper-white
`#FAF9F5` text to light-scheme T1/BMT filled devices and preserve every other
round 5 correction. The focused and standard probes report no geometry,
overflow, clipping, reachability or state-presentation failures; the accepted
2.02:1 colour exception is measured and explicit rather than waived silently.


## Owner rulings 2026-09-02, relayed from the comps-harness shakedown round

These arrived in a separate session while this round was open. They are
binding for this round's comps and are kept near-verbatim. The shakedown
sheet that prompted them is `/tmp/trains-comps-shakedown/index.html`; its
code-level findings are in `OPTIONS.md` beside it.

9. **Cancelled rows are dimmed like past rows.** "The coral cap is only
   supposed to show for tight transfers, not for cancellations. I'm thinking
   we should also 'dim' cancellations the same way we dim 'past trips' so the
   user knows they can't take this trip." Dimming is in type colour, as for
   past rows, never container opacity; the `CANCELLED` provenance word stays
   coral because it names the exception; the cancelled-lead copy
   `<time> CANCELLED · NEXT TRAIN` stays. Joins item 1 above.
10. **The header's two clocks.** Owner, on the locked exemplar where the
    arrival block sits lower than the departure block: "Bondi Junction
    appears below Rhodes, it looks weird." The contract already asks for
    both: station names share one top edge AND times share one baseline. The
    exemplar met the baseline by dropping the whole arrival block; the
    shipped app met the top edge and lost the baseline. Comps show the
    version that meets both (names on one row, times on one baseline row,
    the smaller arrival time's gap absorbing the difference) beside the
    alternative of equal-size times, as a before/after pair.
11. **The top line answers "how far am I from my station", not "tracking".**
    Owner: "honestly, as a user, I want to know how far away Rhodes station
    is from me. And if I'm already at Rhodes station, only then would I want
    to see the status text instead of the distance text." And: "I'm not
    convinced that 'tracking in reverse' is the right copy either." So the
    line above the header is the distance to the origin station when a
    location fix exists and the user is not at it; the status text when they
    are at it, once boarded, or when there is no fix. No "IN REVERSE" copy
    anywhere; the receipt already explains a reversal. Distance uses the
    one-shot fix on open (client-storage.md), never continuous tracking.
    States to comp: far, near, at the station, boarded, no fix, reverse.
12. **Station names are shortened only when they must be, by rule.** Owner
    asked how. Proposal for the comps: the full name wherever it fits; when
    a line would otherwise be cut off, apply an ordered rule set (drop
    "Station", "Junction" → "Jn", then compass words), never a hand-kept
    table, and never ellipsise a station name. Decide after item 11, since
    it changes what that line carries.
13. **Light-scheme platform numerals are white on the chip** (owner: "white
    numbers look better on the light mode"). The shipped app is right; the
    two light exemplars are being re-shot in the regression fix landing
    beside this round.

Regressions against the LOCKED design found by the same round (cancelled row
loses its arrival time; `CANCELLED` label dropped 15px by a stray
`min-height`; the cancelled lead paints the coral tight-change gap; the
saved-trip distance lost its bold) are NOT this round's scope: they are being
restored to the current contract by a fix agent on a worktree, with tests,
so this round's comps start from a client that matches its exemplars.

Landed 2026-09-03 (merge `59e8682`): the four regressions above are restored
with a unit test each; the board's `delayed`, `past` and `cancelled` frames
diff at 0px against their exemplars. Two things the restoration found that
belong to item 9's build: `web/js/board.js` still paints the coral tight-change
gap on a cancelled service that also has a tight connection (the catalogue's
cancelled scenario has no tight change, so no comp shows it), and its warning
text hardcodes the first change. And `home-390x844-before-light.png` is now a
real-client shot seeding ONE saved trip where the dark exemplar shows three;
the home exemplar family should be re-shot together when this round closes.

## Build-stage owner rulings — 2026-09-03

Asked when the build plan was written; recorded here so every brief cites the
doc. The plan (`build_plan.md`, "Decisions taken at build time") applies them.

38. **The smart header is read-only.** It is not a tap target. The saved-trip
    row for the header's trip says `SHOWN ABOVE` and carries the same
    `DEPARTURES ›` cue as every other row.
39. **Detail for the already-focused train has no action rail.** Same shape as
    cancelled detail: the top `<departure station> departures` control is the
    way out. There is no manual unfocus anywhere; focus clears itself 30
    minutes after arrival.
40. **A realtime-shortened change prints only its current window.** The
    change step reads `2 MIN CHANGE` as the C1 frame rendered it; no printed
    or previous window is appended, and the contract sentence requiring one is
    retired with this build.
