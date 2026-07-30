// ── KNOWLEDGE BASE ─────────────────────────────────────────────────────────
// Internal AT&T process reference. The article text lives ONLY in the _Knowledge sheet
// and arrives via the authenticated readKnowledge action — NOTHING in this file may
// contain the content itself, because this repo is PUBLIC and every byte under
// dashboard/ is served to anyone who finds the URL.
//
// Deliberately NOT cached in localStorage either: nothing should survive a logout on a
// shared machine. It is re-fetched per session and held in memory only.
var _KB = null;            // null = not loaded
var _KB_LOADING = false;
var _KB_ERR = '';
var _KB_OPEN = {};         // title -> true, which articles are expanded
var _KB_Q = '';            // current search text

function renderKnowledge() {
  if (_KB_ERR) {
    return '<div class="card"><div class="card-header dark">' + icon('training') + ' Knowledge</div>' +
      '<div class="card-body"><div class="kb-err">' + esc(_KB_ERR) +
      '<button class="kb-retry" onclick="_kbLoad(true)">Retry</button></div></div></div>';
  }
  if (_KB === null) { _kbLoad(); return '<div class="empty">Loading knowledge base…</div>'; }
  if (!_KB.length) return noData('No articles yet.', { icon: 'training' });

  var q = _KB_Q.toLowerCase();
  var shown = q ? _KB.filter(function(a) {
    return (a.title + ' ' + a.tag + ' ' + a.section + ' ' + a.body).toLowerCase().indexOf(q) !== -1;
  }) : _KB;

  // Group by section, preserving the server's order within each.
  var sections = [], byS = {};
  shown.forEach(function(a) {
    if (!byS[a.section]) { byS[a.section] = []; sections.push(a.section); }
    byS[a.section].push(a);
  });

  var body = sections.map(function(s) {
    return '<div class="kb-sec-label">' + esc(s) + '</div>' + byS[s].map(_kbArticleHtml).join('');
  }).join('');
  if (!shown.length) body = '<div class="kb-noresult">Nothing matches &ldquo;' + esc(_KB_Q) + '&rdquo;.</div>';

  return '<div class="card"><div class="card-header dark">' + icon('training') + ' Knowledge' +
      '<span class="kb-count">' + _KB.length + ' article' + (_KB.length === 1 ? '' : 's') + '</span>' +
    '</div><div class="card-body">' +
    '<div class="kb-toolbar">' +
      '<input class="kb-search" id="kb-search" type="search" placeholder="Search titles and article text…" ' +
        'value="' + esc(_KB_Q) + '" oninput="_kbSearch(this.value)">' +
      '<button class="kb-expand" onclick="_kbToggleAll()">' + (_kbAllOpen() ? 'Collapse all' : 'Expand all') + '</button>' +
    '</div>' + body + '</div></div>';
}

function _kbArticleHtml(a) {
  var open = !!_KB_OPEN[a.title];
  return '<div class="kb-art' + (open ? ' open' : '') + '">' +
      '<button class="kb-art-hd" onclick="_kbToggle(this)" data-title="' + esc(a.title) + '">' +
        '<span class="kb-chev">' + icon('chev-right') + '</span>' +
        '<span class="kb-art-title">' + esc(a.title) + '</span>' +
        (a.tag ? '<span class="kb-art-tag">' + esc(a.tag) + '</span>' : '') +
      '</button>' +
      '<div class="kb-art-body">' + _kbRender(a.body) + '</div>' +
    '</div>';
}

