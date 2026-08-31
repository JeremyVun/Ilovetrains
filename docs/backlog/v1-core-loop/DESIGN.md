# v1 core loop — Design

Self-contained with `docs/contracts/api.md`, `docs/contracts/client-storage.md`
and `docs/references/tfnsw-open-data.md`.

## What

The daily-use loop, end to end: open the app → the departure board for your
predicted saved trip is already there → glance → go. Plus the minimum around
it: first-run trip setup and trip management. Trains and metro only.

## Design (decided 2026-08-31)

Comps round complete; owner verdict: **B · Editorial** is the calibration
exemplar. Binding rules, palette, and the stale-board ruling are in
`docs/STYLES.md`; the full exploration (four concepts, stress shots,
instrument notes) is in `comps/OPTIONS.md` beside this file. Build the
departure board against `comps/shots/b-editorial-390x844.png` and its stress
variants — the exemplar image outranks any prose description of it.

## Screens

1. **Departure board (home).** Header: trip name ("Central → Parramatta"),
   flip-direction button, trip switcher (only if >1 saved trip). Body: next
   ~6 journeys — big minutes-until number, estimated departure time, platform,
   line badge, arrival time, delay/cancelled/stale indicators per
   `api.md` semantics. Auto-refresh every 30s while visible (pause when tab
   hidden). First paint from `cache` in localStorage, live data replaces it
   without layout shift.
2. **First run.** Shown when no saved trips: one-line pitch → origin search →
   destination search (autocomplete via `/api/v1/stops`) → save → home.
3. **Trip management.** List saved trips; add (same search flow), delete,
   reorder. Reached from an unobtrusive edit affordance on home.

## Decisions

- **`trip` endpoint, not `departure_mon`.** A station-pair board must exclude
  services that don't reach the destination; only `trip` can do that. It also
  returns arrival times and platforms in one call.
- **Prediction per `client-storage.md`** — deterministic, documented,
  overridable. No geolocation in v1 (rejected: permission prompt cost >
  benefit while the heuristic is unproven).
- **Refresh cadence 30s** matching server `s-maxage=30` — faster polling
  can't produce fresher data by construction.
- **No build-step frontend framework.** Vanilla ES modules + template
  literals (or lift to Preact only if state wiring proves painful — decide in
  Phase 2, record here). Rejected: React/Vue-scale stacks — the app is two
  screens and a list; the perf budget is the point.
- **Rejected for v1:** general trip planner, other modes, push notifications,
  alerts UI (alerts surface only as `cancelled` flags for now).

## Client implementation notes (Phase 2, 2026-09-01)

Where the exemplar and the owner rulings needed a decision to become code.
The images in `comps/shots/` still outrank this prose; these are the choices
the prose did not cover.

- **Cancelled lead.** The cancelled row stays in place, exactly as the
  exemplar draws it. C's copy is carried by the *next running service*, in that
  row's third-line slot in coral, replacing the headsign for that row only. A
  fourth line would break the three-lines invariant, and the headsign is the
  least load-bearing line on a station-pair board. The string is
  `22:48 CANCELLED · NEXT TRAIN` at the full label idiom (owner ruling
  2026-09-01 A). It was `… NEXT RUNNING SERVICE` set at 9px/.05em — the only
  type on the board outside the ladder, and it still did not fit a 360px phone.
  Below 375px the page margin flexes 22px → 18px, which is what buys the last
  few pixels: the type is the design, the margin is the sheet.
- **Stale board.** The figure slot empties (no countdown off stale data) but
  keeps its height, so the board reads as "the figures are gone" rather than
  as a new layout. The provenance slot then says `SCHEDULED`; a cancelled row
  still says `CANCELLED` and keeps its `–`. Departed rows are dropped, the
  rows dim to 55%, the footer goes coral: `OFFLINE · LAST UPDATED X AGO`.
  A dash in the figure slot was rejected: it is the cancelled row's glyph.
- **Masthead words.** `REVERSE` always; `SWITCH TRIP` only with more than one
  saved trip (per the frozen IA); `EDIT` always, as the unobtrusive route to
  trip management. With one trip the masthead keeps the exemplar's two words.
  Both words lead to the same screen, which is both picker and editor.
- **Minutes arithmetic** is the difference between clock *minutes*, not
  wall-clock subtraction, so the figure can never disagree with the two clock
  times printed beside it, and a service holds its row (`Now`) for the whole
  minute in which it leaves.
- **Past 99 minutes the figure changes unit** (owner ruling 2026-09-01 B):
  `187` is `3H`, rounded to the nearest hour. `rowmodel.figureFor` owns the
  rule; `HOURS_FROM_MIN` is the boundary. The `H` is markup, not just a
  character — `board.splitFigure` puts it in a `.unit` span set at 0.40em on
  the numeral's baseline, because flat at the hero size `3H` is 91px in an 86px
  column and reads as a code rather than as a quantity. `patch()` adds and
  removes that span as a row counts down across the boundary.
