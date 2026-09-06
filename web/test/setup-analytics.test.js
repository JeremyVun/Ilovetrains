import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSetup } from '../js/setup.js';
import { emptyDoc } from '../js/storage.js';

const RHODES = {
  id: '213820', name: 'Rhodes Station', modes: ['train'],
  location: { lat: -33.8299, lon: 151.0866 }
};
const BONDI = {
  id: '202210', name: 'Bondi Junction Station', modes: ['train'],
  location: { lat: -33.8915, lon: 151.2477 }
};

class Input {
  constructor() {
    this.value = '';
    this.listeners = {};
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  focus() { this.listeners.focus?.(); }
  blur() {}
  emit(name, event = {}) { this.listeners[name]?.(event); }
}

function screen() {
  const inputs = { from: new Input(), to: new Input() };
  const results = { innerHTML: '' };
  const save = { disabled: true, textContent: '' };
  const handlers = {};
  const root = {
    isConnected: true,
    innerHTML: '',
    querySelector(selector) {
      if (selector === '[data-role="from"]') return inputs.from;
      if (selector === '[data-role="to"]') return inputs.to;
      if (selector === '[data-t="results"]') return results;
      if (selector === '[data-t="save"]') return save;
      return null;
    },
    addEventListener(name, fn) { handlers[name] = fn; },
    contains: () => true,
    click(action, index = 0) {
      const element = { dataset: { act: action, index: String(index) } };
      element.closest = () => element;
      handlers.click({ target: element });
    }
  };
  return { root, inputs, results, save };
}

function context(doc, overrides = {}) {
  const events = [];
  const saves = [];
  return {
    doc,
    events,
    saves,
    permission: async () => 'denied',
    fix: async () => null,
    update(next) { this.doc = next; },
    shownSetup(f) { events.push({ t: 'shown_setup', f }); },
    track(t) { events.push({ t }); },
    saveTrip(...args) { saves.push(args); },
    go() {},
    ...overrides
  };
}

const settle = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

test('setup reports whether From was empty or prefilled', async (t) => {
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  t.after(() => {
    globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => [RHODES, BONDI] });

  const empty = screen();
  globalThis.document = { getElementById: () => empty.root };
  const emptyCtx = context(emptyDoc());
  await renderSetup(empty.root, emptyCtx);
  assert.deepEqual(emptyCtx.events[0], { t: 'shown_setup', f: 'empty' });

  empty.root.isConnected = false;
  const filled = screen();
  globalThis.document = { getElementById: () => filled.root };
  const filledCtx = context({ ...emptyDoc(), trips: [{
    id: 't1', from: RHODES, to: BONDI, createdAt: new Date(0).toISOString()
  }] });
  await renderSetup(filled.root, filledCtx, { origin: RHODES });
  assert.deepEqual(filledCtx.events[0], { t: 'shown_setup', f: 'location' });
  await settle();
  filled.root.isConnected = false;
});

test('location-off setup neither checks permission nor offers a location row', async (t) => {
  const priorDocument = globalThis.document;
  t.after(() => { globalThis.document = priorDocument; });
  const view = screen();
  globalThis.document = { getElementById: () => view.root };
  let permissionCalls = 0;
  let fixCalls = 0;
  const ctx = context({ ...emptyDoc(), preferences: { useLocation: false } }, {
    permission: async () => { permissionCalls++; return 'prompt'; },
    fix: async () => { fixCalls++; return null; }
  });

  await renderSetup(view.root, ctx);
  assert.equal(permissionCalls, 0);
  assert.equal(fixCalls, 0);
  assert.ok(!/Use my location/.test(view.results.innerHTML));
  assert.ok(!ctx.events.some((event) => event.t === 'asked_setup'));
  view.root.isConnected = false;
});

test('a superseded setup location request emits only the current outcome', async (t) => {
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  t.after(() => {
    globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => [RHODES, BONDI] });

  const view = screen();
  globalThis.document = { getElementById: () => view.root };
  const pending = [];
  const doc = { ...emptyDoc(), trips: [{
    id: 't1', from: RHODES, to: BONDI, createdAt: new Date(0).toISOString()
  }] };
  const ctx = context(doc, {
    permission: async () => 'prompt',
    fix: () => new Promise((resolve) => pending.push(resolve))
  });
  await renderSetup(view.root, ctx);
  await settle();
  assert.ok(ctx.events.some((event) => event.t === 'asked_setup'));

  view.root.click('use-location');
  view.root.click('use-location');
  pending[0](null);
  await settle();
  assert.ok(!ctx.events.some((event) => event.t === 'denied_setup'));

  pending[1]({ ...RHODES.location, at: Date.now() });
  await settle();
  assert.equal(ctx.events.filter((event) => event.t === 'granted_setup').length, 1);
  view.root.isConnected = false;
});

test('editing a prefilled redirect origin resets the save to search', async (t) => {
  const priorDocument = globalThis.document;
  const priorFetch = globalThis.fetch;
  t.after(() => {
    globalThis.document = priorDocument;
    globalThis.fetch = priorFetch;
  });
  globalThis.fetch = async () => ({ ok: true, json: async () => [RHODES, BONDI] });

  const view = screen();
  globalThis.document = { getElementById: () => view.root };
  const doc = {
    ...emptyDoc(),
    searches: { from: [RHODES], to: [BONDI] },
    trips: [{ id: 't1', from: RHODES, to: BONDI, createdAt: new Date(0).toISOString() }]
  };
  const ctx = context(doc);
  const redirect = { journeyKey: 'departure', departureMs: 1 };
  await renderSetup(view.root, ctx, { origin: RHODES, redirect });

  view.root.click('pick', 0);
  view.inputs.from.value = '';
  view.inputs.from.emit('input');
  view.root.click('pick', 0);
  assert.equal(view.save.disabled, false);
  view.root.click('save');

  assert.equal(ctx.saves.length, 1);
  assert.equal(ctx.saves[0][1], null);
  assert.equal(ctx.saves[0][2], 'search');
  await settle();
  view.root.isConnected = false;
});
