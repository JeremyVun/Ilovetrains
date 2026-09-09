/* Commute feedback round.
 *
 * Real fixture material:
 * - direct: CENTRAL.services[0], Central -> Parramatta, 22:48-23:17, T1.
 * - transfer: RHODES.services[0], Rhodes -> Bondi Junction, 09:24-10:08,
 *   T9 then T4 through Town Hall.
 *
 * Small named synthetic deltas:
 * - overdue-moving: clock advances three minutes beyond the captured 10:08
 *   ETA; a recent accurate fix remains away from the destination and a short
 *   rolling speed window still shows train-like movement. The 93% marker is
 *   the last timetable-derived position retained when that ETA elapsed; GPS
 *   never places it. The comp does not claim a service delay or invent an ETA.
 * - missing-telemetry: the same ETA is four minutes old and there is no useful
 *   recent fix. The proposed three-minute uncertainty buffer has elapsed.
 * - transfer-before/transfer-during/transfer-after: the real transfer axis is
 *   retained while the marker is placed immediately before, between and after
 *   the two platform events to prove when each platform chip becomes travelled.
 * - settings-direct/settings-two/settings-any: only the new persisted transfer
 *   preference changes. The page content and all other settings are current.
 * - cab: the still is the current web tiny-train DOM after the rear cab fix.
 */
