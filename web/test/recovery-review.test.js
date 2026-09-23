process.env.TZ = 'Australia/Sydney';

/* Adversarial probes for transfer completion and recovery,
   kept as regressions. Each test names the invariant it attacks; the fixes for
   the findings they caught are in focus.js, storage.js and main.js. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  setFocus, composedJourney, recoveryModel, settleRide, directionsModel
} from '../js/focus.js';
import { arrivalMs, legsOf, withLegs, journeyKey, journeyDetail } from '../js/journey.js';
import { parseDoc, serializeDoc, emptyDoc } from '../js/storage.js';
import { homeHtml, homeModel } from '../js/home.js';
import {
  TRANSFER_NOW, TRANSFER_DEPARTED_NOW, transferBody, transferJourneys, delayLeg, cancelLeg,
  recoveryJourney, recoveryRecord, threeLegJourney
} from './fixture.js';

const TRIP = {
  id: 'trip-rhodes-bondi',
  from: { id: '213820', name: 'Rhodes Station' },
  to: { id: '202210', name: 'Bondi Junction Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};
const SELECTION = { tripId: TRIP.id, direction: 'forward' };
const LOST_NOW = TRANSFER_DEPARTED_NOW;
const at = (time) => Date.parse(`2026-09-01T${time}+10:00`);

function docWithFocus(journey, now, by = 'inferred') {
  const doc = setFocus({ ...emptyDoc(), trips: [TRIP] }, SELECTION, journey, now);
  doc.focus.by = by;
  return doc;
}
function lostDoc(record = recoveryRecord(LOST_NOW)) {
  const doc = docWithFocus(delayLeg(transferJourneys()[0], 0, 9), LOST_NOW);
  if (record) doc.focus.recovery = record;
  return doc;
}

/* The shared fixture, read the way the conformance test reads it. */
const fixture = JSON.parse(readFileSync(
  new URL('../../tools/fixtures/conformance/transfer-recovery.json', import.meta.url), 'utf8'));
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
const caseOf = (name) => fixture.cases.find((value) => value.name === name);
const FIXTURE_TRIP = {
  id: fixture.tripId,
  from: { id: fixture.base.legs[0].from.id, name: fixture.base.legs[0].from.name },
  to: { id: fixture.base.legs.at(-1).to.id, name: fixture.base.legs.at(-1).to.name },
  createdAt: '2026-01-01T08:00:00+10:00'
};
function fixtureFocus(value, held = null) {
  const doc = setFocus({ ...emptyDoc(), trips: [FIXTURE_TRIP] },
    { tripId: FIXTURE_TRIP.id, direction: 'forward' }, followedOf(value), value.now);
  doc.focus.by = value.by;
  if (held) doc.focus.recovery = held;
  return doc.focus;
}
/* Answers a search from a table of boards keyed by change stop and minute. */
function responder(boards) {
  return (search) => {
    const hit = boards.find((board) => board.from === search.from
      && Math.floor(board.at / 60_000) === Math.floor(search.at / 60_000));
    return hit ? { journeys: hit.journeys.map((j) => journeyOf(j.legs)), generatedAt: iso(hit.at) } : null;
  };
}
const outline = (journey) => legsOf(journey).map((leg) => [leg.line.name, leg.departure.scheduled]);

// ---------------------------------------------------------------------------
// Invariant 2: the recovery record cannot corrupt the focus.

test('a changeIndex past the last change is malformed and never composes extra legs', () => {
  const doc = lostDoc(recoveryRecord(LOST_NOW, 3));
  const kept = parseDoc(serializeDoc(doc)).focus;
  const composed = composedJourney(kept);
  assert.equal(legsOf(composed).length, 2,
    'a record whose changeIndex is past the last change was appended after the whole followed journey');
  assert.equal(legsOf(composedJourney(doc.focus)).length, 2, 'the model composed it before storage could drop it');

  const lastLeg = recoveryRecord(LOST_NOW, 1);
  lastLeg.journey.legDetail[0].from = { id: '202210', name: 'Bondi Junction Station', platform: 'Platform 1' };
  assert.equal(legsOf(composedJourney(lostDoc(lastLeg).focus)).length, 2,
    'the last leg ends the journey, so it is no change to recover at');
});

