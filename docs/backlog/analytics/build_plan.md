# Build plan: analytics and A/B testing

Read `design.md` first; this plan cites it and adds nothing to the rulings.
Every phase is briefed to a fresh agent with this folder and the contracts
only. Phases 0 and 1 build today, as one wave on a worktree from main. Phases
2 and 3 can now build against the landed smart-header controller: its phase
3 and lifecycle fixes are on main through `2055924` (2026-09-05). Brief
phase 2 and phase 3 as one code wave against that controller. Code waves and the
verification wave are separate; the wave that blows a budget is
verification, not code.

Build audit (2026-09-05): analytics phases 0 and 1 are complete. The
smart-header dependency is now on main, including storage and controller
integration. Analytics controller instrumentation and A2 are built and unit-tested.
The browser verification matrix is complete. Deployment succeeded with
worker v20; protected production readback remains.
The header's physical-phone speed observation remains in its own backlog.

The same audit fixed three transport defects: overlapping flushes now share
one in-flight fetch, malformed queue entries are treated as an empty queue,
and known-offline flushes call neither fetch nor beacon. `createAnalytics`
accepts an optional `isOnline` function for tests; its browser default checks
`navigator.onLine`. The existing 2xx/beacon acceptance rule is unchanged.
The controller still owns the closed event vocabulary: never pass arbitrary
data or caller-supplied `u` into `track`.

Verification: all 273 web tests and `go test ./...` pass. The first real-client
flows verify exact event order, setup cancellation, repeated actions and
zero local analytics requests. The required 390×844/412×732 matrix passes
in both schemes; A2 and its long destination also pass at 360×780. A2
measures a 258.25px rule and 44px CHANGE target. The local production-host
probe verifies first-open assignment/payload and GPC/DNT/blocked-storage
silence. Phase 5 owns deployment and authenticated readback.

Global rules for every phase:

- No Go changes. The server stays exactly as it is.
- Nothing analytics does runs between open and paint: `track` is a
  synchronous push; sending is deferred (design.md, Constraints).
- An event name or dimension value not in design.md section 4 is a
  contract change: stop and ask, do not invent.
- `web/js/analytics.js` joins `SHELL`; the phase that adds it bumps
  `VERSION` in `web/sw.js` in the same change, and every later phase that
  touches a shell file bumps it again.
- Gates: `(cd web && npm test)` and `go test ./...` stay green in every
  phase, even though no Go changes.

## Phase 0 — storage and contract — DONE marker: `analytics phase 0 done` — DONE f4dfb20

Owns: `web/js/storage.js`, `web/test/storage.test.js`,
`docs/contracts/client-storage.md`.

Seam:

- The document gains an optional `telemetry: {opens, bucket}`
  (design.md section 2). `parseDoc` keeps it when `opens` is a
  non-negative integer and `bucket` is an integer 0–99, and drops the
  whole field otherwise (dropped, not repaired, like `locationAsk`).
  `serializeDoc` writes it when present. `emptyDoc` has no `telemetry`.
- `recordOpen(doc, random)` → a new document whose `telemetry.opens` is
  one higher, drawing `bucket` from `random()` (a function returning a
  float in [0, 1), so tests can pin it) when the field did not exist.
  Pure; the caller decides whether analytics is enabled and never calls
  it when not.
- `userClass(doc)` → `'new'` when `telemetry` is absent or `opens ≤ 3`,
  else `'ret'`. The threshold is one constant, `NEW_OPENS = 3`.

Arithmetic a builder checks its tests against: opens 1, 2, 3 → `new`;
4 → `ret`; no field → `new`. `random() = 0.37` → `bucket 37`;
`random() = 0.999` → `bucket 99`; `0` → `0`. A parsed
`{"opens": "7"}`, `{"opens": 2, "bucket": 100}` or `{"opens": -1}` is
dropped entirely.

Gate: storage tests cover keep, drop, increment, draw-once (a second
`recordOpen` keeps the bucket), and the round trip through `trains.v1`.
`client-storage.md` documents the field, its write rule, that only the
`new`/`ret` word derived from it ever leaves the device, and the
separate `trains.analytics.v1` queue key (phase 1 fills in its shape).

