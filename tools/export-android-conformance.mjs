// Regenerate shared prediction cases from the web reference: node tools/export-android-conformance.mjs.
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { predict, locate, scoreCandidate, historyEvidence, automaticHomeOf } from '../web/js/predict.js';
import { here, sightingOf, trainSpeed } from '../web/js/stations.js';
import {
  inferFromRecords, inferOnBoard, onBoardRequests, replacesLastOpen, retiresSnapshot, runningJourney, startable,
  stoppedTrip, writeLastOpen
} from '../web/js/focus.js';
import { readFileSync } from 'node:fs';
import { boardModel } from '../web/js/rowmodel.js';
import { NOW, departuresBody, TRANSFER_NOW, TRANSFER_DEPARTED_NOW, transferBody,
  threeLegJourney, FERRY_NOW, ferryBody } from '../web/test/fixture.js';

process.env.TZ = 'Australia/Sydney';
const station = (id, name, lat, lon) => ({ id, name, location: { lat, lon }, modes: ['train'] });
const rhodes = station('213820', 'Rhodes', -33.8308, 151.0879);
const central = station('200060', 'Central', -33.884, 151.206);
const bondi = station('202210', 'Bondi Junction', -33.891, 151.248);
const stations = [rhodes, central, bondi];
const trips = [{ id: 'a', from: rhodes, to: central, createdAt: '2026-09-01T00:00:00+10:00' }, { id: 'b', from: rhodes, to: bondi, createdAt: '2026-09-01T00:00:00+10:00' }];
const now = '2026-09-07T08:00:00+10:00';
const history = ['2026-09-02T08:00:00+10:00', '2026-09-03T09:00:00+10:00', '2026-09-04T07:00:00+10:00'].map(t => ({ tripId: 'b', direction: 'forward', t }));
const base = { schemaVersion: 1, trips, history: [], rides: [], homeVotes: [], preferences: { useLocation: true }, lastViewed: null };
const view = (tripId, t, direction = 'forward') => ({ tripId, direction, t });
const repeated = Array.from({ length: 12 }, (_, minute) => view('b', `2026-09-04T08:${String(minute).padStart(2, '0')}:00+10:00`));
const routine = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map(day => view('a', `${day}T08:00:00+10:00`));
const closeScores = ['2026-09-02', '2026-09-03'].flatMap(day => [view('a', `${day}T08:00:00+10:00`), view('b', `${day}T08:01:00+10:00`)]);
const habitCases = [
  { name: 'one day of repeated checks cannot outweigh four commute days', history: [...routine, ...repeated], lastViewed: { tripId: 'b', direction: 'forward' }, wanted: ['a', false] },
  { name: 'one day alone cannot override the last viewed trip', history: repeated, lastViewed: { tripId: 'a', direction: 'reverse' }, wanted: ['a', true] },
  { name: 'a tiny recency lead retains the last viewed trip', history: closeScores, lastViewed: { tripId: 'a', direction: 'forward' }, wanted: ['a', false] },
  { name: 'two independent days can establish a clear habit', history: history.slice(0, 2), wanted: ['b', false] },
  { name: 'repeated checks do not beat a local homeward fallback', history: repeated, fix: rhodes.location, homeVotes: ['2026-09-02', '2026-09-03', '2026-09-04'].map(day => ({ day, station: central })), wanted: ['a', false] },
  { name: 'established local history still outranks homeward fallback', history, fix: rhodes.location, homeVotes: ['2026-09-02', '2026-09-03', '2026-09-04'].map(day => ({ day, station: central })), wanted: ['b', false] },
  { name: 'future views cannot establish a habit', history: ['2026-09-08', '2026-09-09'].map(day => view('b', `${day}T08:00:00+10:00`)), wanted: ['a', false] },
  { name: 'expired weak history cannot override a recent explicit choice', history: ['2025-09-02', '2025-09-03'].map(day => view('b', `${day}T08:00:00+10:00`)), wanted: ['a', false] },
  { name: 'forward and reverse evidence stays separate', history: [view('b', '2026-09-03T08:00:00+10:00'), view('b', '2026-09-04T08:00:00+10:00', 'reverse')], wanted: ['a', false] },
  { name: 'DST repeated hour is still one local date', now: '2026-04-12T02:45:00+10:00', history: [view('b', '2026-04-05T02:30:00+11:00'), view('b', '2026-04-05T02:30:00+10:00')], wanted: ['a', false] },
].map(({ history, lastViewed = null, homeVotes = [], ...rest }) => ({ ...rest, fix: rest.fix || null, doc: { ...base, history, lastViewed, homeVotes } }));
const cases = [
  ...habitCases,
  { name: 'empty history chooses first saved trip', doc: base, fix: null },
  { name: 'tied scores retain explicit reverse', doc: { ...base, lastViewed: { tripId: 'b', direction: 'reverse' } }, fix: null },
  { name: 'matching commute hours beat fallback', doc: { ...base, history }, fix: null },
  { name: 'standing at destination chooses real return pair', doc: base, fix: central.location },
  { name: 'disabled location cannot change prediction', doc: { ...base, preferences: { useLocation: false } }, fix: central.location },
  { name: 'relevant origin history outranks home fallback', doc: { ...base, history }, fix: rhodes.location },
  { name: 'three first-open votes infer home', doc: { ...base, homeVotes: ['2026-09-02', '2026-09-03', '2026-09-04'].map(day => ({ day, station: bondi })) }, fix: rhodes.location },
  { name: 'weekend midnight uses circular hour proximity', now: '2026-09-06T00:10:00+10:00', doc: { ...base, history: [{ tripId: 'b', direction: 'reverse', t: '2026-09-05T23:50:00+10:00' }] }, fix: null },
];
/* Rule 2 of commute-reliability, on the index's own points: Gadigal is 152 m
   from Town Hall. Each case declares its intended place and answer. */
