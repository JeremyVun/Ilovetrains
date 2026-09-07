# Transfer cap and a user setting for it

Opened 2026-09-07 by the owner while reviewing the native code review comps
(`docs/backlog/native-review/comps/review-sheet.png`). Design stage is
**closed 2026-09-07** after three comps rounds: the mechanism, the copy,
the Settings row and the journey-line posture are all ruled below.
`build_plan.md` is the build.

## What and why

A journey with several changes names every change station beneath its
journey line, and the line is about 300 pt wide on a phone. Two names fit;
three or four do not read, and a rider who must change three times is not
served by a single row anyway. Offline routing already stops at two changes;
online results are uncapped, so the many-change row exists only online and has
never been designed.

The feature: the server drops journeys with more than two changes, riders
who want them can turn the cap off in Settings, and the whole thing sits
behind one feature flag so the owner can switch it off and get today's
behaviour back without a release.

## As built today (verified 2026-09-07)

- **Offline routing caps at two transfers** on both platforms
  (`OfflineRouter.kt:36`, `OfflineRouter.swift:123`, `maxTransfers = 2`),
  and `native-data.md` records it. The router's label state is keyed by
  `(transfers, stop sequence)`, so its work grows with the bound.
- **Online results are uncapped.** `internal/tfnsw/client.go` asks the Trip
  Planner for `calcNumberOfTrips = max(10, 2 × limit)`, maps, drops journeys
  that fail the mode allow-list or the connection floor and ceiling, then cuts
  to `limit` (`map.go:113-181`). Nothing looks at the change count.
- **No captured upstream response holds a three-change journey.** Across every
  fixture under `tools/` and `internal/`: 80 journeys, 48 direct, 27 with one
  change, 5 with two, none with more. The Trip Planner routes through Central
  and Town Hall and rarely needs a third change.
- **Modes are filtered twice**, and the cap copies that exactly: the server
  excludes disabled classes upstream and drops offending journeys *before*
  `limit` so the board still fills (`api.md`, "A `modes` subset…"); the
  clients also filter their cached bodies on read (`filterBody` in
  `web/js/preferences.js`, `CacheEntry.modes` on iOS, the Android
  equivalent) so a changed preference applies instantly and offline.
- **The exemplar stops at two changes.** `ui.md` names
  `board-390x844-two-change` the two-transfer row grammar; the `threeLeg`
  fixture in `web/test/fixture.js` is its stress delta. The rule "intersecting
  change names use separate lines and expand the row" is written for N names
  but has only ever been shot for two.
- **Preferences are one local document per client** (`preferences` in
  `trains.v1` on the web; `UserData` on Android and iOS) with
  `appearance`, `useLocation`, `homeOverride` and `enabledModes`, all
  "omitted means the default".
- **The repo has no feature-flag channel.** `EXPERIMENTS` in
  `web/js/analytics.js` is a web-only, device-bucketed A/B mechanism;
  server tuning is start-up environment variables (`MIN_CONNECTION_TIME`).
- **The owner's flag service is flagsd** (`~/projects/flags`,
  `docs/CONTRACT.md` there). It is internal-only: browsers and phones never
  talk to it. Each project's own edge API consumes flags through an SDK and
  publishes evaluated values of flags marked `public`. A Go SDK and a .NET
  SDK exist; neither is tagged or published, and the GitHub repo is private.
  No JavaScript, Kotlin or Swift SDK exists and none is needed, because our
  Go server is the edge.
- **Production topology** (infra repo `stacks/`): flagsd sits on the flags
  stack's private bridge plus `shared-db`; ilovetrains sits only on
  `edge-proxy`. They cannot reach each other today.
- **`docs/PROJECT.md` principle 3** reads "No 'max transfers' setting, no
  'prefer fewer changes' toggle … the default posture is that there is
  none."

## Decisions

All rulings are the owner's, 2026-09-07, in the order asked.

1. **The setting ships alongside the cap.** Alternatives put: a fixed cap of
   two with no setting (recommended, on principle 3 and the fixture
   evidence) and deleting the item. Principle 3 is amended in the same change
   to name this setting as the justified exception; its "default posture is
   none" sentence stays.
2. **Two values: `2 changes` (default) and `Any`.** Put as four values
   (Direct only, 1 change, 2 changes, Any) versus two. The on-screen labels
   were later ruled `Up to 2` and `No limit` (see "Copy"). `Any` is uncapped,
   which is today's online behaviour, so a journey with three or more changes
   becomes a real row that comps must design.
