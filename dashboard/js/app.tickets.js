// ── SALES SUPPORT — TICKETING ("Jedi" office) ──────────────────────────────
// A self-contained feature area for the `salessupport` office. Unlike every other
// office (Tableau-fed sales dashboards), this is a Zendesk-style ticket/interaction
// log: agents record rep calls & texts, categorize them (General → Specific), work
// them as a note thread, and chase a follow-up queue. NO Tableau data.
//
// It plugs into the shared portal via tiny branch-hooks (all guarded on
// CFG.officeId === 'salessupport', so every other office is byte-for-byte unchanged):
//   • app.core.js  buildNav/_activeTabs → swaps TABS for SALESSUPPORT_TABS
//   • app.core.js  showApp             → calls initTicketApp() instead of loadData()
//   • app.data.js  renderTab           → delegates to renderTicketTab(id)
//   • app.css      html[data-office="salessupport"] → deep-space dark palette
// Login/roster/session all reuse the portal exactly as-is.
//
// Backend (Slice 2+): its OWN standalone Apps Script project (separate /exec), reached
// through _ticketGet/_ticketPost below — same session-token pattern as app.appts.js.
// ───────────────────────────────────────────────────────────────────────────

// The three screens. `icon` reuses existing sprite symbols until themed icons land
// in the polish slice (buildNav renders #i-<icon||id>). No `roles` needed — access is
// gated by who is in the _Roster_salessupport roster, so buildNav shows all tabs here.
var SALESSUPPORT_TABS = [
  { id:'tickets',   label:'Ticket Queue', group:'Support', sub:'Every Sales Support ticket',            icon:'postedsales' },
  { id:'newticket', label:'New Ticket',   group:'Support', sub:'Log a rep call or text',                icon:'postsale' },
  { id:'followups', label:'Follow-Ups',   group:'Support', sub:'Tickets awaiting a response',           icon:'escalations' },
];

// Module state (grows with each slice). lookups drive the save-as-you-go datalists;
// agents drive the Assignee picker; list/filters/sort are for the queue (Slice 4).
var _TICKETS = {
  lookups: { office:[], rep:[], generalCat:[], specificCat:[] },
  agents: [],
  list: [], filters: {}, sort: {},
  _loaded: false
};

// Canonical statuses ↔ display labels (backend stores the canonical code).
var TICKET_STATUS = [
  { code:'pending',  label:'Pending / Open' },
  { code:'followup', label:'Follow-up (Need Response)' },
  { code:'solved',   label:'Solved' }
];
var TICKET_CHANNELS = ['Calling', 'Texting'];
var TICKET_SARA = ['Pre', 'During', 'Post'];

// ── Separate ticketing backend (wired in Slice 2 once the script is deployed) ──
// Mirror of app.appts.js _apptGet/_apptPost: carry the shared key + portal session
// token, follow redirects, text/plain body (no CORS preflight), route auth-expiry
// back to login via _authIntercept.
var TICKET_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwDYl69QuAHVlTBLSiNujtgA-e4cm686cnJ-90ZctjqZz-8FDAUWYZboaCETi3Rvfqk/exec';   // standalone Sales Support Ticketing backend
function _ticketGet(params) {
  var p = Object.assign({}, params, { key: API_KEY, officeId: CFG.officeId });
  if (SESSION && SESSION.token) p.token = SESSION.token;
  var qs = Object.keys(p).map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(p[k] == null ? '' : p[k]); }).join('&');
  return fetch(TICKET_SCRIPT_URL + '?' + qs, { redirect:'follow' }).then(function(r){ return r.json(); }).then(_authIntercept);
}
function _ticketPost(body) {
  var extra = (SESSION && SESSION.token) ? { key: API_KEY, token: SESSION.token, officeId: CFG.officeId } : { key: API_KEY, officeId: CFG.officeId };
  return fetch(TICKET_SCRIPT_URL, {
    method:'POST', redirect:'follow',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({}, body, extra))
  }).then(function(r){ return r.json(); }).then(_authIntercept);
}

// Entry point from showApp() — renders whatever tab we landed on. (Data fetching for
// the queue/detail/follow-ups arrives with those slices; the scaffold just paints.)
// We also set the sidebar username here because salessupport skips loadData/_applyMainData
// (where every other office sets it).
function initTicketApp() {
  var sb = document.getElementById('sb-office-name'); if (sb) sb.innerHTML = _ssLogoSvg(40, true);   // filled (readable small) sidebar wordmark
  var nameEl = document.getElementById('sb-user-name');
  if (nameEl) nameEl.textContent = (SESSION.name || SESSION.email || '') + (SESSION.role ? ' · ' + SESSION.role : '');
  switchTab(CURRENT_TAB || 'tickets');
}

// ── "Star Wars"-inspired gold wordmark (our own SVG — NOT the trademarked logo) ──
// Geometric sci-fi feel from Orbitron (Google Fonts, SIL OFL) + a gold gradient with a thin
// darker edge, floating on the starfield. NO glyph stretching (that distorted the letters);
// the two words are just centered and stacked. Unique gradient id per call (avoids dup IDs).
var _ssLogoN = 0;
function _ssLoadFont() {
  if (document.getElementById('ss-orbitron')) return;
  var l = document.createElement('link');
  l.id = 'ss-orbitron'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&display=swap';
  document.head.appendChild(l);
}
function _ssLogoSvg(h, filled) {
  h = h || 96;
  _ssLoadFont();
  // Two words justified to the SAME width via lengthAdjust="spacing" (adjusts letter spacing
  // only — NEVER the glyph shapes), stacked tight like the Star Wars mark. `filled` = a solid
  // gold version for the small sidebar (an outline gets too thin to read there).
  var common = 'text-anchor="middle" font-family="Orbitron,\'Arial Black\',sans-serif" font-weight="900" letter-spacing="1"';
  var l1 = '<text x="340" y="72" font-size="62">SALES</text>';
  var l2 = '<text x="340" y="150" font-size="62">SUPPORT</text>';
  if (filled) {
    var gid = 'ssGold' + (++_ssLogoN);
    return '<svg viewBox="0 0 680 172" style="height:' + h + 'px;width:auto;display:inline-block" role="img" aria-label="Sales Support">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFEAA3"/><stop offset="0.5" stop-color="#F4C21B"/><stop offset="1" stop-color="#D29B00"/></linearGradient></defs>' +
      '<g ' + common + ' fill="url(#' + gid + ')">' + l1 + l2 + '</g></svg>';
  }
  return '<svg viewBox="0 0 680 172" style="height:' + h + 'px;width:auto;display:inline-block" role="img" aria-label="Sales Support">' +
    '<g ' + common + ' fill="none" stroke="#F4D014" stroke-width="2.4" stroke-linejoin="round">' + l1 + l2 + '</g></svg>';
}

