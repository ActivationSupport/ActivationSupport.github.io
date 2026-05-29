// ============================================================
//  AT&T Activation Scheduler — Code.gs
// ============================================================

const APPOINTMENTS_SHEET  = 'Appointments';
const ACTIVATORS_SHEET    = 'Activators';
const BLOCKED_TIMES_SHEET = 'Blocked Times';
const ADMINS_SHEET        = 'Admins';
const SLOT_DURATION       = 60;  // minutes
const MIN_ADVANCE_HOURS   = 4;   // minimum hours ahead to book
const SESSION_HOURS       = 8;   // admin session duration

// ── Routing ──────────────────────────────────────────────────

function doGet(e) {
  e = e || {};
  const page = (e.parameter && e.parameter.page) || 'book';
  const id   = (e.parameter && e.parameter.id)   || '';
  const files  = { book:'booking', admin:'admin', setup:'setup', cancel:'cancel', reschedule:'reschedule', master:'master' };
  const titles = {
    book:'Schedule Your AT&T Activation', admin:'Activation Admin Dashboard',
    setup:'Activator Profile Setup', cancel:'Cancel Appointment', reschedule:'Reschedule Appointment',
    master:'Master Dashboard'
  };
  const tmpl = HtmlService.createTemplateFromFile(files[page] || 'booking');
  tmpl.appointmentId = id;
  return tmpl.evaluate()
    .setTitle(titles[page] || 'AT&T Activation Scheduler')
    .addMetaTag('viewport','width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── Activators ───────────────────────────────────────────────

function getActivators() {
  return getSheetData(ACTIVATORS_SHEET)
    .filter(r => r[18] === true || r[18] === 'TRUE')
    .map(r => ({ id: r[0], name: r[1], email: r[2], timezone: r[3], office: r[19] || '' }));
}

function getActivatorById(id) {
  const row = getSheetData(ACTIVATORS_SHEET).find(r => r[0] === id);
  if (!row) return null;
  return {
    id: row[0], name: row[1], email: row[2], timezone: row[3], office: row[19] || '',
    schedule: {
      mon:{ start:row[4],  end:row[5]  }, tue:{ start:row[6],  end:row[7]  },
      wed:{ start:row[8],  end:row[9]  }, thu:{ start:row[10], end:row[11] },
      fri:{ start:row[12], end:row[13] }, sat:{ start:row[14], end:row[15] },
      sun:{ start:row[16], end:row[17] }
    }
  };
}

function getActivatorByEmail(email) {
  const row = getSheetData(ACTIVATORS_SHEET).find(r => r[2] === email);
  if (!row) return null;
  return { id: row[0], name: row[1], email: row[2], timezone: row[3], office: row[19] || '' };
}

function saveActivator(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet(ss, ACTIVATORS_SHEET, [
    'ID','Name','Email','Timezone',
    'Mon Start','Mon End','Tue Start','Tue End','Wed Start','Wed End',
    'Thu Start','Thu End','Fri Start','Fri End','Sat Start','Sat End',
    'Sun Start','Sun End','Active','Office'
  ]);
  // Use getSheetData so we read the cached copy when available
  const all = getSheetData(ACTIVATORS_SHEET);
  let existingRow = -1;
  for (let i = 0; i < all.length; i++) {
    if (all[i][2] === data.email) { existingRow = i + 2; break; } // +2: header row + 1-index
  }
  const id  = existingRow > 0 ? all[existingRow - 2][0] : 'ACT' + Date.now();
  const row = [
    id, data.name, data.email, data.timezone,
    data.schedule.mon.start||'', data.schedule.mon.end||'',
    data.schedule.tue.start||'', data.schedule.tue.end||'',
    data.schedule.wed.start||'', data.schedule.wed.end||'',
    data.schedule.thu.start||'', data.schedule.thu.end||'',
    data.schedule.fri.start||'', data.schedule.fri.end||'',
    data.schedule.sat.start||'', data.schedule.sat.end||'',
    data.schedule.sun.start||'', data.schedule.sun.end||'',
    true, data.office || ''
  ];
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  _bustCache(ACTIVATORS_SHEET);
  return { success: true, id };
}

// ── Blocked Times ─────────────────────────────────────────────

function getBlockedTimesForActivator(activatorId) {
  return getSheetData(BLOCKED_TIMES_SHEET)
    .filter(r => r[0] && r[1] === activatorId)
    .map(r => ({
      id: r[0], activatorId: r[1], date: r[2],
      allDay: r[3] === true || r[3] === 'TRUE',
      startTime: r[4] || '', endTime: r[5] || '',
      reason: r[6] || ''
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getBlockedTimesForDate(activatorId, dateStr) {
  return getSheetData(BLOCKED_TIMES_SHEET)
    .filter(r => r[0] && r[1] === activatorId && r[2] === dateStr)
    .map(r => ({
      allDay: r[3] === true || r[3] === 'TRUE',
      startTime: r[4] || '', endTime: r[5] || ''
    }));
}

function addBlockedTime(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BLOCKED_TIMES_SHEET);
  const id    = 'BLK' + Date.now();
  sheet.appendRow([
    id, data.activatorId, data.date,
    data.allDay === true || data.allDay === 'true',
    data.startTime || '', data.endTime || '',
    data.reason || '', new Date().toISOString()
  ]);
  _bustCache(BLOCKED_TIMES_SHEET);
  return { success: true, id };
}

function removeBlockedTime(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BLOCKED_TIMES_SHEET);
  const rows  = getSheetData(BLOCKED_TIMES_SHEET);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.deleteRow(i + 2); // +2: header row + 1-index
      _bustCache(BLOCKED_TIMES_SHEET);
      return { success: true };
    }
  }
  return { success: false, error: 'Block not found' };
}

// ── Availability ─────────────────────────────────────────────

function getAvailableSlots(activatorId, dateStr, excludeAppointmentId) {
  const activator = getActivatorById(activatorId);
  if (!activator) return [];

  const days    = ['sun','mon','tue','wed','thu','fri','sat'];
  const date    = new Date(dateStr + 'T12:00:00');
  const dayKey  = days[date.getDay()];
  const daySched = activator.schedule[dayKey];
  if (!daySched || !daySched.start || !daySched.end) return [];

  let slots  = generateSlots(daySched.start, daySched.end, SLOT_DURATION);
  const booked  = getBookedSlots(activatorId, dateStr, excludeAppointmentId);
  const blocked = getBlockedTimesForDate(activatorId, dateStr);

  slots = slots.filter(s => !booked.has(s));
  slots = slots.filter(s => !isSlotBlocked(s, blocked));

  const cutoff = new Date(new Date().getTime() + MIN_ADVANCE_HOURS * 3600000);
  return slots.filter(s => {
    const [h, m] = s.split(':').map(Number);
    const slotTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
    return slotTime >= cutoff;
  });
}

function isSlotBlocked(slot, blockedTimes) {
  if (!blockedTimes.length) return false;
  const [sh, sm] = slot.split(':').map(Number);
  const slotStart = sh * 60 + sm;
  const slotEnd   = slotStart + SLOT_DURATION;
  for (const b of blockedTimes) {
    if (b.allDay) return true;
    if (!b.startTime || !b.endTime) continue;
    const [bsh, bsm] = b.startTime.split(':').map(Number);
    const [beh, bem] = b.endTime.split(':').map(Number);
    const blockStart = bsh * 60 + bsm;
    const blockEnd   = beh * 60 + bem;
    if (slotStart < blockEnd && slotEnd > blockStart) return true;
  }
  return false;
}

function getNextAvailableSlots(dateStr) {
  const result = [];
  getActivators().forEach(a => {
    getAvailableSlots(a.id, dateStr).forEach(time =>
      result.push({ activatorId:a.id, activatorName:a.name, timezone:a.timezone, time })
    );
  });
  return result.sort((a, b) => a.time.localeCompare(b.time));
}

function generateSlots(startTime, endTime, duration) {
  const slots = [];
  let [h, m]         = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const endMin       = endH * 60 + endM;
  while (h * 60 + m + duration <= endMin) {
    slots.push(pad(h) + ':' + pad(m));
    m += duration;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  }
  return slots;
}

function getBookedSlots(activatorId, dateStr, excludeId) {
  const booked = new Set();
  getSheetData(APPOINTMENTS_SHEET).forEach(r => {
    if (r[3] === activatorId && r[1] === dateStr && r[12] !== 'Cancelled' && r[0] !== excludeId)
      booked.add(r[2]);
  });
  return booked;
}

function getMinAdvanceHours() { return MIN_ADVANCE_HOURS; }

// ── Appointments ─────────────────────────────────────────────
// Column map (0-indexed): 0=ID, 1=Date, 2=Time, 3=ActID, 4=ActName,
// 5=CustName, 6=Email, 7=Phone, 8=Address, 9=DSI/SPM,
// 10=Type, 11=BookedBy, 12=Status, 13=Notes, 14=CreatedAt,
// 15=Rem24h, 16=Rem1h, 17=DeviceCount, 18=CancelReason, 19=Office

function createAppointment(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(APPOINTMENTS_SHEET);
  const id    = 'APT' + Date.now();
  const activatorData = getActivatorById(data.activatorId);
  const office = activatorData ? activatorData.office || '' : '';
  sheet.appendRow([
    id, data.date, data.time, data.activatorId, data.activatorName,
    data.customerName, data.customerEmail, data.customerPhone,
    data.address||'', data.dsiSpmNumber, data.appointmentType,
    data.bookedBy||'Client', 'Scheduled', '', new Date().toISOString(),
    false, false,
    data.deviceCount || 1,
    '',        // CancelReason
    office     // Office
  ]);
  _bustCache(APPOINTMENTS_SHEET);
  try { sendConfirmationEmail(id, data); } catch(e) { Logger.log('Email error: ' + e); }
  return { success: true, id };
}

function getAppointmentById(id) {
  const row = getSheetData(APPOINTMENTS_SHEET).find(r => r[0] === id);
  if (!row) return null;
  return {
    id:row[0], date:row[1], time:row[2], activatorId:row[3], activatorName:row[4],
    customerName:row[5], customerEmail:row[6], customerPhone:row[7],
    address:row[8], dsiSpmNumber:row[9], appointmentType:row[10],
    bookedBy:row[11], status:row[12], notes:row[13], deviceCount:row[17]||1,
    cancelReason:row[18]||'', office:row[19]||''
  };
}

function getAppointments(filters) {
  let rows = getSheetData(APPOINTMENTS_SHEET)
    .filter(r => r[0])
    .map(r => ({
      id:r[0], date:r[1], time:r[2], activatorId:r[3], activatorName:r[4],
      customerName:r[5], customerEmail:r[6], customerPhone:r[7],
      address:r[8], dsiSpmNumber:r[9], appointmentType:r[10],
      bookedBy:r[11], status:r[12], notes:r[13], createdAt:r[14], deviceCount:r[17]||1,
      cancelReason:r[18]||'', office:r[19]||''
    }));
  if (filters) {
    if (filters.activatorId) rows = rows.filter(r => r.activatorId === filters.activatorId);
    if (filters.status)      rows = rows.filter(r => r.status === filters.status);
    if (filters.date)        rows = rows.filter(r => r.date === filters.date);
    if (filters.office)      rows = rows.filter(r => r.office === filters.office);
    if (filters.officeAccess && filters.officeAccess !== 'ALL') {
      const offices = filters.officeAccess.split('|').map(s => s.trim()).filter(s => s);
      rows = rows.filter(r => offices.includes(r.office || ''));
    }
    if (filters.search) {
      const s = filters.search.toLowerCase();
      rows = rows.filter(r =>
        (r.customerName||'').toLowerCase().includes(s) ||
        (r.dsiSpmNumber||'').toLowerCase().includes(s) ||
        (r.activatorName||'').toLowerCase().includes(s) ||
        (r.customerPhone||'').toLowerCase().includes(s)
      );
    }
  }
  return rows.sort((a,b) => a.date!==b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time));
}

function updateAppointment(id, updates) {
  const sheet  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(APPOINTMENTS_SHEET);
  // Column map (1-indexed for getRange): matches Appointments sheet column order.
  // ID=1, Date=2, Time=3, ActID=4, ActName=5, CustName=6, Email=7, Phone=8,
  // Address=9, DSI=10, Type=11, BookedBy=12, Status=13, Notes=14, CreatedAt=15,
  // Rem24h=16, Rem1h=17, DeviceCount=18, CancelReason=19, Office=20
  const colMap = {
    date:2, time:3, activatorId:4, activatorName:5, customerName:6,
    customerEmail:7, customerPhone:8, address:9, dsiSpmNumber:10,
    status:13, notes:14, rem24h:16, rem1h:17, deviceCount:18, cancelReason:19
  };
  const rows = getSheetData(APPOINTMENTS_SHEET);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] !== id) continue;
    const r = i + 2; // +2: header row + 1-index
    Object.entries(updates).forEach(([key, val]) => {
      if (colMap[key] !== undefined) sheet.getRange(r, colMap[key]).setValue(val);
    });
    _bustCache(APPOINTMENTS_SHEET);
    return { success: true };
  }
  return { success: false, error: 'Appointment not found' };
}

