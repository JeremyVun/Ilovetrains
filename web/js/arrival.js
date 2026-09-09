const SECOND = 1000;
const MINUTE = 60 * SECOND;
const finite = Number.isFinite;
const time = value => typeof value === 'number' ? (finite(value) && Math.abs(value) <= 8.64e15 ? value : null)
  : typeof value === 'string' && finite(Date.parse(value)) ? Date.parse(value) : null;
const iso = value => new Date(value).toISOString();

export const ARRIVAL = Object.freeze({ sampleInterval: 5000, maxAge: 30000,
  futureAllowance: 5000, window: 120000, maxSamples: 24, maxGap: 30000,
  checking: 180000, retention: 7200000, expiry: 1800000 });

export function distanceMetres(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(finite)) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function normalizeArrivalGuard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  if (typeof raw.armed === 'boolean') out.armed = raw.armed;
  const retainedAt = time(raw.retainedAt), confirmedAt = time(raw.confirmedAt);
  if (retainedAt !== null) out.retainedAt = iso(retainedAt);
  if (raw.basis === 'estimate') out.basis = 'estimate';
  if (raw.basis === 'location' && confirmedAt !== null) {
    out.basis = 'location'; out.confirmedAt = iso(confirmedAt);
  }
  return Object.keys(out).length ? out : null;
}

export function validateArrivalSample(raw, nowMs) {
  if (!raw || ![raw.lat, raw.lon, raw.at, raw.accuracy].every(finite)
    || Math.abs(raw.lat) > 90 || Math.abs(raw.lon) > 180
    || raw.at > nowMs + ARRIVAL.futureAllowance || raw.at < nowMs - ARRIVAL.maxAge
    || raw.accuracy <= 0 || raw.accuracy > 100) return null;
  const sample = { lat: raw.lat, lon: raw.lon, at: raw.at, accuracy: raw.accuracy };
  if (finite(raw.speed) && raw.speed >= 0 && raw.speed <= 100) sample.speed = raw.speed;
  return sample;
}

function suffix(samples, predicate) {
  let start = samples.length;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (!predicate(samples[i]) || (i < samples.length - 1 && samples[i + 1].at - samples[i].at > ARRIVAL.maxGap)) break;
    start = i;
  }
  return samples.slice(start);
}

function meanSpeed(samples, nowMs) {
  const valid = suffix(samples, sample => finite(sample.speed));
  if (valid.length < 3 || nowMs - valid.at(-1).at > ARRIVAL.maxAge) return null;
  const span = valid.at(-1).at - valid[0].at;
  if (span < 30000) return null;
  let area = 0;
  for (let i = 1; i < valid.length; i++) area += (valid[i].speed + valid[i - 1].speed) / 2 * (valid[i].at - valid[i - 1].at);
  return area / span;
}

