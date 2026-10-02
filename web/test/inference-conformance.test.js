import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inferFromRecords, replacesLastOpen, writeLastOpen } from '../js/focus.js';

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
  for (const write of value.writes) doc = writeLastOpen(doc, write.record, write.nowMs, write.sightingAt);
  const focus = inferFromRecords(doc, value.snapshot, value.nowMs, value.fix);
  return focus && { via: 'platform', tripId: focus.tripId, direction: focus.direction, journeyKey: keyOf(focus.journey) };
}

for (const value of fixture.entryCases.cases) {
  test(`entry: ${value.name}`, () => assert.deepEqual(entered(value), value.expected));
}
