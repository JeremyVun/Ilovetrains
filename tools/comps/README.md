# tools/comps — the design-comps harness

A comps round is 3–5 throwaway HTML concepts, shot headless at the standard
phone frames and both colour schemes across every stress scenario, assembled
into a contact sheet with measured captions and judged by the owner against the
calibration exemplar. The method is the `design-comps` skill; this directory is
the instrument, so a round is a directory of HTML plus a one-line shoot rather
than a copied `shoot.js`.

## A round, in three commands

```sh
node tools/comps/new-round.js  <name>          # scaffold /tmp/trains-comps-<name>
node tools/comps/shoot.js      /tmp/trains-comps-<name>
node tools/comps/sheet.js      /tmp/trains-comps-<name>   # then open index.html
```

Iterating on the winner inherits the previous round verbatim, which is what
keeps a comp rendering against the same cascade its exemplar was shot with:

```sh
node tools/comps/new-round.js round7 --from /tmp/trains-comps-round6
```

The repo stays untouched by a round until its verdict, and the workshop is
self-contained: a fresh agent can reclaim the round from the directory alone.

## The tools

- **`new-round.js <name> [--from DIR] [--manifest FILE] [--regen base,data]`**
  Scaffolds `/tmp/trains-comps-<name>/`: `base.css` copied verbatim from
  `web/app.css` with its git blob hash in the header, `data.js` and `hdata.js`
  generated from the catalogue, a concept template (`concept.html/.js/.css`),
  `comps.json`, `captions.json`, `OPTIONS.md` in the shape the skill prescribes,
  and `exemplars/` from `assets/comps/latest/`. `--from` inherits a previous
  workshop; generated files are written only where the inherited round did not
  supply them, and `--regen base,data` forces them back to live sources.
- **`shoot.js <workshop> [concept] [scenario] [--no-zooms]`** The matrix
  shooter. Writes `shots/<concept>-<WxH>-<scenario>[-light].png` at
  deviceScaleFactor 2 plus `shots/report.json` with every probe result per shot.
- **`zoom.js <workshop> <concept> <scenario> <x> <y> <w> <h> [--out NAME]
  [--scale 4] [--scheme dark] [--frame phone]`** A 4× clip of the live cascade,
  for decisions that live in twenty pixels. The manifest's `zooms` run with the
  matrix; this CLI is for finding the clip.
- **`sheet.js <workshop> [--out index.html]`** Builds the contact sheet from
  `comps.json`, `shots/report.json` and `captions.json`. It does not open a
  browser; the orchestrator does that.
- **`diff.js <a.png|dirA> <b.png|dirB> [--threshold N]`** Pixel diff with no
  dependencies: both PNGs are decoded by the browser that drew them and compared
  through `getImageData`. Per-platform regression, and this harness's own gate.
- **`scenarios.js`** The scenario catalogue, derived from `tools/fixtures/`.
- **`probes.js`, `chrome.js`, `manifest.js`** The probe pack, the CDP driver and
  the manifest reader.

## The scenario catalogue

`scenarios.js` derives the board and home tables from `tools/fixtures/*.json`:
UTC→AEST, the class-10 "On Demand" exclusion `docs/contracts/api.md` applies
server-side, and `web/js/time.js`'s minute arithmetic (both sides floored to the
clock minute). Nothing is typed by hand, so a comp cannot drift from the
product's own data.

The fixtures were captured on days with no disruption, so a delayed, cancelled
or at-risk board needs a **synthetic delta**. Every delta is declared in the
module and printed into the head of the generated data file, and `sheet.js`
names all of them in the sheet's lede automatically — the owner must never rule
on a fixture artifact by mistake. Board deltas: `delayed`, `cancelled`, `tight`.
Home deltas: `D1`–`D8`.

Scenario names a fresh round starts with: `hero`, `past`, `deep`, `delayed`,
`cancelled`, `tight`, `focused`, `riding`, `long`, `trips`, `ask` (board);
`before`, `leave`, `board`, `change`, `wide`, `final`, `arrive`, `done`,
`tight`, `cxl`, `back`, `moved`, `nofix`, `ask`, `many`, `add`, `save` (home).
A concept may also RESOLVE a job name the catalogue does not hold — board v2's
`landing` renders `past` unscrolled, which is the only way to photograph "the
board never opens inside the past".

