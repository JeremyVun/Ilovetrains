process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { recoveryModel } from '../js/focus.js';
import { homeHtml, homeModel } from '../js/home.js';
import { journeyDetail, journeyKey, legsOf, withLegs } from '../js/journey.js';
import { emptyDoc } from '../js/storage.js';

const fixture = JSON.parse(readFileSync(
  new URL('../../tools/fixtures/conformance/transfer-recovery.json', import.meta.url), 'utf8'));

const KEYS = ['followedChanges', 'composedChanges', 'recoveryAnchor', 'search', 'candidate', 'composed',
  'status', 'pinIcon', 'changeLabels', 'receipt', 'instruction', 'arrival', 'figure', 'provenance', 'alert'];

test('transfer recovery fixture states its arithmetic and every case carries the whole seam', () => {
  assert.match(fixture.notes, /printed clock minutes/);
  assert.match(fixture.notes, /w >= 3/);
  assert.ok(fixture.base.legs.length >= 2);
  assert.ok(fixture.cases.length > 0);
  const names = new Set();
  for (const value of fixture.cases) {
    assert.equal(typeof value.name, 'string');
    assert.ok(!names.has(value.name), `duplicate case ${value.name}`);
    names.add(value.name);
    assert.equal(typeof value.now, 'number', value.name);
    assert.equal(typeof value.fresh, 'boolean', value.name);
    assert.ok(['focus', 'inferred'].includes(value.by), value.name);
    assert.ok(Array.isArray(value.searches), value.name);
    assert.deepEqual([...Object.keys(value.expected)].sort(), [...KEYS].sort(), value.name);
  }
});

const TRIP = {
  id: fixture.tripId,
  from: { id: fixture.base.legs[0].from.id, name: fixture.base.legs[0].from.name },
  to: { id: fixture.base.legs.at(-1).to.id, name: fixture.base.legs.at(-1).to.name },
  createdAt: '2026-01-01T08:00:00+10:00'
};
const SELECTION = { tripId: TRIP.id, direction: 'forward' };

const iso = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

function legOf(raw) {
  return {
    line: { name: raw.line, mode: raw.mode },
    headsign: raw.headsign || '',
    from: { id: raw.from.id, name: raw.from.name, platform: raw.from.platform },
    to: { id: raw.to.id, name: raw.to.name, platform: raw.to.platform },
    departure: { scheduled: iso(raw.departure.scheduled), estimated: iso(raw.departure.estimated) },
    arrival: { scheduled: iso(raw.arrival.scheduled), estimated: iso(raw.arrival.estimated) },
    cancelled: raw.cancelled === true
  };
}

function journeyOf(rawLegs) {
  const legs = rawLegs.map(legOf);
  return withLegs({ line: legs[0].line, destinationHeadsign: legs[0].headsign }, legs);
}

/** The case's followed journey: its own legs or the base ones, then its
    per-leg realtime overrides and its cancellations. */
function followedOf(value) {
  const journey = journeyOf(value.legs || fixture.base.legs);
  for (const estimate of value.estimates || []) {
    const leg = journey.legDetail[estimate.leg];
    if ('departure' in estimate) leg.departure.estimated = iso(estimate.departure);
    if ('arrival' in estimate) leg.arrival.estimated = iso(estimate.arrival);
  }
  for (const index of value.cancelledLegs || []) journey.legDetail[index].cancelled = true;
  return withLegs(journey, journey.legDetail);
}

function searchOf(value, id) {
  return value.searches.find((search) => search.id === id) || null;
}

function candidatesOf(search) {
  return search.journeys.map((journey) => journeyOf(journey.legs));
}

