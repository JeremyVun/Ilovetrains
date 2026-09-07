/* A journey rendered on one percentage time axis. The platform labels overlay
   the axis; they never consume width, so every leg and dwell keeps its exact
   share of the journey at every viewport width. */

import { esc } from './dom.js';
import { boardingCapLabel, boardingLabel, effective, legsOf, modeWords, platformNumber, transferPlatformChip } from './journey.js';
import { colourKey, lineFill } from './lines.js';

const KNOCKOUT = new Set(['T4', 'T5', 'T9', 'CCN', 'HUN']);

export function chipInk(code) {
  return KNOCKOUT.has(code) ? 'var(--ink)' : 'var(--bg)';
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

  const parts = legs.map((leg) => {
    const line = leg.line || {};
    const words = modeWords(line.mode);
    const fromPlatform = platformNumber(leg.from && leg.from.platform);
    const toPlatform = platformNumber(leg.to && leg.to.platform);
    return {
      code: line.name || '',
      colourKey: colourKey(line),
      mode: String(line.mode || '').toLowerCase(),
      place: words.place,
      minutes: positiveMinutes(effective(leg.departure), effective(leg.arrival)),
      fromRaw: String(leg.from && leg.from.platform || ''),
      fromStop: String(leg.from && leg.from.name || ''),
      toStop: String(leg.to && leg.to.name || ''),
      fromPlatform,
      toPlatform,
      fromLabel: boardingLabel(leg.from && leg.from.platform, line.mode),
      toLabel: boardingLabel(leg.to && leg.to.platform, line.mode),
      fromChip: transferPlatformChip(leg.from && leg.from.platform, line.mode) || '—',
      toChip: transferPlatformChip(leg.to && leg.to.platform, line.mode) || '—'
    };
  });
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
  return `--stem:${lineFill(first.colourKey || 'T7')};`
    + `--stem2:${lineFill(second.colourKey || first.colourKey || 'T7')};`
    + `--chipink:${chipInk(first.colourKey)};--chipink2:${chipInk(second.colourKey)};`;
}

function changeAt(opts, index) {
  return Array.isArray(opts.changes) ? opts.changes[index] || null : null;
}

function ferryTransferHtml(label, chip, role, stop) {
  return `<span class="sy-pv" data-ferry-location="${esc(label)}" data-role="${role}" data-stop="${esc(stop)}">${esc(chip)}</span>`;
}

/** Render every segment by cumulative percentages. Supports any leg count;
    the current comps exercise one and two legs, but the seam does not assume it. */
