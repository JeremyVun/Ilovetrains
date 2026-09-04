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
drive that shoots it.

Invariants are checked on every state and reported at `console.error` under the
shot; a state that means something particular declares it in its own `expect`
block (the status string its top line must read, whether journey detail may
carry an action rail), so the assertion lives beside the seed that causes it.
What is checked, with the comp probes the numbers come from:

- three full lines per board row, and a 96px row (100px promoted into detail)
  with its rule drawn edge to edge of a row that is itself edge to edge of the
  region holding it;
- one figure column everywhere: every row figure and every detail step time
  ends at `--sy-pad` + `--sy-fig` (22 + 72 on a phone), and they agree with
  each other;
- the figure fits that column, and our own copy is never ellipsised — an
  upstream headsign may be, but only once it has used the whole row;
- every change on a row names its station and its boarding platform, inside
  the frame;
- the tight window is painted on the dwell segment alone, never on a ride
  segment and never on a cancelled row;
- journey detail: steps 72px (change steps 82px), 18px between the summary and
  the heavy rule, a 66px action rail flush with the frame, and no rail at all
  when the journey is cancelled or already followed;
- home: the endpoint names share a top edge and the clocks share a *baseline*
  (measured with a zero-height inline-block probe, because the two clocks are
  different sizes — a shared box top is the thing ruling 10 calls wrong), one
  status string in both the top line and the focused saved-trip row, and a
  `LIVE` dot that stays the live colour however late the journey is;
- in the light scheme, T1 and BMT fill `#F99D1C` with paper numerals while the
  same codes as bare text stay `#A46204` (ruling 37);
- tap targets 44px, time-axis segments on scale, no part of a scrolling region
  cut off with no way to scroll to it, its last item whole at the end of the
  scroll, and the chrome beneath it never painted over its content or pushed
  below the frame.

The scrolling regions are the board and its footer, journey detail and its
closing rule, and the home trip list and its rail. The sweep also rejects any
focused state that restores the deleted board strip.

One measurement is printed at `console.warn` as `NOTE` instead of failing:
`past-register` and `past-register-scrolled` each report `provenance
"TIMETABLE ONLY" overflows the figure column by 24px`, twice — once per
timetable-only row. It is pre-existing and no comp renders it; the owner rules
on the column or the word, and until then the sweep stays green with the number
in plain sight.

The transfer states (`detail-hero`, `detail-tight`, `detail-cancelled`,
`detail-long`, `detail-departed`, `detail-focused`, `board-focused`,
`board-focused-scrolled`, `board-focused-departed`, `board-tight`,
`board-cancelled-tight`, `board-two-change`) run on the transfer corridor from
`web/test/fixture.js`; `detail-direct` runs on the Central → Parramatta board.
Every `detail-*` state reaches the view by CLICKING a board row, so each one is
also proof that the whole row is the tap target — every one except
`detail-long`, which is **broken**: it declares no `route`, so it opens on home,
its row click finds nothing, and the rejected `--eval` promise is swallowed (see
the trap below). It photographs home and checks no invariant. Giving that state
`route: '#/board'` is the whole fix. Output defaults to the system temporary
directory; use `--out` only for a deliberate comparison set:

```
node tools/shoot-states.js detail-hero detail-direct detail-tight \
  detail-cancelled detail-long detail-departed detail-focused
# add --size 412x732 or --media prefers-color-scheme:light --prefix light-
```

**Trap: a post-departure state moves two clocks.** `detail-departed` advances
the pinned clock *and* `t.state.body.generatedAt` together. Advance only the
clock and the seeded board is four hours old, so the client correctly withholds
every figure — a plausible shot of the wrong screen.

**Trap: a state's driving script can fail in silence.** `screenshot.js` awaits
`--eval` through `Runtime.evaluate`, which returns a rejected promise in its
*result* rather than raising `Runtime.exceptionThrown`; nothing reads it. A
throw in a state's `after` therefore skips the rest of the page script —
including every invariant — and still shoots, exits 0 and prints no warning. A
green sweep is not proof a state rendered: read the frame.

### Re-shooting `assets/comps/latest/`

The exemplars are `shoot-states.js` frames renamed. One sweep per frame and
scheme, each with its own `CDP_PORT`, `--out` and a throwaway profile (the
default); two in parallel roughly halves the wall clock, four do not. The state
names and the exemplar filenames do not match, and `--prefix` and `--size`
change the produced filename, not the state, so rename by an explicit table and
then **read every frame**: a stale `OFFLINE` board or a withheld figure is a
convincing shot of the wrong screen, and so is the wrong route.

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
paint and live data, in ms — from a cold open and then a warm, worker-served one, and exits
non-zero if the bar is missed. `make-icons.sh` regenerates `web/icons/*` from
`tools/icon.html` (a canvas drawing whose proportions are query-tunable) at the
exact sizes the manifest promises.
