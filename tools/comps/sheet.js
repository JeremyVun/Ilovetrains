/* The contact sheet: one HTML file that makes the decision obvious without the
 * report. House style is the board v2 sheet — dark ground, letterspaced
 * small-caps captions, a `.row` of figures per direction, an `.ask` block for
 * the things to judge.
 *
 * Every word on the sheet is the comp agent's, written for the owner. Probe
 * output stays in shots/report.json; the owner ruled (2026-09-02) that an
 * auto-captioned sheet left him unable to decide anything on it.
 *
 * Usage
 *   node tools/comps/sheet.js <workshop> [--out index.html]
 *
 * Inputs: <workshop>/comps.json, <workshop>/shots/report.json and
 * <workshop>/captions.json (the shape is in tools/comps/README.md).
 * It does not open the browser; the orchestrator does that.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const manifest = require('./manifest.js');
const scenarios = require('./scenarios.js');

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0A0B0D; color: #F4F5F7;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  header { padding: 34px 34px 8px; max-width: 980px; }
  h1 { font-size: 26px; font-weight: 300; letter-spacing: -.02em; margin: 0 0 12px; }
  h2 { font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase;
       color: #F4F5F7; margin: 52px 0 4px; padding: 0 34px; }
  h3 { font-size: 10px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase;
       color: rgba(244,245,247,.46); margin: 28px 0 0; padding: 0 34px; }
  p  { color: rgba(244,245,247,.72); margin: 0 0 8px; max-width: 84ch; }
  p.note { padding: 0 34px; }
  b { color: #F4F5F7; }
  .row { display: flex; gap: 18px; overflow-x: auto; padding: 14px 34px 8px; align-items: flex-start; }
  figure { margin: 0; flex: none; width: 250px; }
  figure img { width: 250px; display: block; border: 1px solid rgba(244,245,247,.16); }
  figure.z { width: 430px; } figure.z img { width: 430px; }
  figure.zz { width: 640px; } figure.zz img { width: 640px; }
  figure.exemplar img { border-color: rgba(255,122,92,.55); }
  figcaption { font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
    color: rgba(244,245,247,.46); padding-top: 8px; line-height: 1.6; }
  figcaption b { color: #F4F5F7; font-weight: 600; }
  em { font-style: normal; color: #FF7A5C; }
  .ask { border-left: 2px solid #FF7A5C; padding: 2px 0 2px 14px; margin: 12px 34px 4px; max-width: 82ch; }
  .ask p { color: #F4F5F7; }
  table { border-collapse: collapse; margin: 10px 34px 4px; font-size: 13px; }
  th, td { text-align: left; padding: 6px 16px 6px 0; border-bottom: 1px solid rgba(244,245,247,.10);
    color: rgba(244,245,247,.72); vertical-align: top; }
  th { font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: #F4F5F7; }
  td.k { color: #F4F5F7; white-space: nowrap; }
  code { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #F4F5F7; }
  details { margin: 6px 0 0; color: rgba(244,245,247,.46); font-size: 12px; }
  details ul { margin: 6px 0 0; padding-left: 18px; } summary { cursor: pointer; }
`;

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function figure(spec, report, exemplarDir) {
  const size = spec.size ? ` ${spec.size}` : '';
  if (spec.exemplar) {
    const src = path.posix.join(exemplarDir, spec.exemplar);
    return `<figure class="exemplar${size}"><img src="${src}">`
      + `<figcaption><b>Exemplar</b> &mdash; ${spec.note || escape(spec.exemplar)}</figcaption></figure>`;
  }
  if (spec.zoom) {
    const z = report.zooms[spec.zoom];
    const src = z ? 'shots/' + z.name : 'shots/' + spec.zoom + '.png';
    const scale = z ? `${z.scale || 4}&times; of ${z.w}&times;${z.h}` : '';
    return `<figure class="${spec.size || 'z'}"><img src="${src}">`
      + `<figcaption>${spec.note || ''} ${scale ? '&mdash; <code>' + scale + '</code>' : ''}</figcaption></figure>`;
  }
  const shot = report.shots[spec.shot];
  const src = shot ? shot.file : 'shots/' + spec.shot + '.png';
  return `<figure class="${spec.size || ''}"><img src="${src}">`
    + `<figcaption>${spec.note || ''}</figcaption></figure>`;
}

function withExemplars(figures, exemplarNames, enabled) {
  if (!enabled) return figures;
  const out = [];
  for (const f of figures) {
    const twin = f.shot && exemplarNames.has(f.shot + '.png');
    if (twin && !f.noExemplar) out.push({ exemplar: f.shot + '.png', note: f.note || '' });
    out.push(f);
  }
  return out;
}

function deltaLede() {
  // The declarations are read out of the generator's own block comment, so the
  // continuation markers come with them.
  const line = (d) => `<li><b>${d.id}</b> `
    + d.text.split('.')[0].replace(/\n\s*\*\s*/g, ' ').replace(/\s+/g, ' ').trim() + '.</li>';
  return `<p>Every time, platform, line and headsign on this sheet is real, read out of `
    + `<code>tools/fixtures/</code>. Where a state cannot be shown from days with no disruption, `
    + `a named change is applied to a real service.</p>`
    + `<details><summary>What is synthetic</summary><ul>`
    + scenarios.DELTAS.concat(scenarios.HOME_DELTAS).map(line).join('')
    + `</ul></details>`;
}

