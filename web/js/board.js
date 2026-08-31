/* Departure board markup — a port of comps/b-editorial.html, wired to live
   data. Structure and class names are the exemplar's.

   Rendering is split in two on purpose: `boardHtml` builds the page, `patch`
   only rewrites the figures, the provenance labels and the footer. Between
   fetches the figures count down in place; nothing reflows, because a row's
   height is state-independent. */

import { esc } from './dom.js';
import { rowLines } from './rowmodel.js';

export function boardHtml(view) {
  const { trip, direction, model, tripCount } = view;
  const from = direction === 'reverse' ? trip.to.name : trip.from.name;
  const to = direction === 'reverse' ? trip.from.name : trip.to.name;

  return `
<div class="mast">
  <div class="kicker"><span class="lbl">Next departures</span></div>
  <h1>${esc(shortName(from))} <em>→</em> ${esc(shortName(to))}</h1>
  <div class="tools">
    <button data-act="reverse">Reverse</button>
    ${tripCount > 1 ? '<button data-act="switch">Switch trip</button>' : ''}
    <button data-act="edit">Edit</button>
  </div>
  <div class="rule"></div>
</div>
${rowsHtml(model)}
${footerHtml(model)}`;
}

export function rowsHtml(model) {
  const cls = ['rows', model.stale ? 'stale' : '', model.sparse ? 'sparse' : ''].filter(Boolean).join(' ');
  if (model.empty) {
    return `<div class="${cls}"><div class="hint${model.status === 'offline' ? ' warn' : ''}" data-t="empty">${
      esc(emptyCopy(model))
    }</div></div>`;
  }
  return `<div class="${cls}" data-t="rows">${model.rows.map(rowHtml).join('')}</div>`;
}

/* The one line that stands in for the whole board, so it is the most
   load-bearing sentence in the app. A cold pair — one nobody has asked for in
   the last thirty seconds — is one to two seconds of upstream call, and for all
   of it this line is the only thing on the screen. "Loading" named the
   machine's activity; this names what the user is waiting for. */
export function emptyCopy(model) {
  if (model.status === 'loading') return 'Getting the next trains…';
  if (model.status === 'offline') return 'No board saved for this trip yet';
  if (model.stale) return 'No services on the last board we could load';
  return 'No services in the next few hours';
}

/** One place, because `patch` rewrites the class the same way `boardHtml`
    wrote it — a row that changes state must not change shape. */
function rowClass(row) {
  return ['row', row.first ? 'first' : '', row.wide ? 'wide' : '',
    row.kind === 'live' ? '' : row.kind].filter(Boolean).join(' ');
}

/* An hours figure (owner ruling 2026-09-01 B) is a quantity and its unit, not a
   two-character code: "3H" set flat at the hero size is 91px in an 86px column
   — the in-browser figure invariant catches it — and reads as a label rather
   than as a number. The numeral keeps the headline size and the H is set small
   beside it, which is how a printed timetable sets a unit. */
export function splitFigure(figure) {
  const m = /^(\d+)(H)$/.exec(String(figure));
  return m ? { num: m[1], unit: m[2] } : { num: String(figure), unit: '' };
}

function figureHtml(figure) {
  const { num, unit } = splitFigure(figure);
  return esc(num) + (unit ? `<span class="unit">${esc(unit)}</span>` : '');
}

function rowHtml(row) {
  const cls = rowClass(row);
  return `<div class="${cls}" style="--stem:${esc(row.lineColour)}" data-t="row" data-key="${esc(row.key)}">
  <div class="mins" data-t="figure">${figureHtml(row.figure)}<span class="prov${row.provenanceWarn ? ' warn' : ''}" data-t="provenance">${esc(row.provenance)}</span></div>
  <div class="body">
    <div class="dep">${depHtml(row)}</div>
    <div class="meta">Platform <b>${esc(row.platform || '—')}</b> &nbsp;·&nbsp; <i>${esc(row.lineCode || '—')}</i></div>
    <div class="dest${row.note ? ' note' : ''}" data-t="dest">${esc(row.note || row.headsign || '—')}</div>
  </div>
</div>`;
}

function depHtml(row) {
  const parts = [`<strong>${esc(row.depTime)}</strong>`];
  if (row.schedTime) parts.push(`<del>${esc(row.schedTime)}</del>`);
  if (row.arrTime) parts.push(`<span class="to">arrives ${esc(row.arrTime)}</span>`);
  return parts.join('');
}

export function footerHtml(model) {
  return `<div class="ftr${model.stale ? ' offline' : ''}" data-t="footer">
  <span class="pulse ${model.footer.dot}" data-t="dot"></span>${esc(model.footer.text)}</div>`;
}

/** True when the rendered rows still describe the same services, so the board
    can be patched in place instead of rebuilt. */
export function sameRowSet(root, model) {
  const keys = [...root.querySelectorAll('[data-t="row"]')].map((el) => el.dataset.key);
  return keys.length === model.rows.length && keys.every((k, i) => k === model.rows[i].key);
}

export function patch(root, model) {
  const rows = [...root.querySelectorAll('[data-t="row"]')];
  rows.forEach((el, i) => {
    const row = model.rows[i];
    if (!row) return;
    const figure = el.querySelector('[data-t="figure"]');
    const provenance = el.querySelector('[data-t="provenance"]');
    // An empty figure (stale board) leaves no text node to update, so make one.
    let text = figure.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) {
      text = document.createTextNode('');
      figure.insertBefore(text, figure.firstChild);
    }
    // The figure counts down in place, and a row can cross the 99-minute
    // boundary while it is on screen, so the unit mark comes and goes too.
    const { num, unit } = splitFigure(row.figure);
    if (text.nodeValue !== num) text.nodeValue = num;
    let unitEl = figure.querySelector('.unit');
    if (unit && !unitEl) {
      unitEl = document.createElement('span');
      unitEl.className = 'unit';
      figure.insertBefore(unitEl, provenance);
    }
    if (unit) unitEl.textContent = unit;
    else if (unitEl) unitEl.remove();
    if (provenance.textContent !== row.provenance) provenance.textContent = row.provenance;
    provenance.className = 'prov' + (row.provenanceWarn ? ' warn' : '');
    const cls = rowClass(row);
    if (el.className !== cls) el.className = cls;
  });

  const rowsEl = root.querySelector('[data-t="rows"]');
  if (rowsEl) rowsEl.classList.toggle('stale', model.stale);

  const footer = root.querySelector('[data-t="footer"]');
  if (footer) {
    footer.classList.toggle('offline', model.stale);
    footer.lastChild.nodeValue = model.footer.text;
    footer.querySelector('[data-t="dot"]').className = 'pulse ' + model.footer.dot;
  }
}

/** Fade the rows that just departed, then let the caller rebuild the list. */
export function dissolveDeparted(root, model, done) {
  const keep = new Set(model.rows.map((r) => r.key));
  const leaving = [...root.querySelectorAll('[data-t="row"]')].filter((el) => !keep.has(el.dataset.key));
  if (!leaving.length) return done();
  leaving.forEach((el) => el.classList.add('gone'));
  setTimeout(done, 240);
}

/* "Central Station" reads as "Central" in a masthead that already says these
   are departures. The API's names are station names; the head is a place. */
export function shortName(name) {
  return String(name || '').replace(/\s+Station$/i, '');
}

export { rowLines };
