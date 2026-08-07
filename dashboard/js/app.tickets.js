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

// Each agent's home timezone → the "You" side of the office dual-clock.
// Gavon/Ryan/Amber = Pacific · Jada (New England) = Eastern · Cammy (Louisiana) = Central.
var SALESSUPPORT_AGENT_TZ = {
  'gavonfuller2024@gmail.com':'America/Los_Angeles', 'ryan.turner.50@gmail.com':'America/Los_Angeles',
  'amb3ranastasia@gmail.com':'America/Los_Angeles', 'jadwil893@gmail.com':'America/New_York',
  'kambrynchaisson@gmail.com':'America/Chicago'
};

// Module state (grows with each slice). lookups drive the save-as-you-go datalists;
// agents drive the Assignee picker; list/filters/sort are for the queue (Slice 4).
var _TICKETS = {
  lookups: { office:[], rep:[], generalCat:[], specificCat:[] },
  agents: [],
  offices: [], _officeLabels: [], _officeByLabel: {}, _officesLoaded: false, _officesLoading: false, _clockTimer: null,
  contacts: [], _contactsLoaded: false, _contactsLoading: false,
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
/* ⚠⚠ NEVER CALL r.json() DIRECTLY ON AN APPS SCRIPT RESPONSE.
   This is the bug reps were hitting: `/exec` does not always return JSON. Google serves an
   HTML page for an execution error, a timeout, a quota trip or an auth interstitial, and
   r.json() then throws a PARSER error whose text leaks straight to the user. On iOS Safari
   that text is "The string did not match the expected pattern." — which is what the rep
   screenshotted, and which tells them nothing.
   Two further consequences that made it worse:
     · _authIntercept only ever sees PARSED JSON, so an expired badge arriving as an HTML
       login page could never be routed to a clean re-login.
     · The caller could not tell "definitely not saved" from "maybe saved" — the difference
       between safely retrying and creating a duplicate.
   So: read TEXT, parse it ourselves, and classify the failure. */
function _ticketParse(r) {
  return r.text().then(function(t) {
    var j = null;
    try { j = JSON.parse(t); } catch (e) { j = null; }
    if (j) return _authIntercept(j);

    var body = String(t || '');
    var err;
    if (/<form[^>]+accounts\.google\.com|ServiceLogin|signin\/v2/i.test(body)) {
      err = new Error('Your sign-in expired. Please sign in again — your ticket has NOT been saved.');
      err.ticketAuth = true;
    } else if (/exceeded|quota|too many/i.test(body)) {
      err = new Error('Sales Support is rate-limited right now. Wait a moment and press Create Ticket again — it is safe to retry.');
      err.ticketRetryable = true;
    } else {
      err = new Error('The Sales Support server did not answer properly (HTTP ' + r.status + '). Your details are still here — press Create Ticket again.');
      err.ticketRetryable = true;
    }
    err.ticketTransport = true;   // "we never got a usable answer", NOT "the server said no"
    throw err;
  });
}
/* POSTed, not GET — see the note on api() in app.core.js. A GET would put the live session
   badge in the URL, and Apps Script gives no access to request headers. `_read:true` routes
   into the ticketing backend's doGet verbatim.
   🔴 Requires the redeployed Sales Support Ticketing backend (verified 2026-08-04).
   ⚠ Still goes through _ticketParse, so a non-JSON response is still classified rather than
   leaking a WebKit parser string to the rep. */
function _ticketGet(params) {
  var p = Object.assign({}, params, { key: API_KEY, officeId: CFG.officeId, _read: true });
  if (SESSION && SESSION.token) p.token = SESSION.token;
  return fetch(TICKET_SCRIPT_URL, {
    method:'POST', redirect:'follow',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },   // no CORS preflight
    body: JSON.stringify(p)
  }).then(_ticketParse);
}
function _ticketPost(body) {
  var extra = (SESSION && SESSION.token) ? { key: API_KEY, token: SESSION.token, officeId: CFG.officeId } : { key: API_KEY, officeId: CFG.officeId };
  return fetch(TICKET_SCRIPT_URL, {
    method:'POST', redirect:'follow',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({}, body, extra))
  }).then(_ticketParse);
}

