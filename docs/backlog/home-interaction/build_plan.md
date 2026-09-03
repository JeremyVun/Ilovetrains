# Build plan — trip selection and journey readability

Companion to `design.md`, which holds the owner's rulings (items 1–37) and
is the spec. This plan turns the approved comps into the web client. A phase
brief is this file, `design.md`, the two contracts it cites and the comp
workshop paths named below; nothing else is needed.

## Source material

| Screen | Approved comp | Port from |
| --- | --- | --- |
| Departure board rows | C1 full-rule ledger, round 6 | `/tmp/trains-comps-home-interaction-r6/` — `r6.css`, `r6.js`, `shots/c1-full-rule-*` |
| Journey detail | C1 promoted-result detail, round 6 | same workshop, `detail-*` scenarios |
| Smart home | C2 action rail (round 2) with C3 late treatment (round 3) | `/tmp/trains-comps-home-interaction-r3/` — `round.css`, `round.js`, `shots/c3-status-time-*`; `/tmp/trains-comps-home-interaction-r2/shots/v3-running-*` for the five-trip and reverse frames |

Both workshops were rendered on `base.css` byte-identical to the shipped
`web/app.css` (SHA-256 `e79ba3ea…`), so their round CSS is a delta on the live
cascade, not a fresh stylesheet. A port keeps the live cascade and lands the
delta; it does not restyle.

Every measurement below is a CSS pixel from the workshop probes
(`probe-r6.json`, `probe-r3.json`) and is binding unless the design doc says
otherwise.

## Decisions taken at build time

Recorded so briefs cite the doc, never the chat. Each is the orchestrator's
reading of the rulings; the owner may overrule any of them.

- **B1. The smart header is read-only.** It renders as a section, not a
  button. Rulings 5 and 18 and the approved comps (round 2 onward) make the
  saved-trip row the affordance; the header's own trip carries `SHOWN ABOVE`
  and the `DEPARTURES ›` cue like every other row.
- **B2. No manual unfocus exists.** Rulings 2, 4 and 6: focus changes only
  through `Take this train` on another service and clears itself 30 minutes
  after arrival (client-storage.md). Journey detail for the journey that is
  already focused shows no action rail at all, the same way cancelled detail
  has none; the top back control is the way out.
- **B3. The board stays a now-anchored timeline.** The C1 comps are static
  frames; the frozen list in `design.md` keeps past pages above the `NOW`
  anchor and the landing at the anchor. The row grammar, density and rules
  are ported; the scroll mechanics are not touched. Rows are a fixed 96px and
  the list scrolls when the frame is short; sparse boards no longer stretch
  rows to fill the frame.
- **B4. Board rows show a tight change by colour only.** The dwell segment
  turns warning colour (ruling 36); the headsign line stays the headsign. The
  row no longer prints `Tight change · N min`. Detail names it on the change
  step (`2 MIN CHANGE`). A cancelled journey never paints the tight gap.
- **B5. A realtime-shortened change prints only its current window.** The C1
  tight frame was a shrunk change (printed 7, now 2) and printed `2 MIN
  CHANGE`; the owner ruled it ships as rendered (2026-09-03, build stage).
  The contract sentence about showing the printed window leaves ui.md in
  Phase 5. The shrunk arrival is still the effective one; nothing is struck.
- **B6. After departure, detail's promoted row follows the directions
  ladder.** The C1 detail comps are pre-departure. Once the journey has left,
  the promoted row's figure and provenance are the smart header's
  (`TO CHANGE` / `TO GO` / `AGO`), and steps already behind the rider take
  the quiet done treatment (secondary ink, no strike). Per-leg `ON BOARD`
  figures are retired with the ledger they lived in.
- **B7. Top-line distance uses a silent one-shot fix.** On home open, if the
  browser already reports geolocation permission as granted, the client takes
  one fix without prompting; it never prompts on open (ui.md). `AT <station>`
  when the fix is within 200 m of the origin; `<distance> TO <station>`
  otherwise; `NEXT TRAIN` with no fix. Focused: the status word instead.
- **B8. Focused pre-departure cancellation shows the next train.** When the
  focused journey is cancelled before it departs and the live board has a
  later running service, the header shows that service with the
  `<time> CANCELLED · NEXT TRAIN` instruction and the `CANCELLED` status,
  exactly the round-3 frame. Mid-journey cancellation recovery stays deferred
  (ruling 21): the focused journey remains on screen with its warning copy.
