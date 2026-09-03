# Home interaction and boarding

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

1. What non-presumptive status replaces `ON THIS TRAIN` for a selected train
   that the user may only be following?
2. Should the smart header keep unequal-but-baseline-aligned departure and
   arrival clocks, or make both clocks the same size?

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