export function journeyBarHtml(spec, opts = {}) {
  const total = spec.total || 1;
  let cursor = 0;
  let html = `<span class="sy-spec" data-mins="${esc(axisSignature(spec))}"></span>`;
  let caps = '';
  const travelling = ['ride', 'ride2', 'dwell'].includes(opts.progress?.phase);

  spec.legs.forEach((leg, index) => {
    const start = cursor / total * 100;
    const end = (cursor + leg.minutes) / total * 100;
    html += `<span class="sy-r${index === 0 ? ' a' : index === 1 ? ' b' : ''} leg-${index}" data-seg style="left:${start}%;width:${end - start}%"><span class="sy-rp" data-line-code="${esc(leg.code)}" data-colour-key="${esc(leg.colourKey)}" style="background:${lineFill(leg.colourKey || 'T7')}"></span></span>`;
    cursor += leg.minutes;
    if (index < spec.legs.length - 1) {
      const change = changeAt(opts, index);
      const tight = change ? change.tight === true : Boolean(opts.tight);
      const dwell = spec.dwells[index] || 0;
      const dwellStart = cursor / total * 100;
      const dwellEnd = (cursor + dwell) / total * 100;
      html += `<span class="sy-g0${tight ? ' warn' : ''}" data-seg data-transfer-gap="${index}"${tight ? ' data-tight-gap="true"' : ''} style="left:${dwellStart}%;width:${dwellEnd - dwellStart}%"></span>`;
      const next = spec.legs[index + 1];
      const station = opts.stations && change && change.station
        ? `<span class="sy-pstn${travelling ? ' travelling' : ''}" data-transfer-station data-transfer-index="${index}" data-midpoint="${(dwellStart + dwellEnd) / 2}" style="left:${(dwellStart + dwellEnd) / 2}%">${esc(change.station)}</span>` : '';
      const ferryTransfer = leg.mode === 'ferry' || next.mode === 'ferry';
      const locationsKnown = ferryTransfer
        ? leg.toLabel || next.fromLabel || station
        : leg.toLabel && next.fromLabel;
      if (opts.caps !== false && locationsKnown) {
        const paint = (key) => `background:${lineFill(key || 'T7')};color:${chipInk(key)}`;
        if (!ferryTransfer) {
          caps += `<span class="sy-p a" data-pin="a" data-line-code="${esc(leg.code)}" data-transfer-index="${index}" aria-label="${esc(`${leg.toLabel} · ${leg.code}`)}" style="right:${100 - dwellStart}%;${paint(leg.colourKey)}">${esc(leg.toChip)}</span>`
            + `<span class="sy-p b" data-pin="b" data-next-platform-marker data-transfer-platform data-line-code="${esc(next.code)}" data-transfer-index="${index}" aria-label="${esc(`${next.fromLabel} · ${next.code}`)}" style="left:${dwellEnd}%;${paint(next.colourKey)}"><span class="sy-pv">${esc(next.fromChip)}</span></span>`;
        } else {
          const alightFerry = leg.mode === 'ferry';
          const boardFerry = next.mode === 'ferry';
          const alight = alightFerry
            ? ferryTransferHtml(leg.toLabel, leg.toChip, 'alight', leg.toStop)
            : esc(leg.toChip);
          const board = boardFerry
            ? ferryTransferHtml(next.fromLabel, next.fromChip, 'board', next.fromStop)
            : `<span class="sy-pv">${esc(next.fromChip)}</span>`;
          if (leg.toLabel) {
            caps += `<span class="sy-p a" data-pin="a" data-line-code="${esc(leg.code)}" data-transfer-index="${index}" aria-label="${esc(`${leg.toLabel} · ${leg.code}`)}" style="right:${100 - dwellStart}%;${paint(leg.colourKey)}">${alight}</span>`;
          }
          if (next.fromLabel) {
            caps += `<span class="sy-p b" data-pin="b" data-next-platform-marker data-transfer-platform data-line-code="${esc(next.code)}" data-transfer-index="${index}" aria-label="${esc(`${next.fromLabel} · ${next.code}`)}" style="left:${dwellEnd}%;${paint(next.colourKey)}">${board}</span>`;
          } else if (!leg.toLabel && station) {
            caps += `<span class="sy-p b" data-pin="b" data-next-platform-marker data-transfer-platform data-line-code="${esc(next.code)}" data-transfer-index="${index}" aria-label="— · ${esc(next.code)}" style="left:${dwellEnd}%;${paint(next.colourKey)}"><span class="sy-pv">—</span></span>`;
          }
        }
        caps += station;
      }
      cursor += dwell;
    }
  });

  if (travelling) {
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
  const capAttrs = first.mode === 'ferry'
    ? ` data-ferry-location="${esc(first.fromLabel)}" data-role="origin" data-stop="${esc(first.fromStop)}" aria-label="${esc(first.fromLabel)}"` : '';
  const cap = opts.showBoardingPlatform === false || !first.fromLabel
    ? '' : `<span class="sy-cap" data-line-code="${esc(first.code)}"${capAttrs}>${esc(boardingCapLabel(first.fromRaw, first.mode))}</span>`;
  return {
    spec,
    vars: journeyVars(spec),
    html: `<span class="sy-j${opts.stations && opts.changes?.length ? ' has-changes' : ''}">${cap}<span class="sy-bar" data-axis="${esc(axisSignature(spec))}">${journeyBarHtml(spec, opts)}</span></span>`
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
    // Paint meets the resolved chip interior while the percentage span remains the time axis.
    const paintEdges = new Map();
    bar.querySelectorAll('.sy-p[data-transfer-index]').forEach((platform) => {
      if (!platform.getClientRects().length) return;
      const index = Number(platform.dataset.transferIndex);
      const arriving = platform.dataset.pin === 'a';
      const ride = bar.querySelector(`.leg-${arriving ? index : index + 1}`);
      if (!ride) return;
      const rideBounds = ride.getBoundingClientRect();
      const platformBounds = platform.getBoundingClientRect();
      const platformStyle = getComputedStyle(platform);
      const radius = Math.min(platformBounds.width / 2, parseFloat(arriving
        ? platformStyle.borderTopRightRadius : platformStyle.borderTopLeftRadius) || 0);
      const interiorStart = platformBounds.left + radius;
      const interiorEnd = platformBounds.right - radius;
      const edges = paintEdges.get(ride) || { left: 0, right: 0 };
      if (arriving) {
        const end = Math.max(interiorStart, Math.min(interiorEnd, rideBounds.right));
        edges.right = rideBounds.right - end;
      } else {
        const start = Math.max(interiorStart, Math.min(interiorEnd, rideBounds.left));
        edges.left = start - rideBounds.left;
      }
      paintEdges.set(ride, edges);
    });
    bar.querySelectorAll('.sy-r').forEach((ride) => {
      const paint = ride.querySelector('.sy-rp');
      if (!paint) return;
      const edges = paintEdges.get(ride) || { left: 0, right: 0 };
      paint.style.left = `${edges.left}px`;
      paint.style.right = `${edges.right}px`;
    });
    // Long change names can wrap or stack without moving the time axis.
    const device = bar.closest('.sy-j');
    if (!device) return;
    const deviceBounds = device.getBoundingClientRect();
    const placed = [];
    bar.querySelectorAll('[data-transfer-station]').forEach((label) => {
      label.style.maxWidth = `${deviceBounds.width}px`;
      label.style.left = `${label.dataset.midpoint}%`;
      label.style.top = '';
      let rect = label.getBoundingClientRect();
      const shift = Math.max(deviceBounds.left - rect.left, Math.min(0, deviceBounds.right - rect.right));
      if (shift) label.style.left = `${rect.left + rect.width / 2 - bounds.left + shift}px`;
      rect = label.getBoundingClientRect();
      for (const previous of placed) {
        if (rect.left < previous.right + 6 && rect.right > previous.left - 6
            && rect.top < previous.bottom + 6) {
          label.style.top = `${previous.bottom + 6 - bounds.top}px`;
          rect = label.getBoundingClientRect();
        }
      }
      placed.push(rect);
    });
    const extra = Math.max(0, ...placed.map((rect) => rect.bottom - deviceBounds.bottom));
    device.style.setProperty('--transfer-space', `${Math.ceil(extra)}px`);
  });
}
