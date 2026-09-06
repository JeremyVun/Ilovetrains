# tools

- `probe-tfnsw.sh` — probe TfNSW Trip Planner endpoints, save raw responses
  to `fixtures/` (needs `TFNSW_API_KEY` already in the environment; never
  sources `.env`; ~5 requests). `--ferries` captures four stop searches
  and five ferry/mixed journey responses using verified Trip Planner IDs.
- `fixtures/` — raw TfNSW responses from probes; golden inputs for backend
  mapping tests. Re-run the probe to refresh; note refresh date in commits.
  The three `departures_*.json` files are mapped public-API captures from
  2026-09-05 for the approved ferry-board calibration: Pyrmont Bay → Double
  Bay, its reverse, and Circular Quay → Manly’s numbered/side wharf control.
- `screenshot.js` — screenshot any URL at a real device viewport over CDP.
  No npm dependencies; kills Chrome in a `finally`.
- `shoot-states.js` — drive the real client into every board state and shoot
  it, checking the board's invariants in the browser as it goes.
- `check-analytics-browser.js` — verify analytics enablement and privacy in a
  real browser on the production hostname while serving and capturing locally.
- `measure-open.js` — the experience bar in milliseconds, from the page's own
  Performance API.
- `comps/` — the design-comps harness: scaffold a round, shoot the matrix of
  concepts × scenarios × frames × schemes with measured probes, build the
  contact sheet. Read `comps/README.md`.
- `icon.html` + `make-icons.sh` — regenerate the PWA icons through the browser.
- `build-stations.js` — rebuild the baked station index both clients search.
- `check-controller-lifecycle.js` — browser-check repeated home fixes and
  durable arrival completion against a locally served client.

Run the controller check on a private local server; it supplies synthetic
journeys and CDP geolocation and makes no API request:

```
node tools/check-controller-lifecycle.js --url http://localhost:<port>
```

## comps/

A round is a directory of HTML plus a one-line shoot, not a copied `shoot.js`:

```
node tools/comps/new-round.js <name>            # /tmp/trains-comps-<name>
node tools/comps/shoot.js     /tmp/trains-comps-<name>
node tools/comps/sheet.js     /tmp/trains-comps-<name>    # then open index.html
```

Comps are built from the live `web/app.css` and `tools/fixtures/` **by
reference** — `new-round.js` copies the stylesheet verbatim with its git blob
hash and generates the data from `tools/comps/scenarios.js`, so a comp cannot
drift from the product's language or invent a departure. Every synthetic delta
is declared in the generated data file and named in the sheet's lede.

`shoot.js` shoots the built comps, where `shoot-states.js` shoots the built
client; they share the traps but not the job. Its probes (right-edge overflow,
below-fold, whole items and scroll position against the scroller, tap targets,
text spill versus deliberate ellipsis, widest-legal-lockup track stress, time
axis geometry) are keyed on data attributes documented in `comps/README.md`,
and each one has a fixture with a planted defect proving it bites.

The gates are `node --test 'tools/comps/test/*.test.js'` and
`node tools/comps/test/oracle.js`, which reproduces the exemplar set
pixel-identically from the archived board v2 workshop. It reads that set from
git at `EXEMPLAR_COMMIT` (`b218dd5`), the last commit whose
`assets/comps/latest/` still *was* the archive's own shots, not from disk: the
exemplars shipping today are client shots of a later design, so pinning is what
keeps this a gate on the harness while the product moves on. Both trees come
out of git, so the oracle needs nothing but the repository. A difference is a
defect in the harness or in the pin — report it, never widen the threshold.

## screenshot.js

```
node tools/screenshot.js <url> <out.png> [--size 390x844] [--dsf 2]
        [--desktop] [--wait MS] [--seed doc.json] [--key trains.v1]
        [--eval "JS"] [--media name:value] [--profile DIR] [--manifest]
        [--full] [--quiet]
```

`--seed` writes a JSON file into `localStorage` (default key `trains.v1`)
before the app boots, so any client state — saved trips, history, a cached
board — can be set up without driving the UI. `--eval` runs JS after load and
awaits a promise, which is how the interactive flows get driven; anything the
page logs at `console.warn`/`error` is printed under the shot, and an `--eval`
that throws or rejects is fatal (`EVAL FAILED`, no shot, non-zero exit).

