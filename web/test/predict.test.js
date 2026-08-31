process.env.TZ = 'Australia/Sydney'; // hours and day-type are read locally

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  predict, scoreCandidate, scoreAll, dayTypeMatch, hourProximity, recencyDecay
} from '../js/predict.js';
import { emptyDoc, addTrip, recordView } from '../js/storage.js';

const CENTRAL = { id: '200060', name: 'Central Station' };
const PARRA = { id: '215020', name: 'Parramatta Station' };
const TOWNHALL = { id: '200070', name: 'Town Hall Station' };

const trip = (id, from, to) => ({ id, from, to, createdAt: '2026-01-01T00:00:00+10:00' });
const HOME = trip('home', CENTRAL, PARRA);
const OTHER = trip('other', TOWNHALL, PARRA);

const MON_0800 = Date.parse('2026-08-31T08:00:00+10:00'); // Monday
const SAT_0800 = Date.parse('2026-09-05T08:00:00+10:00'); // Saturday

function doc(events, lastViewed = null) {
  let d = addTrip(addTrip(emptyDoc(), HOME), OTHER);
  for (const [tripId, direction, t] of events) {
    d = { ...d, history: [...d.history, { tripId, direction, t: new Date(t).toISOString() }] };
  }
  return { ...d, lastViewed };
}

test('day-type: weekday matches weekday, weekend does not', () => {
  assert.equal(dayTypeMatch(MON_0800, MON_0800), 1.0);
  assert.equal(dayTypeMatch(SAT_0800, MON_0800), 0.2);
  assert.equal(dayTypeMatch(SAT_0800, SAT_0800), 1.0);
});

test('hour proximity: 1.0 within an hour, 0.5 within two, then nothing', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(hourProximity(at('2026-08-31T08:00:00+10:00'), MON_0800), 1.0);
  assert.equal(hourProximity(at('2026-08-31T09:59:00+10:00'), MON_0800), 1.0);
  assert.equal(hourProximity(at('2026-08-31T10:00:00+10:00'), MON_0800), 0.5);
  assert.equal(hourProximity(at('2026-08-31T11:00:00+10:00'), MON_0800), 0);
  // and it wraps at midnight
  assert.equal(hourProximity(at('2026-08-31T23:30:00+10:00'), at('2026-09-01T00:30:00+10:00')), 1.0);
  assert.equal(hourProximity(at('2026-08-31T22:30:00+10:00'), at('2026-09-01T00:30:00+10:00')), 0.5);
});

test('recency decays 3% a day and never grows with age', () => {
  const day = 86_400_000;
  assert.equal(recencyDecay(MON_0800, MON_0800), 1);
  assert.ok(Math.abs(recencyDecay(MON_0800 - day, MON_0800) - 0.97) < 1e-12);
  assert.ok(Math.abs(recencyDecay(MON_0800 - 10 * day, MON_0800) - Math.pow(0.97, 10)) < 1e-12);
  assert.equal(recencyDecay(MON_0800 + day, MON_0800), 1, 'a future event is not boosted');
});

test('a candidate scores the sum of its own matching events', () => {
  const day = 86_400_000;
  // Three and four days before this Monday are the previous Friday and
  // Thursday: same day-type, same hour, so only recency separates them.
  const d = doc([
    ['home', 'forward', MON_0800 - 3 * day],
    ['home', 'forward', MON_0800 - 4 * day],
    ['home', 'reverse', MON_0800 - 3 * day]
  ]);

  const expected = Math.pow(0.97, 3) + Math.pow(0.97, 4);
  assert.ok(Math.abs(scoreCandidate(d.history, 'home', 'forward', MON_0800) - expected) < 1e-12);
  assert.ok(Math.abs(scoreCandidate(d.history, 'home', 'reverse', MON_0800) - Math.pow(0.97, 3)) < 1e-12);
  assert.equal(scoreCandidate(d.history, 'other', 'forward', MON_0800), 0);
});

test('the morning commute wins in the morning and the evening one in the evening', () => {
  const day = 86_400_000;
  const events = [];
  for (let i = 1; i <= 10; i++) {
    events.push(['home', 'forward', MON_0800 - i * day]);            // 08:00 out
    events.push(['home', 'reverse', MON_0800 - i * day + 10 * 3600_000]); // 18:00 back
  }
  const d = doc(events);

  assert.deepEqual(predict(d, MON_0800), { tripId: 'home', direction: 'forward' });
  assert.deepEqual(predict(d, MON_0800 + 10 * 3600_000), { tripId: 'home', direction: 'reverse' });
});

test('on a Saturday an older weekend habit beats a fresher weekday one', () => {
  const d = doc([
    ['home', 'forward', MON_0800],                    // Monday 08:00, five days ago
    ['other', 'forward', SAT_0800 - 7 * 86_400_000]   // the Saturday before, older
  ]);
  const saturdayMorning = SAT_0800 + 30 * 60000;
  const scores = Object.fromEntries(
    scoreAll(d, saturdayMorning).map((c) => [c.tripId + ':' + c.direction, c.score])
  );

  assert.ok(scores['home:forward'] > 0 && scores['home:forward'] < 0.25, 'weekday event is discounted to a fifth');
  assert.ok(scores['other:forward'] > 0.75);
  assert.deepEqual(predict(d, saturdayMorning), { tripId: 'other', direction: 'forward' });
});

test('an event three hours from now contributes nothing', () => {
  const d = doc([['home', 'forward', MON_0800 - 86_400_000]]);
  const noon = Date.parse('2026-08-31T12:00:00+10:00');
  assert.equal(scoreCandidate(d.history, 'home', 'forward', noon), 0);
});

test('no history falls back to lastViewed', () => {
  const d = doc([], { tripId: 'other', direction: 'reverse' });
  assert.deepEqual(predict(d, MON_0800), { tripId: 'other', direction: 'reverse' });
});

test('a tie falls back to lastViewed, not to whichever came first', () => {
  const d = doc([
    ['home', 'forward', MON_0800 - 86_400_000],
    ['other', 'forward', MON_0800 - 86_400_000]
  ], { tripId: 'other', direction: 'forward' });

  const scores = scoreAll(d, MON_0800);
  const home = scores.find((c) => c.tripId === 'home' && c.direction === 'forward').score;
  const other = scores.find((c) => c.tripId === 'other' && c.direction === 'forward').score;
  assert.equal(home, other, 'the two candidates really are tied');
  assert.deepEqual(predict(d, MON_0800), { tripId: 'other', direction: 'forward' });
});

test('no history and no lastViewed falls back to the first saved trip, forward', () => {
  assert.deepEqual(predict(doc([]), MON_0800), { tripId: 'home', direction: 'forward' });
});

test('a lastViewed pointing at a deleted trip is ignored', () => {
  const d = doc([], { tripId: 'deleted', direction: 'reverse' });
  assert.deepEqual(predict(d, MON_0800), { tripId: 'home', direction: 'forward' });
});

test('no saved trips predicts nothing', () => {
  assert.equal(predict(emptyDoc(), MON_0800), null);
});

test('prediction is deterministic given the same document and clock', () => {
  let d = emptyDoc();
  d = addTrip(addTrip(d, HOME), OTHER);
  d = recordView(d, 'other', 'reverse', MON_0800 - 3600_000);
  assert.deepEqual(predict(d, MON_0800), predict(structuredClone(d), MON_0800));
  assert.deepEqual(predict(d, MON_0800), { tripId: 'other', direction: 'reverse' });
});
