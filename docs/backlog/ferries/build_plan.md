# Build plan: ferries

Read `design.md` first; it is the spec and every ruling is there. Phases
are sized so each is verifiable alone and no agent nears its context
ceiling. Code waves and verification waves are separate. Contracts change
in the same commit as the behaviour they describe. Nothing here overrides
`AGENTS.md`.

Standing rules for every phase:

- Never source `.env`; the API key is only ever already in the environment.
  The owner authorised sourcing `.env` on 2026-09-05 without displaying
  the key. The probe itself now requires an exported key and never sources
  a file.
- `go test ./...` and `(cd web && npm test)` stay green at the end of every
  phase.
- Any change to a file in `web/sw.js`'s `SHELL` bumps `VERSION` in the same
  change. Phase 1 (`web/stations.json`) and phase 3 (`web/js/*`,
  `web/app.css`) both touch shell files; whichever lands first bumps, the
  other bumps again if it lands separately.
- No user fact goes to the server. Mode is a property of stations and
  services, never of the user.
- Copy is only what `design.md` "Copy" records once verdicted. A string
  not there is not written; it is raised as a question.

Dependencies: phase 0 gates 1, 2 and 3, which are independent of each other
and may run in parallel worktrees (distinct files, see "Owns"). Phase 4
adopts the stations.js prerequisite from smart-header-v2. Its controller
subsequently landed on main and now uses the shared lookup helper. Phase 5 runs last, on main, after everything else is
merged.

## Phase 0 — probes and fixtures — VERIFIED 2026-09-05

**Probes verified; owner correction accepted 2026-09-05.** See design
ruling 1 and reference “Ferries”. Phase 1 must use served GTFS boarding
stops mapped to verified Trip Planner hubs, rather than assume parent ID
equality. Circular Quay merges with rail. Side labels are included in
browser verification. Source `.env` only under the owner's existing grant,
without displaying its key.

Owns: `tools/probe-tfnsw.sh`, `tools/fixtures/` (new files only),
`docs/references/tfnsw-open-data.md`.

Needs `TFNSW_API_KEY` in the environment. Every [verify] in `design.md`
is settled here and written into the reference doc with the date, the
fixture name and the observed value.

1. **Ferries bundle.** Captured from
   `https://api.transport.nsw.gov.au/v1/gtfs/schedule/ferries/sydneyferries`
   with the apikey header to `.gtfs/ferries.zip` (never committed). Record:
   HTTP status; `feed_version`; the `route_type` values in `routes.txt`; the
   count of `location_type = 1` rows in `stops.txt`; the exact name shape of
   parents and children for Circular Quay, Manly and Parramatta; whether
   every wharf has a `location_type = 1` parent at all (if wharves are bare
   `location_type = 0` stops the generator needs a different keep rule, and
   that is a design question to raise, not a plan to improvise).
2. **Ids.** Probe `stop_finder` with `name_sf=Manly Wharf` and
   `name_sf=Circular Quay` and record the class-9 stops' ids and `modes`.
   Record the GTFS-to-Trip-Planner mapping. The original equality premise
   failed; the revised owner ruling uses verified Trip Planner hubs.
3. **Trips.** Add to the probe script, each saved as a fixture:
   - `trip_circularquay_manly.json`: wharf id → Manly, current time, with
     the standard exclusions minus `exclMOT_9`.
   - `trip_wynyard_manly.json`: Wynyard `200080` → Manly, same exclusions;
     the train-to-ferry change.
   - `trip_manly_circularquay.json`: the reverse, for the Fast Ferry.
   Record for each: product class and `product.name` of every leg;
   `transportation.disassembledName` (expected `F1`), `number` and
   `destination.name` for ferry legs; `origin.properties.platformName` on a
   ferry leg (expected `Wharf n`) and whether it is absent anywhere;
   `isRealtimeControlled` and `realtimeStatus` on ferry legs; every class-99
   leg's `duration`, planned times and endpoint names between a station and
   a wharf; whether a station-to-wharf change ever comes with no walking
   leg; the private operator's class and code if one appears.
4. **Reference.** A "Ferries" section in `tfnsw-open-data.md` with the
   above, and the ferries bundle added to "Station index".