function cancelAppointment(id, reason) {
  return updateAppointment(id, { status:'Cancelled', cancelReason: reason || '' });
}

function cancelByLink(id, reason) {
  const appt = getAppointmentById(id);
  if (!appt)                       return { success:false, error:'not_found' };
  if (appt.status==='Cancelled')   return { success:false, error:'already_cancelled' };
  if (appt.status==='Completed')   return { success:false, error:'already_completed' };
  if (!reason || !String(reason).trim()) return { success:false, error:'reason_required' };
  cancelAppointment(id, reason);
  return { success:true, appointment:appt };
}

function rescheduleAppointment(id, newDate, newTime) {
  const appt = getAppointmentById(id);
  if (!appt)                       return { success:false, error:'not_found' };
  if (appt.status==='Cancelled')   return { success:false, error:'already_cancelled' };
  if (appt.status==='Completed')   return { success:false, error:'already_completed' };
  if (!getAvailableSlots(appt.activatorId, newDate, id).includes(newTime))
    return { success:false, error:'slot_unavailable' };

  // Reset date, time, status, and reminder flags in one pass
  updateAppointment(id, { date:newDate, time:newTime, status:'Scheduled', rem24h:false, rem1h:false });

  try {
    const act = getActivatorById(appt.activatorId);
    sendConfirmationEmail(id, { ...appt, date:newDate, time:newTime, activatorTimezone: act?act.timezone:'' });
  } catch(e) { Logger.log('Reschedule email error: ' + e); }
  return { success:true };
}

