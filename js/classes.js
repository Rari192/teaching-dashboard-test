/*
 * classes.js — the Classes screen: one place to set up each class and its default subject.
 *
 * Adding a class needs a name and a subject, so it has an explicit "Add class" button.
 * After that, every change saves the moment it is made.
 * Deleting a class always asks first and says how many lessons will become free.
 */
(function (root) {
  'use strict';

  var el = root.UI.el;
  var host = null;
  var selectedId = null;     // a class id, 'new', or null
  var newSubjectOpen = false;
  var draft = { name: '', subject: '' };   // the "New class" form before it is added
  var busy = false;

  function $(id) { return document.getElementById(id); }

  function classById(id) {
    return host.data().classes.filter(function (c) { return c.id === id; })[0] || null;
  }

  function lessonCounts(data) {
    var counts = {};
    for (var d = 1; d <= 5; d++) {
      (data.timetable[d] || []).forEach(function (slot) {
        if (slot) counts[slot.classId] = (counts[slot.classId] || 0) + 1;
      });
    }
    return counts;
  }

  function knownSubjects(data) {
    var seen = {}, list = [];
    data.classes.forEach(function (c) {
      var k = c.subject.toLowerCase();
      if (!seen[k]) { seen[k] = true; list.push(c.subject); }
    });
    return list.sort(function (a, b) { return a.localeCompare(b); });
  }

  function lessonsText(n) { return n === 1 ? '1 lesson a week' : n + ' lessons a week'; }

  function schemeById(id) {
    return host.data().schemes.filter(function (sc) { return sc.id === id; })[0] || null;
  }
  function yearName(scheme) { return scheme ? 'Year ' + scheme.yearGroup : ''; }
  function lessonAt(schemeId, position) {
    return host.data().lessons.filter(function (l) { return l.schemeId === schemeId && l.position === position; })[0] || null;
  }
  // "Year 9 · next Lesson 8", or '' if the class follows no scheme.
  function progressText(classId) {
    var p = host.data().progress[classId];
    if (!p) return '';
    return yearName(schemeById(p.schemeId)) + ' · next Lesson ' + p.position;
  }
  function shortDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // ---------- saved / not saved ----------

  function setStatus(state, message) {
    [$('classes-status'), $('class-panel-status')].forEach(function (t) {
      t.className = 'save-status is-' + state;
      t.textContent = '';
      if (state === 'saved') t.appendChild(root.UI.icon(root.UI.ICONS.check));
      t.appendChild(document.createTextNode(message));
    });
    $('classes-status').lastChild.textContent = state === 'saved' ? 'All changes saved' : message;
  }

  function showError(message) {
    var e = $('class-error');
    e.textContent = message;
    e.hidden = !message;
  }

  function save(change) {
    if (busy) return Promise.resolve(null);
    busy = true;
    showError('');
    setStatus('saving', 'Saving…');
    var result;
    return change().then(function (r) {
      result = r;
      return host.reload();
    }).then(function () {
      busy = false;
      setStatus('saved', 'Saved');
      return result === undefined ? true : result;
    }, function (err) {
      busy = false;
      setStatus('error', 'Not saved');
      showError((err && err.message ? err.message : 'Something went wrong.') + ' Nothing has been changed.');
      return null;
    });
  }

  // ---------- the list ----------

  function renderList() {
    var data = host.data();
    var counts = lessonCounts(data);
    var list = $('class-list');
    list.textContent = '';
    data.classes.forEach(function (c) {
      var b = el('button', 'class-row' + (c.id === selectedId ? ' is-selected' : ''));
      b.type = 'button';
      b.setAttribute('data-id', c.id);
      b.setAttribute('aria-pressed', c.id === selectedId ? 'true' : 'false');
      var left = el('span', 'class-row-main');
      left.appendChild(el('span', 'class-row-name', c.name));
      var where = progressText(c.id);
      left.appendChild(el('span', 'class-row-count', lessonsText(counts[c.id] || 0) + (where ? ' · ' + where : '')));
      b.appendChild(left);
      b.appendChild(el('span', 'class-row-subject', c.subject));
      list.appendChild(b);
    });
    $('class-list-empty').hidden = data.classes.length > 0;
  }

  // ---------- the panel ----------

  function subjectChips(current) {
    var data = host.data();
    var box = $('subject-options');
    box.textContent = '';
    knownSubjects(data).forEach(function (s) {
      var on = current && current.toLowerCase() === s.toLowerCase();
      var b = el('button', 'chip' + (on ? ' is-on' : ''), s);
      b.type = 'button';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('data-subject', s);
      box.appendChild(b);
    });
    var noneYet = knownSubjects(data).length === 0;
    var add = el('button', 'chip chip-add', '+ New subject');
    add.type = 'button';
    add.id = 'btn-new-subject';
    add.hidden = newSubjectOpen || noneYet;
    box.appendChild(add);
    $('new-subject-row').hidden = !(newSubjectOpen || noneYet);
  }

  function renderPanel() {
    var isNew = selectedId === 'new';
    var cls = isNew ? null : classById(selectedId);
    $('class-panel').hidden = !isNew && !cls;
    $('class-panel-none').hidden = isNew || !!cls;
    if (!isNew && !cls) return;

    $('class-panel-title').textContent = isNew ? 'New class' : 'Edit class';
    var nameInput = $('class-name');
    if (document.activeElement !== nameInput) nameInput.value = isNew ? draft.name : cls.name;
    subjectChips(isNew ? draft.subject : cls.subject);
    if (isNew && draft.subject && knownSubjects(host.data()).indexOf(draft.subject) === -1) {
      // a brand-new subject typed for the new class: show it as chosen
      var b = el('button', 'chip is-on', draft.subject);
      b.type = 'button';
      b.setAttribute('aria-pressed', 'true');
      b.setAttribute('data-subject', draft.subject);
      $('subject-options').insertBefore(b, $('btn-new-subject'));
    }

    renderProgress(isNew ? null : cls);
    $('class-note').hidden = isNew;
    $('new-class-actions').hidden = !isNew;
    $('btn-cancel-new').hidden = host.data().classes.length === 0;
    $('class-panel-foot').hidden = isNew;
  }

  // Scheme of work and next lesson for an existing class (hidden while adding a class).
  function renderProgress(cls) {
    $('scheme-field').hidden = !cls;
    $('position-field').hidden = true;
    if (!cls) return;
    var data = host.data();
    var p = data.progress[cls.id] || null;
    var box = $('scheme-options');
    box.textContent = '';
    data.schemes.forEach(function (sc) {
      var on = !!p && p.schemeId === sc.id;
      var b = el('button', 'chip' + (on ? ' is-on' : ''), yearName(sc));
      b.type = 'button';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('data-scheme', sc.id);
      box.appendChild(b);
    });
    var none = el('button', 'chip' + (p ? '' : ' is-on'), 'None');
    none.type = 'button';
    none.setAttribute('aria-pressed', p ? 'false' : 'true');
    none.setAttribute('data-scheme', '');
    box.appendChild(none);

    if (!p) return;
    $('position-field').hidden = false;
    var input = $('pos-input');
    if (document.activeElement !== input) input.value = p.position;
    $('pos-down').disabled = p.position <= 1;
    var lesson = lessonAt(p.schemeId, p.position);
    var title = $('pos-title');
    title.textContent = lesson ? lesson.title : 'Not imported yet';
    title.className = 'pos-title' + (lesson ? '' : ' is-missing');
    var log = Array.isArray(p.log) ? p.log : [];
    var last = log[log.length - 1];
    $('pos-last').textContent = last ? 'Last taught: Lesson ' + last.position + ', ' + shortDate(last.taughtOn) : '';
    $('pos-last').hidden = !last;
  }

  function render() {
    var data = host.data();
    // Nothing chosen yet: pick the first class, or start a new one if there are none.
    if (selectedId !== 'new' && !classById(selectedId)) {
      selectedId = data.classes.length ? data.classes[0].id : 'new';
    }
    renderList();
    renderPanel();
  }

  // ---------- actions ----------

  function select(id) {
    commitName().then(function () {
      selectedId = id;
      newSubjectOpen = false;
      showError('');
      clearPanelStatus();
      render();
    });
  }

  function clearPanelStatus() {
    $('class-panel-status').className = 'save-status';
    $('class-panel-status').textContent = '';
  }

  function startNew() {
    commitName().then(function () {
      selectedId = 'new';
      draft = { name: '', subject: '' };
      newSubjectOpen = false;
      showError('');
      clearPanelStatus();
      render();
      $('class-name').focus();
    });
  }

  // Saves a changed class name (existing classes only). Called on Enter, on leaving the
  // field, and before moving elsewhere so nothing typed is lost.
  function commitName() {
    if (selectedId === 'new' || !selectedId) return Promise.resolve();
    var cls = classById(selectedId);
    if (!cls) return Promise.resolve();
    var typed = $('class-name').value.trim();
    if (typed === cls.name) return Promise.resolve();
    return save(function () {
      return host.store().saveClass({ id: cls.id, name: typed, subject: cls.subject });
    }).then(function (ok) {
      if (!ok) $('class-name').value = typed; // keep what was typed so it can be corrected
      render();
    });
  }

  function chooseSubject(subject) {
    var clean = (subject || '').trim();
    if (!clean) return;
    if (selectedId === 'new') {
      draft.subject = clean;
      draft.name = $('class-name').value;
      newSubjectOpen = false;
      renderPanel();
      return;
    }
    var cls = classById(selectedId);
    if (!cls || cls.subject === clean) return;
    save(function () {
      return host.store().saveClass({ id: cls.id, name: cls.name, subject: clean });
    }).then(function () {
      newSubjectOpen = false;
      $('new-subject-input').value = '';
      render();
    });
  }

  function addClass() {
    var name = $('class-name').value.trim();
    var subject = draft.subject || $('new-subject-input').value.trim();
    save(function () {
      return host.store().saveClass({ name: name, subject: subject });
    }).then(function (saved) {
      if (!saved) return;
      selectedId = saved.id;
      draft = { name: '', subject: '' };
      newSubjectOpen = false;
      $('new-subject-input').value = '';
      render();
      root.UI.toast(saved.name + ' added.');
    });
  }

  function chooseScheme(schemeId) {
    var cls = classById(selectedId);
    if (!cls) return;
    var p = host.data().progress[cls.id] || null;
    var target = schemeId || null;
    if ((p ? p.schemeId : null) === target) return;
    var underway = p && (p.position > 1 || (p.log && p.log.length));
    var ask = Promise.resolve(true);
    if (underway) {
      var from = yearName(schemeById(p.schemeId));
      ask = root.UI.confirm({
        title: target ? 'Move ' + cls.name + ' to ' + yearName(schemeById(target)) + '?' : 'Unlink ' + cls.name + ' from ' + from + '?',
        message: cls.name + ' is on Lesson ' + p.position + ' of ' + from + '. ' +
          (target ? 'It will start ' + yearName(schemeById(target)) + ' at Lesson 1, and its place in ' + from + ' will be lost.'
                  : 'Its place in ' + from + ' will be removed.'),
        confirmLabel: target ? 'Change scheme' : 'Unlink'
      });
    }
    ask.then(function (yes) {
      if (!yes) return;
      save(function () { return host.store().setClassScheme(cls.id, target); }).then(function () { render(); });
    });
  }

  function setPosition(n) {
    var cls = classById(selectedId);
    var p = cls && host.data().progress[cls.id];
    if (!p) return;
    if (!(n >= 1) || Math.floor(n) !== n) {
      showError('The lesson number must be a whole number, 1 or more.');
      $('pos-input').value = p.position;
      return;
    }
    if (n === p.position) { renderProgress(cls); return; }
    save(function () { return host.store().setClassPosition(cls.id, n); }).then(function () { render(); });
  }

  function deleteClass() {
    var cls = classById(selectedId);
    if (!cls) return;
    host.store().countLessonsForClass(cls.id).then(function (n) {
      var message = n === 0
        ? cls.name + ' is not in your timetable, so no lessons are affected.'
        : 'Its ' + (n === 1 ? 'lesson' : n + ' lessons') + ' in your timetable will become ' + (n === 1 ? 'a free period' : 'free periods') + '.';
      var where = progressText(cls.id);
      if (where) message += ' Its place in its scheme of work (' + where + ') will also be removed.';
      if (n !== 0 || where) message += ' This cannot be undone.';
      return root.UI.confirm({ title: 'Delete ' + cls.name + '?', message: message, confirmLabel: 'Delete class' });
    }).then(function (yes) {
      if (!yes) return;
      var name = cls.name;
      save(function () { return host.store().deleteClass(cls.id); }).then(function (freed) {
        if (freed === null) return;
        selectedId = null;
        render();
        root.UI.toast(name + ' deleted' + (freed ? '. ' + freed + (freed === 1 ? ' lesson is' : ' lessons are') + ' now free.' : '.'));
      });
    });
  }

  // ---------- wiring ----------

  function wire() {
    $('btn-add-class').addEventListener('click', startNew);
    $('class-list').addEventListener('click', function (e) {
      var row = e.target.closest('[data-id]');
      if (row) select(row.getAttribute('data-id'));
    });
    $('class-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    $('class-name').addEventListener('change', function () {
      if (selectedId === 'new') draft.name = $('class-name').value; else commitName();
    });
    $('subject-options').addEventListener('click', function (e) {
      if (e.target.closest('#btn-new-subject')) {
        if (selectedId === 'new') draft.name = $('class-name').value;
        newSubjectOpen = true;
        renderPanel();
        $('new-subject-input').focus();
        return;
      }
      var b = e.target.closest('[data-subject]');
      if (b) chooseSubject(b.getAttribute('data-subject'));
    });
    $('new-subject-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); chooseSubject(e.target.value); }
    });
    $('btn-use-new-subject').addEventListener('click', function () { chooseSubject($('new-subject-input').value); });
    $('btn-create-class').addEventListener('click', addClass);
    $('btn-cancel-new').addEventListener('click', function () { selectedId = null; render(); });
    $('btn-delete-class').addEventListener('click', deleteClass);
    $('scheme-options').addEventListener('click', function (e) {
      var b = e.target.closest('[data-scheme]');
      if (b) chooseScheme(b.getAttribute('data-scheme'));
    });
    $('pos-down').addEventListener('click', function () {
      var p = host.data().progress[selectedId];
      if (p && p.position > 1) setPosition(p.position - 1);
    });
    $('pos-up').addEventListener('click', function () {
      var p = host.data().progress[selectedId];
      if (p) setPosition(p.position + 1);
    });
    $('pos-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    $('pos-input').addEventListener('change', function () {
      setPosition(parseInt($('pos-input').value, 10));
    });
  }

  root.Classes = {
    init: function (h) { host = h; wire(); },
    show: function () {
      showError('');
      clearPanelStatus();
      render();
    },
    leave: function () { return commitName(); }
  };
})(this);
