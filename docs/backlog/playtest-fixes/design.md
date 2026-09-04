# Playtest fixes (round of 2026-09-04)

The owner's review of the shipped board v2 client, plus a code review, found
a set of bugs, honesty defects and dead weight. This item ships the fixes.
It does not redesign anything: the one open compositional question, the
smart header's height, runs as a comps round inside this item and is built
only after the owner's verdict. The location-first smart header the owner
described on 2026-09-05 is a separate item, `docs/backlog/smart-header-v2/`.

## The owner's words (spec)

1. "the orange 'tight change' doesn't appear until after you board the
   train"
2. "mouse scroll on desktop can become unresponsive if you scroll too fast,
   and there's a scroll bar, and it says 'timetable only' which doesn't
   make sense"
3. "I think the smart header is maybe slightly a tiny bit too tall"
4. On past rows with no actuals: "don't we have the time that it was
   scheduled to leave? doesn't that give us an <x> min ago?"
5. On the way home: "as a user I would want the app to know that I'm at
   Bondi Junction, and if my home station tends to be Rhodes, it should
   suggest it to me in the smart header." And: "new user experience should
   work out of the box too for smart header", "why is there a hardcoded time
   of 14:00? ... that seems like a silly rule."

## Rulings (2026-09-05)

- **Past rows without actuals** show the elapsed figure counted from the
  scheduled departure with `AGO` beneath, the same figure treatment as a
  row with actuals. What still distinguishes the two registers: only a row
  with actuals can carry a struck scheduled time and a delay. The owner
  chose this over `SCHEDULED` beneath the figure, knowing that a late train
  whose actuals have aged out reads as having left on time. `TIMETABLE ONLY`
  leaves the provenance vocabulary.
- **Desktop scrollbar**: hidden on every scroller. The board has no labelled
  scroll affordance by contract; the bar was the only one.
- **Header height**: a full comps round first (design-comps skill), owner
  verdict, then build. Not a number picked in code.
- **Way home this round**: the location floor only (below). No clock rule
  anywhere. The full location-first header is `smart-header-v2`.
- **Copy**: every new string is drafted by Codex and verdicted by the owner.
  The verdicts are recorded in "Copy" below as they arrive.

## Defects and mechanisms

### 1. Tight change invisible before departure (`web/js/focus.js`)

`directionsModel` returns from the `nowMs < depMs` branch before the risk
computation that sets `model.tight`. The board row and journey detail read
the same numbers through `journeyDetail` and paint the change. Verified with
the fixture's real 4-minute change: at 10:30 `tight` is false while
`changes[0].tight` is true.

Mechanism: the risk is computed once, before the phase branches, from the
`changes` that `journeyDetail` returns (single source of the tight rule; the
duplicate computation in focus.js is deleted). `model.tight` is true in every
phase while the tight change is still ahead (`nowMs < change.departure`).
The dwell segment paints in the warning colour in every phase. The
instruction strings do not change (owner ruling under "Copy"): before
departure the line is still the headsign, so the paint alone carries the
warning there.

### 2. The whole screen is rebuilt every second (`web/js/main.js`)

`timers.tick` calls `renderCurrent` every second, and each renderer writes
`innerHTML` for the whole view. That discards the element a mouse wheel is
scrolling, cancels the browser's smooth scroll, restores a stored
`scrollTop`, kills text selection and keyboard focus, and re-runs
`clampJourneyBars` and `fitStationNames` every second. Nothing on screen
changes per second except the freshness age text.

Mechanism: a view renders to a string; the DOM is written only when that
string differs from the last one written for the view. The freshness age
text is patched in place on its own node every tick. The tick keeps its
one-second cadence so minute rollovers and the `Now` row are still exact to
the second. Verification is a real-client probe: scroll the board with wheel
events across three ticks and assert the scroller is the same element and
its `scrollTop` is what the wheel put there.

### 3. Departed services vanish instead of dissolving into the past