## Phase 1 — the client module — DONE marker: `analytics phase 1 done` — DONE f4dfb20

Owns: `web/js/analytics.js` (new), `web/test/analytics.test.js` (new),
`web/sw.js` (`SHELL` + `VERSION`), `docs/contracts/client-storage.md`
(queue shape only).

Seam, `web/js/analytics.js`:

```js
export const ENDPOINT = 'https://analytics.jeremyvun.com/e';
export const PROJECT = 'ilovetrains';
export const QUEUE_KEY = 'trains.analytics.v1';
export const QUEUE_CAP = 200;
export const EXPERIMENTS = { 'strip-placement': { variants: ['a3', 'a2'], offset: 0 } };

export function isEnabled(env)            // env = {hostname, gpc, dnt, storage}; design.md §6
export function variant(doc, id, enabled) // design.md §3; first variant when !enabled or no bucket
export function experimentDims(doc, enabled) // {'x.strip-placement': 'a2'} for every table row, {} when disabled
export function createAnalytics({ enabled, storage, fetchFn, beacon, schedule, getDoc })
```

`createAnalytics` returns `{track, flush, events, queue}`:

- `track(name, dims = {})` builds `d = {u: userClass(getDoc()), ...dims,
  ...experimentDims(getDoc(), enabled)}`, pushes `{t: name, d}` onto
  `events` (the in-memory ledger, always, enabled or not), and when
  enabled merges it into the persisted queue: an entry with equal `t` and
  deep-equal `d` gets `n + 1`, otherwise a new `{t, d, n: 1}` is appended
  and the oldest entry is dropped past `QUEUE_CAP`. The queue is read from
  and written to `storage` (a localStorage-like object) on every change,
  under `QUEUE_KEY` as `{"queue": [...]}`; a malformed value is treated as
  empty. Then `schedule(flush)` is called once per page load, 10 s after
  the first track (the caller passes an idle-deferring scheduler; tests
  pass a synchronous one).
- `flush({beacon = false} = {})`: no-op unless enabled and the queue is
  non-empty. The body is the queue with `p: PROJECT` added to each entry,
  as one JSON array. With `beacon` and a `beacon(url, body)` function
  present, call it; a `true` return clears the queue; `false` falls
  through to `fetchFn(url, {method: 'POST', body, headers:
  {'Content-Type': 'text/plain'}, keepalive: true})`. A resolved response
  with `ok` clears exactly the entries that were sent (entries tracked
  during the request survive); a rejected promise, a 429 or any non-2xx
  keeps them. Never throws; every path is caught.
- The browser wiring lives in one exported `install(analytics)`:
  `visibilitychange` to hidden and `pagehide` → `flush({beacon: true})`
  with `navigator.sendBeacon(url, new Blob([body], {type:
  'text/plain'}))`; `online` → `flush()`.

Constraining arithmetic: five `track('shown_predicted')` calls offline
with the same dims → one entry `n: 5`; a sixth with `u: 'ret'` → a second
entry. 200 distinct entries then one more → the first is gone and the
length stays 200. An entry is about 60 bytes of JSON, so a full queue is
about 12 KB, under the service's 64 KiB body cap, and 200 entries is
under its 500-events-per-request cap. `variant`: bucket 37 → `a2`,
bucket 38 → `a3`, no bucket → `a3`, disabled → `a3`. `isEnabled`:
`ilovetrains.jeremyvun.com` with no GPC/DNT and a storage → true;
`localhost` → false; production with `gpc: true` → false; production
with `dnt: '1'` → false; production with no storage → false.

Gate: `analytics.test.js` pins each line above with a fake storage, a fake
`fetchFn` returning `{ok: true}` / `{ok: false, status: 429}` / rejecting,
and a fake beacon returning `true` then `false`. `sw.test.js` passes with
`/js/analytics.js` in `SHELL` and `VERSION` bumped. `client-storage.md`
records the queue key, shape, cap and compaction.

## Phase 2 — instrumenting today's client — DONE: `analytics phase 2 done`

