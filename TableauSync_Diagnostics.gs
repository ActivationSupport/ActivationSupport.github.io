// ============================================================================
// TableauSync — DIAGNOSTICS / MANUAL TEST FUNCTIONS
// ----------------------------------------------------------------------------
// Second file of the standalone TableauSync Apps Script project. Contains only
// manual/diagnostic helpers (run by hand from the editor). NONE of these are
// called by the scheduled triggers. Shares global scope with TableauSync.gs, so
// it freely calls _tableauSignIn/_getConfig/REPORTS/etc. defined there.
// ============================================================================

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

// Read-only: report how fresh the Tableau data is + the extract-refresh schedule.
// Run from the editor, then read Executions/Logs. Shows (1) the ATTTRACKER-B2B
// workbook's last-updated time, (2) each published data source's last-updated
// time (the best "last refreshed" signal a non-admin can see), and (3) the
// extract-refresh task schedule/frequency if the account has permission to list it.
function checkTableauRefresh() {
  var config = _getConfig();
  var auth = _tableauSignIn(config);
  try {
    // (1) Workbook updatedAt
    var wbUrl = config.server + '/api/' + TABLEAU_API_VERSION
      + '/sites/' + auth.siteId + '/workbooks?filter=contentUrl:eq:ATTTRACKER-B2B&pageSize=10';
    var wbResp = UrlFetchApp.fetch(wbUrl, { method:'get', headers:{ 'X-Tableau-Auth':auth.token, 'Accept':'application/json' }, muteHttpExceptions:true });
    if (wbResp.getResponseCode() === 200) {
      var wbs = (JSON.parse(wbResp.getContentText()).workbooks || {}).workbook || [];
      if (wbs.length) Logger.log('WORKBOOK "' + wbs[0].name + '": updatedAt=' + wbs[0].updatedAt);
      else Logger.log('WORKBOOK ATTTRACKER-B2B not found via filter.');
    } else {
      Logger.log('Workbook query HTTP ' + wbResp.getResponseCode() + ': ' + wbResp.getContentText().substring(0,200));
    }

    // (2) Data source updatedAt (last refresh signal)
    var dsResp = UrlFetchApp.fetch(config.server + '/api/' + TABLEAU_API_VERSION + '/sites/' + auth.siteId + '/datasources?pageSize=200',
      { method:'get', headers:{ 'X-Tableau-Auth':auth.token, 'Accept':'application/json' }, muteHttpExceptions:true });
    if (dsResp.getResponseCode() === 200) {
      var dss = (JSON.parse(dsResp.getContentText()).datasources || {}).datasource || [];
      Logger.log('=== ' + dss.length + ' DATA SOURCE(S) — updatedAt (most recent = last refresh) ===');
      dss.sort(function(a,b){ return String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')); })
         .slice(0,15).forEach(function(d){ Logger.log('  "' + d.name + '": ' + d.updatedAt); });
    } else {
      Logger.log('Datasources query HTTP ' + dsResp.getResponseCode());
    }

    // (3) Extract refresh tasks (the actual schedule — usually needs site-admin)
    var tResp = UrlFetchApp.fetch(config.server + '/api/' + TABLEAU_API_VERSION + '/sites/' + auth.siteId + '/tasks/extractRefreshes',
      { method:'get', headers:{ 'X-Tableau-Auth':auth.token, 'Accept':'application/json' }, muteHttpExceptions:true });
    Logger.log('=== EXTRACT REFRESH TASKS — HTTP ' + tResp.getResponseCode() + ' ===');
    if (tResp.getResponseCode() === 200) {
      var tasks = (JSON.parse(tResp.getContentText()).tasks || {}).task || [];
      Logger.log(tasks.length + ' task(s):');
      tasks.forEach(function(t, i) {
        var er = t.extractRefresh || {}, sc = er.schedule || {};
        var tgt = er.workbook ? ('wb:' + (er.workbook.name||er.workbook.id)) : er.datasource ? ('ds:' + (er.datasource.name||er.datasource.id)) : '?';
        Logger.log('  [' + i + '] ' + tgt + ' | frequency=' + (sc.frequency || er.frequency || '?') + ' | nextRunAt=' + (sc.nextRunAt || er.nextRunAt || '?'));
      });
      Logger.log('RAW (first 1500 chars): ' + tResp.getContentText().substring(0,1500));
    } else {
      Logger.log('(Likely needs a site-admin account to list refresh tasks.) Body: ' + tResp.getContentText().substring(0,300));
    }
  } finally {
    _tableauSignOut(config, auth.token);
  }
}

// Read-only: dump the Activation Rates view's columns, the EXACT name of any
// color column, and the distinct values it contains (+ sample rows). This tells
// us precisely how Tableau encodes the cell colors so we can mirror them in the
// portal without guessing. Run from the editor, then read the Logs.
function dumpActivationColorValues() {
  var config = _getConfig();
  var report = REPORTS['b2b-activation-rates'];
  var auth = _tableauSignIn(config);
  try {
    var csv = _downloadCustomViewData(config, auth.token, auth.siteId, report.customViewId);
    var data = _parseCsv(csv);
    var headers = data[0];
    Logger.log('=== ' + headers.length + ' COLUMNS ===');
    for (var i = 0; i < headers.length; i++) Logger.log('[' + i + '] "' + headers[i] + '"');

    var colorCols = [];
    for (var c = 0; c < headers.length; c++) {
      if (String(headers[c]).toLowerCase().indexOf('color') !== -1) colorCols.push(c);
    }
    Logger.log('=== COLOR COLUMN(S) FOUND: ' + (colorCols.length ? colorCols.map(function(c){return '"'+headers[c]+'"';}).join(', ') : 'NONE') + ' ===');
    colorCols.forEach(function(c) {
      var counts = {};
      for (var r = 1; r < data.length; r++) {
        var v = String(data[r][c] || '').trim();
        counts[v] = (counts[v] || 0) + 1;
      }
      Logger.log('  "' + headers[c] + '" distinct values:');
      Object.keys(counts).forEach(function(v){ Logger.log('    "' + v + '" x' + counts[v]); });
    });

    var repIdx = headers.indexOf('Rep'), bktIdx = headers.indexOf('Activation Bucket');
    Logger.log('=== SAMPLE ROWS (first 8) ===');
    for (var s = 1; s <= Math.min(8, data.length - 1); s++) {
      var parts = ['rep=' + (data[s][repIdx] || ''), 'bucket=' + (data[s][bktIdx] || '')];
      colorCols.forEach(function(c){ parts.push('"' + headers[c] + '"=' + (data[s][c] || '')); });
      Logger.log('  ' + parts.join(' | '));
    }
  } finally {
    _tableauSignOut(config, auth.token);
  }
}

// Read-only: dump the Churn view's columns, every color column + its distinct
// values, and sample rows (rep | bucket | rate | color). Tells us whether the
// per-bucket color is one column or several, and exactly what values it holds —
// so we can mirror Tableau's churn colors precisely.
function dumpChurnColorValues() {
  var config = _getConfig();
  var report = REPORTS['b2b-churn'];
  var auth = _tableauSignIn(config);
  try {
    var csv = _downloadCustomViewData(config, auth.token, auth.siteId, report.customViewId);
    var data = _parseCsv(csv);
    var raw = data[0];
    var headers = raw.map(function(h){ return String(h).trim(); });   // headers have trailing spaces
    Logger.log('=== ' + headers.length + ' COLUMNS (trimmed) ===');
    for (var i = 0; i < headers.length; i++) Logger.log('[' + i + '] "' + headers[i] + '"  (raw: "' + raw[i] + '")');

    var colorCols = [];
    for (var c = 0; c < headers.length; c++) if (headers[c].toLowerCase().indexOf('color') !== -1) colorCols.push(c);
    var repIdx = headers.indexOf('Rep'), bktIdx = headers.indexOf('Churn Buckets'), rateIdx = headers.indexOf('Churn Rate');
    Logger.log('indices -> rep=' + repIdx + ' bucket=' + bktIdx + ' rate=' + rateIdx + ' color=' + JSON.stringify(colorCols));

    var bkc = {};
    for (var r = 1; r < data.length; r++) { var bv = String(data[r][bktIdx] || '').trim(); bkc[bv] = (bkc[bv] || 0) + 1; }
    Logger.log('=== "Churn Buckets" DISTINCT VALUES ===');
    Object.keys(bkc).forEach(function(v){ Logger.log('  "' + v + '" x' + bkc[v]); });

    colorCols.forEach(function(c) {
      var cc = {}; for (var r = 1; r < data.length; r++) { var v = String(data[r][c] || '').trim(); cc[v] = (cc[v] || 0) + 1; }
      Logger.log('=== COLOR "' + headers[c] + '" DISTINCT VALUES ===');
      Object.keys(cc).forEach(function(v){ Logger.log('  "' + v + '" x' + cc[v]); });
    });

    // THE key check: for a few reps, list every bucket row with its rate + color.
    // If the color is identical across a rep's buckets, the "30-60" column is a
    // single color (wrong per-bucket); if it varies, it's correct per bucket.
    var byRep = {};
    for (var r = 1; r < data.length; r++) {
      var rp = String(data[r][repIdx] || '').trim(); if (!rp) continue;
      (byRep[rp] = byRep[rp] || []).push({
        bucket: String(data[r][bktIdx] || '').trim(),
        rate:   String(data[r][rateIdx] || '').trim(),
        color:  colorCols.length ? String(data[r][colorCols[0]] || '').trim() : ''
      });
    }
    var reps = Object.keys(byRep).filter(function(rp){ return byRep[rp].length > 1; }).slice(0, 4);
    Logger.log('=== PER-REP (bucket | rate | color) — does color vary by bucket? ===');
    reps.forEach(function(rp) {
      Logger.log('REP: ' + rp);
      byRep[rp].forEach(function(x){ Logger.log('   bucket="' + x.bucket + '" rate=' + x.rate + ' color="' + x.color + '"'); });
    });
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
