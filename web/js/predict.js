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
export function distanceKm(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)
      || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return null;
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function locationFactor(fix, origin) {
  const distance = distanceKm(fix, origin && origin.location);
  if (distance === null || (distance > 2 && distance <= 10)) return 1;
  if (distance <= 2) return 2.5;
  return 0.3;
}

export function scoreAll(doc, nowMs, opts = {}) {
  const out = [];
  for (const trip of doc.trips) {
    for (const direction of DIRECTIONS) {
      const origin = direction === 'reverse' ? trip.to : trip.from;
      const baseScore = scoreCandidate(doc.history, trip.id, direction, nowMs);
      out.push({
        tripId: trip.id,
        direction,
        baseScore,
        score: baseScore * locationFactor(opts.fix, origin),
        distanceKm: distanceKm(opts.fix, origin && origin.location)
      });
    }
  }
  return out;
}

/**
 * @returns {{tripId: string, direction: string}|null} null only when no trips
 * are saved. Tie or all-zero falls back to lastViewed, then the first saved
 * trip forward.
 */
export function predict(doc, nowMs, opts = {}) {
  if (!doc.trips.length) return null;

  const candidates = scoreAll(doc, nowMs, opts);
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

/** Saved trips ordered by their strongest direction, with the selected trip at
    the top. The original array is never mutated. */
export function rankTrips(doc, nowMs, opts = {}) {
  const selected = opts.selection || predict(doc, nowMs, opts);
  const candidates = scoreAll(doc, nowMs, opts);
  return doc.trips.map((trip, index) => {
    const directions = candidates.filter((candidate) => candidate.tripId === trip.id);
    const best = directions.sort((a, b) => b.score - a.score)[0] || {
      direction: 'forward', score: 0, distanceKm: null
    };
    const direction = selected && selected.tripId === trip.id ? selected.direction : best.direction;
    const candidate = directions.find((item) => item.direction === direction) || best;
    return { trip, index, ...candidate, selected: Boolean(selected && selected.tripId === trip.id) };
  }).sort((a, b) => Number(b.selected) - Number(a.selected) || b.score - a.score || a.index - b.index);
}
