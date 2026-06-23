// ============================================================
//  Activation Support — Appointment Scheduler
//  Standalone Apps Script project — do NOT paste into Code.gs
// ============================================================

// ── Constants ─────────────────────────────────────────────────
var APPT_TAB    = 'Appointments';
var SCHED_TAB   = 'ActivatorSchedules';
var BLOCKS_TAB  = 'ActivatorBlocks';
var SLOT_MINS   = 60;
var MIN_ADV_HRS = 2;

// Booking window (Phase 1): NO same-day. Earliest bookable = the next day;
// latest = the same weekday next week (rolling 7-day window that slides forward
// daily). This supersedes the old MIN_ADV_HRS same-day rule.
var BOOKING_MIN_DAYS = 1;  // earliest = today + 1
var BOOKING_MAX_DAYS = 7;  // latest   = today + 7 (same weekday next week)

// Fallback working hours for activators who haven't set a custom schedule.
// Mon–Fri 10:00–17:00 in the activator's (office) timezone. They can override
// any/all of this via "Manage My Schedule".
var DEFAULT_HOURS = { start: '10:00', end: '17:00', days: ['mon','tue','wed','thu','fri'] };

var ALL_OFFICES = ['midspire', 'viridian', 'elevate', 'ignite', 'vanguard'];

var OFFICE_TZ = {
  midspire: 'America/Chicago',
  viridian:  'America/Chicago',
  elevate:   'America/Los_Angeles',
  ignite:    'America/Los_Angeles',
  vanguard:  'America/New_York'
};

// Optional per-office call-in fallback number shown in customer emails.
// Leave '' to omit the call-in line (the email still tells the customer the
// activator will call them). Fill these in when the office numbers are known.
var OFFICE_CALLIN = {
  midspire: '(224) 524-8968',
  viridian: '(314) 789-1988',
  elevate:  '(858) 321-5699',
  ignite:   '(949) 841-2241',
  vanguard: '(813) 524-7081'
};

// Per-office colors for the customer booking emails (confirmation / moved /
// reminder). Mirrors the Daily Report branding (portal OFFICE_BRAND) so a
// customer's email matches the office that booked them.
//   band     — dark header bar background (always dark → white text reads)
//   sub      — muted subtitle text on the band
//   accent   — primary fill: Reschedule button bg + info-box left border
//   onAccent — text/label color ON TOP of an accent fill (dark for the light
//              accents — gold / light-blue — so the button stays readable)
//   ink      — readable-on-white accent variant: badge text, Cancel text/border
//   soft     — light accent tint: badge pill bg (+ info-box bg unless boxBg set)
//   boxBg    — (optional) override tint for the "phone appointment" info box,
//              used by dual-color offices so the badge and the box can differ
// Vanguard is a red+blue dual brand: charcoal header, BLUE primary (Reschedule
// button + info-box border) and RED secondary (badge + Cancel outline).
var OFFICE_EMAIL_BRAND = {
  elevate:  { band:'#111827', sub:'#aab8d6', accent:'#0A1FFF', onAccent:'#ffffff', ink:'#0A1FFF', soft:'#e7eaff' },
  midspire: { band:'#0c1d2e', sub:'#a8c8e4', accent:'#4FB0FF', onAccent:'#0c1d2e', ink:'#1573c4', soft:'#e6f4ff' },
  viridian: { band:'#1B3A2D', sub:'#cfd9cf', accent:'#D9C87E', onAccent:'#1B3A2D', ink:'#7a6a2e', soft:'#f6f1de' },
  ignite:   { band:'#211210', sub:'#e3aaaa', accent:'#F0431E', onAccent:'#ffffff', ink:'#c0341a', soft:'#fdeae6' },
  vanguard: { band:'#1C1C1C', sub:'#c9b3b1', accent:'#2652D7', onAccent:'#ffffff', ink:'#c01a1a', soft:'#fbe7e7', boxBg:'#e9eefb' }
};
function _emailBrand(office) {
  return OFFICE_EMAIL_BRAND[String(office || '').toLowerCase()] ||
    { band:'#16314f', sub:'#9db8d6', accent:'#1d4ed8', onAccent:'#ffffff', ink:'#1d4ed8', soft:'#eef5ff' };
}

var APPT_HEADERS = [
  'appointmentId','activatorEmail','bookerEmail','customerName',
  'customerDSI','customerPhone','customerEmail','services',
  'deviceCount','date','timeSlot','office','status','bookedAt','rem24hSent',
  // Phase 1 additions (append-only — never reorder the columns above):
  'outcome','outcomeNote','outcomeBy','outcomeAt',
  // Customer self-booking additions (append-only):
  //   source      — 'rep' (default) | 'customer'
  //   cancelToken — random per-appointment token powering self-service
  //                 cancel/reschedule links in the customer's email
  'source','cancelToken',
  // Google Calendar two-way sync (append-only): id of the event pushed onto the
  // activator's calendar for this appointment, so cancel/reschedule can sync it.
  'calEventId'
];

var SCHED_HEADERS = [
  'email','timezone',
  'monStart','monEnd','tueStart','tueEnd',
  'wedStart','wedEnd','thuStart','thuEnd',
  'friStart','friEnd','satStart','satEnd','sunStart','sunEnd',
  // Phase 1 additions (append-only):
  'bufferMins','maxPerDay',
  // Phase 3: opt-in/out of the booking pool (master-admins default OUT,
  // activators default IN). '' = unset, 'true' = bookable, 'false' = not.
  'bookable'
];

var BLOCKS_HEADERS = [
  'blockId','activatorEmail','date','allDay','startTime','endTime','reason','createdAt'
];

// ── Core helpers ──────────────────────────────────────────────
function _getApiKey()  { return PropertiesService.getScriptProperties().getProperty('API_KEY') || ''; }
function _getSheetId() { return PropertiesService.getScriptProperties().getProperty('SHEET_ID') || ''; }
// Base URL of the public Customer Booking web app. (Legacy — kept for reference;
// the self-service links below now point at the GitHub Pages cancel/reschedule
// pages instead, to dodge the multi-Google-account "unable to open the file" glitch.)
function _getCustomerAppUrl() { return PropertiesService.getScriptProperties().getProperty('CUSTOMER_APP_URL') || ''; }
// Self-service cancel/reschedule pages now live on GitHub Pages (off Apps Script).
// Booking step 2b: emails link to {base}cancel.html / {base}reschedule.html?office=&token=.
var SELF_SERVICE_BASE = 'https://activationsupport.github.io/';

// Fail CLOSED (Phase 2): if API_KEY is unset/blank, deny — never default to allow.
// (API_KEY is confirmed set in production; this only guards against the property
// being cleared by accident and does not change normal behavior.)
function _validateKey(key) {
  var expected = _getApiKey();
  return !!expected && key === expected;
}

// ── Phase 1 Stage C: shared session "badges" (issued by the portal backend) ──
// The portal writes badges to a _Sessions tab in the SAME spreadsheet; here we
// only READ them to derive the caller's real role server-side instead of trusting
// a client-supplied role. STRICT_AUTH (Script Property, default OFF) is the cutover.
var SESSIONS_TAB = '_Sessions';
function _strictAuth() {
  return String(PropertiesService.getScriptProperties().getProperty('STRICT_AUTH') || '').toLowerCase() === 'true';
}
function _hashToken(token) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  return d.map(function(b){ return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function _validateSession(token) {
  if (!token) return { valid:false };
  var sh = _getSS().getSheetByName(SESSIONS_TAB); if (!sh) return { valid:false };
  var th = _hashToken(token);
  var data = sh.getDataRange().getValues();
  var nowIso = new Date().toISOString();
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0]) !== th) continue;
    if (String(data[i][5]) <= nowIso) return { valid:false };
    return { valid:true, email:String(data[i][1]), rank:String(data[i][2]) };
  }
  return { valid:false };
}
// Server-derived role: the badge's role when a valid badge is present; otherwise
// the client-claimed role during the grace period, or '' once strict (so a caller
// can no longer grant itself privilege — same-day, see-PII, cancel — by claiming
// a role). The customer cancel/reschedule flow authorizes by cancelToken, not role,
// so it is unaffected.
function _resolveRole(obj) {
  var s = _validateSession(obj && obj.token);
  if (s && s.valid) return String(s.rank || '');
  return _strictAuth() ? '' : String((obj && obj.role) || '');
}

