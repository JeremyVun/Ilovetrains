/* App controller. Home is the open state; board and detail are one tap deeper. */

import {
  loadDoc, saveDoc, addTrip, findTrip, leg, cacheKey, putCache, getCache, recordView,
  recordRide, updateStop, setHome
} from './storage.js';
import { distanceKm, predict } from './predict.js';
import { boardModel } from './rowmodel.js';
import { journeyDetail, journeyKey, arrivalMs, departureMs } from './journey.js';
import {
  focusOf, setFocus, clearFocus, isFocused, focusExpired, matchJourney, refreshFocus
} from './focus.js';
import * as Board from './board.js';
import * as Detail from './detail.js';
import * as Home from './home.js';
import { renderSetup } from './setup.js';
import { getDepartures, getStops } from './api.js';
import { onAction } from './dom.js';

const REFRESH_MS = 30_000;
const TICK_MS = 1_000;
const VIEW_QUALIFIES_MS = 5_000;
const LIMIT = 6;
const PAST_STEP_MS = 60 * 60_000;
const PAST_BOUND_MS = 24 * 60 * 60_000;
const FIX_MAX_AGE_MS = 5 * 60_000;

let nowFn = () => Date.now();
const now = () => nowFn();

const state = {
  doc: loadDoc(),
  selection: null,
  body: null,
  pastBodies: [],
  serverStale: false,
  offline: false,
  viewRecorded: false,
  root: null,
  view: null,
  journey: null,
  initialBoardLanding: true,
  loadingPast: false,
  pastExhausted: false,
  fix: null,
  locationDismissed: false,
  offerDismissed: false,
  coordsBackfillStarted: false
};
Object.defineProperty(state, 'onBoard', {
  get() { return ['home', 'board', 'detail'].includes(state.view); }
});

const timers = { tick: null, refresh: null, view: null };
let inflight = null;
let pastInflight = null;

function freshRoot() {
  const old = document.getElementById('app');
  const element = document.createElement('div');
  element.id = 'app';
  old.replaceWith(element);
  state.root = element;
  return element;
}

const ctx = {
  get doc() { return state.doc; },
  get selection() { return state.selection; },
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  update(doc) { state.doc = doc; saveDoc(doc); },
  saveTrip(trip) {
    const next = addTrip(state.doc, trip);
    ctx.update(next);
    const saved = next.trips.find((item) => item.from.id === trip.from.id && item.to.id === trip.to.id)
      || next.trips.find((item) => item.from.id === trip.to.id && item.to.id === trip.from.id);
    state.selection = { tripId: saved.id, direction: saved.from.id === trip.from.id ? 'forward' : 'reverse' };
    ctx.go('#/');
  }
};

function route() {
  stopTimers();
  if (inflight) inflight.abort();
  if (pastInflight) pastInflight.abort();
  const hash = location.hash || '#/';
  const root = freshRoot();
  state.view = null;

  if (hash === '#/setup' || hash === '#/trips/new') return renderSetup(root, ctx);
  if (!state.doc.trips.length) {
    if (location.hash !== '#/setup') location.hash = '#/setup';
    else renderSetup(root, ctx);
    return;
  }
  if (hash === '#/journey') return showDetail(root);
  if (hash === '#/board') return showBoard(root);
  showHome(root);
}

function selectedTrip() {
  return state.selection && findTrip(state.doc, state.selection.tripId);
}

function currentLeg() {
  return leg(selectedTrip(), state.selection.direction);
}

function currentKey() {
  const ends = currentLeg();
  return cacheKey(ends.from.id, ends.to.id);
}

function chooseSelection() {
  const focus = focusOf(state.doc);
  if (focus && !focusExpired(focus, now()) && findTrip(state.doc, focus.tripId)) {
    return { tripId: focus.tripId, direction: focus.direction };
  }
  if (state.selection && findTrip(state.doc, state.selection.tripId)) return state.selection;
  return predict(state.doc, now(), { fix: validFix() });
}

function validFix() {
  if (!state.fix || !Number.isFinite(state.fix.at) || now() - state.fix.at > FIX_MAX_AGE_MS) return null;
  return state.fix;
}

function loadSelectedCache() {
  const cached = getCache(state.doc, currentKey());
  state.body = cached ? cached.body : null;
  state.serverStale = false;
  state.offline = false;
}