// Login-screen branding for the ticketing office: swap the plain name for the gold wordmark
// and lay a subtle starfield behind the deep-space glow. Called from loadConfig (before login).
function _ssApplyBranding(officeId) {
  if (officeId !== 'salessupport') return;
  var logo = document.getElementById('login-office-logo');
  if (logo) {
    logo.innerHTML = _ssLogoSvg(120);   // outline wordmark
    logo.style.cssText = 'display:block;width:100%;filter:drop-shadow(0 0 14px rgba(244,194,27,.28))';
    var lsvg = logo.querySelector('svg');   // fit the card width instead of a fixed height (no overflow/clipping)
    if (lsvg) { lsvg.style.width = '100%'; lsvg.style.height = 'auto'; lsvg.style.maxWidth = '100%'; lsvg.style.display = 'block'; lsvg.style.margin = '0 auto'; }
  }
  var nm = document.getElementById('login-office-name'); if (nm) nm.style.display = 'none';
  var brand = document.querySelector('.login-card h1'); if (brand) brand.style.display = 'none';   // hide "Activation Support" on the ticketing login
  var ls = document.getElementById('login-screen');
  if (ls) {
    var pts = [[8,16],[21,60],[34,28],[47,78],[59,14],[69,48],[81,70],[90,26],[15,86],[54,38],[74,9],[92,54],[29,70],[63,88],[41,50]];
    var stars = pts.map(function(p, i){ var c = i % 3 === 0 ? '#ffffff' : (i % 3 === 1 ? '#bcd3ff' : '#9fb2d6'); return 'radial-gradient(1.4px 1.4px at ' + p[0] + '% ' + p[1] + '%, ' + c + ', transparent)'; }).join(', ');
    ls.style.background = 'radial-gradient(ellipse at 50% 30%, #12305f 0%, rgba(5,7,15,0) 62%), ' + stars + ', #05070f';
  }
}

// Router for the three screens (called from app.data.js renderTab when the office is
// salessupport). Slices 3–6 replace each placeholder with the real screen.
function renderTicketTab(id) {
  var c = document.getElementById('main-content');
  if (!c) return;
  if (id === 'tickets')        renderTicketQueue();
  else if (id === 'newticket') renderNewTicket();
  else if (id === 'followups') renderTicketFollowups();
  else                          c.innerHTML = _ticketScaffold('Sales Support', 'Select a screen from the sidebar.', '');
}

// ── NEW TICKET (Slice 3) ────────────────────────────────────────────────────
// One-screen intake. Office / Rep / General / Specific are save-as-you-go via native
// <datalist> (free-type + autocomplete from prior values; new values are remembered
// server-side on create). Assignee defaults to the current agent.
function renderNewTicket() {
  var c = document.getElementById('main-content'); if (!c) return;
  c.innerHTML = _newTicketFormHtml();
  _ticketLoadFormData();   // populate datalists + assignee (no-op until the backend URL is set)
}

function _ntField(label, controlHtml, cls) {
  return '<label class="ss-fld' + (cls ? ' ' + cls : '') + '"><span class="ss-lbl">' + esc(label) + '</span>' + controlHtml + '</label>';
}
function _ntSec(title) { return '<div class="ss-form-seclabel">' + esc(title) + '</div>'; }
function _newTicketFormHtml() {
  var chan = '<select id="nt-channel" class="ps-select"><option value="">—</option>' +
    TICKET_CHANNELS.map(function(x){ return '<option>' + esc(x) + '</option>'; }).join('') + '</select>';
  var sara = '<select id="nt-sara" class="ps-select"><option value="">—</option>' +
    TICKET_SARA.map(function(x){ return '<option>' + esc(x) + '</option>'; }).join('') + '</select>';
  var me = (SESSION && (SESSION.name || SESSION.email)) || '';
  var assignee = '<select id="nt-assignee" class="ps-select"><option value="' + esc((SESSION&&SESSION.email)||'') + '" selected>' + esc(me || 'Me') + '</option></select>';
  return '' +
  '<div class="card ss-card ss-form-card" style="max-width:860px">' +
    '<div class="ss-rule"></div>' +
    '<h2 class="ss-h2">New Ticket</h2>' +
    '<p class="ss-sub">Log a rep call or text. Rep, office, subject and categories remember what you type — pick an existing one or create a new one inline.</p>' +
    '<div class="ss-form-sec">' + _ntSec('Contact') +
      '<div class="ss-grid">' +
        _ntField('Requester (Rep)', _comboField('nt-requester', { placeholder:'Rep name', options:function(){ return _TICKETS.lookups.rep || []; } })) +
        _ntField('Office', _comboField('nt-office', { placeholder:'Office', options:function(){ return _TICKETS.lookups.office || []; } })) +
        _ntField('Channel', chan) +
        _ntField('Phone #', '<input id="nt-phone" class="ps-input" autocomplete="off" placeholder="Called / texted in from">') +
      '</div>' +
    '</div>' +
    '<div class="ss-form-sec">' + _ntSec('Classification') +
      '<div class="ss-grid">' +
        _ntField('General Category', _comboField('nt-general', { placeholder:'e.g. Escalations', options:function(){ return _TICKETS.lookups.generalCat || []; } })) +
        _ntField('Specific Category', _comboField('nt-specific', { placeholder:'e.g. Fraud Support', options:_ticketSpecificOptions })) +
        _ntField('Sara Plus', sara) +
        _ntField('DSI / Account', '<input id="nt-dsi" class="ps-input" autocomplete="off" placeholder="DSI or account info">') +
      '</div>' +
    '</div>' +
    '<div class="ss-form-sec">' + _ntSec('Ticket') +
      '<div class="ss-grid">' +
        _ntField('Subject', _comboField('nt-subject', { placeholder:'Short summary', options:function(){ return _TICKETS.lookups.subject || []; } }), 'ss-fld--full') +
        _ntField('Assignee', assignee) +
        _ntField('Tags', '<input id="nt-tags" class="ps-input" autocomplete="off" placeholder="comma, separated">') +
      '</div>' +
      '<div class="ss-checks">' +
        '<label class="ss-chk"><input type="checkbox" id="nt-calledback"> Called Back</label>' +
        '<label class="ss-chk"><input type="checkbox" id="nt-review"> Review Approval</label>' +
      '</div>' +
      _ntField('Notes', '<textarea id="nt-note" class="ps-textarea" rows="4" placeholder="What happened / what’s needed"></textarea>') +
    '</div>' +
    '<div class="ss-actions">' +
      '<button id="nt-submit" class="ps-btn" onclick="_ticketCreate(event)">Create Ticket</button>' +
      '<span id="nt-status" class="ss-status"></span>' +
    '</div>' +
  '</div>';
}

