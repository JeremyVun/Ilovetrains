/* App controller. Home is the open state; board and detail are one tap deeper. */

import {
  loadDoc, saveDoc, addTrip, findTrip, leg, cacheKey, putCache, getCache, recordView,
  recordRide, recordHomeVote, recordLastOpen, updateStop, declineLocation, newTripId,
  LOCATION_ASK_QUIET_MS
} from './storage.js';
import { distanceKm, locate, predict } from './predict.js';
import { here, loadStations } from './stations.js';
import { boardModel, promotedRow } from './rowmodel.js';
import { journeyDetail, journeyKey, departureKey, legsOf, arrivalMs, departureMs } from './journey.js';
import {
  focusOf, setFocus, clearFocus, isFocused, focusExpired, matchJourney, refreshFocus,
  directionsModel, inferTravel, arrived, journeyCancelled, TRAVEL_LATE_MS
} from './focus.js';
import * as Board from './board.js';
import { clampJourneyBars } from './journeybar.js';
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
const DISSOLVE_HOLD_MS = 260;

let nowFn = () => Date.now();
const now = () => nowFn();

const state = {
  doc: loadDoc(),
  selection: null,
  body: null,
  pastBodies: [],
  seenLive: new Map(),
  seenKey: null,
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
  stations: null,
  loadedAt: Date.now(),
  leap: null,
  prefill: null,
  previousOpen: null,
  predicted: false,
  geoPermission: null,
  locationDismissed: false,
  offerDismissed: false,
  coordsBackfillStarted: false
};

function onLiveView() {
  return ['home', 'board', 'detail'].includes(state.view);
}

const timers = { tick: null, refresh: null, view: null };
let inflight = null;
let pastInflight = null;
let geoGeneration = 0;
/* A tick may not rewrite a view whose markup is unchanged: the write would
   discard the element a wheel is scrolling and cancel a smooth scroll. */
const painted = { home: null, board: null, detail: null };
let pastRowCount = 0;
let dissolving = null;
let indexRequested = false;
let lastHome = null;

/* The freshness age is the one thing that changes every second, so it is the
   one thing patched outside the comparison. */
function patchFresh(node, text) {
  if (!node) return;
  const last = node.lastChild;
  if (last && last.nodeType === 3) last.textContent = text;
  else node.appendChild(document.createTextNode(text));
}

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
  permission: geoPermissionState,
  fix: takeContextFix,
  async saveTrip(trip, redirect) {
    state.selection = savePair(trip);
    if (!redirect) return ctx.go('#/');
    const match = await redirectJourney(trip, redirect);
    if (!match) return ctx.go('#/board');
    ctx.update(setFocus(state.doc, state.selection, match, now(), 'inferred'));
    ctx.go('#/');
  }
};

/* The pair the header answered with, or the sheet saved, becomes a normal saved
   trip under the ten-trip LRU (client-storage.md, `locate`). */
function savePair(trip) {
  const next = addTrip(state.doc, trip);
  ctx.update(next);
  const saved = next.trips.find((item) => item.from.id === trip.from.id && item.to.id === trip.to.id)
    || next.trips.find((item) => item.from.id === trip.to.id && item.to.id === trip.from.id);
  return { tripId: saved.id, direction: saved.from.id === trip.from.id ? 'forward' : 'reverse' };
}

/* The redirect keeps the rider on the same departure: the journey key survives
   a change of destination because the first leg is the same train. */
async function redirectJourney(trip, redirect) {
  try {
    const { body } = await getDepartures(trip.from.id, trip.to.id, {
      at: redirect.departureMs - 60_000, limit: LIMIT
    });
    return (body.journeys || []).find((item) => departureKey(item) === redirect.journeyKey) || null;
  } catch (_) {
    return null;
  }
}

function route() {
  geoGeneration += 1;
  stopTimers();
  if (inflight) inflight.abort();
  if (pastInflight) pastInflight.abort();
  const hash = location.hash || '#/';
  const root = freshRoot();
  state.view = null;
  painted.home = painted.board = painted.detail = null;
  pastRowCount = 0;
  dissolving = null;
  lastHome = null;

  if (hash === '#/setup' || hash === '#/trips/new') return openSetup(root);
  if (!state.doc.trips.length) {
    if (location.hash !== '#/setup') location.hash = '#/setup';
    else openSetup(root);
    return;
  }
  if (hash === '#/journey') return showDetail(root);
  if (hash === '#/board') return showBoard(root);
  showHome(root);
}

