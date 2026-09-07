import { SUPPORTED_MODES, flagsOf, normalizeModes, preferencesOf } from './preferences.js';

/* localStorage document per docs/contracts/client-storage.md.
   Everything above the load/save pair is pure: document in, new document out.
   Nothing here is ever sent to the server — that is a product guarantee. */

export const STORAGE_KEY = 'trains.v1';
export const SCHEMA_VERSION = 1;
export const HISTORY_CAP = 500;
export const RIDES_CAP = 100;
export const TRIPS_CAP = 10;
export const SEARCH_CAP = 3;
export const HOME_VOTES_CAP = 7;
export const DIRECTIONS = ['forward', 'reverse'];
export const FOCUS_KINDS = ['focus', 'inferred'];
export const LOCATION_ASK_QUIET_MS = 30 * 86_400_000;
const MILESTONES = new Set([1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250]);

export function emptyDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    trips: [],
    history: [],
    rides: [],
    searches: { from: [], to: [] },
    homeVotes: [],
    lastOpen: null,
    lastViewed: null,
    cache: {}
  };
}

function isStop(s) {
  return !!s && typeof s.id === 'string' && s.id !== '' && typeof s.name === 'string';
}

function isDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
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
  if (Array.isArray(v.homeVotes)) {
    const days = new Set();
    for (const vote of v.homeVotes) {
      if (!vote || !isDay(vote.day) || days.has(vote.day) || !isStop(vote.station)) continue;
      days.add(vote.day);
      doc.homeVotes.push({ day: vote.day, station: stopOf(vote.station) });
    }
    doc.homeVotes = doc.homeVotes.slice(-HOME_VOTES_CAP);
  }
  const open = v.lastOpen;
  if (open && typeof open.at === 'string' && Number.isFinite(Date.parse(open.at))
      && typeof open.tripId === 'string'
      && DIRECTIONS.includes(open.direction) && open.journey && typeof open.journey === 'object'
      && (open.station === null || isStop(open.station))) {
    doc.lastOpen = {
      at: open.at,
      station: open.station ? { id: open.station.id, name: open.station.name } : null,
      tripId: open.tripId,
      direction: open.direction,
      journey: open.journey
    };
  }
  if (v.lastViewed && typeof v.lastViewed.tripId === 'string' && DIRECTIONS.includes(v.lastViewed.direction)) {
    doc.lastViewed = { tripId: v.lastViewed.tripId, direction: v.lastViewed.direction };
  }
  /* The focused journey is optional and self-describing; absence means there
     is no focus. A malformed one is dropped rather than repaired — the
     directions it would draw are a claim about a train. */
  const f = v.focus || {};
  const by = f.by === undefined ? 'focus' : f.by;
  if (typeof f.tripId === 'string' && DIRECTIONS.includes(f.direction)
      && typeof f.focusedAt === 'string' && f.journey && typeof f.journey === 'object'
      && FOCUS_KINDS.includes(by)) {
    doc.focus = {
      tripId: f.tripId, direction: f.direction, focusedAt: f.focusedAt, by, journey: f.journey
    };
  }
  if (v.locationAsk && typeof v.locationAsk.declinedAt === 'string') {
    doc.locationAsk = { declinedAt: v.locationAsk.declinedAt };
  }
  const tel = v.telemetry;
  if (tel && Number.isInteger(tel.opens) && tel.opens >= 0
      && Number.isInteger(tel.bucket) && tel.bucket >= 0 && tel.bucket <= 99) {
    doc.telemetry = { opens: tel.opens, bucket: tel.bucket };
  }
  if (v.preferences && typeof v.preferences === 'object' && !Array.isArray(v.preferences)) {
    doc.preferences = preferencesOf({ preferences: v.preferences });
  }
  if (v.flags && typeof v.flags === 'object' && !Array.isArray(v.flags)) doc.flags = flagsOf(v);
  if (v.cache && typeof v.cache === 'object') {
    for (const [k, entry] of Object.entries(v.cache)) {
      if (entry && typeof entry.fetchedAt === 'string' && entry.body && typeof entry.body === 'object') {
        doc.cache[k] = { fetchedAt: entry.fetchedAt, body: entry.body };
        if (entry.serverStale === true) doc.cache[k].serverStale = true;
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
    homeVotes: doc.homeVotes || [],
    lastOpen: doc.lastOpen || null,
    lastViewed: doc.lastViewed,
    cache: doc.cache
  };
  if (doc.focus) out.focus = doc.focus;
  if (doc.locationAsk) out.locationAsk = doc.locationAsk;
  if (doc.telemetry) out.telemetry = doc.telemetry;
  if (doc.preferences) out.preferences = preferencesOf(doc);
  if (doc.flags) out.flags = flagsOf(doc);
  return JSON.stringify(out);
}

/** "Not now" on the location ask, remembered: a decline the app forgets on
    reload is a nag. */
export function declineLocation(doc, atMs) {
  return { ...doc, locationAsk: { declinedAt: new Date(atMs).toISOString() } };
}

export function recordOpen(doc, random) {
  const current = doc.telemetry;
  return {
    ...doc,
    telemetry: {
      opens: (current ? current.opens : 0) + 1,
      bucket: current ? current.bucket : Math.floor(random() * 100)
    }
  };
}

export function band(doc) {
  const opens = doc && doc.telemetry && doc.telemetry.opens;
  if (!Number.isInteger(opens) || opens <= 1) return '1';
  if (opens <= 5) return '2-5';
  if (opens <= 10) return '6-10';
  if (opens <= 50) {
    const first = Math.floor((opens - 1) / 5) * 5 + 1;
    return `${first}-${first + 4}`;
  }
  return '51+';
}

export function milestone(doc) {
  const opens = doc && doc.telemetry && doc.telemetry.opens;
  return MILESTONES.has(opens) ? String(opens) : null;
}

/* The device's own calendar day: a vote is about the user's morning, not UTC's. */
function localDay(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function cacheKey(fromId, toId, modes = SUPPORTED_MODES) {
  const selected = normalizeModes(modes);
  const pair = fromId + '-' + toId;
  return selected.length === SUPPORTED_MODES.length ? pair : `${pair}|${selected.join(',')}`;
}

function cacheKeysForPair(fromId, toId) {
  const keys = [];
  for (let mask = 0; mask < 2 ** SUPPORTED_MODES.length; mask++) {
    keys.push(cacheKey(fromId, toId, SUPPORTED_MODES.filter((_, index) => mask & (1 << index))));
  }
  return keys;
}

function removeCachePairVariants(cache, fromId, toId) {
  const pair = fromId + '-' + toId;
  for (const key of Object.keys(cache)) {
    if (key === pair || key.startsWith(pair + '|')) delete cache[key];
  }
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
    lastViewed/lastOpen/focus pointer with it. Completed rides deliberately
    survive: their endpoint snapshots are what the receipts cite. */
export function removeTrip(doc, tripId) {
  const trip = findTrip(doc, tripId);
  const trips = doc.trips.filter((t) => t.id !== tripId);
  const next = {
    ...doc,
    trips,
    history: doc.history.filter((e) => e.tripId !== tripId),
    rides: doc.rides || [],
    lastViewed: doc.lastViewed && doc.lastViewed.tripId === tripId ? null : doc.lastViewed,
    lastOpen: doc.lastOpen && doc.lastOpen.tripId === tripId ? null : doc.lastOpen,
    cache: { ...doc.cache }
  };
  if (trip) {
    removeCachePairVariants(next.cache, trip.from.id, trip.to.id);
    removeCachePairVariants(next.cache, trip.to.id, trip.from.id);
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

export function correctRide(doc, selection, journey, nowMs, arrived = false) {
  if (!selection || !journey) return doc;
  const departedAt = (journey.departure || {}).estimated || (journey.departure || {}).scheduled;
  const scheduledDeparture = (journey.departure || {}).scheduled || departedAt;
  const arrivedAt = (journey.arrival || {}).estimated || (journey.arrival || {}).scheduled;
  const rides = doc.rides || [];
  const index = rides.findIndex((ride) => ride.tripId === selection.tripId
    && ride.direction === selection.direction
    && (ride.scheduledDeparture || ride.departedAt) === scheduledDeparture);
  const moved = Date.parse(arrivedAt || '');
  if (index < 0 || !Number.isFinite(moved) || moved === Date.parse(rides[index].arrivedAt)) return doc;
  if (arrived) return { ...doc, rides: rides.map((ride, i) => (i === index ? { ...ride, arrivedAt } : ride)) };
  return moved > nowMs ? { ...doc, rides: rides.filter((_, i) => i !== index) } : doc;
}

export function updateStop(doc, stop) {
  if (!isStop(stop) || !locationOf(stop)) return doc;
  const trips = doc.trips.map((trip) => ({
    ...trip,
    from: trip.from.id === stop.id ? stopOf({ ...trip.from, location: stop.location }) : trip.from,
    to: trip.to.id === stop.id ? stopOf({ ...trip.to, location: stop.location }) : trip.to
  }));
  return { ...doc, trips };
}

/** One vote per local calendar day: the station the phone was at when the app
    first opened that day. Older votes fall off the end. */
export function recordHomeVote(doc, station, nowMs) {
  if (!isStop(station)) return doc;
  const day = localDay(nowMs);
  const votes = doc.homeVotes || [];
  if (votes.some((vote) => vote.day === day)) return doc;
  return { ...doc, homeVotes: [...votes, { day, station: stopOf(station) }].slice(-HOME_VOTES_CAP) };
}

/** The header's previous unfocused answer, which is what makes inferred travel
    mode possible after the service has left the live board. */
export function recordLastOpen(doc, { station, tripId, direction, journey }, nowMs) {
  if (!tripId || !DIRECTIONS.includes(direction) || !journey) return doc;
  return {
    ...doc,
    lastOpen: {
      at: new Date(nowMs).toISOString(),
      station: isStop(station) ? { id: station.id, name: station.name } : null,
      tripId,
      direction,
      journey
    }
  };
}

/** Cache is capped to saved pairs and their eight possible mode combinations. */
export function putCache(doc, key, body, atMs, { serverStale = false } = {}) {
  const allowed = new Set();
  for (const t of doc.trips) {
    for (const cacheKey of cacheKeysForPair(t.from.id, t.to.id)) allowed.add(cacheKey);
    for (const cacheKey of cacheKeysForPair(t.to.id, t.from.id)) allowed.add(cacheKey);
  }
  const cache = {};
  for (const [k, v] of Object.entries(doc.cache)) if (allowed.has(k)) cache[k] = v;
  if (allowed.has(key)) {
    cache[key] = { fetchedAt: new Date(atMs).toISOString(), body };
    if (serverStale) cache[key].serverStale = true;
  }
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
