/* localStorage document per docs/contracts/client-storage.md.
   Everything above the load/save pair is pure: document in, new document out.
   Nothing here is ever sent to the server — that is a product guarantee. */

export const STORAGE_KEY = 'trains.v1';
export const SCHEMA_VERSION = 1;
export const HISTORY_CAP = 500;
export const RIDES_CAP = 100;
export const TRIPS_CAP = 10;
export const SEARCH_CAP = 3;
export const DIRECTIONS = ['forward', 'reverse'];

export function emptyDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    trips: [],
    history: [],
    rides: [],
    searches: { from: [], to: [] },
    home: null,
    lastViewed: null,
    cache: {}
  };
}

function isStop(s) {
  return !!s && typeof s.id === 'string' && s.id !== '' && typeof s.name === 'string';
}

function locationOf(stop) {
  const value = stop && stop.location;
  return value && Number.isFinite(value.lat) && Number.isFinite(value.lon)
    ? { lat: value.lat, lon: value.lon } : null;
}

function stopOf(stop) {
  const out = { id: stop.id, name: stop.name };
  const location = locationOf(stop);
  if (location) out.location = location;
  return out;
}

/** Tolerant parse: a corrupt or foreign value must never brick the app. */
export function parseDoc(raw) {
  let v = null;
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return emptyDoc(); }
  if (!v || typeof v !== 'object') return emptyDoc();

  const doc = emptyDoc();
  if (Array.isArray(v.trips)) {
    doc.trips = v.trips
      .filter((t) => t && typeof t.id === 'string' && isStop(t.from) && isStop(t.to))
      .map((t) => ({
        id: t.id,
        from: stopOf(t.from),
        to: stopOf(t.to),
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(0).toISOString()
      }));
  }
  if (Array.isArray(v.history)) {
    doc.history = v.history
      .filter((e) => e && typeof e.tripId === 'string' && DIRECTIONS.includes(e.direction) && typeof e.t === 'string')
      .map((e) => ({ tripId: e.tripId, direction: e.direction, t: e.t }))
      .slice(-HISTORY_CAP);
  }
  if (doc.trips.length > TRIPS_CAP) {
    const usedAt = (trip) => {
      const viewed = doc.history.filter((event) => event.tripId === trip.id)
        .map((event) => Date.parse(event.t)).filter(Number.isFinite);
      return viewed.length ? Math.max(...viewed) : Date.parse(trip.createdAt) || 0;
    };
    const keep = new Set(doc.trips.slice().sort((a, b) => usedAt(b) - usedAt(a))
      .slice(0, TRIPS_CAP).map((trip) => trip.id));
    doc.trips = doc.trips.filter((trip) => keep.has(trip.id));
  }
  if (Array.isArray(v.rides)) {
    doc.rides = v.rides.filter((ride) => ride && typeof ride.tripId === 'string'
      && DIRECTIONS.includes(ride.direction) && typeof ride.departedAt === 'string'
      && typeof ride.arrivedAt === 'string' && isStop(ride.from) && isStop(ride.to))
      .map((ride) => ({
        tripId: ride.tripId,
        direction: ride.direction,
        scheduledDeparture: typeof ride.scheduledDeparture === 'string'
          ? ride.scheduledDeparture : ride.departedAt,
        departedAt: ride.departedAt,
        arrivedAt: ride.arrivedAt,
        from: stopOf(ride.from),
        to: stopOf(ride.to)
      })).slice(-RIDES_CAP);
  }
  if (v.searches && typeof v.searches === 'object') {
    for (const role of ['from', 'to']) {
      if (!Array.isArray(v.searches[role])) continue;
      doc.searches[role] = v.searches[role].filter(isStop).map(stopOf).slice(0, SEARCH_CAP);
    }
  }
  if (v.home && isStop(v.home.station) && typeof v.home.inferredAt === 'string') {
    doc.home = {
      station: stopOf(v.home.station),
      inferredAt: v.home.inferredAt,
      confidence: Number.isFinite(v.home.confidence) ? v.home.confidence : 0
    };
  }
  if (v.lastViewed && typeof v.lastViewed.tripId === 'string' && DIRECTIONS.includes(v.lastViewed.direction)) {
    doc.lastViewed = { tripId: v.lastViewed.tripId, direction: v.lastViewed.direction };
  }
  /* The focused journey is optional and self-describing; absence means there
     is no focus. A malformed one is dropped rather than repaired — the
     directions it would draw are a claim about a train. */
  const f = v.focus;
  if (f && typeof f.tripId === 'string' && DIRECTIONS.includes(f.direction)
      && typeof f.focusedAt === 'string' && f.journey && typeof f.journey === 'object') {
    doc.focus = { tripId: f.tripId, direction: f.direction, focusedAt: f.focusedAt, journey: f.journey };
  }
  if (v.cache && typeof v.cache === 'object') {
    for (const [k, entry] of Object.entries(v.cache)) {
      if (entry && typeof entry.fetchedAt === 'string' && entry.body && typeof entry.body === 'object') {
        doc.cache[k] = { fetchedAt: entry.fetchedAt, body: entry.body };
      }
    }
  }
  return doc;
}

