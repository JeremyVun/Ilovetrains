/* HOME SCREEN — REAL DATA ONLY.  Classic script, file:// origin: everything
 * here is a deliberate global.  Inherited from /tmp/trains_comps5/home/data.js
 * and /tmp/trains_comps7.  Every clock time is read out of the repo's captured
 * fixtures and converted UTC -> AEST (+10).  The deltas that ARE applied are
 * named where they are applied, and nothing else is invented:
 *
 *   D1 `evening shift`  : the repo holds NO Bondi Junction -> Rhodes fixture.
 *       The reversal reuses the REAL outbound journey's shape — 15-minute
 *       headway, 44-minute journey, change at Town Hall, leg durations 27 + 10 —
 *       read in ride order and shifted +9h into the evening peak.  The shape is
 *       the fixture's; the hour is the delta.
 *   D2 `terminus platform`: Bondi Junction is a terminus, so the platform a
 *       return service leaves from is a platform the fixture shows trains
 *       ARRIVING at (1 and 2).  The reversal uses 2.
 *   D3 `no invented headsign, no invented change platform`: the return
 *       services' headsigns appear in no fixture, and neither do the platforms
 *       you would change at Town Hall travelling the other way.  So the return
 *       header prints the CHANGE STATION where the outbound prints the
 *       headsign, and its colour bar carries NO transfer numeral.  That is not
 *       a design decision, it is the absence of data, and bar.js is built to
 *       survive it.
 *   D4 `distances`: a distance is computed at runtime from the browser fix and
 *       the stop's coords (api.md /stops, client-storage.md geolocation term).
 *       The distances here are the only invented scalars in the file and they
 *       are stated as what they are: a plausible fix.
 *   D5 `two extra saved trips` (the `many` state only): Meadowbank -> Town Hall
 *       (T9) and Epping -> Chatswood (M1) are real Sydney station pairs on real
 *       lines.  They carry NO departure times, because of the rule below.
 *   D6 `wide change stress` (the `wide` frame only): the change platforms are
 *       set to 12 and 13.  TOWN HALL HAS NO PLATFORM 13 — this frame is a
 *       MEASUREMENT of the widest legal lockup the transfer device can be asked
 *       to draw (the repo's only two-digit platforms, 7/8/12/13, live on the
 *       Central board, which is single-leg and therefore cannot pose the
 *       question).  It is labelled as a stress frame on the contact sheet and it
 *       is not a journey anybody can take.
 *   D7 `tight change` : the SAME delta data.js already names — the first leg
 *       runs 5 minutes late into Town Hall, so it arrives 09:56 instead of 09:51
 *       and the printed 7-minute change becomes a 2-minute one. The connecting
 *       09:58 does not move, so the trip still arrives 10:08.
 *   D8 `cancelled`    : the 09:24 is cancelled; the header answers with the
 *       09:39, which is the next real service in the same fixture.
 *
 * THE RULE THE TRIP LIST OBEYS (owner ruling, round 3): only the trip in the
 * smart header is LIVE.  A next-departure against five saved trips would mean
 * five upstream fetches on cold open, against the app's own speed budget.  What
 * a saved row may state without fetching anything is what the DEVICE already
 * knows: how far away its origin is (fix + stop coords) and when you last rode
 * it (history, capped at 500 events — client-storage.md).
 *
 * SOURCE A — tools/fixtures/trip_rhodes_bondijunction.json
 *   Rhodes P1 -> Town Hall P3 (T9, 27 min), change 7 min, Town Hall P5 ->
 *   Bondi Junction P2 (T4, 10 min).  Departures 09:24 / 09:39 / 09:54 / …; the
 *   09:24 arrives 10:08.  These are the same six services the board comp shows.
 * SOURCE B — tools/fixtures/trip_central_parramatta.json
 *   Central -> Parramatta, T1 and BMT.  Used here only for a saved trip's
 *   identity and leg duration.
 */

/* ---- the journey, in both directions -------------------------------------- */

var OUT = {
  from: 'Rhodes', to: 'Bondi Junction', plat: '1',
  dep: '09:24', arr: '10:08', head: 'Gordon via Lindfield', arrPlat: '2',
  legs: [{ code: 'T9', mins: 27 }, { code: 'T4', mins: 10 }],
  chg: { at: 'Town Hall', mins: 7, pIn: '3', pOut: '5' }
};

/* D7. The legs move, the ends do not: 32 + 2 + 10 is still 44 minutes. */
var TIGHT = {
  from: 'Rhodes', to: 'Bondi Junction', plat: '1',
  dep: '09:24', arr: '10:08', head: 'Gordon via Lindfield', arrPlat: '2',
  legs: [{ code: 'T9', mins: 32 }, { code: 'T4', mins: 10 }],
  chg: { at: 'Town Hall', mins: 2, pIn: '3', pOut: '5' },
  tight: true, chgWas: 7
};

