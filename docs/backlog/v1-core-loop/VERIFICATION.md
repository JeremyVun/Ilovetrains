# v1 core loop — empirical verification (Phase 3, 2026-09-01)

Every check below was run against the **real app**: the Go server on
`PORT=8092` serving `web/`, driven in headless Chrome through
`tools/screenshot.js`. Board states are seeded through the client's own
localStorage document and the page's `window.__trains` harness, so the pixels
are the client's own decisions, not a mock's. Shots are in `shots/` beside this
file and are named by state.

Reproduce:

```
set -a; source .env; set +a; PORT=8092 go run ./cmd/server     # then, elsewhere:
node tools/shoot-states.js            # every state -> docs/backlog/v1-core-loop/shots
node tools/measure-open.js            # the experience bar, in milliseconds
go test ./... && (cd web && npm test)
```

`shoot-states.js` checks three invariants in the browser on every state and
reports them at `console.error` under the shot: three full lines per row, the
figure fits its column, our own copy is never ellipsised.

## 1. Experience bar (DESIGN.md)

Measured by `tools/measure-open.js` from the page's own Performance API. Run 1
is a first visit that also installs the worker; run 2 reuses the profile, so it
is a genuinely warm, worker-served open.

| open | service worker | cached board painted (FCP) | live data (responseEnd) | rows |
|---|---|---|---|---|
| cold | controlling | **40ms** | **542ms** | 6 |
| warm | controlling | **32ms** | **18ms** | 6 |

- Cached paint < 500ms: **pass**, 32ms warm (shot `open-warm.png`).
- Live data < 2s: **pass**, 542ms cold against live TfNSW through the proxy;
  18ms warm because the server's own 30s cache answered.
- These are localhost numbers with no network RTT — the margin is 15x, but a
  deploy behind a CDN should re-run this against the real origin.
- Zero-tap daily case: **pass** — reopening the app (`live-reopen-prediction`)
  painted the predicted trip and direction with no interaction.
- Flip = 1 tap: **pass** — one `REVERSE` click turned Central → Parramatta into
  Parramatta → Central with a live board (`live-first-run` drive).
- Switch = 2 taps: **pass** — `SWITCH TRIP` then the trip's name; measured
  in-page as 2 clicks, masthead went Central → Parramatta to Town Hall → Epping.

## 2. Every state against the exemplar and the binding rules

Exemplar: `comps/shots/b-editorial-390x844.png` and its stress variants.
Three-lines-per-row held in every shot (checked in-page, not by eye).

| state | shot | verdict |
|---|---|---|
| on-time | `on-time-390x844.png` | **pass** — matches the exemplar row for row; masthead reads `REVERSE EDIT` with one saved trip, per the frozen IA in DESIGN.md |
| delayed | `delayed-390x844.png` | **pass** — coral figure, `6 MIN LATE`, timetabled time struck through beside the live one; matches `-delayed` |
| cancelled | `cancelled-390x844.png` | **fixed** — the C-transplant note was arriving as `NEXT RUNNIN…`; see defect 1 |
| scheduled-only | `scheduled-only-390x844.png` | **pass** — lighter figures, `SCHEDULED`, green dot (the data is fresh, only unmonitored) |
| stale | `stale-390x844.png` | **pass** — owner ruling honoured: no countdowns, clock times only, board at 55%, coral `OFFLINE · LAST UPDATED 4 H AGO`. Deliberately unlike the comp's `-stale` variant, which predates the ruling |
| stale, with departures | `stale-departed-390x844.png` | **pass** — the two services that had left are dropped and the remaining four distribute down the frame |
| late-night | `late-night-390x844.png` | **fixed** — three-digit figures; see defect 2 |
| now leaving | `now-leaving-390x844.png` | **fixed** — `Now` is three characters and hit the same defect |
| sparse (3 services) | `sparse-390x844.png` | **pass** — the board fills the frame rather than leaving a short list in a void |
| departed dissolve | `dissolve-390x844.png` | **pass** — caught mid-fade: the lead row is at opacity 0 with its space still held, and the list closes upward 240ms later |
| empty | `empty-390x844.png` | **pass** — `NO SERVICES IN THE NEXT FEW HOURS`, honest and quiet |
| offline, no cache | `cold-offline-390x844.png` | **fixed** — footer claimed an update that never happened; see defect 3 |
| long names | `long-names-390x844.png` | **pass** — headsigns ellipsise, no overflow, rows keep their height |
| two trips | `two-trips-390x844.png` | **pass** — masthead earns its third word, `REVERSE SWITCH TRIP EDIT` |
| first run | `first-run-390x844.png` | **pass** |
| first-run search | `first-run-search-390x844.png` | **fixed** — the browser's own search-clear ✕ was the loudest thing on the page; suppressed |
| trips list | `trips-list-390x844.png` | **fixed** — the current-trip dot was touching the station name |
| desktop | `desktop-1280x800.png` | **fixed** — the 940px measure was not applying at all; see defect 4 |
| desktop delayed | `desktop-delayed-1280x800.png` | **pass** |

