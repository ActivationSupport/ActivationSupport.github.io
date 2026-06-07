// ============================================================
//  TableauSync.gs — Standalone Tableau → Google Sheets Pipeline
//  Central project for all campaign report syncs
// ============================================================
//
//  SETUP (one-time):
//    1. Create a new standalone Apps Script project
//    2. Paste this file
//    3. Set Script Properties (File → Project settings → Script properties):
//       - TABLEAU_EMAIL        → your Tableau login email
//       - TABLEAU_PASSWORD     → your Tableau login password
//       - TABLEAU_SITE         → site content URL (e.g. "sci")
//       - TABLEAU_SERVER       → server URL (e.g. "https://us-east-1.online.tableau.com")
//       - SHEET_ID             → Google Sheet ID for Tableau data output
//       - ADMIN_SHEET_ID       → Google Sheet ID for the admin _Offices tab
//    4. Run setupDailyTrigger() once from the editor
//    5. Done — runs automatically every morning
// ============================================================

var TABLEAU_API_VERSION = '3.24';

// === CONFIGURATION ===

function _getConfig() {
  var props = PropertiesService.getScriptProperties();
  return {
    email:    props.getProperty('TABLEAU_EMAIL')    || '',
    password: props.getProperty('TABLEAU_PASSWORD') || '',
    site:     props.getProperty('TABLEAU_SITE')     || 'sci',
    server:   props.getProperty('TABLEAU_SERVER')   || 'https://us-east-1.online.tableau.com',
    sheetId:  props.getProperty('SHEET_ID')         || ''
  };
}


// === REPORT REGISTRY ===
// Add new reports here. Each entry defines:
//   - viewContentUrl:   workbook/view path as it appears in Tableau URLs (fallback only)
//   - customViewId:     UUID from the Tableau custom view URL (primary download method)
//   - tabName:          Google Sheet tab to write data into
//   - columns:          Array of column names to keep (case-sensitive, must match Tableau field names)
//                       Set null to pull ALL columns from Tableau
//   - deduplicateKey:   Composite key columns to deduplicate on (Tableau Measure Values creates duplicate rows)
//   - dateFilterColumn: Column name to apply a client-side rolling date filter on
//   - dateRangeDays:    Rolling window size in days (default 30)
//   - timeColumns:      Columns to reformat from full datetime → time-only (HH:MM AM/PM)

var REPORTS = {

  'b2b-order-log': {
    viewContentUrl: 'ATTTRACKER-B2B/sheets/ORDERLOG',
    customViewId: '78113e5a-eeb6-48d0-87cf-f3a3901380c0',
    tabName: 'B2B Order Log',
    dateFilterStart: 'Start Date',
    dateFilterEnd: 'End Date',
    dateRangeDays: 120,
    dateFilterColumn: 'sp.Order Date (copy)',
    timeColumns: ['Order Time (Timezone)'],
    columns: [
      'Owner & Office',
      'Rep',
      'sp.Order Date (copy)',
      'Order Time (Timezone)',
      'sp.SPM Number',
      'spe.Name',
      'Product Type (Broken Out)',
      'CRU/IRU',
      'DTR Status (enriched)',
      'Disconnect Reason (Consolidated)',
      'spe.Port Carrier',
      'Order Status',
      'Voice Line Count',
      'spe.TN Type',
      'IF/OOF',
      'Package',
      'spe.Install Date',
      'Auto Bill Pay',
      'B2B Rep Volume Bonus Tiers',
      'Tier Bonus Payout/DNQ Reason',
      'DD Date'
    ],
    deduplicateKey: ['sp.SPM Number', 'spe.Name']
  },

  'b2b-churn': {
    viewContentUrl: 'ATTTRACKER-B2B/sheets/CHURNRATES',
    customViewId: 'c928f902-8feb-4783-838b-f6df0405a3ed',
    tabName: 'Churn Rates',
    columns: null
  },

  'b2b-aor': {
    viewContentUrl: 'ATTTRACKER-B2B/sheets/ActivationOpportunityReport',
    customViewId: '9f3ad24e-214d-45a1-8e1b-065e51ccb53c',
    tabName: 'AOR',
    dateRangeDays: 120,
    dateFilterColumn: 'sp.Order Date (copy)',
    columns: [
      'Owner & Office',
      'Rep',
      'sp.SPM Number',
      'Product Type (Broken out lvl 2)',
      'sp.Order Date (copy)',
      'Ship Date (SP)',
      'DTR Status (enriched)',
      'Activation Bucket',
      'SPE.DTR Current Due Date (date)',
      'Unit Count'
    ],
    deduplicateKey: ['sp.SPM Number', 'sp.Order Date (copy)']
  },

  'b2b-activation-rates': {
    viewContentUrl: 'ATTTRACKER-B2B/sheets/ACTIVATIONRATES',
    customViewId: 'ff0ac9e9-c421-425e-899e-fed400f567dd',
    tabName: 'Activation Rates',
    columns: null
  },

  // Future: add NDS reports here
  // 'nds-order-log': { ... }
};