function openSetup(root) {
  const prefill = state.prefill || {};
  state.prefill = null;
  return renderSetup(root, ctx, prefill);
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

function focusSelection() {
  const focus = focusOf(state.doc);
  return focus && !focusExpired(focus, now()) && findTrip(state.doc, focus.tripId)
    ? { tripId: focus.tripId, direction: focus.direction } : null;
}

function savedSelection() {
  return state.selection && findTrip(state.doc, state.selection.tripId) ? state.selection : null;
}

/* Home leads with the focused journey; the board answers the tap that opened
   it (client-storage.md, Trip selection). */
function chooseSelection() {
  const chosen = focusSelection() || savedSelection();
  state.predicted = !chosen;
  if (chosen) { state.leap = null; return chosen; }
  return locateSelection();
}

/* `locate` may answer with a pair no saved trip covers, which is saved on the
   spot, or with nothing saved at all, which leaves home for the sheet. */
function locateSelection() {
  const answer = locate(state.doc, now(), { fix: validFix(), stations: state.stations });
  state.leap = answer.leap || null;
  if (answer.kind === 'trip') return { tripId: answer.tripId, direction: answer.direction };
  if (answer.kind === 'pair') {
    return savePair({
      id: newTripId(), from: answer.from, to: answer.to, createdAt: new Date().toISOString()
    });
  }
  state.prefill = answer.from ? { origin: answer.from } : null;
  ctx.go('#/trips/new');
  return null;
}

function explicitSelection() {
  return savedSelection() || focusSelection() || predict(state.doc, now(), { fix: validFix() });
}

function validFix() {
  return fixIsValid(state.fix) ? state.fix : null;
}

function loadSelectedCache() {
  const cached = getCache(state.doc, currentKey());
  state.body = cached ? cached.body : null;
  state.serverStale = false;
  state.offline = false;
}

function showHome(root) {
  state.view = 'home';
  state.fix = null;
  state.previousOpen = state.doc.lastOpen || null;
  state.selection = chooseSelection();
  if (!state.selection) return;
  loadSelectedCache();
  renderHome();
  onAction(root, homeAction);
  startTimers(false);
  noteLastOpen();
  fetchLive();
  backfillCoordinates();
  loadIndex();
  silentFix();
}

/* The index arrives after the first paint, so a fix taken without it gets its
   second chance here rather than waiting for the next open. */
function loadIndex() {
  if (indexRequested) return;
  indexRequested = true;
  loadStations().then(indexReady);
}

function indexReady(list) {
  if (!list) return;
  state.stations = list;
  if (state.view === 'home' && validFix()) useFix();
}

/* The record the next open infers travel from. Written where writes happen —
   the cache paint and each successful refresh — and never from a render
   (client-storage.md, Travel mode). */
function noteLastOpen() {
  if (state.view !== 'home' || focusSelection() || !state.selection) return;
  const journeys = (state.body && state.body.journeys) || [];
  const journey = journeys.find((item) => !journeyCancelled(item));
  if (!journey) return;
  const spot = here(state.doc, state.stations, validFix());
  ctx.update(recordLastOpen(state.doc, {
    station: spot && spot.tier === 1 ? spot.station : null,
    tripId: state.selection.tripId,
    direction: state.selection.direction,
    journey
  }, now()));
}

/* An already-granted permission is not a prompt: home may use the fix it can
   have without asking for one on open (ui.md, smart home). */
async function silentFix() {
  const generation = ++geoGeneration;
  const permission = await geoPermissionState();
  if (generation !== geoGeneration || state.view !== 'home') return;
  state.geoPermission = permission;
  if (state.geoPermission !== 'granted') {
    renderHome();
    return;
  }
  const fix = await takeFix({ enableHighAccuracy: underWay(), maximumAge: 0 });
  if (generation !== geoGeneration || state.view !== 'home' || !fix) return;
  state.fix = fix;
  useFix();
}

/* High accuracy costs battery, so it is spent only where the speed reading can
   decide travel mode (client-storage.md, Travel mode). */
function underWay() {
  const journey = (state.previousOpen || {}).journey;
  const departure = departureMs(journey);
  const arrival = arrivalMs(journey);
  if (departure === null || arrival === null) return false;
  return now() >= departure && now() <= arrival + TRAVEL_LATE_MS;
}

/* The one place a coordinate lands: state.fix, never storage and never a
   request. Resolves to the fix, or null when the browser will not give one. */
function takeFix(options = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((position) => {
      const fix = fixOf(position);
      resolve(fixIsValid(fix) ? fix : null);
    }, () => resolve(null), {
      enableHighAccuracy: false, timeout: 8000, maximumAge: FIX_MAX_AGE_MS, ...options
    });
  });
}

