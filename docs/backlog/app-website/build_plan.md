# App website build plan

**R9 A approved for commit, push and website deployment, 10 September 2026.**
The green dot, Sleepers header icon and complete iPhone Live Activity showcase are
consolidated in `comps/` and current site calibration. The owner subsequently requested the F1 retake immediately; both schemes
now contain fresh full-screen native captures with verified line dimming. Preserve earlier implementation
and icon assets; replace its superseded R6 composition when building. Do not
release or close this item before the gates below.

Approved 9 September 2026. Execute with `design.md`, `copy.md`, `comps/`,
`verification/` and `assets/comps/latest/site/`; no conversation is needed.
The owner approved continuing through implementation, verification and
public deployment. This replaces the obsolete pre-redesign rollout checklist.
Historical deployment hazards are retained at the end of `design.md`.

## Ownership and execution

Read AGENTS.md, docs/PROJECT.md, app-website/UI/analytics/client-storage
contracts and tools/README.md before implementation. Use backlog-item build
and close stages, user-facing-copy, and deploy-stack for deployment. The owner explicitly authorized committing, pushing and deploying the approved
website. The selected design is ported unchanged into the production package. Model defaults in the owner's supplied
AGENTS instructions override unavailable skill models: Sol for UI/review and
all computer use; Terra is suitable for mechanical isolated asset work.
Comments are rare and short, one line of why where the reason is non-obvious,
never narrating what the code does.

Record baseline git status/diffs before writing. This checkout contains other
native, widget, storage, feedback and tiny-train changes. Do not stage, revert
or ship those changes. Use explicit file/hunk ownership. Any released app
image must use a clean isolated source snapshot containing only its intended
release; website build context is already isolated to site/. Do not create
or move a user-owned Codex task without an explicit request.

Code and verification are separate waves. Keep independent native packaging
parallel with website work if resources allow; performance tests must not
compete with builds. Own all temporary browsers/simulators and clean them up.
Never read/source .env or secrets.env, print credentials, or change shared
authentication in an attempt to fix deployment. Follow actual deploy skill
requirements if sanctioned tools hit an access boundary.

## Phase 0 — approved handoff

- [x] Record selection of R9 A and the dot/header/Live Activity/recapture steers.
- [x] Consolidate refined A into comps/ and replace old site calibration with
  the selected full-page frames. Keep Sleepers master unchanged.
- [x] Preserve final prototype QA and native Live Activity image provenance.
- [x] Replace rejected standalone card with a complete iPhone screen for
  Chatswood → Bondi Junction via Martin Place; preserve route/capture fixture.

Gate: Sleepers PNG hash matches design.md; selected prototype has updated
192px/180px icons; no product implementation inferred from prototype checks.

## Phase 0a — native tracker material completed

- [x] Recaptured F1 Circular Quay → Manly at eight minutes into its 22-minute
  journey in both schemes. The travelled 8/22 segment is dimmed, the remaining
  segment retains its route colour, and 14 minutes remain.
- [x] Verified current native rendering. No product fix was necessary: the old
  R3 source lacked the travelled overlay; current clean UI sources include it.
- [x] Captured complete 1206×2622 native screens with saved trips, navigation
  and fixed example timestamps intact. No pixel repainting or CSS dimming.
- [x] Exported lossless WebPs and replaced tracker assets in `comps/assets/`,
  `site/assets/` and the selected preview. Decoded RGBA pixels match the PNGs
  exactly; evidence and native provenance are in `comps/native-f1-tracker/`.
- [x] Retained the complete native iPhone Live Activity screen for Chatswood →
  Bondi Junction via Martin Place, with recorded fixture and provenance.

Gate passed for image material: both F1 schemes visibly dim the travelled
segment and every active asset copy contains the verified new bytes. Preserve
these bytes through packaging; later layout or image exports must not restore
the rejected R3 screenshot. Production package verification remains in Phase 3.

## Phase 1 — website implementation

