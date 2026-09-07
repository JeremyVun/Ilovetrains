# Shared flags Go SDK

Vendored from `https://github.com/JeremyVun/flags` at
`0f553854418177049de859176f64973b0c516b61`, with owner approval on
2026-09-08. `UPSTREAM.json` records SHA-256 hashes of the copied files;
`LICENSE` retains the upstream license.

Included: Go SDK implementation and unit tests, plus its shared evaluation
core (`server/pkg/flags`). The evaluator is unchanged. The generated
`server/go.mod` declares only the core module, avoiding unrelated flagsd
database and HTTP server dependencies. SDK integration tests requiring the
complete flagsd server and database are excluded.

Local additions: `sdk/go/public.go` and `public_test.go`. `AllPublicFlags`
filters public metadata and evaluates against a single atomic snapshot;
unready, stale, private and invalid flags are omitted. The app endpoint
further allows only its supported boolean keys. No raw snapshot reaches
the browser.

Root `go.mod` replaces both module paths with this directory. SDK `v0.0.0`
is a local placeholder, not an upstream release. Docker copies this tree
before resolving modules, so builds do not require the source checkout.

To update, copy these same files from a reviewed upstream commit, regenerate
`UPSTREAM.json`, and reapply or retire the public accessor if upstream has
added an equivalent. Run `go test ./...` at the app root and
`go test -race ./...` in `third_party/flags/sdk/go`. Prefer published modules
when both SDK and core releases include the public accessor.
