import { esc, mount, shortName } from './dom.js';
import { automaticHomeOf } from './predict.js';
import { flagsOf, preferencesOf } from './preferences.js';
import { MIN_QUERY, fuzzyScore, hintFor, rankStops } from './search.js';
import { loadStations } from './stations.js';
import { VERSION } from './version.js';

export const FEEDBACK_ENDPOINT = 'https://analytics.jeremyvun.com/feedback';
export const FEEDBACK_LIMIT = 8192;
export const FEEDBACK_BODY_LIMIT = 10240;
export const FEEDBACK_CATEGORIES = Object.freeze(['problem', 'suggestion', 'other']);

const renders = new WeakMap();
const handlers = new WeakMap();
const bound = new WeakSet();

export function createFeedbackDraft() {
  return { category: 'problem', message: '', error: '', status: '', inFlight: null };
}

const feedbackDraft = createFeedbackDraft();

function bytes(value) {
  return new TextEncoder().encode(value).length;
}

export function feedbackPayload(draft) {
  const category = String(draft && draft.category || '').trim().toLowerCase();
  const feedback = String(draft && draft.message || '').trim();
  if (!FEEDBACK_CATEGORIES.includes(category)) return { error: 'Choose a feedback category.' };
  if (!feedback) return { error: 'Write a message before you send it.' };
  if (feedback.includes('\0')) return { error: 'Remove the unsupported character and try again.' };
  if (bytes(feedback) > FEEDBACK_LIMIT) return { error: 'Your message is too long. Shorten it and try again.' };
  const body = JSON.stringify({ project: 'ilovetrains', category, feedback, platform: 'web', clientVersion: VERSION });
  if (bytes(body) > FEEDBACK_BODY_LIMIT) return { error: 'Your message is too long. Shorten it and try again.' };
  return { body };
}

function feedbackFailure(status) {
  if (status === 413) return 'Your message is too long. Shorten it and try again.';
  if (status === 429) return 'Too many attempts. Wait a while and try again.';
  if ([401, 403, 404, 503].includes(status)) return 'Feedback is unavailable right now. Try again later.';
  if (status === 400) return 'Check your feedback and try again.';
  return 'Feedback wasn’t sent. Try again.';
}

export function submitFeedback(draft, { fetchFn = fetch } = {}) {
  if (draft.inFlight) return draft.inFlight;
  const payload = feedbackPayload(draft);
  draft.status = '';
  draft.error = payload.error || '';
  if (payload.error) return Promise.resolve(false);

  draft.inFlight = Promise.resolve().then(() => fetchFn(FEEDBACK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload.body,
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  })).then((response) => {
    if (response && response.status === 201) {
      draft.message = '';
      draft.error = '';
      draft.status = 'Feedback sent.';
      return true;
    }
    draft.error = feedbackFailure(response ? response.status : 0);
    return false;
  }).catch(() => {
    draft.error = 'Couldn’t send feedback. Check your connection and try again.';
    return false;
  }).finally(() => { draft.inFlight = null; });
  return draft.inFlight;
}

