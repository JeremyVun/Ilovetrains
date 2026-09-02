/* The probe pack: everything a screenshot cannot tell you, measured in the page
 * that produced the screenshot. Every probe is keyed on a data attribute, so a
 * comp and (later) the real client can carry the same hooks and be measured by
 * the same code. The vocabulary is documented in tools/comps/README.md.
 *
 * TRAP — the fold is not the scroller. A row clipped by an overflow:auto
 * scroller whose own bottom falls inside the viewport is invisible to a
 * viewport-relative probe, so counts and scroll position are measured against
 * [data-scroller], not against the document.
 * TRAP — text overflowing a FIXED track does not move its box's right edge, so
 * the right-edge probe is blind to it. Every leaf is scanned for scrollWidth
 * over clientWidth, with deliberate ellipsis separated from spill.
 * TRAP — text-align:right does not overflow rightwards. Chrome start-aligns an
 * over-long line box, so a right-aligned figure silently invades the column to
 * its LEFT and no overflow probe fires. Tracks are stressed with the widest
 * value their vocabulary allows, never with the scenario's value.
 * TRAP — a bare clone measures a size the page never renders. The guard that
 * saves a wide lockup is usually a class on the ROW, so the stress clones the
 * whole [data-lockup-row] through the real cascade and measures the ink inside
 * it.
 * TRAP — the overflow probes skip absolutely positioned elements, which is
 * where every mark on a time axis lives. The axis probe is what checks those:
 * it recomputes the picture from the minutes the axis claims to obey.
 */
'use strict';

const DEFAULTS = {
  tapMin: 44,
  selectors: {
    scroller: '[data-scroller]',
    item: '[data-svc]',
    past: '[data-past]',
    tap: '[data-tap], button',
    track: '[data-track]',
    ink: '[data-ink]',
    unit: '[data-unit]',
    lockupRow: '[data-lockup-row]',
    axis: '[data-axis]',
    mins: '[data-mins]',
    seg: '[data-seg]',
    pinA: '[data-pin="a"]',
    pinB: '[data-pin="b"]'
  }
};

