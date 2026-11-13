/*
 * schedule.test.js — automated checks for js/schedule.js.
 * Run on a computer with:  node tests/schedule.test.js
 * Or open run-tests.html (in the main folder) in Safari to see the same results on the iPad.
 *
 * The sample timetable matches the canvas designs. 13 November 2026 is a Friday.
 */
(function (root) {
  'use strict';

  var Schedule = (typeof require !== 'undefined') ? require('../js/schedule.js') : root.Schedule;

  var classes = [
    { id: 'y7',  name: '7A/Cp',   subject: 'Computing' },
    { id: 'y8',  name: '8B/Cp',   subject: 'Computing' },
    { id: 'y9',  name: '9C/Cp',   subject: 'Computing' },
    { id: 'y10', name: '10X/Cs1', subject: 'GCSE CS' },
    { id: 'y11', name: '11Y/Cs1', subject: 'GCSE CS' },
    { id: 'y12', name: '12/Cs',   subject: 'A Level CS' }
  ];

  function L(id, override) { return override ? { classId: id, subjectOverride: override } : { classId: id }; }

  var timetable = {
    1: [L('y11'), L('y12'), L('y10'), null,     L('y7')],               // Monday: P4 free
    2: [L('y7'),  null,     L('y11'), L('y9'),  L('y12')],              // Tuesday: P2 free
    3: [null,     L('y8', 'Digital Literacy'), L('y12'), L('y11'), L('y10')], // Wednesday: P1 free, P2 override
    4: [L('y10'), L('y12'), null,     L('y8'),  L('y11')],              // Thursday: P3 free
    5: [L('y9'),  null,     L('y10'), L('y12'), L('y7')]                // Friday: P2 free
  };

  // Local date-time helper. Month 11 = November.
  function at(day, hh, mm, ss) { return new Date(2026, 10, day, hh, mm, ss || 0); }
  var MON = 9, TUE = 10, WED = 11, FRI = 13, SAT = 14, SUN = 15;

  function status(date, tt) { return Schedule.getTodayStatus(date, tt || timetable, classes); }

  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  function eq(actual, expected, what) {
    if (actual !== expected) {
      throw new Error((what || 'value') + ': expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
    }
  }

  // ---- Teaching now ----
  test('Friday 11:52 (middle of P3) → NOW: 10X/Cs1, GCSE CS, ends 12:35', function () {
    var s = status(at(FRI, 11, 52));
    eq(s.state, 'now', 'state');
    eq(s.lesson.className, '10X/Cs1', 'class');
    eq(s.lesson.subject, 'GCSE CS', 'subject');
    eq(s.lesson.periodLabel, 'P3', 'period');
    eq(s.endsAt, '12:35', 'ends at');
    eq(s.periodIndexNow, 2, 'highlighted period');
  });

  test('During P3, the "Next" card shows P4 12/Cs at 13:10', function () {
    var s = status(at(FRI, 11, 52));
    eq(s.nextToday.className, '12/Cs', 'next class');
    eq(s.nextToday.start, '13:10', 'next start');
  });

  test('First minute of P1 (08:55) → NOW: P1', function () {
    var s = status(at(FRI, 8, 55));
    eq(s.state, 'now', 'state');
    eq(s.lesson.periodLabel, 'P1', 'period');
  });

  test('Last second of P1 (09:59:59) → still NOW: P1', function () {
    var s = status(at(FRI, 9, 59, 59));
    eq(s.state, 'now', 'state');
    eq(s.lesson.periodLabel, 'P1', 'period');
  });

  test('During P5 (last lesson, 15:00) → NOW, with no further lesson today', function () {
    var s = status(at(FRI, 15, 0));
    eq(s.state, 'now', 'state');
    eq(s.lesson.className, '7A/Cp', 'class');
    eq(s.nextToday, null, 'next today');
  });

  // ---- Between lessons ----
  test('Before school (07:30) → UP NEXT: P1 in 85 minutes', function () {
    var s = status(at(FRI, 7, 30));
    eq(s.state, 'next', 'state');
    eq(s.lesson.periodLabel, 'P1', 'period');
    eq(s.minutesUntil, 85, 'minutes until');
    eq(s.periodIndexNow, -1, 'highlighted period');
  });

  test('End of P1 exactly (10:00) → no longer teaching; UP NEXT is the following lesson', function () {
    // Friday P2 is free, so the next lesson is P3 at 11:30
    var s = status(at(FRI, 10, 0));
    eq(s.state, 'next', 'state');
    eq(s.lesson.periodLabel, 'P3', 'period');
  });

  test('5-minute gap between P1 and P2 (Mon 10:02) → UP NEXT: P2 in 3 minutes', function () {
    var s = status(at(MON, 10, 2));
    eq(s.state, 'next', 'state');
    eq(s.lesson.periodLabel, 'P2', 'period');
    eq(s.lesson.className, '12/Cs', 'class');
    eq(s.minutesUntil, 3, 'minutes until');
  });

  test('Part-way through a minute (10:04:30) rounds up to "in 1 minute", never "in 0"', function () {
    var s = status(at(MON, 10, 4, 30));
    eq(s.minutesUntil, 1, 'minutes until');
  });

  test('Free period (Fri 10:30, P2) → UP NEXT: P3 10X/Cs1, and P2 is still highlighted', function () {
    var s = status(at(FRI, 10, 30));
    eq(s.state, 'next', 'state');
    eq(s.lesson.className, '10X/Cs1', 'class');
    eq(s.periodIndexNow, 1, 'highlighted period');
  });

  test('Break (Fri 11:17) → UP NEXT: P3 starts 11:30, in 13 minutes; then P4', function () {
    var s = status(at(FRI, 11, 17));
    eq(s.state, 'next', 'state');
    eq(s.startsAt, '11:30', 'starts at');
    eq(s.minutesUntil, 13, 'minutes until');
    eq(s.afterThat.periodLabel, 'P4', 'after that');
  });

  test('Lunch (Fri 12:50) → UP NEXT: P4 12/Cs at 13:10', function () {
    var s = status(at(FRI, 12, 50));
    eq(s.state, 'next', 'state');
    eq(s.lesson.className, '12/Cs', 'class');
    eq(s.minutesUntil, 20, 'minutes until');
  });

  test('Free period after lunch (Mon P4, 13:30) → UP NEXT: P5', function () {
    var s = status(at(MON, 13, 30));
    eq(s.state, 'next', 'state');
    eq(s.lesson.periodLabel, 'P5', 'period');
  });

  // ---- End of day ----
  test('After P5 (Fri 15:25) → END: finished; next lesson Monday P1 11Y/Cs1', function () {
    var s = status(at(FRI, 15, 25));
    eq(s.state, 'end', 'state');
    eq(s.reason, 'finished', 'reason');
    eq(s.nextLesson.whenLabel, 'Monday', 'when');
    eq(s.nextLesson.periodLabel, 'P1', 'period');
    eq(s.nextLesson.className, '11Y/Cs1', 'class');
    eq(s.nextLesson.daysAhead, 3, 'days ahead');
  });

  test('Monday evening (19:00) → END; next lesson is "Tomorrow" P1', function () {
    var s = status(at(MON, 19, 0));
    eq(s.state, 'end', 'state');
    eq(s.nextLesson.whenLabel, 'Tomorrow', 'when');
    eq(s.nextLesson.periodLabel, 'P1', 'period');
  });

  test('Wednesday evening → next lesson is Thursday P1 (Thursday starts with a lesson)', function () {
    var s = status(at(WED, 18, 0));
    eq(s.nextLesson.whenLabel, 'Tomorrow', 'when');
    eq(s.nextLesson.className, '10X/Cs1', 'class');
  });

  test('Tuesday evening → next lesson skips Wednesday\'s free P1 and is Wednesday P2', function () {
    var s = status(at(TUE, 18, 0));
    eq(s.nextLesson.periodLabel, 'P2', 'period');
    eq(s.nextLesson.className, '8B/Cp', 'class');
  });

  test('Saturday → END: no lessons today; next lesson Monday P1', function () {
    var s = status(at(SAT, 10, 0));
    eq(s.state, 'end', 'state');
    eq(s.reason, 'no-lessons-today', 'reason');
    eq(s.nextLesson.whenLabel, 'Monday', 'when');
    eq(s.periodIndexNow, -1, 'highlighted period');
  });

  test('Sunday → next lesson is "Tomorrow" (Monday)', function () {
    var s = status(at(SUN, 20, 0));
    eq(s.nextLesson.whenLabel, 'Tomorrow', 'when');
  });

  test('A weekday with every period free → END: no lessons today', function () {
    var tt = { 1: [], 2: [], 3: [], 4: [], 5: [null, null, null, null, null] };
    tt[1] = timetable[1];
    var s = status(at(FRI, 9, 0), tt);
    eq(s.state, 'end', 'state');
    eq(s.reason, 'no-lessons-today', 'reason');
    eq(s.nextLesson.whenLabel, 'Monday', 'when');
  });

  test('An empty timetable → END with no next lesson (nothing to show yet)', function () {
    var s = status(at(FRI, 11, 0), {});
    eq(s.state, 'end', 'state');
    eq(s.nextLesson, null, 'next lesson');
  });

  // ---- Subjects ----
  test('Subject comes from the class default', function () {
    var s = status(at(FRI, 9, 0));
    eq(s.lesson.subject, 'Computing', 'subject');
    eq(s.lesson.isOverride, false, 'override');
  });

  test('A lesson-only subject change wins over the class default (Wed P2 → Digital Literacy)', function () {
    var s = status(at(WED, 10, 30));
    eq(s.lesson.className, '8B/Cp', 'class');
    eq(s.lesson.subject, 'Digital Literacy', 'subject');
    eq(s.lesson.isOverride, true, 'override');
  });

  test('Changing a class default updates its lessons, but not lessons with their own subject', function () {
    var changed = classes.map(function (c) { return c.id === 'y8' ? { id: 'y8', name: '8B/Cp', subject: 'Computing (new)' } : c; });
    var thu = Schedule.getTodayStatus(at(12, 13, 30), timetable, changed); // Thursday P4 8B/Cp
    eq(thu.lesson.subject, 'Computing (new)', 'Thursday subject');
    var wed = Schedule.getTodayStatus(at(WED, 10, 30), timetable, changed); // Wednesday P2 override
    eq(wed.lesson.subject, 'Digital Literacy', 'Wednesday subject');
  });

  test('A lesson whose class has been deleted is treated as a free period', function () {
    var withoutY10 = classes.filter(function (c) { return c.id !== 'y10'; });
    var s = Schedule.getTodayStatus(at(FRI, 11, 52), timetable, withoutY10);
    eq(s.state, 'next', 'state');
    eq(s.lesson.className, '12/Cs', 'class');
  });

  // ---- Test mode date ----
  test('Test mode: the chosen day is the next such day on or after today, at the chosen time', function () {
    var fri = new Date(2026, 10, 13, 16, 46); // Friday 13 November 2026
    var mon = Schedule.testModeDate(fri, 1, '08:40');
    eq(mon.getFullYear() + '-' + (mon.getMonth() + 1) + '-' + mon.getDate(), '2026-11-16', 'Monday after a Friday');
    eq(mon.getHours() + ':' + mon.getMinutes(), '8:40', 'time');
    var sameDay = Schedule.testModeDate(fri, 5, '10:05');
    eq(sameDay.getDate(), 13, 'Friday on a Friday is today');
    eq(Schedule.getTodayStatus(mon, [], {}).state !== undefined, true, 'usable by the Today logic');
  });

  test('Test mode: weekends move forward to the chosen school day', function () {
    var sun = new Date(2026, 10, 15, 12, 0); // Sunday
    eq(Schedule.testModeDate(sun, 1, '09:00').getDate(), 16, 'Monday after a Sunday');
    eq(Schedule.testModeDate(sun, 5, '09:00').getDate(), 20, 'Friday after a Sunday');
  });

  test('Test mode: a day or time that is not valid is refused', function () {
    var fri = new Date(2026, 10, 13, 16, 46);
    [[0, '08:40'], [6, '08:40'], [1.5, '08:40'], [1, '25:00'], [1, '8.40'], [1, '']].forEach(function (c) {
      var threw = false;
      try { Schedule.testModeDate(fri, c[0], c[1]); } catch (e) { threw = true; }
      eq(threw, true, 'accepted ' + JSON.stringify(c));
    });
  });

  // ---- Runner (shared by Node and the browser page) ----
  function runAll() {
    var results = tests.map(function (t) {
      try { t.fn(); return { name: t.name, passed: true }; }
      catch (e) { return { name: t.name, passed: false, error: e.message }; }
    });
    return results;
  }

  if (typeof module !== 'undefined' && module.exports && require.main === module) {
    var results = runAll();
    var failed = 0;
    results.forEach(function (r) {
      console.log((r.passed ? 'PASS  ' : 'FAIL  ') + r.name + (r.passed ? '' : '\n      ' + r.error));
      if (!r.passed) failed++;
    });
    console.log('\n' + (results.length - failed) + ' of ' + results.length + ' tests passed.');
    process.exit(failed ? 1 : 0);
  } else if (typeof module === 'undefined') {
    root.ScheduleTests = { runAll: runAll };
  }
})(this);
