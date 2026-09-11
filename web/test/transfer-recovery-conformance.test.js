import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// Phase 1 gives the web client the composed journey; each of these becomes a real assertion then.
for (const value of fixture.cases) test.todo(`transfer recovery: ${value.name}`);