// ── Reporting ─────────────────────────────────────────────────

function getReportData(officeFilter) {
  let data       = getSheetData(APPOINTMENTS_SHEET).filter(r => r[0]);
  let activators = getActivators();

  if (officeFilter && officeFilter !== 'ALL') {
    const offices = officeFilter.split('|').map(s => s.trim()).filter(s => s);
    data       = data.filter(r => offices.includes(r[19] || ''));
    activators = activators.filter(a => offices.includes(a.office || ''));
  }

  const counts = { Scheduled:0, Completed:0, Cancelled:0, 'No-Show':0 };
  data.forEach(r => { const s = r[12]||'Scheduled'; if (counts[s]!==undefined) counts[s]++; });
  const concluded      = counts.Completed + counts['No-Show'];
  const completionRate = concluded > 0 ? Math.round(counts.Completed / concluded * 100) : 0;
  const noShowRate     = concluded > 0 ? Math.round(counts['No-Show'] / concluded * 100) : 0;

  const actMap = {};
  activators.forEach(a => {
    actMap[a.id] = { name:a.name, office:a.office||'', total:0, completed:0, noShow:0, cancelled:0, scheduled:0 };
  });
  data.forEach(r => {
    const aid = r[3];
    if (!actMap[aid]) actMap[aid] = { name:r[4]||'Unknown', office:r[19]||'', total:0, completed:0, noShow:0, cancelled:0, scheduled:0 };
    actMap[aid].total++;
    const s = r[12]||'Scheduled';
    if (s==='Completed')  actMap[aid].completed++;
    else if (s==='No-Show')   actMap[aid].noShow++;
    else if (s==='Cancelled') actMap[aid].cancelled++;
    else                      actMap[aid].scheduled++;
  });

  const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayCounts = [0,0,0,0,0,0,0];
  data.forEach(r => {
    if (r[1]) {
      const [y,m,d] = String(r[1]).split('-').map(Number);
      dayCounts[new Date(y,m-1,d).getDay()]++;
    }
  });
  const byDay = dayLabels.map((lbl,i) => ({ day:lbl, count:dayCounts[i] }));

  const hourBuckets = {};
  for (let h = 7; h <= 20; h++) hourBuckets[h] = 0;
  data.forEach(r => {
    if (r[2]) {
      const h = parseInt(String(r[2]).split(':')[0]);
      if (hourBuckets[h] !== undefined) hourBuckets[h]++;
    }
  });
  const byHour = Object.entries(hourBuckets).map(([h, count]) => ({
    label: formatTime(pad(Number(h)) + ':00'), count
  }));

  const now = new Date();
  const thirtyAgo = new Date(now.getTime() - 30 * 86400000);
  const recentMap = {};
  data.forEach(r => {
    if (!r[1]) return;
    const [y,m,d] = String(r[1]).split('-').map(Number);
    if (new Date(y,m-1,d) >= thirtyAgo) {
      recentMap[r[1]] = (recentMap[r[1]]||0) + 1;
    }
  });

  const totalDevices = data
    .filter(r => r[12] === 'Completed')
    .reduce((sum, r) => sum + (Number(r[17]) || 1), 0);

  return {
    summary: { total:data.length, ...counts, completionRate, noShowRate, totalDevices },
    byActivator: Object.values(actMap),
    byDay,
    byHour,
    recentMap
  };
}