Verify gate: the three fixtures exist and parse; the reference section
answers every [verify] named in `design.md` "Mechanism" 1 and 2; the observed ID differences are stated with IDs. The owner accepted
verified Trip Planner hubs after the parent-only premise failed.

## Phase 1 — index — VERIFIED 2026-09-05

54 GTFS boarding stops map to 38 ferry hubs; 423 total entries. Both copies
regenerate byte-identically with `--from-dir`. Live `/stops` probes return
Manly `209573` and a single shared Circular Quay `200020`. Mapping guard
mutations fail the tests. Bundles downloaded 2026-09-05; NSW TrainLink
feed version `05092026-011236`, ferries `05092026-010132`; the rail and
metro ZIPs have no `feed_info.txt`. The combined shell now uses worker v19.

Owns: `tools/build-stations.js`, `web/stations.json`,
`internal/stations/stations.json`, `internal/stations/stations.go`,
`internal/stations/stations_test.go`, `web/js/search.js`,
`web/test/search.test.js` (or the test file that pins the ranking),
`tools/README.md`, `docs/contracts/api.md` (stops section), `web/sw.js`
(`VERSION`).

1. Follow revised design mechanism 1, including a committed verified
   boarding-stop mapping. Add the ferries bundle: fourth `BUNDLES`
   entry with mode `ferry`, `MODE_ORDER` `train, metro, ferry`, a keep rule
   for this bundle that accepts the ferry `route_type` phase 0 observed and
   still rejects everything else. Name rule per phase 0's finding, so every
   entry ends in `Station` or `Wharf`; the generator prints the exceptions.
   `--from-dir` documents `ferries.zip`.
2. Regenerate both copies from `.gtfs/` and commit them; say in the commit
   from bundles of what date. The Go byte-identity test must pass.
3. Ranking strips `wharf` like `station`, in `web/js/search.js` and
   `internal/stations/stations.go`, and the pinned case table gains
   `{"Manly Wharf", "manly", 1000}`, `{"Circular Quay Wharf", "circular",
   <value>}` and one wharf-versus-station pair, with the value generated
   from the client as the table's comment prescribes.
4. `api.md` stops: `modes` may include `"ferry"`; the bundle list names
   four; light rail and bus remain unreported. `tools/README.md` names the
   fourth bundle and its size.

Arithmetic: the rail index is 386 entries. Sydney Ferries serves about 40
wharves; the gate is 410 to 440 entries with every new entry's `location`
inside lat −34.2..−33.6, lon 150.9..151.4 (the harbour and Parramatta
River). An entry count outside that range means the keep rule is wrong.

Verify gate: entry count and bounding box as above; `curl
'localhost:8080/api/v1/stops?q=manly'` returns Manly Wharf first with
`modes: ["ferry"]`; `q=circular` returns one Circular Quay hub with train and ferry modes;
`go test ./...` and `npm test` green; `VERSION` bumped.

## Phase 2 — server — VERIFIED 2026-09-05

Additional live fixtures cover Side-only platforms and walks between
Wynyard and Barangaroo. Canonical names strip boarding-side suffixes;
outer walks that move boarding/alighting to a different stop are excluded
because this response cannot describe them.

Go tests and live direct/mixed API probes pass. Tests use the three ferry
captures, preserve existing rail outputs, and cover walk summation,
explicit zero, planned-time fallback and invalid negative/oversized walks.
Ferry exclusion and slack-sign mutations are rejected by the regressions.

Owns: `internal/tfnsw/client.go`, `internal/tfnsw/map.go`,
`internal/tfnsw/types.go`, `internal/tfnsw/*_test.go`,
`internal/api/server_test.go`, `docs/contracts/api.md` (departures
section).

1. Class 9 served (`design.md` "Mechanism" 2): `classFerry = 9`,
   `modeName` → `"ferry"`, exclusion list without 9 (comment updated with
   the date), `serviceLegs` accepts it, the stops index publishes `train, metro, ferry` order. The formerly
   described `serveableModes` helper no longer exists.