Live boards (real TfNSW data, late-night timetable): `live-first-run-390x844.png`,
`live-reopen-prediction-390x844.png`.

## 3. PWA

| check | result |
|---|---|
| Manifest parsed by Chrome | **pass** — `Page.getAppManifest` returns zero errors, scope `/` (`tools/screenshot.js --manifest`) |
| Served as `application/manifest+json` | **fixed** — Go's MIME table has no `.webmanifest`; it was `text/plain`. Registered in `internal/api`, guarded by `TestWebManifestIsServedAsManifestJSON` |
| Icons | **pass** — 192, 512, maskable 512, apple-touch 180, all `image/png` over HTTP and all precached. Generated by `tools/make-icons.sh` from `tools/icon.html` |
| Service worker registered and controlling | **pass** — scope `/`, activated, `shell-v1` holding all 19 shell files plus `data-v1` |
| Offline: shell | **pass** — with the server *killed*, a fresh navigation painted the full app (`sw-offline-true-390x844.png`) |
| Offline: data, cached API | **pass** — `sw-offline-datacache-390x844.png`: served from the worker's data cache, 6 rows, footer `UPDATED 40S AGO` — true, because `generatedAt` travels with the body |
| Offline: data, nothing cached | **pass** — `sw-offline-true-390x844.png`: figures dropped, clock times only, board dimmed, coral `OFFLINE · LAST UPDATED 11S AGO`. This is the composition with `rowmodel.STALE_MS` the brief asked for, and it holds in both directions |
| Deploy/update path | **pass** — bumping `VERSION` precached the new shell and, on the next load, left only the new cache behind |
| Installability | **pass** on every criterion Lighthouse checks: manifest with name/short_name/start_url/display/theme_color, 192+512+maskable icons, a service worker with a fetch handler, and a start_url that loads offline. Lighthouse itself was not run — it needs an npm install and the client has no dependencies by design |

`prefers-reduced-motion: reduce` — **pass**, and now actually verifiable: the
instrument could not emulate media features, so the media query had never been
exercised. With `--media prefers-reduced-motion:reduce` the row transition
computes to `0s` against `0.24s` without it. (The 240ms wait before the list
closes remains under reduced motion; the row vanishes rather than fading, which
is what the preference asks for.)

## 4. First-run flow, live

One end-to-end drive against live TfNSW (`live-first-run-390x844.png`):

```
route #/setup
search "central"      -> Central Station
search "parramatta"   -> Parramatta Station
save                  -> board: Central → Parramatta, 6 rows, "Updated 2s ago"
reverse               -> Parramatta → Central, 6 rows
localStorage          -> 1 trip, history [forward, reverse], lastViewed reverse,
                         cache keys 200060-215020 and 215020-200060
reopen (same profile) -> Parramatta → Central, chosen by predict(), 0 taps
```

Short queries returning nothing is upstream behaviour, not a defect
(`docs/references/tfnsw-open-data.md`); full station names were used.

## Defects found

### Fixed

1. **The cancelled-lead note was truncated.** `22:48 CANCELLED · NEXT RUNNING
   SERVICE` needs 282px at the label idiom (10px/.14em) and the body column is
   232px at 390px, so the board printed `NEXT RUNNIN…` — the one line that must
   not be guessed at. Set at 9px/.05em, which fits at 390px with the binding
   copy intact. `shoot-states.js` now fails the state if that note is ever
   ellipsised again. **Still truncates at 360px** — see the ruling below.
2. **A three-character figure was drawn through the departure time.** Found on
   the live late-night board (`defect-wide-figure-before-390x844.png`): the
   next train was 187 minutes away, and the hero figure needs 129px in an 86px
   column with no clip and no ellipsis. Every seeded state until then had a one-
   or two-digit figure. `rowmodel` now marks the row `wide` and the type steps
   down (48px hero / 44px, measured to fit; `Now` is three characters too and
   is wider than three digits). Guarded by `a figure of three characters marks
   itself wide` in `web/test/rowmodel.test.js` (proven to bite) and by the
   in-browser figure-overflow invariant.