function getAppointmentDailySummary(dateStr) {
  const rows = getSheetData(APPOINTMENTS_SHEET).filter(r => r[0] && r[1] === dateStr);
  const scheduled  = [];
  const completed  = [];
  const noShows    = [];
  const cancelled  = [];

  rows.forEach(r => {
    const entry = {
      id:            r[0],
      time:          r[2],
      activatorName: r[4] || '',
      customerName:  r[5] || '',
      dsiSpmNumber:  r[9] || '',
      appointmentType: r[10] || '',
      deviceCount:   Number(r[17]) || 1,
      cancelReason:  r[18] || '',
      office:        r[19] || ''
    };
    const status = r[12] || 'Scheduled';
    if (status === 'Scheduled')  scheduled.push(entry);
    else if (status === 'Completed') completed.push(entry);
    else if (status === 'No-Show')   noShows.push(entry);
    else if (status === 'Cancelled') cancelled.push(entry);
  });

  const byTime = (a, b) => a.time.localeCompare(b.time);
  scheduled.sort(byTime);
  completed.sort(byTime);
  noShows.sort(byTime);
  cancelled.sort(byTime);

  const totalDevicesCompleted = completed.reduce((s, e) => s + e.deviceCount, 0);
  return { scheduled, completed, noShows, cancelled, totalDevicesCompleted, date: dateStr };
}

