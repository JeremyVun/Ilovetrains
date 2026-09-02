/* Time formatting. Pure; all functions take explicit inputs so they are
   testable under `node --test` with TZ pinned. */

const MINUTE = 60_000;

export function parseIso(s) {
  if (typeof s !== 'string' || s === '') return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** "22:48" in the device's local timezone (the commuter is standing in it). */
export function clock(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Minutes until departure, measured between clock minutes — so the figure
    always agrees with the two clock times printed beside it, and a service
    keeps its row for the whole minute in which it leaves ("Now"). */
export function minutesUntil(ms, nowMs) {
  return Math.floor(ms / MINUTE) - Math.floor(nowMs / MINUTE);
}

/** A count of minutes as the ladder prints it:
    "Now" for the minute a thing happens in, minutes up to 99, rounded hours
    beyond that — three digits of minutes is arithmetic, and the clock time
    beside the figure already said it better. Shared by the board's rows, the
    journey's legs and smart directions so the screens can never disagree. */
export function countdownFigure(mins) {
  if (mins <= 0) return 'Now';
  if (mins >= 100) return Math.round(mins / 60) + 'H';
  return String(mins);
}

/** Footer copy, exactly the exemplar's strings (CSS uppercases them). */
export function ageLabel(seconds, offline) {
  const s = Math.max(0, Math.round(seconds));
  let magnitude;
  if (s < 60) magnitude = s + 's';
  else if (s < 3600) magnitude = Math.round(s / 60) + ' min';
  else magnitude = Math.round(s / 3600) + ' h';

  if (offline) return 'Offline · last updated ' + magnitude + ' ago';
  return (s < 60 ? 'Updated ' : 'Last updated ') + magnitude + ' ago';
}