function _getSS() {
  var id = _getSheetId();
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function _json(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Per-request cache — avoids redundant sheet reads within one execution
var _cache = {};

function _sheetData(tabName) {
  if (_cache[tabName]) return _cache[tabName];
  var sheet = _getSS().getSheetByName(tabName);
  _cache[tabName] = sheet ? sheet.getDataRange().getValues() : [];
  return _cache[tabName];
}

function _bustCache(tabName) { delete _cache[tabName]; }

function _ensureSheet(tabName, headers) {
  var ss    = _getSS();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(headers);
  } else {
    _ensureHeaders(sheet, headers);
  }
  return sheet;
}

// Append-only header migration: if an existing sheet has fewer columns than the
// current header list (because new columns were added in a later release), write
// the missing header labels into row 1. Existing data rows keep their values;
// the new columns simply read back blank for old rows. Never reorders columns.
function _ensureHeaders(sheet, headers) {
  if (!sheet || sheet.getLastRow() === 0) return;
  var have = sheet.getLastColumn();
  if (have >= headers.length) return;
  var missing = headers.slice(have);
  sheet.getRange(1, have + 1, 1, missing.length).setValues([missing]);
  _bustCache(sheet.getName());
}

// ── Booking window ────────────────────────────────────────────
// Returns the inclusive bookable date range as canonical YYYY-MM-DD strings,
// computed in the script timezone. min = tomorrow, max = +7 days.
function _todayStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
// Phase 3 #1b: only activators + master-admins may book/reschedule same-day
// (override of the normal no-same-day rule). Role is supplied by the caller,
// same trust model the rest of this file uses for see-name / reschedule / cancel.
function _sameDayAllowed(role) {
  role = String(role || '').trim();
  return role === 'master-admin' || role === 'activator';
}
function _bookingWindow(allowSameDay) {
  var tz  = Session.getScriptTimeZone();
  var now = Date.now();
  var minDays = allowSameDay ? 0 : BOOKING_MIN_DAYS;   // same-day override drops the floor to today
  return {
    min: Utilities.formatDate(new Date(now + minDays * 86400000), tz, 'yyyy-MM-dd'),
    max: Utilities.formatDate(new Date(now + BOOKING_MAX_DAYS * 86400000), tz, 'yyyy-MM-dd')
  };
}
function _inBookingWindow(dateStr, allowSameDay) {
  var w = _bookingWindow(allowSameDay);
  return dateStr >= w.min && dateStr <= w.max;
}

function _pad(n) { return String(n).padStart(2, '0'); }

// Google Sheets auto-coerces "2026-06-12" / "10:00" into Date objects on write.
// These normalize a cell back to the canonical 'YYYY-MM-DD' / 'HH:MM' strings
// so calendar-grid keys and booked-slot lookups match regardless of storage.
function _normDateCell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);   // ISO with time component
  return m ? m[1] + '-' + m[2] + '-' + m[3] : s;
}
function _normTimeCell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  var s = String(v || '').trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? _pad(Number(m[1])) + ':' + m[2] : s;
}

function _capitalize(str) {
  if (!str) return '';
  return String(str).charAt(0).toUpperCase() + String(str).slice(1);
}

function _formatDate(dateStr) {
  if (!dateStr) return '';
  var parts = String(dateStr).split('-').map(Number);
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[parts[1] - 1] + ' ' + parts[2] + ', ' + parts[0];
}

function _formatTime(timeStr) {
  if (!timeStr) return '';
  var parts  = String(timeStr).split(':').map(Number);
  var h      = parts[0];
  var m      = parts[1];
  var suffix = h >= 12 ? 'PM' : 'AM';
  var hour   = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return hour + ':' + _pad(m) + ' ' + suffix;
}

// Phone-call logistics line for customer emails. The activator calls the
// customer at the number on file; an optional office call-in number is the
// fallback. Returns the two logistics lines as plain text.
function _callInBlock(office, customerPhone) {
  var lines = [];
  if (customerPhone) {
    lines.push('Your activation specialist will CALL YOU at ' + customerPhone + ' at the time above.');
  } else {
    lines.push('Your activation specialist will call you at the time above.');
  }
  var callIn = OFFICE_CALLIN[String(office || '').toLowerCase()] || '';
  if (callIn) {
    lines.push('If you need to reach us, call ' + callIn + '.');
  } else {
    lines.push('If you need to reschedule or have questions, contact your representative.');
  }
  return lines.join('\n');
}

// Cross-writes an appointment's activation note into the portal's existing
// _Notes_<officeId> tab (same Sheet ID) so it surfaces in the portal's note
// sections for that DSI. Reuses the existing 'activation' note type.
// Schema: dsi | timestamp | authorEmail | authorName | noteText | noteType | linesActivated
function _appendActivationNote(officeId, dsi, authorEmail, authorName, noteText, linesActivated) {
  if (!officeId || !dsi || !noteText) return;
  var ss   = _getSS();
  var name = '_Notes_' + officeId;
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['dsi','timestamp','authorEmail','authorName','noteText','noteType','linesActivated']);
    sheet.getRange(1,1,1,7).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var n = Math.max(0, parseInt(linesActivated, 10) || 0);
  sheet.appendRow([String(dsi).trim(), new Date(), authorEmail || '', authorName || '', noteText, 'activation', n]);
}

// ── Routing ───────────────────────────────────────────────────
function doGet(e) {
  var key = (e && e.parameter && e.parameter.key) || '';
  if (!_validateKey(key)) return _json({ error: 'unauthorized' });
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    var p      = (e && e.parameter) || {};
    p.role = _resolveRole(p);   // Stage C: trust the badge's role, not the client's claim
    if (action === 'getActivators')        return _json({ activators: getActivators(p.officeId || '') });
    if (action === 'getAvailableSlots')    return _json({ slots: getAvailableSlots(p.activatorEmail, p.date, p.excludeId || '', _sameDayAllowed(p.role)) });
    if (action === 'getNextAvailableSlots') return _json({ slots: getNextAvailableSlots(p.officeId || '', p.date, _sameDayAllowed(p.role)) });
    if (action === 'getOfficeBlocks')      return _json({ blocks: getOfficeBlocks(p.officeId || '', p.dates || '', p.role) });
    if (action === 'getAppointments')      return _json({ appointments: getAppointments(p.officeId, p.bookerEmail, p.role) });
    if (action === 'getActivatorSchedule') return _json({ schedule: getActivatorSchedule(p.email) });
    if (action === 'getActivatorBlocks')   return _json({ blocks: getActivatorBlocks(p.email) });
    if (action === 'getBookingWindow')      return _json({ window: _bookingWindow(_sameDayAllowed(p.role)) });
    if (action === 'getAppointmentByToken') return _json({ appointment: getAppointmentByToken(p.token) });
    return _json({ error: 'unknown action: ' + action });
  } catch (err) { return _json({ error: err.message }); }
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return _json({ error: 'invalid JSON' }); }
  if (!_validateKey(body.key || '')) return _json({ error: 'unauthorized' });
  try {
    var action = body.action || '';
    body.role = _resolveRole(body);   // Stage C: trust the badge's role, not the client's claim
    if (action === 'bookAppointment')      return _json(bookAppointment(body));
    if (action === 'cancelAppointment')    return _json(cancelAppointment(body));
    if (action === 'deleteAppointment')    return _json(deleteAppointment(body));
    if (action === 'rescheduleAppointment') return _json(rescheduleAppointment(body));
    if (action === 'setApptOutcome')        return _json(setApptOutcome(body));
    if (action === 'setActivatorTimezone') return _json(setActivatorTimezone(body));
    if (action === 'setActivatorSchedule') return _json(setActivatorSchedule(body));
    if (action === 'addActivatorBlock')    return _json(addActivatorBlock(body));
    if (action === 'removeActivatorBlock') return _json(removeActivatorBlock(body));
    if (action === 'setupReminderTrigger') return _json(setupReminderTrigger());
    return _json({ error: 'unknown action: ' + action });
  } catch (err) { return _json({ error: err.message }); }
}

