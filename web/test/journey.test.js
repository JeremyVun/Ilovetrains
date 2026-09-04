process.env.TZ = 'Australia/Sydney'; // every clock string the page prints is device-local

import test from 'node:test';
import assert from 'node:assert/strict';

import { journeyDetail, journeyKey, legsOf, TIGHT_CHANGE_MIN } from '../js/journey.js';
import {
  TRANSFER_NOW, TRANSFER_DEPARTED_NOW, transferJourneys, delayLeg, cancelLeg,
  NOW, baseJourneys
} from './fixture.js';

const detail = (journey, now = TRANSFER_NOW, opts) => journeyDetail(journey, now, opts);
const labels = (model) => model.steps.map((s) => s.label);

test('the journey prints as board, change, arrive in travel order', () => {
  const m = detail(transferJourneys()[0]);

  assert.deepEqual(m.steps.map((s) => s.kind), ['board', 'change', 'arrive']);
  assert.equal(m.from, 'Rhodes');
  assert.equal(m.to, 'Bondi Junction');
  assert.equal(m.summary, '1 change · arrives 10:08');
  assert.equal(m.summaryWarn, false);

  const [board, change, arrive] = m.steps;
  assert.deepEqual([board.time, board.station], ['09:24', 'Rhodes']);
  assert.deepEqual(board.chip, { code: 'T9', platform: '1' });
  assert.equal(board.label, 'Board T9 · Gordon via Lindfield');
  assert.deepEqual([change.time, change.station], ['7 min', 'Town Hall']);
  assert.deepEqual(change.off, { code: 'T9', platform: '3' });
  assert.deepEqual(change.on, { code: 'T4', platform: '5' });
  assert.equal(change.label, 'Board');
  assert.deepEqual([arrive.time, arrive.station], ['10:08', 'Bondi Junction']);
  assert.deepEqual(arrive.chip, { code: 'T4', platform: '2' });
  assert.equal(arrive.label, 'Arrive');
  assert.deepEqual(m.arrival, {
    time: '10:08', station: 'Bondi Junction', platform: '2', cancelled: false
  });
});

/* The rule the whole change step rests on. 09:51:36 into Town Hall and
   09:58:00 out is 6m24s of wall clock; the page prints 09:51 and 09:58, so the
   window has to say 7 or it is arguing with the two times beside it. */
test('the change window agrees with the printed times, not with the wall clock', () => {
  const change = detail(transferJourneys()[0]).changes[0];

  assert.equal(change.arrTime, '09:51');
  assert.equal(change.depTime, '09:58');
  assert.equal(change.minutes, 7);
  assert.equal(change.station, 'Town Hall');
  assert.equal(change.fromPlatform, '3');
  assert.equal(change.toPlatform, '5');
});

/* The real tight connection on this corridor, with no delay applied to it:
   11:08:42 in, 11:12:00 out. 3m18s of wall clock, 4 minutes of timetable. */
test('the real 4-minute change reads 4, and reads as tight without a delay', () => {
  const m = detail(transferJourneys()[5], TRANSFER_NOW);
  const change = m.changes[0];

  assert.equal(change.minutes, 4);
  assert.ok(change.minutes < TIGHT_CHANGE_MIN);
  assert.equal(change.tight, true);
  assert.equal(m.steps[1].tight, true);
  assert.equal(m.steps[1].time, '4 min');
  assert.equal(m.steps[1].label, '4 min change');
});

/* A shortened change ships as the window it is: named once, with nothing
   struck and no earlier window beside it. */
test('a shortened change prints its current window and only that', () => {
  const m = detail(delayLeg(transferJourneys()[0], 0, 5));
  const change = m.changes[0];

  assert.equal(change.minutes, 2);
  assert.equal(change.printedMin, 7);
  assert.equal(change.tight, true);
  assert.equal(m.steps[1].time, '2 min');
  assert.equal(m.steps[1].label, '2 min change');
  assert.equal(m.steps[0].time, '09:29');
  assert.ok(!m.steps.some((s) => s.time === '7 min' || /7 min/.test(s.label)),
    'no step prints the window the change used to be');
});

test('a comfortable change is not dressed as a tight one', () => {
  const m = detail(transferJourneys()[1]);

  assert.equal(m.changes[0].minutes, 6);
  assert.equal(m.changes[0].tight, false);
  assert.equal(m.steps[1].tight, false);
  assert.equal(m.steps[1].label, 'Board');
});

test('the summary names the cancelled leg by its departure', () => {
  const second = detail(cancelLeg(transferJourneys()[0], 1));
  assert.equal(second.summary, 'The 09:58 from Town Hall is cancelled.');
  assert.equal(second.summaryWarn, true);
  assert.equal(second.cancelledLeg, 1);

  const first = detail(cancelLeg(transferJourneys()[0], 0));
  assert.equal(first.summary, 'The 09:24 from Rhodes is cancelled.');
  assert.equal(first.cancelledLeg, 0);
});

