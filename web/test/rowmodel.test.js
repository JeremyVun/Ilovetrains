process.env.TZ = 'Australia/Sydney'; // the board is read standing in it

import test from 'node:test';
import assert from 'node:assert/strict';

import { boardModel, rowLines, STALE_MS } from '../js/rowmodel.js';
import { emptyCopy } from '../js/board.js';
import { NOW, departuresBody, baseJourneys, journey, delay, cancel } from './fixture.js';

const body = (journeys, generatedAt) => departuresBody({ journeys, generatedAt });

test('hero board: six services, the lead counts down in minutes', () => {
  const m = boardModel(body(baseJourneys()), NOW);

  assert.equal(m.stale, false);
  assert.equal(m.rows.length, 6);
  assert.equal(m.sparse, false);
  assert.deepEqual(m.rows.map((r) => r.figure), ['3', '18', '27', '33', '48', '63']);
  assert.equal(m.rows[0].first, true);
  assert.equal(m.rows[0].provenance, '', 'ordinary live service needs no exception word');
  assert.equal(m.rows[0].depTime, '22:48');
  assert.equal(m.rows[0].arrTime, '23:17');
  assert.equal(m.rows[0].platform, '12');
  assert.equal(m.rows[0].lineCode, 'T1');
  assert.equal(m.footer.text, 'Updated 0s ago');
  assert.equal(m.footer.dot, 'live');
});

test('no realtime feed is not set with the same confidence as a live figure', () => {
  const m = boardModel(body(baseJourneys()), NOW);
  const scheduledOnly = m.rows[4];

  assert.equal(scheduledOnly.scheduledOnly, true);
  assert.equal(scheduledOnly.provenance, 'SCHEDULED');
  assert.equal(scheduledOnly.kind, 'sched');
  assert.equal(scheduledOnly.provenanceWarn, false);
});

test('a delay is shown as both numbers and named under the figure', () => {
  const js = baseJourneys();
  delay(js[0], 6);
  const m = boardModel(body(js), NOW);

  assert.equal(m.rows[0].provenance, '6 MIN LATE');
  assert.equal(m.rows[0].kind, 'late');
  assert.equal(m.rows[0].provenanceWarn, true);
  assert.equal(m.rows[0].depTime, '22:54');
  assert.equal(m.rows[0].schedTime, '22:48');
  assert.equal(m.rows[0].figure, '9');
});

test('estimated equal to scheduled means on time and monitored, not scheduled-only', () => {
  const m = boardModel(body(baseJourneys()), NOW);
  assert.equal(m.rows[0].provenance, '');
  assert.equal(m.rows[0].scheduledOnly, false);
});

test('a cancelled lead never silently skips: the next running service says so', () => {
  const js = baseJourneys();
  cancel(js[0]);
  cancel(js[3]);
  const m = boardModel(body(js), NOW);

  assert.equal(m.rows[0].cancelled, true);
  assert.equal(m.rows[0].figure, '–');
  assert.equal(m.rows[0].provenance, 'CANCELLED');
  assert.equal(m.rows[0].arrTime, null);
  assert.equal(m.rows[1].note, '22:48 cancelled · next train');
  // The note belongs to the next RUNNING service, and only to it.
  assert.equal(m.rows[0].note, null);
  assert.equal(m.rows[3].note, null);
  assert.equal(m.rows[3].provenance, 'CANCELLED');
});

test('a running lead carries no cancellation note', () => {
  const js = baseJourneys();
  cancel(js[3]);
  const m = boardModel(body(js), NOW);
  assert.equal(m.rows.every((r) => r.note === null), true);
});

test('stale board: clock times only, departed rows dropped, offline footer', () => {
  const js = baseJourneys();
  const fourHoursAgo = new Date(NOW - 4 * 3600_000).toISOString();
  // Data fetched four hours ago; the first three services have since departed.
  const m = boardModel(body(js, fourHoursAgo), NOW + 20 * 60000);

  assert.equal(m.stale, true);
  assert.equal(m.rows.length, 4, 'the 22:48 and 23:03 services have departed');
  assert.equal(m.rows.every((r) => r.figure === ''), true, 'no countdown off stale data');
  assert.equal(m.rows.every((r) => r.provenance === 'SCHEDULED'), true);
  assert.equal(m.rows[0].depTime, '23:12');
  assert.equal(m.footer.text, 'Offline · last updated 4 h ago');
  assert.equal(m.footer.dot, 'stale');
});

test('staleness threshold is the refresh cadence plus margin', () => {
  const fresh = boardModel(body(baseJourneys(), new Date(NOW - STALE_MS + 1000).toISOString()), NOW);
  const old = boardModel(body(baseJourneys(), new Date(NOW - STALE_MS - 1000).toISOString()), NOW);

  assert.equal(fresh.stale, false);
  assert.equal(fresh.rows[0].figure, '3');
  assert.equal(old.stale, true);
  assert.equal(old.rows[0].figure, '');
});

