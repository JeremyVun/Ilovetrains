# App website redesign

Status: **R9 A selected; full-phone Live Activity refinement ready for review, 10 September 2026**.

## Current instruction: retake the F1 in-app tracker now

Owner: “retake the curcular quay to manly wharf follow your trip screen.”
This brings the previously deferred native screenshot task into the current
pass. Recapture the real iOS F1 screen in both schemes, verify dimming behind
the progress marker, and replace active website/comp image assets. Preserve
the selected layout and the separate Chatswood → Bondi Junction Live Activity.

## Latest steer: show the Live Activity on a phone

Owner: “not happy with that live tracker screen being cut / cropped out of a
source image and displayed like that. It should be showcased on a phone
screen, not by itself”; replace Kellyville with “a high traffic route with a
transfer”. The standalone ActivityKit card presentation is rejected. Use a
complete real iPhone system screenshot inside a proportional phone frame.
Keep the selected A composition and its other full app screenshots.

The chosen example is Chatswood → Bondi Junction: M1 to Martin Place,
then T4. NSW commuting guidance confirms the interchange. The bundled TfNSW
timetable supplies a real 10 September 2026 journey: 08:22:07 Chatswood
platform 2 → 08:32:37 Martin Place platform 3; 08:37 Martin Place platform 2
→ 08:45 Bondi Junction platform 1. A fixed 08:28 preview clock shows the
approaching change (the native countdown rounds the remaining 4m37s). This is a recognisable corridor choice, not a measured
claim about this exact origin–destination pair's patronage. Route source and
synthetic clock are recorded in the workshop's route-source JSON.

The refined preview is `http://127.0.0.1:54891/a/#follow`. Complete native
ActivityKit and F1 app phones share the green desktop stage and stack on
mobile. Root and designer inspected desktop and phone captures. Source
`58193d5cc9c861a3d1d7906fd87f2a61c6b770e0b3b28cbdf3b3070830b5504a`
passed bounded 390×844 dark, 1440×900 light and 320×740 dark checks, with
correct image ratios, decoding and reachable content. Prior unchanged hero,
header, privacy/support and interaction evidence remains applicable.

The native full-screen PNG is unchanged, SHA256
`baeeed8aee518f38af40594cdf1d5f246e25521a5d91a3c1b0fd5af5b3c81ff6`.
Its simulator time override displays 08:28 but leaves “Sat 1 Jan” as the
visual date. This fixture artifact is recorded in
`comps/native-live-activity/`; it is not live website travel data. Both site
schemes reuse the same real system screen. No native product code was edited.

The existing F1 in-app screenshot still requires the separate dimmed-line
verification and recapture during the build. This steer does not reopen the
hero, icon, copy or other selected A decisions.

## Current verdict: A selected, with final steers

Owner: “yea, (a) looks best.” Preserve R9 A's complete screenshot presentation,
type, softly coloured feature stages and page composition. Final steers:

- Restore the green live dot beside “Made for Sydney”, as on the public site.
- Add the selected Sleepers app icon beside ilovetrains in the header.
- Showcase the live tracker, preferring the iOS presentation. Use actual native
  Live Activity material, not a redrawn or invented system surface.
- Retake the “Follow your trip” screenshot during the build: the existing
  screenshot has a bug where the trip line behind the progress tracker is not
  dimmed. The final website must not ship that capture. Verify the native fix
  first, then recapture light/dark from the real app without repainting pixels.

These steers supersede the earlier plain-wordmark-only rule and close the
three-way R9 composition choice. The native screenshot repair is explicitly a
later build task; do not silently present the old image as fixed in comps.

## Latest ruling: discard round 8 and rethink from the ground up

Owner: “round 8 is complete crap. Even the current live site at
ilovetrainsapp.jeremyvun.com is better than this. The only good thing is the
hero image design, but even this you fucked up by squishing it. Rethink from
the ground up. get it right, make the website beautiful”.

All R8 compositions and their recommendation are rejected. Round 9 starts
from the actual public site as the minimum visual baseline, with new visual
direction across the full page. The hero's appeal survives, but its current
geometry is explicitly open for repair; do not preserve the squished frame
under a frozen-hero rule. Preserve the product facts, selected Sleepers icon,
mixed saved trips, device CTA behavior and restrained four-colour motif.
Layout, typography, screenshot presentation and section structure are open.
Use `/tmp/trains-comps-site-r9`; Astra designs, Sol captures and measures.
Show full mobile and desktop compositions, and judge aesthetic quality
against the live site, not merely overflow checks or reduced page height.

