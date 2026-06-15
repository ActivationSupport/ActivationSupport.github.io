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

var ALL_OFFICES = ['midspire', 'viridian', 'elevate', 'ignite'];

var OFFICE_TZ = {
  midspire: 'America/Chicago',
  viridian:  'America/Chicago',
  elevate:   'America/Los_Angeles',
  ignite:    'America/Los_Angeles'
};

// Optional per-office call-in fallback number shown in customer emails.
// Leave '' to omit the call-in line (the email still tells the customer the
// activator will call them). Fill these in when the office numbers are known.
var OFFICE_CALLIN = {
  midspire: '',
  viridian: '',
  elevate:  '',
  ignite:   ''
};

var APPT_HEADERS = [
  'appointmentId','activatorEmail','bookerEmail','customerName',
  'customerDSI','customerPhone','customerEmail','services',
  'deviceCount','date','timeSlot','office','status','bookedAt','rem24hSent',
  // Phase 1 additions (append-only — never reorder the columns above):
  'outcome','outcomeNote','outcomeBy','outcomeAt'
];

var SCHED_HEADERS = [
  'email','timezone',
  'monStart','monEnd','tueStart','tueEnd',
  'wedStart','wedEnd','thuStart','thuEnd',
  'friStart','friEnd','satStart','satEnd','sunStart','sunEnd',
  // Phase 1 additions (append-only):
  'bufferMins','maxPerDay'
];

var BLOCKS_HEADERS = [
  'blockId','activatorEmail','date','allDay','startTime','endTime','reason','createdAt'
];

// ── Core helpers ──────────────────────────────────────────────
function _getApiKey()  { return PropertiesService.getScriptProperties().getProperty('API_KEY') || ''; }
function _getSheetId() { return PropertiesService.getScriptProperties().getProperty('SHEET_ID') || ''; }

function _validateKey(key) {
  var expected = _getApiKey();
  return !expected || key === expected;
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
function _bookingWindow() {
  var tz  = Session.getScriptTimeZone();
  var now = Date.now();
  return {
    min: Utilities.formatDate(new Date(now + BOOKING_MIN_DAYS * 86400000), tz, 'yyyy-MM-dd'),
    max: Utilities.formatDate(new Date(now + BOOKING_MAX_DAYS * 86400000), tz, 'yyyy-MM-dd')
  };
}
function _inBookingWindow(dateStr) {
  var w = _bookingWindow();
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
// Schema: dsi | timestamp | authorEmail | authorName | noteText | noteType
function _appendActivationNote(officeId, dsi, authorEmail, authorName, noteText) {
  if (!officeId || !dsi || !noteText) return;
  var ss   = _getSS();
  var name = '_Notes_' + officeId;
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['dsi','timestamp','authorEmail','authorName','noteText','noteType']);
    sheet.getRange(1,1,1,6).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([String(dsi).trim(), new Date(), authorEmail || '', authorName || '', noteText, 'activation']);
}

// ── Routing ───────────────────────────────────────────────────
function doGet(e) {
  var key = (e && e.parameter && e.parameter.key) || '';
  if (!_validateKey(key)) return _json({ error: 'unauthorized' });
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    var p      = (e && e.parameter) || {};
    if (action === 'getActivators')        return _json({ activators: getActivators(p.officeId || '') });
    if (action === 'getAvailableSlots')    return _json({ slots: getAvailableSlots(p.activatorEmail, p.date, p.excludeId || '') });
    if (action === 'getNextAvailableSlots') return _json({ slots: getNextAvailableSlots(p.officeId || '', p.date) });
    if (action === 'getAppointments')      return _json({ appointments: getAppointments(p.officeId, p.bookerEmail, p.role) });
    if (action === 'getActivatorSchedule') return _json({ schedule: getActivatorSchedule(p.email) });
    if (action === 'getActivatorBlocks')   return _json({ blocks: getActivatorBlocks(p.email) });
    if (action === 'getBookingWindow')      return _json({ window: _bookingWindow() });
    return _json({ error: 'unknown action: ' + action });
  } catch (err) { return _json({ error: err.message }); }
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return _json({ error: 'invalid JSON' }); }
  if (!_validateKey(body.key || '')) return _json({ error: 'unauthorized' });
  try {
    var action = body.action || '';
    if (action === 'bookAppointment')      return _json(bookAppointment(body));
    if (action === 'cancelAppointment')    return _json(cancelAppointment(body));
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
      seen[email] = true;
      activators.push({
        email:    email,
        name:     String(row[1] || '').trim(),
        rank:     rank,
        offices:  officesStr.split(',').map(function(o){ return o.trim(); }),
        timezone: timezone,
        schedule: getActivatorSchedule(email)
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
      return {
        timezone: rows[i][1]  || '',
        mon: { start: rows[i][2]  || '', end: rows[i][3]  || '' },
        tue: { start: rows[i][4]  || '', end: rows[i][5]  || '' },
        wed: { start: rows[i][6]  || '', end: rows[i][7]  || '' },
        thu: { start: rows[i][8]  || '', end: rows[i][9]  || '' },
        fri: { start: rows[i][10] || '', end: rows[i][11] || '' },
        sat: { start: rows[i][12] || '', end: rows[i][13] || '' },
        sun: { start: rows[i][14] || '', end: rows[i][15] || '' },
        bufferMins: Number(rows[i][16]) || 0,   // 0 = off
        maxPerDay:  Number(rows[i][17]) || 0     // 0 = unlimited
      };
    }
  }
  // Default: no schedule set
  return {
    timezone: '',
    mon:{start:'',end:''}, tue:{start:'',end:''}, wed:{start:'',end:''},
    thu:{start:'',end:''}, fri:{start:'',end:''}, sat:{start:'',end:''},
    sun:{start:'',end:''},
    bufferMins: 0, maxPerDay: 0
  };
}