// ── Session-aware data accessors ──────────────────────────────

function getActivatorsForUser(token) {
  const user = validateSession(token);
  if (!user) return [];
  let activators = getActivators();
  if (user.role !== 'superadmin' && user.officeAccess !== 'ALL') {
    const offices = user.officeAccess.split('|').map(s => s.trim()).filter(s => s);
    activators = activators.filter(a => offices.includes(a.office || ''));
  }
  return activators;
}

function getAppointmentsForUser(token, filters) {
  const user = validateSession(token);
  if (!user) return [];
  filters = filters || {};
  if (user.role !== 'superadmin' && user.officeAccess !== 'ALL') {
    filters.officeAccess = user.officeAccess;
  }
  return getAppointments(filters);
}

function getReportDataForUser(token) {
  const user = validateSession(token);
  if (!user) return null;
  const officeFilter = (user.role !== 'superadmin' && user.officeAccess !== 'ALL') ? user.officeAccess : null;
  return getReportData(officeFilter);
}

// ── Reminders ────────────────────────────────────────────────

function checkAndSendReminders() {
  const now   = new Date();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(APPOINTMENTS_SHEET);
  const rows  = getSheetData(APPOINTMENTS_SHEET); // uses execution-scope cache
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0] || row[12] !== 'Scheduled') continue;
    const [y,mo,d] = String(row[1]).split('-').map(Number);
    const [h,m]    = String(row[2]).split(':').map(Number);
    const apptTime = new Date(y, mo-1, d, h, m, 0);
    const hrs      = (apptTime - now) / 3600000;
    const rowNum   = i + 2; // +2: header row + 1-index
    if (hrs >= 22 && hrs <= 26 && !row[15]) {
      try {
        sendReminderEmail(row, '24h');
        sheet.getRange(rowNum, 16, 1, 1).setValue(true);
        _bustCache(APPOINTMENTS_SHEET);
      } catch(e) { Logger.log('24h err: ' + e); }
    }
    if (hrs >= 0.5 && hrs <= 2 && !row[16]) {
      try {
        sendReminderEmail(row, '1h');
        sheet.getRange(rowNum, 17, 1, 1).setValue(true);
        _bustCache(APPOINTMENTS_SHEET);
      } catch(e) { Logger.log('1h err: ' + e); }
    }
  }
}

