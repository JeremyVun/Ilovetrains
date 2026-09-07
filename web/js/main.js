/* App controller. Home is the open state; board and detail are one tap deeper. */

import {
  loadDoc, saveDoc, addTrip, findTrip, leg, cacheKey, putCache, getCache, recordView,
  recordRide, recordHomeVote, recordLastOpen, updateStop, declineLocation, newTripId,
  recordOpen, milestone, LOCATION_ASK_QUIET_MS
} from './storage.js';
import { distanceKm, homeOf, locate, predict } from './predict.js';
import { here, loadStations } from './stations.js';
import { boardModel, promotedRow } from './rowmodel.js';
import { journeyDetail, journeyKey, departureKey, legsOf, arrivalMs, departureMs } from './journey.js';
import {
  focusOf, visibleFocus, setFocus, clearFocus, isFocused, focusExpired, matchJourney, refreshFocus,
  directionsModel, inferTravel, arrived, journeyCancelled, TRAVEL_LATE_MS
} from './focus.js';
import * as Board from './board.js';
import { clampJourneyBars } from './journeybar.js';
import * as Detail from './detail.js';
import * as Home from './home.js';
import { tinyTrainPreview, fetchTinyTrain } from './feature-flags.js';
import { attachTinyTrain } from './tiny-train.js';
import { renderSetup } from './setup.js';
import { getDepartures, getFlags, getStops } from './api.js';
import { onAction } from './dom.js';
import { renderSettings } from './settings.js';
import {
  tripAllowed, tripsForModes, stationAllowed, SUPPORTED_MODES,
  preferencesOf, setPreferences, setFlags, effectiveCap, journeyAllowed, filterBody
} from './preferences.js';
import {
  createAnalytics, install as installAnalytics, isEnabled, variant, EXPERIMENTS
} from './analytics.js';

const REFRESH_MS = 30_000;
const TICK_MS = 1_000;
const VIEW_QUALIFIES_MS = 5_000;
const LIMIT = 6;
const CAPPED_CHANGES = 2;
const PAST_STEP_MS = 60 * 60_000;
const PAST_BOUND_MS = 24 * 60 * 60_000;
const FIX_MAX_AGE_MS = 5 * 60_000;
const DISSOLVE_HOLD_MS = 260;

let nowFn = () => Date.now();
const now = () => nowFn();

function localStore() {
  try { return window.localStorage; } catch (_) { return null; }
}

const storage = localStore();
const documentStore = storage || { getItem: () => null, setItem: () => {} };
const trainPreview = tinyTrainPreview(location.hostname, location.search, storage);
let tinyTrain = trainPreview ?? false;
let flagsRequest = null;
let trainLine = null;
let removeTrain = null;

function clearTrain() {
  removeTrain?.();
  removeTrain = null;
  trainLine = null;
}

async function refreshFeatureFlags() {
  if (trainPreview !== null || flagsRequest || document.hidden) return;
  const request = new AbortController();
  flagsRequest = request;
  const timeout = setTimeout(() => request.abort(), 3000);
  const enabled = await fetchTinyTrain(fetch, request.signal);
  clearTimeout(timeout);
  if (flagsRequest !== request) return;
  flagsRequest = null;
  if (enabled === tinyTrain) return;
  tinyTrain = enabled;
  if (!enabled) clearTrain();
  if (state.view === 'home') {
    painted.home = null;
    renderHome();
  }
}

const state = {
  doc: loadDoc(documentStore),
  selection: null,
  body: null,
  focusBody: null,
  focusIdentity: null,
  focusOffline: false,
  focusServerStale: false,
  pastBodies: [],
  seenLive: new Map(),
  seenKey: null,
  serverStale: false,
  offline: false,
  viewRecorded: false,
  root: null,
  view: null,
  journey: null,
  detailHandoff: null,
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
  coordsBackfillStarted: false,
  headerKind: null,
  headerTripId: null,
  headerDirection: null,
  lastShown: null,
  lastShownKind: null,
  tapped: false,
  opened: false,
  askedPanel: false,
  setupSaved: false
};