test('a stale cancelled row keeps saying cancelled', () => {
  const js = baseJourneys();
  cancel(js[0]);
  const m = boardModel(body(js, new Date(NOW - 300_000).toISOString()), NOW);
  assert.equal(m.rows[0].figure, '–');
  assert.equal(m.rows[0].provenance, 'CANCELLED');
});

test('offline forces the stale treatment even on fresh-looking data', () => {
  const m = boardModel(body(baseJourneys()), NOW, { forceStale: true });
  assert.equal(m.stale, true);
  assert.equal(m.footer.text.startsWith('Offline · '), true);
});

test("the server's X-Data-Stale header dims the freshness dot without dropping figures", () => {
  const m = boardModel(body(baseJourneys()), NOW, { degraded: true });
  assert.equal(m.stale, false);
  assert.equal(m.rows[0].figure, '3');
  assert.equal(m.footer.dot, 'stale');
});

test('departed services close the list upward; a shorter board distributes', () => {
  const m = boardModel(body(baseJourneys()), NOW + 30 * 60000);
  assert.equal(m.rows.length, 3);
  assert.equal(m.sparse, true);
  assert.equal(m.rows[0].first, true);
});

/* "Now / MIN" printed a unit under a figure that is not a number of minutes.
   The slot names the event instead, as required by docs/contracts/ui.md. */
test('a service leaving this minute reads Now, and the slot under it says DEPARTING', () => {
  const m = boardModel(
    body(baseJourneys(), '2026-08-31T22:48:00+10:00'),
    Date.parse('2026-08-31T22:48:30+10:00')
  );
  assert.equal(m.rows[0].figure, 'Now');
  assert.equal(m.rows[0].provenance, 'DEPARTING');
  // ...and only that row: the ones with a wait still count in minutes.
  assert.equal(m.rows[1].figure, '15');
  assert.equal(m.rows[1].provenance, '');
});

test('DEPARTING never displaces a more specific provenance', () => {
  const now = Date.parse('2026-08-31T22:48:30+10:00');
  const at = '2026-08-31T22:48:00+10:00';

  // A service leaving now, six minutes late, is late — that is the news.
  const late = delay(journey('22:42', '23:11', '12', 'T1', 'Penrith', true), 6);
  const lateModel = boardModel(body([late], at), now);
  assert.equal(lateModel.rows[0].figure, 'Now');
  assert.equal(lateModel.rows[0].provenance, '6 MIN LATE');

  // A service leaving now with no realtime control is still only scheduled to.
  const sched = journey('22:48', '23:17', '12', 'T1', 'Penrith', false);
  const schedModel = boardModel(body([sched], at), now);
  assert.equal(schedModel.rows[0].figure, 'Now');
  assert.equal(schedModel.rows[0].provenance, 'SCHEDULED');

  // A cancelled service does not depart at all.
  const cx = cancel(journey('22:48', '23:17', '12', 'T1', 'Penrith', true));
  const cxModel = boardModel(body([cx], at), now);
  assert.equal(cxModel.rows[0].provenance, 'CANCELLED');
});

/* Past 99 minutes the figure changes unit. "187" is true and unreadable; the
   clock time beside it already says 03:53 better (docs/contracts/ui.md). */
test('past 99 minutes the figure is rounded hours, not three digits', () => {
  const at = (mins) => {
    const t = new Date(NOW + mins * 60000).toISOString();
    return { departure: { scheduled: t, estimated: t, platform: '1' }, arrival: {}, line: { name: 'T1' }, legs: 1 };
  };
  const figures = (mins) => boardModel(
    { generatedAt: new Date(NOW).toISOString(), journeys: mins.map(at) }, NOW
  ).rows.map((r) => r.figure);

  // The boundary: 99 is the last minute figure, 100 is the first hour figure.
  assert.deepEqual(figures([98, 99, 100, 101]), ['98', '99', '2H', '2H']);

  // Rounding is to the NEAREST hour, not truncation: 187 is 3h 7m -> 3H, and
  // 209 (3h 29m) still rounds down while 210 (3h 30m) rounds up.
  assert.deepEqual(figures([187, 209, 210, 240]), ['3H', '3H', '4H', '4H']);

  // The last-train board that found this: every figure is now two characters.
  assert.deepEqual(figures([187, 216, 221, 240, 251, 266]),
    ['3H', '4H', '4H', '4H', '4H', '4H']);
});

/* The rounding rule and the "MIN" vocabulary disagree for a service that is
   both hours away AND under realtime control — "3H / MIN". The owner ruled the
   provenance slot unchanged (2026-09-01 B), noting such a service will
   virtually always be SCHEDULED, which is what the fixture's own late-night
   board shows. Pinned here so the next reader knows it is a decision, not a
   miss. */
