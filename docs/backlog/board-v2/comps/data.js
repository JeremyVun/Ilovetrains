/* REAL DATA ONLY.
 *
 * Every clock time below is read out of the repo's captured fixtures and
 * converted UTC -> AEST (+10). Nothing is invented. Two deltas ARE applied,
 * and they are named where they are applied (the fixtures were captured on days
 * with no disruption: estimated === planned on every leg, so a delayed board and
 * a cancelled board cannot be shown without one):
 *   - `delayed`  : the 09:24 runs 6 min late, the 09:54 runs 2 min late.
 *   - `cancelled`: the 09:24 is cancelled.
 * Both are deltas on real services. No time, platform, line or headsign that
 * appears anywhere in these comps was made up.
 *
 * SOURCE A — tools/fixtures/trip_rhodes_bondijunction.json
 *   11 journeys; the five routed via the "On Demand - Inner West" bus
 *   (upstream product class 10) are excluded server-side per docs/contracts/api.md,
 *   so a client sees six. Each is T9 Rhodes P1 -> Town Hall P3, change, T4
 *   Town Hall P5 -> Bondi Junction. Two of the six return
 *   isRealtimeControlled: null on the first leg => SCHEDULED.
 *
 * SOURCE B — tools/fixtures/trip_central_parramatta.json
 *   6 journeys, all single-leg, Central -> Parramatta. Carries the longest real
 *   headsign in the repo ("Mount Victoria via Parramatta") and the only
 *   two-digit platforms (7/8/12/13), and it is the board the owner was looking
 *   at when he said the big number reads as the platform.
 *
 * MINUTE ARITHMETIC is web/js/time.js's: both sides floored to the clock
 * minute, so the figure always agrees with the clock times printed beside it.
 */

/* ---- source A: Rhodes -> Bondi Junction ---------------------------------- */

var RHODES = {
  from: 'Rhodes', to: 'Bondi Junction',
  services: [
    { dep: '09:24', plat: '1', line: 'T9', line2: 'T4', head: 'Gordon via Lindfield',
      arr: '10:08', arrPlat: '2', chg: { at: 'Town Hall', mins: 7,  in: '09:51', out: '09:58', pIn: '3', pOut: '5' }, rt: true },
    { dep: '09:39', plat: '1', line: 'T9', line2: 'T4', head: 'Gordon via Lindfield',
      arr: '10:22', arrPlat: '1', chg: { at: 'Town Hall', mins: 6,  in: '10:06', out: '10:12', pIn: '3', pOut: '5' }, rt: true },
    { dep: '09:54', plat: '1', line: 'T9', line2: 'T4', head: 'Gordon via Lindfield',
      arr: '10:42', arrPlat: '1', chg: { at: 'Town Hall', mins: 11, in: '10:21', out: '10:32', pIn: '3', pOut: '5' }, rt: true },
    { dep: '10:09', plat: '1', line: 'T9', line2: 'T4', head: 'Gordon via Lindfield',
      arr: '10:52', arrPlat: '2', chg: { at: 'Town Hall', mins: 6,  in: '10:36', out: '10:42', pIn: '3', pOut: '5' }, rt: true },
    { dep: '10:24', plat: '1', line: 'T9', line2: 'T4', head: 'Gordon via Lindfield',
      arr: '11:12', arrPlat: '2', chg: { at: 'Town Hall', mins: 11, in: '10:51', out: '11:02', pIn: '3', pOut: '5' }, rt: false },
    { dep: '10:39', plat: '1', line: 'T9', line2: 'T4', head: 'Gordon via Lindfield',
      arr: '11:22', arrPlat: '1', chg: { at: 'Town Hall', mins: 4,  in: '11:08', out: '11:12', pIn: '3', pOut: '5' }, rt: false }
  ]
};

/* ---- source B: Central -> Parramatta -------------------------------------- */

var CENTRAL = {
  from: 'Central', to: 'Parramatta',
  services: [
    { dep: '22:48', plat: '12', line: 'T1',  head: 'Penrith via Parramatta',        arr: '23:17', rt: true },
    { dep: '23:03', plat: '8',  line: 'T1',  head: 'Penrith via Parramatta',        arr: '23:34', rt: true },
    { dep: '23:12', plat: '7',  line: 'BMT', head: 'Mount Victoria via Parramatta', arr: '23:36', rt: true },
    { dep: '23:18', plat: '13', line: 'T1',  head: 'Penrith via Parramatta',        arr: '23:47', rt: true },
    { dep: '23:33', plat: '13', line: 'T1',  head: 'Penrith via Parramatta',        arr: '00:04', rt: false },
    { dep: '23:48', plat: '12', line: 'T1',  head: 'Penrith via Parramatta',        arr: '00:17', rt: false }
  ]
};

/* ---- the saved trips (client-storage.md: trips live on the device) --------- */
/* Three trips, built from the three trip fixtures the repo actually holds. */
var TRIPS = [
  { from: 'Rhodes',  to: 'Bondi Junction', line: 'T9', near: true,  dist: '120 m',  next: '3 min'  },
  { from: 'Central', to: 'Parramatta',     line: 'T1', near: false, dist: '14 km',  next: '23:03' },
  { from: 'Tallawong', to: 'Chatswood',    line: 'M1', near: false, dist: '38 km',  next: '09:31' }
];

/* ---- scenarios ------------------------------------------------------------ */

function mins(now, hhmm) {
  var a = now.split(':'), b = hhmm.split(':');
  var m = (+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]);
  if (m < -720) m += 1440;            /* wraps midnight (Central board) */
  if (m > 720) m -= 1440;
  return m;
}