3. **A board that was never loaded claimed an age.** A first open with an empty
   cache printed `OFFLINE · LAST UPDATED 0S AGO` under "no board saved for this
   trip yet", and a cold open with no cache flashed `OFFLINE` while it was
   merely still asking. Footer is now empty with a resting dot while waiting,
   and a bare `OFFLINE` when there is nothing and no network. Guarded by
   `a board that was never loaded reports no age` (proven to bite).
4. **The desktop measure was not applying.** `#app > *` (an ID selector) set
   `max-width: 100%` and out-specified the media query's `max-width: 940px`, so
   every wide screen ran the full 1280px measure — the opposite of the printed
   page the CSS says it wants. Scoped the desktop rules through `#app`; the
   desktop board is now indistinguishable from the exemplar's 1280 shot.
5. **`npm test` in `web/` did not run** (`node --test test/` fails on Node 25);
   the script now matches the invocation the docs use.
6. **Instrument: `screenshot.js` exited 1 after a good shot** when Chrome's
   dying profile lost a race with the cleanup (`ENOTEMPTY`) — a deterministic
   false red in any scripted loop.
7. **Instrument: SIGKILL discarded localStorage**, which made the "reopen the
   app" test show a first-run screen with warm service-worker caches — a
   convincing wrong answer about prediction. The browser is now asked to close
   and given a moment to flush, with SIGKILL still the backstop.
8. Minor: the browser's search-clear ✕ in the setup fields; the current-trip
   dot touching the station name in the trips list.

### Flagged for an owner ruling (not auto-fixed)

**A. The cancelled-lead copy does not fit a 360px phone.** `docs/STYLES.md`
quotes the string `22:48 CANCELLED · NEXT RUNNING SERVICE`. Measured widths
against the body column:

| copy | type | 390px (232px column) | 360px (202px column) |
|---|---|---|---|
| `… NEXT RUNNING SERVICE` | 10px/.14em (the label idiom) | 282 — truncates | 282 — truncates |
| `… NEXT RUNNING SERVICE` | 9px/.05em (**shipped**) | fits | 226 — truncates |
| `… NEXT SERVICE` | 10px/.14em | fits (exactly) | 220 — truncates |
| `… NEXT TRAIN` | 10px/.14em | fits, 27px spare | 205 — 3px over |
| `… NEXT TRAIN` | 10px/.12em | fits | fits |

Recommendation: shorten to `22:48 CANCELLED · NEXT TRAIN` and restore the full
label idiom. It fits both widths, and "train" is the product's own noun where
"running service" is operator vocabulary. That is a change to a string quoted
in a binding doc, so it is the owner's call, not the verification wave's.
Evidence: `cancelled-390x844.png` (shipped, fits) and `cancelled-360x800.png`
(360px, still truncating).

**B. Is `187` the right figure at all?** The board's whole premise is one number
— minutes until the next train — but on the late-night board that number is
three digits and means "just over three hours", while the clock time beside it
(03:53) already says it better. The fix above makes it fit; it does not make it
read. The alternative is switching unit past 99 minutes (`3h`), which changes
the provenance vocabulary `docs/STYLES.md` fixes as `MIN / SCHEDULED / N MIN
LATE / CANCELLED`, so it needs a ruling. Evidence: `late-night-390x844.png`.

**C. Light mode does not exist.** `docs/STYLES.md` says "dark-mode first …
light mode supported"; the client ships `<meta name="color-scheme"
content="dark">` and no `prefers-color-scheme` rules at all, so a light-mode
device gets the dark board. That is a scope decision made in Phase 2 rather
than a regression, but the binding doc currently promises something the app
does not do: either build it or amend the doc.

**D. Observation, no action taken.** With the figure `Now`, the provenance slot
still reads `MIN` ("Now / MIN"). It is not wrong — the column is "minutes until"
— but it reads oddly. See `now-leaving-390x844.png`.

## What is not covered

- Real iOS/Android install and launch (only Chrome headless on macOS).
- A real disruption: `cancelled: true` has still never been observed from
  upstream, so the cancelled states remain seeded from the contract's shape.
- Anything below 360px wide, and any real light-mode device (see ruling C).
