/*
 * backup.js — the Backup & restore screen.
 *
 * Export: builds one JSON file of all classes and the timetable. On iPad it opens the
 * share sheet, where "Save to Files" puts it in the Files app (On My iPad, iCloud Drive
 * or OneDrive). If the share sheet isn't available, the file is downloaded instead and
 * appears in Files › Downloads.
 *
 * Restore: the file is checked first. Nothing changes until the user has seen what the
 * file contains and confirmed. Restoring replaces everything (never merges) and keeps a
 * copy of the previous data so the restore can be undone.
 */
(function (root) {
  'use strict';

  var el = root.UI.el;
  var host = null;
  var pendingBackup = null;   // a checked backup waiting for the user to confirm
  var undoInfo = null;

  function $(id) { return document.getElementById(id); }

  // ---------- wording helpers ----------

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function dayAndTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return 'an unknown date';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function dayOnly(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return 'an unknown date';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function daysAgo(iso, now) {
    var a = new Date(iso); a.setHours(0, 0, 0, 0);
    var b = new Date(now); b.setHours(0, 0, 0, 0);
    var n = Math.round((b - a) / 86400000);
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    return n + ' days ago';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function countLessons(timetable) {
    var n = 0;
    for (var d = 1; d <= 5; d++) (timetable[d] || []).forEach(function (s) { if (s) n++; });
    return n;
  }

  function fileName(now) {
    return 'teaching-dashboard-backup-' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
      '-' + pad(now.getHours()) + pad(now.getMinutes()) + '.json';
  }

  // ---------- the screen ----------

  function renderLastBackup() {
    var data = host.data();
    var now = host.now();
    var title = $('last-backup-when');
    var note = $('last-backup-note');
    var box = $('last-backup');
    if (!data.lastBackupAt) {
      title.textContent = 'No backup yet';
      note.textContent = 'Export a backup and keep it somewhere off this iPad.';
      box.className = 'last-backup is-due';
      return;
    }
    title.textContent = dayAndTime(data.lastBackupAt) + ' · ' + daysAgo(data.lastBackupAt, now);
    var changedSince = data.lastChangedAt && data.lastChangedAt > data.lastBackupAt;
    note.textContent = changedSince ? 'You have made changes since then.' : 'No changes since then.';
    box.className = 'last-backup' + (changedSince ? ' is-due' : ' is-current');
  }

  function renderContents() {
    var data = host.data();
    var linked = Object.keys(data.progress || {}).length;
    $('backup-contents').textContent = 'Includes ' + plural(data.classes.length, 'class', 'classes') +
      ', ' + plural(countLessons(data.timetable), 'timetabled lesson', 'timetabled lessons') +
      ', ' + plural((data.lessons || []).length, 'imported lesson', 'imported lessons') +
      ' and the progress of ' + plural(linked, 'class', 'classes') + '.';
  }

  function renderUndo() {
    var box = $('undo-restore');
    if (!undoInfo) { box.hidden = true; return; }
    box.hidden = false;
    $('undo-restore-text').textContent = 'You restored a backup on ' + dayAndTime(undoInfo.savedAt) +
      '. Undo puts back the ' + plural(undoInfo.classCount, 'class', 'classes') + ', ' +
      plural(undoInfo.lessonCount, 'timetabled lesson', 'timetabled lessons') + ' and ' +
      plural(undoInfo.importedLessonCount || 0, 'imported lesson', 'imported lessons') + ' you had before it, with class progress.';
  }

  function render() {
    renderLastBackup();
    renderContents();
    renderUndo();
  }

  function refreshUndo() {
    return host.store().getUndoInfo().then(function (info) { undoInfo = info; renderUndo(); });
  }

  function showMessage(kind, title, lines) {
    var box = $('backup-message');
    box.className = 'backup-message is-' + kind;
    box.textContent = '';
    box.appendChild(el('strong', '', title));
    if (lines && lines.length) {
      var list = el('ul');
      lines.slice(0, 6).forEach(function (l) { list.appendChild(el('li', '', l)); });
      if (lines.length > 6) list.appendChild(el('li', '', 'and ' + (lines.length - 6) + ' more problems.'));
      box.appendChild(list);
    }
    box.hidden = false;
  }

  function hideMessage() { $('backup-message').hidden = true; }

  // ---------- export ----------

  function recordBackup(now, how) {
    return host.store().markBackedUp(now).then(function () { return host.reload(); }).then(function () {
      render();
      showMessage('ok', how);
    });
  }

  // Must be called directly from the tap: iPadOS only opens the share sheet straight after a tap.
  function exportBackup(forceDownload) {
    hideMessage();
    var now = host.now();
    var backup = root.TDStorage.buildBackup(host.data(), now);
    var json = JSON.stringify(backup, null, 2);
    var name = fileName(now);
    var file = null;
    try { file = new File([json], name, { type: 'application/json' }); } catch (e) { file = null; }

    var canShare = !forceDownload && file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] });
    if (canShare) {
      navigator.share({ files: [file], title: 'Teaching Dashboard backup' }).then(function () {
        return recordBackup(now, 'Backup saved. Choose "Save to Files" in the share sheet to keep it in the Files app.');
      }, function (err) {
        if (err && err.name === 'AbortError') {
          showMessage('info', 'Backup not saved — the share sheet was closed.');
        } else {
          // Sharing failed for another reason: fall back to a download.
          downloadFile(json, name, now);
        }
      });
      return;
    }
    downloadFile(json, name, now);
  }

  function downloadFile(json, name, now) {
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    recordBackup(now, 'Backup downloaded as ' + name + '. On iPad it is in the Files app, in Downloads.');
  }

  // ---------- restore ----------

  function chooseFile() {
    hideMessage();
    var input = $('restore-file');
    input.value = '';
    input.click();
  }

  function readFile(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  function fileChosen() {
    var input = $('restore-file');
    var file = input.files[0];
    if (!file) return;
    hideMessage();
    readFile(file).then(function (text) {
      input.value = ''; // so the same file can be chosen again later
      var parsed;
      try { parsed = JSON.parse(text); }
      catch (e) {
        showMessage('error', 'This file can\'t be restored.', ['It is not a readable backup file. Nothing has been changed.']);
        return;
      }
      var check = root.TDStorage.validateBackup(parsed);
      if (!check.ok) {
        showMessage('error', 'This file can\'t be restored. Nothing has been changed.', check.errors);
        return;
      }
      pendingBackup = parsed;
      openConfirm(check.summary, file.name);
    }, function () {
      showMessage('error', 'The file could not be opened. Nothing has been changed.');
    });
  }

  function openConfirm(summary, name) {
    var data = host.data();
    $('rc-now-classes').textContent = plural(data.classes.length, 'class', 'classes');
    $('rc-now-lessons').textContent = plural(countLessons(data.timetable), 'timetabled lesson', 'timetabled lessons');
    var nowImported = (data.lessons || []).length;
    var nowProgress = Object.keys(data.progress || {}).length;
    $('rc-now-imported').textContent = plural(nowImported, 'imported lesson', 'imported lessons');
    $('rc-now-when').textContent = data.lastChangedAt ? 'Last changed ' + dayAndTime(data.lastChangedAt) : 'Nothing changed yet';
    $('rc-file-classes').textContent = plural(summary.classCount, 'class', 'classes');
    $('rc-file-lessons').textContent = plural(summary.lessonCount, 'timetabled lesson', 'timetabled lessons');
    $('rc-file-imported').textContent = plural(summary.importedLessonCount || 0, 'imported lesson', 'imported lessons');
    var warning = $('rc-warning');
    var lose = [];
    if (!summary.importedLessonCount && nowImported) lose.push('the ' + plural(nowImported, 'lesson', 'lessons') + ' on this iPad');
    if (!summary.progressCount && nowProgress) lose.push('every class\'s progress');
    warning.hidden = lose.length === 0;
    warning.textContent = lose.length
      ? 'This backup has no imported lessons or class progress' + (summary.formatVersion === 1 ? ' (it was made before lessons were added to the dashboard)' : '') +
        '. ' + lose.join(' and ').replace(/^t/, 'T') + ' will be removed. You can undo this afterwards.'
      : '';
    $('rc-file-when').textContent = summary.exportedAt ? 'Exported ' + dayOnly(summary.exportedAt) : 'Export date unknown';
    $('rc-file-name').textContent = name;
    $('restore-confirm').hidden = false;
    $('rc-cancel').focus();
  }

  function closeConfirm() {
    $('restore-confirm').hidden = true;
    pendingBackup = null;
  }

  function doRestore() {
    var backup = pendingBackup;
    if (!backup) return;
    $('rc-replace').disabled = true;
    host.store().restoreFromBackup(backup).then(function (summary) {
      return host.reload().then(function () { return summary; });
    }).then(function (summary) {
      closeConfirm();
      $('rc-replace').disabled = false;
      render();
      refreshUndo();
      showMessage('ok', 'Backup restored: ' + plural(summary.classCount, 'class', 'classes') + ', ' +
        plural(summary.lessonCount, 'timetabled lesson', 'timetabled lessons') + ' and ' +
        plural(summary.importedLessonCount || 0, 'imported lesson', 'imported lessons') + '. Your previous data is kept, so you can undo this.');
    }, function (err) {
      closeConfirm();
      $('rc-replace').disabled = false;
      showMessage('error', 'The backup was not restored. Nothing has been changed.', err && err.problems ? err.problems : [err && err.message ? err.message : '']);
    });
  }

  function undoRestore() {
    if (!undoInfo) return;
    root.UI.confirm({
      title: 'Undo the restore?',
      message: 'This puts back the ' + plural(undoInfo.classCount, 'class', 'classes') + ', ' + plural(undoInfo.lessonCount, 'timetabled lesson', 'timetabled lessons') +
        ' and ' + plural(undoInfo.importedLessonCount || 0, 'imported lesson', 'imported lessons') +
        ' you had before ' + dayAndTime(undoInfo.savedAt) + '. Any changes made since the restore will be lost.',
      confirmLabel: 'Undo restore'
    }).then(function (yes) {
      if (!yes) return;
      host.store().undoRestore().then(function () { return host.reload(); }).then(function () {
        undoInfo = null;
        render();
        showMessage('ok', 'Restore undone. Your previous classes, timetable, lessons and class progress are back.');
      }, function (err) {
        showMessage('error', 'The restore could not be undone. Nothing has been changed.', [err && err.message ? err.message : '']);
      });
    });
  }

  // ---------- wiring ----------

  function wire() {
    $('btn-export').addEventListener('click', function () { exportBackup(false); });
    $('btn-download').addEventListener('click', function () { exportBackup(true); });
    $('btn-choose-file').addEventListener('click', chooseFile);
    $('restore-file').addEventListener('change', fileChosen);
    $('rc-cancel').addEventListener('click', closeConfirm);
    $('rc-replace').addEventListener('click', doRestore);
    $('restore-confirm').addEventListener('click', function (e) { if (e.target === $('restore-confirm')) closeConfirm(); });
    $('btn-undo-restore').addEventListener('click', undoRestore);
  }

  root.Backup = {
    init: function (h) { host = h; wire(); },
    show: function () { hideMessage(); render(); return refreshUndo(); },
    leave: function () { closeConfirm(); return Promise.resolve(); }
  };
})(this);
