/* Board v2: one mobile timeline containing past, now and future. */

import { esc, shortName } from './dom.js';
import { clock } from './time.js';
import { journeyDeviceHtml, clampJourneyBars } from './journeybar.js';
import { rowLines } from './rowmodel.js';

export function boardHtml({ trip, direction, model, nowMs = Date.now() }) {
  const from = direction === 'reverse' ? trip.to.name : trip.from.name;
  const to = direction === 'reverse' ? trip.from.name : trip.to.name;
  const freshness = model.stale ? model.footer.text || 'Offline' : 'Live';
  const dot = model.footer.dot || 'idle';
  return `<div class="sy-mast">
    <div class="sy-top">
      <button class="sy-home" data-act="home"><span class="g">←</span>Home</button>
      <span class="sy-fresh"><span class="pulse ${esc(dot)}"></span><span class="lbl">${esc(freshness)}</span></span>
    </div>
    <h1 class="sy-h1"><b>${esc(shortName(from))}</b><span class="conn"></span><b>${esc(shortName(to))}</b></h1>
    <div class="sy-hr"></div>
  </div>
  ${timelineHtml(model, nowMs)}`;
}

export function timelineHtml(model, nowMs) {
  const future = model.futureRows || model.rows || [];
  const past = model.pastRows || [];
  const nowClass = past.length ? '' : ' top';
  const futureClass = future.length ? '' : ' void';
  const empty = model.empty && !past.length;
  return `<div class="sy-tl tl${empty ? ' empty' : ''}" data-t="timeline" data-scroller>
    ${past.map((row) => resultRowHtml(row)).join('')}
    <div class="sy-fwd${futureClass}">
      <div class="sy-now${nowClass}" id="board-now" data-t="now"><div class="r"></div><div class="l">Now · ${esc(clock(nowMs))}</div></div>
      ${future.map((row) => resultRowHtml(row)).join('')}
      ${future.length ? endMark(future) : emptyState(model)}
    </div>
  </div>`;
}

function emptyState(model) {
  return `<div class="sy-end"><b>— ${esc(emptyCopy(model))}</b></div>`;
}

function endMark(rows) {
  if (rows.length >= 6) return '<div class="sy-end"><b>— Six services shown</b></div>';
  const last = rows[rows.length - 1];
  const nothing = rows.length > 3 ? ''
    : `<span>Nothing scheduled after ${esc(last.depTime)}.</span>`;
  return `<div class="sy-end"><b>— End of board</b>${nothing}</div>`;
}

export function emptyCopy(model) {
  if (model.status === 'loading') return 'Getting the next trains…';
  if (model.status === 'offline') return 'No board saved for this trip yet';
  if (model.stale) return 'No services on the last board we could load';
  return 'No services in the next few hours';
}

function figureHtml(row) {
  const value = String(row.figure || '');
  const hours = /^(\d+)H$/.exec(value);
  if (hours) return `${esc(hours[1])}<span class="sy-u">H</span>`;
  if (/^\d+$/.test(value)) return `${esc(value)}<span class="sy-u">min</span>`;
  return esc(value);
}

export function splitFigure(figure) {
  const hours = /^(\d+)(H)$/.exec(String(figure || ''));
  return hours ? { num: hours[1], unit: hours[2] } : { num: String(figure || ''), unit: '' };
}

/* Journey detail promotes this exact row, so it is rendered here and nowhere else. */
export function resultRowHtml(row, opts = {}) {
  const changes = row.changes || [];
  const device = journeyDeviceHtml(row.journey, {
    caps: true,
    showBoardingPlatform: true,
    changes,
    stations: true
  });
  const classes = ['sy-row', changes.length ? 'change' : 'direct',
    changes.length > 1 ? 'two' : '', changes.some((c) => c.tight) ? 'tight' : '',
    row.past ? 'past' : '', row.kind, row.wide ? 'wide' : '',
    opts.promoted ? 'promoted' : ''].filter(Boolean).join(' ');
  const tap = opts.tappable === false ? ''
    : ' data-act="detail" role="button" tabindex="0"';
  return `<div class="${classes}" style="${device.vars}" data-t="row" data-svc data-key="${esc(row.key)}" data-match="${esc(row.matchKey)}"${tap}>
    <div class="sy-fig" data-figure-column><span class="sy-n">${figureHtml(row)}</span><span class="sy-st${row.provenanceWarn ? ' warn' : ''}">${esc(row.provenance || '')}</span></div>
    <div class="sy-b">
      <div class="sy-t"><span class="sy-dp">${esc(row.depTime)}</span>${row.schedTime ? `<del class="sy-was">${esc(row.schedTime)}</del>` : ''}${arrivalHtml(row, opts)}</div>
      ${device.html}
      ${signHtml(row)}
    </div>
  </div>`;
}

/* Only the promoted row has room to name the cancellation in words; the board
   already says it in the figure slot. */
function arrivalHtml(row, opts) {
  const time = esc(row.arrTime || '—');
  if (!row.cancelled) return `<span class="sy-ar" data-result-arrival>${time}</span>`;
  const word = opts.promoted ? '<span class="sy-arx">Cancelled</span>' : '';
  return `<span class="sy-ar cx" data-result-arrival data-cancelled-final="true"><del>${time}</del>${word}</span>`;
}

function signHtml(row) {
  if (row.note) return `<div class="sy-sign note">${esc(row.note)}</div>`;
  const headsign = row.headsign || '—';
  return `<div class="sy-sign" data-headsign data-full-headsign="${esc(headsign)}">${esc(headsign)}</div>`;
}

export function landAtNow(root) {
  const timeline = root.querySelector('[data-t="timeline"]');
  const anchor = root.querySelector('[data-t="now"]');
  if (timeline && anchor) timeline.scrollTop = anchor.offsetTop;
  clampJourneyBars(root);
}

export function preserveTimeline(root) {
  const timeline = root.querySelector('[data-t="timeline"]');
  return timeline ? { scrollTop: timeline.scrollTop, height: timeline.scrollHeight } : null;
}

export function restoreTimeline(root, saved, addedAbove = false) {
  const timeline = root.querySelector('[data-t="timeline"]');
  if (!timeline || !saved) return;
  timeline.scrollTop = saved.scrollTop + (addedAbove ? timeline.scrollHeight - saved.height : 0);
  clampJourneyBars(root);
}

export function sameRowSet(root, model) {
  const keys = [...root.querySelectorAll('[data-t="row"]')].map((el) => el.dataset.key);
  const rows = [...(model.pastRows || []), ...(model.futureRows || model.rows || [])];
  return keys.length === rows.length && keys.every((key, index) => key === rows[index].key);
}

export function patch() { return false; }
export function dissolveDeparted(_root, _model, done) { done(); }

export { rowLines, shortName, clampJourneyBars };
