import { legsOf, departureMs, effective, departureKey } from './journey.js';
import { journeyAllowed, SUPPORTED_MODES } from './preferences.js';

export const TRANSFER_PENALTY_MS = 300000;
const journeyOf = value => value?.journey || value;
const codePoints = (a, b) => {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (delta) return delta;
  }
  return left.length - right.length;
};

function tuple(journey) {
  const legs = legsOf(journey).filter(leg => leg.line?.mode !== 'walk');
  const departure = effective(legs[0]?.departure), arrival = effective(legs.at(-1)?.arrival);
  const count = journey.legs === undefined ? legs.length : journey.legs;
  if (!Number.isInteger(count) || count < 1 || (journey.legDetail?.length && count !== legs.length)) return null;
  if (!legs.length || departure === null || arrival === null || arrival < departure
    || journey.cancelled || legs.some(leg => leg.cancelled || effective(leg.departure) === null
      || effective(leg.arrival) === null || effective(leg.arrival) < effective(leg.departure)
      || !Number.isFinite(Date.parse(leg.departure?.scheduled)))
    || legs.some((leg, index) => index > 0 && effective(leg.departure) < effective(legs[index - 1].arrival))) return null;
  return [arrival + (count - 1) * TRANSFER_PENALTY_MS, count - 1, arrival, departure,
    legs.map(leg => [leg.line?.name || '', Date.parse(leg.departure.scheduled)])];
}

export function recommendationCost(journey) { return tuple(journey)?.[0] ?? null; }

export function compareRecommendations(a, b) {
  const left = tuple(journeyOf(a)), right = tuple(journeyOf(b));
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  for (let i = 0; i < 4; i++) if (left[i] !== right[i]) return left[i] - right[i];
  const x = left[4], y = right[4];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const order = codePoints(x[i][0], y[i][0]) || x[i][1] - y[i][1];
    if (order) return order;
  }
  return x.length - y.length;
}

function eligible(candidates, nowMs, options) {
  return candidates.filter(value => {
    const journey = journeyOf(value);
    return tuple(journey) && departureMs(journey) >= nowMs
      && journeyAllowed(journey, options.modes ?? SUPPORTED_MODES, options.maxTransfers ?? null);
  });
}

export function selectRecommendation(candidates, nowMs, options = {}) {
  const allowed = eligible(candidates || [], nowMs, options);
  const fresh = allowed.filter(value => value.stale !== true);
  return (fresh.length ? fresh : allowed).sort(compareRecommendations)[0] || null;
}

export function earliestAlternative(candidates, recommendedJourney, nowMs, options = {}) {
  const key = departureKey(journeyOf(recommendedJourney));
  return eligible(candidates || [], nowMs, options)
    .filter(value => departureKey(journeyOf(value)) !== key)
    .sort((a, b) => departureMs(journeyOf(a)) - departureMs(journeyOf(b)) || compareRecommendations(a, b))[0] || null;
}

export function nextRecommendationCursor(rawBody, previousAtMs, nowMs, bestJourney = null) {
  const times = (rawBody?.journeys || []).map(departureMs).filter(Number.isFinite);
  if (!times.length) return null;
  const cursor = (Math.floor(Math.max(...times) / 600000) + 1) * 600000;
  const best = bestJourney ? recommendationCost(journeyOf(bestJourney)) : null;
  return cursor <= previousAtMs || cursor > nowMs + 7200000 || (best !== null && cursor > best) ? null : cursor;
}
