/* Anonymous counters for the self-hosted analytics service.

   Nothing here can link one count to another: an event carries a name, at
   most three dimension words from the closed vocabulary in
   docs/contracts/client-storage.md, and a repeat count. No id, no session,
   no timestamp, no station, no coordinate.

   Recording is a synchronous push so nothing sits between open and paint;
   sending is deferred, batched and compacted, because the phones that run
   this are on spotty networks. */

import { userClass } from './storage.js';

export const ENDPOINT = 'https://analytics.jeremyvun.com/e';
export const PROJECT = 'ilovetrains';
export const QUEUE_KEY = 'trains.analytics.v1';
export const QUEUE_CAP = 200;
export const EXPERIMENTS = {
  'strip-placement': { variants: ['a3', 'a2'], offset: 0 }
};

const PROBE_KEY = 'trains.analytics.probe';
const HOST = 'ilovetrains.jeremyvun.com';

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
  const experiment = EXPERIMENTS[id];
  if (!experiment) return null;
  const bucket = doc && doc.telemetry ? doc.telemetry.bucket : null;
  if (!enabled || !Number.isInteger(bucket)) return experiment.variants[0];
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
    getDoc = () => null
  } = options || {};
  const events = [];
  let scheduled = false;

  function readQueue() {
    try {
      const stored = JSON.parse(storage.getItem(QUEUE_KEY));
      return stored && Array.isArray(stored.queue) ? stored.queue : [];
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
      const doc = getDoc();
      const d = { u: userClass(doc), ...dims, ...experimentDims(doc, enabled) };
      events.push({ t: name, d });
      if (!enabled) return;
      const queue = readQueue();
      const seen = queue.find((entry) => entry.t === name && sameDims(entry.d, d));
      if (seen) seen.n += 1;
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
      const sent = readQueue();
      if (!sent.length) return Promise.resolve();
      const body = JSON.stringify(sent.map(({ t, d, n }) => ({ p: PROJECT, t, d, n })));

      if (opts && opts.beacon && beacon && beacon(ENDPOINT, body)) {
        settle(sent);
        return Promise.resolve();
      }
      if (!fetchFn) return Promise.resolve();
      return Promise.resolve(fetchFn(ENDPOINT, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/plain' },
        keepalive: true
      })).then((response) => {
        if (response && response.ok) settle(sent);
      }).catch(() => {});
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