test('a record whose first leg does not board at the change station is not composed', () => {
  const stray = recoveryRecord(LOST_NOW);
  stray.journey.legDetail[0].from = { id: '200060', name: 'Central Station', platform: 'Platform 20' };
  const doc = lostDoc(stray);
  const composed = composedJourney(parseDoc(serializeDoc(doc)).focus);
  const changeLegs = legsOf(composed);
  assert.equal(changeLegs[0].to.id, changeLegs[1].from.id,
    'the composed journey changes at Town Hall but boards at Central');
});

test('a moved-anchor record is stable across the refreshes that follow it', () => {
  const value = caseOf('candidate-change-lost');
  const boards = value.searches;
  const townHall = boards.find((board) => board.id === 'town-hall-1000');
  const held = {
    changeIndex: 0, journey: journeyOf(townHall.journeys[0].legs),
    fetchedAt: iso(value.now), source: { generatedAt: iso(value.now), degraded: false }
  };
  const respond = responder(boards);
  const first = recoveryModel(fixtureFocus(value, held), value.now, { response: respond });
  assert.deepEqual(outline(first.composed), [['T9', iso(1789428240000)], ['T1', iso(1789430700000)], ['T4', iso(1789431540000)]]);

  let focus = fixtureFocus(value, first.recovery);
  for (let refresh = 2; refresh <= 4; refresh++) {
    const plan = recoveryModel(focus, value.now + refresh * 30_000, { response: respond });
    assert.deepEqual(outline(plan.composed), outline(first.composed),
      `refresh ${refresh} re-told the rider a different train`);
    assert.equal(plan.composedChanges.some((change) => change.state === 'lost'), false,
      `refresh ${refresh} composed a journey with a lost change`);
    focus = fixtureFocus(value, plan.recovery);
  }
});

test('a moved-anchor record is still re-matched so its estimates refresh', () => {
  const value = caseOf('candidate-change-lost');
  const townHall = value.searches.find((board) => board.id === 'town-hall-1000');
  const held = {
    changeIndex: 0, journey: journeyOf(townHall.journeys[0].legs),
    fetchedAt: iso(value.now), source: { generatedAt: iso(value.now), degraded: false }
  };
  const respond = responder(value.searches);
  const first = recoveryModel(fixtureFocus(value, held), value.now, { response: respond });
  const second = recoveryModel(fixtureFocus(value, first.recovery), value.now + 30_000, { response: respond });
  assert.notEqual(second.candidate, null, 'the record held after the anchor moved was never matched again');
});

test('a held candidate whose own window shrinks to tight is kept, not swapped for a later train', () => {
  const value = caseOf('lost-riding');
  const search = value.searches[0];
  const held = {
    changeIndex: 0, journey: journeyOf(search.journeys[0].legs),
    fetchedAt: iso(value.now), source: { generatedAt: iso(value.now), degraded: false }
  };
  // The 10:08 now leaves at 10:02 (two minutes after the T9 arrives); a 10:15 also runs.
  const tightened = journeyOf(search.journeys[0].legs);
  tightened.legDetail[0].departure.estimated = iso(1789430520000);
  tightened.departure.estimated = iso(1789430520000);
  const later = journeyOf(search.journeys[0].legs);
  later.legDetail[0].departure = { scheduled: iso(1789430700000), estimated: iso(1789430700000) };
  later.departure = { ...later.departure, ...later.legDetail[0].departure };
  const plan = recoveryModel(fixtureFocus(value, held), value.now + 30_000, {
    response: () => ({ journeys: [tightened, later], generatedAt: iso(value.now + 30_000) })
  });
  assert.deepEqual(outline(plan.composed), [['T9', iso(1789428240000)], ['T4', iso(1789430880000)]],
    'the rider was re-told a later train instead of keeping the tight one');
  assert.equal(plan.composedChanges[0].state, 'tight');
  assert.equal(plan.receipt, 'The T9 arrives at 10:00, but the T4 left at 09:58.');
});

