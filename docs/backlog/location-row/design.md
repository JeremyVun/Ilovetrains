# Settings: the Use location row reflects the phone's permission

Opened 2026-09-07 from the owner's iOS screenshot (`comps/owner-ios-settings-complaint.png`).
Comps round 1 ran the same day; the owner ruled on the direction, the copy, the
granted-state mark and the scope the same day. No open questions remain; the
item is ready to build in a fresh context.

## What and why

Settings has a `Use location` row whose mark reads `✓ ON` or `○ OFF` and whose
tap flips an app preference. The OS permission is a separate thing, so when the
preference is on but the phone has not answered, a second strip appears under
the row with the only control that actually asks (`Allow location to show
nearby trips.` + `USE MY LOCATION` on iOS; `Location is on, but this phone
hasn't decided whether to allow it.` on web and Android). The owner's words:

1. "On Android and iOS, the 'Allow location to show nearby trips. Use my
   location' appears as a separate row underneath the Use location [row], even
   though it says ON. I don't think this is a good UI/UX."
2. "Can we not have the Use location settings row itself reflect whether
   location permissions have been enabled, and allow the user to enable them?"
3. "I'd like to make sure the option we implement is good."

The strip is 52px, nearly half the Personal block, and the only reason Settings
scrolls on the owner's 412×732 phone. On the phones it is reached from three
edge states only (a fresh install whose preference defaults to on with setup's
location row never tapped, an iOS "Allow Once" after relaunch, an Android
dialog dismissed without answering), and the first of those is the first
impression of a new install.

This item deletes the strip on every client. The row's mark names the next
action and its subtitle carries the state, so the row stops arguing with itself.

## As built today (verified against the repo, 2026-09-07)

- **Web** (`web/js/settings.js`, `personal()`). Row `data-act="toggle-location"`
  with `aria-pressed` = preference; mark `stateMark(prefs.useLocation)`;
  subtitle from preference × `permission` (`granted` / `prompt` / `denied`,
  read through `ctx.permission()`). Toggling on when permission is `prompt`
  calls `ctx.requestLocation()` and repaints with the answer. A
  `.st-location-note` strip appears for `prompt` (with `data-act="request-location"`)
  and for `denied` (`Blocked in browser` + `Allow location in your browser or
  installed-app settings.`). `base.css` colours the mark `--ink` only while
  `aria-pressed="true"`; otherwise `--ink-2`.
- **iOS** (`SettingsView.swift`, `SettingsMain`). `personalRow` with `locationValue`
  and the `✓  On` / `○  Off` mark; tap `setUseLocation(!useLocation)`, which on
  enable calls `requestLocation()` → `location.request(prompt: true)`. That
  call already opens `UIApplication.openSettingsURLString` when the status is
  `.denied` or `.restricted`, and otherwise requests When In Use. The strip is
  an `HStack` shown when `useLocation && !locationGranted && !locationDenied`.
  `locationDenied` = `.denied || .restricted`.
- **Android** (`UiSettings.kt`, `SettingsMain`; `MainActivity.kt`).
  `SettingsPersonalRow` with the same four subtitles and mark. `onLocationRequest`
  opens `ACTION_APPLICATION_DETAILS_SETTINGS` only when the app has asked before
  **and** `shouldShowRequestPermissionRationale` is false; otherwise it launches
  the permission dialog again. But `locationDenied` is set to `asked && !granted`
  in `onResume` and to `!granted` in the launcher callback, so after one soft
  "Don't allow" the state says denied while the tap would show the dialog. The
  strip is a `Row` shown for `useLocation && !granted && !denied`.
- **Contracts.** `docs/contracts/ui.md` Settings: "Location is an app preference,
  distinct from browser permission ... A deliberate location action is available
  when browser permission still awaits a choice." `android-deviations.md`
  records `Blocked in Android settings` and the 72dp rows; `ios-deviations.md`
  records `Blocked in Settings` and that a deliberate action can open the app's
  iOS Settings page.
