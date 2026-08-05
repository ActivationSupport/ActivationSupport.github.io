/* ═══════════════════════════════════════════════════════════════════════════
   app.errors.js — stable error CODES + automatic error REPORTING
   ───────────────────────────────────────────────────────────────────────────
   Before this file the portal had NO global error handling at all: no
   window.onerror, no unhandledrejection, nothing. An uncaught exception left
   the rep looking at a half-rendered tab or a dead button, and nobody ever
   found out. The Bri'an Key apostrophe bug (2026-07-24) was exactly that
   shape — it took a rep complaint to surface a SyntaxError that had been
   killing the NOTES button for weeks.

   Three jobs:
     1. CLASSIFY  — every failure gets a short stable code (e.g. DATA-03) that
                    is rendered on screen. A rep can say the code instead of
                    describing the symptom, and codes are countable in a way
                    that a pile of screenshots never is.
     2. CAPTURE   — as much diagnostic context as we can take without shipping
                    customer data (see THE MASKING RULE below).
     3. REPORT    — queue it and send it to the backend when doing so is free.

   ⚠⚠ FOUR RULES THIS FILE MUST NEVER BREAK — each one is load-bearing:

   · THIS FILE MUST HAVE NO DEPENDENCIES. It loads FIRST, before app.core.js,
     precisely so it is alive when a later bundle fails. It therefore cannot
     call esc(), icon(), api() or anything else the app defines. Every helper
     it needs is inlined below. If you find yourself reaching for a shared
     helper here, you have broken the reason the file exists.

   · IT MUST NEVER THROW. A reporter that breaks the page is strictly worse
     than no reporter — it converts one broken tab into a broken portal, and
     it does it inside the handler that was supposed to tell us about the
     first fault. Every public entry point is wrapped in try/catch that
     swallows. There is no error path out of this file.

   · IT MUST NEVER COMPETE WITH THE MAIN BLOB. Apps Script SERIALISES
     concurrent requests from the same user — measured 2026-08-04, 4 concurrent
     6470ms vs 4 sequential 7406ms. Issuing order IS execution order. An error
     POST fired during load would sit in front of the request the visible tab
     is waiting on and make a bad situation measurably slower. Reports are
     queued and only flushed when the network is quiet (see _flushSoon).

   · IT MUST NOT USE requestAnimationFrame OR requestIdleCallback. rAF does not
     fire in a background tab at all (documented trap — zero errors AND zero
     effect is its signature), and rIC is throttled there. A rep who hits an
     error and switches tabs is the NORMAL case, not the edge case. Plain
     setTimeout only.

   ═══ THE MASKING RULE ═══
   The Master Tracker is full of customer names, phone numbers, addresses,
   DSIs and account numbers. None of that may leave the browser.

   So we mask VALUES but preserve SHAPE: letters become 'a', digits become
   '0', and PUNCTUATION IS KEPT AS-IS. "Bri'an Key" becomes "aaa'aa aaa" and
   "555-123-4567" becomes "000-000-0000".

   🔑 That preserved apostrophe is the whole point. The 2026-07-24 bug was
   CAUSED BY A CHARACTER IN THE DATA, so a snapshot that stripped punctuation
   would have hidden its own cause. Shape-preserving masking is what lets a
   snapshot answer "what was different about this row?" without telling us
   whose row it was.
   ═══════════════════════════════════════════════════════════════════════════ */

