/*
 * home.js — draws the Home Screen: the Today widget, the small "next" card
 * and the timetable panel. It reads from the clock and the saved data and
 * never changes anything.
 */
(function (root) {
  'use strict';

  var S = root.Schedule;

  // Builds an element. Text is always set as text, never as HTML.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function svg(markup) {
    var wrap = document.createElement('span');
    wrap.innerHTML = markup; // fixed icon markup only, never user data
    return wrap.firstChild;
  }

  var TICK = '<svg class="tick" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Done"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var DONE_CIRCLE = '<svg class="end-icon" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clockText(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function dateText(d) {
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function minutesText(mins) {
    if (mins < 60) return 'in ' + mins + ' min';
    var h = Math.floor(mins / 60), m = mins % 60;
    return 'in ' + h + ' hr' + (m ? ' ' + m + ' min' : '');
  }

  function lessonLine(lesson) { return lesson.className + ' · ' + lesson.subject; }

  // What this class will be taught next, from its scheme of work:
  // { text, lessonId|null, reason|null }. reason explains why there is nothing to open.
  function nextLessonFor(classId, data) {
    var p = data.progress && data.progress[classId];
    if (!p) return { text: 'No scheme of work set', lessonId: null, reason: 'This class has no scheme of work yet. Set one in Timetable › Classes.' };
    var lesson = (data.lessons || []).filter(function (l) { return l.schemeId === p.schemeId && l.position === p.position; })[0];
    if (!lesson) return { text: 'Lesson ' + p.position + ' · not imported yet', lessonId: null, reason: 'Lesson ' + p.position + ' is not on this iPad yet. Import it from Timetable › Lessons.' };
    return { text: 'Lesson ' + p.position + ' · ' + lesson.title, lessonId: lesson.id, reason: null };
  }

  // ---------- Today widget ----------

  function renderLessonCard(card, kind, lesson, rightText, data) {
    card.className = 'today-card ' + (kind === 'now' ? 'is-now' : 'is-next');
    var top = el('div', 'today-top');
    var label = el('div', 'today-label');
    label.appendChild(el('span', 'tag', (kind === 'now' ? 'NOW' : 'UP NEXT') + ' · PERIOD ' + lesson.periodNumber));
    label.appendChild(el('span', 'when', rightText));
    top.appendChild(label);
    top.appendChild(el('h2', 'today-class', lesson.className));
    top.appendChild(el('span', 'today-subject', lesson.subject));
    var next = nextLessonFor(lesson.classId, data);
    top.appendChild(el('span', 'today-lesson' + (next.lessonId ? '' : ' is-missing'), next.text));
    top.appendChild(el('span', 'today-period', lesson.start + '–' + lesson.end));
    card.appendChild(top);
    var btn = el('button', 'open-lesson' + (next.lessonId ? '' : ' is-unavailable'), 'OPEN LESSON');
    btn.type = 'button';
    btn.setAttribute('data-action', 'open-lesson');
    btn.setAttribute('data-class', lesson.classId);
    if (next.lessonId) btn.setAttribute('data-lesson', next.lessonId);
    else btn.setAttribute('data-reason', next.reason);
    card.appendChild(btn);
  }

  function renderEndCard(card, status, now) {
    card.className = 'today-card is-end';
    card.appendChild(svg(DONE_CIRCLE));
    var weekend = now.getDay() === 0 || now.getDay() === 6;
    var title;
    if (status.reason === 'finished') title = "That's all your lessons for today.";
    else if (weekend) title = 'No lessons this weekend.';
    else title = 'No lessons today.';
    var detail;
    var n = status.nextLesson;
    if (n) {
      detail = 'Your next lesson is ' + n.whenLabel + ', Period ' + n.periodNumber + ' at ' + n.start + ': ' + lessonLine(n) + '.';
    } else {
      title = 'Your timetable is empty.';
      detail = 'Open the timetable to add your classes and lessons. They will appear here automatically.';
    }
    card.appendChild(el('h2', 'end-title', title));
    card.appendChild(el('p', 'end-detail', detail));
  }

  function renderFollowCard(card, label, lesson) {
    card.textContent = '';
    if (!lesson) { card.hidden = true; return; }
    card.hidden = false;
    card.appendChild(el('span', 'eyebrow', label + ' · PERIOD ' + lesson.periodNumber + ' · ' + lesson.start));
    card.appendChild(el('span', 'follow-text', lessonLine(lesson)));
  }

  // ---------- timetable panel ----------

  // Which day the panel shows: today on a weekday, otherwise the next Monday.
  function panelDay(now) {
    var d = now.getDay();
    if (d >= 1 && d <= 5) return { weekday: d, isToday: true, title: 'TIMETABLE' };
    return { weekday: 1, isToday: false, title: 'MONDAY' };
  }

  function renderPanel(rows, titleEl, now, status, data) {
    var day = panelDay(now);
    titleEl.textContent = day.title;
    rows.textContent = '';
    var nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    S.PERIODS.forEach(function (p, i) {
      var slot = data.timetable[day.weekday] ? data.timetable[day.weekday][i] : null;
      var lesson = S.resolveSlot(slot, data.classes);
      var row = el('span', 'tt-row');
      if (!lesson) row.classList.add('is-free');
      if (day.isToday) {
        if (status.periodIndexNow === i) row.classList.add('is-current');
        else if (nowMin >= S.toMinutes(p.end)) row.classList.add('is-past');
        if (status.state === 'next' && status.lesson.periodIndex === i) row.classList.add('is-next');
      }
      row.appendChild(el('span', 'p', p.label));
      var body = el('span', 'body');
      body.appendChild(el('span', 'what', lesson ? lessonLine(lesson) : 'Free'));
      var timeText = p.start;
      if (day.isToday && status.periodIndexNow === i) timeText += lesson ? ' · Now' : ' · Free now';
      if (day.isToday && status.state === 'next' && status.lesson.periodIndex === i) timeText += ' · Next';
      body.appendChild(el('span', 'time', timeText));
      row.appendChild(body);
      if (lesson && row.classList.contains('is-past')) row.appendChild(svg(TICK));
      rows.appendChild(row);
    });
  }

  // ---------- whole screen ----------

  function render(now, data) {
    var status = S.getTodayStatus(now, data.timetable, data.classes);

    document.getElementById('home-date').textContent = dateText(now);
    var clock = document.getElementById('home-clock');
    clock.textContent = clockText(now);
    clock.setAttribute('datetime', now.toISOString());

    var card = document.getElementById('today-card');
    var follow = document.getElementById('follow-card');
    card.textContent = '';

    if (status.state === 'now') {
      renderLessonCard(card, 'now', status.lesson, 'Ends ' + status.endsAt, data);
      renderFollowCard(follow, 'NEXT', status.nextToday);
    } else if (status.state === 'next') {
      renderLessonCard(card, 'next', status.lesson, 'Starts ' + status.startsAt + ' · ' + minutesText(status.minutesUntil), data);
      renderFollowCard(follow, 'THEN', status.afterThat);
    } else {
      renderEndCard(card, status, now);
      renderFollowCard(follow, '', null);
    }

    renderPanel(document.getElementById('tt-rows'), document.getElementById('tt-panel-title'), now, status, data);
    return status;
  }

  root.Home = { render: render, minutesText: minutesText, nextLessonFor: nextLessonFor };
})(this);