test('a far-future service keeps the provenance its data earns', () => {
  const t = new Date(NOW + 187 * 60000).toISOString();
  const unmonitored = { departure: { scheduled: t, estimated: null, platform: '1' }, arrival: {}, line: { name: 'T1' }, legs: 1 };
  const monitored = { departure: { scheduled: t, estimated: t, platform: '1' }, arrival: {}, line: { name: 'T1' }, legs: 1 };
  const gen = new Date(NOW).toISOString();

  const a = boardModel({ generatedAt: gen, journeys: [unmonitored] }, NOW).rows[0];
  assert.equal(a.figure, '3H');
  assert.equal(a.provenance, 'SCHEDULED');

  const b = boardModel({ generatedAt: gen, journeys: [monitored] }, NOW).rows[0];
  assert.equal(b.figure, '3H');
  assert.equal(b.provenance, '');
});

test('unknown platform and empty headsign still fill their lines', () => {
  const j = journey('22:48', '23:17', null, 'T1', '', true);
  const m = boardModel(body([j]), NOW, { fallbackHeadsign: 'Parramatta Station' });
  const [, line2, line3] = rowLines(m.rows[0]);

  assert.equal(m.rows[0].platform, null);
  assert.equal(line2, 'Platform — · T1');
  assert.equal(line3, 'Parramatta Station');
});

test('an empty board is empty, not broken', () => {
  const m = boardModel(departuresBody({ journeys: [] }), NOW);
  assert.equal(m.empty, true);
  assert.equal(m.rows.length, 0);
  assert.equal(m.stale, false);
});

test('a missing generatedAt is treated as stale, not as fresh', () => {
  const m = boardModel({ journeys: baseJourneys() }, NOW);
  assert.equal(m.stale, true);
});

/* A first open with an empty cache has no board timestamp and is not offline
   while its first request is still pending. */
test('a board that was never loaded reports no age', () => {
  const waiting = boardModel({}, NOW);
  assert.equal(waiting.footer.text, '', 'nothing has been updated yet');
  assert.equal(waiting.footer.dot, 'idle', 'and nothing is wrong yet either');

  const offline = boardModel({}, NOW, { forceStale: true });
  assert.equal(offline.footer.text, 'Offline');
  assert.equal(offline.footer.dot, 'stale');
});

test('a board that WAS loaded still reports its age', () => {
  const fresh = boardModel(departuresBody(), NOW);
  assert.equal(fresh.footer.text, 'Updated 0s ago');
  assert.equal(fresh.footer.dot, 'live');

  const old = boardModel(departuresBody({ generatedAt: new Date(NOW - 4 * 3600_000).toISOString() }), NOW);
  assert.equal(old.footer.text, 'Offline · last updated 4 h ago');
  assert.equal(old.footer.dot, 'stale');
});

/* Three characters do not fit the headline figure column, so the row must mark
   them for the smaller type treatment. Rounded hours remove the three-digit
   case, not the width rule: "Now" is
   three characters, and so is any service that rounds to ten hours or more. */
test('a figure of three characters marks itself wide', () => {
  const at = (mins) => {
    const t = new Date(NOW + mins * 60000).toISOString();
    return { departure: { scheduled: t, estimated: t, platform: '1' }, arrival: {}, line: { name: 'T1' }, legs: 1 };
  };
  const widths = (mins) => boardModel({ generatedAt: new Date(NOW).toISOString(), journeys: mins.map(at) }, NOW)
    .rows.map((r) => ({ figure: r.figure, wide: r.wide }));

  // The unit change means no wait between one minute and nine hours is wide.
  assert.deepEqual(widths([9, 99, 100, 187, 569]), [
    { figure: '9', wide: false },
    { figure: '99', wide: false },
    { figure: '2H', wide: false },
    { figure: '3H', wide: false },
    { figure: '9H', wide: false }
  ]);

  // Still reachable, and still stepped down: ten hours, and "Now" — three
  // characters, and letters are wider than digits.
  assert.deepEqual(widths([570]), [{ figure: '10H', wide: true }]);
  assert.deepEqual(widths([0]), [{ figure: 'Now', wide: true }]);

  // A cancelled row's dash and a stale row's empty slot are not wide.
  const cancelled = boardModel({ generatedAt: new Date(NOW).toISOString(), journeys: [cancel(at(187))] }, NOW);
  assert.deepEqual(cancelled.rows.map((r) => [r.figure, r.wide]), [['–', false]]);
  const staleBoard = boardModel({ generatedAt: new Date(NOW - 4 * 3600_000).toISOString(), journeys: [at(187)] }, NOW);
  assert.deepEqual(staleBoard.rows.map((r) => [r.figure, r.wide]), [['', false]]);
});