function showHome(root) {
  state.view = 'home';
  state.selection = chooseSelection();
  loadSelectedCache();
  renderHome();
  onAction(root, homeAction);
  startTimers(false);
  fetchLive();
  backfillCoordinates();
}

function currentModel() {
  const ends = currentLeg();
  const model = boardModel(state.body || {}, now(), {
    forceStale: state.offline,
    degraded: state.serverStale,
    fallbackHeadsign: ends.to.name,
    pastBodies: state.pastBodies
  });
  if (!state.body) model.status = state.offline ? 'offline' : 'loading';
  return model;
}

function renderHome() {
  if (state.view !== 'home') return;
  const model = currentModel();
  const askLocation = state.doc.trips.length >= 2 && !state.fix && !state.locationDismissed;
  const home = Home.homeModel(state.doc, state.selection, state.body, now(), {
    fix: validFix(),
    stale: model.stale,
    offline: state.offline,
    askLocation,
    leave: leaveDistance()
  });
  if (state.offerDismissed) {
    home.over = false;
    home.home.moved = null;
  }
  const list = state.root.querySelector('[data-t="trip-list"]');
  const scrollTop = list ? list.scrollTop : 0;
  state.root.innerHTML = Home.homeHtml(home);
  const nextList = state.root.querySelector('[data-t="trip-list"]');
  if (nextList) nextList.scrollTop = scrollTop;
  Home.finishHomeRender(state.root);
}

function leaveDistance() {
  const fix = validFix();
  if (!fix || !selectedTrip()) return '';
  const origin = currentLeg().from;
  const distanceKmFromOrigin = distanceKm(fix, origin.location);
  const focus = focusOf(state.doc);
  const journey = focus && focus.tripId === state.selection.tripId
    && focus.direction === state.selection.direction ? focus.journey
    : state.body && (state.body.journeys || []).find((item) => !item.cancelled);
  const departure = departureMs(journey);
  if (!Number.isFinite(distanceKmFromOrigin) || departure === null || departure <= now()) return '';
  // A conservative five-kilometre-per-hour walk plus three minutes to reach
  // the platform. Location is a prompt to act only when leaving is actually
  // due; it must not turn every future service into “Leave now”.
  const walkMs = (distanceKmFromOrigin / 5 * 60 + 3) * 60_000;
  if (departure - now() > walkMs) return '';
  const distance = Home.formatDistance(distanceKmFromOrigin);
  return distance ? distance.replace(/ away$/, '') : '';
}

function showBoard(root) {
  state.view = 'board';
  state.selection = chooseSelection();
  state.viewRecorded = false;
  state.pastBodies = [];
  state.pastExhausted = false;
  state.initialBoardLanding = true;
  loadSelectedCache();
  renderBoard();
  onAction(root, boardAction);
  wireTimeline();
  startTimers(true);
  fetchLive();
  fetchPast(true);
}

function renderBoard({ addedAbove = false } = {}) {
  if (state.view !== 'board') return;
  const saved = Board.preserveTimeline(state.root);
  state.root.innerHTML = Board.boardHtml({
    trip: selectedTrip(),
    direction: state.selection.direction,
    model: currentModel(),
    nowMs: now()
  });
  if (state.initialBoardLanding) {
    Board.landAtNow(state.root);
    state.initialBoardLanding = false;
  } else {
    Board.restoreTimeline(state.root, saved, addedAbove);
  }
  wireTimeline();
}

function wireTimeline() {
  const timeline = state.root.querySelector('[data-t="timeline"]');
  if (!timeline || timeline.dataset.wired) return;
  timeline.dataset.wired = '1';
  timeline.addEventListener('scroll', () => {
    if (timeline.scrollTop < 80) fetchPast(false);
  }, { passive: true });
}

