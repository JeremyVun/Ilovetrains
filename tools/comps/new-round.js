/* Scaffold a comps workshop: one disposable directory that a fresh agent can
 * reclaim the round from, holding the product's real stylesheet, the round's
 * real data, the manifest, the calibration exemplars and the report skeleton.
 * The repo stays untouched by a round until its verdict.
 *
 * Usage
 *   node tools/comps/new-round.js <name> [--from <workshop>] [--manifest <comps.json>] [--regen base,data]
 *
 * `--from` inherits the previous round's files verbatim, which is what
 * iterating on a winner needs: a comp must render against the same cascade the
 * exemplar was shot with. Generated files are written only where the inherited
 * round did not supply them; `--regen` forces them back to live sources.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const scenarios = require('./scenarios.js');
const manifest = require('./manifest.js');
const { DEFAULT_FRAMES } = manifest;

const REPO = path.join(__dirname, '..', '..');
const WORKSHOPS = process.env.COMPS_WORKSHOPS || '/tmp';
const APP_CSS = path.join(REPO, 'web', 'app.css');
const EXEMPLARS = path.join(REPO, 'assets', 'comps', 'latest');

function gitBlobHash(buffer) {
  return crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

function baseCss() {
  const source = fs.readFileSync(APP_CSS);
  return `/* web/app.css, copied verbatim by tools/comps/new-round.js.\n`
    + ` * git blob ${gitBlobHash(source)} — regenerate rather than hand-editing, so a comp\n`
    + ` * can never drift from the product's own language. */\n\n`
    + source.toString('utf8');
}

const CONCEPT_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>CONCEPT — one sentence of intent</title>
<link rel="stylesheet" href="base.css">
<link rel="stylesheet" href="concept.css">
</head><body><div id="app"></div>
<script src="data.js"></script>
<script src="concept.js"></script>
</body></html>
`;

const CONCEPT_JS = `/* Scaffolding. Delete it: it exists so the round shoots before any design
   does, and so the probe vocabulary is on screen once. Classic script under
   file:// — modules are blocked there, so every name is a deliberate global. */
(function () {
  var s = SCENARIOS[scenarioName()] || SCENARIOS[Object.keys(SCENARIOS)[0]];
  var rows = (s.trip === undefined ? RHODES : s.trip).services.map(function (sv) {
    var past = sv.dep < s.now;
    return '<div class="row" data-svc' + (past ? ' data-past' : '') + ' data-tap>'
      + sv.dep + ' &middot; ' + sv.head + '</div>';
  });
  document.getElementById('app').innerHTML =
    '<div data-scroller>' + rows.join('') + '</div>';
})();
`;

const CONCEPT_CSS = `/* This round's own language. base.css is the product's, copied verbatim;
   nothing here should re-type a value that already lives there. */
`;

function comps(name) {
  return {
    round: name,
    title: name + ' — the question this round asks',
    frames: DEFAULT_FRAMES,
    concepts: ['concept'],
    scenarios: Object.keys(scenarios.BOARD_SCENARIOS),
    settle: 260,
    probes: { tapMin: 44 },
    jobs: [
      { concepts: ['concept'], frames: ['phone'], scenarios: ['hero', 'past', 'delayed', 'cancelled', 'tight', 'long', 'deep'] },
      { concepts: ['concept'], frames: ['short'], scenarios: ['hero', 'long'] },
      { concepts: ['concept'], frames: ['phone'], scenarios: ['hero'], schemes: ['light'] }
    ],
    zooms: []
  };
}

function captions(name, m) {
  const byConcept = new Map();
  for (const job of manifest.jobs(m)) {
    if (!byConcept.has(job.concept)) byConcept.set(job.concept, []);
    byConcept.get(job.concept).push({ shot: job.name, note: '' });
  }
  return {
    title: name + ' — the question this round asks',
    lede: ['What this round is for, in two sentences. What is real and what is synthetic.'],
    ask: ['<b>THE THINGS TO JUDGE.</b> (1) … (2) … Each one points at the frames that decide it, with the recommendation.'],
    sections: [...byConcept].map(([concept, figures]) => ({
      h2: concept,
      note: 'Two sentences: the idea, and its emotional target.',
      figures
    }))
  };
}

