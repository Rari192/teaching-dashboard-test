/*
 * steps.js — turns a saved lesson into the screens of the lesson prompter.
 * Pure logic: reads a lesson record, changes nothing, touches no storage or screen.
 *
 * The lesson file decides the order and names every stage (any name, any order).
 * This file only decides HOW each step is laid out, from what the step contains:
 *   'ask'       — one question to ask the class, with its expected answer
 *   'questions' — several questions shown together, each with an answer
 *   'task'      — independent work: instructions and/or tasks
 *   'explain'   — anything else: heading, what to say, points, examples, code
 * After the last step comes one extra screen, 'end', for "Mark as taught".
 */
(function (root) {
  'use strict';

  function has(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  // Which card layout a step uses.
  function kindOf(step) {
    if (has(step.question)) return 'ask';
    if (has(step.questions)) return 'questions';
    if (has(step.tasks) || has(step.instructions)) return 'task';
    return 'explain';
  }

  // The screens for a lesson record (as saved by storage.js): one per step, then 'end'.
  function build(record) {
    var steps = (record && record.lesson && Array.isArray(record.lesson.steps)) ? record.lesson.steps : [];
    var screens = steps.map(function (step, i) {
      return {
        index: i,
        kind: kindOf(step),
        stage: String(step.stage || '').trim(),
        board: step.board || null,
        answerBoard: step.answerBoard || null,
        step: step
      };
    });
    screens.push({ index: steps.length, kind: 'end', stage: 'End of lesson', board: null, answerBoard: null, step: null });
    return screens;
  }

  // Shortens text at a word boundary, for previews.
  function shorten(text, max) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    var cut = t.slice(0, max);
    var space = cut.lastIndexOf(' ');
    return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // The detail line for a screen: board, how much is in it, and time.
  function detailOf(screen) {
    var s = screen.step;
    var parts = [];
    if (screen.board) parts.push('Board ' + screen.board);
    if (screen.kind === 'ask') parts.push('ask before moving on');
    if (screen.kind === 'questions') parts.push(plural(s.questions.length, 'question', 'questions'));
    if (screen.kind === 'task' && has(s.tasks)) parts.push(plural(s.tasks.length, 'task', 'tasks'));
    if (s.minutes) parts.push('about ' + s.minutes + ' min');
    return parts.join(' · ');
  }

  // A short preview of what a screen shows.
  function previewOf(screen) {
    var s = screen.step;
    if (screen.kind === 'ask') return '“' + shorten(s.question, 140) + '”';
    if (screen.kind === 'questions') return 'First: ' + shorten(s.questions[0].q, 120);
    if (screen.kind === 'task') return has(s.instructions) ? shorten(s.instructions, 120) : 'First: ' + shorten(s.tasks[0].task, 120);
    if (has(s.heading)) return shorten(s.heading, 120);
    if (has(s.points)) return shorten(s.points[0], 120);
    if (has(s.say)) return shorten(s.say, 120);
    if (has(s.examples)) return shorten(s.examples[0].question || s.examples[0].answer, 120);
    return '';
  }

  /*
   * What the Up next panel shows on screen i:
   *   { title, detail, preview, isEnd }
   * On the last step it describes the end screen; on the end screen itself it returns null
   * (the panel then shows the class's next lesson instead).
   */
  function upNext(screens, i) {
    var next = screens[i + 1];
    if (!next) return null;
    if (next.kind === 'end') return { title: 'End of lesson', detail: 'Mark as taught', preview: '', isEnd: true };
    return { title: next.stage, detail: detailOf(next), preview: previewOf(next), isEnd: false };
  }

  // Keeps a remembered position inside the lesson (lessons can get shorter when updated).
  function clampIndex(screens, i) {
    if (!(i >= 0)) return 0;
    return Math.min(Math.floor(i), screens.length - 1);
  }

  var Steps = { kindOf: kindOf, build: build, upNext: upNext, detailOf: detailOf, previewOf: previewOf, shorten: shorten, clampIndex: clampIndex };

  if (typeof module !== 'undefined' && module.exports) module.exports = Steps;
  else root.Steps = Steps;
})(this);