// Entry point from showApp() — renders whatever tab we landed on. (Data fetching for
// the queue/detail/follow-ups arrives with those slices; the scaffold just paints.)
// We also set the sidebar username here because salessupport skips loadData/_applyMainData
// (where every other office sets it).
function initTicketApp() {
  var sb = document.getElementById('sb-office-name'); if (sb) sb.innerHTML = _ssLogoSvg(46);   // OUTLINE wordmark — same as the login page (a touch larger + a glow, added in CSS, keep it legible)
  var nameEl = document.getElementById('sb-user-name');
  if (nameEl) nameEl.innerHTML = '<div class="ss-sb-role">' + esc(SESSION.role || 'agent') + '</div>' +
    '<div class="ss-sb-email" title="' + esc(SESSION.email || '') + '">' + esc(SESSION.email || '') + '</div>';
  _ssInstallCanopy();
  _ssLoadOffices();                                                                       // pre-load the office directory (once)
  _ssLoadContacts();                                                                      // pre-load the rep contact directory (once)
  if (!_TICKETS._clockTimer) _TICKETS._clockTimer = setInterval(_ssTickClocks, 20000);    // keep every office/you clock live
  switchTab(CURRENT_TAB || 'newticket');
}
// The Millennium-Falcon DOME windscreen frame — our own SVG (crisp; gradient-drawn CSS moires), handed to
// CSS as --ss-canopy (used by html[data-office=salessupport] #app .content::after). Matches the schematic
// shape: an OPEN central circular port + concentric arches + radial ribs (ribs start at the port rim so the
// port stays a clean window) fanning up from the console point (cx,cy). Rendered as real, top-LIT metal:
// wide dark base (gap/shadow) → body → a vertical steel gradient (bright up top, dark below = overhead light)
// → thin bright spine, with bolt rivets at the arch↔rib intersections. Idempotent (once per session).
function _ssInstallCanopy() {
  var cx = 800, cy = 840;
  var arches = [175, 370, 560, 755, 970];                                   // innermost = the open port
  var angles = [0, 17, 34, 51, 68, 86, 104, -17, -34, -51, -68, -86, -104]; // radial ribs (deg from straight up)
  var Ro = 1060, Ri = arches[0];
  var shapes = '';
  arches.forEach(function(r){ shapes += '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'"/>'; });
  angles.forEach(function(a){ var t = a * Math.PI / 180;
    shapes += '<line x1="'+Math.round(cx + Ri*Math.sin(t))+'" y1="'+Math.round(cy - Ri*Math.cos(t))+'" ' +
                    'x2="'+Math.round(cx + Ro*Math.sin(t))+'" y2="'+Math.round(cy - Ro*Math.cos(t))+'"/>';
  });
  var rivets = '';
  [arches[0], arches[1], arches[2], arches[3]].forEach(function(r){
    angles.forEach(function(a){ var t = a * Math.PI / 180;
      rivets += '<circle cx="'+Math.round(cx + r*Math.sin(t))+'" cy="'+Math.round(cy - r*Math.cos(t))+'" r="5.5"/>'; });
  });
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000">' +
    '<defs>' +
      '<linearGradient id="ssLit" x1="0" y1="0" x2="0" y2="1000" gradientUnits="userSpaceOnUse">' +
        '<stop offset="0" stop-color="#b8c2c6"/><stop offset="0.5" stop-color="#5e686e"/><stop offset="1" stop-color="#2a3236"/>' +
      '</linearGradient>' +
      '<g id="s" fill="none" stroke-linecap="round" stroke-linejoin="round">' + shapes + '</g>' +
    '</defs>' +
    '<use href="#s" stroke="#12171a" stroke-width="36"/>' +        /* wide dark base — the gap/shadow between beams */
    '<use href="#s" stroke="#333c42" stroke-width="26"/>' +        /* body */
    '<use href="#s" stroke="url(#ssLit)" stroke-width="17"/>' +    /* top-lit steel gradient (overhead light) */
    '<use href="#s" stroke="#aeb8bc" stroke-width="3" opacity="0.7"/>' +   /* thin bright spine */
    '<g fill="#20272b" stroke="#9aa4a8" stroke-width="1.4">' + rivets + '</g>' +   /* bolts: dark head, lit rim */
    '</svg>';
  document.documentElement.style.setProperty('--ss-canopy', 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")');
  _ssInstallPlanet();
}
// An original Alderaan-style world (NOT anyone's photo) for the view out the windscreen: a LIT sphere
// with a teal ocean base, procedural GREEN landmasses + heavy WHITE cloud swirls (two fractal-noise
// layers), a day/night terminator, and an atmosphere rim — all clipped to the disc. Set as CSS var
// --ss-planet → a background layer on .content (behind the starfield + frame), slightly right of centre.
function _ssInstallPlanet() {
  var p = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
    '<defs>' +
      '<radialGradient id="pS" cx="34%" cy="29%" r="84%">' +   /* lit teal ocean (highlight upper-left) */
        '<stop offset="0" stop-color="#e3f1ff"/><stop offset="16%" stop-color="#8ec6d8"/>' +
        '<stop offset="40%" stop-color="#3f8ca2"/><stop offset="64%" stop-color="#1e5a70"/>' +
        '<stop offset="85%" stop-color="#0c3044"/><stop offset="100%" stop-color="#051622"/>' +
      '</radialGradient>' +
      '<radialGradient id="pT" cx="32%" cy="27%" r="92%">' +   /* day→night terminator (dark on the far side) */
        '<stop offset="0" stop-color="rgba(0,0,0,0)"/><stop offset="52%" stop-color="rgba(0,0,0,0)"/>' +
        '<stop offset="82%" stop-color="rgba(2,7,11,.55)"/><stop offset="100%" stop-color="rgba(0,2,5,.92)"/>' +
      '</radialGradient>' +
      '<radialGradient id="pA" cx="50%" cy="50%" r="50%">' +   /* atmosphere rim */
        '<stop offset="80%" stop-color="rgba(150,205,255,0)"/><stop offset="95%" stop-color="rgba(160,212,255,.55)"/><stop offset="100%" stop-color="rgba(160,212,255,0)"/>' +
      '</radialGradient>' +
      '<filter id="pL" x="0" y="0" width="100%" height="100%">' +   /* GREEN landmasses */
        '<feTurbulence type="fractalNoise" baseFrequency="0.013 0.021" numOctaves="4" seed="6" result="n"/>' +
        '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.30  0 0 0 0 0.49  0 0 0 0 0.27  0 0 0 2.7 -1.02"/>' +
      '</filter>' +
      '<filter id="pC" x="0" y="0" width="100%" height="100%">' +   /* WHITE cloud swirls */
        '<feTurbulence type="fractalNoise" baseFrequency="0.021 0.034" numOctaves="5" seed="15" result="n"/>' +
        '<feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.9 -0.66"/>' +
      '</filter>' +
      '<clipPath id="pClip"><circle cx="100" cy="100" r="93"/></clipPath>' +
    '</defs>' +
    '<g clip-path="url(#pClip)">' +
      '<circle cx="100" cy="100" r="93" fill="url(#pS)"/>' +                              /* ocean */
      '<rect x="0" y="0" width="200" height="200" filter="url(#pL)" opacity="0.6"/>' +    /* land */
      '<rect x="0" y="0" width="200" height="200" filter="url(#pC)" opacity="0.55"/>' +   /* clouds */
      '<rect x="0" y="0" width="200" height="200" fill="url(#pT)"/>' +                     /* terminator */
    '</g>' +
    '<circle cx="100" cy="100" r="93" fill="url(#pA)"/>' +                                 /* atmosphere rim */
    '</svg>';
  document.documentElement.style.setProperty('--ss-planet', 'url("data:image/svg+xml,' + encodeURIComponent(p) + '")');
}

// Router for the three screens (called from app.data.js renderTab when the office is
// salessupport). Slices 3–6 replace each placeholder with the real screen.
function renderTicketTab(id) {
  var c = document.getElementById('main-content');
  if (!c) return;
  if (id === 'tickets')        renderTicketQueue();
  else if (id === 'newticket') renderNewTicket();
  else if (id === 'followups') renderTicketFollowups();
  else if (id === 'contacts')  renderRepContacts();
  else                          c.innerHTML = _ticketScaffold('Sales Support', 'Select a screen from the sidebar.', '');
}

// ── NEW TICKET (Slice 3) ────────────────────────────────────────────────────
// One-screen intake. Office / Rep / General / Specific are save-as-you-go via native
// <datalist> (free-type + autocomplete from prior values; new values are remembered
// server-side on create). Assignee defaults to the current agent.
function renderNewTicket() {
  var c = document.getElementById('main-content'); if (!c) return;
  // Form + the requester rail beside it (stacks underneath on narrow screens).
  c.innerHTML = '<div class="ss-nt-wrap">' + _newTicketFormHtml() +
    '<aside id="nt-reqpanel" class="ss-rp-rail">' + _ssRequesterPanelHtml('') + '</aside></div>';
  // Put back anything a previous render was holding. This is what makes leaving the tab,
  // an expired badge, or an iOS tab-reload non-destructive.
  if (_ntRestoreDraft()) {
    _ntStatus('Your unsaved ticket was restored — press Create Ticket when ready.', false);
    _ssSyncRequesterPanel('nt');
  }
  // Keep the draft current as they type, so nothing depends on remembering to capture.
  var wrap = c.querySelector('.ss-nt-wrap');
  if (wrap) {
    wrap.addEventListener('input', _ntCaptureDraft);
    wrap.addEventListener('change', _ntCaptureDraft);
  }
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
        _ntField('Requester (Rep)', _comboField('nt-requester', { placeholder:'Rep name', options:function(){ return _TICKETS.lookups.rep || []; }, onChange:function(){ _ntAutofillRep('nt'); _ssSyncRequesterPanel('nt'); }, onInput:function(){ _ssSyncRequesterPanel('nt'); }, onAdd:function(t){ _ssRepAddPopup(t, 'nt'); } })) +
        _ntField('Office', _comboField('nt-office', { placeholder:'Owner — Company', options:function(){ return _TICKETS._officeLabels || []; }, onChange:function(){ _ntOfficeChange('nt'); _ssSyncRequesterPanel('nt'); }, onAdd:function(t){ _ssOfficeAddPopup(t, 'nt'); } })) +
        _ntField('Channel', chan) +
        _ntField('Phone #', _comboField('nt-phone', { placeholder:'Called / texted in from', options:_ntKnownPhones, onChange:function(){ _ntPhoneLookup('nt'); _ssSyncRequesterPanel('nt'); }, onInput:function(){ _ntPhoneLookup('nt'); _ssSyncRequesterPanel('nt'); }, onBlur:function(){ _ssPhoneBlur('nt-phone'); _ssSyncRequesterPanel('nt'); }, noAdd:true })) +
      '</div>' +
      '<div class="ss-contact-row">' +
        '<div id="nt-clock" class="ss-clock-strip"></div>' +
        '<div class="ss-contact-save">' +
          '<button type="button" id="nt-save-contact" class="ps-btn secondary" onclick="_ntSaveContactLink(event)">Save Link</button>' +
          '<span id="nt-contact-status" class="ss-status"></span>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ss-form-sec">' + _ntSec('Classification') +
      '<div class="ss-grid">' +
        _ntField('General Category', _comboField('nt-general', { placeholder:'e.g. Escalations', options:function(){ return _TICKETS.lookups.generalCat || []; }, addTitle:'Add General Category', lookupType:'generalCat' })) +
        _ntField('Specific Category', _comboField('nt-specific', { placeholder:'e.g. Fraud Support', options:_ticketSpecificOptions, addTitle:'Add Specific Category', lookupType:'specificCat', lookupParent:function(){ return _ntVal('nt-general'); } })) +
        _ntField('Sara Plus', sara) +
        _ntField('DSI / Account', '<input id="nt-dsi" class="ps-input" autocomplete="off" placeholder="DSI or account info">') +
      '</div>' +
    '</div>' +
    '<div class="ss-form-sec">' + _ntSec('Ticket') +
      '<div class="ss-grid">' +
        _ntField('Subject', _comboField('nt-subject', { placeholder:'Short summary', options:function(){ return _TICKETS.lookups.subject || []; }, addTitle:'Add Subject', lookupType:'subject' }), 'ss-fld--full') +
        _ntField('Assignee', assignee) +
        _ntField('Tags', '<input id="nt-tags" class="ps-input" autocomplete="off" placeholder="comma, separated">') +
      '</div>' +
      '<div class="ss-fld ss-fld--full" style="margin:16px 0 4px">' +
        '<span class="ss-lbl">Submission Type</span>' +
        '<div class="ss-checks">' +
          '<label class="ss-chk"><input type="radio" name="nt-subtype" value="solved" checked> Solved</label>' +
          '<label class="ss-chk"><input type="radio" name="nt-subtype" value="followup"> Follow-up / Response Needed</label>' +
        '</div>' +
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
    _ticketGet({ action:'getAgents' }),
    _ticketGet({ action:'getTickets' })   // rep→last-phone map + the requester panel's history
  ]).then(function(r) {
    if (r[0] && r[0].lookups) _TICKETS.lookups = r[0].lookups;
    if (r[1] && r[1].agents)  _TICKETS.agents  = r[1].agents;
    if (r[2] && r[2].tickets) { _TICKETS.list = r[2].tickets; _ticketBuildRepProfiles(); }
    _TICKETS._loaded = true;
    _ticketFillAgents();
    _ssSyncRequesterPanel('nt');   // history only exists once the tickets land
  }).catch(function(){ /* leave the form usable with empty lists */ });
}
// Build { rep(lc) -> {phone, office} } from each rep's most recent ticket that HAS each value,
// then let the manually-maintained Rep Contacts directory (_TICKETS.contacts) override — it's
// the source of truth for reps who've never opened a ticket or whose info changed.
function _ticketBuildRepProfiles() {
  var byRep = {}, byPhone = {};
  (_TICKETS.list || []).forEach(function(t) {
    var repRaw = String(t.requester || '').trim(), rep = repRaw.toLowerCase(), ts = String(t.created || '');
    var ph = _ssFmtPhone(t.phone), of = String(t.office || '').trim(), phn = _ssNormPhone(ph);
    if (rep) {
      var r = byRep[rep] || (byRep[rep] = { phone:'', phoneTs:'', office:'', officeTs:'' });
      if (ph && ts >= r.phoneTs) { r.phone = ph; r.phoneTs = ts; }
      if (of && ts >= r.officeTs) { r.office = of; r.officeTs = ts; }
    }
    if (phn && repRaw) { var p = byPhone[phn]; if (!p || ts >= p.ts) byPhone[phn] = { rep: repRaw, office: of, phone: ph, ts: ts }; }
  });
  (_TICKETS.contacts || []).forEach(function(cLink) {
    var repRaw = String(cLink.rep || '').trim(); if (!repRaw) return;
    var rep = repRaw.toLowerCase(), ph = _ssFmtPhone(cLink.phone), of = String(cLink.office || '').trim();
    var r = byRep[rep] || (byRep[rep] = { phone:'', phoneTs:'', office:'', officeTs:'' });
    if (ph) { r.phone = ph; r.phoneTs = '~'; }
    if (of) { r.office = of; r.officeTs = '~'; }
    var phn = _ssNormPhone(ph);
    if (phn) byPhone[phn] = { rep: repRaw, office: of, phone: ph, ts: '~' };
  });
  _TICKETS._repProfile = {};
  Object.keys(byRep).forEach(function(rk){ _TICKETS._repProfile[rk] = { phone: byRep[rk].phone, office: byRep[rk].office }; });
  _TICKETS._phoneProfile = byPhone;   // reverse: phone → { rep, office }
}
// On picking an existing Rep, auto-fill Phone + Office from their profile (each still editable).
// `prefix` selects which field family to read/write ('nt' = New Ticket, 'ted' = ticket-edit modal).
function _ntAutofillRep(prefix) {
  prefix = prefix || 'nt';
  var rep = _ntVal(prefix + '-requester').toLowerCase();
  var p = (_TICKETS._repProfile || {})[rep]; if (!p) return;
  if (p.phone) _ntSetVal(prefix + '-phone', _ssFmtPhone(p.phone));
  if (p.office) { _ntSetVal(prefix + '-office', p.office); _ntOfficeChange(prefix); }
}
// ── Phone numbers — ONE universal format ────────────────────────────────────
// Every number this office stores or shows is "(555) 123-4567". Agents may type one
// however they like — dots, dashes, spaces, a leading 1, +1 — and it is canonicalized
// at the moment of save, with legacy values formatted on their way to the screen.
// A number must be 10 digits (or 11 starting with 1); anything else is REFUSED at save
// rather than stored, which is what keeps the phone→rep map trustworthy.
//   _ssPhoneDigits  the 10 significant digits, or '' if it isn't a valid US number
//   _ssPhoneOk      valid to save? (blank counts as valid — phone is an optional field)
//   _ssFmtPhone     canonical form. A non-conforming value comes back AS TYPED, so odd
//                   legacy data still displays and is never silently rewritten.
//   _ssNormPhone    digits-only MATCH key. Collapses 1-555… and 555… onto ONE key, so
//                   the rep↔phone lookup spans both old and new stored formats.
function _ssPhoneDigits(p) {
  var d = String(p == null ? '' : p).replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d.length === 10 ? d : '';
}
function _ssPhoneOk(p) { return !String(p == null ? '' : p).trim() || !!_ssPhoneDigits(p); }
function _ssFmtPhone(p) {
  var d = _ssPhoneDigits(p);
  return d ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6)
           : String(p == null ? '' : p).trim();
}
function _ssNormPhone(p) { return _ssPhoneDigits(p) || String(p == null ? '' : p).replace(/\D/g, ''); }
// What every surface says when a typed number isn't 10 digits.
var SS_PHONE_ERR = 'Phone must be 10 digits — e.g. (555) 123-4567.';
// Snap a field to the canonical format as the agent leaves it. Blank and invalid values
// are left alone, so the save-time error can quote back exactly what they typed.
function _ssPhoneBlur(id) {
  var el = document.getElementById(id); if (!el) return;
  if (_ssPhoneDigits(el.value)) el.value = _ssFmtPhone(el.value);
}

