/* The comps scenario catalogue: every stress state a screen must survive,
 * derived from tools/fixtures/ rather than typed, plus the named synthetic
 * deltas that the fixtures cannot show (they were captured on days with no
 * disruption, so estimated === planned on every leg).
 *
 * Every delta is declared here and printed into the head of the generated
 * data file, because the contact sheet's lede has to name every fixture
 * artifact or the owner rules on one by mistake.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

/* docs/contracts/api.md: upstream class 10 "On Demand" is dropped server-side,
   so a client of this API never sees those journeys. */
const EXCLUDED_PRODUCT_CLASS = 10;

const AEST_MINUTES = 10 * 60;

function clockAest(iso) {
  const ms = Date.parse(iso) + AEST_MINUTES * 60_000;
  const d = new Date(ms);
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/* web/js/time.js: both sides floored to the clock minute, so a figure always
   agrees with the two clock times printed beside it. */
function span(from, to) {
  const d = toMinutes(to) - toMinutes(from);
  return d < 0 ? d + 1440 : d;
}

function shift(hhmm, minutes) {
  const t = ((toMinutes(hhmm) + minutes) % 1440 + 1440) % 1440;
  return pad(Math.floor(t / 60)) + ':' + pad(t % 60);
}

function platformOf(disassembledName) {
  const m = /Platform (\w+)/.exec(disassembledName || '');
  return m ? m[1] : '';
}

function stationOf(disassembledName) {
  return (disassembledName || '').replace(/ Station.*$/, '').replace(/,.*$/, '');
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name + '.json'), 'utf8'));
}

function plannedJourneys(fixtureName) {
  const doc = readFixture(fixtureName);
  return doc.journeys
    .map((j) => j.legs.filter((l) => l.transportation && l.transportation.product))
    .filter((legs) => legs.length && !legs.some((l) => l.transportation.product.class === EXCLUDED_PRODUCT_CLASS));
}

function serviceOf(legs) {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const service = {
    dep: clockAest(first.origin.departureTimePlanned),
    plat: platformOf(first.origin.disassembledName),
    line: first.transportation.disassembledName,
    head: first.transportation.destination.name,
    arr: clockAest(last.destination.arrivalTimePlanned),
    rt: !!first.isRealtimeControlled
  };
  if (legs.length > 1) {
    service.line2 = last.transportation.disassembledName;
    service.arrPlat = platformOf(last.destination.disassembledName);
    service.chg = {
      at: stationOf(first.destination.disassembledName),
      mins: span(clockAest(first.destination.arrivalTimePlanned), clockAest(last.origin.departureTimePlanned)),
      in: clockAest(first.destination.arrivalTimePlanned),
      out: clockAest(last.origin.departureTimePlanned),
      pIn: platformOf(first.destination.disassembledName),
      pOut: platformOf(last.origin.disassembledName)
    };
  }
  return service;
}

function boardTable(fixtureName, from, to) {
  return { from, to, services: plannedJourneys(fixtureName).map(serviceOf) };
}

const RHODES = boardTable('trip_rhodes_bondijunction', 'Rhodes', 'Bondi Junction');
const CENTRAL = boardTable('trip_central_parramatta', 'Central', 'Parramatta');
const TALLAWONG = boardTable('trip_tallawong_chatswood', 'Tallawong', 'Chatswood');

function journeyOf(service, from, to) {
  const legs = service.chg
    ? [{ code: service.line, mins: span(service.dep, service.chg.in) },
       { code: service.line2, mins: span(service.chg.out, service.arr) }]
    : [{ code: service.line, mins: span(service.dep, service.arr) }];
  const journey = {
    from, to, plat: service.plat,
    dep: service.dep, arr: service.arr,
    head: service.head, arrPlat: service.arrPlat || '',
    legs
  };
  if (service.chg) {
    journey.chg = { at: service.chg.at, mins: service.chg.mins, pIn: service.chg.pIn, pOut: service.chg.pOut };
  }
  return journey;
}

