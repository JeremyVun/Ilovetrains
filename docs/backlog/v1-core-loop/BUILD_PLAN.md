# v1 core loop — Build plan

Phases are sequential; each ends green and independently verifiable.
Owner task before Phase 0: create a TfNSW Open Data account + API key
(https://opendata.transport.nsw.gov.au), provide it as `TFNSW_API_KEY` env
var. Never commit the key.

## Phase 0 — Probe & verify (small)

- `tools/probe-tfnsw.sh` (or .go): hit stop_finder / trip / departure_mon
  with real params, save raw responses to `tools/fixtures/` (scrub nothing —
  responses contain no secrets; the key stays in env).
- Resolve every **[verify]** in `docs/references/tfnsw-open-data.md`; update
  that doc and the contracts if reality disagrees (contract change = owner
  ping, not silent edit).
- Verify: fixtures on disk show realtime estimates and platforms for a known
  pair (e.g. Central→Parramatta) during service hours.

## Phase 1 — Go backend

- `go.mod`, `cmd/server`, `internal/tfnsw` (client + response mapping),
  `internal/cache` (in-memory TTL + single-flight + stale-on-upstream-error).
- Implement `docs/contracts/api.md` exactly: `/api/v1/departures`,
  `/api/v1/stops`, `/healthz`, cache headers, error semantics.
- Tests: mapping tests against Phase 0 fixtures (golden), cache/single-flight
  tests, handler tests for cache-header + error contract. No live calls in
  tests.
- Verify: `go test ./...` green; live smoke `curl` against real TfNSW shows
  a sane departures response with correct `Cache-Control`.

## Phase 2 — Client

- Design round: DONE 2026-08-31 — exemplar `comps/shots/b-editorial-390x844.png`,
  verdict + binding rules in `docs/STYLES.md`.
- Static `web/`: departure board, first-run setup, trip management, storage +
  prediction per `docs/contracts/client-storage.md`.
- Prediction heuristic as a pure module with unit tests (deterministic per
  contract).
- Verify: unit tests green; ONE live smoke drive against the running backend
  (full empirical UX loop belongs to Phase 3, not here).

## Phase 3 — PWA + verification wave

- Service worker (cache-first shell, network-first API with cached fallback),
  manifest, installability, offline last-known state.
- Empirical loop: drive the real app in a browser — first run, daily use,
  flip, mispredict recovery, offline, upstream-down. Check the experience bar
  in DESIGN.md with measured numbers, not vibes.
- Verify: Lighthouse PWA installable; experience-bar numbers recorded in the
  phase report; contracts still match implementation.

## Deploy (after Phase 3)

Any static host + small VM/container for the Go binary behind a CDN
(decide then; the architecture makes this a commodity choice).
