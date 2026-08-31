# Trains App (working name)

A Sydney public transport app that answers one question the moment you open it:
**"When is my next train?"** — with zero taps, zero search, zero ads.

## Why

TripView and the official apps make you search origin and destination every
time, even though almost every journey is one of the same two or three trips.
They're ad-laden, can't save trips well, and have no memory. This app inverts
that: it remembers your trips, learns your patterns, and shows the right
departure board before you ask.

## Product principles

1. **Zero-tap answer.** The home screen shows the next trains for the trip you
   almost certainly want, instantly. Everything else is one tap away.
2. **Speed is a feature.** Render from cached data immediately, refresh live.
   No spinners on the happy path.
3. **No ads, no accounts, no tracking.** All personal data (saved trips,
   history) lives on the device. The server never sees who you are.
4. **Predictable magic.** The mind-reading heuristic is simple and
   documented; a manual override is always one tap away.

## Shape

Thin-client PWA + stateless Go caching proxy in front of Transport for NSW
Open Data. See `docs/contracts/` for the precise interfaces.

```
Browser (localStorage: saved trips, history, heuristic)
  ├─ static shell ─────────── CDN, cached ~forever
  └─ fetch /api/v1/... ────── JSON, CDN s-maxage ~30s (shared across users)
                └─ Go backend (stateless cache/proxy, in-memory cache,
                   single-flight) ── TfNSW Trip Planner API
```

## Key decisions (2026-08-31, aligned with owner)

- **Frontend: thin-client PWA**, not htmx. Static shell, minimal JS, fetches
  JSON. Chosen for installability, offline last-known data, and so a future
  native app can reuse the same API. htmx was considered and rejected: weaker
  offline story, HTML endpoints not reusable by a native client.
- **Backend: Go.** Single static binary, ideal for a caching proxy.
- **Personalization is client-side only.** This is the load-bearing decision:
  because the server holds no user state, every API response is keyed only by
  station pair and is CDN-cacheable and shared across all users. Cheap to
  serve, trivially scalable, cache-friendly by construction.
- **v1 scope: saved trips + next trains only.** Trains and metro. Station
  search exists only to set up a saved trip. No general trip planner yet.
- **Mind reading: time + history heuristic**, localStorage only, no
  geolocation permission in v1. See `docs/contracts/client-storage.md`.

## Core user flows (v1)

1. **Daily use (the whole point):** open app → next trains for the predicted
   trip render instantly (cached, then live refresh): minutes until departure,
   platform, realtime delay, arrival time. One tap flips direction; one tap
   switches to another saved trip.
2. **First run:** welcome → search origin station → search destination →
   trip saved → land on the departure board.
3. **Manage trips:** add / remove / reorder saved trips.

## Status

Docs-only. No code yet. Next step: TfNSW Open Data API key + probe scripts
(see `docs/backlog/v1-core-loop/BUILD_PLAN.md`).
