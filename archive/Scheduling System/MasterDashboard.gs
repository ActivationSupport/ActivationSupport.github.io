// ============================================================
//  MASTER ACTIVATION DASHBOARD  –  Code.gs
//  Paste this entire file into a new standalone Apps Script
//  project that is bound to a new Google Sheet named
//  "Master Activation Dashboard".
//
//  After pasting:
//    1. Run  refreshAllData()  once (authorize when prompted)
//    2. Run  setupHourlyTrigger()  to enable auto-refresh
//  The custom menu  🔄 Dashboard > ↻ Refresh Now  will appear
//  the next time the spreadsheet is opened.
// ============================================================

var OFFICES = [
  { name: 'Elevate',   rep: 'Jackie', id: '1cOib-GVI_bYOgILGP5wBQdQg2ri2bZ0yEmApmv03PM0' },
  { name: 'Delagroup', rep: 'Eli',    id: '1FgCkF66MHlDkzwdpFZk5jYbjhdvoaiyT4bLoAu13Z6o' },
  { name: 'MidSpire',  rep: 'Jamis',  id: '1B9jdR9hm6JiuaLYAJaw4ys2Q9YHkNphQG1I4dViCPTE' },
  { name: 'Prestige',  rep: 'Rudy',   id: '1Rd6b__lsQ-qpEUy52zxMVy8dbHHzWJmQD5iORbGw4tA' },
  { name: 'Ignite',    rep: 'Jacob',  id: '1_D-dRrOjvHkfDIeMiRTtasGEo-KY32UjKSaafqdn5oI' },
  { name: 'Viridian',  rep: 'Stef',   id: '1pFvQrlZqXDJZn3u2LC5Z12n8uLmlbNYGp7rCyQh6tQY' }
];

var APPT_SHEET = 'Appointments';

// Source column indices in each office's Appointments sheet (0-based)
var C = {
  ID:0, DATE:1, TIME:2, ACT_ID:3, ACT_NAME:4,
  CUST:5, EMAIL:6, PHONE:7, ADDRESS:8, DSI:9,
  TYPE:10, BOOKED_BY:11, STATUS:12, NOTES:13,
  CREATED:14, REM24:15, REM1:16, DEVICES:17, CANCEL:18
};

var MASTER_HEADERS = [
  'Office', 'Rep', 'Date', 'Time', 'Activator', 'Customer Name',
  'Phone', 'Email', 'Address', 'DSI/SPM', 'Type', 'Booked By',
  'Status', 'Devices', 'Notes', 'Cancellation Reason'
];

var OFFICE_COLORS = {
  'Elevate':   '#1155cc',
  'Delagroup': '#38761d',
  'MidSpire':  '#b45309',
  'Prestige':  '#cc0000',
  'Ignite':    '#7030a0',
  'Viridian':  '#0b5394'
};

// Row background colors per status
var STATUS_BG = {
  'Scheduled':   '#d9ead3',
  'Completed':   '#efefef',
  'Cancelled':   '#f4cccc',
  'No-Show':     '#fce5cd',
  'Rescheduled': '#fff2cc'
};

// Row font colors per status
var STATUS_FG = {
  'Scheduled':   '#1c4a1c',
  'Completed':   '#555555',
  'Cancelled':   '#990000',
  'No-Show':     '#7f4c00',
  'Rescheduled': '#7f6000'
};


// ── MENU ─────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 Dashboard')
    .addItem('↻  Refresh Now', 'refreshAllData')
    .addSeparator()
    .addItem('⏱  Set Up Hourly Auto-Refresh', 'setupHourlyTrigger')
    .addItem('✕  Remove Auto-Refresh', 'removeHourlyTrigger')
    .addToUi();
}


// ── MAIN REFRESH ─────────────────────────────────────────────