function icon(name, cls = '') {
  const paths = {
    back: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    check: '<path d="m5 12 4 4L19 7"/>',
    off: '<circle cx="12" cy="12" r="6"/>',
    location: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7"/>',
    train: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M8 7h8M8 12h.01M16 12h.01M8 21l2-3M16 18l2 3"/>',
    metro: '<circle cx="12" cy="12" r="9"/><path d="M7.5 16V8l4.5 5 4.5-5v8"/>',
    ferry: '<path d="M4 15h16l-2.5 5h-11zM8 15V9h8v6M10 9V5h4v4M3 22c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 2-1"/>',
    bus: '<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M8 7h8v6H8zM8 16h.01M16 16h.01M8 22v-3M16 19v3"/>'
  };
  return `<svg class="${cls}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function bind(root, handler) {
  handlers.set(root, handler);
  if (bound.has(root)) return;
  bound.add(root);
  root.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]');
    if (el && root.contains(el)) handlers.get(root)?.(el.dataset.act, el, event);
  });
  root.addEventListener('keydown', (event) => {
    const current = event.target.closest('[role="radiogroup"] [role="radio"]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const choices = [...current.closest('[role="radiogroup"]').querySelectorAll('[role="radio"]')];
    const index = nextChoiceIndex(choices.indexOf(current), choices.length, event.key);
    if (index < 0) return;
    event.preventDefault();
    handlers.get(root)?.(choices[index].dataset.act, choices[index], event);
  });
}

function isCurrentRoot(root) {
  return root.isConnected && root.ownerDocument.getElementById('app') === root;
}

function activeControl(root) {
  const active = root.ownerDocument.activeElement;
  if (!active || !root.contains(active)) return '';
  if (active.classList.contains('st-location-row')) return '.st-location-row';
  if (active.dataset.mode) return `[data-mode="${active.dataset.mode}"]`;
  if (active.dataset.appearance) return `[data-appearance="${active.dataset.appearance}"]`;
  return active.dataset.act ? `[data-act="${active.dataset.act}"]` : '';
}

export function nextChoiceIndex(index, length, key) {
  if (!length || index < 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + length) % length;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % length;
  return index;
}

function shell(title, content, { back = '#/settings', backLabel = '', rail = '' } = {}) {
  const label = backLabel || (back === '#/' ? 'Home' : 'Settings');
  return `<main class="st-screen"><div class="st-top"><button class="st-back" data-act="go" data-hash="${back}">${icon('back')}${label}</button></div>
    <div class="st-mast"><h1>${esc(title)}</h1><div class="st-rule"></div></div>
    <div class="st-scroll" data-scroller>${content}</div>${rail}</main>`;
}

function section(name) {
  return `<h2 class="st-section">${esc(name)}</h2>`;
}

function stateMark(on) {
  return `<span class="st-state">${icon(on ? 'check' : 'off')}${on ? 'On' : 'Off'}</span>`;
}

function personal(prefs, automatic, permission) {
  const blocked = prefs.useLocation && permission === 'denied';
  const prompt = prefs.useLocation && permission !== 'granted' && permission !== 'denied';
  const locationValue = !prefs.useLocation ? 'Location is not used'
    : blocked ? 'Blocked in browser' : prompt ? 'Location needs permission' : 'Nearby trips use location';
  const locationAction = prompt ? 'request-location' : 'toggle-location';
  const locationMark = !prefs.useLocation ? 'Turn on' : prompt ? 'Allow' : 'Turn off';
  const pressed = !prompt && !blocked ? ` aria-pressed="${prefs.useLocation}"` : '';
  const current = prefs.homeOverride;
  const automaticName = automatic && automatic.station ? shortName(automatic.station.name) : '';
  const homeValue = current ? current.name
    : automaticName ? `Automatic — ${automaticName}` : 'Automatic';
  return `<section class="st-group">${section('Personal')}<div class="st-person">
    <button class="st-person-row st-location-row" data-act="${locationAction}"${pressed}>${icon('location')}<span class="st-copy"><span class="st-name">Use location</span><span class="st-value${blocked ? ' warn' : ''}">${esc(locationValue)}</span></span><span class="st-state">${locationMark}</span></button>
    <button class="st-person-row" data-act="home-station">${icon('home')}<span class="st-copy"><span class="st-name">Home</span><span class="st-value">${esc(homeValue)}</span></span><span class="st-person-state">${current ? 'Change' : 'Set'}${icon('next')}</span></button>
  </div></section>`;
}

function serviceButton(mode, label, on, disabled = false) {
  const accessible = `${label}, ${on ? 'on' : 'off'}${disabled ? ', not available yet' : ''}`;
  return `<button class="st-mode" data-act="toggle-mode" data-mode="${mode}" aria-label="${accessible}" aria-pressed="${on}"${disabled ? ' disabled aria-disabled="true"' : ''}>
    ${icon(mode, 'st-mode-icon')}<span class="st-mode-label">${label}</span>${stateMark(on)}</button>`;
}

const TRANSFER_VALUES = {
  direct: { value: 'Direct only', label: 'Transfer limit, Direct only, Change' },
  two: { value: 'Up to 2', label: 'Transfer limit, Up to 2, Change' },
  any: { value: 'No limit', label: 'Transfer limit, No limit, Change' }
};

/** The Personal rows' composition without an icon column: no glyph in the set
    means this, and an invented one would not be a borrow. */
export function transferRow(transferLimit) {
  const words = TRANSFER_VALUES[transferLimit] || TRANSFER_VALUES.two;
  return `<button class="st-person-row st-transfer-row" data-act="transfer-limit" aria-label="${esc(words.label)}"><span class="st-copy"><span class="st-name">Transfer limit</span><span class="st-value">${words.value}</span></span><span class="st-state">Change</span></button>`;
}

export function services(enabledModes, transferLimit = null) {
  const enabled = new Set(enabledModes);
  const allOff = enabled.size === 0;
  const note = allOff ? '<p class="st-service-empty">No services selected. Turn one on to see trips.</p>'
    : '<p class="st-service-note">Trips use chosen services only.</p>';
  return `<section class="st-group">${section('Services')}<div class="st-choice-set st-service-set" role="group" aria-label="Services">
    ${serviceButton('train', 'Trains', enabled.has('train'))}${serviceButton('metro', 'Metro', enabled.has('metro'))}${serviceButton('ferry', 'Ferries', enabled.has('ferry'))}${serviceButton('bus', 'Buses', false, true)}
  </div>${note}${transferLimit ? transferRow(transferLimit) : ''}</section>`;
}

function preview(appearance) {
  if (appearance === 'system') return '<span class="st-preview"><i class="paper"></i><i class="night"></i></span>';
  return `<span class="st-preview"><i class="${appearance === 'light' ? 'paper' : 'night'}"></i></span>`;
}

function appearanceButton(name, selected) {
  const chosen = name === selected;
  return `<button class="st-theme" data-act="appearance" data-appearance="${name}" role="radio" aria-checked="${chosen}" tabindex="${chosen ? 0 : -1}">${preview(name)}
    <span class="st-theme-copy"><span class="st-theme-label">${name[0].toUpperCase() + name.slice(1)}</span>${name === 'system' ? '<span class="st-theme-sub">Follow device</span>' : ''}</span>
    ${chosen ? icon('check', 'st-theme-mark') : ''}</button>`;
}

function appearance(selected) {
  return `<section class="st-group">${section('Appearance')}<div class="st-choice-set st-theme-set" role="radiogroup" aria-label="Appearance">
    ${appearanceButton('system', selected)}${appearanceButton('light', selected)}${appearanceButton('dark', selected)}
  </div></section>`;
}

function paintMain(root, ctx, permission) {
  const restore = activeControl(root);
  const prefs = preferencesOf(ctx.doc);
  const automatic = automaticHomeOf(ctx.doc);
  const transferLimit = flagsOf(ctx.doc).transferLimit ? prefs.transferLimit : null;
  mount(root, shell('Settings', `${personal(prefs, automatic, permission)}${services(prefs.enabledModes, transferLimit)}${appearance(prefs.appearance)}
    <div class="st-secondary"><button class="st-secondary-row" data-act="feedback"><span class="st-name">Send feedback</span>${icon('next')}</button>
    <div class="st-secondary-row passive"><span class="st-name">Version ${esc(VERSION)}</span></div></div>`, { back: '#/' }));
  bind(root, async (action, el, event) => {
    if (action === 'go') return ctx.go(el.dataset.hash);
    if (action === 'feedback') return ctx.go('#/settings/feedback');
    if (action === 'home-station') return ctx.go('#/settings/home');
    if (action === 'toggle-mode') {
      const mode = el.dataset.mode;
      const current = preferencesOf(ctx.doc).enabledModes;
      const next = current.includes(mode)
        ? current.filter((item) => item !== mode) : [...current, mode];
      ctx.setPreferences({ enabledModes: next });
      paintMain(root, ctx, permission);
      return;
    }
    if (action === 'transfer-limit') {
      const current = preferencesOf(ctx.doc).transferLimit;
      const next = current === 'direct' ? 'two' : current === 'two' ? 'any' : 'direct';
      ctx.setPreferences({ transferLimit: next });
      paintMain(root, ctx, permission);
      return;
    }
    if (action === 'appearance') {
      const selected = el.dataset.appearance;
      ctx.setPreferences({ appearance: selected });
      window.trainsAppearance?.apply(selected);
      paintMain(root, ctx, permission);
      if (event.type === 'keydown') {
        root.querySelector(`[data-appearance="${selected}"]`)?.focus();
      }
      return;
    }
    if (action === 'toggle-location') {
      const generation = (renders.get(root) || 0) + 1;
      renders.set(root, generation);
      const useLocation = !preferencesOf(ctx.doc).useLocation;
      ctx.setPreferences({ useLocation });
      paintMain(root, ctx, permission);
      if (!useLocation || permission === 'denied') return;
      const nextPermission = await ctx.requestLocation();
      if (!isCurrentRoot(root) || renders.get(root) !== generation) return;
      permission = nextPermission;
      paintMain(root, ctx, permission);
      return;
    }
    if (action === 'request-location') {
      const generation = (renders.get(root) || 0) + 1;
      renders.set(root, generation);
      const nextPermission = await ctx.requestLocation();
      if (!isCurrentRoot(root) || renders.get(root) !== generation) return;
      permission = nextPermission;
      paintMain(root, ctx, permission);
    }
  });
  if (restore) root.querySelector(restore)?.focus();
}

function homeCurrent(root, ctx, current, automatic) {
  const automaticName = automatic && automatic.station ? shortName(automatic.station.name) : 'Not available yet';
  const content = `${section('Current home')}<button class="st-current-home" data-act="change-home"><span class="st-copy"><span class="st-name">${esc(current.name)}</span><span class="st-value">Set on this phone.</span></span><span class="st-action">Change station ${icon('next')}</span></button>
    ${section('Automatic home')}<div class="st-current-home passive"><span class="st-copy"><span class="st-name">${esc(automaticName)}</span><span class="st-value">Used when you return to automatic home.</span></span></div>`;
  const rail = '<div class="st-rail"><button data-act="automatic-home">Use automatic home</button></div>';
  mount(root, shell('Home', content, { rail }));
  bind(root, (action, el) => {
    if (action === 'go') return ctx.go(el.dataset.hash);
    if (action === 'change-home') {
      const generation = (renders.get(root) || 0) + 1;
      renders.set(root, generation);
      return homePicker(root, ctx, () => renders.get(root) === generation);
    }
    if (action === 'automatic-home') {
      ctx.setPreferences({ homeOverride: null });
      ctx.go('#/settings');
    }
  });
}

async function homePicker(root, ctx, isCurrent = () => true) {
  mount(root, shell('Home station', '<div class="st-loading">Loading stations…</div>'));
  const stations = await loadStations();
  if (!isCurrent()) return;
  if (!stations) {
    mount(root, shell('Home station', '<p class="st-note warn">Station search is unavailable. Try again later.</p>'));
    bind(root, (action, el) => { if (action === 'go') ctx.go(el.dataset.hash); });
    return;
  }
  mount(root, shell('Home station', `<label class="st-field"><span class="lbl">Home station</span><input data-role="home-query" type="search" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Station name"></label><div data-role="home-results"></div>`));
  const input = root.querySelector('[data-role="home-query"]');
  const resultsEl = root.querySelector('[data-role="home-results"]');
  let results = [];

  function paint() {
    const query = input.value.trim();
    const hint = hintFor({ query, phase: query.length < MIN_QUERY ? 'idle' : 'done', count: results.length });
    if (hint) {
      resultsEl.innerHTML = `<p class="st-hint${hint.warn ? ' warn' : ''}">${esc(hint.text)}</p>`;
      return;
    }
    resultsEl.innerHTML = results.length ? `${section('Matches')}${results.slice(0, 8).map((stop, index) =>
      `<button class="st-result" data-act="pick-home" data-index="${index}"><span class="st-name">${esc(stop.name)}</span><span class="st-result-mode">${esc((stop.modes || []).join(' · '))}</span></button>`).join('')}` : '';
  }

  input.addEventListener('input', () => {
    const query = input.value.trim();
    results = query.length < MIN_QUERY ? []
      : rankStops(stations.filter((stop) => fuzzyScore(stop.name, query) > 0), query);
    paint();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !results.length) return;
    event.preventDefault();
    ctx.setPreferences({ homeOverride: results[0] });
    homeCurrent(root, ctx, results[0], automaticHomeOf(ctx.doc));
  });
  bind(root, (action, el) => {
    if (action === 'go') return ctx.go(el.dataset.hash);
    if (action === 'pick-home') {
      const stop = results[Number(el.dataset.index)];
      if (!stop) return;
      ctx.setPreferences({ homeOverride: stop });
      homeCurrent(root, ctx, stop, automaticHomeOf(ctx.doc));
    }
  });
  input.focus();
}