function homeAction(action, element) {
  if (action === 'board') return ctx.go('#/board');
  if (action === 'trip-list') {
    state.root.querySelector('[data-t="trip-list"]')?.scrollTo({ top: 0, behavior: 'smooth' });
    state.root.querySelector('.tripr')?.focus();
    return;
  }
  if (action === 'new-trip') return ctx.go('#/trips/new');
  if (action === 'select-trip') {
    state.selection = { tripId: element.dataset.id, direction: element.dataset.direction || 'forward' };
    state.offerDismissed = false;
    loadSelectedCache();
    renderHome();
    fetchLive();
    return;
  }
  if (action === 'way-back') {
    state.doc = clearFocus(state.doc);
    state.selection = {
      tripId: state.selection.tripId,
      direction: state.selection.direction === 'reverse' ? 'forward' : 'reverse'
    };
    ctx.update(state.doc);
    state.offerDismissed = false;
    loadSelectedCache();
    renderHome();
    fetchLive();
    return;
  }
  if (action === 'dismiss-offer') {
    state.offerDismissed = true;
    renderHome();
    return;
  }
  if (action === 'skip-location') {
    state.locationDismissed = true;
    renderHome();
    return;
  }
  if (action === 'use-location') return requestLocation();
  if (action === 'accept-home') {
    const station = state.doc.trips.flatMap((trip) => [trip.from, trip.to])
      .find((stop) => stop.id === element.dataset.id);
    if (station) ctx.update(setHome(state.doc, station, 3, now()));
    state.offerDismissed = true;
    renderHome();
  }
}

function requestLocation() {
  state.locationDismissed = true;
  if (!navigator.geolocation) { renderHome(); return; }
  navigator.geolocation.getCurrentPosition((position) => {
    state.fix = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      at: position.timestamp || Date.now()
    };
    state.selection = predict(state.doc, now(), { fix: validFix() });
    loadSelectedCache();
    renderHome();
    fetchLive();
  }, () => renderHome(), {
    enableHighAccuracy: false,
    timeout: 8000,
    maximumAge: 5 * 60_000
  });
}

function boardAction(action, element) {
  if (action === 'home') {
    qualifyView();
    return ctx.go('#/');
  }
  if (action !== 'detail') return;
  qualifyView();
  const journeys = [
    ...((state.body && state.body.journeys) || []),
    ...state.pastBodies.flatMap((page) => page.journeys || [])
  ];
  const journey = journeys.find((item) => journeyKey(item) === element.dataset.match);
  if (journey) {
    state.journey = journey;
    ctx.go('#/journey');
  }
}

function showDetail(root) {
  const focus = focusOf(state.doc);
  if (!state.journey && focus && !focusExpired(focus, now())) {
    state.journey = focus.journey;
    state.selection = { tripId: focus.tripId, direction: focus.direction };
  }
  if (!state.journey || !state.selection || !selectedTrip()) {
    location.hash = '#/';
    return;
  }
  state.view = 'detail';
  loadSelectedCache();
  renderDetail();
  onAction(root, detailAction);
  startTimers(false);
  fetchLive();
}

function detailModel() {
  if (!state.journey) return null;
  const ends = currentLeg();
  const model = currentModel();
  return {
    ...journeyDetail(state.journey, now(), {
      stale: model.stale,
      fromName: ends.from.name,
      toName: ends.to.name
    }),
    footer: model.footer,
    boardStale: model.stale
  };
}

function renderDetail() {
  const model = detailModel();
  if (!model) { location.hash = '#/'; return; }
  state.root.innerHTML = Detail.detailHtml({
    model,
    focused: isFocused(state.doc, state.journey)
  }) + footerHtml(model);
}

function footerHtml(model) {
  return `<div class="ftr${model.stale ? ' offline' : ''}"><span class="pulse ${model.footer.dot}"></span>${model.footer.text}</div>`;
}

function detailAction(action) {
  if (action === 'board') return ctx.go('#/board');
  if (action === 'focus') {
    ctx.update(setFocus(state.doc, state.selection, state.journey, now()));
    return ctx.go('#/');
  }
  if (action === 'unfocus') {
    ctx.update(clearFocus(state.doc));
    return ctx.go('#/');
  }
}

async function fetchLive() {
  if (!['home', 'board', 'detail'].includes(state.view) || document.hidden) return;
  const ends = currentLeg();
  const key = currentKey();
  if (inflight) inflight.abort();
  inflight = new AbortController();
  try {
    const { body, serverStale } = await getDepartures(ends.from.id, ends.to.id, {
      limit: LIMIT,
      signal: inflight.signal
    });
    if (!['home', 'board', 'detail'].includes(state.view) || key !== currentKey()) return;
    state.body = body;
    state.serverStale = serverStale;
    state.offline = false;
    let doc = putCache(state.doc, key, body, now());
    doc = recordCompletedFocus(doc);
    doc = refreshFocus(doc, state.selection, body, now());
    ctx.update(doc);
    if (state.journey) state.journey = matchJourney(body.journeys, state.journey) || state.journey;
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.offline = true;
  }
  renderCurrent();
}

