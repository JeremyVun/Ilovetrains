/* First run and add-a-trip: origin search → destination search → save.
   Same page furniture as the board — masthead, heavy rule, hairlines.

   Every distinct query string is an upstream call to TfNSW, so keystrokes are
   debounced and queries shorter than the API's 2-character minimum are never
   sent. */

import { esc, mount, onAction } from './dom.js';
import { getStops } from './api.js';
import { shortName } from './board.js';
import { newTripId } from './storage.js';

export const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

export function renderSetup(root, ctx) {
  const firstRun = ctx.doc.trips.length === 0;
  const picked = { from: null, to: null };
  let active = 'from';
  let results = [];
  let hint = null;
  let debounce = null;
  let inflight = null;

  mount(root, `
<div class="mast">
  <div class="kicker"><span class="lbl">${firstRun ? 'Next departures' : 'Saved trips'}</span></div>
  <h1>${firstRun ? 'Save the trip you take.' : 'Add a trip'}</h1>
  ${firstRun ? '<p class="lede">Open it again and the board is already there.</p>' : ''}
  <div class="tools">${firstRun ? '' : '<button data-act="cancel">Back</button>'}</div>
  <div class="rule"></div>
</div>
<div class="sheet">
  <label class="field">
    <span class="lbl">From</span>
    <input data-role="from" type="search" autocomplete="off" autocorrect="off"
           spellcheck="false" enterkeyhint="search" placeholder="Origin station">
  </label>
  <label class="field">
    <span class="lbl">To</span>
    <input data-role="to" type="search" autocomplete="off" autocorrect="off"
           spellcheck="false" enterkeyhint="search" placeholder="Destination station">
  </label>
  <div class="results" data-t="results"></div>
  <div class="act"><button data-act="save" data-t="save" disabled>Save trip</button></div>
</div>`);

  const inputs = { from: root.querySelector('[data-role="from"]'), to: root.querySelector('[data-role="to"]') };
  const resultsEl = root.querySelector('[data-t="results"]');
  const saveEl = root.querySelector('[data-t="save"]');

  function paintResults() {
    if (hint) {
      resultsEl.innerHTML = `<div class="hint${hint.warn ? ' warn' : ''}" data-t="hint">${esc(hint.text)}</div>`;
      return;
    }
    resultsEl.innerHTML = results.map((s) => `
      <button data-act="pick" data-id="${esc(s.id)}" data-name="${esc(s.name)}" data-t="stop">
        <span>${esc(shortName(s.name))}</span>
        <span class="lbl">${esc((s.modes || []).join(' · '))}</span>
      </button>`).join('');
  }

  function paintSave() {
    const ready = picked.from && picked.to && picked.from.id !== picked.to.id;
    saveEl.disabled = !ready;
    if (picked.from && picked.to && picked.from.id === picked.to.id) {
      hint = { text: 'Pick two different stations', warn: true };
      results = [];
      paintResults();
    }
  }

  async function search(query) {
    if (inflight) inflight.abort();
    inflight = new AbortController();
    try {
      results = await getStops(query, { signal: inflight.signal });
      hint = results.length ? null : { text: 'No stations match', warn: false };
    } catch (e) {
      if (e.name === 'AbortError') return;
      results = [];
      hint = { text: 'Station search is unavailable', warn: true };
    }
    paintResults();
  }

  for (const [role, input] of Object.entries(inputs)) {
    input.addEventListener('focus', () => {
      active = role;
      results = [];
      hint = null;
      paintResults();
    });
    input.addEventListener('input', () => {
      active = role;
      picked[role] = null;
      paintSave();
      clearTimeout(debounce);
      const query = input.value.trim();
      if (query.length < MIN_QUERY) {
        if (inflight) inflight.abort();
        results = [];
        hint = null;
        paintResults();
        return;
      }
      debounce = setTimeout(() => search(query), SEARCH_DEBOUNCE_MS);
    });
  }

  onAction(root, (action, el) => {
    if (action === 'cancel') { ctx.go('#/trips'); return; }

    if (action === 'pick') {
      picked[active] = { id: el.dataset.id, name: el.dataset.name };
      inputs[active].value = shortName(el.dataset.name);
      results = [];
      hint = null;
      paintResults();
      paintSave();
      if (active === 'from' && !picked.to) inputs.to.focus();
      else inputs[active].blur();
      return;
    }

    if (action === 'save') {
      if (saveEl.disabled) return;
      const trip = {
        id: newTripId(),
        from: picked.from,
        to: picked.to,
        createdAt: new Date().toISOString()
      };
      ctx.saveTrip(trip);
    }
  });

  inputs.from.focus();
}