// === DISTRIBUTION TARGETS ===
// Each target maps a synced report → a destination campaign sheet + caches to bust.
//
// campaignType:     matches templateType in admin _Offices tab — auto-discovers offices
// filterColumn:     null = write ALL rows (shared sheets, Code.gs handles per-office scoping)
//                   'Owner & Office' = filter per-office using ownerOfficeMatch
// ownerOfficeMatch: only needed when filterColumn is set (substring, case-insensitive)

var TARGETS = [
  {
    reportKey:    'b2b-order-log',
    sourceTab:    'B2B Order Log',
    sheetId:      '115Nn7KbwbdlWFzZPkx_fw2hbNnGXdIsoDk6buSmCsBw',
    tabName:      '_TableauOrderLog',
    filterColumn: null,
    campaignType: 'att-b2b'
  },
  {
    reportKey:    'b2b-churn',
    sourceTab:    'Churn Rates',
    sheetId:      '115Nn7KbwbdlWFzZPkx_fw2hbNnGXdIsoDk6buSmCsBw',
    tabName:      '_TableauChurnReport',
    filterColumn: null,
    campaignType: 'att-b2b'
  },
  {
    reportKey:    'b2b-aor',
    sourceTab:    'AOR',
    sheetId:      '115Nn7KbwbdlWFzZPkx_fw2hbNnGXdIsoDk6buSmCsBw',
    tabName:      '_TableauAOR',
    filterColumn: null,
    campaignType: 'att-b2b'
  },
  {
    reportKey:    'b2b-activation-rates',
    sourceTab:    'Activation Rates',
    sheetId:      '115Nn7KbwbdlWFzZPkx_fw2hbNnGXdIsoDk6buSmCsBw',
    tabName:      '_TableauActivationRates',
    filterColumn: null,
    campaignType: 'att-b2b'
  }

  // Future: NDS targets
  // {
  //   reportKey:    'nds-order-log',
  //   sourceTab:    'NDS Order Log',
  //   sheetId:      'NDS_SHEET_ID',
  //   tabName:      '_TableauOrderLog',
  //   filterColumn: null,
  //   campaignType: 'att-nds'
  // }
];


// === TABLEAU REST API ===

function _tableauSignIn(config) {
  var url = config.server + '/api/' + TABLEAU_API_VERSION + '/auth/signin';
  var payload = {
    credentials: {
      name: config.email,
      password: config.password,
      site: { contentUrl: config.site }
    }
  };

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Accept': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code !== 200) {
    throw new Error('Tableau sign-in failed (HTTP ' + code + '): ' + body.substring(0, 300));
  }

  var json = JSON.parse(body);
  return {
    token: json.credentials.token,
    siteId: json.credentials.site.id
  };
}

function _tableauSignOut(config, token) {
  try {
    UrlFetchApp.fetch(config.server + '/api/' + TABLEAU_API_VERSION + '/auth/signout', {
      method: 'post',
      headers: { 'X-Tableau-Auth': token },
      muteHttpExceptions: true
    });
  } catch (e) { /* non-critical */ }
}

function _findView(config, token, siteId, viewContentUrl) {
  var parts = viewContentUrl.split('/');
  var viewName = parts[parts.length - 1];

  var url = config.server + '/api/' + TABLEAU_API_VERSION
    + '/sites/' + siteId + '/views'
    + '?filter=viewUrlName:eq:' + encodeURIComponent(viewName)
    + '&pageSize=100';

  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Tableau-Auth': token, 'Accept': 'application/json' },
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code !== 200) {
    throw new Error('Failed to query views (HTTP ' + code + '): ' + body.substring(0, 300));
  }

  var json = JSON.parse(body);
  var views = json.views && json.views.view ? json.views.view : [];

  for (var i = 0; i < views.length; i++) {
    Logger.log('View [' + i + ']: contentUrl="' + views[i].contentUrl + '" id="' + views[i].id + '"');
  }

  for (var i = 0; i < views.length; i++) {
    if (views[i].contentUrl === viewContentUrl) {
      return { viewId: views[i].id, workbookId: views[i].workbook ? views[i].workbook.id : null };
    }
  }

  var workbookName = parts[0];
  for (var i = 0; i < views.length; i++) {
    if (views[i].contentUrl && views[i].contentUrl.indexOf(workbookName) !== -1) {
      Logger.log('Partial match: ' + views[i].contentUrl);
      return { viewId: views[i].id, workbookId: views[i].workbook ? views[i].workbook.id : null };
    }
  }

  if (views.length === 1) {
    return { viewId: views[0].id, workbookId: views[0].workbook ? views[0].workbook.id : null };
  }

  throw new Error('View not found: ' + viewContentUrl + '. Found ' + views.length + ' views named "' + viewName + '"');
}


