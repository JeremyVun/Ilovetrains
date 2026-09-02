/* The service worker's precache list is a hand-written mirror of the shell on
   disk, and `cache.addAll` rejects atomically: one path that 404s and the
   install fails, leaving every user without an offline app and nothing in the
   UI to say so. These tests are that mirror's guard. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');

function shellList() {
  const block = /const SHELL = \[([\s\S]*?)\];/.exec(source);
  assert.ok(block, 'sw.js must declare `const SHELL = [...]`');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('every shell path the worker precaches exists on disk', () => {
  for (const entry of shellList()) {
    if (entry === '/') continue; // the navigation URL, served as index.html
    const file = path.join(WEB, entry.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), `sw.js precaches ${entry}, which does not exist`);
  }
});

test('every ES module the app ships is precached', () => {
  const shell = new Set(shellList());
  for (const name of fs.readdirSync(path.join(WEB, 'js'))) {
    if (!name.endsWith('.js')) continue;
    assert.ok(shell.has('/js/' + name), `web/js/${name} is not in the sw.js SHELL list`);
  }
});

test('every icon the manifest promises is precached and on disk', () => {
  const shell = new Set(shellList());
  const manifest = JSON.parse(fs.readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8'));
  assert.ok(manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(WEB, icon.src.replace(/^\//, ''))), `${icon.src} is missing`);
    assert.ok(shell.has(icon.src), `${icon.src} is not precached`);
  }
});

test('the manifest is installable: name, start_url, display, 192 and 512 icons', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8'));
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length > 0);
  assert.ok(manifest.short_name.length <= 12, 'short_name has to survive a home screen');
  assert.equal(manifest.start_url, '/');
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display));
  assert.equal(manifest.theme_color, '#0A0B0D', 'the dark ground from docs/contracts/ui.md');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'), 'installability needs a 192px icon');
  assert.ok(sizes.includes('512x512'), 'installability needs a 512px icon');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'a launcher will crop a non-maskable icon');
});

test('both caches carry the version, so a deploy cannot serve half of two shells', () => {
  const version = /const VERSION = '([^']+)'/.exec(source);
  assert.ok(version, 'sw.js must declare a VERSION');
  assert.match(source, /const SHELL_CACHE = 'shell-' \+ VERSION/);
  assert.match(source, /const DATA_CACHE = 'data-' \+ VERSION/);
});

test('the index the page actually loads is the one the worker precaches', () => {
  const shell = new Set(shellList());
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
    assert.ok(shell.has(href), `index.html loads ${href}, which is not precached`);
  }
  assert.match(html, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
});
