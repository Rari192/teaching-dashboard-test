/*
 * app.js — starts the dashboard and moves between screens.
 */
(function (root) {
  'use strict';

  var store = null;
  var data = null;
  var lastDrawnMinute = null;
  var currentScreen = null;

  // ---------- the time ----------
  // "Now" is decided in one place, so the whole app agrees on it.
  // In test mode it is a chosen day and time that keeps ticking from when test mode started.
  // Test mode lives in memory only, so it ends when the app is closed. Anything recorded
  // (for example the date a lesson is marked as taught) always uses the real time.

  var testMode = null; // { offset: milliseconds added to the real clock, startedAt }

  function realNow() { return new Date(); }
  function now() { return testMode ? new Date(Date.now() + testMode.offset) : new Date(); }

  function startTestMode(weekday, time) {
    var real = realNow();
    var pretend = root.Schedule.testModeDate(real, weekday, time); // throws if not valid
    testMode = { offset: pretend.getTime() - real.getTime() };
    lastDrawnMinute = null;
    timeChanged();
    return pretend;
  }

  function stopTestMode() {
    testMode = null;
    lastDrawnMinute = null;
    timeChanged();
  }

  // Redraws what depends on the time, and tells the menu so the test mode strip is right.
  function timeChanged() {
    if (root.Menu) root.Menu.timeChanged();
    if (currentScreen === '') drawHome(true);
    else if (currentScreen === 'timetable') root.Timetable.show();
  }

  // ---------- screens ----------

  var SCREENS = { '': 'screen-home', 'timetable': 'screen-timetable', 'classes': 'screen-classes', 'backup': 'screen-backup', 'lessons': 'screen-lessons', 'lesson': 'screen-lesson' };
  var MODULES = { 'timetable': 'Timetable', 'classes': 'Classes', 'backup': 'Backup', 'lessons': 'Lessons', 'lesson': 'Lesson' };

  function showScreen() {
    // The part before any '?' names the screen; the rest is for the screen itself (#lesson?l=...).
    var name = (location.hash || '').replace('#', '').split('?')[0];
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
      var btn = e.target.closest('[data-action="open-lesson"]');
      if (!btn) return;
      var lessonId = btn.getAttribute('data-lesson');
      if (lessonId) location.hash = root.Lesson.address(lessonId, btn.getAttribute('data-class')).slice(1);
      else root.UI.toast(btn.getAttribute('data-reason') || 'There is no lesson to open.');
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
      realNow: realNow,
      testMode: {
        start: startTestMode,
        stop: stopTestMode,
        isOn: function () { return !!testMode; }
      },
      store: function () { return store; },
      reload: reload
    };
    root.Timetable.init(host);
    root.Classes.init(host);
    root.Backup.init(host);
    root.Lessons.init(host);
    root.Lesson.init(host);
    root.Menu.init(host);
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
