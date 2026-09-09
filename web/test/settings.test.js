import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FEEDBACK_BODY_LIMIT, FEEDBACK_LIMIT, createFeedbackDraft, feedbackPayload,
  nextChoiceIndex, services, submitFeedback, transferRow
} from '../js/settings.js';
import { homeHtml, homeModel } from '../js/home.js';
import { cacheKey, emptyDoc } from '../js/storage.js';
import { SUPPORTED_MODES } from '../js/preferences.js';
import { ferryBody, transferJourneys } from './fixture.js';

const RHODES = { id: '213820', name: 'Rhodes Station' };
const BONDI = { id: '202210', name: 'Bondi Junction Station' };
const trip = { id: 't1', from: RHODES, to: BONDI, createdAt: '2026-01-01T00:00:00Z' };
const selection = { tripId: 't1', direction: 'forward' };
const now = Date.parse('2026-09-01T09:21:00+10:00');

test('feedback validates the trimmed UTF-8 request before sending', () => {
  const draft = createFeedbackDraft();
  assert.equal(feedbackPayload(draft).error, 'Write a message before you send it.');
  draft.message = ' café ';
  assert.deepEqual(JSON.parse(feedbackPayload(draft).body), {
    project: 'ilovetrains', category: 'problem', feedback: 'café'
  });
  draft.message = 'x'.repeat(FEEDBACK_LIMIT + 1);
  assert.equal(feedbackPayload(draft).error, 'Your message is too long. Shorten it and try again.');
  draft.message = '\b'.repeat(6000);
  assert.equal(feedbackPayload(draft).error, 'Your message is too long. Shorten it and try again.',
    'JSON escaping can exceed the whole-request limit before the text limit');
  draft.message = '\0';
  assert.match(feedbackPayload(draft).error, /unsupported character/);
  assert.equal(FEEDBACK_BODY_LIMIT, 10240);
});

test('feedback uses the dedicated transport and clears only after 201', async () => {
  const draft = createFeedbackDraft();
  draft.category = 'suggestion';
  draft.message = 'Keep this if the server rejects it.';
  const calls = [];
  await submitFeedback(draft, { fetchFn: async (...args) => {
    calls.push(args);
    return { status: 503 };
  } });
  assert.equal(draft.message, 'Keep this if the server rejects it.');
  assert.match(draft.error, /unavailable/);
  const [url, options] = calls[0];
  assert.equal(url, 'https://analytics.jeremyvun.com/feedback');
  assert.deepEqual({
    method: options.method,
    credentials: options.credentials,
    referrerPolicy: options.referrerPolicy,
    contentType: options.headers['Content-Type']
  }, {
    method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
    contentType: 'application/json'
  });

  await submitFeedback(draft, { fetchFn: async () => ({ status: 201 }) });
  assert.equal(draft.message, '');
  assert.equal(draft.status, 'Feedback sent.');
});

