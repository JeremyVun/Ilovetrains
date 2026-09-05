/* Anonymous counters with a closed wire vocabulary. */

import { band } from './storage.js';

export const ENDPOINT = 'https://analytics.jeremyvun.com/e';
export const PROJECT = 'ilovetrains';
export const QUEUE_KEY = 'trains.analytics.v1';
export const QUEUE_CAP = 200;
export const EXPERIMENTS = Object.freeze({
  'strip-placement': Object.freeze({ variants: Object.freeze(['a3', 'a2']), offset: 0 })
});

const PROBE_KEY = 'trains.analytics.probe';
const HOST = 'ilovetrains.jeremyvun.com';
const COUNT_CAP = 1_000_000;
const USAGE_BANDS = new Set([
  '1', '2-5', '6-10', '11-15', '16-20', '21-25', '26-30',
  '31-35', '36-40', '41-45', '46-50', '51+'
]);
const MILESTONES = new Set([
  '1', '5', '10', '15', '20', '25', '30', '40', '50', '75',
  '100', '150', '200', '250'
]);
const SETUP_SOURCES = {
  shown_setup: new Set(['location', 'empty']),
  saved_setup: new Set(['location', 'nearby', 'search', 'redirect', 'redirect_lost'])
};
const HEADER_KINDS = ['predicted', 'focus', 'usual', 'home', 'pair', 'inferred'];
const EVENT_NAMES = new Set([
  ...HEADER_KINDS.flatMap((kind) => ['shown_' + kind, 'hit_' + kind, 'miss_' + kind]),
  'change_inferred', 'entered_inferred', 'back_focus', 'back_inferred',
  'asked_panel', 'granted_panel', 'denied_panel', 'later_panel',
  'asked_setup', 'granted_setup', 'denied_setup',
  'opened', 'shown_setup', 'saved_setup'
]);

function storageWorks(storage) {
  try {
    storage.setItem(PROBE_KEY, '1');
    const back = storage.getItem(PROBE_KEY) === '1';
    if (storage.removeItem) storage.removeItem(PROBE_KEY);
    return back;
  } catch (_) {
    return false;
  }
}

export function isEnabled(env) {
  const { hostname, gpc, dnt, storage } = env || {};
  if (hostname !== HOST || gpc === true || dnt === '1') return false;
  return !!storage && storageWorks(storage);
}

export function variant(doc, id, enabled) {
  if (!Object.hasOwn(EXPERIMENTS, id)) return null;
  const experiment = EXPERIMENTS[id];
  const bucket = doc && doc.telemetry ? doc.telemetry.bucket : null;
  if (!enabled || !Number.isInteger(bucket) || bucket < 0 || bucket > 99) {
    return experiment.variants[0];
  }
  return experiment.variants[(bucket + experiment.offset) % experiment.variants.length];
}

export function experimentDims(doc, enabled) {
  if (!enabled) return {};
  const dims = {};
  for (const id of Object.keys(EXPERIMENTS)) dims['x.' + id] = variant(doc, id, enabled);
  return dims;
}

