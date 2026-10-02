/* commute-reliability rules 4-7: the pure parts of when Home looks, how a trip
   starts and stops, and what counts as a new open. */
process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import { tickNeedsFix } from '../js/focus.js';
import { emptyDoc, recordLastOpen } from '../js/storage.js';

const at = (hhmmss) => Date.parse(`2026-10-01T${hhmmss}+10:00`);
const iso = (ms) => new Date(ms).toISOString();
const RHODES = { id: '213820', name: 'Rhodes Station', location: { lat: -33.83053, lon: 151.087032 } };
const TOWN_HALL = { id: '200070', name: 'Town Hall Station', location: { lat: -33.873596, lon: 151.206899 } };
const trips = [{ id: 'rt', from: RHODES, to: TOWN_HALL, createdAt: iso(0) }];
const journey = (departure, minutes = 27) => ({
  departure: { scheduled: iso(departure), estimated: iso(departure) },
  arrival: { scheduled: iso(departure + minutes * 60_000), estimated: iso(departure + minutes * 60_000) },
  line: { name: 'T9', mode: 'train' }, legs: 1, cancelled: false
});
const seenAt = (when, station = RHODES) => recordLastOpen({ ...emptyDoc(), trips },
  { station, tripId: 'rt', direction: 'forward', journey: journey(at('08:00:00')) }, at(when));

test('a tick looks for five minutes after a lead Home showed this visit departs', () => {
  const doc = { ...emptyDoc(), trips };
  const shown = [at('08:00:00')];
  assert.equal(tickNeedsFix(doc, at('07:59:59'), shown, null, null), false, 'not departed yet');
  assert.equal(tickNeedsFix(doc, at('08:00:00'), shown, null, null), true);
  assert.equal(tickNeedsFix(doc, at('08:05:00'), shown, null, null), true);
  assert.equal(tickNeedsFix(doc, at('08:05:00.001'), shown, null, null), false);
  assert.equal(tickNeedsFix(doc, at('08:13:00'), [...shown, at('08:08:00')], null, null), true,
    'waiting for the next train gives it its own window');
});

test('a tick looks while a held record\'s journey is under way', () => {
  assert.equal(tickNeedsFix(seenAt('07:58:00'), at('07:59:00'), [], null, null), false, 'not departed');
  assert.equal(tickNeedsFix(seenAt('07:58:00'), at('08:20:00'), [], null, null), true);
  assert.equal(tickNeedsFix(seenAt('07:58:00'), at('08:57:00'), [], null, null), true, 'arrival + 30 min');
  assert.equal(tickNeedsFix(seenAt('07:58:00'), at('08:57:00.001'), [], null, null), false);
  assert.equal(tickNeedsFix(seenAt('07:58:00', null), at('08:20:00'), [], null, null), false, 'unsighted');
});

test('a tick keeps looking while the last Home fix, under two minutes old, was at train speed', () => {
  const doc = { ...emptyDoc(), trips };
  const now = at('08:20:00');
  const moving = { ...RHODES.location, at: now - 120_000, accuracy: 10, speed: 12 };
  assert.equal(tickNeedsFix(doc, now, [], moving, null), true);
  assert.equal(tickNeedsFix(doc, now, [], { ...moving, at: now - 120_001 }, null), false);
  assert.equal(tickNeedsFix(doc, now, [], { ...moving, speed: 1 }, null), false);
  assert.equal(tickNeedsFix(doc, now, [], null, null), false);
});
