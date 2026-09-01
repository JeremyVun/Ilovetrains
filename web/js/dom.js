/* Minimal DOM helpers. Template literals do the rendering; `esc` is the only
   thing standing between an upstream headsign and an injection. */

export function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* "Central Station" reads as "Central" in a masthead that already says these
   are departures. The API's names are station names; the head is a place. */
export function shortName(name) {
  return String(name || '').replace(/\s+Station$/i, '');
}

export function mount(root, html) {
  root.innerHTML = html;
}

/** One delegated click handler per screen, matched on [data-act].
    Enter and Space too: full board rows are tap targets
    that are not <button>s (a button cannot contain the row's own headings),
    so the keyboard has to be handed to them explicitly. */
export function onAction(root, handler) {
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    handler(el.dataset.act, el, ev);
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target.closest('[data-act][role="button"]');
    if (!el || !root.contains(el)) return;
    ev.preventDefault();
    handler(el.dataset.act, el, ev);
  });
}
