# Build plan: smart header v2

Read `design.md` first; it is the spec and every ruling is there. This plan
phases the build so each phase is verifiable alone and no agent nears its
context ceiling. Code waves and verification waves are separate. Contracts
change in the same commit as the behaviour they describe, so each phase
lists the contract sections it owns. Nothing here overrides `AGENTS.md`.

Standing rules for every phase:

- Never source `.env`; the API key is only ever already in the environment.
- `go test ./...` and `(cd web && npm test)` stay green at the end of every
  phase.
- Any change to a file in `web/sw.js`'s `SHELL` bumps `VERSION` in the same
  change (phase 3 owns the bump; phases 2 and 3 both touch shell files, so
  phase 2 bumps too if it lands alone).
- No coordinate is ever persisted; no user fact is ever sent to the server.
- Copy is only what `design.md` "Copy" records. A string not there is not
  written; it is raised as a question.

## Build status — 2026-09-05 (orchestrator, on owner stop)

Phases 0 and 1 are merged to `main` (`b0049f2`): the baked 386-station
index, the generator, and the server answering `/api/v1/stops` from it.

Phases 2, 3 and 4 are built and committed on a worktree branch stack
(`shv2-p2` → `shv2-p3` → `shv2-p4`, tips under `/private/tmp/shv2-p*`) and
are NOT yet on `main`. Phase 2 (pure client logic) and phase 3 (controller,
setup, shell) are done, 218 web tests green and a clean 60-state sweep.
Phase 4 (verification wave) is partway: fixture ids corrected, a
geolocation seam added to the shooter, the eight new states shot and four
exemplars added; its contrast probe was found vacuous and the one-line fix
is committed but the sweep has NOT been re-run, so strip/mark contrast is
unverified. Phase 5 (closeout) has not started. Full phase-4 detail is under
its heading below.

Merge is blocked, two ways:
1. The `metro` design session holds uncommitted edits to
   `docs/contracts/ui.md`, which the merge touches.
2. COLLISION: the `ferries` session has edited THIS file and `design.md`
   (uncommitted, in the shared checkout) to claim it "supplies `stations.js`
   and its tests" and to add a tier-1 ruling for `here` — "if several
   qualify, prefer a saved-trip endpoint, then the nearest". Phase 2 already
   built `web/js/stations.js` with a plain nearest tier 1. Two features now
   own one module with different tier-1 semantics; this needs an owner
   decision before either lands. Do not merge `shv2-*` over the ferries
   `stations.js` without resolving it.

## Phase 0 — station index and its [verify] — DONE marker: `phase 0 done` commit — DONE 3e74d2d

Owns: `tools/build-stations.js` (new), `web/stations.json` (new),
`internal/stations/stations.json` (new), `tools/README.md`,
`docs/references/tfnsw-open-data.md`.

1. **Verify the id claim first.** With `TFNSW_API_KEY` in the environment,
   download the GTFS static bundles for Sydney Trains, NSW TrainLink and
   Sydney Metro (the portal's `/v1/gtfs/schedule/<bundle>` endpoints; record
   the exact URLs in `tools/README.md`). From `stops.txt` keep rows with
   `location_type = 1`. Probe five of their ids through `stop_finder` via
   `tools/probe-tfnsw.sh` and confirm they resolve to the same station the
   client stores: Central `200060`, Rhodes `213820`, Bondi Junction
   `202210` (the parent-station id upstream trip responses give; the client
   fixtures in `web/test/fixture.js` and `tools/shoot-states.js` store
   `200080`, which is probably Wynyard, so the probe decides and the fixture
   ids are corrected in phase 3 if wrong, never the index), Parramatta
   `215020`, Tallawong `2155384` (Chatswood is `206710`, per
   `docs/references/tfnsw-open-data.md`). Record the result in
   `docs/references/tfnsw-open-data.md` under a new "Station index" heading
   and remove the **[verify]** from `design.md` section 1.
   - If ids differ, the generator resolves each station through
     `stop_finder` once (name → `id` where `type == "stop"` and modes are
     serveable) and the reference doc says so. Do not proceed to step 2
     with a guessed mapping.
2. **Generator.** `node tools/build-stations.js` writes both copies from the
   bundles, sorted by id, `{id, name, modes, location}` per entry, the name
   in the form `/api/v1/stops` returns ("Central Station"), `modes` from
   the bundle (`train` for the two rail bundles, `metro` for Metro; a
   station in both bundles lists both). Deterministic output: running it
   twice yields identical bytes. It needs the key only to download; a
   `--from-dir` flag reads already-downloaded bundles so nobody has to hit
   the portal to regenerate.