`--media prefers-reduced-motion:reduce` emulates a media feature (a media query
you cannot emulate is one you cannot verify). `--profile DIR` reuses a browser
profile instead of a throwaway one, which is the only way to measure a warm,
service-worker-served open — or a real offline one, by running once with the
server up and again with it stopped. `--manifest` prints the web app manifest
*as Chrome parsed it*, with its errors: the installability check that fetching
the JSON yourself cannot make.

**Traps this instrument exists to defeat** (full detail in its header):

1. `chrome --headless --window-size=390,844 --screenshot` silently clamps the
   layout viewport to 500 CSS px on macOS and crops the PNG. This tool uses
   `Emulation.setDeviceMetricsOverride` and asserts `clientWidth` matches the
   requested width — on mismatch it throws `VIEWPORT LIE` and saves nothing.
   Believe it and fix the instrument, not the CSS.
2. With `mobile:true` and no `<meta name="viewport">`, Chrome lays out at
   980px. The page under test must ship the meta tag (`web/index.html` does).
3. Horizontal overflow is otherwise invisible — cropped content looks missing,
   not overflowing. Every shot reports the worst right-edge overflow.
4. Orphan Chrome trees: the browser is SIGKILLed and its temp profile removed
   in a `finally`, so a killed agent leaves nothing behind.
5. SIGKILL alone discards `localStorage`, which Chrome flushes lazily. With
   `--profile`, that turned "reopen the app" into a first-run screen with warm
   worker caches — a convincing wrong answer. The browser is asked to close
   first and given a moment to flush, with SIGKILL still the backstop.
6. A rejected `--eval` promise arrives in `Runtime.evaluate`'s result, not as a
   `Runtime.exceptionThrown` event. Unread, it photographs the wrong screen and
   exits 0. The result's `exceptionDetails` is read and raised.
7. Two agents, one debugger port. `CDP_PORT` defaults to 9333 here and in every
   `shoot-states.js` run, so a second agent attaches to the first agent's
   browser and photographs its app — or dies with `Session with given id not
   found`. Pick a private port per agent (`CDP_PORT=9441`). `comps/chrome.js`
   asks Chrome for port 0 and is already immune.
8. Two agents, one web server. A second `python3 -m http.server` on a port that
   is already bound exits quietly, so `--url` drives whichever worktree bound
   first: a green sweep of somebody else's code. Pick a private port, and verify
   the served file is yours — `curl` a module and grep it for something your
   branch changed — before believing any frame.

## shoot-states.js

```
node tools/shoot-states.js [state...] [--list] [--url URL] [--out DIR]
        [--size WxH] [--media name:value] [--prefix light-]
        [--probe "JS returning a value"] [--probe-file probe.js]
```

The whole sweep under an emulated media feature is one line, and `--prefix`
keeps it from overwriting the default set:

```
node tools/shoot-states.js --media prefers-color-scheme:light --prefix light-
```

Seeds the client's localStorage document, pins the clock through
`window.__trains`, freezes the network so the live fetch cannot overwrite the
state mid-shot, and photographs the result. `--probe` (or `--probe-file`, for a
probe long enough to drive a flow) runs awaited JS in the page and prints what
it returns, so a state can be *measured* — or driven end to end — in the same
drive that shoots it.

Each state also declares its exact ordered analytics event names. After the
real-clock boot, the driver resets the per-load ledger and attribution guards,
restores the seed, and reruns the route before measuring. It fails if the
ledger differs, if `trains.analytics.v1` exists, or if fetch/sendBeacon touches
the analytics origin. This proves local drives record the intended semantics
while transport stays disabled. On localhost only,
`__trains.forceVariant('strip-placement', 'a2')` changes rendering for a state;
it does not enable transport.

Invariants are checked on every state and reported at `console.error` under the
shot; a state that means something particular declares it in its own `expect`
block (the status string its top line must read, whether journey detail may
carry an action rail), so the assertion lives beside the seed that causes it.
What is checked, with the comp probes the numbers come from:

