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
import { preferencesOf } from './preferences.js';
import { distanceKm, here } from './stations.js';

export { distanceKm };

const DAY_MS = 86_400_000;

/* Fewer votes than this is not a habit, only a week that happened. */
export const HOME_VOTES_NEEDED = 3;

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

export function locationFactor(fix, origin) {
  const distance = distanceKm(fix, origin && origin.location);
  if (distance === null || (distance > 2 && distance <= 10)) return 1;
  if (distance <= 2) return 2.5;
  return 0.3;
}

/* A floor so a fix can answer where no history can: 0.01 × 2.5 beats
   0.01 × 1.0. Any real history dwarfs it. */
export const PREDICT_FLOOR = 0.01;

/** All (trip, direction) candidates with their scores, board order preserved. */
export function scoreAll(doc, nowMs, opts = {}) {
  const fix = preferencesOf(doc).useLocation ? opts.fix : null;
  const out = [];
  for (const trip of doc.trips) {
    for (const direction of DIRECTIONS) {
      const origin = direction === 'reverse' ? trip.to : trip.from;
      const baseScore = scoreCandidate(doc.history, trip.id, direction, nowMs);
      out.push({
        tripId: trip.id,
        direction,
        baseScore,
        score: (baseScore + PREDICT_FLOOR) * locationFactor(fix, origin),
        distanceKm: distanceKm(fix, origin && origin.location)
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

export function automaticHomeOf(doc) {
  const tally = new Map();
  ((doc && doc.homeVotes) || []).forEach((vote, index) => {
    const entry = tally.get(vote.station.id) || { count: 0 };
    tally.set(vote.station.id, { station: vote.station, count: entry.count + 1, latest: index });
  });
  const winner = [...tally.values()].sort((a, b) => b.count - a.count || b.latest - a.latest)[0];
  if (winner && winner.count >= HOME_VOTES_NEEDED) {
    return { station: winner.station, confidence: winner.count };
  }
  const first = (doc && doc.trips && doc.trips[0]) || null;
  return first ? { station: first.from, confidence: 0 } : null;
}

/* Derived on every read, so no stale copy of home can exist. */
export function homeOf(doc) {
  const override = preferencesOf(doc).homeOverride;
  if (override) return { station: override, confidence: 0, source: 'manual' };
  return automaticHomeOf(doc);
}

function fromHere(doc, station, nowMs) {
  const out = [];
  for (const trip of doc.trips || []) {
    for (const direction of DIRECTIONS) {
      const ends = direction === 'reverse'
        ? { from: trip.to, to: trip.from } : { from: trip.from, to: trip.to };
      if (ends.from.id !== station.id) continue;
      out.push({
        tripId: trip.id,
        direction,
        to: ends.to,
        score: scoreCandidate(doc.history, trip.id, direction, nowMs)
      });
    }
  }
  return out;
}

const chosen = (candidate, leap) =>
  ({ kind: 'trip', tripId: candidate.tripId, direction: candidate.direction, leap });

/* Three shapes, one per answer the header can give: see client-storage.md. */
export function locate(doc, nowMs, opts = {}) {
  const fix = preferencesOf(doc).useLocation ? opts.fix : null;
  const locationOpts = { ...opts, fix };
  const spot = here(doc, opts.stations, fix);
  const trips = doc.trips || [];
  const predicted = () => {
    const answer = predict(doc, nowMs, locationOpts);
    return { kind: 'trip', tripId: answer.tripId, direction: answer.direction, leap: 'usual' };
  };
  if (!spot) return trips.length ? predicted() : { kind: 'setup', from: null };

  // Candidate filtering must not change the automatic first-saved-trip home.
  const home = opts.home === undefined ? homeOf(doc) : opts.home;
  const away = Boolean(home) && home.station.id !== spot.station.id;
  const candidates = fromHere(doc, spot.station, nowMs);

  if (candidates.length) {
    const best = candidates.reduce((top, candidate) => Math.max(top, candidate.score), 0);
    const leaders = candidates.filter((candidate) => candidate.score === best);
    if (best > 0 && leaders.length === 1) return chosen(leaders[0], 'usual');
    const homeward = away && candidates.find((candidate) => candidate.to.id === home.station.id);
    if (homeward) return chosen(homeward, 'home');
    const last = doc.lastViewed;
    const viewed = last && candidates.find((candidate) =>
      candidate.tripId === last.tripId && candidate.direction === last.direction);
    return chosen(viewed || candidates[0], 'usual');
  }
  if (away) return { kind: 'pair', from: spot.station, to: home.station };
  if (trips.length) return predicted();
  return { kind: 'setup', from: spot.station };
}