function feedbackForm(root, ctx) {
  const label = feedbackDraft.category[0].toUpperCase() + feedbackDraft.category.slice(1);
  const button = feedbackDraft.inFlight ? 'Sending…' : feedbackDraft.error ? 'Try again' : 'Send feedback';
  const content = `<button class="st-feedback-category" data-act="feedback-category"${feedbackDraft.inFlight ? ' disabled' : ''}><span><span class="st-name">${esc(label)}</span><span class="st-value">Category</span></span><span class="st-action">Change ${icon('next')}</span></button>
    <label class="st-field"><span class="lbl">Message</span><textarea data-role="feedback-message" placeholder="What happened?"${feedbackDraft.inFlight ? ' disabled' : ''}>${esc(feedbackDraft.message)}</textarea></label>
    <p class="st-note">Don’t include personal details.</p>
    ${feedbackDraft.error ? `<p class="st-error" role="alert">${esc(feedbackDraft.error)}</p>` : ''}${feedbackDraft.status ? `<p class="st-success" role="status">${esc(feedbackDraft.status)}</p>` : ''}`;
  const rail = `<div class="st-rail"><button data-act="submit-feedback"${feedbackDraft.inFlight ? ' disabled' : ''}>${button}</button></div>`;
  mount(root, shell('Send feedback', content, { rail }));
  root.querySelector('[data-role="feedback-message"]').addEventListener('input', (event) => {
    feedbackDraft.message = event.target.value;
    feedbackDraft.error = '';
    feedbackDraft.status = '';
  });
  const handler = (action, el) => {
    if (action === 'go') return ctx.go(el.dataset.hash);
    if (action === 'feedback-category') return feedbackCategories(root, ctx);
    if (action === 'submit-feedback') {
      submitFeedback(feedbackDraft);
      feedbackForm(root, ctx);
    }
  };
  bind(root, handler);
  const pending = feedbackDraft.inFlight;
  if (pending) pending.then(() => {
    if (isCurrentRoot(root)
        && handlers.get(root) === handler) feedbackForm(root, ctx);
  });
}

