# Departure board — four design directions

Throwaway comps for the trains_app home screen. Nothing here is product code;
the whole workshop lives in `/tmp/trains_comps/` and the repo was never touched.

- Contact sheet: `/tmp/trains_comps/index.html` (open in a browser)
- Frames: `/tmp/trains_comps/shots/<concept>-<size>[-<stress>].png`
- Sources: `a-solari.html`, `b-editorial.html`, `c-countdown.html`,
  `d-river.html`, shared `base.css` + `data.js`, shot by `shoot.js`

**Recommendation: B · Editorial**, with two organs transplanted from C and D.
Reasoning and the transplant list are at the bottom.

---

## Ground rules this round was held to

**Frozen IA.** `docs/backlog/v1-core-loop/DESIGN.md` is settled and was treated
as untouchable: header carries trip name + direction flip + trip switcher; body
is the next ~6 journeys with minutes-until, estimated departure, platform, line
badge, arrival time and state indicators. Only composition was explored.

**Real data, no invention.** Every value comes from
`tools/fixtures/trip_central_parramatta.json`: six real Central → Parramatta
services, real platforms (12, 8, 7, 13, 13, 12), the real Blue Mountains Line
service at 23:12 to Mount Victoria, and the two services the fixture genuinely
returns with `isRealtimeControlled: null` — which are the scheduled-only stress
case, free and honest. UTC in the fixture is rendered as Sydney local (UTC+10).
The clock is pinned to **22:45**, giving a minutes ladder of 3 / 18 / 27 / 33 /
48 / 63.

**A note on that ladder.** The fixture is a late-evening board, so gaps are
15/9/6/15/15 min. This is harsher than a peak board in one useful way (it forces
two-digit figures into the primary slot and puts a 15-minute hole on screen) and
softer in another (peak spacing of 3–5 min is denser than anything shown here).
Concept D's viability depends entirely on that spacing — see its risk line.

**Typography.** System stack only. A PWA whose whole promise is a sub-500ms warm
paint cannot afford a webfont request between the cold open and the answer, so
weight, letter-spacing, tabular figures and one scale ladder do the work a bought
typeface would. All four use one label idiom: 10px, 600, `0.14–0.16em`, uppercase.

**Colour.** Verified against the TfNSW open-data line-colour set: T1 North Shore
& Western `#F99D1C`, T4 `#005AA3`, T2 `#0098CD`, T5 `#C4258F`, T8 `#00954C`,
T9 `#D11F2F`, Metro M1 `#168388`, Blue Mountains Line `#F99D1C` (intercity
orange, same family as T1). **[verify]** M1's teal and the intercity set were not
confirmed against an official TfNSW document in this round — worth one check
before build. Palette is otherwise `#0A0B0D` ground, `#F4F5F7` ink (17.6:1),
`ink-2` at 66% (~8:1), `ink-3` at 46% (~4.3:1, labels only), and `#FF7A5C`
(7.4:1) for delay and cancellation.

---

## Instrument note — read this before shooting any comp for this project

`chrome --headless --window-size=390,844 --screenshot` **silently clamps the
layout viewport to 500 CSS px on macOS** and then crops the PNG to 390@2x. Every
"mobile" comp taken that way is a lie: content that overflows a real 390px phone
lays out comfortably at 500 and the overflow is simply cropped away. This round
lost two review passes to it — concept A's entire minutes column, the primary
read, was rendered off-screen and looked like a CSS bug.

`shoot.js` drives CDP directly and uses `Emulation.setDeviceMetricsOverride`,
which is not clamped, then **asserts `document.documentElement.clientWidth`
equals the requested width** and refuses to save otherwise. It also reports any
element whose right edge exceeds the viewport. Second trap it caught: with
`mobile: true` and no `<meta name="viewport">`, Chrome uses a 980px layout
viewport — the comps now carry the viewport meta a real PWA ships anyway.

Node's global `WebSocket` means no npm dependency, and Chrome is killed in a
`finally`, so there are no orphan browser trees.

---

## A · Solari

**The idea.** The Sydney platform indicator, shrunk to fit in your hand: a ruled
grid, monospaced tabular figures, column headers in letterspaced small caps, and
the board always full rather than a short list floating in a void. Mono is
reserved strictly for figures, where column alignment is the entire point;
names are set in the sans, because monospaced prose eats a third of a 390px
screen and buys nothing. The only heritage gesture is a single hairline seam
across the minutes digits — the flap fold — and it is load-bearing rather than
decorative: **a service with no live feed has no seam, because there is nothing
to flip it.**

**Emotional target.** Institutional authority. The feeling that this is the
official board, not an app's opinion of it.

**Where the IA lands.** Header is one amber rule of small caps with `⇄` and `⋯`
at the right. Four columns: service (headsign over line badge + name), departs
(with arrival beneath), platform, wait. Six rows flex to fill the frame exactly.

**Motion.** Digit-level split-flap on the minutes only: on refresh, changed
digits roll; unchanged digits never move. Rows never reorder without a departing
service flipping out first. Everything else is still.