function setActivatorSchedule(body) {
  var sheet = _ensureSheet(SCHED_TAB, SCHED_HEADERS);
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
    Number(body.maxPerDay)  || 0     // 0 = unlimited
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
function getAvailableSlots(activatorEmail, dateStr, excludeAppointmentId) {
  var email = String(activatorEmail || '').trim().toLowerCase();
  if (!email || !dateStr) return [];

  // No same-day: only dates inside the rolling [tomorrow, +7 days] window are
  // bookable. This replaces the old MIN_ADV_HRS advance-notice rule.
  if (!_inBookingWindow(dateStr)) return [];

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
function getNextAvailableSlots(officeId, dateStr) {
  if (!dateStr) return [];
  var acts = getActivators(officeId || '');
  var set  = {};
  acts.forEach(function(a) {
    getAvailableSlots(a.email, dateStr, '').forEach(function(s) { set[s] = true; });
  });
  return Object.keys(set).sort();
}

// Picks the first activator in the office who is free for a given date+slot.
// Returns '' if nobody is available.
function _resolveNextActivator(officeId, dateStr, timeSlot) {
  var acts = getActivators(officeId || '');
  for (var i = 0; i < acts.length; i++) {
    if (getAvailableSlots(acts[i].email, dateStr, '').indexOf(timeSlot) !== -1) return acts[i].email;
  }
  return '';
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

// ── Appointments ──────────────────────────────────────────────
function bookAppointment(body) {
  var sheet          = _ensureSheet(APPT_TAB, APPT_HEADERS);
  // Keep date (col 10) & timeSlot (col 11) as plain text so Sheets doesn't
  // coerce "2026-06-12"/"10:00" into Date objects on write.
  sheet.getRange(1, 10, sheet.getMaxRows(), 2).setNumberFormat('@');
  var bookerEmail    = String(body.bookerEmail || '').trim().toLowerCase();
  var activatorEmail = String(body.activatorEmail || '').trim().toLowerCase();
  var date           = String(body.date || '').trim();
  var timeSlot       = String(body.timeSlot || '').trim();
  var office         = String(body.office || '').trim();

  if (!bookerEmail || !activatorEmail || !date || !timeSlot || !office)
    return { error: 'missing required fields' };
  if (!body.customerName || !body.customerDSI || !body.customerPhone || !body.customerEmail)
    return { error: 'missing customer fields' };

  // No same-day / outside the rolling window.
  if (!_inBookingWindow(date)) return { error: 'outside_window' };

  // "Next Available Agent": resolve to whichever activator is free for this slot.
  if (activatorEmail === '__next__') {
    activatorEmail = _resolveNextActivator(office, date, timeSlot);
    if (!activatorEmail) return { error: 'slot_unavailable' };
  }

  // Verify slot is still open
  var available = getAvailableSlots(activatorEmail, date, '');
  if (available.indexOf(timeSlot) === -1) return { error: 'slot_unavailable' };

  var appointmentId = 'APT' + Date.now();
  var services      = Array.isArray(body.services)
    ? body.services.join(', ')
    : String(body.services || '');

  var row = [
    appointmentId,
    activatorEmail,
    bookerEmail,
    String(body.customerName  || '').trim(),
    String(body.customerDSI   || '').trim(),
    String(body.customerPhone || '').trim(),
    String(body.customerEmail || '').trim(),
    services,
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
    ''      // outcomeAt
  ];

  sheet.appendRow(row);
  _bustCache(APPT_TAB);

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
      deviceCount:    body.deviceCount || 1
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
      outcomeAt:      r[18] || ''
    });
  }

  return result;
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
    // Only the booker, activators, or master-admin can cancel
    var booker = String(data[i][2]).trim().toLowerCase();
    if (role !== 'master-admin' && role !== 'activator' && email !== booker)
      return { error: 'not authorized to cancel this appointment' };
    sheet.getRange(i + 1, 13).setValue('cancelled'); // column M
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
    if (note) {
      try {
        var dsi      = String(data[i][4] || '').trim();
        var office   = String(data[i][11] || '').trim();
        var label    = outcome.charAt(0).toUpperCase() + outcome.slice(1);
        _appendActivationNote(office, dsi, email, email,
          '[Appointment ' + label + '] ' + note);
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
  if (!_inBookingWindow(newDate)) return { error: 'outside_window' };

  // Keep date/timeSlot columns as plain text (avoid Date coercion).
  sheet.getRange(1, 10, sheet.getMaxRows(), 2).setNumberFormat('@');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() !== id) continue;
    var r      = data[i];
    var booker = String(r[2]).trim().toLowerCase();
    if (role !== 'master-admin' && role !== 'activator' && email !== booker)
      return { error: 'not authorized' };
    if (String(r[12]).trim().toLowerCase() === 'cancelled')
      return { error: 'appointment is cancelled' };

    var activator = newAct || String(r[1]).trim().toLowerCase();
    if (activator === '__next__') {
      activator = _resolveNextActivator(String(r[11]).trim(), newDate, newSlot);
      if (!activator) return { error: 'slot_unavailable' };
    }
    // Slot must be free for the target activator (excluding this appointment).
    if (getAvailableSlots(activator, newDate, id).indexOf(newSlot) === -1)
      return { error: 'slot_unavailable' };

    var rowNum = i + 1;
    sheet.getRange(rowNum, 2).setValue(activator);   // activatorEmail
    sheet.getRange(rowNum, 10).setValue(newDate);    // date
    sheet.getRange(rowNum, 11).setValue(newSlot);    // timeSlot
    sheet.getRange(rowNum, 15).setValue(false);      // rem24hSent — re-arm reminder
    _bustCache(APPT_TAB);

    try {
      _sendMoved({
        customerName:  r[3],
        customerEmail: r[6],
        customerPhone: r[5],
        date:          newDate,
        timeSlot:      newSlot,
        office:        r[11],
        services:      r[7],
        deviceCount:   r[8]
      });
    } catch (err) { Logger.log('Moved email error: ' + err); }
    return { ok: true, activatorEmail: activator };
  }
  return { error: 'appointment not found' };
}

// ── Emails ────────────────────────────────────────────────────
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
    _callInBlock(appt.office, appt.customerPhone) + '\n\n' +
    'Activation Support Team';
  GmailApp.sendEmail(to, subject, body, {
    name:    'Activation Support Bookings',
    replyTo: 'activationsupport.bookings@gmail.com'
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
    _callInBlock(appt.office, appt.customerPhone) + '\n\n' +
    'Activation Support Team';
  GmailApp.sendEmail(to, subject, body, {
    name:    'Activation Support Bookings',
    replyTo: 'activationsupport.bookings@gmail.com'
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
      GmailApp.sendEmail(to, subject, body, {
        name:    'Activation Support Bookings',
        replyTo: 'activationsupport.bookings@gmail.com'
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