// ---------------------------------------------------------------------------
// Invariant 8: cross-client agreement on a case the fixture does not carry.

test('the candidate\'s own change lost with nothing found from the later change reads as lost', () => {
  const value = caseOf('candidate-change-lost');
  const townHall = value.searches.find((board) => board.id === 'town-hall-1000');
  const held = {
    changeIndex: 0, journey: journeyOf(townHall.journeys[0].legs),
    fetchedAt: iso(value.now), source: { generatedAt: iso(value.now), degraded: false }
  };
  const respond = responder([{ ...value.searches.find((board) => board.id === 'central-1014'), journeys: [] }]);
  const plan = recoveryModel(fixtureFocus(value, held), value.now, { response: respond });
  const directions = directionsModel(plan.composed, value.now, { recoveryFrom: plan.recoveryFrom, receipt: plan.receipt });
  assert.equal(plan.receipt, 'Check the station boards.');
  assert.equal(directions.instruction, 'The T1 arrives too late for the 10:11');
  assert.equal(directions.arrivalPlanned, true);
});

// ---------------------------------------------------------------------------
// Invariant 6: the shrunk clause does not apply to a recovery change.

test('a recovery change whose estimate lands earlier than its timetable is judged by w alone', () => {
  const value = caseOf('lost-riding');
  const search = value.searches[0];
  const early = journeyOf(search.journeys[0].legs);
  // Scheduled 10:08, now expected 10:06: six minutes after the T9, never "shrunk".
  early.legDetail[0].departure.estimated = iso(1789430760000);
  early.departure.estimated = iso(1789430760000);
  const plan = recoveryModel(fixtureFocus(value), value.now, {
    response: () => ({ journeys: [early], generatedAt: iso(value.now) })
  });
  assert.equal(plan.composedChanges[0].state, 'ordinary');
  const directions = directionsModel(plan.composed, value.now, { recoveryFrom: 0, receipt: plan.receipt });
  assert.equal(directions.instruction, 'Get off at Town Hall · Platform 3');
  assert.doesNotMatch(directions.receipt, /Printed change/);
});

// ---------------------------------------------------------------------------
// Invariant 3: identity and ride recording follow the followed journey.

test('the ride recorded at the end of a recovered journey is the followed journey\'s', () => {
  const doc = lostDoc();
  const settled = settleRide(doc, at('10:19:00'));
  const ride = (settled.rides || []).at(-1);
  assert.ok(ride, 'no ride was recorded');
  assert.equal(Date.parse(ride.arrivedAt), arrivalMs(doc.focus.journey));
  assert.equal(journeyKey(doc.focus.journey), journeyKey(lostDoc().focus.journey));
});

// ---------------------------------------------------------------------------
// Invariant 1: nothing changes when no change is lost. The header and detail
// models from the commit before this item are imported from git and compared
// on journeys with ordinary, tight, shrunk, late and cancelled changes.

const BASE = '36d9ad7';
async function baseModules() {
  const dir = mkdtempSync(path.join(tmpdir(), 'recovery-base-'));
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'],
    { cwd: path.dirname(new URL(import.meta.url).pathname), encoding: 'utf8' }).trim();
  execFileSync('sh', ['-c', `git archive ${BASE} web/js | tar -x -C ${dir}`], { cwd: root });
  const load = (name) => import(pathToFileURL(path.join(dir, 'web/js', name)).href);
  return { home: await load('home.js'), journey: await load('journey.js') };
}

