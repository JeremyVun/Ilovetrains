# Roadmap

## M0 — Pipeline proven — DONE 2026-08-31
API key obtained, probes against real TfNSW endpoints, reference doc
verified against reality, Go proxy live-smoked.

## M1 — Core loop (v1) — DONE 2026-09-01
Saved trips, zero-tap predicted departure board with realtime delays and
platforms, direction flip, station search for setup. Comps round + verdict
(B·Editorial) before UI build. Empirically verified: see
`docs/backlog/v1-core-loop/VERIFICATION.md`.

## M2 — PWA polish — DONE except deploy
Installable, offline last-known departures, service worker, perf measured
(warm cached paint 32ms, live < 1s on localhost). REMAINING: deploy behind a
CDN + re-run `tools/measure-open.js` against the real origin.

## M3+ — Candidates (unscheduled, decide after living with M2)
- General A→B trip planner
- Other modes: bus, ferry, light rail
- Disruption/trackwork awareness (alerts surfaced on saved trips)
- Geolocation-assisted trip prediction
- Home-screen widgets / native wrapper