function collect(cfg) {
  const S = cfg.selectors;
  const root = document.documentElement;
  const vw = root.clientWidth;
  const vh = root.clientHeight;
  const px = (n) => Math.round(n * 10) / 10;
  const name = (e) => (e.getAttribute('data-probe') || e.className || e.tagName).toString().trim().slice(0, 40);
  const first = (sel) => (sel ? document.querySelector(sel) : null);

  let overflow = null;
  let belowFold = null;
  document.querySelectorAll('body *').forEach((e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (getComputedStyle(e).position === 'absolute') return;
    if (r.right > vw + 0.5 && (!overflow || r.right - vw > overflow.px)) overflow = { px: Math.round(r.right - vw), tag: name(e) };
    if (r.bottom > vh + 0.5 && (!belowFold || r.bottom - vh > belowFold.px)) belowFold = { px: Math.round(r.bottom - vh), tag: name(e) };
  });

  const taps = [];
  let tapFloor = null;
  document.querySelectorAll(S.tap).forEach((e) => {
    const r = e.getBoundingClientRect();
    if (r.height <= 0) return;
    if (tapFloor === null || r.height < tapFloor) tapFloor = px(r.height);
    if (r.height < cfg.tapMin) taps.push(name(e) + ':' + Math.round(r.height));
  });

  let scroller = null;
  const sc = first(S.scroller);
  if (sc) {
    const b = sc.getBoundingClientRect();
    let whole = 0;
    sc.querySelectorAll(S.item).forEach((e) => {
      if (e.matches(S.past)) return;
      const r = e.getBoundingClientRect();
      if (r.height > 4 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5) whole++;
    });
    scroller = { whole, top: Math.round(sc.scrollTop), extent: Math.round(sc.scrollHeight - sc.clientHeight) };
  }

  const clip = [];
  const spill = [];
  document.querySelectorAll('body *').forEach((e) => {
    if (e.children.length) return;
    if (e.scrollWidth - e.clientWidth <= 1) return;
    const cs = getComputedStyle(e);
    const entry = name(e) + ':' + e.textContent.trim().slice(0, 18) + '+' + (e.scrollWidth - e.clientWidth);
    (cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible' ? clip : spill).push(entry);
  });

  const inkWidth = (e) => {
    const range = document.createRange();
    range.selectNodeContents(e);
    return Math.ceil(range.getBoundingClientRect().width);
  };

  const tracks = [];
  document.querySelectorAll(S.track).forEach((track) => {
    const lockups = (track.getAttribute('data-lockups') || '').split('|').filter(Boolean);
    if (!lockups.length) return;
    const row = track.closest(S.lockupRow) || track.parentElement;
    if (!row || !row.parentElement) return;
    const rowWidth = Math.round(row.getBoundingClientRect().width);
    const label = track.getAttribute('data-track') || name(track);
    const guards = lockups.map((l) => l.split('@')[1]).filter(Boolean);

    lockups.forEach((lockup) => {
      const [value, klass] = lockup.split('@');
      track.setAttribute('data-lockup-target', '');
      const clone = row.cloneNode(true);
      track.removeAttribute('data-lockup-target');
      clone.style.position = 'absolute';
      clone.style.top = '-4000px';
      clone.style.width = rowWidth + 'px';
      row.parentElement.appendChild(clone);
      guards.forEach((g) => clone.classList.remove(g));
      if (klass) clone.classList.add(klass);
      const twin = clone.matches('[data-lockup-target]') ? clone : clone.querySelector('[data-lockup-target]');
      const ink = twin.querySelector(S.ink) || twin;
      const unit = ink.querySelector(S.unit);
      if (unit && !/^[0-9]+$/.test(value)) unit.remove();
      const text = [...ink.childNodes].find((n) => n.nodeType === 3);
      if (text) text.nodeValue = value; else ink.textContent = value;
      const wide = inkWidth(ink);
      const box = Math.round(twin.getBoundingClientRect().width);
      clone.remove();
      tracks.push({ track: label, value, ink: wide, box, invades: wide > box });
    });
  });

  const axes = [];
  document.querySelectorAll(S.axis).forEach((axis) => {
    const spec = axis.getAttribute('data-axis') || axis.getAttribute('data-mins')
      || (axis.querySelector(S.mins) && axis.querySelector(S.mins).getAttribute('data-mins'));
    if (!spec) return;
    const mins = spec.split('/').map(Number).filter((n) => Number.isFinite(n));
    if (!mins.length) return;
    const box = axis.getBoundingClientRect();
    const total = mins.reduce((a, b) => a + b, 0) || 1;
    const want = mins.map((m) => px(box.width * m / total));
    const segs = [...axis.querySelectorAll(S.seg)];
    const drawn = segs.map((e) => px(e.getBoundingClientRect().width));
    const dev = drawn.map((v, i) => (want[i] == null ? null : px(Math.abs(v - want[i]))));
    const entry = {
      axis: name(axis), width: px(box.width), mins, drawn, want, dev,
      offScale: dev.some((d) => d != null && d > 1)
    };
    const a = axis.querySelector(S.pinA);
    const b = axis.querySelector(S.pinB);
    if (a && b) {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      entry.tailRight = px(ra.right - box.left);
      entry.headLeft = px(rb.left - box.left);
      entry.visGap = px(rb.left - ra.right);
      entry.clamped = [a, b].filter((p) => p.hasAttribute('data-clamped')).length;
    }
    axes.push(entry);
  });

  return { w: vw, h: vh, overflow, belowFold, taps, tapFloor, scroller, spill, clip, tracks, axes };
}

function source(config) {
  return `(${collect})(${JSON.stringify(config)})`;
}

function withDefaults(overrides) {
  const o = overrides || {};
  return {
    tapMin: o.tapMin || DEFAULTS.tapMin,
    selectors: Object.assign({}, DEFAULTS.selectors, o.selectors)
  };
}

/** The shooter's one line under each shot: only what went wrong, plus the two
    counts a still image cannot show. */
function summarise(r, tapMin) {
  const parts = [];
  if (r.overflow) parts.push(`OVERFLOW +${r.overflow.px}px (${r.overflow.tag})`);
  if (r.belowFold) parts.push(`BELOW FOLD +${r.belowFold.px}px (${r.belowFold.tag})`);
  if (r.taps.length) parts.push(`TAP<${tapMin} ${r.taps.slice(0, 4).join(' ')}`);
  if (r.spill.length) parts.push(`SPILL ${r.spill.slice(0, 3).join(' ')}`);
  if (r.scroller && r.scroller.whole) parts.push(`${r.scroller.whole} whole items in the scroller`);
  if (r.scroller && r.scroller.extent > 0) parts.push(`scroll ${r.scroller.top}/${r.scroller.extent}`);
  const invades = r.tracks.filter((t) => t.invades);
  if (invades.length) parts.push('TRACK INVADED ' + invades.map((t) => `${t.track}="${t.value}" ${t.ink}/${t.box}`).join(' '));
  r.axes.forEach((a) => {
    if (a.offScale) parts.push(`OFF SCALE ${a.axis} drawn ${a.drawn.join('/')} want ${a.want.join('/')} dev ${a.dev.join('/')}`);
    if (a.clamped) parts.push(`CLAMPED ${a.axis} ${a.clamped}`);
  });
  return parts.join('   ');
}

module.exports = { source, withDefaults, summarise, DEFAULTS };
