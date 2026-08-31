# v1 core loop — Design

Self-contained with `docs/contracts/api.md`, `docs/contracts/client-storage.md`
and `docs/references/tfnsw-open-data.md`.

## What

The daily-use loop, end to end: open the app → the departure board for your
predicted saved trip is already there → glance → go. Plus the minimum around
it: first-run trip setup and trip management. Trains and metro only.

## Screens

1. **Departure board (home).** Header: trip name ("Central → Parramatta"),
   flip-direction button, trip switcher (only if >1 saved trip). Body: next
   ~6 journeys — big minutes-until number, estimated departure time, platform,
   line badge, arrival time, delay/cancelled/stale indicators per
   `api.md` semantics. Auto-refresh every 30s while visible (pause when tab
   hidden). First paint from `cache` in localStorage, live data replaces it
   without layout shift.
2. **First run.** Shown when no saved trips: one-line pitch → origin search →
   destination search (autocomplete via `/api/v1/stops`) → save → home.
3. **Trip management.** List saved trips; add (same search flow), delete,
   reorder. Reached from an unobtrusive edit affordance on home.

## Decisions

- **`trip` endpoint, not `departure_mon`.** A station-pair board must exclude
  services that don't reach the destination; only `trip` can do that. It also
  returns arrival times and platforms in one call.
- **Prediction per `client-storage.md`** — deterministic, documented,
  overridable. No geolocation in v1 (rejected: permission prompt cost >
  benefit while the heuristic is unproven).
- **Refresh cadence 30s** matching server `s-maxage=30` — faster polling
  can't produce fresher data by construction.
- **No build-step frontend framework.** Vanilla ES modules + template
  literals (or lift to Preact only if state wiring proves painful — decide in
  Phase 2, record here). Rejected: React/Vue-scale stacks — the app is two
  screens and a list; the perf budget is the point.
- **Rejected for v1:** general trip planner, other modes, push notifications,
  alerts UI (alerts surface only as `cancelled` flags for now).

## Experience bar (acceptance)

- Warm open → correct predicted board visible < 500ms (cached paint), live
  data < 2s on 4G.
- Zero taps for the daily case; wrong prediction is 1 tap to fix (flip) or
  2 (switch trip).
- Delay, cancellation, no-realtime, stale-data, and offline states all
  visually distinct and honest.

## Open questions (resolve during build, fold answers back in)

- ~~Exact TfNSW params/paths~~ — resolved by Phase 0 probes 2026-08-31; see
  reference doc. Remaining **[verify]**: quota numbers, metro product class,
  cancellation signal shape (needs a real disruption to observe).
- Whether metro journeys need any presentation difference beyond the badge.