// ── Activators ────────────────────────────────────────────────
// Reads from _Roster_<officeId> tabs. Returns active activators
// (rank=activator) and master-admins, deduplicated across offices.
// Each activator's bookable offices come from their permissions column (J).
function getActivators(officeId) {
  var ss         = _getSS();
  var activators = [];
  var seen       = {};
  var offices    = officeId ? [officeId] : ALL_OFFICES;

  offices.forEach(function(oid) {
    var sheet = ss.getSheetByName('_Roster_' + oid);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var row         = data[i];
      var email       = String(row[0] || '').trim().toLowerCase();
      if (!email || seen[email]) continue;
      var rank        = String(row[3] || '').trim().toLowerCase();
      var deactivated = row[4] === true || String(row[4]).toUpperCase() === 'TRUE';
      if (deactivated) continue;
      if (rank !== 'activator' && rank !== 'master-admin') continue;
      var officesStr  = String(row[9] || '').trim() || oid;
      var timezone    = String(row[10] || '').trim() || OFFICE_TZ[oid] || 'America/Los_Angeles';
      // If filtering by officeId, only include activators whose permissions include that office
      if (officeId && officesStr.split(',').map(function(o){ return o.trim(); }).indexOf(officeId) === -1) continue;
      // Phase 3: booking-pool opt-in/out. master-admin is IN only if explicitly
      // bookable==='true' (default OUT — most don't activate); activator is IN
      // unless explicitly bookable==='false' (default IN, can opt out).
      var sched   = getActivatorSchedule(email);
      var include = (rank === 'master-admin') ? (sched.bookable === 'true') : (sched.bookable !== 'false');
      seen[email] = true;
      if (!include) continue;
      activators.push({
        email:    email,
        name:     String(row[1] || '').trim(),
        rank:     rank,
        offices:  officesStr.split(',').map(function(o){ return o.trim(); }),
        timezone: timezone,
        schedule: sched
      });
    }
  });

  return activators;
}

// ── Activator Schedule ────────────────────────────────────────
// One row per activator in ActivatorSchedules tab.
// Stores their weekly working hours (start/end per day) and timezone.
function getActivatorSchedule(email) {
  var e    = String(email || '').trim().toLowerCase();
  var rows = _sheetData(SCHED_TAB);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === e) {
      // Normalize each time cell: Google Sheets can coerce "10:00" into a Date
      // object on write, which would later break _generateSlots / _apptSlotInSched
      // ("startTime.split is not a function"). _normTimeCell → canonical "HH:MM".
      var t = _normTimeCell;
      return {
        timezone: rows[i][1]  || '',
        mon: { start: t(rows[i][2]),  end: t(rows[i][3])  },
        tue: { start: t(rows[i][4]),  end: t(rows[i][5])  },
        wed: { start: t(rows[i][6]),  end: t(rows[i][7])  },
        thu: { start: t(rows[i][8]),  end: t(rows[i][9])  },
        fri: { start: t(rows[i][10]), end: t(rows[i][11]) },
        sat: { start: t(rows[i][12]), end: t(rows[i][13]) },
        sun: { start: t(rows[i][14]), end: t(rows[i][15]) },
        bufferMins: Number(rows[i][16]) || 0,   // 0 = off
        maxPerDay:  Number(rows[i][17]) || 0,    // 0 = unlimited
        bookable:   String(rows[i][18] || '').trim().toLowerCase()   // '' | 'true' | 'false'
      };
    }
  }
  // Default: no schedule set
  return {
    timezone: '',
    mon:{start:'',end:''}, tue:{start:'',end:''}, wed:{start:'',end:''},
    thu:{start:'',end:''}, fri:{start:'',end:''}, sat:{start:'',end:''},
    sun:{start:'',end:''},
    bufferMins: 0, maxPerDay: 0, bookable: ''
  };
}

function setActivatorSchedule(body) {
  var sheet = _ensureSheet(SCHED_TAB, SCHED_HEADERS);
  // Force the 14 time columns (start/end × 7 days, cols 3–16) to plain text so
  // Sheets doesn't coerce "10:00" into a Date object on write (the coercion that
  // caused "startTime.split is not a function"). Read side also normalizes.
  sheet.getRange(1, 3, sheet.getMaxRows(), 14).setNumberFormat('@');
  var email = String(body.email || '').trim().toLowerCase();
  if (!email) return { error: 'missing email' };
  var sched = body.schedule || {};
  var tz    = String(body.timezone || '').trim();
  var row   = [
    email, tz,
    (sched.mon && sched.mon.start) || '', (sched.mon && sched.mon.end) || '',
    (sched.tue && sched.tue.start) || '', (sched.tue && sched.tue.end) || '',
    (sched.wed && sched.wed.start) || '', (sched.wed && sched.wed.end) || '',
    (sched.thu && sched.thu.start) || '', (sched.thu && sched.thu.end) || '',
    (sched.fri && sched.fri.start) || '', (sched.fri && sched.fri.end) || '',
    (sched.sat && sched.sat.start) || '', (sched.sat && sched.sat.end) || '',
    (sched.sun && sched.sun.start) || '', (sched.sun && sched.sun.end) || '',
    Number(body.bufferMins) || 0,   // 0 = no buffer
    Number(body.maxPerDay)  || 0,    // 0 = unlimited
    (body.bookable === true || String(body.bookable).toLowerCase() === 'true') ? 'true' : 'false'   // booking-pool opt-in
  ];
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      _bustCache(SCHED_TAB);
      return { ok: true };
    }
  }
  sheet.appendRow(row);
  _bustCache(SCHED_TAB);
  return { ok: true };
}

// Writes timezone to column K (index 10) of the _Roster_ tab
// so the portal reflects the activator's timezone immediately.
function setActivatorTimezone(body) {
  var ss    = _getSS();
  var email = String(body.email || '').trim().toLowerCase();
  var tz    = String(body.timezone || '').trim();
  if (!email || !tz) return { error: 'missing email or timezone' };
  var updated = false;
  ALL_OFFICES.forEach(function(oid) {
    var sheet = ss.getSheetByName('_Roster_' + oid);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() === email) {
        sheet.getRange(i + 1, 11).setValue(tz); // Column K (1-indexed = 11)
        updated = true;
      }
    }
  });
  if (!updated) return { error: 'email not found in any roster' };
  return { ok: true };
}

// ── Blocked Times ─────────────────────────────────────────────
// Activators can block specific dates or time ranges.
// All-day blocks prevent any bookings that day.
// Partial blocks prevent bookings that overlap the blocked window.
function getActivatorBlocks(email) {
  var e    = String(email || '').trim().toLowerCase();
  var rows = _sheetData(BLOCKS_TAB);
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    if (String(rows[i][1]).trim().toLowerCase() !== e) continue;
    result.push({
      blockId:        rows[i][0],
      activatorEmail: rows[i][1],
      date:           rows[i][2],
      allDay:         rows[i][3] === true || rows[i][3] === 'TRUE',
      startTime:      rows[i][4] || '',
      endTime:        rows[i][5] || '',
      reason:         rows[i][6] || '',
      createdAt:      rows[i][7] || ''
    });
  }
  return result;
}

function addActivatorBlock(body) {
  var sheet = _ensureSheet(BLOCKS_TAB, BLOCKS_HEADERS);
  var email = String(body.activatorEmail || '').trim().toLowerCase();
  if (!email || !body.date) return { error: 'missing required fields' };
  var blockId = 'BLK' + Date.now();
  sheet.appendRow([
    blockId, email, body.date,
    body.allDay === true || body.allDay === 'true',
    body.startTime || '', body.endTime || '',
    body.reason || '', new Date().toISOString()
  ]);
  _bustCache(BLOCKS_TAB);
  return { ok: true, blockId: blockId };
}

function removeActivatorBlock(body) {
  var sheet = _ensureSheet(BLOCKS_TAB, BLOCKS_HEADERS);
  var id    = String(body.blockId || '').trim();
  if (!id) return { error: 'missing blockId' };
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) {
      sheet.deleteRow(i + 1);
      _bustCache(BLOCKS_TAB);
      return { ok: true };
    }
  }
  return { error: 'block not found' };
}

