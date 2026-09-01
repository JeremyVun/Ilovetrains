# Journey focus & detail — Design

Owner-requested 2026-09-01 after live use: "no way to focus on a trip, see
past trips, or drill down to see the transfers. once I'm on a trip, I can't
go back and view that trip again because it was in the past."

Self-contained with `docs/contracts/api.md` (legDetail addition),
`docs/contracts/client-storage.md` (focus addition), `docs/STYLES.md`
(binding design language; B·Editorial exemplar governs).

## What

1. **Journey detail** — tap any board row → a detail view of that journey:
   every service leg (line, headsign, both platforms, times with realtime),
   the transfer station(s) and computed change time between legs, honest
   states per leg (delayed / cancelled / scheduled-only).
2. **Focus ("I'm on this train")** — from detail, focus the journey. A
   focused journey stays fully viewable — including after it departs, and
   offline — until ~30 min past arrival or manual unfocus. The board carries
   a compact focused strip (glance: arrival time + minutes to go) linking
   back to detail. Snapshot + re-match semantics per client-storage.md.
3. **Transfer data** comes from the same cached departures response
   (legDetail) — no new endpoints, no extra upstream calls.

## Verdict (owner, 2026-09-01)

Comps round complete (6 comps, 48 shots, `comps/` beside this file).
**A1 · Ledger** is the detail exemplar, **B2 · Footer rail** the focus
exemplar — shot paths, transplants and the new provenance vocabulary
(`TO CHANGE`, `ON BOARD`, `MIN TO GO`; detail view exempt from the
three-line invariant) are recorded in `docs/STYLES.md`. The sixth-service
cost of the strip is paid by scrolling (owner ruling), never by hiding a
service. Data notes from the round that bind the build:
- Change windows use time.js's floor-to-clock-minute rule so the change
  figure always agrees with the printed times.
- A cancelled leg's replacement can arrive at a DIFFERENT platform (real
  case: the 10:12 T4 arrives Bondi Junction Platform 1, not 2) — the detail
  view must re-read the arrival platform from the replacement, not assume it.
- Tight connections are normal on this corridor (a real 4-minute change
  exists in the fixture with no delay applied) — the tight treatment is not
  an edge case.

## Built (2026-09-01)

Shipped in `web/`: route `#/journey` (`js/journey.js` — the pure model,
`js/detail.js` — A1's markup), focus per client-storage.md (`js/focus.js`,
`storage.js`), the B2 strip in `js/board.js`, the styles in `app.css`. Shots of
every state, both frames and both schemes, in `shots/` beside the comps.

Five calls the port had to make, each of them a place where the comps' data and
the API's data differ or where the exemplar had no case:

1. **No replacement service.** A1's `cancelled` comp showed the next T4 taking
   the cancelled one's place, which the comps' own data.js constructed by hand;
   `/api/v1/departures` has no such field. What ships is honest about what we
   know: `legDetail[].cancelled` strikes THAT leg in the board's idiom and the
   arrival line is struck with it. The rule the comp was really demonstrating —
   re-read the arrival platform from the leg that arrives, never assume it — is
   kept, and tested.
2. **Tight and shrunk are two things.** `PRINTED CHANGE WAS N MIN` and the
   struck arrival time are printed only when the window actually shrank; a
   change that is merely short (the real 4-minute one, no delay) gets the coral
   figure without a sentence saying the printed change was the same 4 minutes.
3. **A leg that is behind you** has no case in the comps. It keeps its place in
   the ladder and empties its figure slot, which is the stale board's own
   mechanism, rather than inventing a word for the provenance slot.
4. **The third line is the headsign**, not "Northern Line to Gordon via
   Lindfield": the API carries the badge code and the headsign, never the full
   line name. Same third line the board prints.
5. **`ON BOARD` counts to the door.** OPTIONS.md offered A2's leg DURATION
   under that label; the round's own artifact (`comps/onboard.js`, which every
   surface-B comp rendered) counts minutes until you step off, which is the
   number you look at while standing up. That is what shipped.

Known cost, faithful to B3: `you arrive Bondi Junction` does not fit the
strip's body column beside a 20px clock time and wraps to its own line, exactly
as it does in `b3-lead-390x844-boarddeparted.png`. The departed strip is
therefore ~24px taller than the waiting one.

## Frozen IA (comps explore COMPOSITION only)

- Board row → detail (whole row is the tap target; no new chrome on rows).
- Detail: masthead idiom (trip name, back affordance); legs in order;
  transfer(s) between legs showing station + change minutes; focus action;
  focused state visibly different from unfocused.
- Board with a focus active: one compact strip, tappable → detail; rows
  otherwise unchanged. Strip survives the journey leaving the board.
- All existing binding rules hold (three-line rows on the board, provenance
  vocabulary, honest states, stale treatment).

## Out of scope (backlog candidates, owner may pull in)

- A browsable "earlier departures" list on the board (past journeys beyond
  the focused one).
- Per-leg walk directions inside stations; vehicle position (`stopsAway`).

## Data reality (from fixture trip_rhodes_bondijunction.json, 2026-09-01)

- Real transfer shape: T9 Rhodes Pl 1 → Town Hall Pl 3, change to T4
  Town Hall Pl 5 → Bondi Junction; change windows can be a few minutes.
- Upstream leaks class-10 "On Demand" bus legs past the exclusions —
  journeys containing them are excluded server-side (api.md).
- Class-99/100 walking legs exist between platforms; folded into transfer
  time, never listed.
- A delayed first leg can make a printed change time impossible — the detail
  view must render a tight/broken connection honestly (comps stress case).