The owner added: “app screenshots are important to show users what the app
looks and feels like”. Real, recognisable app screenshots are central to
the redesign. Preserve their proportions and enough screen context to show
the interface; do not reduce them to loose UI fragments or hide the key
screens behind the rejected gallery controls.

R9 baseline captures: `/tmp/trains-comps-site-r9/live-baseline/`. Actual public
landing, privacy and support were captured at 390×844 dark and 1440×900 light
with real scrolling. R8's hero image retained its bitmap ratio but sat in a
frame roughly 16–17% shorter than the screenshot, cutting away native context.
R9 uses flowing, full-aspect screenshots inside correctly proportioned devices.

The active R9 direction A uses larger complete screenshots, paired departure
and transfer scenes, and a separate full tracker scene. Root reviewed all
three first-pass desktop compositions and A's mobile hero/features. Refinement
removes A's unnecessary hero backdrop, loosens crowded heading spacing,
enlarges the screenshots and aligns the paired devices. The continuous hero
line remains. B's louder poster treatment and C's desktop triptych remain
alternatives; none is approved. Direct preview: http://127.0.0.1:54891/a/.

Refined A is now presented for review. It retains all four real screens at
their full intrinsic aspect ratio, including the pin action and saved-trip
navigation. Root inspected mobile hero/features/tracker, desktop full page,
desktop privacy and mobile support. The final refinements also remove the
redundant support return link and correct mobile caption alignment. All eight
WebP assets remain byte-identical to the captured source. The final responsive
matrix is recorded under the R9 workshop's `verification/`. All three landing
directions have 320×740, 390×844, 412×732, 900×900 and 1440×900 captures in both
schemes. Root checked all 30 reports: no image distortion, document overflow,
text spill or undersized controls. A tablet rail-end clipping defect was fixed
and its affected frames refreshed; unchanged frames retain their original
source hashes with the targeted CSS change documented. A privacy/support have
primary phone/desktop captures. No new composition verdict has been received.

## Latest owner ruling: redesign the rest of the website

After the build's scroll lock was fixed, the owner said: “now that I can
scroll and see the rest of the site … the rest of the site doesn't look good
at all. redesign it please. make it beautiful”. This supersedes approval of
the below-fold composition. Preserve the current working implementation and
Sleepers assets, but do not release it or close this backlog.

Round 8 will rethink the page below the hero: composition, image presentation,
typography, pacing and the final call to action. Carry a coherent treatment
through privacy/support. The hero direction, Sleepers icon, real journey
material, concise factual copy, device CTA behavior and line-tap interaction
remain fixed unless the owner steers them. The full scrollable desktop and
mobile pages must reach the owner before the next build verdict; a hero-only
frame is not approval of the rest of the page.

The build preview is http://127.0.0.1:54771/. The old body `overflow:hidden`
rule prevented user scrolling, despite programmatic screenshot captures.
It was removed and real wheel input reached the footer. Every subsequent comp
and build must verify input-driven scrolling, not just scrollTo/document size.

The previous approval and implementation specification below is historical
where this ruling changes composition. Preserve its behavioral constraints.

Round-8 workshop: `/tmp/trains-comps-site-r8`. Rejected-build full-page
references are `/tmp/trains-site-rejected-build-reference/` at 390×844 dark
and 1440×900 light, with real wheel-to-footer evidence. Root inspected both.
Observed problems: isolated screenshot windows and weak continuity; tracker
framing looks like a severed phone; mobile board/detail cuts through meaningful
rows/itinerary; awkward black borders/positioning on desktop; sparse ending
without a strong acquisition action. These are diagnosis, not dictated new
geometry. Compare three distinct full compositions and show their new sections
and footer prominently before asking for a verdict.

Build checkpoint preserved: production port and Sleepers assets are uncommitted;
canonical app version 1.5.1/iOS marketing version and SW v56 are reserved local
changes, not releases. No files were staged, no source/infra/registry push or
deploy call occurred. Candidate website tag 1.0.2 remains unused. Local
`ilovetrainsapp-qa` at 54771 is the rejected-build reference, rebuilt for the
scroll fix but predating the final 192/180 favicon copies. All eight WebP
conversions are pixel-equivalent; nginx static/package checks and native
resource compilation passed. Full browser matrix and native build/launcher
gates stopped at the owner's redesign steer. Resume them only for final new
sources. Do not discard or ship the other task's unrelated dirty client work.

