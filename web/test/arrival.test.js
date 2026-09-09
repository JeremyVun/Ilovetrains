import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reduceArrival, validateArrivalSample, normalizeArrivalGuard } from '../js/arrival.js';

const fixture = JSON.parse(readFileSync(new URL('../../tools/fixtures/conformance/commute-feedback.json', import.meta.url)));
const epoch = fixture.epochMs;
const guardOf = value => value == null ? null : {
  ...value,
  ...(value.retainedDelta == null ? {} : { retainedAt: epoch + value.retainedDelta }),
  ...(value.confirmedDelta == null ? {} : { confirmedAt: epoch + value.confirmedDelta })
};
for (const item of fixture.arrivals) test(item.id, () => {
  const defaults = fixture.arrivalDefaults;
  const input = {
    identity: fixture.identity,
    nowMs: epoch + item.nowDelta,
    departureMs: epoch + (item.departureDelta ?? defaults.departureDelta),
    arrivalMs: epoch + (item.arrivalDelta ?? defaults.arrivalDelta),
    destination: Object.hasOwn(item, 'destination') ? item.destination : fixture.destination,
    guard: guardOf(Object.hasOwn(item, 'guard') ? item.guard : defaults.guard),
    matchingRefresh: item.matchingRefresh,
    legacyCompleted: item.legacyCompleted,
    permissionPending: item.permissionPending,
    cancelled: item.cancelled,
    resumeWaitUntilMs: item.resumeWaitUntilDelta == null ? null : epoch + item.resumeWaitUntilDelta
  };
  let window = null;
  let guard = input.guard;
  for (const [offset, lat, lon, accuracy, speed] of item.samples) {
    const next = reduceArrival({ ...input, identity: item.windowIdentity ?? input.identity,
      nowMs: epoch + offset, guard, window, sample: { lat, lon, accuracy, speed, at: epoch + offset } });
    window = next.window;
    guard = next.guard;
  }
  const actual = reduceArrival({ ...input, guard: item.windowIdentity ? input.guard : guard, window });
  assert.equal(actual.state, item.expectedState);
  // A confirmation during the last sample is already latched on the final reduction.
  assert.equal(actual.action, item.expectedAction);
  if (item.expectedBasis) assert.equal(actual.basis, item.expectedBasis);
  if (Object.hasOwn(item, 'expectedMoving')) assert.equal(actual.moving, item.expectedMoving);
});

test('sample validation separates invalid speed from invalid position', () => {
  const base = { at: epoch, lat: 0, lon: 0, accuracy: 10 };
  for (const speed of [NaN, Infinity, -1, 101, null]) {
    assert.deepEqual(validateArrivalSample({ ...base, speed }, epoch), base);
  }
  for (const patch of [{ lat: NaN }, { lon: 181 }, { accuracy: 0 }, { accuracy: 101 },
    { at: epoch - 30001 }, { at: epoch + 5001 }]) assert.equal(validateArrivalSample({ ...base, ...patch }, epoch), null);
});

test('duplicates, backwards callbacks and faster-than-five-second fixes are rejected', () => {
  const input = { identity: 'one', departureMs: epoch - 100000, arrivalMs: epoch + 100000,
    nowMs: epoch, destination: fixture.destination, monitoring: true };
  const first = reduceArrival({ ...input, sample: { at: epoch, lat: 0, lon: 0, accuracy: 10 } });
  for (const offset of [0, -1, 4999]) {
    const next = reduceArrival({ ...input, nowMs: epoch + 5000, guard: first.guard,
      window: first.window, sample: { at: epoch + offset, lat: 0, lon: 0, accuracy: 10 } });
    assert.equal(next.window.samples.length, 1);
  }
});

test('only accepted current evidence checkpoints retention; render ticks do not', () => {
  const input = { identity: 'one', departureMs: epoch - 100000, arrivalMs: epoch,
    nowMs: epoch + 70000, guard: { armed: true, retainedAt: epoch }, destination: fixture.destination };
  const tick = reduceArrival(input);
  assert.equal(Date.parse(tick.guard.retainedAt), epoch);
  const fix = reduceArrival({ ...input, sample: { at: input.nowMs, lat: 0, lon: 0, accuracy: 10 } });
  assert.equal(Date.parse(fix.guard.retainedAt), input.nowMs);
  const noRenew = reduceArrival({ ...input, nowMs: input.nowMs + 70000, guard: fix.guard, window: fix.window });
  assert.equal(noRenew.guard.retainedAt, fix.guard.retainedAt);
});

test('corrupt metadata cannot latch a completion and missing retention does not renew on reload', () => {
  assert.deepEqual(normalizeArrivalGuard({ armed: true, basis: 'location', confirmedAt: 'nonsense' }), { armed: true });
  const input = { identity: 'one', departureMs: epoch - 100000, arrivalMs: epoch, nowMs: epoch + 100000,
    guard: { armed: true, basis: 'location', confirmedAt: epoch + 999999 } };
  const first = reduceArrival(input);
  assert.notEqual(first.state, 'arrived');
  assert.equal(first.guard.basis, undefined);
  assert.equal(first.guard.confirmedAt, undefined);
  assert.equal(Date.parse(first.guard.retainedAt), epoch);
  const restored = reduceArrival({ ...input, nowMs: epoch + 200000, guard: first.guard });
  assert.equal(restored.guard.retainedAt, first.guard.retainedAt);
});

test('completed focus keeps the ordinary ETA-plus-thirty-minute expiry', () => {
  const input = { identity: 'one', departureMs: epoch - 100000, arrivalMs: epoch, nowMs: epoch + 1800001 };
  for (const completion of [
    { legacyCompleted: true },
    { guard: { armed: true, retainedAt: epoch + 1800000, basis: 'location', confirmedAt: epoch } }
  ]) assert.equal(reduceArrival({ ...input, ...completion }).action, 'expire');
});

test('guard arms before an ETA boundary can settle, even with no useful fix', () => {
  const actual = reduceArrival({ identity: 'one', departureMs: epoch - 100000, arrivalMs: epoch,
    nowMs: epoch, monitoring: true });
  assert.equal(actual.guard.armed, true);
  assert.equal(actual.state, 'checkingArrival');
  assert.equal(actual.action, 'none');
});
