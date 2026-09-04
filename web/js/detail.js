/* Journey detail: the board's chosen row promoted intact, then the journey as
   steps (the C1 full-rule ledger, docs/contracts/ui.md). The row is rendered
   by board.js so the two screens cannot drift apart. */

import { esc } from './dom.js';
import { resultRowHtml } from './board.js';
import { chipInk } from './journeybar.js';
import { lineFill } from './lines.js';

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
  ${resultRowHtml(model.row, { promoted: true, tappable: false })}
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
    + `<span class="dwhat"><strong>${esc(step.station)}</strong><span>${actHtml(step)}</span></span></div>`;
}

function actHtml(step) {
  if (step.kind !== 'change') return chipHtml(step.chip) + ' ' + esc(step.label);
  return chipHtml(step.off) + ' Get off &nbsp;→&nbsp; ' + chipHtml(step.on) + ' ' + esc(step.label);
}

function chipHtml(chip) {
  return `<b class="dchip" data-line-code="${esc(chip.code)}" style="background:${
    lineFill(chip.code)};color:${chipInk(chip.code)}">${esc(chip.platform)}</b>`;
}

/* The closing rule answers the masthead's, and the line under it states the
   one fact stated nowhere else on the screen: the platform you get off at. */
function tailHtml(arrival) {
  const platform = arrival.cancelled
    ? '<span class="lbl p warn">Journey cancelled</span>'
    : `<span class="lbl p">Platform ${esc(arrival.platform || '—')}</span>`;
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
  return '<div class="hm-bar detail-rail" data-footer-rail><button data-act="focus">Take this train</button></div>';
}