3. **Gate.** Entry count between 250 and 400; every entry has a finite
   `location` inside the bounding box lat −37..−29, lon 147..154; the
   stations the client fixtures name (Central, Town Hall, Bondi Junction,
   Rhodes, Parramatta, Strathfield, Epping, Chatswood, Tallawong,
   Meadowbank, Sydney Olympic Park, Mount Victoria) are present by name,
   and every fixture id that differs from the index is listed in the phase
   report; the two files are byte-identical (the Go test in phase 1 makes
   this permanent; here, `cmp`).

Blocker recorded 2026-09-05: `TFNSW_API_KEY` is not in the orchestrator's
environment and `.env` is never read without the owner's permission, so the
download and probe in steps 1–2 wait for the owner to supply the key. Phase 2
is independent and runs first. Owner ruling 2026-09-05: the phase 0/1 agent
may source the root `.env` inside its own shell commands for the download
and the probe only; the key is never printed, committed or passed in a
prompt.

## Phase 1 — server answers stops from the index — DONE marker: `phase 1 done` — DONE 5f7e79e

Owns: `internal/stations/` (new package: embed, search), `internal/api/
server.go`, `internal/api/server_test.go`, `internal/tfnsw/client.go` and
`map.go` (remove `Stops`, `mapStops`, `serveableModes` if unused; keep
`modeName` if departures use it), `docs/contracts/api.md`.

Seam: `stations.Search(query string, limit int) []Stop` on the normalised
query the handler already computes. Ranking mirrors `web/js/search.js`
`rankStops` / `fuzzyScore` so a prefix such as `rhode` ranks Rhodes first;
port the same scoring and pin it with the same case table
`web/test/search.test.js` uses (copy the cases into the Go test). Minimum
query stays 2 characters at the API. The response shape and the
`Cache-Control` for stops are unchanged. `Upstream` loses `Stops`; the
7-day stale window and the 24-hour stops cache go with it.

Gate: `go test ./...`; a Go test asserts `internal/stations/stations.json`
equals `web/stations.json` byte for byte; `api.md` "GET /api/v1/stops"
says the list is baked, how it is rebuilt (phase 0's command) and that no
upstream call is made; the "stale window" paragraph loses its stops
sentence.

## Phase 2 — pure client logic — DONE marker: `phase 2 done` — DONE e91e069

Owns: `web/js/stations.js` (new), `web/js/predict.js`, `web/js/home.js`,
`web/js/storage.js`, `web/js/focus.js`, their tests, and
`docs/contracts/client-storage.md`. No DOM, no controller.

Seams (all pure, deterministic given their arguments):

- `stations.js`: the ferries build supplies this module and tests, including
  the saved-end tie-break inside 200 m; reuse it. `loadStations()` fetches `/stations.json` once and
  resolves to the array (null on failure; the app degrades to the no-`here`
  branch); `nearest(stations, fix, withinKm)` → `{station, km}` or null;
  `here(doc, stations, fix)` → `{station, tier}` or null, tiers exactly as
  design.md section 2 (200 m any; 2 km saved end; 2 km any).
- `storage.js`: document gains `homeVotes: []` (cap 7, one per local day,
  newest last), `lastOpen: null`, and `locationAsk` unchanged; loses
  `home` and `setHome`. `parseDoc` drops a malformed vote or `lastOpen`
  rather than repairing it, and ignores a legacy `home` field.
  `recordHomeVote(doc, station, nowMs)` writes nothing if today already
  voted. `recordLastOpen(doc, {station, tripId, direction, journey},
  nowMs)`. `addTrip` unchanged; the auto-save is the controller calling it.
- `predict.js`: today's `predict`, `scoreAll`, `rankTrips` stay. New
  `homeOf(doc)` → `{station, confidence}` per design.md section 3. New
  `locate(doc, nowMs, {fix, stations})` → one of `{kind:"trip", tripId,
  direction, leap:"usual"|"home"}`, `{kind:"pair", from, to}`,
  `{kind:"setup", from}` exactly per the pseudocode in design.md section
  4. Ties inside the candidates from `here` resolve by `lastViewed` then
  saved order.
- `focus.js`: `setFocus(doc, selection, journey, nowMs, by = "focus")`
  writes `by`. New `inferTravel(doc, nowMs, fix)` → the `focus` object to
  set, or null, implementing design.md section 5's three conditions
  (`fix.speed` is read from the fix object when finite). New
  `arrived(focus, fix, nowMs)` → true when the fix is within 200 m of the
  destination and `now ≥ effective arrival − 5 min`.
- `home.js`: `inferHome` is replaced by `homeOf`; `moved` and the
  `accept-home` offer are removed from the model and `offerHtml`; the
  model gains `strip` (inferred focus only: `{destination, time, origin}`)
  and each ranked row gains `justAdded` (true when `trip.createdAt` is
  within this page load and the selection was predicted; the controller
  passes the page-load time in `opts`). Receipts by `leap` per design.md
  section 8 with the recorded copy. The strip is design.md's A3 (one line
  below the heavy rule: `<div class="hm-strip"><span>Going somewhere
  else?</span><button data-act="change-destination" data-tap>Change</button></div>`,
  or equivalent), the mark is B6 (`<i>Just added</i>` in the sub line's
  status slot before the distance). Build both against the exemplar images
  in `docs/backlog/smart-header-v2/comps/`, not against prose.

