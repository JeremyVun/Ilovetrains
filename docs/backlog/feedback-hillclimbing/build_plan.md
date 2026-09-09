# Feedback hillclimbing: build plan (this repository)

Scope: only the "this repo" row of the work table in `design.md`. The
daemon, the playtest lease and origin guard, the analytics columns and the
gateway model list are other repositories' items. Every phase here is
useful on its own and nothing in it waits on those items.

Owner ruling 2026-09-09 (build start): playtest's `app.clock` is built in
this run too, as `../playtest/docs/backlog/web-clock/`, so Phase 3 records
its baseline here rather than waiting.

Waves. Phases 0, 1 and 2 and the playtest clock item own disjoint files and
fork in parallel from main (each in its own `/private/tmp/hillclimb-*`
worktree). A Fable 5 adversarial review runs between each build wave and
its fix wave (owner approval 2026-09-09). Phase 3 forks from the merged
result of Phase 2 and the landed playtest clock. Phase 4 is the
verification wave and runs last on the final sources.

## Phase 0: the fixer contract

Owns: `docs/contracts/hillclimbing.md` (new), `docs/operations/deploy.md`
(release PR flow), `AGENTS.md` (one pointer under "Read first").

The contract states, for any automated fixer working in this repo:

- A bug is behaviour that contradicts a file in `docs/contracts/`. The
  fixer cites the file and section in its PR. Anything the contracts do not
  promise is a feature and is out of bounds.
- Never edit `docs/contracts/`, `assets/comps/latest/`,
  `tools/baselines/`, or anything in `web/sw.js` other than the `VERSION`
  constant. A fix that seems to need any of these stops and reports
  `needs_owner`. The `VERSION` bump is mandatory in the same change as any
  edit to a `SHELL` file, exactly as `AGENTS.md` already requires.
- Every fix carries a regression: a Go test on a captured fixture for API
  behaviour, a `web/test/` case or `shoot-states.js` state for client
  logic, and a `playtest/regressions/` journey case for anything a user
  sees. The regression must fail on `main` and pass on the branch, and the
  PR shows both runs.
- Branch `fix/<attempt-id>` where the attempt id is the finding id plus an
  attempt number. PR title is the finding title. The PR
  description's first line is the changelog entry, under sixty words, in
  the voice of `user-facing-copy`; then the finding link, the contract
  cited, gate results and the two regression runs.
- The release PR is `release/<version>`: bumps `web/js/version.js` and
  `web/sw.js`'s `VERSION`, and lists each merged fix's first line under the
  version. Both bumps happen on every release, because `web/js/version.js`
  is a `SHELL` file. Merging it is the deploy trigger; the daemon deploys
  that exact merge commit and comments the job id.

`deploy.md` gains a short "Release pull request" section describing that
flow next to the existing manual steps, which remain valid, and its step 2
notes that the stack pins the numbered tag through `config.env` once the
infra change lands.

Verify: a reader with only `AGENTS.md` and the contract can answer "may I
change this file" for every path in the repo. Done marker: the contract
exists, `AGENTS.md` links it, and `deploy.md` describes the release PR.

Done 2026-09-09 (f538c82).

## Phase 1: feedback carries platform and version

Owns: `web/js/settings.js`, its tests under `web/test/`, `web/sw.js`
(`VERSION` bump: `settings.js` is a `SHELL` file), `web/js/version.js`
(patch bump), `android/app/src/main/java/com/ilovetrains/app/TransitApi.kt`
and its unit test, `ios/ILoveTrains/Core/TransitAPI.swift` and its test,
`docs/contracts/analytics.md` ("Explicit feedback").

Seam contract. The submission body becomes exactly
`{project, category, feedback, platform, clientVersion}`:

- `platform` is one of `web`, `android`, `ios`, fixed per client.
- `clientVersion` is the canonical version string: `VERSION` from
  `web/js/version.js` on web, `BuildConfig.VERSION_NAME` on Android (already
  derived from the same file by `build.gradle.kts:16`), and
  `CFBundleShortVersionString` on iOS (`MARKETING_VERSION`, which the iOS
  release process keeps equal to `version.js`).
- Neither field is personal and neither enters `/e`, storage, logs or the
  service worker cache; the existing sentence in `analytics.md` extends to
  them.
- Size arithmetic: measured at version `1.5.1`, the two fields add 41 bytes
  of encoded JSON on web and iOS and 45 on Android, taking the empty-message
  envelope from 60 bytes to 101 and 105. Both caps stay as the contract
  states them, the message at 8,192 UTF-8 bytes and the body at 10,240, and
  the body cap is what a heavily escaped message hits first. A message that
  sat exactly at the body cap under the three-field body is now refused with
  the same "too long" copy; the boundary probes on all three clients pin the
  new limit.
- Analytics ignores the fields until its own item stores them; the request
  must succeed with 201 either way (the [verify] item in `design.md`).

