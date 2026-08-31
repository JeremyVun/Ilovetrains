/* App controller: routing, timers, and the fetch/cache loop.

   Order of events on a warm open: predicted trip → paint from the localStorage
   cache → fetch live → replace without layout shift. Between fetches the
   figures count down in place once a second. */

import {
  loadDoc, saveDoc, addTrip, findTrip, leg, cacheKey, putCache, getCache, recordView
} from './storage.js';
import { predict } from './predict.js';
import { boardModel } from './rowmodel.js';
import * as Board from './board.js';
import { renderSetup } from './setup.js';
import { renderTrips } from './trips.js';
import { getDepartures } from './api.js';
import { onAction } from './dom.js';

const REFRESH_MS = 30_000;   // matches the server's s-maxage=30
const TICK_MS = 1_000;
const VIEW_QUALIFIES_MS = 5_000;
const LIMIT = 6;

/* Indirection so a test harness can pin the clock: window.__trains.now = () => ms */
let nowFn = () => Date.now();
const now = () => nowFn();

const state = {
  doc: loadDoc(),
  selection: null,      // {tripId, direction}
  body: null,           // last departures response for the current selection
  serverStale: false,
  offline: false,
  viewRecorded: false,
  root: null,
  onBoard: false
};

const timers = { tick: null, refresh: null, view: null };
let inflight = null;

/* --- routing ------------------------------------------------------------ */

function freshRoot() {
  // Replacing the node drops every listener the previous screen attached.
  const old = document.getElementById('app');
  const el = document.createElement('div');
  el.id = 'app';
  old.replaceWith(el);
  state.root = el;
  return el;
}

const ctx = {
  get doc() { return state.doc; },
  get selection() { return state.selection; },
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  update(doc) { state.doc = doc; saveDoc(doc); },
  saveTrip(trip) {
    ctx.update(addTrip(state.doc, trip));
    state.selection = { tripId: trip.id, direction: 'forward' };
    ctx.go('#/');
  },
  selectTrip(tripId) {
    state.selection = { tripId, direction: 'forward' };
    ctx.go('#/');
  },
  tripRemoved(tripId) {
    if (state.selection && state.selection.tripId === tripId) state.selection = null;
    if (!state.doc.trips.length) ctx.go('#/setup');
  }
};

function route() {
  stopTimers();
  state.onBoard = false;
  const hash = location.hash || '#/';
  const root = freshRoot();

  if (hash === '#/setup' || hash === '#/trips/new') return renderSetup(root, ctx);
  if (hash === '#/trips') return renderTrips(root, ctx);
  if (!state.doc.trips.length) { location.hash = '#/setup'; return; }
  showBoard(root);
}

/* --- board -------------------------------------------------------------- */

function currentLeg() {
  const trip = findTrip(state.doc, state.selection.tripId);
  return leg(trip, state.selection.direction);
}

function currentKey() {
  const { from, to } = currentLeg();
  return cacheKey(from.id, to.id);
}

function showBoard(root) {
  if (!state.selection || !findTrip(state.doc, state.selection.tripId)) {
    state.selection = predict(state.doc, now());
  }
  state.onBoard = true;
  state.viewRecorded = false;
  state.offline = false;
  state.serverStale = false;

  const cached = getCache(state.doc, currentKey());
  state.body = cached ? cached.body : null;

  render();
  onAction(root, boardAction);
  startTimers();
  fetchLive();
}

function currentModel() {
  const trip = findTrip(state.doc, state.selection.tripId);
  const { to } = leg(trip, state.selection.direction);
  const model = boardModel(state.body || {}, now(), {
    forceStale: state.offline,
    degraded: state.serverStale,
    fallbackHeadsign: to.name
  });
  if (!state.body) model.status = state.offline ? 'offline' : 'loading';
  return model;
}

function render() {
  const trip = findTrip(state.doc, state.selection.tripId);
  state.root.innerHTML = Board.boardHtml({
    trip,
    direction: state.selection.direction,
    tripCount: state.doc.trips.length,
    model: currentModel()
  });
}

function onTick() {
  if (!state.onBoard) return;
  const model = currentModel();
  if (Board.sameRowSet(state.root, model)) {
    Board.patch(state.root, model);
    return;
  }
  Board.dissolveDeparted(state.root, model, render);
}

function boardAction(action) {
  if (action === 'edit' || action === 'switch') {
    qualifyView();
    return ctx.go('#/trips');
  }
  if (action === 'reverse') {
    qualifyView();
    state.selection = {
      tripId: state.selection.tripId,
      direction: state.selection.direction === 'reverse' ? 'forward' : 'reverse'
    };
    state.viewRecorded = false;
    state.offline = false;
    state.serverStale = false;
    const cached = getCache(state.doc, currentKey());
    state.body = cached ? cached.body : null;
    render();
    startTimers();
    fetchLive();
  }
}

/* --- data --------------------------------------------------------------- */

async function fetchLive() {
  if (!state.onBoard || document.hidden) return;
  const { from, to } = currentLeg();
  const key = cacheKey(from.id, to.id);
  if (inflight) inflight.abort();
  inflight = new AbortController();
  try {
    const { body, serverStale } = await getDepartures(from.id, to.id, { limit: LIMIT, signal: inflight.signal });
    if (!state.onBoard || key !== currentKey()) return; // the user moved on
    state.body = body;
    state.serverStale = serverStale;
    state.offline = false;
    ctx.update(putCache(state.doc, key, body, now()));
  } catch (e) {
    if (e.name === 'AbortError') return;
    state.offline = true;
  }
  if (state.onBoard) render();
}

/* --- timers ------------------------------------------------------------- */

function startTimers() {
  stopTimers();
  timers.tick = setInterval(onTick, TICK_MS);
  timers.refresh = setInterval(() => { if (!document.hidden) fetchLive(); }, REFRESH_MS);
  timers.view = setTimeout(qualifyView, VIEW_QUALIFIES_MS);
}

function stopTimers() {
  clearInterval(timers.tick); clearInterval(timers.refresh); clearTimeout(timers.view);
  timers.tick = timers.refresh = timers.view = null;
}

/* A view counts once it has been looked at for five seconds or acted on —
   otherwise a mispredicted board the user flips straight off would teach the
   predictor that it guessed right. */
function qualifyView() {
  if (!state.onBoard || state.viewRecorded || !state.selection) return;
  state.viewRecorded = true;
  ctx.update(recordView(state.doc, state.selection.tripId, state.selection.direction, now()));
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopTimers(); return; }
  if (!state.onBoard) return;
  startTimers();
  fetchLive();
});

window.addEventListener('hashchange', route);

/* Handles for the verification harness: pin the clock, force a refresh, or
   read the model without scraping the DOM. */
window.__trains = {
  get state() { return state; },
  get model() { return state.onBoard ? currentModel() : null; },
  set now(fn) { nowFn = fn; },
  get now() { return nowFn; },
  refresh: fetchLive,
  rerender: () => { if (state.onBoard) render(); },
  tick: onTick,
  route
};

route();