const DELTAS = [
  { id: 'delayed', text: 'the 09:24 runs 6 min late, the 09:54 runs 2 min late.' },
  { id: 'cancelled', text: 'the 09:24 is cancelled.' },
  { id: 'tight',
    text: "the 09:24's FIRST leg runs 5 min late into Town Hall, so it\n"
      + ' *       arrives 09:56 instead of 09:51 and the printed 7-minute\n'
      + ' *       change becomes a 2-minute one. The connecting 09:58 is\n'
      + ' *       unchanged, so the trip still arrives 10:08. This is the only\n'
      + ' *       way to show a connection at risk from fixtures captured on\n'
      + ' *       undisrupted days, and it is a delta on a real journey.' }
];

const HOME_DELTAS = [
  { id: 'D1', name: 'evening shift',
    text: 'the repo holds NO Bondi Junction -> Rhodes fixture.\n'
      + ' *       The reversal reuses the REAL outbound journey’s shape — 15-minute\n'
      + ' *       headway, 44-minute journey, change at Town Hall, leg durations 27 + 10 —\n'
      + ' *       read in ride order and shifted +9h into the evening peak. The shape is\n'
      + ' *       the fixture’s; the hour is the delta.' },
  { id: 'D2', name: 'terminus platform',
    text: 'Bondi Junction is a terminus, so the platform a\n'
      + ' *       return service leaves from is a platform the fixture shows trains\n'
      + ' *       ARRIVING at. The reversal uses the outbound journey’s arrival platform.' },
  { id: 'D3', name: 'no invented headsign, no invented change platform',
    text: 'the return\n'
      + ' *       services’ headsigns appear in no fixture, and neither do the platforms\n'
      + ' *       you would change at Town Hall travelling the other way. So the return\n'
      + ' *       journey carries an EMPTY headsign and EMPTY change platforms, and the\n'
      + ' *       concept must survive their absence rather than invent them.' },
  { id: 'D4', name: 'distances and history',
    text: 'a distance is computed at runtime from the browser fix\n'
      + ' *       and the stop’s coords (api.md /stops, client-storage.md geolocation\n'
      + ' *       term), and "last ridden" comes from on-device history. Neither is in a\n'
      + ' *       fixture. The distances, the ridden lines and the saved rows’ next\n'
      + ' *       departures are the only invented scalars, and they are stated as what\n'
      + ' *       they are: a plausible fix and a plausible history.' },
  { id: 'D5', name: 'two extra saved trips',
    text: 'Meadowbank -> Town Hall (T9) and Epping ->\n'
      + ' *       Chatswood (M1) are real Sydney station pairs on real lines, added for\n'
      + ' *       the `many` frame only. Their journey lengths are plausible, not\n'
      + ' *       captured; they carry no departure times, because only the trip in the\n'
      + ' *       smart header is live (owner ruling: five saved trips would mean five\n'
      + ' *       upstream fetches on cold open).' },
  { id: 'D6', name: 'wide change stress',
    text: 'the change platforms are set to 12 and 13 for the\n'
      + ' *       `wide` frame only. TOWN HALL HAS NO PLATFORM 13 — this frame is a\n'
      + ' *       MEASUREMENT of the widest legal lockup the transfer device can be asked\n'
      + ' *       to draw (the repo’s only two-digit platforms, 7/8/12/13, live on the\n'
      + ' *       Central board, which is single-leg and therefore cannot pose the\n'
      + ' *       question). It is labelled as a stress frame on the contact sheet and it\n'
      + ' *       is not a journey anybody can take.' },
  { id: 'D7', name: 'tight change',
    text: 'the SAME delta the board data names — the first leg runs\n'
      + ' *       5 minutes late into Town Hall, so it arrives 09:56 instead of 09:51 and\n'
      + ' *       the printed 7-minute change becomes a 2-minute one. The connecting 09:58\n'
      + ' *       does not move, so the trip still arrives 10:08.' },
  { id: 'D8', name: 'cancelled',
    text: 'the 09:24 is cancelled; the header answers with the\n'
      + ' *       09:39, which is the next real service in the same fixture.' }
];

const TIGHT_DELTA = { legLate: 5 };
const EVENING_SHIFT_MINUTES = 9 * 60;
const WIDE_PLATFORMS = { pIn: '12', pOut: '13' };

const OUT = journeyOf(RHODES.services[0], RHODES.from, RHODES.to);