// === CUSTOM VIEW DATA DOWNLOAD (primary) ===

function _downloadCustomViewData(config, token, siteId, customViewId) {
  var url = config.server + '/api/' + TABLEAU_API_VERSION
    + '/sites/' + siteId + '/customviews/' + customViewId + '/data';

  Logger.log('Downloading custom view: ' + customViewId);

  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Tableau-Auth': token },
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('Custom view download failed (HTTP ' + code + '): ' + resp.getContentText().substring(0, 300));
  }

  return resp.getContentText();
}


// === REST API DATA DOWNLOAD (fallback) ===

function _downloadViewData(config, token, siteId, viewId, report) {
  var url = config.server + '/api/' + TABLEAU_API_VERSION
    + '/sites/' + siteId + '/views/' + viewId + '/data';

  var dateRangeDays = report.dateRangeDays || 30;
  var endDate = new Date();
  var startDate = new Date();
  startDate.setDate(startDate.getDate() - dateRangeDays);
  var startStr = Utilities.formatDate(startDate, Session.getScriptTimeZone(), 'M/d/yyyy');
  var endStr   = Utilities.formatDate(endDate,   Session.getScriptTimeZone(), 'M/d/yyyy');

  if (report.dateFilterStart && report.dateFilterEnd) {
    url += '?vp_' + encodeURIComponent(report.dateFilterStart) + '=' + startStr
         + '&vp_' + encodeURIComponent(report.dateFilterEnd)   + '=' + endStr;
  } else if (report.dateFilterField) {
    url += '?vf_' + encodeURIComponent(report.dateFilterField) + '=' + encodeURIComponent(startStr + ',' + endStr);
  }

  Logger.log('Download URL: ' + url);

  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Tableau-Auth': token },
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('Failed to download view data (HTTP ' + code + '): ' + resp.getContentText().substring(0, 200));
  }

  return resp.getContentText();
}


// === CSV PARSING & COLUMN FILTERING ===

function _parseCsv(csvText) {
  return Utilities.parseCsv(csvText);
}

function _filterColumns(data, columnsToKeep) {
  if (!data || data.length === 0) return { headers: [], rows: [] };

  var headerRow = data[0];
  var keepIndices = [];
  var filteredHeaders = [];

  for (var c = 0; c < columnsToKeep.length; c++) {
    var colName = columnsToKeep[c];
    var idx = headerRow.indexOf(colName);
    if (idx !== -1) {
      keepIndices.push(idx);
      filteredHeaders.push(colName);
    } else {
      Logger.log('WARNING: Column not found in Tableau data: "' + colName + '"');
    }
  }

  var filteredRows = [];
  for (var r = 1; r < data.length; r++) {
    var row = [];
    for (var k = 0; k < keepIndices.length; k++) {
      row.push(data[r][keepIndices[k]] || '');
    }
    filteredRows.push(row);
  }

  return { headers: filteredHeaders, rows: filteredRows };
}

function _deduplicateRows(filtered, keyColumns) {
  var keyIndices = [];
  for (var k = 0; k < keyColumns.length; k++) {
    var idx = filtered.headers.indexOf(keyColumns[k]);
    if (idx === -1) {
      Logger.log('WARNING: dedup key column "' + keyColumns[k] + '" not found — skipping dedup');
      return filtered;
    }
    keyIndices.push(idx);
  }

  var seen = {};
  var beforeCount = filtered.rows.length;
  filtered.rows = filtered.rows.filter(function(row) {
    var key = keyIndices.map(function(i) { return String(row[i] || '').trim(); }).join('|');
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });

  Logger.log('Dedup (' + keyColumns.join('+') + '): ' + beforeCount + ' → ' + filtered.rows.length + ' rows (removed ' + (beforeCount - filtered.rows.length) + ')');
  return filtered;
}

