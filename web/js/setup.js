/* Add a trip in the locked home-sheet grammar, with recent stations and fuzzy
   ranking. */

import { esc, mount, onAction, shortName } from './dom.js';
import { getStops } from './api.js';
import { newTripId, recordSearch } from './storage.js';
import { MIN_QUERY, createSearcher, hintFor, queryKey, rankStops, fuzzyScore } from './search.js';

export const SEARCH_DEBOUNCE_MS = 300;
const searcher = createSearcher((query, opts) => getStops(query, opts));

export function renderSetup(root, ctx) {
  const picked = { from: null, to: null };
  let active = 'from';
  let results = [];
  let group = '';
  let hint = null;
  let debounce = null;
  let inflight = null;

  mount(root, `<div class="hm-c home-screen">
    <div class="hm-top">${ctx.doc.trips.length
      ? '<button class="hm-back" data-act="home"><span class="g">←</span>Home</button>' : ''}</div>
    <div class="hm-mast"><h1>New trip</h1><div class="r"></div></div>
    <div class="hm-sheet">
      ${fieldHtml('from', 'From', 'Origin station')}
      ${fieldHtml('to', 'To', 'Destination station')}
      <div data-t="results"></div>
      <p class="hm-lede">Save <b>one direction only</b>. When today’s ride is done, the way back is ready.</p>
    </div>
    <div class="hm-bar save"><button data-act="save" data-t="save" disabled>Choose where you start</button></div>
  </div>`);

  const inputs = {
    from: root.querySelector('[data-role="from"]'),
    to: root.querySelector('[data-role="to"]')
  };
  const resultsEl = root.querySelector('[data-t="results"]');
  const saveEl = root.querySelector('[data-t="save"]');

  function fieldHtml(role, label, placeholder) {
    return `<label class="hm-field"><span class="lbl">${label}</span>
      <input class="v" data-role="${role}" type="search" autocomplete="off" autocorrect="off"
        spellcheck="false" enterkeyhint="search" placeholder="${placeholder}">
    </label>`;
  }

  function recentFor(role, query = '') {
    return ((ctx.doc.searches && ctx.doc.searches[role]) || [])
      .filter((stop) => !query || fuzzyScore(stop.name, query) > 0);
  }

  function paintResults() {
    if (hint) {
      resultsEl.innerHTML = `<div class="hint${hint.warn ? ' warn' : ''}">${esc(hint.text)}</div>`;
      return;
    }
    if (!results.length) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = `<div class="hm-grp">${esc(group)}</div><div class="hm-res">${results.map((stop, index) =>
      `<button data-act="pick" data-index="${index}"><span class="n">${esc(shortName(stop.name))}</span>
        <span class="w">${esc((stop.modes || []).join(' · '))}</span></button>`).join('')}</div>`;
  }

  function showRecents(role, query = '') {
    results = recentFor(role, query);
    group = results.length ? 'You searched before' : '';
    hint = null;
    paintResults();
  }

  function paintSave() {
    const ready = picked.from && picked.to && picked.from.id !== picked.to.id;
    saveEl.disabled = !ready;
    saveEl.textContent = ready
      ? `Save ${shortName(picked.from.name)} → ${shortName(picked.to.name)}`
      : picked.from ? 'Choose where you’re going' : 'Choose where you start';
    if (picked.from && picked.to && picked.from.id === picked.to.id) {
      results = [];
      hint = { text: 'Pick two different stations', warn: true };
      paintResults();
    }
  }

  async function search(query, role) {
    if (inflight) inflight.abort();
    inflight = new AbortController();
    try {
      const stops = await searcher.search(query, { signal: inflight.signal });
      if (role !== active || queryKey(query) !== queryKey(inputs[role].value)) return;
      const combined = [...stops, ...recentFor(role, query)];
      results = rankStops([...new Map(combined.map((stop) => [stop.id, stop])).values()], query);
      group = results.length ? 'Matches' : '';
      hint = hintFor({ query, phase: 'done', count: results.length });
    } catch (error) {
      if (error.name === 'AbortError') return;
      results = recentFor(role, query);
      group = results.length ? 'You searched before' : '';
      hint = results.length ? null : hintFor({ query, phase: 'error' });
    }
    paintResults();
  }

  Object.entries(inputs).forEach(([role, input]) => {
    input.addEventListener('focus', () => {
      active = role;
      if (!input.value.trim()) showRecents(role);
    });
    input.addEventListener('input', () => {
      active = role;
      picked[role] = null;
      paintSave();
      clearTimeout(debounce);
      const query = input.value.trim();
      if (query.length < MIN_QUERY) {
        if (inflight) inflight.abort();
        if (query) {
          results = recentFor(role, query);
          group = results.length ? 'You searched before' : '';
          hint = results.length ? null : hintFor({ query, phase: 'idle' });
          paintResults();
        } else showRecents(role);
        return;
      }
      const remembered = searcher.peek(query);
      if (remembered) {
        const combined = [...remembered, ...recentFor(role, query)];
        results = rankStops([...new Map(combined.map((stop) => [stop.id, stop])).values()], query);
        group = results.length ? 'Matches' : '';
        hint = hintFor({ query, phase: 'done', count: results.length });
        paintResults();
        return;
      }
      results = [];
      group = '';
      hint = hintFor({ query, phase: 'pending' });
      paintResults();
      debounce = setTimeout(() => search(query, role), SEARCH_DEBOUNCE_MS);
    });
  });

  onAction(root, (action, element) => {
    if (action === 'home') {
      if (ctx.doc.trips.length) ctx.go('#/');
      return;
    }
    if (action === 'pick') {
      const stop = results[Number(element.dataset.index)];
      if (!stop) return;
      picked[active] = stop;
      ctx.update(recordSearch(ctx.doc, active, stop));
      inputs[active].value = shortName(stop.name);
      results = [];
      hint = null;
      paintResults();
      paintSave();
      if (active === 'from' && !picked.to) inputs.to.focus();
      else inputs[active].blur();
      return;
    }
    if (action === 'save' && !saveEl.disabled) {
      ctx.saveTrip({
        id: newTripId(),
        from: picked.from,
        to: picked.to,
        createdAt: new Date().toISOString()
      });
    }
  });

  inputs.from.focus();
}