/* D6, a measurement rather than a journey. */
var WIDE = {
  from: 'Rhodes', to: 'Bondi Junction', plat: '1',
  dep: '09:24', arr: '10:08', head: 'Gordon via Lindfield', arrPlat: '2',
  legs: [{ code: 'T9', mins: 27 }, { code: 'T4', mins: 10 }],
  chg: { at: 'Town Hall', mins: 7, pIn: '12', pOut: '13' }
};

/* D8. The 09:39 is the fixture's own next service; `cancelled` carries the time
   of the one that will not run, because the copy STYLES ruling A binds names it
   in the same breath: `09:24 CANCELLED · NEXT TRAIN`. */
var CXL = {
  from: 'Rhodes', to: 'Bondi Junction', plat: '1',
  dep: '09:39', arr: '10:22', head: 'Gordon via Lindfield', arrPlat: '1',
  legs: [{ code: 'T9', mins: 27 }, { code: 'T4', mins: 10 }],
  chg: { at: 'Town Hall', mins: 6, pIn: '3', pOut: '5' },
  cancelled: '09:24'
};

/* D1 + D2 + D3.  Ride order flips, so the colour device flips with it: ten
   minutes of blue and then twenty-seven of red, which is the fixture's own two
   legs read backwards. */
var BACK = {
  from: 'Bondi Junction', to: 'Rhodes', plat: '2',
  dep: '18:24', arr: '19:08', head: '', arrPlat: '',
  legs: [{ code: 'T4', mins: 10 }, { code: 'T9', mins: 27 }],
  chg: { at: 'Town Hall', mins: 7, pIn: '', pOut: '' }
};

/* ---- the saved trips (client-storage.md: trips live on the device) --------- */

var TRIPS = [
  { from: 'Rhodes',    to: 'Bondi Junction', legs: OUT.legs,
    dist: '120 m', rode: 'Rode it this morning' },
  { from: 'Central',   to: 'Parramatta',     legs: [{ code: 'T1', mins: 29 }],
    dist: '14 km', rode: 'Last ridden Friday' },
  { from: 'Tallawong', to: 'Chatswood',      legs: [{ code: 'M1', mins: 38 }],
    dist: '38 km', rode: 'Last ridden 12 Aug' }
];

/* D5 */
var TRIPS_MANY = TRIPS.concat([
  { from: 'Meadowbank', to: 'Town Hall', legs: [{ code: 'T9', mins: 24 }],
    dist: '1.6 km', rode: 'Last ridden 8 Aug' },
  { from: 'Epping',     to: 'Chatswood', legs: [{ code: 'M1', mins: 13 }],
    dist: '9 km',   rode: 'Never ridden' }
]);

/* ---- the add-trip sheet ---------------------------------------------------- */
var RECENT = ['Bondi Junction', 'Town Hall', 'Chatswood'];
var MATCHES = [{ name: 'Rhodes', hit: 'Rhode', tail: 's', line: 'T9', why: 'Best match' }];

/* ---- THE STATE LADDER ------------------------------------------------------
   Every state below is one `web/js/focus.js` can already distinguish today; the
   clock is the only thing that changes between the seven tracking frames, which
   is the point — one object, one journey, read at seven times of day. */

var SCENARIOS = {
  /* 1. BEFORE YOU LEAVE. The train exists and you have time, so the app has
     nothing to tell you to do and says the calmest true thing it knows: which
     train this is. Marker at rest at the start of the line. */
  before: { now: '09:09', j: OUT, fix: 'Rhodes', dist: '120 m' },

  /* 2. LEAVE NOW. The one state that spends the location fix, and therefore the
     one that prints it underneath (`leave`). */
  leave:  { now: '09:20', j: OUT, fix: 'Rhodes', dist: '120 m', leave: '120 m' },

  /* 3. ON BOARD, leg 1. Nine minutes in; the figure changes referent to the
     connection, which is the next thing the person has to DO. */
  board:  { now: '09:33', j: OUT, fix: 'Rhodes', dist: '120 m' },

  /* 4. CHANGE HERE. Standing in the dwell at Town Hall. The marker is IN the
     gap, which is the whole reason the gap was kept. THE HERO. */
  change: { now: '09:53', j: OUT, fix: 'Rhodes', dist: '120 m' },

  /* 4b. the same moment, D6's two-digit platforms — a measurement. */
  wide:   { now: '09:53', j: WIDE, fix: 'Rhodes', dist: '120 m' },

  /* 5. ON BOARD, final leg. */
  final:  { now: '10:01', j: OUT, fix: 'Rhodes', dist: '120 m' },

  /* 6. ARRIVING. */
  arrive: { now: '10:06', j: OUT, fix: 'Rhodes', dist: '120 m' },

  /* 7. ARRIVED, and the handoff: evidence, then a verb, printed in place — the
     device this page already uses for the home-may-have-moved offer. */
  done:   { now: '10:11', j: OUT, fix: 'Bondi Junction', dist: '90 m', over: true },

  /* EXCEPTION A — the connection is at risk (D7). */
  tight:  { now: '09:47', j: TIGHT, fix: 'Rhodes', dist: '120 m' },

  /* EXCEPTION B — the tracked service is cancelled (D8). */
  cxl:    { now: '09:21', j: CXL, fix: 'Rhodes', dist: '120 m' },

  /* THE RECEIPT STATES, carried forward unchanged from round 4/5. */
  /* the reversal: the direction on screen was never saved, which is the biggest
     leap the app makes, and it earns the longest receipt. */
  back:   { now: '18:12', j: BACK, fix: 'Bondi Junction', dist: '250 m',
            rode: { dep: '09:24' } },
  /* same evening, the home heuristic has noticed the day ending somewhere else */
  moved:  { now: '18:12', j: BACK, fix: 'Bondi Junction', dist: '250 m',
            rode: { dep: '09:24' }, moved: 'Central' },
  /* no fix: degrades SILENTLY to time + history, and says which */
  nofix:  { now: '09:09', j: OUT, fix: null },
  /* the contextual permission ask: >=2 trips, never first load, in place */
  ask:    { now: '09:09', j: OUT, fix: null, ask: true },

  /* five saved trips, mid-journey — the switch has to stay cheap at length */
  many:   { now: '09:33', j: OUT, fix: 'Rhodes', dist: '120 m', many: true },

  /* add a trip */
  add:    { now: '09:09', j: OUT, fix: 'Rhodes', dist: '120 m', screen: 'add' },
  save:   { now: '09:09', j: OUT, fix: 'Rhodes', dist: '120 m', screen: 'save' }
};

