/* Only evaluated public values cross the API boundary. Preview overrides are
 * restricted to a developer's local server, never the production hostname. */
export const TINY_TRAIN_FLAG = 'tiny_train';
export const TINY_TRAIN_KEY = 'trains.flags.tinyTrain';

/** Explicit URL values win for this visit, even when storage is unavailable.
 * Stored overrides survive a normal PWA launch without the preview URL. */
export function tinyTrainPreview(hostname, search, storage) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return null;
  const value = new URLSearchParams(search).get('tinyTrain');
  if (value === '1' || value === '0') {
    try { storage?.setItem(TINY_TRAIN_KEY, value); } catch (_) { /* session only */ }
    return value === '1';
  }
  try {
    const stored = storage?.getItem(TINY_TRAIN_KEY);
    if (stored === '1' || stored === '0') return stored === '1';
  } catch (_) { /* default when storage is blocked */ }
  return null;
}

export async function fetchTinyTrain(fetchFn, signal) {
  try {
    const response = await fetchFn('/api/v1/flags', { cache: 'no-store', credentials: 'omit', signal });
    if (!response.ok) return false;
    const flags = await response.json();
    return flags?.[TINY_TRAIN_FLAG] === true;
  } catch (_) { return false; }
}
