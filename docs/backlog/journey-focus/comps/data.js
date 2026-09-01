/* REAL DATA ONLY.
 *
 * Every timestamp below is copied out of
 * tools/fixtures/trip_rhodes_bondijunction.json (captured 2026-09-01), UTC as
 * the fixture stores it, rendered Sydney local (UTC+10). The fixture holds 11
 * journeys; five of them route via an "On Demand - Inner West" bus (upstream
 * product class 10) and are EXCLUDED server-side per docs/contracts/api.md, so
 * what a client actually sees is the six T9 -> T4 journeys here. Walking legs
 * (class 99) are folded into the change gap and never listed, also per api.md.
 *
 * Nothing is invented except the two realtime deltas the fixture cannot supply
 * (it was captured with estimated == planned on every leg, i.e. a day with no
 * delays): the `tight` scenario runs the first leg 5 minutes late, and the
 * `cancelled` scenario cancels the second leg. Both deltas are applied to real
 * times, and the cancelled scenario's replacement service is the real next T4
 * out of Town Hall Platform 5 (10:12, journey index 2 in the fixture).
 *
 * Minute arithmetic follows web/js/time.js EXACTLY -- minutesUntil() floors
 * both sides to the clock minute, "so the figure always agrees with the two
 * clock times printed beside it". That is why the hero change reads 7 MIN
 * (09:51:36 -> 09:58:00 is 6m24s of wall clock, but 09:51 -> 09:58 is what the
 * page prints and 7 is what the page must therefore say).
 */

var TZ = 'Australia/Sydney';

