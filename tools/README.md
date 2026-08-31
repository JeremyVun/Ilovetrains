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
- `icon.html` + `make-icons.sh` — regenerate the PWA icons through the browser.

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
        [--size WxH] [--media name:value] [--probe "JS returning a value"]
```

Seeds the client's localStorage document, pins the clock through
`window.__trains`, freezes the network so the live fetch cannot overwrite the
state mid-shot, and photographs the result. `--probe` runs (awaited) JS in the
page and prints what it returns, so a state can be *measured* in the same drive
that shoots it. Three invariants are checked on every state and reported at
`console.error` under the shot: three full lines per row, the figure fits its
column, our own copy is never ellipsised.

## measure-open.js and make-icons.sh

`measure-open.js` reports the DESIGN.md experience bar — cached paint and live
data, in ms — from a cold open and then a warm, worker-served one, and exits
non-zero if the bar is missed. `make-icons.sh` regenerates `web/icons/*` from
`tools/icon.html` (a canvas drawing whose proportions are query-tunable) at the
exact sizes the manifest promises.