const analyticsEnabled = isEnabled({
  hostname: location.hostname,
  dnt: navigator.doNotTrack,
  storage
}) && Boolean(globalThis.crypto && crypto.getRandomValues);
const forcedVariants = new Map();
const analytics = createAnalytics({
  enabled: analyticsEnabled,
  storage,
  fetchFn: (...args) => fetch(...args),
  schedule: (flush) => setTimeout(() => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(flush);
    else flush();
  }, 10_000),
  getDoc: () => state.doc
});
installAnalytics(analytics);

function activeVariant(id) {
  return forcedVariants.get(id) || variant(state.doc, id, analyticsEnabled);
}

function randomBucket() {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  return word[0] / 0x100000000;
}

function openForAnalytics() {
  if (state.opened) return;
  state.opened = true;
  if (!analyticsEnabled) return;
  ctx.update(recordOpen(state.doc, randomBucket));
  const mark = milestone(state.doc);
  if (mark) analytics.track('opened', { m: mark });
}

function onLiveView() {
  return ['home', 'board', 'detail'].includes(state.view);
}

const timers = { tick: null, refresh: null, view: null };
let inflight = null;
let pastInflight = null;
let focusInflight = null;
let requestGeneration = 0;
let preserveSelection = false;
let suppressPreferenceEvents = false;
let geoGeneration = 0;
let routeGeneration = 0;
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
  clearTrain();
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
  update(doc) { state.doc = doc; saveDoc(doc, documentStore); },
  permission: geoPermissionState,
  get useLocation() { return preferencesOf(state.doc).useLocation; },
  setPreferences(patch) {
    const before = preferencesOf(state.doc);
    const wasCapped = capped();
    ctx.update(setPreferences(state.doc, patch));
    const after = preferencesOf(state.doc);
    globalThis.trainsAppearance?.apply(after.appearance);
    suppressPreferenceEvents = true;
    if (before.useLocation !== after.useLocation) {
      geoGeneration += 1;
      state.fix = null;
    }
    if (before.homeOverride?.id !== after.homeOverride?.id || before.useLocation !== after.useLocation) {
      if (!focusSelection() && state.predicted) {
        state.selection = null;
        preserveSelection = false;
      }
    }
    if (before.enabledModes.join(',') !== after.enabledModes.join(',') || wasCapped !== capped()) {
      refetchEligible();
    }
    return state.doc;
  },
  async requestLocation() {
    if (!preferencesOf(state.doc).useLocation) return geoPermissionState();
    await takeContextFix({ maximumAge: 0 });
    state.geoPermission = await geoPermissionState();
    return state.geoPermission;
  },
  fix: takeContextFix,
  track: (name, dims) => analytics.track(name, dims),
  shownSetup(source) {
    openForAnalytics();
    state.headerKind = 'setup';
    analytics.track('shown_setup', { f: source });
  },
  async saveTrip(trip, redirect, source) {
    if (state.setupSaved) return;
    const generation = routeGeneration;
    state.setupSaved = true;
    state.selection = savePair(trip);
    if (!redirect) {
      analytics.track('saved_setup', { f: source });
      return ctx.go('#/');
    }
    const match = await redirectJourney(trip, redirect);
    if (generation !== routeGeneration || state.view !== 'setup') return;
    analytics.track('saved_setup', { f: match ? 'redirect' : 'redirect_lost' });
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
      at: redirect.departureMs - 60_000, limit: LIMIT, modes: enabledModes(),
      transferLimit: transferLimit()
    });
    return (body.journeys || []).find((item) => journeyAllowed(item, enabledModes(), capped()) && departureKey(item) === redirect.journeyKey) || null;
  } catch (_) {
    return null;
  }
}

function invalidateSuggestions() {
  requestGeneration += 1;
  if (inflight) inflight.abort();
  if (pastInflight) pastInflight.abort();
  state.loadingPast = false;
}

function enabledModes() { return preferencesOf(state.doc).enabledModes; }

function capped() { return effectiveCap(state.doc); }

function transferLimit() { return capped() ? CAPPED_CHANGES : undefined; }

/* What a changed filter does, whether the rider changed it or the backend
   did: keep the rows that still qualify, ask the API for the rest, and never
   restore an excluded journey if that answer fails (ui.md, Settings). */