function feedbackCategories(root, ctx) {
  const content = `<div class="st-category-set" role="radiogroup" aria-label="Feedback category">${FEEDBACK_CATEGORIES.map((category) => {
    const label = category[0].toUpperCase() + category.slice(1);
    const chosen = feedbackDraft.category === category;
    return `<button class="st-radio" data-act="choose-category" data-category="${category}" role="radio" aria-checked="${chosen}" tabindex="${chosen ? 0 : -1}"><span class="st-name">${label}</span><span class="st-radio-mark"></span></button>`;
  }).join('')}</div>`;
  mount(root, shell('Feedback category', content, { back: '#/settings/feedback', backLabel: 'Send feedback' }));
  bind(root, (action, el, event) => {
    if (action === 'go') return feedbackForm(root, ctx);
    if (action === 'choose-category') {
      feedbackDraft.category = el.dataset.category;
      feedbackDraft.error = '';
      feedbackDraft.status = '';
      if (event.type === 'keydown') {
        feedbackCategories(root, ctx);
        root.querySelector(`[data-category="${feedbackDraft.category}"]`)?.focus();
        return;
      }
      feedbackForm(root, ctx);
    }
  });
}

export async function renderSettings(root, ctx, subview = '') {
  const generation = (renders.get(root) || 0) + 1;
  renders.set(root, generation);
  if (subview === 'home') {
    const prefs = preferencesOf(ctx.doc);
    if (prefs.homeOverride) homeCurrent(root, ctx, prefs.homeOverride, automaticHomeOf(ctx.doc));
    else await homePicker(root, ctx, () => isCurrentRoot(root) && renders.get(root) === generation);
    return;
  }
  if (subview === 'feedback') return feedbackForm(root, ctx);
  paintMain(root, ctx, null);
  if (!preferencesOf(ctx.doc).useLocation) return;
  const permission = await ctx.permission();
  if (isCurrentRoot(root)
      && renders.get(root) === generation) paintMain(root, ctx, permission);
}