function sendReminderEmail(row, type) {
  const activator = getActivatorById(row[3]);
  const tz        = activator ? activator.timezone : '';
  const label     = type==='24h' ? '24-Hour' : '1-Hour';
  const typeLabel = row[10]==='phone' ? 'Phone Appointment' : 'In-Person Appointment';
  const note      = row[10]==='phone'
    ? 'Please have your AT&T device and account information ready.'
    : 'Your activator will arrive at your location at the scheduled time.';
  const devices   = row[17] ? ' · ' + row[17] + ' device' + (row[17]>1?'s':'') : '';

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f5;padding:20px;">
  <div style="background:#f97316;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
    <h1 style="color:#fff;margin:0;font-size:22px;">⏰ ${label} Reminder</h1>
  </div>
  <div style="background:#fff;padding:30px;border-radius:0 0 8px 8px;">
    <p style="color:#333;font-size:16px;">Hi <strong>${row[5]}</strong>,</p>
    <p style="color:#555;margin-bottom:20px;">Your AT&T activation is coming up <strong>${type==='24h'?'tomorrow':'in about an hour'}</strong>!</p>
    <div style="background:#f8f9fa;border-left:4px solid #f97316;padding:16px;border-radius:4px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#888;padding:5px 0;width:40%;">Date</td><td style="color:#222;font-weight:bold;">${_bpFormatDate(row[1])}</td></tr>
        <tr><td style="color:#888;padding:5px 0;">Time</td><td style="color:#222;font-weight:bold;">${formatTime(row[2])}${tz?' ('+tz+')':''}</td></tr>
        <tr><td style="color:#888;padding:5px 0;">Type</td><td style="color:#222;font-weight:bold;">${typeLabel}</td></tr>
        <tr><td style="color:#888;padding:5px 0;">Activator</td><td style="color:#222;font-weight:bold;">${row[4]}</td></tr>
        <tr><td style="color:#888;padding:5px 0;">Devices</td><td style="color:#222;font-weight:bold;">${row[17]||1}${devices}</td></tr>
      </table>
    </div>
    <p style="color:#555;">${note}</p>
    <p style="color:#aaa;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">Appointment ID: ${row[0]}</p>
  </div></body></html>`;
  MailApp.sendEmail({ to: row[6], subject: label+' Reminder – AT&T Activation – '+_bpFormatDate(row[1]), htmlBody: html });
}

function setupReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction()==='checkAndSendReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAndSendReminders').timeBased().everyHours(1).create();
  return { success: true };
}

// ── Email ─────────────────────────────────────────────────────

function sendConfirmationEmail(id, data) {
  const activator  = getActivatorById(data.activatorId);
  const tz         = (activator&&activator.timezone) ? activator.timezone : (data.activatorTimezone||'');
  const webUrl     = getWebAppUrl();
  const cancelUrl  = webUrl ? webUrl+'?page=cancel&id='+id : '';
  const reschedUrl = webUrl ? webUrl+'?page=reschedule&id='+id : '';
  const html       = buildEmailHtml({ ...data, id, timezone:tz, cancelUrl, reschedUrl });
  MailApp.sendEmail({ to:data.customerEmail, subject:'Activation Appointment Confirmed – '+_bpFormatDate(data.date), htmlBody:html });
  if (activator&&activator.email) {
    MailApp.sendEmail({ to:activator.email,
      subject:'New Booking: '+data.customerName+' – '+_bpFormatDate(data.date)+' at '+formatTime(data.time),
      htmlBody:html });
  }
}

function buildEmailHtml(d) {
  const typeLabel = d.appointmentType==='phone' ? 'Phone Appointment' : 'In-Person Appointment';
  const callout   = d.appointmentType==='phone'
    ? 'Your activator will call you at the scheduled time. Please have your AT&T device and account information ready.'
    : 'Your activator will travel to your address at the scheduled time. Please ensure someone is available to receive them.';
  const actionBtns = d.cancelUrl ? `
    <div style="text-align:center;margin-top:24px;padding-top:20px;border-top:1px solid #eee;">
      <a href="${d.reschedUrl}" style="display:inline-block;background:#00A8E0;color:#fff;text-decoration:none;padding:11px 22px;border-radius:7px;font-weight:bold;font-size:13px;margin-right:10px;">Reschedule</a>
      <a href="${d.cancelUrl}" style="display:inline-block;background:#f3f4f6;color:#374151;text-decoration:none;padding:11px 22px;border-radius:7px;font-weight:bold;font-size:13px;">Cancel</a>
    </div>` : '';
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f5;padding:20px;">
  <div style="background:#00A8E0;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
    <h1 style="color:#fff;margin:0;font-size:22px;">Activation Appointment Confirmed</h1>
  </div>
  <div style="background:#fff;padding:30px;border-radius:0 0 8px 8px;">
    <p style="color:#333;font-size:16px;">Dear <strong>${d.customerName}</strong>,</p>
    <p style="color:#555;margin-bottom:20px;">Your AT&T device activation appointment has been scheduled successfully.</p>
    <div style="background:#f8f9fa;border-left:4px solid #00A8E0;padding:16px;border-radius:4px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#888;padding:5px 0;width:40%;">Date</td><td style="color:#222;font-weight:bold;">${_bpFormatDate(d.date)}</td></tr>
        <tr><td style="color:#888;padding:5px 0;">Time</td><td style="color:#222;font-weight:bold;">${formatTime(d.time)}${d.timezone?' ('+d.timezone+')':''}</td></tr>
        <tr><td style="color:#888;padding:5px 0;">Type</td><td style="color:#222;font-weight:bold;">${typeLabel}</td></tr>
        <tr><td style="color:#888;padding:5px 0;">Activator</td><td style="color:#222;font-weight:bold;">${d.activatorName}</td></tr>
        <tr><td style="color:#888;padding:5px 0;">Devices</td><td style="color:#222;font-weight:bold;">${d.deviceCount||1} device${(d.deviceCount||1)>1?'s':''}</td></tr>
        <tr><td style="color:#888;padding:5px 0;">DSI/SPM #</td><td style="color:#222;font-weight:bold;">${d.dsiSpmNumber}</td></tr>
        ${d.address?'<tr><td style="color:#888;padding:5px 0;">Address</td><td style="color:#222;">'+d.address+'</td></tr>':''}
      </table>
    </div>
    <p style="color:#555;">${callout}</p>
    ${actionBtns}
    <p style="color:#aaa;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
      Appointment ID: ${d.id}<br>Need help? Contact us directly.
    </p>
  </div></body></html>`;
}