function _filterByDateRange(filtered, dateColumn, rangeDays) {
  var idx = filtered.headers.indexOf(dateColumn);
  if (idx === -1) {
    Logger.log('WARNING: dateFilterColumn "' + dateColumn + '" not found — skipping date filter');
    return filtered;
  }

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays);
  cutoff.setHours(0, 0, 0, 0);
  Logger.log('Date filter cutoff: ' + cutoff.toISOString());

  var sampleCount = Math.min(filtered.rows.length, 5);
  for (var s = 0; s < sampleCount; s++) {
    var rawVal = filtered.rows[s][idx];
    var parsed = rawVal ? new Date(rawVal) : null;
    Logger.log('  Sample date [' + s + ']: raw="' + rawVal + '" parsed=' + (parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : 'INVALID'));
  }

  var beforeCount = filtered.rows.length;
  filtered.rows = filtered.rows.filter(function(row) {
    var val = row[idx];
    if (!val) return false;
    var d = new Date(val);
    return !isNaN(d.getTime()) && d >= cutoff;
  });

  Logger.log('Date filter (' + dateColumn + ', last ' + rangeDays + 'd): ' + beforeCount + ' → ' + filtered.rows.length + ' rows');
  return filtered;
}

function _formatTimeColumns(filtered, timeColumns) {
  if (!timeColumns || timeColumns.length === 0) return;

  var indices = [];
  for (var c = 0; c < timeColumns.length; c++) {
    var idx = filtered.headers.indexOf(timeColumns[c]);
    if (idx !== -1) {
      indices.push(idx);
    } else {
      Logger.log('WARNING: timeColumn "' + timeColumns[c] + '" not found — skipping');
    }
  }
  if (indices.length === 0) return;

  var formatted = 0;
  for (var r = 0; r < filtered.rows.length; r++) {
    for (var i = 0; i < indices.length; i++) {
      var val = filtered.rows[r][indices[i]];
      if (!val) continue;
      var str = String(val).trim();
      if (/^\d{1,2}:\d{2}/.test(str) && !/^\d{4}-/.test(str)) continue;
      var d = new Date(str);
      if (!isNaN(d.getTime())) {
        var h = d.getHours(), m = d.getMinutes();
        var ampm = h >= 12 ? 'PM' : 'AM';
        var h12 = h % 12 || 12;
        filtered.rows[r][indices[i]] = h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm;
        formatted++;
      }
    }
  }
  Logger.log('Formatted ' + formatted + ' time value(s) across ' + indices.length + ' column(s)');
}


// === GOOGLE SHEET WRITING ===

function _writeToSheet(sheetId, tabName, headers, rows) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) sheet = ss.insertSheet(tabName);

  sheet.clearContents();

  if (headers.length > 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  var resizeCols = Math.min(headers.length, 25);
  for (var i = 1; i <= resizeCols; i++) {
    sheet.autoResizeColumn(i);
  }

  return { tab: tabName, headers: headers.length, rows: rows.length };
}


// === SYNC FUNCTIONS ===

function syncReport(reportKey) {
  var report = REPORTS[reportKey];
  if (!report) throw new Error('Unknown report: ' + reportKey);

  var config = _getConfig();
  if (!config.email || !config.password) throw new Error('Tableau credentials not set in Script Properties');
  if (!config.sheetId) throw new Error('SHEET_ID not set in Script Properties');

  var auth = _tableauSignIn(config);
  try {
    var csv, source;

    if (report.customViewId) {
      try {
        csv = _downloadCustomViewData(config, auth.token, auth.siteId, report.customViewId);
        source = 'customView';
        Logger.log('Custom view download: ' + csv.length + ' chars');
      } catch (cvErr) {
        Logger.log('Custom view failed: ' + cvErr.message + ' — falling back to REST API');
        csv = null;
      }
    }

    if (!csv) {
      var viewInfo = _findView(config, auth.token, auth.siteId, report.viewContentUrl);
      csv = _downloadViewData(config, auth.token, auth.siteId, viewInfo.viewId, report);
      source = 'restApi';
      Logger.log('REST API download: ' + csv.length + ' chars');
    }

    var data = _parseCsv(csv);
    Logger.log('Parsed ' + data.length + ' rows (including header), source: ' + source);

    var filtered;
    if (report.columns) {
      filtered = _filterColumns(data, report.columns);
      Logger.log('Filtered to ' + filtered.headers.length + ' columns, ' + filtered.rows.length + ' rows');
    } else {
      filtered = { headers: data[0], rows: data.slice(1) };
      Logger.log('All columns mode: ' + filtered.headers.length + ' columns, ' + filtered.rows.length + ' rows');
    }

    if (report.deduplicateKey) {
      filtered = _deduplicateRows(filtered, report.deduplicateKey);
    }

    if (report.dateFilterColumn && report.dateRangeDays) {
      filtered = _filterByDateRange(filtered, report.dateFilterColumn, report.dateRangeDays);
    }

    if (report.timeColumns) {
      _formatTimeColumns(filtered, report.timeColumns);
    }

    var result = _writeToSheet(config.sheetId, report.tabName, filtered.headers, filtered.rows);
    Logger.log('Wrote to sheet: ' + JSON.stringify(result));

    return {
      ok: true,
      report: reportKey,
      source: source,
      totalRowsFromTableau: data.length - 1,
      filteredColumns: filtered.headers.length,
      rowsWritten: filtered.rows.length
    };
  } finally {
    _tableauSignOut(config, auth.token);
  }
}

