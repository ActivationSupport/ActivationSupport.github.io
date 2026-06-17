// ============================================================
//  Activation Support — Customer Booking (PUBLIC web app)
//  Standalone Apps Script project — SEPARATE from the portal.
//  Deploy: Execute as = Me, Who has access = Anyone.
//
//  This app serves the public booking/cancel/reschedule pages and
//  PROXIES every data call to the live Appointment Scheduler backend.
//  The backend API key lives ONLY in this project's Script Properties
//  (server-side) and is NEVER sent to the browser.
//
//  Required Script Properties:
//    APPT_API_URL  — the Appointment Scheduler web app /exec URL
//    APPT_API_KEY  — that backend's API_KEY value
// ============================================================

var OFFICES = ['elevate', 'midspire', 'viridian', 'ignite'];

// ── Page routing ──────────────────────────────────────────────
// ?office=<id>            → booking page (locked to that office)
// ?action=cancel&token=…  → cancel page
// ?action=reschedule&token=… → reschedule page
function doGet(e) {
  var p      = (e && e.parameter) || {};
  var action = String(p.action || 'book').toLowerCase();
  var office = String(p.office || '').toLowerCase();
  var token  = String(p.token || '');

  var file = action === 'cancel' ? 'cancel'
           : action === 'reschedule' ? 'reschedule'
           : 'booking';

  var t   = HtmlService.createTemplateFromFile(file);
  t.office = OFFICES.indexOf(office) !== -1 ? office : '';
  t.token  = token;

  return t.evaluate()
    .setTitle('Schedule Your AT&T Activation')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  // No setXFrameOptionsMode → defaults to DENY-other-origins (Phase 2): the page
  // is opened directly via its per-office link, never embedded, so disallowing
  // framing closes a clickjacking vector with no UX impact.
}

// ── Backend proxy helpers (key kept server-side) ──────────────
function _apptUrl() { return PropertiesService.getScriptProperties().getProperty('APPT_API_URL') || ''; }
function _apptKey() { return PropertiesService.getScriptProperties().getProperty('APPT_API_KEY') || ''; }

function _apiGet(action, params) {
  var url = _apptUrl();
  if (!url) return { error: 'backend not configured' };
  var qs = ['action=' + encodeURIComponent(action), 'key=' + encodeURIComponent(_apptKey())];
  params = params || {};
  Object.keys(params).forEach(function (k) {
    if (params[k] !== null && params[k] !== undefined && params[k] !== '')
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  });
  var full = url + (url.indexOf('?') === -1 ? '?' : '&') + qs.join('&');
  var resp = UrlFetchApp.fetch(full, { muteHttpExceptions: true, followRedirects: true });
  try { return JSON.parse(resp.getContentText()); }
  catch (err) { return { error: 'bad backend response' }; }
}

function _apiPost(bodyObj) {
  var url = _apptUrl();
  if (!url) return { error: 'backend not configured' };
  bodyObj.key = _apptKey();
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(bodyObj),
    muteHttpExceptions: true,
    followRedirects: true
  });
  try { return JSON.parse(resp.getContentText()); }
  catch (err) { return { error: 'bad backend response' }; }
}

// ── Public functions (called from the pages via google.script.run) ──
// All are read-or-book only and pass role 'customer' so the backend never
// grants same-day overrides or reveals other customers' data.

// Opaque, stable public id for an activator so the real work EMAIL never reaches
// the public booking page (Phase 2 — stops harvesting employee emails from the
// page source). Resolved back to the email server-side by recomputing + matching.
function _activatorId(email) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(email || '').trim().toLowerCase());
  return raw.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 16);
}
// Map a public activator id back to the real email by matching against the
// office's roster. '__next__' (Next Available) passes straight through.
function _resolveActivatorId(office, id) {
  if (id === '__next__') return '__next__';
  if (OFFICES.indexOf(office) === -1) return '';
  var acts = _apiGet('getActivators', { officeId: office }).activators || [];
  for (var i = 0; i < acts.length; i++) {
    if (_activatorId(acts[i].email) === id) return String(acts[i].email || '').trim().toLowerCase();
  }
  return '';
}

function getActivatorsPublic(office) {
  if (OFFICES.indexOf(office) === -1) return [];
  var acts = _apiGet('getActivators', { officeId: office }).activators || [];
  // Display-safe only: an opaque id + the display name. No email leaves the server.
  return acts.map(function (a) { return { id: _activatorId(a.email), name: a.name }; });
}

function getWindowPublic() {
  return _apiGet('getBookingWindow', { role: 'customer' }).window || null;
}

function getSlotsPublic(activatorId, date, office) {
  if (activatorId === '__next__') return [];   // use getNextSlotsPublic instead
  var email = _resolveActivatorId(office, activatorId);
  if (!email) return [];
  return _apiGet('getAvailableSlots', { activatorEmail: email, date: date, role: 'customer' }).slots || [];
}

function getNextSlotsPublic(office, date) {
  if (OFFICES.indexOf(office) === -1) return [];
  return _apiGet('getNextAvailableSlots', { officeId: office, date: date, role: 'customer' }).slots || [];
}

function bookPublic(payload) {
  payload = payload || {};
  if (OFFICES.indexOf(payload.office) === -1) return { error: 'invalid office' };
  // Honeypot (Phase 2): a hidden field no human fills. If it has any value the
  // caller is a bot — drop the request but return a normal-looking success so
  // the bot can't tell it was rejected.
  if (String(payload.hp || '').trim() !== '') return { ok: true };
  // Resolve the opaque activator id back to a real email server-side (the email
  // never travels through the browser). '__next__' passes through.
  var activatorEmail = _resolveActivatorId(payload.office, payload.activatorId);
  if (!activatorEmail) return { error: 'invalid activator' };
  // Build the backend request from an explicit allowlist so a caller can't
  // smuggle extra fields (role/booker/status/etc.) through the public app.
  var clean = {
    action:         'bookAppointment',
    source:         'customer',
    role:           'customer',
    office:         payload.office,
    activatorEmail: activatorEmail,
    date:           payload.date,
    timeSlot:       payload.timeSlot,
    customerName:   payload.customerName,
    customerPhone:  payload.customerPhone,
    customerEmail:  payload.customerEmail,
    services:       payload.services,
    deviceCount:    payload.deviceCount,
    nextMode:       payload.nextMode
  };
  return _apiPost(clean);
}

function getByTokenPublic(token) {
  return _apiGet('getAppointmentByToken', { token: token }).appointment || null;
}

function cancelPublic(appointmentId, token) {
  if (!appointmentId || !token) return { error: 'missing token' };
  return _apiPost({ action: 'cancelAppointment', appointmentId: appointmentId, token: token });
}

function reschedulePublic(p) {
  p = p || {};
  if (!p.appointmentId || !p.token || !p.date || !p.timeSlot) return { error: 'missing fields' };
  return _apiPost({
    action: 'rescheduleAppointment',
    appointmentId: p.appointmentId,
    token: p.token,
    date: p.date,
    timeSlot: p.timeSlot,
    activatorEmail: '__next__',   // customer reschedules into any open slot in their office
    role: 'customer'
  });
}
