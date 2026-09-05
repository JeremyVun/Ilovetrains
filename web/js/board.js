/* Board v2: one mobile timeline containing past, now and future. */

import { esc, figureHtml, shortName } from './dom.js';
import { clock } from './time.js';
import { journeyDeviceHtml, clampJourneyBars } from './journeybar.js';
import { rowLines } from './rowmodel.js';

export function boardHtml({ trip, direction, model, nowMs = Date.now(), freshness }) {
  const from = direction === 'reverse' ? trip.to.name : trip.from.name;
  const to = direction === 'reverse' ? trip.from.name : trip.to.name;
  const label = freshness === undefined ? freshnessText(model) : freshness;
  const dot = model.footer.dot || 'idle';
  return `<div class="sy-mast">
    <div class="sy-top">
      <button class="sy-home" data-act="home"><span class="g">←</span>Home</button>
      <span class="sy-fresh"><span class="pulse ${esc(dot)}"></span><span class="lbl">${esc(label)}</span></span>
    </div>
    <h1 class="sy-h1"><b class="endpoint from">${esc(shortName(from))}</b><span class="conn"></span><b class="endpoint to">${esc(shortName(to))}</b></h1>
    <div class="sy-hr"></div>
  </div>
  ${timelineHtml(model, nowMs, from)}`;
}

export function freshnessText(model) {
  return model.stale ? model.footer.text || 'Offline' : 'Live';
}

export function timelineHtml(model, nowMs, originName = '') {
  const future = model.futureRows || model.rows || [];
  const past = model.pastRows || [];
  const nowClass = past.length ? '' : ' top';
  const futureClass = future.length ? '' : ' void';
  const empty = model.empty && !past.length;
  return `<div class="sy-tl tl${empty ? ' empty' : ''}" data-t="timeline" data-scroller>
    ${past.map((row) => resultRowHtml(row, { originName })).join('')}
    <div class="sy-fwd${futureClass}">
      <div class="sy-now${nowClass}" id="board-now" data-t="now"><div class="r"></div><div class="l">Now · ${esc(clock(nowMs))}</div></div>
      ${future.map((row) => resultRowHtml(row, { originName })).join('')}
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

/* Journey detail promotes this exact row, so it is rendered here and nowhere else. */
export function resultRowHtml(row, opts = {}) {
  const changes = row.changes || [];
  const device = journeyDeviceHtml(row.journey, {
    caps: true,
    showBoardingPlatform: true,
    originName: opts.originName,
    changes,
    stations: true
  });
  const classes = ['sy-row', changes.length ? 'change' : 'direct',
    device.fullTransfer ? 'full-transfer' : '',
    changes.length > 1 ? 'two' : '', changes.some((c) => c.tight) ? 'tight' : '',
    changes.some((c) => c.fromStation && c.toStation && c.fromStation !== c.toStation) ? 'distinct-stop' : '',
    changes.some((c) => c.fromPlace === 'Wharf' || c.toPlace === 'Wharf') ? 'ferry-change' : '',
    row.past ? 'past' : '', row.kind, row.wide ? 'wide' : '',
    opts.promoted ? 'promoted' : ''].filter(Boolean).join(' ');
  const tap = opts.tappable === false ? ''
    : ' data-act="detail" role="button" tabindex="0"';
  const access = [...rowLines(row), ...changes.flatMap((change) => [
    change.fromLabel || '—',
    change.toLabel || '—'
  ])].join('. ');
  return `<div class="${classes}" style="${device.vars}" data-t="row" data-svc data-key="${esc(row.key)}" data-match="${esc(row.matchKey)}" aria-label="${esc(access)}"${tap}>
    <div class="sy-fig" data-figure-column><span class="sy-n">${figureHtml(row.figure, 'sy-u')}</span><span class="sy-st${row.provenanceWarn ? ' warn' : ''}">${esc(row.provenance || '')}</span></div>
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

/* A service that has left is not deleted out from under the eye: it fades
   where it stood and the timeline closes upward afterwards (ui.md). */
export function markDeparting(root, keptKeys) {
  const leaving = [...root.querySelectorAll('.sy-fwd > [data-t="row"]')]
    .filter((row) => !keptKeys.has(row.dataset.key));
  leaving.forEach((row) => row.classList.add('departing'));
  return leaving;
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
