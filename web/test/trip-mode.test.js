/* The pure parts of when Home looks, how a trip starts and stops, and what
   counts as a new open. */
process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  declineFocus, inferenceDeclinedFor, runningJourney, startable, tickNeedsFix, DECLINE_HOLD_MS
} from '../js/focus.js';
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

test('a decline holds a trip in both directions for the later of an hour and arrival + 30 min', () => {
  const ride = journey(at('08:00:00'));
  const focus = { tripId: 'rt', direction: 'forward', focusedAt: iso(at('08:01:00')), by: 'inferred', journey: ride };
  const doc = declineFocus({ ...emptyDoc(), trips }, focus, at('08:05:00'));
  assert.equal(doc.inferenceDeclined.departure, JSON.stringify(['T9', iso(at('08:00:00'))]));
  assert.equal(inferenceDeclinedFor(doc, 'rt', at('09:04:59.999')), true);
  assert.equal(inferenceDeclinedFor(doc, 'rt', at('08:05:00') + DECLINE_HOLD_MS), false);
  assert.equal(inferenceDeclinedFor(doc, 'other', at('08:10:00')), false);
  const late = declineFocus({ ...emptyDoc(), trips }, { ...focus, journey: journey(at('08:00:00'), 70) }, at('08:05:00'));
  assert.equal(inferenceDeclinedFor(late, 'rt', at('09:39:59')), true, 'arrival 09:10 + 30 min');
  assert.equal(inferenceDeclinedFor(late, 'rt', at('09:40:00')), false);
  assert.equal(inferenceDeclinedFor(doc, 'rt', at('20:00:00'), ride), true, 'that departure, never again');
  assert.equal(inferenceDeclinedFor(doc, 'rt', at('20:00:00'), journey(at('08:08:00'))), false);
});

test('Start trip is offered from 15 minutes before the train leaves until it leaves', () => {
  const train = journey(at('08:15:00'));
  assert.equal(startable(train, at('08:00:00')), true, 'exactly 15 minutes');
  assert.equal(startable(train, at('07:59:59')), false, '15 minutes and a second');
  assert.equal(startable(train, at('08:15:00')), true, 'as it leaves');
  assert.equal(startable(train, at('08:15:01')), false, 'once it has left');
  assert.equal(startable({ ...train, cancelled: true }, at('08:10:00')), false);
  assert.equal(startable(null, at('08:10:00')), false);
});

test('a board row is on its way from its departure until its arrival', () => {
  const train = journey(at('08:00:00'));
  const modes = ['train', 'metro', 'ferry'];
  assert.equal(runningJourney(train, at('07:59:59'), modes), false);
  assert.equal(runningJourney(train, at('08:00:00'), modes), true);
  assert.equal(runningJourney(train, at('08:26:59'), modes), true);
  assert.equal(runningJourney(train, at('08:27:00'), modes), false, 'arrived');
  assert.equal(runningJourney({ ...train, cancelled: true }, at('08:10:00'), modes), false);
  assert.equal(runningJourney(train, at('08:10:00'), ['ferry']), false, 'mode turned off');
});

/* The controller is browser-only; these read its source for the constants the
   browser drive (tools/check-commute-reliability.js) exercises end to end. */
test('the first past page asks from 30 minutes ago for ten services; later pages step an hour', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.match(main, /const FIRST_PAST_PAGE_MS = 30 \* 60_000;/);
  assert.match(main, /const FIRST_PAST_PAGE_LIMIT = 10;/);
  assert.match(main, /const PAST_STEP_MS = 60 \* 60_000;/);
  const past = /async function fetchPast\(initial\) \{([\s\S]*?)\n\}/.exec(main)[1];
  assert.match(past, /const at = first \? now\(\) - FIRST_PAST_PAGE_MS : earliest - PAST_STEP_MS;/);
  assert.match(past, /limit: first \? FIRST_PAST_PAGE_LIMIT : LIMIT/);
});

test('a return after ten minutes away reopens Home', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.match(main, /const NEW_OPEN_AFTER_MS = 10 \* 60_000;/);
  assert.match(main, /if \(away >= NEW_OPEN_AFTER_MS\) return reopen\(\);/);
  const reopen = /function reopen\(\) \{([\s\S]*?)\n\}/.exec(main)[1];
  assert.match(reopen, /state\.selection = null;/);
  assert.match(reopen, /ctx\.go\('#\/'\)/);
});