/* ---- THE COPY SYSTEM -------------------------------------------------------
   TRACKING  the top strip's left half. It used to state proximity on every
             screen; in directions mode it states WHAT IS BEING TRACKED, because
             that is the thing a user might want to change and the owner ruled
             that switching must be cheap and obvious from the header. It is a
             button with a chevron and the list it opens is already on screen.
   RECEIPT   one sentence, in proportion to the size of the leap the app made
             (owner). A trip you are standing on top of gets nothing; a trip
             picked with no fix gets its history; the reverse of a direction you
             never saved gets the full sentence. Proximity moved INTO this slot:
             `120 m from Rhodes` is now printed only in the one state where it
             is load-bearing — the state where the app tells you to start
             walking — instead of on every frame whether it earns it or not.
   OFFER     evidence, then a verb, printed in place. Never a dialog.
   ---------------------------------------------------------------------------- */

function shortStn(n) {
  return n === 'Bondi Junction' ? 'Bondi Jn' : n === 'Town Hall' ? 'Town Hall' : n;
}

function copy(s, d) {
  var c = {};
  c.tracking = 'Tracking · ' + shortStn(s.j.from) + ' → ' + shortStn(s.j.to);

  c.receipt = d.evidence || '';
  if (!c.receipt && s.rode) {
    c.receipt = 'You rode out at ' + s.rode.dep + '. Here’s the way back.';
  } else if (!c.receipt && !s.fix && !s.ask) {
    c.receipt = 'You ride this most weekday mornings.';
  }

  if (s.over) {
    c.offer = {
      k: 'Trip over',
      p: 'You rode out at 09:24, and you’re at Bondi Junction now.',
      yes: 'Show the way back', no: 'Not now'
    };
  } else if (s.moved) {
    c.offer = {
      k: 'Home may have moved',
      p: 'Your last three evenings ended at ' + s.moved + ', not Rhodes.',
      yes: 'Go to ' + s.moved + ' instead',
      no: 'Keep Rhodes'
    };
  }
  if (s.ask) {
    c.ask = {
      k: 'Open on the right trip',
      p: 'With three trips saved, knowing where you are lets the app open on '
        + 'the right one. Your location never leaves this phone.',
      yes: 'Use my location', no: 'Not now'
    };
  }
  return c;
}

function model(name) {
  var s = SCENARIOS[name] || SCENARIOS.before;
  var d = DIR(s.j, s.now, { leave: s.leave || '' });
  return {
    name: name, now: s.now, screen: s.screen || 'home',
    j: s.j, d: d,
    fig: d.figure, prov: d.prov,
    fix: s.fix || null, dist: s.dist || '',
    rode: s.rode || null, ask: !!s.ask, moved: s.moved || null, over: !!s.over,
    trips: s.many ? TRIPS_MANY : TRIPS,
    c: copy(s, d)
  };
}

function scenarioName() {
  var m = /[?&]s=([a-z]+)/.exec(location.search);
  return m ? m[1] : 'before';
}

/* Knocked-out ink on a filled line colour, MEASURED against #F4F5F7 and
   #0A0B0D (STYLES.md Board v2 amendment: text on a fill is set >=14px/700, the
   3:1 large-text threshold, which every line clears).  White loses on
   T1/T2/T3/T7/T8/M1; on PAPER the fill's ink is the ground for every line. */
var INK_ON = { T1: 'bg', T2: 'bg', T3: 'bg', T7: 'bg', T8: 'bg', M1: 'bg',
               BMT: 'bg', SCO: 'bg', SHL: 'bg',
               T4: 'ink', T5: 'ink', T9: 'ink', CCN: 'ink', HUN: 'ink' };
