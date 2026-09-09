const SVG_NS = 'http://www.w3.org/2000/svg';
const CARRIAGES = 8;
const RUN_MS = 2600;
const REDUCED_MS = 650;

function svgElement(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function doorway(x) {
  return [
    svgElement('rect', { class: 'tiny-train-passenger-door', x, y: '4', width: '5', height: '11', rx: '.25' }),
    svgElement('path', { class: 'tiny-train-door-seam', d: `M${x + 2.5} 4V15` }),
    svgElement('rect', { class: 'tiny-train-door-window', x: String(x + .5), y: '5', width: '1.5', height: '3' }),
    svgElement('rect', { class: 'tiny-train-door-window', x: String(x + 3), y: '5', width: '1.5', height: '3' })
  ];
}

function carriage(lead = false) {
  const svg = svgElement('svg', {
    class: `tiny-train-car${lead ? ' lead' : ''}`,
    viewBox: '0 0 40 18',
    width: '40',
    height: '18',
    'aria-hidden': 'true'
  });

  const body = svgElement('path', {
    class: 'tiny-train-body',
    d: lead ? 'M1 3H33L39 7V15H1Z' : 'M1 3H39V15H1Z'
  });
  svg.append(body);

  for (const y of [5, 9]) {
    for (const x of [12.5, 16.5, 20.5, 24.5]) {
      svg.append(svgElement('rect', {
        class: `tiny-train-window ${y === 5 ? 'upper' : 'lower'}`,
        x: String(x), y: String(y), width: '2.5', height: '2'
      }));
    }
  }

  svg.append(...doorway(6), ...doorway(28));

  if (lead) {
    svg.append(svgElement('path', { class: 'tiny-train-nose', d: 'M33 3H34L39 7V15H33Z' }));
    svg.append(svgElement('rect', { class: 'tiny-train-windscreen', x: '34', y: '5', width: '3', height: '4' }));
    svg.append(svgElement('rect', { class: 'tiny-train-headlight', x: '37', y: '12', width: '1', height: '1' }));
  }

  svg.append(
    svgElement('circle', { class: 'tiny-train-wheel', cx: '8', cy: '16', r: '1.5' }),
    svgElement('circle', { class: 'tiny-train-wheel', cx: '32', cy: '16', r: '1.5' })
  );
  return svg;
}

export function attachTinyTrain(host) {
  if (!(host instanceof HTMLElement)) return () => {};
  host.classList.add('tiny-train-lane');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'tiny-train-trigger';
  trigger.dataset.act = 'tiny-train';
  trigger.setAttribute('aria-label', 'Run a tiny train');
  const stage = document.createElement('span');
  stage.className = 'tiny-train-stage';
  stage.setAttribute('aria-hidden', 'true');
  host.append(stage, trigger);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let consist = null;
  let raf = 0;
  let timer = 0;
  let start = 0;
  let speed = 0;
  let stageWidth = 0;
  let trainWidth = 0;
  let destroyed = false;
  function refresh(nextHost = host) {
    if (nextHost !== host) {
      const active = Boolean(consist);
      const reducedRun = host.classList.contains('tiny-train-reduced');
      host.classList.remove('tiny-train-lane', 'tiny-train-lane-active', 'tiny-train-reduced');
      host = nextHost;
      host.classList.add('tiny-train-lane');
      host.classList.toggle('tiny-train-lane-active', active);
      host.classList.toggle('tiny-train-reduced', reducedRun);
      // Move only the toy: the newly rendered journey keeps its live data.
      host.append(stage, trigger);
    }
    stageWidth = host.clientWidth;
  }

  function clearRun() {
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0;
    timer = 0;
    consist?.remove();
    consist = null;
    trainWidth = 0;
    host.classList.remove('tiny-train-lane-active', 'tiny-train-reduced');
    trigger.setAttribute('aria-label', 'Run a tiny train');
  }

  function showReduced() {
    host.classList.add('tiny-train-reduced');
    const fit = Math.min(1, Math.max(0, stageWidth - 8) / trainWidth);
    consist.style.transform = `translateX(-50%) scale(${fit})`;
    consist.style.left = '50%';
  }

  function frame(now) {
    if (!consist || destroyed || !document.contains(host) || document.hidden) {
      clearRun();
      return;
    }
    const front = -4 + (now - start) * speed;
    consist.style.transform = `translate3d(${front}px, 0, 0) translateX(-100%)`;
    if (front > stageWidth + trainWidth + 4) {
      clearRun();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function run() {
    refresh();
    host.classList.add('tiny-train-lane-active');
    consist = document.createElement('span');
    consist.className = 'tiny-train-consist';
    for (let i = 1; i < CARRIAGES; i += 1) consist.append(carriage(false));
    consist.append(carriage(true));
    consist.dataset.carriages = String(CARRIAGES);
    stage.append(consist);
    trainWidth = consist.getBoundingClientRect().width;

    if (reduced.matches) {
      showReduced();
      timer = setTimeout(clearRun, REDUCED_MS);
      return;
    }

    start = performance.now();
    speed = (stageWidth + trainWidth + 8) / RUN_MS;
    raf = requestAnimationFrame(frame);
  }

  function activate() {
    if (!consist) run();
  }

  function keyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (event.repeat) return;
    activate();
  }

  function visibilityChanged() {
    if (document.hidden) clearRun();
  }

  function motionChanged(event) {
    if (!event.matches || !consist) return;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    showReduced();
    if (timer) clearTimeout(timer);
    timer = setTimeout(clearRun, REDUCED_MS);
  }

  trigger.addEventListener('click', activate);
  trigger.addEventListener('keydown', keyDown);
  document.addEventListener('visibilitychange', visibilityChanged);
  reduced.addEventListener('change', motionChanged);
  refresh();

  const cleanup = () => {
    destroyed = true;
    clearRun();
    trigger.removeEventListener('click', activate);
    trigger.removeEventListener('keydown', keyDown);
    document.removeEventListener('visibilitychange', visibilityChanged);
    reduced.removeEventListener('change', motionChanged);
    trigger.remove();
    stage.remove();
    host.classList.remove('tiny-train-lane');
  };
  cleanup.refresh = refresh;
  return cleanup;
}
