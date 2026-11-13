/*
 * storage.js — saves and loads all dashboard data on the device, using IndexedDB.
 *
 * Every change is written in a single transaction and the returned promise only
 * resolves once the device confirms the write is complete. That is what lets the
 * screens show "Saved" honestly.
 *
 * What is stored (object stores in the database):
 *   classes   : { id, name, subject }
 *   slots     : { key: "3-1", weekday: 3, periodIndex: 1, classId, subjectOverride? }
 *               (only lessons are stored; a missing slot is a free period)
 *   meta      : { key, value }  — lastChangedAt, lastBackupAt
 *   snapshots : { key: "pre-restore", savedAt, data }  — safety copy for undoing a restore
 *   -- added in database version 2 --
 *   schemes   : { id, title, yearGroup, subject }  — one scheme of work per year group,
 *               fixed ids y7 ... y12 (see SCHEMES below). Theory and programming lessons
 *               are lesson types inside a scheme, never separate schemes.
 *   lessons   : { id, schemeId, position, version, title, topic, type, importedAt, lesson }
 *               one record per imported lesson file; `lesson` is the file's lesson object.
 *               Shared by every class that follows the scheme.
 *   progress  : { classId, schemeId, position, log: [{ position, lessonId, title, version, taughtOn }] }
 *               one record per class. `position` is the NEXT lesson to teach.
 *
 * Lesson file format (one lesson per file):
 *   { app: "teaching-dashboard", kind: "lesson", formatVersion: 1,
 *     scheme: { id, title, yearGroup, subject },
 *     lesson: { id: "<schemeId>/<slug>", version, position, topic, title, objective, ... } }
 *
 * Backup file format (also what exportData() returns):
 *   { app: "teaching-dashboard", formatVersion: 2, exportedAt: ISO string,
 *     classes: [{ id, name, subject }],
 *     timetable: { "1": [slot|null x5], ..., "5": [...] },
 *     schemes: [{ id, title, yearGroup, subject }],
 *     lessons: [{ schemeId, importedAt, lesson }],
 *     progress: [{ classId, schemeId, position, log }] }
 *   where a slot is { classId } or { classId, subjectOverride }.
 *   Format 1 backups (classes and timetable only) still validate and restore.
 */