Verify: `(cd web && npm test)`; `tools/check-settings-browser.js` (page-local
feedback fixture) asserts the exact body; `tools/build-android.sh --unit`
and `tools/build-ios.sh --unit` with the feedback tests asserting the body.
No visual change, so no visual-regression run. Done marker: all three
clients' tests pin the five-field body and `analytics.md` states it.
Done 2026-09-09 (ef73695).

## Phase 2: fixture-backed TfNSW stub

Owns: `tools/tfnsw-stub/` (new Go program), `tools/fixtures/stub-routes.json`
(new), `tools/README.md` (one section), `AGENTS.md` ("Local development":
one paragraph on running without a key).

Seam contract:

- The stub listens on a port given by `--port` and serves the one Trip
  Planner path the server calls, `/trip` (`internal/tfnsw/client.go:146`;
  corrected 2026-09-09: `departure_mon` and `stop_finder` are probe-only
  fixtures and `/api/v1/stops` is served from the bundled station list), and
  the GTFS schedule and realtime feed paths in `internal/native/feed.go`.
  The server is pointed at it with `TFNSW_BASE_URL` and
  `TFNSW_FEED_BASE_URL` and any non-empty `TFNSW_API_KEY`. The server must
  boot and answer `/api/v1/departures` from the bundled bootstrap timetable
  when a feed path has no fixture: an unmatched feed request gets the same
  404 body as any other unmatched path, and the realtime refresh already
  logs and retains on error.
- `stub-routes.json` maps a request to a fixture by path plus a subset of
  query parameters (for `/trip`: `name_origin` and `name_destination`; for
  feed paths: the path alone). The first matching route wins; no match
  returns 404 with a JSON body naming the path and the query so a fixer
  knows which fixture to capture with `tools/probe-tfnsw.sh`.
- Fixtures are served verbatim. Each route records an `anchor`: the
  instant at which the fixture's departures read as a few minutes ahead.
  A regression case pins the browser clock to that anchor (D14), so no
  timestamp rewriting is needed and the GTFS-RT `.pb` fixtures need no
  special handling. `--list-anchors` prints route and anchor for case
  authors.
- The stub has no key, reads only `tools/fixtures/`, and logs one line per
  request.

Verify: `go test ./tools/tfnsw-stub/...` covers route matching, the 404
body and anchor listing; a smoke script in the README boots stub and
server and fetches `/api/v1/trips` for Central to Parramatta and receives
the fixture's journeys. Done
marker: the smoke script passes with no `TFNSW_API_KEY` present in the
environment.

Done 2026-09-09 (08fd2f2).

## Phase 2p: playtest `app.clock` (in `../playtest`)

Owns: `../playtest/docs/backlog/web-clock/design.md` (the item), the
playtest web driver and config resolution (`packages/core/src/types.ts`,
`config/resolve.ts`, `driver.ts`, `drivers/web.ts`), the case schemas, the
core tests, `docs/contracts/engine.md` and `README.md` there. Nothing in
this repo.

Seam contract: `app.clock: { time: <RFC 3339 instant>, timezone: <IANA> }`
is a web-only environment key, valid in `playtest.yaml` defaults and a
case, like `viewport`; not in an `app.envs` overlay and not settable by a
hosted ring (owner ruling 2026-09-09 after the Fable review found the
original "wherever viewport is valid, including overlays" sentence
self-contradictory). It is applied at browser context
creation for record, act and heal alike: `timezoneId` on the context and
Playwright's clock API so that `Date.now()` and `new Date()` in the page
return the fixed instant on every call while timers keep running (the app's
refresh loops must not stall). It is echoed in the resolved case and the
run manifest. Omitted means real time, as today. A mobile or API case that
declares it is a configuration error naming the key.

Verify: `npm run typecheck`, `npm run test:core`, and one real Chromium
probe under `test:browser` that loads a page printing `new Date()` twice a
few hundred milliseconds apart and asserts both equal the fixed instant in
the given timezone. Done marker: landed on playtest `main`, since
`/opt/homebrew/bin/playtest` runs that checkout's source directly.

## Phase 3: checked-in regression suite

Depends on Phase 2 (the stub) and Phase 2p (`app.clock`, D14). Forks from
the merged result of both.

Facts from Phase 2 (2026-09-09) that bind this phase: the board endpoint is
`/api/v1/departures?from=&to=` (there is no `/api/v1/trips`); Central is
`200060` and Parramatta is `215020`; the Central to Parramatta route's
anchor is `2026-08-31T22:44:00+10:00` and its first departure
`22:48`; the server's clock is real and only the browser is pinned, which
is safe because the client clamps data age at zero and the server drops
nothing by wall clock when `at` is absent; the past-window fixture is
unreachable because the server bounds `at` by its own clock, so no case
uses it; `AGENTS.md` is a symlink to `CLAUDE.md`, so its gate list is
edited there; the playtest CLI under review lives at
`/private/tmp/hillclimb-playtest-clock` until it lands on playtest `main`,
so the script runs `${PLAYTEST_BIN:-playtest}` and the build sets
`PLAYTEST_BIN` to that checkout's `packages/cli/src/cli.ts` via `node`.