/* THE INVARIANT (docs/contracts/ui.md): three lines per row, in every state, so no
   state change can reflow a row or push the sixth service below the fold. */
test('every row is exactly three non-empty lines in every state', () => {
  const scenarios = {
    hero: boardModel(body(baseJourneys()), NOW),
    delayed: boardModel(body(baseJourneys().map((j, i) => (i === 0 || i === 3 ? delay(j, 6) : j))), NOW),
    cancelled: boardModel(body(baseJourneys().map((j, i) => (i === 0 || i === 3 ? cancel(j) : j))), NOW),
    scheduled: boardModel(body(baseJourneys().map((j) => {
      j.departure.estimated = null; j.arrival.estimated = null; return j;
    })), NOW),
    stale: boardModel(body(baseJourneys(), new Date(NOW - 4 * 3600_000).toISOString()), NOW),
    sparse: boardModel(body(baseJourneys()), NOW + 30 * 60000)
  };

  for (const [name, model] of Object.entries(scenarios)) {
    assert.ok(model.rows.length > 0, name + ' has rows');
    for (const row of model.rows) {
      const lines = rowLines(row);
      assert.equal(lines.length, 3, name + ': row has three lines');
      for (const line of lines) {
        assert.ok(typeof line === 'string' && line.trim() !== '', name + ': no line is empty');
      }
      assert.equal(typeof row.provenance, 'string', name + ': the reserved state slot is always present');
    }
  }
});

test('past punctuality and elapsed figures require an actuals record', () => {
  const actual = journey('22:30', '22:42', '12', 'T1', 'Penrith', true);
  delay(actual, 4);
  actual.legDetail = [{
    line: actual.line,
    headsign: actual.destinationHeadsign,
    from: { name: 'Central', platform: 'Platform 12' },
    to: { name: 'Parramatta', platform: 'Platform 1' },
    departure: { scheduled: actual.departure.scheduled, estimated: actual.departure.estimated },
    arrival: { scheduled: actual.arrival.scheduled, estimated: actual.arrival.estimated }
  }];

  const timetable = structuredClone(actual);
  // The journey-level delta may survive even when the per-leg realtime gate
  // says this is timetable-only.
  timetable.legDetail[0].departure.estimated = null;
  timetable.legDetail[0].arrival.estimated = null;
  timetable.line = { ...timetable.line, name: 'T2' };
  timetable.legDetail[0].line = timetable.line;

  const model = boardModel(departuresBody({ journeys: [] }), NOW, {
    pastBodies: [{ journeys: [actual, timetable] }]
  });
  const rows = model.pastRows;
  const actualRow = rows.find((row) => row.actual);
  const timetableRow = rows.find((row) => !row.actual);

  assert.ok(actualRow.figure, 'actuals may state elapsed time');
  assert.equal(actualRow.provenance, 'AGO');
  assert.equal(actualRow.depTime, '22:34');
  assert.equal(actualRow.schedTime, '22:30');
  assert.equal(actualRow.kind, 'late');

  assert.equal(timetableRow.figure, '', 'timetable-only may not state elapsed time');
  assert.equal(timetableRow.provenance, 'TIMETABLE ONLY');
  assert.equal(timetableRow.depTime, '22:30', 'the stale delta is not printed as an actual');
  assert.equal(timetableRow.schedTime, null);
  assert.equal(timetableRow.kind, 'sched');
  assert.equal(timetableRow.provenanceWarn, false);
});

/* --- the line that stands in for the whole board -------------------------- */

/* When there are no rows there is one sentence on the screen, and on a cold
   pair the user reads it for one to two seconds while TfNSW answers. It has to
   say which of the four possible nothings this is. */
test('an empty board names what it is waiting for, not what the machine is doing', () => {
  const waiting = boardModel({}, NOW);
  waiting.status = 'loading';
  const copy = emptyCopy(waiting);

  assert.match(copy, /trains/i, 'the wait is named in the product\'s own noun');
  assert.notEqual(copy.toLowerCase(), 'loading');
  assert.doesNotMatch(copy, /error|fetch|request|API|null/i);
  assert.ok(copy.length <= 30, 'one letterspaced line');
});

test('the four empty boards are four different sentences', () => {
  const loading = boardModel({}, NOW);
  loading.status = 'loading';
  const offline = boardModel({}, NOW, { forceStale: true });
  offline.status = 'offline';
  const staleEmpty = boardModel(body([], new Date(NOW - 4 * 3600_000).toISOString()), NOW);
  const fresh = boardModel(body([]), NOW);

  const copies = [loading, offline, staleEmpty, fresh].map(emptyCopy);
  assert.equal(new Set(copies).size, 4, 'each nothing says which nothing it is');
  for (const copy of copies) assert.ok(copy.trim().length > 0);
});
