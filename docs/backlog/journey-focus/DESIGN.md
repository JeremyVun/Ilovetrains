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