function scenarios() {
  const riding = TRANSFER_DEPARTED_NOW;
  const arrivalOnly = transferJourneys()[0];
  arrivalOnly.legDetail[0].arrival.estimated = '2026-09-01T09:54:36+10:00';
  const cancelledLater = cancelLeg(transferJourneys()[0], 1);
  const body = transferBody();
  return [
    ['pre-departure inferred', docWithFocus(transferJourneys()[0], TRANSFER_NOW), TRANSFER_NOW, {}],
    ['pre-departure pinned', docWithFocus(transferJourneys()[0], TRANSFER_NOW, 'focus'), TRANSFER_NOW, {}],
    ['riding ordinary', docWithFocus(transferJourneys()[0], riding), riding, {}],
    ['riding pinned', docWithFocus(transferJourneys()[0], riding, 'focus'), riding, {}],
    ['riding, leg 0 one minute late (shrunk, tight)', docWithFocus(delayLeg(transferJourneys()[0], 0, 1), riding), riding, {}],
    ['riding, leg 0 three minutes late', docWithFocus(delayLeg(transferJourneys()[0], 0, 3), riding), riding, {}],
    ['riding, leg 1 one minute late', docWithFocus(delayLeg(transferJourneys()[0], 1, 1), riding), riding, {}],
    ['riding, arrival-only delay (documented exception)', docWithFocus(arrivalOnly, riding), riding, {}],
    ['dwelling at the change', docWithFocus(transferJourneys()[0], at('09:55:00')), at('09:55:00'), {}],
    ['riding the last leg', docWithFocus(transferJourneys()[0], at('10:01:00')), at('10:01:00'), {}],
    ['later leg cancelled while riding', docWithFocus(cancelledLater, riding), riding, {}],
    ['stale while riding', docWithFocus(transferJourneys()[0], riding), riding, { stale: true }],
    ['offline while riding', docWithFocus(transferJourneys()[0], riding), riding, { offline: true }],
    ['trip over', docWithFocus(transferJourneys()[0], at('10:12:00')), at('10:12:00'), {}],
    ['three legs riding', docWithFocus(threeLegJourney(), riding), riding, {}],
    ['three legs dwelling', docWithFocus(threeLegJourney(), at('09:55:00')), at('09:55:00'), {}]
  ].map(([name, doc, now, opts]) => [name, doc, body, now, opts]);
}

// The saved-trip list below the header lost its repeated status on 2026-09-23.
const headerOf = (html) => html.slice(0, html.indexOf('data-t="trip-list"'));

test('the home header is byte-identical to the base commit on every non-lost journey', async () => {
  const base = await baseModules();
  const differences = [];
  for (const [name, doc, body, now, opts] of scenarios()) {
    const before = headerOf(base.home.homeHtml(base.home.homeModel(doc, SELECTION, body, now, opts)));
    const after = headerOf(homeHtml(homeModel(doc, SELECTION, body, now, opts)));
    if (before !== after) differences.push(name);
  }
  assert.deepEqual(differences, ['riding, arrival-only delay (documented exception)']);
});

test('journey detail steps and summary are unchanged on every non-lost journey', async () => {
  const base = await baseModules();
  const shape = (model) => ({
    summary: model.summary,
    steps: model.steps.map((step) => [step.kind, step.time, step.station, step.label, step.serviceLabel])
  });
  for (const [name, doc, , now, opts] of scenarios()) {
    const journey = doc.focus.journey;
    assert.deepEqual(shape(journeyDetail(journey, now, opts)), shape(base.journey.journeyDetail(journey, now, opts)), name);
  }
});

test('the recovery seam is inert without a lost change', () => {
  for (const [name, doc, , now] of scenarios()) {
    const plan = recoveryModel(doc.focus, now, { response: () => ({ journeys: [recoveryJourney()] }) });
    assert.equal(plan.search, null, `${name}: searched`);
    assert.equal(plan.recovery, null, `${name}: held a record`);
    assert.equal(plan.composed, doc.focus.journey, `${name}: composed a different journey`);
  }
});