- **Instruments.** `tools/check-settings-browser.js` `permission-prompt` asserts
  the text `Permission not decided` and a `[data-act="request-location"]`
  element; `permission-denied` asserts `Blocked in browser`.
  `tools/visual-regression.js` shoots `settings`, `settings-light` and
  `settings-412` on all three clients. `web/js/settings.js` and `web/app.css`
  are in `web/sw.js`'s `SHELL`.
- **Analytics.** No event covers the Settings location row; none is added.

## Comps round 1 (2026-09-07)

Workshop `/tmp/trains-comps-location-row-r1` (sheet `index.html`, report
`OPTIONS.md`, own instrument `measure.js`); the durable frames are in `comps/`.
Five full-screen concepts at 390×844, 412×732 and 360×780, dark and light, in
the four states plus `wide` (`Blocked in Android settings`), `widest` (the
longest drafted subtitle) and `longhome` stresses: c0 today, c1 the mark is the
verb, c2 two targets in one row, c3 the quiet row, c4 the permission is the
setting. Copy came from three Codex sets (`comps/copy-sets.md`) and shipped
strings only.

Findings that outranked taste: every proposal removes the 412×732 scroll; no
concept overflows, no lockup invades, no target is under 44px; the mark's
contrast clears AA in both inks (8.0:1 at `--ink-2`, 18:1 at `--ink`), so
hierarchy, not contrast, decides its colour; a verb mark costs the subtitle
60–80px and only c2 wraps at 360; `OPEN SETTINGS` cannot work on the web
because no browser API opens site settings.

Owner rulings, verbatim from the verdict questions:

- Direction: **"c1, the mark is the verb"**. Refused: c2 (Off always one tap,
  but a pinned 133px mark column wraps three of four subtitles at 360), c3
  (keeps `✓ ON`; the row never says a tap will ask), c4 (drops the app
  preference; a contract change on every client and an unverdicted row title).
- Copy: **"Set A"**.
- Granted state: **"TURN OFF, verb everywhere"** over a glanceable `✓ ON`.
- Scope: **"All three clients"**, with the web's blocked state as the one
  recorded deviation.

`comps/c1-verb-390x844-ask.png` is the calibration exemplar; the four
`comps/zoom-row-c1-verb-*.png` clips are the row in each state at 4×.

## The design

One row, one target, four states. The subtitle is the state; the mark is what
the tap does. Nothing else on Settings changes.

| preference | phone permission | subtitle | mark | tap |
|---|---|---|---|---|
| off | any | Location is not used | `TURN ON` | turn the preference on, then ask the phone (as today) |
| on | not decided | Location needs permission | `ALLOW` | show the system permission sheet |
| on | denied | Location is blocked | `OPEN SETTINGS ›` | open the app's page in the system settings |
| on | granted | Nearby trips use location | `TURN OFF` | turn the preference off (as today) |

Web blocked state: subtitle `Blocked in browser` (existing string, still in
`--warn`), mark `TURN OFF`, tap turns the preference off. The web strip for
`denied` is deleted along with the `prompt` one; the sentence about browser
settings goes with it.

Rules that fell out of the comps and the code:

- **Mark ink.** The mark is an action in every state, so it is `--ink` (iOS
  `colors.ink`, Android `c.ink`) in every state. The `aria-pressed`-only ink
  rule in `app.css` is replaced, not extended. The subtitle for the denied state
  stays `--warn` on every client as today.
- **Chevron.** Only `OPEN SETTINGS ›` carries the `next` chevron. Its meaning
  widens from "goes to a subpage" to "leaves this screen"; `ALLOW` has none
  because the sheet is modal and returns.
- **Row geometry is unchanged**: web 56px minimum, Android 72dp, iOS as
  today; the row must not change height between states. The subtitle may wrap
  at 360 wide but must not push the mark or the row height; the widest legal
  pair is `Location needs permission` beside `ALLOW` and `Location is blocked`
  beside `OPEN SETTINGS ›`. Nothing invaded at any frame in the comps.
