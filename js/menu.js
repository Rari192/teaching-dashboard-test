/*
 * menu.js — the menu (☰ on Home) and test mode.
 *
 * The menu is a panel that slides in from the right, with quick links to the other screens
 * and Test mode. Test mode pretends it is a chosen school day and time, so the Today card can
 * be tried at any time. While it is on, an amber strip runs across the top of every screen.
 * It only changes what is shown; nothing saved is changed, and it ends when the app closes.
 */
(function (root) {
  'use strict';

  var el = root.UI.el;
  var host = null;
  var stripTimer = null;
  var picked = { day: 1, time: '08:40' };

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // The quick time choices: before school, each period and each break, in order of the day.
  function timeChoices() {
    var S = root.Schedule;
    var list = [{ label: 'Before school', time: '08:40' }];
    S.PERIODS.forEach(function (p) { list.push({ label: 'Period ' + p.number, time: p.start }); });
    S.BREAKS.forEach(function (b) { list.push({ label: b.label, time: b.start }); });
    return list.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  }

  // ---------- menu panel ----------

  function openMenu() {
    $('menu-test-state').textContent = host.testMode.isOn() ? 'On' : 'Off';
    $('menu-panel').hidden = false;
    $('menu-close').focus({ preventScroll: true });
  }
  function closeMenu() { $('menu-panel').hidden = true; }

  function go(screen) {
    closeMenu();
    location.hash = screen;
  }

  // ---------- test mode picker ----------

  function openPicker() {
    closeMenu();
    if (host.testMode.isOn()) {
      // Already on: start from the pretend day and time.
      var n = host.now();
      picked = { day: n.getDay() >= 1 && n.getDay() <= 5 ? n.getDay() : 1, time: pad(n.getHours()) + ':' + pad(n.getMinutes()) };
    } else {
      var r = host.realNow().getDay();
      picked = { day: r >= 1 && r <= 5 ? r : 1, time: '08:40' };
    }
    $('tm-error').hidden = true;
    renderPicker();
    $('test-picker').hidden = false;
    $('tm-cancel').focus({ preventScroll: true });
  }
  function closePicker() { $('test-picker').hidden = true; }

  function renderPicker() {
    var days = $('tm-days');
    days.textContent = '';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach(function (name, i) {
      var b = el('button', 'tm-choice' + (picked.day === i + 1 ? ' is-on' : ''), name);
      b.type = 'button';
      b.setAttribute('data-day', String(i + 1));
      b.setAttribute('aria-pressed', picked.day === i + 1 ? 'true' : 'false');
      days.appendChild(b);
    });
    var times = $('tm-times');
    times.textContent = '';
    timeChoices().forEach(function (c) {
      var b = el('button', 'tm-choice tm-time-choice' + (picked.time === c.time ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('data-time', c.time);
      b.setAttribute('aria-pressed', picked.time === c.time ? 'true' : 'false');
      b.appendChild(el('span', '', c.label));
      b.appendChild(el('small', '', c.time));
      times.appendChild(b);
    });
    if ($('tm-exact').value !== picked.time) $('tm-exact').value = picked.time;
    $('tm-start').textContent = host.testMode.isOn() ? 'Change test time' : 'Start test mode';
  }

  function start() {
    try {
      host.testMode.start(picked.day, picked.time);
    } catch (e) {
      $('tm-error').textContent = e.message;
      $('tm-error').hidden = false;
      return;
    }
    closePicker();
    location.hash = '';
  }

  // ---------- the amber strip ----------

  function renderStrip() {
    var on = host.testMode.isOn();
    document.documentElement.classList.toggle('test-mode', on);
    $('test-strip').hidden = !on;
    if (!on) return;
    var n = host.now();
    $('test-strip-text').textContent = 'TEST MODE · ' + root.Schedule.DAY_NAMES[n.getDay()].toUpperCase() + ' ' +
      pad(n.getHours()) + ':' + pad(n.getMinutes()) + ' · NOT THE REAL TIME';
  }

  function timeChanged() {
    renderStrip();
    if (stripTimer) { clearInterval(stripTimer); stripTimer = null; }
    if (host.testMode.isOn()) stripTimer = setInterval(renderStrip, 5000);
  }

  // ---------- wiring ----------

  function wire() {
    $('btn-menu').addEventListener('click', openMenu);
    $('menu-close').addEventListener('click', closeMenu);
    $('menu-panel').addEventListener('click', function (e) {
      if (e.target === $('menu-panel')) { closeMenu(); return; }
      var b = e.target.closest('[data-go]');
      if (b) go(b.getAttribute('data-go'));
    });
    $('menu-test').addEventListener('click', openPicker);
    $('tm-days').addEventListener('click', function (e) {
      var b = e.target.closest('[data-day]');
      if (!b) return;
      picked.day = +b.getAttribute('data-day');
      renderPicker();
    });
    $('tm-times').addEventListener('click', function (e) {
      var b = e.target.closest('[data-time]');
      if (!b) return;
      picked.time = b.getAttribute('data-time');
      renderPicker();
    });
    $('tm-exact').addEventListener('change', function () {
      if ($('tm-exact').value) { picked.time = $('tm-exact').value.slice(0, 5); renderPicker(); }
    });
    $('tm-cancel').addEventListener('click', closePicker);
    $('tm-start').addEventListener('click', start);
    $('test-picker').addEventListener('click', function (e) { if (e.target === $('test-picker')) closePicker(); });
    $('tm-off').addEventListener('click', function () { host.testMode.stop(); root.UI.toast('Test mode is off. Showing the real time.'); });
  }

  root.Menu = {
    init: function (h) { host = h; wire(); renderStrip(); },
    timeChanged: function () { if (host) timeChanged(); }
  };
})(this);