// ── Auth System ───────────────────────────────────────────────
// Admins sheet columns (0-indexed):
// 0=ID, 1=Username, 2=PasswordHash, 3=Role, 4=OfficeAccess,
// 5=DisplayName, 6=Active, 7=SessionToken, 8=TokenExpiry

function hashPassword(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + ':' + salt
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function getOrCreateAdminsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ensureSheet(ss, ADMINS_SHEET, [
    'ID','Username','PasswordHash','Role','OfficeAccess',
    'DisplayName','Active','SessionToken','TokenExpiry'
  ]);
}

function loginAdmin(username, password) {
  if (!username || !password) return { success: false, error: 'Missing credentials' };
  const sheet  = getOrCreateAdminsSheet();
  const all    = getSheetData(ADMINS_SHEET);
  const rowIdx = all.findIndex(r =>
    String(r[1]).toLowerCase() === username.toLowerCase() &&
    (r[6] === true || r[6] === 'TRUE')
  );
  if (rowIdx < 0) return { success: false, error: 'Invalid username or password' };
  const row  = all[rowIdx];
  const hash = hashPassword(password, username.toLowerCase());
  if (row[2] !== hash) return { success: false, error: 'Invalid username or password' };

  const token    = Utilities.getUuid();
  const expiry   = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  const sheetRow = rowIdx + 2; // +1 for header, +1 for 1-index
  sheet.getRange(sheetRow, 8, 1, 2).setValues([[token, expiry]]);
  _bustCache(ADMINS_SHEET);

  return {
    success: true, token,
    role: row[3], officeAccess: row[4],
    displayName: row[5], username: row[1]
  };
}

function validateSession(token) {
  if (!token) return null;
  const all    = getSheetData(ADMINS_SHEET);
  const rowIdx = all.findIndex(r =>
    r[7] === token && (r[6] === true || r[6] === 'TRUE')
  );
  if (rowIdx < 0) return null;
  const row = all[rowIdx];
  if (row[8] && new Date(row[8]) < new Date()) return null; // expired
  return {
    role: row[3], officeAccess: row[4],
    displayName: row[5], username: row[1], id: row[0]
  };
}

function logoutAdmin(token) {
  if (!token) return { success: false };
  const sheet  = getOrCreateAdminsSheet();
  const all    = getSheetData(ADMINS_SHEET);
  const rowIdx = all.findIndex(r => r[7] === token);
  if (rowIdx < 0) return { success: false };
  sheet.getRange(rowIdx + 2, 8, 1, 2).setValues([['', '']]);
  _bustCache(ADMINS_SHEET);
  return { success: true };
}

function createAdmin(data, callerToken) {
  const caller = validateSession(callerToken);
  if (!caller || caller.role !== 'superadmin') return { success: false, error: 'Unauthorized' };
  if (!data.username || !data.password || !data.role)
    return { success: false, error: 'Missing required fields' };

  const sheet = getOrCreateAdminsSheet();
  const all   = getSheetData(ADMINS_SHEET);
  if (all.find(r => String(r[1]).toLowerCase() === data.username.toLowerCase()))
    return { success: false, error: 'Username already exists' };

  const id   = 'ADM' + Date.now();
  const hash = hashPassword(data.password, data.username.toLowerCase());
  sheet.appendRow([
    id, data.username, hash, data.role,
    data.officeAccess || '', data.displayName || data.username,
    true, '', ''
  ]);
  _bustCache(ADMINS_SHEET);
  return { success: true, id };
}

function updateAdmin(id, updates, callerToken) {
  const caller = validateSession(callerToken);
  if (!caller || caller.role !== 'superadmin') return { success: false, error: 'Unauthorized' };

  const sheet = getOrCreateAdminsSheet();
  const all   = getSheetData(ADMINS_SHEET);
  for (let i = 0; i < all.length; i++) {
    if (all[i][0] !== id) continue;
    const r = i + 2; // +2: header row + 1-index
    if (updates.displayName  !== undefined) sheet.getRange(r, 6).setValue(updates.displayName);
    if (updates.role         !== undefined) sheet.getRange(r, 4).setValue(updates.role);
    if (updates.officeAccess !== undefined) sheet.getRange(r, 5).setValue(updates.officeAccess);
    if (updates.active       !== undefined) sheet.getRange(r, 7).setValue(updates.active);
    if (updates.password) {
      sheet.getRange(r, 3).setValue(hashPassword(updates.password, all[i][1].toLowerCase()));
    }
    _bustCache(ADMINS_SHEET);
    return { success: true };
  }
  return { success: false, error: 'Admin not found' };
}