### Round 8 comparison, 9 September 2026 — rejected in full

The owner confirmed delegated comps are acceptable “as long as astra is doing
the design comps”. Astra at xhigh owns the design; Sol handles browser capture
and input verification. The comparison is http://127.0.0.1:54881/ with its
report at `/tmp/trains-comps-site-r8/OPTIONS.md`.

A presents complete app views in an open spread; B joins them in a staggered
composition; C selects among Departures, Journey detail and Travel tracker in
one large app surface. C was recommended and then rejected with all of R8.
Its phone page is 2670 CSS px tall versus A's 3588 and B's 3354 at 390px wide.
The tradeoff is that the reader selects the other two views; without JavaScript
they appear in a stack. Each direction preserves complete meaningful content,
adds a final device CTA with a web alternative, and retains the chosen hero.
Primary full-page, below-hero and footer captures use 390×844 dark and
1440×900 light at 2×. Real touch/wheel input reached all three footers.

Product integration, authoritative exemplar replacement and release remain
paused until the owner rules on the new full-page composition.

## Outcome and scope

Rebuild the independent public website at
https://ilovetrainsapp.jeremyvun.com from selected R9 A and the owner's final
header/Live Activity steers. Improve phone spacing, readable screenshots, public copy and device
CTAs. Adopt the selected four-colour Sleepers app icon. The actual trip-planning
app at https://ilovetrains.jeremyvun.com keeps its existing screen design and
behavior; its icon assets change alongside native launcher assets. The one
additional native prerequisite is verifying/fixing the tracker line dimming
before recapturing the website's illustrative F1 screenshot.

The selected reference is consolidated in `comps/`, with normalized page
routes, `r9.css`, `site.js`, `r9.js` and real image material. It matches refined
R9 A at `/tmp/trains-comps-site-r9/a/`. Current full-page and header/tracker
calibration is in `assets/comps/latest/site/`; superseded R6 material has been
replaced. Final bounded verification is in `verification/refinement/`.
The exact icon master is `assets/brand/sleepers.svg` and `sleepers-1024.png`.

## Owner rulings

- The original desktop page was acceptable but mobile was unattractive:
  excessive gaps and oversized copy, small/offset screenshots and a huge red
  privacy panel. A from round 3 was selected, then consolidated in round 6.
- Hero journey is **Parramatta → Central**, reversing the original direction.
  The saved list includes train, metro, ferry and a transfer journey. Circular
  Quay → Manly is the iconic tracker example, not the hero's next trip.
- No public Android APK button or “App Store and Google Play coming soon”
  banner. APK downloads are for the owner's testing. Device primary CTA:
  desktop web, Android Google Play, iOS App Store; native stores unavailable
  for now. The reviewed local dialog plus working web fallback is the chosen
  temporary store behavior, with no invented listing URL.
- Rewrite privacy/support in short public language. No operator biography as
  subtitle, “email Jeremy Vun” action, literal “[email protected]”, or a heading
  per paragraph. Preserve factual disclosures and a contact line.
- Preserve the **continuous four-colour background line behind the hero**.
  The short rounded separated orange/teal/green/red bars from r3 are restrained
  accents at the tracker and once in each document heading, not everywhere.
- Trigger the train by tapping the line itself. No separate arrow or circle.
- Icon sequence: diagonal arrow looked crossed out; junction too abstract;
  front train too grey; all little-cab ideas dropped. Icon redesign remained
  wanted. Final owner: “T looks great … it may be too abstract. So Sleepers is
  probably best.” Assistant agreed on railway recognition, then owner approved
  proceeding. **Sleepers is selected without further geometry changes.**
- Keep the uppercase ilovetrains wordmark and add the selected Sleepers icon
  beside it in the header, per the latest owner steer. Restore the green dot
  beside “Made for Sydney”. Do not redesign the selected icon.

## Composition and material