var AS_ERR = (function (w, d) {
  'use strict';

  /* ── THE CODE REGISTRY ────────────────────────────────────────────────────
     Codes are SHORT and SPEAKABLE — a rep reads one down a phone line. They
     are also PERMANENT: a code appears in the log, in a screenshot and in a
     conversation, so renumbering one silently invalidates history. Add new
     codes, never renumber existing ones.

     `hint` is what the rep sees under the message. It says what to do, not
     what went wrong — an error a user cannot act on is a dead end, which is
     the defect the 2026-08-04 empty-state pass existed to fix. */
  var CODES = {
    // AUTH — the badge/session layer. These must be reportable even though
    // they are themselves auth failures; see the backend note about
    // _PREAUTH_ACTIONS. If these could not report, we would be blind to
    // exactly the class of bug that is currently unexplained.
    'AUTH-01': { label: 'Your sign-in expired',        hint: 'Sign in again — nothing you did was lost.' },
    'AUTH-02': { label: 'Sign-in was refused',         hint: 'Tell an admin this code — your access may need updating.' },
    'AUTH-03': { label: 'Wrong office for this badge', hint: 'Switch back to your own office, or sign in again.' },

    // NET — we never got an answer.
    'NET-01': { label: 'No answer from the server', hint: 'Check your connection, then press Try again.' },
    'NET-02': { label: 'You appear to be offline',  hint: 'Reconnect and press Try again.' },
    'NET-03': { label: 'The server is busy',        hint: 'Wait a few seconds and press Try again — it is safe to retry.' },

    // DATA — we got an answer and could not use it.
    'DATA-01': { label: 'The server sent something we could not read', hint: 'Press Try again. If the code repeats, report it.' },
    'DATA-02': { label: 'This data did not load',                      hint: 'Press Try again.' },
    'DATA-03': { label: 'The server is running an older version',      hint: 'Report this code — the backend needs redeploying.' },

    // WRITE — a save. The did-it-save-or-not distinction is the important
    // one: it is the difference between safely retrying and creating a
    // duplicate, and it is why the transports classify rather than rethrow.
    'WRITE-01': { label: 'That did not save',        hint: 'Your details are still here — press Save again.' },
    'WRITE-02': { label: 'That may not have saved',  hint: 'Refresh and check before saving again, so you do not create a duplicate.' },

    // APP — our own bug. Always worth reporting.
    'APP-01': { label: 'Something went wrong on this screen', hint: 'Press Try again. This has been reported automatically.' },
    'APP-02': { label: 'Part of the portal failed to load',   hint: 'Do a hard refresh (Ctrl+Shift+R). This has been reported automatically.' }
  };

  var SESSION_MAX   = 20;   // total reports per page-load
  var PER_SIG_MAX   = 3;    // reports per identical signature
  var BREADCRUMBS   = 25;   // ring buffer size
  var SNAPSHOT_MAX  = 40000;// chars of masked markup
  var QUIET_MS      = 2500; // network must be idle this long before we flush

  var _queue = [], _sent = 0, _suppressed = 0, _sigCount = {}, _crumbs = [];
  var _inflight = 0, _lastNet = 0, _flushTimer = null, _endpoint = '', _installed = false;

  // ── inlined helpers (see the no-dependencies rule) ───────────────────────
  function _s(v) { try { return String(v == null ? '' : v); } catch (e) { return ''; } }
  function _clip(v, n) { var s = _s(v); return s.length > n ? s.slice(0, n) + '…[+' + (s.length - n) + ']' : s; }
  function _now() { return new Date().getTime(); }

  /* Shape-preserving mask — the heart of the masking rule above.
     Alphanumerics are flattened; everything else survives so that the
     STRUCTURE of a value stays diagnosable. */
  function mask(v) {
    return _s(v).replace(/[A-Za-z]/g, 'a').replace(/[0-9]/g, '0');
  }

  /* A fingerprint describes a value we are NOT sending. Length plus which
     character classes are present is usually enough to identify a parsing or
     escaping bug — 'apos' on its own would have named the Bri'an Key cause. */
  function fingerprint(v) {
    var s = _s(v), cls = [];
    if (/[A-Za-z]/.test(s))      cls.push('alpha');
    if (/[0-9]/.test(s))         cls.push('digit');
    if (/'/.test(s))             cls.push('apos');
    if (/"/.test(s))             cls.push('quote');
    if (/[<>&]/.test(s))         cls.push('markup');
    if (/[\\]/.test(s))          cls.push('backslash');
    if (/[^\x20-\x7E]/.test(s))  cls.push('non-ascii');
    if (/^\s|\s$/.test(s))       cls.push('edge-space');
    if (s === '')                cls.push('empty');
    return { len: s.length, cls: cls.join('|') };
  }

  /* ⚠⚠ SCRUB EVERY STRING THAT LEAVES. SESSION.token is a LIVE BADGE — it is
     never read into a payload in the first place, but a token can also reach
     us second-hand inside a stack frame, a URL or an echoed request body, and
     a reporter that leaks the credential it was debugging is a security bug
     with a friendly face. Belt and braces. */
  function scrub(v) {
    return _s(v)
      .replace(/([?&](?:token|key|pin|pwreset|password)=)[^&\s"']*/gi, '$1[redacted]')
      .replace(/("(?:token|key|pin|pwreset|password)"\s*:\s*")[^"]*/gi, '$1[redacted]')
      .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[redacted-blob]');
  }

  /* ⚠⚠ NOTHING UNSERIALISABLE MAY ENTER THE QUEUE — found by errors_harness.js.
     A caller passed an object with a circular reference in `extra`; the queue accepted
     the live reference, and JSON.stringify then threw inside _flush — which had ALREADY
     spliced the queue empty. The catch swallowed it, so ONE malformed extra silently
     destroyed every pending report in the session. The reporter looked healthy and sent
     nothing, which is the worst failure mode a reporter has.
     So: copy every caller-supplied value into a bounded, plain, serialisable shape at
     REPORT time. Never hold a reference to an object we do not control — its contents
     can also change between queueing and flushing. */
  function _safeVal(v, depth, seen) {
    depth = depth || 0;
    if (v === null || v === undefined) return null;
    var t = typeof v;
    if (t === 'string') return _clip(scrub(v), 300);
    if (t === 'number') return isFinite(v) ? v : String(v);   // NaN/Infinity are not JSON
    if (t === 'boolean') return v;
    if (t === 'function') return '[function]';
    if (t !== 'object') return _clip(_s(v), 100);
    if (depth >= 3) return '[deep]';
    seen = seen || [];
    for (var i = 0; i < seen.length; i++) if (seen[i] === v) return '[circular]';
    seen = seen.concat([v]);
    try {
      if (v.nodeType) return '[dom:' + _s(v.nodeName).toLowerCase() + ']';   // never walk the DOM
      if (Object.prototype.toString.call(v) === '[object Array]') {
        var out = [];
        for (var j = 0; j < v.length && j < 20; j++) out.push(_safeVal(v[j], depth + 1, seen));
        if (v.length > 20) out.push('[+' + (v.length - 20) + ' more]');
        return out;
      }
      var o = {}, n = 0;
      for (var k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
        if (n++ >= 30) { o._truncated = true; break; }
        o[k] = _safeVal(v[k], depth + 1, seen);
      }
      return o;
    } catch (e) { return '[unreadable]'; }
  }

  // ── BREADCRUMBS ──────────────────────────────────────────────────────────
  /* The last N things that happened, so an error has a story rather than just
     a stack. Values are never recorded — only identities (a tab id, an action
     name, an element's tag/class). */
  function crumb(kind, detail) {
    try {
      _crumbs.push({ t: _now(), k: _s(kind), d: _clip(scrub(detail), 120) });
      if (_crumbs.length > BREADCRUMBS) _crumbs.shift();
    } catch (e) {}
  }

  /* Identify an element without quoting anything a user typed or a customer
     owns: tag, classes, and the NAMES of its data-* attributes (never their
     values — those carry DSIs and emails). */
  function _elDesc(el) {
    try {
      if (!el || el.nodeType !== 1) return '';
      var bits = [el.tagName.toLowerCase()];
      if (el.id) bits.push('#' + el.id);
      var cls = _s(el.className);
      if (cls && cls.split) bits.push('.' + cls.split(/\s+/).filter(Boolean).slice(0, 3).join('.'));
      var keys = [];
      for (var i = 0; el.attributes && i < el.attributes.length; i++) {
        var n = el.attributes[i].name;
        if (n.indexOf('data-') === 0) keys.push(n);
      }
      if (keys.length) bits.push('[' + keys.slice(0, 4).join(',') + ']');
      return bits.join('');
    } catch (e) { return ''; }
  }

  // ── CONTEXT ──────────────────────────────────────────────────────────────
  /* Which bundle versions this browser actually has. This is the single most
     useful field when a fix is already live: it separates "the fix does not
     work" from "this rep is still on the old cached bundle", which has bitten
     twice (13 commits once shipped behind a stale ?v). */
  function _bundleVersions() {
    var out = {};
    try {
      var tags = d.getElementsByTagName('script');
      for (var i = 0; i < tags.length; i++) {
        var src = _s(tags[i].getAttribute('src'));
        var m = src.match(/([\w.]+)\.js\?v=([\w-]+)/);
        if (m) out[m[1]] = m[2];
      }
    } catch (e) {}
    return out;
  }

  /* Row counts per DATA key — the shape of what loaded, never its contents.
     "masterTracker: 0 but completedOrders: 812" is a diagnosis on its own. */
  function _dataShape() {
    var out = {};
    try {
      var D = w.DATA;
      if (!D || typeof D !== 'object') return { _absent: true };
      for (var k in D) {
        if (!Object.prototype.hasOwnProperty.call(D, k)) continue;
        var v = D[k];
        out[k] = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? 'obj' : typeof v);
      }
    } catch (e) {}
    return out;
  }

  function context() {
    var c = {};
    try {
      var S = w.SESSION || {}, G = w.CFG || {};
      // Staff identity IS wanted — we need to know who to follow up with.
      // ⚠ SESSION.token is deliberately absent and must stay absent.
      c.office   = _s(G.officeId);
      c.entity   = _s(G.officeId) === 'salessupport' ? 'salessupport' : 'activation';
      c.user     = _s(S.email);
      c.role     = _s(S.role);
      c.realRole = _s(S._actualRole);
      c.badgeAge = S.tokenExpires ? Math.round((Number(S.tokenExpires) - _now()) / 60000) + 'min-left' : 'none';
      c.tab      = _s(w.CURRENT_TAB);
      c.dataShape = _dataShape();
      c.versions  = _bundleVersions();
    } catch (e) {}
    try {
      var n = w.navigator || {};
      c.ua       = _clip(n.userAgent, 300);
      c.platform = _s(n.platform);
      c.online   = n.onLine === false ? 'offline' : 'online';
      c.lang     = _s(n.language);
      c.viewport = (w.innerWidth || 0) + 'x' + (w.innerHeight || 0) + '@' + (w.devicePixelRatio || 1);
      c.tz       = new Date().getTimezoneOffset();
      c.theme    = _s(d.documentElement.getAttribute('data-theme'));
      // ⚠ The URL can carry ?pwreset=<token>; scrub before it is recorded.
      c.url      = _clip(scrub(w.location.href), 300);
      c.uptime   = Math.round((_now() - _T0) / 1000) + 's';
    } catch (e) {}
    return c;
  }

  // ── DOM SNAPSHOT ─────────────────────────────────────────────────────────
  /* The visual half of the answer, and the reason this beats a screenshot:
     it is REPLAYABLE. Feed it back through _private/preview/error_replay.html
     and it re-renders against the real app.css, so you see what the rep saw —
     but masked, a few KB instead of a PNG, and greppable.

     Two reductions keep it small on a 4000-row Master Tracker:
       · prefer the subtree around the error, not the whole tab
       · collapse repeated siblings past the third, noting how many were cut */
  function snapshot(root) {
    try {
      var host = root;
      if (!host) {
        var errEl = d.querySelector('.empty-state.is-error');
        host = (errEl && (errEl.closest ? errEl.closest('.card') : null)) ||
               d.getElementById('main-content');
      }
      if (!host) return '';
      var clone = host.cloneNode(true);
      _reduce(clone);
      _maskTree(clone);
      return _clip(clone.outerHTML, SNAPSHOT_MAX);
    } catch (e) { return ''; }
  }

  var _REDUCE_KEEP = 6;
  function _reduce(node) {
    try {
      var kids = node.children, seen = {}, drop = [];
      for (var i = 0; kids && i < kids.length; i++) {
        var el = kids[i];
        /* ⚠ NEVER collapse table CELLS. Repetition across ROWS is noise worth cutting;
           repetition across CELLS is the row's SHAPE. An earlier version collapsed both
           and produced snapshots with the status and actions columns missing — which are
           usually the columns that explain the bug. */
        if (el.tagName === 'TD' || el.tagName === 'TH') { _reduce(el); continue; }
        var sig = el.tagName + '|' + _s(el.className);
        seen[sig] = (seen[sig] || 0) + 1;
        if (seen[sig] > _REDUCE_KEEP) drop.push(el); else _reduce(el);
      }
      if (drop.length) {
        for (var j = 0; j < drop.length; j++) drop[j].parentNode.removeChild(drop[j]);
        /* Record the count on the PARENT rather than appending a marker element — a <div>
           inserted into a <tbody> or <tr> is invalid HTML and replays as a layout glitch
           that looks like a rendering bug in the captured page. */
        node.setAttribute('data-as-elided', String(drop.length));
      }
    } catch (e) {}
  }

  /* Mask every text node, and every attribute that could carry a value.
     Class names, ids and structural attributes survive untouched — they are
     ours, not the customer's, and they are what make the replay legible. */
  function _maskTree(node) {
    try {
      if (node.nodeType === 3) { node.nodeValue = mask(node.nodeValue); return; }
      if (node.nodeType !== 1) return;
      var KEEP = { 'class': 1, 'id': 1, 'style': 1, 'colspan': 1, 'rowspan': 1, 'type': 1, 'role': 1, 'aria-hidden': 1, 'viewbox': 1, 'd': 1, 'x1': 1, 'x2': 1, 'y1': 1, 'y2': 1, 'cx': 1, 'cy': 1, 'r': 1, 'points': 1, 'href': 1, 'xlink:href': 1, 'width': 1, 'height': 1, 'data-as-elided': 1 };
      for (var i = 0; node.attributes && i < node.attributes.length; i++) {
        var a = node.attributes[i];
        if (KEEP[a.name.toLowerCase()]) continue;
        // onclick handlers are OURS but interpolate values — mask the value,
        // keep the function name, which is what identifies the call site.
        if (a.name.toLowerCase().indexOf('on') === 0) {
          node.setAttribute(a.name, _s(a.value).replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"'));
        } else {
          node.setAttribute(a.name, mask(a.value));
        }
      }
      for (var j = 0; j < node.childNodes.length; j++) _maskTree(node.childNodes[j]);
    } catch (e) {}
  }

  // ── REPORTING ────────────────────────────────────────────────────────────
  /* Storm control. An exception inside a render loop can fire hundreds of
     times a second; without this, the first bug of the day would append
     hundreds of rows and burn the very backend we are trying to diagnose.
     Suppressed reports are COUNTED and the count rides along on the next one
     that does go out, so a storm is visible in the log as a storm. */
  function _admit(sig) {
    if (_sent >= SESSION_MAX) { _suppressed++; return false; }
    _sigCount[sig] = (_sigCount[sig] || 0) + 1;
    if (_sigCount[sig] > PER_SIG_MAX) { _suppressed++; return false; }
    return true;
  }

  /* THE public entry point. Everything here is best-effort: if any part of
     building a report fails, the report is dropped silently. Never throws. */
  function report(code, err, extra) {
    try {
      if (!CODES[code]) code = 'APP-01';
      var e   = err || {};
      var msg = scrub(_clip(e.message || e.msg || _s(err), 400));
      var sig = code + '|' + msg + '|' + _s(e.lineno);
      if (!_admit(sig)) return code;

      var rec = {
        code:    code,
        label:   CODES[code].label,
        message: msg,
        stack:   scrub(_clip(e.stack, 1800)),
        source:  scrub(_clip(e.filename || e.source, 200)),
        line:    _s(e.lineno), col: _s(e.colno),
        at:      new Date().toISOString(),
        ctx:     context(),
        crumbs:  _crumbs.slice(),
        extra:   {},
        suppressedSoFar: _suppressed
      };
      // Caller-supplied detail, copied through _safeVal so a hostile or merely careless
      // value cannot poison the batch. `_root` is an element passed in for the snapshot
      // below — it is consumed, never transmitted.
      try {
        var x = extra || {};
        for (var k in x) {
          if (!Object.prototype.hasOwnProperty.call(x, k)) continue;
          if (k === '_root') continue;
          rec.extra[k] = _safeVal(x[k]);
        }
      } catch (e2) {}
      // A snapshot is expensive-ish, so only for the classes where seeing the
      // screen actually helps. A network timeout does not need a picture.
      if (code.indexOf('APP-') === 0 || code === 'DATA-02' || code === 'DATA-03') {
        rec.snapshot = snapshot(extra && extra._root);
      }
      _queue.push(rec);
      _sent++;
      _flushSoon();
      return code;
    } catch (e) { return code || 'APP-01'; }
  }

  /* ⚠⚠ FLUSH TIMING IS THE PART THAT IS EASY TO "TIDY" INTO A REGRESSION.
     We wait for the network to be QUIET before sending, because Apps Script
     serialises same-user requests and an error POST issued during load lands
     IN FRONT of the blob the visible tab is waiting for. That is precisely
     how the 2026-08-04 slowdown happened: work that was individually cheap
     got reordered ahead of the thing the user was actually waiting on.
     Do not "simplify" this to an immediate send. */
  function _flushSoon() {
    if (_flushTimer) return;
    _flushTimer = w.setTimeout(function () {
      _flushTimer = null;
      var quiet = _inflight === 0 && (_now() - _lastNet) > QUIET_MS;
      if (!quiet) { _flushSoon(); return; }   // still busy — check again later
      _flush(false);
    }, QUIET_MS);
  }

  function _flush(beacon) {
    try {
      if (!_queue.length) return;
      var url = _endpoint || w.APPS_SCRIPT_URL;
      if (!url) return;                       // core has not loaded; keep queueing
      var batch = _queue.splice(0, _queue.length);
      var wrap = function (rs) {
        return JSON.stringify({
          action: 'logClientError',
          key: w.API_KEY || '',
          officeId: (w.CFG && w.CFG.officeId) || '',
          reports: rs
        });
      };
      var body;
      /* ⚠ Belt and braces on top of _safeVal. The queue is already spliced by this point,
         so anything that throws here loses the WHOLE batch — drop only the record that
         cannot be serialised, never the ones that can. A lost batch is a lost diagnosis. */
      try { body = wrap(batch); }
      catch (e1) {
        var ok = [];
        for (var i = 0; i < batch.length; i++) {
          try { JSON.stringify(batch[i]); ok.push(batch[i]); } catch (e2) {}
        }
        try { body = wrap(ok); } catch (e3) { return; }
      }
      /* keepalive lets the send survive the page being closed — the tab
         closing is a COMMON way to lose the report for the error that made
         the rep give up and close the tab. */
      w.fetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // no CORS preflight
        body: body,
        keepalive: !!beacon
      })['catch'](function () { /* a failed report is not an error worth reporting */ });
    } catch (e) {}
  }

  // ── NETWORK ACTIVITY HOOKS (called by the transports) ────────────────────
  function netStart(action) { _inflight++; _lastNet = _now(); crumb('fetch', action); }
  function netEnd(action, ok, ms) {
    _inflight = Math.max(0, _inflight - 1);
    _lastNet = _now();
    crumb('fetch:' + (ok ? 'ok' : 'FAIL'), action + ' ' + (ms || 0) + 'ms');
  }

  // ── INSTALL ──────────────────────────────────────────────────────────────
  var _T0 = _now();

  function install(endpoint) {
    try {
      if (endpoint) _endpoint = endpoint;
      if (_installed) return;
      _installed = true;

      /* Capture phase, so we also see RESOURCE load failures (a bundle that
         404s or is cut off mid-download) — those do not bubble and are
         invisible to a plain window.onerror assignment. That failure mode
         produces a portal which is half-loaded and looks like anything but a
         network problem, so it is worth its own code. */
      w.addEventListener('error', function (ev) {
        try {
          if (ev && ev.target && ev.target !== w && (ev.target.src || ev.target.href)) {
            report('APP-02', { message: 'Failed to load ' + _s(ev.target.src || ev.target.href) });
            return;
          }
          report('APP-01', {
            message: ev && ev.message, stack: ev && ev.error && ev.error.stack,
            filename: ev && ev.filename, lineno: ev && ev.lineno, colno: ev && ev.colno
          });
        } catch (e) {}
      }, true);

      w.addEventListener('unhandledrejection', function (ev) {
        try {
          var r = ev && ev.reason;
          // A classified transport failure already reported itself with a
          // precise code; re-reporting it here would double-count it as APP-01.
          if (r && r.asCode) return;
          report('APP-01', { message: 'Unhandled rejection: ' + _s(r && r.message || r), stack: r && r.stack });
        } catch (e) {}
      });

      /* Clicks are the breadcrumb that makes a stack readable — "what did they
         press?" is the first question every time. Identity only, no values. */
      d.addEventListener('click', function (ev) {
        try { crumb('click', _elDesc(ev.target)); } catch (e) {}
      }, true);

      /* Last chance to send. visibilitychange is the reliable one on mobile —
         'unload' does not fire on iOS when the tab is swiped away. */
      d.addEventListener('visibilitychange', function () {
        try { if (d.visibilityState === 'hidden' && _queue.length) _flush(true); } catch (e) {}
      });

      // Drain anything the inline <head> bootstrap buffered before we ran.
      try {
        var pre = w.__AS_ERR_PRE;
        if (pre && pre.length) {
          for (var i = 0; i < pre.length; i++) {
            report(pre[i].code || 'APP-01', pre[i]);
          }
          w.__AS_ERR_PRE = [];
        }
      } catch (e) {}
    } catch (e) {}
  }

  return {
    install: install, report: report, crumb: crumb, codes: CODES,
    mask: mask, fingerprint: fingerprint, scrub: scrub, snapshot: snapshot,
    context: context, netStart: netStart, netEnd: netEnd,
    label: function (c) { return (CODES[c] || {}).label || 'Something went wrong'; },
    hint:  function (c) { return (CODES[c] || {}).hint  || ''; },
    _state: function () { return { queued: _queue.length, sent: _sent, suppressed: _suppressed, inflight: _inflight, crumbs: _crumbs.length }; }
  };
})(window, document);

// Installed immediately — the whole point is to be alive before anything else
// can fail. The endpoint is picked up from APPS_SCRIPT_URL once core defines it.
AS_ERR.install();
