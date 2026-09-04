/* The palette is a measurement, so it is tested as one.
 *
 * docs/contracts/ui.md fixes the CONTRAST STRUCTURE of the board — primary ink at
 * ~17:1, secondary at ~8:1, labels clear of 4.5:1, the accent and every line
 * badge readable as text — and the light scheme
 * had to reach that structure with different values, not by inverting the dark
 * ones. Nothing here reads a screenshot: it parses the stylesheet's own custom
 * properties and computes WCAG relative-luminance ratios against each scheme's
 * own ground, so a plausible-looking colour that fails the bar fails the suite.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { COLOURS, lineColour, lineFill } from '../js/lines.js';

const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The two `:root` blocks, in source order: the dark scheme, then the light
    one inside `@media (prefers-color-scheme: light)`. */
function schemes() {
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2, 'app.css declares exactly two palettes');
  assert.ok(
    /@media\s*\(prefers-color-scheme:\s*light\)/.test(css),
    'the second palette is the light scheme'
  );
  return blocks.map((block) => {
    const vars = {};
    for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name] = value.trim();
    }
    return vars;
  });
}

const [dark, light] = schemes();

/* --- colour maths (WCAG 2.x) --------------------------------------------- */

function rgb(value, ground) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const rgba = value.match(/^rgba?\(([^)]+)\)$/i);
  assert.ok(rgba, 'unparseable colour: ' + value);
  const parts = rgba[1].split(',').map((n) => Number(n.trim()));
  const alpha = parts.length > 3 ? parts[3] : 1;
  // An alpha ink is only as dark as what it is painted over, so composite it
  // over its own scheme's ground before measuring. This is the step that makes
  // the light scheme need 0.75 where the dark one needs 0.66.
  return parts.slice(0, 3).map((v, i) => Math.round(v * alpha + ground[i] * (1 - alpha)));
}

function luminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(scheme, name) {
  const ground = rgb(scheme['--bg'], [0, 0, 0]);
  assert.ok(scheme[name], name + ' is declared');
  const [hi, lo] = [luminance(rgb(scheme[name], ground)), luminance(ground)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/* --- the bar ------------------------------------------------------------- */

/** [floor, ceiling] per role. The ceilings matter as much as the floors: a
    "secondary" read at 15:1 is not secondary, and the two schemes would stop
    reading as the same page. */
const STRUCTURE = {
  '--ink': [17, 21],
  '--ink-2': [7.5, 9.5],
  '--ink-3': [4.3, 5.6],
  '--warn': [4.5, 9],
  '--live': [4.5, 12]
};

for (const [scheme, name] of [[dark, 'dark'], [light, 'light']]) {
  test(`${name} scheme holds the contrast structure`, () => {
    for (const [role, [floor, ceiling]] of Object.entries(STRUCTURE)) {
      const measured = contrast(scheme, role);
      assert.ok(measured >= floor, `${name} ${role} is ${measured.toFixed(2)}:1, wanted >= ${floor}`);
      assert.ok(measured <= ceiling, `${name} ${role} is ${measured.toFixed(2)}:1, wanted <= ${ceiling}`);
    }
  });

  test(`${name} scheme hairlines are hairlines, and the two weights differ`, () => {
    const rule = contrast(scheme, '--rule');
    const rule2 = contrast(scheme, '--rule-2');
    assert.ok(rule > 1.1 && rule < 1.4, `${name} --rule is ${rule.toFixed(2)}:1`);
    assert.ok(rule2 > rule, `${name} --rule-2 must be the heavier of the two`);
  });
}

/* T1's dark-scheme #F99D1C is only 1.9:1 on a light ground, so each scheme
   needs its own readable line-badge value. */
test('every line badge is readable as text in the scheme it is printed in', () => {
  for (const code of Object.keys(COLOURS)) {
    for (const [scheme, name, floor] of [[dark, 'dark', 2.2], [light, 'light', 4.5]]) {
      const measured = contrast(scheme, '--line-' + code);
      assert.ok(measured >= floor,
        `${name} --line-${code} is ${measured.toFixed(2)}:1, wanted >= ${floor}`);
    }
  }
});

/* A code's fill defaults to its bare-text value; only the light scheme splits
   them, and only for T1 and BMT (ruling 37). */
function fillValue(scheme, code) {
  const raw = scheme['--line-fill-' + code] || dark['--line-fill-' + code];
  assert.ok(raw, 'app.css declares --line-fill-' + code);
  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw);
  return reference ? scheme[reference[1]] : raw;
}

/* The exception the owner accepted with its measurement, not with a waiver. */
const YELLOW_EXCEPTION = { codes: ['T1', 'BMT'], fill: '#F99D1C', ink: '#FAF9F5', ratio: 2.02 };

function paperRatio(value) {
  const paper = rgb(light['--bg'], [0, 0, 0]);
  const [hi, lo] = [luminance(paper), luminance(rgb(value, paper))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/* Owner ruling 2026-09-02, written into ui.md: numerals on a line-colour chip
   are paper in the light scheme, on every line. Ink on the light T4 blue is
   2.66:1 and fails the contract's own 3:1 bar for text on a fill. */
test('light-scheme chip numerals are paper, and paper clears 3:1 on every line', () => {
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*\.sy-cap,\s*\.sy-bar\s+\.sy-p,\s*\.hm-bdg,\s*\.dchip\s*\{\s*color:\s*var\(--bg\)\s*!important/);

  for (const code of Object.keys(COLOURS)) {
    if (YELLOW_EXCEPTION.codes.includes(code)) continue;
    const measured = paperRatio(fillValue(light, code));
    assert.ok(measured >= 3,
      `paper on the light --line-fill-${code} is ${measured.toFixed(2)}:1, wanted >= 3`);
  }
});

/* The pair is asserted exactly, so the accepted exception can only ever be
   changed on purpose: ruling 37 allows an imperceptible darkening after device
   evidence, never a return to the brown. */
test('light T1 and BMT fills are the exact approved yellow, an owner exception at 2.02:1', () => {
  for (const code of YELLOW_EXCEPTION.codes) {
    assert.equal(fillValue(light, code).toUpperCase(), YELLOW_EXCEPTION.fill);
    assert.equal(light['--bg'].toUpperCase(), YELLOW_EXCEPTION.ink);
    const measured = paperRatio(fillValue(light, code));
    assert.ok(Math.abs(measured - YELLOW_EXCEPTION.ratio) < 0.01,
      `the accepted exception measures ${measured.toFixed(2)}:1, recorded as ${YELLOW_EXCEPTION.ratio}:1`);
    assert.notEqual(fillValue(light, code).toUpperCase(), light['--line-' + code].toUpperCase(),
      'the fill role is the one that keeps the line identity; bare text stays darkened');
  }
});

/* js/lines.js maps the API's badge code to a custom property; if the two lists
   drift, a real line silently paints in the fallback ink instead of its own
   colour, which no screenshot of Central → Parramatta would ever show. */
test('lines.js and app.css agree on which lines exist, and on the dark values', () => {
  const declared = new Set(
    [...css.matchAll(/--line-([\w]+)\s*:/g)].map((m) => m[1])
  );
  const filled = new Set(
    [...css.matchAll(/--line-fill-([\w]+)\s*:/g)].map((m) => m[1])
  );
  for (const [code, value] of Object.entries(COLOURS)) {
    assert.ok(declared.has(code), 'app.css declares --line-' + code);
    assert.ok(filled.has(code), 'app.css declares --line-fill-' + code);
    assert.equal(dark['--line-' + code].toUpperCase(), value.toUpperCase(),
      `--line-${code} matches lines.js`);
    assert.ok(light['--line-' + code], 'the light scheme prints --line-' + code + ' too');
    // Dark is one colour twice: the split is a light-scheme fact only.
    assert.equal(fillValue(dark, code).toUpperCase(), value.toUpperCase(),
      `--line-fill-${code} is the line colour in the dark scheme`);
    assert.equal(lineFill(code), `var(--line-fill-${code})`);
    assert.equal(lineColour(code), `var(--line-${code})`);
  }
  for (const code of declared) {
    assert.ok(code in COLOURS, 'app.css declares no line lines.js has never heard of: ' + code);
  }
  for (const code of filled) {
    assert.ok(code in COLOURS, 'app.css fills no line lines.js has never heard of: ' + code);
  }
});

/* The light ground is paper, not #FFF: a page of hairlines and 250-weight
   numerals glares off pure white, and a printed timetable is never white. */
test('the light ground is warm paper', () => {
  const [r, g, b] = rgb(light['--bg'], [0, 0, 0]);
  assert.ok(r > 240 && r < 253, 'near-white, not white');
  assert.ok(r >= g && g >= b, 'warm: no more blue in it than red');
  assert.ok(r - b >= 3, 'warm enough to see');
});
