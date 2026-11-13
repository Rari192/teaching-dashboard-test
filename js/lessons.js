/*
 * lessons.js — the Lessons screen: the lessons saved on this iPad, by year group,
 * and importing lesson files from the Files app.
 *
 * Importing always shows a preview first and saves nothing until "Import" is tapped.
 * A lesson already saved at the same position is only replaced if the user switches
 * that file to "Replace" AND confirms. Importing never changes any class's progress.
 */
(function (root) {
  'use strict';

  var el = root.UI.el;
  var host = null;
  var selectedScheme = null;   // scheme id shown on the right
  var pending = null;          // { files, items, replace: { lessonId: true } } while the preview is open
  var detailId = null;         // lesson id shown in the detail sheet

  function $(id) { return document.getElementById(id); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function yearName(scheme) { return 'Year ' + scheme.yearGroup; }

  function schemeById(id) {
    return host.data().schemes.filter(function (s) { return s.id === id; })[0] || null;
  }

  function dayOnly(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return 'an unknown date';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Classes following each scheme, with their next lesson: { schemeId: [{ name, position }] }
  function classesByScheme(data) {
    var out = {};
    data.classes.forEach(function (c) {
      var p = data.progress[c.id];
      if (!p) return;
      (out[p.schemeId] = out[p.schemeId] || []).push({ id: c.id, name: c.name, position: p.position });
    });
    return out;
  }

  function lessonsOf(data, schemeId) {
    return data.lessons.filter(function (l) { return l.schemeId === schemeId; });
  }

  // ---------- message strip ----------

  function showMessage(kind, title, lines) {
    var box = $('lessons-message');
    box.className = 'backup-message is-' + kind;
    box.textContent = '';
    box.appendChild(el('strong', '', title));
    if (lines && lines.length) {
      var list = el('ul');
      lines.forEach(function (l) { list.appendChild(el('li', '', l)); });
      box.appendChild(list);
    }
    box.hidden = false;
  }
  function hideMessage() { $('lessons-message').hidden = true; }

  // ---------- the screen ----------

  function renderSchemes() {
    var data = host.data();
    var following = classesByScheme(data);
    var list = $('scheme-list');
    list.textContent = '';
    data.schemes.forEach(function (s) {
      var n = lessonsOf(data, s.id).length;
      var b = el('button', 'class-row' + (s.id === selectedScheme ? ' is-selected' : ''));
      b.type = 'button';
      b.setAttribute('data-scheme', s.id);
      b.setAttribute('aria-pressed', s.id === selectedScheme ? 'true' : 'false');
      var left = el('span', 'class-row-main');
      left.appendChild(el('span', 'class-row-name', yearName(s)));
      var who = (following[s.id] || []).map(function (c) { return c.name; });
      left.appendChild(el('span', 'class-row-count', who.length ? who.join(', ') : 'No classes linked'));
      b.appendChild(left);
      b.appendChild(el('span', 'class-row-subject', n === 0 ? 'No lessons' : plural(n, 'lesson', 'lessons')));
      list.appendChild(b);
    });
  }

  function renderLessonList() {
    var data = host.data();
    var scheme = schemeById(selectedScheme);
    var box = $('lesson-list');
    box.textContent = '';
    if (!scheme) return;
    $('lesson-panel-title').textContent = scheme.title;

    var lessons = lessonsOf(data, scheme.id);
    var classes = classesByScheme(data)[scheme.id] || [];

    // Rows: every imported lesson, plus a placeholder for any position a class is on
    // that has not been imported yet, so "next" is never hidden.
    var rows = lessons.map(function (l) { return { position: l.position, lesson: l }; });
    classes.forEach(function (c) {
      if (!rows.some(function (r) { return r.position === c.position; })) rows.push({ position: c.position, lesson: null });
    });
    rows.sort(function (a, b) { return a.position - b.position; });

    $('lesson-list-empty').hidden = rows.length > 0;
    $('lesson-list-empty').textContent = 'No ' + yearName(scheme) + ' lessons yet. Tap "Import lessons" to add lesson files from the Files app.';

    rows.forEach(function (r) {
      var here = classes.filter(function (c) { return c.position === r.position; }).map(function (c) { return c.name; });
      var row = el(r.lesson ? 'button' : 'div', 'lesson-row' + (r.lesson ? '' : ' is-missing'));
      if (r.lesson) { row.type = 'button'; row.setAttribute('data-lesson', r.lesson.id); }
      row.appendChild(el('span', 'lesson-num', String(r.position)));
      var main = el('span', 'lesson-main');
      main.appendChild(el('span', 'lesson-title', r.lesson ? r.lesson.title : 'Not imported yet'));
      if (r.lesson) {
        var meta = [r.lesson.type, r.lesson.topic].filter(Boolean).join(' · ');
        main.appendChild(el('span', 'lesson-meta', meta + (meta ? ' · ' : '') + 'v' + r.lesson.version));
      }
      row.appendChild(main);
      if (here.length) row.appendChild(el('span', 'next-tag', 'Next: ' + here.join(', ')));
      box.appendChild(row);
    });
  }

  function render() {
    var data = host.data();
    if (!schemeById(selectedScheme)) {
      // Start on the first year that has lessons, otherwise the first year.
      var withLessons = data.schemes.filter(function (s) { return lessonsOf(data, s.id).length; })[0];
      selectedScheme = (withLessons || data.schemes[0] || {}).id || null;
    }
    renderSchemes();
    renderLessonList();
  }

  // ---------- lesson details and delete ----------

  function openDetail(id) {
    var l = host.data().lessons.filter(function (x) { return x.id === id; })[0];
    if (!l) return;
    detailId = id;
    var s = schemeById(l.schemeId);
    $('ld-eyebrow').textContent = (s ? yearName(s) : l.schemeId) + ' · Lesson ' + l.position;
    $('ld-title').textContent = l.title;
    var rows = $('ld-rows');
    rows.textContent = '';
    [
      ['Learning objective', l.lesson.objective],
      ['Topic', l.topic],
      ['Type', l.type || '—'],
      ['Version', String(l.version)],
      ['Imported', dayOnly(l.importedAt)],
      ['Lesson id', l.id]
    ].forEach(function (pair) {
      var r = el('div', 'ld-row');
      r.appendChild(el('span', 'eyebrow', pair[0]));
      r.appendChild(el('span', 'ld-value', pair[1]));
      rows.appendChild(r);
    });
    $('lesson-detail').hidden = false;
    $('ld-close').focus();
  }

  function closeDetail() { $('lesson-detail').hidden = true; detailId = null; }

  function deleteLesson() {
    var l = host.data().lessons.filter(function (x) { return x.id === detailId; })[0];
    if (!l) return;
    var s = schemeById(l.schemeId);
    root.UI.confirm({
      title: 'Delete this lesson?',
      message: '"' + l.title + '" (' + (s ? yearName(s) : l.schemeId) + ', Lesson ' + l.position + ') will be removed from this iPad. ' +
        'Classes keep their place. You can import the file again later.',
      confirmLabel: 'Delete lesson'
    }).then(function (yes) {
      if (!yes) return;
      host.store().deleteLesson(l.id).then(function () { return host.reload(); }).then(function () {
        closeDetail();
        render();
        root.UI.toast('Lesson deleted.');
      }, function (err) {
        closeDetail();
        showMessage('error', 'The lesson was not deleted.', [err && err.message ? err.message : '']);
      });
    });
  }

  // ---------- import ----------

  function readFile(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  function chooseFiles() {
    hideMessage();
    var input = $('lesson-files');
    input.value = '';
    input.click();
  }

  function filesChosen() {
    var input = $('lesson-files');
    var chosen = Array.prototype.slice.call(input.files || []);
    if (!chosen.length) return;
    hideMessage();
    Promise.all(chosen.map(function (f) {
      return readFile(f).then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (e) { data = undefined; }
        return { name: f.name, data: data };
      }, function () { return { name: f.name, data: undefined }; });
    })).then(function (files) {
      input.value = ''; // so the same files can be chosen again later
      return host.store().previewImport(files).then(function (items) {
        pending = { files: files, items: items, replace: {} };
        renderPreview();
        $('import-preview').hidden = false;
        $('ip-cancel').focus({ preventScroll: true });
        $('import-preview').querySelector('.sheet').scrollTop = 0;
      });
    }).catch(function (err) {
      showMessage('error', 'The files could not be checked. Nothing has been changed.', [err && err.message ? err.message : '']);
    });
  }

  var GROUPS = [
    { key: 'add', title: 'Will be added', kind: 'new' },
    { key: 'update', title: 'Will be updated', kind: 'update' },
    { key: 'decide', title: 'Needs your decision', kind: 'clash' },
    { key: 'skip', title: 'Not imported', kind: 'skip' }
  ];

  var SKIP_LABEL = {
    same: 'Already imported',
    conflict: 'Different content, same version',
    older: 'Older version',
    repeat: 'Chosen twice',
    invalid: 'Problem with the file'
  };

  function groupOf(item) {
    if (item.status === 'new') return 'add';
    if (item.status === 'update') return 'update';
    if (item.status === 'clash') return 'decide';
    return 'skip';
  }

  function itemHeading(item) {
    var r = item.record;
    if (!r) return item.fileName;
    var s = schemeById(r.schemeId);
    return (s ? yearName(s) : r.schemeId) + ' · Lesson ' + r.position + ' · ' + r.title;
  }

  function importCount() {
    if (!pending) return 0;
    return pending.items.filter(function (i) {
      return i.status === 'new' || i.status === 'update' || (i.status === 'clash' && pending.replace[i.record.id]);
    }).length;
  }

  function renderPreview() {
    var items = pending.items;
    $('ip-title').textContent = 'Import ' + plural(items.length, 'file', 'files');
    var body = $('ip-groups');
    body.textContent = '';
    GROUPS.forEach(function (g) {
      var inGroup = items.filter(function (i) { return groupOf(i) === g.key; });
      if (!inGroup.length) return;
      var section = el('section', 'ip-group is-' + g.kind);
      var head = el('h3', 'ip-group-head');
      head.appendChild(el('span', 'ip-dot'));
      head.appendChild(document.createTextNode(g.title + ' (' + inGroup.length + ')'));
      section.appendChild(head);
      inGroup.forEach(function (item) { section.appendChild(previewRow(item)); });
      body.appendChild(section);
    });
    var n = importCount();
    var go = $('ip-import');
    go.disabled = n === 0;
    go.textContent = n === 0 ? 'Nothing to import' : 'Import ' + plural(n, 'lesson', 'lessons');
  }

  function previewRow(item) {
    var row = el('div', 'ip-row');
    var text = el('div', 'ip-text');
    text.appendChild(el('span', 'ip-heading', itemHeading(item)));
    var detail;
    if (item.status === 'new') detail = 'New lesson · version ' + item.record.version;
    else if (item.status === 'update') detail = 'Version ' + item.existing.version + ' → ' + item.record.version +
      (item.moveFrom ? ' · moves from Lesson ' + item.moveFrom : '');
    else if (item.status === 'clash') detail = 'Lesson ' + item.record.position + ' is already "' + item.clashWith.title + '" (version ' + item.clashWith.version + ').';
    else if (item.status === 'same') detail = 'Already imported (version ' + item.record.version + '). Nothing to change.';
    else if (item.status === 'conflict') detail = 'Same version number (' + item.record.version + ') as the saved lesson, but different content. ' +
      'A changed lesson needs a higher version number.';
    else detail = SKIP_LABEL[item.status] + ': ' + item.message;
    text.appendChild(el('span', 'ip-detail', detail));
    if (item.status === 'invalid' && item.errors && item.errors.length > 1) {
      text.appendChild(el('span', 'ip-detail', 'and ' + plural(item.errors.length - 1, 'more problem', 'more problems') + '.'));
    }
    text.appendChild(el('span', 'ip-file', item.fileName));
    row.appendChild(text);

    if (item.status === 'clash') {
      var on = !!pending.replace[item.record.id];
      var seg = el('div', 'segmented ip-choice');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Keep or replace');
      [['keep', 'Keep existing', !on], ['replace', 'Replace', on]].forEach(function (opt) {
        var b = el('button', '', opt[1]);
        b.type = 'button';
        b.setAttribute('aria-pressed', opt[2] ? 'true' : 'false');
        b.setAttribute('data-choice', opt[0]);
        b.setAttribute('data-lesson', item.record.id);
        seg.appendChild(b);
      });
      row.appendChild(seg);
    }
    return row;
  }

  function closePreview() {
    $('import-preview').hidden = true;
    pending = null;
  }

  function doImport() {
    if (!pending) return;
    var replacing = pending.items.filter(function (i) { return i.status === 'clash' && pending.replace[i.record.id]; });
    var ask = replacing.length ? root.UI.confirm({
      title: replacing.length === 1 ? 'Replace a lesson?' : 'Replace ' + replacing.length + ' lessons?',
      message: replacing.map(function (i) {
        return '"' + i.clashWith.title + '" will be removed and replaced by "' + i.record.title + '" as Lesson ' + i.record.position + '.';
      }).join(' ') + ' Classes keep their place.',
      confirmLabel: 'Replace'
    }) : Promise.resolve(true);

    ask.then(function (yes) {
      if (!yes || !pending) return;
      var go = $('ip-import');
      go.disabled = true;
      var replaceIds = replacing.map(function (i) { return i.record.id; });
      host.store().commitImport(pending.files, replaceIds).then(function (result) {
        return host.reload().then(function () { return result; });
      }).then(function (result) {
        var first = pending.items.filter(function (i) { return i.record && (i.status === 'new' || i.status === 'update' || replaceIds.indexOf(i.record.id) !== -1); })[0];
        closePreview();
        if (first) selectedScheme = first.record.schemeId;
        render();
        // result.added/updated also count lessons that replaced another one; report replacements on their own.
        var replacedNew = replacing.filter(function (i) { return i.clashOf === 'new'; }).length;
        var replacedUpd = replacing.length - replacedNew;
        var parts = [];
        var added = result.added - (result.replaced.length ? replacedNew : 0);
        var updated = result.updated - (result.replaced.length ? replacedUpd : 0);
        if (added > 0) parts.push(plural(added, 'new lesson', 'new lessons'));
        if (updated > 0) parts.push(plural(updated, 'lesson', 'lessons') + ' updated');
        if (result.replaced.length) parts.push(plural(result.replaced.length, 'lesson', 'lessons') + ' replaced');
        if (parts.length) showMessage('ok', 'Imported: ' + parts.join(', ') + '. Class progress has not changed.');
        else showMessage('info', 'Nothing was imported. The lessons on this iPad have changed since the preview; please import again.');
      }, function (err) {
        closePreview();
        showMessage('error', 'Nothing was imported. Nothing has been changed.', [err && err.message ? err.message : '']);
      });
    });
  }

  // ---------- wiring ----------

  function wire() {
    $('btn-lessons').addEventListener('click', function () { location.hash = 'lessons'; });
    $('btn-import-lessons').addEventListener('click', chooseFiles);
    $('lesson-files').addEventListener('change', filesChosen);
    $('scheme-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-scheme]');
      if (!b) return;
      selectedScheme = b.getAttribute('data-scheme');
      render();
    });
    $('lesson-list').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-lesson]');
      if (b) openDetail(b.getAttribute('data-lesson'));
    });
    $('ld-close').addEventListener('click', closeDetail);
    $('ld-delete').addEventListener('click', deleteLesson);
    $('lesson-detail').addEventListener('click', function (e) { if (e.target === $('lesson-detail')) closeDetail(); });
    $('ip-groups').addEventListener('click', function (e) {
      var b = e.target.closest('[data-choice]');
      if (!b || !pending) return;
      var id = b.getAttribute('data-lesson');
      if (b.getAttribute('data-choice') === 'replace') pending.replace[id] = true; else delete pending.replace[id];
      renderPreview();
    });
    $('ip-cancel').addEventListener('click', closePreview);
    $('ip-import').addEventListener('click', doImport);
  }

  root.Lessons = {
    init: function (h) { host = h; wire(); },
    show: function () { hideMessage(); render(); return Promise.resolve(); },
    leave: function () { closePreview(); closeDetail(); return Promise.resolve(); }
  };
})(this);
