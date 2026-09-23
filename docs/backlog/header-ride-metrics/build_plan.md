# Build plan: header and ride metrics

Design: [design.md](design.md). Branch `header-ride-metrics`, based on
`field-report-fixes-head` (its arrival and ride writes are the seam this item
hooks). Platform worktrees fork from this branch after phase 1.

Every agent: comments are rare and short, one line of *why* where the reason
is non-obvious, never narrating what the code does. Commit after every step.
Run Gradle and Xcode builds one at a time: hold
`mkdir /private/tmp/ilt-5e0c1f-gate-lock` (retry every 15 s until it succeeds)
for the duration of any `tools/build-android.sh` or `tools/build-ios.sh` run
and `rmdir` it afterwards.

## Seam contract (all platforms)

- Vocabulary, dimensions and trigger rules are exactly design.md's; native
  never invents a value outside it.
- Within one open: `opened` (when a milestone is due) precedes the first
  `shown_*`. On a pin of the header's trip and direction, `hit_<kind>` is
  recorded before `pinned_<kind>`.
- `pinned_<kind>` compares against the header's last rendered answer (trip,
  direction, lead journey identity key), captured before navigation away from
  home, not against whatever the header would show after the pin.
- `rode_*` is recorded after the ride write is applied to the in-memory
  document by the serialized owner, never from a render, timer or location
  callback directly.
- A dimension object always contains `u`, `pl`, `pl.u`; plus `x.*` on web;
  plus exactly the event's own keys (`m`, `f`, `r`+`pl.r`, `b`+`pl.b`).

## Phase 1: contracts and privacy copy (lead) — done marker: [ ]

Owns `docs/contracts/analytics.md`, `docs/contracts/client-storage.md`
("Analytics queue" and native storage sections),
`docs/contracts/android-deviations.md`, `docs/contracts/ios-deviations.md`,
`site/privacy/index.html`. Copy drafted by Astra; the privacy wording ships in
the branch marked for the owner's verdict. Verify: contracts agree with
design.md; no other contract still says native analytics is off.

## Phase 2: web (lead) — done marker: [ ]

Owns `web/js/analytics.js`, the pin and ride emission points in
`web/js/main.js`, `web/sw.js` `VERSION`, `web/test/analytics.test.js` and new
cases beside the existing pin/arrival tests, and
`tools/check-analytics-browser.js` if its expected payload changes.
Verify: `(cd web && npm test)`;
`CDP_PORT=9453 HTTP_PORT=8193 node tools/check-analytics-browser.js`;
`tools/playtest-regressions.sh`. Tests prove: legacy queue upgrade, each `r`
value, `rode_pin` versus `rode_auto`, no emission on ride correction, a pin
with no header answer emits no `pinned_*`.

## Phase 3: Android (Opus, worktree `/private/tmp/ilt-metrics-android`) — done marker: [ ]

Owns a new `Analytics.kt` (vocabulary, queue, store, transport, enablement),
the kind added to `Selection` in `Prediction.kt`, emission points in
`TrainViewModel.kt`, the debug override plumbing in `MainActivity.kt`, and new
JVM tests. Does not touch UI files. Verify: `tools/build-android.sh --unit`,
then the full `tools/build-android.sh` (unit, lint) once on final sources.
Tests prove: band and milestone derivation per foreground open, kind mapping
for each prediction path, the three `r` values, `rode_*` only on a new ride,
queue compaction, cap, saturation, snapshot settlement, malformed-store drop,
and that a debug build never sends without the override.

## Phase 4: iOS (Opus, after phase 3; worktree `/private/tmp/ilt-metrics-ios`) — done marker: [ ]

Same scope as phase 3 in `ios/ILoveTrains/Core/Analytics.swift`,
`Prediction.swift`, `TrainViewModel.swift`, the app entry point for the
override, and new XCTest cases in `ios/ILoveTrainsTests/` (add them to the
Xcode project). Verify: `tools/build-ios.sh --unit`, then
`tools/build-ios.sh --test` once on final sources.

## Phase 5: integration and wire verification (lead) — done marker: [ ]

Merge phases 3 and 4 into `header-ride-metrics`. On each platform, run a
debug build with `ILOVETRAINS_ANALYTICS_URL` pointed at a local capture
server, drive open → header → row tap → detail → pin, background the app, and
check the captured body: exact `{p,t,d,n}` shape, `pl`, ordering, no field
outside the vocabulary. Run the full primary gates from `CLAUDE.md` once on
the final sources. Then offer the close stage.
