/*
 * storage.test.js — checks for js/storage.js. Runs in a browser (IndexedDB is a browser feature).
 * Uses its own database, "teaching-dashboard-TEST", which is deleted before and after each test,
 * so your real dashboard data is never touched.
 */
(function (root) {
  'use strict';

  var TEST_DB = 'teaching-dashboard-TEST';
  var Storage = root.TDStorage;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  function eq(actual, expected, what) {
    if (actual !== expected) {
      throw new Error((what || 'value') + ': expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
    }
  }
  function ok(cond, what) { if (!cond) throw new Error(what); }

  // Opens a fresh, empty test database, runs fn(store), always closes it.
  function withFreshStore(fn) {
    return Storage.deleteDatabase(TEST_DB).then(function () {
      return Storage.open(TEST_DB);
    }).then(function (store) {
      return Promise.resolve().then(function () { return fn(store); })
        .then(function (r) { store.close(); return r; }, function (e) { store.close(); throw e; });
    });
  }

  function expectRejection(promise, messagePart) {
    return promise.then(function () {
      throw new Error('expected this to be refused, but it was accepted');
    }, function (e) {
      if (messagePart && String(e.message).indexOf(messagePart) === -1) {
        throw new Error('refused with the wrong message: "' + e.message + '"');
      }
    });
  }

  // Adds the classes used across tests; resolves with { y7, y10, y12 } saved records.
  function addSampleClasses(store) {
    var made = {};
    return store.saveClass({ name: '7A/Cp', subject: 'Computing' }).then(function (c) { made.y7 = c;
      return store.saveClass({ name: '10X/Cs1', subject: 'GCSE CS' }); }).then(function (c) { made.y10 = c;
      return store.saveClass({ name: '12/Cs', subject: 'A Level CS' }); }).then(function (c) { made.y12 = c;
      return made; });
  }

  // ---- Classes ----
  test('A new database starts empty, with a 5 × 5 timetable of free periods', function () {
    return withFreshStore(function (store) {
      return store.loadAll().then(function (all) {
        eq(all.classes.length, 0, 'classes');
        for (var d = 1; d <= 5; d++) {
          eq(all.timetable[d].length, 5, 'periods on day ' + d);
          all.timetable[d].forEach(function (s) { eq(s, null, 'slot'); });
        }
        eq(all.lastChangedAt, null, 'last changed');
      });
    });
  });

  test('Adding a class saves it with an id; it is there when loaded back', function () {
    return withFreshStore(function (store) {
      return store.saveClass({ name: '  10X/Cs1 ', subject: 'GCSE CS' }).then(function (saved) {
        ok(saved.id, 'the class was given an id');
        eq(saved.name, '10X/Cs1', 'name is trimmed');
        return store.loadAll();
      }).then(function (all) {
        eq(all.classes.length, 1, 'classes');
        eq(all.classes[0].subject, 'GCSE CS', 'subject');
        ok(all.lastChangedAt, 'last-changed time recorded');
      });
    });
  });

  test('Classes load in a natural order (7A before 10X before 12)', function () {
    return withFreshStore(function (store) {
      return store.saveClass({ name: '12/Cs', subject: 'A Level CS' })
        .then(function () { return store.saveClass({ name: '7A/Cp', subject: 'Computing' }); })
        .then(function () { return store.saveClass({ name: '10X/Cs1', subject: 'GCSE CS' }); })
        .then(function () { return store.loadAll(); })
        .then(function (all) {
          eq(all.classes.map(function (c) { return c.name; }).join(', '), '7A/Cp, 10X/Cs1, 12/Cs', 'order');
        });
    });
  });

  test('Editing a class changes it rather than adding a second one', function () {
    return withFreshStore(function (store) {
      return store.saveClass({ name: '8B/Cp', subject: 'Computing' }).then(function (c) {
        return store.saveClass({ id: c.id, name: '8B/Cp', subject: 'Digital Literacy' });
      }).then(function () { return store.loadAll(); }).then(function (all) {
        eq(all.classes.length, 1, 'classes');
        eq(all.classes[0].subject, 'Digital Literacy', 'subject');
      });
    });
  });

  test('A class with no name, or no subject, is refused', function () {
    return withFreshStore(function (store) {
      return expectRejection(store.saveClass({ name: '  ', subject: 'Computing' }), 'name')
        .then(function () { return expectRejection(store.saveClass({ name: '9C/Cp', subject: '' }), 'subject'); });
    });
  });

  test('Two classes with the same name (any capitals) are refused', function () {
    return withFreshStore(function (store) {
      return store.saveClass({ name: '9C/Cp', subject: 'Computing' }).then(function () {
        return expectRejection(store.saveClass({ name: '9c/cp', subject: 'Computing' }), 'already have');
      });
    });
  });

  // ---- Timetable ----
  test('Assigning a class to a period saves it; the subject comes from the class', function () {
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function (c) {
        return store.setSlot(5, 2, { classId: c.y10.id }).then(function () { return store.loadAll(); })
          .then(function (all) {
            eq(all.timetable[5][2].classId, c.y10.id, 'Friday P3');
            eq(all.timetable[5][2].subjectOverride, undefined, 'no override');
            var r = Schedule.resolveSlot(all.timetable[5][2], all.classes);
            eq(r.subject, 'GCSE CS', 'subject shown');
          });
      });
    });
  });

  test('A lesson-only subject is kept; the class default is unchanged', function () {
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function (c) {
        return store.setSlot(3, 1, { classId: c.y7.id, subjectOverride: 'Digital Literacy' })
          .then(function () { return store.loadAll(); })
          .then(function (all) {
            eq(all.timetable[3][1].subjectOverride, 'Digital Literacy', 'override');
            var y7 = all.classes.filter(function (x) { return x.id === c.y7.id; })[0];
            eq(y7.subject, 'Computing', 'class default');
          });
      });
    });
  });

  test('Choosing the class default as the "override" is not stored as an override', function () {
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function (c) {
        return store.setSlot(1, 0, { classId: c.y12.id, subjectOverride: 'A Level CS' })
          .then(function () { return store.loadAll(); })
          .then(function (all) { eq(all.timetable[1][0].subjectOverride, undefined, 'override'); });
      });
    });
  });

  test('Setting a period to free removes the lesson', function () {
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function (c) {
        return store.setSlot(2, 4, { classId: c.y7.id })
          .then(function () { return store.setSlot(2, 4, null); })
          .then(function () { return store.loadAll(); })
          .then(function (all) { eq(all.timetable[2][4], null, 'Tuesday P5'); });
      });
    });
  });

  test('A lesson for a class that does not exist is refused', function () {
    return withFreshStore(function (store) {
      return expectRejection(store.setSlot(1, 0, { classId: 'no-such-class' }), 'no longer exists');
    });
  });

  test('Weekends and period numbers outside P1–P5 are refused', function () {
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function (c) {
        return expectRejection(store.setSlot(6, 0, { classId: c.y7.id }), 'Weekday')
          .then(function () { return expectRejection(store.setSlot(1, 5, { classId: c.y7.id }), 'Period'); });
      });
    });
  });

  // ---- Deleting a class ----
  test('Before deleting, the dashboard can say how many lessons will become free', function () {
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function (c) {
        return store.setSlot(1, 0, { classId: c.y10.id })
          .then(function () { return store.setSlot(3, 2, { classId: c.y10.id }); })
          .then(function () { return store.setSlot(5, 2, { classId: c.y12.id }); })
          .then(function () { return store.countLessonsForClass(c.y10.id); })
          .then(function (n) { eq(n, 2, 'lessons for 10X/Cs1'); });
      });
    });
  });

  test('Deleting a class removes it and turns only its lessons into free periods', function () {
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function (c) {
        return store.setSlot(1, 0, { classId: c.y10.id })
          .then(function () { return store.setSlot(3, 2, { classId: c.y10.id }); })
          .then(function () { return store.setSlot(5, 2, { classId: c.y12.id }); })
          .then(function () { return store.deleteClass(c.y10.id); })
          .then(function (freed) { eq(freed, 2, 'lessons freed'); return store.loadAll(); })
          .then(function (all) {
            eq(all.classes.length, 2, 'classes left');
            eq(all.timetable[1][0], null, 'Monday P1');
            eq(all.timetable[3][2], null, 'Wednesday P3');
            eq(all.timetable[5][2].classId, c.y12.id, 'Friday P3 (other class) kept');
          });
      });
    });
  });

  // ---- Saving is real ----
  test('Changes are still there after closing and reopening the database', function () {
    return Storage.deleteDatabase(TEST_DB).then(function () { return Storage.open(TEST_DB); })
      .then(function (store) {
        return addSampleClasses(store).then(function (c) {
          return store.setSlot(4, 3, { classId: c.y7.id, subjectOverride: 'Digital Literacy' });
        }).then(function () { store.close(); });
      })
      .then(function () { return Storage.open(TEST_DB); })
      .then(function (store) {
        return store.loadAll().then(function (all) {
          store.close();
          eq(all.classes.length, 3, 'classes');
          eq(all.timetable[4][3].subjectOverride, 'Digital Literacy', 'Thursday P4');
        });
      });
  });

  // ---- Backup ----
  test('Export produces a complete backup in the agreed format', function () {
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function (c) {
        return store.setSlot(5, 2, { classId: c.y10.id });
      }).then(function () { return store.exportData(); }).then(function (b) {
        eq(b.app, 'teaching-dashboard', 'app id');
        eq(b.formatVersion, 2, 'format version');
        ok(!isNaN(Date.parse(b.exportedAt)), 'export time present');
        eq(b.classes.length, 3, 'classes');
        eq(b.timetable[5].length, 5, 'Friday periods');
        eq(b.schemes.length, 6, 'schemes');
        ok(Array.isArray(b.lessons) && b.lessons.length === 0, 'an empty list of lessons');
        ok(Array.isArray(b.progress) && b.progress.length === 0, 'an empty list of class progress');
        var check = TDStorage.validateBackup(JSON.parse(JSON.stringify(b)));
        ok(check.ok, 'the exported file passes the restore check');
        eq(check.summary.lessonCount, 1, 'lessons counted');
      });
    });
  });

  test('Recording a backup stores the time, for the "last backup" panel', function () {
    return withFreshStore(function (store) {
      var when = new Date(2026, 10, 9, 15, 40);
      return store.markBackedUp(when).then(function () { return store.loadAll(); })
        .then(function (all) { eq(all.lastBackupAt, when.toISOString(), 'last backup'); });
    });
  });

  // ---- Restore: checking files ----
  test('A file that is not a dashboard backup is rejected', function () {
    var v = TDStorage.validateBackup({ name: 'something else' });
    eq(v.ok, false, 'accepted');
    eq(v.errors[0], 'This file is not a Teaching Dashboard backup.', 'message');
  });

  test('A backup from a newer version of the dashboard is rejected', function () {
    var v = TDStorage.validateBackup({ app: 'teaching-dashboard', formatVersion: 99, classes: [], timetable: {} });
    eq(v.ok, false, 'accepted');
  });

  test('A backup whose lesson points to a missing class is rejected', function () {
    var v = TDStorage.validateBackup({
      app: 'teaching-dashboard', formatVersion: 1, classes: [{ id: 'a', name: '7A', subject: 'Computing' }],
      timetable: { 1: [{ classId: 'zzz' }, null, null, null, null] }
    });
    eq(v.ok, false, 'accepted');
    ok(v.errors[0].indexOf('not in the backup') !== -1, 'explains why');
  });

  test('A backup with a day that does not have exactly 5 periods is rejected', function () {
    var v = TDStorage.validateBackup({
      app: 'teaching-dashboard', formatVersion: 1, classes: [], timetable: { 2: [null, null] }
    });
    eq(v.ok, false, 'accepted');
  });

  // ---- Restore: replacing ----
  test('Restoring replaces everything — nothing from before is merged in', function () {
    var backup = {
      app: 'teaching-dashboard', formatVersion: 1, exportedAt: '2026-10-02T15:00:00.000Z',
      classes: [{ id: 'b1', name: '11Y/Cs1', subject: 'GCSE CS' }],
      timetable: { 1: [null, { classId: 'b1' }, null, null, null] }
    };
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function (c) {
        return store.setSlot(5, 2, { classId: c.y10.id });
      }).then(function () { return store.restoreFromBackup(backup); })
        .then(function (summary) {
          eq(summary.classCount, 1, 'summary classes');
          eq(summary.lessonCount, 1, 'summary lessons');
          return store.loadAll();
        }).then(function (all) {
          eq(all.classes.length, 1, 'classes after restore');
          eq(all.classes[0].name, '11Y/Cs1', 'class');
          eq(all.timetable[5][2], null, 'old Friday lesson gone');
          eq(all.timetable[1][1].classId, 'b1', 'Monday P2 from backup');
        });
    });
  });

  test('An invalid backup changes nothing', function () {
    return withFreshStore(function (store) {
      return addSampleClasses(store).then(function () {
        return store.restoreFromBackup({ app: 'teaching-dashboard', formatVersion: 1, classes: 'oops', timetable: {} })
          .then(function () { throw new Error('the invalid backup was accepted'); },
                function (e) { ok(e.problems && e.problems.length, 'problems listed'); });
      }).then(function () { return store.loadAll(); })
        .then(function (all) { eq(all.classes.length, 3, 'classes untouched'); });
    });
  });

  test('A restore can be undone, bringing back exactly the data from before', function () {
    var backup = {
      app: 'teaching-dashboard', formatVersion: 1,
      classes: [{ id: 'b1', name: '11Y/Cs1', subject: 'GCSE CS' }], timetable: {}
    };
    return withFreshStore(function (store) {
      var savedY10;
      return addSampleClasses(store).then(function (c) {
        savedY10 = c.y10;
        return store.setSlot(5, 2, { classId: c.y10.id, subjectOverride: 'Revision' });
      }).then(function () { return store.restoreFromBackup(backup); })
        .then(function () { return store.getUndoInfo(); })
        .then(function (info) {
          eq(info.classCount, 3, 'undo info: classes');
          eq(info.lessonCount, 1, 'undo info: lessons');
          return store.undoRestore();
        })
        .then(function () { return store.loadAll(); })
        .then(function (all) {
          eq(all.classes.length, 3, 'classes back');
          eq(all.timetable[5][2].classId, savedY10.id, 'Friday P3 back');
          eq(all.timetable[5][2].subjectOverride, 'Revision', 'override back');
          return store.getUndoInfo();
        })
        .then(function (info) { eq(info, null, 'undo used up'); });
    });
  });

  // =====================================================================
  // Phase 2: schemes, lessons, import, class progress, backup format 2
  // =====================================================================

  var SCHEME_INFO = {
    y9: { id: 'y9', title: 'Year 9 Computing', yearGroup: 9, subject: 'Computing' },
    y10: { id: 'y10', title: 'Year 10 GCSE Computer Science', yearGroup: 10, subject: 'Computer Science' }
  };

  // A minimal valid lesson file. `extra` adds or overrides lesson fields.
  function lessonFile(schemeId, slug, position, version, title, extra) {
    var lesson = { id: schemeId + '/' + slug, version: version, position: position, topic: 'Test topic',
      title: title, objective: 'Test objective.' };
    Object.keys(extra || {}).forEach(function (k) { lesson[k] = extra[k]; });
    var scheme = JSON.parse(JSON.stringify(SCHEME_INFO[schemeId]));   // a fresh copy for each file
    return { app: 'teaching-dashboard', kind: 'lesson', formatVersion: 1, scheme: scheme, lesson: lesson };
  }
  function asFiles() {
    return Array.prototype.map.call(arguments, function (d, i) { return { name: 'file' + (i + 1) + '.json', data: d }; });
  }
  function statuses(items) { return items.map(function (i) { return i.status; }).join(','); }
  function importNow(store, files, replaceIds) { return store.commitImport(files, replaceIds || []); }
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  // A lesson file using every section, as Claude will produce them.
  function fullLessonFile() {
    return lessonFile('y10', 'characters-ascii-unicode', 1, 1, 'Characters: character sets, ASCII and Unicode', {
      type: 'Theory',
      specRefs: ['1.2.4'],
      vocabulary: [{ term: 'Character set', meaning: 'A defined list of characters, each with a unique binary code.' }],
      doNow: { board: 1, minutes: 7, questions: [{ q: 'How many bits are in a byte?', a: '8' }] },
      iDo: { minutes: 12, steps: [{ board: 2, heading: 'Why a character set is needed', say: 'A computer can only store binary.',
        example: { question: 'What is the ASCII code for A?', working: ['A is 65 in denary'], answer: '1000001' }, code: 'print(ord("A"))' }] },
      weDo: { minutes: 8, items: [{ board: 3, prompt: 'Convert B to ASCII.', expected: '66' }] },
      checks: [{ after: 'iDo', board: 2, question: 'Why does Unicode need more bits than ASCII?', answer: 'It represents far more characters.' }],
      youDo: { board: 4, minutes: 15, instructions: 'Complete the worksheet.', tasks: [{ task: 'Encode CAT in ASCII.', answer: '67 65 84' }],
        extension: { task: 'How many characters can 8-bit ASCII represent?', answer: '256' } },
      misconceptions: [{ wrong: 'ASCII and Unicode are the same.', correction: 'Unicode includes ASCII and many more characters.' }],
      resources: [{ name: 'Characters worksheet (PDF)', note: 'One per student' }]
    });
  }

  // ---- Schemes and the database upgrade ----
  test('A new database has one scheme per year group, with the fixed ids y7 to y12', function () {
    return withFreshStore(function (store) {
      return store.loadAll().then(function (all) {
        eq(all.schemes.map(function (s) { return s.id; }).join(','), 'y7,y8,y9,y10,y11,y12', 'scheme ids');
        eq(all.schemes.map(function (s) { return s.yearGroup; }).join(','), '7,8,9,10,11,12', 'year groups');
        eq(all.lessons.length, 0, 'no lessons yet');
        eq(Object.keys(all.progress).length, 0, 'no progress yet');
      });
    });
  });

  test('Upgrading a Phase 1 (version 1) database keeps every class, lesson and backup date', function () {
    var name = TEST_DB;
    return Storage.deleteDatabase(name).then(function () {
      return new Promise(function (resolve, reject) {
        var req = root.indexedDB.open(name, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          db.createObjectStore('classes', { keyPath: 'id' }).put({ id: 'old1', name: '9A', subject: 'Computing' });
          var slots = db.createObjectStore('slots', { keyPath: 'key' });
          slots.createIndex('byClass', 'classId', { unique: false });
          slots.put({ key: '2-3', weekday: 2, periodIndex: 3, classId: 'old1', subjectOverride: 'Revision' });
          db.createObjectStore('meta', { keyPath: 'key' }).put({ key: 'lastBackupAt', value: '2026-11-10T08:00:00.000Z' });
          db.createObjectStore('snapshots', { keyPath: 'key' });
        };
        req.onsuccess = function () { req.result.close(); resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    }).then(function () { return Storage.open(name); }).then(function (store) {
      return store.loadAll().then(function (all) {
        store.close();
        eq(all.classes.length, 1, 'classes');
        eq(all.classes[0].name, '9A', 'class name');
        eq(all.timetable[2][3].classId, 'old1', 'Tuesday P4 class');
        eq(all.timetable[2][3].subjectOverride, 'Revision', 'Tuesday P4 override');
        eq(all.lastBackupAt, '2026-11-10T08:00:00.000Z', 'last backup date');
        eq(all.schemes.length, 6, 'schemes added');
      });
    });
  });

  // ---- Checking lesson files ----
  test('A lesson file using every section passes the checks', function () {
    var v = TDStorage.validateLessonFile(fullLessonFile());
    ok(v.ok, 'refused: ' + (v.errors || []).join(' / '));
    eq(v.record.schemeId, 'y10', 'scheme');
    eq(v.record.type, 'Theory', 'type');
  });

  test('Each missing required field is reported', function () {
    var f = lessonFile('y9', 'x', 1, 1, 'T');
    ['id', 'version', 'position', 'title', 'topic', 'objective'].forEach(function (k) { delete f.lesson[k]; });
    var v = TDStorage.validateLessonFile(f);
    eq(v.ok, false, 'accepted');
    var text = v.errors.join(' | ');
    ['no id', 'version', 'position', 'no title', 'no topic', 'no learning objective'].forEach(function (part) {
      ok(text.indexOf(part) !== -1, 'no message about "' + part + '": ' + text);
    });
  });

  test('A separate theory or programming scheme is refused; only y7 to y12 are allowed', function () {
    var f = lessonFile('y10', 'loops', 3, 1, 'For loops');
    f.scheme = { id: 'y10-programming', title: 'Programming', yearGroup: 10, subject: 'Computer Science' };
    f.lesson.id = 'y10-programming/loops';
    var v = TDStorage.validateLessonFile(f);
    eq(v.ok, false, 'accepted');
    ok(v.errors[0].indexOf('not one of your schemes') !== -1, 'message: ' + v.errors[0]);
  });

  test('A lesson id must start with its scheme id', function () {
    var f = lessonFile('y9', 'x', 1, 1, 'T');
    f.lesson.id = 'y8/x';
    var v = TDStorage.validateLessonFile(f);
    eq(v.ok, false, 'accepted');
    ok(v.errors[0].indexOf('must start with "y9/"') !== -1, 'message: ' + v.errors[0]);
  });

  test('A scheme with the wrong year group is refused', function () {
    var f = lessonFile('y9', 'x', 1, 1, 'T');
    f.scheme.yearGroup = 8;
    eq(TDStorage.validateLessonFile(f).ok, false, 'accepted');
  });

  test('Version and position must be whole numbers, 1 or more', function () {
    [0, -1, 1.5, '2'].forEach(function (bad) {
      eq(TDStorage.validateLessonFile(lessonFile('y9', 'x', 1, bad, 'T')).ok, false, 'version ' + JSON.stringify(bad) + ' accepted');
      eq(TDStorage.validateLessonFile(lessonFile('y9', 'x', bad, 1, 'T')).ok, false, 'position ' + JSON.stringify(bad) + ' accepted');
    });
  });

  test('Badly formed optional sections are reported', function () {
    var v = TDStorage.validateLessonFile(lessonFile('y9', 'x', 1, 1, 'T', {
      vocabulary: [{ term: 'Bit' }],
      checks: [{ after: 'later', question: 'Q?' }],
      weDo: { items: [{ board: 0, prompt: 'P' }] },
      iDo: { steps: [] }
    }));
    eq(v.ok, false, 'accepted');
    var text = v.errors.join(' | ');
    ['has no meaning', 'when to ask it', 'has no answer', 'board number', 'has no items'].forEach(function (part) {
      ok(text.indexOf(part) !== -1, 'no message about "' + part + '": ' + text);
    });
  });

  test('Files that are not lesson files, or from a newer format, are refused', function () {
    eq(TDStorage.validateLessonFile({ app: 'teaching-dashboard', formatVersion: 2, classes: [] }).ok, false, 'a backup accepted as a lesson');
    var f = lessonFile('y9', 'x', 1, 1, 'T');
    f.formatVersion = 2;
    var v = TDStorage.validateLessonFile(f);
    eq(v.ok, false, 'newer format accepted');
    ok(v.errors[0].indexOf('newer version') !== -1, 'message: ' + v.errors[0]);
  });

  // ---- Importing ----
  test('A preview of new lessons saves nothing', function () {
    return withFreshStore(function (store) {
      var files = asFiles(lessonFile('y9', 'cybercrime', 1, 1, 'Cybercrime'), lessonFile('y9', 'hacking', 2, 1, 'Hacking'));
      return store.previewImport(files).then(function (items) {
        eq(statuses(items), 'new,new', 'statuses');
        return store.loadAll();
      }).then(function (all) { eq(all.lessons.length, 0, 'lessons saved by a preview'); });
    });
  });

  test('Importing saves each lesson once, in sequence order, with its id, position and version', function () {
    return withFreshStore(function (store) {
      var files = asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'), lessonFile('y9', 'cybercrime', 1, 1, 'Cybercrime'));
      return importNow(store, files).then(function (r) {
        eq(r.added, 2, 'added');
        return store.loadAll();
      }).then(function (all) {
        eq(all.lessons.map(function (l) { return l.id; }).join(','), 'y9/cybercrime,y9/hacking', 'order');
        eq(all.lessons[1].position, 2, 'position');
        eq(all.lessons[1].version, 1, 'version');
        ok(all.lessons[1].importedAt, 'import time recorded');
        eq(all.lessons[1].lesson.objective, 'Test objective.', 'content kept');
      });
    });
  });

  test('Same id, same version and same content: "already imported", nothing changes', function () {
    return withFreshStore(function (store) {
      var f = lessonFile('y9', 'hacking', 2, 1, 'Hacking');
      var firstTime;
      return importNow(store, asFiles(f), [], new Date(2026, 10, 1)).then(function () { return store.getLesson('y9/hacking'); })
        .then(function (r) { firstTime = r.importedAt; return store.previewImport(asFiles(JSON.parse(JSON.stringify(f)))); })
        .then(function (items) {
          eq(statuses(items), 'same', 'status');
          return importNow(store, asFiles(f));
        }).then(function (r) {
          eq(r.skipped, 1, 'skipped');
          return store.getLesson('y9/hacking');
        }).then(function (r) { eq(r.importedAt, firstTime, 'saved lesson untouched'); });
    });
  });

  test('Same id and version but different content is flagged and not imported', function () {
    return withFreshStore(function (store) {
      return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'))).then(function () {
        return store.previewImport(asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking (edited)')));
      }).then(function (items) {
        eq(statuses(items), 'conflict', 'status');
        ok(items[0].message.indexOf('higher version') !== -1, 'message: ' + items[0].message);
        return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking (edited)')));
      }).then(function (r) {
        eq(r.skipped, 1, 'skipped');
        return store.getLesson('y9/hacking');
      }).then(function (r) { eq(r.title, 'Hacking', 'saved lesson unchanged'); });
    });
  });

  test('A higher version updates the lesson and keeps its identity (no duplicate)', function () {
    return withFreshStore(function (store) {
      return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'))).then(function () {
        return store.previewImport(asFiles(lessonFile('y9', 'hacking', 2, 2, 'Hacking: brute force')));
      }).then(function (items) {
        eq(statuses(items), 'update', 'status');
        return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 2, 'Hacking: brute force')));
      }).then(function (r) {
        eq(r.updated, 1, 'updated');
        return store.loadAll();
      }).then(function (all) {
        eq(all.lessons.length, 1, 'lessons');
        eq(all.lessons[0].id, 'y9/hacking', 'id');
        eq(all.lessons[0].version, 2, 'version');
        eq(all.lessons[0].title, 'Hacking: brute force', 'new content');
      });
    });
  });

  test('An older version is not imported', function () {
    return withFreshStore(function (store) {
      return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 3, 'Hacking v3'))).then(function () {
        return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 2, 'Hacking v2')));
      }).then(function (r) {
        eq(r.skipped, 1, 'skipped');
        return store.getLesson('y9/hacking');
      }).then(function (r) { eq(r.version, 3, 'version kept'); });
    });
  });

  test('The same lesson chosen twice: only the highest version is used', function () {
    return withFreshStore(function (store) {
      var files = asFiles(lessonFile('y9', 'hacking', 2, 1, 'v1'), lessonFile('y9', 'hacking', 2, 2, 'v2'));
      return store.previewImport(files).then(function (items) {
        eq(statuses(items), 'repeat,new', 'statuses');
        return importNow(store, files);
      }).then(function () { return store.loadAll(); })
        .then(function (all) { eq(all.lessons.length, 1, 'lessons'); eq(all.lessons[0].title, 'v2', 'version used'); });
    });
  });

  test('Two chosen files with the same id and version but different content: neither is imported', function () {
    return withFreshStore(function (store) {
      var files = asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'), lessonFile('y9', 'hacking', 2, 1, 'Hacking (edited)'));
      return store.previewImport(files).then(function (items) {
        eq(statuses(items), 'invalid,invalid', 'statuses');
        return importNow(store, files);
      }).then(function () { return store.loadAll(); })
        .then(function (all) { eq(all.lessons.length, 0, 'lessons'); });
    });
  });

  test('Two different chosen lessons at the same position: neither is imported', function () {
    return withFreshStore(function (store) {
      var files = asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'), lessonFile('y9', 'phishing', 2, 1, 'Phishing'));
      return store.previewImport(files).then(function (items) {
        eq(statuses(items), 'invalid,invalid', 'statuses');
        return importNow(store, files);
      }).then(function () { return store.loadAll(); })
        .then(function (all) { eq(all.lessons.length, 0, 'lessons'); });
    });
  });

  test('A different lesson at a saved position is NOT replaced without an explicit decision', function () {
    return withFreshStore(function (store) {
      return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'))).then(function () {
        return store.previewImport(asFiles(lessonFile('y9', 'phishing', 2, 1, 'Phishing')));
      }).then(function (items) {
        eq(statuses(items), 'clash', 'status');
        eq(items[0].clashWith.id, 'y9/hacking', 'clashes with');
        return importNow(store, asFiles(lessonFile('y9', 'phishing', 2, 1, 'Phishing')), []);
      }).then(function (r) {
        eq(r.skipped, 1, 'skipped');
        return store.loadAll();
      }).then(function (all) { eq(all.lessons.length, 1, 'lessons'); eq(all.lessons[0].id, 'y9/hacking', 'kept'); });
    });
  });

  test('With an explicit decision, the clashing lesson is replaced', function () {
    return withFreshStore(function (store) {
      return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'))).then(function () {
        return importNow(store, asFiles(lessonFile('y9', 'phishing', 2, 1, 'Phishing')), ['y9/phishing']);
      }).then(function (r) {
        eq(r.added, 1, 'added');
        eq(r.replaced.join(','), 'y9/hacking', 'replaced');
        return store.loadAll();
      }).then(function (all) { eq(all.lessons.length, 1, 'lessons'); eq(all.lessons[0].id, 'y9/phishing', 'now at Lesson 2'); });
    });
  });

  test('An update that moves a lesson frees its old position', function () {
    return withFreshStore(function (store) {
      return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'))).then(function () {
        return importNow(store, asFiles(lessonFile('y9', 'hacking', 3, 2, 'Hacking')));
      }).then(function () { return Promise.all([store.getLessonAt('y9', 2), store.getLessonAt('y9', 3)]); })
        .then(function (r) { eq(r[0], null, 'Lesson 2'); eq(r[1].id, 'y9/hacking', 'Lesson 3'); });
    });
  });

  test('A broken file in a batch is skipped; the valid files are still imported', function () {
    return withFreshStore(function (store) {
      var files = asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'), { app: 'teaching-dashboard', kind: 'lesson' });
      files.push({ name: 'notes.txt', data: undefined });
      return store.previewImport(files).then(function (items) {
        eq(statuses(items), 'new,invalid,invalid', 'statuses');
        return importNow(store, files);
      }).then(function (r) { eq(r.added, 1, 'added'); eq(r.skipped, 2, 'skipped'); });
    });
  });

  test('The save re-checks: a lesson saved after the preview is never silently overwritten', function () {
    return withFreshStore(function (store) {
      var mine = asFiles(lessonFile('y9', 'phishing', 2, 1, 'Phishing'));
      return store.previewImport(mine).then(function (items) {
        eq(statuses(items), 'new', 'status at preview time');
        return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'))); // something else arrives first
      }).then(function () { return importNow(store, mine, []); })
        .then(function (r) {
          eq(r.added, 0, 'added');
          return store.getLessonAt('y9', 2);
        }).then(function (r) { eq(r.id, 'y9/hacking', 'Lesson 2 untouched'); });
    });
  });

  test('Importing never changes any class\'s progress', function () {
    return withFreshStore(function (store) {
      var c9a, before;
      return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (c) { c9a = c;
        return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 1, 'Hacking'))); })
        .then(function () { return store.setClassScheme(c9a.id, 'y9'); })
        .then(function () { return store.setClassPosition(c9a.id, 2); })
        .then(function () { return store.loadAll(); })
        .then(function (all) { before = JSON.stringify(all.progress); })
        .then(function () { return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 2, 'Hacking v2'))); })
        .then(function () { return importNow(store, asFiles(lessonFile('y9', 'phishing', 2, 1, 'Phishing')), ['y9/phishing']); })
        .then(function () { return importNow(store, asFiles(lessonFile('y9', 'cybercrime', 1, 1, 'Cybercrime'))); })
        .then(function () { return store.loadAll(); })
        .then(function (all) { eq(JSON.stringify(all.progress), before, 'progress'); });
    });
  });

  test('Deleting a lesson removes only that lesson and leaves progress alone', function () {
    return withFreshStore(function (store) {
      var c9a;
      return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (c) { c9a = c;
        return importNow(store, asFiles(lessonFile('y9', 'a', 1, 1, 'A'), lessonFile('y9', 'b', 2, 1, 'B'))); })
        .then(function () { return store.setClassScheme(c9a.id, 'y9'); })
        .then(function () { return store.deleteLesson('y9/a'); })
        .then(function () { return store.loadAll(); })
        .then(function (all) {
          eq(all.lessons.length, 1, 'lessons');
          eq(all.lessons[0].id, 'y9/b', 'remaining lesson');
          eq(all.progress[c9a.id].position, 1, 'progress');
        });
    });
  });

  // ---- Class progress ----
  test('A class follows its scheme from Lesson 1; choosing the same scheme again keeps its place', function () {
    return withFreshStore(function (store) {
      var c;
      return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (x) { c = x; return store.loadAll(); })
        .then(function (all) { eq(all.progress[c.id], undefined, 'no progress before a scheme is chosen'); })
        .then(function () { return store.setClassScheme(c.id, 'y9'); })
        .then(function (p) { eq(p.position, 1, 'starts at'); return store.setClassPosition(c.id, 6); })
        .then(function () { return store.setClassScheme(c.id, 'y9'); })
        .then(function (p) { eq(p.position, 6, 'same scheme again'); return store.setClassScheme(c.id, 'y10'); })
        .then(function (p) { eq(p.schemeId, 'y10', 'scheme'); eq(p.position, 1, 'a different scheme starts at'); })
        .then(function () { return store.setClassScheme(c.id, null); })
        .then(function () { return store.loadAll(); })
        .then(function (all) { eq(all.progress[c.id], undefined, 'progress removed when unlinked'); });
    });
  });

  test('9A, 9B and 9C share one Year 9 scheme and lesson, each at its own position', function () {
    return withFreshStore(function (store) {
      var ids = {};
      return ['9A', '9B', '9C'].reduce(function (p, n) {
        return p.then(function () { return store.saveClass({ name: n, subject: 'Computing' }); })
          .then(function (c) { ids[n] = c.id; return store.setClassScheme(c.id, 'y9'); });
      }, Promise.resolve())
        .then(function () { return importNow(store, asFiles(lessonFile('y9', 'l8', 8, 1, 'Lesson eight'))); })
        .then(function () { return store.setClassPosition(ids['9A'], 12); })
        .then(function () { return store.setClassPosition(ids['9B'], 8); })
        .then(function () { return store.setClassPosition(ids['9C'], 15); })
        .then(function () { return store.loadAll(); })
        .then(function (all) {
          eq(all.progress[ids['9A']].position, 12, '9A');
          eq(all.progress[ids['9B']].position, 8, '9B');
          eq(all.progress[ids['9C']].position, 15, '9C');
          eq(all.lessons.length, 1, 'one shared copy of the lesson');
        });
    });
  });

  test('Mark as taught records the lesson and moves only that class to the next lesson', function () {
    return withFreshStore(function (store) {
      var a, b, when = new Date(2026, 10, 13, 10, 0);
      return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (c) { a = c;
        return store.saveClass({ name: '9B', subject: 'Computing' }); }).then(function (c) { b = c;
        return importNow(store, asFiles(lessonFile('y9', 'hacking', 8, 2, 'Hacking'))); })
        .then(function () { return store.setClassScheme(a.id, 'y9'); })
        .then(function () { return store.setClassScheme(b.id, 'y9'); })
        .then(function () { return store.setClassPosition(a.id, 8); })
        .then(function () { return store.setClassPosition(b.id, 8); })
        .then(function () { return store.markTaught(a.id, 8, when); })
        .then(function () { return store.loadAll(); })
        .then(function (all) {
          var p = all.progress[a.id];
          eq(p.position, 9, '9A next lesson');
          eq(p.log.length, 1, 'log entries');
          eq(p.log[0].position, 8, 'logged position');
          eq(p.log[0].lessonId, 'y9/hacking', 'logged lesson');
          eq(p.log[0].version, 2, 'logged version');
          eq(p.log[0].taughtOn, when.toISOString(), 'logged date');
          eq(all.progress[b.id].position, 8, '9B unchanged');
        });
    });
  });

  test('Changing the next lesson by hand never creates or alters a "last taught" record', function () {
    return withFreshStore(function (store) {
      var c, before;
      return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (x) { c = x; return store.setClassScheme(c.id, 'y9'); })
        .then(function () { return store.setClassPosition(c.id, 5); })
        .then(function (p) { eq(p.log.length, 0, 'log after a manual change'); return store.markTaught(c.id, 5, new Date(2026, 10, 12)); })
        .then(function (p) { before = JSON.stringify(p.log); return store.setClassPosition(c.id, 9); })
        .then(function () { return store.setClassPosition(c.id, 3); })
        .then(function (p) {
          eq(p.position, 3, 'position');
          eq(JSON.stringify(p.log), before, 'log unchanged by manual changes');
        });
    });
  });

  test('Mark as taught twice for the same lesson is refused, so no lesson is skipped', function () {
    return withFreshStore(function (store) {
      var c;
      return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (x) { c = x; return store.setClassScheme(c.id, 'y9'); })
        .then(function () { return store.markTaught(c.id, 1); })
        .then(function () { return expectRejection(store.markTaught(c.id, 1), 'already moved on to Lesson 2'); })
        .then(function () { return store.loadAll(); })
        .then(function (all) { eq(all.progress[c.id].position, 2, 'position'); });
    });
  });

  test('A lesson that has not been imported can still be marked as taught', function () {
    return withFreshStore(function (store) {
      var c;
      return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (x) { c = x; return store.setClassScheme(c.id, 'y9'); })
        .then(function () { return store.markTaught(c.id, 1); })
        .then(function (p) { eq(p.position, 2, 'position'); eq(p.log[0].lessonId, null, 'no lesson id logged'); });
    });
  });

  test('Progress needs a scheme, a known scheme and a whole lesson number', function () {
    return withFreshStore(function (store) {
      var c;
      return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (x) { c = x; })
        .then(function () { return expectRejection(store.setClassPosition(c.id, 3), 'scheme of work for this class first'); })
        .then(function () { return expectRejection(store.markTaught(c.id, 1), 'does not follow a scheme'); })
        .then(function () { return expectRejection(store.setClassScheme(c.id, 'y10-programming'), 'does not exist'); })
        .then(function () { return store.setClassScheme(c.id, 'y9'); })
        .then(function () { return expectRejection(store.setClassPosition(c.id, 0), 'whole number'); })
        .then(function () { return expectRejection(store.setClassPosition(c.id, 2.5), 'whole number'); })
        .then(function () { return expectRejection(store.setClassScheme('no-such-class', 'y9'), 'no longer exists'); });
    });
  });

  test('Deleting a class removes its progress and leaves other classes\' progress alone', function () {
    return withFreshStore(function (store) {
      var a, b;
      return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (c) { a = c;
        return store.saveClass({ name: '9B', subject: 'Computing' }); }).then(function (c) { b = c;
        return store.setClassScheme(a.id, 'y9'); })
        .then(function () { return store.setClassScheme(b.id, 'y9'); })
        .then(function () { return store.setClassPosition(b.id, 4); })
        .then(function () { return store.deleteClass(a.id); })
        .then(function () { return store.loadAll(); })
        .then(function (all) {
          eq(all.progress[a.id], undefined, '9A progress');
          eq(all.progress[b.id].position, 4, '9B progress');
        });
    });
  });

  // ---- Backup format 2 ----
  function fillStore(store) {
    var ids = {};
    return store.saveClass({ name: '9A', subject: 'Computing' }).then(function (c) { ids.a = c.id;
      return store.saveClass({ name: '10X', subject: 'Computer Science' }); }).then(function (c) { ids.x = c.id;
      return store.setSlot(1, 0, { classId: ids.a }); })
      .then(function () { return importNow(store, asFiles(lessonFile('y9', 'hacking', 2, 3, 'Hacking'), fullLessonFile())); })
      .then(function () { return store.setClassScheme(ids.a, 'y9'); })
      .then(function () { return store.setClassScheme(ids.x, 'y10'); })
      .then(function () { return store.markTaught(ids.a, 1, new Date(2026, 10, 12)); })
      .then(function () { return ids; });
  }

  test('A backup includes lessons, schemes and class progress, and restores exactly', function () {
    var backup, original;
    return withFreshStore(function (store) {
      return fillStore(store).then(function () { return store.exportData(); })
        .then(function (b) { backup = JSON.parse(JSON.stringify(b)); return store.loadAll(); })
        .then(function (all) { original = all; });
    }).then(function () {
      var check = TDStorage.validateBackup(backup);
      ok(check.ok, 'backup refused: ' + (check.errors || []).join(' / '));
      eq(check.summary.importedLessonCount, 2, 'lessons counted');
      eq(check.summary.progressCount, 2, 'progress counted');
      return withFreshStore(function (store) {
        return store.restoreFromBackup(backup).then(function () { return store.loadAll(); }).then(function (all) {
          eq(JSON.stringify(all.lessons.map(function (l) { return [l.id, l.position, l.version, l.importedAt, l.lesson]; })),
            JSON.stringify(original.lessons.map(function (l) { return [l.id, l.position, l.version, l.importedAt, l.lesson]; })), 'lessons');
          eq(JSON.stringify(all.progress), JSON.stringify(original.progress), 'progress');
          eq(JSON.stringify(all.schemes), JSON.stringify(original.schemes), 'schemes');
          eq(all.classes.length, 2, 'classes');
        });
      });
    });
  });

  test('An older (format 1) backup still restores; it has no lessons or progress, and schemes stay', function () {
    return withFreshStore(function (store) {
      return fillStore(store).then(function () {
        return store.restoreFromBackup({ app: 'teaching-dashboard', formatVersion: 1,
          classes: [{ id: 'k', name: '7A', subject: 'Computing' }], timetable: { 1: [{ classId: 'k' }, null, null, null, null] } });
      }).then(function (summary) {
        eq(summary.formatVersion, 1, 'format');
        eq(summary.importedLessonCount, 0, 'imported lessons in file');
        return store.loadAll();
      }).then(function (all) {
        eq(all.classes.length, 1, 'classes');
        eq(all.lessons.length, 0, 'lessons');
        eq(Object.keys(all.progress).length, 0, 'progress');
        eq(all.schemes.length, 6, 'schemes');
      });
    });
  });

  test('Undoing a restore brings back lessons and class progress too', function () {
    return withFreshStore(function (store) {
      var before;
      return fillStore(store).then(function () { return store.loadAll(); })
        .then(function (all) { before = all; return store.restoreFromBackup({ app: 'teaching-dashboard', formatVersion: 1, classes: [], timetable: {} }); })
        .then(function () { return store.getUndoInfo(); })
        .then(function (info) { eq(info.importedLessonCount, 2, 'undo info: imported lessons'); return store.undoRestore(); })
        .then(function () { return store.loadAll(); })
        .then(function (all) {
          eq(all.lessons.length, 2, 'lessons back');
          eq(JSON.stringify(all.progress), JSON.stringify(before.progress), 'progress back');
        });
    });
  });

  test('Format 2 backups with broken lessons or progress are refused', function () {
    return withFreshStore(function (store) {
      return fillStore(store).then(function () { return store.exportData(); }).then(function (good) {
        function broken(change) { var b = JSON.parse(JSON.stringify(good)); change(b); return TDStorage.validateBackup(b).ok; }
        eq(broken(function (b) { b.progress[0].classId = 'nobody'; }), false, 'progress for a missing class accepted');
        eq(broken(function (b) { b.progress[0].position = 0; }), false, 'lesson number 0 accepted');
        eq(broken(function (b) { b.lessons[1].lesson.position = b.lessons[0].lesson.position; b.lessons[1].schemeId = b.lessons[0].schemeId;
          b.lessons[1].lesson.id = b.lessons[0].schemeId + '/other'; }), false, 'two lessons at one position accepted');
        eq(broken(function (b) { b.lessons.push(JSON.parse(JSON.stringify(b.lessons[0]))); }), false, 'duplicate lesson id accepted');
        eq(broken(function (b) { delete b.lessons[0].lesson.title; }), false, 'lesson with no title accepted');
        eq(broken(function (b) { b.schemes.push({ id: 'y10-programming', title: 'P', yearGroup: 10, subject: 'CS' }); }), false, 'unknown scheme accepted');
        eq(broken(function (b) { delete b.lessons; }), false, 'missing lessons list accepted');
      });
    });
  });

  test('A lesson file chosen by mistake in Restore is refused', function () {
    var v = TDStorage.validateBackup(lessonFile('y9', 'x', 1, 1, 'T'));
    eq(v.ok, false, 'accepted');
    eq(v.errors[0], 'This file is not a Teaching Dashboard backup.', 'message');
  });

  // ---- Runner ----
  function runAll() {
    if (!Storage || !root.indexedDB) {
      return Promise.resolve([{ name: 'Storage is available in this browser', passed: false,
        error: 'IndexedDB is not available here. Open the dashboard from its web address to test storage.' }]);
    }
    var results = [];
    return tests.reduce(function (chain, t) {
      return chain.then(function () {
        return Promise.resolve().then(t.fn).then(
          function () { results.push({ name: t.name, passed: true }); },
          function (e) { results.push({ name: t.name, passed: false, error: e && e.message ? e.message : String(e) }); }
        );
      });
    }, Promise.resolve()).then(function () {
      return Storage.deleteDatabase(TEST_DB).then(function () { return results; }, function () { return results; });
    });
  }

  root.StorageTests = { runAll: runAll };
})(this);
