import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { locate, scoreCandidate, automaticHomeOf } from '../js/predict.js';
import { boardModel } from '../js/rowmodel.js';

process.env.TZ = 'Australia/Sydney';
const cases = JSON.parse(readFileSync(new URL('../../tools/fixtures/conformance/prediction.json', import.meta.url), 'utf8'));
for (const value of cases) {
  test(`native conformance: ${value.name}`, () => {
    const now = Date.parse(value.now);
    const answer = locate(value.doc, now, { stations: value.stations, fix: value.fix });
    const selection = answer.kind === 'trip' ? { tripId: answer.tripId, reverse: answer.direction === 'reverse' } : null;
    assert.deepEqual(selection, value.expected.selection);
    assert.equal(automaticHomeOf(value.doc)?.station?.id || null, value.expected.home);
    for (const score of value.expected.scores) {
      assert.equal(scoreCandidate(value.doc.history, score.tripId, score.reverse ? 'reverse' : 'forward', now), score.value);
    }
  });
}

const rowCases = JSON.parse(readFileSync(new URL('../../tools/fixtures/conformance/rows.json', import.meta.url), 'utf8'));
for (const value of rowCases) {
  test(`native row conformance: ${value.name}`, () => {
    const past = !!value.syntheticDelta.past;
    const model = boardModel(past ? { ...value.body, journeys: [] } : value.body, value.now, {
      forceStale: !!value.syntheticDelta.offline,
      pastBodies: past ? [value.body] : [],
    });
    const row = (past ? model.pastRows : model.rows)[0];
    assert.deepEqual({ figure: row.figure, provenance: row.provenance, depTime: row.depTime,
      arrTime: row.arrTime, past: row.past }, value.expected);
  });
}