// ── Availability ──────────────────────────────────────────────
// Returns available 1-hour slots for an activator on a given date.
// Filters out: already-booked slots, blocked times, past slots.
// Slots are generated from the activator's own schedule (their timezone hours).
function getAvailableSlots(activatorEmail, dateStr, excludeAppointmentId, allowSameDay) {
  var email = String(activatorEmail || '').trim().toLowerCase();
  if (!email || !dateStr) return [];

  // No same-day: only dates inside the rolling [tomorrow, +7 days] window are
  // bookable. This replaces the old MIN_ADV_HRS advance-notice rule.
  // allowSameDay (activator/master-admin override) drops the floor to today.
  if (!_inBookingWindow(dateStr, allowSameDay)) return [];

  var sched    = getActivatorSchedule(email);
  var dayKeys  = ['sun','mon','tue','wed','thu','fri','sat'];
  var date     = new Date(dateStr + 'T12:00:00');
  var dayKey   = dayKeys[date.getDay()];
  var daySched = sched[dayKey];

  // Fall back to default working hours (Mon–Fri 10–5) when the activator
  // hasn't set custom hours for this day.
  if (!daySched || !daySched.start || !daySched.end) {
    if (DEFAULT_HOURS.days.indexOf(dayKey) === -1) return [];
    daySched = { start: DEFAULT_HOURS.start, end: DEFAULT_HOURS.end };
  }

  var booked = _getBookedSlots(email, dateStr, excludeAppointmentId || '');

  // Guardrail: max appointments per day (0 = unlimited). If already at the cap,
  // no further slots are offered for this date.
  if (sched.maxPerDay > 0 && Object.keys(booked).length >= sched.maxPerDay) return [];

  var slots  = _generateSlots(daySched.start, daySched.end);
  var blocks = getActivatorBlocks(email).filter(function(b) { return String(b.date) === dateStr; });
  // Two-way calendar: the activator's external Google Calendar events also block
  // slots (times only). Unlinked activators contribute nothing here.
  blocks = blocks.concat(_getCalendarBlocks(email, dateStr));

  slots = slots.filter(function(s) { return !booked[s]; });
  slots = slots.filter(function(s) { return !_isSlotBlocked(s, blocks); });

  // Guardrail: per-activator buffer (0 = off). A slot is unavailable if it sits
  // closer than `bufferMins` to any of the activator's other appointments.
  if (sched.bufferMins > 0) {
    var bookedStarts = Object.keys(booked).map(function(t) {
      var p = t.split(':').map(Number); return p[0] * 60 + p[1];
    });
    slots = slots.filter(function(s) {
      var p = s.split(':').map(Number);
      var sStart = p[0] * 60 + p[1], sEnd = sStart + SLOT_MINS;
      for (var i = 0; i < bookedStarts.length; i++) {
        var bStart = bookedStarts[i], bEnd = bStart + SLOT_MINS;
        var gap = sStart >= bEnd ? sStart - bEnd : (bStart >= sEnd ? bStart - sEnd : -1);
        if (gap < sched.bufferMins) return false;   // gap < 0 means overlap
      }
      return true;
    });
  }

  return slots;
}

// Union of open slots across every activator in the office, for "Next
// Available Agent" bookings. Returns a sorted, de-duplicated slot list.
function getNextAvailableSlots(officeId, dateStr, allowSameDay) {
  if (!dateStr) return [];
  var acts = getActivators(officeId || '');
  var set  = {};
  acts.forEach(function(a) {
    getAvailableSlots(a.email, dateStr, '', allowSameDay).forEach(function(s) { set[s] = true; });
  });
  return Object.keys(set).sort();
}

// Per-office "unavailable" slots for the calendar grid. For each activator/date,
// returns the in-schedule 1-hr slots that are NOT bookable and NOT already booked
// — i.e. blocked by a Google Calendar event, a manual block, or a buffer/cap. The
// portal grid is otherwise client-side + block-blind; this lets it mark those
// cells. Batched (all activators × the given dates) so it's one call. Out-of-window
// dates return [] (the grid already shows those as "outside the window").
function getOfficeBlocks(officeId, datesCsv, role) {
  var allowSameDay = _sameDayAllowed(role);
  var dates = String(datesCsv || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  if (!dates.length) return {};
  var SLOTS   = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00'];
  var dayKeys = ['sun','mon','tue','wed','thu','fri','sat'];
  var acts       = getActivators(officeId || '');
  var thisOffice = String(officeId || '').trim().toLowerCase();
  var out  = {};
  acts.forEach(function(a){
    var email  = String(a.email || '').trim().toLowerCase();
    var byDate = {};
    dates.forEach(function(d){
      if (!_inBookingWindow(d, allowSameDay)) { byDate[d] = {}; return; }
      var sched = getActivatorSchedule(email);
      var dk    = dayKeys[new Date(d + 'T12:00:00').getDay()];
      var day   = sched[dk];
      if (!day || !day.start || !day.end) {
        if (DEFAULT_HOURS.days.indexOf(dk) === -1) { byDate[d] = {}; return; }
        day = { start: DEFAULT_HOURS.start, end: DEFAULT_HOURS.end };
      }
      var availSet = {};
      getAvailableSlots(email, d, '', allowSameDay).forEach(function(s){ availSet[s] = true; });
      // {slot: officeId} for THIS activator across ALL offices, so a slot taken at
      // a different office shows as "Booked — <office>" rather than open.
      var bookedOffice = _bookedSlotOffices(email, d);
      var map = {};
      SLOTS.forEach(function(s){
        if (!_slotInRange(s, day.start, day.end)) return;   // outside schedule → "closed", not blocked
        if (availSet[s]) return;                            // still bookable → not blocked
        var bo = bookedOffice[s];
        if (bo) {
          if (bo === thisOffice) return;                    // booked HERE → already shown as a booked cell
          map[s] = 'Booked — ' + _capitalize(bo);      // cross-office booking
        } else {
          map[s] = 'Unavailable';                           // calendar event / manual block / buffer
        }
      });
      byDate[d] = map;
    });
    out[email] = byDate;
  });
  return out;
}

// Resolves "Next Available Agent" to a concrete activator for a date+slot.
// mode 'soonest' (default) = first free in roster order (original behavior).
// mode 'balance' (Phase 3 #1a, round-robin) = the free activator with the
// fewest appointments that day; roster order breaks ties. Returns '' if nobody
// is free.
function _resolveNextActivator(officeId, dateStr, timeSlot, mode, allowSameDay) {
  var acts = getActivators(officeId || '');
  var free = acts.filter(function(a) {
    return getAvailableSlots(a.email, dateStr, '', allowSameDay).indexOf(timeSlot) !== -1;
  });
  if (!free.length) return '';
  if (mode === 'balance') {
    var best = null, bestLoad = Infinity, bestIdx = Infinity;
    free.forEach(function(a) {
      var load = Object.keys(_getBookedSlots(a.email, dateStr, '')).length;
      var idx  = acts.indexOf(a);   // roster position = deterministic tie-breaker
      if (load < bestLoad || (load === bestLoad && idx < bestIdx)) { best = a; bestLoad = load; bestIdx = idx; }
    });
    return best ? best.email : '';
  }
  return free[0].email;   // 'soonest'
}

function _generateSlots(startTime, endTime) {
  var slots = [];
  var startParts = startTime.split(':').map(Number);
  var endParts   = endTime.split(':').map(Number);
  var h = startParts[0];
  var m = startParts[1];
  var endMin = endParts[0] * 60 + endParts[1];
  while (h * 60 + m + SLOT_MINS <= endMin) {
    slots.push(_pad(h) + ':' + _pad(m));
    m += SLOT_MINS;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  }
  return slots;
}

function _getBookedSlots(activatorEmail, dateStr, excludeId) {
  var booked = {};
  var rows   = _sheetData(APPT_TAB);
  // Appointments column map (0-indexed):
  // 0=appointmentId, 1=activatorEmail, 2=bookerEmail, 3=customerName,
  // 4=customerDSI,   5=customerPhone,  6=customerEmail, 7=services,
  // 8=deviceCount,   9=date,           10=timeSlot,     11=office,
  // 12=status,       13=bookedAt,      14=rem24hSent
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    if (String(r[0]).trim() === excludeId) continue;
    if (String(r[1]).trim().toLowerCase() !== activatorEmail) continue;
    if (_normDateCell(r[9]) !== dateStr) continue;
    if (String(r[12]).trim().toLowerCase() === 'cancelled') continue;
    booked[_normTimeCell(r[10])] = true;
  }
  return booked;
}

// Like _getBookedSlots but returns { slot: officeId } for this activator's active
// appointments on a date, ACROSS ALL offices — lets the grid label a slot
// "Booked — <office>" when it's taken at a different office than the one in view.
function _bookedSlotOffices(activatorEmail, dateStr) {
  var out  = {};
  var rows = _sheetData(APPT_TAB);
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    if (String(r[1]).trim().toLowerCase() !== activatorEmail) continue;
    if (_normDateCell(r[9]) !== dateStr) continue;
    if (String(r[12]).trim().toLowerCase() === 'cancelled') continue;
    out[_normTimeCell(r[10])] = String(r[11] || '').trim().toLowerCase();
  }
  return out;
}

function _isSlotBlocked(slot, blocks) {
  if (!blocks.length) return false;
  var slotParts = slot.split(':').map(Number);
  var slotStart = slotParts[0] * 60 + slotParts[1];
  var slotEnd   = slotStart + SLOT_MINS;
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.allDay) return true;
    if (!b.startTime || !b.endTime) continue;
    var bStart = b.startTime.split(':').map(Number);
    var bEnd   = b.endTime.split(':').map(Number);
    var blockStart = bStart[0] * 60 + bStart[1];
    var blockEnd   = bEnd[0]   * 60 + bEnd[1];
    if (slotStart < blockEnd && slotEnd > blockStart) return true;
  }
  return false;
}