Use selected R9 A and its consolidated header/Live Activity refinement as the
visual contract. System fonts, stronger headings, dark #0a0b0d and light
#faf9f5 grounds, quiet coloured feature stages and original transport colours.
The hero is a complete proportional phone above the continuous four-colour
line. Departures/detail are paired on desktop and stacked on mobile; the
tracker has its own green stage. All four full app screenshots appear through
ordinary scrolling, with navigation and actions intact. Keep image intrinsic
dimensions 1206×2622, width responsive and height automatic. No fixed-height
phone masks, translateY crops, stretching or repainted pixels. Do not restore
the rejected R8 gallery or detached UI fragments.

The hero uses real SwiftUI captures `hero-{dark,light}.png`: T1 Parramatta
08:34 → Central 08:59, Platform 1, Hornsby via Gordon, at example app time
08:31. Saved trips are T1 Parramatta → Central; M1 Tallawong → Chatswood;
F1 Circular Quay → Manly Wharf; T9/T4 Rhodes → Bondi Junction via Town Hall.
The board uses the corresponding inbound journey, and detail is the real
Rhodes → Bondi Junction transfer screen. The F1 active tracker capture shows
Circular Quay 15:45 Wharf 3 Side A → Manly 16:07, eight minutes into the trip.
These are illustrative captures, never live marketing data. The current F1
image is a temporary comp asset: its travelled line is not dimmed. Before
release, verify the native `.travelled` overlay and its stacking in
`ios/ILoveTrains/UI/Common.swift` / `JourneyAxisLayout.swift`, fixing only if
still broken, and retake both schemes from the real app. These files already
contain unrelated working changes; preserve their ownership and do not assume
a new native edit is required just because the old screenshot is wrong.

Showcase the actual iOS Live Activity on a complete iPhone system screen,
alongside the full F1 app tracker phone. The selected example is Chatswood →
Bondi Junction with an M1/T4 transfer at Martin Place, using the timetable
values and fixed preview clock recorded above. Capture from the native system
renderer, clear unrelated notifications through the real UI and preserve the
whole screenshot. No standalone card crops or Kellyville example. Two
proportional phones share the desktop stage and stack legibly on narrow
screens. Preserve the distinction between Notification Center capture
provenance and claims about an actually locked device or continuously
advancing instructions.

Inbound images came from `/tmp/trains-site-material-r4/output`; their scheduled
morning response came from `/tmp/trains-site-material-r4/source/parramatta-central-0830.json`.
Estimated times were null; the board says Scheduled. The hero's LIVE badge is
an existing native freshness display in the capture, not invented realtime.
F1 captures came from `/tmp/trains-site-material-r3/output`. The selected image
bytes are bundled in `comps/assets/`, so the build does not need temporary
capture tools or an API key. Convert screenshots to lossless WebP for the site
and verify decoded pixel equivalence. Below-fold pictures may load lazily.

## Copy and acquisition actions

`copy.md` is the approved public prose; selected HTML is the layout reference.
Desktop and unknown devices get a real anchor to
https://ilovetrains.jeremyvun.com, labelled “Open the web app”. Enhancement
runs locally without storage or a request. Android UA selects “Get it on
Google Play”; iPhone/iPod/iPad selects “Download on the App Store”. Handle
MacIntel with multiple touch points as iPadOS; desktop Mac remains web.
Do not claim this heuristic identifies a device with certainty.

On native devices, retain “Use the web app” as a second real anchor. Until
store URLs exist, activating the primary opens the reviewed native dialog
with the copy in `copy.md`, “Open the web app” and “Close”. Support Escape,
modal focus, return focus and keyboard activation. No invented external URL.
With JavaScript disabled, unsupported dialog API, missing markup or unknown
device, preserve the working web link. Never block navigation merely because
enhancement failed. Static privacy/support and navigation need no JavaScript.

Email links are readable “Email support” / “Email about privacy”, both
`mailto:admin@jeremyvun.com`. Operator appears once at the end of privacy.
The policy retains device storage/location, station-pair/time API requests,
short server caching, hosting/IP logs, anonymous web counts and DNT,
explicit feedback plus service arrival timestamps, indefinite feedback
retention/deletion by contact, and no cloud recovery. The site itself sends
no analytics, cookies or persistent state.

## Line interaction

Use the existing app tiny-train design embodied in the selected prototype:
one six-car train travels across the hero background line in about 2.6s;
cleanup at 2750ms. Repeat activation while running is ignored. No audio,
network, analytics or storage. This is a site-local easter egg, independent
of app feature flags and product train code.

