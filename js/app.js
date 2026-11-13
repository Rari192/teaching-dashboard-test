/*
 * app.js — starts the dashboard and moves between screens.
 */
(function (root) {
  'use strict';

  var store = null;
  var data = null;
  var lastDrawnMinute = null;
  var currentScreen = null;

  // The current time. Kept in one place so the whole app agrees on "now".
  function now() { return new Date(); }

  // ---------- screens ----------

  var SCREENS = { '': 'screen-home', 'timetable': 'screen-timetable', 'classes': 'screen-classes', 'backup': 'screen-backup', 'lessons': 'screen-lessons' };
  var MODULES = { 'timetable': 'Timetable', 'classes': 'Classes', 'backup': 'Backup', 'lessons': 'Lessons' };

  function showScreen() {
    var name = (location.hash || '').replace('#', '');
    if (!SCREENS[name]) name = '';
    // Let the screen being left finish anything in progress (for example a name being typed).
    var leavingModule = currentScreen !== name && MODULES[currentScreen] ? root[MODULES[currentScreen]] : null;
    var leaving = leavingModule ? leavingModule.leave() : Promise.resolve();
    return leaving.then(function () {
      currentScreen = name;
      Object.keys(SCREENS).forEach(function (key) {
        document.getElementById(SCREENS[key]).hidden = key !== name;
      });
      document.getElementById('screen-error').hidden = true;
      if (name === '') drawHome(true);
      if (MODULES[name]) root[MODULES[name]].show();
    });
  }

  // ---------- drawing ----------

  function drawHome(force) {
    if (!data) return;
    var t = now();
    var minuteKey = t.getFullYear() + '-' + t.getMonth() + '-' + t.getDate() + ' ' + t.getHours() + ':' + t.getMinutes();
    if (!force && minuteKey === lastDrawnMinute) return;
    lastDrawnMinute = minuteKey;
    root.Home.render(t, data);
    root.Timetable.refresh();
  }

  // Reloads everything from storage after a change, so every screen shows the saved state.
  function reload() {
    return store.loadAll().then(function (loaded) {
      data = loaded;
      drawHome(true);
      return loaded;
    });
  }

  function wireButtons() {
    document.getElementById('today-card').addEventListener('click', function (e) {
      if (e.target.closest('[data-action="open-lesson"]')) {
        root.UI.toast('Lessons open here in a later phase.');
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.year-nav button'), function (b) {
      b.addEventListener('click', function () {
        root.UI.toast('Year ' + b.getAttribute('data-year') + ' dashboard comes in a later phase.');
      });
    });
  }

  // ---------- start-up ----------

  function showError(err) {
    Object.keys(SCREENS).forEach(function (k) { document.getElementById(SCREENS[k]).hidden = true; });
    document.getElementById('screen-error').hidden = false;
    document.getElementById('error-detail').textContent =
      (err && err.message ? err.message + ' ' : '') + 'Nothing has been changed or lost. Close the app fully and open it again.';
  }

  // Switches on the offline helper (sw.js). It only works when the app is opened from a
  // web address (https), not from a file, so failures here are expected and harmless.
  function enableOffline() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  function start() {
    enableOffline();
    wireButtons();
    var host = {
      data: function () { return data; },
      now: now,
      store: function () { return store; },
      reload: reload
    };
    root.Timetable.init(host);
    root.Classes.init(host);
    root.Backup.init(host);
    root.Lessons.init(host);
    root.TDStorage.requestPersistence();
    root.TDStorage.open().then(function (s) {
      store = s;
      return store.loadAll();
    }).then(function (loaded) {
      data = loaded;
      showScreen();
      window.addEventListener('hashchange', showScreen);
      // Keep "now" current: check every 5 seconds, redraw when the minute changes.
      setInterval(function () { drawHome(false); }, 5000);
      // Redraw straight away when the iPad wakes or the app comes back to the front.
      document.addEventListener('visibilitychange', function () { if (!document.hidden) drawHome(true); });
      window.addEventListener('pageshow', function () { drawHome(true); });
    }).catch(showError);
  }

  root.App = {
    reload: reload,
    getStore: function () { return store; },
    getData: function () { return data; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(this);