// ── Google Calendar two-way sync ──────────────────────────────────────────────
// Activators link by sharing their personal Google Calendar with THIS backend's
// owner account (activationsupport.bookings) at "Make changes to events". Then:
//   • READ  — every event on their calendar that day blocks the overlapping slot
//             (times only; we never read titles/details). Events they've DECLINED
//             are skipped; all-day events block the whole day.
//   • WRITE — a booked activation is pushed onto their calendar as
//             "Activation Appointment – <Office>"; cancel removes it, reschedule
//             moves it. The event id is stored on the appointment row (col 22).
// Not linked → getCalendarById returns null and every call silently no-ops, so
// unlinked activators behave exactly as before.

function _hmToMin(hm)  { var p = String(hm).split(':'); return Number(p[0]) * 60 + Number(p[1]); }
function _minToHm(min) { return _pad(Math.floor(min / 60)) + ':' + _pad(min % 60); }
// True if a 1-hour slot starting at `slot` fits entirely within [start,end).
function _slotInRange(slot, start, end) {
  var s = _hmToMin(slot), st = _hmToMin(start), en = _hmToMin(end);
  return s >= st && s + SLOT_MINS <= en;
}

// The activator's scheduling timezone (their schedule's tz, else the script tz).
function _activatorTz(email) {
  return getActivatorSchedule(email).timezone || Session.getScriptTimeZone();
}

// Absolute Date for `dateStr` at `minutes` past midnight, as read in `tz`.
// Offset-correction: render a UTC guess in tz, measure the gap, shift by it.
// DST-safe for business hours (the guess sits the same day as the result).
function _localDateTime(dateStr, minutes, tz) {
  var hhmm  = _minToHm(minutes);
  var guess = new Date(dateStr + 'T' + hhmm + ':00Z');                  // treat as UTC
  var shown = Utilities.formatDate(guess, tz, "yyyy-MM-dd'T'HH:mm:ss"); // what tz shows
  var delta = new Date(dateStr + 'T' + hhmm + ':00').getTime() - new Date(shown).getTime();
  return new Date(guess.getTime() + delta);
}

function _bustCalCache(email, dateStr) {
  try { CacheService.getScriptCache().remove('calblk_' + String(email).trim().toLowerCase() + '_' + dateStr); }
  catch (e) {}
}

// Resolve an activator's calendar, auto-subscribing if needed. Google quirk: a
// calendar shared WITH this account isn't readable via getCalendarById until the
// account has "added" (subscribed to) it — the share grants access, subscribing
// makes it appear. So on a miss we subscribe once and retry, which means an
// activator only has to SHARE their calendar; the backend adds itself. A short
// cache stops us re-subscribing every call for activators who haven't shared.
function _getActivatorCalendar(email) {
  var cal = CalendarApp.getCalendarById(email);
  if (cal) return cal;
  var ckey  = 'calsub_' + email;
  var cache = CacheService.getScriptCache();
  if (cache.get(ckey)) return null;            // recently tried + failed → don't hammer
  try {
    CalendarApp.subscribeToCalendar(email);
    cal = CalendarApp.getCalendarById(email);
  } catch (e) { cal = null; }                  // not shared with us → no access
  if (!cal) cache.put(ckey, '1', 300);         // 5-min cooldown before retrying an unshared calendar
  return cal;
}

// The activator's external Google Calendar events for dateStr, as block objects
// ({allDay:true} or {startTime,endTime}) compatible with _isSlotBlocked. Cached
// ~45s so the Next-Available roster loop doesn't re-hit the Calendar API per call.
function _getCalendarBlocks(activatorEmail, dateStr) {
  var email = String(activatorEmail || '').trim().toLowerCase();
  if (!email || !dateStr) return [];
  var ckey  = 'calblk_' + email + '_' + dateStr;
  var cache = CacheService.getScriptCache();
  var hit   = cache.get(ckey);
  if (hit !== null) { try { return JSON.parse(hit); } catch (e) {} }

  var blocks = [];
  try {
    var cal = _getActivatorCalendar(email);
    if (cal) {
      var tz       = _activatorTz(email);
      var dayStart = new Date(dateStr + 'T00:00:00');
      var dayEnd   = new Date(dateStr + 'T23:59:59');
      // Pad the query window ±12h so events near local midnight / across timezones
      // are still caught, then we filter precisely in the activator's tz below.
      var events = cal.getEvents(new Date(dayStart.getTime() - 432e5),
                                 new Date(dayEnd.getTime()   + 432e5));
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        try { if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) continue; } catch (e) {}  // skip declined
        if (ev.isAllDayEvent()) {
          var s  = Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd');
          var e2 = Utilities.formatDate(ev.getAllDayEndDate(),   tz, 'yyyy-MM-dd');  // exclusive end
          if (dateStr >= s && dateStr < e2) blocks.push({ allDay: true });
          continue;
        }
        var dS = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
        var dE = Utilities.formatDate(ev.getEndTime(),   tz, 'yyyy-MM-dd');
        if (dateStr < dS || dateStr > dE) continue;                       // event doesn't touch this day
        var startMin = (dateStr > dS) ? 0    : _hmToMin(Utilities.formatDate(ev.getStartTime(), tz, 'HH:mm'));
        var endMin   = (dateStr < dE) ? 1440 : _hmToMin(Utilities.formatDate(ev.getEndTime(),   tz, 'HH:mm'));
        if (endMin > startMin) blocks.push({ startTime: _minToHm(startMin), endTime: _minToHm(endMin) });
      }
    }
  } catch (err) { Logger.log('Calendar read error for ' + email + ': ' + err); }
  cache.put(ckey, JSON.stringify(blocks), 45);
  return blocks;
}

// Pushes an activation onto the activator's calendar. Returns the event id (or '').
function _createCalendarEvent(activatorEmail, dateStr, timeSlot, office) {
  var email = String(activatorEmail || '').trim().toLowerCase();
  if (!email || !dateStr || !timeSlot) return '';
  try {
    var cal = _getActivatorCalendar(email);
    if (!cal) return '';
    var tz    = _activatorTz(email);
    var start = _localDateTime(dateStr, _hmToMin(timeSlot), tz);
    var end   = _localDateTime(dateStr, _hmToMin(timeSlot) + SLOT_MINS, tz);
    var ev    = cal.createEvent('Activation Appointment – ' + _capitalize(office), start, end);
    _bustCalCache(email, dateStr);
    return ev.getId() || '';
  } catch (err) { Logger.log('createCalendarEvent error for ' + email + ': ' + err); return ''; }
}

// Removes a pushed activation event from the activator's calendar.
function _deleteCalendarEvent(activatorEmail, calEventId, dateStr) {
  var email = String(activatorEmail || '').trim().toLowerCase();
  var id    = String(calEventId || '').trim();
  if (!email || !id) return;
  try {
    var cal = _getActivatorCalendar(email);
    if (!cal) return;
    var ev = cal.getEventById(id);
    if (ev) ev.deleteEvent();
    if (dateStr) _bustCalCache(email, dateStr);
  } catch (err) { Logger.log('deleteCalendarEvent error for ' + email + ': ' + err); }
}