- **B9. Exemplars are re-shot from the real client.** Every board, detail and
  home exemplar changes, so `assets/comps/latest/` becomes a full set of
  `tools/shoot-states.js` frames. The comps oracle then compares the archived
  board v2 workshop against the exemplar set pinned in git at the last commit
  where they were harness-reproducible, so the harness gate survives the
  product moving on.
- **B10. Comp data attributes ship.** The comp markup carries the probe
  vocabulary (`data-scroller`, `data-svc`, `data-axis`, `data-seg`,
  `data-pin`, `data-transfer-station`, `data-transfer-platform`,
  `data-line-code`, `data-headsign`, `data-summary`, `data-footer-rail`). The
  port keeps them so the verification wave measures the client with the same
  probes that judged the comps.

## Behavioural contracts at the seams

These hold across phases; a phase that cannot honour one stops and reports.

**Selection precedence (main.js).** Two readers of the trip selection:

- Home shows `focus` if one is live, else the explicit selection, else the
  prediction.
- The board and detail show the explicit selection if the user made one
  (row tap), else `focus`, else the prediction.

A saved-trip row tap sets the explicit selection and routes to `#/board`.
It never writes `focus`. `Take this train` writes `focus` for the board's
trip/direction and routes home. Nothing else writes or clears `focus`
except the 30-minute expiry on refresh.

**Late status (focus.js).** `RUNNING LATE` renders only when all three hold:
the snapshot is fresh (not stale, not offline); the relevant leg has a
realtime `estimated` departure; `floor(estimated/60000) −
floor(scheduled/60000) > 0`. Relevant leg: leg 0 before departure and while
riding leg 0; leg *i+1* while dwelling before it or riding it. Cancellation
renders `CANCELLED`; `now > effective arrival` renders `TRIP OVER`; both
outrank late. Otherwise `RUNNING`. The same status string appears in the
header's top line and the focused saved-trip row.

**Fill versus bare-text colour (app.css, lines.js).** Every filled device
(boarding cap, platform pins, saved-trip badges and spine bars, detail chips,
axis ride segments) paints `--line-fill-<code>`; every bare use of line colour
as text paints `--line-<code>`. Dark: the two are equal. Light: only T1 and
BMT differ, fill `#F99D1C` with paper `#FAF9F5` type; bare text keeps
`#A46204`. The 2.02:1 ratio is the owner's accepted exception (ruling 37) and
the regression test asserts the exact pair, not a ratio.

**Transfer facts on a row (rowmodel.js → board.js).** A row model carries
`changes[]` with `{station, fromPlatform, toPlatform, minutes, printed,
tight, broken}` per change, computed by the same floored-minute arithmetic as
`journey.js`. The renderer attaches the station label to the boarding-platform
pin of each change. `tight` is false whenever either adjoining leg is
cancelled.

## Phases

### Phase 1 — board rows (C1)

Owns: `web/js/rowmodel.js`, `web/js/board.js`, `web/js/journeybar.js`,
`web/js/lines.js`, the `Departure board` and light-scheme sections of
`web/app.css`, `web/test/rowmodel.test.js`, `web/test/journeybar.test.js`,
`web/test/theme.test.js`.

Port the C1 result row into the existing timeline:

- Row: 96px min-height; padding 9px top, 10px bottom, 22px sides (18px at
  ≤375px); grid `72px minmax(0,1fr)`, column gap 14px; full-width 1px rule
  drawn edge to edge under every row (`::after`, left 0, right 0), no inset
  border. Figure 45px/250 right-aligned in the 72px column, vertically
  centred on the row; `min` unit 0.21em; status 9px/600 0.13em uppercase 6px
  below; wide figures 31px. Departure 18px/300; struck scheduled 13px;
  arrival 16px/300 secondary ink at the right. Journey line 22px high, 6px
  below the times: 22px cap `PLATFORM n` 14px/700, 7px axis, 22px pins.
  Headsign line 20px high, 5px below, 13px/300.