function syncAllReports() {
  var results = [];
  var keys = Object.keys(REPORTS);
  for (var i = 0; i < keys.length; i++) {
    try {
      var result = syncReport(keys[i]);
      results.push(result);
      Logger.log('✓ ' + keys[i] + ': ' + result.rowsWritten + ' rows');
    } catch (e) {
      results.push({ ok: false, report: keys[i], error: e.message });
      Logger.log('✗ ' + keys[i] + ': ' + e.message);
    }
  }
  return results;
}


// === OFFICE DISCOVERY ===

function _getOfficesForCampaign(campaignType) {
  var adminSheetId = PropertiesService.getScriptProperties().getProperty('ADMIN_SHEET_ID');
  if (!adminSheetId) throw new Error('ADMIN_SHEET_ID not set in Script Properties');

  var ss = SpreadsheetApp.openById(adminSheetId);
  var sheet = ss.getSheetByName('_Offices');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('_getOfficesForCampaign: _Offices tab empty or missing');
    return [];
  }

  var data = sheet.getDataRange().getValues();
  // _Offices columns: 0=officeId, 1=name, 2=templateType, 3=sheetId, 4=appsScriptUrl, 5=apiKey, 6=status
  var offices = [];
  for (var i = 1; i < data.length; i++) {
    var templateType  = String(data[i][2] || '').trim();
    var status        = String(data[i][6] || '').trim();
    var officeId      = String(data[i][0] || '').trim();
    var appsScriptUrl = String(data[i][4] || '').trim();
    var apiKey        = String(data[i][5] || '').trim();

    if (templateType !== campaignType) continue;
    if (status !== 'active') continue;
    if (!officeId || !appsScriptUrl) continue;

    var fullUrl = appsScriptUrl.indexOf('https://') === 0
      ? appsScriptUrl
      : 'https://script.google.com/macros/s/' + appsScriptUrl + '/exec';

    offices.push({ officeId: officeId, appsScriptUrl: fullUrl, apiKey: apiKey });
  }

  Logger.log('_getOfficesForCampaign("' + campaignType + '"): ' + offices.length + ' active offices');
  return offices;
}


// === DISTRIBUTE TO OFFICES ===