- three full lines per board row, and a 96px row (at least 100px in detail)
  with its rule drawn edge to edge of a row that is itself edge to edge of the
  region holding it;
- one figure column per view: detail uses 69px, the phone board uses 72px;
  each row figure and detail step time ends at `--sy-pad` + `--sy-fig`;
- the figure fits that column, and our own copy is never ellipsised — an
  upstream headsign may be, but only once it has used the whole row;
- countdown units stay at least 12px even when an hours figure uses smaller
  numerals;
- every change on a row names its station and its boarding platform, inside
  the frame; ferry origins keep the full raw label in data while their visible
  cap follows the named-only `Wharf` fallback, and compact transfer markers
  keep their full raw label, role and stop association in data;
- actual text ranges keep transfer names clear of headsigns, boarding markers
  clear of each other, and step text/chips at least 4px inside their dividers;
  visible ferry labels stay at least 14px, remain unclipped, and detail keeps
  the full boarding location visible beside a compact transfer chip;
- board endpoint names stay inside their title, and change instructions
  visibly name the onward line code;
- the tight window is painted on the dwell segment alone, never on a ride
  segment and never on a cancelled row;
- journey detail: steps 72px (change steps 82px), 18px between the summary and
  the heavy rule, a 66px action rail flush with the frame, and no rail at all
  when the journey is cancelled or already followed;
- home: the endpoint names share a top edge and the clocks share a *baseline*
  (measured with a zero-height inline-block probe, because the two clocks are
  different sizes and a shared box top is not the shared baseline ui.md binds),
  one status string in both the top line and the focused saved-trip row, and a
  `LIVE` dot that stays the live colour however late the journey is;
- home station names, the inferred strip and the complete `Just added` sub line
  never ellipsise; ordinary saved-row metadata may use its designed ellipsis;
- in the light scheme, T1 and BMT fill `#F99D1C` with paper numerals while the
  same codes as bare text stay `#A46204`;
- tap targets 44px, time-axis segments on scale, no part of a scrolling region
  cut off with no way to scroll to it, its last item whole at the end of the
  scroll, and the chrome beneath it never painted over its content or pushed
  below the frame.

The scrolling regions are the board and its footer, journey detail and its
closing rule, and the home trip list and its rail. The sweep also rejects any
focused state that restores the deleted board strip.

A provenance that overflows the 72px figure column now fails the sweep like any
other invariant. It was reported as a `NOTE` while `TIMETABLE ONLY` was the one
word that did not fit; that word left the vocabulary on 2026-09-05 and the
measurement went back to being an assertion.

`journey-geometry.js` checks text fragments, including wrapped lines. A label
can fit the viewport and report no horizontal overflow while overlapping a
headsign or touching the next step's divider; element widths alone do not
prove those cases. The shooter runs these checks in every seeded state.

The transfer states (`detail-hero`, `detail-tight`, `detail-cancelled`,
`detail-long`, `detail-departed`, `detail-focused`, `board-focused`,
`board-focused-scrolled`, `board-focused-departed`, `board-tight`,
`board-cancelled-tight`, `board-two-change`) run on the transfer corridor from
`web/test/fixture.js`; `detail-direct` runs on the Central → Parramatta board.
Every `detail-*` state reaches the view by CLICKING a board row, so each one is
also proof that the whole row is the tap target. Output defaults to the system
temporary directory; use `--out` only for a deliberate comparison set:

```
node tools/shoot-states.js detail-hero detail-direct detail-tight \
  detail-cancelled detail-long detail-departed detail-focused
# add --size 412x732 or --media prefers-color-scheme:light --prefix light-
```

### The geolocation seam

A state may declare `geo: {lat, lon, speed?}` and `permission: 'granted' |
'prompt' | 'denied'` (a `geo` alone implies `granted`). `screenshot.js` answers
both over CDP — `Browser.setPermission` and `Emulation.setGeolocationOverride`,
which headless Chrome supports including `coords.speed` — and the state's page
script then calls `t.route()`. That call is the point: the permission query, the
silent fix, `useFix`, the home vote, inferred entry and the auto-saved pair all
live behind `route()`, so a state that only writes `t.state.fix` photographs a
screen the controller never decided.