export function reduceArrival(input) {
  const { identity, departureMs: departure, arrivalMs: arrival, nowMs: now } = input;
  let guard = normalizeArrivalGuard(input.guard);
  let samples = input.window?.identity === identity && Array.isArray(input.window.samples)
    ? input.window.samples.filter(s => finite(s.at) && s.at >= now - ARRIVAL.window && s.at <= now + ARRIVAL.futureAllowance) : [];
  let accepted = null;
  if (input.sample) {
    const next = validateArrivalSample(input.sample, now);
    if (next && (!samples.length || next.at - samples.at(-1).at >= ARRIVAL.sampleInterval)) {
      accepted = next; samples = [...samples, next].slice(-ARRIVAL.maxSamples);
    }
  }
  const window = { identity, samples };
  const result = (state, basis = null, action = 'none', away = false, moving = false) =>
    ({ state, basis, guard, window, action, away, moving });
  if (!identity || !finite(departure) || !finite(arrival) || !finite(now) || arrival < departure) return result('travelling');
  if (guard?.basis === 'location' && time(guard.confirmedAt) > now + ARRIVAL.futureAllowance) {
    guard = { ...guard }; delete guard.basis; delete guard.confirmedAt;
  }
  const legacy = input.legacyCompleted === true && !guard;
  const confirmed = guard?.basis === 'location' && time(guard.confirmedAt) <= now + ARRIVAL.futureAllowance;
  if (!legacy && !confirmed && now >= departure && (input.monitoring || accepted)) {
    if (!guard?.armed) guard = { ...guard, armed: true, retainedAt: iso(now) };
  }
  if (guard?.armed) {
    let retained = time(guard.retainedAt);
    if (retained === null) retained = Math.min(arrival, now);
    guard = { ...guard, retainedAt: iso(Math.min(retained, now)) };
  }
  const last = samples.at(-1);
  const fresh = last && now - last.at <= ARRIVAL.maxAge;
  const distance = fresh ? distanceMetres(last, input.destination) : null;
  const away = distance !== null && distance - last.accuracy >= 300;
  const moving = away && (meanSpeed(samples, now) ?? -1) >= 8;
  const nearPosition = sample => {
    const d = distanceMetres(sample, input.destination);
    return d !== null && sample.accuracy <= 50 && d + sample.accuracy <= 200;
  };
  const useful = accepted && (nearPosition(accepted) || ((distanceMetres(accepted, input.destination) ?? -Infinity) - accepted.accuracy >= 300));
  if (guard?.armed && (useful || (input.matchingRefresh && arrival > now)) && now - time(guard.retainedAt) >= MINUTE) {
    guard = { ...guard, retainedAt: iso(now) };
  }
  const expiryDeadline = guard?.armed && !confirmed && !legacy
    ? Math.max(arrival + ARRIVAL.expiry, time(guard.retainedAt) + ARRIVAL.retention)
    : arrival + ARRIVAL.expiry;
  const expired = now > expiryDeadline && !(finite(input.resumeWaitUntilMs) && now < input.resumeWaitUntilMs);
  if (input.cancelled) return result(expired ? 'expiredUnconfirmed' : 'travelling', null,
    expired ? 'expire' : input.legacyCompleted ? 'withdraw' : 'none');
  if ((confirmed || legacy) && now > arrival + ARRIVAL.expiry) return result('expiredUnconfirmed', null, 'expire');
  if (confirmed) return result('arrived', 'location', input.legacyCompleted ? 'correct' : 'record');
  if (legacy && (!input.matchingRefresh || now >= arrival)) return result('arrived', 'estimate', 'correct');

  const earliest = Math.max(departure, arrival - 5 * MINUTE);
  const near = suffix(samples, sample => sample.at >= earliest && nearPosition(sample));
  const speed = meanSpeed(near, now);
  const lowSpeed = speed !== null && speed <= 2;
  let still = suffix(near, sample => !finite(sample.speed) || sample.speed <= 2);
  const boundary = still.findLastIndex(sample => sample.at <= (still.at(-1)?.at ?? 0) - MINUTE);
  if (boundary >= 0) still = still.slice(boundary);
  const stationary = fresh && still.length >= 4 && still.at(-1).at - still[0].at >= MINUTE
    && still.every((a, i) => still.slice(i + 1).every(b => distanceMetres(a, b) <= 50));
  if (guard?.armed && fresh && (lowSpeed || stationary)) {
    guard = { ...guard, basis: 'location', confirmedAt: iso(now) };
    return result('arrived', 'location', input.legacyCompleted ? 'correct' : 'record');
  }
  if (expired) {
    return result('expiredUnconfirmed', null, 'expire');
  }
  if (now < arrival) {
    if (guard?.basis === 'estimate') { guard = { ...guard }; delete guard.basis; }
    return result('travelling', null, input.legacyCompleted ? 'withdraw' : 'none', away, moving);
  }
  if (!guard?.armed && !input.permissionPending) {
    guard = { ...guard, basis: 'estimate' };
    return result('arrived', 'estimate', input.legacyCompleted ? 'correct' : 'record');
  }
  return result(away || now >= arrival + ARRIVAL.checking ? 'arrivalUnconfirmed' : 'checkingArrival', null, 'none', away, moving);
}
