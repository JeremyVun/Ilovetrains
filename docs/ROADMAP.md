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

## M3 — Board v2 + smart home — DONE 2026-09-02
Locked comps8 implemented: home is the open state, the departure board is a
now-anchored past/future timeline, and focused journeys become continuous
directions in the smart header. Includes exact percentage transfer axes,
actuals-vs-timetable past rows, real return journeys, recent/fuzzy station
search, location-aware prediction, completed-ride/home inference, ten-trip LRU,
and the server-tuneable planned transfer floor. Browser and geometry evidence:
`docs/backlog/board-v2/VERIFICATION.md`.

## M4+ — Candidates (unscheduled, decide after living with M3)
- Baked station index: build the ~300-entry train/metro station list into the
  server (from the GTFS stops bundle) so /api/v1/stops never touches TfNSW —
  instant autocomplete, zero upstream calls. Motivated by live use 2026-09-01:
  every distinct search prefix is a cold ~0.5–1.5s upstream call.
- General A→B trip planner
- Other modes: bus, ferry, light rail
- Disruption/trackwork awareness (alerts surfaced on saved trips)
- Home-screen widgets / native wrapper
- **Ride history as a stat** (owner idea 2026-09-01): with a native wrapper
  and coarse background location, count actual rides and print it in the
  saved-trip row's meta, beside the "last ridden Friday" fact that is already
  there — "you rode this 4 times this week". Honesty constraint carried from
  the board's two-register rule: count only what can actually be observed. A
  count inferred from app opens is a count of *looks*, not rides, and must be
  named as whatever it really measures — a rider who took the train twice and
  is told they took it four times has been told something false about their
  own week. Needs ride detection first; the PWA cannot observe it today.