const TIGHT = (() => {
  const j = journeyOf(RHODES.services[0], RHODES.from, RHODES.to);
  const arriveIn = shift(RHODES.services[0].chg.in, TIGHT_DELTA.legLate);
  j.legs = [{ code: j.legs[0].code, mins: span(j.dep, arriveIn) }, j.legs[1]];
  j.chg = { at: j.chg.at, mins: span(arriveIn, RHODES.services[0].chg.out), pIn: j.chg.pIn, pOut: j.chg.pOut };
  j.tight = true;
  j.chgWas = OUT.chg.mins;
  return j;
})();

const WIDE = (() => {
  const j = journeyOf(RHODES.services[0], RHODES.from, RHODES.to);
  j.chg = { at: j.chg.at, mins: j.chg.mins, pIn: WIDE_PLATFORMS.pIn, pOut: WIDE_PLATFORMS.pOut };
  return j;
})();

const CXL = (() => {
  const j = journeyOf(RHODES.services[1], RHODES.from, RHODES.to);
  j.cancelled = RHODES.services[0].dep;
  return j;
})();

const BACK = {
  from: OUT.to, to: OUT.from,
  plat: OUT.arrPlat,
  dep: shift(OUT.dep, EVENING_SHIFT_MINUTES), arr: shift(OUT.arr, EVENING_SHIFT_MINUTES),
  head: '', arrPlat: '',
  legs: OUT.legs.slice().reverse().map((l) => ({ code: l.code, mins: l.mins })),
  chg: { at: OUT.chg.at, mins: OUT.chg.mins, pIn: '', pOut: '' }
};

/* D4: what a saved row may state without fetching anything is what the DEVICE
   already knows — how far away its origin is, and when you last rode it. */
const SAVED_SCALARS = [
  { dist: '120 m', rode: 'Rode it this morning', near: true, next: '3 min' },
  { dist: '14 km', rode: 'Last ridden Friday', near: false, next: null },
  { dist: '38 km', rode: 'Last ridden 12 Aug', near: false, next: '09:31' }
];

const SAVED = [
  { table: RHODES, journey: OUT },
  { table: CENTRAL, journey: journeyOf(CENTRAL.services[0], CENTRAL.from, CENTRAL.to) },
  { table: TALLAWONG, journey: { legs: [{ code: TALLAWONG.services[0].line, mins: 38 }] } }
];

const BOARD_TRIPS = SAVED.map((s, i) => ({
  from: s.table.from, to: s.table.to, line: s.table.services[0].line,
  near: SAVED_SCALARS[i].near, dist: SAVED_SCALARS[i].dist,
  next: SAVED_SCALARS[i].next || s.table.services[1].dep
}));

const HOME_TRIPS = SAVED.map((s, i) => ({
  from: s.table.from, to: s.table.to,
  legs: s.journey.legs,
  dist: SAVED_SCALARS[i].dist, rode: SAVED_SCALARS[i].rode
}));

/* D5 */
const HOME_TRIPS_MANY = HOME_TRIPS.concat([
  { from: 'Meadowbank', to: 'Town Hall', legs: [{ code: 'T9', mins: 24 }], dist: '1.6 km', rode: 'Last ridden 8 Aug' },
  { from: 'Epping', to: 'Chatswood', legs: [{ code: 'M1', mins: 13 }], dist: '9 km', rode: 'Never ridden' }
]);

const RECENT = ['Bondi Junction', 'Town Hall', 'Chatswood'];
const MATCHES = [{ name: 'Rhodes', hit: 'Rhode', tail: 's', line: 'T9', why: 'Best match' }];

const BOARD_SCENARIOS = {
  hero: { trip: 'RHODES', now: '09:21' },
  past: { trip: 'RHODES', now: '10:12', scrolled: true, late: { 2: 2 } },
  deep: { trip: 'RHODES', now: '10:42', scrolled: true, late: { 0: 6, 2: 2 } },
  delayed: { trip: 'RHODES', now: '09:21', late: { 0: 6, 2: 2 } },
  cancelled: { trip: 'RHODES', now: '09:21', cx: [0] },
  tight: { trip: 'RHODES', now: '09:21', tight: { 0: { in: shift(RHODES.services[0].chg.in, TIGHT_DELTA.legLate), was: OUT.chg.mins } } },
  focused: { trip: 'RHODES', now: '09:21', focus: 0 },
  riding: { trip: 'RHODES', now: '09:33', focus: 0, scrolled: true },
  long: { trip: 'CENTRAL', now: '22:45' },
  trips: { trip: 'RHODES', now: '09:21', screen: 'trips' },
  ask: { trip: 'RHODES', now: '09:21', screen: 'ask' }
};

