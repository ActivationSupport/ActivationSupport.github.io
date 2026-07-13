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
var TICKET_SCRIPT_URL = '';   // ⏳ Slice 2: paste the new ticketing /exec URL here
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
  var nameEl = document.getElementById('sb-user-name');
  if (nameEl) nameEl.textContent = (SESSION.name || SESSION.email || '') + (SESSION.role ? ' · ' + SESSION.role : '');
  switchTab(CURRENT_TAB || 'tickets');
}

// Router for the three screens (called from app.data.js renderTab when the office is
// salessupport). Slices 3–6 replace each placeholder with the real screen.
function renderTicketTab(id) {
  var c = document.getElementById('main-content');
  if (!c) return;
  if (id === 'tickets')        c.innerHTML = _ticketScaffold('Ticket Queue', 'Every ticket the Order works — searchable, filterable, sortable. Open one to see its full thread.', 'Coming in Slice 4.');
  else if (id === 'newticket') renderNewTicket();
  else if (id === 'followups') c.innerHTML = _ticketScaffold('Follow-Ups', 'Tickets marked “Follow-up / Need Response,” aged by how long they have waited. This feeds the 6:00 AM reminder.', 'Coming in Slice 6.');
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
function _newTicketFormHtml() {
  var chan = '<select id="nt-channel" class="ps-select"><option value="">—</option>' +
    TICKET_CHANNELS.map(function(x){ return '<option>' + esc(x) + '</option>'; }).join('') + '</select>';
  var sara = '<select id="nt-sara" class="ps-select"><option value="">—</option>' +
    TICKET_SARA.map(function(x){ return '<option>' + esc(x) + '</option>'; }).join('') + '</select>';
  var me = (SESSION && (SESSION.name || SESSION.email)) || '';
  var assignee = '<select id="nt-assignee" class="ps-select"><option value="' + esc((SESSION&&SESSION.email)||'') + '" selected>' + esc(me || 'Me') + '</option></select>';
  return '' +
  '<div class="card ss-card" style="max-width:860px">' +
    '<div class="ss-rule"></div>' +
    '<h2 class="ss-h2">New Ticket</h2>' +
    '<p class="ss-sub">Log a rep call or text. Office, rep, and categories remember what you type.</p>' +
    '<div class="ss-grid">' +
      _ntField('Requester (Rep)', '<input id="nt-requester" class="ps-input" list="nt-reps" autocomplete="off" placeholder="Rep name"><datalist id="nt-reps"></datalist>') +
      _ntField('Office', '<input id="nt-office" class="ps-input" list="nt-offices" autocomplete="off" placeholder="Office"><datalist id="nt-offices"></datalist>') +
      _ntField('Channel', chan) +
      _ntField('Phone #', '<input id="nt-phone" class="ps-input" autocomplete="off" placeholder="Called / texted in from">') +
      _ntField('Subject', '<input id="nt-subject" class="ps-input" autocomplete="off" placeholder="Short summary">', 'ss-fld--full') +
      _ntField('General Category', '<input id="nt-general" class="ps-input" list="nt-gencats" autocomplete="off" oninput="_ticketOnGeneralChange()" placeholder="e.g. Escalations"><datalist id="nt-gencats"></datalist>') +
      _ntField('Specific Category', '<input id="nt-specific" class="ps-input" list="nt-speccats" autocomplete="off" placeholder="e.g. Fraud Support"><datalist id="nt-speccats"></datalist>') +
      _ntField('Sara Plus', sara) +
      _ntField('DSI / Account', '<input id="nt-dsi" class="ps-input" autocomplete="off" placeholder="DSI or account info">') +
      _ntField('Assignee', assignee) +
      _ntField('Tags', '<input id="nt-tags" class="ps-input" autocomplete="off" placeholder="comma, separated">') +
    '</div>' +
    '<div class="ss-checks">' +
      '<label class="ss-chk"><input type="checkbox" id="nt-calledback"> Called Back</label>' +
      '<label class="ss-chk"><input type="checkbox" id="nt-review"> Review Approval</label>' +
    '</div>' +
    _ntField('Notes', '<textarea id="nt-note" class="ps-textarea" rows="4" placeholder="What happened / what’s needed"></textarea>') +
    '<div class="ss-actions">' +
      '<button id="nt-submit" class="ps-btn" onclick="_ticketCreate(event)">Create Ticket</button>' +
      '<span id="nt-status" class="ss-status"></span>' +
    '</div>' +
  '</div>';
}

// Fetch the save-as-you-go lists + agents (once), then fill the controls. Safe no-op
// (and a gentle hint) while TICKET_SCRIPT_URL is still empty in the preview.
function _ticketLoadFormData() {
  _ticketFillLookups();   // paint whatever we already have cached
  if (!TICKET_SCRIPT_URL) { _ntStatus('Preview mode — backend not connected yet (dropdowns fill once it is).', false); return; }
  Promise.all([
    _ticketGet({ action:'getLookups' }),
    _ticketGet({ action:'getAgents' })
  ]).then(function(r) {
    if (r[0] && r[0].lookups) _TICKETS.lookups = r[0].lookups;
    if (r[1] && r[1].agents)  _TICKETS.agents  = r[1].agents;
    _TICKETS._loaded = true;
    _ticketFillLookups();
    _ticketFillAgents();
  }).catch(function(){ /* leave the form usable with empty lists */ });
}
function _ticketFillDatalist(id, values) {
  var dl = document.getElementById(id); if (!dl) return;
  dl.innerHTML = (values || []).map(function(v){ return '<option value="' + esc(v) + '">'; }).join('');
}
function _ticketFillLookups() {
  var lk = _TICKETS.lookups || {};
  _ticketFillDatalist('nt-reps', lk.rep || []);
  _ticketFillDatalist('nt-offices', lk.office || []);
  _ticketFillDatalist('nt-gencats', lk.generalCat || []);
  _ticketOnGeneralChange();   // specifics depend on the chosen general
}
function _ticketFillAgents() {
  var sel = document.getElementById('nt-assignee'); if (!sel || !_TICKETS.agents.length) return;
  var mine = (SESSION && SESSION.email) || '';
  sel.innerHTML = _TICKETS.agents.map(function(a){
    return '<option value="' + esc(a.email) + '"' + (a.email === mine ? ' selected' : '') + '>' + esc(a.name || a.email) + '</option>';
  }).join('');
}
// Specific-category datalist shows the specifics under the currently-typed general
// (case-insensitive); with no/unknown general it shows all specifics. Free-type still allowed.
function _ticketOnGeneralChange() {
  var gen = (document.getElementById('nt-general') || {}).value || '';
  gen = String(gen).trim().toLowerCase();
  var specs = (_TICKETS.lookups.specificCat || []);
  var filtered = specs.filter(function(s){ return !gen || String(s.parent||'').trim().toLowerCase() === gen; });
  if (!filtered.length) filtered = specs;   // unknown general → don't hide everything
  _ticketFillDatalist('nt-speccats', filtered.map(function(s){ return s.value; }));
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
  _ticketOnGeneralChange();
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