export function serializeDoc(doc) {
  const out = {
    schemaVersion: SCHEMA_VERSION,
    trips: doc.trips,
    history: doc.history,
    rides: doc.rides || [],
    searches: doc.searches || { from: [], to: [] },
    home: doc.home || null,
    lastViewed: doc.lastViewed,
    cache: doc.cache
  };
  if (doc.focus) out.focus = doc.focus;
  return JSON.stringify(out);
}

export function cacheKey(fromId, toId) {
  return fromId + '-' + toId;
}

/** The (from, to) actually queried for a trip in a direction. */
export function leg(trip, direction) {
  return direction === 'reverse' ? { from: trip.to, to: trip.from } : { from: trip.from, to: trip.to };
}

export function findTrip(doc, tripId) {
  return doc.trips.find((t) => t.id === tripId) || null;
}

export function addTrip(doc, trip) {
  const duplicate = doc.trips.find((saved) =>
    (saved.from.id === trip.from.id && saved.to.id === trip.to.id)
    || (saved.from.id === trip.to.id && saved.to.id === trip.from.id));
  if (duplicate) return doc;
  const trips = [...doc.trips, { ...trip, from: stopOf(trip.from), to: stopOf(trip.to) }];
  if (trips.length <= TRIPS_CAP) return { ...doc, trips };

  const usedAt = (candidate) => {
    const times = doc.history.filter((event) => event.tripId === candidate.id)
      .map((event) => Date.parse(event.t)).filter(Number.isFinite);
    return times.length ? Math.max(...times) : Date.parse(candidate.createdAt) || 0;
  };
  const evict = trips.slice(0, -1).reduce((oldest, candidate) =>
    usedAt(candidate) < usedAt(oldest) ? candidate : oldest, trips[0]);
  return removeTrip({ ...doc, trips }, evict.id);
}

/** Deleting a trip takes its prediction history, cached boards and any
    lastViewed/focus pointer with it. Completed rides deliberately survive:
    their endpoint snapshots are the home heuristic's historical evidence. */
export function removeTrip(doc, tripId) {
  const trip = findTrip(doc, tripId);
  const trips = doc.trips.filter((t) => t.id !== tripId);
  const next = {
    ...doc,
    trips,
    history: doc.history.filter((e) => e.tripId !== tripId),
    rides: doc.rides || [],
    lastViewed: doc.lastViewed && doc.lastViewed.tripId === tripId ? null : doc.lastViewed,
    cache: { ...doc.cache }
  };
  if (trip) {
    delete next.cache[cacheKey(trip.from.id, trip.to.id)];
    delete next.cache[cacheKey(trip.to.id, trip.from.id)];
  }
  if (next.focus && next.focus.tripId === tripId) delete next.focus;
  return next;
}

export function moveTrip(doc, tripId, delta) {
  const i = doc.trips.findIndex((t) => t.id === tripId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= doc.trips.length) return doc;
  const trips = doc.trips.slice();
  [trips[i], trips[j]] = [trips[j], trips[i]];
  return { ...doc, trips };
}

