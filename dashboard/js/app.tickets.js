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
  else if (id === 'newticket') c.innerHTML = _ticketScaffold('New Ticket', 'The intake form: Requester (rep), Office, Channel, Call Reason (General → Specific), Sara Plus, DSI, notes — with save-as-you-go dropdowns.', 'Coming in Slice 3.');
  else if (id === 'followups') c.innerHTML = _ticketScaffold('Follow-Ups', 'Tickets marked “Follow-up / Need Response,” aged by how long they have waited. This feeds the 6:00 AM reminder.', 'Coming in Slice 6.');
  else                          c.innerHTML = _ticketScaffold('Sales Support', 'Select a screen from the sidebar.', '');
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
