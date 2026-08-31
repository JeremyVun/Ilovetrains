# tools

- `probe-tfnsw.sh` — probe TfNSW Trip Planner endpoints, save raw responses
  to `fixtures/` (needs `TFNSW_API_KEY` in env or root `.env`; ~5 requests).
- `fixtures/` — raw TfNSW responses from probes; golden inputs for backend
  mapping tests. Re-run the probe to refresh; note refresh date in commits.
- `screenshot.js` — screenshot any URL at a real device viewport over CDP.
  No npm dependencies; kills Chrome in a `finally`.

## screenshot.js

```
node tools/screenshot.js <url> <out.png> [--size 390x844] [--dsf 2]
        [--desktop] [--wait MS] [--seed doc.json] [--key trains.v1]
        [--eval "JS"] [--full] [--quiet]
```

`--seed` writes a JSON file into `localStorage` (default key `trains.v1`)
before the app boots, so any client state — saved trips, history, a cached
board — can be set up without driving the UI. `--eval` runs JS after load and
awaits a promise, which is how the interactive flows get driven; anything the
page logs at `console.warn`/`error` is printed under the shot.

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