function refreshAllData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allAppts = [];

  OFFICES.forEach(function(office) {
    try {
      var src   = SpreadsheetApp.openById(office.id);
      var sheet = src.getSheetByName(APPT_SHEET);
      if (!sheet) { Logger.log('No Appointments sheet in ' + office.name); return; }

      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var r = data[i];
        if (!r[C.ID] && !r[C.DATE]) continue; // skip blank rows
        allAppts.push({
          office:   office.name,
          rep:      office.rep,
          date:     r[C.DATE],
          time:     r[C.TIME],
          actName:  r[C.ACT_NAME]  || '',
          cust:     r[C.CUST]      || '',
          email:    r[C.EMAIL]     || '',
          phone:    r[C.PHONE]     || '',
          address:  r[C.ADDRESS]   || '',
          dsi:      r[C.DSI]       || '',
          type:     r[C.TYPE]      || '',
          bookedBy: r[C.BOOKED_BY] || '',
          status:   r[C.STATUS]    || '',
          notes:    r[C.NOTES]     || '',
          devices:  r[C.DEVICES]   || '',
          cancel:   r[C.CANCEL]    || ''
        });
      }
    } catch(e) {
      Logger.log('Error reading ' + office.name + ': ' + e.message);
    }
  });

  // Sort by date then time
  allAppts.sort(function(a, b) {
    return parseApptDate(a.date, a.time) - parseApptDate(b.date, b.time);
  });

  // Build all tabs
  buildTodayTab(ss, allAppts);
  buildMasterTab(ss, allAppts);
  OFFICES.forEach(function(office) {
    buildOfficeTab(ss, office, allAppts.filter(function(a) { return a.office === office.name; }));
  });

  orderTabs(ss);

  // Stamp refresh time on Today tab row 1
  var tz = Session.getScriptTimeZone();
  var ts = Utilities.formatDate(new Date(), tz, 'M/d/yyyy h:mm a');
  var todaySheet = ss.getSheetByName('📋 Today');
  if (todaySheet) {
    todaySheet.getRange('A1')
      .setValue('↻  Last refreshed: ' + ts)
      .setFontColor('#888888')
      .setFontStyle('italic')
      .setFontSize(9);
  }

  ss.toast('Updated — ' + allAppts.length + ' total appointments across all offices', '✓ Dashboard Refreshed', 5);
}


// ── TODAY TAB ─────────────────────────────────────────────────