2. Slack rule: a helper computes the connection between two consecutive
   service legs as `next.departurePlanned − prev.arrivalPlanned − Σ walk`,
   where `Σ walk` sums the `duration` of the class-99/100 legs between them
   (fallback: each walk's planned arrival minus departure). `connectionFloorMet`
   and `longestConnection` both use it. `serviceLegs` retains the walking legs per gap in a servicePath for the
   policy while the response contains only services.
3. Tests: goldens from the three phase-0 fixtures (the mapped journeys,
   including a train-to-ferry change's `legDetail` with `mode: "ferry"`
   and a `Wharf n` platform); a unit test where a 5-minute gap holding a
   4-minute walk fails a 3-minute floor, and the same gap with no walk
   passes; the existing golden outputs unchanged (no rail fixture carries a
   walk inside a change short enough to flip, and the test proves it).
4. `api.md`: `mode` gains `"ferry"`; the excluded-class sentence names
   classes 4, 5, 7, 10, 11; the floor and ceiling paragraph states the slack
   rule and that response times are never rewritten.

Verify gate: `go test ./...` green including the new goldens; a local
server with the key answers `from=<Circular Quay wharf id>&to=<Manly id>`
with ferry journeys; `from=200080&to=<Manly id>` shows a change whose leg
detail has one `train` and one `ferry` leg.

## Phase 3 — client colour and words — VERIFIED 2026-09-05

The 52-frame browser matrix passed at both phone sizes and schemes,
including real Side A/B labels. Home, focus and setup states were
refreshed against the combined smart-header implementation and passed. Numeric chips stay compact while caps, directions and
accessibility retain the full upstream label. F1 and MFF paint FERRY while
retaining their visible codes.

Owns: `web/js/lines.js`, `web/app.css`, `web/test/theme.test.js`,
`web/js/rowmodel.js`, `web/js/journey.js`, `web/js/journeybar.js`,
`web/js/home.js`, `web/js/detail.js`, `web/js/focus.js`, `web/js/board.js`,
`web/js/setup.js`, their tests under `web/test/`, `web/test/fixture.js`,
`docs/contracts/ui.md`, `web/sw.js` (`VERSION`).

1. Colour by mode (`design.md` "Mechanism" 3): `COLOURS.FERRY = '#5AB031'`;
   a `colourKey(line)` that returns `FERRY` for mode `ferry` else the code;
   `--line-FERRY` and `--line-fill-FERRY` in the dark block; light
   `--line-FERRY: #428024` with its measured ratio in the comment. Every
   caller listed in the design passes the key. The theme test's loops cover
   the new key unchanged; add one assertion that `colourKey` of a ferry
   line with code `F1` and of one with code `MFF` both paint `FERRY`.
2. Words: `modeWords(mode)`; `platformNumber` strips `Platform ` or
   `Wharf `; each string in `design.md` "Copy" takes its word from the leg
   the design names. Loading and no-journey strings unchanged.
3. Fixtures: `web/test/fixture.js` gains a ferry journey and a
   train-to-ferry journey shaped like the phase-0 fixtures (mode `ferry`,
   platform `Wharf 3`, code `F1`). Unit tests: row colour key, cap text
   `Wharf 3`, focus instruction `Leave now for Wharf 3`, detail button
   `Take this ferry`, change step `· Wharf 3` when the boarded leg is a
   ferry and `· Platform 3` when it is a train.
4. `ui.md`: the line-colour paragraph records that ferry is a mode colour
   (one green, keyed by mode) and the light value; the copy rules record
   the vehicle and place words and the metro ruling beside them.

Copy gate: the Codex draft in `design.md` "Copy" must carry the owner's
verdict (a dated line under the table) before any string is written. If
the table says "draft", stop and ask.

Verify gate: `npm test` green; the theme test passes with `FERRY` in both
schemes; a seeded client (phase 5's states may be used early, without
exemplars) shows a green segment, a `Wharf 3` cap and the ferry words.

## Phase 4 — nearest-station tie-break — VERIFIED 2026-09-05

The stations.js seam and seven tests are built from the subsequently
discovered shv2-p4 implementation, retaining its exports and loader seam; the index and module are in
SHELL. smart-header-v2's plan now reuses this helper. The smart-header controller has since landed and calls the shared helper;
the client-storage contract now describes the integrated behavior.

Owns: `web/js/stations.js`, its test, `docs/contracts/client-storage.md`
(the tier wording). Build the stations.js seam from smart-header-v2
phase 2 now: loadStations, nearest and here. This avoids building unrelated
new prediction/storage behavior as a ferry dependency. Record the existing
helper in that phase so it is reused when the controller lands.

1. Tier 1 with several stations inside 200 m prefers one that is an end of
   a saved trip; among several such, or none, the nearest
   (`design.md` ruling 5).
2. Unit test: Two nearby station and wharf entries (Circular Quay itself is now one hub),
   fix 60 m from the wharf and 100 m from the station; with a saved trip
   from the station the pick is the station; with none it is the wharf;
   with trips from both it is the wharf.
3. `client-storage.md` tier text gains the one sentence.

Verify gate: the test above; the existing tier tests unchanged.

## Phase 5 — verification wave and closeout — in progress

Independent review is complete with no unresolved implementation findings.
Current combined-checkout gates: 263 web tests, all Go tests, 3 generator
tests, byte-identical indexes and clean diff checks. The production image builds for linux/amd64
and linux/arm64 as local `ilovetrains:ferries-review`; container health,
Manly/Circular Quay stop searches and worker-v19 delivery pass. Docker's
context now explicitly includes only build inputs, excluding local secrets
and downloaded feeds. Final-code live API probes pass for Manly, mixed
Wynyard–Manly, Balmain East and Barangaroo–Balmain, and all returned service
endpoints match the requested stops. Regression mutations prove ferry exclusion,
walk arithmetic, index mapping guards, saved-stop preference, itinerary
identity and dark-chip contrast tests bite. The 52-frame browser matrix
passed. After smart-header landed,
a duplicated station-index precache entry was removed and a regression
guard added and proven by mutation. The combined v19 image has been
rebuilt for both architectures and its runtime smoke passes. Worker v19
warm install and a true offline reopen pass. A persistent profile upgraded
from shell-v18 to shell-v19, removed the old cache, remained controlled,
and reopened offline with all required shell cache hits. Refreshed
smart-header-affected ferry states passed across all four phone/scheme
combinations. The owner's screenshot verdict,
exemplar updates, backlog deletion and deployment remain pending.

The build is one integrated code/contracts change with worker v19, so shell
files receive the version bump atomically. Review artifacts live in
`/tmp/trains-ferries-review/index.html` while the owner verdict is pending.
Implementation and contracts are committed as `be1b695`.


Owns: `tools/shoot-states.js`, `tools/comps/scenarios.js`,
`assets/comps/latest/`, `docs/PROJECT.md` (scope line), `docs/ROADMAP.md`,
`docs/contracts/*.md` (closeout migrations), `docs/backlog/ferries/`
(deleted at the end).

1. Seeds: a saved ferry trip (Circular Quay Wharf → Manly Wharf, real ids
   from phase 0, real coordinates) and a train-plus-ferry trip (Wynyard →
   Manly), with API-shaped documents built from the phase-0 fixtures. States:
   home with the ferry trip predicted, its board, journey detail, focused
   pre-departure (`Leave now for Wharf 3`), a train-to-ferry change on the
   board and in detail, the setup sheet showing `ferry` under Manly Wharf.
2. Shoot at the standard frames and both schemes with the documented
   invocation in `tools/README.md`; every geometry, tap-target and
   reachability probe passes. A `Wharf 3` cap that breaks the cap geometry
   or a green pin that fails the numeral rule is a defect to fix, not a
   caption.
3. Replace exemplars for every screen whose pixels changed; the sheet is
   written for the owner (concise prose, one measurement where it decides,
   every question has a shot).
4. Closeout per the `backlog-item` close stage: `PROJECT.md` "Trains and
   metro only" becomes trains, metro and ferries; the roadmap candidate line
   loses ferries; every surviving rule is in a contract; delete the folder;
   deploy per `docs/operations/deploy.md`.

Verify gate: the shooter run is green; the owner has verdicted the sheet;
the folder is gone and the contracts describe the shipped behaviour.