test('one in-flight feedback request is shared across route redraws', async () => {
  const draft = createFeedbackDraft();
  draft.message = 'Only send this once.';
  let release;
  let calls = 0;
  const fetchFn = () => {
    calls++;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = submitFeedback(draft, { fetchFn });
  const second = submitFeedback(draft, { fetchFn });
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release({ status: 201 });
  await first;
});

test('appearance radio arrows wrap and support Home and End', () => {
  assert.equal(nextChoiceIndex(0, 3, 'ArrowLeft'), 2);
  assert.equal(nextChoiceIndex(0, 3, 'ArrowUp'), 2);
  assert.equal(nextChoiceIndex(0, 3, 'ArrowDown'), 1);
  assert.equal(nextChoiceIndex(2, 3, 'ArrowRight'), 0);
  assert.equal(nextChoiceIndex(1, 3, 'Home'), 0);
  assert.equal(nextChoiceIndex(1, 3, 'End'), 2);
});

test('home explains manual home and gives all-off and empty searches distinct actions', () => {
  const manual = {
    ...emptyDoc(), trips: [trip],
    preferences: { homeOverride: RHODES, enabledModes: ['train', 'metro', 'ferry'] }
  };
  const shown = homeModel(manual, selection, { journeys: transferJourneys() }, now, {
    predicted: true, leap: 'home'
  });
  assert.equal(shown.directions.receipt, 'You set Rhodes as home.');

  const off = homeModel({ ...manual, preferences: { ...manual.preferences, enabledModes: [] } },
    selection, { journeys: transferJourneys() }, now);
  assert.equal(off.directions.instruction, 'Turn on a service in Settings');
  assert.equal(off.freshness, '');
  assert.equal(off.dot, 'idle');
  assert.match(homeHtml(off), /Turn on a service in <button[^>]+>Settings<\/button>/);

  const empty = homeModel(manual, selection, { journeys: [] }, now);
  assert.equal(empty.directions.instruction, 'No services in the next few hours');
  assert.doesNotMatch(homeHtml(empty), />Change settings<\/button>/);
  const subset = homeModel({ ...manual, preferences: { ...manual.preferences, enabledModes: ['train'] } },
    selection, { journeys: [] }, now);
  assert.equal(subset.directions.instruction, 'No journeys with these services');
  assert.match(homeHtml(subset), />Change settings<\/button>/);

  const offline = homeModel(manual, selection, { journeys: [] }, now, { offline: true });
  assert.match(offline.directions.instruction, /Try again when connected/);
  const stale = homeModel(manual, selection, { journeys: [] }, now, { stale: true });
  assert.equal(stale.directions.instruction, 'No services on the last board we could load');
});

test('home never revives an excluded or superseded cached journey', () => {
  const train = transferJourneys()[0];
  const ferry = ferryBody().journeys[0];
  const doc = {
    ...emptyDoc(), trips: [trip], preferences: { enabledModes: ['train'] },
    cache: {
      [cacheKey(RHODES.id, BONDI.id)]: {
        fetchedAt: '2026-09-01T09:20:00+10:00', journeys: [], body: { journeys: [ferry, train] }
      }
    }
  };
  const cached = homeModel(doc, selection, null, now);
  assert.equal(cached.directions.journey, train, 'the eligible later journey survives the broad cache');
  const completedEmpty = homeModel(doc, selection, { journeys: [] }, now);
  assert.equal(completedEmpty.directions.journey, null, 'a successful empty search wins over old cache');
});

test('known incompatible endpoints hide saved trips while unknown endpoints remain eligible', () => {
  const wharf = { id: '2000260', name: 'Pyrmont Bay Wharf' };
  const ferryTrip = { ...trip, from: wharf };
  const doc = {
    ...emptyDoc(), trips: [ferryTrip], preferences: { enabledModes: ['train', 'metro'] }
  };
  const unknown = homeHtml(homeModel(doc, selection, null, now));
  assert.match(unknown, /data-act="open-trip"/, 'cached or unknown mode evidence cannot disable the row');

  const indexed = homeHtml(homeModel(doc, selection, null, now, {
    stations: [{ ...wharf, modes: ['ferry'] }, { ...BONDI, modes: ['train'] }]
  }));
  assert.doesNotMatch(indexed, /data-act="enable-ferries"/);
  assert.doesNotMatch(indexed, /Ferries are off/);
  assert.doesNotMatch(indexed, /data-act="open-trip"/);
});

test('settings smoke: the approved grouped controls and private feedback copy ship together', () => {
  const root = join(import.meta.dirname, '..');
  const source = readFileSync(join(root, 'js', 'settings.js'), 'utf8');
  const css = readFileSync(join(root, 'app.css'), 'utf8');
  assert.match(source, /Personal[\s\S]*Services[\s\S]*Appearance[\s\S]*Send feedback/);
  assert.match(source, /Trains[\s\S]*Metro[\s\S]*Ferries[\s\S]*Buses/);
  assert.match(source, /Don’t include personal details\./);
  assert.match(css, /\.st-service-set\s*\{[^}]*repeat\(4/);
});

/* The flag off is the before of every transfer-cap frame, so Settings must draw
   the bytes it drew at cc7f165. An intended Settings change updates these
   digests the way an intended screen change updates a baseline. */
test('the transfer limit is absent from Settings until the backend turns it on', () => {
  const digest = (markup) => createHash('sha256').update(markup).digest('hex');
  assert.equal(digest(services(SUPPORTED_MODES)),
    '98b03aebe9c9a299259313567a38ccf0ae07f70ad982bbdd51cdd60d923c38a8');
  assert.equal(digest(services([])),
    'e3413a43abc3e619b88562e8407a2a171c7465cdbee5a805b549ec458717f832');
  assert.equal(services(SUPPORTED_MODES, null), services(SUPPORTED_MODES));
  assert.doesNotMatch(services(SUPPORTED_MODES), /st-transfer-row/);
});

test('the transfer limit row shows each value with one Change action', () => {
  const direct = services(SUPPORTED_MODES, 'direct');
  const capped = services(SUPPORTED_MODES, 'two');
  const uncapped = services(SUPPORTED_MODES, 'any');

  assert.match(capped, /Trips use chosen services only\.<\/p><button class="st-person-row st-transfer-row"/);
  assert.match(capped, /<span class="st-name">Transfer limit<\/span><span class="st-value">Up to 2<\/span>/);
  assert.match(capped, /<span class="st-state">Change<\/span><\/button><\/section>/);
  assert.match(capped, /aria-label="Transfer limit, Up to 2, Change"/);
  assert.match(uncapped, /<span class="st-value">No limit<\/span>/);
  assert.match(uncapped, /<span class="st-state">Change<\/span>/);
  assert.match(uncapped, /aria-label="Transfer limit, No limit, Change"/);
  assert.match(direct, /<span class="st-value">Direct only<\/span>/);
  assert.match(direct, /aria-label="Transfer limit, Direct only, Change"/);
  assert.equal(transferRow('junk'), transferRow('two'));

  // Every service off hides the journey line, and keeps the words (round 2).
  const allOff = services([], 'two');
  assert.match(allOff, /Turn one on to see trips\.<\/p><button class="st-person-row st-transfer-row"/);
  assert.doesNotMatch(allOff, /sy-bar|st-section">Transfer/);
});

/* Tapping the row goes through the same preference path the service buttons
   use, so the board refetches instead of only repainting. */
test('the transfer limit row swaps the value through setPreferences', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'js', 'settings.js'), 'utf8');
  const branch = /if \(action === 'transfer-limit'\) \{([\s\S]*?)\n    \}/.exec(source);

  assert.ok(branch, 'the settings handler still answers the row');
  assert.match(branch[1], /current === 'direct' \? 'two' : current === 'two' \? 'any' : 'direct'/);
  assert.match(branch[1], /ctx\.setPreferences\(\{ transferLimit: next \}\)/);
  assert.match(branch[1], /paintMain\(root, ctx, permission\)/);
  assert.match(source, /flagsOf\(ctx\.doc\)\.transferLimit \? prefs\.transferLimit : null/);
});
