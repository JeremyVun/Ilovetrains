# trains_app

Sydney next-train PWA: zero-tap departure board for saved trips, no ads.
Thin-client PWA + stateless Go caching proxy over TfNSW Open Data.

## Status

Phase 1 (Go backend) done 2026-08-31; `docs/contracts/api.md` is implemented
and smoke-tested against live TfNSW. Phase 2 (web client in `web/`) built
2026-09-01: board, first run, trip management, storage + prediction. Phase 3
(2026-09-01): PWA (manifest, icons, service worker) plus the empirical
verification wave — every state driven in a real browser and judged against the
exemplar, the experience bar measured, offline proven with the server killed.
Results, defects and two open owner rulings:
`docs/backlog/v1-core-loop/VERIFICATION.md`. `TFNSW_API_KEY` lives in `.env`
(gitignored) — never commit or print it.

Run the whole app: `set -a; source .env; set +a; go run ./cmd/server`, then
open http://localhost:8080 — the server serves `web/` at `/` (env:
`TFNSW_API_KEY` required, `PORT` default 8080, `WEB_DIR` default `./web`).
Test: `go test ./...` and `cd web && npm test` — no test makes a network call,
and the client has no build step and no npm deps.

Editing the client: `web/sw.js` serves the shell cache-first, so a browser that
has already visited will keep serving the old CSS and modules until `VERSION`
is bumped. Develop with DevTools' "Update on reload", or in a throwaway profile
— `tools/screenshot.js` and `tools/shoot-states.js` use one by default.

## Structure

- `docs/PROJECT.md` — what/why, principles, key decisions, core flows
- `docs/ROADMAP.md` — milestones
- `docs/STYLES.md` — BINDING design verdict (B·Editorial exemplar) + intent
- `docs/contracts/api.md` — backend JSON API (binding)
- `docs/contracts/client-storage.md` — localStorage schema + prediction
  heuristic (binding)
- `docs/references/tfnsw-open-data.md` — upstream API notes; **[verify]**
  items must be resolved by live probes before being relied on
- `docs/backlog/v1-core-loop/` — v1 design + phased build plan
- `tools/` — verification instruments (`screenshot.js`, `shoot-states.js`,
  `measure-open.js`, `make-icons.sh`) + the TfNSW probe and fixtures; read
  `tools/README.md` before trusting or changing any of them
- `web/` — the client: `index.html`, `app.css`, ES modules in `web/js`
  (`rowmodel`, `storage`, `predict` are pure and unit tested in `web/test`),
  plus the PWA shell: `manifest.webmanifest`, `sw.js`, `icons/`
- `cmd/server` — backend entrypoint; `internal/tfnsw` — upstream client and
  response mapping; `internal/cache` — TTL + single-flight + stale-on-error;
  `internal/api` — handlers, cache headers, error contract

## Rules

- Server is stateless; personal data never leaves the device. Don't add
  server-side user state without an owner ruling.
- Contract docs update in the same change as the interface they describe.
- Any deploy that changes a file in `web/sw.js`'s `SHELL` list must bump
  `VERSION` in that file, or returning users keep the old shell.