function sameDims(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function callerDims(name, dims) {
  if (!EVENT_NAMES.has(name) || !dims || typeof dims !== 'object' || Array.isArray(dims)) {
    return null;
  }
  const keys = Object.keys(dims);
  if (name === 'opened') {
    const value = dims.m;
    return keys.length === 1 && keys[0] === 'm' && MILESTONES.has(value)
      ? { m: value } : null;
  }
  const sources = SETUP_SOURCES[name];
  if (sources) {
    const value = dims.f;
    return keys.length === 1 && keys[0] === 'f' && sources.has(value)
      ? { f: value } : null;
  }
  return keys.length === 0 ? {} : null;
}

function validStoredDims(name, dims) {
  if (!dims || typeof dims !== 'object' || Array.isArray(dims)) return false;
  if (!USAGE_BANDS.has(dims.u)) return false;
  const expected = ['u'];
  for (const [id, experiment] of Object.entries(EXPERIMENTS)) {
    const key = 'x.' + id;
    if (!experiment.variants.includes(dims[key])) return false;
    expected.push(key);
  }
  if (name === 'opened') {
    if (!MILESTONES.has(dims.m)) return false;
    expected.push('m');
  } else if (SETUP_SOURCES[name]) {
    if (!SETUP_SOURCES[name].has(dims.f)) return false;
    expected.push('f');
  }
  const keys = Object.keys(dims);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function validQueueEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const keys = Object.keys(entry);
  return keys.length === 3 && keys.includes('t') && keys.includes('d') && keys.includes('n')
    && EVENT_NAMES.has(entry.t) && validStoredDims(entry.t, entry.d)
    && Number.isSafeInteger(entry.n) && entry.n > 0 && entry.n <= COUNT_CAP;
}

function browserBeacon(url, body) {
  return typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
    && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
}

export function createAnalytics(options) {
  const {
    enabled = false,
    storage = null,
    fetchFn = null,
    beacon = browserBeacon,
    schedule = null,
    isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false,
    getDoc = () => null
  } = options || {};
  const events = [];
  let scheduled = false;
  let inFlight = null;

  function readQueue() {
    try {
      const stored = JSON.parse(storage.getItem(QUEUE_KEY));
      if (!stored || !Array.isArray(stored.queue)) return [];
      const valid = stored.queue.every(validQueueEntry);
      return valid ? stored.queue.slice(-QUEUE_CAP) : [];
    } catch (_) {
      return [];
    }
  }

  function writeQueue(queue) {
    try {
      storage.setItem(QUEUE_KEY, JSON.stringify({ queue }));
    } catch (_) { /* a full or blocked store loses counters, never the app */ }
  }

  function track(name, dims = {}) {
    try {
      const extra = callerDims(name, dims);
      if (!extra) return;
      const doc = getDoc();
      const d = { u: band(doc), ...experimentDims(doc, enabled), ...extra };
      events.push({ t: name, d });
      if (!enabled) return;
      const queue = readQueue();
      const seen = queue.find((entry) => entry.t === name && sameDims(entry.d, d));
      if (seen) seen.n = Math.min(seen.n + 1, COUNT_CAP);
      else queue.push({ t: name, d, n: 1 });
      writeQueue(queue.slice(-QUEUE_CAP));
      if (!scheduled && schedule) {
        scheduled = true;
        schedule(flush);
      }
    } catch (_) { /* a counter is never worth an exception on a user's path */ }
  }

  /* Subtract rather than clear: anything tracked while the request was in
     flight, including a repeat compacted into an entry that was sent, keeps
     its count. */
  function settle(sent) {
    const kept = [];
    for (const entry of readQueue()) {
      const match = sent.find((s) => s.t === entry.t && sameDims(s.d, entry.d));
      const n = entry.n - (match ? match.n : 0);
      if (n > 0) kept.push({ ...entry, n });
    }
    writeQueue(kept);
  }

  function flush(opts) {
    try {
      if (!enabled) return Promise.resolve();
      if (inFlight) return inFlight;
      if (!isOnline()) return Promise.resolve();
      const sent = readQueue();
      if (!sent.length) return Promise.resolve();
      const body = JSON.stringify(sent.map(({ t, d, n }) => ({ p: PROJECT, t, d, n })));

      if (opts && opts.beacon && beacon && beacon(ENDPOINT, body)) {
        settle(sent);
        return Promise.resolve();
      }
      if (!fetchFn) return Promise.resolve();
      inFlight = Promise.resolve(fetchFn(ENDPOINT, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/plain' },
        keepalive: true
      })).then((response) => {
        if (response && response.ok) settle(sent);
      }).catch(() => {}).finally(() => { inFlight = null; });
      return inFlight;
    } catch (_) {
      return Promise.resolve();
    }
  }

  return { track, flush, events, queue: readQueue };
}

export function install(analytics) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const leaving = () => analytics.flush({ beacon: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leaving();
  });
  window.addEventListener('pagehide', leaving);
  window.addEventListener('online', () => analytics.flush());
}