for (const value of fixture.cases) {
  test(`transfer recovery: ${value.name}`, () => {
    const followed = followedOf(value);
    const held = value.heldRecovery ? {
      changeIndex: value.heldRecovery.changeIndex,
      journey: candidatesOf(searchOf(value, value.heldRecovery.search))[value.heldRecovery.journey],
      fetchedAt: iso(value.now - 60_000),
      source: { generatedAt: iso(value.now - 60_000), degraded: false }
    } : null;
    const focus = {
      tripId: TRIP.id,
      direction: 'forward',
      focusedAt: iso(value.now - 600_000),
      by: value.by,
      journey: followed,
      ...(held ? { recovery: held } : {})
    };

    const asked = [];
    const response = (search) => {
      asked.push(search);
      const match = value.searches.find((item) => item.from === search.from && item.at === search.at);
      return match ? { journeys: candidatesOf(match), generatedAt: iso(value.now), degraded: false } : null;
    };

    const plan = recoveryModel(focus, value.now, { response });
    const expected = value.expected;

    assert.deepEqual(plan.followedChanges.map((change) => change.state), expected.followedChanges,
      'connection states of the followed journey');
    assert.deepEqual(plan.composedChanges.map((change) => change.state), expected.composedChanges,
      'connection states of the composed journey');
    assert.equal(plan.anchor, expected.recoveryAnchor, 'recovery anchor');

    assert.ok(asked.length <= 1, 'a refresh makes at most one recovery search');
    const named = expected.search ? searchOf(value, expected.search) : null;
    if (named) {
      assert.deepEqual({ from: plan.search.from, at: plan.search.at },
        { from: named.from, at: named.at }, `the search is ${expected.search}`);
    } else {
      assert.equal(plan.search, null, 'no search');
    }

    if (expected.candidate === null) assert.equal(plan.candidate, null, 'no candidate');
    else {
      assert.equal(journeyKey(plan.candidate),
        journeyKey(candidatesOf(named)[expected.candidate]), 'candidate');
    }

    assert.deepEqual(legsOf(plan.composed).map((leg) => ({
      line: leg.line.name, scheduledDeparture: Date.parse(leg.departure.scheduled)
    })), expected.composed, 'composed journey');

    const doc = { ...emptyDoc(), trips: [TRIP], focus };
    const model = homeModel(doc, SELECTION, { journeys: [], generatedAt: iso(value.now) }, value.now,
      { recoveryResponse: response, stale: !value.fresh });
    const html = homeHtml(model);
    const directions = model.directions;

    assert.equal(model.status.text.toUpperCase(), expected.status, 'status');
    assert.equal(/class="answer-line">[^]*?class="pin-icon"/.test(html), expected.pinIcon,
      'the pin icon beside the header status');
    assert.deepEqual(model.changes.map((change) => change.label.toUpperCase()),
      expected.changeLabels, 'change labels');
    assert.equal(directions.receipt, expected.receipt, 'receipt');
    assert.equal(directions.instruction, expected.instruction, 'instruction');
    assert.equal(directions.figure, expected.figure, 'figure');
    assert.equal(directions.provenance, expected.provenance, 'provenance');

    const arrival = expected.arrival;
    if (arrival.shown) {
      assert.equal(directions.arrTime, arrival.shown, 'arrival clock');
      assert.equal(directions.arrivalStruck, arrival.struck || '', 'struck arrival');
      assert.equal(directions.arrivalPlanned, false, 'an arrival with a candidate is not planned only');
    } else if (arrival.planned) {
      assert.equal(directions.arrTime, arrival.planned, 'arrival clock');
      assert.equal(directions.arrivalPlanned, true, 'the arrival is the planned one');
    } else {
      /* A cancelled journey strikes its arrival in the promoted row and in
         detail; the smart header's own clock is unchanged by this item. */
      assert.equal(directions.arrTime, arrival.struck, 'arrival clock');
      assert.equal(journeyDetail(plan.composed, value.now).arrival.cancelled, true, 'struck arrival');
    }
  });
}

/* `alert` is native only: web has no journey alerts, so the cue column of the
   shared cases is asserted by the Android and iOS suites. */