- Transfer facts: the boarding-platform pin of each change carries the
  station label beneath it (10px/600 0.06em uppercase secondary ink, 1px tick
  above). Two changes: the second label left-aligns and the second change's
  alighting pin is hidden. Headsign ellipsis only on actual collision (no
  width caps; the comp's `min-width: 56px` guard for two-change rows stays).
- States: `late` colours figure and departure; `sched` figure secondary ink
  weight 200; `cx` dims figure, times, headsign to label ink, strikes the
  departure and the arrival, appends `CANCELLED` (9px warning) to the
  arrival, fades the journey device to 0.3; `past` dims to label ink. The
  cancelled-lead note on the next running row stays. Tight paints the dwell
  segment only, never on a cancelled row (B4).
- `NOW · HH:MM` anchor and `— SIX SERVICES SHOWN` / `— END OF BOARD` end
  mark per the comp; timeline scroll, past paging and `landAtNow` untouched.
- Colour roles: add `--line-fill-*`, `lineFill()` and the light T1/BMT
  values; port the probe's exact-colour assertion into `theme.test.js` and
  relax the 3:1 paper assertion for T1/BMT only, naming the exception.
- Desktop (≥900px) rules for the new row so `desktop` states do not regress.

Verify: `(cd web && npm test)`; a smoke drive with `tools/screenshot.js
--seed` at 390×844 and 412×732, dark and light, of hero, delayed, cancelled,
tight, scheduled-only, past-scrolled and long-name boards, compared side by
side with `shots/c1-full-rule-*` from the r6 workshop. No `shoot-states.js`
edits in this phase (Phase 4 owns the instrument).

Done when: unit gates green, smoke frames match the comps at a glance and the
report names any deviation with a measurement.

### Phase 2 — journey detail (C1), based on Phase 1's branch

Owns: `web/js/detail.js`, `web/js/journey.js`, the detail parts of
`web/js/main.js` (`showDetail`, `renderDetail`, `detailAction`), the
`journey detail` section of `web/app.css`, `web/test/journey.test.js`.

- Masthead: `← <departure station> departures` back (11px/600 0.15em, 44px);
  kicker `JOURNEY`; title `From → To`; summary `1 change · arrives 10:08` /
  `Direct · arrives 23:36` / `The 09:58 from Town Hall is cancelled.`
  (warning colour, names the cancelled leg's departure time and station);
  exactly 18px between the summary and the heavy rule.
- Scroll region: the promoted result row (Phase 1's renderer, 100px
  min-height, not a tap target) then the steps: board step (`09:24`,
  `Rhodes`, chip platform + `BOARD T9 · GORDON VIA LINDFIELD`), one change
  step per change (`7 min`, `Town Hall`, chip `GET OFF → ` chip `BOARD`;
  tight: `2 MIN CHANGE` in warning on the time and label, current window
  only (B5); broken: `CANCELLED`, step at 0.58 opacity, time and station
  struck), arrive step (`10:08`, `Bondi Junction`, chip + `ARRIVE`, plus
  `· JOURNEY CANCELLED` when the final leg is cancelled). Steps 72px, change
  steps 82px with heavy rules above and below.
- Tail: heavy rule; `10:08  Bondi Junction … PLATFORM 2`, or
  `JOURNEY CANCELLED` in warning with the time struck. Then the freshness
  line (`● UPDATED 0S AGO`, existing footer text), then the action rail
  `Take this train` using `.hm-bar` geometry (2px rule, 56px control, 22px
  sides, 8px bottom). No rail when the journey is cancelled or already
  focused (B2).
- Actions: back routes to `#/board` for the same selection; `Take this train`
  sets focus and routes home. `Unfocus` and `Focus this train` are gone.
- Post-departure treatment per B6.

Verify: unit gates; smoke drive of transfer, direct, delayed, tight,
cancelled, long-name and focused-riding detail at both frames and schemes
against `shots/c1-full-rule-*-detail-*`. Reaching detail in the smoke must go
through a real board row click.

Done when: gates green, frames match, the rail is measured at 66px and the
summary gap at 18px.

### Phase 3 — smart home (C2 + C3), based on main, in parallel with Phase 1

Owns: `web/js/home.js`, `web/js/focus.js`, `web/js/predict.js` if ranking
needs a hook, `web/js/dom.js` (name fitting), the home parts of
`web/js/main.js` (`showHome`, `renderHome`, `homeAction`, selection
precedence, silent fix), the `Smart home and directions` section of
`web/app.css`, `web/test/home.test.js`, `web/test/focus.test.js`.

- Top line replaces `Tracking · A → B`: distance/`AT`/`NEXT TRAIN` when not
  focused (B7); `RUNNING` / `RUNNING LATE` / `CANCELLED` / `TRIP OVER` when
  focused (late rule above). Late and cancelled use warning colour; when
  late the large countdown is warning too (ruling 25). `LIVE` stays green and
  independent.
- Header is a read-only section (B1). Arrival clock `margin-top: 7px` so
  both clocks share a baseline while names share a top edge (ruling 10).
  Station names never ellipsise: on render, a name that would clip is
  shortened by rule (`Station` dropped, `Junction` → `Jn`, then leading
  compass words to initials) until it fits (ruling 12).
- `MY TRIPS` anchor; rows 72px with `DEPARTURES ›` cue at the right, sub
  line reserving 106px for it. Sub copy: focused row → status; the header's
  unfocused trip → `SHOWN ABOVE · 120 M AWAY`; others → `14 KM AWAY · LAST
  RIDDEN FRIDAY` (distance only with a fix). Row tap opens that trip's board
  (selection precedence above); focus is untouched.
- Receipts based on view history say check, not ride: `You check this trip
  most weekday mornings.` / `You often check this trip around now.` The
  ride-based reverse receipt stays.
- Trip-over offer and location ask unchanged. Focused cancellation per B8.

Verify: unit gates (including one test per late-rule predicate and one that a
row tap leaves `focus` untouched); smoke drive of before (no fix / near /
far / at), delayed, cancelled, focused change, focused late (leg 1 +1 min),
focused first-leg late, stale focused (stored delay renders `RUNNING`),
scheduled-only focused, trip over, reverse and five trips at both frames and
schemes, against `shots/c3-status-time-*` and `v3-running-*`.

Done when: gates green, frames match, status strings verified in both
placements.

### Phase 4 — integration, instrument and exemplars

Owns: the merge of Phases 1–3, `tools/shoot-states.js`, `tools/README.md`,
`assets/comps/latest/`, `tools/comps/test/oracle.js`,
`tools/comps/test/oracle.comps.json` if needed, `web/test/fixture.js`
(three-leg journey and the late-leg helpers).

- Land the stack (Phase 3 onto Phase 1+2) and resolve `app.css` and
  `main.js` overlaps by intent, never by picking a side.
- Rewrite the state list for the new design and port the comp probes into
  the page invariants: 96px rows, full-width rules, stable figure column,
  transfer station and platform visible on every change row, no headsign
  clipping while width remains, tight-gap colour, exact T1/BMT light colours,
  18px summary gap, 66px rail, no rail on cancelled detail, six services
  reachable at 412×732, status strings per state, `LIVE` independent of
  late. Prove each new invariant bites by breaking its guard once.
- Re-shoot `assets/comps/latest/` from the client: the board, detail and
  home families at the names ui.md lists, plus `home-390x844-late.png`,
  `board-390x844-two-change.png` and `detail-390x844-direct.png`. Remove
  frames no state produces any more.
- Repoint the oracle per B9 and run it green.

Verify: `go test ./...`, `(cd web && npm test)`, `node --test
'tools/comps/test/*.test.js'`, `node tools/comps/test/oracle.js`, the full
`shoot-states` sweep at both frames and both schemes with zero invariant
errors, `tools/measure-open.js` within the bar.

Done when: every gate above is green on the integrated branch and the
exemplar set is complete.

### Phase 5 — contracts and shell version

Owns: `docs/contracts/ui.md`, `docs/contracts/client-storage.md`,
`web/sw.js` (`VERSION`), `tools/README.md` wording.

- ui.md: core flow (rows open boards, header read-only, `Take this train`,
  back copy), smart home (top line, status vocabulary, late colour,
  `MY TRIPS`, row copy), board (96px rows, full rules, transfer facts, tight
  colour, cancelled dimming and strike), journey detail (promoted row,
  steps, tail, rail, no unfocus), visual language (fill versus bare-text
  roles, the T1/BMT exception with its ratio), calibration list.
- client-storage.md: focus is set by `Take this train`, never cleared by
  hand; the "one-tap flip" invariant becomes the automatic return offer.
- Bump `VERSION` once for the whole change.

Done when: contracts read true of the shipped screens and the design doc's
rulings are all traceable to a contract sentence. Then invoke
`close-backlog-item`.

## Working rules for every phase

- Worktrees live under `/private/tmp/trains-hi-<phase>`; verify the base with
  this file and `shasum -a 256 web/app.css` before editing.
- Each agent runs its own server (`TFNSW_API_KEY=x PORT=<own> go run
  ./cmd/server`) and its own Chrome (`CDP_PORT=<own>`), and writes shots to
  its own `/tmp` directory named after the phase.
- Comments are rare and short: one line of *why* where the reason is
  non-obvious, never narrating what the code does.
- A change to any file in `web/sw.js`'s `SHELL` list needs no per-phase
  version bump; Phase 5 bumps once. Do not add modules without adding them
  to `SHELL`.
- Every report ends with "what the next agent must know".

## Status

| Phase | State |
| --- | --- |
| 1 board rows | not started |
| 2 journey detail | not started |
| 3 smart home | not started |
| 4 integration and exemplars | not started |
| 5 contracts and version | not started |
