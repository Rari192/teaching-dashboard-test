/*
 * schedule.js — the time logic behind the Today widget.
 *
 * Works out, from the device's local time and your timetable, whether you
 * are teaching now, have a lesson coming up later today, or are finished.
 * It has no knowledge of screens or storage, so it can be tested on its own.
 *
 * Data shapes used here:
 *   classes   : [{ id: "c1", name: "10X/Cs1", subject: "GCSE CS" }, ...]
 *   timetable : { 1: [slot, slot, slot, slot, slot], ..., 5: [...] }
 *               keys 1–5 are Monday–Friday; each array has one slot per period.
 *               A slot is null (free period) or
 *               { classId: "c1" } or { classId: "c1", subjectOverride: "Digital Literacy" }
 */
(function (root) {
  'use strict';

  // The school day. Times are "HH:MM" in local time.
  // A period includes its start minute and ends just before its end minute.
  var PERIODS = [
    { number: 1, label: 'P1', start: '08:55', end: '10:00' },
    { number: 2, label: 'P2', start: '10:05', end: '11:10' },
    { number: 3, label: 'P3', start: '11:30', end: '12:35' },
    { number: 4, label: 'P4', start: '13:10', end: '14:15' },
    { number: 5, label: 'P5', start: '14:20', end: '15:25' }
  ];

  var BREAKS = [
    { label: 'Break', start: '11:10', end: '11:30' },
    { label: 'Lunch', start: '12:35', end: '13:10' }
  ];

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function toMinutes(hhmm) {
    var parts = hhmm.split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  // Minutes since midnight, including seconds as a fraction.
  function minutesOfDay(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  }

  function isSchoolDay(weekday) {
    return weekday >= 1 && weekday <= 5;
  }

  // Index (0–4) of the period running at this moment, or -1 if none.
  // Used to highlight the current row, whether or not it is a free period.
  function periodIndexAt(date) {
    if (!isSchoolDay(date.getDay())) return -1;
    var m = minutesOfDay(date);
    for (var i = 0; i < PERIODS.length; i++) {
      if (m >= toMinutes(PERIODS[i].start) && m < toMinutes(PERIODS[i].end)) return i;
    }
    return -1;
  }

  // Turns a timetable slot into the details the screen shows, or null if free.
  // A slot pointing at a class that no longer exists is treated as free.
  function resolveSlot(slot, classes) {
    if (!slot || !slot.classId) return null;
    var cls = null;
    for (var i = 0; i < classes.length; i++) {
      if (classes[i].id === slot.classId) { cls = classes[i]; break; }
    }
    if (!cls) return null;
    var override = slot.subjectOverride ? String(slot.subjectOverride).trim() : '';
    return {
      classId: cls.id,
      className: cls.name,
      subject: override || cls.subject,
      isOverride: override !== ''
    };
  }

  function lessonAt(weekday, periodIndex, timetable, classes) {
    var day = timetable && timetable[weekday];
    if (!day) return null;
    var details = resolveSlot(day[periodIndex], classes);
    if (!details) return null;
    var p = PERIODS[periodIndex];
    details.weekday = weekday;
    details.dayName = DAY_NAMES[weekday];
    details.periodIndex = periodIndex;
    details.periodNumber = p.number;
    details.periodLabel = p.label;
    details.start = p.start;
    details.end = p.end;
    return details;
  }

  // First lesson on this weekday whose period starts at or after `fromMinutes`.
  function firstLessonFrom(weekday, fromMinutes, timetable, classes) {
    for (var i = 0; i < PERIODS.length; i++) {
      if (toMinutes(PERIODS[i].start) < fromMinutes) continue;
      var lesson = lessonAt(weekday, i, timetable, classes);
      if (lesson) return lesson;
    }
    return null;
  }

  // The first lesson on a later day (up to a week ahead), with how many days away it is.
  function nextLessonOnLaterDay(date, timetable, classes) {
    for (var ahead = 1; ahead <= 7; ahead++) {
      var weekday = (date.getDay() + ahead) % 7;
      if (!isSchoolDay(weekday)) continue;
      var lesson = firstLessonFrom(weekday, 0, timetable, classes);
      if (lesson) {
        lesson.daysAhead = ahead;
        lesson.whenLabel = ahead === 1 ? 'Tomorrow' : DAY_NAMES[weekday];
        return lesson;
      }
    }
    return null;
  }

  /*
   * The single question the Today widget asks.
   * Returns one of:
   *   { state: 'now',  lesson, endsAt, nextToday }
   *   { state: 'next', lesson, startsAt, minutesUntil, afterThat }
   *   { state: 'end',  reason: 'finished' | 'no-lessons-today', nextLesson }
   * Every result also has `periodIndexNow` (0–4, or -1) for highlighting the timetable.
   */
  function getTodayStatus(date, timetable, classes) {
    var weekday = date.getDay();
    var m = minutesOfDay(date);
    var periodIndexNow = periodIndexAt(date);

    if (isSchoolDay(weekday)) {
      // 1. Teaching right now?
      if (periodIndexNow !== -1) {
        var current = lessonAt(weekday, periodIndexNow, timetable, classes);
        if (current) {
          return {
            state: 'now',
            periodIndexNow: periodIndexNow,
            lesson: current,
            endsAt: current.end,
            nextToday: firstLessonFrom(weekday, toMinutes(current.end), timetable, classes)
          };
        }
      }

      // 2. A lesson still to come today? (between periods, break, lunch, free period, before school)
      var upcoming = firstLessonFrom(weekday, m, timetable, classes);
      if (upcoming) {
        return {
          state: 'next',
          periodIndexNow: periodIndexNow,
          lesson: upcoming,
          startsAt: upcoming.start,
          minutesUntil: Math.ceil(toMinutes(upcoming.start) - m),
          afterThat: firstLessonFrom(weekday, toMinutes(upcoming.end), timetable, classes)
        };
      }
    }

    // 3. Nothing more today.
    var hadLessonsToday = isSchoolDay(weekday) && firstLessonFrom(weekday, 0, timetable, classes) !== null;
    return {
      state: 'end',
      periodIndexNow: periodIndexNow,
      reason: hadLessonsToday ? 'finished' : 'no-lessons-today',
      nextLesson: nextLessonOnLaterDay(date, timetable, classes)
    };
  }

  var api = {
    PERIODS: PERIODS,
    BREAKS: BREAKS,
    DAY_NAMES: DAY_NAMES,
    toMinutes: toMinutes,
    periodIndexAt: periodIndexAt,
    resolveSlot: resolveSlot,
    getTodayStatus: getTodayStatus
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Schedule = api;
  }
})(this);
