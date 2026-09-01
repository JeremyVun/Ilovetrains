/* Station search: what we ask upstream, what we remember, and what we say
   while the answer is in the post. Pure — no DOM, no fetch of its own — so the
   policy that governs the only slow screen in the app is unit tested.

   The cost this module exists to manage: every DISTINCT query string is a cold
   call to TfNSW's stop_finder, 0.5–1.5s, cached by the backend for 24h per
   exact string. Two letters of a station name are a call that cannot answer
   well (see docs/references/tfnsw-open-data.md: a very short query loses to
   exact word matches on street names, so "parr" comes back empty while
   "parra" finds Parramatta), and a query the user already typed once is a call
   we should never make twice. Hence: three characters before we ask, and a
   memo for the rest of the session.

   The copy is the other half. A cold call is up to a second and a half of a
   screen that used to say nothing at all, and an empty result on a short query
   used to say "No stations match" — which is not true, and the user's own next
   keystroke would have disproved it. */

/** Below this, nothing is sent: the upstream match is too weak to be worth a
    second of waiting, and the hint asks for another letter instead. */
export const MIN_QUERY = 3;

/** Up to this length, an empty result means "not yet", not "no such station" —
    upstream is still exact-matching street and bus-stop names at this width. */
export const SHORT_QUERY = 4;

/* Every string on this screen, in the label idiom: one short line saying what
   happened and what to do. */
export const COPY = {
  keepTyping: 'Keep typing',
  searching: 'Searching…',
  noMatchYet: 'No match yet · keep typing',
  noMatch: 'No stations match',
  unavailable: 'Station search is unavailable'
};

/** The memo key. "Central ", "central" and "CENTRAL" are one upstream call. */
export function queryKey(query) {
  return String(query == null ? '' : query).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The hint that stands in for the results list, or null when the results
 * themselves should be painted.
 *
 * @param {{query: string, phase: 'idle'|'pending'|'done'|'error', count?: number}} view
 */
export function hintFor({ query, phase, count = 0 }) {
  if (phase === 'error') return { text: COPY.unavailable, warn: true };

  const q = queryKey(query);
  // An empty field is not a failed search: the screen waits, saying nothing.
  if (!q.length) return null;
  if (q.length < MIN_QUERY) return { text: COPY.keepTyping, warn: false };

  if (phase === 'pending') return { text: COPY.searching, warn: false };
  if (phase === 'done' && count === 0) {
    return { text: q.length <= SHORT_QUERY ? COPY.noMatchYet : COPY.noMatch, warn: false };
  }
  return null;
}

/**
 * A session-lifetime memo over the stops endpoint. Backspacing to a query
 * already asked is answered from the Map, in the same tick, so the screen never
 * pays for the same letters twice.
 *
 * Only answers are remembered. A failed call leaves nothing behind, or the
 * network dropping out for one second would poison that query for the session.
 */
export function createSearcher(fetchStops) {
  const memo = new Map();
  return {
    /** The remembered answer, or undefined if this query has never been asked. */
    peek(query) {
      return memo.get(queryKey(query));
    },
    get size() {
      return memo.size;
    },
    async search(query, opts) {
      const key = queryKey(query);
      if (memo.has(key)) return memo.get(key);
      const stops = await fetchStops(query, opts);
      memo.set(key, stops);
      return stops;
    }
  };
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return prev[b.length];
}

/** Stable client ranking over the candidates returned by stop_finder. Prefixes
    win, then word prefixes, then small edit distances. Thus “Rhode” ranks
    “Rhodes” first without hiding other stations TfNSW returned. */
export function fuzzyScore(name, query) {
  const n = queryKey(String(name).replace(/\bstation\b/gi, ''));
  const q = queryKey(query);
  if (!q) return 0;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 900 - (n.length - q.length);
  const word = n.split(/\s+/).findIndex((part) => part.startsWith(q));
  if (word >= 0) return 800 - word * 10;
  if (n.includes(q)) return 700 - n.indexOf(q);
  const distance = editDistance(n, q);
  return distance <= Math.max(2, Math.floor(q.length / 3)) ? 500 - distance * 25 : 0;
}

export function rankStops(stops, query) {
  return (Array.isArray(stops) ? stops : []).map((stop, index) => ({
    stop,
    index,
    score: fuzzyScore(stop.name, query)
  })).sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.stop);
}
