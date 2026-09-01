process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import { directionsModel } from '../js/focus.js';
import { homeModel, inferHome, tripIsOver } from '../js/home.js';
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

test('a delayed smart-header train names the delay beside its effective time', () => {
  const journey = transferJourneys()[0];
  delayLeg(journey, 0, 5);
  const model = directionsModel(journey, at('09:21'));
  assert.equal(model.depTime, '09:29');
  assert.equal(model.figure, '8');
  assert.equal(model.provenance, '5 MIN LATE');
  assert.equal(model.provenanceWarn, true);
});