// Fetch the save-as-you-go lists + agents (once). The comboboxes read their options
// live from _TICKETS.lookups, so there's nothing to "fill" — just the Assignee <select>.
function _ticketLoadFormData() {
  if (!TICKET_SCRIPT_URL) { _ntStatus('Preview mode — backend not connected yet (dropdowns fill once it is).', false); return; }
  Promise.all([
    _ticketGet({ action:'getLookups' }),
    _ticketGet({ action:'getAgents' })
  ]).then(function(r) {
    if (r[0] && r[0].lookups) _TICKETS.lookups = r[0].lookups;
    if (r[1] && r[1].agents)  _TICKETS.agents  = r[1].agents;
    _TICKETS._loaded = true;
    _ticketFillAgents();
  }).catch(function(){ /* leave the form usable with empty lists */ });
}
function _ticketFillAgents() {
  var sel = document.getElementById('nt-assignee'); if (!sel || !_TICKETS.agents.length) return;
  var mine = (SESSION && SESSION.email) || '';
  sel.innerHTML = _TICKETS.agents.map(function(a){
    return '<option value="' + esc(a.email) + '"' + (a.email === mine ? ' selected' : '') + '>' + esc(a.name || a.email) + '</option>';
  }).join('');
}
// Specific-category options = specifics under the currently-typed General (case-insensitive);
// unknown/empty General shows all. Free-type/create still allowed.
function _ticketSpecificOptions() {
  var gen = String((document.getElementById('nt-general') || {}).value || '').trim().toLowerCase();
  var specs = _TICKETS.lookups.specificCat || [];
  var filtered = specs.filter(function(s){ return !gen || String(s.parent || '').trim().toLowerCase() === gen; });
  if (!filtered.length) filtered = specs;
  return filtered.map(function(s){ return s.value; });
}

// ── Creatable combobox (Zendesk-Garden style) ───────────────────────────────
// An input + a filtering listbox. Type to narrow existing values; if what you typed
// isn't already an option, a "+ Create …" row lets you add it inline. Single-select;
// the value lives in the input (so _ntVal reads it), and brand-new values are persisted
// by the backend save-as-you-go on ticket create. Keyboard: ↑/↓ move, Enter picks the
// highlight, Esc closes. `cfg = { placeholder, options: ()=>[strings] }`.
var _COMBO = {};
function _comboField(id, cfg) {
  _COMBO[id] = { opts: cfg.options, items: [], hi: -1 };
  return '<div class="ss-combo">' +
    '<input id="' + id + '" class="ps-input ss-combo-input" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" placeholder="' + esc(cfg.placeholder || '') + '" ' +
      'onfocus="_comboOpen(\'' + id + '\')" oninput="_comboOpen(\'' + id + '\')" onkeydown="_comboKey(\'' + id + '\',event)" onblur="_comboBlur(\'' + id + '\')">' +
    '<div class="ss-combo-menu" id="' + id + '-menu" role="listbox"></div>' +
  '</div>';
}
function _comboRender(id) {
  var input = document.getElementById(id), menu = document.getElementById(id + '-menu'), st = _COMBO[id];
  if (!input || !menu || !st) return;
  var q = String(input.value || '').trim(), ql = q.toLowerCase();
  var all = (st.opts && st.opts()) || [];
  var matches = all.filter(function(o){ return String(o).toLowerCase().indexOf(ql) !== -1; });
  var exact = all.some(function(o){ return String(o).toLowerCase() === ql; });
  var items = matches.map(function(o){ return { val: String(o), create: false }; });
  if (q && !exact) items.push({ val: q, create: true });
  st.items = items;
  if (st.hi >= items.length) st.hi = items.length - 1;
  menu.innerHTML = items.length
    ? items.map(function(it, i){
        var cls = 'ss-combo-opt' + (it.create ? ' ss-combo-create' : '') + (i === st.hi ? ' hi' : '');
        return '<div class="' + cls + '" role="option" data-i="' + i + '">' + (it.create ? '+ Create “' + esc(it.val) + '”' : esc(it.val)) + '</div>';
      }).join('')
    : '<div class="ss-combo-empty">No matches</div>';
  menu.onmousedown = function(e){
    var el = e.target && e.target.closest ? e.target.closest('.ss-combo-opt') : null;
    if (!el) return;
    e.preventDefault();   // fire before the input's blur so the pick registers
    _comboPick(id, parseInt(el.getAttribute('data-i'), 10));
  };
}
function _comboOpen(id) {
  var menu = document.getElementById(id + '-menu'), input = document.getElementById(id); if (!menu || !input) return;
  _comboRender(id);
  if (_COMBO[id] && _COMBO[id].items.length) { menu.classList.add('open'); input.setAttribute('aria-expanded', 'true'); }
  else { menu.classList.remove('open'); input.setAttribute('aria-expanded', 'false'); }   // nothing to suggest (e.g. empty Subject) → no menu
}
function _comboClose(id) {
  var menu = document.getElementById(id + '-menu'), input = document.getElementById(id);
  if (menu) menu.classList.remove('open');
  if (input) input.setAttribute('aria-expanded', 'false');
  if (_COMBO[id]) _COMBO[id].hi = -1;
}
function _comboBlur(id) { setTimeout(function(){ _comboClose(id); }, 140); }   // delay so a click can register
function _comboPick(id, i) {
  var st = _COMBO[id], input = document.getElementById(id);
  if (!st || !input || !st.items[i]) return;
  input.value = st.items[i].val;
  _comboClose(id);
}
function _comboKey(id, e) {
  var st = _COMBO[id]; if (!st) return;
  var menuOpen = (document.getElementById(id + '-menu') || {}).classList && document.getElementById(id + '-menu').classList.contains('open');
  if (e.key === 'ArrowDown')      { e.preventDefault(); if (!menuOpen) { _comboOpen(id); return; } st.hi = Math.min(st.hi + 1, st.items.length - 1); _comboRender(id); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); st.hi = Math.max(st.hi - 1, 0); _comboRender(id); }
  else if (e.key === 'Enter')     { if (st.hi >= 0 && st.items[st.hi]) { e.preventDefault(); _comboPick(id, st.hi); } else { _comboClose(id); } }
  else if (e.key === 'Escape')    { _comboClose(id); }
}

