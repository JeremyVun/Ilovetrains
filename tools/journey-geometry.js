'use strict';

// Text ranges reveal wrapped lines and collisions that scrollWidth cannot.
function journeyGeometryProblems(root = document) {
  const problems = [];
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const visible = (rect) => rect.width > 0 && rect.height > 0;
  function hasSeparator(element) {
    const style = getComputedStyle(element);
    const ground = getComputedStyle(document.body).backgroundColor;
    const border = parseFloat(style.borderLeftWidth) >= 1 && style.borderLeftColor === ground;
    const shadow = style.boxShadow;
    const lengths = shadow.replace(/rgba?\([^)]*\)/g, '').trim().split(/\s+/).map(parseFloat);
    return border || (shadow.includes(ground) && lengths[0] === 0 && lengths[1] === 0
      && lengths[2] === 0 && lengths[3] >= 1);
  }
  function textRects(element, clip = false) {
    if (!element) return [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const result = [];
    const bounds = element.getBoundingClientRect();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        const box = clip ? {
          left: Math.max(rect.left, bounds.left), right: Math.min(rect.right, bounds.right),
          top: Math.max(rect.top, bounds.top), bottom: Math.min(rect.bottom, bounds.bottom)
        } : rect;
        if (box.right > box.left && box.bottom > box.top) result.push({ box, node });
      }
    }
    return result;
  }

  for (const title of root.querySelectorAll('.sy-h1')) {
    const bounds = title.getBoundingClientRect();
    if (textRects(title).some(({ box }) => box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5)) {
      problems.push('board endpoint name escapes its title: ' + title.textContent.trim());
    }
  }

  for (const row of root.querySelectorAll('[data-t="row"]')) {
    const unit = row.querySelector('.sy-u');
    if (unit && parseFloat(getComputedStyle(unit).fontSize) < 11.9) {
      problems.push('countdown unit is smaller than 12px: ' + unit.textContent.trim());
    }
    const bounds = row.getBoundingClientRect();
    for (const element of row.querySelectorAll('.sy-t, .sy-cap, .sy-pv, [data-pin="a"], [data-ferry-location], [data-transfer-station], .sy-sign')) {
      if (textRects(element, element.classList.contains('sy-sign')).some(({ box }) =>
        box.top < bounds.top - 0.5 || box.bottom > bounds.bottom + 0.5)) {
        problems.push('journey text escapes its row: ' + element.textContent.trim());
      }
    }
    const sign = textRects(row.querySelector('.sy-sign'), true);
    for (const label of row.querySelectorAll('[data-transfer-station]')) {
      if (textRects(label).some(({ box }) => sign.some((part) => overlaps(box, part.box)))) {
        problems.push('transfer name overlaps the headsign: ' + label.textContent.trim());
      }
    }
    const devices = [...row.querySelectorAll('.sy-cap, .sy-p, [data-ferry-location]')]
      .filter((element) => !(element.classList.contains('sy-p') && element.querySelector('[data-ferry-location]')))
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => visible(box));
    for (let i = 0; i < devices.length; i++) {
      for (let j = i + 1; j < devices.length; j++) {
        if (overlaps(devices[i].box, devices[j].box)) {
          problems.push('boarding or transfer markers overlap: '
            + devices[i].element.textContent.trim() + ' / ' + devices[j].element.textContent.trim());
        }
        const cap = [devices[i], devices[j]].find(({ element }) => element.classList.contains('sy-cap'));
        const pin = [devices[i], devices[j]].find(({ element }) =>
          element.matches('.sy-p') || element.closest('.sy-p'));
        if (cap && pin && Math.abs(cap.box.right - pin.box.left) <= 1
          && Math.min(cap.box.bottom, pin.box.bottom) > Math.max(cap.box.top, pin.box.top)
          && !hasSeparator(pin.element)) {
          problems.push('clamped transfer marker merges with the boarding cap without a visible separator');
        }
      }
    }
  }

  for (const step of root.querySelectorAll('[data-t="step"]')) {
    const bounds = step.getBoundingClientRect();
    const style = getComputedStyle(step);
    const top = bounds.top + parseFloat(style.borderTopWidth) + 4;
    const bottom = bounds.bottom - parseFloat(style.borderBottomWidth) - 4;
    const parts = textRects(step.querySelector('.dwhat'));
    if (step.dataset.step === 'change') {
      const code = [...step.querySelectorAll('.dchip')].at(-1)?.dataset.lineCode;
      if (code && !step.querySelector('.dwhat').textContent.includes(code)) {
        problems.push('change instructions omit the boarding service code: ' + code);
      }
    }
    if (parts.some(({ box }) => box.top < top - 0.5 || box.bottom > bottom + 0.5
      || box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5)) {
      problems.push('step text crosses its content boundary or crowds the divider: ' + step.textContent.trim());
    }
    for (const chip of step.querySelectorAll('.dchip')) {
      const box = chip.getBoundingClientRect();
      if (visible(box) && (box.top < top - 0.5 || box.bottom > bottom + 0.5)) {
        problems.push('step chip crowds the divider: ' + chip.textContent.trim());
      }
      if (parts.some((part) => !chip.contains(part.node) && overlaps(box, part.box))) {
        problems.push('step chip overlaps instruction text: ' + step.textContent.trim());
      }
    }
  }
  return problems;
}

module.exports = { journeyGeometryProblems };
