/* The journey detail view's markup — a port of comps/a1-ledger.html, wired to
   live data. Structure, class names and type values are the comp's.

   Split the same way board.js is: `detailHtml` builds the page, `patch`
   rewrites only the figures and the provenance labels, so the ledger counts
   down in place between fetches without a block ever changing shape. */

import { esc } from './dom.js';
import { splitFigure } from './board.js';

export function detailHtml(view) {
  const { model, focused } = view;
  return `
<div class="mast">
  <div class="kicker"><span class="lbl">${esc(model.departed && focused ? 'On this train' : 'Journey')}</span></div>
  <h1>${esc(model.from)} <em>→</em> ${esc(model.to)}</h1>
  <div class="lede" data-t="lede">${esc(ledeFor(model, focused))}</div>
  <div class="tools">
    <button data-act="board">Board</button>
    <button data-act="${focused ? 'unfocus' : 'focus'}"${focused ? '' : ' class="on"'}>${
      focused ? 'Unfocus' : 'Focus this train'}</button>
  </div>
  <div class="rule"></div>
</div>
<div class="legs${model.stale ? ' stale' : ''}" data-t="legs">${model.blocks.map(blockHtml).join('')}</div>
${tailHtml(model)}`;
}

/* Focused and moving, the standfirst is the glance fact — arrival and minutes
   to go, which is what "I'm on this train" is actually asking. Otherwise it is
   the shape of the journey. */
function ledeFor(model, focused) {
  if (focused && model.departed && model.toGo !== null && model.toGo > 0) {
    return 'Arrives ' + model.arrival.time + ' · ' + model.toGo + ' min to go';
  }
  return model.lede;
}

function blockHtml(block) {
  return block.type === 'change' ? changeHtml(block) : legHtml(block);
}

function figureHtml(figure) {
  const { num, unit } = splitFigure(figure);
  return esc(num) + (unit ? `<span class="unit">${esc(unit)}</span>` : '');
}

function minsHtml(block, extra) {
  return `<div class="mins" data-t="figure">${figureHtml(block.figure)}<span class="prov${
    block.provenanceWarn || extra ? ' warn' : ''}" data-t="provenance">${esc(block.provenance)}</span></div>`;
}

function legClass(leg) {
  return ['row', leg.first ? 'first' : '', leg.wide ? 'wide' : '',
    leg.kind === 'live' ? '' : leg.kind].filter(Boolean).join(' ');
}

/* A leg is a board row, and inherits every state treatment the board already
   ships — delayed, cancelled, scheduled-only, stale — because it IS the
   board's row. The badge sits at the right end of the meta line rather than
   inline: a flex row eats the space between "PLATFORM" and its number. */
function legHtml(leg) {
  return `<div class="${legClass(leg)}" style="--stem:${esc(leg.lineColour)}" data-t="leg">
  ${minsHtml(leg)}
  <div class="body">
    <div class="dep">${depHtml(leg)}</div>
    <div class="meta">Platform <b>${esc(leg.platform || '—')}</b><span class="badge">${esc(leg.lineCode || '—')}</span></div>
    <div class="dest">${esc(leg.headsign || '—')}</div>
  </div>
</div>`;
}

function depHtml(leg) {
  const parts = [`<strong>${esc(leg.time)}</strong>`];
  if (leg.struck) parts.push(`<del>${esc(leg.struck)}</del>`);
  if (leg.tail) parts.push(`<span class="to">${esc(leg.tail)}</span>`);
  return parts.join('');
}

/* The change is made unmissable STRUCTURALLY, not by out-shouting it: two
   heavy rules — the masthead's own gesture, reused — and the station set at
   the h1 step, printed once, spanning the two platforms and the two times.

   When the window is tight the figure goes coral and both times are printed
   with the timetabled one struck. What is never printed is a verdict on
   whether you make it: this app has no data that could support one. */
function changeHtml(change) {
  const cls = ['row', 'chg', change.tight ? 'tight' : '', change.wide ? 'wide' : '',
    change.done ? 'done' : ''].filter(Boolean).join(' ');
  const times = [
    change.arrTime ? `Arrive ${esc(change.arrTime)}` : '',
    change.arrStruck ? `<del>${esc(change.arrStruck)}</del>` : '',
    change.depTime ? `&nbsp;·&nbsp; leave ${esc(change.depTime)}` : ''
  ].filter(Boolean).join(' ');
  return `<div class="${cls}" data-t="change">
  ${minsHtml(change, change.tight)}
  <div class="body">
    <h2>${esc(change.station || '—')}</h2>
    <div class="meta">Platform <b>${esc(change.fromPlatform || '—')}</b><span class="arw">→</span>Platform <b>${
      esc(change.toPlatform || '—')}</b></div>
    <div class="dest">${times}</div>
    ${change.warnline ? `<div class="warnline">${esc(change.warnline)}</div>` : ''}
  </div>
</div>`;
}

/* The closing rule answers the masthead's, and the line under it states the
   one fact stated nowhere else on the screen: the platform you get off at. */
function tailHtml(model) {
  const a = model.arrival;
  return `<div class="tail${a.cancelled ? ' cx' : ''}"><div class="rule"></div>
  <div class="line">
    <span class="t">${esc(a.time || '—')}</span>
    <span class="n">${esc(a.station || '—')}</span>
    <span class="lbl p">Platform ${esc(a.platform || '—')}</span>
  </div>
</div>`;
}

/** The ledger counts down in place: figures and provenance only, never shape. */
export function patch(root, model, focused) {
  const blocks = [...root.querySelectorAll('[data-t="leg"],[data-t="change"]')];
  if (blocks.length !== model.blocks.length) return false;
  const lede = root.querySelector('[data-t="lede"]');
  const ledeText = ledeFor(model, focused);
  if (lede && lede.textContent !== ledeText) lede.textContent = ledeText;
  const legs = root.querySelector('[data-t="legs"]');
  if (legs) legs.classList.toggle('stale', model.stale);
  blocks.forEach((el, i) => {
    const block = model.blocks[i];
    const figure = el.querySelector('[data-t="figure"]');
    const provenance = el.querySelector('[data-t="provenance"]');
    let text = figure.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) {
      text = document.createTextNode('');
      figure.insertBefore(text, figure.firstChild);
    }
    const { num, unit } = splitFigure(block.figure);
    if (text.nodeValue !== num) text.nodeValue = num;
    let unitEl = figure.querySelector('.unit');
    if (unit && !unitEl) {
      unitEl = document.createElement('span');
      unitEl.className = 'unit';
      figure.insertBefore(unitEl, provenance);
    }
    if (unit) unitEl.textContent = unit;
    else if (unitEl) unitEl.remove();
    if (provenance.textContent !== block.provenance) provenance.textContent = block.provenance;
    const cls = block.type === 'change'
      ? ['row', 'chg', block.tight ? 'tight' : '', block.wide ? 'wide' : '', block.done ? 'done' : ''].filter(Boolean).join(' ')
      : legClass(block);
    if (el.className !== cls) el.className = cls;
  });
  return true;
}