// Reverse link: typing/picking a known Phone # fills the Rep (+ office) it belongs to.
// Only fills BLANK fields, so a manually-chosen rep is never clobbered.
function _ntPhoneLookup(prefix) {
  prefix = prefix || 'nt';
  var p = (_TICKETS._phoneProfile || {})[_ssNormPhone(_ntVal(prefix + '-phone'))]; if (!p) return;
  if (!_ntVal(prefix + '-requester') && p.rep) _ntSetVal(prefix + '-requester', p.rep);
  if (!_ntVal(prefix + '-office') && p.office) { _ntSetVal(prefix + '-office', p.office); _ntOfficeChange(prefix); }
}
// Known phone numbers for the Phone # combobox — { val:number, label:"number · rep — office" }.
function _ntKnownPhones() {
  var pp = _TICKETS._phoneProfile || {};
  return Object.keys(pp).map(function(k){ var x = pp[k], n = _ssFmtPhone(x.phone || k);
    return { val: n, label: n + (x.rep ? '  ·  ' + x.rep + (x.office ? ' — ' + x.office : '') : '') }; });
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

// ── Office directory + timezones ─────────────────────────────────────────────
// The Office field is a picklist of "Owner — Company" from a pre-loaded ICD directory;
// picking one shows a live "their time vs your time" clock. New offices are added inline
// (with City/State so we can derive their timezone) and persist to the backend.
var _SS_STATE_TZ = { CA:'PT',WA:'PT',OR:'PT',NV:'PT', CO:'MT',UT:'MT',NM:'MT',ID:'MT',WY:'MT',MT:'MT', AZ:'AZ',
  TX:'CT',LA:'CT',IL:'CT',KS:'CT',AL:'CT',MO:'CT',AR:'CT',WI:'CT',OK:'CT',MN:'CT',IA:'CT',MS:'CT',ND:'CT',SD:'CT',NE:'CT',
  FL:'ET',NC:'ET',SC:'ET',GA:'ET',VA:'ET',OH:'ET',MI:'ET',PA:'ET',NY:'ET',MA:'ET',CT:'ET',RI:'ET',NJ:'ET',NH:'ET',
  MD:'ET',DE:'ET',ME:'ET',VT:'ET',WV:'ET',DC:'ET',KY:'ET',IN:'ET',TN:'CT' };
var _SS_CITY_TZ = { 'TX|el paso':'MT','TN|knoxville':'ET','TN|chattanooga':'ET','TN|johnson city':'ET','TN|kingsport':'ET','TN|bristol':'ET','TN|oak ridge':'ET' };
var _SS_TZ_IANA = { PT:'America/Los_Angeles', MT:'America/Denver', AZ:'America/Phoenix', CT:'America/Chicago', ET:'America/New_York' };
var _SS_IANA_LABEL = { 'America/Los_Angeles':'PT','America/Denver':'MT','America/Phoenix':'MST','America/Chicago':'CT','America/New_York':'ET' };
// Resolve a {token,iana,label} timezone from state (+ split-state city overrides).
function _ssTzForStateCity(state, city) {
  var st = String(state||'').replace(/\s+/g,'').toUpperCase(), c = String(city||'').trim().toLowerCase();
  var tok = _SS_CITY_TZ[st + '|' + c] || _SS_STATE_TZ[st] || '';
  return { token:tok, iana:_SS_TZ_IANA[tok] || '', label: tok === 'AZ' ? 'MST' : (tok || '?') };
}
function _ssTzLabel(iana) { return _SS_IANA_LABEL[iana] || String(iana||'').split('/').pop().replace(/_/g,' '); }
function _ssTimeInZone(iana) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone:iana, hour:'numeric', minute:'2-digit' }).format(new Date()); }
  catch (e) { return '—'; }
}
function _ssYourIana() {
  var e = String((SESSION && SESSION.email) || '').toLowerCase();
  return SALESSUPPORT_AGENT_TZ[e] || (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/Los_Angeles';
}
function _ssOfficeLabel(o) { o = o || {}; return (o.owner ? o.owner + ' — ' : '') + (o.company || ''); }
function _ssSetOffices(list) {
  _TICKETS.offices = list || [];
  var byLabel = {}, labels = [];
  _TICKETS.offices.forEach(function(o){ var lb = _ssOfficeLabel(o); if (!lb) return; byLabel[lb.toLowerCase()] = o; labels.push(lb); });
  labels.sort(function(a, b){ return a.localeCompare(b); });
  _TICKETS._officeByLabel = byLabel; _TICKETS._officeLabels = labels; _TICKETS._officesLoaded = true;
}
function _ssLoadOffices() {
  if (_TICKETS._officesLoaded || _TICKETS._officesLoading || !TICKET_SCRIPT_URL) return;
  _TICKETS._officesLoading = true;
  _ticketGet({ action:'getOffices' }).then(function(r){ _ssSetOffices((r && r.offices) || []); })
    .catch(function(){}).then(function(){ _TICKETS._officesLoading = false; });
}
// Pre-load the Rep Contacts directory (once) so Rep/Phone autofill works everywhere —
// New Ticket, the ticket-edit modal, and the Rep Contacts tab — even before any ticket exists.
function _ssLoadContacts() {
  if (_TICKETS._contactsLoaded || _TICKETS._contactsLoading || !TICKET_SCRIPT_URL) return;
  _TICKETS._contactsLoading = true;
  _ticketGet({ action:'getContactLinks' }).then(function(r){
    _TICKETS.contacts = (r && r.links) || []; _TICKETS._contactsLoaded = true; _ticketBuildRepProfiles();
  }).catch(function(){}).then(function(){ _TICKETS._contactsLoading = false; });
}
function _ssOfficeMeta(officeStr) { return (_TICKETS._officeByLabel || {})[String(officeStr||'').trim().toLowerCase()] || null; }
// A live clock chip; the shared 20s timer (_ssTickClocks) refreshes every .ss-clock on the page.
function _ssClockChip(who, iana, label, sub) {
  return '<span class="ss-clock" data-iana="' + esc(iana) + '"><span class="ss-clock-who">' + esc(who) + '</span>' +
    '<span class="ss-clock-time">' + esc(_ssTimeInZone(iana)) + '</span> <span class="ss-clock-tz">' + esc(label) + '</span>' +
    (sub ? '<span class="ss-clock-sub">' + esc(sub) + '</span>' : '') + '</span>';
}
function _ssClockPairHtml(meta) {
  if (!meta || !meta.iana) return '';
  var you = _ssYourIana(), where = (meta.city || '') + (meta.state ? ', ' + meta.state : '');
  return '<span class="ss-clockpair">' +
    _ssClockChip('Them', meta.iana, meta.tz || _ssTzLabel(meta.iana), where) +
    _ssClockChip('You', you, _ssTzLabel(you), '') + '</span>';
}
function _ssTickClocks() {
  var els = document.querySelectorAll('.ss-clock');
  for (var i = 0; i < els.length; i++) { var t = els[i].querySelector('.ss-clock-time'); if (t) t.textContent = _ssTimeInZone(els[i].getAttribute('data-iana')); }
}
// Refresh the office clock strip when the office changes (only New Ticket has one — the
// ticket-edit modal's #ted-clock lookup is just a harmless no-op there).
function _ntOfficeChange(prefix) {
  prefix = prefix || 'nt';
  var el = document.getElementById(prefix + '-clock'); if (!el) return;
  var meta = _ssOfficeMeta(_ntVal(prefix + '-office'));
  el.innerHTML = meta ? _ssClockPairHtml(meta) : '';
}
// Add-an-office popup: Owner/Company/City/State (+ optional Address/ZIP). Derives the timezone
// from State (+ split-state city), fills the Office field with "Owner — Company", and persists it.
function _ssUniqOfficeVals(key) {
  var seen = {}, out = [];
  (_TICKETS.offices || []).forEach(function(o){ var v = String(o[key]||'').trim(); if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = 1; out.push(v); } });
  return out.sort(function(a,b){ return a.localeCompare(b); });
}
function _ssOfficeAddPopup(typed, prefix) {
  prefix = prefix || 'nt';
  _ssAddPopup('Add Office', [
    { id:'owner', label:'Owner name', value:typed, options:_ssUniqOfficeVals('owner') },
    { id:'company', label:'Company', value:'', options:_ssUniqOfficeVals('company') },
    { id:'city', label:'City', value:'', options:_ssUniqOfficeVals('city') },
    { id:'state', label:'State (2-letter, e.g. TX)', value:'', options:_ssUniqOfficeVals('state') },
    { id:'address', label:'Address (optional)', value:'' },
    { id:'zip', label:'ZIP (optional)', value:'' }
  ], function(v) {
    if (!v.company && !v.owner) return;
    var tz = _ssTzForStateCity(v.state, v.city);
    var o = { company:v.company, owner:v.owner, address:v.address, city:v.city,
      state:String(v.state||'').toUpperCase(), zip:v.zip, iana:tz.iana, tz:tz.label };
    (_TICKETS.offices = _TICKETS.offices || []).push(o);
    _ssSetOffices(_TICKETS.offices);
    _ntSetVal(prefix + '-office', _ssOfficeLabel(o));
    _ntOfficeChange(prefix);
    if (TICKET_SCRIPT_URL) { try { _ticketPost(Object.assign({ action:'addOffice' }, o)); } catch (e) {} }
  });
}

