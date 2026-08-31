process.env.TZ = 'Australia/Sydney'; // the board is read standing in it

import test from 'node:test';
import assert from 'node:assert/strict';

import { boardModel, rowLines, STALE_MS } from '../js/rowmodel.js';
import { NOW, departuresBody, baseJourneys, journey, delay, cancel } from './fixture.js';

const body = (journeys, generatedAt) => departuresBody({ journeys, generatedAt });

test('hero board: six services, the lead counts down in minutes', () => {
  const m = boardModel(body(baseJourneys()), NOW);

  assert.equal(m.stale, false);
  assert.equal(m.rows.length, 6);
  assert.equal(m.sparse, false);
  assert.deepEqual(m.rows.map((r) => r.figure), ['3', '18', '27', '33', '48', '63']);
  assert.equal(m.rows[0].first, true);
  assert.equal(m.rows[0].provenance, 'MIN');
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
  assert.equal(m.rows[0].provenance, 'MIN');
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
  assert.equal(m.rows[1].note, '22:48 cancelled · next running service');
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

test('a service leaving this minute reads Now', () => {
  const m = boardModel(
    body(baseJourneys(), '2026-08-31T22:48:00+10:00'),
    Date.parse('2026-08-31T22:48:30+10:00')
  );
  assert.equal(m.rows[0].figure, 'Now');
  assert.equal(m.rows[0].provenance, 'MIN');
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

/* THE INVARIANT (docs/STYLES.md): three lines per row, in every state, so no
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
      assert.ok(row.provenance !== '', name + ': the figure always states its provenance');
    }
  }
});
