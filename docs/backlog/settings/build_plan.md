# Settings build plan

Approved C1 composition and September 6 build authorization are in design.md.
The owner explicitly requested implementation in this session.

## 1. API modes — done
Own internal/api, internal/tfnsw and API contract. Optional canonical served-mode
allow-list; absent all, empty none, invalid rejected. Upstream exclusions and
conjunctive response filtering happen before limit. Cache keys include modes.
Verify upstream mock requests, all-off no fetch, cache separation, mixed legs;
Go suite and race detector pass.

## 2. Preferences — done
Own preferences/storage/predict and setup location gates. Defaults preserve
current behavior; explicit all-off survives; raw caches partition by mode set.
Manual home takes precedence without stopping votes. Location-off invalidates
pending fixes in controller. Verify malformed storage, cache cleanup, home
restore and location gating with unit tests. The 303-test web suite passes.

## 3. C1 surface — done
Own settings, appearance, version, home footer, CSS and release build wiring.
Port round-2 C1 and round-1 home search/feedback. Draft is one in-memory object
through navigation; only 201 clears. Theme applies before first paint and obeys
system changes only in System. Verify controls/forms, byte limits and theme.

## 4. Controller integration — done
Own main/api client and SW shell. Mode changes abort/invalidate suggestion work,
retain eligible cached display and fetch again through departures API. Async
success and failure use generation guards. All-off suppresses suggestions.
Followed journeys refresh independently using all modes, including in Settings.
Preference rerender preserves selection provenance without history/exposure
writes. Verify navigation, rapid mode changes, focus updates and location races.

## 5. Verification and release — in progress
Run Go/web gates, independent review and real-client drives at 390×844 and
412×732 in dark/light, plus permissions, home restore, all-off, feedback
navigation/retry/success, reload/offline and service-worker update. Capture
built-client calibration frames; migrate contracts and close backlog. Build,
push and deploy using operations runbook, then verify production shell and
flow. Feedback synthetic submit/authenticated retrieval remains release gate.

## Verification record — 2026-09-06

- Go suite and race detector pass; web suite: 303/303.
- Independent review findings fixed: focus/candidate freshness stay separate,
  widening filters restores raw cached results, stale-source metadata survives
  navigation, and normal refresh resumes last-open bookkeeping after edits.
- Full Settings Chromium matrix passes at 390×844 and 412×732 in both schemes,
  including permissions, mode races, home restore, feedback and keyboard use.
  Seven Settings and eighteen affected Home calibration frames reviewed.
- Production amd64 image builds. Container health/static headers pass;
  explicit all-off returns 200 with no journeys; unsupported mode returns 400.
- Synthetic feedback POST returned 201, record
  `8df66404-ceff-47c1-a2a5-62c2a0072626`. Authenticated dashboard retrieval
  awaits owner confirmation; no authenticated browser surface is available.
  No `.env` was read. No production deployment has occurred.
- Controller lifecycle, Board/Detail smoke and service-worker-controlled
  offline reopen pass. A returning profile upgraded from shell-v30 to
  shell-v31, removed the old cache, cached all four new modules and matched
  current main.js byte-for-byte; Settings then reopened with the server off.
- Remaining: authenticated feedback retrieval, release and backlog closeout.
