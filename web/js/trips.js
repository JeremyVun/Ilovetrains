/* Saved trips: switch to one, reorder, delete, add. The same screen answers
   "show me the other trip" and "manage my trips", because with two or three
   saved trips they are the same act. */

import { esc, mount, onAction } from './dom.js';
import { moveTrip, removeTrip } from './storage.js';
import { shortName } from './board.js';

export function renderTrips(root, ctx) {
  let pendingDelete = null;

  function paint() {
    const trips = ctx.doc.trips;
    const current = ctx.selection;
    mount(root, `
<div class="mast">
  <div class="kicker"><span class="lbl">Saved trips</span></div>
  <h1>Trips</h1>
  <div class="tools">
    <button data-act="done">Done</button>
    <button data-act="add">Add trip</button>
  </div>
  <div class="rule"></div>
</div>
<div class="sheet">
  ${trips.map((t, i) => `
  <div class="trip${current && current.tripId === t.id ? ' current' : ''}" data-t="trip" data-id="${esc(t.id)}">
    <button class="name" data-act="select" data-id="${esc(t.id)}">${esc(shortName(t.from.name))} <em>→</em> ${esc(shortName(t.to.name))}</button>
    <span class="acts">
      <button data-act="up" data-id="${esc(t.id)}"${i === 0 ? ' disabled' : ''}>Up</button>
      <button data-act="down" data-id="${esc(t.id)}"${i === trips.length - 1 ? ' disabled' : ''}>Down</button>
      <button class="del" data-act="delete" data-id="${esc(t.id)}" data-t="delete">${pendingDelete === t.id ? 'Remove?' : 'Delete'}</button>
    </span>
  </div>`).join('')}
  ${trips.length ? '' : '<div class="hint">No saved trips yet</div>'}
</div>`);
  }

  paint();

  onAction(root, (action, el) => {
    const id = el.dataset.id;
    if (action === 'done') return ctx.go('#/');
    if (action === 'add') return ctx.go('#/trips/new');
    if (action === 'select') return ctx.selectTrip(id);
    if (action === 'up' || action === 'down') {
      ctx.update(moveTrip(ctx.doc, id, action === 'up' ? -1 : 1));
      pendingDelete = null;
      return paint();
    }
    if (action === 'delete') {
      // Two taps, no modal: the word becomes the question.
      if (pendingDelete !== id) { pendingDelete = id; return paint(); }
      pendingDelete = null;
      ctx.update(removeTrip(ctx.doc, id));
      ctx.tripRemoved(id);
      return paint();
    }
  });
}
