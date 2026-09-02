# tools

- `probe-tfnsw.sh` — probe TfNSW Trip Planner endpoints, save raw responses
  to `fixtures/` (needs `TFNSW_API_KEY` in env or root `.env`; ~5 requests).
- `fixtures/` — raw TfNSW responses from probes; golden inputs for backend
  mapping tests. Re-run the probe to refresh; note refresh date in commits.
- `screenshot.js` — screenshot any URL at a real device viewport over CDP.
  No npm dependencies; kills Chrome in a `finally`.
- `shoot-states.js` — drive the real client into every board state and shoot
  it, checking the board's invariants in the browser as it goes.
- `measure-open.js` — the experience bar in milliseconds, from the page's own
  Performance API.
- `comps/` — the design-comps harness: scaffold a round, shoot the matrix of
  concepts × scenarios × frames × schemes with measured probes, build the
  contact sheet. Read `comps/README.md`.
- `icon.html` + `make-icons.sh` — regenerate the PWA icons through the browser.

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
`node tools/comps/test/oracle.js`, which reproduces every calibration exemplar
in `assets/comps/latest/` pixel-identically from the archived board v2 workshop.

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
page logs at `console.warn`/`error` is printed under the shot.

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
drive that shoots it. Invariants are checked on every state and reported at
`console.error` under the shot: three full lines per board row, the figure fits
its column (rows and journey blocks alike), our own copy is never ellipsised,
no part of a scrolling region is cut off with no way to scroll to it, its last
item is whole at the end of the scroll, and the chrome beneath it is never
painted over its content or pushed below the frame.

That last pair is checked for the board against its footer and for the journey
detail view against its closing rule. The sweep also rejects any focused state
that restores the deleted board strip.

The transfer-detail states (`detail-hero`, `detail-tight`, `detail-cancelled`,
`detail-long`, `board-focused`, `board-focused-scrolled`,
`board-focused-departed`) run on the transfer corridor from
`web/test/fixture.js`, and the `detail-*` ones reach the view by CLICKING a
board row, so every one of them is also proof that the whole row is the tap
target. Output defaults to the system temporary directory; use `--out` only
for a deliberate comparison set:

```
node tools/shoot-states.js detail-hero detail-tight detail-cancelled \
  detail-long board-focused board-focused-scrolled board-focused-departed
# add --size 412x732 or --media prefers-color-scheme:light --prefix light-
```

The `short-*` states shoot the board at **412x732** — a 412px Android with its
browser chrome on screen, which is the frame the owner's phone actually gets and
the one six three-line rows do not fit. Each is shot twice, before and after a
driven scroll to the end, because "the sixth service is reachable" is a claim
about a gesture and not about a still image. The scroll-reachability invariant
above is the one that would have caught the defect they exist for: run it
against `overflow: hidden` and it reports `129px of board is cut off with no way
to scroll to it` at 412x732, and 17px at 390x844.

## measure-open.js and make-icons.sh

`measure-open.js` reports the `docs/contracts/ui.md` experience bar — cached
paint and live data, in ms — from a cold open and then a warm, worker-served one, and exits
non-zero if the bar is missed. `make-icons.sh` regenerates `web/icons/*` from
`tools/icon.html` (a canvas drawing whose proportions are query-tunable) at the
exact sizes the manifest promises.
