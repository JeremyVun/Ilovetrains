#!/usr/bin/env node
/* Real-client checks using captured services; no live API or credentials.
 * node tools/check-tiny-train.js --url http://localhost:8198 --out /tmp/tiny-train
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { withPage, frame, evaluate, screenshot, sleep } = require('./comps/chrome');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const option = (key, fallback) => argv.includes(key) ? argv[argv.indexOf(key) + 1] : fallback;
const url = option('--url', 'http://localhost:8198');
const out = option('--out', '/tmp/ilovetrains-tiny-train-check');
fs.mkdirSync(out, { recursive: true });

async function ready(page) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(page, '!!window.__trains && !!document.querySelector(".hm-rule")')) return;
    await sleep(50);
  }
  throw Error('Home did not load');
}

async function check() {
  const { departuresBody, NOW } = await import(pathToFileURL(path.join(ROOT, 'web/test/fixture.js')));
  const body = departuresBody();
  const trip = { id: 'tiny-train-preview', from: body.from, to: body.to, createdAt: body.generatedAt };
  const doc = {
    schemaVersion: 1, trips: [trip], history: [], rides: [],
    preferences: { useLocation: false },
    cache: { [`${trip.from.id}-${trip.to.id}`]: { fetchedAt: body.generatedAt, body } }
  };
  const report = [];
  for (const [width, height] of [[390, 844], [412, 732]]) {
    for (const scheme of ['dark', 'light']) {
      await withPage(async (page) => {
        await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Australia/Sydney' });
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
          localStorage.setItem('trains.v1', ${JSON.stringify(JSON.stringify(doc))});
          Date.now = () => ${NOW};
          const originalFetch = window.fetch.bind(window);
          window.fetch = (input, ...args) => String(input).includes('/api/')
            ? new Promise(() => {}) : originalFetch(input, ...args);
        ` });
        await frame(page, { url, width, height, scheme, settle: 400 });
        await ready(page);
        assert.equal(await evaluate(page, '!!document.querySelector(".tiny-train-trigger")'), false);
        const idle = await screenshot(page);
        const enabledUrl = new URL(url);
        enabledUrl.searchParams.set('tinyTrain', '1');
        await frame(page, { url: enabledUrl.href, width, height, scheme, settle: 400 });
        await ready(page);
        const stem = `${width}x${height}-${scheme}`;
        fs.writeFileSync(path.join(out, `${stem}-idle.png`), await screenshot(page));
        const geometry = await evaluate(page, `(() => {
          const button = document.querySelector('.tiny-train-trigger');
          if (!button) throw Error('flag did not attach a train control');
          if (!button.getAttribute('aria-label')) throw Error('train control needs an accessible label');
          const box = button.getBoundingClientRect();
          if (box.width < 44 || box.height < 44) throw Error('train target smaller than 44px');
          for (const other of document.querySelectorAll('button, [role="button"]')) {
            if (other === button || button.contains(other)) continue;
            const r = other.getBoundingClientRect();
            if (Math.min(box.right, r.right) > Math.max(box.left, r.left)
              && Math.min(box.bottom, r.bottom) > Math.max(box.top, r.top)) {
              throw Error('train target overlaps ' + other.outerHTML.slice(0, 120));
            }
          }
          if (document.documentElement.scrollWidth > innerWidth) throw Error('horizontal overflow');
          const line = document.querySelector('.hm-hd .sy-bar');
          if (button.parentElement !== line) throw Error('control is not on the trip line');
          if (document.querySelector('.hm-rule .tiny-train-trigger')) throw Error('divider still owns the train');
          window.trainLineBefore = line;
          window.trainStageBefore = line.querySelector('.tiny-train-stage');
          window.trainGeometry = ['.hm-rule', '.hm-hd .sy-bar', '.hm-ix'].map(selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { selector, x: r.x, y: r.y, width: r.width, height: r.height };
          });
          button.click();
          for (const before of window.trainGeometry) {
            const after = document.querySelector(before.selector).getBoundingClientRect();
            for (const axis of ['x', 'y', 'width', 'height']) {
              if (after[axis] !== before[axis]) throw Error(before.selector + ' jumped on activation');
            }
          }
          const stageBox = window.trainStageBefore.getBoundingClientRect();
          if (Math.abs(stageBox.bottom - line.getBoundingClientRect().top) > 0.5) throw Error('train is not riding the trip line');
          return { width: box.width, height: box.height };
        })()`);
        assert.equal(await evaluate(page, 'document.querySelectorAll(".tiny-train-car").length'), 6);
        await sleep(450);
        fs.writeFileSync(path.join(out, `${stem}-passing.png`), await screenshot(page));
        await evaluate(page, `(() => {
          document.querySelector('.tiny-train-trigger').click();
          if (document.querySelectorAll('.tiny-train-car').length !== 7) throw Error('tap did not add a carriage');
          const t = window.__trains;
          t.now = () => ${NOW + 60000};
          t.rerender();
          if (document.querySelector('.tiny-train-stage') !== window.trainStageBefore) throw Error('live repaint replaced train');
          if (document.querySelector('.hm-hd .sy-bar') === window.trainLineBefore) throw Error('live repaint retained stale journey markup');
          if (document.querySelectorAll('.tiny-train-car').length !== 7) throw Error('live repaint lost carriages');
          for (let i = 0; i < 80; i++) document.querySelector('.tiny-train-trigger').click();
          if (document.querySelectorAll('.tiny-train-car').length > 64) throw Error('unbounded carriage count');
        })()`);
        await sleep(150);
        fs.writeFileSync(path.join(out, `${stem}-long.png`), await screenshot(page));
        const touch = await evaluate(page, `(() => {
          const scroller = document.querySelector('.hm-ix');
          const row = scroller.querySelector('.tripr');
          const spacer = document.createElement('div');
          spacer.style.cssText = 'flex:none;height:900px';
          scroller.append(spacer);
          const r = row.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        await page.send('Input.dispatchTouchEvent', {
          type: 'touchStart', touchPoints: [{ x: touch.x, y: touch.y }]
        });
        await page.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: touch.x, y: touch.y - 100 }]
        });
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(150);
        await evaluate(page, `(() => {
          const scroller = document.querySelector('.hm-ix');
          const trigger = document.querySelector('.tiny-train-trigger');
          if (scroller.scrollTop <= 0) throw Error('touch did not scroll trips');
          if (trigger.hidden) throw Error('trip-line control disappeared while only saved trips scrolled');
          if (document.querySelectorAll('.tiny-train-car').length !== 64) throw Error('trip-list scroll interrupted header train');
          if (trigger.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top) throw Error('trip-line control overlaps saved trips');
          scroller.querySelector(':scope > div:last-child').remove();
          scroller.scrollTop = 0;
        })()`);
        await sleep(50);
        assert.equal(await evaluate(page, 'document.querySelector(".tiny-train-trigger").hidden'), false,
          'train target returns with the anchor');
        await evaluate(page, `(() => { location.hash = '#/settings'; })()`);
        await sleep(100);
        assert.equal(await evaluate(page, '!!document.querySelector(".tiny-train-trigger")'), false);
        assert.equal(await evaluate(page, 'window.trainStageBefore.querySelectorAll(".tiny-train-car").length'), 0);
        await frame(page, { url, width, height, scheme, settle: 400 });
        await ready(page);
        assert.equal(await evaluate(page, '!!document.querySelector(".tiny-train-trigger")'), true, 'opt-in survives plain launch');
        await evaluate(page, 'document.querySelector(".tiny-train-trigger").focus()');
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        assert.equal(await evaluate(page, 'document.querySelectorAll(".tiny-train-car").length'), 6, 'Enter starts a train');
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        assert.equal(await evaluate(page, 'document.querySelectorAll(".tiny-train-car").length'), 7, 'Space adds a carriage');
        await page.send('Emulation.setEmulatedMedia', { features: [
          { name: 'prefers-color-scheme', value: scheme },
          { name: 'prefers-reduced-motion', value: 'reduce' }
        ] });
        await evaluate(page, 'document.querySelector(".tiny-train-trigger").click()');
        await sleep(80);
        const position = await evaluate(page, 'getComputedStyle(document.querySelector(".tiny-train-consist")).transform');
        await sleep(350);
        assert.equal(await evaluate(page, 'getComputedStyle(document.querySelector(".tiny-train-consist")).transform'), position, 'reduced motion stays still');
        fs.writeFileSync(path.join(out, `${stem}-reduced.png`), await screenshot(page));
        await sleep(2200);
        assert.equal(await evaluate(page, 'document.querySelectorAll(".tiny-train-car").length'), 0, 'static train clears');
        const disabledUrl = new URL(url);
        disabledUrl.searchParams.set('tinyTrain', '0');
        await frame(page, { url: disabledUrl.href, width, height, scheme, settle: 400 });
        await ready(page);
        assert.equal(await evaluate(page, '!!document.querySelector(".tiny-train-trigger")'), false);
        assert.deepEqual(await screenshot(page), idle, 'flag-off screen matches original');
        report.push({ width, height, scheme, target: geometry, result: 'passed' });
        console.log(`${stem}: passed`);
      });
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Screenshots and report: ${out}`);
}

check().catch((error) => { console.error(error); process.exitCode = 1; });
