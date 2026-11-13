/*
 * steps.test.js — checks for js/steps.js: how a lesson becomes prompter screens and Up next text.
 * Uses the real Year 12 hexadecimal lesson in tests/fixtures as well as small made-up lessons.
 */
(function (root) {
  'use strict';

  var Steps = root.Steps;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function eq(actual, expected, what) {
    if (actual !== expected) throw new Error((what || 'value') + ': expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
  }
  function ok(cond, what) { if (!cond) throw new Error(what); }
  function rec(steps) { return { lesson: { steps: steps } }; }

  var hex = null;
  function loadHex() {
    if (hex) return Promise.resolve(hex);
    return root.fetch('tests/fixtures/y12-001-hexadecimal.json').then(function (r) { return r.json(); })
      .then(function (d) { hex = { lesson: d.lesson }; return hex; });
  }

  test('Card layout comes from what a step contains, never from its stage name', function () {
    eq(Steps.kindOf({ stage: 'We Do', question: 'Q?', answer: 'A' }), 'ask', 'one question');
    eq(Steps.kindOf({ stage: 'I Do', question: 'Q?', answer: 'A' }), 'ask', 'one question named I Do');
    eq(Steps.kindOf({ stage: 'Do Now', questions: [{ q: 'Q', a: 'A' }] }), 'questions', 'several questions');
    eq(Steps.kindOf({ stage: 'You Do', tasks: [{ task: 'T' }] }), 'task', 'tasks');
    eq(Steps.kindOf({ stage: 'Silent work', instructions: 'Work alone.' }), 'task', 'instructions only');
    eq(Steps.kindOf({ stage: 'Check for understanding', heading: 'Recap', say: 'Text.' }), 'explain', 'explanation named like a check');
  });

  test('Screens follow the file order exactly, stages may repeat, and an end screen is added', function () {
    var screens = Steps.build(rec([
      { stage: 'I Do', heading: 'A' }, { stage: 'We Do', question: 'Q?', answer: 'A' }, { stage: 'I Do', say: 'B' }
    ]));
    eq(screens.length, 4, 'screens');
    eq(screens.map(function (s) { return s.stage; }).join(','), 'I Do,We Do,I Do,End of lesson', 'stages');
    eq(screens.map(function (s) { return s.kind; }).join(','), 'explain,ask,explain,end', 'layouts');
  });

  test('Up next names the next stage, its board, what is in it and a preview', function () {
    var screens = Steps.build(rec([
      { stage: 'Explanation', board: 4, heading: 'Place values' },
      { stage: 'Check for understanding', board: 4, question: 'Why does adding more characters make a password harder to brute-force?', answer: 'A' },
      { stage: 'Your turn', board: 13, answerBoard: 14, minutes: 5, questions: [{ q: 'Convert 01111100 to hexadecimal.', a: '7C' }, { q: 'Q2', a: 'A2' }] },
      { stage: 'Independent practice', board: 27, minutes: 25, instructions: 'Work on your own.', tasks: [{ task: 'T1' }, { task: 'T2' }, { task: 'T3' }] }
    ]));
    var n = Steps.upNext(screens, 0);
    eq(n.title, 'Check for understanding', 'title after step 1');
    eq(n.detail, 'Board 4 · ask before moving on', 'detail after step 1');
    eq(n.preview, '“Why does adding more characters make a password harder to brute-force?”', 'preview after step 1');
    n = Steps.upNext(screens, 1);
    eq(n.title, 'Your turn', 'title after step 2');
    eq(n.detail, 'Board 13 · 2 questions · about 5 min', 'detail after step 2');
    eq(n.preview, 'First: Convert 01111100 to hexadecimal.', 'preview after step 2');
    n = Steps.upNext(screens, 2);
    eq(n.detail, 'Board 27 · 3 tasks · about 25 min', 'detail after step 3');
    eq(n.preview, 'Work on your own.', 'preview after step 3');
  });

  test('On the last step Up next is the end of the lesson; on the end screen there is no Up next', function () {
    var screens = Steps.build(rec([{ stage: 'Plenary', heading: 'Summary' }]));
    var n = Steps.upNext(screens, 0);
    eq(n.isEnd, true, 'end flagged');
    eq(n.title, 'End of lesson', 'title');
    eq(Steps.upNext(screens, 1), null, 'nothing after the end screen');
  });

  test('Long previews are shortened at a word, with an ellipsis', function () {
    var t = Steps.shorten('one two three four five six seven eight nine ten', 20);
    ok(t.length <= 21, 'too long: ' + t);
    eq(t.slice(-1), '…', 'ellipsis');
    ok(t.indexOf('  ') === -1, 'double spaces');
    eq(Steps.shorten('short', 20), 'short', 'short text unchanged');
  });

  test('A remembered step outside a shorter, updated lesson is brought back inside it', function () {
    var screens = Steps.build(rec([{ stage: 'A', heading: 'a' }, { stage: 'B', heading: 'b' }]));
    eq(Steps.clampIndex(screens, 7), 2, 'beyond the end');
    eq(Steps.clampIndex(screens, -1), 0, 'negative');
    eq(Steps.clampIndex(screens, undefined), 0, 'missing');
    eq(Steps.clampIndex(screens, 1), 1, 'inside');
  });

  test('The Year 12 hexadecimal lesson becomes 20 screens plus the end screen, in board order', function () {
    if (!root.fetch) return;
    return loadHex().then(function (l) {
      var screens = Steps.build(l);
      eq(screens.length, 21, 'screens');
      eq(screens[0].stage, 'Do Now', 'first stage');
      eq(screens[0].kind, 'questions', 'Do Now layout');
      eq(screens[0].answerBoard, 2, 'Do Now answers board');
      eq(screens[19].stage, 'Independent practice', 'last stage');
      eq(screens[19].kind, 'task', 'practice layout');
      eq(screens[20].kind, 'end', 'end screen');
      var boards = screens.filter(function (s) { return s.board; }).map(function (s) { return s.board; });
      ok(boards.every(function (b, i) { return i === 0 || b > boards[i - 1]; }), 'boards are not in order: ' + boards.join(','));
      var n = Steps.upNext(screens, 10);
      eq(n.title, 'Worked examples', 'up next after the first Your turn');
      eq(n.detail, 'Board 15', 'its detail');
      eq(n.preview, 'Hexadecimal to binary', 'its preview');
      eq(Steps.upNext(screens, 18).detail, 'Board 27 · 19 tasks · about 25 min', 'up next before independent practice');
    });
  });

  function runAll() {
    var results = [];
    return tests.reduce(function (chain, t) {
      return chain.then(function () {
        return Promise.resolve().then(t.fn).then(
          function () { results.push({ name: t.name, passed: true }); },
          function (e) { results.push({ name: t.name, passed: false, error: e && e.message ? e.message : String(e) }); });
      });
    }, Promise.resolve()).then(function () { return results; });
  }

  root.StepsTests = { runAll: runAll };
})(this);