function getAdmins(callerToken) {
  const caller = validateSession(callerToken);
  if (!caller || caller.role !== 'superadmin') return { success: false, error: 'Unauthorized' };

  return getSheetData(ADMINS_SHEET)
    .filter(r => r[0])
    .map(r => ({
      id: r[0], username: r[1], role: r[3],
      officeAccess: r[4], displayName: r[5],
      active: r[6] === true || r[6] === 'TRUE'
    }));
}

function getOffices() {
  const fromActivators = getSheetData(ACTIVATORS_SHEET)
    .filter(r => r[0])
    .map(r => r[19] || '');
  const fromAdmins = getSheetData(ADMINS_SHEET)
    .filter(r => r[0] && r[4] && r[4] !== 'ALL')
    .flatMap(r => r[4].split('|').map(s => s.trim()));
  return [...new Set([...fromActivators, ...fromAdmins].filter(o => o))].sort();
}

// One-time function: creates the initial superadmin account.
// Run once from the Apps Script editor after deploying.
function setupInitialAdmin() {
  const sheet = getOrCreateAdminsSheet();
  const all   = getSheetData(ADMINS_SHEET);
  if (all.find(r => r[3] === 'superadmin' && (r[6] === true || r[6] === 'TRUE'))) {
    Logger.log('An active superadmin already exists.');
    return { success: false, error: 'Superadmin already exists' };
  }
  const username = 'admin';
  const password = 'ATT@ctiv8!';
  const hash     = hashPassword(password, username.toLowerCase());
  const id       = 'ADM' + Date.now();
  sheet.appendRow([id, username, hash, 'superadmin', 'ALL', 'System Admin', true, '', '']);
  Logger.log('Superadmin created! Username: admin | Password: ATT@ctiv8! — CHANGE PASSWORD AFTER FIRST LOGIN.');
  return { success: true, username, tempPassword: password };
}

// ── Setup ─────────────────────────────────────────────────────

function initializeSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet(ss, APPOINTMENTS_SHEET, [
    'ID','Date','Time','Activator ID','Activator Name',
    'Customer Name','Customer Email','Customer Phone','Address',
    'DSI/SPM Number','Type','Booked By','Status','Notes','Created At',
    'Reminder 24h Sent','Reminder 1h Sent','Device Count','Cancellation Reason','Office'
  ]);
  ensureSheet(ss, ACTIVATORS_SHEET, [
    'ID','Name','Email','Timezone',
    'Mon Start','Mon End','Tue Start','Tue End','Wed Start','Wed End',
    'Thu Start','Thu End','Fri Start','Fri End','Sat Start','Sat End',
    'Sun Start','Sun End','Active','Office'
  ]);
  ensureSheet(ss, BLOCKED_TIMES_SHEET, [
    'ID','Activator ID','Date','All Day',
    'Start Time','End Time','Reason','Created At'
  ]);
  ensureSheet(ss, ADMINS_SHEET, [
    'ID','Username','PasswordHash','Role','OfficeAccess',
    'DisplayName','Active','SessionToken','TokenExpiry'
  ]);
  return { success:true };
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    const rng = sheet.getRange(1,1,1,headers.length);
    rng.setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Helpers ───────────────────────────────────────────────────

// Execution-scoped read cache.  GAS starts a fresh execution for every
// client call, so this safely collapses repeated reads of the same sheet
// within one request (e.g. validateSession called by several callers).
const _SHEET_CACHE = {};
function getSheetData(sheetName) {
  if (_SHEET_CACHE[sheetName]) return _SHEET_CACHE[sheetName];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) { _SHEET_CACHE[sheetName] = []; return []; }
  return (_SHEET_CACHE[sheetName] = sheet.getDataRange().getValues().slice(1));
}
// Call after any write to a sheet so the next read gets fresh data.
function _bustCache(sheetName) { delete _SHEET_CACHE[sheetName]; }

function getWebAppUrl() {
  try { const u = ScriptApp.getService().getUrl(); if (u) return u; } catch(e) {}
  return PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || '';
}

function _bpFormatDate(dateStr) {
  if (!dateStr) return '';
  const [y,m,d] = String(dateStr).split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-US',{ weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h,m] = String(timeStr).split(':').map(Number);
  const period = h>=12?'PM':'AM', h12=h===0?12:h>12?h-12:h;
  return h12+':'+pad(m)+' '+period;
}

function pad(n) { return String(n).padStart(2,'0'); }

// ── One-time setup helpers ─────────────────────────────────────

function setScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('WEB_APP_URL', 'https://script.google.com/macros/s/AKfycbwdTwcAvsAYQ72li2MSAQ_14U6D3lkwoSPeksNKm5o9TFhla_Qam0orQO3jZCnFS7DxZA/exec');
  props.setProperty('ADMIN_PASSWORD', 'ATT@ctiv8!');
  Logger.log('Properties set.');
  return { success: true };
}