function _ntVal(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
function _ntChk(id) { var el = document.getElementById(id); return !!(el && el.checked); }
function _ntStatus(msg, isError) {
  var el = document.getElementById('nt-status'); if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--red)' : 'var(--accent2b)';
}
function _ticketResetForm() {
  ['nt-requester','nt-office','nt-phone','nt-subject','nt-general','nt-specific','nt-dsi','nt-tags','nt-note','nt-channel','nt-sara'].forEach(function(id){ var el=document.getElementById(id); if (el) el.value=''; });
  ['nt-calledback','nt-review'].forEach(function(id){ var el=document.getElementById(id); if (el) el.checked=false; });
}
function _ticketCreate(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  var payload = {
    action:'createTicket', status:'pending',
    requester:_ntVal('nt-requester'), office:_ntVal('nt-office'), channel:_ntVal('nt-channel'),
    phone:_ntVal('nt-phone'), subject:_ntVal('nt-subject'), generalCategory:_ntVal('nt-general'),
    specificCategory:_ntVal('nt-specific'), saraPlus:_ntVal('nt-sara'), dsi:_ntVal('nt-dsi'),
    assignee:_ntVal('nt-assignee'), tags:_ntVal('nt-tags'),
    calledBack:_ntChk('nt-calledback'), reviewApproval:_ntChk('nt-review'), note:_ntVal('nt-note')
  };
  if (!payload.requester && !payload.subject && !payload.generalCategory) { _ntStatus('Add at least a rep, a subject, or a category.', true); return; }
  var btn = document.getElementById('nt-submit');
  if (!TICKET_SCRIPT_URL) { _ntStatus('Preview mode — backend not connected, so this can’t save yet.', true); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  _ntStatus('', false);
  _ticketPost(payload).then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Ticket'; }
    if (res && res.ok) {
      _ntStatus('Ticket ' + res.ticketId + ' created. ✦', false);
      _ticketResetForm();
      // remember any freshly-typed values locally so the datalists update without a refetch
      _ticketRememberLocal(payload);
    } else { _ntStatus((res && res.error) || 'Could not create the ticket.', true); }
  }).catch(function(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Ticket'; }
    _ntStatus('Error: ' + e.message, true);
  });
}
// Mirror the server's save-as-you-go into local state so the next open shows new values.
function _ticketRememberLocal(p) {
  var lk = _TICKETS.lookups;
  function add(arr, v){ v = String(v||'').trim(); if (v && arr.indexOf(v) === -1) arr.push(v); }
  add(lk.office, p.office); add(lk.rep, p.requester); add(lk.generalCat, p.generalCategory);
  if (String(p.specificCategory||'').trim()) {
    var exists = (lk.specificCat||[]).some(function(s){ return String(s.value).toLowerCase() === p.specificCategory.toLowerCase(); });
    if (!exists) lk.specificCat.push({ value:p.specificCategory, parent:p.generalCategory });
  }
}

// ── TICKET QUEUE (Slice 4) ──────────────────────────────────────────────────
function renderTicketQueue() {
  var c = document.getElementById('main-content'); if (!c) return;
  if (!TICKET_SCRIPT_URL) { c.innerHTML = _ticketScaffold('Ticket Queue', 'Backend not connected in this preview.', ''); return; }
  if (!_TICKETS.sort || !_TICKETS.sort.key) _TICKETS.sort = { key:'created', dir:'desc' };   // newest first
  c.innerHTML = '<div class="card ss-card"><div class="ss-rule"></div><h2 class="ss-h2">Ticket Queue</h2>' + _ssLoading('Loading tickets…') + '</div>';
  Promise.all([
    _ticketGet({ action:'getTickets' }),
    _ticketGet({ action:'getLookups' }),
    _ticketGet({ action:'getAgents' })
  ]).then(function(r) {
    _TICKETS.list = (r[0] && r[0].tickets) || [];
    if (r[1] && r[1].lookups) _TICKETS.lookups = r[1].lookups;
    if (r[2] && r[2].agents)  _TICKETS.agents  = r[2].agents;
    _TICKETS.render = _ticketTableHtml;   // which table the in-place sync re-renders
    c.innerHTML = _ticketQueueView();
  }).catch(function(e) {
    c.innerHTML = '<div class="card ss-card"><div class="ss-rule"></div><h2 class="ss-h2">Ticket Queue</h2><p class="ss-sub" style="color:var(--red)">Could not load tickets: ' + esc(e.message) + '</p></div>';
  });
}