Constraining arithmetic a builder checks its tests against:

- Tiers: fix 150 m from Town Hall with a saved Central trip 800 m away →
  `here` = Town Hall (tier 1). Fix 1.2 km from Rhodes (saved) with
  Meadowbank 0.9 km away → Rhodes (tier 2). Fix 1.5 km from Burwood, no
  saved end within 2 km → Burwood (tier 3). Fix 3 km from everything →
  null.
- Home: votes R,R,B,R,B,B,B (oldest first) → B (4 of 7). R,R,B → R (2 < 3
  for B, 2 < 3 for R → fallback: first trip's origin, confidence 0).
  R,R,R → R confidence 3. Seven votes then an eighth drops the oldest.
- Locate: at Bondi Junction, saved Rhodes → Bondi Junction, no reverse
  history, home Rhodes → `{trip, reverse, leap:"home"}`. Same with three
  reverse views at this hour on this day type → `leap:"usual"`. At Burwood,
  home Rhodes, nothing saved from Burwood → `{pair, Burwood → Rhodes}`. At
  Rhodes (home) with nothing saved from Rhodes → today's `predict`.
- Entry: `J` = 09:24 Rhodes → Bondi Junction, arrival 10:03; `lastOpen`
  at 09:15 at Rhodes (tier 1). Now 09:40, fix at Strathfield (≈ 4 km from
  Rhodes, ≈ 13 km from Bondi Junction; Rhodes → Bondi Junction ≈ 16 km):
  1 ✓ 2 ✓ 3 ✓ → enter. Now 09:40, fix 1.2 km from Rhodes on the far side
  (≈ 17 km from Bondi Junction): 3 ✗ → no entry. `lastOpen` at 09:05 →
  `D − at` = 19 min > 15 → no entry. Now 10:40 → past `A + 30` → no
  entry. Fix at Rhodes platform reporting speed 12 m/s → `distance ≥ 200 m`
  fails → no entry.
- Exit: fix 150 m from Bondi Junction at 09:59 (arrival 10:03) → arrived.
  At 09:57 → not yet.

Gate: `npm test` with the cases above added to `predict.test.js`,
`home.test.js`, `storage.test.js`, `focus.test.js` and a new
`stations.test.js`; `client-storage.md` rewritten per design.md section
9 in the same commit (schema example, "Prediction heuristic" replaced by
`locate` with today's formula as the no-`here` branch, "Completed rides
and home-station heuristic" replaced by the votes, a new "Travel mode"
subsection under "Focused journey" with the entry and exit conditions and
`lastOpen`).

## Phase 3 — controller, setup and shell — DONE marker: `phase 3 done` — DONE e3c38c0

Phase 2 handoff (2026-09-05), binding for this phase:

- `homeModel` opts gained `leap` ('usual'|'home', only when predicted and
  never beside an active focus), `loadedAt` (page-load ms; no row is marked
  without it) and `arrived` (boolean; makes the model over).
- `model.strip` is `null` or `{origin, destination, departureMs, journeyKey}`,
  the ends from the focused trip's leg (with coordinates), the key from
  `journeyKey(focus.journey)`. Action `data-act="change-destination"`.
- `inferTravel(doc, nowMs, fix)` returns the focus OBJECT (not a doc) and
  does not check for an existing focus; the controller guards. `arrived(focus,
  destination, fix, nowMs)` takes the destination station from
  `leg(trip, focus.direction).to`.
- `homeModel` needs at least one saved trip; a `setup` answer routes before
  rendering home.
- `lastOpen.station` must be the tier-1 `here` or null.
- `sw.js` is `v15` with `/js/stations.js` in `SHELL`; this phase adds
  `/stations.json` and bumps to `v16`.
- `directionsModel` must take an `arrived` opt that forces the done branch
  (design.md section 5, Exit).

Owns: `web/js/main.js`, `web/js/setup.js`, `web/js/home.js` (markup only,
if phase 2 left the strip/mark markup to the verdict), `web/app.css`,
`web/sw.js`, `web/index.html` if a preload is wanted,
`docs/contracts/ui.md`.

Event order on home open (the seam that matters most):

1. `route` → `showHome`: selection = focus ‖ explicit ‖ `locate` with no
   fix and whatever `stations` has loaded (null → no-`here` branch); paint
   from cache; `fetchLive`; start the index load if not started; silent
   fix if permission is granted, `enableHighAccuracy` only when
   `lastOpen.journey` is under way by the clock.
2. When the index resolves and a valid fix exists and the selection was
   predicted → re-run step 3. When a fix arrives → step 3.
3. `applyFix`: record the home vote (first of the day); if no active focus,
   `inferTravel` → on entry, `setFocus(…, "inferred")`, write the doc,
   selection = focus; else if the selection was predicted → `locate`; a
   `pair` result is saved through `addTrip` (`ctx.update`) and becomes the
   selection; a `setup` result routes to `#/trips/new` with the origin.
   Then load the selected cache, render, `fetchLive`.
4. `lastOpen` is written at the two write points only: after step 1's cache
   paint when the header is unfocused and has a lead journey, and in
   `fetchLive`'s success path under the same condition. Never in a render.
5. `visibilitychange` back to visible on home takes the silent fix again
   (today it only refetches).
6. `recordCompletedFocus` stays; `arrived` marks the trip over as soon as a
   fix says so, on the fetch/fix write paths.

Change destination: the strip's action goes to `#/trips/new` with
`state.prefill = {origin, redirect: {journeyKey, departureMs, from, to}}`.
`renderSetup(root, ctx, {origin, recentsFrom})` fills From, focuses To and
lists saved and recent destinations from that origin first. On save with a
redirect: `addTrip` if new; `getDepartures(origin, newTo, {at: D − 60 s,
limit: 6})`; match by `journeyKey`; matched → `setFocus(…, "inferred")`
and `#/`; unmatched → explicit selection and `#/board`.

Setup rows: From results before any query show `Use my location` when the
permission state is `prompt` and there is no fix (tap → `getCurrentPosition`
→ From = `here` tier 3; error → row removed), and the `NEAREST STATION`
group with the one nearest index station when a fix exists and From is
empty. The lede paragraph is deleted. First run with permission granted
takes the silent fix before the sheet paints From.

Shell: `web/stations.json`, `web/js/stations.js` added to `SHELL`;
`VERSION` bumped.

Gate: `npm test`; `ui.md` updated in the same commit: smart home (the
strip, the row mark, receipts, no moved offer), setup (prefilled From,
the two rows, no lede), and the location-panel paragraph left as is.
Then `node tools/shoot-states.js` passes on every existing state (no
regression) before phase 4 adds states.

## Phase 4 — verification wave — DONE marker: `phase 4 done` — IN PROGRESS, stopped by the owner 2026-09-05

Progress when stopped (branch `shv2-p4`, worktree `/private/tmp/shv2-p4`):

- Done and committed: fixture station ids corrected against the index
  (`4f136bf`); a `geo`/`permission` seam in the shooter with the eight new
  states, and its README notes (`e0f9db8`); four exemplars
  `home-390x844-inferred.png`, `home-390x844-inferred-light.png`,
  `home-390x844-just-added.png`, `setup-390x844-origin.png` with the
  `ui.md` calibration list and the README table updated (`0fde902`).
- Committed with the progress note, not re-run: the shooter's contrast probe
  had a vacuous regex (`[\d.]+` lost its backslash inside the page-script
  template literal), so every contrast check it reported passed without
  measuring anything. The one-character fix is in; the sweep has NOT been
  re-run with it and the strip/mark contrast ratios are therefore unverified.
- Not started: the agent's final report (sweep count, measurement table,
  defects found, strings not in the copy list, owner verdicts), the
  `measure-open.js` run or skip note, re-shooting `first-run` if the
  `Use my location` row changed its frame, the phase 4 done marker.
