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

/* ⚠⚠ CUSTOMER-FACING GUIDES ARE A DIFFERENT KIND OF DOCUMENT from the internal playbooks: they
   get SENT TO A CUSTOMER, the playbooks never do. They render in their own tab so a rep looking
   for something to send is not scrolling past order-issue scripts to find it.
   🔑 THE SPLIT IS THE SHEET'S `Section` COLUMN — one source, one fetch, no second backend call.
   ⚠ Rename that section in the sheet and the guides FALL BACK into Issue Resolution rather than
   vanishing. Visible degradation, not a silent one. Must match `_private/knowledge/*.txt`. */
var KB_RESOURCE_SECTION = 'Customer Resources';
function _kbIsResource(a) { return String(a.section || '').trim() === KB_RESOURCE_SECTION; }

function renderKnowledge() { return _kbScreen(false); }
function renderResources() { return _kbScreen(true); }

function _kbScreen(resourcesOnly) {
  var ttl = resourcesOnly ? 'Customer Resources' : 'Knowledge';
  var ico = resourcesOnly ? 'mail' : 'training';
  if (_KB_ERR) {
    return '<div class="card"><div class="card-header dark">' + icon(ico) + ' ' + ttl + '</div>' +
      '<div class="card-body"><div class="kb-err">' + esc(_KB_ERR) +
      '<button class="kb-retry" onclick="_kbLoad(true)">Retry</button></div></div></div>';
  }
  if (_KB === null) { _kbLoad(); return loadingState('Loading ' + (resourcesOnly ? 'customer resources' : 'knowledge base') + '…', { icon: ico }); }

  var pool = _KB.filter(function(a) { return _kbIsResource(a) === !!resourcesOnly; });
  /* ⚠ An empty RESOURCES tab is the EXPECTED state until the guides are pasted into the sheet —
     name the section that is missing, or it reads as a broken tab rather than an empty one. */
  if (!pool.length) {
    return resourcesOnly
      ? noData('No customer guides yet. They live in the _Knowledge sheet under the "' + KB_RESOURCE_SECTION + '" section.', { icon: ico })
      : noData('No articles yet.', { icon: ico });
  }

  /* The resources tab is a short shelf, not a corpus — a search box over two guides is noise,
     and _KB_Q is shared state, so searching there would silently filter Issue Resolution too. */
  var q = resourcesOnly ? '' : _KB_Q.toLowerCase();
  var shown = q ? pool.filter(function(a) {
    return (a.title + ' ' + a.tag + ' ' + a.section + ' ' + a.body).toLowerCase().indexOf(q) !== -1;
  }) : pool;

  // Group by section, preserving the server's order within each.
  var sections = [], byS = {};
  shown.forEach(function(a) {
    if (!byS[a.section]) { byS[a.section] = []; sections.push(a.section); }
    byS[a.section].push(a);
  });

  /* One section on the resources shelf, so its label would just repeat the tab title. */
  var body = sections.map(function(s) {
    return (resourcesOnly ? '' : '<div class="kb-sec-label">' + esc(s) + '</div>') +
           byS[s].map(_kbArticleHtml).join('');
  }).join('');
  if (!shown.length) body = '<div class="kb-noresult">Nothing matches &ldquo;' + esc(_KB_Q) + '&rdquo;.</div>';

  return '<div class="card"><div class="card-header dark">' + icon(ico) + ' ' + ttl +
      /* ⚠ pool.length, NOT _KB.length — the count must describe THIS tab, or Issue Resolution
         claims the guides it no longer shows. */
      '<span class="kb-count">' + pool.length + (resourcesOnly ? ' guide' : ' article') + (pool.length === 1 ? '' : 's') + '</span>' +
    '</div><div class="card-body">' +
    (resourcesOnly
      ? '<p class="rh-op-p" style="margin:0 0 14px">Send these with the welcome text. The guide is written for the customer, so it can go across as-is.</p>'
      : '<div class="kb-toolbar">' +
      '<input class="kb-search" id="kb-search" type="search" placeholder="Search titles and article text…" ' +
        'value="' + esc(_KB_Q) + '" oninput="_kbSearch(this.value)">' +
      '<button class="kb-expand" onclick="_kbToggleAll()">' + (_kbAllOpen() ? 'Collapse all' : 'Expand all') + '</button>' +
      '</div>') + body + '</div></div>';
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

// Inline formatting on ALREADY-ESCAPED text: **bold** and [label](https://…).
//
// Links are the one place a scheme allowlist is load-bearing. esc() has already turned
// " into &quot;, so a URL cannot break out of the href attribute — but "javascript:" and
// "data:" contain NO characters that escaping touches, so they would survive intact and
// become a live handler. Requiring an https:// prefix is what stops that, and the charset
// additionally bars whitespace, quotes, angle brackets and parens so nothing can append a
// second attribute. Bold runs first so the href itself can never be rewritten by it.
function _kbInline(escaped) {
  var s = String(escaped).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return s.replace(/\[([^\]]+)\]\((https:\/\/[^\s"'<>()*\\]+)\)/g, function(_m, label, url) {
    return '<a class="kb-link" href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  });
}

// ── loading + interaction ──────────────────────────────────────────────────
function _kbLoad(force) {
  if (_KB_LOADING) return;
  if (_KB !== null && !force) return;
  _KB_LOADING = true; _KB_ERR = '';
  if (force) {
    _KB = null;
    var c0 = document.getElementById('main-content');
    if (c0 && CURRENT_TAB === 'knowledge') c0.innerHTML = loadingState('Loading knowledge base…', { icon:'training' });
  }
  api({ action: 'readKnowledge' }).then(function(res) {
    _KB_LOADING = false;
    if (!res || res.error) {
      _KB_ERR = (res && res.error) ? String(res.error) : 'Could not load the knowledge base.'; _KB = null;
    } else if (!res.articles) {
      // An action doGet doesn't recognise falls through to the MAIN DATA BUNDLE — a 200
      // with the office blob, no error, and no articles key. Reading that as an empty
      // list renders "No articles yet.", which looks like an empty knowledge base rather
      // than a backend that predates this action. Distinguish on the KEY, not the length:
      // a deployed backend always sends articles, even when it is an empty array.
      _KB_ERR = 'The portal backend is running an older version that doesn’t serve the knowledge base yet. ' +
                'Redeploy Code.gs as “Deploy → edit existing → New version”, then hit Retry.';
      _KB = null;
    } else { _KB = res.articles; }
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
