process.env.TZ = 'Australia/Sydney'; // the board is read standing in it

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { boardModel, rowLines, STALE_MS } from '../js/rowmodel.js';
import { emptyCopy, resultRowHtml } from '../js/board.js';
import { departureKey, journeyKey } from '../js/journey.js';
import { NOW, departuresBody, baseJourneys, journey, delay, cancel } from './fixture.js';
import {
  TRANSFER_NOW, transferBody, transferJourneys, cancelLeg, delayLeg, threeLegJourney,
  FERRY_NOW, ferryBody, mixedBody, mixedJourneys
} from './fixture.js';

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
  assert.equal(m.rows[0].figure, '—');
  assert.equal(m.rows[0].provenance, 'CANCELLED');
  assert.equal(m.rows[0].arrTime, '23:17', 'the timetabled arrival survives the cancellation');
  assert.equal(m.rows[1].note, '22:48 cancelled · next train');
  // The note belongs to the next RUNNING service, and only to it.
  assert.equal(m.rows[0].note, null);
  assert.equal(m.rows[3].note, null);
  assert.equal(m.rows[3].provenance, 'CANCELLED');
});

test('a cancelled row prints an em dash and keeps the arrival it promised', () => {
  const js = baseJourneys();
  cancel(js[0]);
  const row = boardModel(body(js), NOW).rows[0];

  assert.equal(row.figure, '\u2014', 'the cancelled figure is an em dash, not an en dash');
  assert.equal(row.arrTime, '23:17');
  assert.equal(rowLines(row)[0], '22:48 arrives 23:17');
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
  assert.equal(m.rows[0].figure, '—');
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
  assert.deepEqual(cancelled.rows.map((r) => [r.figure, r.wide]), [['—', false]]);
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

test('past punctuality — not elapsed time — requires an actuals record', () => {
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

  // Owner ruling 2026-09-05: the scheduled time answers "how long ago?" too.
  assert.equal(timetableRow.figure, '15', 'elapsed is counted from the scheduled departure');
  assert.equal(timetableRow.provenance, 'AGO');
  assert.equal(timetableRow.depTime, '22:30', 'the stale delta is not printed as an actual');
  assert.equal(timetableRow.schedTime, null);
  assert.equal(timetableRow.delayMin, 0);
  assert.equal(timetableRow.kind, 'sched', 'the numeral keeps the quiet scheduled weight');
  assert.equal(timetableRow.provenanceWarn, false);
});

/* The journey-level estimate can outlive the per-leg realtime record in a
   cached past page. Nothing derived from it may reach the screen. */
test('a stale delta on a timetable-only past row never becomes a struck time', () => {
  const journeyWithDelta = journey('22:30', '22:42', '12', 'T1', 'Penrith', true);
  delay(journeyWithDelta, 9);
  journeyWithDelta.legDetail = [{
    line: journeyWithDelta.line,
    headsign: journeyWithDelta.destinationHeadsign,
    from: { name: 'Central', platform: 'Platform 12' },
    to: { name: 'Parramatta', platform: 'Platform 1' },
    departure: { scheduled: journeyWithDelta.departure.scheduled, estimated: null },
    arrival: { scheduled: journeyWithDelta.arrival.scheduled, estimated: null }
  }];

  const row = boardModel(departuresBody({ journeys: [] }), NOW, {
    pastBodies: [{ journeys: [journeyWithDelta] }]
  }).pastRows[0];

  assert.equal(row.actual, false);
  assert.equal(row.schedTime, null, 'no strike without actuals');
  assert.equal(row.delayMin, 0, 'no delay without actuals');
  assert.equal(row.depTime, '22:30', 'the timetable time is the one printed');
  assert.equal(row.figure, '15', 'elapsed still counts, from the scheduled time');
  assert.equal(row.provenance, 'AGO');
  assert.deepEqual(rowLines(row), ['22:30 arrives 22:42', 'Platform 12 · T1', 'Penrith']);
});

/* The train you just missed is in the past register the moment it leaves, not
   whenever upstream gets round to dropping it (ui.md, departed services). */
test('a service the live answer still lists but has already run is a past row', () => {
  const journeys = baseJourneys();
  const departed = journeys[0];
  const model = boardModel(departuresBody({ journeys }), NOW + 4 * 60_000, {
    pastBodies: [{ journeys: [departed] }]
  });

  assert.ok(!model.futureRows.some((row) => row.depTime === '22:48'),
    'a departed service has no future row');
  const row = model.pastRows.find((item) => item.depTime === '22:48');
  assert.ok(row, 'the last live copy of it stands in the past register');
  assert.equal(row.provenance, 'AGO');
  assert.equal(row.actual, true, 'the live estimate is an actuals record');

  // A service the live answer does still show keeps winning over a past copy.
  const running = boardModel(departuresBody({ journeys }), NOW, {
    pastBodies: [{ journeys: [departed] }]
  });
  assert.equal(running.pastRows.length, 0);
});

test('live and past alternatives deduplicate by their shared first departure', () => {
  const [live, oldAlternative] = mixedJourneys();
  delayLeg(live, 0, 7);
  const now = Date.parse('2026-09-05T15:30:00+10:00');
  const model = boardModel({
    generatedAt: new Date(now).toISOString(), journeys: [live]
  }, now, { pastBodies: [{ journeys: [oldAlternative] }] });

  assert.equal(model.futureRows.length, 1);
  assert.equal(model.pastRows.length, 0);
  assert.equal(model.futureRows[0].departureKey, departureKey(oldAlternative));
  assert.notEqual(model.futureRows[0].matchKey, journeyKey(oldAlternative),
    'the itinerary key remains independent of first-departure dedupe');
});

test('ferry rows derive paint and words from mode without hiding the operator code', () => {
  const model = boardModel(ferryBody(), FERRY_NOW);
  assert.deepEqual(model.rows.slice(0, 2).map((row) => [row.lineCode, row.colourKey]), [
    ['MFF', 'FERRY'], ['F1', 'FERRY']
  ]);
  assert.equal(model.rows[0].lineFill, 'var(--line-fill-FERRY)');
  assert.equal(rowLines(model.rows[0])[1], 'Wharf 2, Side A · MFF');
  assert.match(resultRowHtml(model.rows[0]), /aria-label="15:40 arrives 16:00\. Wharf 2, Side A · MFF\. Manly"/);
  const mixedRows = boardModel(mixedBody(), Date.parse('2026-09-05T15:25:00+10:00')).rows;
  assert.equal(new Set(mixedRows.map((row) => row.matchKey)).size, 2);
  assert.equal(new Set(mixedRows.map((row) => row.key)).size, 2);
  assert.match(resultRowHtml(mixedRows[0]), /aria-label="[^"]*Wharf 2, Side A[^"]*"/);

  const cancelled = ferryBody();
  cancelled.journeys[0].cancelled = true;
  cancelled.journeys[0].legDetail[0].cancelled = true;
  const replacement = boardModel(cancelled, FERRY_NOW).rows[1];
  assert.equal(replacement.note, '15:40 cancelled · next ferry');

  const crossMode = ferryBody();
  crossMode.journeys[0].cancelled = true;
  crossMode.journeys[0].legDetail[0].cancelled = true;
  crossMode.journeys[1].line = { name: 'T8', mode: 'train' };
  crossMode.journeys[1].legDetail[0].line = crossMode.journeys[1].line;
  crossMode.journeys[1].departure.platform = 'Platform 4';
  crossMode.journeys[1].legDetail[0].from.platform = 'Platform 4';
  const trainReplacement = boardModel(crossMode, FERRY_NOW).rows[1];
  assert.equal(trainReplacement.note, '15:40 cancelled · next train');
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

/* --- transfer facts, and the row they are printed on ---------------------- */

test('a row carries each change: the station, both platforms and the window', () => {
  const m = boardModel(transferBody(), TRANSFER_NOW);

  assert.deepEqual(m.rows[0].changes, [{
    station: 'Town Hall', fromStation: 'Town Hall', toStation: 'Town Hall',
    fromPlatform: '3', toPlatform: '5', fromLabel: 'Platform 3', toLabel: 'Platform 5',
    fromPlace: 'Platform', toPlace: 'Platform',
    minutes: 7, printed: 7, tight: false, broken: false
  }]);
  assert.equal(m.rows[0].changes[0].station, 'Town Hall', 'the station a browsing user needs, without opening detail');
});

test('two changes are two sets of facts, in travel order', () => {
  const m = boardModel(transferBody({ journeys: [threeLegJourney()] }), TRANSFER_NOW);

  assert.deepEqual(m.rows[0].changes.map((c) => [c.station, c.fromPlatform, c.toPlatform, c.minutes]), [
    ['Town Hall', '3', '5', 7],
    ['Central', '12', '13', 5]
  ]);
});

/* Floored to the printed clock minute, like journey.js: the row and the detail
   view can never disagree about a window. */
test('a shortened change is tight on the row, and prints its printed window', () => {
  const late = delayLeg(transferJourneys()[0], 0, 5);
  const m = boardModel(transferBody({ journeys: [late] }), TRANSFER_NOW);

  assert.equal(m.rows[0].changes[0].minutes, 2);
  assert.equal(m.rows[0].changes[0].printed, 7);
  assert.equal(m.rows[0].changes[0].tight, true);
});

/* Painting a coral dwell gap under a cancelled row says the same bad news
   twice. */
test('a change beside a cancelled leg is broken and never tight', () => {
  const broken = cancelLeg(delayLeg(transferJourneys()[0], 0, 5), 1);
  const m = boardModel(transferBody({ journeys: [broken] }), TRANSFER_NOW);

  assert.equal(m.rows[0].changes[0].broken, true);
  assert.equal(m.rows[0].changes[0].tight, false);
  assert.doesNotMatch(resultRowHtml(m.rows[0]), /tight-gap/);
});

test('a journey cancelled with no leg named still cannot paint a tight change', () => {
  const cancelled = delayLeg(transferJourneys()[0], 0, 5);
  cancelled.cancelled = true;
  const m = boardModel(transferBody({ journeys: [cancelled] }), TRANSFER_NOW);

  assert.equal(m.rows[0].changes[0].tight, false);
  assert.doesNotMatch(resultRowHtml(m.rows[0]), /tight-gap/);
});

/* --- the row markup the detail view promotes ------------------------------ */

test('a cancelled row keeps its arrival and strikes it', () => {
  const cancelled = cancel(structuredClone(baseJourneys()[0]));
  const m = boardModel(body([cancelled, ...baseJourneys().slice(1)]), NOW);
  const html = resultRowHtml(m.rows[0]);

  assert.equal(m.rows[0].arrTime, '23:17', 'the arrival is what the next train is judged against');
  assert.match(html, /data-cancelled-final="true"/);
  assert.match(html, /<del>23:17<\/del>/);
  assert.match(html, /class="sy-dp"/);
  assert.doesNotMatch(html, /sy-arx/, 'the board says CANCELLED in the figure slot, not twice');
  assert.match(resultRowHtml(m.rows[0], { promoted: true }), /sy-arx/);
});

/* No width cap may shorten "Gordon via Lindfield" while the row still has
   width. */
test('the headsign is printed whole, and the stylesheet puts no cap on it', () => {
  const m = boardModel(transferBody(), TRANSFER_NOW);
  const html = resultRowHtml(m.rows[0]);

  assert.match(html, /data-full-headsign="Gordon via Lindfield"/);
  assert.match(html, />Gordon via Lindfield</);

  const rule = /\n\.sy-sign\s*\{([^}]*)\}/.exec(
    readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8'));
  assert.ok(rule, '.sy-sign is styled');
  assert.match(rule[1], /max-width:\s*100%/);
  assert.doesNotMatch(rule[1], /max-width:\s*\d?\d%/, 'no fractional width cap');
});

test('a two-change row hides one alighting numeral and nothing else', () => {
  const m = boardModel(transferBody({ journeys: [threeLegJourney()] }), TRANSFER_NOW);
  const html = resultRowHtml(m.rows[0]);

  assert.match(html, /class="sy-row change two /);
  assert.match(html, /data-transfer-station data-transfer-index="0">Town Hall</);
  assert.match(html, /data-transfer-station data-transfer-index="1">Central</);
  assert.match(html, /data-pin="b"[^>]*data-transfer-index="1"/);
  assert.match(html, /data-pin="a"[^>]*data-transfer-index="1"/, 'still rendered; the stylesheet hides it');
});

test('the row keeps the hooks the client and the instruments drive it by', () => {
  const m = boardModel(transferBody(), TRANSFER_NOW);
  const html = resultRowHtml(m.rows[0]);

  for (const hook of ['data-t="row"', 'data-svc', 'data-key=', 'data-match=', 'data-act="detail"',
    'role="button"', 'tabindex="0"', 'data-axis=', 'data-seg', 'data-headsign', 'data-result-arrival']) {
    assert.ok(html.includes(hook), 'the row carries ' + hook);
  }
  assert.doesNotMatch(resultRowHtml(m.rows[0], { tappable: false }), /data-act/,
    'the promoted row on detail is not a tap target');
});
