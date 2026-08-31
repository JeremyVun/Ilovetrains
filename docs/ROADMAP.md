# Roadmap

## M0 — Pipeline proven — DONE 2026-08-31
API key obtained, probes against real TfNSW endpoints, reference doc
verified against reality, Go proxy live-smoked.

## M1 — Core loop (v1) — DONE 2026-09-01
Saved trips, zero-tap predicted departure board with realtime delays and
platforms, direction flip, station search for setup. Comps round + verdict
(B·Editorial) before UI build. Empirically verified: see
`docs/backlog/v1-core-loop/VERIFICATION.md`.

## M2 — PWA polish — DONE 2026-09-01
Installable, offline last-known departures, service worker, perf measured
(warm cached paint 32ms, live < 1s on localhost). Deployed behind Cloudflare+Caddy on syd1 (see CLAUDE.md Deploy); real-origin
numbers: warm cached paint 12ms, live data 7ms (edge cache).

## M3+ — Candidates (unscheduled, decide after living with M2)
- Baked station index: build the ~300-entry train/metro station list into the
  server (from the GTFS stops bundle) so /api/v1/stops never touches TfNSW —
  instant autocomplete, zero upstream calls. Motivated by live use 2026-09-01:
  every distinct search prefix is a cold ~0.5–1.5s upstream call.
- General A→B trip planner
- Other modes: bus, ferry, light rail
- Disruption/trackwork awareness (alerts surfaced on saved trips)
- Geolocation-assisted trip prediction
- Home-screen widgets / native wrapper
