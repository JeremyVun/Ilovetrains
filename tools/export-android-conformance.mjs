// Regenerate shared prediction cases from the web reference: node tools/export-android-conformance.mjs.
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { predict, locate, scoreCandidate, historyEvidence, automaticHomeOf } from '../web/js/predict.js';
import { here, sightingOf } from '../web/js/stations.js';
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
