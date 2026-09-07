#!/usr/bin/env node

/*
 * Usage: node tools/check-settings-browser.js --url http://localhost:8197
 *        [--frames assets/comps/latest]
 *        [--location-frames /tmp/location-row-web-frames]
 *
 * Drives the built settings UI through a private Chromium/CDP port. All
 * departures and feedback requests are replaced in the page; this never sends
 * feedback or depends on TfNSW.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const value = (flag, fallback = null) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : fallback;
};
const baseURL = new URL(value('--url', 'http://localhost:8197'));
const framesDir = value('--frames');
const locationFramesDir = value('--location-frames');
const firstPort = Number.parseInt(process.env.CDP_PORT || '9571', 10);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-settings-'));
const versionSource = fs.readFileSync(path.join(ROOT, 'web/js/version.js'), 'utf8');
const canonicalVersion = versionSource.match(/VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];

if (!canonicalVersion) throw new Error('could not read the canonical web version');

if (!['localhost', '127.0.0.1'].includes(baseURL.hostname)) {
  throw new Error('--url must use a private localhost server');
}

const from = { id: '213820', name: 'Rhodes Station', location: { lat: -33.830834, lon: 151.087868 } };
const to = { id: '202210', name: 'Bondi Junction Station', location: { lat: -33.891819, lon: 151.247455 } };
const longHome = {
  id: '10101100',
  name: 'International Airport Station',
  modes: ['train'],
  location: { lat: -33.934968, lon: 151.165958 }
};
const mascot = { id: '202010', name: 'Mascot Station', modes: ['train'], location: { lat: -33.923188, lon: 151.180786 } };
const kellyville = { id: '2155382', name: 'Kellyville Station', modes: ['metro'], location: { lat: -33.713514, lon: 150.935304 } };
const rouseHill = { id: '2155383', name: 'Rouse Hill Station', modes: ['metro'], location: { lat: -33.691986, lon: 150.924306 } };
const pyrmont = { id: '2000260', name: 'Pyrmont Bay Wharf', modes: ['ferry'], location: { lat: -33.868482, lon: 151.198818 } };
const doubleBay = { id: '202823', name: 'Double Bay Wharf', modes: ['ferry'], location: { lat: -33.873707, lon: 151.242443 } };
const rhodes = { ...from, modes: ['train'] };
const bondi = { ...to, modes: ['train'] };
const central = { id: '200060', name: 'Central Station', modes: ['train', 'metro'], location: { lat: -33.883882, lon: 151.205829 } };
const chatswood = { id: '206710', name: 'Chatswood Station', modes: ['train', 'metro'], location: { lat: -33.797134, lon: 151.180821 } };
const nowMs = Date.now();

function journey(id, mode = 'train', delayMinutes = 0) {
  const scheduled = new Date(nowMs + 20 * 60_000).toISOString();
  const estimated = new Date(nowMs + (20 + delayMinutes) * 60_000).toISOString();
  const arrival = new Date(nowMs + (55 + delayMinutes) * 60_000).toISOString();
  const lineName = mode === 'metro' ? 'M1' : mode === 'ferry' ? 'F3' : id;
  return {
    id,
    departure: { scheduled, estimated },
    arrival: { scheduled: new Date(nowMs + 55 * 60_000).toISOString(), estimated: arrival },
    line: { name: lineName, mode },
    legDetail: [{
      from: { ...from, platform: mode === 'ferry' ? 'B' : '1' },
      to: { ...to, platform: mode === 'ferry' ? 'A' : '2' },
      departure: { scheduled, estimated },
      arrival: { scheduled: new Date(nowMs + 55 * 60_000).toISOString(), estimated: arrival },
      line: { name: lineName, mode }
    }]
  };
}

function mixedJourney(id = 'MIXED') {
  const firstDeparture = new Date(nowMs + 20 * 60_000).toISOString();
  const changeArrival = new Date(nowMs + 35 * 60_000).toISOString();
  const secondDeparture = new Date(nowMs + 39 * 60_000).toISOString();
  const finalArrival = new Date(nowMs + 75 * 60_000).toISOString();
  return {
    id,
    departure: { scheduled: firstDeparture, estimated: firstDeparture },
    arrival: { scheduled: finalArrival, estimated: finalArrival },
    line: { name: 'T8', mode: 'train' },
    legDetail: [
      {
        from: { ...mascot, platform: '2' }, to: { ...central, platform: '21' },
        departure: { scheduled: firstDeparture, estimated: firstDeparture },
        arrival: { scheduled: changeArrival, estimated: changeArrival },
        line: { name: 'T8', mode: 'train' }
      },
      {
        from: { ...central, platform: '26' }, to: { ...kellyville, platform: '2' },
        departure: { scheduled: secondDeparture, estimated: secondDeparture },
        arrival: { scheduled: finalArrival, estimated: finalArrival },
        line: { name: 'M1', mode: 'metro' }
      }
    ]
  };
}

const train = journey('T9');
const metro = journey('metro', 'metro');
const ferry = journey('ferry', 'ferry');
const body = { generatedAt: new Date(nowMs).toISOString(), journeys: [train, metro, ferry] };

function seed(overrides = {}) {
  return {
    schemaVersion: 1,
    trips: [{ id: 't1', from, to, createdAt: new Date(nowMs - 86_400_000).toISOString() }],
    history: [], rides: [], searches: { from: [], to: [] },
    homeVotes: [
      { day: '2026-09-01', station: from },
      { day: '2026-09-02', station: from },
      { day: '2026-09-03', station: from }
    ],
    lastOpen: null, lastViewed: { tripId: 't1', direction: 'forward' },
    cache: { [`${from.id}-${to.id}`]: { fetchedAt: body.generatedAt, body } },
    ...overrides
  };
}

function browserPrelude() {
  return `
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const waitFor = async (read, message) => {
      for (let i = 0; i < 80; i += 1) { const answer = read(); if (answer) return answer; await sleep(25); }
      throw new Error(message);
    };
    const t = window.__trains;
  `;
}

function geometryScript(extra = '') {
  return `(async () => {
    ${browserPrelude()}
    history.replaceState(null, '', '#/settings');
    t.route();
    await waitFor(() => document.querySelector('.st-service-set'), 'settings did not render');
    await sleep(80);
    const labels = [...document.querySelectorAll('.st-mode')].map((el) => el.textContent.trim());
    assert(labels.length === 4, 'expected four service buttons');
    assert(document.querySelectorAll('.st-theme[role="radio"]').length === 3, 'expected three appearance radios');
    assert(document.querySelector('.st-mode[data-mode="bus"]').disabled, 'buses must be disabled');
    for (const el of document.querySelectorAll('button,input,textarea')) {
      const rect = el.getBoundingClientRect();
      assert(rect.height >= 44, 'short target ' + (el.dataset.act || el.tagName) + ': ' + rect.height);
      assert(rect.left >= -0.5 && rect.right <= document.documentElement.clientWidth + 0.5,
        'target outside viewport: ' + (el.dataset.act || el.tagName));
    }
    const scroller = document.querySelector('[data-scroller]');
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(30);
    const version = [...document.querySelectorAll('.st-secondary-row')].find((el) => el.textContent.includes('Version'));
    const versionBottom = version && version.getBoundingClientRect().bottom;
    const scrollerBottom = scroller.getBoundingClientRect().bottom;
    assert(version && versionBottom <= scrollerBottom + 1,
      'version cannot be reached in the settings scroller: ' + JSON.stringify({
        versionBottom, scrollerBottom, scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight
      }));
    assert(version.textContent.trim() === ${JSON.stringify(`Version ${canonicalVersion}`)},
      'settings did not show the canonical version: ' + version.textContent.trim());
    scroller.scrollTop = 0;
    ${extra}
  })()`;
}

function transferRowScript(choice) {
  const words = { two: { value: 'Up to 2', mark: 'No limit' }, any: { value: 'No limit', mark: 'Up to 2' } }[choice];
  return `
    const transferRow = document.querySelector('.st-transfer-row');
    assert(transferRow instanceof HTMLButtonElement, 'transfer limit row is not one button');
    assert(transferRow.dataset.act === 'transfer-limit', 'transfer limit row has the wrong action: ' + transferRow.dataset.act);
    assert(transferRow.previousElementSibling?.classList.contains('st-service-note'),
      'transfer limit row does not sit directly after the services note');
    assert(transferRow.querySelector('.st-name')?.textContent.trim() === 'Transfer limit',
      'wrong transfer limit title: ' + transferRow.querySelector('.st-name')?.textContent.trim());
    assert(transferRow.querySelector('.st-value')?.textContent.trim() === ${JSON.stringify(words.value)},
      'wrong transfer limit value: ' + transferRow.querySelector('.st-value')?.textContent.trim());
    assert(transferRow.querySelector('.st-state')?.textContent.trim() === ${JSON.stringify(words.mark)},
      'wrong transfer limit mark: ' + transferRow.querySelector('.st-state')?.textContent.trim());
    assert(!transferRow.querySelector('svg'), 'transfer limit row drew a glyph');
    const transferHeight = transferRow.getBoundingClientRect().height;
    assert(Math.round(transferHeight) === 56, 'transfer limit row is not 56px: ' + transferHeight);
  `;
}

function locationRowScript(finalState = 'on') {
  return `
    let permissionState = 'prompt';
    const geoRequests = [];
    Object.defineProperty(navigator.permissions, 'query', {
      configurable: true, value: async () => ({ state: permissionState })
    });
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      configurable: true, value: (success, error) => geoRequests.push({ success, error })
    });
    const expectedLocation = {
      off: { use: false, permission: 'denied', value: 'Location is not used', mark: 'Turn on', action: 'toggle-location', pressed: 'false' },
      ask: { use: true, permission: 'prompt', value: 'Location needs permission', mark: 'Allow', action: 'request-location', pressed: null },
      blocked: { use: true, permission: 'denied', value: 'Blocked in browser', mark: 'Turn off', action: 'toggle-location', pressed: null },
      on: { use: true, permission: 'granted', value: 'Nearby trips use location', mark: 'Turn off', action: 'toggle-location', pressed: 'true' }
    };
    const locationHeights = {};
    const assertLocation = (state, measure = true) => {
      const want = expectedLocation[state];
      const row = document.querySelector('.st-location-row');
      assert(row instanceof HTMLButtonElement, state + ': location row is not one button');
      const name = row.querySelector('.st-name');
      const value = row.querySelector('.st-value');
      const mark = row.querySelector('.st-state');
      assert(name?.textContent.trim() === 'Use location', state + ': wrong title');
      assert(value?.textContent.trim() === want.value, state + ': wrong subtitle: ' + value?.textContent.trim());
      assert(mark?.textContent.trim() === want.mark, state + ': wrong mark: ' + mark?.textContent.trim());
      assert(row.dataset.act === want.action, state + ': wrong action: ' + row.dataset.act);
      assert(row.getAttribute('aria-pressed') === want.pressed,
        state + ': wrong pressed semantics: ' + row.getAttribute('aria-pressed'));
      assert(row.innerText.trim().replace(/\\s+/g, ' ') === ['Use location', want.value, want.mark.toUpperCase()].join(' '),
        state + ': accessible text is not title, subtitle, action: ' + row.innerText.trim().replace(/\\s+/g, ' '));
      assert(name.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING,
        state + ': subtitle does not follow title');
      assert(value.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING,
        state + ': action does not follow subtitle');
      assert(row.tabIndex === 0 && !row.disabled, state + ': location button is not keyboard reachable');
      assert(getComputedStyle(mark).whiteSpace === 'nowrap', state + ': action mark can wrap');
      assert(getComputedStyle(mark).color === getComputedStyle(name).color, state + ': action mark is not primary ink');
      const rowRect = row.getBoundingClientRect();
      const valueRect = value.getBoundingClientRect();
      const markRect = mark.getBoundingClientRect();
      assert(Math.abs(rowRect.height - 56) <= 0.5, state + ': location row is not 56px: ' + rowRect.height);
      assert(valueRect.right <= markRect.left + 0.5,
        state + ': subtitle overlaps action: ' + JSON.stringify({ valueRight: valueRect.right, markLeft: markRect.left }));
      assert(markRect.right <= rowRect.right + 0.5, state + ': action escapes the row');
      assert(!document.querySelector('.st-location-note'), state + ': separate location strip remains');
      assert(!document.body.textContent.includes('this phone hasn’t decided'), state + ': old prompt explanation remains');
      assert(!document.body.textContent.includes('Allow location in your browser'), state + ': old blocked explanation remains');
      const requests = document.querySelectorAll('[data-act="request-location"]');
      assert(requests.length === (state === 'ask' ? 1 : 0), state + ': request action exists outside the ask state');
      if (state === 'blocked') assert(value.classList.contains('warn'), 'blocked: subtitle lost warning ink');
      else assert(!value.classList.contains('warn'), state + ': non-blocked subtitle uses warning ink');
      if (measure) locationHeights[state] = rowRect.height;
      return row;
    };
    const showLocation = async (state, measure = true) => {
      const want = expectedLocation[state];
      permissionState = want.permission;
      t.setPreferences({ useLocation: want.use });
      history.replaceState(null, '', '#/settings');
      t.route();
      await waitFor(() => document.querySelector('.st-location-row .st-value')?.textContent.trim() === want.value,
        state + ': location state did not render');
      await sleep(20);
      return assertLocation(state, measure);
    };

    const delayedPermissions = [];
    Object.defineProperty(navigator.permissions, 'query', {
      configurable: true, value: () => new Promise((resolve) => delayedPermissions.push(resolve))
    });
    t.setPreferences({ useLocation: true });
    history.replaceState(null, '', '#/settings');
    t.route();
    assertLocation('ask', false);
    await waitFor(() => delayedPermissions.length === 1, 'permission query did not start');
    document.querySelector('.st-location-row').click();
    await waitFor(() => geoRequests.length === 1, 'ALLOW did not supersede the initial permission query');
    geoRequests[0].error(new Error('not decided'));
    await waitFor(() => delayedPermissions.length === 2, 'ALLOW did not recheck permission');
    delayedPermissions[1]({ state: 'prompt' });
    await sleep(20);
    assertLocation('ask', false);
    delayedPermissions[0]({ state: 'granted' });
    await sleep(20);
    assertLocation('ask', false);
    Object.defineProperty(navigator.permissions, 'query', {
      configurable: true, value: async () => ({ state: permissionState })
    });

    for (const state of ['off', 'ask', 'blocked', 'on']) await showLocation(state);
    const heightValues = Object.values(locationHeights);
    assert(Math.max(...heightValues) - Math.min(...heightValues) <= 0.5,
      'location row height changes by state: ' + JSON.stringify(locationHeights));

    let row = await showLocation('off', false);
    row.focus();
    const beforeOff = geoRequests.length;
    permissionState = 'prompt';
    row.click();
    await waitFor(() => geoRequests.length === beforeOff + 1, 'TURN ON did not request location');
    assert(t.state.doc.preferences.useLocation, 'TURN ON did not enable the preference');
    assertLocation('ask', false);
    assert(document.activeElement?.classList.contains('st-location-row'), 'TURN ON lost keyboard focus');
    geoRequests.at(-1).error(new Error('not decided'));
    await sleep(30);
    assertLocation('ask', false);

    row = document.querySelector('.st-location-row');
    row.focus();
    const beforeAsk = geoRequests.length;
    row.click();
    await waitFor(() => geoRequests.length === beforeAsk + 1, 'ALLOW did not request location');
    permissionState = 'granted';
    geoRequests.at(-1).success({ timestamp: Date.now(), coords: {
      latitude: ${from.location.lat}, longitude: ${from.location.lon}, speed: null
    } });
    await waitFor(() => document.querySelector('.st-location-row .st-value')?.textContent.trim() === 'Nearby trips use location',
      'ALLOW success did not paint granted');
    assertLocation('on', false);
    assert(document.activeElement?.classList.contains('st-location-row'), 'ALLOW lost keyboard focus');

    row = document.querySelector('.st-location-row');
    const beforeOn = geoRequests.length;
    row.click();
    await waitFor(() => !t.state.doc.preferences.useLocation, 'TURN OFF did not disable the preference');
    assertLocation('off', false);
    assert(geoRequests.length === beforeOn, 'TURN OFF requested location');
    assert(document.activeElement?.classList.contains('st-location-row'), 'TURN OFF lost keyboard focus');

    row = await showLocation('blocked', false);
    row.focus();
    const beforeBlocked = geoRequests.length;
    row.click();
    await waitFor(() => !t.state.doc.preferences.useLocation, 'blocked TURN OFF did not disable the preference');
    assertLocation('off', false);
    assert(geoRequests.length === beforeBlocked, 'blocked TURN OFF requested location');
    assert(document.activeElement?.classList.contains('st-location-row'), 'blocked TURN OFF lost keyboard focus');

    row = await showLocation('ask', false);
    row.click();
    await waitFor(() => geoRequests.length === beforeBlocked + 1, 'navigation race did not start a location request');
    history.replaceState(null, '', '#/settings/feedback');
    t.route();
    await waitFor(() => document.querySelector('[data-role="feedback-message"]'), 'navigation race did not open feedback');
    permissionState = 'granted';
    geoRequests.at(-1).success({ timestamp: Date.now(), coords: {
      latitude: ${from.location.lat}, longitude: ${from.location.lon}, speed: null
    } });
    await sleep(40);
    assert(document.querySelector('[data-role="feedback-message"]'), 'late location answer replaced the Settings subview');
    assert(!document.querySelector('.st-location-row'), 'late location answer repainted the main Settings view');
    await showLocation(${JSON.stringify(finalState)}, false);
  `;
}

function raceScript() {
  const stale = { generatedAt: new Date(nowMs + 1_000).toISOString(), journeys: [journey('STALE')] };
  const current = { generatedAt: new Date(nowMs + 2_000).toISOString(), journeys: [journey('CURRENT')] };
  const focusJourney = journey('T9', 'train', 7);
  focusJourney.id = 'FOCUS';
  return `(async () => {
    ${browserPrelude()}
    const pending = [];
    window.fetch = (input, init = {}) => {
      const url = String(input);
      if (!url.startsWith('/api/v1/departures?')) return Promise.reject(new Error('unexpected request ' + url));
      return new Promise((resolve, reject) => pending.push({ url, init, resolve, reject }));
    };
    history.replaceState(null, '', '#/settings');
    t.route();
    await waitFor(() => document.querySelector('.st-service-set'), 'settings did not render');
    t.state.stations = [];
    pending.length = 0;

    t.setPreferences({ enabledModes: ['train'] });
    await waitFor(() => pending.length === 1, 'first train request did not start');
    t.setPreferences({ enabledModes: [] });
    await sleep(30);
    assert(pending.length === 1, 'all-off made a suggestion request');
    t.setPreferences({ enabledModes: ['train'] });
    await waitFor(() => pending.length === 2, 'replacement train request did not start');
    pending[0].resolve(new Response(${JSON.stringify(JSON.stringify(stale))}, { status: 200 }));
    await sleep(30);
    assert(!(t.state.body.journeys || []).some((item) => item.id === 'STALE'),
      'late same-mode success replaced the current generation');
    pending[1].resolve(new Response(${JSON.stringify(JSON.stringify(current))}, { status: 200 }));
    await waitFor(() => (t.state.body.journeys || []).some((item) => item.id === 'CURRENT'),
      'current replacement did not paint');

    t.setPreferences({ enabledModes: ['metro'] });
    await waitFor(() => pending.length === 3, 'metro request did not start');
    t.setPreferences({ enabledModes: ['train'] });
    await waitFor(() => pending.length === 4, 'new train request did not start');
    pending[3].resolve(new Response(${JSON.stringify(JSON.stringify(current))}, { status: 200 }));
    await waitFor(() => (t.state.body.journeys || []).some((item) => item.id === 'CURRENT'),
      'new train response did not settle');
    pending[2].reject(new Error('late old failure'));
    await sleep(40);
    assert(t.state.offline === false, 'late failure marked current data offline');

    const legacy = ${JSON.stringify(body)};
    t.state.doc.cache[${JSON.stringify(`${from.id}-${to.id}`)}] = { fetchedAt: legacy.generatedAt, body: legacy };
    t.setPreferences({ enabledModes: ['train'] });
    t.state.body = legacy;
    t.setPreferences({ enabledModes: ['metro'] });
    assert(!(t.state.body.journeys || []).some((item) => item.line.mode !== 'metro'),
      'excluded cached fallback remained visible');
    const oldRequest = pending[pending.length - 1];
    oldRequest.reject(new Error('replacement unavailable'));
    await sleep(40);
    assert(!(t.state.body.journeys || []).some((item) => item.line.mode !== 'metro'),
      'failed replacement restored an excluded cached journey');

    t.state.doc.focus = {
      tripId: 't1', direction: 'forward', focusedAt: ${JSON.stringify(train.departure.scheduled)},
      by: 'focus', journey: ${JSON.stringify(train)}
    };
    pending.length = 0;
    t.setPreferences({ enabledModes: [] });
    await waitFor(() => pending.some((item) => new URL(item.url, location.href).searchParams.get('modes') === 'train,metro,ferry'),
      'all-off did not independently refresh the followed journey');
    assert(!pending.some((item) => new URL(item.url, location.href).searchParams.get('modes') === ''),
      'all-off issued a suggestion request');
    const focusRequest = pending.find((item) => new URL(item.url, location.href).searchParams.get('modes') === 'train,metro,ferry');
    const focusBody = { generatedAt: new Date().toISOString(), journeys: [${JSON.stringify(focusJourney)}] };
    focusRequest.resolve(new Response(JSON.stringify(focusBody), { status: 200 }));
    await sleep(40);
    history.replaceState(null, '', '#/');
    t.route();
    await sleep(40);
    assert(t.state.doc.focus && t.state.doc.focus.journey.id === 'FOCUS',
      'followed snapshot did not survive settings and return home');
  })()`;
}

function focusFreshnessScript() {
  const suggestionOnly = { generatedAt: new Date(nowMs + 3_000).toISOString(), journeys: [metro] };
  const refreshedFocus = journey('T9', 'train', 5);
  refreshedFocus.id = 'FOCUS-FRESH';
  const focused = { generatedAt: new Date(nowMs + 4_000).toISOString(), journeys: [refreshedFocus] };
  return `(async () => {
    ${browserPrelude()}
    const pending = [];
    window.fetch = (input, init = {}) => new Promise((resolve, reject) => {
      pending.push({ url: String(input), init, resolve, reject });
    });
    t.state.doc.focus = {
      tripId: 't1', direction: 'forward', focusedAt: ${JSON.stringify(train.departure.scheduled)},
      by: 'focus', journey: ${JSON.stringify(train)}
    };
    history.replaceState(null, '', '#/');
    t.route();
    await waitFor(() => pending.length === 2, 'focus and suggestion requests did not both start');
    pending[0].reject(new Error('focus offline'));
    pending[1].resolve(new Response(${JSON.stringify(JSON.stringify(suggestionOnly))}, { status: 200 }));
    await sleep(120);
    assert(document.querySelector('.hm-fresh .lbl')?.textContent === 'Offline',
      'successful suggestions mislabeled a failed focused source as live: ' + JSON.stringify({
        freshness: document.querySelector('.hm-fresh .lbl')?.textContent,
        focusOffline: t.state.focusOffline,
        offline: t.state.offline,
        body: (t.state.body?.journeys || []).map((item) => item.id),
        focusBody: (t.state.focusBody?.journeys || []).map((item) => item.id),
        focusIdentity: t.state.focusIdentity,
        focus: t.state.doc.focus && { id: t.state.doc.focus.journey?.id, by: t.state.doc.focus.by },
        selection: t.state.selection,
        view: t.state.view
      }));

    t.refresh();
    await waitFor(() => pending.length === 4, 'second focus and suggestion requests did not both start');
    pending[2].resolve(new Response(${JSON.stringify(JSON.stringify(focused))}, { status: 200 }));
    pending[3].reject(new Error('suggestions offline'));
    await waitFor(() => document.querySelector('.hm-fresh .lbl')?.textContent === 'Live',
      'failed suggestions mislabeled a successful focused source as offline');
    assert(t.state.doc.focus.journey.id === 'FOCUS-FRESH', 'focused snapshot did not refresh from its own source');
  })()`;
}

function serviceEligibilityScript(stations) {
  const freshTrain = { generatedAt: new Date(nowMs).toISOString(), journeys: [train] };
  return `(async () => {
    ${browserPrelude()}
    const stations = ${JSON.stringify(stations)};
    const pending = [];
    window.fetch = (input, init = {}) => new Promise((resolve, reject) => {
      pending.push({ url: String(input), init, resolve, reject });
    });

    history.replaceState(null, '', '#/settings');
    t.route();
    await waitFor(() => document.querySelector('.st-service-set'), 'settings did not render');

    // A returning selection is provisionally usable before the index arrives.
    // Once the index proves it incompatible, prediction must choose again.
    t.state.stations = null;
    t.state.selection = { tripId: 'metro-trip', direction: 'forward' };
    history.replaceState(null, '', '#/');
    t.route();
    assert(t.state.selection?.tripId === 'metro-trip', 'pre-index selection was unexpectedly replaced');
    t.indexReady(stations);
    await waitFor(() => t.state.selection?.tripId === 'train-trip',
      'late index did not reselect away from the metro-only trip');
    t.rerender();
    await sleep(40);
    const ids = () => [...document.querySelectorAll('.tripr[data-id]')].map((row) => row.dataset.id);
    assert(ids().includes('train-trip'), 'train Rhodes trip was hidden with Trains on');
    assert(ids().includes('multi-trip'), 'multimodal endpoints were hidden with Trains on');
    assert(!ids().includes('metro-trip'), 'metro-only Kellyville trip remained visible with Metro off');
    assert(!ids().includes('ferry-trip'), 'ferry-only Pyrmont trip remained visible with Ferries off');
    assert(!document.querySelector('[data-act="enable-ferries"]'), 'obsolete one-tap ferry action remained');
    assert(t.state.doc.trips.length === 4, 'service filtering deleted stored trips');

    t.setPreferences({ enabledModes: ['train', 'metro', 'ferry'] });
    t.rerender();
    await waitFor(() => ids().length === 4, 're-enabling services did not restore every saved trip');
    assert(ids().includes('metro-trip') && ids().includes('ferry-trip'),
      're-enabling services did not restore metro and ferry trips');

    t.setPreferences({ enabledModes: ['train'] });

    // A coordinate requested under the old mode set must be filtered using the
    // current mode set when it arrives.
    t.setPreferences({ enabledModes: ['train', 'metro', 'ferry'], useLocation: true });
    t.state.selection = { tripId: 'metro-trip', direction: 'forward' };
    let lateFix = null;
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      configurable: true, value: (success) => { lateFix = success; }
    });
    history.replaceState(null, '', '#/settings');
    t.route();
    history.replaceState(null, '', '#/');
    t.route();
    await waitFor(() => lateFix, 'home did not start the location request');
    t.setPreferences({ enabledModes: ['train'] });
    assert(t.state.selection?.tripId === 'train-trip', 'mode change did not replace the metro selection');
    lateFix({ timestamp: Date.now(), coords: {
      latitude: ${kellyville.location.lat}, longitude: ${kellyville.location.lon}, speed: null
    } });
    await sleep(100);
    t.rerender();
    assert(t.state.selection?.tripId === 'train-trip' || t.state.selection?.tripId === 'multi-trip',
      'late metro-area fix restored an incompatible selection');
    assert(!ids().includes('metro-trip') && !ids().includes('ferry-trip'),
      'late fix restored filtered trip rows');

    // Finish on a deterministic fresh answer for the calibration frame.
    t.state.selection = { tripId: 'train-trip', direction: 'forward' };
    t.state.body = ${JSON.stringify(freshTrain)};
    t.state.fix = null;
    t.state.offline = false;
    t.state.serverStale = false;
    t.rerender();
    await waitFor(() => document.querySelector('.hm-fresh .lbl')?.textContent === 'Live',
      'calibration state did not render a fresh train answer');
    assert(!document.body.textContent.includes('No services on the last board'),
      'calibration state retained the empty stale instruction');
  })()`;
}

function hiddenFocusScript(stations, by, refreshed) {
  return `(async () => {
    ${browserPrelude()}
    const stations = ${JSON.stringify(stations)};
    const pending = [];
    window.fetch = (input, init = {}) => new Promise((resolve, reject) => {
      pending.push({ url: String(input), init, resolve, reject });
    });
    const ids = () => [...document.querySelectorAll('.tripr[data-id]')].map((row) => row.dataset.id);
    const assertHidden = (stage, indexed) => {
      assert(t.state.doc.focus?.by === ${JSON.stringify(by)}, stage + ': stored focus changed');
      assert(document.querySelector('.home-screen')?.dataset.focused === 'false',
        stage + ': excluded focus became the Home header');
      assert(!document.querySelector('.tripr.focused'), stage + ': excluded focus received focused row treatment');
      assert(!document.querySelector('.hm-hd [data-line-code="M1"]'), stage + ': excluded M1 directions appeared');
      if (indexed) {
        assert(!ids().includes('mixed-trip'), stage + ': indexed Kellyville trip remained visible');
        assert(ids().includes('train-trip'), stage + ': eligible Rhodes trip disappeared');
      }
    };

    history.replaceState(null, '', '#/settings');
    t.route();
    t.state.stations = null;
    t.state.selection = { tripId: 'mixed-trip', direction: 'forward' };
    history.replaceState(null, '', '#/');
    t.route();
    await waitFor(() => document.querySelector('.home-screen'), 'pre-index Home did not render');
    assertHidden('before index', false);
    await waitFor(() => pending.some((item) =>
      new URL(item.url, location.href).searchParams.get('modes') === 'train,metro,ferry'),
      'hidden focus did not keep its independent all-mode refresh');
    t.indexReady(stations);
    await waitFor(() => t.state.selection?.tripId === 'train-trip',
      'index did not reselect the eligible Rhodes trip');
    t.rerender();
    assertHidden('after index', true);
    const focusRequest = pending.filter((item) =>
      new URL(item.url, location.href).searchParams.get('modes') === 'train,metro,ferry').at(-1);

    focusRequest.resolve(new Response(${JSON.stringify(JSON.stringify({
      generatedAt: new Date(nowMs + 2_000).toISOString(), journeys: [refreshed]
    }))}, { status: 200 }));
    await waitFor(() => t.state.doc.focus?.journey?.id === ${JSON.stringify(refreshed.id)},
      'hidden focus snapshot did not refresh in storage');
    t.rerender();
    assertHidden('after focus refresh', true);
    t.tick();
    assertHidden('after tick', true);
    t.refresh();
    await sleep(50);
    assertHidden('after independent refresh', true);

    const beforeRestore = pending.length;
    t.setPreferences({ enabledModes: ['train', 'metro', 'ferry'] });
    assert(t.state.selection?.tripId === 'mixed-trip',
      're-enabling Metro did not synchronize the controller selection to stored focus');
    const restoredRequest = await waitFor(() => pending.length > beforeRestore && pending.at(-1),
      'restored focus did not start its matching suggestion request');
    const restoredURL = new URL(restoredRequest.url, location.href);
    assert(restoredURL.searchParams.get('from') === ${JSON.stringify(mascot.id)}
      && restoredURL.searchParams.get('to') === ${JSON.stringify(kellyville.id)},
      'restored focus fetched the previous suggestion pair: ' + restoredURL.href);
    t.rerender();
    await waitFor(() => document.querySelector('.tripr[data-id="mixed-trip"].focused'),
      're-enabling Metro did not restore the stored focus');
    assert(document.querySelector('.home-screen')?.dataset.focused === 'true',
      'restored focus did not return to the Home header');
    assert(!document.querySelector('.hm-hd [data-line-code="T9"]')
      && !document.querySelector('.hm-hd')?.textContent.includes('Bondi'),
      'cancelled restored focus reused the prior Rhodes suggestion as a replacement');

    t.setPreferences({ enabledModes: ['train'] });
    t.rerender();
    assertHidden('after filtering again', true);
    t.setPreferences({ enabledModes: [] });
    t.rerender();
    await waitFor(() => document.querySelector('[data-filtered-empty]'), 'all-off hidden focus was not recoverable');
    assert(t.state.doc.focus?.journey?.id === ${JSON.stringify(refreshed.id)}, 'all-off deleted stored focus');
    assert(document.querySelector('.hm-filtered-empty [data-act="settings"]'), 'all-off lost its Settings recovery action');
    t.setPreferences({ enabledModes: ['train'] });
    t.rerender();
    await waitFor(() => ids().includes('train-trip'), 'turning Trains back on did not recover Rhodes');
    assertHidden('final train-only state', true);
  })()`;
}

function hiddenFocusReloadScript(by, refreshedId) {
  return `(async () => {
    ${browserPrelude()}
    await waitFor(() => Array.isArray(t.state.stations), 'reload did not load the station index');
    await waitFor(() => document.querySelector('.home-screen'), 'reload did not render Home');
    assert(t.state.doc.focus?.by === ${JSON.stringify(by)}
      && t.state.doc.focus?.journey?.id === ${JSON.stringify(refreshedId)}, 'reload lost stored focus');
    assert(t.state.selection?.tripId === 'train-trip', 'reload did not retain the eligible Rhodes selection');
    assert(document.querySelector('.tripr[data-id="train-trip"]'), 'reload hid Rhodes');
    assert(!document.querySelector('.tripr[data-id="mixed-trip"]') && !document.querySelector('.tripr.focused'),
      'reload resurrected the excluded focus');
    t.tick();
    assert(!document.querySelector('.tripr[data-id="mixed-trip"]'), 'reload tick resurrected the excluded focus');
  })()`;
}

function hiddenFocusJourneyScript(by, refreshedId) {
  return `(async () => {
    ${browserPrelude()}
    await waitFor(() => Array.isArray(t.state.stations), 'cold journey did not load the station index');
    await waitFor(() => t.state.view === 'home' && document.querySelector('.home-screen'),
      'excluded cold #/journey did not return Home');
    assert(t.state.doc.focus?.by === ${JSON.stringify(by)}
      && t.state.doc.focus?.journey?.id === ${JSON.stringify(refreshedId)}, 'cold journey changed stored focus');
    assert(t.state.selection?.tripId === 'train-trip', 'cold journey did not select eligible Rhodes');
    assert(!document.querySelector('.tripr[data-id="mixed-trip"]') && !document.querySelector('.tripr.focused'),
      'cold journey resurrected excluded focus UI');
    assert(!document.querySelector('[data-act="focus"]'), 'cold journey rendered excluded Detail fallback');
  })()`;
}

function coldBoardFilterScript() {
  return `(async () => {
    ${browserPrelude()}
    await sleep(120);
    assert(t.state.view === 'board', 'cold #/board did not open the board: ' + JSON.stringify({
      hash: location.hash, view: t.state.view, trips: t.state.doc.trips.length,
      selection: t.state.selection
    }));
    assert(t.state.doc.trips[0].id === 'metro-trip', 'cold-board fixture lost its incompatible first trip');
    assert(t.state.doc.lastViewed?.tripId === 'ferry-trip', 'cold-board fixture lost its incompatible lastViewed');
    if (t.state.selection?.tripId === 'ferry-trip') {
      t.indexReady(${JSON.stringify([rhodes, bondi, kellyville, rouseHill, pyrmont, doubleBay, central, chatswood])});
    }
    await waitFor(() => t.state.selection?.tripId === 'train-trip',
      'cold #/board did not reconcile after its late station index');
    assert(t.state.selection?.tripId === 'train-trip', 'cold #/board did not choose the first eligible train trip');
    assert(t.state.doc.trips.length === 4, 'cold board filtering changed stored trips');
    assert(document.querySelector('[data-t="timeline"]'), 'cold board did not paint');
  })()`;
}

function emptyRecoveryScript() {
  return `(async () => {
    ${browserPrelude()}
    const ids = () => [...document.querySelectorAll('.tripr[data-id]')].map((row) => row.dataset.id);
    await waitFor(() => Array.isArray(t.state.stations), 'station index did not load');
    history.replaceState(null, '', '#/');
    t.route();
    await waitFor(() => document.querySelector('[data-filtered-empty]'), 'all-hidden Home did not render its empty page');
    assert(t.state.selection === null, 'all-hidden Home retained an incompatible selection');
    assert(document.body.textContent.includes('No saved trips with these services.'), 'all-hidden copy changed');
    const change = document.querySelector('.hm-filtered-empty [data-act="settings"]');
    assert(change && change.getBoundingClientRect().height >= 44, 'all-hidden page has no reachable Settings action');
    change.click();
    const metroMode = await waitFor(() => document.querySelector('.st-mode[data-mode="metro"]'),
      'all-hidden Settings action did not navigate');
    metroMode.click();
    history.replaceState(null, '', '#/');
    t.route();
    await waitFor(() => ids().includes('metro-trip'), 'enabling Metro did not recover the hidden metro trip');
    assert(!ids().includes('ferry-trip'), 'recovering Metro also exposed the ferry-only trip');

    t.setPreferences({ enabledModes: [] });
    t.rerender();
    await waitFor(() => document.querySelector('[data-filtered-empty]'), 'all-off Home did not render its empty page');
    assert(t.state.selection === null, 'all-off Home retained a selection');
    assert(document.body.textContent.includes('Turn on a service to see your trips.'), 'all-off copy changed');
    const allOffChange = document.querySelector('.hm-filtered-empty [data-act="settings"]');
    assert(allOffChange && allOffChange.getBoundingClientRect().height >= 44, 'all-off page has no reachable Settings action');
    allOffChange.click();
    const ferryMode = await waitFor(() => document.querySelector('.st-mode[data-mode="ferry"]'),
      'all-off Settings action did not navigate');
    ferryMode.click();
    history.replaceState(null, '', '#/');
    t.route();
    await waitFor(() => ids().includes('ferry-trip'), 'enabling Ferries did not recover the hidden ferry trip');
    assert(t.state.doc.trips.length === 2, 'empty-state recovery changed stored trips');

    // Leave the durable frame on the all-hidden state rather than a recovered one.
    t.setPreferences({ enabledModes: ['train'] });
    t.rerender();
    await waitFor(() => document.querySelector('[data-filtered-empty]'), 'could not restore all-hidden frame state');
  })()`;
}

function cacheAndAttributionScript() {
  const trainBody = { generatedAt: new Date(nowMs + 5_000).toISOString(), journeys: [train] };
  return `(async () => {
    ${browserPrelude()}
    const pending = [];
    window.fetch = (input, init = {}) => new Promise((resolve, reject) => {
      pending.push({ url: String(input), init, resolve, reject });
    });
    history.replaceState(null, '', '#/settings');
    t.route();
    await waitFor(() => document.querySelector('.st-service-set'), 'settings did not render');
    t.state.stations = [];
    pending.length = 0;

    t.setPreferences({ enabledModes: ['train'] });
    await waitFor(() => pending.length === 1, 'train replacement did not start');
    assert((t.state.body?.journeys || []).every((item) => item.line.mode === 'train'),
      'mode change did not filter the raw cache before fetch');
    pending[0].reject(new Error('train replacement failed'));
    await sleep(40);
    t.setPreferences({ enabledModes: [] });
    assert((t.state.body?.journeys || []).length === 0, 'all-off did not clear suggestions');
    t.setPreferences({ enabledModes: ['train'] });
    await waitFor(() => pending.length === 2, 're-enabled train replacement did not start');
    assert((t.state.body?.journeys || []).some((item) => item.id === 'T9'),
      'off then on did not restore eligible raw cached data immediately');
    pending[1].reject(new Error('re-enabled replacement failed'));
    await sleep(40);
    assert((t.state.body?.journeys || []).some((item) => item.id === 'T9'),
      'failed re-enabled request removed the restored cached journey');

    const trainKey = ${JSON.stringify(`${from.id}-${to.id}|train`)};
    t.state.doc.cache[trainKey] = {
      fetchedAt: ${JSON.stringify(trainBody.generatedAt)}, body: ${JSON.stringify(trainBody)}, serverStale: true
    };
    t.setPreferences({ enabledModes: ['metro'] });
    t.setPreferences({ enabledModes: ['train'] });
    assert(t.state.serverStale === true, 'cached server-stale provenance was not restored with the mode cache');
    t.state.doc.lastOpen = null;
    history.replaceState(null, '', '#/');
    t.route();
    await waitFor(() => document.querySelector('.hm-fresh .pulse.stale'), 'cached server-stale source lost its neutral dot');
    assert(document.querySelector('.hm-fresh .lbl').textContent !== 'Live', 'cached server-stale source was labeled Live');
    const firstHome = pending.at(-1);
    firstHome.resolve(new Response(${JSON.stringify(JSON.stringify(trainBody))}, { status: 200 }));
    await sleep(50);
    assert(t.state.doc.lastOpen === null, 'preference-caused refresh wrote lastOpen attribution');
    t.refresh();
    await waitFor(() => pending.at(-1) !== firstHome, 'independent refresh did not start');
    pending.at(-1).resolve(new Response(${JSON.stringify(JSON.stringify(trainBody))}, { status: 200 }));
    await waitFor(() => t.state.doc.lastOpen, 'independent refresh did not resume lastOpen attribution');
  })()`;
}

function locationScript() {
  return `(async () => {
    ${browserPrelude()}
    let fixes = 0;
    let watches = 0;
    let late = null;
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      configurable: true, value: (success) => { fixes += 1; late = success; }
    });
    Object.defineProperty(navigator.geolocation, 'watchPosition', {
      configurable: true, value: () => { watches += 1; return 1; }
    });
    t.setPreferences({ useLocation: false });
    t.state.fix = null;
    history.replaceState(null, '', '#/');
    t.route();
    await sleep(80);
    assert(fixes === 0 && watches === 0, 'location-off touched geolocation');
    history.replaceState(null, '', '#/settings');
    t.route();
    const toggle = await waitFor(() => document.querySelector('[data-act="toggle-location"]'), 'location toggle missing');
    assert(toggle.getAttribute('aria-pressed') === 'false', 'location did not start off');
    toggle.click();
    await waitFor(() => fixes === 1 && late, 'turning location on did not start a fix');
    const ask = document.querySelector('.st-location-row');
    assert(ask.dataset.act === 'request-location' && !ask.hasAttribute('aria-pressed'),
      'location did not paint the ask state before the fix resolved');
    t.setPreferences({ useLocation: false });
    t.route();
    await waitFor(() => document.querySelector('[data-act="toggle-location"]')?.getAttribute('aria-pressed') === 'false',
      'location did not turn off while its fix was pending');
    late({ timestamp: Date.now(), coords: { latitude: ${from.location.lat}, longitude: ${from.location.lon}, speed: null } });
    await sleep(40);
    assert(t.state.fix === null, 'pending location callback mutated state after location was turned off');
    assert(document.querySelector('.st-location-row')?.getAttribute('aria-pressed') === 'false',
      'pending location callback repainted after a newer Settings render');
  })()`;
}

function homeScript() {
  return `(async () => {
    ${browserPrelude()}
    const before = JSON.stringify(t.state.doc.homeVotes);
    history.replaceState(null, '', '#/settings/home');
    t.route();
    const input = await waitFor(() => document.querySelector('[data-role="home-query"]'), 'home search did not open');
    input.value = 'International Airport';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const result = await waitFor(() => document.querySelector('[data-act="pick-home"]'), 'home match did not render');
    result.click();
    await waitFor(() => document.querySelector('[data-act="automatic-home"]'), 'home override did not render');
    assert(t.state.doc.preferences.homeOverride.name === ${JSON.stringify(longHome.name)}, 'home override was not saved');
    document.querySelector('[data-act="automatic-home"]').click();
    await sleep(30);
    assert(!t.state.doc.preferences.homeOverride, 'automatic home did not remove the override');
    assert(JSON.stringify(t.state.doc.homeVotes) === before, 'automatic home changed learned votes');
  })()`;
}

function feedbackScript() {
  return `(async () => {
    ${browserPrelude()}
    const storageBefore = localStorage.getItem('trains.v1');
    const requests = [];
    let outcome = 'reject';
    window.fetch = async (input, init = {}) => {
      assert(String(input) === 'https://analytics.jeremyvun.com/feedback', 'feedback used the wrong endpoint');
      requests.push({ input: String(input), init });
      if (outcome === 'reject') throw new TypeError('offline');
      return new Response('', { status: outcome });
    };
    history.replaceState(null, '', '#/settings/feedback');
    t.route();
    const textarea = await waitFor(() => document.querySelector('[data-role="feedback-message"]'), 'feedback form did not render');
    textarea.value = 'The platform changed after I opened the app.';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    history.replaceState(null, '', '#/settings');
    t.route();
    history.replaceState(null, '', '#/settings/feedback');
    t.route();
    await waitFor(() => document.querySelector('[data-role="feedback-message"]')?.value.includes('platform changed'),
      'feedback draft did not survive navigation');
    document.querySelector('[data-act="submit-feedback"]').click();
    await waitFor(() => document.querySelector('.st-error'), 'offline feedback did not show retry copy');
    assert(document.querySelector('[data-role="feedback-message"]').value.includes('platform changed'),
      'failure cleared the feedback draft');
    outcome = 429;
    document.querySelector('[data-act="submit-feedback"]').click();
    await waitFor(() => document.querySelector('.st-error')?.textContent.includes('Wait'), 'rate-limit copy did not render');
    outcome = 201;
    document.querySelector('[data-act="submit-feedback"]').click();
    await waitFor(() => document.querySelector('.st-success'), 'feedback success did not render');
    assert(document.querySelector('[data-role="feedback-message"]').value === '', '201 did not clear the feedback draft');
    assert(localStorage.getItem('trains.v1') === storageBefore, 'feedback draft or result touched storage');
    assert(requests.every(({ init }) => init.method === 'POST' && init.credentials === 'omit'
      && init.referrerPolicy === 'no-referrer'), 'feedback request privacy options changed');
    const payload = JSON.parse(requests.at(-1).init.body);
    assert(Object.keys(payload).sort().join(',') === 'category,feedback,project', 'feedback payload has extra fields');
    assert(!localStorage.getItem('trains.analytics.v1'), 'feedback created an analytics queue on localhost');

    const message = document.querySelector('[data-role="feedback-message"]');
    message.value = '🙂'.repeat(2049);
    message.dispatchEvent(new Event('input', { bubbles: true }));
    const sent = requests.length;
    document.querySelector('[data-act="submit-feedback"]').click();
    await waitFor(() => document.querySelector('.st-error')?.textContent.includes('too long'), 'UTF-8 byte limit did not render');
    assert(requests.length === sent, 'oversized feedback reached the transport');
  })()`;
}

function feedbackFrameScript() {
  return `(async () => {
    ${browserPrelude()}
    history.replaceState(null, '', '#/settings/feedback');
    t.route();
    const textarea = await waitFor(() => document.querySelector('[data-role="feedback-message"]'), 'feedback form did not render');
    textarea.value = 'The platform changed after I opened the app.';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  })()`;
}

function themeScript() {
  return `(async () => {
    ${browserPrelude()}
    history.replaceState(null, '', '#/settings');
    t.route();
    await waitFor(() => document.querySelector('.st-theme[data-appearance="system"]'), 'appearance choices missing');
    await sleep(80);
    const selected = document.querySelector('.st-theme[data-appearance="system"]');
    selected.focus();
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(30);
    assert(document.documentElement.dataset.appearance === 'light', 'radio arrow did not apply Light: ' + JSON.stringify({
      appearance: document.documentElement.dataset.appearance,
      systemChecked: document.querySelector('.st-theme[data-appearance="system"]')?.getAttribute('aria-checked'),
      lightChecked: document.querySelector('.st-theme[data-appearance="light"]')?.getAttribute('aria-checked'),
      active: document.activeElement?.dataset.appearance,
      stored: JSON.parse(localStorage.getItem('trains.v1')).preferences
    }));
    assert(document.activeElement?.dataset.appearance === 'light', 'radio arrow did not move focus');
    document.querySelector('.st-theme[data-appearance="dark"]').click();
    assert(document.documentElement.dataset.theme === 'dark', 'manual Dark did not apply immediately');
    const stored = JSON.parse(localStorage.getItem('trains.v1'));
    assert(stored.preferences.appearance === 'dark', 'manual theme was not persisted');
  })()`;
}

async function run(name, doc, script, port, options = {}) {
  const seedPath = path.join(tmp, `${name}.json`);
  fs.writeFileSync(seedPath, JSON.stringify(doc));
  const out = options.out || path.join(tmp, `${name}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const target = new URL(baseURL);
  target.hash = options.hash || '';
  const args = [
    path.join(ROOT, 'tools/screenshot.js'), target.href, out,
    '--wait', String(options.wait || 250), '--size', options.size || '390x844',
    '--quiet', '--eval', script
  ];
  if (!options.noSeed) args.push('--seed', seedPath);
  if (options.profile) args.push('--profile', options.profile);
  if (options.media) args.push('--media', options.media);
  if (options.permission) args.push('--geo-permission', options.permission);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, CDP_PORT: String(port), TZ: 'Australia/Sydney' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`${name}: ${output.trim()}`)));
  });
}

async function runColdBoard(doc, port) {
  const profile = path.join(tmp, 'cold-board-profile');
  await run('cold-board-seed', doc, '(async () => {})()', port, { profile });
  return run('cold-board', doc, coldBoardFilterScript(), port, {
    hash: '#/board', profile, noSeed: true
  });
}

async function runHiddenFocus(doc, stations, by, refreshed, port) {
  const profile = path.join(tmp, `hidden-focus-${by}`);
  await run(`hidden-focus-${by}`, doc, hiddenFocusScript(stations, by, refreshed), port, {
    profile
  });
  await run(`hidden-focus-reload-${by}`, doc, hiddenFocusReloadScript(by, refreshed.id), port, {
    profile, noSeed: true
  });
  return run(`hidden-focus-journey-${by}`, doc, hiddenFocusJourneyScript(by, refreshed.id), port, {
    hash: '#/journey', profile, noSeed: true
  });
}

function frame(name) {
  return framesDir ? path.resolve(ROOT, framesDir, name) : null;
}

function locationFrame(name) {
  return locationFramesDir ? path.resolve(ROOT, locationFramesDir, name) : null;
}

const locationViewports = [
  { name: '390x844', size: '390x844' },
  { name: '412x732', size: '412x732' },
  { name: '360x780', size: '360x780' }
];
const locationSchemes = [
  { name: 'dark' },
  { name: 'light', media: 'prefers-color-scheme:light' }
];
const locationStates = [
  { name: 'off', permission: 'denied' },
  { name: 'ask', permission: 'prompt' },
  { name: 'blocked', permission: 'denied' },
  { name: 'on', permission: 'granted' }
];

async function runLocationFrames(doc, port) {
  for (const viewport of locationViewports) {
    for (const scheme of locationSchemes) {
      await Promise.all(locationStates.map((state, index) => run(
        `location-${state.name}-${viewport.name}-${scheme.name}`,
        state.name === 'off' ? { ...doc, preferences: { useLocation: false, enabledModes: ['train', 'metro', 'ferry'] } } : doc,
        geometryScript(locationRowScript(state.name)), port + index, {
          permission: state.permission, size: viewport.size, media: scheme.media,
          out: locationFrame(`location-${state.name}-${viewport.name}-${scheme.name}.png`) || undefined
        }
      )));
    }
  }
}

try {
  const marker = await fetch(new URL('/js/settings.js', baseURL)).then((response) => response.text());
  if (!marker.includes('export async function renderSettings')) {
    throw new Error(`${baseURL.origin} is not serving this worktree's settings module`);
  }

  const visualSeed = seed();
  const longSeed = seed({ preferences: { homeOverride: longHome, enabledModes: ['train', 'metro', 'ferry'] } });
  const allOffSeed = seed({ preferences: { useLocation: false, enabledModes: [] } });
  const serviceStations = [rhodes, bondi, kellyville, rouseHill, pyrmont, doubleBay, central, chatswood];
  const savedAt = new Date(nowMs - 86_400_000).toISOString();
  const serviceTrips = [
    { id: 'metro-trip', from: { id: kellyville.id, name: kellyville.name, location: kellyville.location }, to: { id: rouseHill.id, name: rouseHill.name, location: rouseHill.location }, createdAt: savedAt },
    { id: 'ferry-trip', from: { id: pyrmont.id, name: pyrmont.name, location: pyrmont.location }, to: { id: doubleBay.id, name: doubleBay.name, location: doubleBay.location }, createdAt: savedAt },
    { id: 'train-trip', from: { id: rhodes.id, name: rhodes.name, location: rhodes.location }, to: { id: bondi.id, name: bondi.name, location: bondi.location }, createdAt: savedAt },
    { id: 'multi-trip', from: { id: central.id, name: central.name, location: central.location }, to: { id: chatswood.id, name: chatswood.name, location: chatswood.location }, createdAt: savedAt }
  ];
  const serviceSeed = seed({
    trips: serviceTrips,
    lastViewed: { tripId: 'metro-trip', direction: 'forward' },
    preferences: { useLocation: true, enabledModes: ['train'] },
    cache: {}
  });
  const hiddenSeed = seed({
    trips: serviceTrips.slice(0, 2),
    lastViewed: { tripId: 'metro-trip', direction: 'forward' },
    preferences: { useLocation: false, enabledModes: ['train'] },
    cache: {}
  });
  const coldBoardSeed = seed({
    trips: serviceTrips,
    lastViewed: { tripId: 'ferry-trip', direction: 'forward' },
    preferences: { useLocation: false, enabledModes: ['train'] },
    cache: { [`${rhodes.id}-${bondi.id}|train`]: { fetchedAt: body.generatedAt, body } }
  });
  const focusStations = [mascot, central, kellyville, rhodes, bondi];
  const mixed = mixedJourney();
  const refreshedMixed = structuredClone(mixed);
  refreshedMixed.id = 'MIXED-FRESH';
  refreshedMixed.cancelled = true;
  refreshedMixed.arrival.estimated = new Date(nowMs + 79 * 60_000).toISOString();
  refreshedMixed.legDetail[1].arrival.estimated = refreshedMixed.arrival.estimated;
  const focusTrips = [
    {
      id: 'mixed-trip',
      from: { id: mascot.id, name: mascot.name, location: mascot.location },
      to: { id: kellyville.id, name: kellyville.name, location: kellyville.location },
      createdAt: savedAt
    },
    serviceTrips.find((trip) => trip.id === 'train-trip')
  ];
  const hiddenFocusSeed = (by) => seed({
    trips: focusTrips,
    lastViewed: { tripId: 'mixed-trip', direction: 'forward' },
    focus: {
      tripId: 'mixed-trip', direction: 'forward', focusedAt: new Date(nowMs).toISOString(), by, journey: mixed
    },
    preferences: { useLocation: false, enabledModes: ['train'] },
    cache: { [`${rhodes.id}-${bondi.id}|train`]: { fetchedAt: body.generatedAt, body } }
  });

  const only = value('--only');
  if (only === 'location-row') {
    await runLocationFrames(visualSeed, firstPort);
    console.log(`settings location-row browser checks passed${locationFramesDir
      ? `; frames written to ${path.resolve(ROOT, locationFramesDir)}` : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }
  if (only === 'service-eligibility') {
    await run('service-eligibility', serviceSeed, serviceEligibilityScript(serviceStations), firstPort, {
      permission: 'granted', out: frame('home-390x844-services-filtered.png') || undefined
    });
    console.log('settings service-eligibility browser check passed');
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }
  if (only === 'empty-recovery') {
    await run('empty-recovery', hiddenSeed, emptyRecoveryScript(), firstPort);
    console.log('settings empty-recovery browser check passed');
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }
  if (only === 'hidden-focus') {
    await runHiddenFocus(hiddenFocusSeed('focus'), focusStations, 'focus', refreshedMixed, firstPort);
    await runHiddenFocus(hiddenFocusSeed('inferred'), focusStations, 'inferred', refreshedMixed, firstPort);
    console.log('settings hidden-focus browser checks passed');
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }
  if (only === 'cold-board') {
    await runColdBoard(coldBoardSeed, firstPort);
    console.log('settings cold-board browser check passed');
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }
  if (only === 'focus-freshness') {
    await run('focus-freshness', visualSeed, focusFreshnessScript(), firstPort);
    console.log('settings focus-freshness browser check passed');
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }
  if (only === 'controller-races') {
    await run('controller-races', visualSeed, raceScript(), firstPort);
    console.log('settings controller-races browser check passed');
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }
  if (only === 'cache-attribution') {
    await run('cache-attribution', visualSeed, cacheAndAttributionScript(), firstPort);
    console.log('settings cache-attribution browser check passed');
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  }
  const checks = [
    run('settings-dark-390', visualSeed, geometryScript(locationRowScript('on')), firstPort, {
      permission: 'granted', out: frame('settings-390x844.png') || undefined
    }),
    run('settings-light-390', visualSeed, geometryScript(locationRowScript('on')), firstPort + 1, {
      permission: 'granted', media: 'prefers-color-scheme:light', out: frame('settings-390x844-light.png') || undefined
    }),
    run('settings-dark-412', visualSeed, geometryScript(locationRowScript('on')), firstPort + 2, {
      permission: 'granted', size: '412x732', out: frame('settings-412x732.png') || undefined
    }),
    run('settings-light-412', visualSeed, geometryScript(locationRowScript('on')), firstPort + 3, {
      permission: 'granted', size: '412x732', media: 'prefers-color-scheme:light',
      out: frame('settings-412x732-light.png') || undefined
    })
  ];
  await Promise.all(checks);
  await Promise.all([
    run('settings-dark-360', visualSeed, geometryScript(locationRowScript('ask')), firstPort, {
      permission: 'prompt', size: '360x780'
    }),
    run('settings-light-360', visualSeed, geometryScript(locationRowScript('ask')), firstPort + 1, {
      permission: 'prompt', size: '360x780', media: 'prefers-color-scheme:light'
    })
  ]);

  const transferSeed = (transferLimit) => seed({
    preferences: { enabledModes: ['train', 'metro', 'ferry'], transferLimit },
    flags: { transferLimit: true }
  });
  await Promise.all([
    run('transfer-limit-390', transferSeed('two'), geometryScript(transferRowScript('two')), firstPort, {
      permission: 'granted', out: frame('settings-390x844-transfer-limit.png') || undefined
    }),
    run('transfer-limit-any-390', transferSeed('any'), geometryScript(transferRowScript('any')), firstPort + 1, {
      permission: 'granted', out: frame('settings-390x844-transfer-limit-any.png') || undefined
    }),
    run('transfer-limit-light-390', transferSeed('two'), geometryScript(transferRowScript('two')), firstPort + 2, {
      permission: 'granted', media: 'prefers-color-scheme:light',
      out: frame('settings-390x844-transfer-limit-light.png') || undefined
    }),
    run('transfer-limit-412', transferSeed('two'), geometryScript(transferRowScript('two')), firstPort + 3, {
      permission: 'granted', size: '412x732', out: frame('settings-412x732-transfer-limit.png') || undefined
    })
  ]);

  await run('long-home', longSeed, geometryScript(), firstPort, {
    permission: 'granted', out: frame('settings-390x844-long-home.png') || undefined
  });
  await run('all-off', allOffSeed, geometryScript(`
    assert(document.querySelector('.st-service-empty'), 'all-off explanation missing');
    assert([...document.querySelectorAll('.st-mode:not([disabled])')].every((el) => el.getAttribute('aria-pressed') === 'false'),
      'all-off did not leave every served mode off');
  `), firstPort, { out: frame('settings-390x844-all-off.png') || undefined });
  await run('feedback-frame', visualSeed, feedbackFrameScript(), firstPort, {
    out: frame('settings-390x844-feedback.png') || undefined
  });
  await run('permission-prompt', visualSeed, geometryScript(`
    const row = document.querySelector('.st-location-row');
    assert(row?.querySelector('.st-value')?.textContent.trim() === 'Location needs permission', 'prompt state not explained');
    assert(row?.dataset.act === 'request-location', 'prompt action is not on the location row');
    assert(!row.hasAttribute('aria-pressed'), 'prompt state has toggle semantics');
    assert(!document.querySelector('.st-location-note'), 'prompt state retained a separate strip');
  `), firstPort, {
    permission: 'prompt', out: frame('settings-390x844-ask.png') || undefined
  });
  await run('permission-denied', visualSeed, geometryScript(`
    const row = document.querySelector('.st-location-row');
    assert(row?.querySelector('.st-value')?.textContent.trim() === 'Blocked in browser', 'denied state not explained');
    assert(row?.querySelector('.st-state')?.textContent.trim() === 'Turn off', 'denied state has the wrong action');
    assert(row?.dataset.act === 'toggle-location', 'denied action is not on the location row');
    assert(!row.hasAttribute('aria-pressed'), 'denied state has toggle semantics');
    assert(!document.querySelector('.st-location-note'), 'denied state retained a separate strip');
  `), firstPort, { permission: 'denied' });
  await run('location-off', allOffSeed, locationScript(), firstPort, { permission: 'granted' });
  await run('home-override', seed({ homeVotes: [
    { day: '2026-09-01', station: from }, { day: '2026-09-02', station: from }, { day: '2026-09-03', station: from }
  ] }), homeScript(), firstPort);
  await run('feedback', visualSeed, feedbackScript(), firstPort);
  await run('theme-keyboard', visualSeed, themeScript(), firstPort);
  await run('controller-races', visualSeed, raceScript(), firstPort);
  await run('focus-freshness', visualSeed, focusFreshnessScript(), firstPort);
  await run('service-eligibility', serviceSeed, serviceEligibilityScript(serviceStations), firstPort, {
    permission: 'granted', out: frame('home-390x844-services-filtered.png') || undefined
  });
  await run('empty-recovery', hiddenSeed, emptyRecoveryScript(), firstPort, {
    out: frame('home-390x844-services-empty.png') || undefined
  });
  await runHiddenFocus(hiddenFocusSeed('focus'), focusStations, 'focus', refreshedMixed, firstPort);
  await runHiddenFocus(hiddenFocusSeed('inferred'), focusStations, 'inferred', refreshedMixed, firstPort);
  await runColdBoard(coldBoardSeed, firstPort);
  await run('cache-attribution', visualSeed, cacheAndAttributionScript(), firstPort);

  console.log(`settings browser checks passed${framesDir ? `; frames written to ${path.resolve(ROOT, framesDir)}` : ''}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