// ── SAFE RENDERER ──────────────────────────────────────────────────────────
// ESCAPE FIRST, then recognise a fixed set of line forms. Anyone with access to the
// _Knowledge sheet can edit these cells, so raw HTML must never reach innerHTML: a
// stray script tag (or a spreadsheet formula that produces one) would otherwise run in
// every user's portal. esc() is applied before any markup is added, and the only tags
// emitted are ones this function writes itself.
//
// Line forms: '## ' heading · '- ' bullet · '1. ' step · '> ' script · '! label | text'
// callout · '| k | v |' table row · blank line ends a block. Inline: **bold** only.
function _kbRender(src) {
  var lines = String(src == null ? '' : src).split(/\r?\n/);
  var out = [], list = null, table = null, script = null, para = [];

  function flushPara()   { if (para.length) { out.push('<p>' + para.join(' ') + '</p>'); para = []; } }
  function flushList()   { if (list)   { out.push('<' + list.tag + ' class="kb-' + list.cls + '">' + list.items.join('') + '</' + list.tag + '>'); list = null; } }
  function flushTable()  { if (table)  { out.push('<table class="kb-table"><tbody>' + table.join('') + '</tbody></table>'); table = null; } }
  function flushScript() { if (script) { out.push('<div class="kb-script">' + script.join('') + '</div>'); script = null; } }
  function flushAll()    { flushPara(); flushList(); flushTable(); flushScript(); }

  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) { flushAll(); continue; }

    var e = esc(t);            // everything downstream is already escaped
    var m;

    if ((m = e.match(/^##\s+(.*)$/))) {
      flushAll(); out.push('<div class="kb-h">' + _kbInline(m[1]) + '</div>'); continue;
    }
    if ((m = e.match(/^&gt;\s*(.*)$/))) {          // '>' became '&gt;' in esc()
      flushPara(); flushList(); flushTable();
      script = script || [];
      script.push('<p>' + _kbInline(m[1]) + '</p>');
      continue;
    }
    if ((m = e.match(/^!\s*(.*)$/))) {
      flushAll();
      var parts = m[1].split('|');
      var label = parts.length > 1 ? parts.shift().trim() : '';
      out.push('<div class="kb-alert">' +
        (label ? '<div class="kb-alert-h">' + _kbInline(label) + '</div>' : '') +
        _kbInline(parts.join('|').trim()) + '</div>');
      continue;
    }
    if ((m = e.match(/^\|(.+)\|$/))) {
      flushPara(); flushList(); flushScript();
      var cells = m[1].split('|');
      table = table || [];
      table.push('<tr><td class="kb-td-k">' + _kbInline((cells[0] || '').trim()) + '</td>' +
                 '<td>' + _kbInline(cells.slice(1).join('|').trim()) + '</td></tr>');
      continue;
    }
    if ((m = e.match(/^-\s+(.*)$/))) {
      flushPara(); flushTable(); flushScript();
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', cls: 'ul', items: [] }; }
      list.items.push('<li>' + _kbInline(m[1]) + '</li>'); continue;
    }
    if ((m = e.match(/^\d+\.\s+(.*)$/))) {
      flushPara(); flushTable(); flushScript();
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', cls: 'ol', items: [] }; }
      list.items.push('<li>' + _kbInline(m[1]) + '</li>'); continue;
    }
    flushList(); flushTable(); flushScript();
    para.push(_kbInline(e));
  }
  flushAll();
  return out.join('');
}

// Inline formatting on ALREADY-ESCAPED text. Only **bold** is supported; asterisks are
// the only thing this looks for, so no tag or attribute can be reconstructed from input.
function _kbInline(escaped) {
  return String(escaped).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

// ── loading + interaction ──────────────────────────────────────────────────
function _kbLoad(force) {
  if (_KB_LOADING) return;
  if (_KB !== null && !force) return;
  _KB_LOADING = true; _KB_ERR = '';
  if (force) {
    _KB = null;
    var c0 = document.getElementById('main-content');
    if (c0 && CURRENT_TAB === 'knowledge') c0.innerHTML = '<div class="empty">Loading knowledge base…</div>';
  }
  api({ action: 'readKnowledge' }).then(function(res) {
    _KB_LOADING = false;
    if (!res || res.error) { _KB_ERR = (res && res.error) ? String(res.error) : 'Could not load the knowledge base.'; _KB = null; }
    else { _KB = res.articles || []; }
    _kbRepaint();
  }).catch(function() {
    _KB_LOADING = false; _KB = null; _KB_ERR = 'Could not reach the server.';
    _kbRepaint();
  });
}
function _kbRepaint() {
  if (CURRENT_TAB !== 'knowledge') return;
  var c = document.getElementById('main-content');
  if (c) c.innerHTML = renderKnowledge();
}

// data-attr + delegated read, never a title interpolated into an inline onclick string
// (the "Bri'an Key" class of bug — an apostrophe in a title would break the handler).
function _kbToggle(el) {
  var t = el && el.getAttribute('data-title'); if (!t) return;
  if (_KB_OPEN[t]) delete _KB_OPEN[t]; else _KB_OPEN[t] = true;
  var art = el.parentNode; if (art && art.classList) art.classList.toggle('open', !!_KB_OPEN[t]);
  var btn = document.querySelector('.kb-expand'); if (btn) btn.textContent = _kbAllOpen() ? 'Collapse all' : 'Expand all';
}
function _kbAllOpen() {
  if (!_KB || !_KB.length) return false;
  for (var i = 0; i < _KB.length; i++) if (!_KB_OPEN[_KB[i].title]) return false;
  return true;
}
function _kbToggleAll() {
  var openAll = !_kbAllOpen();
  _KB_OPEN = {};
  if (openAll) (_KB || []).forEach(function(a) { _KB_OPEN[a.title] = true; });
  _kbRepaint();
}
// Repaints the whole tab, then restores focus and caret so typing isn't interrupted.
function _kbSearch(v) {
  _KB_Q = String(v || '');
  var inp = document.getElementById('kb-search');
  var pos = inp ? inp.selectionStart : null;
  _kbRepaint();
  var inp2 = document.getElementById('kb-search');
  if (inp2) { inp2.focus(); if (pos !== null) { try { inp2.setSelectionRange(pos, pos); } catch (e) {} } }
}
