/* The acceptance oracle, and the real gate on this harness.
 *
 * It scaffolds a round from the archived board v2 final workshop, shoots the
 * archive's own job list with tools/comps/, and compares the result with the
 * exemplar set as it stood at EXEMPLAR_COMMIT — the last commit whose
 * assets/comps/latest/ still WAS the archive's own shots. Pinning it there is
 * what lets the product move on: the exemplars on disk are now client shots of
 * a later design, and this gate is about the harness, not about the design.
 * Target: pixel-identical. A difference is a defect in the harness, not a
 * reason to loosen the comparison.
 *
 * Both trees are extracted from git, so this needs nothing on disk:
 *   node tools/comps/test/oracle.js
 *
 * It is not a `node --test` file because it drives Chrome for a minute and
 * shoots 41 frames; the unit gates stay fast.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..');
const ARCHIVE_COMMIT = '91aadd9';
const ARCHIVE_PATH = 'docs/backlog/board-v2/comps-final';
// The last commit whose exemplars the archive can still reproduce: home-interaction
// re-shot every one of them from the real client.
const EXEMPLAR_COMMIT = 'b218dd5';
const EXEMPLAR_PATH = 'assets/comps/latest';
// Even at the pin these two were client shots after an owner ruling; the archive's
// CSS cannot reproduce them, so they are calibration for the build, not the harness.
const CLIENT_SHOTS = {
  'board-390x844-hero-light.png': 'light chip numerals are paper (owner, 2026-09-02)',
  'home-390x844-before-light.png': 'light chip numerals are paper (owner, 2026-09-02)'
};
const WORKSHOP = '/tmp/trains-comps-oracle';

const node = (args) => execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });

function extractTree(commit, treePath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-comps-oracle-src-'));
  const listing = execFileSync('git', ['ls-tree', '--name-only', `${commit}:${treePath}`],
    { cwd: REPO, encoding: 'utf8' }).trim().split('\n');
  for (const name of listing) {
    if (name.endsWith('/') || name === 'shots') continue;
    const blob = execFileSync('git', ['show', `${commit}:${treePath}/${name}`],
      { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(dir, name), blob);
  }
  return dir;
}

function main() {
  fs.rmSync(WORKSHOP, { recursive: true, force: true });
  const source = extractTree(ARCHIVE_COMMIT, ARCHIVE_PATH);

  console.log(node(['tools/comps/new-round.js', 'oracle',
    '--from', source,
    '--manifest', 'tools/comps/test/oracle.comps.json']));

  console.log(node(['tools/comps/shoot.js', WORKSHOP]));
  console.log(node(['tools/comps/sheet.js', WORKSHOP]));

  const pinned = extractTree(EXEMPLAR_COMMIT, EXEMPLAR_PATH);
  for (const f of Object.keys(CLIENT_SHOTS)) {
    console.log(`skip  ${f}  client shot: ${CLIENT_SHOTS[f]}`);
    fs.rmSync(path.join(pinned, f), { force: true });
  }

  let diff = '';
  let identical = true;
  try {
    diff = node(['tools/comps/diff.js', pinned, path.join(WORKSHOP, 'shots')]);
  } catch (e) {
    diff = e.stdout || String(e);
    identical = false;
  }
  console.log(diff);
  fs.rmSync(source, { recursive: true, force: true });
  fs.rmSync(pinned, { recursive: true, force: true });

  if (!identical) {
    console.error('ORACLE FAILED — find out why and fix the harness; the pinned exemplars are the truth.');
    process.exit(1);
  }
  console.log(`ORACLE PASSED — every exemplar pinned at ${EXEMPLAR_COMMIT} reproduced from ${WORKSHOP}`);
}

main();
