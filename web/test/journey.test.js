process.env.TZ = 'Australia/Sydney'; // every clock string the page prints is device-local

import test from 'node:test';
import assert from 'node:assert/strict';

import { journeyDetail, journeyKey, legsOf, TIGHT_CHANGE_MIN } from '../js/journey.js';
import {
  TRANSFER_NOW, TRANSFER_DEPARTED_NOW, transferJourneys, delayLeg, cancelLeg,
  NOW, baseJourneys
} from './fixture.js';

const detail = (journey, now = TRANSFER_NOW, opts) => journeyDetail(journey, now, opts);
const blocksOf = (model, type) => model.blocks.filter((b) => b.type === type);

test('the ledger prints leg, change, leg — the exemplar\'s three blocks', () => {
  const m = detail(transferJourneys()[0]);

  assert.deepEqual(m.blocks.map((b) => b.type), ['leg', 'change', 'leg']);
  assert.equal(m.from, 'Rhodes');
  assert.equal(m.to, 'Bondi Junction');
  assert.equal(m.lede, '1 change at Town Hall · arrives 10:08');
  assert.equal(m.legs[0].figure, '3');
  assert.equal(m.legs[0].provenance, 'MIN');
  assert.equal(m.legs[0].time, '09:24');
  assert.equal(m.legs[0].tail, 'arrives 09:51');
  assert.equal(m.legs[0].platform, '1');
  assert.equal(m.legs[1].figure, '37');
  assert.equal(m.legs[1].platform, '5');
  assert.equal(m.arrival.time, '10:08');
  assert.equal(m.arrival.station, 'Bondi Junction');
  assert.equal(m.arrival.platform, '2');
});

/* The rule the whole change band rests on. 09:51:36 into Town Hall and
   09:58:00 out is 6m24s of wall clock; the page prints 09:51 and 09:58, so the
   figure has to say 7 or it is arguing with the two times beside it. */
test('the change figure agrees with the printed times, not with the wall clock', () => {
  const change = blocksOf(detail(transferJourneys()[0]), 'change')[0];

  assert.equal(change.arrTime, '09:51');
  assert.equal(change.depTime, '09:58');
  assert.equal(change.minutes, 7);
  assert.equal(change.figure, '7');
  assert.equal(change.provenance, 'TO CHANGE');
  assert.equal(change.station, 'Town Hall');
  assert.equal(change.fromPlatform, '3');
  assert.equal(change.toPlatform, '5');
});

/* The real tight connection on this corridor, with no delay applied to it:
   11:08:42 in, 11:12:00 out. 3m18s of wall clock, 4 minutes of timetable. */
test('the real 4-minute change reads 4, and reads as tight without a delay', () => {
  const journeys = transferJourneys();
  const change = blocksOf(detail(journeys[5], TRANSFER_NOW), 'change')[0];

  assert.equal(change.arrTime, '11:08');
  assert.equal(change.depTime, '11:12');
  assert.equal(change.minutes, 4);
  assert.ok(change.minutes < TIGHT_CHANGE_MIN);
  assert.equal(change.tight, true);
  assert.equal(change.shrunk, false);
  // Nothing shrank, so there is no earlier window to report — "printed change
  // was 4 min" beside a 4-minute change would be the page arguing with itself.
  assert.equal(change.warnline, null);
  assert.equal(change.arrStruck, null);
});

test('a delayed first leg shrinks the change: both times, both windows, no verdict', () => {
  const journey = delayLeg(transferJourneys()[0], 0, 5);
  const m = detail(journey);
  const change = m.changes[0];

  assert.equal(m.legs[0].provenance, '5 MIN LATE');
  assert.equal(m.legs[0].kind, 'late');
  assert.equal(m.legs[0].time, '09:29');
  assert.equal(m.legs[0].struck, '09:24');
  assert.equal(change.minutes, 2);
  assert.equal(change.printedMin, 7);
  assert.equal(change.tight, true);
  assert.equal(change.shrunk, true);
  assert.equal(change.warnline, 'Printed change was 7 min');
  assert.equal(change.arrTime, '09:56');
  assert.equal(change.arrStruck, '09:51');
  // The arrival figure is never coloured: only the change is at risk (A3).
  assert.equal(m.legs[1].kind, 'live');
});

test('a comfortable change is not dressed as a tight one', () => {
  const change = detail(transferJourneys()[1]).changes[0];

  assert.equal(change.minutes, 6);
  assert.equal(change.printedMin, 6);
  assert.equal(change.tight, false);
  assert.equal(change.warnline, null);
});

test('one journey can mix a scheduled-only leg with a live one', () => {
  const journey = transferJourneys()[0];
  journey.legDetail[1].departure.estimated = null;
  journey.legDetail[1].arrival.estimated = null;
  const m = detail(journey);

  assert.equal(m.legs[0].scheduledOnly, false);
  assert.equal(m.legs[0].provenance, 'MIN');
  assert.equal(m.legs[1].scheduledOnly, true);
  assert.equal(m.legs[1].provenance, 'SCHEDULED');
  assert.equal(m.legs[1].kind, 'sched');
});

