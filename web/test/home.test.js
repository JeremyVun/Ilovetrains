process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import { directionsModel } from '../js/focus.js';
import { homeHtml, homeModel, inferHome, tripIsOver } from '../js/home.js';
import { emptyDoc } from '../js/storage.js';
import { delayLeg, transferJourneys } from './fixture.js';

const at = (time) => Date.parse(`2026-09-01T${time}:00+10:00`);

test('directions follows the closed state ladder on one journey', () => {
  const journey = transferJourneys()[0];
  const before = directionsModel(journey, at('09:21'));
  assert.deepEqual([before.figure, before.provenance, before.phase], ['3', '', 'pre']);
  assert.equal(before.showBoardingPlatform, true);

  const riding = directionsModel(journey, at('09:33'));
  assert.deepEqual([riding.figure, riding.provenance, riding.phase], ['18', 'TO CHANGE', 'ride']);
  assert.match(riding.instruction, /Off at Town Hall · Platform 3/);

  const change = directionsModel(journey, at('09:53'));
  assert.deepEqual([change.figure, change.provenance, change.phase], ['5', 'TO CHANGE', 'dwell']);
  assert.match(change.instruction, /Platform 5 · 09:58 to Bondi Junction/);
  assert.ok(Math.abs(change.progress.at - 29 / 44) < 0.02);

  const final = directionsModel(journey, at('10:01'));
  assert.deepEqual([final.figure, final.provenance, final.phase], ['7', 'TO GO', 'ride2']);
  assert.match(final.instruction, /Off at Bondi Junction · Platform 2/);

  const done = directionsModel(journey, at('10:11'));
  assert.deepEqual([done.figure, done.provenance, done.phase], ['3', 'AGO', 'done']);
  assert.equal(done.showBoardingPlatform, false);
});

test('home inference uses three device-only morning/evening votes', () => {
  const doc = emptyDoc();
  const rhodes = { id: '213820', name: 'Rhodes' };
  const city = { id: '200060', name: 'Central' };
  doc.trips = [{ id: 't', from: rhodes, to: city, createdAt: new Date(0).toISOString() }];
  doc.rides = [0, 1, 2].map((day) => ({
    tripId: 't',
    direction: 'reverse',
    departedAt: `2026-08-${28 + day}T17:00:00+10:00`,
    arrivedAt: `2026-08-${28 + day}T17:30:00+10:00`,
    from: city,
    to: rhodes
  }));
  const result = inferHome(doc, at('20:00'));
  assert.equal(result.inferred.station.id, rhodes.id);
  assert.equal(result.inferred.confidence, 3);
});

test('a trip becomes over at effective arrival, not at an arbitrary UI age', () => {
  const focus = { journey: transferJourneys()[0] };
  assert.equal(tripIsOver(focus, at('10:07')), false);
  assert.equal(tripIsOver(focus, at('10:09')), true);
});

test('a cancelled lead names the cancellation while answering with the next train', () => {
  const journeys = transferJourneys();
  journeys[0].cancelled = true;
  journeys[0].legDetail[0].cancelled = true;
  const trip = {
    id: 't',
    from: { id: '213820', name: 'Rhodes Station' },
    to: { id: '200080', name: 'Bondi Junction Station' },
    createdAt: new Date(0).toISOString()
  };
  const doc = { ...emptyDoc(), trips: [trip] };
  const model = homeModel(doc, { tripId: 't', direction: 'forward' }, {
    generatedAt: '2026-09-01T09:21:00+10:00', journeys
  }, at('09:21'));
  assert.equal(model.directions.depTime, '09:39');
  assert.equal(model.directions.figure, '18');
  assert.equal(model.directions.instruction, '09:24 CANCELLED · NEXT TRAIN');
});

test('a cancellation is not a tight change: the transfer gap stays neutral', () => {
  const cancelled = transferJourneys()[0];
  cancelled.cancelled = true;
  cancelled.legDetail[0].cancelled = true;
  const model = directionsModel(cancelled, at('09:21'));

  assert.equal(model.warn, true, 'the words still warn');
  assert.equal(model.tight, false, 'but nothing about this connection is at risk');
  assert.ok(!homeHtml(headerOnly(model)).includes('sy-g0 warn'));

  const risky = directionsModel(delayLeg(transferJourneys()[0], 0, 5), at('09:53'));
  assert.equal(risky.tight, true);
  assert.ok(homeHtml(headerOnly(risky)).includes('sy-g0 warn'));
});

test('a delayed smart-header train names the delay beside its effective time', () => {
  const journey = transferJourneys()[0];
  delayLeg(journey, 0, 5);
  const model = directionsModel(journey, at('09:21'));
  assert.equal(model.depTime, '09:29');
  assert.equal(model.figure, '8');
  assert.equal(model.provenance, '5 MIN LATE');
  assert.equal(model.provenanceWarn, true);
});

test('every saved-trip row leads with its distance in bold, not just the tracked one', () => {
  const station = (id, name, lat, lon) => ({ id, name, location: { lat, lon } });
  const trip = (id, from, to) => ({ id, from, to, createdAt: new Date(0).toISOString() });
  const doc = {
    ...emptyDoc(),
    trips: [
      trip('t1', station('213820', 'Rhodes Station', -33.8299, 151.0866),
        station('200080', 'Bondi Junction Station', -33.8915, 151.2477)),
      trip('t2', station('200060', 'Central Station', -33.8832, 151.2069),
        station('215020', 'Parramatta Station', -33.8172, 151.0050))
    ]
  };
  const model = homeModel(doc, { tripId: 't1', direction: 'forward' }, null, at('09:21'), {
    fix: { lat: -33.8299, lon: 151.0866 }
  });
  const html = homeHtml(model);

  assert.deepEqual(model.ranked.map((entry) => entry.selected), [true, false]);
  assert.ok(model.ranked[1].distance, 'the unselected row has a distance to print');
  assert.ok(html.includes(`<b>${model.ranked[1].distance}</b>`),
    'the distance is bold on an unselected row');
  assert.ok(html.includes('<b>Tracking now</b>'), 'and the tracked row still says so');
});


/* homeHtml only reads `directions` and `ranked`; the rest of the model is the
   screen around the header. */
function headerOnly(directions, ranked = []) {
  return {
    directions, ranked, home: { home: null, moved: null },
    over: false, freshness: 'Live', dot: 'live', askLocation: false
  };
}