// ── Formula-injection guard (Phase 2) ────────────────────────────────────────
// Customer free-text (name, phone, email, services, DSI) lands in a sheet that
// staff later open. A value beginning with = + - @ (or a tab/CR that Sheets may
// reinterpret) would be evaluated as a formula. Prefixing a single quote forces
// Sheets to treat it as literal text without changing what staff see.
function _sanitizeCell(v) {
  var s = String(v == null ? '' : v);
  if (s && /^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

// ── Appointments ──────────────────────────────────────────────
function bookAppointment(body) {
  var sheet          = _ensureSheet(APPT_TAB, APPT_HEADERS);
  // Keep date (col 10) & timeSlot (col 11) as plain text so Sheets doesn't
  // coerce "2026-06-12"/"10:00" into Date objects on write.
  sheet.getRange(1, 10, sheet.getMaxRows(), 2).setNumberFormat('@');
  // 'customer' = public self-booking via the Customer Booking app; anything
  // else is treated as a rep booking from the portal.
  var source         = String(body.source || 'rep').trim().toLowerCase() === 'customer' ? 'customer' : 'rep';
  var bookerEmail    = String(body.bookerEmail || '').trim().toLowerCase();
  // Self-booking customers have no rep "booker" — stamp a system sentinel so
  // the row still has a non-empty booker (used by getAppointments scoping).
  if (!bookerEmail && source === 'customer') bookerEmail = 'customer-self-booking';
  var activatorEmail = String(body.activatorEmail || '').trim().toLowerCase();
  var date           = String(body.date || '').trim();
  var timeSlot       = String(body.timeSlot || '').trim();
  var office         = String(body.office || '').trim();

  if (!bookerEmail || !activatorEmail || !date || !timeSlot || !office)
    return { error: 'missing required fields' };
  // Name / phone / email are always required. DSI is required for REP bookings
  // only — a self-booking customer doesn't know their DSI (the activator
  // matches the order later).
  if (!body.customerName || !body.customerPhone || !body.customerEmail)
    return { error: 'missing customer fields' };
  if (source !== 'customer' && !body.customerDSI)
    return { error: 'missing customer fields' };

  // Same-day override: granted only when the booker's role is activator/master-admin.
  // Customer self-bookings pass role 'customer', so they never get same-day.
  var allowSameDay = _sameDayAllowed(body.role);

  // No same-day / outside the rolling window (unless overridden above).
  if (!_inBookingWindow(date, allowSameDay)) return { error: 'outside_window' };

  // Light spam/duplicate guard for customer self-bookings: the same phone
  // number can't hold two active appointments on the same date.
  if (source === 'customer') {
    var phoneNorm = String(body.customerPhone || '').replace(/\D/g, '');
    if (phoneNorm) {
      var existRows = _sheetData(APPT_TAB);
      for (var di = 1; di < existRows.length; di++) {
        var er = existRows[di];
        if (!er[0]) continue;
        if (String(er[12]).trim().toLowerCase() === 'cancelled') continue;
        if (_normDateCell(er[9]) !== date) continue;
        if (String(er[5] || '').replace(/\D/g, '') === phoneNorm)
          return { error: 'duplicate' };
      }
    }
  }

  // "Next Available Agent": resolve to whichever activator is free for this slot.
  // nextMode ('soonest' default | 'balance') selects round-robin fairness.
  if (activatorEmail === '__next__') {
    activatorEmail = _resolveNextActivator(office, date, timeSlot, body.nextMode || 'soonest', allowSameDay);
    if (!activatorEmail) return { error: 'slot_unavailable' };
  }

  // Verify slot is still open
  var available = getAvailableSlots(activatorEmail, date, '', allowSameDay);
  if (available.indexOf(timeSlot) === -1) return { error: 'slot_unavailable' };

  var appointmentId = 'APT' + Date.now();
  var cancelToken   = Utilities.getUuid();   // powers self-service cancel/reschedule links
  var services      = Array.isArray(body.services)
    ? body.services.join(', ')
    : String(body.services || '');

  var row = [
    appointmentId,
    activatorEmail,
    bookerEmail,
    _sanitizeCell(String(body.customerName  || '').trim()),
    _sanitizeCell(String(body.customerDSI   || '').trim()),
    _sanitizeCell(String(body.customerPhone || '').trim()),
    _sanitizeCell(String(body.customerEmail || '').trim()),
    _sanitizeCell(services),
    Number(body.deviceCount)  || 1,
    date,
    timeSlot,
    office,
    'confirmed',
    new Date().toISOString(),
    false,  // rem24hSent
    '',     // outcome
    '',     // outcomeNote
    '',     // outcomeBy
    '',     // outcomeAt
    source,       // 'rep' | 'customer'
    cancelToken   // self-service token
  ];

  sheet.appendRow(row);
  _bustCache(APPT_TAB);

  // Two-way calendar: push this activation onto the activator's Google Calendar
  // (if linked) and remember the event id on the row so cancel/reschedule sync.
  try {
    var calEventId = _createCalendarEvent(activatorEmail, date, timeSlot, office);
    if (calEventId) sheet.getRange(sheet.getLastRow(), 22).setValue(calEventId);
  } catch (err) { Logger.log('Calendar push error: ' + err); }

  try {
    _sendConfirmation({
      appointmentId:  appointmentId,
      activatorEmail: activatorEmail,
      customerName:   body.customerName,
      customerEmail:  body.customerEmail,
      customerPhone:  body.customerPhone,
      date:           date,
      timeSlot:       timeSlot,
      office:         office,
      services:       services,
      deviceCount:    body.deviceCount || 1,
      cancelToken:    cancelToken
    });
  } catch (err) { Logger.log('Confirmation email error: ' + err); }

  return { ok: true, appointmentId: appointmentId };
}

function getAppointments(officeId, bookerEmail, role) {
  var rows       = _sheetData(APPT_TAB);
  var canSeeName = role === 'master-admin' || role === 'activator';
  var bEmail     = String(bookerEmail || '').trim().toLowerCase();
  var result     = [];

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    if (officeId && String(r[11]).trim() !== officeId) continue;
    var isBooker  = String(r[2]).trim().toLowerCase() === bEmail;
    var showName  = canSeeName || isBooker;
    result.push({
      appointmentId:  r[0],
      activatorEmail: r[1],
      bookerEmail:    r[2],
      customerName:   showName ? r[3]  : '••••••',
      customerDSI:    showName ? r[4]  : '••••',
      customerPhone:  showName ? r[5]  : '••••',
      customerEmail:  showName ? r[6]  : '••••',
      services:       r[7],
      deviceCount:    r[8],
      date:           _normDateCell(r[9]),
      timeSlot:       _normTimeCell(r[10]),
      office:         r[11],
      status:         r[12],
      bookedAt:       r[13],
      outcome:        r[15] || '',
      outcomeNote:    showName ? (r[16] || '') : '',
      outcomeBy:      r[17] || '',
      outcomeAt:      r[18] || '',
      source:         r[19] || 'rep'
    });
  }

  return result;
}

// Look up a single appointment by its self-service cancelToken. Returns ONLY
// the fields the customer needs to see on the cancel/reschedule page — never
// any other customer's data. Powers the public Customer Booking app.
function getAppointmentByToken(token) {
  var t = String(token || '').trim();
  if (!t) return null;
  var rows = _sheetData(APPT_TAB);
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    if (String(r[20] || '').trim() !== t) continue;
    return {
      appointmentId: r[0],
      customerName:  r[3],
      date:          _normDateCell(r[9]),
      timeSlot:      _normTimeCell(r[10]),
      office:        r[11],
      services:      r[7],
      deviceCount:   r[8],
      status:        r[12]
    };
  }
  return null;
}

function cancelAppointment(body) {
  var sheet = _ensureSheet(APPT_TAB, APPT_HEADERS);
  var id    = String(body.appointmentId || '').trim();
  var role  = String(body.role  || '').trim();
  var email = String(body.email || '').trim().toLowerCase();
  if (!id) return { error: 'missing appointmentId' };
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() !== id) continue;
    // Authorization: the booker, an activator, or master-admin — OR a customer
    // holding the matching self-service token (from their confirmation email).
    var booker   = String(data[i][2]).trim().toLowerCase();
    var token    = String(body.token || '').trim();
    var rowToken = String(data[i][20] || '').trim();
    var byToken  = token && rowToken && token === rowToken;
    if (!byToken && role !== 'master-admin' && role !== 'activator' && email !== booker)
      return { error: 'not authorized to cancel this appointment' };
    sheet.getRange(i + 1, 13).setValue('cancelled'); // column M
    _bustCache(APPT_TAB);
    // Two-way calendar: remove the pushed event from the activator's calendar.
    try { _deleteCalendarEvent(String(data[i][1]), String(data[i][21] || ''), _normDateCell(data[i][9])); }
    catch (err) { Logger.log('Calendar cancel sync error: ' + err); }
    return { ok: true };
  }
  return { error: 'appointment not found' };
}

// ── Hard delete (master-admin only) — removes the row entirely. ───────────
// Use for bad/test bookings. Cancel only flags a row; this purges it.
function deleteAppointment(body) {
  var sheet = _ensureSheet(APPT_TAB, APPT_HEADERS);
  var id    = String(body.appointmentId || '').trim();
  var role  = String(body.role || '').trim();
  if (role !== 'master-admin') return { error: 'not authorized to delete appointments' };
  if (!id) return { error: 'missing appointmentId' };
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() !== id) continue;
    try { _deleteCalendarEvent(String(data[i][1]), String(data[i][21] || ''), _normDateCell(data[i][9])); }
    catch (err) { Logger.log('Calendar delete sync error: ' + err); }
    sheet.deleteRow(i + 1);
    _bustCache(APPT_TAB);
    return { ok: true };
  }
  return { error: 'appointment not found' };
}

