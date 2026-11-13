/*
 * ui.js — small shared pieces used by several screens:
 * building elements safely, brief notices ("toasts") and the confirmation dialog.
 */
(function (root) {
  'use strict';

  // Builds an element. Text is always set as text, never as HTML.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // Fixed icon markup only — never pass user data here.
  function icon(markup) {
    var wrap = document.createElement('span');
    wrap.innerHTML = markup;
    return wrap.firstChild;
  }

  var ICONS = {
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };

  var toastTimer = null;
  function toast(message) {
    var t = document.getElementById('toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /*
   * Asks the user to confirm something that removes or changes saved data.
   * options: { title, message, confirmLabel }
   * Resolves true if confirmed, false if cancelled.
   */
  function confirmAction(options) {
    var box = document.getElementById('confirm');
    var ok = document.getElementById('confirm-ok');
    var cancel = document.getElementById('confirm-cancel');
    document.getElementById('confirm-title').textContent = options.title;
    document.getElementById('confirm-msg').textContent = options.message;
    ok.textContent = options.confirmLabel || 'Confirm';
    box.hidden = false;
    cancel.focus();
    return new Promise(function (resolve) {
      function finish(answer) {
        box.hidden = true;
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        box.removeEventListener('click', onBackdrop);
        resolve(answer);
      }
      function onOk() { finish(true); }
      function onCancel() { finish(false); }
      function onBackdrop(e) { if (e.target === box) finish(false); }
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      box.addEventListener('click', onBackdrop);
    });
  }

  root.UI = { el: el, icon: icon, ICONS: ICONS, toast: toast, confirm: confirmAction };
})(this);
