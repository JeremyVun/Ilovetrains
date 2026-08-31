# trains_app

Sydney next-train PWA: zero-tap departure board for saved trips, no ads.
Thin-client PWA + stateless Go caching proxy over TfNSW Open Data.

## Status

Phase 1 (Go backend) done 2026-08-31; `docs/contracts/api.md` is implemented
and smoke-tested against live TfNSW. Next: Phase 2 (client) in
`docs/backlog/v1-core-loop/BUILD_PLAN.md`. `TFNSW_API_KEY` lives in `.env`
(gitignored) — never commit or print it.

Run the backend: `set -a; source .env; set +a; go run ./cmd/server`
(env: `TFNSW_API_KEY` required, `PORT` default 8080, `WEB_DIR` default
`./web`). Test: `go test ./...` — no test makes a network call.

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
- `tools/` — probe/verification scripts + captured TfNSW fixtures
- `cmd/server` — backend entrypoint; `internal/tfnsw` — upstream client and
  response mapping; `internal/cache` — TTL + single-flight + stale-on-error;
  `internal/api` — handlers, cache headers, error contract

## Rules

- Server is stateless; personal data never leaves the device. Don't add
  server-side user state without an owner ruling.
- Contract docs update in the same change as the interface they describe.
