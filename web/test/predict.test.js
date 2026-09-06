process.env.TZ = 'Australia/Sydney'; // hours and day-type are read locally

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  predict, scoreCandidate, scoreAll, dayTypeMatch, hourProximity, recencyDecay,
  distanceKm, locationFactor, rankTrips, automaticHomeOf, homeOf, locate, PREDICT_FLOOR, HOME_VOTES_NEEDED
} from '../js/predict.js';
import { emptyDoc, addTrip, recordView } from '../js/storage.js';
import { INDEX, STATIONS, tripBetween } from './fixture.js';

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

test('location boosts a nearby origin without breaking candidates lacking coordinates', () => {
  const near = { lat: -33.883, lon: 151.207 };
  const fix = { lat: -33.884, lon: 151.206 };
  assert.ok(distanceKm(fix, near) < 2);
  assert.equal(locationFactor(fix, { location: near }), 2.5);
  assert.equal(locationFactor(fix, CENTRAL), 1);

  let d = doc([
    ['home', 'forward', MON_0800 - 86_400_000],
    ['other', 'forward', MON_0800 - 86_400_000]
  ]);
  d = {
    ...d,
    trips: d.trips.map((saved) => saved.id === 'other'
      ? { ...saved, from: { ...saved.from, location: near } } : saved)
  };
  assert.deepEqual(predict(d, MON_0800, { fix }), { tripId: 'other', direction: 'forward' });
});

test('an explicit trip switch outranks the prediction in the home list', () => {
  const d = doc([['home', 'forward', MON_0800 - 86_400_000]]);
  const ranked = rankTrips(d, MON_0800, {
    selection: { tripId: 'other', direction: 'reverse' }
  });
  assert.deepEqual([ranked[0].trip.id, ranked[0].direction, ranked[0].selected], ['other', 'reverse', true]);
});


/* ---- the location floor (design.md 8) ----------------------------------- */

const LOCATED = trip('home',
  { ...CENTRAL, location: { lat: -33.8832, lon: 151.2069 } },
  { ...PARRA, location: { lat: -33.8172, lon: 151.0050 } });
const AT_PARRA = { lat: -33.8172, lon: 151.0050 };

function locatedDoc(events = []) {
  return {
    ...emptyDoc(),
    trips: [LOCATED],
    history: events.map(([direction, t]) => ({ tripId: 'home', direction, t: new Date(t).toISOString() }))
  };
}

test('standing at the destination with no history, the way back wins on location alone', () => {
  const scores = Object.fromEntries(scoreAll(locatedDoc(), MON_0800, { fix: AT_PARRA })
    .map((c) => [c.direction, c.score]));

  assert.ok(Math.abs(scores.reverse - PREDICT_FLOOR * 2.5) < 1e-12);
  assert.ok(Math.abs(scores.forward - PREDICT_FLOOR * 0.3) < 1e-12);
  assert.deepEqual(predict(locatedDoc(), MON_0800, { fix: AT_PARRA }),
    { tripId: 'home', direction: 'reverse' });
});

test('without a fix the floor is the same everywhere, so lastViewed still answers', () => {
  const d = { ...doc([], { tripId: 'other', direction: 'reverse' }) };
  assert.deepEqual(scoreAll(d, MON_0800).map((c) => c.score),
    [PREDICT_FLOOR, PREDICT_FLOOR, PREDICT_FLOOR, PREDICT_FLOOR]);
  assert.deepEqual(predict(d, MON_0800), { tripId: 'other', direction: 'reverse' });
});

test('one real view outweighs the floor even from the wrong end of the line', () => {
  const d = locatedDoc([['forward', MON_0800 - 86_400_000]]);
  const scores = Object.fromEntries(scoreAll(d, MON_0800, { fix: AT_PARRA })
    .map((c) => [c.direction, c.score]));

  assert.ok(scores.forward > scores.reverse, 'history dominates the floor');
  assert.deepEqual(predict(d, MON_0800, { fix: AT_PARRA }), { tripId: 'home', direction: 'forward' });
});