Its traps:

- **The fix arrives after the load, deliberately.** Granted before the first
  navigation, the app takes a fix against the real clock and writes home votes,
  a `lastOpen` and possibly an auto-saved trip into the seeded document before
  anything is pinned. Both CDP calls therefore run between the load and the
  `--eval`.
- **A second `route()` is not a second open unless you make it one.** The load
  left a `selection` behind, which makes `chooseSelection` treat the open as an
  explicit one and never re-locate, and it overwrote the seeded `lastOpen` with
  its own. The geo block clears the selection and restores `lastOpen` from the
  seed before re-routing.
- **The index is already there, but only on home.** `loadStations()` is started
  by `showHome`, so it has resolved long before the eval freezes `fetch` — the
  block asserts `t.state.stations` rather than trusting it. The setup sheet
  holds its own copy and never fills `state.stations`, so the assertion is
  scoped to the home route.
- **Two clocks.** `t.now` is the pinned clock; the fix Chrome returns is stamped
  with the machine clock, and `state.loadedAt` (which decides the `Just added`
  mark) is real page-load time. The fix passes `validFix` because every pinned
  state sits in the past; a state pinned to the future would need a page stub
  instead.
- **`change-destination` is a hash change.** Allow at least 400ms after the
  click before reading the sheet, or the frame is still home.
- **Measure the header rule with a body.** A null body draws a figure-less
  header and the heavy rule lands at 189px, not the 214px `ui.md` binds. Seed
  `t.state.body` first.

**Trap: a post-departure state moves two clocks.** `detail-departed` advances
the pinned clock *and* `t.state.body.generatedAt` together. Advance only the
clock and the seeded board is four hours old, so the client correctly withholds
every figure — a plausible shot of the wrong screen.

**Trap: a driving script that throws.** `Runtime.evaluate` returns a rejected
`--eval` promise in its *result* rather than raising `Runtime.exceptionThrown`.
A throw in a state's `after` skips the rest of the page script, including every
invariant, and the frame is then whatever the page happened to be showing.
`screenshot.js` reads `exceptionDetails`: a failed `--eval` prints
`EVAL FAILED` with the message, saves no shot and exits non-zero, so the sweep
fails on it. A state that shoots is a state whose script ran to the end; a
green sweep still says nothing about what no invariant covers, so read the
frames.

### Re-shooting `assets/comps/latest/`

The exemplars are `shoot-states.js` frames renamed. One sweep per frame and
scheme, each with its own `CDP_PORT`, `--out` and a throwaway profile (the
default); two in parallel roughly halves the wall clock, four do not. The state
names and the exemplar filenames do not match, and `--prefix` and `--size`
change the produced filename, not the state, so rename by an explicit table and
then **read every frame**: a stale `OFFLINE` board or a withheld figure is a
convincing shot of the wrong screen, and so is the wrong route.

The table, all forty-five frames. `default` means no flags: the state carries its
own size and the dark scheme is unsuffixed.