// Filter bar (its own card) + a #ticket-tbody-wrap that alone re-renders on filter/sort,
// so typing in the search box never loses focus (same trick as My Appointments).
function _ticketQueueView() {
  var f = _TICKETS.filters || (_TICKETS.filters = {});
  function sel(id, cur, list, anyLabel, valOf, labOf) {
    return '<select id="' + id + '" class="ps-select ss-qf" onchange="_ticketQueueFilter()"><option value="">' + anyLabel + '</option>' +
      list.map(function(x){ var v = valOf ? valOf(x) : x; var l = labOf ? labOf(x) : x; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select>';
  }
  var statusSel = '<select id="tq-status" class="ps-select ss-qf" onchange="_ticketQueueFilter()"><option value="">All statuses</option>' +
    TICKET_STATUS.map(function(s){ return '<option value="' + s.code + '"' + (s.code === f.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') + '</select>';
  return '<div class="card ss-card"><div class="ss-rule"></div>' +
    '<div class="ss-qbar">' +
      '<input id="tq-q" class="ps-input ss-qf ss-qf-search" placeholder="Search ticket, rep, subject, office, DSI…" value="' + esc(f.q || '') + '" oninput="_ticketQueueFilter()">' +
      statusSel +
      sel('tq-assignee', f.assignee, _TICKETS.agents || [], 'All agents', function(a){ return a.email; }, function(a){ return a.name || a.email; }) +
      sel('tq-office', f.office, _TICKETS.lookups.office || [], 'All offices') +
      sel('tq-general', f.general, _TICKETS.lookups.generalCat || [], 'All categories') +
      sel('tq-channel', f.channel, TICKET_CHANNELS, 'Any channel') +
      '<span class="ss-qf-dates">From <input type="date" id="tq-from" class="ps-input ss-qf-date" value="' + esc(f.from || '') + '" onchange="_ticketQueueFilter()"> to <input type="date" id="tq-to" class="ps-input ss-qf-date" value="' + esc(f.to || '') + '" onchange="_ticketQueueFilter()"></span>' +
      '<button class="ps-btn secondary ss-qf-btn" onclick="renderTicketQueue()">Refresh</button>' +
    '</div></div>' +
    '<div id="ticket-tbody-wrap">' + _ticketTableHtml() + '</div>';
}

function _ticketQueueFilter() {
  var f = _TICKETS.filters;
  f.q = _ntVal('tq-q'); f.status = _ntVal('tq-status'); f.assignee = _ntVal('tq-assignee');
  f.office = _ntVal('tq-office'); f.general = _ntVal('tq-general'); f.channel = _ntVal('tq-channel');
  f.from = _ntVal('tq-from'); f.to = _ntVal('tq-to');
  var wrap = document.getElementById('ticket-tbody-wrap'); if (wrap) wrap.innerHTML = _ticketTableHtml();
}

function _ticketMatch(t, f) {
  if (f.status && String(t.status) !== f.status) return false;
  if (f.assignee && String(t.assignee) !== f.assignee) return false;
  if (f.office && String(t.office) !== f.office) return false;
  if (f.general && String(t.generalCategory) !== f.general) return false;
  if (f.channel && String(t.channel) !== f.channel) return false;
  var created = String(t.created || '').slice(0, 10);
  if (f.from && created && created < f.from) return false;
  if (f.to && created && created > f.to) return false;
  if (f.q) {
    var hay = [t.ticketId, t.requester, t.subject, t.office, t.dsi, t.specificCategory, t.generalCategory, t.assigneeName].join(' ').toLowerCase();
    if (hay.indexOf(f.q.toLowerCase()) === -1) return false;
  }
  return true;
}

function _ticketSortVal(t, key) {
  if (key === 'ticketId') { var m = String(t.ticketId || '').match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; }
  if (key === 'created' || key === 'lastUpdated') return String(t[key] || '');
  return String(t[key] || '').toLowerCase();
}
function _ticketSort(key) {
  var s = _TICKETS.sort;
  if (s.key === key) s.dir = (s.dir === 'asc' ? 'desc' : 'asc');
  else { s.key = key; s.dir = (key === 'created' || key === 'lastUpdated' || key === 'ticketId') ? 'desc' : 'asc'; }
  var wrap = document.getElementById('ticket-tbody-wrap'); if (wrap) wrap.innerHTML = _ticketTableHtml();
}
function _ticketTh(label, key) {
  var s = _TICKETS.sort; var ind = s.key === key ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return '<th onclick="_ticketSort(\'' + key + '\')" style="cursor:pointer;white-space:nowrap">' + esc(label) + ind + '</th>';
}

function _ticketStatusLabel(code) {
  for (var i = 0; i < TICKET_STATUS.length; i++) if (TICKET_STATUS[i].code === code) return TICKET_STATUS[i].label;
  return code || '—';
}
function _ticketStatusColor(code) { return { pending:'var(--blue2)', followup:'#e0a838', solved:'var(--green)' }[code] || 'var(--text2)'; }
function _ticketStatusBadge(code) {
  var col = _ticketStatusColor(code);
  return '<span class="ss-badge" style="color:' + col + ';border-color:' + col + '"><span class="ss-badge-dot" style="background:' + col + '"></span>' + esc(_ticketStatusLabel(code)) + '</span>';
}
function _ticketCat(t) {
  var g = t.generalCategory || '', sp = t.specificCategory || '';
  if (g && sp) return esc(g) + ' <span style="opacity:.55">›</span> ' + esc(sp);
  return esc(g || sp || '—');
}
// ── Shared UI bits (Pass 2 polish) ──
function _ssInitials(name) {
  var s = String(name || '').trim(); if (!s) return '?';
  var p = s.split(/\s+/);
  return ((p[0].charAt(0) || '') + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
}
function _ssAvatar(name) {   // deterministic muted-color circle with initials
  var str = String(name || ''), h = 0, i;
  for (i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return '<span class="ss-av" style="background:hsl(' + (h % 360) + ',42%,34%)">' + esc(_ssInitials(name)) + '</span>';
}
function _ssAgentCell(name) { return '<span class="ss-agentcell">' + _ssAvatar(name) + '<span>' + esc(name || '—') + '</span></span>'; }
function _ssEmpty(sym, title, sub) {
  return '<div class="ss-empty"><svg class="ss-empty-svg" viewBox="0 0 24 24"><use href="#i-' + sym + '"></use></svg>' +
    '<div class="ss-empty-t">' + esc(title) + '</div>' + (sub ? '<div class="ss-empty-s">' + esc(sub) + '</div>' : '') + '</div>';
}
function _ssLoading(label) {   // console scanning bar + label
  return '<div class="ss-loading"><div class="ss-loading-bar"></div><div class="ss-loading-lbl">' + esc(label || 'Loading…') + '</div></div>';
}

function _ticketTableHtml() {
  var f = _TICKETS.filters, s = _TICKETS.sort;
  var rows = (_TICKETS.list || []).filter(function(t){ return _ticketMatch(t, f); });
  rows.sort(function(a, b){ var av = _ticketSortVal(a, s.key), bv = _ticketSortVal(b, s.key); var r = av < bv ? -1 : (av > bv ? 1 : 0); return s.dir === 'asc' ? r : -r; });
  if (!rows.length) return '<div class="card ss-card">' + (_TICKETS.list.length
    ? '<p class="ss-sub" style="margin:0">No tickets match your filters.</p>'
    : _ssEmpty('postedsales', 'No tickets yet', 'Log the first one from New Ticket.')) + '</div>';
  var head = '<tr>' + _ticketTh('Ticket','ticketId') + _ticketTh('Created','created') + _ticketTh('Agent','assigneeName') +
    _ticketTh('Rep','requester') + _ticketTh('Office','office') + '<th>Category</th>' + _ticketTh('Subject','subject') + _ticketTh('Status','status') + '</tr>';
  var body = rows.map(function(t){
    return '<tr class="ss-row" onclick="openTicketDetail(\'' + esc(t.ticketId) + '\')">' +
      '<td class="ss-tid" style="white-space:nowrap">' + esc(t.ticketId) + '</td>' +
      '<td style="white-space:nowrap">' + esc(_ticketFmtDate(t.created)) + '</td>' +
      '<td>' + _ssAgentCell(t.assigneeName || t.assignee) + '</td>' +
      '<td>' + esc(t.requester || '—') + '</td>' +
      '<td>' + esc(t.office || '—') + '</td>' +
      '<td>' + _ticketCat(t) + '</td>' +
      '<td>' + esc(t.subject || '—') + '</td>' +
      '<td>' + _ticketStatusBadge(t.status) + '</td>' +
    '</tr>';
  }).join('');
  return '<div class="card ss-card ss-tablewrap"><table class="tbl ss-table">' + head + body + '</table>' +
    '<p class="ss-sub" style="margin:10px 0 0">' + rows.length + ' of ' + _TICKETS.list.length + ' ticket' + (_TICKETS.list.length === 1 ? '' : 's') + '</p></div>';
}

function _ticketFmtDate(iso) {
  if (!iso) return '—';
  var d = new Date(iso); if (isNaN(d.getTime())) return String(iso);
  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

// ── FOLLOW-UPS (Slice 6) ────────────────────────────────────────────────────
// The queue pre-filtered to status=followup, oldest-first (most overdue on top) with an
// age column. Same tickets the daily 06:00-PT reminder emails. Reuses openTicketDetail;
// marking one Solved in the modal drops it from this list in place (via _TICKETS.render).
function renderTicketFollowups() {
  var c = document.getElementById('main-content'); if (!c) return;
  if (!TICKET_SCRIPT_URL) { c.innerHTML = _ticketScaffold('Follow-Ups', 'Backend not connected in this preview.', ''); return; }
  var hdr = '<div class="card ss-card"><div class="ss-rule"></div><h2 class="ss-h2">Follow-Ups</h2>' +
    '<p class="ss-sub">Tickets marked “Follow-up (Need Response),” oldest first. These feed the daily 6:00 AM reminder.</p></div>';
  c.innerHTML = '<div class="card ss-card"><div class="ss-rule"></div><h2 class="ss-h2">Follow-Ups</h2>' + _ssLoading('Loading…') + '</div>';
  Promise.all([ _ticketGet({ action:'getTickets' }), _ticketGet({ action:'getAgents' }) ]).then(function(r) {
    _TICKETS.list = (r[0] && r[0].tickets) || [];
    if (r[1] && r[1].agents) _TICKETS.agents = r[1].agents;
    _TICKETS.render = _followupTableHtml;
    c.innerHTML = hdr + '<div id="ticket-tbody-wrap">' + _followupTableHtml() + '</div>';
  }).catch(function(e) {
    c.innerHTML = '<div class="card ss-card"><div class="ss-rule"></div><h2 class="ss-h2">Follow-Ups</h2><p class="ss-sub" style="color:var(--red)">Could not load: ' + esc(e.message) + '</p></div>';
  });
}
function _ageDays(iso) {
  if (!iso) return 0;
  var t = new Date(iso).getTime(); if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}
function _followupTableHtml() {
  var rows = (_TICKETS.list || []).filter(function(t){ return String(t.status) === 'followup'; });
  rows.sort(function(a, b){ var av = String(a.lastUpdated || a.created || ''), bv = String(b.lastUpdated || b.created || ''); return av < bv ? -1 : (av > bv ? 1 : 0); });   // oldest first
  if (!rows.length) return '<div class="card ss-card">' + _ssEmpty('completed', 'No open follow-ups', 'The Order rests. ✦') + '</div>';
  var head = '<tr><th>Ticket</th><th>Age</th><th>Rep</th><th>Office</th><th>Subject</th><th>Assignee</th></tr>';
  var body = rows.map(function(t){
    var age = _ageDays(t.lastUpdated || t.created);
    var col = age >= 2 ? '#e0a838' : 'var(--text2)';
    return '<tr class="ss-row" onclick="openTicketDetail(\'' + esc(t.ticketId) + '\')">' +
      '<td class="ss-tid" style="white-space:nowrap">' + esc(t.ticketId) + '</td>' +
      '<td style="white-space:nowrap;color:' + col + '">' + age + 'd</td>' +
      '<td>' + esc(t.requester || '—') + '</td>' +
      '<td>' + esc(t.office || '—') + '</td>' +
      '<td>' + esc(t.subject || '—') + '</td>' +
      '<td>' + _ssAgentCell(t.assigneeName || t.assignee) + '</td>' +
    '</tr>';
  }).join('');
  return '<div class="card ss-card ss-tablewrap"><table class="tbl ss-table">' + head + body + '</table>' +
    '<p class="ss-sub" style="margin:10px 0 0">' + rows.length + ' open follow-up' + (rows.length === 1 ? '' : 's') + '</p></div>';
}

// ── Ticket detail (Slice 5: interactive — status / reassign / toggles / note thread) ──
// The open ticket + its notes live in _TICKETS.open; every action posts to the backend,
// then updates that state + the queue row in place (no full refetch).
function openTicketDetail(id) {
  var modal = document.getElementById('ticket-modal'); if (!modal) return;
  var body = document.getElementById('ticket-modal-body'), title = document.getElementById('ticket-modal-title');
  if (title) title.textContent = 'Ticket ' + id;
  if (body) body.innerHTML = _ssLoading('Loading…');
  modal.classList.add('open');
  _ticketGet({ action:'getTicket', ticketId:id }).then(function(res){
    if (!res || !res.ticket) { body.innerHTML = '<p style="color:var(--red)">Could not load ticket.</p>'; return; }
    _TICKETS.open = { ticket:res.ticket, notes:res.notes || [] };
    _renderTicketDetail();
  }).catch(function(e){ body.innerHTML = '<p style="color:var(--red)">Error: ' + esc(e.message) + '</p>'; });
}
function closeTicketModal() {
  var m = document.getElementById('ticket-modal'); if (m) m.classList.remove('open');
  _TICKETS.open = null;
}
function _renderTicketDetail() {
  var body = document.getElementById('ticket-modal-body');
  if (body && _TICKETS.open) body.innerHTML = _ticketDetailHtml(_TICKETS.open.ticket, _TICKETS.open.notes);
}
function _dt(label, valHtml) { return '<div class="ss-dt"><span class="ss-lbl">' + esc(label) + '</span><span>' + (valHtml || '—') + '</span></div>'; }
function _ticketDetailHtml(t, notes) {
  var agents = (_TICKETS.agents && _TICKETS.agents.length) ? _TICKETS.agents : (t.assignee ? [{ email:t.assignee, name:t.assigneeName || t.assignee }] : []);
  var statusSel = '<select class="ps-select" onchange="_ticketSetStatus(this.value)">' +
    TICKET_STATUS.map(function(s){ return '<option value="' + s.code + '"' + (s.code === t.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') + '</select>';
  var asgSel = '<select class="ps-select" onchange="_ticketReassign(this.value)">' +
    agents.map(function(a){ return '<option value="' + esc(a.email) + '"' + (a.email === t.assignee ? ' selected' : '') + '>' + esc(a.name || a.email) + '</option>'; }).join('') + '</select>';
  var header = '<div class="ss-td-head">' +
    '<div class="ss-td-headmain">' +
      '<h4 class="ss-dsubj">' + (t.subject ? esc(t.subject) : '<span style="opacity:.55">(no subject)</span>') + '</h4>' +
      '<div class="ss-td-sub"><span class="ss-tid">' + esc(t.ticketId) + '</span> · opened by ' + esc(t.createdByName || t.createdBy || '—') + ' · ' + esc(_ticketFmtDate(t.created)) + '</div>' +
    '</div>' + _ticketStatusBadge(t.status) +
  '</div>';
  var notesHtml = notes.length ? notes.map(function(n){
      var who = n.authorName || n.author;
      return '<div class="ss-note"><div class="ss-note-hd">' + _ssAvatar(who) + '<span>' + esc(who) + ' · ' + esc(_ticketFmtDate(n.timestamp)) + '</span></div><div class="ss-note-body">' + esc(n.body).replace(/\n/g, '<br>') + '</div></div>';
    }).join('') : '<p class="ss-sub" style="margin:0 0 6px">No notes yet — add the first one below.</p>';
  var main = '<div class="ss-td-main">' +
    '<div class="ss-lbl" style="margin-bottom:8px">Conversation</div>' +
    '<div class="ss-td-thread">' + notesHtml + '</div>' +
    '<textarea id="td-note" class="ps-textarea" rows="3" placeholder="Add a note to the thread…"></textarea>' +
    '<div class="ss-actions"><button class="ps-btn" onclick="_ticketAddNote()">Add Note</button><span id="td-status" class="ss-status"></span></div>' +
  '</div>';
  var side = '<div class="ss-td-side">' +
    '<div class="ss-side-grp">' + _dt('Status', statusSel) + _dt('Assignee', asgSel) + '</div>' +
    '<div class="ss-side-grp">' +
      _dt('Requester (Rep)', esc(t.requester)) +
      _dt('Office', esc(t.office)) +
      _dt('Channel', esc(t.channel)) +
      _dt('Phone', esc(t.phone)) +
      _dt('Category', _ticketCat(t)) +
      _dt('Sara Plus', esc(t.saraPlus)) +
      _dt('DSI / Account', esc(t.dsi)) +
      _dt('Tags', esc(t.tags)) +
    '</div>' +
    '<div class="ss-side-grp">' +
      '<label class="ss-chk"><input type="checkbox" ' + (t.calledBack ? 'checked' : '') + ' onchange="_ticketToggle(\'calledBack\',this.checked)"> Called Back</label>' +
      '<label class="ss-chk"><input type="checkbox" ' + (t.reviewApproval ? 'checked' : '') + ' onchange="_ticketToggle(\'reviewApproval\',this.checked)"> Review Approval</label>' +
    '</div>' +
  '</div>';
  return header + '<div class="ss-td-grid">' + main + side + '</div>';
}

// ── Detail actions (in-place; every agent can modify any ticket) ──
function _tdStatus(msg, isErr) { var el = document.getElementById('td-status'); if (el) { el.textContent = msg || ''; el.style.color = isErr ? 'var(--red)' : 'var(--text2)'; } }
function _ticketSyncListRow(u) {
  if (!u) return;
  for (var i = 0; i < (_TICKETS.list || []).length; i++) { if (_TICKETS.list[i].ticketId === u.ticketId) { _TICKETS.list[i] = u; break; } }
  var wrap = document.getElementById('ticket-tbody-wrap'); if (wrap) wrap.innerHTML = (_TICKETS.render || _ticketTableHtml)();   // keep the active list (queue or follow-ups) live
}
function _ticketOpenId() { return _TICKETS.open && _TICKETS.open.ticket ? _TICKETS.open.ticket.ticketId : null; }
function _ticketSetStatus(code) {
  var id = _ticketOpenId(); if (!id) return; _tdStatus('Saving…');
  _ticketPost({ action:'setTicketStatus', ticketId:id, status:code }).then(function(res){
    if (res && res.ok && res.ticket) { _TICKETS.open.ticket = res.ticket; _ticketSyncListRow(res.ticket); _renderTicketDetail(); }
    else _tdStatus((res && res.error) || 'Could not update status.', true);
  }).catch(function(e){ _tdStatus('Error: ' + e.message, true); });
}
function _ticketReassign(email) {
  var id = _ticketOpenId(); if (!id) return; _tdStatus('Saving…');
  _ticketPost({ action:'reassignTicket', ticketId:id, assignee:email }).then(function(res){
    if (res && res.ok && res.ticket) { _TICKETS.open.ticket = res.ticket; _ticketSyncListRow(res.ticket); _renderTicketDetail(); }
    else _tdStatus((res && res.error) || 'Could not reassign.', true);
  }).catch(function(e){ _tdStatus('Error: ' + e.message, true); });
}
function _ticketToggle(field, checked) {
  var id = _ticketOpenId(); if (!id) return; _tdStatus('Saving…');
  var body = { action:'updateTicket', ticketId:id }; body[field] = checked;
  _ticketPost(body).then(function(res){
    if (res && res.ok && res.ticket) { _TICKETS.open.ticket = res.ticket; _ticketSyncListRow(res.ticket); _tdStatus('Saved.'); }
    else _tdStatus((res && res.error) || 'Could not save.', true);
  }).catch(function(e){ _tdStatus('Error: ' + e.message, true); });
}
function _ticketAddNote() {
  var id = _ticketOpenId(); if (!id) return;
  var ta = document.getElementById('td-note'); var text = ta ? ta.value.trim() : '';
  if (!text) { _tdStatus('Write a note first.', true); return; }
  _tdStatus('Adding…');
  _ticketPost({ action:'addTicketNote', ticketId:id, note:text }).then(function(res){
    if (res && res.ok && res.note) {
      _TICKETS.open.notes.push(res.note);
      _TICKETS.open.ticket.lastUpdated = res.note.timestamp;
      _ticketSyncListRow(_TICKETS.open.ticket);
      _renderTicketDetail();
    } else _tdStatus((res && res.error) || 'Could not add note.', true);
  }).catch(function(e){ _tdStatus('Error: ' + e.message, true); });
}

// Close the ticket modal on backdrop click (registered once; harmless for other offices).
(function(){
  var m = document.getElementById('ticket-modal');
  if (m) m.addEventListener('click', function(e){ if (e.target === this) closeTicketModal(); });
})();

// A themed placeholder card — deep-space panel, lightsaber-blue title, green accent
// rule, small Jedi flourish. Purely a scaffold marker; replaced screen-by-screen.
function _ticketScaffold(title, body, note) {
  return '' +
    '<div class="card" style="max-width:720px">' +
      '<div style="height:3px;border-radius:3px;background:linear-gradient(90deg,var(--blue2),var(--accent2b));margin:-2px 0 18px"></div>' +
      '<h2 style="color:var(--blue2);margin:0 0 8px">' + esc(title) + '</h2>' +
      '<p style="color:var(--text2);line-height:1.55;margin:0 0 14px">' + esc(body) + '</p>' +
      (note ? '<div class="badge" style="background:var(--blue2-fade);color:var(--blue2);border:1px solid var(--border)">' + esc(note) + '</div>' : '') +
      '<p style="color:var(--text2);opacity:.6;margin:18px 0 0;font-size:12px;letter-spacing:.3px">The Order is assembling. ✦</p>' +
    '</div>';
}