Expose both ends through transparent 44×44px buttons with the accessible name
“Run a train along the coloured line”. The line itself is visible; there is
no arrow/pill/circle control. Space, Enter, pointer and visible keyboard focus
work. At narrow widths invisible target padding may overlap the static image
margin; it must not intercept an actual link or add visible chrome.

Reduced motion displays only the stationary lead car, then cleans up at 900ms.
At 320px it is 30.08×16.92 CSS px and visibly complete, including yellow nose.
The hero line must not create an isolated stacking context.
Background line and normal train stay behind phone
z1; only the reduced stage rises to z2. Keep this behavior when simplifying
CSS. A bounding-box assertion did not catch the earlier clipped car; inspect
actual pixels as well. Cleanup must tolerate navigation and preference changes.

## Sleepers asset contract

Master PNG SHA-256:
`4b21719de7dbb39e7398aed436215530a131925223d9ab77b71b85069ce7c218`.
It is an opaque 1024×1024 square on #0a0b0d, four rounded orange/teal/green/red
sleepers with two white rails. No baked-in system corner mask. Derive sizes
from the SVG/master, not screenshots. Keep existing platform icon plumbing
and documented safe zones; inspect actual iOS and Android renderer output.
Do not alter the drawing to produce a new concept during integration.

Update site favicons/touch icon, PWA icons/manifest references as appropriate,
and existing iOS AppIcon/Android launcher asset sets. PWA icon files are in
`web/sw.js`'s SHELL: bump the worker VERSION and follow returning-client cache
verification. Android adaptive/round masks need empirical inspection. Do not
modify app screens, routing, widget artwork, privacy-sensitive behavior or
unrelated client work for this icon change.

## Build seams and verification

The working website contract already records local JS and device CTAs; its
plain-header and screenshot-crop rules need the new visual amendments. Update
`docs/contracts/app-website.md` in the same implementation. Preserve `script-src 'self'`,
keep restrictive other directives and `no-cache, no-transform`. Package the
local JS in both Dockerfile and `.dockerignore`; no inline handlers or CDN.
Default image bake still targets the app; use explicit `ilovetrainsapp` for
this independent website release.

Prototype evidence in `verification/`: layout matrix at 320×740, 390×844,
412×732, 900×900, 1440×900 in both schemes; image aspect ratio and no overflow.
Final rail checks: **82 pass / 0 fail**, real pointer/keyboard, 44px hit tests,
repeat/cleanup, reduced pixels and no network/storage. R4's unchanged CTA
matrix passed 78 checks (original `/tmp/trains-site-qa-r4`); production checks
must rerun against the actual packaged site rather than treating prototype
results as a release gate. See build plan for focused production coverage.

Sleepers was installed with the original/T/ring on an isolated iPhone 16 Pro,
iOS 26.4. Root inspected clean real SpringBoard masks and launcher readability.
The selected crop is in `assets/comps/latest/site/sleepers-springboard.png`;
full evidence `/tmp/trains-site-icons-r7/os/all-four-springboard-v2.png`.
The verifier removed its owned simulator. R9 changed only workshop sources;
the earlier production port remains preserved and superseded. Current preview:
http://127.0.0.1:54891/a/.

## Deployment history to verify, not assume

The pre-redesign website was already live. Earlier notes report source
`3585d77`, infra `86df3f9`, published site 1.0.1 with digest
`sha256:5aebf81f42efbca66337eb7a1a327e77294d7026776b111813b13bb6a58efa87`,
but production still ran 1.0.0. Cloudflare obfuscated email and its injected
script violated CSP. 1.0.1 added no-transform. Deploy endpoint later returned
401 despite active OIDC tokens. This is historical, not a current probe.
Recheck through the sanctioned deploy tools; do not assume either success or
continuing failure. No shared authentication change is authorized by this
redesign. Never read/source `.env` or print credentials. Follow deploy-stack
for any exceptional host access; earlier SSH permission was not granted.

Many pre-existing uncommitted native/client changes belong to other work.
Inventory first, stage only owned paths/hunks, and release from a clean
snapshot containing approved changes only. Do not deploy that unrelated
working tree as part of an icon update. Publish the website independently;
report native distribution and any separately required app release honestly.