Owns: `web/js/main.js`, `web/js/setup.js`, `web/js/home.js` (the
`data-t` hooks only if any are needed), `docs/contracts/ui.md` (the
events table for the screens that exist today).

Amendment first (ruling 5, 2026-09-05, after phases 0 and 1 shipped
`new`/`ret`): in `storage.js`, replace `userClass` and `NEW_OPENS` with
`band(doc)` returning the section 2 band string (`'1'` with no field or
`opens` 1; `'2-5'`; `'6-10'`; then five-wide to `'46-50'`; `'51+'`), and
add `milestone(doc)` returning the `m` string when `opens` is exactly in
`[1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250]`, else
`null`. `analytics.js`'s `track` uses `band` for `u`. Pin: opens 0/absent
→ `'1'`; 5 → `'2-5'`; 6 → `'6-10'`; 50 → `'46-50'`; 51 → `'51+'`;
`milestone` at 25 → `'25'`, at 26 → `null`. Update the two tests and
`client-storage.md`. Then, in `main.js`, immediately after the
`recordOpen` write and before the first `shown_`, `track('opened', {m})`
when `milestone` is non-null.

Seam, in `main.js`:

- One instance, created at boot before `route()`:
  `analytics = createAnalytics({enabled: isEnabled({hostname:
  location.hostname, gpc: navigator.globalPrivacyControl, dnt:
  navigator.doNotTrack, storage: localStorage}), storage: localStorage,
  fetchFn: fetch, schedule: idle-deferred 10 s, getDoc: () =>
  state.doc})`, then `install(analytics)`. Omit `beacon`: as built, the
  module's default beacon is a guarded `navigator.sendBeacon` sending a
  `text/plain` Blob, and a bound `sendBeacon` would post a raw string
  instead. As built, `queue` on the instance is a function that re-reads
  storage, `schedule` is armed only when enabled, and `variant` returns
  `null` for an unknown experiment id. Exposed as `window.__trains.analytics` (its
  `events` ledger is what the shooter reads).
- Client state gains `headerKind` (null until home shows an answer),
  `lastShown` (a string `${kind}:${tripId}:${direction}`), `tapped`
  (false until the first row tap of the page load), and `opened` (false
  until `recordOpen` has run this page load).
- **shown.** In `renderHome`, after the model is built and only when the
  header's answer is the app's own (`state.predicted`, or a live focus),
  compute `kind` (`'focus'` when an unexpired focus leads, else
  `'predicted'`) and the key; when it differs from `lastShown`, set
  `headerKind`, set `lastShown`, and `track('shown_' + kind)`. Home
  showing an explicit selection emits nothing. Before the first `shown_`
  of the page load (any kind, including `shown_setup` below), when
  enabled, run `ctx.update(recordOpen(state.doc, random))` once, with
  `random` backed by `crypto.getRandomValues` as design.md section 2 requires, and
  set `opened`, so `u` is computed from the incremented count.
- **hit / miss.** In `homeAction('open-trip')`, when `headerKind` is set
  and `tapped` is false: `tapped = true`; `track((same ? 'hit_' :
  'miss_') + headerKind)` where `same` is the tapped row's trip id and
  direction equalling `state.selection` at that moment. In
  `detailAction('focus')`: `track('hit_' + headerKind)` only when
  `headerKind` is set, is not `setup`, and the focused trip and direction
  equal the selection recorded with `lastShown`; a different
  selection emits nothing (design.md section 4). This one is not
  guarded by `tapped` (a tap then a focus on the same trip is one hit and
  one hit; the rate read divides by shown, so this double count is the
  accepted cost of keeping the rule simple — record it in `ui.md`).
- **way back.** `homeAction('way-back')` → `track('back_' +
  headerKind)` (`focus` today).
- **location panel.** In `renderHome`, when `askLocation` is true and
  `asked_panel` has not been tracked this page load → `track('asked_panel')`.
  `homeAction('skip-location')` → `track('later_panel')`.
  `requestLocation` → on success `track('granted_panel')`, on error
  `track('denied_panel')`. (Silent fixes with permission already granted
  emit nothing.)
