/* The baked station index, held in memory for the page's life and never written
   to storage. 2 km is the band the location term already treats as near
   (client-storage.md, `here`). */
export const AT_STATION_KM = 0.2;
// Gadigal is 152 m from Town Hall's point, so a saved station's footprint must beat a stranger's 200 m.
export const SAVED_STATION_KM = 0.4;
// Platforms reach about 150 m from a station's point, and a Home fix may be 200 m inaccurate.
export const SIGHTING_KM = 0.3;
export const NEAR_STATION_KM = 2;
// About 30 km/h: faster than anyone walks or runs on a platform.
export const TRAIN_SPEED_MPS = 8;
export const PREVIOUS_FIX_MIN_MS = 15_000;
export const PREVIOUS_FIX_MAX_MS = 120_000;

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

export function previousFixUsable(fix, previous) {
  const gap = fix && previous ? fix.at - previous.at : NaN;
  return Number.isFinite(gap) && gap >= PREVIOUS_FIX_MIN_MS && gap <= PREVIOUS_FIX_MAX_MS;
}

const known = (accuracy) => Number.isFinite(accuracy) && accuracy >= 0;

// Without a usable speed, only a displacement no position error could produce counts.
export function trainSpeed(fix, previous = null) {
  if (!fix) return false;
  if (Number.isFinite(fix.speed) && fix.speed >= 0) return fix.speed >= TRAIN_SPEED_MPS;
  if (!previousFixUsable(fix, previous) || !known(fix.accuracy) || !known(previous.accuracy)) return false;
  const metres = distanceKm(fix, previous) * 1000;
  return metres >= TRAIN_SPEED_MPS * (fix.at - previous.at) / 1000 + fix.accuracy + previous.accuracy;
}

let loading = null;

/** Null on any failure: the app then answers from history alone, as it did
    before the index existed. */
export function loadStations(fetchFn = fetch) {
  if (!loading) {
    loading = Promise.resolve()
      .then(() => fetchFn('/stations.json'))
      .then((response) => (response && response.ok ? response.json() : null))
      .then((list) => (Array.isArray(list) ? list : null))
      .catch(() => null);
  }
  return loading;
}

export function nearest(stations, fix, withinKm) {
  let best = null;
  for (const station of stations || []) {
    const km = distanceKm(fix, station && station.location);
    if (km === null || km > withinKm) continue;
    if (!best || km < best.km) best = { station, km };
  }
  return best;
}

/**
 * Where the user is, as a station: the nearest saved end within 400 m, else any
 * station within 200 m, else the nearest saved end within 2 km, else the
 * nearest station within 2 km. A saved end outranks a nearer stranger so a user
 * whose own origin is a kilometre away is not handed a station they have never
 * used. A phone at train speed is passing stations, not at one.
 */
export function here(doc, stations, fix, previousFix = null) {
  if (!stations || !fix || trainSpeed(fix, previousFix)) return null;

  const ends = new Map();
  for (const trip of (doc && doc.trips) || []) {
    for (const stop of [trip.from, trip.to]) ends.set(stop.id, stop);
  }
  const indexed = new Map(stations.map((station) => [station.id, station]));
  const saved = [...ends.values()].map((stop) => indexed.get(stop.id) || stop);
  const standing = nearest(saved, fix, SAVED_STATION_KM) || nearest(stations, fix, AT_STATION_KM);
  if (standing) return { station: standing.station, tier: 1 };

  const near = nearest(saved, fix, NEAR_STATION_KM);
  if (near) return { station: near.station, tier: 2 };

  const any = nearest(stations, fix, NEAR_STATION_KM);
  return any ? { station: any.station, tier: 3 } : null;
}

export function sightingOf(spot, fix) {
  const km = spot ? distanceKm(fix, spot.station.location) : null;
  return km !== null && km <= SIGHTING_KM ? spot.station : null;
}
