# Contract: App website

`https://ilovetrainsapp.jeremyvun.com/` is the public product website for
ilovetrains. It serves marketing, privacy and support independently of the
web app at `https://ilovetrains.jeremyvun.com/`.

## Public pages

- `/`: a screenshot-led introduction, a working web-app link and Android APK
  link. App Store and Google Play are marked coming soon until real public
  listing URLs are available. Never present an unavailable listing as a
  working download.
- `/privacy/`: policy covering the website and all three app clients,
  identifying Jeremy Vun and `admin@jeremyvun.com`. Covers device storage,
  location permissions, online departure requests, anonymous web counters,
  deliberate feedback, hosting connections, retention and deletion.
- `/support/`: direct email contact, problem-report guidance and local-data
  recovery limitations. No login or form service is required.
- `/healthz` and `/health`: static HTTP 200 liveness responses.

The privacy policy must change with any relevant change to the analytics,
client-storage or API contracts. Counters' transmitted fields are distinct
from the analytics service's arrival-time records. Feedback has no automatic
expiry; the operator can delete it. The marketing site sends no analytics.

## Presentation

Static HTML and CSS under `site/`, with local assets and system fonts. No
runtime JavaScript, service worker, account, database or application cookies.
The app's dark ground `#0A0B0D`, light paper `#FAF9F5`, primary ink and
transport-line colours carry through to the site. Large website headings
extend the app's scale; document labels use secondary ink for readable
contrast. Phone and desktop layouts support both system colour schemes.

Real iOS simulator screenshots come from `tools/baselines/ios/`, with seeded
example journeys, and are served in the matching scheme. They must not be
redrawn as invented app UI. Website imagery is illustrative, never live data.
`home`, `board` and `detail` map to the same-named baselines; website `-dark`
maps to the unsuffixed baseline and `-light` to its light variant. The public
WebP copies use `cwebp -lossless -m 6`, preserving the original pixels.
HTML `picture` selects the scheme, and below-fold screenshots load lazily.
Responsive screenshot widths retain `height: auto`; cropping is done by the
containing window, never by stretching the image. Check displayed content
aspect ratios as well as natural dimensions.
Final calibration frames live under `assets/comps/latest/site/`.

## Operations and review

The independent nginx image is built with the explicit `ilovetrainsapp`
target in `docker-bake.hcl`. The default target still builds only the train
app. Its build context is `site/`; native work and API secrets cannot enter
the image. The infra `ilovetrainsapp` stack runs on `syd1` through the shared
Caddy edge, without secrets, volumes or a host port.

Verify all three pages on phone and desktop in both schemes, with loaded
images, no horizontal overflow, visible keyboard focus and reachable footer
links. Include a tablet width between phone and desktop layouts. Scroll
captures must wait for the actual document end; smooth-scroll intermediate
frames are not bottom-of-page evidence. Verify the actual nginx container and then public HTTPS, health and
navigation after deployment. See [deployment](../operations/deploy.md).

The public URLs are suitable for the marketing, privacy and support URL
fields. Store metadata and required links inside each native app remain
part of that app's submission process. Relevant references:
[Apple app review](https://developer.apple.com/app-store/review/) and
[Google Play user-data policy](https://support.google.com/googleplay/android-developer/answer/10144311).
