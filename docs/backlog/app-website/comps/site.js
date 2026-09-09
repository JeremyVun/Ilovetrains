'use strict';

const WEB_APP = 'https://ilovetrains.jeremyvun.com';

function deviceKind() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPod|iPad/i.test(ua)) return 'ios';
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return 'ios';
  return 'web';
}

function enhanceAction() {
  const action = document.querySelector('[data-device-action]');
  const dialog = document.querySelector('[data-store-dialog]');
  if (typeof HTMLDialogElement !== 'function' || !(action instanceof HTMLAnchorElement) || !(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== 'function') return;

  const title = dialog.querySelector('[data-dialog-title]');
  const body = dialog.querySelector('[data-dialog-body]');
  const close = dialog.querySelector('[data-dialog-close]');
  if (!(title instanceof HTMLElement) || !(body instanceof HTMLElement) || !(close instanceof HTMLButtonElement)) return;

  const kind = deviceKind();
  document.documentElement.dataset.device = kind;
  if (kind === 'web') return;

  const ios = kind === 'ios';
  action.textContent = ios ? 'Download on the App Store' : 'Get it on Google Play';
  title.textContent = ios ? 'App Store' : 'Google Play';
  body.textContent = ios
    ? "The iPhone app isn't available in the App Store yet. You can use ilovetrains in your browser."
    : "The Android app isn't available on Google Play yet. You can use ilovetrains in your browser.";

  const alternative = document.createElement('a');
  alternative.className = 'web-alternative';
  alternative.href = WEB_APP;
  alternative.textContent = 'Use the web app';
  action.after(alternative);

  let opener = null;
  action.addEventListener('click', (event) => {
    try {
      dialog.showModal();
    } catch {
      return;
    }
    event.preventDefault();
    opener = action;
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (opener?.isConnected) opener.focus();
    opener = null;
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function carriage(lead = false) {
  const train = svg('svg', { class: `tiny-car${lead ? ' lead' : ''}`, viewBox: '0 0 32 18', width: '32', height: '18', 'aria-hidden': 'true' });
  train.append(svg('path', { class: 'tiny-body', d: lead ? 'M1 3H25L31 7V15H1Z' : 'M1 3H31V15H1Z' }));
  for (const y of [5, 9]) {
    for (const x of [4, 9, 14, 19]) train.append(svg('rect', { class: `tiny-window ${y === 5 ? 'upper' : 'lower'}`, x, y, width: 3, height: 2 }));
  }
  if (lead) {
    train.append(svg('path', { class: 'tiny-nose', d: 'M24 3H26L31 7V15H24Z' }));
    train.append(svg('rect', { class: 'tiny-windscreen', x: 25, y: 5, width: 3, height: 4 }));
    train.append(svg('rect', { class: 'tiny-headlight', x: 29, y: 12, width: 1, height: 1 }));
  } else {
    train.append(svg('rect', { class: 'tiny-door', x: 25, y: 5, width: 3, height: 8 }));
  }
  train.append(svg('circle', { class: 'tiny-wheel', cx: 7, cy: 16, r: 1.5 }));
  train.append(svg('circle', { class: 'tiny-wheel', cx: 25, cy: 16, r: 1.5 }));
  return train;
}

function attachTrain() {
  const rail = document.querySelector('[data-train-rail]');
  const triggers = rail ? [...rail.querySelectorAll('[data-train-trigger]')] : [];
  const stage = rail?.querySelector('[data-train-stage]');
  if (!rail || !stage || !triggers.length || triggers.some((trigger) => !(trigger instanceof HTMLButtonElement))) return;

  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let consist = null;
  let timer = 0;

  const clear = () => {
    clearTimeout(timer);
    consist?.remove();
    consist = null;
    rail.classList.remove('train-running', 'train-reduced');
  };
  const run = () => {
    if (consist) return;
    consist = document.createElement('span');
    consist.className = 'tiny-consist';
    for (let index = 1; index < 6; index += 1) consist.append(carriage());
    consist.append(carriage(true));
    consist.dataset.carriages = '6';
    stage.append(consist);
    rail.style.setProperty('--rail-width', `${rail.clientWidth}px`);
    rail.classList.add(reduced.matches ? 'train-reduced' : 'train-running');
    timer = setTimeout(clear, reduced.matches ? 900 : 2750);
  };

  triggers.forEach((trigger) => trigger.addEventListener('click', run));
  reduced.addEventListener?.('change', clear);
  addEventListener('pagehide', clear, { once: true });
}

enhanceAction();
attachTrain();