function buildTodayTab(ss, allAppts) {
  var sheet = getOrCreate(ss, '📋 Today');
  sheet.clearContents();
  sheet.clearFormats();
  sheet.setTabColor('#0b5394');

  var tz       = Session.getScriptTimeZone();
  var today    = new Date();
  today.setHours(0, 0, 0, 0);
  var todayLabel = Utilities.formatDate(today, tz, 'EEEE, MMMM d, yyyy');
  var COLS     = 10;

  // Row 1: refresh stamp (filled by refreshAllData after build)
  // Row 2: date banner
  sheet.getRange(2, 1, 1, COLS).merge()
    .setValue('📋   DAILY ACTIVATION REPORT  —  ' + todayLabel)
    .setBackground('#1a1a2e')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(13)
    .setHorizontalAlignment('center');

  var todayAppts = allAppts.filter(function(a) {
    var d = toMidnight(a.date);
    return d && d.getTime() === today.getTime();
  });

  var row = 3;

  if (todayAppts.length === 0) {
    sheet.getRange(row, 1, 1, COLS).merge()
      .setValue('No appointments scheduled for today.')
      .setFontStyle('italic')
      .setFontColor('#888888')
      .setHorizontalAlignment('center');
    sheet.autoResizeColumns(1, COLS);
    return;
  }

  var COL_HEADERS = [
    'Time', 'Activator', 'Customer Name', 'Phone',
    'Type', 'Booked By', 'Status', 'Devices', 'Notes', 'Cancellation Reason'
  ];

  OFFICES.forEach(function(office) {
    var appts = todayAppts.filter(function(a) { return a.office === office.name; });
    if (appts.length === 0) return;

    var oc = OFFICE_COLORS[office.name] || '#444444';

    // ── Office banner ────────────────────────────────────────
    sheet.getRange(row, 1, 1, COLS).merge()
      .setValue('  ' + office.name.toUpperCase() + '  ·  ' + office.rep +
                '  ·  ' + appts.length + ' appt' + (appts.length !== 1 ? 's' : '') + ' today')
      .setBackground(oc)
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setFontSize(11)
      .setHorizontalAlignment('left');
    row++;

    // Group by activator name
    var byAct = {};
    appts.forEach(function(a) {
      var k = a.actName || '(Unassigned)';
      if (!byAct[k]) byAct[k] = [];
      byAct[k].push(a);
    });

    Object.keys(byAct).sort().forEach(function(actName) {
      var list = byAct[actName];

      // Activator sub-header
      sheet.getRange(row, 1, 1, COLS).merge()
        .setValue('    👤  ' + actName + '  —  ' +
                  list.length + ' booking' + (list.length !== 1 ? 's' : ''))
        .setBackground('#d9d9d9')
        .setFontWeight('bold')
        .setFontColor('#222222')
        .setFontSize(10);
      row++;

      // Column header row
      sheet.getRange(row, 1, 1, COLS)
        .setValues([COL_HEADERS])
        .setBackground('#f3f3f3')
        .setFontWeight('bold')
        .setFontColor('#555555')
        .setFontSize(9);
      row++;

      // Appointment rows
      list.forEach(function(a) {
        var vals = [
          formatTime(a.time), a.actName, a.cust, a.phone,
          a.type, a.bookedBy, a.status, a.devices, a.notes,
          a.cancel || ''
        ];
        var rng = sheet.getRange(row, 1, 1, COLS);
        rng.setValues([vals]).setFontSize(9).setFontWeight('normal');

        // Status-based highlight
        var bg   = STATUS_BG[a.status] || '#ffffff';
        var fg   = STATUS_FG[a.status] || '#000000';
        var bold = (a.status === 'Cancelled' || a.status === 'No-Show') ? 'bold' : 'normal';
        rng.setBackground(bg).setFontColor(fg).setFontWeight(bold);

        row++;
      });

      row++; // spacer between activators
    });

    row++; // spacer between offices
  });

  // Column widths
  sheet.setColumnWidth(1, 85);   // Time
  sheet.setColumnWidth(2, 130);  // Activator
  sheet.setColumnWidth(3, 165);  // Customer
  sheet.setColumnWidth(4, 115);  // Phone
  sheet.setColumnWidth(5, 115);  // Type
  sheet.setColumnWidth(6, 115);  // Booked By
  sheet.setColumnWidth(7, 105);  // Status
  sheet.setColumnWidth(8, 70);   // Devices
  sheet.autoResizeColumn(9);     // Notes
  sheet.autoResizeColumn(10);    // Cancellation Reason
  sheet.setFrozenRows(2);
}


// ── ALL OFFICES TAB ──────────────────────────────────────────

function buildMasterTab(ss, appts) {
  var sheet = getOrCreate(ss, '📊 All Offices');
  sheet.clearContents();
  sheet.clearFormats();
  sheet.setTabColor('#434343');

  sheet.getRange(1, 1, 1, MASTER_HEADERS.length)
    .setValues([MASTER_HEADERS])
    .setBackground('#434343')
    .setFontColor('#ffffff')
    .setFontWeight('bold');

  if (appts.length === 0) {
    sheet.getRange(2, 1).setValue('No appointments found.');
    return;
  }

  var rows = appts.map(toRow);
  sheet.getRange(2, 1, rows.length, MASTER_HEADERS.length).setValues(rows);

  appts.forEach(function(a, i) {
    var rng = sheet.getRange(i + 2, 1, 1, MASTER_HEADERS.length);
    if (a.status === 'Cancelled') {
      rng.setBackground('#f4cccc').setFontColor('#990000').setFontWeight('bold');
    } else {
      rng.setBackground(STATUS_BG[a.status] || '#ffffff')
         .setFontColor(STATUS_FG[a.status] || '#000000')
         .setFontWeight('normal');
    }
  });

  sheet.getRange(2, 3, rows.length, 1).setNumberFormat('MM/dd/yyyy');
  sheet.autoResizeColumns(1, MASTER_HEADERS.length);
  sheet.setFrozenRows(1);
}


