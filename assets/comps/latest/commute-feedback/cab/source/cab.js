/* Eight-car Waratah target derived from the official driving and motor-car
   drawings. This is a design reference requiring a product-code change. */
(function () {
  'use strict';

  function svgElement(tag, attrs) {
    var attrText = Object.keys(attrs || {}).map(function (key) {
      return ' ' + key + '="' + attrs[key] + '"';
    }).join('');
    return '<' + tag + attrText + '></' + tag + '>';
  }

  function doorway(x) {
    return '<rect class="tiny-train-passenger-door" x="' + x + '" y="4" width="5" height="11" rx=".25"></rect>'
      + '<path class="tiny-train-door-seam" d="M' + (x + 2.5) + ' 4V15"></path>'
      + '<rect class="tiny-train-door-window" x="' + (x + .5) + '" y="5" width="1.5" height="3"></rect>'
      + '<rect class="tiny-train-door-window" x="' + (x + 3) + '" y="5" width="1.5" height="3"></rect>';
  }

  function carriage(hasCab, mirrored) {
    var windows = '';
    [5, 9].forEach(function (y) {
      [12.5, 16.5, 20.5, 24.5].forEach(function (x) {
        windows += svgElement('rect', {
          'class': 'tiny-train-window ' + (y === 5 ? 'upper' : 'lower'),
          x: x,
          y: y,
          width: 2.5,
          height: 2
        });
      });
    });

    var body = hasCab ? 'M1 3H33L39 7V15H1Z' : 'M1 3H39V15H1Z';
    var cab = hasCab
      ? '<path class="tiny-train-nose" d="M33 3H34L39 7V15H33Z"></path>'
        + '<rect class="tiny-train-windscreen" x="34" y="5" width="3" height="4"></rect>'
        + '<rect class="tiny-train-headlight" x="37" y="12" width="1" height="1"></rect>'
      : '';

    return '<svg class="tiny-train-car' + (hasCab ? ' lead' : '') + '"'
      + (mirrored ? ' style="transform:scaleX(-1)"' : '')
      + ' viewBox="0 0 40 18" width="40" height="18" aria-hidden="true">'
      + '<path class="tiny-train-body" d="' + body + '"></path>'
      + windows + doorway(6) + doorway(28) + cab
      + '<circle class="tiny-train-wheel" cx="8" cy="16" r="1.5"></circle>'
      + '<circle class="tiny-train-wheel" cx="32" cy="16" r="1.5"></circle></svg>';
  }

  var cars = carriage(true, true);
  for (var i = 0; i < 6; i += 1) cars += carriage(false, false);
  cars += carriage(true, false);

  document.getElementById('app').innerHTML = '<main class="hm-c home-screen cab-comp">'
    + '<div class="hm-top"><span class="answer-kind"><span class="answer-line">Tiny train</span></span></div>'
    + '<section class="hm-hd"><span class="hm-fig"><span class="hm-n">8</span><span class="hm-st">Cars</span></span>'
    + '<span class="hm-ends"><span class="hm-e from"><span class="hm-stn">Rhodes</span><span class="hm-t">09:24</span></span>'
    + '<span class="hm-e to"><span class="hm-stn">Bondi Junction</span><span class="hm-t">10:08</span></span></span>'
    + '<span class="sy-j"><span class="sy-cap" style="--stem:var(--line-fill-T9);background:var(--line-fill-T9);color:var(--ink)">1</span>'
    + '<span class="sy-bar tiny-train-lane" style="background:var(--line-fill-T9)"><span class="tiny-train-stage">'
    + '<span class="tiny-train-consist tiny-train-reduced" data-carriages="8">' + cars + '</span></span></span></span>'
    + '<span class="cab-note">Rear cab ← · six middle cars · → front cab</span></section>'
    + '<div class="hm-rule cab-rule"></div><div class="hm-ix" data-scroller>'
    + '<div class="hm-anchor"><div class="l">Waratah refinement</div></div>'
    + '<div class="hm-filtered-empty"><p>Eight cars fit the 18px lane. Every car has two yellow passenger doorways; the driver cabs face outwards.</p></div>'
    + '</div></main>';
})();