const HOME_SCENARIOS = {
  before: { now: '09:09', j: 'OUT', fix: 'Rhodes', dist: '120 m' },
  leave: { now: '09:20', j: 'OUT', fix: 'Rhodes', dist: '120 m', leave: '120 m' },
  board: { now: '09:33', j: 'OUT', fix: 'Rhodes', dist: '120 m' },
  change: { now: '09:53', j: 'OUT', fix: 'Rhodes', dist: '120 m' },
  wide: { now: '09:53', j: 'WIDE', fix: 'Rhodes', dist: '120 m' },
  final: { now: '10:01', j: 'OUT', fix: 'Rhodes', dist: '120 m' },
  arrive: { now: '10:06', j: 'OUT', fix: 'Rhodes', dist: '120 m' },
  done: { now: '10:11', j: 'OUT', fix: 'Bondi Junction', dist: '90 m', over: true },
  tight: { now: '09:47', j: 'TIGHT', fix: 'Rhodes', dist: '120 m' },
  cxl: { now: '09:21', j: 'CXL', fix: 'Rhodes', dist: '120 m' },
  back: { now: '18:12', j: 'BACK', fix: 'Bondi Junction', dist: '250 m', rode: { dep: '09:24' } },
  moved: { now: '18:12', j: 'BACK', fix: 'Bondi Junction', dist: '250 m', rode: { dep: '09:24' }, moved: 'Central' },
  nofix: { now: '09:09', j: 'OUT', fix: null },
  ask: { now: '09:09', j: 'OUT', fix: null, ask: true },
  many: { now: '09:33', j: 'OUT', fix: 'Rhodes', dist: '120 m', many: true },
  add: { now: '09:09', j: 'OUT', fix: 'Rhodes', dist: '120 m', screen: 'add' },
  save: { now: '09:09', j: 'OUT', fix: 'Rhodes', dist: '120 m', screen: 'save' }
};

/* A job may name a scenario the concept RESOLVES rather than one the catalogue
   holds: `landing` renders `past` unscrolled, which is the only way to
   photograph "the board never opens inside the past". */
const BOARD_ALIASES = { landing: 'past' };

function serialise(value, refs, indent) {
  const pad2 = ' '.repeat(indent);
  if (Array.isArray(value)) {
    const parts = value.map((v) => serialise(v, refs, indent + 2));
    const flat = '[' + parts.join(', ') + ']';
    if (flat.length <= 92) return flat;
    return '[\n' + parts.map((p) => pad2 + '  ' + p).join(',\n') + '\n' + pad2 + ']';
  }
  if (value && typeof value === 'object') {
    const parts = Object.keys(value).map((k) => {
      const ref = refs && refs[k] && typeof value[k] === 'string' ? value[k] : null;
      return key(k) + ': ' + (ref || serialise(value[k], refs, indent + 2));
    });
    const flat = '{ ' + parts.join(', ') + ' }';
    if (flat.length <= 92) return flat;
    return '{\n' + parts.map((p) => pad2 + '  ' + p).join(',\n') + '\n' + pad2 + '}';
  }
  return JSON.stringify(value);
}

function key(k) {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
}

function declaration(name, value, refs) {
  return 'var ' + name + ' = ' + serialise(value, refs, 0) + ';\n';
}

function deltaBlock(deltas) {
  return deltas
    .map((d) => ' *   ' + (d.name ? '`' + d.id + '` ' + d.name : '`' + d.id + '`') + ': ' + d.text)
    .join('\n');
}