| Exemplar | State | Invocation |
| --- | --- | --- |
| `board-390x844-hero.png` | `on-time` | default |
| `board-390x844-past.png` | `past-register-scrolled` | default |
| `board-390x844-delayed.png` | `delayed` | default |
| `board-390x844-cancelled.png` | `cancelled` | default |
| `board-390x844-long.png` | `long-names` | default |
| `board-390x844-two-change.png` | `board-two-change` | default |
| `board-390x844-hero-light.png` | `on-time` | `--media prefers-color-scheme:light` |
| `board-412x732-hero.png` | `short-on-time` | default (the state is 412×732) |
| `board-390x844-ferry-pyrmont.png` | `ferry-pyrmont` | default |
| `board-390x844-ferry-doublebay.png` | `ferry-doublebay` | default |
| `board-390x844-ferry-numeric.png` | `ferry-numeric-control` | default |
| `board-390x844-ferry-side-only.png` | `ferry-side-only-control` | default |
| `detail-390x844-hero.png` | `detail-hero` | default |
| `detail-390x844-tight.png` | `detail-tight` | default |
| `detail-390x844-cancelled.png` | `detail-cancelled` | default |
| `detail-390x844-direct.png` | `detail-direct` | default |
| `detail-390x844-long.png` | `detail-long` | default |
| `detail-390x844-departed.png` | `detail-departed` | default |
| `detail-390x844-focused.png` | `detail-focused` | default |
| `detail-390x844-hero-light.png` | `detail-hero` | `--media prefers-color-scheme:light` |
| `detail-412x732-hero.png` | `detail-hero` | `--size 412x732` |
| `detail-412x732-tight.png` | `detail-tight` | `--size 412x732` |
| `detail-412x732-cancelled.png` | `detail-cancelled` | `--size 412x732` |
| `detail-412x732-long.png` | `detail-long` | `--size 412x732` |
| `detail-390x844-ferry-pyrmont.png` | `ferry-pyrmont-detail` | default |
| `detail-390x844-ferry-numeric.png` | `ferry-numeric-detail` | default |
| `home-390x844-before.png` | `home-before` | default |
| `home-390x844-change.png` | `home-change` | default |
| `home-390x844-final.png` | `home-final` | default |
| `home-390x844-tight.png` | `home-delayed` | default |
| `home-390x844-cxl.png` | `home-cancelled` | default |
| `home-390x844-focused-cxl.png` | `home-focused-cancelled` | default |
| `home-390x844-late.png` | `home-late` | default |
| `home-390x844-back.png` | `reverse-real-platforms` | default |
| `home-390x844-ferry-pyrmont-focused.png` | `ferry-pyrmont-home-focused` | default |
| `home-390x844-ferry-numeric-focused.png` | `ferry-numeric-home-focused` | default |
| `home-925x844-ferry-pyrmont-focused.png` | `ferry-pyrmont-home-focused` | `--size 925x844` |
| `home-390x844-before-light.png` | `home-before` | `--media prefers-color-scheme:light` |
| `home-412x732-change.png` | `home-change` | `--size 412x732` |
| `home-390x844-inferred.png` | `home-inferred` | default |
| `home-390x844-inferred-light.png` | `home-inferred` | `--media prefers-color-scheme:light` |
| `home-390x844-inferred-a2.png` | `home-inferred-a2` | default |
| `home-390x844-inferred-a2-light.png` | `home-inferred-a2` | `--media prefers-color-scheme:light` |
| `home-390x844-just-added.png` | `home-here-pair` | default |
| `setup-390x844-origin.png` | `setup-origin` | default |

The focused Pyrmont state selects its captured 22:11 journey, whose Circular
Quay transfer is `5B` to `4B`; its raw `Pyrmont Bay Wharf` origin presents as
`Wharf`. The reverse focused state applies the same fallback to `Double Bay
Wharf` and uses `5B` to `5A`. `ferry-side-only-control` proves that a supplied
`Side A` stays visible rather than taking the named-only fallback.
`ferry-numeric-home-focused` and `ferry-numeric-detail` select the captured
Circular Quay departure from `Wharf 4, Side B` so the full initial label is
calibrated separately from compact transfer markers.

`docs/contracts/ui.md` lists the set; the directory holds it and nothing else,
so a frame no state can produce is removed rather than left to rot.

The `short-*` states shoot the board at **412x732** — a 412px Android with its
browser chrome on screen, which is the frame the owner's phone actually gets and
the one six three-line rows do not fit. Each is shot twice, before and after a
driven scroll to the end, because "the sixth service is reachable" is a claim
about a gesture and not about a still image. The scroll-reachability invariant
above is the one that would have caught the defect they exist for: run it
against `overflow: hidden` and it reports `21px of board is cut off with no way
to scroll to it` at 412x732. At 390x844 it reports nothing any more — six 96px
rows fit that frame, which is exactly why the 412 states are the ones that
matter.

## measure-open.js and make-icons.sh

`measure-open.js` reports the `docs/contracts/ui.md` experience bar — cached
paint and live data, in ms — from a cold open and then a warm, worker-served
one. It also requires a successful API response and fresh, non-offline data, so
cached rows plus a failed request cannot pass the bar. It exits non-zero if the
bar is missed. `make-icons.sh` regenerates `web/icons/*` from
`tools/icon.html` (a canvas drawing whose proportions are query-tunable) at the
exact sizes the manifest promises.