async function takeContextFix(options = {}) {
  const generation = ++geoGeneration;
  const fix = await takeFix(options);
  if (generation !== geoGeneration || !fix) return null;
  state.fix = fix;
  return fix;
}

function fixIsValid(fix) {
  return Boolean(fix && Number.isFinite(fix.at) && now() - fix.at <= FIX_MAX_AGE_MS);
}

function fixOf(position) {
  const speed = position.coords.speed;
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    speed: Number.isFinite(speed) ? speed : undefined,
    at: position.timestamp || Date.now()
  };
}

async function geoPermissionState() {
  if (!navigator.geolocation) return 'unavailable';
  if (!navigator.permissions) return 'prompt';
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch (_) {
    return 'prompt';
  }
}

/* Asking is a favour, not a habit: a decline is persisted for 30 days, an
   answered permission needs no panel at all, and the panel waits until the
   permission state is known rather than flashing for a tick (client-storage.md). */
function shouldAskLocation() {
  if (state.doc.trips.length < 2 || state.fix || state.locationDismissed) return false;
  if (state.geoPermission !== 'prompt') return false;
  const declined = Date.parse((state.doc.locationAsk || {}).declinedAt || '');
  return !Number.isFinite(declined) || now() - declined >= LOCATION_ASK_QUIET_MS;
}

/* What a fix answers: where the day starts, whether the rider is already on a
   train, and — a guess being re-answerable where a tap is not — which trip. */
function useFix() {
  if (state.view !== 'home') return;
  const fix = validFix();
  if (!fix) return;
  const spot = here(state.doc, state.stations, fix);
  if (spot) {
    const voted = recordHomeVote(state.doc, spot.station, now());
    if (voted !== state.doc) ctx.update(voted);
  }
  // Against the record as it stood when this open began: the cache paint has
  // already overwritten lastOpen with this open's own header.
  const entered = focusSelection() || rideRecorded(state.doc, state.previousOpen) ? null
    : inferTravel({ ...state.doc, lastOpen: state.previousOpen }, now(), fix);
  if (entered) {
    ctx.update(setFocus(state.doc, entered, entered.journey, now(), 'inferred'));
    state.predicted = false;
    state.leap = null;
    state.selection = { tripId: entered.tripId, direction: entered.direction };
  } else if (state.predicted) {
    const answer = locateSelection();
    if (!answer) return;
    state.selection = answer;
  }
  const completed = recordCompletedFocus(state.doc);
  if (completed !== state.doc) ctx.update(completed);
  loadSelectedCache();
  renderHome();
  fetchLive();
}

function currentModel() {
  const ends = currentLeg();
  // The train you just missed is in neither register until the last live copy
  // of it is offered back as a past page (design.md, defect 3).
  const pastBodies = state.view === 'board'
    ? [...state.pastBodies, { journeys: [...state.seenLive.values()] }]
    : state.pastBodies;
  const model = boardModel(state.body || {}, now(), {
    forceStale: state.offline,
    degraded: state.serverStale,
    fallbackHeadsign: ends.to.name,
    pastBodies
  });
  if (!state.body) model.status = state.offline ? 'offline' : 'loading';
  return model;
}