function refetchEligible() {
  invalidateSuggestions();
  const previousSelection = state.selection;
  const previousBody = filterBody(state.body, enabledModes(), capped());
  const previousStale = state.serverStale;
  const followed = focusSelection();
  if (followed) {
    state.selection = followed;
    state.predicted = false;
    state.leap = null;
  } else if (!suggestionAllowed(state.selection)) {
    state.selection = null;
    state.predicted = true;
    state.selection = locateSelection();
  }
  const samePair = previousSelection && state.selection
    && previousSelection.tripId === state.selection.tripId
    && previousSelection.direction === state.selection.direction;
  state.body = { journeys: [] };
  state.serverStale = false;
  if (state.selection) loadSelectedCache();
  if (samePair && (!state.body || (!(state.body.journeys || []).length && previousBody.journeys.length))) {
    state.body = previousBody;
    state.serverStale = previousStale;
  }
  state.pastBodies = [];
  state.seenLive = new Map();
  state.seenKey = null;
  state.journey = null;
  fetchLive();
}

/* One answer per open, after the first paint: the board never waits on it, and
   the stored answer is what this open already drew with. */
async function loadFlags() {
  let flags;
  try { flags = await getFlags(); } catch (_) { return; }
  const wasCapped = capped();
  ctx.update(setFlags(state.doc, flags));
  if (capped() === wasCapped) return;
  if (state.view === 'settings') renderSettings(state.root, ctx, settingsSubview());
  refetchEligible();
}