- **setup.** `renderSetup` → `track('shown_setup', {f: 'empty'})` (the
  `location` value arrives in phase 3), through the `opened` rule above.
  `ctx.saveTrip` → `track('saved_setup', {f: 'search'})` (the other
  sources arrive in phase 3). `setup` is also the `headerKind` for a
  page load that opened on setup, so a first row tap after saving is
  attributed to... nothing: `saveTrip` sets an explicit selection and
  home shows it, which emits nothing, and `headerKind` stays `setup`
  with `tapped` false; therefore `homeAction('open-trip')` must skip
  when `headerKind === 'setup'`. Say so in a one-line comment.

Ordering the shooter will assert: `shown_*` precedes `hit_*`/`miss_*`
in `events`; a fix that re-answers produces two `shown_predicted`
entries with different `lastShown` keys; returning from the board
produces no third.

Gate: `npm test` green; a local drive at `http://localhost:8092` (the
`python3 -m http.server 8092` over `web/` the shooter uses) shows
`__trains.analytics.events` filling with `shown_predicted` then
`hit_predicted` on a row tap, and `localStorage['trains.analytics.v1']`
staying absent (disabled off production). `ui.md` gains the events table
for home, board, detail and setup as they exist today.

## Phase 3 — smart-header-v2 kinds, the strip and A2 — DONE: `analytics phase 3 done`

Starts only after `smart-header-v2` phase 3 is marked done on main;
verify with the landmark `web/stations.json` and `by:` in
`web/js/focus.js` before branching.

Owns: `web/js/main.js`, `web/js/home.js`, `web/js/setup.js`,
`web/app.css`, `web/test/home.test.js`, `web/sw.js` (`VERSION`),
`docs/contracts/ui.md`.

Seam:

- **kinds.** `headerKind` is derived from what `smart-header-v2` gives
  the controller: an unexpired focus → `focus.by === 'inferred' ?
  'inferred' : 'focus'`; a `locate` result `{kind: 'trip', leap}` →
  `leap` (`usual` or `home`); `{kind: 'pair'}` → `pair`; the no-`here`
  branch → `predicted`; `{kind: 'setup'}` → `setup` with `f:
  'location'`.
- **strip events.** `change_inferred` in the strip's action handler,
  before navigation. `entered_inferred` where inferred entry writes the
  focus (`inferTravel` returning non-null), once per entry. `back_inferred`
  on the way-back accept when `focus.by === 'inferred'`.
- **setup sources.** `shown_setup` with `f: 'location'` when From is
  prefilled. `saved_setup` with `f`: `location` (From came from the
  `Use my location` row), `nearby` (the "near you" group), `search`,
  `redirect` (Change destination, journey re-found and focus replaced),
  `redirect_lost` (not re-found; the board opens). The setup location
  row → `asked_setup` when it renders, `granted_setup` / `denied_setup`
  on its outcome.
- **A2.** `homeModel` receives `opts.stripVariant` (`'a3'` | `'a2'`,
  from `variant(state.doc, 'strip-placement', enabled)`). With `a2`, the
  strip renders inside the header's receipt slot as one line: the
  question in the receipt's type, the action `CHANGE` at the right in the
  offer button idiom (uppercase letterspaced, primary ink, 44 px tap
  target), and nothing below the heavy rule; the rule sits at 258 px on
  390×844 (the A3 build keeps 214 px). Copy is the ruled `Going
  somewhere else?` / `CHANGE`, identical to A3. Build against
  `comps/a2-receipt-390x844-change.png`, `-change-light.png` and
  `-longdest.png` (the words in the shots are the round's candidate, not
  the ruled copy). The `data-act="change-destination"` button and its
  handler are shared with A3; only placement differs. `ui.md` records
  the exception: while `strip-placement` runs, the receipt slot may carry
  the strip's one action.

Arithmetic: under `a2`, header height grows by the strip line and the
rule moves from 214 to 258 px (+44); the trip list loses one row of the
six-at-412×732 budget, which the comps round accepted for the
experiment's duration. The longest legal destination
(`comps/a2-receipt-390x844-longdest.png`) must keep question and action
on one line at 360 px wide; if it wraps, ellipsise the question, never
the action.

