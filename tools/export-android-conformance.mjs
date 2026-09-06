// Regenerate shared prediction cases from the web reference: node tools/export-android-conformance.mjs.
import { writeFileSync, mkdirSync } from 'node:fs';
import { predict, locate, scoreCandidate, automaticHomeOf } from '../web/js/predict.js';
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
const cases = [
  { name: 'empty history chooses first saved trip', doc: base, fix: null },
  { name: 'tied scores retain explicit reverse', doc: { ...base, lastViewed: { tripId: 'b', direction: 'reverse' } }, fix: null },
  { name: 'matching commute hours beat fallback', doc: { ...base, history }, fix: null },
  { name: 'standing at destination chooses real return pair', doc: base, fix: central.location },
  { name: 'disabled location cannot change prediction', doc: { ...base, preferences: { useLocation: false } }, fix: central.location },
  { name: 'relevant origin history outranks home fallback', doc: { ...base, history }, fix: rhodes.location },
  { name: 'three first-open votes infer home', doc: { ...base, homeVotes: ['2026-09-02', '2026-09-03', '2026-09-04'].map(day => ({ day, station: bondi })) }, fix: rhodes.location },
  { name: 'weekend midnight uses circular hour proximity', now: '2026-09-06T00:10:00+10:00', doc: { ...base, history: [{ tripId: 'b', direction: 'reverse', t: '2026-09-05T23:50:00+10:00' }] }, fix: null },
];
const out = cases.map(value => {
  const time = Date.parse(value.now || now);
  const answer = locate(value.doc, time, { stations, fix: value.fix });
  return { ...value, now: value.now || now, stations, expected: {
    selection: answer.kind === 'trip' ? { tripId: answer.tripId, reverse: answer.direction === 'reverse' } : null,
    noLocation: predict(value.doc, time),
    home: automaticHomeOf(value.doc)?.station?.id || null,
    scores: trips.flatMap(t => ['forward', 'reverse'].map(direction => ({ tripId: t.id, reverse: direction === 'reverse', value: scoreCandidate(value.doc.history, t.id, direction, time) })))
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
  { name: 'expired realtime shows absolute clocks', offset: 5, realtime: true, age: 91 },
  { name: 'network failure suppresses countdown', offset: 5, realtime: true, offline: true },
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