// Add a value to the dropdown NOW: update the local list (so it shows immediately) + persist it
// via the backend addLookup so it's there for everyone next time.
function _ticketRememberValue(type, value, parent) {
  type = String(type || '').trim(); value = String(value || '').trim(); parent = String(parent || '').trim();
  if (!type || !value) return;
  var lk = _TICKETS.lookups;
  if (type === 'specificCat') {
    lk.specificCat = lk.specificCat || [];
    if (!lk.specificCat.some(function(s){ return String(s.value).toLowerCase() === value.toLowerCase(); })) lk.specificCat.push({ value: value, parent: parent });
  } else {
    lk[type] = lk[type] || [];
    if (lk[type].indexOf(value) === -1) lk[type].push(value);
  }
  if (TICKET_SCRIPT_URL) { try { _ticketPost({ action: 'addLookup', type: type, value: value, parent: parent }); } catch (e) {} }
}
function _ntSetVal(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; }
// Add-a-rep popup: captures name + phone + office; fills the three ticket fields (each still editable)
// and saves it as a real Rep Contacts entry, so it's there for everyone next time — no ticket required.
function _ssRepAddPopup(typed, prefix) {
  prefix = prefix || 'nt';
  _ssAddPopup('Add Rep', [
    { id:'name', label:'Rep name', value:typed, options:(_TICKETS.lookups.rep || []) },
    { id:'phone', label:'Phone number', value:'' },
    { id:'office', label:'Office (pick an existing one)', value:'', options:(_TICKETS._officeLabels || []) }
  ], function(v){
    if (!v.name) return 'Add a rep name.';
    if (!_ssPhoneOk(v.phone)) return SS_PHONE_ERR;
    v.phone = _ssFmtPhone(v.phone);
    _ntSetVal(prefix + '-requester', v.name);
    _ntSetVal(prefix + '-phone', v.phone);
    _ntSetVal(prefix + '-office', v.office);
    _ntOfficeChange(prefix);   // if the office matches a directory entry, the clock lights up
    // persist the rep + office to the dropdowns, and link rep→phone/office locally so re-picking
    // fills them even before a ticket is saved (backed by the Rep Contacts directory).
    _ticketRememberValue('rep', v.name, '');
    if (v.office) _ticketRememberValue('office', v.office, '');
    var rk = v.name.toLowerCase();
    _TICKETS._repProfile = _TICKETS._repProfile || {};
    _TICKETS._repProfile[rk] = { phone: v.phone, office: v.office };
    var pn = _ssNormPhone(v.phone);
    if (pn) { _TICKETS._phoneProfile = _TICKETS._phoneProfile || {}; _TICKETS._phoneProfile[pn] = { rep: v.name, office: v.office, phone: v.phone, ts: '~' }; }
    if (v.phone || v.office) {
      var found = false;
      (_TICKETS.contacts = _TICKETS.contacts || []).forEach(function(c){ if (String(c.rep).toLowerCase() === rk) { c.phone = v.phone; c.office = v.office; found = true; } });
      if (!found) _TICKETS.contacts.push({ rep:v.name, phone:v.phone, office:v.office });
      if (TICKET_SCRIPT_URL) { try { _ticketPost({ action:'saveContactLink', rep:v.name, phone:v.phone, office:v.office }); } catch (e) {} }
    }
    _ssSyncRequesterPanel(prefix);
  });
}
function _ntVal(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
function _ntChk(id) { var el = document.getElementById(id); return !!(el && el.checked); }
// Submission type = the ticket's starting status: 'solved' or 'followup' (defaults to solved).
function _ntSubType() { var el = document.querySelector('input[name="nt-subtype"]:checked'); return (el && el.value) || 'solved'; }
function _ntStatus(msg, isError) {
  var el = document.getElementById('nt-status'); if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--red)' : 'var(--accent2b)';
}
function _ntContactStatus(msg, isError) {
  var el = document.getElementById('nt-contact-status'); if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--red)' : 'var(--accent2b)';
}
// Save the current Rep/Office/Phone as a Rep Contacts entry WITHOUT creating a ticket —
// for pre-loading a rep's info before they ever call in, or fixing it on the spot.
function _ntSaveContactLink(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  var rep = _ntVal('nt-requester'), office = _ntVal('nt-office'), phone = _ntVal('nt-phone');
  if (!rep) { _ntContactStatus('Add a rep name first.', true); return; }
  if (!phone && !office) { _ntContactStatus('Add a phone or an office to save.', true); return; }
  if (!_ssPhoneOk(phone)) { _ntContactStatus(SS_PHONE_ERR, true); return; }
  phone = _ssFmtPhone(phone); _ntSetVal('nt-phone', phone);
  if (!TICKET_SCRIPT_URL) { _ntContactStatus('Preview mode — backend not connected.', true); return; }
  var btn = document.getElementById('nt-save-contact');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  _ntContactStatus('', false);
  _ticketPost({ action:'saveContactLink', rep:rep, phone:phone, office:office }).then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Link'; }
    if (res && res.ok) {
      _ntContactStatus('Saved ✦', false);
      var rk = rep.toLowerCase(), found = false;
      (_TICKETS.contacts = _TICKETS.contacts || []).forEach(function(c){ if (String(c.rep).toLowerCase() === rk) { c.phone = phone; c.office = office; found = true; } });
      if (!found) _TICKETS.contacts.push({ rep:rep, phone:phone, office:office });
      _ticketRememberValue('rep', rep, '');
      if (office) _ticketRememberValue('office', office, '');
      _ticketBuildRepProfiles();
      _ssSyncRequesterPanel('nt');
    } else { _ntContactStatus((res && res.error) || 'Could not save.', true); }
  }).catch(function(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Link'; }
    _ntContactStatus('Error: ' + e.message, true);
  });
}
/* ── DRAFT PRESERVATION ──────────────────────────────────────────────────────────────
   Reps reported losing an entire ticket. Every path that can empty this form does it by
   rebuilding the markup — switchTab re-runs renderNewTicket(), a forced re-login repaints
   the app, and iOS Safari discards and reloads a backgrounded tab under memory pressure.
   The typed values live only in the DOM, so any of those wipes them.
   🔑 IN MEMORY, NOT localStorage. A draft holds a customer DSI and free-text notes; these
   are shared/handheld devices, and persisting that to disk outlives the session and the
   user. A module variable survives every re-render above, which is the actual failure, and
   dies with the tab — which is the correct lifetime for customer data. */
var _NT_FIELDS = ['nt-requester','nt-office','nt-phone','nt-subject','nt-general','nt-specific',
                  'nt-dsi','nt-tags','nt-note','nt-channel','nt-sara','nt-assignee'];
var _NT_DRAFT = null;
var _NT_CLIENT_KEY = null;   // idempotency key, held across retries of the SAME ticket

/* forbidden_office was the sign-in bug's face: reps saw the raw token. Say what to do. */
function _ticketErrText(err) {
  var e = String(err || '');
  if (e === 'forbidden_office') return 'Your account is not set up for Sales Support yet. Ask Gavon to add you to the Sales Support roster, then sign out and back in.';
  if (e === 'auth_required')    return 'Your sign-in expired. Sign in again — your details are still here.';
  if (/^busy/i.test(e))         return 'Sales Support is busy. Press Create Ticket again — it is safe to retry.';
  return e || 'Could not create the ticket.';
}

function _ntCaptureDraft() {
  var d = {}, any = false;
  _NT_FIELDS.forEach(function(id) {
    var el = document.getElementById(id); if (!el) return;
    var v = String(el.value || '');
    d[id] = v; if (v.trim()) any = true;
  });
  var st = document.querySelector('input[name="nt-subtype"]:checked');
  if (st) d._subtype = st.value;
  _NT_DRAFT = any ? d : null;   // an all-blank form is not worth restoring
  return _NT_DRAFT;
}

function _ntRestoreDraft() {
  if (!_NT_DRAFT) return false;
  var restored = false;
  _NT_FIELDS.forEach(function(id) {
    var el = document.getElementById(id); if (!el) return;
    var v = _NT_DRAFT[id];
    // Don't stomp a value the fresh render legitimately supplied (e.g. a default assignee)
    // with a blank one from the draft.
    if (v == null || (!v && el.value)) return;
    el.value = v; if (v) restored = true;
  });
  if (_NT_DRAFT._subtype) {
    var st = document.querySelector('input[name="nt-subtype"][value="' + _NT_DRAFT._subtype + '"]');
    if (st) st.checked = true;
  }
  return restored;
}