// ── INDIVIDUAL OFFICE TABS ───────────────────────────────────

function buildOfficeTab(ss, office, appts) {
  var tabName = office.name + ' (' + office.rep + ')';
  var sheet   = getOrCreate(ss, tabName);
  sheet.clearContents();
  sheet.clearFormats();
  sheet.setTabColor(OFFICE_COLORS[office.name] || '#444444');

  var headers = MASTER_HEADERS.slice(2); // drop Office + Rep columns
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setBackground(OFFICE_COLORS[office.name] || '#444444')
    .setFontColor('#ffffff')
    .setFontWeight('bold');

  if (appts.length === 0) {
    sheet.getRange(2, 1).setValue('No appointments yet for ' + office.name + '.');
    return;
  }

  var rows = appts.map(function(a) { return toRow(a).slice(2); });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  appts.forEach(function(a, i) {
    var rng = sheet.getRange(i + 2, 1, 1, headers.length);
    if (a.status === 'Cancelled') {
      rng.setBackground('#f4cccc').setFontColor('#990000').setFontWeight('bold');
    } else {
      rng.setBackground(STATUS_BG[a.status] || '#ffffff')
         .setFontColor(STATUS_FG[a.status] || '#000000')
         .setFontWeight('normal');
    }
  });

  sheet.getRange(2, 1, rows.length, 1).setNumberFormat('MM/dd/yyyy');
  sheet.autoResizeColumns(1, headers.length);
  sheet.setFrozenRows(1);
}


// ── HELPERS ──────────────────────────────────────────────────

function toRow(a) {
  var d = a.date instanceof Date ? a.date : new Date(a.date);
  return [
    a.office, a.rep, d, a.time, a.actName,
    a.cust, a.phone, a.email, a.address,
    a.dsi, a.type, a.bookedBy, a.status,
    a.devices, a.notes, a.cancel
  ];
}

function getOrCreate(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function toMidnight(val) {
  if (!val) return null;
  var d = val instanceof Date ? new Date(val) : new Date(val);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseApptDate(dateVal, timeStr) {
  var d = toMidnight(dateVal);
  if (!d) return new Date(0);
  if (timeStr) {
    var m = String(timeStr).match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (m) {
      var h = parseInt(m[1]), min = parseInt(m[2]);
      var ampm = (m[3] || '').toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      d.setHours(h, min);
    }
  }
  return d;
}

function formatTime(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'h:mm a');
  }
  return String(val);
}

function orderTabs(ss) {
  var order = ['📋 Today', '📊 All Offices']
    .concat(OFFICES.map(function(o) { return o.name + ' (' + o.rep + ')'; }));
  order.forEach(function(name, idx) {
    var s = ss.getSheetByName(name);
    if (s) { ss.setActiveSheet(s); ss.moveActiveSheet(idx + 1); }
  });
  // Remove blank default Sheet1 if present
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
}


// ── TRIGGERS ─────────────────────────────────────────────────

function setupHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'refreshAllData') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshAllData').timeBased().everyHours(1).create();
  SpreadsheetApp.getActiveSpreadsheet()
    .toast('Hourly auto-refresh enabled ✓', 'Trigger Set', 4);
}

function removeHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'refreshAllData') ScriptApp.deleteTrigger(t);
  });
  SpreadsheetApp.getActiveSpreadsheet()
    .toast('Auto-refresh removed.', 'Done', 3);
}
