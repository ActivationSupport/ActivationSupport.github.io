/* ═══════════════════════════════════════════════════════════════════════════
   app.admin.js — the Admin Portal (master-admin only)
   ───────────────────────────────────────────────────────────────────────────
   Phase 1: the ERROR LOG. Phases 2-4 (office overview snapshot, all-office
   appointment calendar) will live here too, which is why this is its own bundle
   rather than another few hundred lines in app.data.js.

   ⚠⚠ LOADED UNCONDITIONALLY, like every other bundle. It would be tempting to inject it
   only for master-admins — but a role is not known until AFTER login, while the defer
   chain is fixed at parse time, and conditional loading is the exact trap app.tickets.js
   fell into (symbols other bundles called went missing for six offices). The cost is a few
   KB for people who never open it; the alternative is a class of bug that has already bitten
   this project once.

   ⚠⚠ THE TAB'S `roles` LIST IS NOT THE SECURITY BOUNDARY. Hiding a nav item hides a button,
   not an endpoint. `readErrorLog` / `readErrorDetail` are in _READ_ROLES on the backend and
   are checked against the badge's SERVER-VERIFIED rank. If you ever add an admin action,
   gate it there too — the FE list is convenience only. */

var _ADMIN = {
  errors: [], total: 0, loaded: false, loading: false, err: '',
  filters: { code: '', office: '', entity: '', q: '', status: '' },
  openKey: null, detail: null, detailLoading: false,
  lastLoad: 0, timer: null,
  currentCoreVersion: '', saving: false, saveErr: ''
};

/* ── THE "ALREADY WORKED ON" MARK ────────────────────────────────────────────
   ⚠⚠ A MARK BELONGS TO THE SIGNATURE, NOT THE ROW. One bug produces dozens of rows;
   marking them one at a time would never finish, and the _Errors ring buffer deletes
   the oldest at 5000 anyway. The backend computes the signature and ships it as
   e.sig — the client NEVER recomputes it, because two implementations of "the same
   error" would drift apart and a mark that silently stops matching reads as "fixed"
   forever while the bug keeps landing rows.

   🔑 REGRESSION vs STALE CACHE is the reason this is worth building rather than just
   hiding rows. Once a signature is marked fixed in a known app.core ?v, a NEW row of
   that signature from an OLDER bundle is a rep on a stale cache (expected, quiet)
   and one from a NEWER bundle means the fix did not hold (loud). Those two are
   otherwise indistinguishable, and treating the first as the second is how a fixed
   bug gets fixed twice.

   ⚠ TWO marked states only, by decision (2026-08-06): "Needs work" and "Fixed".
   'open' is the third value but it is the ABSENCE of a mark, not a state anyone
   sets — it is what an error has before anyone has looked at it, and what
   clearing a mark returns it to. */
var _ADMIN_STATUS = {
  open:    { label: 'Open',       cls: 'ae-fx-open' },
  working: { label: 'Needs work', cls: 'ae-fx-working' },
  fixed:   { label: 'Fixed',      cls: 'ae-fx-fixed' }
};

/* The Error Log reads LIVE, not from the 5-minute admin snapshot the other admin surfaces
   will use. It is small, it is the thing being monitored, and staleness here defeats the
   entire point of having it. */
var _ADMIN_REFRESH_MS = 60000;

function renderAdminErrors() {
  if (!_ADMIN.loaded && !_ADMIN.loading) _adminLoadErrors();
  if (_ADMIN.loading && !_ADMIN.loaded) return loadingState('Loading the error log…', { icon: 'issues' });
  if (_ADMIN.err) {
    return errorState('Couldn’t load the error log.', {
      icon: 'issues', code: _ADMIN.errCode || '', sub: _ADMIN.err,
      retry: '_adminReloadErrors()'
    });
  }
  if (!_ADMIN.total) {
    return noData('No errors logged.', {
      icon: 'completed',
      sub: 'Nothing has been reported since error logging went live. This is the good outcome.'
    });
  }
  return _adminErrorsHtml();
}