const townHall = station('200070', 'Town Hall Station', -33.873596, 151.206899);
const gadigal = { ...station('200066', 'Gadigal Station', -33.873866, 151.208509), modes: ['metro'] };
const rhodesPoint = station('213820', 'Rhodes Station', -33.83053, 151.087032);
const centralPoint = station('200060', 'Central Station', -33.883882, 151.205829);
const city = [townHall, gadigal, rhodesPoint, centralPoint];
const evening = '2026-10-01T17:30:00+10:00';
const eveningMs = Date.parse(evening);
const cityDoc = { ...base, trips: [{ id: 'th', from: rhodesPoint, to: townHall, createdAt: '2026-09-01T00:00:00+10:00' }] };
const fixAt = (lat, lon, extra = {}) => ({ lat, lon, at: eveningMs, accuracy: 10, ...extra });
const placeCases = [
  { name: 'a saved station at 269 m beats an unsaved one at 119 m', fix: fixAt(-33.8738, 151.209799),
    wantedHere: ['200070', 1, '200070'], wanted: ['th', true] },
  { name: 'a saved station at 342 m is here but no sighting', fix: fixAt(-33.8738, 151.210599),
    wantedHere: ['200070', 1, null], wanted: ['th', true] },
  { name: 'an unsaved station within 200 m answers when no saved end is within 400 m',
    doc: { ...base, trips: [{ id: 'cr', from: rhodesPoint, to: centralPoint, createdAt: '2026-09-01T00:00:00+10:00' }] },
    fix: fixAt(-33.8738, 151.209799), wantedHere: ['200066', 1, '200066'], wantedKind: 'pair' },
  { name: 'a fix reporting train speed has no here', fix: fixAt(-33.873596, 151.206899, { speed: 12 }),
    wantedHere: null, wanted: ['th', false] },
  { name: 'a fix 600 m on from one 30 s earlier is at train speed', fix: fixAt(-33.873596, 151.206899),
    previousFix: { lat: -33.879, lon: 151.2069, at: eveningMs - 30_000, accuracy: 10 },
    wantedHere: null, wanted: ['th', false] },
  { name: 'a walking pair of fixes keeps here', fix: fixAt(-33.873596, 151.206899),
    previousFix: { lat: -33.8738, lon: 151.2069, at: eveningMs - 30_000, accuracy: 10 },
    wantedHere: ['200070', 1, '200070'], wanted: ['th', true] },
  { name: 'a previous fix over 120 s old cannot derive train speed', fix: fixAt(-33.873596, 151.206899),
    previousFix: { lat: -33.92, lon: 151.2069, at: eveningMs - 120_001, accuracy: 10 },
    wantedHere: ['200070', 1, '200070'], wanted: ['th', true] },
].map(value => ({ doc: cityDoc, now: evening, stations: city, ...value }));
const out = [...cases, ...placeCases].map(value => {
  const time = Date.parse(value.now || now);
  const where = value.stations || stations;
  const answer = locate(value.doc, time, { stations: where, fix: value.fix, previousFix: value.previousFix });
  if (value.wanted) assert.deepEqual([answer.tripId, answer.direction === 'reverse'], value.wanted, value.name);
  if (value.wantedKind) assert.equal(answer.kind, value.wantedKind, value.name);
  const spot = here(value.doc, where, value.fix, value.previousFix);
  const placed = spot ? [spot.station.id, spot.tier, sightingOf(spot, value.fix)?.id || null] : null;
  if (Object.hasOwn(value, 'wantedHere')) assert.deepEqual(placed, value.wantedHere, value.name);
  const { wantedHere, wantedKind, ...recorded } = value;
  return { ...recorded, now: value.now || now, stations: where, expected: {
    selection: answer.kind === 'trip' ? { tripId: answer.tripId, reverse: answer.direction === 'reverse' } : null,
    noLocation: predict(value.doc, time),
    home: automaticHomeOf(value.doc)?.station?.id || null,
    here: spot ? { stationId: spot.station.id, tier: spot.tier } : null,
    sighting: sightingOf(spot, value.fix)?.id || null,
    scores: value.doc.trips.flatMap(t => ['forward', 'reverse'].map(direction => ({ tripId: t.id, reverse: direction === 'reverse', value: scoreCandidate(value.doc.history, t.id, direction, time), days: historyEvidence(value.doc.history, t.id, direction, time).days, receiptDays: historyEvidence(value.doc.history, t.id, direction, time).receiptDays })))
  } };
});
mkdirSync(new URL('./fixtures/conformance/', import.meta.url), { recursive: true });
writeFileSync(new URL('./fixtures/conformance/prediction.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');

const sourceBoard = JSON.parse(readFileSync(new URL('./fixtures/departures_pyrmont_doublebay.json', import.meta.url), 'utf8'));
const original = sourceBoard.journeys[0];
const rowNow = Date.parse('2026-09-07T10:00:00+10:00');
const rowCases = [
  { name: 'scheduled next service', offset: 5, realtime: false },
  { name: 'fresh realtime next service', offset: 5, realtime: true },
  { name: 'delayed service', offset: 5, realtime: true, delay: 6 },
  { name: 'cancelled service', offset: 5, realtime: true, cancelled: true },
  { name: 'departing realtime service', offset: 0, realtime: true },
  { name: 'departing scheduled service', offset: 0, realtime: false },
  { name: 'rounded hour figure', offset: 100, realtime: true },
  { name: 'live at horizon', offset: 40, realtime: true },
  { name: 'beyond horizon on time', offset: 41, realtime: true },
  { name: 'beyond horizon late', offset: 41, realtime: true, delay: 6 },
  { name: 'early estimate at horizon', offset: 43, realtime: true, delay: -2 },
  { name: 'beyond horizon cancelled', offset: 41, realtime: true, cancelled: true },
  { name: 'expired realtime keeps figure and absolute clocks', offset: 5, realtime: true, age: 91 },
  { name: 'network failure keeps countdown', offset: 5, realtime: true, offline: true },
  { name: 'scheduled past register', offset: -12, realtime: false, past: true },
  { name: 'cancelled past service', offset: -12, realtime: true, cancelled: true, past: true },
].map(c => {
  const journey = structuredClone(original);
  const shift = rowNow + c.offset * 60_000 - Date.parse(original.departure.scheduled);
  for (const part of [journey, ...journey.legDetail]) {
    for (const key of ['departure', 'arrival']) {
      part[key].scheduled = new Date(Date.parse(part[key].scheduled) + shift).toISOString();
      part[key].estimated = c.realtime ? new Date(Date.parse(part[key].scheduled) + (c.delay || 0) * 60_000).toISOString() : null;
    }
    part.cancelled = !!c.cancelled;
  }
  const body = { ...sourceBoard, generatedAt: new Date(rowNow - (c.age || 0) * 1000).toISOString(), journeys: [journey] };
  const model = boardModel(c.past ? { ...body, journeys: [] } : body, rowNow, { forceStale: !!c.offline, pastBodies: c.past ? [body] : [] });
  const row = (c.past ? model.pastRows : model.rows)[0];
  return { name: c.name, sourceFixture: 'departures_pyrmont_doublebay.json journey 0', syntheticDelta: c, now: rowNow, body,
    expected: { figure: row.figure, provenance: row.provenance, depTime: row.depTime, arrTime: row.arrTime, past: row.past } };
});
writeFileSync(new URL('./fixtures/conformance/rows.json', import.meta.url), JSON.stringify(rowCases, null, 2) + '\n');

function canonicalSingleLegBody(body) {
  return { ...body, journeys: body.journeys.map(journey => {
    if (journey.legDetail) return journey;
    if (journey.legs !== 1) throw new Error('Only direct captured journeys can expand legacy leg fields');
    return { ...journey, legDetail: [{
      line: journey.line,
      headsign: journey.destinationHeadsign,
      from: { ...body.from, platform: journey.departure.platform },
      to: { ...body.to, platform: null },
      departure: { scheduled: journey.departure.scheduled, estimated: journey.departure.estimated },
      arrival: { scheduled: journey.arrival.scheduled, estimated: journey.arrival.estimated },
      cancelled: journey.cancelled,
    }] };
  }) };
}

const calibration = {
  source: 'Mapped from the captured TfNSW fixtures named in web/test/fixture.js; legacy direct rows expand to canonical legDetail without invented fields; threeLeg is its declared two-change stress delta.',
  central: { now: NOW, body: canonicalSingleLegBody(departuresBody()) },
  transfer: { now: TRANSFER_NOW, departedNow: TRANSFER_DEPARTED_NOW, body: transferBody() },
  threeLeg: { now: TRANSFER_NOW, body: transferBody({ journeys: [threeLegJourney()] }) },
  ferry: { now: FERRY_NOW, body: ferryBody() },
};
writeFileSync(new URL('./fixtures/conformance/calibration.json', import.meta.url), JSON.stringify(calibration, null, 2) + '\n');

/* inference.json: commute-reliability rules 3, 5 and 6. Inputs are built here;
   every expected value is declared by hand from design.md and only checked,
   never copied, against the web implementation. */
const sydney = (hhmmss) => `2026-10-01T${hhmmss.length === 5 ? hhmmss + ':00' : hhmmss}+10:00`;
const ms = (hhmmss) => Date.parse(sydney(hhmmss));
const place = (id, name, lat, lon) => ({ id, name, location: { lat, lon } });
const RHODES = place('213820', 'Rhodes Station', -33.83053, 151.087032);
const TOWN_HALL = place('200070', 'Town Hall Station', -33.873596, 151.206899);
const REDFERN = place('201510', 'Redfern Station', -33.89237, 151.198485);
const STRATHFIELD = place('213510', 'Strathfield Station', -33.87181, 151.094427);
const stop = ({ id, name }) => ({ id, name });
const clockOf = (millis) => new Date(millis + 10 * 3_600_000).toISOString().slice(0, 19) + '+10:00';

/* An on-time T9 from Rhodes: Redfern 22 minutes on, Town Hall 27. `from`
   turns it round for the evening run home. */
function t9(departure, to = TOWN_HALL, { from = RHODES, rideMinutes = null, lateMinutes = 0, cancelled = false } = {}) {
  const leave = ms(departure);
  const ride = rideMinutes ?? ([to.id, from.id].includes(REDFERN.id) ? 22 : 27);
  const times = (at) => ({ scheduled: clockOf(at), estimated: clockOf(at + lateMinutes * 60_000) });
  const leg = {
    line: { name: 'T9', mode: 'train' }, headsign: 'Hornsby via Strathfield',
    from: { ...stop(from), platform: 'Platform 1' }, to: { ...stop(to), platform: 'Platform 3' },
    departure: times(leave), arrival: times(leave + ride * 60_000), cancelled
  };
  return {
    departure: { ...leg.departure, platform: 'Platform 1' }, arrival: { ...leg.arrival },
    line: leg.line, destinationHeadsign: leg.headsign, stopsAway: null, cancelled, legs: 1, legDetail: [leg]
  };
}
const keyOf = (journey) => journey.legDetail.map((leg) => [leg.line.name, leg.departure.scheduled]);
const commuteTrips = [
  { id: 'rt', from: RHODES, to: TOWN_HALL, createdAt: '2026-09-01T00:00:00+10:00' },
  { id: 'rr', from: RHODES, to: REDFERN, createdAt: '2026-09-01T00:00:00+10:00' }
];
function commuteDoc(patch = {}) {
  return {
    schemaVersion: 1, trips: commuteTrips, history: [], rides: [], searches: { from: [], to: [] },
    homeVotes: [], lastOpen: null, lastViewed: null, preferences: { useLocation: true }, cache: {}, ...patch
  };
}
const record = (at, journey, { station = RHODES, tripId = 'rt', direction = 'forward' } = {}) =>
  ({ at: sydney(at), station: station && stop(station), tripId, direction, journey });
const incomingRecord = (journey, { station = RHODES, tripId = 'rt', direction = 'forward' } = {}) =>
  ({ station: station && stop(station), tripId, direction, journey });
const fixAtPlace = (where, at, extra = {}) => ({ lat: where.location.lat, lon: where.location.lon, at: ms(at), accuracy: 10, ...extra });

const SEEN = record('07:58', t9('08:00'));
const holdCases = [
  ['an unsighted write cannot replace a held record after departure', '08:01:30', incomingRecord(t9('08:08'), { station: null }), null, 'stored'],
  ['an unsighted write cannot replace a held record before departure', '07:59', incomingRecord(t9('08:00'), { station: null }), null, 'stored'],
  ['a write sighted at an intermediate station cannot replace it', '08:06', incomingRecord(t9('08:08'), { station: STRATHFIELD }), '08:06', 'stored'],
  ['a same-origin sighting before departure replaces it', '07:59:30', incomingRecord(t9('08:00')), '07:59:30', 'incoming'],
  ['a same-origin sighting for another trip before departure replaces it', '07:59:30', incomingRecord(t9('08:00', REDFERN), { tripId: 'rr' }), '07:59:30', 'incoming'],
  ['a same-origin sighting 59.999 s after departure cannot replace it', '08:01:00', incomingRecord(t9('08:08')), '08:00:59.999', 'stored'],
  ['a same-origin sighting 60 s after departure replaces it', '08:01:00', incomingRecord(t9('08:08')), '08:01:00', 'incoming'],
  ['a sighting fix taken before departure cannot replace it after departure', '08:02', incomingRecord(t9('08:08')), '07:59:30', 'stored'],
].map(([name, now, incoming, sightingAt, kept]) => ({
  name, doc: commuteDoc({ lastOpen: SEEN }), nowMs: ms(now), incoming,
  sightingAt: sightingAt === null ? null : ms(sightingAt), expectedKept: kept
}));
holdCases.push(...[
  ['an unsighted stored record is not held', record('07:58', t9('08:00'), { station: null }), '08:01:30'],
  ['a record seen 15 min 1 s before departure is not held', record('07:44:59', t9('08:00')), '08:01:30'],
  ['a record seen after its own departure is not held', record('08:00:01', t9('08:00')), '08:01:30'],
  ['a record past arrival plus 30 min is not held', SEEN, '08:57:01'],
  ['a record whose trip was deleted is not held', record('07:58', t9('08:00'), { tripId: 'gone' }), '08:01:30'],
].map(([name, stored, now]) => ({
  name, doc: commuteDoc({ lastOpen: stored }), nowMs: ms(now),
  incoming: incomingRecord(t9('08:16'), { station: null }), sightingAt: null, expectedKept: 'incoming'
})));
holdCases.push({
  name: 'a record seen exactly 15 min before departure is held', doc: commuteDoc({ lastOpen: record('07:45', t9('08:00')) }),
  nowMs: ms('08:01:30'), incoming: incomingRecord(t9('08:08'), { station: null }), sightingAt: null, expectedKept: 'stored'
}, {
  name: 'a record at arrival plus 30 min exactly is held', doc: commuteDoc({ lastOpen: SEEN }),
  nowMs: ms('08:57'), incoming: incomingRecord(t9('08:16'), { station: null }), sightingAt: null, expectedKept: 'stored'
});
for (const value of holdCases) {
  const replaced = replacesLastOpen(value.doc, value.incoming, value.nowMs, value.sightingAt);
  assert.equal(replaced ? 'incoming' : 'stored', value.expectedKept, value.name);
}

const writeOf = (at, journey, options = {}, sightingAt = null) =>
  ({ nowMs: ms(at), record: incomingRecord(journey, options), sightingAt: sightingAt === null ? null : ms(sightingAt) });
const platform = (journey, tripId = 'rt') => ({ via: 'platform', tripId, direction: 'forward', journeyKey: keyOf(journey) });
const entryCases = [
  { name: 'regression: the open snapshot alone enters', snapshot: SEEN, doc: commuteDoc(),
    nowMs: ms('08:10'), fix: fixAtPlace(STRATHFIELD, '08:10'), expected: platform(t9('08:00')) },
  { name: 'regression: the stored record alone enters', snapshot: null, doc: commuteDoc({ lastOpen: SEEN }),
    nowMs: ms('08:10'), fix: fixAtPlace(STRATHFIELD, '08:10'), expected: platform(t9('08:00')) },
  { name: 'regression: the open refresh writes an unsighted record before the fix', snapshot: SEEN,
    doc: commuteDoc({ lastOpen: SEEN }), writes: [writeOf('08:10', t9('08:16'), { station: null })],
    nowMs: ms('08:10:05'), fix: fixAtPlace(STRATHFIELD, '08:10:05'), expected: platform(t9('08:00')) },
  { name: 'regression: the open refresh writes first and no snapshot exists (the native race)', snapshot: null,
    doc: commuteDoc({ lastOpen: SEEN }), writes: [writeOf('08:10', t9('08:16'), { station: null })],
    nowMs: ms('08:10:05'), fix: fixAtPlace(STRATHFIELD, '08:10:05'), expected: platform(t9('08:00')) },
  { name: 'Home stayed open through boarding: the held record enters on a moving tick fix',
    snapshot: record('07:45', t9('08:00'), { station: null }), doc: commuteDoc({ lastOpen: SEEN }),
    writes: [writeOf('08:00:30', t9('08:08'), { station: null }), writeOf('08:01', t9('08:08'), { station: STRATHFIELD }, '08:01')],
    nowMs: ms('08:01:30'), fix: { lat: -33.8341, lon: 151.0868, at: ms('08:01:30'), accuracy: 10, speed: 14 },
    expected: platform(t9('08:00')) },
  { name: 'without movement toward the destination there is no entry', snapshot: SEEN, doc: commuteDoc({ lastOpen: SEEN }),
    nowMs: ms('08:10'), fix: fixAtPlace(RHODES, '08:10'), expected: null },
  { name: 'a recorded ride for the record journey blocks entry', snapshot: SEEN,
    doc: commuteDoc({ lastOpen: SEEN, rides: [{ tripId: 'rt', direction: 'forward', scheduledDeparture: '2026-10-01T08:00:00+10:00',
      departedAt: '2026-10-01T08:00:00+10:00', arrivedAt: '2026-10-01T08:27:00+10:00', from: stop(RHODES), to: stop(TOWN_HALL) }] }),
    nowMs: ms('08:10'), fix: fixAtPlace(STRATHFIELD, '08:10'), expected: null },
  { name: 'an unexpired focus blocks entry', snapshot: SEEN,
    doc: commuteDoc({ lastOpen: SEEN, focus: { tripId: 'rr', direction: 'forward', focusedAt: sydney('07:50'), by: 'focus', journey: t9('08:08', REDFERN) } }),
    nowMs: ms('08:10'), fix: fixAtPlace(STRATHFIELD, '08:10'), expected: null },
  { name: 'a journey whose mode is turned off cannot be entered', snapshot: SEEN,
    doc: commuteDoc({ lastOpen: SEEN, preferences: { useLocation: true, enabledModes: ['metro', 'ferry'] } }),
    nowMs: ms('08:10'), fix: fixAtPlace(STRATHFIELD, '08:10'), expected: null },
  { name: 'snapshot: a same-origin sighting 60 s after departure retires the departed train from the snapshot too',
    snapshot: SEEN, doc: commuteDoc({ lastOpen: SEEN }), writes: [writeOf('08:01:10', t9('08:08'), {}, '08:01:10')],
    nowMs: ms('08:12'), fix: fixAtPlace(STRATHFIELD, '08:12', { speed: 14 }), expected: platform(t9('08:08')) },
  { name: 'snapshot: a same-origin sighting fix taken 59.999 s after departure keeps it, though written later',
    snapshot: SEEN, doc: commuteDoc(), writes: [writeOf('08:01', t9('08:08'), {}, '08:00:59.999')],
    nowMs: ms('08:12'), fix: fixAtPlace(STRATHFIELD, '08:12', { speed: 14 }), expected: platform(t9('08:00')) },
  { name: 'snapshot: a same-origin sighting fix taken exactly 60 s after departure retires it',
    snapshot: SEEN, doc: commuteDoc(), writes: [writeOf('08:01', t9('08:08'), {}, '08:01')],
    nowMs: ms('08:12'), fix: fixAtPlace(STRATHFIELD, '08:12', { speed: 14 }), expected: platform(t9('08:08')) },
  { name: 'snapshot: a sighting at an intermediate station keeps it',
    snapshot: SEEN, doc: commuteDoc(), writes: [writeOf('08:06', t9('08:08'), { station: STRATHFIELD }, '08:06')],
    nowMs: ms('08:12'), fix: fixAtPlace(STRATHFIELD, '08:12', { speed: 14 }), expected: platform(t9('08:00')) },
  { name: 'snapshot: a same-origin sighting recording another saved trip retires it',
    snapshot: SEEN, doc: commuteDoc(), writes: [writeOf('08:01:10', t9('08:04', REDFERN), { tripId: 'rr' }, '08:01:10')],
    nowMs: ms('08:12'), fix: fixAtPlace(STRATHFIELD, '08:12', { speed: 14 }), expected: platform(t9('08:04', REDFERN), 'rr') },
  { name: 'a record written after its train left does not enter', doc: commuteDoc({ lastOpen: record('08:01:10', t9('08:00')) }),
    snapshot: null, nowMs: ms('08:10'), fix: fixAtPlace(STRATHFIELD, '08:10'), expected: null },
  { name: 'a record written as its train leaves still enters', doc: commuteDoc({ lastOpen: record('08:00', t9('08:00')) }),
    snapshot: null, nowMs: ms('08:10'), fix: fixAtPlace(STRATHFIELD, '08:10'), expected: platform(t9('08:00')) },
  { name: 'a platform sighting that re-records the departed train after it left enters it from neither record',
    snapshot: SEEN, doc: commuteDoc({ lastOpen: SEEN }), writes: [writeOf('08:01:10', t9('08:00'), {}, '08:01:10')],
    nowMs: ms('08:12'), fix: fixAtPlace(STRATHFIELD, '08:12', { speed: 14 }), expectedRequests: [], expected: null },
].map((value) => ({ writes: [], previousFix: null, boards: {}, cached: {}, ...value }));

function enteredBy(value) {
  let doc = value.doc;
  let snapshot = value.snapshot;
  for (const write of value.writes) {
    if (retiresSnapshot(doc, snapshot, write.record, write.sightingAt)) snapshot = null;
    doc = writeLastOpen(doc, write.record, write.nowMs, write.sightingAt);
  }
  const described = (via, focus) => focus && { via, tripId: focus.tripId, direction: focus.direction, journeyKey: keyOf(focus.journey) };
  const platformEntry = inferFromRecords(doc, snapshot, value.nowMs, value.fix);
  if (platformEntry) return described('platform', platformEntry);
  if (value.expectedRequests) {
    const asked = onBoardRequests(doc, value.nowMs, value.fix, value.previousFix, value.cached)
      .map(({ tripId, direction, from, to, at, limit }) => ({ tripId, direction, from, to, at, limit }));
    assert.deepEqual(asked, value.expectedRequests, value.name);
  }
  return trainSpeed(value.fix, value.previousFix)
    ? described('onBoard', inferOnBoard(doc, value.nowMs, value.fix, value.previousFix, value.boards, value.cached)) : null;
}
/* On board at Strathfield, 4.64 km from Rhodes: position progress is 0.309 toward
   Town Hall and 0.320 toward Redfern. At 08:10 the 08:00 T9 has 0.370 of its
   ride behind it (gap 0.062 to Town Hall, 0.135 to Redfern), the 08:08 has 0.074
   (0.235 and 0.229) and the 07:52 0.667 (0.358, and 0.818 to Redfern). */
const BURWOOD = place('213410', 'Burwood Station', -33.877315, 151.104762);
const ASHFIELD = place('213610', 'Ashfield Station', -33.887917, 151.125688);
const NORTH_STRATHFIELD = place('213710', 'North Strathfield Station', -33.858688, 151.087986);
const EPPING = place('212110', 'Epping Station', -33.772636, 151.082027);
const onBoardFix = (at, extra = {}) => fixAtPlace(STRATHFIELD, at, { speed: 14, ...extra });
const cameFrom = (at) => fixAtPlace(NORTH_STRATHFIELD, at);
const morningBoards = () => ({
  'rt|forward': ['07:52', '08:00', '08:08'].map((at) => t9(at)),
  'rr|forward': ['07:52', '08:00', '08:08'].map((at) => t9(at, REDFERN))
});
const onBoard = (journey, tripId = 'rt', direction = 'forward') => ({ via: 'onBoard', tripId, direction, journeyKey: keyOf(journey) });
const extraTrips = [
  { id: 'rb', from: RHODES, to: BURWOOD, createdAt: '2026-09-01T00:00:00+10:00' },
  { id: 'ra', from: RHODES, to: ASHFIELD, createdAt: '2026-09-01T00:00:00+10:00' }
];
const ask = (tripId, at, direction = 'forward') => {
  const trip = [...commuteTrips, ...extraTrips].find((item) => item.id === tripId);
  const ends = direction === 'forward' ? [trip.from, trip.to] : [trip.to, trip.from];
  return { tripId, direction, from: ends[0].id, to: ends[1].id, at: ms(at), limit: 10 };
};
const rtOnly = { trips: [commuteTrips[0]] };
const rrHabit = ['2026-09-28', '2026-09-29', '2026-09-30'].map((day) => ({ tripId: 'rr', direction: 'forward', t: `${day}T08:05:00+10:00` }));
const ride = (tripId, journey) => ({ tripId, direction: 'forward', scheduledDeparture: journey.departure.scheduled,
  departedAt: journey.departure.scheduled, arrivedAt: journey.arrival.scheduled, from: stop(RHODES), to: stop(journey.legDetail[0].to) });
const onBoardCases = [
  { name: 'on board: a heading toward the city decides forward and the closest progress wins',
    fix: onBoardFix('08:10', { heading: 90 }), boards: morningBoards(),
    expectedRequests: [ask('rr', '07:00'), ask('rt', '07:00')], expected: onBoard(t9('08:00')) },
  { name: 'on board: a heading back toward Rhodes decides reverse', doc: commuteDoc(rtOnly),
    nowMs: ms('18:10'), fix: onBoardFix('18:10', { heading: 350 }),
    boards: { 'rt|reverse': ['17:52', '18:00'].map((at) => t9(at, RHODES, { from: TOWN_HALL })) },
    expectedRequests: [ask('rt', '17:00', 'reverse')], expected: onBoard(t9('17:52', RHODES, { from: TOWN_HALL }), 'rt', 'reverse') },
  { name: 'on board: without a heading the previous fix decides', fix: onBoardFix('08:10'),
    previousFix: cameFrom('08:09'), boards: morningBoards(),
    expectedRequests: [ask('rr', '07:00'), ask('rt', '07:00')], expected: onBoard(t9('08:00')) },
  { name: 'on board: a derived train speed is enough, and the previous fix decides', fix: fixAtPlace(STRATHFIELD, '08:10'),
    previousFix: cameFrom('08:09'), boards: morningBoards(),
    expectedRequests: [ask('rr', '07:00'), ask('rt', '07:00')], expected: onBoard(t9('08:00')) },
  { name: 'on board: a heading with both destinations within 90 degrees leaves it to the previous fix',
    doc: commuteDoc(rtOnly), fix: onBoardFix('08:10', { heading: 40 }), previousFix: fixAtPlace(BURWOOD, '08:09'),
    boards: { 'rt|reverse': ['07:52', '08:00'].map((at) => t9(at, RHODES, { from: TOWN_HALL })) },
    expectedRequests: [ask('rt', '07:00', 'reverse')], expected: onBoard(t9('07:52', RHODES, { from: TOWN_HALL }), 'rt', 'reverse') },
  { name: 'on board: with neither a heading nor a previous fix the direction waits',
    fix: onBoardFix('08:10'), boards: morningBoards(), expectedRequests: [], expected: null },
  { name: 'on board: a fix below train speed is not on board', fix: onBoardFix('08:10', { speed: 3, heading: 90 }),
    boards: morningBoards(), expectedRequests: [], expected: null },
  { name: 'on board: no running service within 0.25 of the position', fix: onBoardFix('08:10', { heading: 90 }),
    boards: { 'rt|forward': [t9('07:52'), t9('08:16')], 'rr|forward': [t9('07:52', REDFERN), t9('08:16', REDFERN)] },
    expectedRequests: [ask('rr', '07:00'), ask('rt', '07:00')], expected: null },
  { name: 'on board: history breaks the tie between saved trips sharing a train', doc: commuteDoc({ history: rrHabit }),
    fix: onBoardFix('08:10', { heading: 90 }), boards: morningBoards(),
    expectedRequests: [ask('rr', '07:00'), ask('rt', '07:00')], expected: onBoard(t9('08:00', REDFERN), 'rr') },
  { name: 'on board: a recorded ride excludes its journey', doc: commuteDoc({ rides: [ride('rt', t9('08:00'))] }),
    fix: onBoardFix('08:10', { heading: 90 }), boards: morningBoards(),
    expectedRequests: [ask('rr', '07:00'), ask('rt', '07:00')], expected: onBoard(t9('08:00', REDFERN), 'rr') },
  { name: 'on board: a cancelled service is not a match', doc: commuteDoc(rtOnly),
    fix: onBoardFix('08:10', { heading: 90 }), boards: { 'rt|forward': [t9('08:00', TOWN_HALL, { cancelled: true }), t9('08:08')] },
    expectedRequests: [ask('rt', '07:00')], expected: onBoard(t9('08:08')) },
  { name: 'on board: outside the 1.5 corridor there is no candidate', fix: fixAtPlace(EPPING, '08:10', { speed: 14, heading: 80 }),
    boards: morningBoards(), expectedRequests: [], expected: null },
  { name: 'on board: within 1 km of the origin there is no candidate',
    fix: { lat: -33.838, lon: 151.0864, at: ms('08:02'), accuracy: 10, speed: 14, heading: 180 }, nowMs: ms('08:02'),
    boards: morningBoards(), expectedRequests: [], expected: null },
  { name: 'on board: within 1 km of the destination there is no candidate', doc: commuteDoc(rtOnly),
    fix: { lat: -33.879, lon: 151.2066, at: ms('08:25'), accuracy: 10, speed: 14, heading: 60 }, nowMs: ms('08:25'),
    boards: morningBoards(), expectedRequests: [], expected: null },
  { name: 'on board: at most three candidates, smallest corridor ratio first, so Town Hall is never evaluated',
    doc: commuteDoc({ trips: [...commuteTrips, ...extraTrips] }), fix: onBoardFix('08:10', { heading: 90 }),
    boards: morningBoards(), expectedRequests: [ask('rb', '07:00'), ask('ra', '07:00'), ask('rr', '07:00')],
    expected: onBoard(t9('08:00', REDFERN), 'rr') },
  { name: 'on board: the cached board\'s median ride sets how far back to look, so one long itinerary cannot',
    cached: { 'rt|forward': [t9('07:30'), t9('07:20', TOWN_HALL, { rideMinutes: 99 }), t9('07:38', TOWN_HALL, { rideMinutes: 31 })] },
    fix: onBoardFix('08:10', { heading: 90 }), boards: morningBoards(),
    expectedRequests: [ask('rr', '07:00'), ask('rt', '07:29')], expected: onBoard(t9('08:00')) },
  { name: 'on board: an even count of cached rides takes the lower middle one',
    cached: { 'rt|forward': [t9('07:38', TOWN_HALL, { rideMinutes: 31 }), t9('07:30')] },
    fix: onBoardFix('08:10', { heading: 90 }), boards: morningBoards(),
    expectedRequests: [ask('rr', '07:00'), ask('rt', '07:33')], expected: onBoard(t9('08:00')) },
  { name: 'on board: a platform-sighted record enters first', snapshot: SEEN,
    fix: onBoardFix('08:10', { heading: 90 }), boards: morningBoards(), expected: platform(t9('08:00')) },
  { name: 'on board: an unexpired focus blocks entry',
    doc: commuteDoc({ focus: { tripId: 'rr', direction: 'forward', focusedAt: sydney('07:50'), by: 'focus', journey: t9('08:08', REDFERN) } }),
    fix: onBoardFix('08:10', { heading: 90 }), boards: morningBoards(), expected: null },
].map((value) => ({ doc: commuteDoc(), snapshot: null, writes: [], previousFix: null, cached: {}, nowMs: ms('08:10'), ...value }));
entryCases.push(...onBoardCases);
for (const value of entryCases) assert.deepEqual(enteredBy(value), value.expected, value.name);
/* Stop trip on a guessed trip declines it (rule 6). departure is the web
   departureKey: the JSON-encoded [line name, scheduled departure] of the
   declined journey's first service leg. */
const declined = (tripId, at, journey, direction = 'forward') => ({
  tripId, direction, at: sydney(at), departure: JSON.stringify(keyOf(journey)[0]), arrival: journey.arrival.estimated
});
const declineCases = [
  { name: 'decline: holds platform entry for the declined trip', doc: commuteDoc({ ...rtOnly, lastOpen: SEEN,
    inferenceDeclined: declined('rt', '08:05', t9('07:52')) }), fix: fixAtPlace(STRATHFIELD, '08:10'), expected: null },
  { name: 'decline: holds on-board entry for the declined trip', doc: commuteDoc({ ...rtOnly,
    inferenceDeclined: declined('rt', '08:05', t9('07:52')) }), fix: onBoardFix('08:10', { heading: 90 }),
    boards: morningBoards(), expectedRequests: [], expected: null },
  { name: 'decline: holds only its own trip', doc: commuteDoc({ inferenceDeclined: declined('rr', '08:05', t9('07:52', REDFERN)) }),
    fix: onBoardFix('08:10', { heading: 90 }), boards: morningBoards(),
    expectedRequests: [ask('rt', '07:00')], expected: onBoard(t9('08:00')) },
  { name: 'decline: holds both directions of its trip', doc: commuteDoc({ ...rtOnly, lastOpen: SEEN,
    inferenceDeclined: declined('rt', '08:05', t9('07:52', RHODES, { from: TOWN_HALL }), 'reverse') }),
    fix: fixAtPlace(STRATHFIELD, '08:10'), expected: null },
  { name: 'decline: entry resumes an hour after the decline', doc: commuteDoc({ ...rtOnly,
    inferenceDeclined: declined('rt', '07:10', t9('06:52')) }), fix: onBoardFix('08:10', { heading: 90 }),
    boards: morningBoards(), expectedRequests: [ask('rt', '07:00')], expected: onBoard(t9('08:00')) },
  { name: 'decline: a long ride holds it until its arrival plus 30 min', nowMs: ms('09:39:59'), doc: commuteDoc({ ...rtOnly,
    inferenceDeclined: declined('rt', '08:05', t9('08:00', TOWN_HALL, { rideMinutes: 70 })) }),
    fix: onBoardFix('09:39:59', { heading: 90 }), boards: { 'rt|forward': [t9('09:30')] }, expectedRequests: [], expected: null },
  { name: 'decline: entry resumes at the declined journey\'s arrival plus 30 min', nowMs: ms('09:40'), doc: commuteDoc({ ...rtOnly,
    inferenceDeclined: declined('rt', '08:05', t9('08:00', TOWN_HALL, { rideMinutes: 70 })) }),
    fix: onBoardFix('09:40', { heading: 90 }), boards: { 'rt|forward': [t9('09:30')] },
    expectedRequests: [ask('rt', '08:30')], expected: onBoard(t9('09:30')) },
  { name: 'decline: the declined departure is never inferred again, even running late past the window',
    nowMs: ms('09:05'), doc: commuteDoc({ ...rtOnly, inferenceDeclined: declined('rt', '08:03', t9('08:00')) }),
    fix: fixAtPlace(REDFERN, '09:05', { speed: 14, heading: 60 }),
    boards: { 'rt|forward': [t9('08:00', TOWN_HALL, { lateMinutes: 40 }), t9('08:40')] },
    expectedRequests: [ask('rt', '07:55')], expected: onBoard(t9('08:40')) },
].map((value) => ({ doc: commuteDoc(), snapshot: null, writes: [], previousFix: null, boards: {}, cached: {}, nowMs: ms('08:10'), ...value }));
for (const value of declineCases) assert.deepEqual(enteredBy(value), value.expected, value.name);
entryCases.push(...declineCases);

const startCases = [
  ['shown 15 minutes before it leaves', '07:45', t9('08:00'), true],
  ['hidden 15 minutes and a second before it leaves', '07:44:59', t9('08:00'), false],
  ['shown as it leaves', '08:00', t9('08:00'), true],
  ['hidden once it has left', '08:00:01', t9('08:00'), false],
  ['hidden for a cancelled train', '07:50', t9('08:00', TOWN_HALL, { cancelled: true }), false],
  ['the window follows the estimate of a late train', '07:58', t9('08:00', TOWN_HALL, { lateMinutes: 5 }), true],
].map(([name, now, journey, expected]) => ({ name, nowMs: ms(now), journey, expectedStartable: expected }));
for (const value of startCases) assert.equal(startable(value.journey, value.nowMs), value.expectedStartable, value.name);

const runningCases = [
  ['not on its way before it leaves', '07:59:59', t9('08:00'), null, false],
  ['on its way as it leaves', '08:00', t9('08:00'), null, true],
  ['on its way a second before it arrives', '08:26:59', t9('08:00'), null, true],
  ['arrived at its arrival', '08:27', t9('08:00'), null, false],
  ['a cancelled train is never on its way', '08:10', t9('08:00', TOWN_HALL, { cancelled: true }), null, false],
  ['a train whose mode is turned off is not offered', '08:10', t9('08:00'), ['metro', 'ferry'], false],
  ['a late train runs on its estimates', '08:30', t9('08:00', TOWN_HALL, { lateMinutes: 5 }), null, true],
].map(([name, now, journey, modes, expected]) => ({ name, nowMs: ms(now), journey, enabledModes: modes, expectedRunning: expected }));
for (const value of runningCases) {
  assert.equal(runningJourney(value.journey, value.nowMs, value.enabledModes || ['train', 'metro', 'ferry']), value.expectedRunning, value.name);
}

/* Stop trip (rule 6, ruling 23). A started focus's pair is its journey's first
   service leg origin to its last service leg destination. */
const stopFocus = (by, journey, { tripId = 'rt', direction = 'forward' } = {}) =>
  ({ tripId, direction, focusedAt: sydney('07:55'), by, journey });
const older = declined('rr', '07:30', t9('07:00', REDFERN));
const unsaved = stopFocus('focus', t9('08:00', STRATHFIELD, { rideMinutes: 8 }), { tripId: 'rs' });
const stopCases = [
  { name: 'a guessed trip declines its own trip and direction and is reported',
    focus: stopFocus('inferred', t9('08:00')), nowMs: ms('08:05'), expectedEvent: true,
    expectedDecline: { tripId: 'rt', direction: 'forward', departure: '["T9","2026-10-01T08:00:00+10:00"]',
      arrival: ms('08:27'), at: ms('08:05') } },
  { name: 'a started trip on a saved pair declines that trip unreported, until its estimated arrival',
    focus: stopFocus('focus', t9('08:00', TOWN_HALL, { lateMinutes: 4 })), nowMs: ms('08:05'), expectedEvent: false,
    expectedDecline: { tripId: 'rt', direction: 'forward', departure: '["T9","2026-10-01T08:00:00+10:00"]',
      arrival: ms('08:31'), at: ms('08:05') } },
  { name: 'a started trip on the reverse of a saved pair declines that trip in reverse',
    focus: stopFocus('focus', t9('17:52', RHODES, { from: TOWN_HALL }), { direction: 'reverse' }), nowMs: ms('18:00'),
    expectedEvent: false,
    expectedDecline: { tripId: 'rt', direction: 'reverse', departure: '["T9","2026-10-01T17:52:00+10:00"]',
      arrival: ms('18:19'), at: ms('18:00') } },
  { name: 'a started trip on an unsaved pair writes no decline', focus: unsaved, nowMs: ms('08:05'),
    expectedEvent: false, expectedDecline: null },
  { name: 'a started stop replaces an older decline', doc: commuteDoc({ inferenceDeclined: older }),
    focus: stopFocus('focus', t9('08:00')), nowMs: ms('08:05'), expectedEvent: false,
    expectedDecline: { tripId: 'rt', direction: 'forward', departure: '["T9","2026-10-01T08:00:00+10:00"]',
      arrival: ms('08:27'), at: ms('08:05') } },
  { name: 'a stop that writes no decline keeps the older one', doc: commuteDoc({ inferenceDeclined: older }),
    focus: unsaved, nowMs: ms('08:05'), expectedEvent: false,
    expectedDecline: { tripId: 'rr', direction: 'forward', departure: '["T9","2026-10-01T07:00:00+10:00"]',
      arrival: ms('07:22'), at: ms('07:30') } },
].map((value) => ({ name: value.name, doc: commuteDoc(), ...value }));
for (const value of stopCases) {
  const legs = value.focus.journey.legDetail;
  const stopped = stoppedTrip({ ...value.doc, focus: value.focus }, value.focus,
    { from: legs[0].from, to: legs[legs.length - 1].to }, value.nowMs);
  const decline = stopped.doc.inferenceDeclined;
  assert.equal(stopped.doc.focus, undefined, value.name);
  assert.deepEqual(decline ? { ...decline, arrival: Date.parse(decline.arrival), at: Date.parse(decline.at) } : null,
    value.expectedDecline, value.name);
  assert.equal(stopped.declinedInferred, value.expectedEvent, value.name);
}

const inference = {
  description: 'commute-reliability rules 3, 5 and 6, shared by web, Android and iOS. Inputs are built by '
    + 'tools/export-android-conformance.mjs; every expected value is declared by hand from the design and only '
    + 'checked against the web implementation. Never regenerate an expectation from the code under test.',
  encoding: 'Top-level times (nowMs, sightingAt, writes[].nowMs, fix.at, previousFix.at) are integer epoch '
    + 'milliseconds. Inside doc, records and journeys, times are ISO 8601 strings exactly as the web document and '
    + 'the departures API carry them. doc is the web personal document (client-storage.md); lastOpen.at is the '
    + 'record write time. A fix omits speed, heading or accuracy when unknown; an omitted value is never zero. '
    + 'journeyKey is the ordered list of [line name, scheduled departure] for every service leg. '
    + 'doc.inferenceDeclined.departure is the web departureKey, the JSON-encoded [line name, scheduled departure] '
    + 'of the declined journey\'s first service leg.',
  holdCases: {
    run: 'With doc.lastOpen as the stored record, ask whether incoming (a record written at nowMs, sighted by a fix '
      + 'taken at sightingAt, or unsighted when station is null) replaces it. expectedKept is stored or incoming.',
    cases: holdCases
  },
  entryCases: {
    run: 'Apply each write in order. A write whose record is sighted at the origin of the snapshot\'s '
      + 'leg(trip, direction) on the saved trip (record.station.id equal to that origin\'s id), by a fix taken at '
      + 'sightingAt >= the snapshot journey\'s effective departure + 60 s, retires the snapshot: it is null from then '
      + 'on, whether or not the hold rule lets the write replace the stored record. The write\'s nowMs plays no part '
      + 'in retirement. Then the write goes through the hold rule (a write that replaces sets lastOpen = {at: its '
      + 'nowMs as ISO, ...record}). Then evaluate a Home fix at nowMs: platform-sighted inference from snapshot, then from '
      + 'the stored doc.lastOpen. Only when neither enters and the fix is at train speed (given previousFix), '
      + 'on-board entry: expectedRequests, when present, is the ordered list of departures requests '
      + '(from and to are station ids, at is epoch ms, limit the journey count) built from doc, fix, previousFix and '
      + 'cached (each pair\'s cached journeys, keyed <tripId>|<direction>; at = nowMs - (median + 10 min), the median '
      + 'being of the effective durations A - D >= 0 there, the lower middle for an even count, 60 min when none); '
      + 'boards answers each request by the same '
      + 'key with the journeys it returned. expected is null or the entered focus: via (platform or onBoard), '
      + 'tripId, direction and journeyKey.',
    cases: entryCases
  },
  startCases: {
    run: 'Home offers Start trip for its lead journey when expectedStartable: not cancelled and 0 <= D - nowMs <= 15 min, '
      + 'with D the effective (estimated, else scheduled) departure.',
    cases: startCases
  },
  runningCases: {
    run: 'A board row starts the trip at once when expectedRunning: D <= nowMs < A on effective times, not cancelled, '
      + 'and every service leg\'s mode enabled (enabledModes; null means all three) under the transfer cap.',
    cases: runningCases
  },
  stopCases: {
    run: 'Stop trip at nowMs with focus as the document\'s focus. A guessed focus (by inferred) declines its own tripId '
      + 'and direction. A started focus (by focus) declines the saved trip whose endpoints are the focus\'s pair, its '
      + 'journey\'s first service leg from.id to its last service leg to.id (the board a native focus carries): '
      + 'direction forward when trip.from -> trip.to is the pair, reverse when trip.to -> trip.from is; a pair no saved '
      + 'trip has in either direction declines nothing. A written decline replaces doc.inferenceDeclined with tripId, '
      + 'direction, departure (the web departureKey of the focus journey\'s first service leg), arrival (the focus '
      + 'journey\'s effective arrival, estimated else scheduled, composed with any recovery) and at (nowMs); a stop that '
      + 'writes none leaves doc.inferenceDeclined as it was. expectedDecline is doc.inferenceDeclined after the stop, '
      + 'null when absent, with arrival and at as epoch ms. expectedEvent is whether declined_inferred is sent: only for '
      + 'a guessed focus. Every stop also removes the focus and clears lastOpen and the open snapshot unconditionally.',
    cases: stopCases
  }
};
writeFileSync(new URL('./fixtures/conformance/inference.json', import.meta.url), JSON.stringify(inference, null, 2) + '\n');