function _ticketResetForm() {
  _NT_DRAFT = null;   // the ticket is saved — the draft has done its job
  ['nt-requester','nt-office','nt-phone','nt-subject','nt-general','nt-specific','nt-dsi','nt-tags','nt-note','nt-channel','nt-sara'].forEach(function(id){ var el=document.getElementById(id); if (el) el.value=''; });
  var st = document.querySelector('input[name="nt-subtype"][value="solved"]'); if (st) st.checked = true;
  _ssSyncRequesterPanel('nt');   // nobody is on the phone any more
}
function _ticketCreate(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  var payload = {
    action:'createTicket', status:_ntSubType(),
    requester:_ntVal('nt-requester'), office:_ntVal('nt-office'), channel:_ntVal('nt-channel'),
    phone:_ntVal('nt-phone'), subject:_ntVal('nt-subject'), generalCategory:_ntVal('nt-general'),
    specificCategory:_ntVal('nt-specific'), saraPlus:_ntVal('nt-sara'), dsi:_ntVal('nt-dsi'),
    assignee:_ntVal('nt-assignee'), tags:_ntVal('nt-tags'), note:_ntVal('nt-note')
  };
  if (!payload.requester && !payload.subject && !payload.generalCategory) { _ntStatus('Add at least a rep, a subject, or a category.', true); return; }
  if (!_ssPhoneOk(payload.phone)) { _ntStatus(SS_PHONE_ERR, true); return; }
  payload.phone = _ssFmtPhone(payload.phone); _ntSetVal('nt-phone', payload.phone);
  var btn = document.getElementById('nt-submit');
  if (!TICKET_SCRIPT_URL) { _ntStatus('Preview mode — backend not connected, so this can’t save yet.', true); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  _ntStatus('', false);
  _ntCaptureDraft();   // hold everything BEFORE the round-trip; nothing below can lose it

  /* One key per ATTEMPT, reused across retries of the same ticket, so a retry after an
     ambiguous failure returns the original ticket instead of creating a second one.
     Cleared only on a confirmed save (below). */
  if (!_NT_CLIENT_KEY) _NT_CLIENT_KEY = 'nt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  payload.clientKey = _NT_CLIENT_KEY;

  _ticketPost(payload).then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Ticket'; }
    if (res && res.ok) {
      _ntStatus(res.duplicate
        ? 'Already saved as ticket ' + res.ticketId + ' — no duplicate was created. ✦'
        : 'Ticket ' + res.ticketId + ' created. ✦', false);
      _NT_CLIENT_KEY = null;   // next ticket gets a fresh key
      _ticketResetForm();
      // remember any freshly-typed values locally so the datalists update without a refetch
      _ticketRememberLocal(payload);
    } else {
      // The server answered and REFUSED. The form is untouched, so they can fix and resend.
      _ntStatus(_ticketErrText(res && res.error), true);
    }
  }).catch(function(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Ticket'; }
    // Transport failure: we never got a usable answer, so we do NOT know whether it saved.
    // The draft is intact and the clientKey is kept, which is what makes retrying safe.
    _ntStatus(e && e.ticketTransport ? e.message
      : 'Could not reach Sales Support. Your details are still here — press Create Ticket again.', true);
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
      /* Archived duplicates are hidden by default; this is the way back to them, so they
         are never unreachable. Labels say what you will SEE, not what is filtered out. */
      '<select id="tq-archived" class="ps-select ss-qf" onchange="_ticketQueueFilter()">' +
        ['', 'all', 'only'].map(function (v) {
          var lab = { '': 'Hide archived', 'all': 'Include archived', 'only': 'Archived only' }[v];
          return '<option value="' + v + '"' + (v === (f.archived || '') ? ' selected' : '') + '>' + lab + '</option>';
        }).join('') + '</select>' +
      '<span class="ss-qf-dates">From <input type="date" id="tq-from" class="ps-input ss-qf-date" value="' + esc(f.from || '') + '" onchange="_ticketQueueFilter()"> to <input type="date" id="tq-to" class="ps-input ss-qf-date" value="' + esc(f.to || '') + '" onchange="_ticketQueueFilter()"></span>' +
      '<button class="ps-btn secondary ss-qf-btn" onclick="renderTicketQueue()">Refresh</button>' +
    '</div></div>' +
    '<div id="ticket-tbody-wrap">' + _ticketTableHtml() + '</div>';
}

function _ticketQueueFilter() {
  var f = _TICKETS.filters;
  f.q = _ntVal('tq-q'); f.status = _ntVal('tq-status'); f.assignee = _ntVal('tq-assignee');
  f.office = _ntVal('tq-office'); f.general = _ntVal('tq-general'); f.channel = _ntVal('tq-channel');
  f.from = _ntVal('tq-from'); f.to = _ntVal('tq-to'); f.archived = _ntVal('tq-archived');
  var wrap = document.getElementById('ticket-tbody-wrap'); if (wrap) wrap.innerHTML = _ticketTableHtml();
}

function _ticketMatch(t, f) {
  /* ⚠ Archived duplicates are hidden by DEFAULT — that is the whole point of archiving
     them. `f.archived` is a deliberate three-state: '' = hide (default), 'only' = just the
     archive, 'all' = both. Hidden-and-unreachable would be a delete with extra steps, so
     there is always a way back to them. */
  var arch = f.archived || '';
  if (arch === 'only') { if (!t.archived) return false; }
  else if (arch !== 'all') { if (t.archived) return false; }
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
    _ticketTh('Rep','requester') + _ticketTh('Office','office') + '<th>Category</th>' + _ticketTh('Subject','subject') + _ticketTh('Status','status') +
    '<th class="ss-rowacts-h"></th></tr>';
  var body = rows.map(function(t){
    /* An archived row only appears when the filter asks for it, but it must still be
       obvious at a glance — otherwise "Include archived" silently mixes duplicates back
       into a list people count. */
    return '<tr class="ss-row' + (t.archived ? ' ss-row-arch' : '') + '" onclick="openTicketDetail(\'' + esc(t.ticketId) + '\')">' +
      '<td data-label="Ticket" class="ss-tid" style="white-space:nowrap">' + esc(t.ticketId) +
        (t.archived ? ' <span class="ss-arch-tag" title="Duplicate of ' + esc(t.duplicateOf || '') + '">DUP</span>' : '') + '</td>' +
      '<td data-label="Created" class="ss-mono" style="white-space:nowrap">' + esc(_ticketFmtDate(t.created)) + '</td>' +
      '<td data-label="Agent">' + _ssAgentCell(t.assigneeName || t.assignee) + '</td>' +
      '<td data-label="Rep">' + esc(t.requester || '—') + '</td>' +
      '<td data-label="Office">' + esc(t.office || '—') + '</td>' +
      '<td data-label="Category">' + _ticketCat(t) + '</td>' +
      '<td data-label="Subject">' + esc(t.subject || '—') + '</td>' +
      '<td data-label="Status">' + _ticketStatusBadge(t.status) + '</td>' +
      '<td data-label="" class="ss-rowacts">' + _ticketRowActions(t) + '</td>' +
    '</tr>';
  }).join('');
  return '<div class="card ss-card ss-tablewrap"><table class="tbl ss-table">' + head + body + '</table>' +
    '<p class="ss-sub" style="margin:10px 0 0">' + rows.length + ' of ' + _TICKETS.list.length + ' ticket' + (_TICKETS.list.length === 1 ? '' : 's') + '</p></div>';
}

// ── REQUESTER PANEL — who's on the phone, and everything they've called about ─
// The duplicate-ticket fix. Before an agent logs a NEW ticket, show every ticket this rep has
// already opened — newest first, one click from the real thing. If they're calling back about
// the same order, the agent adds a note to THAT ticket instead of starting another one.
// Reads `_TICKETS.list`, which New Ticket already fetches for the rep→phone map, so the whole
// feature is client-side: no new backend action, nothing to redeploy.

// Every ticket for a rep, newest first. `excludeId` drops the one you're already looking at.
function _ssRepHistory(rep, excludeId) {
  var key = String(rep || '').trim().toLowerCase(); if (!key) return [];
  return (_TICKETS.list || []).filter(function(t) {
    return String(t.requester || '').trim().toLowerCase() === key && (!excludeId || t.ticketId !== excludeId);
  }).sort(function(a, b) { return String(b.created || '').localeCompare(String(a.created || '')); });
}
// Who is the New Ticket form about? The rep they typed — or, while that's still blank, whoever
// owns the phone number they entered (the same reverse lookup that autofills the form).
function _ssPanelRep(prefix) {
  var rep = _ntVal(prefix + '-requester'); if (rep) return rep;
  var p = (_TICKETS._phoneProfile || {})[_ssNormPhone(_ntVal(prefix + '-phone'))];
  return (p && p.rep) || '';
}
// One history row per ticket. The id rides in a data-attr and the handler reads it off the
// element — never interpolated into an inline JS string (the "Bri'an Key" notes bug).
function _ssHistoryListHtml(rows) {
  if (!rows.length) return '<p class="ss-sub ss-rp-none">No earlier tickets for this rep.</p>';
  return '<div class="ss-rp-hist">' + rows.map(function(t) {
    var label = t.subject || t.specificCategory || t.generalCategory || t.ticketId;
    return '<button type="button" class="ss-rp-item" data-id="' + esc(t.ticketId) + '" onclick="_ssOpenFromHistory(this)">' +
      '<span class="ss-rp-dot" style="background:' + _ticketStatusColor(t.status) + '"></span>' +
      '<span class="ss-rp-body">' +
        '<span class="ss-rp-subj">' + esc(label) + '</span>' +
        '<span class="ss-rp-meta"><span class="ss-mono">' + esc(_ticketFmtDate(t.created)) + '</span> · ' +
          esc(_ticketStatusLabel(t.status)) + '</span>' +
      '</span>' +
      '<span class="ss-rp-go">›</span>' +
    '</button>';
  }).join('') + '</div>';
}
function _ssOpenFromHistory(el) {
  var id = el && el.getAttribute ? el.getAttribute('data-id') : '';
  if (id) openTicketDetail(id);   // in the modal this simply swaps to that ticket
}
function _ssHistoryHeadHtml(n) {
  return '<div class="ss-rp-histhead"><span class="ss-form-seclabel">Interaction History</span>' +
    (n ? '<span class="ss-rp-count">' + n + '</span>' : '') + '</div>';
}
// Identity block: avatar + name, then the facts an agent needs mid-call. Phone/office fall back
// to the rep's saved profile when the form fields are still empty.
// NO local-time row on purpose: the form already shows the Them/You clock strip under Contact,
// and it appears on OFFICE alone — so the form's is the one that always works. Repeating it here
// just listed the same two times twice on one screen.
function _ssRequesterFactsHtml(rep, opts) {
  var prof   = (_TICKETS._repProfile || {})[String(rep).trim().toLowerCase()] || {};
  var office = opts.office || prof.office || '';
  var phone  = _ssFmtPhone(opts.phone || prof.phone || '');
  return '<div class="ss-rp-who">' + _ssAvatar(rep) + '<span class="ss-rp-name">' + esc(rep) + '</span></div>' +
    '<div class="ss-side-grp">' +
      _dt('Phone', phone ? esc(phone) : '—') +
      _dt('Office', office ? esc(office) : '—') +
    '</div>';
}
// The New Ticket rail. Rendered even with nobody identified, so the layout never jumps.
function _ssRequesterPanelHtml(rep, opts) {
  opts = opts || {};
  var rows = rep ? _ssRepHistory(rep, opts.excludeId) : [];
  var inner = rep
    ? _ssRequesterFactsHtml(rep, opts) + _ssHistoryHeadHtml(rows.length) + _ssHistoryListHtml(rows)
    : '<p class="ss-sub ss-rp-none">Pick a rep — or type a phone number we already know — to see every ticket they have opened.</p>';
  return '<div class="card ss-card ss-rp"><div class="ss-rule"></div>' +
    '<h2 class="ss-h2 ss-rp-h">Requester</h2>' + inner + '</div>';
}
// Repaint the rail from whatever the form currently says. Cheap + client-side, so it can run
// on every keystroke in the Rep / Phone fields.
function _ssSyncRequesterPanel(prefix) {
  prefix = prefix || 'nt';
  // The rail belongs to the New Ticket form. Calls carrying the modal's 'ted' prefix are
  // no-ops — otherwise editing a ticket would repaint the form's rail with the modal's rep.
  if (prefix !== 'nt') return;
  var el = document.getElementById('nt-reqpanel'); if (!el) return;
  el.innerHTML = _ssRequesterPanelHtml(_ssPanelRep(prefix),
    { office:_ntVal(prefix + '-office'), phone:_ntVal(prefix + '-phone') });
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
    /* An archived row only appears when the filter asks for it, but it must still be
       obvious at a glance — otherwise "Include archived" silently mixes duplicates back
       into a list people count. */
    return '<tr class="ss-row' + (t.archived ? ' ss-row-arch' : '') + '" onclick="openTicketDetail(\'' + esc(t.ticketId) + '\')">' +
      '<td data-label="Ticket" class="ss-tid" style="white-space:nowrap">' + esc(t.ticketId) +
        (t.archived ? ' <span class="ss-arch-tag" title="Duplicate of ' + esc(t.duplicateOf || '') + '">DUP</span>' : '') + '</td>' +
      '<td data-label="Age" class="ss-mono" style="white-space:nowrap;color:' + col + '">' + age + 'd</td>' +
      '<td data-label="Rep">' + esc(t.requester || '—') + '</td>' +
      '<td data-label="Office">' + esc(t.office || '—') + '</td>' +
      '<td data-label="Subject">' + esc(t.subject || '—') + '</td>' +
      '<td data-label="Assignee">' + _ssAgentCell(t.assigneeName || t.assignee) + '</td>' +
    '</tr>';
  }).join('');
  return '<div class="card ss-card ss-tablewrap"><table class="tbl ss-table">' + head + body + '</table>' +
    '<p class="ss-sub" style="margin:10px 0 0">' + rows.length + ' open follow-up' + (rows.length === 1 ? '' : 's') + '</p></div>';
}

