# Contract: App website

`https://ilovetrainsapp.jeremyvun.com/` is the public product website for
ilovetrains. It serves marketing, privacy and support independently of the
web app at `https://ilovetrains.jeremyvun.com/`.

## Public pages

- `/` introduces the app with real, illustrative client screenshots and one
  usable link to the web app. On Android and iOS, local enhancement relabels
  the primary action for Google Play or the App Store and adds a second `Use
  the web app` link. Until a public store listing exists, the store action
  opens a local availability dialog whose primary action is the real web link.
  There is no public APK action or invented store URL.
- `/privacy/` covers the website and all three app clients. It identifies
  Jeremy Vun as the privacy contact and links `Email about privacy` to
  `mailto:admin@jeremyvun.com`.
- `/support/` links `Email support` to `mailto:admin@jeremyvun.com`, gives
  problem-report guidance and states the local-data recovery limit.
- `/healthz` and `/health` are static HTTP 200 liveness responses.

The privacy policy changes with any relevant change to the analytics,
client-storage or API contracts. It covers device-held saved trips, history,
preferences, offline timetables and location; station-pair and requested-time
departure requests; brief server caching; hosting-provider IP and request
logs; anonymous web-app counts and Do Not Track; deliberate feedback and
service arrival timestamps; indefinite feedback retention and deletion by
contact; and the absence of cloud recovery. Counters' transmitted fields are
distinct from the service's arrival-time records.

The marketing site sends no analytics, cookies or personal state. Its device
check reads only browser user-agent, platform and touch-point values. It does
not store a profile or make a request. Serve `Cache-Control: no-cache,
no-transform` so Cloudflare preserves readable contact links instead of
injecting email-decoding markup that the site's CSP blocks.

## Actions and local interaction

The unenhanced landing page, unknown devices, desktop browsers and unsupported
dialog implementations keep an ordinary `Open the web app` anchor. JavaScript
may enhance that anchor only after all required dialog markup and APIs exist.
Android uses `Get it on Google Play`; iPhone, iPod, iPad and touch-capable
`MacIntel` use `Download on the App Store`. An ordinary desktop Mac remains on
the web action. The dialog supports its link, Close, Escape, modal focus and
focus return to the store action.

The continuous orange, teal, green and red line behind the hero has transparent
44×44px buttons at both ends, each named `Run a train along the coloured line`.
Pointer, Enter and Space start one six-car train. Further activation is ignored
until cleanup at 2750ms. Reduced motion shows only the complete stationary lead
car and cleans it up at 900ms. Preference changes and page exit safely clear the
current train. The interaction uses no audio, network, analytics or storage.

## Presentation and identity

The site uses static HTML and CSS, one local enhancement script, local assets
and system fonts. The CSP allows only same-origin images, styles and scripts;
all other default sources remain closed. Privacy, support and navigation work
without JavaScript. The app's dark ground `#0A0B0D`, light paper `#FAF9F5`,
primary ink and transport colours carry through to phone and desktop layouts in
both system colour schemes. The header keeps the plain uppercase `ilovetrains`
wordmark.

Real iOS simulator screenshots are served in the matching colour scheme and
must not be redrawn as invented app UI. The hero shows Parramatta to Central;
the tracker shows the F1 ferry from Circular Quay to Manly; the board and
journey-detail examples retain their captured routes. The public WebP copies
use lossless encoding and decode to the source pixels. HTML `picture` selects
the scheme, and below-fold screenshots load lazily. Screenshot widths retain
`height: auto`; crop windows may reposition them but never stretch them. Every
screenshot retains its 1206×2622 intrinsic dimensions.

The selected icon is the four-colour Sleepers railway motif. Its canonical
vector and opaque unmasked 1024×1024 export live under `assets/brand/`. Site,
PWA, iOS and Android launcher artwork derives from that source. Platform launchers
apply their own corner or adaptive masks; the iOS source has no baked mask, and
the Android foreground keeps the approved safe area. Final website and native
renderer calibration lives under `assets/comps/latest/site/`.

## Operations and review

The independent nginx image is built with the explicit `ilovetrainsapp` target
in `docker-bake.hcl`. The default target still builds only the train app. Its
build context is `site/`; native work and API secrets cannot enter the image.
The infra `ilovetrainsapp` stack runs on `syd1` through the shared Caddy edge,
without secrets, volumes or a host port. Infra pins a numbered image tag so Git
names the deployed website release.

Before release, verify all three pages from the packaged nginx image on phone,
tablet and desktop in both schemes, with loaded undistorted images, no horizontal
overflow, visible keyboard focus and reachable footer links. Check desktop,
Android, iPhone, iPad, touch Mac, desktop Mac, unknown and no-JavaScript action
paths. Drive both rail targets with pointer and keyboard, including reduced
motion, repeat suppression and cleanup. After deployment, repeat public HTTPS,
health, navigation, asset, header, readable-email and console checks against the
deployed bytes. See [deployment](../operations/deploy.md).

The public URLs are suitable for the marketing, privacy and support URL fields.
Native store distribution remains a separate release process. Relevant
references: [Apple app review](https://developer.apple.com/app-store/review/)
and [Google Play user-data policy](https://support.google.com/googleplay/android-developer/answer/10144311).