`dissolveDeparted` and `patch` in `board.js` are stubs, while ui.md binds "a
departed service dissolves before the timeline closes upward". Separately,
a just-departed service is only in the past register if the initial past
page (fetched at now minus sixty minutes, six rows) reaches it; on a
frequent corridor it does not, so the train you just missed is in neither
register.

Mechanism: the client keeps the last live copy of every journey it has seen
this board session, keyed by `journeyKey`, and feeds those copies as one
extra past page. The existing dedupe (live wins over past) and the actuals
gate (`estimated` present) already do the rest, so a departed service shows
as an actuals past row from its last live estimate. The dissolve: when a
rebuild would drop a future row, the row gets a `departing` class and fades
over 240ms before the rebuild; `prefers-reduced-motion` skips the fade. The
`dissolve` state in `tools/shoot-states.js` is the gate.

### 4. Past rows without actuals (`web/js/rowmodel.js`)

Today: empty figure, `TIMETABLE ONLY` provenance overflowing the column by
24px. Ruling above: figure counts from the scheduled departure, `AGO`
beneath, quiet scheduled weight for the numeral (the `sched` class), no
struck time, no delay. `rowLines` invariant unchanged. The
`board-390x844-past.png` exemplar is re-shot. The `NOTE` in shoot-states
about the overflow is deleted with the overflow. ui.md's "Past, stale and
exceptional data" and the closed vocabulary lose `TIMETABLE ONLY`; the
roadmap's open question is removed.

### 5. Receipts without evidence (`web/js/home.js`)

`homeModel` prints "You check this trip most weekday mornings." whenever
any history exists and there is no fix, for any trip, on any day, even for
an explicit tap. The contract says a receipt explains a meaningful leap and
names real evidence.

Mechanism: the view-history receipt appears only when all of: the shown trip
was chosen by prediction (not a tap, not a focus; `main.js` passes
`predicted`); at least two trips are saved; and the winning candidate has at
least three history events with `hourProximity > 0` and matching day type.
"most weekday mornings" requires now to be a weekday before 12:00 and those
events to fall on at least three distinct days; otherwise "You often check
this trip around now." Both strings are unchanged. Otherwise no receipt.

### 6. Loading header reads `TIMETABLE ONLY` (`web/js/home.js:126`)

The provenance slot is empty while the first board loads (Codex, slot D).

### 7. Mid-journey cancellation names the wrong leg (`web/js/focus.js`)

When a later leg is cancelled after departure the instruction reads
`09:24 CANCELLED · NEXT TRAIN`: the 09:24 left fine. The line must name the
cancelled leg's departure time and station. Copy below. The pre-departure
form (`<time> CANCELLED · NEXT TRAIN`, showing the next running service) is
unchanged and remains contract.

### 8. The way home: location floor (`web/js/predict.js`)