(function (root) {
  'use strict';

  var DEFAULT_DB_NAME = 'teaching-dashboard';
  var DB_VERSION = 2;
  var APP_ID = 'teaching-dashboard';
  var FORMAT_VERSION = 2;          // backup files
  var LESSON_FORMAT_VERSION = 1;   // lesson files
  var DAYS = [1, 2, 3, 4, 5];
  var PERIOD_COUNT = 5;
  var DATA_STORES = ['classes', 'slots', 'meta', 'schemes', 'lessons', 'progress'];
  var STORES = DATA_STORES.concat(['snapshots']);
  var LOG_LIMIT = 300;

  // The schemes of work: one per year group. The ids are permanent and are what every
  // lesson file uses in scheme.id and as the start of lesson.id ("y9/...").
  var SCHEMES = [
    { id: 'y7', title: 'Year 7 Computing', yearGroup: 7, subject: 'Computing' },
    { id: 'y8', title: 'Year 8 Computing', yearGroup: 8, subject: 'Computing' },
    { id: 'y9', title: 'Year 9 Computing', yearGroup: 9, subject: 'Computing' },
    { id: 'y10', title: 'Year 10 GCSE Computer Science', yearGroup: 10, subject: 'Computer Science' },
    { id: 'y11', title: 'Year 11 GCSE Computer Science', yearGroup: 11, subject: 'Computer Science' },
    { id: 'y12', title: 'Year 12 A Level Computer Science', yearGroup: 12, subject: 'Computer Science' }
  ];
  var SCHEME_BY_ID = {};
  SCHEMES.forEach(function (s) { SCHEME_BY_ID[s.id] = s; });

  function copyScheme(s) { return { id: s.id, title: s.title, yearGroup: s.yearGroup, subject: s.subject }; }

  // ---------- small IndexedDB helpers ----------

  function promisifyRequest(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // Runs `work(stores)` inside one transaction. Resolves with work's result only
  // after the transaction has fully completed (data is on disk), rejects if anything fails.
  function transact(db, storeNames, mode, work) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeNames, mode);
      var stores = {};
      storeNames.forEach(function (n) { stores[n] = tx.objectStore(n); });
      var result;
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Save was cancelled')); };
      try {
        Promise.resolve(work(stores, tx)).then(function (r) { result = r; }, function (e) {
          try { tx.abort(); } catch (ignore) {}
          reject(e);
        });
      } catch (e) {
        try { tx.abort(); } catch (ignore) {}
        reject(e);
      }
    });
  }

  function openDatabase(name) {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('This browser has no IndexedDB storage.')); return; }
      var req = root.indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        // Version 1 stores (created only if missing, so existing data is never touched).
        if (!db.objectStoreNames.contains('classes')) db.createObjectStore('classes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('slots')) {
          var slots = db.createObjectStore('slots', { keyPath: 'key' });
          slots.createIndex('byClass', 'classId', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'key' });
        // Version 2 stores.
        if (!db.objectStoreNames.contains('schemes')) {
          var schemes = db.createObjectStore('schemes', { keyPath: 'id' });
          SCHEMES.forEach(function (s) { schemes.put(copyScheme(s)); });
        }
        if (!db.objectStoreNames.contains('lessons')) {
          var lessons = db.createObjectStore('lessons', { keyPath: 'id' });
          lessons.createIndex('byPosition', ['schemeId', 'position'], { unique: true });
          lessons.createIndex('byScheme', 'schemeId', { unique: false });
        }
        if (!db.objectStoreNames.contains('progress')) {
          var progress = db.createObjectStore('progress', { keyPath: 'classId' });
          progress.createIndex('byScheme', 'schemeId', { unique: false });
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        // If a newer copy of the app needs to upgrade the database, step aside for it.
        db.onversionchange = function () { db.close(); };
        resolve(db);
      };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('Storage is in use by another copy of the app. Close other tabs and try again.')); };
    });
  }

  // ---------- general checks ----------

  function cleanText(value) { return typeof value === 'string' ? value.trim() : ''; }
  function isText(value) { return cleanText(value) !== ''; }
  function isWhole(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value; }
  function isPositiveWhole(value) { return isWhole(value) && value >= 1; }
  function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

  function slotKey(weekday, periodIndex) { return weekday + '-' + periodIndex; }

  function checkWeekdayPeriod(weekday, periodIndex) {
    if (DAYS.indexOf(weekday) === -1) throw new Error('Weekday must be 1 (Monday) to 5 (Friday).');
    if (!(periodIndex >= 0 && periodIndex < PERIOD_COUNT) || Math.floor(periodIndex) !== periodIndex) {
      throw new Error('Period must be 0 to 4.');
    }
  }

  function newId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function emptyTimetable() {
    var t = {};
    DAYS.forEach(function (d) { t[d] = [null, null, null, null, null]; });
    return t;
  }

  // JSON with object keys in a fixed order, so two lessons with the same content
  // compare equal however their files were laid out.
  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (isPlainObject(value)) {
      return '{' + Object.keys(value).sort().map(function (k) {
        return JSON.stringify(k) + ':' + stableStringify(value[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  function schemeName(schemeId) {
    var s = SCHEME_BY_ID[schemeId];
    return s ? 'Year ' + s.yearGroup : schemeId;
  }

  // ---------- lesson checks ----------

  var CHECK_AFTER = ['doNow', 'iDo', 'weDo', 'youDo'];

  // Checks a lesson object (the "lesson" part of a file) against its scheme.
  // Pushes plain-English problems onto `errors`. Never changes anything.
  function checkLessonBody(l, schemeId, errors) {
    if (!isPlainObject(l)) { errors.push('The file has no lesson in it.'); return; }

    // Identity and order
    if (!isText(l.id)) {
      errors.push('The lesson has no id.');
    } else if (schemeId && l.id.trim().indexOf(schemeId + '/') !== 0) {
      errors.push('The lesson id "' + l.id + '" must start with "' + schemeId + '/".');
    } else if (schemeId && l.id.trim().length <= schemeId.length + 1) {
      errors.push('The lesson id "' + l.id + '" has nothing after "' + schemeId + '/".');
    }
    if (!isPositiveWhole(l.version)) errors.push('The lesson version must be a whole number, 1 or more.');
    if (!isPositiveWhole(l.position)) errors.push('The lesson position must be a whole number, 1 or more.');

    // Required text
    if (!isText(l.title)) errors.push('The lesson has no title.');
    if (!isText(l.topic)) errors.push('The lesson has no topic.');
    if (!isText(l.objective)) errors.push('The lesson has no learning objective.');

    // Optional fields
    if (l.type !== undefined && !isText(l.type)) errors.push('The lesson type must be a short piece of text.');
    if (l.specRefs !== undefined && (!Array.isArray(l.specRefs) || !l.specRefs.every(isText))) {
      errors.push('Spec references must be a list of text.');
    }

    function board(obj, where) {
      if (obj.board !== undefined && !isPositiveWhole(obj.board)) errors.push(where + ': the board number must be a whole number, 1 or more.');
    }
    function minutes(obj, where) {
      if (obj.minutes !== undefined && !(typeof obj.minutes === 'number' && obj.minutes > 0)) errors.push(where + ': minutes must be a number above 0.');
    }
    // Checks an optional list; `each(item, label)` checks one item.
    function list(value, label, each, mustHaveItems) {
      if (value === undefined) return;
      if (!Array.isArray(value)) { errors.push(label + ' must be a list.'); return; }
      if (mustHaveItems && value.length === 0) errors.push(label + ' has no items.');
      value.forEach(function (item, i) {
        var where = label + ' item ' + (i + 1);
        if (!isPlainObject(item)) { errors.push(where + ' is not readable.'); return; }
        each(item, where);
      });
    }
    function section(value, label, each) {
      if (value === undefined) return;
      if (!isPlainObject(value)) { errors.push(label + ' is not readable.'); return; }
      each(value, label);
    }

    list(l.vocabulary, 'Vocabulary', function (v, where) {
      if (!isText(v.term)) errors.push(where + ' has no term.');
      if (!isText(v.meaning)) errors.push(where + ' has no meaning.');
    });

    section(l.doNow, 'Do Now', function (s, where) {
      board(s, where); minutes(s, where);
      if (!Array.isArray(s.questions)) { errors.push(where + ' has no list of questions.'); return; }
      list(s.questions, where + ' question', function (q, w) {
        if (!isText(q.q)) errors.push(w + ' has no question.');
        if (!isText(q.a)) errors.push(w + ' has no answer.');
      }, true);
    });

    section(l.iDo, 'I Do', function (s, where) {
      minutes(s, where);
      if (!Array.isArray(s.steps)) { errors.push(where + ' has no list of steps.'); return; }
      list(s.steps, where + ' step', function (st, w) {
        board(st, w);
        if (!isText(st.heading) && !isText(st.say)) errors.push(w + ' needs a heading or something to say.');
        if (st.heading !== undefined && typeof st.heading !== 'string') errors.push(w + ': the heading must be text.');
        if (st.say !== undefined && typeof st.say !== 'string') errors.push(w + ': "say" must be text.');
        if (st.code !== undefined && typeof st.code !== 'string') errors.push(w + ': the code must be text.');
        if (st.example !== undefined) {
          if (!isPlainObject(st.example)) { errors.push(w + ': the example is not readable.'); return; }
          if (st.example.working !== undefined && (!Array.isArray(st.example.working) || !st.example.working.every(function (x) { return typeof x === 'string'; }))) {
            errors.push(w + ': the example working must be a list of text.');
          }
          if (!isText(st.example.question) && !isText(st.example.answer)) errors.push(w + ': the example needs a question or an answer.');
        }
      }, true);
    });

    section(l.weDo, 'We Do', function (s, where) {
      minutes(s, where);
      if (!Array.isArray(s.items)) { errors.push(where + ' has no list of items.'); return; }
      list(s.items, where + ' item', function (it, w) {
        board(it, w);
        if (!isText(it.prompt)) errors.push(w + ' has no prompt.');
        if (it.expected !== undefined && typeof it.expected !== 'string') errors.push(w + ': the expected response must be text.');
      }, true);
    });

    list(l.checks, 'Check for understanding', function (c, where) {
      board(c, where);
      if (CHECK_AFTER.indexOf(c.after) === -1) errors.push(where + ' must say when to ask it: doNow, iDo, weDo or youDo.');
      if (!isText(c.question)) errors.push(where + ' has no question.');
      if (!isText(c.answer)) errors.push(where + ' has no answer.');
    });

    section(l.youDo, 'You Do', function (s, where) {
      board(s, where); minutes(s, where);
      if (s.instructions !== undefined && typeof s.instructions !== 'string') errors.push(where + ': the instructions must be text.');
      if (!isText(s.instructions) && !(Array.isArray(s.tasks) && s.tasks.length)) errors.push(where + ' needs instructions or tasks.');
      list(s.tasks, where + ' task', function (t, w) {
        if (!isText(t.task)) errors.push(w + ' has no task.');
        if (t.answer !== undefined && typeof t.answer !== 'string') errors.push(w + ': the answer must be text.');
      });
      if (s.extension !== undefined) {
        if (!isPlainObject(s.extension) || !isText(s.extension.task)) errors.push(where + ': the extension has no task.');
      }
    });

    list(l.misconceptions, 'Misconception', function (m, where) {
      if (!isText(m.wrong)) errors.push(where + ' does not say what the misconception is.');
      if (!isText(m.correction)) errors.push(where + ' has no correction.');
    });

    list(l.resources, 'Resource', function (r, where) {
      if (!isText(r.name)) errors.push(where + ' has no name.');
      if (r.note !== undefined && typeof r.note !== 'string') errors.push(where + ': the note must be text.');
    });
  }

  // Checks the scheme named in a lesson file against the fixed schemes.
  function checkSchemeRef(s, errors) {
    if (!isPlainObject(s) || !isText(s.id)) { errors.push('The file does not say which scheme of work it belongs to.'); return null; }
    var known = SCHEME_BY_ID[s.id.trim()];
    if (!known) {
      errors.push('"' + s.id + '" is not one of your schemes of work (' + SCHEMES.map(function (x) { return x.id; }).join(', ') + ').');
      return null;
    }
    if (s.yearGroup !== undefined && s.yearGroup !== known.yearGroup) {
      errors.push('The file says scheme "' + known.id + '" is Year ' + s.yearGroup + ', but it is Year ' + known.yearGroup + '.');
    }
    return known.id;
  }

  // Builds the stored record for a checked lesson.
  function makeLessonRecord(schemeId, lesson, importedAt) {
    return {
      id: lesson.id.trim(),
      schemeId: schemeId,
      position: lesson.position,
      version: lesson.version,
      title: lesson.title.trim(),
      topic: lesson.topic.trim(),
      type: isText(lesson.type) ? lesson.type.trim() : '',
      importedAt: importedAt,
      lesson: lesson
    };
  }

  // Checks one parsed lesson file. Never changes anything.
  // Returns { ok: true, record } or { ok: false, errors: [...] }.
  function validateLessonFile(data) {
    if (!isPlainObject(data) || data.app !== APP_ID || data.kind !== 'lesson') {
      return { ok: false, errors: ['This is not a Teaching Dashboard lesson file.'] };
    }
    var errors = [];
    if (!isPositiveWhole(data.formatVersion)) errors.push('The file has no format version.');
    else if (data.formatVersion > LESSON_FORMAT_VERSION) errors.push('This lesson file was made for a newer version of the dashboard.');
    var schemeId = checkSchemeRef(data.scheme, errors);
    checkLessonBody(data.lesson, schemeId, errors);
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, record: makeLessonRecord(schemeId, data.lesson, null) };
  }

  function lessonLabel(record) {
    return schemeName(record.schemeId) + ', Lesson ' + record.position + ': ' + record.title;
  }

  function sameContent(a, b) { return stableStringify(a.lesson) === stableStringify(b.lesson); }

  /*
   * Decides what importing each file would do, against what is already saved.
   * Pure: changes nothing. `files` is [{ name, data }] with data already parsed
   * (or data: undefined if the file could not be read as JSON).
   * Returns one item per file:
   *   { fileName, status, message, record?, existing?, clashWith?, moveFrom? }
   * status is one of:
   *   'new'       — will be added
   *   'update'    — same id, higher version: will replace the saved version
   *   'same'      — same id and version, same content: already imported, skipped
   *   'conflict'  — same id and version but different content: not imported
   *   'older'     — lower version than the saved one: not imported
   *   'repeat'    — the same lesson was chosen more than once: this copy is not used
   *   'clash'     — would be new/update, but a DIFFERENT lesson is saved at that position:
   *                 imported only if the user explicitly chooses to replace it
   *   'invalid'   — the file has problems: not imported
   */
  function planImport(files, savedLessons) {
    var byId = {}, byPos = {};
    savedLessons.forEach(function (r) { byId[r.id] = r; byPos[r.schemeId + '|' + r.position] = r; });

    var items = files.map(function (f) {
      var item = { fileName: f.name || 'file' };
      if (f.data === undefined) {
        item.status = 'invalid';
        item.message = 'This file could not be read. It is not a lesson file.';
        return item;
      }
      var check = validateLessonFile(f.data);
      if (!check.ok) {
        item.status = 'invalid';
        item.message = check.errors[0];
        item.errors = check.errors;
        return item;
      }
      item.record = check.record;
      return item;
    });

    // The same lesson id chosen more than once: use only the highest version.
    var bestForId = {};
    items.forEach(function (item, i) {
      if (!item.record) return;
      var b = bestForId[item.record.id];
      if (b === undefined || item.record.version > items[b].record.version) bestForId[item.record.id] = i;
    });
    // Same id and same top version but different content: there is no safe way to choose, so use neither.
    var contentClash = {};
    items.forEach(function (item, i) {
      if (!item.record) return;
      var best = items[bestForId[item.record.id]];
      if (bestForId[item.record.id] !== i && item.record.version === best.record.version && !sameContent(item.record, best.record)) {
        contentClash[item.record.id] = best.record.version;
      }
    });
    items.forEach(function (item, i) {
      if (!item.record) return;
      if (contentClash[item.record.id] !== undefined && item.record.version === contentClash[item.record.id]) {
        item.status = 'invalid';
        item.message = 'More than one chosen file is version ' + item.record.version + ' of this lesson, with different content. Choose only one of them.';
      } else if (bestForId[item.record.id] !== i) {
        item.status = 'repeat';
        item.message = 'This lesson was chosen more than once. Only version ' + items[bestForId[item.record.id]].record.version + ' will be used.';
      }
    });

    // Two different chosen lessons at the same position: neither is imported.
    var chosenAt = {};
    items.forEach(function (item) {
      if (!item.record || item.status) return;
      var k = item.record.schemeId + '|' + item.record.position;
      (chosenAt[k] = chosenAt[k] || []).push(item);
    });
    Object.keys(chosenAt).forEach(function (k) {
      if (chosenAt[k].length < 2) return;
      chosenAt[k].forEach(function (item) {
        item.status = 'invalid';
        item.message = 'More than one of the chosen files is ' + schemeName(item.record.schemeId) + ', Lesson ' +
          item.record.position + '. Choose only one of them.';
      });
    });

    // Compare with what is saved.
    items.forEach(function (item) {
      if (!item.record || item.status) return;
      var r = item.record;
      var saved = byId[r.id];
      if (saved) {
        if (r.version < saved.version) {
          item.status = 'older';
          item.message = 'Not imported: version ' + r.version + ' is older than the saved version ' + saved.version + '.';
          return;
        }
        if (r.version === saved.version) {
          if (sameContent(r, saved)) {
            item.status = 'same';
            item.message = 'Already imported (version ' + r.version + ').';
          } else {
            item.status = 'conflict';
            item.message = 'Not imported: this is also version ' + r.version + ', but its content is different from the saved lesson. A changed lesson needs a higher version number.';
          }
          return;
        }
        item.status = 'update';
        item.existing = { id: saved.id, version: saved.version, position: saved.position, title: saved.title };
        item.message = 'Updates version ' + saved.version + ' to version ' + r.version + '.';
        if (saved.position !== r.position) {
          item.moveFrom = saved.position;
          item.message += ' Moves from Lesson ' + saved.position + ' to Lesson ' + r.position + '.';
        }
      } else {
        item.status = 'new';
        item.message = 'New lesson.';
      }
      var occupant = byPos[r.schemeId + '|' + r.position];
      if (occupant && occupant.id !== r.id) {
        item.clashOf = item.status;          // what it would be once the clash is resolved
        item.status = 'clash';
        item.clashWith = { id: occupant.id, version: occupant.version, title: occupant.title, position: occupant.position };
        item.message = schemeName(r.schemeId) + ', Lesson ' + r.position + ' is already "' + occupant.title +
          '". Choose whether to replace it.';
      }
    });
    return items;
  }

  // ---------- backup checks ----------

  // Checks a parsed backup file. Never changes anything.
  // Returns { ok: true, summary } or { ok: false, errors: [...] }.
  function validateBackup(data) {
    var errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, errors: ['This file is not a Teaching Dashboard backup.'] };
    }
    if (data.app !== APP_ID || data.kind === 'lesson') {
      return { ok: false, errors: ['This file is not a Teaching Dashboard backup.'] };
    }
    if (typeof data.formatVersion !== 'number' || data.formatVersion > FORMAT_VERSION) {
      errors.push('This backup was made by a newer version of the dashboard.');
    }
    if (!Array.isArray(data.classes)) {
      errors.push('The backup has no list of classes.');
    }
    var ids = {};
    var names = {};
    (Array.isArray(data.classes) ? data.classes : []).forEach(function (c, i) {
      var label = 'Class ' + (i + 1);
      if (!c || typeof c !== 'object') { errors.push(label + ' is not readable.'); return; }
      if (!cleanText(c.id)) errors.push(label + ' has no id.');
      if (!cleanText(c.name)) errors.push(label + ' has no name.');
      if (typeof c.subject !== 'string') errors.push(label + ' has no subject.');
      if (ids[c.id]) errors.push('Two classes share the id "' + c.id + '".');
      var lower = cleanText(c.name).toLowerCase();
      if (lower && names[lower]) errors.push('Two classes are both called "' + c.name + '".');
      ids[c.id] = true;
      names[lower] = true;
    });
    var lessons = 0;
    if (!data.timetable || typeof data.timetable !== 'object') {
      errors.push('The backup has no timetable.');
    } else {
      DAYS.forEach(function (d) {
        var day = data.timetable[d];
        if (day === undefined) return; // a missing day is treated as all free
        if (!Array.isArray(day) || day.length !== PERIOD_COUNT) {
          errors.push('The timetable for day ' + d + ' does not have 5 periods.');
          return;
        }
        day.forEach(function (slot, p) {
          if (slot === null) return;
          if (!slot || typeof slot !== 'object' || !cleanText(slot.classId)) {
            errors.push('Day ' + d + ', period ' + (p + 1) + ' is not readable.');
          } else if (!ids[slot.classId]) {
            errors.push('Day ' + d + ', period ' + (p + 1) + ' refers to a class that is not in the backup.');
          } else {
            lessons++;
          }
        });
      });
    }

    // Format 2 additions: schemes, imported lessons and class progress.
    var importedLessons = 0;
    var progressCount = 0;
    if (typeof data.formatVersion === 'number' && data.formatVersion >= 2) {
      var schemeIds = {};
      if (!Array.isArray(data.schemes)) {
        errors.push('The backup has no list of schemes.');
      } else {
        data.schemes.forEach(function (s, i) {
          if (!isPlainObject(s) || !isText(s.id)) { errors.push('Scheme ' + (i + 1) + ' is not readable.'); return; }
          if (!SCHEME_BY_ID[s.id]) errors.push('Scheme "' + s.id + '" is not one of your schemes of work.');
          if (schemeIds[s.id]) errors.push('Scheme "' + s.id + '" appears twice.');
          schemeIds[s.id] = true;
        });
      }
      var lessonIds = {}, lessonPos = {};
      if (!Array.isArray(data.lessons)) {
        errors.push('The backup has no list of lessons.');
      } else {
        data.lessons.forEach(function (entry, i) {
          var label = 'Saved lesson ' + (i + 1);
          if (!isPlainObject(entry)) { errors.push(label + ' is not readable.'); return; }
          if (!schemeIds[entry.schemeId]) { errors.push(label + ' belongs to a scheme that is not in the backup.'); return; }
          var problems = [];
          checkLessonBody(entry.lesson, entry.schemeId, problems);
          if (problems.length) { errors.push(label + ': ' + problems[0]); return; }
          var id = entry.lesson.id.trim();
          var pos = entry.schemeId + '|' + entry.lesson.position;
          if (lessonIds[id]) errors.push('Two saved lessons share the id "' + id + '".');
          if (lessonPos[pos]) errors.push('Two saved lessons are both ' + schemeName(entry.schemeId) + ', Lesson ' + entry.lesson.position + '.');
          lessonIds[id] = true;
          lessonPos[pos] = true;
          importedLessons++;
        });
      }
      var progressFor = {};
      if (!Array.isArray(data.progress)) {
        errors.push('The backup has no list of class progress.');
      } else {
        data.progress.forEach(function (p, i) {
          var label = 'Class progress ' + (i + 1);
          if (!isPlainObject(p)) { errors.push(label + ' is not readable.'); return; }
          if (!ids[p.classId]) errors.push(label + ' refers to a class that is not in the backup.');
          if (!schemeIds[p.schemeId]) errors.push(label + ' refers to a scheme that is not in the backup.');
          if (!isPositiveWhole(p.position)) errors.push(label + ' has no valid lesson number.');
          if (p.log !== undefined && !Array.isArray(p.log)) errors.push(label + ' has an unreadable record of taught lessons.');
          if (progressFor[p.classId]) errors.push('A class has two progress records.');
          progressFor[p.classId] = true;
          progressCount++;
        });
      }
    }

    if (errors.length) return { ok: false, errors: errors };
    return {
      ok: true,
      summary: {
        formatVersion: data.formatVersion,
        classCount: data.classes.length,
        lessonCount: lessons,
        importedLessonCount: importedLessons,
        progressCount: progressCount,
        exportedAt: data.exportedAt || null
      }
    };
  }

  // ---------- the storage object ----------

  function Storage(db) { this.db = db; }

  // Opens (or creates) the database. Pass a different name in tests.
  Storage.open = function (name) {
    return openDatabase(name || DEFAULT_DB_NAME).then(function (db) { return new Storage(db); });
  };

  // Removes a whole database. Used by tests only.
  Storage.deleteDatabase = function (name) {
    return promisifyRequest(root.indexedDB.deleteDatabase(name));
  };

  Storage.validateBackup = validateBackup;
  Storage.validateLessonFile = validateLessonFile;
  Storage.planImport = planImport;
  Storage.lessonLabel = lessonLabel;
  Storage.APP_ID = APP_ID;
  Storage.FORMAT_VERSION = FORMAT_VERSION;
  Storage.LESSON_FORMAT_VERSION = LESSON_FORMAT_VERSION;
  Storage.DB_VERSION = DB_VERSION;
  Storage.SCHEMES = SCHEMES.map(copyScheme);

  Storage.prototype.close = function () { this.db.close(); };

  // Asks the device not to clear this app's data when space runs low.
  // Resolves true if granted, false if refused or unsupported. Never throws.
  Storage.requestPersistence = function () {
    try {
      if (root.navigator && navigator.storage && navigator.storage.persist) {
        return navigator.storage.persist().catch(function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  };

  function bySchemeThenPosition(a, b) {
    var sa = SCHEME_BY_ID[a.schemeId], sb = SCHEME_BY_ID[b.schemeId];
    var ya = sa ? sa.yearGroup : 99, yb = sb ? sb.yearGroup : 99;
    return ya - yb || a.position - b.position;
  }

  // Everything, in the shapes the rest of the app uses:
  // { classes: [...sorted by name], timetable: {1:[...5],...}, lastChangedAt, lastBackupAt,
  //   schemes: [...by year group], lessons: [...full records, by scheme then position],
  //   progress: { classId: { classId, schemeId, position, log } } }
  Storage.prototype.loadAll = function () {
    return transact(this.db, DATA_STORES, 'readonly', function (s) {
      return Promise.all([
        promisifyRequest(s.classes.getAll()),
        promisifyRequest(s.slots.getAll()),
        promisifyRequest(s.meta.getAll()),
        promisifyRequest(s.schemes.getAll()),
        promisifyRequest(s.lessons.getAll()),
        promisifyRequest(s.progress.getAll())
      ]).then(function (r) {
        var classes = r[0].sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
        var timetable = emptyTimetable();
        r[1].forEach(function (slot) {
          var entry = { classId: slot.classId };
          if (slot.subjectOverride) entry.subjectOverride = slot.subjectOverride;
          timetable[slot.weekday][slot.periodIndex] = entry;
        });
        var meta = {};
        r[2].forEach(function (m) { meta[m.key] = m.value; });
        var progress = {};
        r[5].forEach(function (p) { progress[p.classId] = p; });
        return {
          classes: classes,
          timetable: timetable,
          lastChangedAt: meta.lastChangedAt || null,
          lastBackupAt: meta.lastBackupAt || null,
          schemes: r[3].sort(function (a, b) { return a.yearGroup - b.yearGroup; }),
          lessons: r[4].sort(bySchemeThenPosition),
          progress: progress
        };
      });
    });
  };

  function touch(metaStore) {
    metaStore.put({ key: 'lastChangedAt', value: new Date().toISOString() });
  }

  // Adds a class (no id) or updates one (with id). Resolves with the saved class.
  Storage.prototype.saveClass = function (cls) {
    var name = cleanText(cls && cls.name);
    var subject = cleanText(cls && cls.subject);
    if (!name) return Promise.reject(new Error('Please give the class a name.'));
    if (!subject) return Promise.reject(new Error('Please choose a subject for this class.'));
    var record = { id: (cls.id || newId()), name: name, subject: subject };
    return transact(this.db, ['classes', 'meta'], 'readwrite', function (s) {
      return promisifyRequest(s.classes.getAll()).then(function (all) {
        var clash = all.some(function (c) { return c.id !== record.id && c.name.toLowerCase() === name.toLowerCase(); });
        if (clash) throw new Error('You already have a class called "' + name + '".');
        s.classes.put(record);
        touch(s.meta);
        return record;
      });
    });
  };

  // How many timetabled lessons use this class. For the delete warning.
  Storage.prototype.countLessonsForClass = function (classId) {
    return transact(this.db, ['slots'], 'readonly', function (s) {
      return promisifyRequest(s.slots.index('byClass').count(classId));
    });
  };

  // Deletes a class and, in the same transaction, turns its lessons into free periods
  // and removes its progress. Resolves with the number of lessons that became free.
  Storage.prototype.deleteClass = function (classId) {
    return transact(this.db, ['classes', 'slots', 'progress', 'meta'], 'readwrite', function (s) {
      return promisifyRequest(s.slots.index('byClass').getAllKeys(classId)).then(function (keys) {
        keys.forEach(function (k) { s.slots.delete(k); });
        s.progress.delete(classId);
        s.classes.delete(classId);
        touch(s.meta);
        return keys.length;
      });
    });
  };

  // Sets one timetable slot. Pass null for a free period,
  // or { classId } / { classId, subjectOverride }.
  Storage.prototype.setSlot = function (weekday, periodIndex, slot) {
    try { checkWeekdayPeriod(weekday, periodIndex); } catch (e) { return Promise.reject(e); }
    var key = slotKey(weekday, periodIndex);
    return transact(this.db, ['classes', 'slots', 'meta'], 'readwrite', function (s) {
      if (slot === null) {
        s.slots.delete(key);
        touch(s.meta);
        return null;
      }
      var classId = cleanText(slot && slot.classId);
      if (!classId) throw new Error('Choose a class, or mark the period as free.');
      return promisifyRequest(s.classes.get(classId)).then(function (cls) {
        if (!cls) throw new Error('That class no longer exists.');
        var record = { key: key, weekday: weekday, periodIndex: periodIndex, classId: classId };
        var override = cleanText(slot.subjectOverride);
        // An "override" identical to the class default is not an override.
        if (override && override !== cls.subject) record.subjectOverride = override;
        s.slots.put(record);
        touch(s.meta);
        return record;
      });
    });
  };

  // ---------- lessons ----------

  // One saved lesson by id, or null.
  Storage.prototype.getLesson = function (id) {
    return transact(this.db, ['lessons'], 'readonly', function (s) {
      return promisifyRequest(s.lessons.get(id)).then(function (r) { return r || null; });
    });
  };

  // The saved lesson at a scheme position, or null if none has been imported.
  Storage.prototype.getLessonAt = function (schemeId, position) {
    return transact(this.db, ['lessons'], 'readonly', function (s) {
      return promisifyRequest(s.lessons.index('byPosition').get([schemeId, position])).then(function (r) { return r || null; });
    });
  };

  // Works out what importing these files would do. Changes nothing.
  // files: [{ name, data }] (data already parsed; undefined if unreadable). Resolves with planImport items.
  Storage.prototype.previewImport = function (files) {
    return transact(this.db, ['lessons'], 'readonly', function (s) {
      return promisifyRequest(s.lessons.getAll()).then(function (saved) { return planImport(files, saved); });
    });
  };

  /*
   * Saves an import, all in one transaction (everything is saved or nothing is).
   * `files` are the same files given to previewImport. `replaceIds` lists the lesson ids
   * whose position clash the user has explicitly agreed to resolve by replacing the
   * lesson already there. The plan is worked out again inside the transaction, so a
   * change since the preview can never cause a silent overwrite. Class progress is
   * never read or changed.
   * Resolves with { added, updated, replaced: [ids removed], skipped }.
   */
  Storage.prototype.commitImport = function (files, replaceIds, when) {
    var allowed = {};
    (replaceIds || []).forEach(function (id) { allowed[id] = true; });
    var importedAt = (when || new Date()).toISOString();
    return transact(this.db, ['lessons', 'meta'], 'readwrite', function (s) {
      return promisifyRequest(s.lessons.getAll()).then(function (saved) {
        var items = planImport(files, saved);
        var result = { added: 0, updated: 0, replaced: [], skipped: 0 };
        var toSave = [];
        var toRemove = {};
        items.forEach(function (item) {
          var go = item.status === 'new' || item.status === 'update' ||
            (item.status === 'clash' && allowed[item.record.id]);
          if (!go) { result.skipped++; return; }
          if (item.status === 'clash') toRemove[item.clashWith.id] = true;
          toSave.push(item);
        });
        // Removing a lesson that another chosen file updates would be contradictory: refuse.
        toSave.forEach(function (item) {
          if (toRemove[item.record.id]) throw new Error('These files replace each other. Import them one at a time.');
        });
        Object.keys(toRemove).forEach(function (id) { s.lessons.delete(id); result.replaced.push(id); });
        // Free the old positions of lessons that move before anything takes a new position.
        toSave.forEach(function (item) { if (item.status === 'update' || item.clashOf === 'update') s.lessons.delete(item.record.id); });
        toSave.forEach(function (item) {
          var record = makeLessonRecord(item.record.schemeId, item.record.lesson, importedAt);
          s.lessons.add(record);   // add (not put): refuses rather than overwrites anything unexpected
          if ((item.clashOf || item.status) === 'update') result.updated++; else result.added++;
        });
        if (toSave.length) touch(s.meta);
        return result;
      });
    });
  };

  // Deletes one saved lesson. Class progress is not changed.
  Storage.prototype.deleteLesson = function (id) {
    return transact(this.db, ['lessons', 'meta'], 'readwrite', function (s) {
      return promisifyRequest(s.lessons.get(id)).then(function (r) {
        if (!r) throw new Error('That lesson is no longer saved.');
        s.lessons.delete(id);
        touch(s.meta);
        return true;
      });
    });
  };

  // ---------- class progress ----------
  // A class's position is the NEXT lesson to teach in its scheme.

  // Links a class to a scheme (or unlinks it with schemeId null).
  // Linking to the scheme it already follows changes nothing; a different scheme starts at Lesson 1.
  Storage.prototype.setClassScheme = function (classId, schemeId) {
    return transact(this.db, ['classes', 'schemes', 'progress', 'meta'], 'readwrite', function (s) {
      return promisifyRequest(s.classes.get(classId)).then(function (cls) {
        if (!cls) throw new Error('That class no longer exists.');
        if (schemeId === null) {
          s.progress.delete(classId);
          touch(s.meta);
          return null;
        }
        return Promise.all([
          promisifyRequest(s.schemes.get(schemeId)),
          promisifyRequest(s.progress.get(classId))
        ]).then(function (r) {
          if (!r[0]) throw new Error('That scheme of work does not exist.');
          var current = r[1];
          if (current && current.schemeId === schemeId) return current;
          var record = { classId: classId, schemeId: schemeId, position: 1, log: [] };
          s.progress.put(record);
          touch(s.meta);
          return record;
        });
      });
    });
  };

  // Sets which lesson a class will be taught next (for corrections and setting up mid-year).
  Storage.prototype.setClassPosition = function (classId, position) {
    if (!isPositiveWhole(position)) return Promise.reject(new Error('The lesson number must be a whole number, 1 or more.'));
    return transact(this.db, ['progress', 'meta'], 'readwrite', function (s) {
      return promisifyRequest(s.progress.get(classId)).then(function (p) {
        if (!p) throw new Error('Choose a scheme of work for this class first.');
        p.position = position;
        s.progress.put(p);
        touch(s.meta);
        return p;
      });
    });
  };

  // Records that a class has been taught the lesson it was on, and moves it to the next one.
  // `position` must be the class's current position, so a repeated tap cannot skip a lesson.
  Storage.prototype.markTaught = function (classId, position, when) {
    var taughtOn = (when || new Date()).toISOString();
    return transact(this.db, ['progress', 'lessons', 'meta'], 'readwrite', function (s) {
      return promisifyRequest(s.progress.get(classId)).then(function (p) {
        if (!p) throw new Error('This class does not follow a scheme of work yet.');
        if (p.position !== position) throw new Error('This class has already moved on to Lesson ' + p.position + '.');
        return promisifyRequest(s.lessons.index('byPosition').get([p.schemeId, position])).then(function (lesson) {
          var log = Array.isArray(p.log) ? p.log.slice() : [];
          log.push({
            position: position,
            lessonId: lesson ? lesson.id : null,
            title: lesson ? lesson.title : null,
            version: lesson ? lesson.version : null,
            taughtOn: taughtOn
          });
          if (log.length > LOG_LIMIT) log = log.slice(log.length - LOG_LIMIT);
          p.log = log;
          p.position = position + 1;
          s.progress.put(p);
          touch(s.meta);
          return p;
        });
      });
    });
  };

  // ---------- backup and restore ----------

  // Builds the backup object (see format at the top) from data already loaded with loadAll().
  // Synchronous, so the share sheet can open immediately after a tap.
  Storage.buildBackup = function (all, when) {
    var timetable = {};
    DAYS.forEach(function (d) {
      timetable[d] = (all.timetable[d] || [null, null, null, null, null]).map(function (slot) {
        if (!slot) return null;
        var s = { classId: slot.classId };
        if (slot.subjectOverride) s.subjectOverride = slot.subjectOverride;
        return s;
      });
    });
    var progress = all.progress || {};
    return {
      app: APP_ID,
      formatVersion: FORMAT_VERSION,
      exportedAt: (when || new Date()).toISOString(),
      classes: all.classes.map(function (c) { return { id: c.id, name: c.name, subject: c.subject }; }),
      timetable: timetable,
      schemes: (all.schemes || SCHEMES).map(copyScheme),
      lessons: (all.lessons || []).map(function (r) { return { schemeId: r.schemeId, importedAt: r.importedAt || null, lesson: r.lesson }; }),
      progress: Object.keys(progress).map(function (id) {
        var p = progress[id];
        return { classId: p.classId, schemeId: p.schemeId, position: p.position, log: Array.isArray(p.log) ? p.log : [] };
      })
    };
  };

  // Reads everything and builds the backup object. Does not change anything.
  Storage.prototype.exportData = function () {
    return this.loadAll().then(function (all) { return Storage.buildBackup(all); });
  };

  // Records that a backup file was successfully saved.
  Storage.prototype.markBackedUp = function (when) {
    var value = (when || new Date()).toISOString();
    return transact(this.db, ['meta'], 'readwrite', function (s) {
      s.meta.put({ key: 'lastBackupAt', value: value });
      return value;
    });
  };

  // Writes `data` (an already-validated backup, format 1 or 2) over everything, in one transaction.
  // A format 1 backup has no lessons or progress, so those end up empty; the schemes are always the fixed set.
  function replaceEverything(s, data) {
    s.classes.clear();
    s.slots.clear();
    s.schemes.clear();
    s.lessons.clear();
    s.progress.clear();
    data.classes.forEach(function (c) {
      s.classes.put({ id: c.id, name: cleanText(c.name), subject: cleanText(c.subject) });
    });
    DAYS.forEach(function (d) {
      var day = data.timetable[d] || [];
      day.forEach(function (slot, p) {
        if (!slot) return;
        var record = { key: slotKey(d, p), weekday: d, periodIndex: p, classId: slot.classId };
        if (cleanText(slot.subjectOverride)) record.subjectOverride = cleanText(slot.subjectOverride);
        s.slots.put(record);
      });
    });
    SCHEMES.forEach(function (sc) { s.schemes.put(copyScheme(sc)); });
    (Array.isArray(data.lessons) ? data.lessons : []).forEach(function (entry) {
      s.lessons.put(makeLessonRecord(entry.schemeId, entry.lesson, entry.importedAt || null));
    });
    (Array.isArray(data.progress) ? data.progress : []).forEach(function (p) {
      s.progress.put({ classId: p.classId, schemeId: p.schemeId, position: p.position, log: Array.isArray(p.log) ? p.log : [] });
    });
    touch(s.meta);
  }

  // Replaces ALL data with a backup. Nothing is merged.
  // First keeps a copy of the current data (for undo). If anything fails, nothing changes.
  // Resolves with the backup's summary; rejects with the list of problems if the file is invalid.
  Storage.prototype.restoreFromBackup = function (data) {
    var check = validateBackup(data);
    if (!check.ok) {
      var err = new Error('This backup cannot be restored.');
      err.problems = check.errors;
      return Promise.reject(err);
    }
    var self = this;
    return this.exportData().then(function (current) {
      return transact(self.db, STORES, 'readwrite', function (s) {
        s.snapshots.put({ key: 'pre-restore', savedAt: new Date().toISOString(), data: current });
        replaceEverything(s, data);
        return check.summary;
      });
    });
  };

  // Details of the safety copy taken before the last restore, or null.
  Storage.prototype.getUndoInfo = function () {
    return transact(this.db, ['snapshots'], 'readonly', function (s) {
      return promisifyRequest(s.snapshots.get('pre-restore')).then(function (snap) {
        if (!snap) return null;
        var summary = validateBackup(snap.data).summary;
        return {
          savedAt: snap.savedAt,
          classCount: summary.classCount,
          lessonCount: summary.lessonCount,
          importedLessonCount: summary.importedLessonCount
        };
      });
    });
  };

  // Puts back the data from before the last restore, then discards the safety copy.
  Storage.prototype.undoRestore = function () {
    return transact(this.db, STORES, 'readwrite', function (s) {
      return promisifyRequest(s.snapshots.get('pre-restore')).then(function (snap) {
        if (!snap) throw new Error('There is no restore to undo.');
        replaceEverything(s, snap.data);
        s.snapshots.delete('pre-restore');
        return true;
      });
    });
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Storage;
  } else {
    root.TDStorage = Storage;
  }
})(this);