function _adminLoadErrors() {
  _ADMIN.loading = true; _ADMIN.err = ''; _ADMIN.errCode = '';
  api({ action: 'readErrorLog', limit: 300 }).then(function (res) {
    _ADMIN.loading = false;
    if (!res || res.error) {
      // 'forbidden' means the badge's rank is not master-admin — say that plainly rather
      // than showing a generic failure the reader cannot act on.
      _ADMIN.err = (res && res.error === 'forbidden')
        ? 'This is master-admin only.'
        : ((res && res.error) || 'The server did not return the log.');
      _ADMIN.loaded = true;
    } else {
      _ADMIN.errors = res.errors || [];
      _ADMIN.total = res.total || 0;
      _ADMIN.currentCoreVersion = res.currentCoreVersion || '';
      _ADMIN.loaded = true; _ADMIN.lastLoad = Date.now();
    }
    if (CURRENT_TAB === 'adminerrors') _adminPaint();
  }).catch(function (e) {
    _ADMIN.loading = false; _ADMIN.loaded = true;
    _ADMIN.err = e && e.message ? e.message : 'Request failed.';
    _ADMIN.errCode = (typeof errCode === 'function') ? errCode(e) : '';
    if (CURRENT_TAB === 'adminerrors') _adminPaint();
  });
}

function _adminReloadErrors() { _ADMIN.loaded = false; _ADMIN.detail = null; _ADMIN.openKey = null; _adminLoadErrors(); _adminPaint(); }
function _adminPaint() {
  var c = document.getElementById('main-content');
  if (c && CURRENT_TAB === 'adminerrors') c.innerHTML = renderAdminErrors();
}

// ── filtering ───────────────────────────────────────────────────────────────
function _adminMatch(e, f) {
  if (f.code && e.code !== f.code) return false;
  if (f.entity && e.entity !== f.entity) return false;
  if (f.office && e.office !== f.office) return false;
  /* 'todo' is the working view: everything except what is genuinely done. With two
     states that is the clean complement of Fixed — unmarked errors AND ones marked
     "Needs work" both still need work. ⚠ A regression stays in, even though its mark
     says Fixed: that mark is exactly what has just been proven wrong, and a regression
     hiding behind it is the outcome this whole feature exists to prevent. */
  if (f.status === 'todo' && _adminFixOf(e) === 'fixed' && !e.regression) return false;
  if (f.status && f.status !== 'todo' && _adminFixOf(e) !== f.status) return false;
  if (f.q) {
    var hay = [e.code, e.label, e.message, e.user, e.office, e.tab, e.source].join(' ').toLowerCase();
    if (hay.indexOf(f.q.toLowerCase()) === -1) return false;
  }
  return true;
}
function _adminFilter() {
  var f = _ADMIN.filters;
  f.code = _adminVal('ae-code'); f.entity = _adminVal('ae-entity');
  f.office = _adminVal('ae-office'); f.q = _adminVal('ae-q');
  f.status = _adminVal('ae-status');
  var w = document.getElementById('ae-body-wrap');
  if (w) w.innerHTML = _adminRowsHtml();
}

// The stored status, defaulting to 'open' — an unmarked error is simply one nobody
// has looked at yet, which is a status, not a missing value.
function _adminFixOf(e) {
  var s = String((e && e.fixStatus) || 'open');
  return _ADMIN_STATUS[s] ? s : 'open';
}
function _adminVal(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }

function _adminUniq(key) {
  var seen = {}, out = [];
  (_ADMIN.errors || []).forEach(function (e) { var v = e[key]; if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
  return out.sort();
}

// ── render ──────────────────────────────────────────────────────────────────
function _adminAgo(ts) {
  if (!ts) return '—';
  var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

/* The code's colour carries its class, so a wall of rows is scannable: red = our bug or a
   lost write, amber = auth, blue = transport/data. */
function _adminCodeClass(code) {
  var c = String(code || '');
  if (c.indexOf('APP-') === 0 || c.indexOf('WRITE-') === 0) return 'ae-c-red';
  if (c.indexOf('AUTH-') === 0) return 'ae-c-amber';
  return 'ae-c-blue';
}

function _adminErrorsHtml() {
  var f = _ADMIN.filters;
  var sel = function (id, cur, list, anyLabel) {
    return '<select id="' + id + '" class="ps-select ae-f" onchange="_adminFilter()"><option value="">' + anyLabel + '</option>' +
      list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      '</select>';
  };
  /* ⚠ Not built from _adminUniq: the status list must offer every state even when
     nothing currently has it — a filter that only lists what is already there cannot
     be used to check "is anything still open?" on a quiet day. */
  var statusSel = '<select id="ae-status" class="ps-select ae-f" onchange="_adminFilter()">' +
    [['', 'Any status'], ['todo', 'Needs attention'], ['working', 'Needs work'],
     ['fixed', 'Fixed']].map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === f.status ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';

  var bar = '<div class="card"><div class="card-body ae-bar">' +
    '<input id="ae-q" class="ps-input ae-f ae-f-q" placeholder="Search code, message, user, office…" value="' + esc(f.q) + '" oninput="_adminFilter()">' +
    statusSel +
    sel('ae-code', f.code, _adminUniq('code'), 'All codes') +
    sel('ae-entity', f.entity, _adminUniq('entity'), 'Both portals') +
    sel('ae-office', f.office, _adminUniq('office'), 'All offices') +
    '<button class="ps-btn secondary" onclick="_adminReloadErrors()">Refresh</button>' +
    '<span class="ae-stamp">' + (_ADMIN.lastLoad ? 'Updated ' + _adminAgo(_ADMIN.lastLoad) : '') + '</span>' +
    '</div></div>';
  return bar + '<div id="ae-body-wrap">' + _adminRowsHtml() + '</div>';
}

function _adminRowsHtml() {
  var rows = (_ADMIN.errors || []).filter(function (e) { return _adminMatch(e, _ADMIN.filters); });
  if (!rows.length) {
    return '<div class="card"><div class="card-body">' +
      noData('No errors match those filters.', { bare: true, icon: 'issues' }) + '</div></div>';
  }
  var body = rows.map(function (e) {
    var open = _ADMIN.openKey === e.rowKey;
    var st = _adminFixOf(e);
    /* A handled row is DIMMED, not hidden. Hiding is what the filter is for; dimming
       keeps the history readable while making the unhandled rows the ones your eye
       lands on. ⚠ A regression is never dimmed even though its mark says 'fixed' —
       that mark is precisely what has just been proven wrong. */
    var dim = st === 'fixed' && !e.regression;
    return '<tr class="ae-row' + (open ? ' is-open' : '') + (dim ? ' ae-r-done' : '') +
        (e.regression ? ' ae-r-regress' : '') + '" onclick="_adminOpen(\'' + esc(e.rowKey) + '\')">' +
      '<td data-label="When" class="ae-when">' + esc(_adminAgo(e.ts)) + '</td>' +
      '<td data-label="Code"><span class="ae-code ' + _adminCodeClass(e.code) + '">' + esc(e.code) + '</span>' +
        _adminFixPill(e) + '</td>' +
      '<td data-label="Portal"><span class="ae-ent ae-ent-' + esc(e.entity) + '">' +
        esc(e.entity === 'salessupport' ? 'Sales Support' : 'Activation') + '</span></td>' +
      '<td data-label="Office">' + esc(e.office || '—') + '</td>' +
      '<td data-label="Who">' + esc(e.user || '—') + '</td>' +
      '<td data-label="Tab">' + esc(e.tab || '—') + '</td>' +
      '<td data-label="What"><b>' + esc(e.label || '') + '</b>' +
        (e.message ? '<div class="ae-msg">' + esc(String(e.message).slice(0, 180)) + '</div>' : '') + '</td>' +
    '</tr>' + (open ? _adminDetailRow() : '');
  }).join('');
  var head = '<tr><th>When</th><th>Code</th><th>Portal</th><th>Office</th><th>Who</th><th>Tab</th><th>What</th></tr>';
  return '<div class="card"><table class="tbl ae-table">' + head + body + '</table>' +
    '<p class="ae-count">' + rows.length + ' of ' + _ADMIN.total + ' error' + (_ADMIN.total === 1 ? '' : 's') + '</p></div>';
}

/* The mark as it appears on a row. An OPEN error gets no pill at all — the common case
   must stay quiet or the column becomes a wall of identical badges saying "nobody has
   looked at this", which is what an empty space already says. */
function _adminFixPill(e) {
  if (e.regression) {
    return '<span class="ae-fx ae-fx-regress" title="This was marked fixed in ' +
      esc(e.fixedIn || '?') + ', but this one came from a NEWER bundle (' +
      esc(e.coreVersion || '?') + ') — the fix did not hold.">Came back</span>';
  }
  var st = _adminFixOf(e);
  if (st === 'open') return '';
  var meta = _ADMIN_STATUS[st];
  var tip = st === 'fixed' && e.fixedIn
    ? 'Marked fixed in app.core ' + e.fixedIn + '. Rows on that bundle or older are stale caches.'
    : (e.fixNote || meta.label);
  return '<span class="ae-fx ' + meta.cls + '" title="' + esc(tip) + '">' + esc(meta.label) + '</span>';
}

function _adminOpen(rowKey) {
  if (_ADMIN.openKey === rowKey) { _ADMIN.openKey = null; _ADMIN.detail = null; _adminPaintRows(); return; }
  _ADMIN.openKey = rowKey; _ADMIN.detail = null; _ADMIN.detailLoading = true;
  _adminPaintRows();
  api({ action: 'readErrorDetail', rowKey: rowKey }).then(function (res) {
    _ADMIN.detailLoading = false;
    _ADMIN.detail = (res && !res.error) ? res : { error: (res && res.error) || 'Could not load it.' };
    _adminPaintRows();
  }).catch(function (e) {
    _ADMIN.detailLoading = false;
    _ADMIN.detail = { error: e && e.message ? e.message : 'Request failed.' };
    _adminPaintRows();
  });
}
function _adminPaintRows() { var w = document.getElementById('ae-body-wrap'); if (w) w.innerHTML = _adminRowsHtml(); }

function _adminDetailRow() {
  var d = _ADMIN.detail;
  var inner;
  if (_ADMIN.detailLoading) inner = loadingState('Loading the detail…', { bare: true, icon: 'clock' });
  else if (!d) inner = '';
  else if (d.error) inner = errorState('Couldn’t load this error’s detail.', { bare: true, sub: d.error, retry: '_adminOpen(\'' + esc(_ADMIN.openKey) + '\')' });
  else {
    var blk = function (label, val, mono) {
      if (!val) return '';
      return '<div class="ae-d-blk"><div class="ae-d-lbl">' + esc(label) + '</div>' +
        '<div class="ae-d-val' + (mono ? ' ae-d-mono' : '') + '">' + esc(val) + '</div></div>';
    };
    /* ⚠ The snapshot is masked markup, not a picture, and it is NOT rendered inline here —
       injecting captured markup into the live page would let a captured <style> or a broken
       tag bleed into the portal's own layout. It is offered as copyable text for
       _private/preview/error_replay.html, which renders it in an isolated document. */
    var snap = d.snapshot
      ? '<div class="ae-d-blk"><div class="ae-d-lbl">Screen snapshot ' +
          '<span class="ae-d-hint">masked — paste into error_replay.html to see it rendered</span></div>' +
          '<textarea class="ae-d-snap" readonly onclick="this.select()">' + esc(d.snapshot) + '</textarea></div>'
      : '';
    inner = '<div class="ae-detail">' +
      _adminFixPanel() +
      blk('Stack', d.stack, true) +
      blk('Breadcrumbs — what they did just before', d.breadcrumbs, true) +
      blk('Data loaded at the time', d.dataShape, true) +
      blk('Bundle versions', d.versions, true) +
      blk('Extra', d.extra, true) +
      blk('URL', d.url, true) +
      blk('Badge', d.badgeAge) +
      (Number(d.suppressedSoFar) ? blk('Suppressed before this one', d.suppressedSoFar + ' (a storm — same error repeating)') : '') +
      snap +
    '</div>';
  }
  return '<tr class="ae-drow"><td colspan="7">' + inner + '</td></tr>';
}

// The row currently expanded, or null. Module state — never passed through an onclick.
function _adminOpenRow() {
  var k = _ADMIN.openKey;
  if (!k) return null;
  for (var i = 0; i < (_ADMIN.errors || []).length; i++) {
    if (_ADMIN.errors[i].rowKey === k) return _ADMIN.errors[i];
  }
  return null;
}

/* The marking controls, inside the opened row.
   ⚠⚠ EVERY BUTTON PASSES A LITERAL ENUM, never an interpolated value. The signature
   and the note are read from module state and the DOM at click time. This is the
   2026-07-24 apostrophe rule: esc() turns ' into &#39;, the attribute parser decodes
   it back BEFORE the JS parser sees it, and a signature contains arbitrary message
   text — it is exactly the kind of value that would break it. */
function _adminFixPanel() {
  var e = _adminOpenRow();
  if (!e) return '';
  var st = _adminFixOf(e);
  var n = Number(e.sigCount || 1);
  var scope = n > 1
    ? 'Marks all <b>' + n + '</b> errors with this signature — not just this one.'
    : 'Marks this error, and any future one that matches it.';

  var btn = function (status, label) {
    var on = (st === status);
    return '<button class="ps-btn ' + (on ? '' : 'secondary ') + 'ae-fx-btn"' +
      (on ? ' disabled' : '') + ' onclick="event.stopPropagation();_adminSetFix(\'' + status + '\')">' +
      esc(label) + '</button>';
  };

  var known = st !== 'open'
    ? '<div class="ae-fx-known">Currently <b>' + esc(_ADMIN_STATUS[st].label) + '</b>' +
        (e.fixedIn ? ' in app.core <code>' + esc(e.fixedIn) + '</code>' : '') +
        (e.fixBy ? ' — ' + esc(e.fixBy) : '') +
        (e.fixNote ? '<div class="ae-fx-note-read">' + esc(e.fixNote) + '</div>' : '') +
      '</div>'
    : '';

  var regress = e.regression
    ? '<div class="ae-fx-warn">This was marked fixed in <code>' + esc(e.fixedIn || '?') +
      '</code>, but this occurrence came from <code>' + esc(e.coreVersion || '?') +
      '</code> — a newer bundle. The fix did not hold.</div>'
    : '';

  /* The fixed-in version is PREFILLED from the newest ?v the log has seen, because the
     value being right is what makes every later regression check meaningful, and asking
     someone to type a version string from memory is how it ends up wrong. */
  return '<div class="ae-d-blk ae-fx-panel" onclick="event.stopPropagation()">' +
    '<div class="ae-d-lbl">Have we handled this?</div>' +
    regress + known +
    '<div class="ae-fx-scope">' + scope + '</div>' +
    /* ⚠ "Clear" is not a third state — it returns the error to unmarked. Without it a
       mark made by mistake would be permanent, and a wrong "Fixed" is the single worst
       thing this feature can hold: it makes a live bug read as handled. */
    '<div class="ae-fx-row">' +
      btn('working', 'Needs work') + btn('fixed', 'Fixed') +
      (st !== 'open' ? btn('open', 'Clear') : '') +
    '</div>' +
    '<div class="ae-fx-row">' +
      '<input id="ae-fx-ver" class="ps-input ae-fx-ver" placeholder="fixed in app.core ?v" value="' +
        esc(_ADMIN.currentCoreVersion || '') + '">' +
      '<input id="ae-fx-note" class="ps-input ae-fx-note" placeholder="Note — what was it, what did you change?" value="' +
        esc(e.fixNote || '') + '">' +
    '</div>' +
    (_ADMIN.saving ? '<div class="ae-fx-saving">Saving…</div>' : '') +
    (_ADMIN.saveErr ? '<div class="ae-fx-warn">' + esc(_ADMIN.saveErr) + '</div>' : '') +
  '</div>';
}

function _adminSetFix(status) {
  var e = _adminOpenRow();
  if (!e || _ADMIN.saving) return;
  _ADMIN.saving = true; _ADMIN.saveErr = '';
  var note = _adminVal('ae-fx-note');
  var ver = _adminVal('ae-fx-ver');
  _adminPaintRows();

  apiPost({
    action: 'setErrorFix',
    sig: e.sig, entity: e.entity, status: status,
    fixedIn: status === 'fixed' ? ver : '',
    note: note, code: e.code, sampleMessage: e.message,
    by: (typeof SESSION !== 'undefined' && SESSION && SESSION.email) ? SESSION.email : ''
  }).then(function (res) {
    _ADMIN.saving = false;
    if (!res || res.error) { _ADMIN.saveErr = (res && res.error) || 'It did not save.'; _adminPaintRows(); return; }
    /* ⚠⚠ APPLY THE MARK TO EVERY ROW OF THIS SIGNATURE, not just the clicked one.
       A repaint that updated one row would show the other occurrences still unmarked
       and read as a failed save — and the next refresh would silently "fix" it, which
       is worse: it teaches you to distrust what you just did. */
    var n = 0;
    (_ADMIN.errors || []).forEach(function (x) {
      if (x.sig !== e.sig || x.entity !== e.entity) return;
      n++;
      x.fixStatus = res.status; x.fixedIn = res.fixedIn || '';
      x.fixNote = note; x.fixWhen = res.when || '';
      x.regression = (res.status === 'fixed') && !!res.fixedIn && !!x.coreVersion &&
                     /^\d{8}[a-z]?$/.test(x.coreVersion) && x.coreVersion > res.fixedIn;
    });
    _adminPaintRows();
  }).catch(function (err) {
    _ADMIN.saving = false;
    _ADMIN.saveErr = (err && err.message) ? err.message : 'It did not save.';
    _adminPaintRows();
  });
}

/* Live-ish refresh while the tab is open. ⚠ Stops when the tab is left and when the window
   is not focused — a background timer that keeps hitting a serialised backend is exactly how
   the 2026-08-04 slowdown happened. */
function _adminStartTimer() {
  _adminStopTimer();
  _ADMIN.timer = setInterval(function () {
    if (CURRENT_TAB !== 'adminerrors') { _adminStopTimer(); return; }
    if (document.hidden) return;
    if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    _ADMIN.loaded = false; _adminLoadErrors();
  }, _ADMIN_REFRESH_MS);
}
function _adminStopTimer() { if (_ADMIN.timer) { clearInterval(_ADMIN.timer); _ADMIN.timer = null; } }