function distributeToOffices() {
  var config = _getConfig();
  if (!config.sheetId) throw new Error('SHEET_ID not set');
  if (!TARGETS.length) {
    Logger.log('No targets configured — skipping distribution');
    return [];
  }

  var tableauSS = SpreadsheetApp.openById(config.sheetId);
  var results = [];

  for (var t = 0; t < TARGETS.length; t++) {
    var target = TARGETS[t];
    try {
      var srcSheet = tableauSS.getSheetByName(target.sourceTab);
      if (!srcSheet || srcSheet.getLastRow() < 2) {
        Logger.log(target.reportKey + ': no data in "' + target.sourceTab + '" — skipping');
        results.push({ ok: false, reportKey: target.reportKey, error: 'No source data' });
        continue;
      }

      var data    = srcSheet.getDataRange().getValues();
      var headers = data[0];
      var rows    = data.slice(1);

      if (target.filterColumn && target.ownerOfficeMatch) {
        var filterIdx = headers.indexOf(target.filterColumn);
        if (filterIdx === -1) throw new Error('"' + target.filterColumn + '" column not found');
        var match = target.ownerOfficeMatch.toLowerCase();
        rows = rows.filter(function(row) {
          return String(row[filterIdx] || '').toLowerCase().indexOf(match) !== -1;
        });
        Logger.log(target.reportKey + ': filtered to ' + rows.length + ' rows (match: "' + match + '")');
      } else {
        Logger.log(target.reportKey + ': writing all ' + rows.length + ' rows');
      }

      var destSS  = SpreadsheetApp.openById(target.sheetId);
      var destTab = destSS.getSheetByName(target.tabName);
      if (!destTab) destTab = destSS.insertSheet(target.tabName);

      destTab.clearContents();
      if (headers.length > 0) {
        destTab.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
        destTab.setFrozenRows(1);
      }
      if (rows.length > 0) {
        destTab.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }

      Logger.log(target.reportKey + ': wrote ' + rows.length + ' rows → ' + target.tabName);

      var offices = target.campaignType
        ? _getOfficesForCampaign(target.campaignType)
        : (target.offices || []);

      for (var o = 0; o < offices.length; o++) {
        var bustResult = _bustOfficeCache(offices[o]);
        Logger.log('  ' + offices[o].officeId + ': cache bust → ' + bustResult);
      }

      results.push({
        ok: true,
        reportKey: target.reportKey,
        rowsWritten: rows.length,
        officesBusted: offices.map(function(o) { return o.officeId; })
      });
    } catch (e) {
      Logger.log(target.reportKey + ': ERROR — ' + e.message);
      results.push({ ok: false, reportKey: target.reportKey, error: e.message });
    }
  }

  return results;
}

function _bustOfficeCache(office) {
  try {
    var url = office.appsScriptUrl
      + '?key='      + encodeURIComponent(office.apiKey)
      + '&officeId=' + encodeURIComponent(office.officeId)
      + '&action=bustTableauCache';
    var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    return 'HTTP ' + resp.getResponseCode();
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}


// === FULL NIGHTLY PIPELINE ===

function nightlySync() {
  Logger.log('=== NIGHTLY SYNC START ===');
  var syncResults = syncAllReports();
  Logger.log('Sync: ' + JSON.stringify(syncResults));
  var distResults = distributeToOffices();
  Logger.log('Distribute: ' + JSON.stringify(distResults));
  Logger.log('=== NIGHTLY SYNC COMPLETE ===');
  return { sync: syncResults, distribute: distResults };
}


// === DAILY TRIGGER ===

function setupDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'syncAllReports' || fn === 'nightlySync') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('nightlySync')
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .nearMinute(0)
    .create();

  Logger.log('Daily trigger set: nightlySync at ~1:00 AM');
}

function removeDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'syncAllReports' || fn === 'nightlySync') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  Logger.log('Removed ' + removed + ' trigger(s)');
}


