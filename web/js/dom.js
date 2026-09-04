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

/* A station name is shortened by rule until it fits, never ellipsised, and
   wraps only when even the shortest form cannot fit. */
const SHORTENINGS = [
  (name) => name.replace(/\s+Station$/i, ''),
  (name) => name.replace(/\s+Junction$/i, ' Jn'),
  (name) => name.replace(/^(North|South|East|West)\s+/i, (_, word) => `${word[0]} `)
];

export function fitStationNames(root = document) {
  root.querySelectorAll('[data-fit-name]').forEach((node) => {
    const box = node.closest('[data-fit-box]') || node;
    const fits = () => box.scrollWidth <= box.clientWidth + 1;
    if (fits()) return;
    let name = node.dataset.fitName;
    for (const shorten of SHORTENINGS) {
      const next = shorten(name);
      if (next === name) continue;
      name = next;
      node.textContent = name;
      if (fits()) return;
    }
    if (box === node) node.style.whiteSpace = 'normal';
  });
}
