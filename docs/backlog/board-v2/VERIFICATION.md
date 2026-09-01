# Board v2 implementation verification

Verified locally and in production on 2026-09-02 against the locked comps8 in `comps-final/`.
The browser driver is `tools/shoot-states.js`; it loads the real client, seeds
the document the client writes, pins the clock, drives actual controls and
checks geometry in Chromium. No `.env` or deployment secret was read.

## Gates

- `go test ./...` — all packages pass.
- `cd web && npm test` — 116 tests pass, including the exact past-row
  actuals/timetable rule, time-axis arithmetic, reverse platforms, fuzzy
  ranking, location scoring, LRU and ride deduplication.
- `node --check` passes for the changed controllers and browser driver.
- Dark and light browser sweeps pass without invariant errors at 390×844,
  412×732 and 1280×800. Journey detail is included on phone and desktop.
- Chromium reports no parsed manifest errors. After a warm v6 visit, the local
  server was stopped and a fresh navigation in the same profile painted the
  complete setup shell from the service worker.

## Measured invariants

- At 412×732 the board timeline is 632.265625px high. Its six future services
  are each 100.03125px; the first begins below the 32px now anchor and the sixth
  ends at y=731.921875 inside the 732px viewport. All are whole and equal.
- The reference transfer is a 27/7/10-minute axis in a 346px bar. Chromium drew
  212.3125/55.03125/78.625px against mathematical widths
  212.31818/55.04545/78.63636px: deviations 0.0057/0.0142/0.0114px, or 0.0px
  at the instrument's one-decimal reporting precision. Platform boxes overlay
  those marks and do not consume axis width.
- In the smart header, both station names start at y=91.375 and both endpoint
  times at y=112.765625. This fixes the comps8 Rhodes/Bondi Junction offset
  called out during handoff.
- Every visible button or full-row control clears the 44px tap-target floor.
  The detail-view actions were found at 12px during this pass and corrected to
  44px before the final sweep.
- With past pages loaded, the board initially lands with `scrollTop` equal to
  the now anchor. Scrolling upward reveals actuals rows with elapsed figures
  and `AGO`, followed by timetable-only rows with blank figures and no coral or
  punctuality claim. No past row displays a countdown.

## Driven flows

- Tapping a board row opens its real journey detail.
- Focusing that journey returns to home and promotes the snapshot into the
  smart header; no B2 footer strip appears on the board.
- The marker advances through first leg, dwell and final leg on the same time
  axis. The boarding platform cap disappears after departure.
- Choosing “Show the way back” clears the completed focus, fetches the real
  reverse response and renders its own transfer platforms. The driven reverse
  fixture displays arrival platform 4 and next boarding platform 1, rather
  than reversing or inventing the outbound pair.
- The first-run screen has no dead Home control; add-trip keeps per-field
  recents, fuzzy-ranks station answers and exposes one full-width save action.

## PWA and contracts

The shell cache is v6 and precaches the new home and journey-bar modules. The
API contract records the planned connection floor; the client-storage contract
records coordinates, recent searches, rides, home inference and the ten-trip
web LRU. Completed ride snapshots survive saved-trip eviction so home evidence
does not disappear with management state.

## Production

Commit `34dc031` was pushed to `main`, published as the multi-architecture image
`registry.jeremyvun.com/ilovetrains:latest` (manifest digest
`sha256:a65cd08bf7f55d1b50394505d16d1c55a73cfae7075d213e3b3656b9b267451f`),
and deployed to `syd1` by successful job `704ddb8ce9537ec23fc6c7bdb4581ac2`.
The public health check, HTML shell, v6 service worker and a real departures
request all returned successfully. A controlled warm Chromium open of
`#/board` painted in 52ms, completed live data in 48ms, showed four rows and
was controlled by the service worker, clearing the 500ms/2s experience bar.
