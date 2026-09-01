/* The backend API (docs/contracts/api.md). Same origin — the Go server serves
   this client from ./web. */

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function getJson(path, signal) {
  let res;
  try {
    res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('offline', 'network unreachable', 0);
  }
  let body = null;
  try { body = await res.json(); } catch (_) { /* handled below */ }
  if (!res.ok) {
    const err = body && body.error ? body.error : {};
    throw new ApiError(err.code || 'http_' + res.status, err.message || res.statusText, res.status);
  }
  if (!body) throw new ApiError('bad_response', 'response was not JSON', res.status);
  return { body, res };
}

/** `X-Data-Stale` is CORS-exposed by the backend; it is the server telling us
    it is serving from its own stale window, independent of generatedAt age. */
export async function getDepartures(fromId, toId, { limit = 6, at, signal } = {}) {
  const q = new URLSearchParams({ from: fromId, to: toId, limit: String(limit) });
  if (at) q.set('at', typeof at === 'string' ? at : new Date(at).toISOString());
  const { body, res } = await getJson('/api/v1/departures?' + q, signal);
  return { body, serverStale: res.headers.get('X-Data-Stale') === 'true' };
}

export async function getStops(query, { signal } = {}) {
  const q = new URLSearchParams({ q: query });
  const { body } = await getJson('/api/v1/stops?' + q, signal);
  return Array.isArray(body.stops) ? body.stops : [];
}
