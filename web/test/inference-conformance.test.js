import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  inferFromRecords, inferOnBoard, onBoardRequests, replacesLastOpen, retiresSnapshot, runningJourney, startable,
  stoppedTrip, writeLastOpen
} from '../js/focus.js';
import { trainSpeed } from '../js/stations.js';

process.env.TZ = 'Australia/Sydney';
const fixture = JSON.parse(readFileSync(new URL('../../tools/fixtures/conformance/inference.json', import.meta.url)));
const keyOf = (journey) => (journey.legDetail || []).map((leg) => [leg.line.name, leg.departure.scheduled]);

for (const value of fixture.holdCases.cases) {
  test(`hold rule: ${value.name}`, () => {
    const replaced = replacesLastOpen(value.doc, value.incoming, value.nowMs, value.sightingAt);
    assert.equal(replaced ? 'incoming' : 'stored', value.expectedKept);
    const written = writeLastOpen(value.doc, value.incoming, value.nowMs, value.sightingAt).lastOpen;
    assert.deepEqual(written, value.expectedKept === 'stored' ? value.doc.lastOpen
      : { at: new Date(value.nowMs).toISOString(), ...value.incoming });
  });
}

function entered(value) {
  let doc = value.doc;
  let snapshot = value.snapshot;
  for (const write of value.writes) {
    if (retiresSnapshot(doc, snapshot, write.record, write.sightingAt)) snapshot = null;
    doc = writeLastOpen(doc, write.record, write.nowMs, write.sightingAt);
  }
  const described = (via, focus) => focus && { via, tripId: focus.tripId, direction: focus.direction, journeyKey: keyOf(focus.journey) };
  const platform = inferFromRecords(doc, snapshot, value.nowMs, value.fix);
  if (platform) return described('platform', platform);
  if (value.expectedRequests) {
    assert.deepEqual(onBoardRequests(doc, value.nowMs, value.fix, value.previousFix, value.cached)
      .map(({ tripId, direction, from, to, at, limit }) => ({ tripId, direction, from, to, at, limit })), value.expectedRequests);
  }
  return trainSpeed(value.fix, value.previousFix)
    ? described('onBoard', inferOnBoard(doc, value.nowMs, value.fix, value.previousFix, value.boards, value.cached)) : null;
}

for (const value of fixture.entryCases.cases) {
  test(`entry: ${value.name}`, () => assert.deepEqual(entered(value), value.expected));
}

for (const value of fixture.startCases.cases) {
  test(`start trip: ${value.name}`, () => assert.equal(startable(value.journey, value.nowMs), value.expectedStartable));
}

for (const value of fixture.runningCases.cases) {
  test(`running row: ${value.name}`, () => assert.equal(
    runningJourney(value.journey, value.nowMs, value.enabledModes || ['train', 'metro', 'ferry']), value.expectedRunning));
}

for (const value of fixture.stopCases.cases) {
  test(`stop trip: ${value.name}`, () => {
    const legs = value.focus.journey.legDetail;
    const stopped = stoppedTrip({ ...value.doc, focus: value.focus }, value.focus,
      { from: legs[0].from, to: legs[legs.length - 1].to }, value.nowMs);
    const decline = stopped.doc.inferenceDeclined;
    assert.equal(stopped.doc.focus, undefined);
    assert.deepEqual(decline ? { ...decline, arrival: Date.parse(decline.arrival), at: Date.parse(decline.at) } : null,
      value.expectedDecline);
    assert.equal(stopped.declinedInferred, value.expectedEvent);
  });
}