function ms(iso) { return Date.parse(iso); }
function clock(t) {
  return new Date(t).toLocaleTimeString('en-AU',
    { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}
function minsBetween(a, b) { return Math.floor(b / 60000) - Math.floor(a / 60000); }

/* ---- the six journeys, verbatim from the fixture ------------------------ */

var T9 = { code: 'T9', name: 'Northern Line', full: 'T9 Northern Line', headsign: 'Gordon via Lindfield' };
var T4 = { code: 'T4', name: 'Eastern Suburbs & Illawarra Line', full: 'T4 Eastern Suburbs & Illawarra Line', headsign: 'Bondi Junction' };

var RAW = [
  { dep: '2026-08-31T23:24:18Z', arrTH: '2026-08-31T23:51:36Z', depTH: '2026-08-31T23:58:00Z', arr: '2026-09-01T00:08:00Z', bondiPlat: 'Platform 2', rt: true },
  { dep: '2026-08-31T23:39:18Z', arrTH: '2026-09-01T00:06:36Z', depTH: '2026-09-01T00:12:00Z', arr: '2026-09-01T00:22:00Z', bondiPlat: 'Platform 1', rt: true },
  { dep: '2026-08-31T23:54:18Z', arrTH: '2026-09-01T00:21:36Z', depTH: '2026-09-01T00:32:00Z', arr: '2026-09-01T00:42:00Z', bondiPlat: 'Platform 1', rt: true },
  { dep: '2026-09-01T00:09:18Z', arrTH: '2026-09-01T00:36:36Z', depTH: '2026-09-01T00:42:00Z', arr: '2026-09-01T00:52:00Z', bondiPlat: 'Platform 2', rt: true },
  { dep: '2026-09-01T00:24:18Z', arrTH: '2026-09-01T00:51:36Z', depTH: '2026-09-01T01:02:00Z', arr: '2026-09-01T01:12:00Z', bondiPlat: 'Platform 2', rt: false },
  { dep: '2026-09-01T00:39:18Z', arrTH: '2026-09-01T01:08:42Z', depTH: '2026-09-01T01:12:00Z', arr: '2026-09-01T01:22:00Z', bondiPlat: 'Platform 1', rt: false }
];

var TRIP = { from: 'Rhodes', to: 'Bondi Junction', fromStation: 'Rhodes Station', toStation: 'Bondi Junction Station' };

/* Pinned clocks. 09:21 puts the lead journey 3 minutes out -- the same ladder
   position the calibration exemplar was shot at. 09:47 is 4 minutes short of
   Town Hall on the 09:24: the focused journey has left the board and the change
   is the next thing that happens. */
var CLOCKS = { board: ms('2026-08-31T23:21:00Z'), onboard: ms('2026-08-31T23:47:00Z') };

function buildJourney(raw, i, opt) {
  opt = opt || {};
  var lateMs = (opt.leg1LateMin || 0) * 60000;
  var depEst = ms(raw.dep) + lateMs;
  var arrTHEst = ms(raw.arrTH) + lateMs;
  var depTH = ms(raw.depTH);
  var arrEst = ms(raw.arr);

  var leg2Cancelled = !!opt.cancelLeg2;
  /* The real next T4 out of Town Hall Platform 5 after 09:58 (fixture journey
     index 2's second leg). Not invented -- looked up. */
  var endPlat = raw.bondiPlat;
  if (leg2Cancelled) { depTH = ms(RAW[1].depTH); arrEst = ms(RAW[1].arr); endPlat = RAW[1].bondiPlat; }

  var legs = [
    {
      line: T9,
      from: { name: 'Rhodes', station: 'Rhodes Station', platform: 'Platform 1' },
      to: { name: 'Town Hall', station: 'Town Hall Station', platform: 'Platform 3' },
      depSched: ms(raw.dep), depEst: raw.rt ? depEst : null,
      arrSched: ms(raw.arrTH), arrEst: raw.rt ? arrTHEst : null,
      cancelled: false, realtime: raw.rt,
      lateMin: raw.rt ? minsBetween(ms(raw.dep), depEst) : 0
    },
    {
      line: T4,
      from: { name: 'Town Hall', station: 'Town Hall Station', platform: 'Platform 5' },
      to: { name: 'Bondi Junction', station: 'Bondi Junction Station', platform: endPlat },
      depSched: leg2Cancelled ? ms(raw.depTH) : ms(raw.depTH), depEst: depTH,
      arrSched: leg2Cancelled ? ms(raw.arr) : ms(raw.arr), arrEst: arrEst,
      cancelled: false, realtime: true, lateMin: 0,
      /* House copy, verbatim idiom from rowmodel.js CANCELLED_LEAD_NOTE. */
      note: leg2Cancelled ? clock(ms(raw.depTH)) + ' cancelled · next train' : null,
      replacedTime: leg2Cancelled ? clock(ms(raw.depTH)) : null
    }
  ];
  if (leg2Cancelled) legs[1].cancelledOriginal = true;

  var eff = function (l, which) {
    return l[which + 'Est'] === null ? l[which + 'Sched'] : l[which + 'Est'];
  };
  var changeMin = minsBetween(eff(legs[0], 'arr'), eff(legs[1], 'dep'));
  var printedChangeMin = minsBetween(legs[0].arrSched, legs[1].depSched);

  return {
    idx: i, legs: legs,
    depMs: eff(legs[0], 'dep'), depSchedMs: legs[0].depSched,
    arrMs: eff(legs[1], 'arr'), arrSchedMs: ms(raw.arr),
    realtime: raw.rt,
    changeMin: changeMin, printedChangeMin: printedChangeMin,
    changeStation: 'Town Hall',
    durationMin: minsBetween(eff(legs[0], 'dep'), eff(legs[1], 'arr')),
    cancelledLeg: leg2Cancelled ? 1 : -1
  };
}

/* ---- scenarios ---------------------------------------------------------- */

var SCENARIOS = {
  /* On-time, at 09:21. The hero journey is the fixture's first: 09:24 Rhodes
     Platform 1, change Town Hall Platform 3 -> 5, 10:08 Bondi Junction. */
  hero: { now: CLOCKS.board, focus: 0, opts: {} },

  /* Tight connection: the first leg runs 5 minutes late, so the printed
     7-minute change window is really 2. No prediction is made about whether
     you make it -- both times are printed and the window is stated twice. */
  tight: { now: CLOCKS.board, focus: 0, opts: { leg1LateMin: 5 } },

  /* Second leg cancelled. Replacement is the real 10:12 T4. */
  cancelled: { now: CLOCKS.board, focus: 0, opts: { cancelLeg2: true } },

  /* Long names: nothing is abbreviated anywhere. */
  long: { now: CLOCKS.board, focus: 0, opts: {}, longNames: true },

  /* On the train. 09:47: the 09:24 has left the board, four services remain. */
  onboard: { now: CLOCKS.onboard, focus: 0, opts: {}, departed: true },

  /* Board at 09:21 with the focus already set (surface B). */
  board: { now: CLOCKS.board, focus: 0, opts: {} },

  /* Board at 09:47: the focused journey is gone from the board, the strip
     survives it (client-storage.md: the snapshot carries it). */
  boarddeparted: { now: CLOCKS.onboard, focus: 0, opts: {}, departed: true }
};

function scenario() {
  var s = new URLSearchParams(location.search).get('s') || 'hero';
  return { name: s, cfg: SCENARIOS[s] || SCENARIOS.hero };
}

/* ---- view model --------------------------------------------------------- */

function model() {
  var sc = scenario();
  var cfg = sc.cfg;
  var now = cfg.now;
  var all = RAW.map(function (r, i) { return buildJourney(r, i, i === cfg.focus ? cfg.opts : {}); });
  var focus = all[cfg.focus];

  /* The board drops departed services, exactly as rowmodel.js does. */
  var board = all.filter(function (j) { return minsBetween(now, j.depMs) >= 0; });

  return {
    name: sc.name, now: now, long: !!cfg.longNames, departed: !!cfg.departed,
    trip: TRIP, focus: focus, all: all, board: board
  };
}

/* ---- shared render helpers (house idioms) -------------------------------- */

function figureFor(mins) {
  if (mins <= 0) return { fig: 'Now', prov: 'DEPARTING' };
  if (mins >= 100) return { fig: Math.round(mins / 60) + 'H', prov: 'MIN' };
  return { fig: String(mins), prov: 'MIN' };
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/** A board row, byte-for-byte the shipped board.js grammar. */
function boardRowHtml(j, now, first) {
  var mins = minsBetween(now, j.depMs);
  var f = figureFor(mins);
  var late = j.legs[0].lateMin > 0;
  var kind = late ? 'late' : (j.realtime ? '' : 'sched');
  var prov = late ? j.legs[0].lateMin + ' MIN LATE' : (j.realtime ? f.prov : 'SCHEDULED');
  var cls = ['row', first ? 'first' : '', f.fig.length >= 3 ? 'wide' : '', kind].filter(Boolean).join(' ');
  return '<div class="' + cls + '" style="--stem:var(--line-T9)">' +
    '<div class="mins">' + esc(f.fig) +
      '<span class="prov' + (late ? ' warn' : '') + '">' + esc(prov) + '</span></div>' +
    '<div class="body">' +
      '<div class="dep"><strong>' + clock(j.depMs) + '</strong>' +
        (late ? '<del>' + clock(j.depSchedMs) + '</del>' : '') +
        '<span class="to">arrives ' + clock(j.arrMs) + '</span></div>' +
      '<div class="meta">Platform <b>1</b> &nbsp;·&nbsp; <i>T9</i></div>' +
      '<div class="dest">Gordon via Lindfield</div>' +
    '</div></div>';
}

function footerHtml(text) {
  return '<div class="ftr"><span class="pulse live"></span>' + (text || 'Updated 4s ago') + '</div>';
}