test('location-off prediction ignores a supplied fix', () => {
  const d = { ...locatedDoc(), preferences: { useLocation: false } };
  assert.deepEqual(scoreAll(d, MON_0800, { fix: AT_PARRA }).map((candidate) => candidate.score),
    [PREDICT_FLOOR, PREDICT_FLOOR]);
  assert.deepEqual(predict(d, MON_0800, { fix: AT_PARRA }), { tripId: 'home', direction: 'forward' });
});


/* ---- home from the daily votes (design.md 3) ---------------------------- */

const votes = (keys) => keys.map((key, index) => ({
  day: `2026-08-${String(24 + index).padStart(2, '0')}`, station: STATIONS[key]
}));

test('home is the station with the most votes among the last seven days', () => {
  const doc = { ...emptyDoc(), homeVotes: votes(['rhodes', 'rhodes', 'burwood', 'rhodes', 'burwood', 'burwood', 'burwood']) };
  assert.deepEqual(homeOf(doc), { station: STATIONS.burwood, confidence: 4 });
});

test('three votes are the minimum; below it the first saved trip answers at zero', () => {
  const thin = {
    ...emptyDoc(),
    trips: [tripBetween('t1', 'rhodes', 'bondi')],
    homeVotes: votes(['rhodes', 'rhodes', 'burwood'])
  };
  assert.deepEqual(homeOf(thin), { station: STATIONS.rhodes, confidence: 0 });

  const enough = { ...thin, homeVotes: votes(['rhodes', 'rhodes', 'rhodes']) };
  assert.deepEqual(homeOf(enough), { station: STATIONS.rhodes, confidence: HOME_VOTES_NEEDED });

  assert.equal(homeOf({ ...emptyDoc(), homeVotes: votes(['rhodes', 'burwood']) }), null,
    'no votes worth counting and no saved trip is no home');
});

test('a tie goes to the station of the most recent vote among the tied', () => {
  const doc = { ...emptyDoc(), homeVotes: votes(['rhodes', 'burwood', 'rhodes', 'burwood', 'rhodes', 'burwood']) };
  assert.deepEqual(homeOf(doc), { station: STATIONS.burwood, confidence: 3 });

  const other = { ...emptyDoc(), homeVotes: votes(['burwood', 'rhodes', 'burwood', 'rhodes', 'burwood', 'rhodes']) };
  assert.deepEqual(homeOf(other), { station: STATIONS.rhodes, confidence: 3 });
});

test('a manual home overrides but never replaces the automatic vote result', () => {
  const d = {
    ...emptyDoc(),
    homeVotes: votes(['rhodes', 'rhodes', 'rhodes']),
    preferences: { homeOverride: STATIONS.burwood }
  };
  assert.deepEqual(automaticHomeOf(d), { station: STATIONS.rhodes, confidence: HOME_VOTES_NEEDED });
  assert.deepEqual(homeOf(d), {
    station: { id: STATIONS.burwood.id, name: STATIONS.burwood.name, location: STATIONS.burwood.location },
    confidence: 0,
    source: 'manual'
  });
  assert.deepEqual(homeOf({ ...d, preferences: {} }),
    { station: STATIONS.rhodes, confidence: HOME_VOTES_NEEDED });
});


/* ---- locate: the answer outside travel mode (design.md 4) --------------- */

const AT = (key) => ({ ...STATIONS[key].location });
const homeVotes = votes(['rhodes', 'rhodes', 'rhodes']);
const reverseViews = (times) => times.map((t) => ({ tripId: 't1', direction: 'reverse', t }));