Gate: `home.test.js` pins the model's `strip` placement per variant and
the receipt slot's content under each; `npm test` green; `VERSION`
bumped.

## Phase 4 — verification wave — DONE: `analytics phase 4 done`

Owns: `tools/shoot-states.js`, `tools/README.md`,
`assets/comps/latest/` (A2 exemplar only), `docs/contracts/ui.md`
(calibration set entry for A2).

Work:

- `shoot-states.js`: each state declares `events`, the exact ordered
  list of names expected in `__trains.analytics.events` after the drive,
  and the invariant fails on any difference. At minimum: the default
  state (`shown_predicted`), a row-tap drive (`shown_predicted`,
  `hit_predicted` for the top row; `miss_predicted` for the second), the
  focused state (`shown_focus`), the location-panel state
  (`shown_predicted`, `asked_panel`, then `later_panel` after `Not now`),
  the `home-inferred` state from smart-header-v2 (`shown_inferred`, then
  `change_inferred` after CHANGE), and a fresh profile on setup
  (`shown_setup`). Every state also asserts
  `localStorage['trains.analytics.v1']` is absent and no request left
  for the analytics origin (the shooter's frozen `fetch` and a
  `sendBeacon` stub that records calls).
- A `home-inferred-a2` state seeds `telemetry: {opens: 5, bucket: 37}`
  and forces the variant (the shooter runs off production, so it sets
  `__trains.analytics` enabled for variant purposes only, via a test hook
  the phase adds: `window.__trains.forceVariant('strip-placement',
  'a2')`), then shoots 390×844 dark and light and 360×780 against the
  `comps/a2-receipt-*` exemplars: rule at 258 px, 44 px tap target on
  CHANGE, contrast in both schemes, no overflow. The accepted shot
  becomes `assets/comps/latest/` A2 exemplar; `ui.md`'s calibration set
  names it.
- `tools/README.md`: the ledger assertion, the `forceVariant` hook, and
  the production smoke:

  ```sh
  curl -sS "https://analytics.jeremyvun.com/stats?project=ilovetrains"
  ```

  after one real open on the production origin shows `shown_*` in
  `window.counters`; the ratios from design.md section 4 written out.
  `/stats` is read-gated on this deployment (it answers `unauthorized`
  without `ANALYTICS_READ_KEY`), so the smoke passes the key the operator
  holds; `/e` answers CORS preflight with `allow-origin: *` (probed
  2026-09-05).

Gate: `node tools/shoot-states.js` green across the listed states at
390×844 and 412×732 in both schemes; `npm test` green.

## Phase 5 — deploy and closeout — DEPLOYED; FINAL READBACK PENDING

Implementation commit `f9f2c9d`; multi-architecture registry image
`sha256:5f6e994fd34133d97d0840f1d4664ea04d3a0671a3ca3c85d781f4914e57bfb6`.
Deploy job `a892c11ef75884b30a230c6b6e31cccf` succeeded. Production health is
200, `/sw.js` is v20, and `/js/main.js` matches the verified source SHA-256
`bdf4ce3fc22cbdae237bb76d6ec8511715249dd83047e13ead5f8860e6e6d940`.
The protected stats endpoint returns 401. Permission to read only its
`ANALYTICS_READ_KEY` from the infra analytics secret file has been requested;
no `.env` file has been read. Keep this item until the final readback is
verified. Durable rules now live in `docs/contracts/analytics.md`, with
storage, UI, API, project and tool references updated.

The preserved returning profile caught v20 installing old HTTP-cached
controller bytes despite the new cache name. v21 reloads every shell request
on installation. Its executable regression fails with reload mode removed;
all 274 web tests pass. Repeat the production upgrade check against the same
profile after redeployment before calling the browser release verified.

Run the `backlog-item` skill's close stage: migrate design.md's
constraints, vocabulary and reads into the contracts (section 9 lists
them), reword `PROJECT.md` principle 5 for the owner's verdict, mark M4
"measure before tuning" done in `ROADMAP.md`, deploy per
`docs/operations/deploy.md`, run the production smoke above, confirm the
counters appear on `/ui`, and delete this folder.
