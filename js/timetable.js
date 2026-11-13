/*
 * timetable.js — the weekly timetable screen and the edit-period sheet.
 *
 * Viewing is the default. Changes are only possible after tapping Edit,
 * so a stray tap while teaching cannot alter the timetable.
 * Every change is saved the moment it is made.
 */
(function (root) {
  'use strict';

  var S = root.Schedule;
  var el = root.UI.el;
  var DAY_SHORT = ['', 'MON', 'TUE', 'WED', 'THU', 'FRI'];
  var DAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  // Supplied by app.js: get the latest data, save a change, and the current time.
  var host = null;

  var editing = false;
  var sheet = null;          // { weekday, periodIndex, mode: 'lesson' | 'free', overrideOpen }
  var busy = false;          // a save is in progress

  function $(id) { return document.getElementById(id); }

  function slotAt(data, d, p) { return data.timetable[d] ? data.timetable[d][p] : null; }

  // ---------- the week grid ----------

  function band(label, times) {
    var b = el('div', 'tt-band');
    b.appendChild(el('span', '', label + ' · ' + times));
    b.appendChild(el('span', 'tt-band-line'));
    return b;
  }

  function cellFor(data, d, p, isNow) {
    var slot = slotAt(data, d, p);
    var lesson = S.resolveSlot(slot, data.classes);
    var cell = el('button', 'tt-cell');
    cell.type = 'button';
    cell.setAttribute('data-day', d);
    cell.setAttribute('data-period', p);
    var where = DAY_LONG[d] + ' period ' + (p + 1);
    if (!lesson) {
      cell.classList.add('is-free');
      cell.appendChild(el('span', 'tt-cell-free', 'Free'));
      cell.setAttribute('aria-label', where + ': free');
    } else {
      var top = el('span', 'tt-cell-top');
      top.appendChild(el('span', 'tt-cell-class', lesson.className));
      if (isNow) top.appendChild(el('span', 'now-tag', 'NOW'));
      cell.appendChild(top);
      var sub = el('span', 'tt-cell-subject');
      if (lesson.isOverride) {
        var dot = el('span', 'override-dot');
        dot.setAttribute('role', 'img');
        dot.setAttribute('aria-label', 'Subject changed for this lesson only');
        sub.appendChild(dot);
        cell.classList.add('is-override');
      }
      sub.appendChild(document.createTextNode(lesson.subject));
      cell.appendChild(sub);
      cell.setAttribute('aria-label', where + ': ' + lesson.className + ', ' + lesson.subject + (lesson.isOverride ? ' (this lesson only)' : ''));
    }
    if (isNow) cell.classList.add('is-now');
    if (editing) cell.classList.add('is-editing');
    return cell;
  }

  function renderGrid() {
    var data = host.data();
    var now = host.now();
    var today = now.getDay();
    var periodNow = S.periodIndexAt(now);
    var grid = $('week-grid');
    grid.textContent = '';

    grid.appendChild(el('span', 'tt-corner'));
    for (var d = 1; d <= 5; d++) {
      var h = el('span', 'tt-day' + (d === today ? ' is-today' : ''), DAY_SHORT[d] + (d === today ? ' · TODAY' : ''));
      grid.appendChild(h);
    }
    S.PERIODS.forEach(function (period, p) {
      if (p === 2) grid.appendChild(band('BREAK', '11:10–11:30'));
      if (p === 3) grid.appendChild(band('LUNCH', '12:35–13:10'));
      var label = el('span', 'tt-period' + (p === periodNow ? ' is-now' : ''));
      label.appendChild(el('span', 'tt-period-num', period.label));
      label.appendChild(el('span', 'tt-period-time', period.start + '–' + period.end));
      grid.appendChild(label);
      for (var day = 1; day <= 5; day++) {
        grid.appendChild(cellFor(data, day, p, day === today && p === periodNow));
      }
    });
  }

  function renderHeader() {
    var screen = $('screen-timetable');
    screen.classList.toggle('is-editing', editing);
    var btn = $('btn-edit');
    btn.textContent = editing ? 'Done' : 'Edit';
    btn.classList.toggle('btn-primary', editing);
    btn.setAttribute('aria-pressed', editing ? 'true' : 'false');
    $('tt-mode').textContent = editing ? 'Editing · tap any period to change it' : 'Same every week';
  }

  function render() {
    renderHeader();
    renderGrid();
    if (sheet) renderSheet();
  }

  // ---------- saved / not saved indicators ----------

  function setStatus(state, message) {
    var targets = [$('save-status'), $('sheet-status')];
    targets.forEach(function (t) {
      t.className = 'save-status is-' + state;
      t.textContent = '';
      if (state === 'saved') t.appendChild(root.UI.icon(root.UI.ICONS.check));
      t.appendChild(document.createTextNode(message));
    });
  }

  // Runs one change through storage, then reloads and redraws everything.
  function save(change) {
    if (busy) return Promise.resolve(false);
    busy = true;
    $('sheet-error').hidden = true;
    setStatus('saving', 'Saving…');
    return change().then(function () {
      return host.reload();
    }).then(function () {
      busy = false;
      setStatus('saved', 'Saved');
      $('save-status').lastChild.textContent = 'All changes saved';
      render();
      return true;
    }, function (err) {
      busy = false;
      setStatus('error', 'Not saved');
      var e = $('sheet-error');
      e.textContent = (err && err.message ? err.message : 'Something went wrong.') + ' Your timetable has not been changed.';
      e.hidden = false;
      render();
      return false;
    });
  }

  // ---------- the edit sheet ----------

  function knownSubjects(data) {
    var seen = {}, list = [];
    function add(s) { var k = s.toLowerCase(); if (s && !seen[k]) { seen[k] = true; list.push(s); } }
    data.classes.forEach(function (c) { add(c.subject); });
    for (var d = 1; d <= 5; d++) (data.timetable[d] || []).forEach(function (slot) { if (slot && slot.subjectOverride) add(slot.subjectOverride); });
    return list;
  }

  function chip(text, pressed) {
    var b = el('button', 'chip' + (pressed ? ' is-on' : ''), text);
    b.type = 'button';
    b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    return b;
  }

  function renderSheet() {
    var data = host.data();
    var slot = slotAt(data, sheet.weekday, sheet.periodIndex);
    var lesson = S.resolveSlot(slot, data.classes);
    var period = S.PERIODS[sheet.periodIndex];
    if (lesson) sheet.mode = 'lesson';

    $('sheet-day').textContent = DAY_LONG[sheet.weekday].toUpperCase() + ' · PERIOD ' + period.number;
    $('sheet-title').textContent = period.start + '–' + period.end;

    $('seg-lesson').setAttribute('aria-pressed', sheet.mode === 'lesson' ? 'true' : 'false');
    $('seg-free').setAttribute('aria-pressed', sheet.mode === 'free' ? 'true' : 'false');
    $('sheet-lesson-body').hidden = sheet.mode !== 'lesson';
    $('sheet-free-msg').hidden = sheet.mode !== 'free';

    // class chips
    var chips = $('class-chips');
    chips.textContent = '';
    data.classes.forEach(function (c) {
      var b = chip(c.name, lesson && lesson.classId === c.id);
      b.setAttribute('data-class-id', c.id);
      chips.appendChild(b);
    });
    $('no-classes').hidden = data.classes.length > 0;

    // subject
    var value = $('subject-value');
    var source = $('subject-source');
    if (lesson) {
      value.textContent = lesson.subject;
      value.classList.remove('is-muted');
      source.textContent = lesson.isOverride ? 'This lesson only' : 'From class';
      source.classList.toggle('is-override', lesson.isOverride);
    } else {
      value.textContent = 'Choose a class first';
      value.classList.add('is-muted');
      source.textContent = 'Currently free';
      source.classList.remove('is-override');
    }
    var cls = lesson ? data.classes.filter(function (c) { return c.id === lesson.classId; })[0] : null;
    $('btn-override').hidden = !lesson || lesson.isOverride || sheet.overrideOpen;
    $('btn-use-default').hidden = !lesson || !lesson.isOverride;
    if (cls) $('btn-use-default').textContent = 'Use class default (' + cls.subject + ')';

    // override editor
    var editor = $('override-editor');
    editor.hidden = !(lesson && sheet.overrideOpen);
    if (!editor.hidden) {
      var input = $('override-input');
      if (document.activeElement !== input) input.value = lesson.isOverride ? lesson.subject : '';
      var subjChips = $('subject-chips');
      subjChips.textContent = '';
      knownSubjects(data).forEach(function (s) {
        if (cls && s === cls.subject) return; // choosing the default is not an override
        var b = chip(s, lesson.isOverride && lesson.subject === s);
        b.setAttribute('data-subject', s);
        subjChips.appendChild(b);
      });
    }
  }

  function openSheet(weekday, periodIndex) {
    var data = host.data();
    var hasLesson = !!S.resolveSlot(slotAt(data, weekday, periodIndex), data.classes);
    // A free period opens ready to choose a class; the Free button shows it is currently free.
    sheet = { weekday: weekday, periodIndex: periodIndex, mode: 'lesson', overrideOpen: false };
    $('sheet-error').hidden = true;
    $('sheet-status').className = 'save-status';
    $('sheet-status').textContent = '';
    renderSheet();
    $('period-sheet').hidden = false;
    $('sheet-done').focus();
  }

  function closeSheet() {
    // Save anything typed but not yet confirmed before closing.
    var pending = commitTypedOverride();
    return pending.then(function () {
      sheet = null;
      $('period-sheet').hidden = true;
    });
  }

  function currentLesson() {
    var data = host.data();
    return S.resolveSlot(slotAt(data, sheet.weekday, sheet.periodIndex), data.classes);
  }

  function pickClass(classId) {
    var lesson = currentLesson();
    if (lesson && lesson.classId === classId) return;
    sheet.overrideOpen = false;
    var d = sheet.weekday, p = sheet.periodIndex;
    save(function () { return host.store().setSlot(d, p, { classId: classId }); });
  }

  function makeFree() {
    var lesson = currentLesson();
    if (!lesson) { sheet.mode = 'free'; renderSheet(); return; }
    var d = sheet.weekday, p = sheet.periodIndex;
    var where = DAY_LONG[d] + ' Period ' + (p + 1);
    root.UI.confirm({
      title: 'Make ' + where + ' a free period?',
      message: 'This removes ' + lesson.className + ' · ' + lesson.subject + ' from ' + where + '. Your class and its other lessons are not affected.',
      confirmLabel: 'Make free'
    }).then(function (yes) {
      if (!yes) return;
      sheet.overrideOpen = false;
      sheet.mode = 'free';
      save(function () { return host.store().setSlot(d, p, null); });
    });
  }

  function setOverride(subject) {
    var lesson = currentLesson();
    if (!lesson) return Promise.resolve();
    var clean = (subject || '').trim();
    if (!clean || clean === lesson.subject) return Promise.resolve();
    var d = sheet.weekday, p = sheet.periodIndex;
    return save(function () { return host.store().setSlot(d, p, { classId: lesson.classId, subjectOverride: clean }); })
      .then(function (ok) { if (ok) { sheet.overrideOpen = false; renderSheet(); } });
  }

  function useDefault() {
    var lesson = currentLesson();
    if (!lesson) return;
    var d = sheet.weekday, p = sheet.periodIndex;
    sheet.overrideOpen = false;
    save(function () { return host.store().setSlot(d, p, { classId: lesson.classId }); });
  }

  function commitTypedOverride() {
    if (!sheet || !sheet.overrideOpen) return Promise.resolve();
    var input = $('override-input');
    return setOverride(input.value);
  }

  // ---------- wiring ----------

  function wire() {
    $('btn-edit').addEventListener('click', function () {
      editing = !editing;
      render();
    });
    $('btn-classes').addEventListener('click', function () { location.hash = 'classes'; });
    $('btn-backup').addEventListener('click', function () { location.hash = 'backup'; });

    $('week-grid').addEventListener('click', function (e) {
      var cell = e.target.closest('.tt-cell');
      if (!cell) return;
      if (!editing) { root.UI.toast('Tap Edit to change your timetable.'); return; }
      openSheet(Number(cell.getAttribute('data-day')), Number(cell.getAttribute('data-period')));
    });

    $('seg-lesson').addEventListener('click', function () { sheet.mode = 'lesson'; renderSheet(); });
    $('seg-free').addEventListener('click', makeFree);

    $('class-chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-class-id]');
      if (b) pickClass(b.getAttribute('data-class-id'));
    });

    $('btn-override').addEventListener('click', function () {
      sheet.overrideOpen = true;
      renderSheet();
      $('override-input').focus();
    });
    $('btn-use-default').addEventListener('click', useDefault);
    $('subject-chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-subject]');
      if (b) setOverride(b.getAttribute('data-subject'));
    });
    $('override-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); setOverride(e.target.value); e.target.blur(); }
    });
    $('override-cancel').addEventListener('click', function () {
      sheet.overrideOpen = false;
      $('override-input').value = '';
      renderSheet();
    });

    $('sheet-done').addEventListener('click', closeSheet);
    $('period-sheet').addEventListener('click', function (e) { if (e.target === $('period-sheet')) closeSheet(); });
  }

  root.Timetable = {
    init: function (h) { host = h; wire(); },
    show: function () { render(); },
    // Called when leaving the screen: close any sheet and leave Edit mode.
    leave: function () {
      var p = sheet ? closeSheet() : Promise.resolve();
      return p.then(function () { editing = false; });
    },
    refresh: function () { if (!$('screen-timetable').hidden) renderGrid(); },
    isEditing: function () { return editing; }
  };
})(this);
