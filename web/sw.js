/* Service worker: the shell survives a dead network, the data never lies.
 *
 * Two caches, two strategies, and a hard line between them:
 *
 *   shell (cache-first)   — index.html, the CSS, the ES modules, the icons.
 *     Versioned: a deploy bumps VERSION, the new worker precaches the whole
 *     shell as one set, then deletes every older cache on activate. Cache-first
 *     is what makes a cold open on a dead network paint the board at all.
 *
 *   data (network-first)  — /api/ GETs. The network always wins when it
 *     answers; the cached copy is a fallback, never a preference, because a
 *     departure board is only as good as its freshness.
 *
 * The client already treats an old board honestly: `rowmodel.js` reads
 * `generatedAt`, and past STALE_MS it drops the countdowns, keeps the clock
 * times, drops departed rows and dims the board. A response replayed from this
 * cache carries its original `generatedAt`, so it lands in exactly that
 * treatment — the worker cannot make stale data look live. When there is no
 * cached copy either, the fetch is allowed to REJECT rather than resolving with
 * a synthetic error response: `api.js` turns a rejection into the offline state,
 * and a fake 503 body would only travel further before saying the same thing.
 *
 * Bump VERSION on every deploy that changes any file in SHELL.
 */

const VERSION = 'v7';
const SHELL_CACHE = 'shell-' + VERSION;
const DATA_CACHE = 'data-' + VERSION;

/* Every file the app needs to boot with no network. Kept in step with the
   directory by web/test/sw.test.js, which fails if a module is added here and
   not there (a missing entry makes addAll reject and the install fail). */
const SHELL = [
  '/',
  '/index.html',
  '/app.css',
  '/manifest.webmanifest',
  '/js/api.js',
  '/js/board.js',
  '/js/detail.js',
  '/js/dom.js',
  '/js/focus.js',
  '/js/home.js',
  '/js/journey.js',
  '/js/journeybar.js',
  '/js/lines.js',
  '/js/main.js',
  '/js/predict.js',
  '/js/rowmodel.js',
  '/js/search.js',
  '/js/setup.js',
  '/js/storage.js',
  '/js/time.js',
  '/js/trips.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      // The shell is small and self-consistent, so there is nothing to gain by
      // waiting for every tab to close before the new version takes over.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname === '/healthz') return; // a liveness probe must never be cached

  event.respondWith(cacheFirst(request));
});

/** Fresh if the network answers; otherwise the last answer we were given,
    which the client will date and dim for itself. */
async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err; // api.js reads a rejection as "offline"; a fake 503 would not add anything
  }
}

/** The shell, then the network for anything not precached (and store it, so a
    file added between deploys is still there next time the network is gone). */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && new URL(request.url).pathname !== '/') {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}
