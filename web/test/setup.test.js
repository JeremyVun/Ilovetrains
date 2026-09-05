process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const setup = readFileSync(join(import.meta.dirname, '..', 'js', 'setup.js'), 'utf8');
const css = readFileSync(join(import.meta.dirname, '..', 'app.css'), 'utf8');

/* The sheet's copy is only what design.md records; the lede the owner deleted
   may not come back through the stylesheet either (ui.md, setup). */
test('the sheet carries the two location strings and no lede', () => {
  assert.match(setup, /<span class="n">Use my location<\/span>/);
  assert.match(setup, /<div class="hm-grp">Nearest station<\/div>/,
    'the group idiom prints it uppercase');
  assert.ok(!/hm-lede/.test(setup), 'the lede paragraph is deleted');
  assert.ok(!/hm-lede/.test(css), 'and its rule with it');
  assert.ok(!/one direction only/.test(setup));
});

/* Nothing prompts on load: the ask is a row the user taps, and the silent fix
   is only taken where the permission is already granted (design.md, ruling 8). */
test('the sheet never prompts for location on load', () => {
  assert.ok(!/getCurrentPosition/.test(setup), 'the controller owns the geolocation call');
  const boot = /Promise\.all\(\[ctx\.permission\(\), loadStations\(\)\]\)([\s\S]*?)\n  \}\);/.exec(setup);
  assert.ok(boot, 'the sheet asks the controller for the permission state');
  assert.match(boot[1], /permission === 'prompt'/, 'an askable permission only shows the row');
  assert.match(boot[1], /permission === 'granted'/, 'a granted one may take the fix');
});

test('saving carries the redirect and source, so the controller can attribute the outcome', () => {
  const branch = /if \(action === 'save' && !saveEl\.disabled\) \{([\s\S]*?)\n    \}/.exec(setup);
  assert.ok(branch);
  assert.match(branch[1], /\}, redirect, fromSource\);/);
});