const SOURCE_NOTE = ' * SOURCE trip_rhodes_bondijunction.json — 11 journeys; the five routed via the\n'
  + ' *   "On Demand - Inner West" bus (upstream product class 10) are excluded\n'
  + ' *   server-side per docs/contracts/api.md, so a client sees six. Two of the six\n'
  + ' *   return isRealtimeControlled: null on the first leg => SCHEDULED.\n'
  + ' * SOURCE trip_central_parramatta.json — 6 journeys, all single-leg. Carries the\n'
  + ' *   longest real headsign in the repo ("Mount Victoria via Parramatta") and the\n'
  + ' *   only two-digit platforms (7/8/12/13).\n'
  + ' * SOURCE trip_tallawong_chatswood.json — the metro saved trip’s identity.\n';

function head(title, deltas) {
  return '/* ' + title + '\n'
    + ' *\n'
    + ' * GENERATED by tools/comps/scenarios.js from tools/fixtures/. Do not hand-edit:\n'
    + ' * regenerate instead, so a comp can never drift from the product’s own data.\n'
    + ' * Every clock time is read out of a captured fixture and converted UTC -> AEST\n'
    + ' * (+10). Minute arithmetic is web/js/time.js’s: both sides floored to the clock\n'
    + ' * minute, so a figure always agrees with the clock times printed beside it.\n'
    + ' *\n'
    + ' * THE DELTAS APPLIED, and there are no others. The fixtures were captured on\n'
    + ' * days with no disruption (estimated === planned on every leg), so a delayed or\n'
    + ' * cancelled board cannot be shown without one. Name every one of these in the\n'
    + ' * sheet’s lede, or the owner rules on a fixture artifact by mistake.\n'
    + deltaBlock(deltas) + '\n'
    + ' *\n'
    + SOURCE_NOTE
    + ' *\n'
    + ' * Classic script under file:// — every name below is a deliberate global.\n'
    + ' */\n';
}

function renderBoardData() {
  return head('Board comps — real data only.', DELTAS)
    + '\n'
    + declaration('RHODES', RHODES)
    + '\n'
    + declaration('CENTRAL', CENTRAL)
    + '\n'
    + '/* client-storage.md: saved trips live on the device. */\n'
    + declaration('TRIPS', BOARD_TRIPS)
    + '\n'
    + declaration('SCENARIOS', BOARD_SCENARIOS, { trip: true })
    + '\n'
    + '/* A concept may resolve a job name the catalogue does not hold:\n'
    + Object.keys(BOARD_ALIASES).map((a) => '   `' + a + '` renders `' + BOARD_ALIASES[a] + '` unscrolled.').join('\n') + ' */\n'
    + '\nfunction scenarioName() {\n'
    + "  var m = /[?&]s=([a-z-]+)/.exec(location.search);\n"
    + "  return m ? m[1] : Object.keys(SCENARIOS)[0];\n"
    + '}\n';
}

function renderHomeData() {
  return head('Home comps — real data only.', HOME_DELTAS)
    + '\n'
    + declaration('OUT', OUT)
    + '\n/* D7 */\n'
    + declaration('TIGHT', TIGHT)
    + '\n/* D6, a measurement rather than a journey. */\n'
    + declaration('WIDE', WIDE)
    + '\n/* D8 */\n'
    + declaration('CXL', CXL)
    + '\n/* D1 + D2 + D3 */\n'
    + declaration('BACK', BACK)
    + '\n'
    + declaration('TRIPS', HOME_TRIPS)
    + '\n/* D5 */\n'
    + declaration('TRIPS_MANY', HOME_TRIPS_MANY)
    + '\n'
    + declaration('RECENT', RECENT)
    + declaration('MATCHES', MATCHES)
    + '\n'
    + declaration('SCENARIOS', HOME_SCENARIOS, { j: true })
    + '\nfunction scenarioName() {\n'
    + "  var m = /[?&]s=([a-z-]+)/.exec(location.search);\n"
    + "  return m ? m[1] : Object.keys(SCENARIOS)[0];\n"
    + '}\n';
}

module.exports = {
  RHODES, CENTRAL, TALLAWONG,
  OUT, TIGHT, WIDE, CXL, BACK,
  BOARD_TRIPS, HOME_TRIPS, HOME_TRIPS_MANY, RECENT, MATCHES,
  BOARD_SCENARIOS, HOME_SCENARIOS, BOARD_ALIASES,
  DELTAS, HOME_DELTAS,
  renderBoardData, renderHomeData,
  span, shift, clockAest, plannedJourneys, EXCLUDED_PRODUCT_CLASS
};
