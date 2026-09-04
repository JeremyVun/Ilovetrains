/* The clock the app prints is Sydney's, not the phone's. A rider checking the
   Central board from Perth, or from a laptop left on UTC, is reading a
   departure that happens on Sydney's clock; printing it in the device's zone
   is off by two or three hours and looks entirely plausible.

   Run under any TZ: nothing here is allowed to depend on the runner's. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { clock, countdownFigure, minutesUntil, ageLabel } from '../js/time.js';

test('a Sydney departure prints its Sydney time from any device zone', (t) => {
  const runnerZone = process.env.TZ;
  t.after(() => { process.env.TZ = runnerZone; });

  const departure = Date.parse('2026-01-15T09:00:00+11:00');
  assert.equal(clock(departure), '09:00');
  for (const zone of ['Australia/Perth', 'UTC', 'America/New_York', 'Australia/Sydney']) {
    process.env.TZ = zone;
    assert.equal(clock(departure), '09:00', zone);
  }
});

test('both sides of the daylight-saving boundary print Sydney wall time', () => {
  assert.equal(clock(Date.parse('2026-08-31T22:48:00+10:00')), '22:48');
  assert.equal(clock(Date.parse('2026-01-15T22:48:00+11:00')), '22:48');
  // The same instant, an hour apart on the two offsets.
  assert.equal(clock(Date.parse('2026-01-15T11:48:00+10:00')), '12:48');
});

test('midnight is 00:00, never 24:00', () => {
  assert.equal(clock(Date.parse('2026-09-01T00:00:00+10:00')), '00:00');
  assert.equal(clock(Date.parse('2026-09-01T00:07:00+10:00')), '00:07');
});

test('the countdown and its clock time are cut from the same minute', () => {
  const now = Date.parse('2026-08-31T22:45:30+10:00');
  const departure = Date.parse('2026-08-31T22:48:10+10:00');
  assert.equal(minutesUntil(departure, now), 3);
  assert.equal(countdownFigure(minutesUntil(departure, now)), '3');
  assert.equal(clock(departure), '22:48');
});

test('freshness copy is exact', () => {
  assert.equal(ageLabel(0, false), 'Updated 0s ago');
  assert.equal(ageLabel(90, false), 'Last updated 2 min ago');
  assert.equal(ageLabel(90, true), 'Offline · last updated 2 min ago');
});