(function () {
  'use strict';

  var root = document.getElementById('app');
  var scenario = (/[^?]*[?&]s=([a-z-]+)/.exec(location.search) || [])[1] || 'transfer';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function icon(name, cls) {
    var paths = {
      back: '<path d="m15 18-6-6 6-6"/>',
      next: '<path d="m9 18 6-6-6-6"/>',
      check: '<path d="m5 12 4 4L19 7"/>',
      off: '<circle cx="12" cy="12" r="6"/>',
      location: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
      home: '<path d="m3 11 9-8 9 8"/><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7"/>',
      train: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M8 7h8M8 12h.01M16 12h.01M8 21l2-3M16 18l2 3"/>',
      metro: '<circle cx="12" cy="12" r="9"/><path d="M7.5 16V8l4.5 5 4.5-5v8"/>',
      ferry: '<path d="M4 15h16l-2.5 5h-11zM8 15V9h8v6M10 9V5h4v4M3 22c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 2-1"/>',
      bus: '<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M8 7h8v6H8zM8 16h.01M16 16h.01M8 22v-3M16 19v3"/>'
    };
    return '<svg class="' + esc(cls || '') + '" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>';
  }

  function serviceButton(mode, label, on, disabled) {
    return '<button class="st-mode" data-tap aria-pressed="' + on + '"' + (disabled ? ' disabled aria-disabled="true"' : '') + '>'
      + icon(mode, 'st-mode-icon') + '<span class="st-mode-label">' + label + '</span>'
      + '<span class="st-state">' + icon(on ? 'check' : 'off') + (on ? 'On' : 'Off') + '</span></button>';
  }

  function settingsPage(value) {
    return '<main class="st-screen settings-comp"><div class="st-top"><button class="st-back" data-tap>' + icon('back') + 'Home</button></div>'
      + '<div class="st-mast"><h1>Settings</h1><div class="st-rule"></div></div>'
      + '<div class="st-scroll" data-scroller>'
      + '<section class="st-group"><h2 class="st-section">Personal</h2><div class="st-person">'
      + '<button class="st-person-row st-location-row" data-tap>' + icon('location') + '<span class="st-copy"><span class="st-name">Use location</span><span class="st-value">Nearby trips use location</span></span><span class="st-state">Turn off</span></button>'
      + '<button class="st-person-row" data-tap>' + icon('home') + '<span class="st-copy"><span class="st-name">Home</span><span class="st-value">Automatic — Rhodes</span></span><span class="st-person-state">Set' + icon('next') + '</span></button></div></section>'
      + '<section class="st-group"><h2 class="st-section">Services</h2><div class="st-choice-set st-service-set">'
      + serviceButton('train', 'Trains', true, false) + serviceButton('metro', 'Metro', true, false) + serviceButton('ferry', 'Ferries', true, false) + serviceButton('bus', 'Buses', false, true)
      + '</div><p class="st-service-note">Trips use chosen services only.</p>'
      + '<button class="st-person-row st-transfer-row" data-tap aria-label="Transfer limit, ' + esc(value) + ', Change"><span class="st-copy"><span class="st-name">Transfer limit</span><span class="st-value">' + esc(value) + '</span></span><span class="st-state">Change</span></button></section>'
      + '<section class="st-group"><h2 class="st-section">Appearance</h2><div class="st-choice-set st-theme-set">'
      + '<button class="st-theme" data-tap aria-checked="true"><span class="st-preview"><i class="paper"></i><i class="night"></i></span><span class="st-theme-copy"><span class="st-theme-label">System</span><span class="st-theme-sub">Follow device</span></span>' + icon('check', 'st-theme-mark') + '</button>'
      + '<button class="st-theme" data-tap aria-checked="false"><span class="st-preview"><i class="paper"></i></span><span class="st-theme-copy"><span class="st-theme-label">Light</span></span></button>'
      + '<button class="st-theme" data-tap aria-checked="false"><span class="st-preview"><i class="night"></i></span><span class="st-theme-copy"><span class="st-theme-label">Dark</span></span></button>'
      + '</div></section><div class="st-secondary"><button class="st-secondary-row" data-tap><span class="st-name">Send feedback</span>' + icon('next') + '</button><div class="st-secondary-row passive"><span class="st-name">Version 1.2.4</span></div></div></div></main>';
  }

  function lineColour(code) {
    return 'var(--line-fill-' + code + ')';
  }

  function chipInk(code) {
    return ['T4', 'T5', 'T9', 'CCN', 'HUN'].indexOf(code) >= 0 ? 'var(--ink)' : 'var(--bg)';
  }

  function marker(at, phase, colour) {
    return '<span class="sy-mk ' + phase + '" style="left:' + (at * 100) + '%;--mkc:' + colour + '"><i></i></span>';
  }

  function directBar(at, markerVisible) {
    return '<span class="sy-j" style="--stem:' + lineColour('T1') + ';--chipink:' + chipInk('T1') + '"><span class="sy-bar" data-axis="29">'
      + '<span class="sy-r a leg-0" data-seg style="left:0;width:100%"><span class="sy-rp" style="background:' + lineColour('T1') + '"></span></span>'
      + '<span class="travelled" style="width:' + (at * 100) + '%"></span>'
      + (markerVisible ? marker(at, 'ride', lineColour('T1')) : '') + '</span></span>';
  }

  function transferBar(at, markerVisible) {
    var a = 27 / 44 * 100;
    var b = 34 / 44 * 100;
    var transferDone = at * 100 > b ? ' completed' : '';
    return '<span class="sy-j has-changes" style="--stem:' + lineColour('T9') + ';--stem2:' + lineColour('T4') + ';--chipink:' + chipInk('T9') + ';--chipink2:' + chipInk('T4') + '"><span class="sy-bar" data-axis="27/7/10">'
      + '<span class="sy-r a leg-0" data-seg style="left:0;width:' + a + '%"><span class="sy-rp" style="background:' + lineColour('T9') + '"></span></span>'
      + '<span class="sy-g0" data-seg style="left:' + a + '%;width:' + (b - a) + '%"></span>'
      + '<span class="sy-r b leg-1" data-seg style="left:' + b + '%;width:' + (100 - b) + '%"><span class="sy-rp" style="background:' + lineColour('T4') + '"></span></span>'
      + '<span class="travelled" style="width:' + (at * 100) + '%"></span>'
      + (markerVisible ? marker(at, 'ride2', lineColour('T4')) : '')
      + '<span class="sy-p a' + transferDone + '" data-pin="a" style="right:' + (100 - a) + '%;background:' + lineColour('T9') + ';color:' + chipInk('T9') + '">3</span>'
      + '<span class="sy-p b' + transferDone + '" data-pin="b" style="left:' + b + '%;background:' + lineColour('T4') + ';color:' + chipInk('T4') + '"><span class="sy-pv">5</span></span>'
      + '<span class="sy-pstn travelling" style="left:' + ((a + b) / 2) + '%">Town Hall</span></span></span>';
  }

  function settingsIcon() {
    return '<svg class="settings-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function tripRows(from, to, status, direct) {
    var lines = direct
      ? '<span class="hm-spine"><i style="background:' + lineColour('T1') + '"></i></span><span class="hm-bd"><span class="hm-nm"><span class="hm-bdg" style="background:' + lineColour('T1') + ';color:' + chipInk('T1') + '">T1</span>' + esc(from) + ' <em>→</em> ' + esc(to) + '</span>'
      : '<span class="hm-spine"><i style="background:' + lineColour('T9') + '"></i><i style="background:' + lineColour('T4') + '"></i></span><span class="hm-bd"><span class="hm-nm"><span class="hm-bdg" style="background:' + lineColour('T9') + ';color:' + chipInk('T9') + '">T9</span>' + esc(from) + ' <em>→</em> <span class="hm-bdg" style="background:' + lineColour('T4') + ';color:' + chipInk('T4') + '">T4</span>' + esc(to) + '</span>';
    return '<div class="hm-ix tl" data-scroller><div class="hm-anchor"><div class="l">My trips</div></div>'
      + '<button class="tripr focused" data-tap><span class="hm-in">' + lines + '<span class="hm-sub"><b>' + esc(status) + '</b> · Pinned</span><span class="route-cue">Departures <span class="arrow">›</span></span></span></span></button>'
      + '<div class="hm-end">— End of trips</div></div>';
  }

  function homePage(model) {
    var figure = model.figure === '—' ? '—' : esc(model.figure) + (model.unit ? '<span class="hm-u">' + esc(model.unit) + '</span>' : '');
    var freshness = model.uncertain ? '' : '<span class="hm-fresh"><span class="pulse live"></span><span class="lbl">Live</span></span>';
    return '<main class="hm-c home-screen commute-home"><div class="hm-top"><span class="answer-kind ' + (model.statusClass || '') + '"><span class="answer-line uncertain-copy">' + esc(model.status) + '</span></span>' + freshness + '</div>'
      + '<section class="hm-hd ' + (model.uncertain ? 'uncertain-figure' : '') + '" data-probe="smart header"><span class="hm-fig"><span class="hm-n">' + figure + '</span><span class="hm-st">' + esc(model.provenance || '') + '</span></span>'
      + '<span class="hm-ends"><span class="hm-e from"><span class="hm-stn">' + esc(model.from) + '</span><span class="hm-t">' + esc(model.dep) + '</span></span><span class="hm-e to"><span class="hm-stn">' + esc(model.to) + '</span><span class="hm-t">' + esc(model.arr) + '</span>' + (model.lastEstimate ? '<span class="hm-estimate">Last estimate</span>' : '') + '</span></span>'
      + model.bar + '<span class="hm-sign hm-act">' + esc(model.instruction) + '</span></section><div class="hm-rule"></div>'
      + tripRows(model.from, model.to, model.rowStatus, model.direct) + '<div class="hm-bar split"><button data-tap><span class="g">+</span>New trip</button><button data-tap>' + settingsIcon() + 'Settings</button></div></main>';
  }

  function homeModel(name) {
    if (name === 'direct') return { status: 'Running · Pinned', figure: '12', unit: 'min', provenance: 'To go', from: 'Central', to: 'Parramatta', dep: '22:48', arr: '23:17', instruction: 'Get off at Parramatta', bar: directBar(17 / 29, true), rowStatus: 'Running', direct: true };
    if (name === 'transfer-before') return { status: 'Running · Pinned', figure: '19', unit: 'min', provenance: 'To go', from: 'Rhodes', to: 'Bondi Junction', dep: '09:24', arr: '10:08', instruction: 'Get off at Town Hall · Platform 3', bar: transferBar(25 / 44, true), rowStatus: 'Running' };
    if (name === 'transfer-during') return { status: 'Running · Pinned', figure: '14', unit: 'min', provenance: 'To go', from: 'Rhodes', to: 'Bondi Junction', dep: '09:24', arr: '10:08', instruction: 'Change at Town Hall · Platform 5', bar: transferBar(30 / 44, true), rowStatus: 'Running' };
    if (name === 'transfer-after') return { status: 'Running · Pinned', figure: '7', unit: 'min', provenance: 'To go', from: 'Rhodes', to: 'Bondi Junction', dep: '09:24', arr: '10:08', instruction: 'Get off at Bondi Junction · Platform 2', bar: transferBar(37 / 44, true), rowStatus: 'Running' };
    if (name === 'transfer') return { status: 'Running · Pinned', figure: '7', unit: 'min', provenance: 'To go', from: 'Rhodes', to: 'Bondi Junction', dep: '09:24', arr: '10:08', instruction: 'Get off at Bondi Junction · Platform 2', bar: transferBar(37 / 44, true), rowStatus: 'Running' };
    if (name === 'overdue-moving') {
      return { status: 'Arrival uncertain', figure: '3', unit: 'min', provenance: 'Past estimate', from: 'Rhodes', to: 'Bondi Junction', dep: '09:24', arr: '10:08', lastEstimate: true, instruction: 'Still on the way to Bondi Junction.', bar: transferBar(.93, true), rowStatus: 'Arrival uncertain', uncertain: true };
    }
    return { status: 'Arrival unconfirmed', figure: '—', provenance: '', from: 'Rhodes', to: 'Bondi Junction', dep: '09:24', arr: '10:08', lastEstimate: true, instruction: 'Arrival time needs an update.', bar: transferBar(.93, false), rowStatus: 'Arrival uncertain', uncertain: true };
  }

  function svgElement(tag, attrs, children) {
    var attrText = Object.keys(attrs || {}).map(function (key) { return ' ' + key + '="' + attrs[key] + '"'; }).join('');
    return '<' + tag + attrText + '>' + (children || '') + '</' + tag + '>';
  }

  /* Exact current web carriage geometry. The first cab is mirrored and the
     last cab faces forward; the four cars between them have plain ends. */
  function carriage(lead, mirrored) {
    var windows = '';
    [5, 10].forEach(function (y) {
      [4, 9, 14, 19].forEach(function (x) { windows += svgElement('rect', { 'class': 'tiny-train-window ' + (y === 5 ? 'upper' : 'lower'), x: x, y: y, width: 3, height: 3 }); });
    });
    var cab = lead ? '<path class="tiny-train-nose" d="M24 3H26L31 7V15H24Z"></path><rect class="tiny-train-windscreen" x="25" y="5" width="3" height="4"></rect><rect class="tiny-train-headlight" x="29" y="12" width="1" height="1"></rect>' : '<rect class="tiny-train-door" x="25" y="5" width="3" height="8"></rect>';
    return '<svg class="tiny-train-car' + (lead ? ' lead' : '') + '"' + (mirrored ? ' style="transform:scaleX(-1)"' : '') + ' viewBox="0 0 32 18" aria-hidden="true"><path class="tiny-train-body" d="M1 3H25L29 7V15H1Z"></path>' + windows + cab + '<circle class="tiny-train-wheel" cx="7" cy="16" r="1.5"></circle><circle class="tiny-train-wheel" cx="25" cy="16" r="1.5"></circle></svg>';
  }

  function cabPage() {
    var cars = carriage(true, true);
    for (var i = 0; i < 4; i += 1) cars += carriage(false, false);
    cars += carriage(true, false);
    return '<main class="hm-c home-screen cab-comp"><div class="hm-top"><span class="answer-kind"><span class="answer-line">Tiny train</span></span></div><section class="hm-hd"><span class="hm-fig"><span class="hm-n">6</span><span class="hm-st">Cars</span></span><span class="hm-ends"><span class="hm-e from"><span class="hm-stn">Rhodes</span><span class="hm-t">09:24</span></span><span class="hm-e to"><span class="hm-stn">Bondi Junction</span><span class="hm-t">10:08</span></span></span><span class="sy-j"><span class="sy-cap" style="--stem:' + lineColour('T9') + ';background:' + lineColour('T9') + ';color:' + chipInk('T9') + '">1</span><span class="sy-bar tiny-train-lane" style="background:' + lineColour('T9') + '"><span class="tiny-train-stage"><span class="tiny-train-consist" data-carriages="6">' + cars + '</span></span></span></span><span class="cab-note">Rear cab ← · four middle cars · → front cab</span></section><div class="hm-rule cab-rule"></div><div class="hm-ix" data-scroller><div class="hm-anchor"><div class="l">Resolved correction</div></div><div class="hm-filtered-empty"><p>The two yellow noses face outwards. The animation, six-car count and 18px lane stay unchanged.</p></div></div></main>';
  }

  if (scenario === 'settings-direct') root.innerHTML = settingsPage('Direct only');
  else if (scenario === 'settings-two') root.innerHTML = settingsPage('Up to 2 changes');
  else if (scenario === 'settings-any') root.innerHTML = settingsPage('No limit');
  else if (scenario === 'cab') root.innerHTML = cabPage();
  else root.innerHTML = homePage(homeModel(scenario));
})();