- Resume by re-running the full sweep on the branch
  (`python3 -m http.server <port> --directory web`, private `CDP_PORT`,
  `node tools/shoot-states.js --url http://localhost:<port>`), reading every
  new frame, and finishing the list above.

Stack state: phases 0–1 are on `main` (`b0049f2`). Phases 2–4 are on the
`shv2-p2` → `shv2-p3` → `shv2-p4` stack and NOT on `main`: the merge was
blocked because another session (the `metro` design session) holds
uncommitted edits to `docs/contracts/ui.md`, which the merge touches. Merge
`shv2-p4` into `main` once that file is committed; expect trivial conflicts
in this file and `design.md` only.

Owner verdicts still open (recorded in `design.md`): `Now` over `AGO` for an
early arrival; the 23 out-of-NSW terminals in the index; the real-phone
`coords.speed` check.

Phase 0 and 3 handoff (2026-09-05), binding for this phase:

- Fixture ids to correct from `web/stations.json` (never the reverse), in
  `web/test/fixture.js` and `tools/shoot-states.js`: Bondi Junction is
  `202210` (`200080` is Wynyard); Epping `212110` (not `213910`); Tallawong
  `2155384` and Chatswood `206710` (the fixtures had them shifted); Meadowbank
  `211430` (not `213810`, Concord West); Strathfield `213510` (not `206020`,
  Waverton); Mount Victoria `278610` (not `253030`); and there is no "Sydney
  Olympic Park Station": it is `Olympic Park Station`, `212710` (not
  `206010`, North Sydney). Another session is concurrently editing
  `tools/shoot-states.js`'s Tallawong/Chatswood lines to these same values;
  make the identical edits so the merge is clean.
