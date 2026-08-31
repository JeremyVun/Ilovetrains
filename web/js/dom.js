/* Minimal DOM helpers. Template literals do the rendering; `esc` is the only
   thing standing between an upstream headsign and an injection. */

export function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function mount(root, html) {
  root.innerHTML = html;
}

/** One delegated click handler per screen, matched on [data-act]. */
export function onAction(root, handler) {
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    handler(el.dataset.act, el, ev);
  });
}