function build(workshop) {
  const m = manifest.read(workshop);
  const reportFile = path.join(workshop, 'shots', 'report.json');
  if (!fs.existsSync(reportFile)) throw new Error(`no shots/report.json in ${workshop}; run shoot.js first`);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));

  const captionsFile = path.join(workshop, 'captions.json');
  if (!fs.existsSync(captionsFile)) throw new Error(`no captions.json in ${workshop}; the comp agent writes it`);
  const captions = JSON.parse(fs.readFileSync(captionsFile, 'utf8'));

  const exemplarDir = m.exemplars || 'exemplars';
  const exemplarPath = path.join(workshop, exemplarDir);
  const exemplarNames = new Set(fs.existsSync(exemplarPath) ? fs.readdirSync(exemplarPath) : []);

  const parts = [];
  parts.push('<!doctype html>\n<html lang="en"><head>\n<meta charset="utf-8">');
  parts.push(`<title>${escape(captions.title || m.title || m.round)}</title>`);
  parts.push(`<style>${STYLE}</style>\n</head><body>\n`);

  parts.push('<header>');
  parts.push(`<h1>${captions.title || m.title || m.round}</h1>`);
  for (const p of captions.lede || []) parts.push(`<p>${p}</p>`);
  parts.push(deltaLede());
  parts.push('</header>\n');

  for (const p of [].concat(captions.ask || [])) parts.push(`<div class="ask"><p>${p}</p></div>`);

  for (const section of captions.sections || []) {
    if (section.h2) parts.push(`\n<h2>${section.h2}</h2>`);
    if (section.h3) parts.push(`\n<h3>${section.h3}</h3>`);
    for (const note of [].concat(section.note || [])) parts.push(`<p class="note">${note}</p>`);
    if (section.table) {
      const t = section.table;
      parts.push('<table>');
      if (t.head) parts.push('<tr>' + t.head.map((h) => `<th>${h}</th>`).join('') + '</tr>');
      for (const row of t.rows || []) parts.push('<tr>' + row.map((c) => `<td class="k">${c}</td>`).join('') + '</tr>');
      parts.push('</table>');
    }
    const figures = withExemplars(section.figures || [], exemplarNames, section.exemplars !== false);
    if (figures.length) {
      parts.push('<div class="row">');
      for (const f of figures) parts.push('  ' + figure(f, report, exemplarDir));
      parts.push('</div>');
    }
    for (const ask of [].concat(section.ask || [])) parts.push(`<div class="ask"><p>${ask}</p></div>`);
  }

  parts.push('\n</body></html>\n');
  return parts.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const workshop = path.resolve(argv[0] || '');
  const outIndex = argv.indexOf('--out');
  const out = path.join(workshop, outIndex >= 0 ? argv[outIndex + 1] : 'index.html');
  if (!argv[0]) throw new Error('usage: sheet.js <workshop> [--out index.html]');
  fs.writeFileSync(out, build(workshop));
  console.log(out);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message || e); process.exit(1); }
}

module.exports = { build, deltaLede };