3. **Enforced on the server before the limit, plus a client filter over
   cached bodies**, exactly as modes are. A phone-only filter was rejected
   because it runs after the server has cut to `limit` and leaves thin boards.
4. **The offline planner follows the setting.**
5. **Everything sits behind one public feature flag** consumed by the server
   and all three clients, served by flagsd. Flag off means exactly today's
   behaviour: no Settings row, no query parameter, no server filter, offline
   at two transfers, stored preference ignored but kept.
6. **The Go SDK is vendored**, as flagsd's own admin-ui vendors the core:
   `go.mod` replaces the two flags modules with the sibling checkout, `vendor/`
   is committed, the Docker build uses `-mod=vendor`. Rejected: tagging the
   flags repo and pulling it with `GOPRIVATE` plus a build credential.
7. **A new external `shared-flags` network** carries flagsd to its consumers,
   created once at bootstrap like `shared-db`. Rejected: attaching ilovetrains
   to the flags stack's own bridge.

Decisions made in design and put to the owner on 2026-09-07. D1, D2 and D3
were approved as written; D4 was changed by the owner to the single name
`transferLimit`.

- **D1. No cap-specific empty-board copy.** Unlike modes, the client cannot
  tell whether the cap emptied a board: the server does not report what it
  dropped. Inventing "No journeys with up to two changes" would be a guess,
  and the case (a pair whose every journey needs three changes) has never
  been observed. The Settings row's note carries the explanation instead.
- **D2. Offline `Any` is bounded at four transfers.** Ruling 4 says offline
  follows the setting, but the router's label space grows with the bound and
  "uncapped" has no finite meaning there. Four covers any plausible Sydney
  journey (three changes have never been observed) while keeping the search
  bounded. `2 changes` sets two; flag off sets two.
- **D3. The cache is not re-keyed by the cap.** Modes are part of the client
  cache key; the cap is only a read-time filter plus a request hint. A cached
  capped body viewed under `Any` lacks the rare three-change rows until the
  refetch that every preference change already triggers; a cached uncapped
  body under `2 changes` is filtered thin until the same refetch. Both heal
  on the next answer, and the key space does not double.
- **D4. Names (owner ruling 2026-09-07: the flag, the query parameter and
  the saved preference are all called `transferLimit`).** flagsd project
  `ilovetrains`, environment `production`, flag key `transferLimit`
  (boolean, public, default off). Server environment `FLAGSD_URL` (config)
  and `FLAGSD_KEY` (secret). API query parameter `transferLimit`. Preference
  field `transferLimit` with values `two` and `any`. Client flag memory
  `flags` (an object of flag key to boolean). Where a sentence could mean
  either, it says "the `transferLimit` flag" or "the `transferLimit`
  preference".
