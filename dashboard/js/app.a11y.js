// ── A11Y: keyboard reachability for clickable non-button elements ────────────
//
// The portal renders 77 clickable <div>/<span>/<tr> elements with inline onclick and
// NOT ONE of them carried a tabindex, so none could be reached by keyboard at all.
// The :focus-visible ring shipped earlier only helps things you can focus; these you
// could not. This module makes them reachable and operable without touching a single
// render site — everything is applied by observation, so new markup is covered the
// moment it renders.
//
// ⚠ Modal focus traps are NOT here. app.sales.js already implements a complete one
//   (role=dialog + aria-modal, focus on open, Tab cycling, Esc -> .modal-close, focus
//   restore). Its focusable() selector includes [tabindex]:not([tabindex="-1"]), so
//   the elements this file promotes join that cycle automatically.
//
// ⚠⚠ TABLE ROWS ARE DELIBERATELY NOT PLAIN TAB STOPS. Five tables render one clickable
//   <tr> per record (fiber installs, two LST leaderboards, two ticket queues). Giving
//   each row tabindex="0" would put HUNDREDS of stops between the table and whatever
//   follows it, and would double up with the DSI links already inside those rows. They
//   get the ARIA grid pattern instead: the table is ONE tab stop, arrows move between
//   rows, Enter activates. Cells keep their own links, which is what a keyboard user
//   expects in a table.
(function () {
  'use strict';

  // Elements the browser already makes focusable and operable on their own.
  var NATIVE = { A: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, SUMMARY: 1 };
  function isNative(el) { return NATIVE[el.tagName] === 1; }

  // A class ending in "-link" (dsi-link, appt-dsi-link) navigates rather than acts, so
  // it gets role=link. Per ARIA a link is Enter-only; a button takes Enter AND Space.
  function looksLikeLink(el) {
    var c = el.classList;
    for (var i = 0; i < c.length; i++) if (/-link$/.test(c[i])) return true;
    return false;
  }

  // ── 1. promote clickable non-native elements ───────────────────────────────
  function promoteOne(el) {
    var tag = el.tagName;
    if (isNative(el)) return;
    if (tag === 'TR' || tag === 'TD' || tag === 'TH') return;     // grid pass owns these
    if (el.hasAttribute('tabindex')) return;                       // author already decided
    el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', looksLikeLink(el) ? 'link' : 'button');
  }
  // ⚠⚠ querySelectorAll SEARCHES DESCENDANTS ONLY — it never returns the root itself.
  //   The app renders by assigning innerHTML to a container, so the clickable elements
  //   ARE the added nodes the observer hands us, not children of them. Checking only
  //   descendants promoted nothing on real markup while passing a synthetic fixture
  //   that happened to wrap its elements in a container. Always test the root too.
  function promote(root) {
    try {
      if (root.matches && root.matches('[onclick]')) promoteOne(root);
      var els = root.querySelectorAll('[onclick]');
      for (var i = 0; i < els.length; i++) promoteOne(els[i]);
    } catch (_) {}
  }

  // ── 2. roving tabindex for clickable table rows ────────────────────────────
  function rove(root) {
    var rows = [];
    try {
      // same root-vs-descendant trap as promote(): a re-rendered <tbody> hands us rows
      // whose own subtree contains none.
      if (root.matches && root.matches('tr[onclick]')) rows.push(root);
      rows = rows.concat(Array.prototype.slice.call(root.querySelectorAll('tr[onclick]')));
    } catch (_) { return; }
    var seen = [];
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].closest ? rows[i].closest('table') : null;
      if (!t || seen.indexOf(t) !== -1) continue;
      seen.push(t);
      var rs = t.querySelectorAll('tr[onclick]');
      // Re-seat the single stop only if the table has lost it (first render, or a
      // re-render that replaced the row that held it). Otherwise a background refresh
      // would yank the user's position back to row 0 mid-navigation.
      var hasStop = false;
      for (var k = 0; k < rs.length; k++) if (rs[k].getAttribute('tabindex') === '0') hasStop = true;
      for (var j = 0; j < rs.length; j++) {
        if (!rs[j].hasAttribute('tabindex') || !hasStop) {
          rs[j].setAttribute('tabindex', (!hasStop && j === 0) ? '0' : '-1');
        }
        if (!rs[j].hasAttribute('role')) rs[j].setAttribute('role', 'button');
      }
    }
  }

  function rowsOf(tr) {
    var t = tr.closest ? tr.closest('table') : null;
    return t ? Array.prototype.slice.call(t.querySelectorAll('tr[onclick]')) : [tr];
  }
  function moveRow(tr, delta, absolute) {
    var rs = rowsOf(tr), i = rs.indexOf(tr);
    if (i < 0) return;
    var next = absolute === 'first' ? 0
             : absolute === 'last'  ? rs.length - 1
             : Math.max(0, Math.min(rs.length - 1, i + delta));
    if (next === i) return;
    tr.setAttribute('tabindex', '-1');
    rs[next].setAttribute('tabindex', '0');
    rs[next].focus();
  }

  // ── 3. keyboard activation ─────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    var el = e.target;
    if (!el || !el.getAttribute || e.altKey || e.ctrlKey || e.metaKey) return;
    // Never hijack typing.
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return;
    if (!el.hasAttribute('onclick')) return;
    if (isNative(el)) return;                       // the browser already does this

    if (tag === 'TR') {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveRow(el, 1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); moveRow(el, -1); return; }
      if (e.key === 'Home')      { e.preventDefault(); moveRow(el, 0, 'first'); return; }
      if (e.key === 'End')       { e.preventDefault(); moveRow(el, 0, 'last'); return; }
    }
    var isLink = el.getAttribute('role') === 'link';
    // Space scrolls the page by default, so it must be prevented wherever it activates.
    if (e.key === 'Enter' || (!isLink && (e.key === ' ' || e.key === 'Spacebar'))) {
      e.preventDefault();
      el.click();
    }
  });

  // ── 4. apply to whatever is on screen, now and later ───────────────────────
  // Batched: the app rewrites whole panels via innerHTML, so a mutation burst is one
  // pass rather than one pass per node.
  // ⚠⚠ DO NOT BATCH THIS WITH requestAnimationFrame. rAF only fires while the page is
  //   PAINTING, so in a background tab (or headless) the callback never runs and nothing
  //   is ever promoted — the markup silently stays keyboard-unreachable until the tab is
  //   focused. Caught by the behavioural test, which reported zero errors and zero
  //   promotions. A microtask always runs; setTimeout is the fallback. (Also note rAF
  //   must be called bound to window, or it throws "Illegal invocation" — two separate
  //   traps in the same one-liner.)
  var defer = window.queueMicrotask
    ? window.queueMicrotask.bind(window)
    : function (fn) { return window.setTimeout(fn, 0); };

  var queued = false, roots = [];
  function flush() {
    queued = false;
    var list = roots; roots = [];
    for (var i = 0; i < list.length; i++) { promote(list[i]); rove(list[i]); }
  }
  function schedule(root) {
    roots.push(root);
    if (queued) return;
    queued = true;
    defer(flush);
  }

  function start() {
    schedule(document.body);
    // childList only — this never observes attributes, so setting tabindex/role here
    // cannot re-trigger the observer and loop.
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) schedule(added[j]);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
