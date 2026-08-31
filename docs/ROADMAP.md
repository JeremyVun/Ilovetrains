# Roadmap

## M0 — Pipeline proven
API key obtained, probe scripts against real TfNSW endpoints, reference doc
verified against reality, Go proxy serving normalized departures for one
hardcoded station pair.

## M1 — Core loop (v1)
Saved trips, zero-tap predicted departure board with realtime delays and
platforms, direction flip, station search for setup. Design pass (comps)
before UI build. This is the "better than TripView daily" bar.

## M2 — PWA polish
Installable, offline last-known departures, service worker, perf budget
(cold open < 1s on 4G, warm open feels instant), deployed behind a CDN.

## M3+ — Candidates (unscheduled, decide after living with M2)
- General A→B trip planner
- Other modes: bus, ferry, light rail
- Disruption/trackwork awareness (alerts surfaced on saved trips)
- Geolocation-assisted trip prediction
- Home-screen widgets / native wrapper