function settingsSubview() {
  return location.hash.slice('#/settings'.length).replace(/^\//, '');
}

function route() {
  preserveSelection = Boolean(state.view?.startsWith('settings')) && Boolean(state.selection);
  invalidateSuggestions();
  routeGeneration += 1;
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

  if (hash === '#/settings' || hash.startsWith('#/settings/')) {
    state.view = 'settings';
    renderSettings(root, ctx, settingsSubview());
    startTimers(false);
    refreshFollowed();
    return;
  }
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
  state.view = 'setup';
  state.setupSaved = false;
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
  return cacheKey(ends.from.id, ends.to.id, enabledModes());
}

function focusSelection() {
  const focus = visibleFocus(state.doc, now(), state.stations);
  return focus ? { tripId: focus.tripId, direction: focus.direction } : null;
}

function savedSelection() {
  return state.selection && findTrip(state.doc, state.selection.tripId) ? state.selection : null;
}

function suggestionAllowed(selection) {
  return selection && tripAllowed(findTrip(state.doc, selection.tripId), enabledModes(), state.stations);
}

/* Home leads with the focused journey; the board answers the tap that opened
   it (client-storage.md, Trip selection). */
function chooseSelection() {
  const followed = focusSelection();
  if (followed) { state.predicted = false; state.leap = null; return followed; }
  if (preserveSelection && suggestionAllowed(savedSelection())) return state.selection;
  const chosen = suggestionAllowed(savedSelection()) ? savedSelection() : null;
  state.predicted = !chosen;
  if (chosen) { state.leap = null; return chosen; }
  return locateSelection();
}

/* Filters apply before ranking and location-driven pairing. Stored trips and
   home votes remain intact, including when every saved trip is hidden. */
function locateSelection() {
  const doc = tripsForModes(state.doc, state.stations);
  if (!doc.trips.length) { state.leap = null; return null; }
  const stations = state.stations?.filter((station) => stationAllowed(station, enabledModes()));
  const hasHere = Boolean(here(doc, stations, validFix()));
  const answer = locate(doc, now(), { fix: validFix(), stations, home: homeOf(state.doc) });
  state.leap = answer.kind === 'pair' ? 'pair' : hasHere ? answer.leap || null : null;
  if (answer.kind === 'trip') return { tripId: answer.tripId, direction: answer.direction };
  if (answer.kind === 'pair' && tripAllowed(answer, enabledModes(), state.stations)) {
    return savePair({
      id: newTripId(), from: answer.from, to: answer.to, createdAt: new Date().toISOString()
    });
  }
  state.leap = null;
  return predict(doc, now(), { fix: validFix() });
}

function explicitSelection() {
  return (suggestionAllowed(savedSelection()) ? savedSelection() : null)
    || focusSelection() || predict(tripsForModes(state.doc, state.stations), now(), { fix: validFix() });
}

/* Hiding, restoring or ending a followed journey reconciles the selected
   pair without changing saved data. */
function reconcileSuggestionSelection() {
  const followed = focusSelection();
  if (followed && state.selection?.tripId === followed.tripId
      && state.selection?.direction === followed.direction) return false;
  if (!followed && suggestionAllowed(state.selection)) return false;
  const next = followed || predict(tripsForModes(state.doc, state.stations), now(), { fix: validFix() });
  if (!state.selection && !next) return false;
  invalidateSuggestions();
  state.selection = next;
  state.predicted = !followed;
  state.leap = null;
  state.body = null;
  state.journey = null;
  state.pastBodies = [];
  state.seenLive = new Map();
  state.seenKey = null;
  if (next) loadSelectedCache();
  return true;
}

function validFix() {
  return preferencesOf(state.doc).useLocation && fixIsValid(state.fix) ? state.fix : null;
}

function loadSelectedCache() {
  const ends = currentLeg();
  const cached = getCache(state.doc, currentKey())
    || getCache(state.doc, cacheKey(ends.from.id, ends.to.id));
  state.body = cached ? filterBody(cached.body, enabledModes(), capped()) : null;
  state.serverStale = cached?.serverStale === true;
  state.offline = false;
}

function showHome(root) {
  state.view = 'home';
  state.fix = null;
  state.previousOpen = state.doc.lastOpen || null;
  state.selection = chooseSelection();
  if (state.selection) loadSelectedCache();
  else state.body = null;
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
  if (state.view === 'board' && !focusSelection() && !suggestionAllowed(state.selection)) {
    state.selection = null;
    ctx.go('#/board');
    return;
  }
  if (state.view === 'home') {
    if (!focusSelection() && !suggestionAllowed(state.selection)) {
      invalidateSuggestions();
      state.selection = null;
      state.predicted = true;
      state.selection = locateSelection();
      state.body = null;
      if (state.selection) loadSelectedCache();
      fetchLive();
    }
    if (validFix()) useFix();
    else renderHome();
  }
}

/* The record the next open infers travel from. Written where writes happen —
   the cache paint and each successful refresh — and never from a render
   (client-storage.md, Travel mode). */
function noteLastOpen() {
  if (suppressPreferenceEvents || state.view !== 'home' || focusSelection() || !state.selection) return;
  const journeys = (state.body && state.body.journeys) || [];
  const journey = journeys.find((item) => journeyAllowed(item, enabledModes(), capped()) && !journeyCancelled(item));
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
  if (!preferencesOf(state.doc).useLocation) return;
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
    if (!preferencesOf(state.doc).useLocation || !navigator.geolocation) return resolve(null);
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
  if (!preferencesOf(state.doc).useLocation || state.doc.trips.length < 2 || state.fix || state.locationDismissed) return false;
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
  // Compare with the opening record before the cache paint replaced it.
  const storedFocus = focusOf(state.doc);
  const entered = (storedFocus && !focusExpired(storedFocus, now()))
    || rideRecorded(state.doc, state.previousOpen) ? null
    : journeyAllowed(state.previousOpen?.journey, enabledModes(), capped())
      ? inferTravel({ ...state.doc, lastOpen: state.previousOpen }, now(), fix) : null;
  if (entered) {
    ctx.update(setFocus(state.doc, entered, entered.journey, now(), 'inferred'));
    state.predicted = false;
    state.leap = null;
    state.selection = { tripId: entered.tripId, direction: entered.direction };
    openForAnalytics();
    analytics.track('entered_inferred');
  } else if (state.predicted) {
    const answer = locateSelection();
    state.selection = answer;
    if (!answer) { state.body = null; renderHome(); return; }
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
  if (!enabledModes().length) model.status = 'services-off';
  else if (!state.body) model.status = state.offline ? 'offline' : 'loading';
  else if (model.empty && enabledModes().length < SUPPORTED_MODES.length && !state.offline && !model.stale) model.status = 'services-empty';
  return model;
}

function sourceTime(body) {
  const generated = Date.parse(body?.generatedAt || '');
  return Number.isFinite(generated) ? generated : -Infinity;
}

function identityOfFocus(focus) {
  return focus ? `${focus.tripId}:${focus.direction}:${departureKey(focus.journey)}` : '';
}

function focusSource() {
  const focus = focusOf(state.doc);
  const trip = focus && findTrip(state.doc, focus.tripId);
  if (!focus || !trip || focusExpired(focus, now())) return null;
  const ends = leg(trip, focus.direction);
  const sources = [];
  const add = (body, offline, serverStale, priority) => {
    if (!body || !matchJourney(body.journeys, focus.journey)) return;
    sources.push({ body, offline, serverStale, priority });
  };
  const identity = identityOfFocus(focus);
  if (state.focusIdentity === identity) {
    add(state.focusBody, state.focusOffline, state.focusServerStale, 2);
  }
  if (state.selection?.tripId === focus.tripId && state.selection?.direction === focus.direction) {
    add(state.body, state.focusOffline || state.offline, state.serverStale, 3);
  }
  for (let mask = 0; mask < 2 ** SUPPORTED_MODES.length; mask++) {
    const modes = SUPPORTED_MODES.filter((_, index) => mask & (1 << index));
    const cached = getCache(state.doc, cacheKey(ends.from.id, ends.to.id, modes));
    add(cached?.body, state.focusOffline, cached?.serverStale === true, 1);
  }
  return sources.sort((a, b) => sourceTime(b.body) - sourceTime(a.body)
    || b.priority - a.priority)[0] || null;
}

function modelForSource(source) {
  return boardModel(source?.body || {}, now(), {
    forceStale: !source || source.offline,
    degraded: Boolean(source?.serverStale)
  });
}

function homeFreshness(model, serverStale = false) {
  if (model.stale) return { stale: true, freshness: 'Offline', dot: 'stale' };
  if (serverStale) return { stale: false, freshness: model.footer.text, dot: 'stale' };
  return { stale: false, freshness: 'Live', dot: 'live' };
}

function renderHome() {
  if (state.view !== 'home') return;
  if (!state.selection) {
    clearTrain();
    const html = Home.emptyServicesHtml(enabledModes());
    if (html !== painted.home) { state.root.innerHTML = html; painted.home = html; }
    lastHome = null;
    return;
  }
  const candidateModel = currentModel();
  const focused = Boolean(focusSelection());
  const followed = focused ? focusSource() : null;
  const focusModel = modelForSource(followed);
  const candidateFreshness = homeFreshness(candidateModel, state.serverStale);
  const followedFreshness = homeFreshness(focusModel, followed?.serverStale);
  const askLocation = shouldAskLocation();
  const kind = homeAnswerKind();
  if (!kind) restoreHomeAttribution();
  if (kind) openForAnalytics();
  const home = Home.homeModel(state.doc, state.selection, state.body, now(), {
    stations: state.stations,
    fix: validFix(),
    stale: focused ? focusModel.stale : candidateModel.stale,
    offline: focused ? !followed || followed.offline : state.offline,
    candidateSource: candidateFreshness,
    focusBody: followed?.body || null,
    focusSource: followedFreshness,
    askLocation,
    predicted: state.predicted,
    leap: state.leap,
    loadedAt: state.loadedAt,
    arrived: arrivedNow(),
    leave: leaveDistance(),
    stripVariant: activeVariant('strip-placement')
  });
  lastHome = home;
  if (kind) trackShown(kind, home.selected);
  if (askLocation && !state.askedPanel) {
    state.askedPanel = true;
    analytics.track('asked_panel');
  }
  if (state.offerDismissed) home.over = false;
  const freshness = home.freshness;
  home.freshness = '';
  const html = Home.homeHtml(home);
  if (html !== painted.home) {
    const list = state.root.querySelector('[data-t="trip-list"]');
    const scrollTop = list ? list.scrollTop : 0;
    const trainFocus = trainLine?.contains(document.activeElement) ? document.activeElement : null;
    state.root.innerHTML = html;
    painted.home = html;
    const nextList = state.root.querySelector('[data-t="trip-list"]');
    if (nextList) nextList.scrollTop = scrollTop;
    Home.finishHomeRender(state.root);
    const line = state.root.querySelector('.hm-hd .sy-bar');
    if (tinyTrain && line?.querySelector('[data-seg][data-line-code]')) {
      if (removeTrain) removeTrain.refresh(line);
      else removeTrain = attachTinyTrain(line);
      trainLine = line;
      trainFocus?.focus({ preventScroll: true });
    } else clearTrain();
  }
  patchFresh(state.root.querySelector('.hm-fresh .lbl'), freshness);
}

function homeAnswerKind() {
  const focus = visibleFocus(state.doc, now(), state.stations);
  if (focus) return focus.by === 'inferred' ? 'inferred' : 'focus';
  if (!state.predicted) return null;
  return state.leap || 'predicted';
}

function trackShown(kind, selection) {
  const key = `${kind}:${selection.tripId}:${selection.direction}`;
  state.headerKind = kind;
  state.headerTripId = selection.tripId;
  state.headerDirection = selection.direction;
  if (key === state.lastShown) return;
  state.lastShown = key;
  state.lastShownKind = kind;
  if (!suppressPreferenceEvents) analytics.track('shown_' + kind);
}

function restoreHomeAttribution() {
  if (state.headerKind !== 'setup' || state.setupSaved || !state.lastShownKind) return;
  if (state.selection.tripId !== state.headerTripId
    || state.selection.direction !== state.headerDirection) return;
  state.headerKind = state.lastShownKind;
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
  const focus = visibleFocus(state.doc, now(), state.stations);
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
  if (!state.selection) { ctx.go('#/'); return; }
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
  loadIndex();
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
  if (action === 'unpin' && lastHome?.pinned) return unpinService();
  if (action === 'settings') return ctx.go('#/settings');
  if (action === 'next-service') {
    const next = lastHome?.following;
    if (!next || next.key !== element.dataset.match) return;
    state.selection = { ...lastHome.selected };
    state.journey = next.journey;
    state.detailHandoff = { key: currentKey(), journeyKey: next.key, ...next.source };
    return ctx.go('#/journey');
  }
  suppressPreferenceEvents = false;
  if (action === 'new-trip') return ctx.go('#/trips/new');
  if (action === 'open-trip') {
    state.selection = { tripId: element.dataset.id, direction: element.dataset.direction || 'forward' };
    if (!state.tapped) {
      state.tapped = true;
      // Setup led to an explicit choice, so no home answer exists to judge.
      if (state.headerKind && state.headerKind !== 'setup') {
        const result = state.selection.tripId === state.headerTripId
          && state.selection.direction === state.headerDirection ? 'hit_' : 'miss_';
        analytics.track(result + state.headerKind);
      }
    }
    state.offerDismissed = false;
    return ctx.go('#/board');
  }
  if (action === 'way-back') {
    if (state.headerKind === 'focus' || state.headerKind === 'inferred') {
      analytics.track('back_' + state.headerKind);
    }
    state.headerKind = null;
    state.doc = clearFocus(recordCompletedFocus(state.doc));
    state.selection = {
      tripId: state.selection.tripId,
      direction: state.selection.direction === 'reverse' ? 'forward' : 'reverse'
    };
    ctx.update(state.doc);
    state.offerDismissed = false;
    reconcileSuggestionSelection();
    if (state.selection) loadSelectedCache();
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
    lastHome.strip = null;
    analytics.track('change_inferred');
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
    analytics.track('later_panel');
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
    analytics.track('granted_panel');
    state.fix = fix;
    useFix();
  } else {
    analytics.track('denied_panel');
    renderHome();
  }
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
  const focus = visibleFocus(state.doc, now(), state.stations);
  if (!state.journey && focus) {
    state.journey = focus.journey;
    state.selection = { tripId: focus.tripId, direction: focus.direction };
  }
  if (!state.journey || !state.selection || !selectedTrip()
      || !journeyAllowed(state.journey, enabledModes(), capped())
      || !suggestionAllowed(state.selection)) {
    location.hash = '#/';
    return;
  }
  state.view = 'detail';
  loadSelectedCache();
  const handoff = state.detailHandoff;
  state.detailHandoff = null;
  if (handoff?.key === currentKey() && handoff.journeyKey === journeyKey(state.journey)) {
    state.body = filterBody(handoff.body, enabledModes(), capped());
    state.offline = handoff.offline;
    state.serverStale = handoff.serverStale;
  }
  renderDetail();
  onAction(root, detailAction);
  startTimers(false);
  fetchLive();
}

function detailModel() {
  if (!state.journey) return null;
  const ends = currentLeg();
  const board = isFocused(state.doc, state.journey)
    ? modelForSource(focusSource()) : currentModel();
  const opts = { stale: board.stale, fromName: ends.from.name, toName: ends.to.name };
  const model = journeyDetail(state.journey, now(), opts);
  return {
    ...model,
    row: detailRow(model, opts),
    focused: isFocused(state.doc, state.journey),
    pinned: isFocused(state.doc, state.journey) && focusOf(state.doc)?.by !== 'inferred',
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

function unpinService() {
  if (!focusOf(state.doc) || focusOf(state.doc).by === 'inferred') return;
  const released = clearFocus(recordCompletedFocus(state.doc));
  delete released.lastOpen;
  ctx.update(released);
  if (focusInflight) focusInflight.abort();
  focusInflight = null;
  state.focusBody = null;
  state.focusIdentity = null;
  state.focusOffline = false;
  state.focusServerStale = false;
  // A subsequent location fix must not immediately infer the released ride.
  state.previousOpen = null;
  state.headerKind = null;
  if (state.view !== 'home') return ctx.go('#/');
  reconcileSuggestionSelection();
  if (state.selection) loadSelectedCache();
  renderHome();
  fetchLive();
}

function detailAction(action) {
  if (action === 'unpin' && isFocused(state.doc, state.journey)) return unpinService();
  if (action === 'board') return ctx.go('#/board');
  if (action === 'focus') {
    if (state.headerKind && state.headerKind !== 'setup'
      && state.selection.tripId === state.headerTripId
      && state.selection.direction === state.headerDirection) {
      analytics.track('hit_' + state.headerKind);
    }
    state.headerKind = null;
    ctx.update(setFocus(state.doc, state.selection, state.journey, now()));
    return ctx.go('#/');
  }
}

async function refreshFollowed() {
  const focus = focusOf(state.doc);
  if (focus && focusExpired(focus, now())) {
    ctx.update(clearFocus(recordCompletedFocus(state.doc)));
    state.focusBody = null;
    state.focusIdentity = null;
    if (state.view === 'home' || state.view === 'settings') reconcileSuggestionSelection();
    return;
  }
  const trip = focus && findTrip(state.doc, focus.tripId);
  if (!trip || document.hidden) return;
  const identity = identityOfFocus(focus);
  const ends = leg(trip, focus.direction);
  if (focusInflight) focusInflight.abort();
  const controller = new AbortController();
  focusInflight = controller;
  const departure = departureMs(focus.journey);
  try {
    const { body, serverStale } = await getDepartures(ends.from.id, ends.to.id, {
      limit: LIMIT, modes: SUPPORTED_MODES, signal: controller.signal,
      ...(departure !== null && departure < now() ? { at: departure - 60_000 } : {})
    });
    const current = focusOf(state.doc);
    if (controller.signal.aborted || !current
      || identityOfFocus(current) !== identity) return;
    ctx.update(refreshFocus(recordCompletedFocus(state.doc), focus, body, now()));
    state.focusOffline = false;
    if (matchJourney(body.journeys, current.journey)) {
      state.focusBody = body;
      state.focusIdentity = identity;
      state.focusServerStale = serverStale;
    }
    if (state.journey && isFocused(state.doc, state.journey)) {
      state.journey = matchJourney(body.journeys, state.journey) || state.journey;
    }
    renderCurrent();
  } catch (_) {
    if (!controller.signal.aborted && focusInflight === controller) {
      state.focusOffline = true;
      renderCurrent();
    }
  }
}

async function fetchLive({ independent = false } = {}) {
  if (independent) suppressPreferenceEvents = false;
  if (document.hidden) return;
  refreshFollowed();
  if ((!onLiveView() && state.view !== 'settings') || !state.selection) return;
  const modes = enabledModes();
  if (!modes.length) {
    state.body = { ...(state.body || {}), journeys: [] };
    state.offline = false;
    renderCurrent();
    return;
  }
  const ends = currentLeg();
  const key = currentKey();
  if (inflight) inflight.abort();
  const controller = new AbortController();
  inflight = controller;
  const generation = ++requestGeneration;
  try {
    const { body, serverStale } = await getDepartures(ends.from.id, ends.to.id, {
      limit: LIMIT, modes, transferLimit: transferLimit(), signal: controller.signal
    });
    if (controller.signal.aborted || generation !== requestGeneration || !state.selection || key !== currentKey()) return;
    const eligible = filterBody(body, modes, capped());
    if (state.seenKey !== key) { state.seenLive = new Map(); state.seenKey = key; }
    for (const journey of eligible.journeys || []) state.seenLive.set(departureKey(journey), journey);
    state.body = eligible;
    state.serverStale = serverStale;
    state.offline = false;
    ctx.update(recordCompletedFocus(putCache(state.doc, key, body, now(), { serverStale })));
    noteLastOpen();
    if (state.journey) state.journey = matchJourney(eligible.journeys, state.journey) || state.journey;
  } catch (error) {
    if (controller.signal.aborted || generation !== requestGeneration || error.name === 'AbortError') return;
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
  if (state.view !== 'board' || state.loadingPast || state.pastExhausted || !enabledModes().length) return;
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
  const controller = new AbortController();
  pastInflight = controller;
  const generation = routeGeneration;
  try {
    const { body } = await getDepartures(ends.from.id, ends.to.id, {
      limit: LIMIT,
      at, modes: enabledModes(), transferLimit: transferLimit(),
      signal: controller.signal
    });
    if (controller.signal.aborted || generation !== routeGeneration || state.view !== 'board' || key !== currentKey()) return;
    const before = new Set(state.pastBodies.flatMap((page) => page.journeys || []).map(departureKey));
    const gained = (body.journeys || []).some((journey) => !before.has(departureKey(journey)));
    if (!gained) state.pastExhausted = true;
    else state.pastBodies.unshift(filterBody(body, enabledModes(), capped()));
    if (initial) state.initialBoardLanding = true;
    renderBoard({ addedAbove: !initial });
  } catch (error) {
    // A transient page failure is not evidence that history has ended. The
    // next near-top scroll may retry it; only an empty/deduplicated answer or
    // the explicit 24-hour bound exhausts pagination.
  } finally {
    if (pastInflight === controller) state.loadingPast = false;
  }
}

function renderCurrent() {
  if (state.view === 'home') {
    if (reconcileSuggestionSelection()) fetchLive();
    renderHome();
  }
  else if (state.view === 'board') renderBoard();
  else if (state.view === 'detail') renderDetail();
}

function startTimers(recordBoardView) {
  stopTimers();
  timers.tick = setInterval(renderCurrent, TICK_MS);
  timers.refresh = setInterval(() => {
    if (!document.hidden) {
      fetchLive({ independent: true });
      refreshFeatureFlags();
    }
  }, REFRESH_MS);
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
  if (document.hidden) {
    stopTimers();
    flagsRequest?.abort();
    flagsRequest = null;
    return;
  }
  refreshFeatureFlags();
  if (!onLiveView() && state.view !== 'settings') return;
  suppressPreferenceEvents = false;
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
  analytics: { ...analytics, variant: activeVariant },
  set now(fn) { nowFn = fn; },
  get now() { return nowFn; },
  refresh: () => fetchLive({ independent: true }),
  setPreferences: ctx.setPreferences,
  older: () => fetchPast(false),
  rerender: renderCurrent,
  onLiveView,
  tick: renderCurrent,
  indexReady,
  route
};

if (location.hostname === 'localhost') {
  window.__trains.forceVariant = (id, value) => {
    if (!Object.hasOwn(EXPERIMENTS, id)) return false;
    const experiment = EXPERIMENTS[id];
    if (!experiment || !experiment.variants.includes(value)) return false;
    forcedVariants.set(id, value);
    renderCurrent();
    return true;
  };
  window.__trains.resetAnalyticsForTest = () => {
    analytics.events.length = 0;
    state.headerKind = null;
    state.headerTripId = null;
    state.headerDirection = null;
    state.lastShown = null;
    state.lastShownKind = null;
    state.tapped = false;
    state.opened = false;
    state.askedPanel = false;
    state.setupSaved = false;
  };
}

route();
loadFlags();
refreshFeatureFlags();