/* The API cancels a journey; only `legDetail` can say which leg. When it does
   not, every step is off, which is what the struck board row already says. */
test('a journey cancelled with no leg named is cancelled in all of them', () => {
  const journey = transferJourneys()[0];
  journey.cancelled = true;
  const m = detail(journey);

  assert.equal(m.cancelled, true);
  assert.equal(m.summary, 'The 09:24 from Rhodes is cancelled.');
  assert.deepEqual(m.steps.map((s) => s.cancelled), [true, true, true]);
  assert.equal(m.arrival.cancelled, true);
});

test('a broken change says so instead of naming a window, and is never tight', () => {
  const m = detail(cancelLeg(transferJourneys()[5], 1)); // the 4-minute change
  const change = m.steps[1];

  assert.equal(change.cancelled, true);
  assert.equal(change.label, 'Cancelled');
  // A broken connection is not a tight one: colouring the window as well would
  // tell the same bad news twice in two different words.
  assert.equal(change.tight, false);
  assert.equal(m.changes[0].broken, true);
  assert.equal(m.changes[0].tight, false);
});

test('the arrival is only cancelled when the leg that arrives is', () => {
  const final = detail(cancelLeg(transferJourneys()[0], 1));
  assert.equal(final.steps[2].label, 'Arrive · Journey cancelled');
  assert.equal(final.steps[2].cancelled, true);
  assert.equal(final.arrival.cancelled, true);

  const firstLeg = detail(cancelLeg(transferJourneys()[0], 0));
  assert.equal(firstLeg.steps[2].label, 'Arrive');
  assert.equal(firstLeg.steps[2].cancelled, false);
  assert.equal(firstLeg.steps[0].cancelled, true);
  assert.equal(firstLeg.arrival.cancelled, false);
});

test('the arrival platform is read from the leg that actually arrives', () => {
  const journeys = transferJourneys();
  // The 10:12 T4 lands on Bondi Junction Platform 1, not the 2 the 09:58 uses.
  // Nothing may assume the platform is unchanged.
  assert.equal(detail(journeys[0]).arrival.platform, '2');
  assert.equal(detail(journeys[1]).arrival.platform, '1');
});

test('a platform upstream does not know prints as a dash, not as a guess', () => {
  const journey = transferJourneys()[0];
  journey.legDetail[1].from.platform = null;
  journey.legDetail[1].to.platform = null;
  const m = detail(journey);

  assert.equal(m.changes[0].toPlatform, null);
  assert.equal(m.steps[1].on.platform, '—');
  assert.equal(m.steps[2].chip.platform, '—');
  assert.equal(m.arrival.platform, null);
});

test('a direct journey is two steps and no change', () => {
  const m = journeyDetail(baseJourneys()[2], NOW, {
    fromName: 'Central Station', toName: 'Parramatta Station'
  });

  assert.deepEqual(m.steps.map((s) => s.kind), ['board', 'arrive']);
  assert.equal(m.changes.length, 0);
  assert.equal(m.summary, 'Direct · arrives 23:36');
  assert.equal(m.from, 'Central');
  assert.equal(m.to, 'Parramatta');
  assert.deepEqual(labels(m), ['Board BMT · Mount Victoria via Parramatta', 'Arrive']);
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
  const m = journeyDetail(journey, NOW, { fromName: 'Central Station', toName: 'Parramatta Station' });
  assert.deepEqual(m.steps.map((s) => s.time), ['22:48', '23:17']);
});

/* The steps behind the rider are quiet rather than gone — the ladder is how
   the journey is read, and half a ladder is a different screen. */
test('a step the rider is past is done, and the ones ahead are not', () => {
  const m = detail(transferJourneys()[0], TRANSFER_DEPARTED_NOW); // 09:47, riding leg 0

  assert.equal(m.departed, true);
  assert.deepEqual(m.steps.map((s) => s.done), [true, false, false]);

  const later = detail(transferJourneys()[0], Date.parse('2026-09-01T10:00:00+10:00'));
  assert.deepEqual(later.steps.map((s) => s.done), [true, true, false]);
});

test('a step states a time, not a countdown, so old data cannot age it', () => {
  const m = detail(transferJourneys()[0], TRANSFER_NOW, { stale: true });
  const fresh = detail(transferJourneys()[0], TRANSFER_NOW);

  assert.equal(m.stale, true);
  assert.deepEqual(m.steps.map((s) => s.time), fresh.steps.map((s) => s.time));
  assert.deepEqual(m.steps.map((s) => s.time), ['09:24', '7 min', '10:08']);
});

test('the journey key is the pair a delay cannot move', () => {
  const journey = transferJourneys()[0];
  const before = journeyKey(journey);
  delayLeg(journey, 0, 9);

  assert.equal(journeyKey(journey), before);
  assert.equal(before, 'T9|2026-09-01T09:24:18+10:00');
});
