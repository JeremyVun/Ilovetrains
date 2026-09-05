/* The baked station index and the one question it answers: which station is
   the user standing at? Pure but for `loadStations`, which fetches the index
   once per page load and holds it in memory; it is never written to storage. */

/* The 200 m radius is "standing at it"; 2 km is the band the location term
   already treats as near (client-storage.md). */
export const AT_STATION_KM = 0.2;
export const NEAR_STATION_KM = 2;

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
 * Where the user is, as a station: any station within 200 m, else the nearest
 * end of a saved trip within 2 km, else the nearest station within 2 km.
 * A saved end outranks a nearer stranger so a user whose own origin is a
 * kilometre away is not handed a station they have never used.
 */
export function here(doc, stations, fix) {
  if (!stations || !fix) return null;

  const standing = nearest(stations, fix, AT_STATION_KM);
  if (standing) return { station: standing.station, tier: 1 };

  const ends = new Map();
  for (const trip of (doc && doc.trips) || []) {
    for (const stop of [trip.from, trip.to]) ends.set(stop.id, stop);
  }
  const saved = nearest([...ends.values()], fix, NEAR_STATION_KM);
  if (saved) return { station: saved.station, tier: 2 };

  const any = nearest(stations, fix, NEAR_STATION_KM);
  return any ? { station: any.station, tier: 3 } : null;
}