var SCENARIOS = {
  /* the exemplar's own clock: six services ahead, ladder 3/18/33/48/63/78 */
  hero:      { trip: RHODES, now: '09:21' },
  /* the same six real journeys, clock pinned later: four have genuinely run.
     Past = 09:24 (48 ago), 09:39 (33), 09:54 (18), 10:09 (3).
     Future = 10:24 (12, SCHEDULED), 10:39 (27, SCHEDULED). */
  past:      { trip: RHODES, now: '10:12', scrolled: true },
  /* Scrolled DEEP: far enough back that the realtime record has aged out of the
     top of the page while it still survives at the bottom. One frame, both past
     registers, plus the third real case — a service that was never monitored at
     all (the fixture returns isRealtimeControlled: null on the 10:24 and 10:39).
     Clock 10:42; the same named `late` delta as the delayed board.
     The fixture's window ends at 10:39, so this frame genuinely has no future
     services. That is the fixture, not a design claim. */
  deep:      { trip: RHODES, now: '10:42', scrolled: true, late: { 0: 6, 2: 2 } },
  delayed:   { trip: RHODES, now: '09:21', late: { 0: 6, 2: 2 } },
  cancelled: { trip: RHODES, now: '09:21', cx: [0] },
  focused:   { trip: RHODES, now: '09:21', focus: true },
  /* longest strings + two-digit platforms + a second line colour + single-leg */
  long:      { trip: CENTRAL, now: '22:45' },
  trips:     { trip: RHODES, now: '09:21', screen: 'trips' },
  ask:       { trip: RHODES, now: '09:21', screen: 'ask' }
};

/* Build the render model for a scenario: every row already knows whether it is
   past, what its figure is, and what word goes under the figure. */
function model(name) {
  var s = SCENARIOS[name] || SCENARIOS.hero;
  var rows = s.trip.services.map(function (sv, i) {
    var r = {};
    for (var k in sv) r[k] = sv[k];
    r.i = i;
    r.lateBy = (s.late && s.late[i]) || 0;
    r.cx = !!(s.cx && s.cx.indexOf(i) >= 0);
    r.sched = !sv.rt;
    if (r.lateBy) {
      var p = r.dep.split(':'), t = (+p[0] * 60 + +p[1] + r.lateBy) % 1440;
      r.planned = r.dep;
      r.dep = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    }
    r.m = mins(s.now, r.dep);
    r.past = r.m < 0;
    r.ago = -r.m;

    /* THE PAST HAS TWO REGISTERS (backend finding, 2026-09-01, binding).
       (1) Recent past, roughly the last hour: the realtime record survives, so
           the row may state what ACTUALLY happened — the time it really left and
           how late that was. A backed claim.
       (2) Older past, and anything that was never monitored (this fixture's
           10:24 and 10:39 return isRealtimeControlled: null): realtime has aged
           out to estimated:null. The row may state the TIMETABLE and nothing
           else. "The timetable says it ran" is not "it ran on time", and the
           design must not let the two look alike.
       Never a countdown on a past row. And an elapsed marker ("48 min ago") is
       only printed on an ACTUALS row, because on a timetable-only row it would
       assert a departure the data cannot back. */
    r.RT_WINDOW = 60;
    r.pastKind = (r.past && sv.rt && r.ago <= 60) ? 'actual' : r.past ? 'timetable' : '';
    if (r.pastKind === 'actual') {
      r.pastProv = r.lateBy ? ('Left ' + r.lateBy + ' min late') : 'Left on time';
      r.agoText = r.ago + ' min ago';
    } else if (r.pastKind === 'timetable') {
      r.pastProv = 'Timetable only';
      r.agoText = '';
    }
    /* A timetable-only row prints the TIMETABLED time, never the estimate: at
       10:42 the 09:24 did run six minutes late, but the record that knew so has
       aged out, and printing 09:30 would be the board asserting something it can
       no longer see. The struck planned time belongs only to an actuals row. */
    r.pastDep = r.pastKind === 'timetable' ? (r.planned || r.dep) : r.dep;
    r.pastStruck = r.pastKind === 'actual' && r.planned ? r.planned : '';
    /* the provenance slot: the whole shipped vocabulary, nothing added */
    r.prov = r.cx ? 'CANCELLED'
      : r.past ? 'DEPARTED'
      : r.lateBy ? (r.lateBy + ' MIN LATE')
      : r.m === 0 ? 'DEPARTING'
      : r.sched ? 'SCHEDULED' : 'MIN';
    /* Where a direction welds the unit to the numeral, the slot under the figure
       is freed to state the SERVICE's status instead of the figure's unit. `MIN`
       under every figure was six redundant labels; `ON TIME` is the fact the
       board currently only implies (realtime-controlled, estimated == planned).
       New word, owner call — flagged in OPTIONS.md. */
    r.state = r.prov === 'MIN' ? 'ON TIME' : r.prov;
    r.fig = r.cx ? '—' : r.m === 0 ? 'Now' : String(r.m);
    return r;
  });
  return {
    name: name, now: s.now, from: s.trip.from, to: s.trip.to,
    scrolled: !!s.scrolled, focus: !!s.focus, screen: s.screen || 'board',
    past: rows.filter(function (r) { return r.past; }),
    next: rows.filter(function (r) { return !r.past; }),
    rows: rows
  };
}

function scenarioName() {
  var m = /[?&]s=([a-z]+)/.exec(location.search);
  return m ? m[1] : 'hero';
}

/* DEPARTED is proposed new provenance vocabulary in every direction in this
   round and is flagged as an owner call in OPTIONS.md. */