// === WEB APP ENDPOINT ===

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'syncAll';
  var key    = (e && e.parameter && e.parameter.key)    || '';

  var apiKey = PropertiesService.getScriptProperties().getProperty('SYNC_API_KEY') || '';
  if (apiKey && key !== apiKey) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid API key' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var result;
  try {
    if (action === 'syncAll') {
      result = syncAllReports();
    } else if (action === 'sync' && e.parameter.report) {
      result = syncReport(e.parameter.report);
    } else if (action === 'listReports') {
      result = { reports: Object.keys(REPORTS) };
    } else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


// === MANUAL TEST FUNCTIONS ===

function testConnection() {
  var config = _getConfig();
  Logger.log('Connecting to: ' + config.server + ' as ' + config.email + ' (site: ' + config.site + ')');
  var auth = _tableauSignIn(config);
  Logger.log('SUCCESS — Token: ' + auth.token.substring(0, 10) + '... | Site ID: ' + auth.siteId);
  _tableauSignOut(config, auth.token);
  Logger.log('Signed out.');
}

function testSyncOrderLog() {
  Logger.log(JSON.stringify(syncReport('b2b-order-log'), null, 2));
}

function testSyncChurn() {
  Logger.log(JSON.stringify(syncReport('b2b-churn'), null, 2));
}

function testSyncAOR() {
  Logger.log(JSON.stringify(syncReport('b2b-aor'), null, 2));
}

function testSyncActivationRates() {
  Logger.log(JSON.stringify(syncReport('b2b-activation-rates'), null, 2));
}

function testDistribute() {
  Logger.log(JSON.stringify(distributeToOffices(), null, 2));
}

/**
 * Print every column header from a report's custom view CSV.
 * Also shows which configured columns matched and which didn't.
 * Usage: change reportKey below and run from the editor.
 */
function logColumnHeaders() {
  var reportKey = 'b2b-aor';  // ← change to any report key to inspect it
  var config = _getConfig();
  var report = REPORTS[reportKey];
  var auth = _tableauSignIn(config);
  try {
    var csv;
    if (report.customViewId) {
      csv = _downloadCustomViewData(config, auth.token, auth.siteId, report.customViewId);
      Logger.log('Source: Custom View ' + report.customViewId);
    } else {
      var viewInfo = _findView(config, auth.token, auth.siteId, report.viewContentUrl);
      csv = _downloadViewData(config, auth.token, auth.siteId, viewInfo.viewId, report);
      Logger.log('Source: REST API');
    }
    var data = _parseCsv(csv);
    var headers = data[0];
    Logger.log('=== ALL ' + headers.length + ' COLUMNS ===');
    for (var i = 0; i < headers.length; i++) {
      Logger.log('[' + i + '] "' + headers[i] + '"');
    }
    if (report.columns) {
      Logger.log('=== COLUMN MATCH CHECK ===');
      for (var c = 0; c < report.columns.length; c++) {
        var found = headers.indexOf(report.columns[c]) !== -1;
        Logger.log((found ? '✓' : '✗') + ' "' + report.columns[c] + '"');
      }
    }
    if (data.length > 1) {
      Logger.log('=== SAMPLE ROW ===');
      for (var j = 0; j < headers.length; j++) {
        Logger.log('  ' + headers[j] + ': "' + String(data[1][j] || '').substring(0, 80) + '"');
      }
    }
  } finally {
    _tableauSignOut(config, auth.token);
  }
}

function listWorkbookViews() {
  var config = _getConfig();
  var auth = _tableauSignIn(config);
  try {
    // Step 1: find the ATTTRACKER-B2B workbook ID
    var wbUrl = config.server + '/api/' + TABLEAU_API_VERSION
      + '/sites/' + auth.siteId + '/workbooks?filter=contentUrl:eq:ATTTRACKER-B2B&pageSize=10';
    var wbResp = UrlFetchApp.fetch(wbUrl, {
      method: 'get',
      headers: { 'X-Tableau-Auth': auth.token, 'Accept': 'application/json' },
      muteHttpExceptions: true
    });
    var wbJson = JSON.parse(wbResp.getContentText());
    var workbooks = (wbJson.workbooks && wbJson.workbooks.workbook) ? wbJson.workbooks.workbook : [];
    if (!workbooks.length) { Logger.log('Workbook ATTTRACKER-B2B not found'); return; }
    var workbookId = workbooks[0].id;
    Logger.log('Workbook: "' + workbooks[0].name + '" id=' + workbookId);

    // Step 2: list all views in that workbook
    var vUrl = config.server + '/api/' + TABLEAU_API_VERSION
      + '/sites/' + auth.siteId + '/workbooks/' + workbookId + '/views';
    var vResp = UrlFetchApp.fetch(vUrl, {
      method: 'get',
      headers: { 'X-Tableau-Auth': auth.token, 'Accept': 'application/json' },
      muteHttpExceptions: true
    });
    var vJson = JSON.parse(vResp.getContentText());
    var views = (vJson.views && vJson.views.view) ? vJson.views.view : [];
    Logger.log('=== ' + views.length + ' VIEWS IN WORKBOOK ===');
    for (var i = 0; i < views.length; i++) {
      Logger.log('[' + i + '] name="' + views[i].name + '" contentUrl="' + views[i].contentUrl + '" id="' + views[i].id + '"');
    }
  } finally {
    _tableauSignOut(config, auth.token);
  }
}

function testActRatesTotalsDownload() {
  var config = _getConfig();
  var auth = _tableauSignIn(config);
  var VIEW_ID = 'd5efaccd-2962-477d-9897-1c7e51252fc6'; // ACTIVATION RATES dashboard
  try {
    var url = config.server + '/api/' + TABLEAU_API_VERSION
      + '/sites/' + auth.siteId + '/views/' + VIEW_ID + '/data';
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'X-Tableau-Auth': auth.token },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    Logger.log('HTTP ' + code);
    if (code !== 200) { Logger.log(resp.getContentText().substring(0, 300)); return; }
    var data = _parseCsv(resp.getContentText());
    Logger.log('Rows: ' + (data.length - 1) + ' | Columns: ' + data[0].length);
    Logger.log('Headers: ' + JSON.stringify(data[0]));
    // log unique Rep values
    var repIdx = data[0].indexOf('Rep');
    var ownerIdx = data[0].indexOf('Owner & Office');
    var repVals = {};
    for (var i = 1; i < Math.min(data.length, 300); i++) {
      var r = data[i][repIdx] || '', o = (data[i][ownerIdx] || '').substring(0, 40);
      repVals[r + ' | ' + o] = true;
    }
    var keys = Object.keys(repVals);
    Logger.log('=== ' + keys.length + ' UNIQUE Rep|Office combos (first 300 rows) ===');
    for (var k = 0; k < keys.length; k++) Logger.log(keys[k]);
  } finally {
    _tableauSignOut(config, auth.token);
  }
}

