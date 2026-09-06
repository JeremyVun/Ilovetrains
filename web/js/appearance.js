(function () {
  'use strict';

  var STORAGE_KEY = 'trains.v1';
  var media = window.matchMedia('(prefers-color-scheme: light)');

  function valid(value) {
    return value === 'light' || value === 'dark' ? value : 'system';
  }

  function readStoredAppearance() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var doc = raw ? JSON.parse(raw) : null;
      return valid(doc && doc.preferences && doc.preferences.appearance);
    } catch (_) {
      return 'system';
    }
  }

  function apply(value) {
    var appearance = valid(value);
    var resolved = appearance === 'system' ? (media.matches ? 'light' : 'dark') : appearance;
    var root = document.documentElement;
    root.dataset.appearance = appearance;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    var theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.content = resolved === 'light' ? '#FAF9F5' : '#0A0B0D';
    return resolved;
  }

  var api = { apply: apply, readStoredAppearance: readStoredAppearance };
  window.trainsAppearance = api;
  apply(readStoredAppearance());
  function mediaChanged() {
    if (document.documentElement.dataset.appearance === 'system') apply('system');
  }
  if (media.addEventListener) media.addEventListener('change', mediaChanged);
  else if (media.addListener) media.addListener(mediaChanged);
})();
