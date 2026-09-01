/* localStorage document per docs/contracts/client-storage.md.
   Everything above the load/save pair is pure: document in, new document out.
   Nothing here is ever sent to the server — that is a product guarantee. */

export const STORAGE_KEY = 'trains.v1';
export const SCHEMA_VERSION = 1;
export const HISTORY_CAP = 500;
export const DIRECTIONS = ['forward', 'reverse'];

export function emptyDoc() {
  return { schemaVersion: SCHEMA_VERSION, trips: [], history: [], lastViewed: null, cache: {} };
}

function isStop(s) {
  return !!s && typeof s.id === 'string' && s.id !== '' && typeof s.name === 'string';
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
        from: { id: t.from.id, name: t.from.name },
        to: { id: t.to.id, name: t.to.name },
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(0).toISOString()
      }));
  }
  if (Array.isArray(v.history)) {
    doc.history = v.history
      .filter((e) => e && typeof e.tripId === 'string' && DIRECTIONS.includes(e.direction) && typeof e.t === 'string')
      .map((e) => ({ tripId: e.tripId, direction: e.direction, t: e.t }))
      .slice(-HISTORY_CAP);
  }
  if (v.lastViewed && typeof v.lastViewed.tripId === 'string' && DIRECTIONS.includes(v.lastViewed.direction)) {
    doc.lastViewed = { tripId: v.lastViewed.tripId, direction: v.lastViewed.direction };
  }
  /* The focused journey (added 2026-09-01). Optional and self-describing, so
     the migration is the absence of the key: a document written before this
     shipped simply has no focus. A malformed one is dropped rather than
     repaired — the strip it would draw is a claim about a train. */
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
  return { ...doc, trips: [...doc.trips, trip] };
}

/** Deleting a trip takes its history, its cached boards and any lastViewed
    pointer with it — nothing should outlive the trip it describes. */
export function removeTrip(doc, tripId) {
  const trip = findTrip(doc, tripId);
  const trips = doc.trips.filter((t) => t.id !== tripId);
  const next = {
    ...doc,
    trips,
    history: doc.history.filter((e) => e.tripId !== tripId),
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