- **Blocked means the phone will not ask again.** iOS: `.denied` or
  `.restricted` (as today). Android: `locationAsked && !granted &&
  !shouldShowRequestPermissionRationale(ACCESS_COARSE_LOCATION)`; a soft
  "Don't allow" or a dismissed dialog leaves the row in the not-decided state,
  whose tap shows the dialog again. The existing `locationAsked` flag is recorded only after a non-empty
  permission result, rather than before launch. A dismissed first dialog has
  no answer and can still be shown, despite a false rationale flag. The same
  blocked rule drives resume, callback and the request action in `MainActivity`. Web: `permission === 'denied'`.
- **Ask and open-settings reuse the existing request path.** iOS
  `requestLocation()` already branches on status; Android `onLocationRequest`
  already does. The row's tap in the not-decided and denied states calls that
  path instead of toggling the preference. On the web the not-decided tap calls
  `ctx.requestLocation()` and repaints with the answer, exactly what the
  deleted strip did.
- **Post-tap states.** `ALLOW` → allow: `on`; refuse: `blocked` on iOS, `ask` or
  `blocked` on Android per the rule above. `OPEN SETTINGS ›` returns through
  `onResume` / `scenePhase` with whatever the phone now says; nothing in the
  app changes until then. `TURN ON` from `off` asks immediately, as today.
- **Accessibility.** The row is one button whose label reads title, subtitle
  and mark in that order. `aria-pressed` (web) and toggle traits (native) are
  present only in the two states whose tap toggles (`off`, `on`); in `ask` and
  `blocked` the row is a plain button.
- **Setup is untouched.** Setup's `Use my location` row stays; this item is
  Settings only. The Home footer location panel is untouched on the web.

## Contract changes (land in the build commit)

- `docs/contracts/ui.md`, Settings: replace "A deliberate location action is
  available when browser permission still awaits a choice" and the
  `Blocked in browser` sentence with the four-state table above (subtitle,
  mark, tap), the mark-ink rule, the chevron rule and the web blocked
  deviation. Keep "Location is an app preference, distinct from browser
  permission. Off prevents fixes and contextual prompts".
- `docs/contracts/ios-deviations.md`: the blocked row's tap opens the app's
  iOS Settings page; subtitle `Location is blocked` replaces `Blocked in
  Settings`.
- `docs/contracts/android-deviations.md`: same for Android
  (`ACTION_APPLICATION_DETAILS_SETTINGS`); `Location is blocked` replaces
  `Blocked in Android settings`; blocked means the dialog can no longer be
  shown.
- `assets/comps/latest/`: the Settings frames on all three clients are
  replaced by the built client's shots after the visual-regression accept.

## Decisions

| date | ruling | consequence |
|---|---|---|
| 2026-09-07 | Fold the strip into the row (owner complaint 1, 2) | strip deleted on every client |
| 2026-09-07 | c1, the mark is the verb | one target; Off is not one tap while the phone is undecided or blocked |
| 2026-09-07 | Copy set A | the four subtitles and marks in the table |
| 2026-09-07 | TURN OFF in the granted state | no `✓ ON` anywhere on the row |
| 2026-09-07 | All three clients | web changes too; web blocked = `Blocked in browser` + `TURN OFF` |
| 2026-09-07 | Mark in primary ink in every state (implicit in the c1 pick, shown on the sheet) | `aria-pressed` ink rule replaced |
| 2026-09-07 | Chevron on `OPEN SETTINGS ›` only (as shot in c1) | chevron means "leaves this screen" |

## Rejected

- **A separate switch control** (native pattern): breaks the approved C1
  grouped-buttons composition and adds a second grammar to Personal.
- **Two targets in one row (c2)**: Off always one tap, but 27px of chrome the
  360 frame does not have; three of four states wrap.
- **Keeping `✓ ON` when granted (c3's mark)**: mixes a state grammar and a verb
  grammar in one row; ruled out by the owner.
- **The permission is the setting (c4)**: removes a contracted preference on
  every client to save one state.
- **A confirmation or explanatory sentence anywhere**: the point is fewer rows
  and fewer words; a label that explains a gesture is a design admitting it
  failed.
