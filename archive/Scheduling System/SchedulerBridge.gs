// ============================================================
//  Scheduler Bridge — add this file to each office's
//  CallList Apps Script project.
//
//  Setup (one-time per office):
//  1. Open your central Scheduling spreadsheet
//  2. Copy its URL — the ID is the long string between /d/ and /edit
//     e.g. https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
//  3. Paste that ID as SCHEDULER_SPREADSHEET_ID below
//  4. Paste your Web App URL (the ...exec link) as SCHEDULER_WEB_APP_URL
//  5. Save — no redeploy needed for the CallList (this runs server-side only)
// ============================================================

var SCHEDULER_SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';
var SCHEDULER_WEB_APP_URL    = 'PASTE_YOUR_WEB_APP_URL_HERE';  // e.g. https://script.google.com/macros/s/XXXXX/exec

var _APPOINTMENTS_SHEET = 'Appointments';

/**
 * Returns today's appointment summary from the central scheduling spreadsheet.
 * Used by writeDailyReportTab() in CallList_final.gs and CallList_ICD.gs.
 * Returns empty buckets gracefully if the scheduler isn't configured yet.
 */
function getAppointmentDailySummary(dateStr) {
  var empty = { scheduled:[], completed:[], noShows:[], cancelled:[], totalDevicesCompleted:0, date:dateStr };

  try {
    if (!SCHEDULER_SPREADSHEET_ID || SCHEDULER_SPREADSHEET_ID === 'PASTE_YOUR_SPREADSHEET_ID_HERE') return empty;

    var ss    = SpreadsheetApp.openById(SCHEDULER_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(_APPOINTMENTS_SHEET);
    if (!sheet) return empty;

    var data = sheet.getDataRange().getValues().slice(1); // skip header
    var scheduled = [], completed = [], noShows = [], cancelled = [];

    data.forEach(function(r) {
      if (!r[0] || String(r[1]) !== dateStr) return;
      var entry = {
        id:              r[0],
        time:            r[2]  || '',
        activatorName:   r[4]  || '',
        customerName:    r[5]  || '',
        dsiSpmNumber:    r[9]  || '',
        appointmentType: r[10] || '',
        deviceCount:     Number(r[17]) || 1,
        cancelReason:    r[18] || ''
      };
      var status = r[12] || 'Scheduled';
      if      (status === 'Scheduled')  scheduled.push(entry);
      else if (status === 'Completed')  completed.push(entry);
      else if (status === 'No-Show')    noShows.push(entry);
      else if (status === 'Cancelled')  cancelled.push(entry);
    });

    var byTime = function(a, b) { return String(a.time).localeCompare(String(b.time)); };
    scheduled.sort(byTime);
    completed.sort(byTime);
    noShows.sort(byTime);
    cancelled.sort(byTime);

    var totalDevicesCompleted = completed.reduce(function(s, e) { return s + e.deviceCount; }, 0);
    return { scheduled:scheduled, completed:completed, noShows:noShows, cancelled:cancelled, totalDevicesCompleted:totalDevicesCompleted, date:dateStr };

  } catch(e) {
    Logger.log('SchedulerBridge error: ' + e);
    return empty;
  }
}

/**
 * Returns the scheduler URLs for use in the Daily Report links.
 */
function getSchedulerUrls() {
  if (!SCHEDULER_WEB_APP_URL || SCHEDULER_WEB_APP_URL === 'PASTE_YOUR_WEB_APP_URL_HERE') {
    return { bookingUrl: '', adminUrl: '' };
  }
  return {
    bookingUrl: SCHEDULER_WEB_APP_URL,
    adminUrl:   SCHEDULER_WEB_APP_URL + '?page=admin'
  };
}