`score = (history + 0.01) × locationFactor`. With no fix every floor is
equal and the fallback (last viewed, then first trip forward) is unchanged.
With a fix within 2 km of a direction's origin and more than 2 km from the
other's, that direction wins on location alone: reverse 0.01 × 2.5 = 0.025
against forward 0.01 × 1.0 = 0.01. Any history still dominates: 0.5 events
of history outweigh the floor. `predict`'s tie rule (`best > 0 &&
leaders.length === 1`) is unchanged; ties fall back as before. Contract:
client-storage.md "Geolocation term".

### 9. Location ask nags (`web/js/main.js`, `home.js`, `storage.js`)

"Not now" is in-memory, so the panel returns on every open with two or
more trips. Mechanism: the document gains `locationAsk: {declinedAt}`;
after a decline the panel stays away for 30 days. A permission the
Permissions API reports as `denied` suppresses the panel entirely, and
`granted` already takes a silent fix. Contract: client-storage.md schema.

### 10. Enter and Search do nothing in setup (`web/js/setup.js`)

Enter, or the keyboard's Search key, on a field with results picks the top
result. With no results it does nothing.

### 11. Clock times print in the device zone (`web/js/time.js`)

`clock()` formats with `Australia/Sydney` explicitly. Prediction's hour and
day-type buckets stay device-local as the contract says; only printed clock
times change, and only on a phone outside Sydney.

### 12. Stops cache key is the raw query (`internal/api/server.go`)

The key is the trimmed, whitespace-collapsed, lower-cased query, so
`Central` and `central` are one upstream call. The upstream request sends
the same normalised text. Test in `server_test.go`.

### 13. Dead weight

- `web/js/trips.js` is unrouted and calls `ctx.selectTrip` and
  `ctx.tripRemoved`, which do not exist. Deleted, with its `sw.js` SHELL
  entry (VERSION bumps to `v14`) and its CSS: `.mast*`, `.sheet`, `.field*`,
  `.results*`, `.act*`, `.trip*` and their 900px media rules. `.hint` stays
  (setup uses it).
- `state.onBoard`, `sameRowSet`, `splitFigure` and the `patch` stub go;
  `dissolveDeparted` becomes real (defect 3).
- The platform-prefix regex exists four times (`rowmodel.js`, `focus.js`,
  `journey.js`, `journeybar.js`); one `platformNumber` in `journey.js`.
- `figureHtml` exists in `board.js` and `home.js`; one function in `dom.js`
  taking the unit class.
- The tight-change window is computed in both `focus.js` and `journey.js`
  and they disagree on the broken case; `journey.js` is the source (defect 1).
- `index.html`'s `apple-mobile-web-app-title` says `Departures`; the
  manifest says `ilovetrains`. Aligned to `ilovetrains`.

### 14. Smart header height (comps round)

Measured in the built client at 390×844: the header section is pinned at
its 226px `--hdmax` while its content is 157px, leaving 35px above and 33px
below beyond the 18/16px padding. With the 56px top line the block is 284px
from the frame top to the rule. The cap appears sized for the receipt case
(content 190px plus padding 34px fills it), so the common no-receipt frame
carries the slack. Frozen: the information grammar, copy, type ladder,
journey device, the shared clock baseline, the receipt's existence. Open:
vertical composition only, and the policy for the receipt row (reserved
slot versus content-sized with a shift). Round output: a contact sheet the
owner opens, a verdict, then the build and re-shot home exemplars.

## Copy (Codex drafts, owner verdicts)

Slot A (past provenance): superseded by the ruling that the figure returns
with `AGO`.

Slot D (loading provenance): empty. Accepted 2026-09-05 as the only honest
option.

Slot C (later leg cancelled while riding): owner ruling 2026-09-05, "all
the suggested are too long": the line is `<HH:MM> FROM <STATION> CANCELLED`,
naming the cancelled leg's departure clock time and its boarding station,
e.g. `09:58 FROM TOWN HALL CANCELLED`, in the header's uppercase label idiom
with `warn` set. The top line's `CANCELLED` status is unchanged.

Slot B (tight change): owner ruling 2026-09-05, "Today's copy is fine."
Every instruction string stays as shipped: the headsign before departure,
`Get off at <station> · Platform <n>` riding, `Change at <station> ·
Platform <n>` dwelling, and `Tight change · <n> min · Platform <n>` in place
of either once the change is tight. The receipt `Printed change was <n>
min.` stays. Only the paint changes: the dwell segment is warning-coloured
in every phase, including before departure. Codex's drafts are rejected.

## Rejected

- Widening the figure column to keep `TIMETABLE ONLY`: geometry change on
  every board exemplar for one word.
- `SCHEDULED` beneath a past elapsed figure: the owner preferred one
  register for elapsed time.
- A "homeward after 14:00" prediction term: clock rules rejected by the
  owner; the real answer is `smart-header-v2`.
- Re-adding a reverse control or a trips screen with delete: both were
  deleted by owner rulings in board v2 and are not reopened here.
- Rendering with a virtual DOM or keyed patching: string equality plus one
  patched text node removes the per-second rebuild with no new machinery.
