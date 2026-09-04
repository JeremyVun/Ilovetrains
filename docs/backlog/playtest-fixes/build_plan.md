# Build plan: playtest fixes

Numbers in brackets refer to the defects in `design.md`. Every phase is an
Opus 5 agent in its own worktree under `/private/tmp`, briefed from this
folder plus the contracts. Verification waves are separate from code waves.
A phase is done when its gate is green in its worktree and it has landed on
`main`. Phase 0 lands before anything forks; phases 1–3 fork from the
post-phase-0 `main` and land in order 1, 2, 3; phase 4 (comps) runs in
parallel and touches no repo file; phase 5 verifies the landed stack; phase
6 builds the header verdict.

Standing rules for every brief: comments are rare and short, one line of
*why* where the reason is non-obvious, never narrating what the code does;
no doc comments that restate a signature; no commented-out code. Contracts
change in the same commit as the behaviour. Any change to a file in the
service-worker `SHELL` list keeps `VERSION` at `v14` (phase 0 bumps it; later
phases do not bump again).

## Phase 0 — subtraction and shared helpers [13]

Owns: `web/js/trips.js` (delete), `web/sw.js`, `web/app.css` (dead rules
only), `web/index.html`, `web/js/board.js`, `web/js/main.js` (remove
`onBoard`; replace the three `['home','board','detail'].includes(state.view)`
checks with one helper), `web/js/dom.js` (`figureHtml`), `web/js/journey.js`
(`platformNumber`, `changeBetween` gains `index`, `arrivalMs`, `departureMs`),
`web/js/focus.js` (read changes from `journeyDetail`; delete its own change
loop and `cleanPlatform`), `web/js/rowmodel.js`, `web/js/journeybar.js`,
`web/js/home.js` (import `figureHtml`), tests touched by the moves.

Seam: pure behaviour-preserving. `directionsModel`'s output for every existing
test is byte-identical except that `changes[i]` carries the extra fields.
`focus.js`'s `tight` becomes `journeyDetail`'s (which is false when a leg is
cancelled); the existing tests must still pass, and if one asserts the old
disagreement it is corrected with a one-line note in the commit.

Gate: `(cd web && npm test)`, `go test ./...`, `node --test
'tools/comps/test/*.test.js'`, and `grep -rn "trips.js\|splitFigure\|sameRowSet\|onBoard\|cleanPlatform" web tools` finds nothing. `web/test/sw.test.js`
passes with the SHELL list one entry shorter.

Done: landed on `main` as one merge.  — [ ]

## Phase 1 — board rendering [2, 3, 4] and hidden scrollbars

Owns: `web/js/main.js` (render path: `renderCurrent`, `renderHome`,
`renderBoard`, `renderDetail`, timers, `fetchLive`'s body handling for the
seen-live map, `fetchPast`), `web/js/board.js`, `web/js/rowmodel.js`,
`web/app.css` (scroller rules, `.departing` transition), `web/test/rowmodel.test.js`,
`tools/shoot-states.js` (the past-register `NOTE` and its invariant; the
`dissolve` state), `docs/contracts/ui.md` sections "Departure board" and
"Past, stale and exceptional data", `docs/ROADMAP.md` (remove the
`TIMETABLE ONLY` open question), `assets/comps/latest/board-390x844-past.png`.