function renderHome() {
  if (state.view !== 'home') return;
  const model = currentModel();
  const askLocation = shouldAskLocation();
  const home = Home.homeModel(state.doc, state.selection, state.body, now(), {
    fix: validFix(),
    stale: model.stale,
    offline: state.offline,
    askLocation,
    predicted: state.predicted,
    leap: state.leap,
    loadedAt: state.loadedAt,
    arrived: arrivedNow(),
    leave: leaveDistance()
  });
  lastHome = home;
  if (state.offerDismissed) home.over = false;
  const freshness = home.freshness;
  home.freshness = '';
  const html = Home.homeHtml(home);
  if (html !== painted.home) {
    const list = state.root.querySelector('[data-t="trip-list"]');
    const scrollTop = list ? list.scrollTop : 0;
    state.root.innerHTML = html;
    painted.home = html;
    const nextList = state.root.querySelector('[data-t="trip-list"]');
    if (nextList) nextList.scrollTop = scrollTop;
    Home.finishHomeRender(state.root);
  }
  patchFresh(state.root.querySelector('.hm-fresh .lbl'), freshness);
}

/* The rider stepping off the train ends the trip before the timetable does
   (client-storage.md, Travel mode). */
function arrivedNow(doc = state.doc) {
  const focus = focusOf(doc);
  const trip = focus && !focusExpired(focus, now()) && findTrip(doc, focus.tripId);
  if (!trip) return false;
  if (rideRecorded(doc, focus)) return true;
  return arrived(focus, leg(trip, focus.direction).to, validFix(), now());
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
  state.selection = explicitSelection();
  state.viewRecorded = false;
  state.pastBodies = [];
  state.seenLive = new Map();
  state.seenKey = currentKey();
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

function renderBoard({ addedAbove = false, fade = true } = {}) {
  if (state.view !== 'board') return;
  const model = currentModel();
  const html = Board.boardHtml({
    trip: selectedTrip(),
    direction: state.selection.direction,
    model,
    nowMs: now(),
    freshness: ''
  });
  if (html !== painted.board && !(fade && beginDissolve(html, model, addedAbove))) {
    const saved = Board.preserveTimeline(state.root);
    // A service that has just left is redrawn above the anchor, so the timeline
    // has to close upward around it rather than push the whole board down.
    const grewAbove = model.pastRows.length > pastRowCount;
    state.root.innerHTML = html;
    painted.board = html;
    pastRowCount = model.pastRows.length;
    if (state.initialBoardLanding) {
      Board.landAtNow(state.root);
      state.initialBoardLanding = false;
    } else {
      Board.restoreTimeline(state.root, saved, addedAbove || grewAbove);
    }
    wireTimeline();
  }
  patchFresh(state.root.querySelector('.sy-fresh .lbl'), Board.freshnessText(model));
}

/* True while a departing row is fading and the rebuild is deferred. One fade is
   in flight at a time; anything else that changes meanwhile rebuilds at once. */
function beginDissolve(html, model, addedAbove) {
  if (dissolving) {
    if (html === dissolving.html) return true;
    clearTimeout(dissolving.timer);
    dissolving = null;
    return false;
  }
  if (painted.board === null || state.initialBoardLanding) return false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const kept = new Set(model.futureRows.map((row) => row.key));
  const leaving = Board.markDeparting(state.root, kept);
  if (!leaving.length) return false;
  const pending = { html };
  const finish = () => {
    if (dissolving !== pending) return;
    clearTimeout(pending.timer);
    dissolving = null;
    renderBoard({ addedAbove, fade: false });
  };
  pending.timer = setTimeout(finish, DISSOLVE_HOLD_MS);
  leaving[0].addEventListener('transitionend', (ev) => {
    if (ev.target === leaving[0] && ev.propertyName === 'opacity') finish();
  });
  dissolving = pending;
  return true;
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
  if (action === 'new-trip') return ctx.go('#/trips/new');
  if (action === 'open-trip') {
    state.selection = { tripId: element.dataset.id, direction: element.dataset.direction || 'forward' };
    state.offerDismissed = false;
    return ctx.go('#/board');
  }
  if (action === 'way-back') {
    state.doc = clearFocus(recordCompletedFocus(state.doc));
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
  if (action === 'change-destination') {
    const strip = lastHome && lastHome.strip;
    if (!strip) return;
    state.prefill = {
      origin: strip.origin,
      redirect: {
        journeyKey: strip.journeyKey,
        departureMs: strip.departureMs,
        from: strip.origin,
        to: strip.destination
      }
    };
    return ctx.go('#/trips/new');
  }
  if (action === 'skip-location') {
    state.locationDismissed = true;
    ctx.update(declineLocation(state.doc, now()));
    renderHome();
    return;
  }
  if (action === 'use-location') return requestLocation();
}

async function requestLocation() {
  state.locationDismissed = true;
  const generation = ++geoGeneration;
  const fix = await takeFix({ maximumAge: 0 });
  if (generation !== geoGeneration || state.view !== 'home') return;
  if (fix) {
    state.fix = fix;
    useFix();
  } else renderHome();
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
  const board = currentModel();
  const opts = { stale: board.stale, fromName: ends.from.name, toName: ends.to.name };
  const model = journeyDetail(state.journey, now(), opts);
  return {
    ...model,
    row: detailRow(model, opts),
    focused: isFocused(state.doc, state.journey),
    footer: board.footer
  };
}

/* Once the journey has left, its promoted row counts to the next thing the
   rider does, not to a departure that has already happened: the figure and
   provenance become the smart header's (ui.md, journey detail). */
function detailRow(model, opts) {
  const row = promotedRow(state.journey, now(), { ...opts, fallbackHeadsign: opts.toName });
  // A cancelled journey keeps the board's dash and its CANCELLED word.
  if (!model.departed || model.cancelled) return row;
  const directions = directionsModel(state.journey, now(), opts);
  return {
    ...row,
    figure: directions.figure,
    provenance: directions.provenance,
    wide: directions.figure.length >= 3
  };
}

function renderDetail() {
  const model = detailModel();
  if (!model) { location.hash = '#/'; return; }
  const freshness = model.footer.text;
  model.footer = { ...model.footer, text: '' };
  const html = Detail.detailHtml(model);
  if (html !== painted.detail) {
    state.root.innerHTML = html;
    painted.detail = html;
    clampJourneyBars(state.root);
  }
  patchFresh(state.root.querySelector('[data-t="footer"]'), freshness);
}

function detailAction(action) {
  if (action === 'board') return ctx.go('#/board');
  if (action === 'focus') {
    ctx.update(setFocus(state.doc, state.selection, state.journey, now()));
    return ctx.go('#/');
  }
}

async function fetchLive() {
  if (!onLiveView() || document.hidden) return;
  const ends = currentLeg();
  const key = currentKey();
  if (inflight) inflight.abort();
  inflight = new AbortController();
  try {
    const { body, serverStale } = await getDepartures(ends.from.id, ends.to.id, {
      limit: LIMIT,
      signal: inflight.signal
    });
    if (!onLiveView() || key !== currentKey()) return;
    if (state.seenKey !== key) { state.seenLive = new Map(); state.seenKey = key; }
    for (const journey of body.journeys || []) state.seenLive.set(journeyKey(journey), journey);
    state.body = body;
    state.serverStale = serverStale;
    state.offline = false;
    let doc = putCache(state.doc, key, body, now());
    doc = recordCompletedFocus(doc);
    doc = refreshFocus(doc, state.selection, body, now());
    ctx.update(doc);
    noteLastOpen();
    if (state.journey) state.journey = matchJourney(body.journeys, state.journey) || state.journey;
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.offline = true;
  }
  renderCurrent();
}

function recordCompletedFocus(doc) {
  const focus = focusOf(doc);
  if (!focus || arrivalMs(focus.journey) === null) return doc;
  if (now() < arrivalMs(focus.journey) && !arrivedNow(doc)) return doc;
  const trip = findTrip(doc, focus.tripId);
  if (!trip) return doc;
  const ends = leg(trip, focus.direction);
  return recordRide(doc, { tripId: focus.tripId, direction: focus.direction },
    focus.journey, ends.from, ends.to);
}

function rideRecorded(doc, selection) {
  if (!selection || !selection.journey) return false;
  const first = legsOf(selection.journey)[0] || {};
  const departure = (first.departure || {}).scheduled
    || ((selection.journey.departure || {}).scheduled);
  if (!departure) return false;
  return (doc.rides || []).some((ride) => ride.tripId === selection.tripId
    && ride.direction === selection.direction
    && (ride.scheduledDeparture || ride.departedAt) === departure);
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
  if (!onLiveView()) return;
  if (state.view === 'home') {
    state.fix = null;
    state.previousOpen = state.doc.lastOpen || null;
  }
  startTimers(state.view === 'board');
  fetchLive();
  if (state.view !== 'home') return;
  silentFix();
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
  onLiveView,
  tick: renderCurrent,
  indexReady,
  route
};

route();