test('a whole journey with no realtime control says so on every leg', () => {
  const m = detail(transferJourneys()[4]);
  assert.deepEqual(m.legs.map((l) => l.provenance), ['SCHEDULED', 'SCHEDULED']);
});

test('the detail view says WHICH leg is cancelled', () => {
  const journey = cancelLeg(transferJourneys()[0], 1);
  const m = detail(journey);

  assert.equal(m.cancelled, true);
  assert.equal(m.cancelledLeg, 1);
  assert.equal(m.legs[0].cancelled, false);
  assert.equal(m.legs[1].cancelled, true);
  assert.equal(m.legs[1].provenance, 'CANCELLED');
  assert.equal(m.legs[1].kind, 'cx');
  assert.equal(m.legs[1].figure, '–');
  assert.equal(m.legs[1].tail, null);
  assert.equal(m.arrival.cancelled, true);
  // A broken connection is not a tight one: the leg row is where that news
  // belongs, and colouring the window would tell it twice in two words.
  assert.equal(m.changes[0].broken, true);
  assert.equal(m.changes[0].tight, false);
});

test('the arrival platform is read from the leg that actually arrives', () => {
  const journeys = transferJourneys();
  // The real case (DESIGN.md): the 10:12 T4 lands on Bondi Junction Platform 1,
  // not the 2 the 09:58 uses. Nothing may assume the platform is unchanged.
  assert.equal(detail(journeys[0]).arrival.platform, '2');
  assert.equal(detail(journeys[1]).arrival.platform, '1');
});

test('a platform upstream does not know prints as a dash, not as a guess', () => {
  const journey = transferJourneys()[0];
  journey.legDetail[1].from.platform = null;
  journey.legDetail[1].to.platform = null;
  const m = detail(journey);

  assert.equal(m.legs[1].platform, null);
  assert.equal(m.changes[0].toPlatform, null);
  assert.equal(m.arrival.platform, null);
});

test('a single-leg journey is one block and no change band', () => {
  const m = journeyDetail(baseJourneys()[0], NOW, { fromName: 'Central Station', toName: 'Parramatta Station' });

  assert.deepEqual(m.blocks.map((b) => b.type), ['leg']);
  assert.equal(m.changes.length, 0);
  assert.equal(m.lede, 'Direct · arrives 23:17');
  assert.equal(m.from, 'Central');
  assert.equal(m.to, 'Parramatta');
  assert.equal(m.legs[0].figure, '3');
  assert.equal(m.arrival.time, '23:17');
});

/* A body cached before the server shipped legDetail still has to render: the
   client keeps the last response in localStorage, so a returning user brings
   one with them. */
test('a journey with no legDetail renders as the single leg it describes', () => {
  const journey = baseJourneys()[0];
  delete journey.legDetail;
  const legs = legsOf(journey, { fromName: 'Central Station', toName: 'Parramatta Station' });

  assert.equal(legs.length, 1);
  assert.equal(legs[0].line.name, 'T1');
  assert.equal(journeyDetail(journey, NOW, { toName: 'Parramatta Station' }).legs[0].figure, '3');
});

test('the leg you are riding counts to the door, not to a departure', () => {
  const m = detail(transferJourneys()[0], TRANSFER_DEPARTED_NOW);
  const riding = m.blocks[0];

  assert.equal(riding.onBoard, true);
  assert.equal(riding.provenance, 'ON BOARD');
  assert.equal(riding.figure, '4');            // 09:47 → off at 09:51
  assert.equal(riding.time, '09:51');
  assert.equal(riding.tail, 'off at Town Hall');
  // The platform that matters on a train you are already on is the one you
  // step onto (A2, transplanted).
  assert.equal(riding.platform, '3');
  assert.equal(m.departed, true);
  assert.equal(m.toGo, 21);
  assert.equal(m.legs[1].provenance, 'MIN');
  assert.equal(m.legs[1].figure, '11');
});

test('a leg that is behind you keeps its place and loses its figure', () => {
  const m = detail(transferJourneys()[0], Date.parse('2026-09-01T10:00:00+10:00'));

  assert.equal(m.legs[0].done, true);
  assert.equal(m.legs[0].figure, '');
  assert.equal(m.legs[0].provenance, '');
  assert.equal(m.changes[0].done, true);
  assert.equal(m.changes[0].figure, '');
  assert.equal(m.legs[1].onBoard, true);
  assert.equal(m.legs[1].provenance, 'ON BOARD');
});

test('off old data the ledger drops its countdowns and keeps its clock times', () => {
  const m = detail(transferJourneys()[0], TRANSFER_NOW, { stale: true });

  assert.equal(m.stale, true);
  assert.deepEqual(m.legs.map((l) => l.figure), ['', '']);
  assert.deepEqual(m.legs.map((l) => l.provenance), ['SCHEDULED', 'SCHEDULED']);
  assert.equal(m.changes[0].figure, '');
  assert.equal(m.legs[0].time, '09:24');
  assert.equal(m.arrival.time, '10:08');
});

test('the journey key is the pair a delay cannot move', () => {
  const journey = transferJourneys()[0];
  const before = journeyKey(journey);
  delayLeg(journey, 0, 9);

  assert.equal(journeyKey(journey), before);
  assert.equal(before, 'T9|2026-09-01T09:24:18+10:00');
});