Owns: `playtest/regressions/` (new: `playtest.yaml`, `stories/`, `state/`,
`results/`), `tools/playtest-regressions.sh` (new), `AGENTS.md` (gate
list), `tools/README.md` (one section).

Seam contract:

- `playtest.yaml` declares `app.driver: web`, `mode: journey`, and
  `base_url` from `PLAYTEST_BASE_URL`, defaulting to the port the script
  chooses. Cases live under `stories/`. Each case sets `app.clock` to the
  anchor of the fixtures it relies on with timezone `Australia/Sydney`,
  and the script exports the same `TZ` for the server and the stub. Storage-state seeds under `state/` are synthetic and reuse the
  shapes already committed to the hosted `user-stories` suite.
- `tools/playtest-regressions.sh` boots the Phase 2 stub and the Go server
  on free ports, exports the base URL, runs
  `playtest ./playtest/regressions --json`, tears both down, and exits with
  playtest's code: 0 pass, 1 gate failure, 2 infrastructure. It passes
  `--fresh` through when given.
- The gate command is `playtest ./playtest/regressions --no-grade --json`
  with `PLAYTEST_LLM_BASE_URL` and every model key unset. That is
  playtest's only keyless path (`packages/cli/src/cli.ts:540-548`):
  committed baselines replay, drift or an action failure fails the run
  because no model is available to heal (`docs/contracts/engine.md:1022`),
  and a case without a baseline fails preflight instead of recording.
  Recording a new case is a separate, explicit step the fixer runs with
  `PLAYTEST_LLM_BASE_URL=http://127.0.0.1:8900`; the resulting baseline
  under `results/` is committed with the case. Cases use only
  deterministic `success:` checks; the natural language `assert` is
  rejected by the script before the run.
- One seed case proves the lane: "Home answers for a saved trip" using a
  seed with one saved trip whose fixture is in `stub-routes.json`, with a
  `success:` gate on `element_exists` for the smart header and an
  `element_exists` text selector for the destination name. Web cases may
  use only `element_exists`, `url_matches`, `api_called`,
  `console_errors`, `accessibility_violations` and `invariant`; the
  script rejects any other kind, and `assert`, before the run. The `playtest-ci` skill's hard
  rules apply: nobody edits `story:` or `success:` to make a failure pass.

Verify: the script passes twice in a row, on different days or with the
system clock moved, on the committed baseline with no LLM base URL set, fails with exit 1 when a baseline step is deliberately
broken (no heal, no record), and exits 2 with a clear message when the stub port is
unreachable. Done marker: the script is listed as a gate in `AGENTS.md`
and passes on the final sources.

Done 2026-09-09 (9f7a1b1).

## Phase 4: verification wave

Owns nothing. Runs on the final merged sources of Phases 0 to 3:

```sh
go test ./...
(cd web && npm test)
tools/build-android.sh --unit
tools/build-ios.sh --unit
tools/playtest-regressions.sh
```

The Android and iOS full gates run only if Phase 1 touched anything beyond
the feedback request body. Done marker: every command exits 0 and the
results are recorded in this file with the commit they ran against.

Results on `29c8cf9` (the wave 1 fix commit, final sources), 2026-09-09:
`go test ./...` ok in every package including `tools/tfnsw-stub` (21 tests);
web 372 pass, 0 fail; Android unit 119 tests, 0 failures across 20 classes;
iOS unit 137 tests, 0 failures; `tools/tfnsw-stub/smoke.sh` pass with no
key; `tools/playtest-regressions.sh` exit 0 on the landed playtest CLI
(`home-answers-saved-trip` pass, not healed, not changed). The full native
gates were not run: Phase 1 changed only the feedback request body and its
tests. Done 2026-09-09 (29c8cf9).

## Landing (parked 2026-09-09, owner ruling)

Every phase is done and verified on branch `hillclimb/stack` (worktree
`/private/tmp/hillclimb-stack`). Landing on `main` was parked by the owner
because main held uncommitted peer edits (the commute-feedback work) on
`web/js/settings.js`, `web/js/version.js`, `web/sw.js`, `tools/README.md`
and `ios/ILoveTrains.xcodeproj/project.pbxproj`. To land once main is clean
on those files: merge `hillclimb/stack`, keep the higher of each version
(`web/js/version.js` 1.5.1 on both sides; `web/sw.js` `VERSION` is v55 here
and v56 in the peer edit, so v56 or higher wins), resolve the pbxproj by
regenerating with `tools/generate-ios-project.rb`, rerun `(cd web && npm
test)` and `tools/playtest-regressions.sh`, then run the close stage of
the `backlog-item` skill. The playtest `app.clock` change is already on
playtest `main` (94da9e8), so the gate uses the plain `playtest` on PATH.

## Closeout

Migrate the fixer contract (already durable in Phase 0), the stub and the
regression suite's descriptions into `tools/README.md` and `AGENTS.md`,
record the feedback body in `analytics.md`, add the daemon's requirements
to `docs/operations/deploy.md`, and delete this folder. The daemon, lease,
origin guard and analytics columns are tracked in their own repositories.
