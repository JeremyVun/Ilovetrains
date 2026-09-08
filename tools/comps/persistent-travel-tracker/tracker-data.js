/* Round 4 uses the seeded Mascot → Central → Kellyville timetable.
 * Source: tools/shoot-states.js:296-327 and the current Mascot focused exemplar.
 * Base schedule: 04:38 / 04:49 / 04:56 / 05:46, platforms 21 / 26 / 2.
 * The three review clocks are synthetic transcription states, not observed position.
 * U1 removes only the final platform.
 * T1 moves only the onward departure to 04:53; the true axis becomes 11/4/53.
 * O1 retains the 04:44 state and adds offline provenance last updated at 04:42.
 * L1 substitutes the captured long station name “Bondi Junction” only to test fit.
 */
'use strict';

var TRACKER_STATES = {
  ontrain: {
    stage: 'ride', now: '04:44', from: 'Mascot', destination: 'Kellyville',
    depart: '04:38', arrive: '05:46', interchange: 'Central',
    offPlatform: '21', onPlatform: '26', finalPlatform: '2',
    line1: 'T8', line2: 'M1', onwardDeparture: '04:56',
    segments: [11, 7, 50], progress: 6, timer: '5', timerUnit: 'min',
    timerLabel: 'GET OFF IN', changeWindow: '7 min change',
    freshness: 'LIVE', updated: '', longHeadsign: ''
  },
  transfer: {
    stage: 'transfer', now: '04:52', from: 'Mascot', destination: 'Kellyville',
    depart: '04:38', arrive: '05:46', interchange: 'Central',
    offPlatform: '21', onPlatform: '26', finalPlatform: '2',
    line1: 'T8', line2: 'M1', onwardDeparture: '04:56',
    segments: [11, 7, 50], progress: 14, timer: '4', timerUnit: 'min',
    timerLabel: 'M1 LEAVES IN', changeWindow: 'Departs 04:56',
    freshness: 'LIVE', updated: '', longHeadsign: ''
  },
  final: {
    stage: 'final', now: '05:39', from: 'Mascot', destination: 'Kellyville',
    depart: '04:38', arrive: '05:46', interchange: 'Central',
    offPlatform: '21', onPlatform: '26', finalPlatform: '2',
    line1: 'T8', line2: 'M1', onwardDeparture: '04:56',
    segments: [11, 7, 50], progress: 61, timer: '7', timerUnit: 'min',
    timerLabel: 'GET OFF IN', changeWindow: '',
    freshness: 'LIVE', updated: '', longHeadsign: ''
  },
  'unknown-platform': {
    stage: 'final', now: '05:39', from: 'Mascot', destination: 'Kellyville',
    depart: '04:38', arrive: '05:46', interchange: 'Central',
    offPlatform: '21', onPlatform: '26', finalPlatform: '',
    line1: 'T8', line2: 'M1', onwardDeparture: '04:56',
    segments: [11, 7, 50], progress: 61, timer: '7', timerUnit: 'min',
    timerLabel: 'GET OFF IN', changeWindow: '',
    freshness: 'LIVE', updated: '', longHeadsign: ''
  },
  'tight-transfer': {
    stage: 'transfer', now: '04:52', from: 'Mascot', destination: 'Kellyville',
    depart: '04:38', arrive: '05:46', interchange: 'Central',
    offPlatform: '21', onPlatform: '26', finalPlatform: '2',
    line1: 'T8', line2: 'M1', onwardDeparture: '04:53',
    segments: [11, 4, 53], progress: 14, timer: '1', timerUnit: 'min',
    timerLabel: 'M1 LEAVES IN', changeWindow: 'Tight change · departs 04:53',
    freshness: 'LIVE', updated: '', warning: true, longHeadsign: ''
  },
  'offline-stale': {
    stage: 'ride', now: '04:44', from: 'Mascot', destination: 'Kellyville',
    depart: '04:38', arrive: '05:46', interchange: 'Central',
    offPlatform: '21', onPlatform: '26', finalPlatform: '2',
    line1: 'T8', line2: 'M1', onwardDeparture: '04:56',
    segments: [11, 7, 50], progress: 6, timer: '5', timerUnit: 'min',
    timerLabel: 'GET OFF IN', changeWindow: '7 min change',
    freshness: 'OFFLINE', updated: 'Last updated 04:42', degraded: true, longHeadsign: ''
  },
  'long-content': {
    stage: 'ride', now: '04:44', from: 'Mascot', destination: 'Kellyville',
    depart: '04:38', arrive: '05:46', interchange: 'Bondi Junction',
    offPlatform: '21', onPlatform: '26', finalPlatform: '2',
    line1: 'T8', line2: 'M1', onwardDeparture: '04:56',
    segments: [11, 7, 50], progress: 6, timer: '5', timerUnit: 'min',
    timerLabel: 'GET OFF IN', changeWindow: '7 min change',
    freshness: 'LIVE', updated: '', longHeadsign: ''
  }
};

function trackerScenario() {
  var key = new URLSearchParams(location.search).get('s') || 'ontrain';
  return { key: key, state: TRACKER_STATES[key] || TRACKER_STATES.ontrain };
}
