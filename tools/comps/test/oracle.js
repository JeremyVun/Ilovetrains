/* The acceptance oracle, and the real gate on this harness.
 *
 * It scaffolds a round from the archived board v2 final workshop, shoots the
 * archive's own job list with tools/comps/, and compares the result with the
 * locked calibration exemplars in assets/comps/latest/ — which ARE the archive's
 * shots. Target: pixel-identical. A difference is a defect in the harness, not
 * a reason to loosen the comparison.
 *
 * The archived workshop is extracted from git, so this needs nothing on disk:
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
const WORKSHOP = '/tmp/trains-comps-oracle';
const EXEMPLARS = path.join(REPO, 'assets', 'comps', 'latest');

const node = (args) => execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });

function extractArchive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-comps-oracle-src-'));
  const listing = execFileSync('git', ['ls-tree', '--name-only', `${ARCHIVE_COMMIT}:${ARCHIVE_PATH}`],
    { cwd: REPO, encoding: 'utf8' }).trim().split('\n');
  for (const name of listing) {
    if (name.endsWith('/') || name === 'shots') continue;
    const blob = execFileSync('git', ['show', `${ARCHIVE_COMMIT}:${ARCHIVE_PATH}/${name}`],
      { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(dir, name), blob);
  }
  return dir;
}

function main() {
  fs.rmSync(WORKSHOP, { recursive: true, force: true });
  const source = extractArchive();

  console.log(node(['tools/comps/new-round.js', 'oracle',
    '--from', source,
    '--manifest', 'tools/comps/test/oracle.comps.json']));

  console.log(node(['tools/comps/shoot.js', WORKSHOP]));
  console.log(node(['tools/comps/sheet.js', WORKSHOP]));

  let diff = '';
  let identical = true;
  try {
    diff = node(['tools/comps/diff.js', EXEMPLARS, path.join(WORKSHOP, 'shots')]);
  } catch (e) {
    diff = e.stdout || String(e);
    identical = false;
  }
  console.log(diff);
  fs.rmSync(source, { recursive: true, force: true });

  if (!identical) {
    console.error('ORACLE FAILED — find out why and fix the harness; the exemplars are the truth.');
    process.exit(1);
  }
  console.log(`ORACLE PASSED — every calibration exemplar reproduced from ${WORKSHOP}`);
}

main();