Seam contract:
- `renderCurrent` may be called every second and must not touch the DOM
  when the view's HTML string is unchanged. The freshness text (`.sy-fresh
  .lbl` on the board, `.hm-fresh .lbl` on home, `[data-t="footer"]` on
  detail) is patched by `textContent` every tick and excluded from the
  comparison. `clampJourneyBars`, `fitStationNames` and scroll restoration
  run only after a real rebuild.
- The scroll-position preservation across a real rebuild stays exactly as
  today (`preserveTimeline`/`restoreTimeline`, `addedAbove`).
- `state.seenLive`: `Map<journeyKey, journey>`, reset in `showBoard` and
  whenever `currentKey()` changes, updated from every successful live body,
  passed to `boardModel` as one additional past page after `pastBodies`.
  Home and detail do not use it.
- Dissolve: a future row present in the DOM whose key is absent from the
  next future set gets class `departing` (opacity to 0, 240ms, `will-change`
  free), and the rebuild runs when the transition ends or after 260ms,
  whichever first; under `prefers-reduced-motion: reduce` the rebuild is
  immediate. At most one dissolve is in flight; a second change during it
  rebuilds immediately.
- Past rows without actuals: `kind: 'sched'`, `provenance: 'AGO'`, figure
  `countdownFigure(-mins)` from the scheduled time, `schedTime: null`,
  `delayMin` ignored, `provenanceWarn: false`. Rows with actuals unchanged.
- `scrollbar-width: none` and `::-webkit-scrollbar { display: none }` on
  `.sy-tl`, `.hm-ix`, `.detail-scroll`.

Gate: unit tests; `node tools/shoot-states.js` full sweep green (the past
`NOTE` gone, `dissolve` state shows a fading row); a wheel probe run through
`tools/screenshot.js --desktop --eval` or a probe file: dispatch ten
`mouseWheel` events 40ms apart on the timeline, wait 3.2s, assert the
timeline element identity is unchanged and `scrollTop` equals the value read
80ms after the last wheel event (tolerance 1px); a second probe asserts
`document.querySelector('[data-t="timeline"]')` identity is unchanged across
five seconds of idle ticks on a live board. Re-shoot
`board-390x844-past.png` with the documented invocation and read it.

Done:  — [ ]

## Phase 2 — smart header truthfulness [1, 5, 6, 7, 8, 9]

Owns: `web/js/focus.js`, `web/js/home.js`, `web/js/predict.js`,
`web/js/storage.js` (`locationAsk`), `web/js/main.js` (only: the
`homeModel` options object gains `predicted: state.predicted`; the
`askLocation` expression reads the persisted decline and the permission
state; `skip-location` writes the decline through `ctx.update`), their
tests, `docs/contracts/ui.md` sections "Smart home" and "Journey detail,
time axis and directions", `docs/contracts/client-storage.md` (schema,
geolocation term, location ask).

Seam contract:
- `directionsModel(journey, nowMs, opts).tight` is true in every phase while
  a tight change lies ahead; `changes` come from `journeyDetail`.
  Instruction strings per design.md "Copy"; the builder wires the seams with
  the recommended candidates and expects a one-sweep string replacement.
- The riding tight instruction keeps the get-off station and platform.
- Later-leg cancellation after departure: the instruction names the
  cancelled leg's departure clock time and its `from` station; `warn` true;
  the figure keeps counting to the next action (get off / change) rather
  than to the journey's own departure.
- Receipt rule exactly as design.md [5]; `predicted` false means no
  view-history receipt; the reverse-ride receipt is unchanged.
- `scoreAll`: `score = (baseScore + PREDICT_FLOOR) * locationFactor`, floor
  `0.01`, exported. Tests: at the destination with no history the reverse
  wins; with no fix every floor ties and `lastViewed` wins; one forward
  event outweighs the floor at the destination (1 × 0.3 = 0.3 > 0.025).
- `locationAsk: {declinedAt}` parsed and serialised; `askLocation` is false
  within 30 days of `declinedAt` or when `permissions.query` reports
  `denied`. The permission query result is cached in `state` for the page
  load.

Gate: unit tests; `node tools/shoot-states.js home-before home-change
home-delayed home-focused-cancelled home-late home-five-trips` green with
each state's `expect` block; a new shoot-states state `home-tight-before`
(focused, pre-departure, change shortened by a first-leg delay) asserting
the dwell segment carries `data-tight-gap="true"` and the instruction names
the change station.

Done:  — [ ]

## Phase 3 — small disjoint fixes [10, 11, 12]

Owns: `web/js/setup.js`, `web/js/time.js`, `web/test/*` for those,
`internal/api/server.go`, `internal/api/server_test.go`, `docs/contracts/api.md`
(one sentence: the stops cache key and upstream query are the normalised
text), `docs/contracts/ui.md` "Setup and station search" (Enter picks the
top result).

Gate: `(cd web && npm test)`, `go test ./...`, and a node check that
`clock(Date.parse('2026-01-15T09:00:00+11:00'))` prints `09:00` under
`TZ=Australia/Perth`.

Done:  — [ ]

## Phase 4 — smart header height comps round [14]

No repo files. An Opus 5 agent on xhigh effort runs the `design-comps`
skill with `tools/comps/`: workshop `/tmp/trains-comps-header-height`, the
owner's words verbatim as the spec, 3–5 directions on vertical composition
only, both frames, both schemes, the home scenarios `before`, `leave`,
`change`, `tight`, `cxl`, `back`, `many`. The sheet is opened in the
owner's browser by the orchestrator. Output: the sheet, `OPTIONS.md`, and a
report naming the recommendation and the condition under which it flips.

Done when the owner has ruled and the ruling is recorded in `design.md`.  — [ ]

## Phase 5 — verification wave

After phases 1–3 land. One agent, no code changes except test or tool
fixes it can justify: both unit gates, `node --test
'tools/comps/test/*.test.js'`, the full `shoot-states.js` sweep at both
schemes, `tools/measure-open.js` against a local server if a key is present
(else skipped and named as skipped), a desktop drive of the board at 1280×800
with the wheel probe, and a read of every re-shot exemplar against its
predecessor with `tools/comps/diff.js` so every changed band is named and
expected. Report per defect: proven fixed, with the instrument that proved
it.

Done:  — [ ]

## Phase 6 — header build after the verdict [14]

Owns: `web/app.css` (`.hm-c` variables and `.hm-hd` sizing), `docs/contracts/ui.md`
"Smart home" (the sizing rule), every `assets/comps/latest/home-*.png`
re-shot with the documented table, `tools/shoot-states.js` invariants if
the verdict adds one.

Done:  — [ ]

## Close

Per the `backlog-item` skill's close stage: migrate surviving rules into
the contracts (most already land with their phases), delete this folder,
retire the worktrees, then deploy per `docs/operations/deploy.md`.
