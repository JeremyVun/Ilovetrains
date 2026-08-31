# trains_app

Sydney next-train PWA: zero-tap departure board for saved trips, no ads.
Thin-client PWA + stateless Go caching proxy over TfNSW Open Data.

## Status

Phase 1 (Go backend) done 2026-08-31; `docs/contracts/api.md` is implemented
and smoke-tested against live TfNSW. Phase 2 (web client in `web/`) built
2026-09-01: board, first run, trip management, storage + prediction, unit
tested and smoke-driven; the empirical/visual verification pass is still
outstanding. `TFNSW_API_KEY` lives in `.env` (gitignored) — never commit or
print it.

Run the whole app: `set -a; source .env; set +a; go run ./cmd/server`, then
open http://localhost:8080 — the server serves `web/` at `/` (env:
`TFNSW_API_KEY` required, `PORT` default 8080, `WEB_DIR` default `./web`).
Test: `go test ./...` and `cd web && node --test 'test/*.test.js'` — no test
makes a network call, and the client has no build step and no npm deps.

## Structure

- `docs/PROJECT.md` — what/why, principles, key decisions, core flows
- `docs/ROADMAP.md` — milestones
- `docs/STYLES.md` — design intent (comps verdict pending)
- `docs/contracts/api.md` — backend JSON API (binding)
- `docs/contracts/client-storage.md` — localStorage schema + prediction
  heuristic (binding)
- `docs/references/tfnsw-open-data.md` — upstream API notes; **[verify]**
  items must be resolved by live probes before being relied on
- `docs/backlog/v1-core-loop/` — v1 design + phased build plan
- `tools/` — probe/verification scripts (`screenshot.js`) + TfNSW fixtures
- `web/` — the client: `index.html`, `app.css`, ES modules in `web/js`
  (`rowmodel`, `storage`, `predict` are pure and unit tested in `web/test`)
- `cmd/server` — backend entrypoint; `internal/tfnsw` — upstream client and
  response mapping; `internal/cache` — TTL + single-flight + stale-on-error;
  `internal/api` — handlers, cache headers, error contract

## Rules

- Server is stateless; personal data never leaves the device. Don't add
  server-side user state without an owner ruling.
- Contract docs update in the same change as the interface they describe.
