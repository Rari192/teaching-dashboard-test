/*
 * lesson.js — the lesson prompter: one step of a lesson at a time, in large type.
 *
 * Opened at  #lesson?l=<lesson id>&c=<class id>   (c is left out for a preview with no class)
 *            optionally &from=lessons, so the close button goes back to the Lessons screen.
 * The lesson file decides the order and the stage names; steps.js decides each card's layout.
 * The app remembers which step each class is on, so a locked iPad reopens in the same place.
 * At the end, "Mark as taught" moves only this class to its next lesson, and only if the class
 * is still on this lesson.
 */
(function (root) {
  'use strict';

  var el = root.UI.el;
  var host = null;
  var state = null;   // { lesson, cls, progress, scheme, screens, index, from }

  function $(id) { return document.getElementById(id); }

  // ---------- opening ----------

  function params() {
    var hash = location.hash || '';
    var q = hash.indexOf('?') === -1 ? '' : hash.slice(hash.indexOf('?') + 1);
    var out = {};
    q.split('&').forEach(function (pair) {
      if (!pair) return;
      var bits = pair.split('=');
      out[decodeURIComponent(bits[0])] = decodeURIComponent(bits.slice(1).join('=') || '');
    });
    return out;
  }

  // The address that opens a lesson, for the Today card and the Lessons screen.
  function address(lessonId, classId, from) {
    return '#lesson?l=' + encodeURIComponent(lessonId) + (classId ? '&c=' + encodeURIComponent(classId) : '') + (from ? '&from=' + from : '');
  }

  function show() {
    var p = params();
    var data = host.data();
    var lesson = data.lessons.filter(function (l) { return l.id === p.l; })[0] || null;
    if (!lesson || !Array.isArray(lesson.lesson.steps)) {
      state = null;
      renderMissing(!!lesson);
      return Promise.resolve();
    }
    var cls = p.c ? data.classes.filter(function (c) { return c.id === p.c; })[0] || null : null;
    state = {
      lesson: lesson,
      cls: cls,
      progress: cls ? data.progress[cls.id] || null : null,
      scheme: data.schemes.filter(function (s) { return s.id === lesson.schemeId; })[0] || null,
      screens: root.Steps.build(lesson),
      index: 0,
      from: p.from || ''
    };
    $('lesson-missing').hidden = true;
    $('lesson-main').hidden = false;
    return host.store().getOpenStep(cls ? cls.id : null, lesson.id, lesson.version).then(function (i) {
      if (!state || state.lesson !== lesson) return;
      state.index = root.Steps.clampIndex(state.screens, i);
      render();
    });
  }

  // oldFormat: the lesson is saved but was imported in the old file format (before steps).
  function renderMissing(oldFormat) {
    $('lesson-main').hidden = true;
    $('lesson-missing').hidden = false;
    $('ls-missing-title').textContent = oldFormat ? 'This lesson is in the old file format' : 'This lesson is not on this iPad';
    $('ls-missing-text').textContent = oldFormat
      ? 'Delete it from the Lessons screen, then make the lesson file again with the current instructions and import it.'
      : 'It may have been deleted or replaced. Import it again from the Lessons screen.';
  }

  function close() {
    var from = state && state.from;
    closeSheet();
    location.hash = from === 'lessons' ? 'lessons' : '';
  }

  // ---------- moving ----------

  function go(delta) {
    if (!state) return;
    var i = state.index + delta;
    if (i < 0 || i >= state.screens.length) return;
    state.index = i;
    render();
    $('ls-card-scroll').scrollTop = 0;
    host.store().setOpenStep(state.cls ? state.cls.id : null, state.lesson.id, state.lesson.version, i).catch(function () {});
  }

  // ---------- drawing ----------

  function yearName() { return state.scheme ? 'Year ' + state.scheme.yearGroup : state.lesson.schemeId; }

  function renderHeader() {
    var l = state.lesson;
    var bits = [state.cls ? state.cls.name : 'Preview', yearName(), 'Lesson ' + l.position];
    if (l.type) bits.push(l.type);
    $('ls-eyebrow').textContent = bits.join(' · ');
    $('ls-title').textContent = l.title;
    $('ls-objective').textContent = 'Objective: ' + (l.lesson.objective || '');
    $('ls-vocab').hidden = !(l.lesson.vocabulary && l.lesson.vocabulary.length);
    $('ls-misc').hidden = !(l.lesson.misconceptions && l.lesson.misconceptions.length);
    $('ls-res').hidden = !(l.lesson.resources && l.lesson.resources.length);
  }

  function renderStageRow(screen) {
    $('ls-stage').textContent = screen.stage;
    var dots = $('ls-dots');
    dots.textContent = '';
    var count = state.screens.length - 1; // the end screen has no dot
    for (var i = 0; i < count; i++) {
      dots.appendChild(el('i', i < state.index ? 'past' : i === state.index ? 'on' : ''));
    }
    // The teaching target is set on a settings screen that does not exist yet.
    $('ls-target').hidden = true;
  }

  function tagRow(screen) {
    var row = el('div', 'ls-tags');
    if (screen.board) row.appendChild(el('span', 'ls-board', 'BOARD ' + screen.board));
    if (screen.kind === 'ask') row.appendChild(el('span', 'ls-ask', 'ASK NOW'));
    var s = screen.step;
    if (s && s.note) row.appendChild(el('span', 'ls-note', s.note));
    if (s && s.minutes) row.appendChild(el('span', 'ls-note', s.minutes + ' min'));
    if (screen.answerBoard) row.appendChild(el('span', 'ls-note ls-answers-on', 'Answers: Board ' + screen.answerBoard));
    return row.childNodes.length ? row : null;
  }

  function addText(box, tag, cls, text) { if (text) box.appendChild(el(tag, cls, text)); }

  function renderExamples(box, examples) {
    (examples || []).forEach(function (ex) {
      var e = el('div', 'ls-example');
      if (ex.label) e.appendChild(el('span', 'ls-ex-label', ex.label));
      var grid = el('div', 'ls-ex-grid');
      if (ex.question) { grid.appendChild(el('span', 'k', 'QUESTION')); grid.appendChild(el('span', '', ex.question)); }
      if (ex.working && ex.working.length) {
        grid.appendChild(el('span', 'k', 'WORKING'));
        var w = el('span', 'ls-working');
        ex.working.forEach(function (line) { w.appendChild(el('span', '', line)); });
        grid.appendChild(w);
      }
      if (ex.answer) { grid.appendChild(el('span', 'k', 'ANSWER')); grid.appendChild(el('span', 'ans', ex.answer)); }
      e.appendChild(grid);
      box.appendChild(e);
    });
  }

  function renderExplain(box, s) {
    addText(box, 'h2', 'ls-heading', s.heading);
    if (s.say) { box.appendChild(el('span', 'ls-label', 'SAY')); box.appendChild(el('p', 'ls-say', s.say)); }
    if (s.points && s.points.length) {
      // Points that are already numbered ("1. Split…") are shown without bullets.
      var numbered = s.points.every(function (pt) { return /^\s*\d+[.)]\s/.test(pt); });
      var ul = el('ul', 'ls-points' + (numbered ? ' is-numbered' : ''));
      s.points.forEach(function (pt) { ul.appendChild(el('li', '', pt)); });
      box.appendChild(ul);
    }
    renderExamples(box, s.examples);
    if (s.code) box.appendChild(el('pre', 'ls-code', s.code));
  }

  function renderAsk(box, s) {
    addText(box, 'span', 'ls-pre-heading', s.heading);
    box.appendChild(el('p', 'ls-question', s.question));
    var a = el('div', 'ls-answer');
    a.appendChild(el('span', 'ls-label ls-label-accent', 'EXPECTED ANSWER'));
    a.appendChild(el('p', '', s.answer));
    box.appendChild(a);
    renderExamples(box, s.examples);
  }

  function renderQuestions(box, s) {
    addText(box, 'h2', 'ls-heading', s.heading);
    addText(box, 'p', 'ls-say ls-say-small', s.say);
    var list = el('ol', 'ls-qlist');
    s.questions.forEach(function (q) {
      var li = el('li');
      li.appendChild(el('span', 'ls-qlabel', q.label || ''));
      var body = el('span', 'ls-qbody');
      body.appendChild(el('span', 'ls-q', q.q));
      body.appendChild(el('span', 'ls-a', q.a));
      li.appendChild(body);
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  function renderTask(box, s) {
    addText(box, 'h2', 'ls-heading', s.heading);
    if (s.instructions) box.appendChild(el('p', 'ls-instructions', s.instructions));
    var tasks = s.tasks || [];
    // The boards showing a section's answers, named once in the section heading.
    function boardsFor(section) {
      var seen = [];
      tasks.forEach(function (t) { if (t.section === section && t.answerBoard && seen.indexOf(t.answerBoard) === -1) seen.push(t.answerBoard); });
      return seen;
    }
    var lastSection = null;
    var list = null;
    tasks.forEach(function (t) {
      if (t.section !== lastSection || !list) {
        if (t.section) {
          var h = el('h3', 'ls-section', t.section);
          var boards = boardsFor(t.section);
          if (boards.length) h.appendChild(el('span', 'ls-section-board', (boards.length === 1 ? 'Answers on Board ' : 'Answers on Boards ') + boards.join(' and ')));
          box.appendChild(h);
        }
        list = el('ol', 'ls-tasks');
        box.appendChild(list);
        lastSection = t.section;
      }
      var li = el('li');
      li.appendChild(el('span', 'ls-qlabel', t.label || ''));
      var body = el('span', 'ls-qbody');
      body.appendChild(el('span', 'ls-q', t.task + (t.marks ? ' [' + t.marks + (t.marks === 1 ? ' mark]' : ' marks]') : '')));
      if (t.answer) body.appendChild(el('span', 'ls-a', t.answer));
      if (t.answerBoard && !t.section) body.appendChild(el('span', 'ls-a-board', 'Answer on Board ' + t.answerBoard));
      li.appendChild(body);
      list.appendChild(li);
    });
    if (s.extension) {
      box.appendChild(el('h3', 'ls-section', 'Extension'));
      var ex = el('div', 'ls-qbody ls-extension');
      ex.appendChild(el('span', 'ls-q', s.extension.task));
      if (s.extension.answer) ex.appendChild(el('span', 'ls-a', s.extension.answer));
      box.appendChild(ex);
    }
  }

  // The class's next lesson after this one, for the end screen.
  function nextLessonText() {
    var l = state.lesson;
    var next = host.data().lessons.filter(function (x) { return x.schemeId === l.schemeId && x.position === l.position + 1; })[0];
    return { title: 'Lesson ' + (l.position + 1) + (next ? ' · ' + next.title : ''), detail: next ? (next.topic || '') : 'Not imported yet' };
  }

  // Can this class be marked as taught for this lesson? Returns null if yes, or the reason why not.
  function cannotMark() {
    var l = state.lesson;
    if (!state.cls) return 'This is a preview. Open the lesson from the Today screen to mark it as taught for a class.';
    var p = host.data().progress[state.cls.id];
    if (!p || p.schemeId !== l.schemeId) return state.cls.name + ' does not follow ' + yearName() + '. Set its scheme of work in Classes.';
    if (p.position !== l.position) return state.cls.name + ' is on Lesson ' + p.position + ', not Lesson ' + l.position + ', so this lesson cannot be marked as taught for it.';
    return null;
  }

  function renderEnd(box) {
    var l = state.lesson;
    box.appendChild(el('span', 'eyebrow', 'End of lesson'));
    var reason = cannotMark();
    if (reason) {
      box.appendChild(el('h2', 'ls-end-title', 'End of Lesson ' + l.position));
      box.appendChild(el('p', 'ls-end-text', reason));
      return;
    }
    var name = state.cls.name;
    var nxt = nextLessonText();
    box.appendChild(el('h2', 'ls-end-title', 'Did ' + name + ' finish Lesson ' + l.position + '?'));
    var p = el('p', 'ls-end-text');
    p.appendChild(document.createTextNode('Marking it as taught moves ' + name + ' on to '));
    p.appendChild(el('b', '', nxt.title));
    p.appendChild(document.createTextNode('. If you didn’t finish, just close the lesson. Lesson ' + l.position + ' stays next for ' + name + '.'));
    box.appendChild(p);
    var b = el('button', 'ls-taught', 'Mark Lesson ' + l.position + ' as taught');
    b.type = 'button';
    b.id = 'ls-taught';
    box.appendChild(b);
  }

  function renderCard(screen) {
    var card = $('ls-card');
    var box = $('ls-card-scroll');
    box.textContent = '';
    card.className = 'step ls-card is-' + screen.kind;
    if (screen.kind !== 'end') {
      var tags = tagRow(screen);
      if (tags) box.appendChild(tags);
    }
    if (screen.kind === 'explain') renderExplain(box, screen.step);
    else if (screen.kind === 'ask') renderAsk(box, screen.step);
    else if (screen.kind === 'questions') renderQuestions(box, screen.step);
    else if (screen.kind === 'task') renderTask(box, screen.step);
    else renderEnd(box);
    $('ls-back').hidden = state.index === 0;
    updateFade();
  }

  // A soft fade at the bottom of the card whenever there is more to scroll to.
  function updateFade() {
    var box = $('ls-card-scroll');
    var more = box.scrollHeight - box.scrollTop - box.clientHeight > 4;
    var card = $('ls-card');
    card.classList.toggle('has-more', more);
    // Sit the fade on the bottom edge of the scrolling area, whatever is below it.
    card.style.setProperty('--fade-bottom', (card.clientHeight - box.offsetTop - box.clientHeight) + 'px');
  }

  function renderNext(screen) {
    var panel = $('ls-next');
    panel.textContent = '';
    var n = root.Steps.upNext(state.screens, state.index);
    if (!n) {
      // End screen: show where the class goes next. Not a button.
      panel.className = 'next is-quiet';
      panel.disabled = true;
      var nxt = nextLessonText();
      panel.appendChild(el('span', 'eyebrow', state.cls ? 'Next for ' + state.cls.name : 'Next in ' + yearName()));
      panel.appendChild(el('span', 'what', nxt.title));
      panel.appendChild(el('span', 'detail', nxt.detail));
      return;
    }
    panel.className = 'next' + (n.isEnd ? ' is-end' : '');
    panel.disabled = false;
    panel.appendChild(el('span', 'eyebrow', 'Up next'));
    panel.appendChild(el('span', 'what', n.title));
    if (n.detail) panel.appendChild(el('span', 'detail', n.detail));
    if (n.preview) panel.appendChild(el('span', 'preview', n.preview));
    panel.appendChild(el('span', 'arrow', 'Next ›'));
  }

  function render() {
    if (!state) return;
    var screen = state.screens[state.index];
    renderHeader();
    renderStageRow(screen);
    renderCard(screen);
    renderNext(screen);
  }

  // ---------- mark as taught ----------

  function markTaught() {
    if (!state || cannotMark()) return;
    var cls = state.cls;
    var l = state.lesson;
    var btn = $('ls-taught');
    btn.disabled = true;
    host.store().markTaught(cls.id, l.position).then(function (p) {
      return host.reload().then(function () { return p; });
    }).then(function (p) {
      root.UI.toast(cls.name + ' moves on to Lesson ' + p.position + '.');
      location.hash = '';
    }, function (err) {
      btn.disabled = false;
      root.UI.toast((err && err.message ? err.message : 'Not saved.') + ' Nothing has been changed.');
    });
  }

  // ---------- notes sheet: vocabulary, misconceptions, resources ----------

  function openSheet(kind) {
    var l = state.lesson.lesson;
    var list = $('ls-sheet-list');
    list.textContent = '';
    var title;
    if (kind === 'vocab') {
      title = 'Vocabulary';
      l.vocabulary.forEach(function (v) {
        var row = el('div', 'ls-sheet-row');
        row.appendChild(el('span', 'ls-sheet-term', v.term));
        row.appendChild(el('span', 'ls-sheet-text', v.meaning));
        list.appendChild(row);
      });
    } else if (kind === 'misc') {
      title = 'Misconceptions';
      l.misconceptions.forEach(function (m) {
        var row = el('div', 'ls-sheet-row');
        row.appendChild(el('span', 'ls-sheet-wrong', m.wrong));
        row.appendChild(el('span', 'ls-sheet-text', m.correction));
        list.appendChild(row);
      });
    } else {
      title = 'Resources';
      l.resources.forEach(function (r) {
        var row = el('div', 'ls-sheet-row');
        row.appendChild(el('span', 'ls-sheet-term', r.name));
        if (r.note) row.appendChild(el('span', 'ls-sheet-text', r.note));
        list.appendChild(row);
      });
    }
    $('ls-sheet-title').textContent = title;
    $('lesson-sheet').hidden = false;
    $('ls-sheet-close').focus({ preventScroll: true });
  }

  function closeSheet() { $('lesson-sheet').hidden = true; }

  // ---------- wiring ----------

  function wire() {
    $('ls-close').addEventListener('click', close);
    $('ls-card-scroll').addEventListener('scroll', updateFade, { passive: true });
    window.addEventListener('resize', function () { if (state) updateFade(); });
    $('ls-missing-back').addEventListener('click', close);
    $('ls-next').addEventListener('click', function () { go(1); });
    $('ls-back').addEventListener('click', function () { go(-1); });
    $('ls-card').addEventListener('click', function (e) { if (e.target.closest('#ls-taught')) markTaught(); });
    $('ls-vocab').addEventListener('click', function () { openSheet('vocab'); });
    $('ls-misc').addEventListener('click', function () { openSheet('misc'); });
    $('ls-res').addEventListener('click', function () { openSheet('res'); });
    $('ls-sheet-close').addEventListener('click', closeSheet);
    $('lesson-sheet').addEventListener('click', function (e) { if (e.target === $('lesson-sheet')) closeSheet(); });

    // Swipe left for the next step, right to go back. Vertical scrolling is left alone.
    var startX = null, startY = null;
    var area = $('lesson-main');
    area.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { startX = null; return; }
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    }, { passive: true });
    area.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      startX = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      go(dx < 0 ? 1 : -1);
    }, { passive: true });

    // Arrow keys, for a keyboard (on the Mac, for example).
    document.addEventListener('keydown', function (e) {
      if ($('screen-lesson').hidden || !$('lesson-sheet').hidden) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    });
  }

  root.Lesson = {
    init: function (h) { host = h; wire(); },
    show: show,
    leave: function () { closeSheet(); return Promise.resolve(); },
    address: address
  };
})(this);