function recordCompletedFocus(doc) {
  const focus = focusOf(doc);
  if (!focus || arrivalMs(focus.journey) === null || now() < arrivalMs(focus.journey)) return doc;
  const trip = findTrip(doc, focus.tripId);
  if (!trip) return doc;
  const ends = leg(trip, focus.direction);
  let next = recordRide(doc, { tripId: focus.tripId, direction: focus.direction },
    focus.journey, ends.from, ends.to);
  if (!next.home) {
    const inferred = Home.inferHome(next, now()).inferred;
    if (inferred) next = setHome(next, inferred.station, inferred.confidence, now());
  }
  return next;
}

async function fetchPast(initial) {
  if (state.view !== 'board' || state.loadingPast || state.pastExhausted) return;
  state.loadingPast = true;
  const ends = currentLeg();
  const key = currentKey();
  const all = state.pastBodies.flatMap((page) => page.journeys || []);
  const earliest = all.map((journey) => Date.parse((journey.departure || {}).scheduled))
    .filter(Number.isFinite).sort((a, b) => a - b)[0];
  const at = initial || !Number.isFinite(earliest) ? now() - PAST_STEP_MS : earliest - PAST_STEP_MS;
  if (now() - at > PAST_BOUND_MS) {
    state.pastExhausted = true;
    state.loadingPast = false;
    return;
  }
  pastInflight = new AbortController();
  try {
    const { body } = await getDepartures(ends.from.id, ends.to.id, {
      limit: LIMIT,
      at,
      signal: pastInflight.signal
    });
    if (state.view !== 'board' || key !== currentKey()) return;
    const before = new Set(state.pastBodies.flatMap((page) => page.journeys || []).map(journeyKey));
    const gained = (body.journeys || []).some((journey) => !before.has(journeyKey(journey)));
    if (!gained) state.pastExhausted = true;
    else state.pastBodies.unshift(body);
    if (initial) state.initialBoardLanding = true;
    renderBoard({ addedAbove: !initial });
  } catch (error) {
    // A transient page failure is not evidence that history has ended. The
    // next near-top scroll may retry it; only an empty/deduplicated answer or
    // the explicit 24-hour bound exhausts pagination.
  } finally {
    state.loadingPast = false;
  }
}

function renderCurrent() {
  if (state.view === 'home') renderHome();
  else if (state.view === 'board') renderBoard();
  else if (state.view === 'detail') renderDetail();
}

function startTimers(recordBoardView) {
  stopTimers();
  timers.tick = setInterval(renderCurrent, TICK_MS);
  timers.refresh = setInterval(() => { if (!document.hidden) fetchLive(); }, REFRESH_MS);
  if (recordBoardView) timers.view = setTimeout(qualifyView, VIEW_QUALIFIES_MS);
}

function stopTimers() {
  clearInterval(timers.tick);
  clearInterval(timers.refresh);
  clearTimeout(timers.view);
  timers.tick = timers.refresh = timers.view = null;
}

function qualifyView() {
  if (state.view !== 'board' || state.viewRecorded || !state.selection) return;
  state.viewRecorded = true;
  ctx.update(recordView(state.doc, state.selection.tripId, state.selection.direction, now()));
}

async function backfillCoordinates() {
  if (state.coordsBackfillStarted) return;
  const missing = state.doc.trips.flatMap((trip) => [trip.from, trip.to])
    .filter((stop) => !stop.location);
  const unique = [...new Map(missing.map((stop) => [stop.id, stop])).values()];
  if (!unique.length) return;
  state.coordsBackfillStarted = true;
  for (const stop of unique) {
    try {
      const results = await getStops(stop.name);
      const match = results.find((candidate) => candidate.id === stop.id && candidate.location);
      if (match) ctx.update(updateStop(state.doc, match));
    } catch (_) {
      // Station coordinates are an optional prediction term; time/history
      // continues to work when the backfill endpoint is unavailable.
    }
  }
  if (state.view === 'home') renderHome();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopTimers(); return; }
  if (!['home', 'board', 'detail'].includes(state.view)) return;
  startTimers(state.view === 'board');
  fetchLive();
});
window.addEventListener('hashchange', route);

window.__trains = {
  get state() { return state; },
  get model() { return selectedTrip() ? currentModel() : null; },
  set now(fn) { nowFn = fn; },
  get now() { return nowFn; },
  refresh: fetchLive,
  older: () => fetchPast(false),
  rerender: renderCurrent,
  tick: renderCurrent,
  route
};

route();