**Perf.** Cheapest of the four — a static grid, no measurement, no absolute
positioning, no layout reads. `content-visibility` on rows is free. S.

**Build cost.** S.

**Why this might be the wrong choice.** The heritage is a costume the product
doesn't need, and it costs real information: at 390px the four-column table
truncates both the headsign *and* the line name on every row, which is a worse
trade than it looks when the fixture's board is 5/6 identical T1 services. And
the "no seam means no realtime" idea is elegant to describe and nearly invisible
to a user who has never been told the rule.

---

## B · Editorial

**The idea.** A printed timetable page, set properly: one column measure, one
scale ladder, letterspaced small-caps labels, a single heavy rule under the
masthead and hairlines below it. The minutes figure and its own reliability
occupy the left column; departure and arrival sit on one line because they are
the pair you actually compare; the line name and headsign fall below. Colour
appears once as a stem beside the service you are about to catch, plus the line
badge set in its own colour.

**The rule that makes it work:** the slot under the figure always states that
figure's provenance — `MIN`, `SCHEDULED`, `6 MIN LATE`, `CANCELLED`. Every row
is therefore *exactly three lines in every state*, so no delay, cancellation or
missing feed can push the sixth service past the fold. This was found the hard
way: earlier passes put the state on its own line and the sixth service — the
one you scroll for — fell off the bottom in the delayed and cancelled shots.

**Emotional target.** Calm and expensive. Nothing is shouting; everything is
already legible.

**Where the IA lands.** Masthead: kicker, trip name at 29px light, `REVERSE` /
`SWITCH TRIP` as words rather than glyphs, then the rule. Six rows, all above
the fold on both sizes.

**Motion.** Figures cross-fade and count down in place; the row never reflows
because its height is state-independent. A departed service dissolves and the
list closes upward over ~240ms. The freshness dot is the only live element.

**Perf.** Static list, no JS layout, no measurement. First paint from cache is
a template-literal join. S.

**Build cost.** S–M.

**Why this might be the wrong choice.** It is the safest thing here, and safe is
a real risk for a product whose whole pitch is that the incumbents are joyless.
The 54px figure is smaller than STYLES.md's "legible at arm's length in
sunlight" arguably demands, and reading it still requires locating the right row
rather than simply receiving an answer — which is precisely what C does better.

---

## C · Countdown

**The idea.** The answer *is* the screen. One figure at the size of a clock face
occupies the upper half, optically centred in its free space and left-aligned
against the same margin as everything else; beneath a hairline, a one-line-per-
service ledger for what follows. Zero-tap taken literally: you do not read this
screen, you receive it. Colour appears exactly once, as a short stem under the
figure in the line's colour.

**Emotional target.** Relief. The number lands before your eyes have focused.

**Where the IA lands.** A quiet trip name and the two controls at the top; the
hero carries platform, departs, arrives (with journey duration) as three
labelled facts, then line name and headsign, then a state line when there is one
to state. The remaining five services are a four-column ledger pinned to the
bottom, in thumb reach.

**Motion.** The figure ticks down in place with a slight upward crossfade per
change; the ledger rows shift up as services depart. On a delay, the figure
recomputes and the state line fades in beneath the stem — the figure never
silently changes meaning.

**Perf.** One large glyph, no images, no measurement. Trivially cacheable. S.