function testChurnCustomView() {
  var config = _getConfig();
  var auth = _tableauSignIn(config);
  var CUSTOM_VIEW_ID = 'c928f902-8feb-4783-838b-f6df0405a3ed'; // existing b2b-churn custom view
  try {
    Logger.log('Testing custom view: ' + CUSTOM_VIEW_ID);
    var csv = _downloadCustomViewData(config, auth.token, auth.siteId, CUSTOM_VIEW_ID);
    var data = _parseCsv(csv);
    Logger.log('Rows: ' + (data.length - 1) + ' | Columns: ' + data[0].length);
    Logger.log('=== HEADERS ===');
    Logger.log(JSON.stringify(data[0]));
    Logger.log('=== SAMPLE ROWS (first 8) ===');
    for (var i = 1; i <= Math.min(8, data.length - 1); i++) {
      Logger.log('Row ' + i + ': ' + JSON.stringify(data[i]));
    }
  } catch (e) {
    Logger.log('Custom view failed: ' + e.message);
  } finally {
    _tableauSignOut(config, auth.token);
  }
}

function testChurnDownload() {
  var config = _getConfig();
  var auth = _tableauSignIn(config);
  var VIEW_ID = '728d4433-de48-42c8-9bdc-eecd31e79c2a'; // CHURN RATES view
  try {
    var url = config.server + '/api/' + TABLEAU_API_VERSION
      + '/sites/' + auth.siteId + '/views/' + VIEW_ID + '/data';
    Logger.log('Fetching: ' + url);
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'X-Tableau-Auth': auth.token },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    Logger.log('HTTP ' + code);
    if (code !== 200) { Logger.log(resp.getContentText().substring(0, 300)); return; }
    var data = _parseCsv(resp.getContentText());
    Logger.log('Rows: ' + (data.length - 1) + ' | Columns: ' + data[0].length);
    Logger.log('=== HEADERS ===');
    Logger.log(JSON.stringify(data[0]));
    Logger.log('=== SAMPLE ROWS (first 5) ===');
    for (var i = 1; i <= Math.min(5, data.length - 1); i++) {
      var row = {};
      for (var j = 0; j < data[0].length; j++) row[data[0][j]] = data[i][j];
      Logger.log('Row ' + i + ': ' + JSON.stringify(row));
    }
    // Unique values in each column (to understand structure)
    Logger.log('=== UNIQUE VALUES PER COLUMN (up to 10 each) ===');
    for (var c = 0; c < data[0].length; c++) {
      var seen = {}, vals = [];
      for (var r = 1; r < data.length; r++) {
        var v = String(data[r][c] || '').trim();
        if (v && !seen[v]) { seen[v] = true; vals.push(v); }
        if (vals.length >= 10) break;
      }
      Logger.log('"' + data[0][c] + '": [' + vals.join(', ') + ']');
    }
  } finally {
    _tableauSignOut(config, auth.token);
  }
}

function listUniqueOwnerOffice() {
  var config = _getConfig();
  var ss = SpreadsheetApp.openById(config.sheetId);
  var sheet = ss.getSheetByName('B2B Order Log');
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('No data in B2B Order Log'); return; }
  var data = sheet.getDataRange().getValues();
  var idx = data[0].indexOf('Owner & Office');
  if (idx === -1) { Logger.log('"Owner & Office" column not found'); return; }
  var unique = {};
  for (var r = 1; r < data.length; r++) {
    var val = String(data[r][idx] || '').trim();
    if (val) unique[val] = (unique[val] || 0) + 1;
  }
  var keys = Object.keys(unique).sort();
  Logger.log('=== ' + keys.length + ' UNIQUE "Owner & Office" VALUES ===');
  for (var i = 0; i < keys.length; i++) {
    Logger.log('[' + i + '] "' + keys[i] + '" (' + unique[keys[i]] + ' rows)');
  }
}