Owner files: site/index.html, site/privacy/index.html, site/support/index.html,
site/site.css, new site/site.js, site/assets/*, site/Dockerfile,
site/.dockerignore, site/nginx.conf.template, docs/contracts/app-website.md.

- [x] Port refined R9 A with clean CSS: complete proportional phones, paired
  departure/detail stages, green tracker stage with native iOS Live Activity,
  coherent privacy/support and final device CTA. Remove stale R6/R8 geometry.
- [x] Convert selected real screenshot material to lossless WebP; verify
  decoded pixels, intrinsic aspect ratios, scheme selection and lazy loading.
  Remove obsolete shipped assets only after checking their references.
- [x] Wire Sleepers site icons and the icon beside the header wordmark;
  restore green dot beside “Made for Sydney” on the homepage. Preserve44px
  home-link/navigation targets and narrow header fit.
- [x] Add progressive device CTA and accessible store dialog with real web
  fallback for no-JS/unknown/unsupported enhancement. No public APK action,
  coming-soon banner or invented store URL.
- [x] Port line-tap train, both 44px targets, keyboard/focus/repeat/cleanup and
  reduced-motion complete lead car. No remote resources, network or state.
- [x] Include external local site.js in image allowlist/COPY; allow only
  script-src self in CSP and preserve no-cache/no-transform/contact links.
- [x] Update website contract to actual copy/actions/JS/privacy behavior in
  the same change, including full screenshot presentation and new header.
  Preserve existing health/SEO/HTTPS metadata routes.

Seam: static HTML contains usable navigation and a working web anchor before
JS; script only enhances the current device CTA and local train. Missing or
unsupported enhancement cannot remove the usable anchor. Dialog focus is
restored; repeated train input cannot create another consist. Styles retain
real screenshot proportions and the final rail stacking behavior.

Gate: static reference/link/package validation plus one local smoke at
390×844; unit checks only for meaningful device/fallback/lifecycle behavior.
Do not build a test that merely repeats the markup. Keep empirical matrix in
Phase 3. Mark done only after resulting files are inspectable.

## Phase 2 — shared icon integration

Owner files: assets/brand/*, web/icons/*, web/manifest.webmanifest and icon
links only if needed, web/sw.js VERSION; iOS existing AppIcon assets under
ios/ILoveTrains/Resources/Assets.xcassets; Android existing launcher resources;
relevant UI/deviation contract identity notes. No unrelated source changes.

- [ ] Derive web sizes and platform-specific icon assets from locked Sleepers
  SVG/master. Preserve native corner masking and Android safe zones, and use
  existing resource references wherever possible.
- [ ] Bump worker VERSION for changed cached icon files without overwriting
  concurrent worker edits. Change no behavior in app screens or tiny-train.
- [ ] Update the icon identity contract and reproducible asset-generation
  path if the repo already has one; keep the vector as the canonical source.

Seam: every platform resolves the same approved motif at its existing icon
entry point. No corner mask baked into iOS source; Android adaptive icon is
verified under actual launcher clipping. Manifest/theme behavior stays valid.
Gate: generated asset metadata/hashes/reference checks, then native packaging
and renderer verification in Phase 4. Web returning-client check in Phase 3.

## Phase 3 — packaged website and web verification

Owner files: focused site verification tooling/tests only where reusable,
tools/README.md if adding an instrument, approved site calibration updates.
Scratch captures/reports stay in /tmp until final frames replace calibration.

- [x] Build/run actual site nginx container on an owned loopback port. Check
  /, /privacy/, /support/, health aliases, all assets, MIME/CSP/cache headers,
  mailto links and canonical/sitemap/robots metadata. Verify JS is packaged.
- [x] Real browser matrix: 320×740, 390×844, 412×732, 900×900, 1440×900, light
  and dark. Verify exact viewport, no overflow, loaded images, undistorted
  content, readable headings, footer reachability and no excessive gaps.
- [x] Device matrix: desktop, Android, iPhone, iPad UA, touch MacIntel iPadOS,
  ordinary desktop Mac and unknown/no-JS. Check real anchors and unsupported
  dialog fallback; click/open/Close/Escape, focus restoration and Tab order.
- [x] Real pointer and keyboard line activation at both ends; 44px hit targets,
  one consist for repeats, complete cleanup, reduced-motion visible full lead
  car at 320px, no console errors, network or storage writes from the action.
- [x] Inspect privacy/support public prose and email destinations, without
  adding headings or disclosures beyond approved facts unless code requires it.
- [ ] Run web unit suite and applicable icon/cache checks. Verify a cold and
  returning service-worker-controlled profile picks up new icon bytes; isolate
  known unrelated failures instead of altering their owner’s work.

Gate: packaged site matrix and flows pass; selected final screenshots compared
with approved calibration. Save final frames only, replace prior exemplar
rather than keeping rejected variants. Prototype evidence is guidance, not
proof of production packaging. Do not repeat unchanged matrices after docs.

## Phase 4 — native packaging and independent review

Owner files: isolated build outputs, only genuine icon resource fixes,
verification notes in this plan; review code wave with Sol before fixes.

- [ ] Run affected native build/test gates per AGENTS on final icon resources
  and inspect actual iOS SpringBoard plus Android launcher output. Reuse owned
  warm devices; do not touch another session’s device or install on owner phone.
- [ ] Use actual launcher masks for Android and iOS; no screenshot-only fake
  mask claim. Verify resource/catalog packaging and no icon clipping. Do not
  re-run application screenshot matrices for unchanged screens without cause.
- [ ] Independent review: selected layout/copy preserved, progressive fallback,
  CSP/package integrity, rail hit testing/reduced pixels, icon safe zones,
  no personal state/network, no unrelated staged changes. Fix concrete defects
  and rerun only the gates they invalidate.

Gate: review has no unresolved actionable defects; native asset builds and
actual renderer frames pass. Record pre-existing test failures with evidence
and whether they prevent this change. Native store publishing is out of scope:
there are no listings. Do not claim compiled resources are distributed apps.

## Phase 5 — release and public verification

Owner files: task-owned commits in trains_app; ../projects/stacks/ilovetrainsapp
image pin and necessary website-only infra docs; docs/operations/deploy.md.
Read deploy-stack and applicable infra instructions first.

- [x] Commit only approved task paths/hunks. Choose next unused numbered
  website version after checking current source/registry/infra; do not overwrite
  old 1.0.1 just because historical notes name it. Build from committed source.
- [x] Build/push explicit ilovetrainsapp target, update numbered infra pin,
  commit/push infra and use sanctioned deploy command. No secrets required.
- [x] Verify public HTTPS all pages/health/assets, actual deployed bytes/version,
  no-transform header, readable mailto destinations, absence of injected
  blocked email-decoding script/CSP errors. Drive real public phone and desktop.
- [ ] For PWA icon delivery, release only a clean isolated app snapshot with
  the intended icon/cache change using the app runbook. Do not inadvertently
  include unrelated native/client working-tree work. If existing coordinated
  release work owns this, record the safe handoff rather than claiming shipped.
- [x] Report website deployment separately from native artifact distribution.
  Never treat registry push or source push alone as proof of deployment.

Gate: public website exactly reflects the verified release; any deployment
access failure is stated explicitly with the action and actual reason. Inspect
old 401/email issue anew; do not modify shared authentication or read .env.
A real external access blocker does not justify undoing completed design/build.

## Phase 6 — closeout

- [ ] Migrate current durable website/icon rules into app-website/UI contracts
  and deploy runbook; retain only authoritative assets/calibration.
- [ ] Update ROADMAP references for this item without disturbing other work.
- [ ] Delete entire docs/backlog/app-website folder after deployment and all
  required work are complete. Backlog prototype/evidence/history is disposable.
- [ ] Final report: public URL, what changed, verification, source/infra release
  identifiers and exact remaining distribution/access limitations, if any.

Gate: no stale live references to deleted backlog paths; required work verified,
no unreported production mismatch, unrelated work preserved.

## Current release scope

The owner approved “commit, push, deploy” for the completed website. This
release packages only `site/` as website version 1.0.2. The main app remains on
its independent 1.6.0 release; no unrelated native or web-client behavior is
included in the website image. Native/PWA Sleepers artwork was committed in
427b27c; its independent distribution/launcher gates remain outside this
website release and must not be represented as completed by nginx checks.

## Website release verification — 10 September 2026

Source `78d5153d849f` is pushed to main. Website image `1.0.2` contains
linux/amd64 and linux/arm64 manifests with digest
`sha256:123f4f4bb68cf09f7bbbe5e69c94cc425b9c0e224edb4a70434e09db598c535c`.
Infra commit `28823e5` pins it; syd1 deployment job
`0c62b138ac0af9ebfb9b95bcdabc19a6` succeeded.

Packaged browser verification passed 18 page/size/scheme captures, 86 rail
interaction/lifecycle checks, eight device/fallback cases and six modal/focus
checks. Independent Sol review has no unresolved findings. Both modal
placements were driven with real pointer input after scrolling settled.
Public HTTPS verification matched all 21 checked pages/assets/health paths to
the committed source, with correct MIME, CSP, metadata and readable mailto
links. HTML retains no-cache/no-transform; Cloudflare applies four-hour caching
to static assets while retaining no-transform. All public asset bytes matched.
The full native launcher/PWA delivery gates above remain separate work.