const OPTIONS_MD = (name) => `# ${name} — options

Workshop: \`/tmp/trains-comps-${name}\` · sheet: \`index.html\` · shots: \`shots/\`
Recommendation, in one line:

The findings that outrank the concepts are below; read them before the concepts.

## 1 Ground rules held to

The spec, near-verbatim from the owner. What was borrowed from the product's
grammar. Data sources and why. Every synthetic delta (they are declared in the
head of \`data.js\` and named in the sheet's lede). What stayed frozen.

## 2 Findings that outrank the concepts

Measurements that decide the round regardless of taste: a count that changes
between frames, a contrast that fails in one scheme, a rule that cannot be
kept. They lead because they are not opinion.

## 3 The concepts

Per concept: the idea in three sentences and its emotional target; where every
spec item lands; motion; build cost S/M/L; one honest "why this might be
wrong"; the passes log of what each iteration fixed.

## 4 Vocabulary and contract additions needed

Each one an owner call.

## 5 Recommendation

The named transplants from each loser, why this over each other direction, and
the condition under which it flips.

## 6 Open questions for the owner

1.

## 7 What the next agent must know

Shoot invocation, scenario names, instrument traps, class collisions with the
copied stylesheet, layout traps that cost a cycle.
`;

function copyInto(from, to) {
  const copied = [];
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'shots' || entry.name.startsWith('.')) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyInto(src, dst).forEach((f) => copied.push(path.join(entry.name, f)));
    } else {
      fs.copyFileSync(src, dst);
      copied.push(entry.name);
    }
  }
  return copied;
}

function main() {
  const argv = process.argv.slice(2);
  const name = argv[0];
  if (!name || name.startsWith('--')) throw new Error('usage: new-round.js <name> [--from <workshop>] [--manifest <comps.json>] [--regen base,data]');
  const fromIndex = argv.indexOf('--from');
  const from = fromIndex >= 0 ? path.resolve(argv[fromIndex + 1]) : null;
  const regenIndex = argv.indexOf('--regen');
  const regen = new Set(regenIndex >= 0 ? argv[regenIndex + 1].split(',') : []);
  const manifestIndex = argv.indexOf('--manifest');
  const seedManifest = manifestIndex >= 0 ? path.resolve(argv[manifestIndex + 1]) : null;

  const dir = path.join(WORKSHOPS, 'trains-comps-' + name);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists; a round is one directory, so pick another name or delete it`);
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });

  const inherited = from ? copyInto(from, dir) : [];
  const held = new Set(inherited);
  const written = [];
  const write = (file, contents, force) => {
    if (held.has(file) && !force) return;
    fs.writeFileSync(path.join(dir, file), contents);
    written.push(file);
  };

  write('base.css', baseCss(), regen.has('base'));
  write('data.js', scenarios.renderBoardData(), regen.has('data'));
  write('hdata.js', scenarios.renderHomeData(), regen.has('data'));
  write('concept.html', CONCEPT_HTML);
  write('concept.js', CONCEPT_JS);
  write('concept.css', CONCEPT_CSS);
  const declared = seedManifest ? JSON.parse(fs.readFileSync(seedManifest, 'utf8')) : comps(name);
  write('comps.json', JSON.stringify(declared, null, 2) + '\n', !!seedManifest);
  write('captions.json', JSON.stringify(captions(name, Object.assign({ dir }, declared)), null, 2) + '\n', !!seedManifest);
  write('OPTIONS.md', OPTIONS_MD(name));

  /* Always the CURRENT calibration assets: an inherited round's copy is the
     thing a later verdict may already have replaced. */
  const exemplarDir = path.join(dir, 'exemplars');
  fs.rmSync(exemplarDir, { recursive: true, force: true });
  fs.mkdirSync(exemplarDir, { recursive: true });
  let exemplars = 0;
  for (const file of fs.readdirSync(EXEMPLARS)) {
    fs.copyFileSync(path.join(EXEMPLARS, file), path.join(exemplarDir, file));
    exemplars++;
  }

  console.log(dir);
  if (inherited.length) console.log(`  inherited ${inherited.length} files from ${from}`);
  console.log(`  generated ${written.join(', ')}`);
  console.log(`  ${exemplars} calibration exemplars from assets/comps/latest/`);
  console.log(`\n  node tools/comps/shoot.js ${dir}`);
  console.log(`  node tools/comps/sheet.js ${dir}`);
}

try { main(); } catch (e) { console.error(e.message || e); process.exit(1); }
