'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sheet = require('../sheet.js');

function workshop() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-comps-sheet-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  fs.writeFileSync(path.join(dir, 'comps.json'), JSON.stringify({ round: 't', concepts: ['c'], scenarios: ['hero'] }));
  fs.writeFileSync(path.join(dir, 'shots', 'report.json'), JSON.stringify({
    zooms: {},
    shots: { 'c-390x844-hero': { file: 'shots/c-390x844-hero.png', frame: '390x844',
      scroller: { whole: 6, top: 0, extent: 0 }, tapFloor: 44,
      axes: [{ width: 141, dev: [0, 0, 0], visGap: 22.4 }],
      tracks: [{ track: 'figure', value: 'Now', invades: true, ink: 93, box: 81 }],
      taps: [], spill: [] } }
  }));
  fs.writeFileSync(path.join(dir, 'captions.json'), JSON.stringify({
    title: 't', lede: ['for the owner'],
    sections: [{ h2: 'c', exemplars: false, figures: [{ shot: 'c-390x844-hero', note: 'The gap is 22px, a fifth of the bar.' }] },
      { h2: 'pair', figures: [{ shot: 'c-390x844-hero', note: 'The app.', noteExemplar: 'the design you locked' }] }]
  }));
  fs.mkdirSync(path.join(dir, 'exemplars'));
  fs.writeFileSync(path.join(dir, 'exemplars', 'c-390x844-hero.png'), '');
  return dir;
}

test('a caption is exactly what the comp agent wrote; probe output never reaches the sheet', () => {
  const html = sheet.build(workshop());
  assert.match(html, /<figcaption>The gap is 22px, a fifth of the bar\.<\/figcaption>/);
  assert.doesNotMatch(html, /invades|dev <code>|whole|taps &ge;/);
});

test('the synthetic deltas are declared, folded away under a summary', () => {
  const html = sheet.build(workshop());
  assert.match(html, /<details><summary>What is synthetic<\/summary><ul><li><b>delayed<\/b>/);
});

test('the exemplar column carries its own caption, never a copy of the shot\'s', () => {
  const html = sheet.build(workshop());
  assert.match(html, /<b>Exemplar<\/b> &mdash; the design you locked</);
  assert.strictEqual((html.match(/The app\./g) || []).length, 1);
});
