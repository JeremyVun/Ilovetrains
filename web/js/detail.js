/* Journey detail: the board's chosen row promoted intact, then the journey as
   steps (the C1 full-rule ledger, docs/contracts/ui.md). The row is rendered
   by board.js so the two screens cannot drift apart. */

import { esc } from './dom.js';
import { resultRowHtml } from './board.js';
import { chipInk } from './journeybar.js';
import { lineFill } from './lines.js';
import { boardingCapLabel } from './journey.js';

export function detailHtml(model) {
  return `
<div class="sy-mast">
  <div class="sy-top">
    <button class="sy-home" data-act="board"><span class="g">←</span>${esc(model.from)} departures</button>
  </div>
  <div class="detail-kicker lbl">Journey</div>
  <h1 class="detail-title">${esc(model.from)} <em>→</em> ${esc(model.to)}</h1>
  <div class="detail-summary${model.summaryWarn ? ' warn' : ''}" data-summary>${esc(model.summary)}</div>
  <div class="sy-hr"></div>
</div>
<div class="detail-scroll" data-scroller>
  ${resultRowHtml(model.row, { promoted: true, tappable: false, originName: model.from })}
  <div class="detail-steps">${model.steps.map(stepHtml).join('')}</div>
</div>
${tailHtml(model.arrival)}
<div class="detail-fresh${model.stale ? ' offline' : ''}" data-t="footer"><span class="pulse ${esc(model.footer.dot)}"></span>${esc(model.footer.text)}</div>
${railHtml(model)}`;
}

function stepHtml(step) {
  const classes = ['dstep', step.kind === 'change' ? 'change' : '', step.tight ? 'tight' : '',
    step.cancelled ? 'cancelled' : '', step.done ? 'done' : ''].filter(Boolean).join(' ');
  return `<div class="${classes}" data-t="step" data-step="${esc(step.kind)}">`
    + `<span class="dtime">${esc(step.time)}</span>`
    + `<span class="dwhat"><strong>${esc(step.station)}</strong>${actHtml(step)}</span></div>`;
}

function actHtml(step) {
  if (step.kind !== 'change') {
    const ferry = step.chip.place === 'Wharf' && step.chip.location && step.chip.role === 'origin';
    if (ferry) return `<span class="dplace-act">${chipHtml(step.chip)}<span>${esc(step.label)}</span></span>`;
    return `<span>${chipHtml(step.chip)} ${esc(step.label)}</span>`;
  }
  const note = step.label === 'Board' ? '' : `<span class="dchange-note">${esc(step.label)}</span>`;
  const place = step.boardingPlace
    ? ' · ' + boardingPlaceHtml(step.boardingPlace, step.on.place === 'Wharf') : '';
  return `<span class="dchange-act"><span class="dact-unit">${chipHtml(step.off)}<span>Get off</span></span>`
    + `<span class="darrow">→</span><span class="dact-unit board">${chipHtml(step.on)}`
    + `<span class="dact-copy">${note}<span>${esc(step.serviceLabel)}${place}</span></span></span></span>`;
}

function boardingPlaceHtml(value, ferry = false) {
  const match = String(value).match(/^(.*?)(Side\s+\S+)$/i);
  const contents = match
    ? esc(match[1]) + `<span class="dside">${esc(match[2])}</span>`
    : esc(value);
  return ferry ? `<span data-boarding-location="${esc(value)}">${contents}</span>` : contents;
}

function chipHtml(chip) {
  const label = chip.location ? ` aria-label="${esc(`${chip.location} · ${chip.code}`)}"` : '';
  const ferry = chip.place === 'Wharf' && chip.location;
  const full = ferry && chip.role === 'origin';
  const attrs = ferry
    ? ` data-ferry-location="${esc(chip.location)}" data-role="${esc(chip.role)}" data-stop="${esc(chip.stop)}"` : '';
  return `<b class="dchip${full ? ' full-location' : ''}" data-line-code="${esc(chip.code)}"${attrs}${label} style="background:${
    lineFill(chip.colourKey)};color:${chipInk(chip.colourKey)}">${esc(full ? boardingCapLabel(chip.location, 'ferry') : chip.platform)}</b>`;
}

/* The closing rule answers the masthead's, and the line under it states the
   one fact stated nowhere else on the screen: the platform you get off at. */
function tailHtml(arrival) {
  const platform = arrival.cancelled
    ? '<span class="lbl p warn">Journey cancelled</span>'
    : `<span class="lbl p">${esc(arrival.label || '—')}</span>`;
  return `<div class="detail-tail${arrival.cancelled ? ' cx' : ''}"><div class="rule"></div>
  <div class="line"><span class="t">${esc(arrival.time || '—')}</span><span class="n">${
    esc(arrival.station || '—')}</span>${platform}</div>
</div>`;
}

/* A cancelled journey and the one already being followed have no positive
   action, so the rail is absent rather than disabled. There is no manual
   unfocus; the back control is the way out. */
function railHtml(model) {
  if (model.cancelled || model.focused) return '';
  return `<div class="hm-bar detail-rail" data-footer-rail><button data-act="focus">Take this ${esc(model.vehicle)}</button></div>`;
}