- The shooter has no geolocation seam. Add one as a repo feature of
  `tools/shoot-states.js` (a per-state `geo: {lat, lon, speed?}` that grants
  the permission and answers `getCurrentPosition`, via CDP
  `Browser.grantPermissions` + `Emulation.setGeolocationOverride` in
  `screenshot.js` if that works headless, else a `navigator` stub installed
  before `route()`), and document its trap: `loadStations()` starts at module
  load, before the fetch freeze, so the index is usually present.
- `first-run` now shows the `Use my location` row under headless Chrome
  (permission `prompt`); that is ruling 8, not a regression.
- `tools/measure-open.js` needs the live API; if it cannot run without the
  key, report it as skipped rather than faking it.
- The real-phone `coords.speed` check is the owner's; report it as open.

Owns: `tools/shoot-states.js`, `assets/comps/latest/`, `tools/README.md`.
No product code except fixes for defects this wave finds, each named in
the commit.

States to add and shoot at 390×844 and 412×732, dark and light where the
calibration set has a light variant:

- `home-here-home`: at Bondi Junction, saved Rhodes → Bondi Junction, home
  Rhodes by votes, no reverse history → header reverse, receipt `Your days
  usually start at Rhodes.`, top line `AT BONDI JUNCTION`.
- `home-here-fallback`: same with no votes → receipt `You usually travel
  from Rhodes.`
- `home-here-pair`: at Burwood, trip auto-saved, its row's sub line
  `Just added · <distance>` in italics, no header receipt, nothing
  truncated at 360, 390 or 412; compared against
  `comps/mark-b6-390x844-before.png`.
- `home-inferred`: `lastOpen` at Rhodes 09:15 for the 09:24, now 09:40 at
  Strathfield → directions header with the strip `Going somewhere else?
  CHANGE`, the heavy rule still at 214px, the strip 49px tall with a 44px
  tap target, compared against `comps/strip-a3-390x844-change.png`.
- `home-arrived`: focused, fix at Bondi Junction at 09:59 → `TRIP OVER`
  and the way-back offer.
- `setup-origin`: `#/trips/new` with From prefilled from a fix.
- `setup-location-row`: permission `prompt`, the `Use my location` row.
- `setup-nearest`: a fix, empty From, the `NEAREST STATION` group.

Checks per state: tap floor 44px, no horizontal overflow, station names
never ellipsised, the strip's and mark's contrast in both schemes ≥ the
ratio the comps round recorded, the header's heavy rule at 214px with no
receipt, and every string on screen present in `design.md` "Copy" or the
existing contracts. `node tools/measure-open.js` still under its
thresholds. Replace or add exemplars in `assets/comps/latest/` per
`ui.md`'s calibration list, shot from the client, and update that list.

Real-phone [verify]: on the owner's Android, with permission granted,
whether a high-accuracy `getCurrentPosition` fills `coords.speed` on a
moving train. Report the observation; if it is null, remove the speed
clause from `focus.js`, its test and `client-storage.md` in this phase and
say so in `design.md`.

## Phase 5 — closeout

Run the `backlog-item` close stage: migrate the surviving rules into the
contracts (already done per phase; confirm nothing is only in this
folder), `PROJECT.md` decisions and `ROADMAP.md` (M4 items landed, M6
station index done), rewrite or delete user stories 08, 09 and 21, delete
this folder, deploy per `docs/operations/deploy.md`.