- **Three-character figures still step down a size.** `187` and `Now` are 129px
  and 91px wide against an 86px column at the headline size, and nothing clips
  them: the hero figure was drawn through the departure time beside it.
  `rowmodel` marks such a row `wide` and the stylesheet sets it one step
  smaller. Ruling B retired the three-DIGIT case but not the rule — `Now` is
  three characters, and so is any service that rounds to `10H` or beyond — so
  the step-down stays, guarded by the in-browser figure-overflow invariant.
- **The `Now` row's provenance is `DEPARTING`** (owner ruling 2026-09-01 D),
  not `MIN`: the figure is not a count of minutes, so the slot names the event.
  It never displaces a more specific word — late, scheduled-only and cancelled
  rows keep theirs.
- **A board that was never loaded reports no age.** With no `generatedAt` at
  all there is no "last updated": the footer is empty with a resting grey dot
  while the first answer is in the post, and reads `OFFLINE` (no age) when the
  answer never comes. It used to say `OFFLINE · LAST UPDATED 0S AGO`, which
  dated a board that did not exist and called a client that was still asking
  offline.
- **Light mode** (owner ruling 2026-09-01 C) is one `prefers-color-scheme`
  block of custom properties in `app.css` plus two things that are not colours:
  the default font smoothing (`antialiased` thins dark-on-light type), and the
  stale board's dim, which moved from the rows container onto the rows so it
  stops washing out the one-line hint that stands in for them. Line badges are
  painted through `var(--line-XX)` rather than a hex from `lines.js`, because
  the badge colour is scheme-dependent and the inline style is not. Values,
  measured ratios and the rejected filled-chip alternative: `docs/STYLES.md`.
- **`X-Data-Stale`** dims the freshness dot but does not drop the figures:
  the server serving from its own stale window can still be seconds old, and
  `generatedAt` age already governs the stale treatment.

## PWA notes (Phase 3, 2026-09-01)

`web/manifest.webmanifest`, `web/sw.js`, `web/icons/*` (generated by
`tools/make-icons.sh` from `tools/icon.html`), and a two-line registration in
`index.html` that runs on `load`, so nothing about the worker sits between a
cold open and the board. The client's modules are untouched by it.

- **Shell cache-first, data network-first.** A deploy bumps `VERSION` in
  `sw.js`; the new worker precaches the whole shell as one set and deletes
  every older cache on activate (verified: after a bump only the new cache
  survives, and it holds all 19 shell files). `web/test/sw.test.js` fails if a
  module or icon is added without being precached — one missing path makes
  `addAll` reject and the install fail silently.
- **The worker cannot make stale data look live.** A replayed `/api/` response
  carries its original `generatedAt`, so it lands in the ordinary staleness
  treatment: seconds old it counts down and says so, past `STALE_MS` the
  figures go and the board dims. The app reports the age of its data, not the
  state of the network — which is why an offline open a minute after the last
  fetch shows a countdown and `UPDATED 40S AGO` (both true), and one an hour
  later shows clock times and `OFFLINE`.
- **A failed `/api/` fetch with nothing cached is allowed to reject**, because
  `api.js` reads a rejection as offline and a synthetic 503 would only travel
  further before saying the same thing.
- Go's MIME table has no `.webmanifest`, so the server registers
  `application/manifest+json` (`internal/api`, guarded by a test) — without it
  the manifest arrives as `text/plain` and the install prompt never appears.

## Experience bar (acceptance)

- Warm open → correct predicted board visible < 500ms (cached paint), live
  data < 2s on 4G.
- Zero taps for the daily case; wrong prediction is 1 tap to fix (flip) or
  2 (switch trip).
- Delay, cancellation, no-realtime, stale-data, and offline states all
  visually distinct and honest.

## Open questions (resolve during build, fold answers back in)

- ~~Exact TfNSW params/paths~~ — resolved by Phase 0 probes 2026-08-31; see
  reference doc. Remaining **[verify]**: quota numbers, metro product class,
  cancellation signal shape (needs a real disruption to observe).
- Whether metro journeys need any presentation difference beyond the badge
  (M1 teal never exercised against real data in the comps round).
- Whether the headsign line ("Penrith via Parramatta") earns its place on a
  station-pair board where every service goes via the destination by
  construction — it is the string that forces every truncation decision.
  v1 keeps it per the exemplar; revisit after living with it.
- Stale-board behaviour: RESOLVED (owner 2026-08-31) — clock times only past
  the staleness threshold; see STYLES.md binding rules.