## build-stations.js

Writes the baked station index to `web/stations.json` and
`internal/stations/stations.json`, byte-identical, sorted by id. The Go
server answers `/api/v1/stops` from its copy and makes no upstream call; the
client loads its copy for nearest-station work. A Go test keeps the two
copies equal.

```sh
node tools/build-stations.js                          # downloads, needs the key
node tools/build-stations.js --from-dir /path/to/zips # no key, no network
```

It reads `TFNSW_API_KEY` from the process environment and only to download;
it never opens `.env`. `--from-dir` expects `sydneytrains.zip`,
`nswtrains.zip`, `metro.zip` and `ferries.zip` already in that directory; without the flag
the bundles land in `.gtfs/` off the repository root. The zips are about 12 MB, 40
MB, 1 MB and 0.9 MB and are never committed. It shells out to `unzip -p`, so it is
dependency-free but not portable to a machine without it.

Bundle URLs, and why metro is v2:

- `https://api.transport.nsw.gov.au/v1/gtfs/schedule/sydneytrains`
- `https://api.transport.nsw.gov.au/v1/gtfs/schedule/nswtrains`
- `https://api.transport.nsw.gov.au/v2/gtfs/schedule/metro` — the v1 metro
  bundle answers 200 but is frozen at September 2024 and has none of the
  Metro City section. See `docs/references/tfnsw-open-data.md`, "Station
  index".

Ferries use `https://api.transport.nsw.gov.au/v1/gtfs/schedule/ferries/sydneyferries`.
The generator joins ferry routes (4, 1000–1099 or 1200) to served boarding
stops, then uses `fixtures/ferry_stop_mapping.json` to resolve Trip Planner
hubs. Regeneration stays offline with `--from-dir` and fails on an unmapped
boarding stop. To refresh the mapping, first download the ferries ZIP and
run `python3 tools/probe-ferry-stops.py` with the key already exported. The
probe queries every served boarding ID, validates one best ferry result,
and captures full responses without recording the key. It never opens `.env`.
The current mapping resolves 54 boarding stops to 38 hubs; Circular Quay
merges with the railway, giving 423 index entries. Names lacking either
`Station` or `Wharf` are printed, including intentional shared hubs.

`node --test tools/test/build-stations.test.js` verifies the mapping's ID,
ambiguity and coordinate guards against captured responses.

A parent station is kept only when a rail `route_type` actually serves it,
joining `stop_times.txt` → `trips.txt` → `routes.txt`. Without that join NSW
TrainLink's coach network arrives too, Adelaide included. It prints the
entry count, each bundle's contribution and any station whose name does not
end in "Station" — currently Southern Cross (Melbourne) and four rail
replacement stops.

Regenerating is a deliberate act: the output is committed, so run it when
the network changes, check the diff, and say in the commit message that the
index was rebuilt and from bundles of what date.

## Analytics browser and production checks

Run the isolated browser probe with its private ports:

```sh
CDP_PORT=9453 HTTP_PORT=8193 node tools/check-analytics-browser.js
```

It maps `ilovetrains.jeremyvun.com` to the local static server inside Chrome,
maps the analytics host to loopback as a backstop, and captures attempted
analytics fetches in the page. It proves a first enabled open assigns a bucket,
emits `opened` before `shown_predicted`, and builds only the approved payload.
Separate fresh targets prove DNT and denied storage force A3 without a
telemetry write, queue or request, and that GPC alone leaves analytics on. No synthetic event leaves the machine.

After deployment, open the real production app once in an ordinary browser,
then read the collector with the operator-held key in the header:

```sh
curl -sS -H "X-Analytics-Key: ${ANALYTICS_READ_KEY}" \
  "https://analytics.jeremyvun.com/stats?project=ilovetrains"
```

The response's `window.counters` should contain the open's `shown_*` counter
and any milestone due for that profile. Compute new-user hit rate, returning
answer acceptance, milestone reach and A2/A3 strip correction with the exact
ratios and caveats in [the analytics contract](../docs/contracts/analytics.md#reading-the-counters).
Never put the read key in a URL.