- **D4a. flagsd stores the flag as `transfer_limit` (build-time finding,
  2026-09-07, pending owner confirmation).** flagsd validates every key
  against `^[a-z][a-z0-9_.-]*$` (`server/internal/api/validation.go:13`),
  so `transferLimit` cannot be created there. The nearest legal spelling is
  `transfer_limit`. The translation lives only in `internal/flagsd`: the
  adapter maps the server's public name `transferLimit` to the flagsd key
  `transfer_limit`. `/api/v1/flags`, the query parameter, the preference and
  every client keep `transferLimit`. If the owner prefers a namespaced key
  (the flags skill's convention is `area.thing`, e.g. `board.transfer_limit`)
  it is one string in the adapter and one in the runbook.

- **D5. The flag rides the shipped flags channel (integration finding,
  2026-09-08).** While this item was being built, a peer session landed and
  deployed its own flagsd integration on main for the `tiny_train` Easter egg
  (commit 6182609 and its follow-ups, production 1.3.1, service worker
  `v47`). It is the shipped contract, so this item adapts to it rather than
  the reverse: the SDK is the owner-approved snapshot under
  `third_party/flags/` (not `vendor/`); the server reads `FLAGS_URL`,
  `FLAGS_KEY`, `FLAGS_PROJECT` (default `ilovetrains`) and `FLAGS_ENV`
  (production's flagsd environment key is `prod`, not `production`); the
  provider is `api.WithPublicFlags(func() map[string]any)` built by
  `cmd/server/flags.go`; `GET /api/v1/flags` answers a flat object of
  published name to evaluated boolean with `Cache-Control: no-store`, e.g.
  `{"tiny_train": false, "transferLimit": false}`; there is no `version`
  field. The published name stays `transferLimit` (D4) and maps to the flagsd
  key `transfer_limit` (D4a) in the handler's public-flag table. Clients
  persist the answer in their local document as designed (the tiny train
  deliberately does not; both patterns coexist). The service worker serves
  `/api/v1/flags` network-only, which is fine because the persisted `flags`
  value is what an offline open uses. Infrastructure already exists: the
  ilovetrains stack joins `shared-flags`, `FLAGS_KEY` is sealed, and the owner
  has created both public flags in flagsd, including `transfer_limit`, which
  also confirms D4a. Phase 2's `internal/flagsd`, `vendor/`, `FLAGSD_*`
  variables and Docker vendor lines are dropped in integration.

## Mechanism

### The flag, end to end

1. **flagsd** holds project `ilovetrains`, environment `production`, boolean
   flag `transferLimit` marked `public`. It is created and toggled in the
   admin UI at `flags.jeremyvun.com`. An environment-scoped read key is
   minted there for the server.
2. **The server** builds a flags client at start-up from `FLAGSD_URL` and
   `FLAGSD_KEY` with project `ilovetrains`, environment `production`,
   application `ilovetrains`, `FailDefault`, no stale threshold, and
   `LocalCachePath` under `NATIVE_DATA_DIR` so a restart while flagsd is down
   keeps the last snapshot. If either variable is unset the client is nil and
   every flag reads its default. The SDK never blocks boot; until the first
   snapshot the flag reads `false`. Evaluation uses an empty context: no
   identity exists server-side, so percentage rollouts are unsupported by
   design and the flag is on or off for everyone.
3. **`GET /api/v1/flags`** answers `{"version": "<snapshot version or
   empty>", "flags": {"transferLimit": <bool>}}`. The server names its
   public flags; it never forwards a snapshot. `Cache-Control: public,
   s-maxage=60, stale-while-revalidate=300`, so a flip reaches new opens
   within about a minute. The endpoint exists whether or not a flags client
   is configured.
4. **Every client** requests `/api/v1/flags` once per open, in the
   background, never before first paint. The answer is persisted in the
   local document as `flags` and read synchronously at the next open. Absent
   means every flag off. The web service worker already serves `/api/`
   network-first with a cached fallback, so an offline open keeps the last
   answer even before the document is read. When a fresh answer changes
   `transferLimit`, the client behaves as if the preference changed
   (below): Settings repaints and the current board refetches.

### The cap

- **API.** `GET /api/v1/departures` gains `transferLimit={n}`: a non-negative
  integer no greater than 9, else `400`. Omitted means no cap, which keeps
  every existing client's behaviour. A journey whose `legs - 1` exceeds `n`
  is dropped in the same pass as the mode drop, before the connection rules
  and before `limit`, so eligible replacements fill the board. `changes`
  joins the cache key. When the `transferLimit` flag is off the server treats the
  parameter as omitted and leaves it out of the key. Clients on `2 changes`
  send `transferLimit=2`; on `Any` they omit it.
- **Preference.** `transferLimit` is `two` or `any`; omitted or anything else
  reads as `two`. It lives beside `enabledModes` on all three clients and
  never leaves the device except as the `transferLimit` hint on the stateless
  departures query. While the flag is off the value is ignored and retained.
- **Client filter.** `journeyAllowed` gains the cap: under `two` a journey
  with `legs > 3` is not allowed. `filterBody` and every native equivalent
  apply it wherever modes are applied: the board, the smart header, the
  next-service rail, cancellation replacements and focus alternatives all
  derive from the filtered body and need no separate rule.
- **Changing the preference** does what changing services does (`ui.md`,
  Settings): keep eligible cached rows, fetch replacements through the
  departures API, never restore excluded journeys on failure.
- **Focus.** The followed journey's refresh request is uncapped, as it is
  all-mode. Visibility follows the preference; the stored snapshot survives
  a later cap and returns under `Any` while still current.
- **Offline.** `OfflinePlanner` passes the router a bound derived from the
  effective preference: `two` or flag off → 2, `any` → 4 (D2). The router
  keeps its constructor default of 2.
- **Empty boards** keep their existing copy (D1).
- **Analytics.** None. "Preferences cause no new history or prediction
  exposure event" (`ui.md`) applies; the flag is not an experiment.

### Settings (ruled in comps rounds 1 to 3)

One row inside the Services group, directly below the services note, in
the Location row's composition without its icon column: title
`Transfer limit` on the left, the current value as the subtitle (`Up to 2`
or `No limit`), the other value as the action mark on the right in the
mark's letterspaced caps (`NO LIMIT` or `UP TO 2`). Tapping the row swaps
value and mark. The row is one 56px button read as title, subtitle, then
action, exactly as the Location row is specified in `ui.md`; it adds no
heading, no note, no glyph, no journey line and no colour (owner ruling,
round 3). Exemplars: `comps/settings-390x844-transfer-limit.png` (default,
dark), `comps/settings-390x844-transfer-limit-any.png` (uncapped),
`-light`, `-all-off`, `-long-home`, `comps/settings-412x732-transfer-limit.png`
and its `-light`; `comps/settings-390x844-flag-off.png` is the flag-off
"before", which must stay pixel-identical to today's Settings. Every frame
was drawn by the shipped Settings renderer with the row added; the probes
report no overflow, spill or clipping, a 56px row in every state, and a
412×732 page that scrolls 9px with the row and 0px without it. The row is
absent when the flag is off, and Settings then renders exactly as today.

The journey line does not change in this item: a three-change row renders
as shipped code renders it (ruling, round 1). The row is taller than a
two-change row, so a board of such rows may show fewer than six whole
services; `ui.md`'s "all six remain whole" sentence is qualified to two
changes. The Home header is untouched.

### Contract and document changes

Same change as the code: `api.md` (`transferLimit`, `/api/v1/flags`, the flag
posture), `client-storage.md` (`transferLimit`, `flags`), `ui.md` (Settings
row, six-services sentence), `native-data.md` (offline bound), `PROJECT.md`
principle 3, `docs/operations/deploy.md` (variables, network, the flags
admin steps), the project `CLAUDE.md` runtime-variable list, and
`tools/README.md` if any instrument changes.

### Infrastructure (infra repo, `deploy-stack` skill)

- Bootstrap: `docker network create shared-flags` once on the host.
- `stacks/flags/docker-compose.yml`: `flagsd` joins `shared-flags`; the
  network is declared `external: true`.
- `stacks/ilovetrains/docker-compose.yml`: the service joins `shared-flags`;
  `config.env` gains `FLAGSD_URL=http://flagsd:8080`; `secrets.env` gains
  `FLAGSD_KEY` (the owner pastes the minted key; it is sealed, never read).
- flags admin UI: create project `ilovetrains` (production only), flag
  `transferLimit` boolean public, off; mint a read-only key scoped to
  `ilovetrains/production`.

### Build mechanics

- `go.mod`: `require github.com/JeremyVun/flags/sdk/go v0.1.0` and
  `github.com/JeremyVun/flags/server v0.1.0`, with `replace` lines to
  `../flags/sdk/go` and `../flags/server`; `go mod vendor` with the sibling
  checkout present. The core is stdlib-only, so `vendor/` stays small.
- `.dockerignore` allow-lists `vendor/`; the Dockerfile copies it and sets
  `GOFLAGS=-mod=vendor`. Local `go test ./...` also builds from `vendor/`
  once it exists, so a checkout without `../flags` still builds.

## Lenses applied

- **Should it exist?** Argued against (principle 3, no observed data); the
  owner ruled for it. Recorded, not relitigated.
- **Simplify.** The cap reuses the mode pipeline at every layer rather than
  adding a second filter path. The flag needs a channel that does not exist;
  the smallest one that meets "one switch, three clients" is the edge
  endpoint the flags contract already prescribes.
- **Edges.** Flag flips mid-session (treated as a preference change); flagsd
  down at boot (default off, last snapshot from disk); a stale client sending
  `transferLimit` after the flag is turned off (ignored, not rejected); `Any` with
  ferries off (unchanged mode rule); a cached body of the wrong cap (D3);
  offline `Any` (D2); an old app version that never fetches flags (omits the
  parameter, sees uncapped results, exactly today).
- **Consistency.** The upstream contract's `legs` definition already excludes
  walking legs, so `legs - 1` is the change count everywhere.

## Rejected alternatives

- Fixed cap with no setting, or deleting the item (ruling 1).
- Four setting values or a numeric stepper (ruling 2).
- Phone-only filtering (ruling 3, thin boards).
- A `maxChanges` upstream parameter: unverified for TfNSW, and the server
  already fetches spare candidates and filters locally.
- Flag echoed inside departures responses: Settings could not know the flag
  before the first board.
- Per-client compile-time flags: four places to flip, three releases to turn
  off.
- Web experiment bucketing (`EXPERIMENTS`): web-only and per-device, not a
  switch.
- Cap-specific empty copy (D1) and re-keying caches by cap (D3).

## Comps round 1 (2026-09-07)

Workshop `/tmp/trains-comps-transfer-cap-r1` (sheet `index.html`, report
kept here as `comps/OPTIONS-r1.md`, sheet as `comps/sheet-r1.html`). Four
concepts, each answering the Settings choice and the three-change line,
every frame drawn by the shipped web modules bundled verbatim
(`c1-pair-390x844-two.png` was pixel-identical to the two-change exemplar).

Owner rulings, in the owner's words where given:

- Settings, first pass: "Single row in Services: Changes / Up to 2 / ANY
  NUMBER" (c2). Asked again plainly with the sheet open, the owner ruled
  "Combination of C2 and C4": the single row inside Services carrying c4's
  small journey-line preview. Refused: the paired band under its own
  heading on its own (c1), the band with the other words and a note (c3).
- Journey line: "keep shipped rendering. If you want to make a visual
  improvement, you must do a design comp and present first." The c4 remedy
  (hide alighting numerals after the first change, smaller name band, pins
  slid apart) and the c2 slide are refused for this item.
- Home header: "No, header keeps drawing every numeral."
- The owner declined a `debate` review; the build follows the comps.

Findings recorded, out of scope by the rulings above, for a future comps
round if the owner wants one: at three changes on a four-minute middle leg
the shipped row draws the alighting pin over and left of the boarding pin,
so travel order reads wrong; the Home header draws all six numerals and
stacks names on three lines; at font scale 1.3 the six pins exceed the axis
and the clamp cuts two numerals; station-name length changes nothing, the
pins are the mechanism; a three-change row is 145px against 127px, so a
390 board shows five whole services instead of six.

## Comps round 2 (2026-09-07)

Workshop `/tmp/trains-comps-transfer-cap-r2` (report `comps/OPTIONS-r2.md`),
three placements of the journey-line preview inside the single row (beside
the value, under the value, in the icon column). Owner verdict on the
placements: "try again, you can do better." Two rulings landed with it:

- The row is titled **`Transfer limit`**, "not changes".
- When every service is switched off: "Hide the line, keep the words."

## Comps round 3 (2026-09-07)

Workshop `/tmp/trains-comps-transfer-cap-r3` (report `comps/OPTIONS-r3.md`),
four rows carrying a real journey-line preview (a two-cell switch, a
full-width specimen, a kept-and-excluded pair, a pinned line beside the
value). Owner verdict, verbatim: "I dont think any of them work. it was an
interesting experiment, but not one that panned out. Just keep the settings
option nice and boring - no lines, no colours." Uncapped value ruled
`No limit`.

**Final Settings design.** The round-1 single row (concept c2) inside
Services, with no preview: title `Transfer limit`, values `Up to 2` and
`No limit`, no note, no glyph, no colour. The exemplar frames in `comps/`
are that row re-rendered with the final words
(`/tmp/trains-comps-transfer-cap-final`).

## Copy (Codex drafts 2026-09-07, ruled through the comps rounds)

Codex (`gpt-5.6-sol`) drafted, from the prompt kept at
`/tmp/transfer-cap-copy-prompt.txt`:

- Group name: `Changes` or `Change limit`.
- Value pairs (capped / uncapped): `Up to 2` / `Any number`, or `2 max` /
  `No limit`. The owner's own words when ruling the value count were
  `2 changes` and `Any`; both pairs go on the sheet beside them.
- Note line: `Trips follow the chosen limit on changes.` or `Trips stay
  within the chosen change limit.` Codex's own recommendation: no note is
  needed with `Changes: Up to 2 / Any number`. The owner's standing taste is
  to delete copy before rewriting it, so the round shows at least one
  concept without a note.
- Accessible label: the pattern is the choice's full phrase plus its state,
  e.g. `Up to 2 changes, selected`, matching `Trains, on` in form.

Ruled: title `Transfer limit` (round 2), values `Up to 2` and `No limit`
(round 3), no note.
