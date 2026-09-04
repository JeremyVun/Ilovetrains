/* A journey rendered on one percentage time axis. The platform labels overlay
   the axis; they never consume width, so every leg and dwell keeps its exact
   share of the journey at every viewport width. */

import { esc } from './dom.js';
import { effective, legsOf } from './journey.js';
import { lineFill } from './lines.js';

const KNOCKOUT = new Set(['T4', 'T5', 'T9', 'CCN', 'HUN']);

function chipInk(code) {
  return KNOCKOUT.has(code) ? 'var(--ink)' : 'var(--bg)';
}

export function platformNumber(value) {
  if (!value) return '';
  return String(value).replace(/^platform\s+/i, '');
}

function positiveMinutes(from, to) {
  if (from === null || to === null) return 0;
  // The timetable UI prints whole clock minutes, so the axis must measure the
  // same endpoints the user can read. This is the established
  // floor-to-clock-minute rule: 09:24:18 → 09:51:36 is 27 printed minutes,
  // not a hidden 27.3-minute segment beside labels saying 09:24 and 09:51.
  return Math.max(0, Math.floor(to / 60000) - Math.floor(from / 60000));
}

export function journeyBarSpec(journey, opts = {}) {
  const legs = legsOf(journey, opts);
  if (!legs.length) return { legs: [{ minutes: 1, code: '' }], dwell: 0, total: 1 };

  const parts = legs.map((leg) => ({
    code: (leg.line && leg.line.name) || '',
    minutes: positiveMinutes(effective(leg.departure), effective(leg.arrival)),
    fromPlatform: platformNumber(leg.from && leg.from.platform),
    toPlatform: platformNumber(leg.to && leg.to.platform)
  }));
  const dwells = [];
  for (let i = 1; i < legs.length; i++) {
    dwells.push(positiveMinutes(effective(legs[i - 1].arrival), effective(legs[i].departure)));
  }
  const dwell = dwells.reduce((sum, n) => sum + n, 0);
  const total = parts.reduce((sum, leg) => sum + leg.minutes, 0) + dwell || 1;
  return { legs: parts, dwells, dwell, total };
}

export function journeyVars(spec) {
  const first = spec.legs[0] || {};
  const second = spec.legs[1] || first;
  return `--stem:${lineFill(first.code || 'T7')};`
    + `--stem2:${lineFill(second.code || first.code || 'T7')};`
    + `--chipink:${chipInk(first.code)};--chipink2:${chipInk(second.code)};`;
}

function changeAt(opts, index) {
  return Array.isArray(opts.changes) ? opts.changes[index] || null : null;
}

/** Render every segment by cumulative percentages. Supports any leg count;
    the current comps exercise one and two legs, but the seam does not assume it. */
export function journeyBarHtml(spec, opts = {}) {
  const total = spec.total || 1;
  let cursor = 0;
  let html = `<span class="sy-spec" data-mins="${esc(axisSignature(spec))}"></span>`;
  let caps = '';

  spec.legs.forEach((leg, index) => {
    const start = cursor / total * 100;
    const end = (cursor + leg.minutes) / total * 100;
    html += `<span class="sy-r${index === 0 ? ' a' : index === 1 ? ' b' : ''} leg-${index}" data-seg data-line-code="${esc(leg.code)}" style="left:${start}%;width:${end - start}%;background:${lineFill(leg.code || 'T7')}"></span>`;
    cursor += leg.minutes;
    if (index < spec.legs.length - 1) {
      const change = changeAt(opts, index);
      const tight = change ? change.tight === true : Boolean(opts.tight);
      const dwell = spec.dwells[index] || 0;
      const dwellStart = cursor / total * 100;
      const dwellEnd = (cursor + dwell) / total * 100;
      html += `<span class="sy-g0${tight ? ' warn' : ''}" data-seg data-transfer-gap="${index}"${tight ? ' data-tight-gap="true"' : ''} style="left:${dwellStart}%;width:${dwellEnd - dwellStart}%"></span>`;
      if (opts.caps !== false && leg.toPlatform && spec.legs[index + 1].fromPlatform) {
        const next = spec.legs[index + 1];
        const station = opts.stations && change && change.station
          ? `<span class="sy-pstn" data-transfer-station data-transfer-index="${index}">${esc(change.station)}</span>` : '';
        const paint = (code) => `background:${lineFill(code || 'T7')};color:${chipInk(code)}`;
        caps += `<span class="sy-p a" data-pin="a" data-line-code="${esc(leg.code)}" data-transfer-index="${index}" style="right:${100 - dwellStart}%;${paint(leg.code)}">${esc(leg.toPlatform)}</span>`
          + `<span class="sy-p b" data-pin="b" data-next-platform-marker data-transfer-platform data-line-code="${esc(next.code)}" data-transfer-index="${index}" style="left:${dwellEnd}%;${paint(next.code)}"><span class="sy-pv">${esc(next.fromPlatform)}</span>${station}</span>`;
      }
      cursor += dwell;
    }
  });

  if (opts.progress) {
    const at = Math.max(0, Math.min(1, opts.progress.at || 0));
    if (at > 0) html += `<span class="sy-dim" style="width:${at * 100}%"></span>`;
    html += `<span class="sy-mk ${esc(opts.progress.phase || 'pre')}" style="left:${at * 100}%"><i></i></span>`;
  }
  // Platform numerals paint last. They remain readable when the continuous
  // marker passes through their territory and never inherit the travelled dim.
  return html + caps;
}

export function journeyDeviceHtml(journey, opts = {}) {
  const spec = journeyBarSpec(journey, opts);
  const first = spec.legs[0] || {};
  const cap = opts.showBoardingPlatform === false || !first.fromPlatform
    ? '' : `<span class="sy-cap" data-line-code="${esc(first.code)}">Platform ${esc(first.fromPlatform)}</span>`;
  return {
    spec,
    vars: journeyVars(spec),
    html: `<span class="sy-j">${cap}<span class="sy-bar" data-axis="${esc(axisSignature(spec))}">${journeyBarHtml(spec, opts)}</span></span>`
  };
}

export function axisSignature(spec) {
  const out = [];
  spec.legs.forEach((leg, index) => {
    out.push(Number(leg.minutes.toFixed(4)));
    if (index < spec.legs.length - 1) out.push(Number((spec.dwells[index] || 0).toFixed(4)));
  });
  return out.join('/');
}

/** Clamp only a platform box that would physically leave its time-axis. */
export function clampJourneyBars(root = document) {
  root.querySelectorAll('.sy-bar').forEach((bar) => {
    const bounds = bar.getBoundingClientRect();
    bar.querySelectorAll('.sy-p').forEach((platform) => {
      const rect = platform.getBoundingClientRect();
      if (rect.right > bounds.right + 0.5) {
        platform.style.left = 'auto';
        platform.style.right = '0';
        platform.dataset.clamped = '1';
      } else if (rect.left < bounds.left - 0.5) {
        platform.style.right = 'auto';
        platform.style.left = '0';
        platform.dataset.clamped = '1';
      }
    });
  });
}
