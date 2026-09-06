/* Add a trip in the locked home-sheet grammar, with recent stations and fuzzy
   ranking. */

import { esc, mount, onAction, shortName } from './dom.js';
import { getStops } from './api.js';
import { preferencesOf } from './preferences.js';
import { newTripId, recordSearch } from './storage.js';
import { here, loadStations, nearest, NEAR_STATION_KM } from './stations.js';
import { MIN_QUERY, createSearcher, hintFor, queryKey, rankStops, fuzzyScore, topPick } from './search.js';

export const SEARCH_DEBOUNCE_MS = 300;
const searcher = createSearcher((query, opts) => getStops(query, opts));

export async function renderSetup(root, ctx, { origin, redirect } = {}) {
  const isCurrent = () => root.isConnected && document.getElementById('app') === root;
  const useLocation = preferencesOf(ctx.doc).useLocation;
  let initialPermission = null;
  let initialStations = null;
  let initialFix = null;
  if (useLocation && !origin && !ctx.doc.trips.length) {
    initialPermission = await ctx.permission();
    if (!isCurrent()) return;
    if (initialPermission === 'granted') {
      [initialFix, initialStations] = await Promise.all([
        ctx.fix({ maximumAge: 0 }), loadStations()
      ]);
      if (!isCurrent()) return;
      const spot = initialFix && initialStations ? here(ctx.doc, initialStations, initialFix) : null;
      if (spot) origin = spot.station;
    }
  }
  let fromSource = origin && useLocation ? 'location' : 'search';
  const picked = { from: null, to: null };
  let active = 'from';
  let results = [];
  let group = '';
  let hint = null;
  let debounce = null;
  let inflight = null;
  let stations = initialStations;
  let fix = initialFix;
  let askable = initialPermission === 'prompt';
  let nearby = null;
  let askedLocation = false;
  let locationGeneration = 0;

  mount(root, `<div class="hm-c home-screen">
    <div class="hm-top">${ctx.doc.trips.length
      ? '<button class="hm-back" data-act="home"><span class="g">←</span>Home</button>' : ''}</div>
    <div class="hm-mast"><h1>New trip</h1><div class="r"></div></div>
    <div class="hm-sheet">
      ${fieldHtml('from', 'From', 'Origin station')}
      ${fieldHtml('to', 'To', 'Destination station')}
      <div data-t="results"></div>
    </div>
    <div class="hm-bar save"><button data-act="save" data-t="save" disabled>Choose where you start</button></div>
  </div>`);
  ctx.shownSetup(origin && useLocation ? 'location' : 'empty');

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

  /* Where this origin already goes: the far end of every saved trip through it,
     newest first, then what was searched for. */
  function destinationsFrom(from) {
    const saved = [...(ctx.doc.trips || [])]
      .filter((trip) => trip.from.id === from.id || trip.to.id === from.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((trip) => (trip.from.id === from.id ? trip.to : trip.from));
    const combined = [...saved, ...recentFor('to')].filter((stop) => stop.id !== from.id);
    return [...new Map(combined.map((stop) => [stop.id, stop])).values()];
  }

  /* The From field's two pre-query rows, in the result-row grammar: the ask
     while the permission is still askable, the nearest station once a fix
     exists (ui.md, setup and station search). */
  function leadHtml() {
    if (active !== 'from' || inputs.from.value.trim()) return '';
    if (nearby) return `<div class="hm-grp">Nearest station</div>${rowsHtml([nearby], 'pick-near')}`;
    if (!useLocation || !askable || fix) return '';
    if (!askedLocation) {
      askedLocation = true;
      ctx.track('asked_setup');
    }
    return `<div class="hm-res"><button data-act="use-location">
      <span class="n">Use my location</span></button></div>`;
  }

  function rowsHtml(stops, act) {
    return `<div class="hm-res">${stops.map((stop, index) =>
      `<button data-act="${act}" data-index="${index}"><span class="n">${esc(shortName(stop.name))}</span>
        <span class="w">${esc((stop.modes || []).join(' · '))}</span></button>`).join('')}</div>`;
  }

  function paintResults() {
    const lead = leadHtml();
    if (hint) {
      resultsEl.innerHTML = `${lead}<div class="hint${hint.warn ? ' warn' : ''}">${esc(hint.text)}</div>`;
      return;
    }
    if (!results.length) { resultsEl.innerHTML = lead; return; }
    resultsEl.innerHTML = `${lead}<div class="hm-grp">${esc(group)}</div>${rowsHtml(results, 'pick')}`;
  }

  function showRecents(role, query = '') {
    results = role === 'to' && !query && picked.from
      ? destinationsFrom(picked.from) : recentFor(role, query);
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
      if (!isCurrent()) return;
      if (role !== active || queryKey(query) !== queryKey(inputs[role].value)) return;
      const combined = [...stops, ...recentFor(role, query)];
      results = rankStops([...new Map(combined.map((stop) => [stop.id, stop])).values()], query);
      group = results.length ? 'Matches' : '';
      hint = hintFor({ query, phase: 'done', count: results.length });
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (!isCurrent()) return;
      results = recentFor(role, query);
      group = results.length ? 'You searched before' : '';
      hint = results.length ? null : hintFor({ query, phase: 'error' });
    }
    paintResults();
  }

  function pick(stop, source = 'search') {
    if (!stop) return;
    picked[active] = stop;
    if (active === 'from') fromSource = source;
    ctx.update(recordSearch(ctx.doc, active, stop));
    inputs[active].value = shortName(stop.name);
    results = [];
    hint = null;
    paintResults();
    paintSave();
    if (active === 'from' && !picked.to) inputs.to.focus();
    else inputs[active].blur();
  }

  Object.entries(inputs).forEach(([role, input]) => {
    input.addEventListener('focus', () => {
      active = role;
      if (!input.value.trim()) showRecents(role);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault(); // an implicit submit would reload away the half-entered pair
      active = role;
      pick(topPick(results, hint));
    });
    input.addEventListener('input', () => {
      active = role;
      picked[role] = null;
      if (role === 'from') {
        fromSource = 'search';
        redirect = null;
      }
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

  async function requestLocation() {
    if (!useLocation) return;
    const generation = ++locationGeneration;
    fix = await ctx.fix();
    if (!isCurrent() || generation !== locationGeneration) return;
    ctx.track(fix ? 'granted_setup' : 'denied_setup');
    if (!stations) stations = await loadStations();
    if (!isCurrent() || generation !== locationGeneration) return;
    const spot = fix && stations ? here(ctx.doc, stations, fix) : null;
    if (!spot) {
      askable = false;
      paintResults();
      return;
    }
    active = 'from';
    pick(spot.station, 'location');
  }

  /* A returning user whose permission is already granted starts the sheet where
     they are; everyone else is offered the station rather than given it. */
  function settleLocation() {
    if (picked.from || inputs.from.value.trim()) return;
    const spot = fix && stations ? here(ctx.doc, stations, fix) : null;
    if (spot && !ctx.doc.trips.length) {
      active = 'from';
      pick(spot.station, 'location');
      return;
    }
    const near = fix && stations ? nearest(stations, fix, NEAR_STATION_KM) : null;
    nearby = near ? near.station : null;
    paintResults();
  }

  onAction(root, (action, element) => {
    if (action === 'home') {
      if (ctx.doc.trips.length) ctx.go('#/');
      return;
    }
    if (action === 'pick') {
      pick(results[Number(element.dataset.index)]);
      return;
    }
    if (action === 'pick-near') {
      active = 'from';
      pick(nearby, 'nearby');
      return;
    }
    if (action === 'use-location') {
      requestLocation();
      return;
    }
    if (action === 'save' && !saveEl.disabled) {
      ctx.saveTrip({
        id: newTripId(),
        from: picked.from,
        to: picked.to,
        createdAt: new Date().toISOString()
      }, redirect, fromSource);
    }
  });

  if (origin) {
    active = 'from';
    pick(origin, useLocation ? 'location' : 'search');
  } else {
    inputs.from.focus();
  }

  if (!useLocation) return;

  if (initialPermission !== null) {
    if (stations) settleLocation();
    else loadStations().then((list) => {
      if (!isCurrent()) return;
      stations = list;
      settleLocation();
    });
    return;
  }

  Promise.all([ctx.permission(), loadStations()]).then(async ([permission, list]) => {
    if (!isCurrent()) return;
    stations = list;
    askable = permission === 'prompt';
    if (permission === 'granted') fix = await ctx.fix();
    if (!isCurrent()) return;
    settleLocation();
  });
}