`node --test 'tools/comps/test/*.test.js'` proves the generated tables
deep-equal the board v2 workshop's own hand-maintained tables, read out of git.

## comps.json

```json
{
  "round": "board-v3",
  "title": "the question this round asks",
  "frames": { "phone": { "w": 390, "h": 844 }, "short": { "w": 412, "h": 732 } },
  "concepts": ["c1-ledger", "c2-spine"],
  "scenarios": ["hero", "past"],
  "settle": 260,
  "dsf": 2,
  "exemplars": "exemplars",
  "probes": { "tapMin": 44, "selectors": { "scroller": ".tl" } },
  "jobs": [
    { "concepts": ["c1-ledger"], "scenarios": ["hero", "long"],
      "frames": ["phone", "short"], "schemes": ["dark", "light"] }
  ],
  "zooms": [
    { "out": "bar", "concept": "c1-ledger", "scenario": "hero",
      "x": 22, "y": 300, "w": 160, "h": 40, "scale": 4, "frame": "phone" }
  ]
}
```

Each `jobs` entry is the cross product of its concepts × scenarios × frames ×
schemes, in order, de-duplicated. Singular `concept`/`scenario`/`frame`/`scheme`
keys are accepted. Frames default to 390×844 (`phone`), 412×732 (`short`, the
owner's Android with its browser chrome) and 360×780 (`narrow`, for stress). The
dark scheme is unsuffixed; every other scheme suffixes the file name.
`probes.selectors` overrides any hook below, which is how a round inherited from
before this vocabulary is still measured.

## captions.json

The comp agent writes it; the sheet builds from it. Captions carry
measurements, never adjectives — the numbers are appended automatically from
`report.json`, so a caption cannot claim what the probes did not measure.

```json
{
  "title": "...",
  "lede": ["what this round is for", "..."],
  "ask": ["<b>THE THINGS TO JUDGE.</b> (1) … (2) …"],
  "sections": [
    { "h2": "c1 · the ledger",
      "note": "two sentences: the idea, and its emotional target",
      "exemplars": true,
      "figures": [
        { "shot": "c1-ledger-390x844-hero", "note": "<b>Hero</b>" },
        { "zoom": "zoom-bar", "size": "z", "note": "the transfer gap, 4×" },
        { "exemplar": "board-390x844-hero.png", "note": "the thing to beat" }
      ],
      "table": { "head": ["state", "clock"], "rows": [["before", "09:09"]] },
      "ask": ["my recommendation, and the condition under which it flips"] }
  ]
}
```

A figure whose `shot` has a same-named file in `exemplars/` gets the exemplar
column beside it automatically — verdicts are made side by side. Set
`"exemplars": false` on the section, or `"noExemplar": true` on the figure, to
suppress it. `size` is `z` (430px) or `zz` (640px).

## The data-attribute vocabulary

The probes are keyed on data attributes so a comp and, later, the real client
can carry the same hooks and be measured by the same code.

| attribute | what it marks |
|---|---|
| `data-scroller` | the element the content scrolls inside; counts and scroll position are measured against IT, never the viewport |
| `data-svc` | one item inside the scroller (a service, a row, a saved trip) |
| `data-past` | an item that has already happened; excluded from the whole-item count |
| `data-tap` | a tap target; every `button` is one too |
| `data-track` | a fixed track whose width is a design constraint; the value names it in the report |
| `data-lockups` | `\|`-separated widest LEGAL values for that track, e.g. `78\|999@wide\|12H@wide\|Now@wide`. `@class` is the guard class the renderer would add for that value |
| `data-lockup-row` | the ancestor to clone when stressing a track, so the guard runs through the real cascade |
| `data-ink` | inside a track, the element whose text is replaced (defaults to the track) |
| `data-unit` | a unit inside the ink that a non-numeric value drops (`min` under `12H`) |
| `data-axis` | a bar claiming to be a time axis, carrying the minutes it claims: `data-axis="27/7/10"` |
| `data-seg` | one drawn segment of an axis, in order |
| `data-pin="a"` / `="b"` | the marks pinned to the end of leg 1 and the start of leg 2 |
| `data-clamped` | set by the renderer when a pin had to be pulled back off the end of the bar |
| `data-probe` | an optional readable name for any element, used in probe output instead of its class |

`report.json` carries, per shot: `frame`, `scheme`, `w`/`h`, `overflow`,
`belowFold`, `taps`, `tapFloor`, `scroller` (`whole`/`top`/`extent`), `spill`,
`clip`, `tracks` (`ink`/`box`/`invades` per lockup) and `axes`
(`drawn`/`want`/`dev`/`tailRight`/`headLeft`/`visGap`/`clamped`/`offScale`).

## Traps this harness exists to defeat

Each one cost a review pass. They are also written beside the code that defeats
them, in `chrome.js` and `probes.js`.

1. **Viewport lie.** `chrome --headless --window-size=390,844 --screenshot`
   silently clamps the layout viewport to 500 CSS px on macOS and crops the PNG.
   `chrome.js` drives `Emulation.setDeviceMetricsOverride` and asserts BOTH
   `clientWidth` and `clientHeight`, refusing to save otherwise.
2. **Missing viewport meta.** With `mobile:true` and no `<meta name="viewport">`
   Chrome lays out at 980px. Every comp ships the meta; the shooter refuses a
   page that does not.
3. **Locked profile.** A profile directory left by an orphaned headless tree
   makes the next Chrome exit before the devtools endpoint opens, which surfaces
   as an unrelated `Invalid URL` from the WebSocket. Every run gets its own
   `mkdtemp` profile.
4. **Port collision.** The same failure, from two rounds sharing one fixed port.
   Chrome is asked for port 0 and reports what it got in `DevToolsActivePort`,
   so nothing here collides with `tools/screenshot.js` (9333) or a stale tree.
5. **Orphan Chrome.** SIGKILL in a `finally`, plus a process-exit backstop.
6. **The fold is not the scroller.** A row clipped by an `overflow:auto`
   scroller whose own bottom falls inside the viewport is invisible to a
   viewport-relative probe. Counts and scroll position use `[data-scroller]`.
7. **Text in a fixed track does not move its box.** The right-edge probe is
   blind to it; every leaf is scanned for `scrollWidth > clientWidth`, with
   deliberate ellipsis separated from spill.
8. **`text-align: right` does not overflow rightwards.** Chrome start-aligns an
   over-long line box, so a right-aligned figure invades the column to its LEFT
   with nothing firing. Tracks are stressed with the widest value the vocabulary
   allows, never the scenario's value.
9. **A bare clone measures a size the page never renders.** The guard that saves
   a wide lockup is usually a class on the ROW, so the stress clones the whole
   `[data-lockup-row]` and measures the ink inside it.
10. **Absolutely positioned marks are invisible to the overflow probes** — which
    is where every mark on a time axis lives. The axis probe is what checks
    those: it recomputes the picture from the minutes the axis claims to obey and
    reports the drawn-versus-wanted deviation per segment.
11. **Modules are blocked under `file://`.** Comps are classic scripts; every
    name in a comp's data file is a deliberate global.

## Gates

```sh
node --test 'tools/comps/test/*.test.js'   # catalogue + every probe proven to bite
node tools/comps/test/oracle.js            # the acceptance oracle, ~1 min of Chrome
```

The oracle extracts the archived board v2 final workshop from git, scaffolds a
round from it, shoots the archive's own job list and diffs the result against
`assets/comps/latest/`. It passes only when every exemplar is reproduced
**pixel-identical**. If a shot differs, find out why and fix the harness; the
exemplars are the truth, and loosening the comparison is not a fix.

## Seams left open

- **The real client carries none of these attributes yet.** Adding
  `data-scroller`, `data-svc`, `data-tap`, `data-track`, `data-axis` and their
  companions to `web/` would let `tools/shoot-states.js` run this same probe
  pack against the shipped screens, which is what "the comp and the client
  measured by the same code" is for. It is a separate product change.
- **`tools/shoot-states.js` still owns its own state list.** It seeds the real
  client with API-response-shaped documents built from `web/test/fixture.js`,
  while this catalogue emits already-mapped view rows: the two are at different
  levels, so the migration is not a verbatim data move. Unifying them is M7's
  "state catalogue and seeded shooters" bullet, and it wants the catalogue to
  emit API bodies as well as rows.