test('away from home with nothing to go on, the header answers with the way home', () => {
  const doc = { ...emptyDoc(), trips: [tripBetween('t1', 'rhodes', 'bondi')], homeVotes };
  assert.deepEqual(locate(doc, MON_0800, { fix: AT('bondi'), stations: INDEX }),
    { kind: 'trip', tripId: 't1', direction: 'reverse', leap: 'home' });
});

test('real history from where you are outranks the home rule', () => {
  const doc = {
    ...emptyDoc(),
    trips: [tripBetween('t1', 'rhodes', 'bondi')],
    homeVotes,
    history: reverseViews([
      '2026-08-24T08:10:00+10:00', '2026-08-25T08:05:00+10:00', '2026-08-26T07:50:00+10:00'
    ])
  };
  assert.deepEqual(locate(doc, MON_0800, { fix: AT('bondi'), stations: INDEX }),
    { kind: 'trip', tripId: 't1', direction: 'reverse', leap: 'usual' });
});

test('a pair no saved trip covers is the answer where the user actually is', () => {
  const doc = { ...emptyDoc(), trips: [tripBetween('t1', 'rhodes', 'bondi')], homeVotes };
  const answer = locate(doc, MON_0800, { fix: AT('burwood'), stations: INDEX });

  assert.equal(answer.kind, 'pair');
  assert.deepEqual([answer.from.id, answer.to.id], [STATIONS.burwood.id, STATIONS.rhodes.id]);
  assert.ok(answer.from.location && answer.to.location, 'the controller saves this pair as a trip');
});

test('at home with nothing saved from home, today\'s predictor answers unchanged', () => {
  const doc = { ...emptyDoc(), trips: [tripBetween('t1', 'central', 'parramatta')], homeVotes };
  const opts = { fix: AT('rhodes'), stations: INDEX };

  assert.deepEqual(locate(doc, MON_0800, opts),
    { kind: 'trip', ...predict(doc, MON_0800, opts), leap: 'usual' });
});

test('with no here at all the predictor answers, and a new user gets the sheet', () => {
  const nowhere = { fix: { lat: -33.9042, lon: 151.1040 }, stations: INDEX };
  const doc = { ...emptyDoc(), trips: [tripBetween('t1', 'central', 'parramatta')], homeVotes };

  assert.deepEqual(locate(doc, MON_0800, nowhere),
    { kind: 'trip', ...predict(doc, MON_0800, nowhere), leap: 'usual' });
  assert.deepEqual(locate(doc, MON_0800, {}),
    { kind: 'trip', ...predict(doc, MON_0800, {}), leap: 'usual' });
  assert.deepEqual(locate(emptyDoc(), MON_0800, nowhere), { kind: 'setup', from: null });
});

test('a new user with a fix gets the sheet with From already filled', () => {
  const doc = { ...emptyDoc(), homeVotes };
  assert.deepEqual(locate(doc, MON_0800, { fix: AT('rhodes'), stations: INDEX }),
    { kind: 'setup', from: STATIONS.rhodes });

  // Votes know where home is before any trip is saved, so the pair is answerable.
  const away = locate(doc, MON_0800, { fix: AT('burwood'), stations: INDEX });
  assert.deepEqual([away.kind, away.from.id, away.to.id],
    ['pair', STATIONS.burwood.id, STATIONS.rhodes.id]);
});

test('candidates from here that tie fall back to lastViewed, then to saved order', () => {
  const doc = {
    ...emptyDoc(),
    trips: [tripBetween('t1', 'central', 'parramatta'), tripBetween('t2', 'central', 'townhall')],
    homeVotes
  };
  const opts = { fix: AT('central'), stations: INDEX };

  assert.deepEqual(locate(doc, MON_0800, opts),
    { kind: 'trip', tripId: 't1', direction: 'forward', leap: 'usual' });
  assert.deepEqual(locate({ ...doc, lastViewed: { tripId: 't2', direction: 'forward' } }, MON_0800, opts),
    { kind: 'trip', tripId: 't2', direction: 'forward', leap: 'usual' });
});