**Build cost.** M — the hero has genuinely distinct states (running, late,
timetable-only, and "your first service is cancelled, here is the next one that
is actually running") and each needs its own copy.

**Why this might be the wrong choice.** It spends half the screen on one datum,
and the honest truth about this product is that the *second* train matters more
than we like to admit — you frequently can't make the first one. It also has the
most to lose from a wrong prediction: a giant confident "3" for the wrong trip is
a worse error than a wrong row in a list.

**Its best moment,** and the strongest single frame in the round: with the first
service cancelled, the hero moves to the next running service, shows `18`, and
says `22:48 CANCELLED · NEXT RUNNING SERVICE` in coral. It never silently skips.

---

## D · River  *(the brave one)*

**The idea.** Time is drawn to scale down a single rail. Departures sit at their
true vertical position on a real clock axis with quarter-hour ticks, so the
15-minute hole after 23:18 is a hole you can *see* rather than a number you have
to subtract. A delay is not a label but a displacement: the service shows as a
dashed hollow ring at the position the timetable promised, dragged down the rail
by a coral bar to the solid dot where it now actually is. Scheduled-only services
are hollow dots — present on the axis, not yet confirmed by anything.

**Emotional target.** You see the shape of the next hour, not a list of six
facts. It should feel like the network is a physical thing that is running late.

**Where the IA lands.** Header as in B. The rail runs the full canvas at x=66;
each departure is a dot on the rail plus a card to its right carrying figure,
time, platform, badge, headsign and arrival. Cards that would collide are pushed
down and tied back to their true dot by an elbow hairline, and every card carries
its own left measure — without it, a pushed card reads as belonging to the *next*
dot down, which is not an ugliness but a lie about which train leaves platform 7.

**Motion.** The whole field slides upward continuously as now advances — the one
concept where the passage of time is animated rather than re-rendered. A newly
delayed service visibly slides down its rail into its new slot.

**Perf.** Worst of the four and the only one that needs JS layout: positions are
computed from canvas height, so it measures the DOM on every resize and every
refresh, and it cannot be server-rendered or painted from cache without a
reflow. M–L.

**Build cost.** L.

**Why this might be the wrong choice — and this one is measured, not
speculated.** Spatial truth costs vertical space that a phone does not have. A
card is ~78px tall at minimum; an 844px screen showing a 69-minute window gives
~9px per minute, so **the true-position claim only survives while services are
roughly 8+ minutes apart.** At the fixture's 23:12/23:18 pair (6 min) the
cascade already starts, and by the third card almost nothing is at its true
position any more — at which point the concept is paying a large layout and
complexity bill for a promise it is no longer keeping. At genuine peak headways
(3–5 min) it collapses entirely. See `d-river-390x844-long.png`.

---

## Recommendation

**Ship B · Editorial** as the calibration exemplar, with these transplants:

- **From C — the cancelled-lead behaviour, as a product rule, not a style.** When
  the first service is cancelled, say so in the same breath as the replacement.
  C's `22:48 CANCELLED · NEXT RUNNING SERVICE` is the best copy produced this
  round and belongs in B verbatim, in the first row's slot.
- **From C — the provenance-under-the-figure rule** is already in B and came from
  thinking about C's hero; keep it as an invariant and write it into the design
  doc: *every row is three lines in every state.* It is what keeps six services
  above the fold, and it is the first thing a future change will break.
- **From D — the delay device.** Even in a list, showing the timetabled time
  struck through beside the live one (B already does) plus D's insight that a
  delay is a *displacement* is worth one experiment: a hairline of coral in the
  row's left margin whose length is proportional to the delay. Cheap, spatial,
  no layout cost.
- **From A — the "no live feed, no flap" idea, generalised.** A doesn't earn its
  costume, but its principle does: a figure that isn't being driven by real data
  should not be set with the same confidence as one that is. B implements this as
  `SCHEDULED` under a lighter numeral; C implements it as a lighter hero. Keep it.
- **From A — the full board.** A's rows flex to fill the frame so the board is
  never a short list in a void. B gets this for free at six services; if a trip
  ever returns fewer, B should distribute rather than leave a hole.

**Why B over C**, which is the close call: C is the better *hero* and the worse
*board*. The product principle is a zero-tap answer, but the honest daily use of
a Sydney commuter board is "can I make the 22:48, and if not, when is the next
one" — that is two numbers, not one, and B shows six of them with the first one
already emphasised. C also concentrates all its risk on the prediction being
right. B is one row-emphasis away from C's benefit (make the first row's figure
larger still) while keeping the tail, and it survived every stress case without
reflowing. If the owner wants more drama, the cheap move is to grow B's first
figure toward C's scale rather than to adopt C wholesale.

---

## Open questions for the owner

1. **Stale data and the minutes figure.** B and C currently dim the whole board
   and flip the footer to `OFFLINE · LAST UPDATED 4 H AGO`, but they still show
   "3 MIN" computed from a four-hour-old cache, which is arguably a lie. Options:
   stop showing minutes past some staleness threshold and show only scheduled
   times; or keep minutes but recompute against the current clock and mark them
   scheduled. This is a product-semantics call, not a visual one. See
   `b-editorial-390x844-stale.png`.
2. **Headsign value on a station-pair board.** Every service on this board goes
   via Parramatta by construction, so "Penrith via Parramatta" is nearly
   redundant and is the string that forces every truncation decision. Worth
   confirming it earns its line before build.
3. **Desktop.** Treated as genuinely secondary. B centres a 940px measure and
   fits all six services; C splits into hero + ledger and is the more impressive
   of the two at 1280. Neither is a considered desktop design yet.
4. **Metro presentation.** DESIGN.md's open question stands — no metro service
   appears in this fixture, so M1 teal was never exercised against real data.

## What the next agent must know

- Shoot with `node /tmp/trains_comps/shoot.js [concept] [scenario]`. It asserts
  the viewport; if it throws `VIEWPORT LIE`, believe it and fix the instrument,
  not the CSS.
- Scenarios live in `data.js` (`hero`, `delayed`, `cancelled`, `scheduled`,
  `stale`, `long`) and are appended as `?s=<name>`. `cancelled` deliberately
  cancels the *first* and fourth services, because a cancelled lead is the case
  that forces a board to say what it is doing.
- The comps are plain classic scripts, not ES modules: `file://` blocks module
  loading with an opaque origin, so `data.js` defines globals on purpose.
- `base.css` contains one non-obvious rule — `body > * { width: 100%; min-width:
  0 }`. Without it, a single nowrap string (the full line name) inflates the flex
  line's cross size and shoves right-aligned content outside the viewport clip.
  It looks like content is missing rather than overflowing.
