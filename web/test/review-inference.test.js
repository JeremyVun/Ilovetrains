/* Adversarial probes of the hold rule, on-board entry and the decline (pure
   focus.js), kept as regressions. Each states what client-storage.md
   requires. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  inferFromRecords, inferOnBoard, inferenceDeclinedFor, retiresSnapshot, writeLastOpen, PROGRESS_WINDOW
} from '../js/focus.js';
import { distanceKm } from '../js/stations.js';
import { journeyKey } from '../js/journey.js';

process.env.TZ = 'Australia/Sydney';
const fixture = JSON.parse(readFileSync(new URL('../../tools/fixtures/conformance/inference.json', import.meta.url)));
const caseNamed = (name) => fixture.entryCases.cases.find((value) => value.name === name);
const clone = (value) => JSON.parse(JSON.stringify(value));
const ms = (iso) => Date.parse(iso);

const RHODES = { id: '213820', name: 'Rhodes Station', platform: 'Platform 1' };
const TOWN_HALL = { id: '200070', name: 'Town Hall Station', platform: 'Platform 3' };

function t9(departureIso, arrivalIso) {
  const leg = {
    line: { name: 'T9', mode: 'train' }, headsign: 'Hornsby via Strathfield', from: RHODES, to: TOWN_HALL,
    departure: { scheduled: departureIso, estimated: departureIso },
    arrival: { scheduled: arrivalIso, estimated: arrivalIso }, cancelled: false
  };
  return {
    departure: { scheduled: departureIso, estimated: departureIso, platform: 'Platform 1' },
    arrival: { scheduled: arrivalIso, estimated: arrivalIso },
    line: leg.line, destinationHeadsign: leg.headsign, stopsAway: null, cancelled: false, legs: 1, legDetail: [leg]
  };
}

const record = (journey, station = RHODES) => ({
  station: station && { id: station.id, name: station.name }, tripId: 'rt', direction: 'forward', journey
});

/* Being seen at the platform again after the shown train left means the
   rider did not board it. A same-origin sighting 60 s after D therefore
   replaces the stored record (hold rule), and the snapshot this Home visit
   began with must not enter that departed train when the rider boards the
   next one. */
test('review: a platform sighting after departure retires the departed train from the snapshot too', () => {
  const base = caseNamed('regression: the stored record alone enters');
  const departed = base.doc.lastOpen;
  // The Home visit began with the departed train's record as the snapshot (a return or back-to-Home at 07:59).
  const snapshot = clone(departed);
  // 70 s after the 08:00 left, a refresh with a fresh platform fix records the 08:08 (fixture hold case: replaces).
  const sightingAt = ms('2026-10-01T08:01:10+10:00');
  const next = record(t9('2026-10-01T08:08:00+10:00', '2026-10-01T08:35:00+10:00'));
  // The controller's write step: the same sighting retires the snapshot before the hold rule writes.
  const kept = retiresSnapshot(base.doc, snapshot, next, sightingAt) ? null : snapshot;
  const doc = writeLastOpen(clone(base.doc), next, sightingAt, sightingAt);
  assert.equal(journeyKey(doc.lastOpen.journey), journeyKey(t9('2026-10-01T08:08:00+10:00', '2026-10-01T08:35:00+10:00')),
    'the hold rule replaces the stored record with the next train');

  // The rider boards the 08:08; a tick fix a few km along at train speed.
  const now = ms('2026-10-01T08:12:00+10:00');
  const entered = inferFromRecords(doc, kept, now, { ...base.fix, at: now, speed: 14 });
  assert.ok(entered, 'the moving fix enters trip mode');
  assert.equal(journeyKey(entered.journey), journeyKey(doc.lastOpen.journey),
    `entered the departed ${entered.journey.departure.scheduled} instead of the boarded ${doc.lastOpen.journey.departure.scheduled}`);
});

/* These pin the 0.25 progress window from both sides. */
function onBoardAt(gapFromTime, now = ms('2026-10-01T08:10:00+10:00')) {
  const base = caseNamed('on board: a heading toward the city decides forward and the closest progress wins');
  const doc = clone(base.doc);
  doc.trips = doc.trips.filter((trip) => trip.id === 'rt');
  const fix = { ...base.fix, at: now };
  const origin = doc.trips[0].from.location;
  const destination = doc.trips[0].to.location;
  const fromOrigin = distanceKm(fix, origin);
  const position = fromOrigin / (fromOrigin + distanceKm(fix, destination));
  const ride = 30 * 60_000;
  const timeProgress = position + gapFromTime;
  // Whole seconds: ISO strings carry no sub-millisecond precision, so the gap must survive the round trip.
  const departure = Math.round((now - timeProgress * ride) / 1000) * 1000;
  const journey = t9(new Date(departure).toISOString(), new Date(departure + ride).toISOString());
  return { doc, now, fix, journey, position, result: inferOnBoard(doc, now, fix, null, { 'rt|forward': [journey] }, {}) };
}

test('review: a service 0.24 off the position progress still matches', () => {
  const { result, journey } = onBoardAt(0.24);
  assert.equal(result && journeyKey(result.journey), journeyKey(journey));
});

test('review: a service 0.26 off the position progress is not a match', () => {
  assert.equal(onBoardAt(0.26).result, null);
  assert.equal(PROGRESS_WINDOW, 0.25);
});

test('review: a service 0.249 off the position progress matches (the window is inclusive of 0.25)', () => {
  const { result, journey } = onBoardAt(0.249);
  assert.equal(result && journeyKey(result.journey), journeyKey(journey));
});

/* Here the declined arrival + 30 min has passed and only the hour holds. */
test('review: the decline hour alone holds entry once the declined arrival plus 30 min has passed', () => {
  const now = ms('2026-10-01T08:10:00+10:00');
  const probe = onBoardAt(0.02, now);
  const at = new Date(now - 59 * 60_000).toISOString();
  const arrival = new Date(now - 40 * 60_000).toISOString();
  probe.doc.inferenceDeclined = { tripId: 'rt', direction: 'forward', at, departure: '["T9","2026-10-01T06:50:00+10:00"]', arrival };
  assert.equal(inferenceDeclinedFor(probe.doc, 'rt', now), true);
  assert.equal(inferOnBoard(probe.doc, now, probe.fix, null, { 'rt|forward': [probe.journey] }, {}), null);
  probe.doc.inferenceDeclined.at = new Date(now - 60 * 60_000).toISOString();
  assert.equal(inferenceDeclinedFor(probe.doc, 'rt', now), false, 'the hour lapses exactly 60 min after the stop');
  const resumed = inferOnBoard(probe.doc, now, probe.fix, null, { 'rt|forward': [probe.journey] }, {});
  assert.equal(resumed && journeyKey(resumed.journey), journeyKey(probe.journey));
});