// ── Outcome (manually set by the activator after the appointment) ─────────
// outcome ∈ completed | rescheduled | no-show | canceled.
// An optional note is stored on the row AND cross-written to the portal's
// _Notes_<officeId> tab as an 'activation' note so it shows for that DSI.
function setApptOutcome(body) {
  var sheet = _ensureSheet(APPT_TAB, APPT_HEADERS);
  var id    = String(body.appointmentId || '').trim();
  var role  = String(body.role  || '').trim();
  var email = String(body.email || '').trim().toLowerCase();
  var outcome = String(body.outcome || '').trim().toLowerCase();
  var note    = String(body.note || '').trim();
  var linesActivated = Math.max(0, parseInt(body.linesActivated, 10) || 0);
  var VALID = ['completed','rescheduled','no-show','canceled'];
  if (!id) return { error: 'missing appointmentId' };
  if (VALID.indexOf(outcome) === -1) return { error: 'invalid outcome' };
  // Only activators / master-admin / the booker may mark an outcome.
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() !== id) continue;
    var booker = String(data[i][2]).trim().toLowerCase();
    if (role !== 'master-admin' && role !== 'activator' && email !== booker)
      return { error: 'not authorized' };
    var rowNum = i + 1;
    // Outcome columns are P,Q,R,S (16–19, 1-indexed).
    sheet.getRange(rowNum, 16, 1, 4).setValues([[
      outcome, note, email, new Date().toISOString()
    ]]);
    _bustCache(APPT_TAB);
    // Surface the note in the portal's notes for this customer's DSI.
    // Write a note row when there's a note OR the activator marked lines
    // activated (so the activation is recorded + counted in the daily report).
    if (note || linesActivated) {
      try {
        var dsi      = String(data[i][4] || '').trim();
        var office   = String(data[i][11] || '').trim();
        var label    = outcome.charAt(0).toUpperCase() + outcome.slice(1);
        var body2    = note || ('Activated ' + linesActivated + ' line' + (linesActivated===1?'':'s') + ' during appointment.');
        _appendActivationNote(office, dsi, email, email,
          '[Appointment ' + label + '] ' + body2, linesActivated);
      } catch (err) { Logger.log('Outcome note error: ' + err); }
    }
    return { ok: true };
  }
  return { error: 'appointment not found' };
}

// ── Reschedule in place (one "moved" email instead of cancel + rebook) ────
// Mutates the same row's date/timeSlot (and optionally the activator), re-arms
// the 24h reminder, and emails the customer once that the time has changed.
function rescheduleAppointment(body) {
  var sheet = _ensureSheet(APPT_TAB, APPT_HEADERS);
  var id      = String(body.appointmentId || '').trim();
  var role    = String(body.role  || '').trim();
  var email   = String(body.email || '').trim().toLowerCase();
  var newDate = String(body.date || '').trim();
  var newSlot = String(body.timeSlot || '').trim();
  var newAct  = String(body.activatorEmail || '').trim().toLowerCase();
  if (!id || !newDate || !newSlot) return { error: 'missing required fields' };
  var allowSameDay = _sameDayAllowed(role);   // activator/master-admin may move to today
  if (!_inBookingWindow(newDate, allowSameDay)) return { error: 'outside_window' };

  // Keep date/timeSlot columns as plain text (avoid Date coercion).
  sheet.getRange(1, 10, sheet.getMaxRows(), 2).setNumberFormat('@');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() !== id) continue;
    var r        = data[i];
    var booker   = String(r[2]).trim().toLowerCase();
    var token    = String(body.token || '').trim();
    var rowToken = String(r[20] || '').trim();
    var byToken  = token && rowToken && token === rowToken;
    if (!byToken && role !== 'master-admin' && role !== 'activator' && email !== booker)
      return { error: 'not authorized' };
    if (String(r[12]).trim().toLowerCase() === 'cancelled')
      return { error: 'appointment is cancelled' };

    var activator = newAct || String(r[1]).trim().toLowerCase();
    if (activator === '__next__') {
      activator = _resolveNextActivator(String(r[11]).trim(), newDate, newSlot, body.nextMode || 'soonest', allowSameDay);
      if (!activator) return { error: 'slot_unavailable' };
    }
    // Slot must be free for the target activator (excluding this appointment).
    if (getAvailableSlots(activator, newDate, id, allowSameDay).indexOf(newSlot) === -1)
      return { error: 'slot_unavailable' };

    var rowNum = i + 1;
    sheet.getRange(rowNum, 2).setValue(activator);   // activatorEmail
    sheet.getRange(rowNum, 10).setValue(newDate);    // date
    sheet.getRange(rowNum, 11).setValue(newSlot);    // timeSlot
    sheet.getRange(rowNum, 15).setValue(false);      // rem24hSent — re-arm reminder
    _bustCache(APPT_TAB);

    // Two-way calendar: the activator and/or time may have changed, so remove the
    // old pushed event and create a fresh one, storing the new id on the row.
    try {
      _deleteCalendarEvent(String(r[1]), String(r[21] || ''), _normDateCell(r[9]));
      var movedCalId = _createCalendarEvent(activator, newDate, newSlot, String(r[11]).trim());
      sheet.getRange(rowNum, 22).setValue(movedCalId || '');
    } catch (err) { Logger.log('Calendar reschedule sync error: ' + err); }

    try {
      _sendMoved({
        customerName:  r[3],
        customerEmail: r[6],
        customerPhone: r[5],
        date:          newDate,
        timeSlot:      newSlot,
        office:        r[11],
        services:      r[7],
        deviceCount:   r[8],
        cancelToken:   r[20]
      });
    } catch (err) { Logger.log('Moved email error: ' + err); }
    return { ok: true, activatorEmail: activator };
  }
  return { error: 'appointment not found' };
}

// ── Emails ────────────────────────────────────────────────────
// Builds the "need to make a change?" cancel/reschedule block for customer
// emails. Returns '' when the Customer Booking app URL isn't configured or the
// appointment has no token (e.g. legacy rows booked before this feature).
function _selfServiceBlock(office, token) {
  if (!token) return '';
  var q = '?office=' + encodeURIComponent(office || '') + '&token=' + encodeURIComponent(token);
  return '\nNeed to make a change?\n' +
         'Reschedule: ' + SELF_SERVICE_BASE + 'reschedule.html' + q + '\n' +
         'Cancel:     ' + SELF_SERVICE_BASE + 'cancel.html' + q + '\n';
}

// HTML-escape customer-supplied values before they enter an HTML email body.
function _htmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Styled Reschedule/Cancel buttons (HTML) for customer emails. Returns '' when
// the Customer Booking app URL isn't configured or the row has no token.
function _selfServiceButtonsHtml(office, token) {
  if (!token) return '';
  var q = '?office=' + encodeURIComponent(office || '') + '&token=' + encodeURIComponent(token);
  var resch = SELF_SERVICE_BASE + 'reschedule.html' + q;
  var canc  = SELF_SERVICE_BASE + 'cancel.html' + q;
  var BR    = _emailBrand(office);
  return '' +
    '<tr><td style="padding:4px 32px 26px;">' +
      '<p style="margin:0 0 12px;font:600 14px Arial,sans-serif;color:#16314f;">Need to make a change?</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="padding-right:10px;"><a href="' + resch + '" style="display:inline-block;background:' + BR.accent + ';color:' + BR.onAccent + ';text-decoration:none;font:600 14px Arial,sans-serif;padding:11px 22px;border-radius:6px;">Reschedule</a></td>' +
        '<td><a href="' + canc + '" style="display:inline-block;background:#ffffff;color:' + BR.ink + ';text-decoration:none;font:600 14px Arial,sans-serif;padding:10px 22px;border:1px solid ' + BR.ink + ';border-radius:6px;">Cancel</a></td>' +
      '</tr></table>' +
    '</td></tr>';
}