// ── REP CONTACTS — Rep ↔ Phone ↔ Office directory ───────────────────────────
// A standalone place to add a rep (with phone/office) before they've ever made a ticket,
// or fix their saved info. Backed by _ContactLinks_salessupport (getContactLinks/saveContactLink);
// every add/edit here also feeds the Rep/Office pickers (via _rememberLookup on the backend) and
// the Rep→Phone/Office autofill profiles used on New Ticket + the ticket-edit modal.
function renderRepContacts() {
  var c = document.getElementById('main-content'); if (!c) return;
  if (!TICKET_SCRIPT_URL) { c.innerHTML = _ticketScaffold('Rep Contacts', 'Backend not connected in this preview.', ''); return; }
  c.innerHTML = '<div class="card ss-card"><div class="ss-rule"></div><h2 class="ss-h2">Rep Contacts</h2>' + _ssLoading('Loading…') + '</div>';
  Promise.all([
    _ticketGet({ action:'getContactLinks' }),
    _ticketGet({ action:'getLookups' }),
    _ticketGet({ action:'getTickets' })   // so reps with no saved link yet still show their ticket-derived phone/office
  ]).then(function(r) {
    _TICKETS.contacts = (r[0] && r[0].links) || [];
    _TICKETS._contactsLoaded = true;
    if (r[1] && r[1].lookups) _TICKETS.lookups = r[1].lookups;
    if (r[2] && r[2].tickets) _TICKETS.list = r[2].tickets;
    _ticketBuildRepProfiles();
    c.innerHTML = _repContactsView();
  }).catch(function(e) {
    c.innerHTML = '<div class="card ss-card"><div class="ss-rule"></div><h2 class="ss-h2">Rep Contacts</h2><p class="ss-sub" style="color:var(--red)">Could not load: ' + esc(e.message) + '</p></div>';
  });
}
// Merge saved contact links with any rep names that only exist from ticket history/lookups —
// those get their phone/office pre-filled from _repProfile (built from past tickets) and are
// flagged `saved:false` so "Save All" can backfill them into real Contact Links rows.
function _ssContactRows() {
  var byRep = {};
  (_TICKETS.contacts || []).forEach(function(cLink) {
    var rep = String(cLink.rep || '').trim(); if (!rep) return;
    byRep[rep.toLowerCase()] = { rep:rep, phone:String(cLink.phone||'').trim(), office:String(cLink.office||'').trim(), saved:true };
  });
  (_TICKETS.lookups.rep || []).forEach(function(name) {
    var k = String(name || '').trim().toLowerCase(); if (!k || byRep[k]) return;
    var p = (_TICKETS._repProfile || {})[k] || {};
    byRep[k] = { rep:name, phone:p.phone || '', office:p.office || '', saved:false };
  });
  var rows = Object.keys(byRep).map(function(k){ return byRep[k]; });
  rows.sort(function(a, b){ return a.rep.localeCompare(b.rep); });
  return rows;
}
function _repContactsView() {
  var rows = _ssContactRows();
  _TICKETS._contactRowsCache = rows;
  var addCard = '<div class="card ss-card"><div class="ss-rule"></div><h2 class="ss-h2">Rep Contacts</h2>' +
    '<p class="ss-sub">Add a rep before they ever call in, or fix a saved phone/office. These feed the Rep, Office and Phone # pickers on every ticket.</p>' +
    '<div class="ss-grid">' +
      _ntField('Rep name', '<input id="rc-rep" class="ps-input" autocomplete="off" placeholder="Rep name">') +
      _ntField('Office', _comboField('rc-office', { placeholder:'Owner — Company', options:function(){ return _TICKETS._officeLabels || []; }, onAdd:function(t){ _ssOfficeAddPopup(t, 'rc'); } })) +
      _ntField('Phone #', '<input id="rc-phone" class="ps-input" autocomplete="off" placeholder="(555) 123-4567" onblur="_ssPhoneBlur(\'rc-phone\')">') +
    '</div>' +
    '<div class="ss-actions"><button class="ps-btn" id="rc-add-btn" onclick="_rcAdd()">Add / Update Contact</button><span id="rc-status" class="ss-status"></span></div>' +
  '</div>';
  var tableHtml;
  if (!rows.length) {
    tableHtml = '<div class="card ss-card">' + _ssEmpty('people', 'No reps yet', 'Add the first one above.') + '</div>';
  } else {
    var unsaved = rows.filter(function(r){ return !r.saved && (r.phone || r.office); }).length;
    var head = '<tr><th>Rep</th><th>Phone</th><th>Office</th><th></th></tr>';
    var body = rows.map(function(r, i){
      var tag = (!r.saved && (r.phone || r.office)) ? ' <span class="ss-rc-unsaved" title="From ticket history — not yet saved to Rep Contacts">from tickets</span>' : '';
      return '<tr class="ss-row ss-rc-row" data-i="' + i + '">' +
        '<td data-label="Rep">' + esc(r.rep) + '</td>' +
        '<td data-label="Phone">' + esc(_ssFmtPhone(r.phone) || '—') + tag + '</td>' +
        '<td data-label="Office">' + esc(r.office || '—') + '</td>' +
        '<td data-label="" style="white-space:nowrap"><button class="ps-btn secondary" onclick="_rcEditRow(' + i + ')">Edit</button></td>' +
      '</tr>';
    }).join('');
    tableHtml = '<div class="card ss-card ss-tablewrap">' +
      '<div class="ss-actions" style="margin-top:0;justify-content:space-between">' +
        '<p class="ss-sub" style="margin:0">' + rows.length + ' rep' + (rows.length === 1 ? '' : 's') + (unsaved ? ' · ' + unsaved + ' from ticket history not yet saved' : '') + '</p>' +
        (unsaved ? '<span><button class="ps-btn secondary" id="rc-saveall-btn" onclick="_rcSaveAll()">Save All (' + unsaved + ')</button></span>' : '') +
      '</div>' +
      '<table class="tbl ss-table">' + head + body + '</table></div>';
  }
  return addCard + tableHtml;
}
function _rcStatus(msg, isErr) {
  var el = document.getElementById('rc-status'); if (!el) return;
  el.textContent = msg || ''; el.style.color = isErr ? 'var(--red)' : 'var(--accent2b)';
}
function _rcSyncLocal(rep, phone, office) {
  var rk = rep.toLowerCase(), found = false;
  (_TICKETS.contacts = _TICKETS.contacts || []).forEach(function(c){ if (String(c.rep).toLowerCase() === rk) { c.phone = phone; c.office = office; found = true; } });
  if (!found) _TICKETS.contacts.push({ rep:rep, phone:phone, office:office });
  _ticketRememberValue('rep', rep, '');
  if (office) _ticketRememberValue('office', office, '');
  _ticketBuildRepProfiles();
}
function _rcAdd() {
  var rep = _ntVal('rc-rep'), office = _ntVal('rc-office'), phone = _ntVal('rc-phone');
  if (!rep) { _rcStatus('Add a rep name.', true); return; }
  if (!phone && !office) { _rcStatus('Add a phone or an office.', true); return; }
  if (!_ssPhoneOk(phone)) { _rcStatus(SS_PHONE_ERR, true); return; }
  phone = _ssFmtPhone(phone); _ntSetVal('rc-phone', phone);
  var btn = document.getElementById('rc-add-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  _rcStatus('', false);
  _ticketPost({ action:'saveContactLink', rep:rep, phone:phone, office:office }).then(function(res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Add / Update Contact'; }
    if (res && res.ok) {
      _rcSyncLocal(rep, phone, office);
      var c = document.getElementById('main-content'); if (c) c.innerHTML = _repContactsView();
      _rcStatus('Saved ✦', false);
    } else { _rcStatus((res && res.error) || 'Could not save.', true); }
  }).catch(function(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Add / Update Contact'; }
    _rcStatus('Error: ' + e.message, true);
  });
}
// Backfill every rep we already have a phone/office for (derived from past tickets) into real,
// persisted Rep Contacts rows — so info that only lived in ticket history survives independently.
// Names the rows a batch had to leave behind, so a skip is always visible and actionable.
function _rcBadPhoneNote(bad) {
  var names = bad.slice(0, 3).map(function(r){ return r.rep; }).join(', ');
  return bad.length + ' rep' + (bad.length === 1 ? '' : 's') + ' whose phone isn\'t 10 digits (' +
    names + (bad.length > 3 ? ', +' + (bad.length - 3) + ' more' : '') + ') — fix with Edit, then save again.';
}
function _rcSaveAll() {
  var all = (_TICKETS._contactRowsCache || []).filter(function(r){ return !r.saved && (r.phone || r.office); });
  // A legacy number that isn't 10 digits can't be canonicalized, so it is SKIPPED and named
  // rather than written as-is — one bad row must not block the batch, or slip through it.
  var bad  = all.filter(function(r){ return !_ssPhoneOk(r.phone); });
  var rows = all.filter(function(r){ return  _ssPhoneOk(r.phone); })
                .map(function(r){ return { rep:r.rep, phone:_ssFmtPhone(r.phone), office:r.office }; });
  if (!rows.length) {
    _rcStatus(bad.length ? 'Nothing saved — skipped ' + _rcBadPhoneNote(bad)
                         : 'Nothing to save — every rep with a phone or office is already saved.', !!bad.length);
    return;
  }
  var btn = document.getElementById('rc-saveall-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  _rcStatus('Saving ' + rows.length + ' rep' + (rows.length === 1 ? '' : 's') + '…', false);
  Promise.all(rows.map(function(r){ return _ticketPost({ action:'saveContactLink', rep:r.rep, phone:r.phone, office:r.office }); }))
    .then(function(results) {
      var ok = 0;
      results.forEach(function(res, i) {
        if (res && res.ok) { ok++; var r = rows[i]; (_TICKETS.contacts = _TICKETS.contacts || []).push({ rep:r.rep, phone:r.phone, office:r.office }); }
      });
      _ticketBuildRepProfiles();
      var c = document.getElementById('main-content'); if (c) c.innerHTML = _repContactsView();
      var msg = 'Saved ' + ok + ' of ' + rows.length + ' rep' + (rows.length === 1 ? '' : 's') + '.';
      if (bad.length) msg += ' Skipped ' + _rcBadPhoneNote(bad);
      _rcStatus(msg, ok < rows.length || !!bad.length);
    }).catch(function(e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save All (' + rows.length + ')'; }
      _rcStatus('Error: ' + e.message, true);
    });
}
// Swap one row into edit mode (Phone + Office only — the rep name is the lookup key, so it
// isn't renamed in place; add a new contact above if a rep needs a different name on file).
function _rcEditRow(i) {
  var rows = _TICKETS._contactRowsCache || [], r = rows[i]; if (!r) return;
  var tr = document.querySelector('.ss-rc-row[data-i="' + i + '"]'); if (!tr) return;
  tr.innerHTML =
    '<td data-label="Rep">' + esc(r.rep) + '</td>' +
    '<td data-label="Phone"><input id="rc-e-phone-' + i + '" class="ps-input ss-ted-inp" value="' + esc(_ssFmtPhone(r.phone)) + '" onblur="_ssPhoneBlur(\'rc-e-phone-' + i + '\')"></td>' +
    '<td data-label="Office">' + _comboField('rc-e-office-' + i, { placeholder:'Owner — Company', noAdd:true, options:function(){ return _TICKETS._officeLabels || []; } }) + '</td>' +
    '<td style="white-space:nowrap"><button class="ps-btn" onclick="_rcSaveRow(' + i + ')">Save</button> <button class="ps-btn secondary" onclick="_rcCancelEdit()">Cancel</button></td>';
  _ntSetVal('rc-e-office-' + i, r.office || '');
}
function _rcCancelEdit() { var c = document.getElementById('main-content'); if (c) c.innerHTML = _repContactsView(); }
function _rcSaveRow(i) {
  var rows = _TICKETS._contactRowsCache || [], r = rows[i]; if (!r) return;
  var phone = _ntVal('rc-e-phone-' + i), office = _ntVal('rc-e-office-' + i);
  if (!_ssPhoneOk(phone)) { _rcStatus(SS_PHONE_ERR, true); return; }
  phone = _ssFmtPhone(phone);
  _ticketPost({ action:'saveContactLink', rep:r.rep, phone:phone, office:office }).then(function(res) {
    if (res && res.ok) {
      _rcSyncLocal(r.rep, phone, office);
      var c = document.getElementById('main-content'); if (c) c.innerHTML = _repContactsView();
      _rcStatus('Saved ✦', false);
    } else { _rcStatus((res && res.error) || 'Could not save.', true); }
  }).catch(function(e) { _rcStatus('Error: ' + e.message, true); });
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
  if (!body || !_TICKETS.open) return;
  body.innerHTML = _ticketDetailHtml(_TICKETS.open.ticket, _TICKETS.open.notes);
  if (_TICKETS.open.editing) {   // comboboxes render valueless — seed them from the ticket
    var t = _TICKETS.open.ticket;
    _ntSetVal('ted-requester', t.requester); _ntSetVal('ted-office', t.office); _ntSetVal('ted-phone', _ssFmtPhone(t.phone));
  }
}
function _dt(label, valHtml) { return '<div class="ss-dt"><span class="ss-lbl">' + esc(label) + '</span><span>' + (valHtml || '—') + '</span></div>'; }
function _dtCombo(label, comboHtml) { return '<div class="ss-dt"><span class="ss-lbl">' + esc(label) + '</span>' + comboHtml + '</div>'; }
function _ticketDetailHtml(t, notes) {
  var editing = !!(_TICKETS.open && _TICKETS.open.editing);
  var agents = (_TICKETS.agents && _TICKETS.agents.length) ? _TICKETS.agents : (t.assignee ? [{ email:t.assignee, name:t.assigneeName || t.assignee }] : []);
  var statusSel = '<select class="ps-select" onchange="_ticketSetStatus(this.value)">' +
    TICKET_STATUS.map(function(s){ return '<option value="' + s.code + '"' + (s.code === t.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') + '</select>';
  var asgSel = '<select class="ps-select" onchange="_ticketReassign(this.value)">' +
    agents.map(function(a){ return '<option value="' + esc(a.email) + '"' + (a.email === t.assignee ? ' selected' : '') + '>' + esc(a.name || a.email) + '</option>'; }).join('') + '</select>';
  var subjEl = editing
    ? '<input id="ted-subject" class="ps-input ss-ted-inp" value="' + esc(t.subject||'') + '" placeholder="Subject">'
    : '<h4 class="ss-dsubj">' + (t.subject ? esc(t.subject) : '<span style="opacity:.55">(no subject)</span>') + '</h4>';
  var header = '<div class="ss-td-head">' +
    '<div class="ss-td-headmain">' + subjEl +
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
  // Properties: read-only + an "Edit" button, OR editable inputs + Save/Cancel (all agents may edit any ticket).
  var propGrp;
  if (editing) {
    var inp = function(id, val){ return '<input id="' + id + '" class="ps-input ss-ted-inp" value="' + esc(val || '') + '">'; };
    var chanSel = '<select id="ted-channel" class="ps-select"><option value="">—</option>' +
      TICKET_CHANNELS.map(function(x){ return '<option' + (x === t.channel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>';
    var saraSel = '<select id="ted-sara" class="ps-select"><option value="">—</option>' +
      TICKET_SARA.map(function(x){ return '<option' + (x === t.saraPlus ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>';
    propGrp = '<div class="ss-side-grp">' +
      _dtCombo('Requester (Rep)', _comboField('ted-requester', { placeholder:'Rep name', options:function(){ return _TICKETS.lookups.rep || []; }, onChange:function(){ _ntAutofillRep('ted'); }, onAdd:function(typ){ _ssRepAddPopup(typ, 'ted'); } })) +
      _dtCombo('Office', _comboField('ted-office', { placeholder:'Owner — Company', options:function(){ return _TICKETS._officeLabels || []; }, onChange:function(){ _ntOfficeChange('ted'); }, onAdd:function(typ){ _ssOfficeAddPopup(typ, 'ted'); } })) +
      _dt('Channel', chanSel) +
      _dtCombo('Phone', _comboField('ted-phone', { placeholder:'Called / texted in from', options:_ntKnownPhones, onChange:function(){ _ntPhoneLookup('ted'); }, onInput:function(){ _ntPhoneLookup('ted'); }, onBlur:function(){ _ssPhoneBlur('ted-phone'); }, noAdd:true })) +
      _dt('General Category', inp('ted-general', t.generalCategory)) +
      _dt('Specific Category', inp('ted-specific', t.specificCategory)) +
      _dt('Sara Plus', saraSel) +
      _dt('DSI / Account', inp('ted-dsi', t.dsi)) +
      _dt('Tags', inp('ted-tags', t.tags)) +
    '</div>' +
    '<div class="ss-actions"><button class="ps-btn" onclick="_ticketSaveEdit()">Save Changes</button>' +
      '<button class="ps-btn secondary" onclick="_ticketToggleEdit()">Cancel</button>' +
      '<span id="ted-status" class="ss-status"></span></div>';
  } else {
    var _oMeta = _ssOfficeMeta(t.office);
    propGrp = '<div class="ss-side-grp">' +
      _dt('Requester (Rep)', esc(t.requester)) +
      _dt('Office', esc(t.office)) +
      (_oMeta ? _dt('Local time', _ssClockPairHtml(_oMeta)) : '') +
      _dt('Channel', esc(t.channel)) +
      _dt('Phone', esc(_ssFmtPhone(t.phone))) +
      _dt('Category', _ticketCat(t)) +
      _dt('Sara Plus', esc(t.saraPlus)) +
      _dt('DSI / Account', esc(t.dsi)) +
      _dt('Tags', esc(t.tags)) +
    '</div>' +
    '<button class="ps-btn secondary ss-ted-edit" onclick="_ticketToggleEdit()">Edit ticket details</button>' +
    _ticketArchiveBoxHtml(t);
  }
  // This rep's OTHER tickets, newest first — so an agent working one ticket can see the rest of
  // the conversation and jump straight there. Read-only mode only: while editing, the panel is
  // already a form ending in Save/Cancel, and a list under those buttons reads as part of them.
  var histGrp = '';
  if (!editing && t.requester) {
    var hist = _ssRepHistory(t.requester, t.ticketId);
    histGrp = '<div class="ss-side-grp ss-rp-inmodal">' + _ssHistoryHeadHtml(hist.length) +
      _ssHistoryListHtml(hist) + '</div>';
  }
  var side = '<div class="ss-td-side">' +
    '<div class="ss-side-grp">' + _dt('Status', statusSel) + _dt('Assignee', asgSel) + '</div>' +
    propGrp + histGrp +
  '</div>';
  return header + '<div class="ss-td-grid">' + main + side + '</div>';
}
/* ── PER-ROW ACTIONS ─────────────────────────────────────────────────────────
   Archive (duplicate) · Delete · Edit, at the far right of every queue row.
   ⚠⚠ EVERY HANDLER MUST stopPropagation(). The row itself carries
   onclick="openTicketDetail(...)", so without it each button would ALSO open the modal it
   just acted on — and Delete would open the detail of a ticket that no longer exists.
   ⚠ The ticket id is interpolated into the handler, matching the surrounding file. That is
   safe HERE and only here: ids are opaque SS-00000 strings with no quote, apostrophe or
   user-entered text in them. Never do this with a name — see the Bri'an Key bug. */
function _ticketRowActions(t) {
  var id = esc(t.ticketId);
  if (t.archived) {
    return '<button class="ss-ra" title="Restore to the queue" onclick="event.stopPropagation();_tqRestore(\'' + id + '\')">Restore</button>' +
           '<button class="ss-ra ss-ra-del" title="Delete permanently" onclick="event.stopPropagation();_tqDelete(\'' + id + '\')">Delete</button>';
  }
  return '<button class="ss-ra" title="Archive as a duplicate" onclick="event.stopPropagation();_tqArchive(\'' + id + '\')">Archive</button>' +
         '<button class="ss-ra ss-ra-del" title="Delete permanently" onclick="event.stopPropagation();_tqDelete(\'' + id + '\')">Delete</button>' +
         '<button class="ss-ra" title="Edit this ticket" onclick="event.stopPropagation();_tqEdit(\'' + id + '\')">Edit</button>';
}

/* Archive straight from the row. You identify the original by TYPING ITS TICKET NUMBER —
   there is no automatic duplicate detection, by design (option A). */
function _tqArchive(id) {
  _ssAddPopup('Archive ' + id + ' as a duplicate',
    [{ id:'dup', label:'Duplicate of (ticket number)', value:'' }],
    function (v) {
      var dup = String(v.dup || '').trim().toUpperCase();
      if (!dup) return 'Enter the ticket number this duplicates, e.g. SS-00041.';
      if (dup === String(id).toUpperCase()) return 'A ticket cannot be a duplicate of itself.';
      if (!/^SS-\d+$/i.test(dup)) return 'That is not a ticket number — expected SS-00041.';
      _ticketPost({ action:'archiveTicket', ticketId:id, duplicateOf:dup }).then(function (res) {
        if (res && res.ok) _ticketSyncListRow(res.ticket);
        else alert((res && res.error) || 'Could not archive.');
      }).catch(function (e) { alert('Error: ' + e.message); });
    },
    { saveLabel:'Archive', intro:'It leaves the queue, the weekly report and the follow-up reminders. Reversible.' });
}

function _tqRestore(id) {
  _ticketPost({ action:'unarchiveTicket', ticketId:id }).then(function (res) {
    if (res && res.ok) _ticketSyncListRow(res.ticket);
    else alert((res && res.error) || 'Could not restore.');
  }).catch(function (e) { alert('Error: ' + e.message); });
}

/* A plain "are you sure?" — no typing, no reason field (user's call, 2026-08-05).
   ⚠ The backend still REQUIRES `confirm` to equal the ticket id, and that check stays: it
   is no longer a UX speed bump but an API-level guard, so a malformed or replayed call from
   anything that is not this UI cannot delete a ticket. The UI simply supplies it.
   🔑 That split is why this change needed NO backend redeploy. */
function _tqDelete(id) {
  _ssAddPopup('Delete ' + id + '?', [],
    function () {
      _ticketPost({ action:'deleteTicket', ticketId:id, confirm:id }).then(function (res) {
        if (res && res.ok) {
          // Drop it from the local list — there is no updated ticket to sync back.
          _TICKETS.list = (_TICKETS.list || []).filter(function (x) { return x.ticketId !== id; });
          var wrap = document.getElementById('ticket-tbody-wrap');
          if (wrap) wrap.innerHTML = (_TICKETS.render || _ticketTableHtml)();
        } else alert((res && res.error) || 'Could not delete.');
      }).catch(function (e) { alert('Error: ' + e.message); });
    },
    { saveLabel:'Yes, delete it', danger:true,
      intro:'This permanently removes the ticket and its notes. Archiving is the reversible option.' });
}

// Open the detail already in edit mode, rather than making it a two-click journey.
function _tqEdit(id) {
  openTicketDetail(id);
  var tries = 0;
  (function waitForLoad() {
    if (_TICKETS.open && _TICKETS.open.ticket && _TICKETS.open.ticket.ticketId === id) {
      _TICKETS.open.editing = true; _renderTicketDetail(); return;
    }
    if (++tries < 40) setTimeout(waitForLoad, 50);   // the detail is fetched, so poll briefly
  })();
}

/* ── ARCHIVING A DUPLICATE ───────────────────────────────────────────────────
   🔴 ARCHIVE, NOT DELETE — and that is forced by the backend, not a preference.
   _nextTicketId() is max(existing)+1, so deleting the highest ticket makes the NEXT one
   reuse its id; notes are keyed by TicketID in a separate tab, so the dead ticket's notes
   would silently reattach to a brand-new unrelated ticket. The row therefore stays,
   flagged: out of the queue, out of the weekly report, fully reversible.
   ⚠ "Duplicate of" is REQUIRED. An archive with no target is indistinguishable from a
   mistake six months later, and recording which ticket survived is the entire point. */
function _ticketArchiveBoxHtml(t) {
  if (t.archived) {
    return '<div class="ss-side-grp ss-arch-box is-archived">' +
      '<div class="ss-lbl">Archived duplicate</div>' +
      '<p class="ss-sub" style="margin:.35rem 0 .6rem">Duplicate of <b class="ss-tid">' + esc(t.duplicateOf || '—') + '</b>' +
        (t.archivedBy ? '<br>by ' + esc(t.archivedBy) : '') +
        (t.archivedAt ? ' · ' + esc(_ticketFmtDate(t.archivedAt)) : '') +
      '</p>' +
      '<button class="ps-btn secondary" onclick="_ticketUnarchive()">Restore to the queue</button>' +
      '<span id="td-arch-status" class="ss-status"></span></div>';
  }
  return '<div class="ss-side-grp ss-arch-box">' +
    '<div class="ss-lbl">Archive as a duplicate</div>' +
    '<p class="ss-sub" style="margin:.35rem 0 .5rem">Hides it from the queue and the weekly report. Reversible.</p>' +
    '<div class="ss-arch-row">' +
      '<input id="td-dupof" class="ps-input" placeholder="Duplicate of… e.g. ' + esc(_ticketDupHint(t)) + '">' +
      '<button class="ps-btn secondary" onclick="_ticketArchive()">Archive</button>' +
    '</div>' +
    '<span id="td-arch-status" class="ss-status"></span></div>';
}

/* A useful default for the "duplicate of" box: the newest OTHER ticket from the same rep,
   which is what a duplicate almost always pairs with. Only a placeholder — never
   pre-filled, because a wrong id silently recorded is worse than an empty box. */
function _ticketDupHint(t) {
  var best = '';
  (_TICKETS.list || []).forEach(function (o) {
    if (o.ticketId === t.ticketId || o.archived) return;
    if (String(o.requester || '') !== String(t.requester || '')) return;
    if (!best || String(o.created || '') > best.created) best = { ticketId:o.ticketId, created:String(o.created || '') };
  });
  return (best && best.ticketId) || 'SS-00001';
}

function _tdArchStatus(msg, isErr) {
  var el = document.getElementById('td-arch-status');
  if (el) { el.textContent = msg || ''; el.style.color = isErr ? 'var(--red)' : 'var(--text2)'; }
}

function _ticketArchive() {
  var id = _ticketOpenId(); if (!id) return;
  var el = document.getElementById('td-dupof');
  var dup = el ? String(el.value || '').trim().toUpperCase() : '';
  // Validate here as well as server-side: a round trip to be told "required" is a poor trade.
  if (!dup) { _tdArchStatus('Enter the ticket this duplicates.', true); if (el) el.focus(); return; }
  if (dup === String(id).toUpperCase()) { _tdArchStatus('A ticket cannot duplicate itself.', true); return; }
  _tdArchStatus('Archiving…');
  _ticketPost({ action:'archiveTicket', ticketId:id, duplicateOf:dup }).then(function (res) {
    if (res && res.ok) { _tdArchStatus(''); _ticketSyncListRow(res.ticket); closeTicketModal(); }
    else _tdArchStatus((res && res.error) || 'Could not archive.', true);
  }).catch(function (e) { _tdArchStatus('Error: ' + e.message, true); });
}

function _ticketUnarchive() {
  var id = _ticketOpenId(); if (!id) return;
  _tdArchStatus('Restoring…');
  _ticketPost({ action:'unarchiveTicket', ticketId:id }).then(function (res) {
    if (res && res.ok) { _tdArchStatus(''); _ticketSyncListRow(res.ticket); closeTicketModal(); }
    else _tdArchStatus((res && res.error) || 'Could not restore.', true);
  }).catch(function (e) { _tdArchStatus('Error: ' + e.message, true); });
}

// Toggle the detail modal between read-only + edit; Save posts the whole property set to updateTicket.
function _ticketToggleEdit() {
  if (!_TICKETS.open) return;
  _TICKETS.open.editing = !_TICKETS.open.editing;
  _renderTicketDetail();
}
function _ticketSaveEdit() {
  var id = _ticketOpenId(); if (!id) return;
  var v = function(x){ var e = document.getElementById(x); return e ? String(e.value || '').trim() : undefined; };
  var st = document.getElementById('ted-status');
  if (!_ssPhoneOk(v('ted-phone'))) { if (st) { st.textContent = SS_PHONE_ERR; st.style.color = 'var(--red)'; } return; }
  _ntSetVal('ted-phone', _ssFmtPhone(v('ted-phone')));
  if (st) { st.textContent = 'Saving…'; st.style.color = 'var(--text2)'; }
  _ticketPost({ action:'updateTicket', ticketId:id,
    subject:v('ted-subject'), requester:v('ted-requester'), office:v('ted-office'), channel:v('ted-channel'),
    phone:v('ted-phone'), generalCategory:v('ted-general'), specificCategory:v('ted-specific'),
    saraPlus:v('ted-sara'), dsi:v('ted-dsi'), tags:v('ted-tags')
  }).then(function(res){
    if (res && res.ok && res.ticket) {
      _TICKETS.open.ticket = res.ticket; _TICKETS.open.editing = false;
      _ticketSyncListRow(res.ticket); _renderTicketDetail();
    } else if (st) { st.textContent = (res && res.error) || 'Could not save.'; st.style.color = 'var(--red)'; }
  }).catch(function(e){ if (st) { st.textContent = 'Error: ' + e.message; st.style.color = 'var(--red)'; } });
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
function _ticketAddNote() {
  var id = _ticketOpenId(); if (!id) return;
  var ta = document.getElementById('td-note'); var text = ta ? ta.value.trim() : '';
  if (!text) { _tdStatus('Write a note first.', true); return; }
  _tdStatus('Adding…');
  /* ⚠ The backend now dedupes this on clientKey, but nothing retries it automatically yet:
     _ticketPost is a RAW fetch, not _asFetch, so Sales Support gets no retry and no timeout.
     The key is sent regardless so the guard is live the moment that transport is unified. */
  _ticketPost({ action:'addTicketNote', ticketId:id, note:text, clientKey:_clientKey('tnote') }).then(function(res){
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

/* ── LOADED CONDITIONALLY ────────────────────────────────────────────────────────────────
   index.html injects this bundle only for ?office=salessupport, so it may land AFTER
   app.core.js showApp() has already run. showApp() sets _SS_INIT_PENDING; whichever side
   is last does the init. Without this tail, a slow load means the ticketing UI never
   starts. See _ssTryInitTickets in app.core.js. */
if (typeof _ssTryInitTickets === 'function') _ssTryInitTickets();