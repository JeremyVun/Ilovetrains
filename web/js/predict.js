/* Trip prediction, exactly as specified in docs/contracts/client-storage.md.
   Pure and deterministic given (storage document, now). Any change to the
   formula must update that contract in the same change.

     score = Σ over history events matching (trip, direction):
               dayTypeMatch × hourProximity × recencyDecay
     dayTypeMatch: 1.0 same day-type (weekday/weekend) as now, else 0.2
     hourProximity: 1.0 if |eventHour − nowHour| ≤ 1 (mod 24), 0.5 if ≤ 2, else 0
     recencyDecay: 0.97 ^ ageInDays

   Hours and day-type are read in the device's local timezone; the user and
   their commute share one. ageInDays is fractional, so decay is continuous. */

import { DIRECTIONS } from './storage.js';

const DAY_MS = 86_400_000;

export function isWeekend(ms) {
  const d = new Date(ms).getDay();
  return d === 0 || d === 6;
}

export function dayTypeMatch(eventMs, nowMs) {
  return isWeekend(eventMs) === isWeekend(nowMs) ? 1.0 : 0.2;
}

export function hourProximity(eventMs, nowMs) {
  const diff = Math.abs(new Date(eventMs).getHours() - new Date(nowMs).getHours());
  const circular = Math.min(diff, 24 - diff);
  if (circular <= 1) return 1.0;
  if (circular <= 2) return 0.5;
  return 0;
}

export function recencyDecay(eventMs, nowMs) {
  const ageInDays = Math.max(0, (nowMs - eventMs) / DAY_MS);
  return Math.pow(0.97, ageInDays);
}

export function scoreEvent(eventMs, nowMs) {
  return dayTypeMatch(eventMs, nowMs) * hourProximity(eventMs, nowMs) * recencyDecay(eventMs, nowMs);
}

export function scoreCandidate(history, tripId, direction, nowMs) {
  let total = 0;
  for (const e of history) {
    if (e.tripId !== tripId || e.direction !== direction) continue;
    const t = Date.parse(e.t);
    if (Number.isNaN(t)) continue;
    total += scoreEvent(t, nowMs);
  }
  return total;
}

/** All (trip, direction) candidates with their scores, board order preserved. */
export function scoreAll(doc, nowMs) {
  const out = [];
  for (const trip of doc.trips) {
    for (const direction of DIRECTIONS) {
      out.push({ tripId: trip.id, direction, score: scoreCandidate(doc.history, trip.id, direction, nowMs) });
    }
  }
  return out;
}

/**
 * @returns {{tripId: string, direction: string}|null} null only when no trips
 * are saved. Tie or all-zero falls back to lastViewed, then the first saved
 * trip forward.
 */
export function predict(doc, nowMs) {
  if (!doc.trips.length) return null;

  const candidates = scoreAll(doc, nowMs);
  const best = candidates.reduce((a, c) => (c.score > a ? c.score : a), 0);
  const leaders = candidates.filter((c) => c.score === best);
  if (best > 0 && leaders.length === 1) {
    return { tripId: leaders[0].tripId, direction: leaders[0].direction };
  }

  const last = doc.lastViewed;
  if (last && doc.trips.some((t) => t.id === last.tripId)) {
    return { tripId: last.tripId, direction: last.direction };
  }
  return { tripId: doc.trips[0].id, direction: 'forward' };
}