// Builds the branded HTML body shared by the confirmation / moved / reminder
// emails. o = { name, badge, heading, intro, date, time, office, services,
// devices, phone, buttons }. All customer-supplied fields are HTML-escaped.
function _apptEmailHtml(o) {
  var rows = [
    ['Date', _formatDate(o.date)],
    ['Time', _formatTime(o.time)],
    ['Office', _capitalize(o.office)],
    ['Activating', o.services || 'N/A'],
    ['Devices', o.devices || 1]
  ];
  var detailRows = rows.map(function (r) {
    return '<tr>' +
      '<td style="padding:9px 0;font:13px Arial,sans-serif;color:#667085;width:108px;vertical-align:top;">' + _htmlEsc(r[0]) + '</td>' +
      '<td style="padding:9px 0;font:600 14px Arial,sans-serif;color:#16314f;">' + _htmlEsc(r[1]) + '</td>' +
      '</tr>';
  }).join('');
  var phoneLine = o.phone
    ? 'Your activation specialist will call you at <b>' + _htmlEsc(o.phone) + '</b> at the time above.'
    : 'Your activation specialist will call you at the time above.';
  var callIn = OFFICE_CALLIN[String(o.office || '').toLowerCase()] || '';
  var callInLine = callIn ? '<br>If you need to reach us, call <b>' + _htmlEsc(callIn) + '</b>.' : '';
  var BR = _emailBrand(o.office);

  return '' +
  '<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f8;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e7ec;">' +
      '<tr><td style="background:' + BR.band + ';padding:22px 32px;">' +
        '<div style="font:700 18px Arial,sans-serif;color:#ffffff;letter-spacing:.3px;">Activation Support</div>' +
        '<div style="font:13px Arial,sans-serif;color:' + BR.sub + ';margin-top:2px;">AT&amp;T Activation Scheduling</div>' +
      '</td></tr>' +
      '<tr><td style="padding:26px 32px 2px;">' +
        '<span style="display:inline-block;background:' + BR.soft + ';color:' + BR.ink + ';font:600 12px Arial,sans-serif;padding:5px 12px;border-radius:20px;">' + _htmlEsc(o.badge || 'Confirmed') + '</span>' +
        '<h1 style="margin:14px 0 6px;font:700 22px Arial,sans-serif;color:#16314f;">' + _htmlEsc(o.heading) + '</h1>' +
        '<p style="margin:0;font:15px/1.5 Arial,sans-serif;color:#475467;">Hi ' + _htmlEsc(o.name || 'there') + ', ' + _htmlEsc(o.intro) + '</p>' +
      '</td></tr>' +
      '<tr><td style="padding:18px 32px 2px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #eef1f5;border-radius:10px;"><tr><td style="padding:4px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + detailRows + '</table></td></tr></table>' +
      '</td></tr>' +
      '<tr><td style="padding:18px 32px 2px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + (BR.boxBg || BR.soft) + ';border-left:4px solid ' + BR.accent + ';border-radius:6px;"><tr><td style="padding:13px 16px;font:14px/1.5 Arial,sans-serif;color:#1e3a5f;">' +
          '<b>This is a phone appointment</b> — there is nothing to attend in person.<br>' + phoneLine + callInLine +
        '</td></tr></table>' +
      '</td></tr>' +
      (o.buttons || '') +
      '<tr><td style="padding:18px 32px 26px;border-top:1px solid #eef1f5;">' +
        '<p style="margin:0;font:12px/1.5 Arial,sans-serif;color:#98a2b3;">Sent by Activation Support Bookings · please do not reply to this email.</p>' +
      '</td></tr>' +
    '</table>' +
  '</td></tr></table></body></html>';
}

function _sendConfirmation(appt) {
  var to = String(appt.customerEmail || '').trim();
  if (!to) return;
  var subject =
    'Appointment Confirmed — ' + _formatDate(appt.date) + ' at ' + _formatTime(appt.timeSlot);
  var body =
    'Hi ' + (appt.customerName || 'there') + ',\n\n' +
    'Your Long Distance activation appointment has been confirmed.\n\n' +
    '───────────────────────\n' +
    'Date:     ' + _formatDate(appt.date)    + '\n' +
    'Time:     ' + _formatTime(appt.timeSlot) + '\n' +
    'Office:   ' + _capitalize(appt.office)   + '\n' +
    'Services: ' + (appt.services || 'N/A')   + '\n' +
    'Devices:  ' + (appt.deviceCount || 1)    + '\n' +
    '───────────────────────\n\n' +
    'This is a PHONE appointment — there is nothing to attend in person.\n' +
    _callInBlock(appt.office, appt.customerPhone) +
    _selfServiceBlock(appt.office, appt.cancelToken) + '\n' +
    'Activation Support Team';
  var html = _apptEmailHtml({
    name: appt.customerName, badge: 'Confirmed', heading: "You're all set!",
    intro: 'your AT&T activation appointment is confirmed.',
    date: appt.date, time: appt.timeSlot, office: appt.office,
    services: appt.services, devices: appt.deviceCount, phone: appt.customerPhone,
    buttons: _selfServiceButtonsHtml(appt.office, appt.cancelToken)
  });
  GmailApp.sendEmail(to, subject, body, {
    name:     'Activation Support Bookings',
    replyTo:  'activationsupport.bookings@gmail.com',
    htmlBody: html
  });
}

// Sent once when an appointment is rescheduled in place.
function _sendMoved(appt) {
  var to = String(appt.customerEmail || '').trim();
  if (!to) return;
  var subject =
    'Appointment Updated — ' + _formatDate(appt.date) + ' at ' + _formatTime(appt.timeSlot);
  var body =
    'Hi ' + (appt.customerName || 'there') + ',\n\n' +
    'Your Long Distance activation appointment has been moved to a new time:\n\n' +
    '───────────────────────\n' +
    'New Date: ' + _formatDate(appt.date)    + '\n' +
    'New Time: ' + _formatTime(appt.timeSlot) + '\n' +
    'Office:   ' + _capitalize(appt.office)   + '\n' +
    'Services: ' + (appt.services || 'N/A')   + '\n' +
    'Devices:  ' + (appt.deviceCount || 1)    + '\n' +
    '───────────────────────\n\n' +
    'This is a PHONE appointment — there is nothing to attend in person.\n' +
    _callInBlock(appt.office, appt.customerPhone) +
    _selfServiceBlock(appt.office, appt.cancelToken) + '\n' +
    'Activation Support Team';
  var html = _apptEmailHtml({
    name: appt.customerName, badge: 'Updated', heading: 'Your appointment was moved',
    intro: 'your AT&T activation appointment has been rescheduled to a new time.',
    date: appt.date, time: appt.timeSlot, office: appt.office,
    services: appt.services, devices: appt.deviceCount, phone: appt.customerPhone,
    buttons: _selfServiceButtonsHtml(appt.office, appt.cancelToken)
  });
  GmailApp.sendEmail(to, subject, body, {
    name:     'Activation Support Bookings',
    replyTo:  'activationsupport.bookings@gmail.com',
    htmlBody: html
  });
}

// ── 24-Hour Reminders ─────────────────────────────────────────
// Run daily via time-based trigger. Sends reminder to customer
// for every confirmed appointment scheduled for tomorrow.
// Uses rem24hSent flag (column O, index 14) to prevent duplicates.
function checkAndSendReminders() {
  var sheet    = _ensureSheet(APPT_TAB, APPT_HEADERS);
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var dateStr  = tomorrow.toISOString().split('T')[0];
  var data     = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    if (String(r[9]).trim()  !== dateStr)     continue; // date
    if (String(r[12]).trim() === 'cancelled') continue; // status
    if (r[14] === true || r[14] === 'TRUE')   continue; // already sent

    var to = String(r[6] || '').trim();
    if (!to) continue;

    try {
      var subject =
        'Reminder: Appointment Tomorrow — ' + _formatTime(String(r[10]));
      var body =
        'Hi ' + (r[3] || 'there') + ',\n\n' +
        'This is your 24-hour reminder for your activation appointment tomorrow.\n\n' +
        '───────────────────────\n' +
        'Date:     ' + _formatDate(String(r[9]))   + '\n' +
        'Time:     ' + _formatTime(String(r[10]))  + '\n' +
        'Office:   ' + _capitalize(String(r[11]))  + '\n' +
        'Services: ' + (r[7] || 'N/A')             + '\n' +
        'Devices:  ' + (r[8] || 1)                 + '\n' +
        '───────────────────────\n\n' +
        'This is a PHONE appointment — there is nothing to attend in person.\n' +
        _callInBlock(String(r[11]), String(r[5] || '')) + '\n\n' +
        'Activation Support Team';
      var html = _apptEmailHtml({
        name: r[3], badge: 'Tomorrow', heading: 'See you tomorrow',
        intro: 'this is a friendly reminder about your AT&T activation appointment tomorrow.',
        date: String(r[9]), time: String(r[10]), office: String(r[11]),
        services: r[7], devices: r[8], phone: String(r[5] || ''),
        buttons: _selfServiceButtonsHtml(String(r[11]), String(r[20] || ''))
      });
      GmailApp.sendEmail(to, subject, body, {
        name:     'Activation Support Bookings',
        replyTo:  'activationsupport.bookings@gmail.com',
        htmlBody: html
      });
      sheet.getRange(i + 1, 15).setValue(true); // mark rem24hSent = TRUE
    } catch (err) {
      Logger.log('Reminder error for appointment ' + r[0] + ': ' + err);
    }
  }
  _bustCache(APPT_TAB);
}

// Creates (or recreates) the daily reminder trigger.
// Run this once manually from the Apps Script editor after deployment.
function setupReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'checkAndSendReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAndSendReminders')
    .timeBased().atHour(9).everyDays(1).create();
  return { ok: true, message: 'Daily reminder trigger set for 9 AM.' };
}