/** A view event, recorded only once the view has earned it (>= 5s or an
    interaction) so a mispredicted board the user flips away from does not
    teach the predictor that it was right. */
export function recordView(doc, tripId, direction, atMs) {
  const history = [...doc.history, { tripId, direction, t: new Date(atMs).toISOString() }];
  return {
    ...doc,
    history: history.length > HISTORY_CAP ? history.slice(history.length - HISTORY_CAP) : history,
    lastViewed: { tripId, direction }
  };
}

/** The selected station, not raw keystrokes: recent search is a one-tap answer
    and stays useful when spelling or capitalisation changes. */
export function recordSearch(doc, role, stop) {
  if (!['from', 'to'].includes(role) || !isStop(stop)) return doc;
  const searches = { ...(doc.searches || { from: [], to: [] }) };
  searches[role] = [stopOf(stop), ...(searches[role] || []).filter((item) => item.id !== stop.id)]
    .slice(0, SEARCH_CAP);
  return { ...doc, searches };
}

export function recordRide(doc, selection, journey, from, to) {
  if (!selection || !journey || !from || !to) return doc;
  const departedAt = (journey.departure || {}).estimated || (journey.departure || {}).scheduled;
  const scheduledDeparture = (journey.departure || {}).scheduled || departedAt;
  const arrivedAt = (journey.arrival || {}).estimated || (journey.arrival || {}).scheduled;
  if (!departedAt || !arrivedAt) return doc;
  const key = `${selection.tripId}|${selection.direction}|${scheduledDeparture}`;
  const current = doc.rides || [];
  if (current.some((ride) =>
    `${ride.tripId}|${ride.direction}|${ride.scheduledDeparture || ride.departedAt}` === key)) return doc;
  const rides = [...current, {
    tripId: selection.tripId,
    direction: selection.direction,
    scheduledDeparture,
    departedAt,
    arrivedAt,
    from: stopOf(from),
    to: stopOf(to)
  }].slice(-RIDES_CAP);
  return { ...doc, rides };
}

export function updateStop(doc, stop) {
  if (!isStop(stop) || !locationOf(stop)) return doc;
  const trips = doc.trips.map((trip) => ({
    ...trip,
    from: trip.from.id === stop.id ? stopOf({ ...trip.from, location: stop.location }) : trip.from,
    to: trip.to.id === stop.id ? stopOf({ ...trip.to, location: stop.location }) : trip.to
  }));
  const home = doc.home && doc.home.station.id === stop.id
    ? { ...doc.home, station: stopOf({ ...doc.home.station, location: stop.location }) } : doc.home;
  return { ...doc, trips, home };
}

export function setHome(doc, station, confidence, atMs) {
  if (!isStop(station)) return doc;
  return {
    ...doc,
    home: {
      station: stopOf(station),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      inferredAt: new Date(atMs).toISOString()
    }
  };
}

/** Cache is capped to saved pairs only: one entry per trip per direction. */
export function putCache(doc, key, body, atMs) {
  const allowed = new Set();
  for (const t of doc.trips) {
    allowed.add(cacheKey(t.from.id, t.to.id));
    allowed.add(cacheKey(t.to.id, t.from.id));
  }
  const cache = {};
  for (const [k, v] of Object.entries(doc.cache)) if (allowed.has(k)) cache[k] = v;
  if (allowed.has(key)) cache[key] = { fetchedAt: new Date(atMs).toISOString(), body };
  return { ...doc, cache };
}

export function getCache(doc, key) {
  return doc.cache[key] || null;
}

export function newTripId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'trip-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* --- the only two impure functions in this module --- */

export function loadDoc(store) {
  const ls = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return emptyDoc();
  try { return parseDoc(ls.getItem(STORAGE_KEY)); } catch (_) { return emptyDoc(); }
}

export function saveDoc(doc, store) {
  const ls = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return false;
  try { ls.setItem(STORAGE_KEY, serializeDoc(doc)); return true; } catch (_) { return false; }
}
