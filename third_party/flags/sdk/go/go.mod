module github.com/JeremyVun/flags/sdk/go

go 1.26

// The Go SDK depends only on the shared evaluation core (pkg/flags), which is
// stdlib-only. The core lives in the sibling server module.
//
// For downstream consumers the `require` below resolves the tagged core module
// (`server/vX.Y.Z`) straight from the repo. The `replace` is local-development
// only — Go ignores replace directives in non-main modules, so consumers never
// see it; it just lets this repo build/test against the sibling source instead
// of a published tag. Keep the required version in lockstep with the latest
// `server/vX.Y.Z` tag (see docs/PUBLISHING.md).
require github.com/JeremyVun/flags/server v0.1.0

replace github.com/JeremyVun/flags/server => ../../server
