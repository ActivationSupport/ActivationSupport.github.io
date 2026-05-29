/**
 * Daily Call List Tracker - Google Apps Script
 * --------------------------------------------
 * Live tracker that merges a raw 30-day "Activation Oppt Order Log" pull
 * into your call tracker, preserving Notes you've written and updating
 * Status as the carrier data changes.
 *
 * Daily flow (option A): click "Import CSV & Build", select the file, done.
 * Daily flow (option B): paste CSV into Raw Import tab, click "Build / Refresh".
 */

// --- Config --------------------------------------------------------------- //
const RAW_TAB       = "Raw Import";
const MASTER_TAB    = "Master Tracker";
const DAY_AFTER_TAB = "Day-After Orders";
const DELIVERED_TAB = "Delivered Not Activated";
const ISSUES_TAB    = "Order Issues";
const SUMMARY_TAB   = "Summary";
const ESCALATIONS_TAB = "Escalations";
const REPORT_TAB    = "Daily Report";
const REP_CHURN_TAB      = "_Rep Churn Data";
const REP_ACTIVATION_TAB = "_Rep Activation Data";
const REP_ACTIVATION_VIEW_TAB = "Rep Activation";
const REP_CHURN_VIEW_TAB      = "Rep Churn";

// Customer experience ratings
const RATINGS = [
  "⭐⭐⭐⭐⭐ Excellent",
  "⭐⭐⭐⭐ Good",
  "⭐⭐⭐ OK",
  "⭐⭐ Poor",
  "⭐ Bad"
];
const ESCALATION_RATINGS = ["⭐⭐ Poor", "⭐ Bad"];
const RATING_COLORS = {
  "⭐⭐⭐⭐⭐ Excellent": {bg:"#C6EFCE", fg:"#1E5631"},
  "⭐⭐⭐⭐ Good":            {bg:"#E2EFDA", fg:"#385723"},
  "⭐⭐⭐ OK":                    {bg:"#FFF2CC", fg:"#7F6000"},
  "⭐⭐ Poor":                        {bg:"#FCE4D6", fg:"#9C0006"},
  "⭐ Bad":                               {bg:"#F4CCCC", fg:"#660000"}
};

const HEADERS = [
  "Activation Bucket", "Order Date", "Rep", "Customer Name", "SPM Number",
  "Product Type", "Status", "Lines In Status", "Affected Statuses",
  "Ship Date", "Current Due Date", "Notes", "Rating", "Last Seen", "Note Updated"
];

const RAW_COLS = {
  bucket:   "Activation Bucket",
  order:    "sp.Order Date (copy)",
  rep:      "Rep",
  customer: "Customer Name",
  spm:      "sp.SPM Number",
  product:  "Product Type (Broken out lvl 2)",
  status:   "spe.Status",
  ship:     "Ship Date (SP)",
  due:      "SPE.DTR Current Due Date (date)"
};

const PORTING_RELATED = ["Porting Issue","Pending Order Port","Port Approved","Pending Shipment","Pending"];
const BUCKET_ORDER = {"0-7 Days":0,"8-14 Days":1,"15-30 Days":2,"31-60 Days":3};

// --- Menu ----------------------------------------------------------------- //
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Call List")
    .addItem("Import CSV & Build (recommended)", "showImportDialog")
    .addItem("Build / Refresh (after manual paste)", "buildCallListAlerted")
    .addSeparator()
    .addItem("Refresh Daily Report (end of day)", "refreshDailyReport")
    .addSeparator()
    .addItem("Import Rep Churn CSV...",        "showChurnImportDialog")
    .addItem("Import Activation Office CSV...", "showActivationImportDialog")
    .addSeparator()
    .addItem("First-Time Setup", "firstTimeSetup")
    .addToUi();
}

// --- onEdit trigger: instant escalation ---------------------------------- //
// Fires on every user edit. When a Rating cell is set to Poor or Bad on any
// tracker tab, copies that row to the Escalations tab immediately.
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const watched = [MASTER_TAB, DAY_AFTER_TAB, DELIVERED_TAB, ISSUES_TAB, ESCALATIONS_TAB];
    if (watched.indexOf(sheetName) < 0) return;

    const allData = sheet.getDataRange().getValues();
    const hIdx = findHeaderRowIdx(allData);
    if (hIdx < 0) return;
    const headerRow = allData[hIdx].map(String);
    const editedRow = e.range.getRow();
    const editedCol = e.range.getColumn();
    if (editedRow <= hIdx + 1) return;

    const noteCol         = headerRow.indexOf("Notes") + 1;
    const ratingCol       = headerRow.indexOf("Rating") + 1;
    const noteUpdatedCol  = headerRow.indexOf("Note Updated") + 1;

    // ----- Notes edit: stamp Note Updated with current timestamp -----
    if (noteCol > 0 && editedCol === noteCol && noteUpdatedCol > 0) {
      sheet.getRange(editedRow, noteUpdatedCol).setValue(new Date())
        .setNumberFormat("m/d/yyyy h:mm am/pm");
    }

    // ----- Rating edit: push to Escalations tab if Poor/Bad -----
    if (ratingCol > 0 && editedCol === ratingCol) {
      const newValue = String(e.range.getValue() || "").trim();
      if (ESCALATION_RATINGS.indexOf(newValue) < 0) return;
      const rowValues = sheet.getRange(editedRow, 1, 1, headerRow.length).getValues()[0];
      const rowObj = {};
      for (let i = 0; i < headerRow.length; i++) rowObj[headerRow[i]] = rowValues[i];
      rowObj["Rating"] = newValue;
      addOrUpdateInEscalations(rowObj);
    }
  } catch (err) {
    console.log("onEdit error: " + (err && err.message));
  }
}

// Add a row to the Escalations tab, or update if customer+SPM already there.
function addOrUpdateInEscalations(rowObj) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ESCALATIONS_TAB);
  if (!sh) {
    sh = ss.insertSheet(ESCALATIONS_TAB);
    // Banner row 1
    sh.getRange(1, 1, 1, HEADERS.length).merge();
    sh.getRange(1, 1).setValue("Escalations  |  customers rated Poor / Bad")
      .setBackground("#7030A0").setFontColor("#FFFFFF").setFontWeight("bold")
      .setFontSize(13).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sh.setRowHeight(1, 32);
    // Header row 2
    sh.getRange(2, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF")
      .setHorizontalAlignment("center");
    sh.setRowHeight(2, 36);
    sh.setFrozenRows(2);
    for (let i = 0; i < HEADERS.length; i++) sh.setColumnWidth(i+1, COL_WIDTHS_PX[i] || 110);
  }

  const data = sh.getDataRange().getValues();
  const hIdx = findHeaderRowIdx(data);
  if (hIdx < 0) return;
  const headerRow = data[hIdx].map(String);
  const custIdx = headerRow.indexOf("Customer Name");
  const spmIdx  = headerRow.indexOf("SPM Number");
  const ratingIdx = headerRow.indexOf("Rating");
  if (custIdx < 0 || spmIdx < 0) return;

  const cust = String(rowObj["Customer Name"] || "").trim();
  const spm  = String(rowObj["SPM Number"] || "").trim();
  if (!cust || !spm) return;

  // Find existing row for this customer
  let existingRowIdx = -1;
  for (let i = hIdx + 1; i < data.length; i++) {
    if (String(data[i][custIdx] || "").trim() === cust &&
        String(data[i][spmIdx]  || "").trim() === spm) {
      existingRowIdx = i;
      break;
    }
  }

  const newRow = HEADERS.map(function(h){
    const v = rowObj[h];
    return (v === undefined || v === null) ? "" : v;
  });

  if (existingRowIdx >= 0) {
    sh.getRange(existingRowIdx + 1, 1, 1, HEADERS.length).setValues([newRow]);
  } else {
    const targetRow = Math.max(sh.getLastRow() + 1, hIdx + 2);
    sh.getRange(targetRow, 1, 1, HEADERS.length).setValues([newRow]);
    // Apply Rating dropdown to the new row so user can change it from there
    const ratingValidation = SpreadsheetApp.newDataValidation()
      .requireValueInList(RATINGS, true).setAllowInvalid(true).build();
    sh.getRange(targetRow, HEADERS.indexOf("Rating") + 1).setDataValidation(ratingValidation);
  }
}

// --- One-click import dialog ---------------------------------------------- //
function showImportDialog() {
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:18px;">' +
      '<h3 style="margin-top:0;">Upload Raw CSV</h3>' +
      '<p style="color:#555;font-size:13px;">Pick the daily 30-day pull. UTF-16 tab-delimited (the standard export) is auto-handled.</p>' +
      '<input type="file" id="file" accept=".csv,.txt,.tsv" />' +
      '<p id="status" style="color:#1F4E78;font-weight:bold;min-height:18px;margin:14px 0;"></p>' +
      '<button id="go" style="background:#1F4E78;color:#fff;border:none;padding:10px 18px;border-radius:4px;cursor:pointer;font-size:14px;">Import & Build</button>' +
      '<button onclick="google.script.host.close()" style="margin-left:8px;padding:10px 14px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;">Cancel</button>' +
      '<script>' +
        'document.getElementById("go").addEventListener("click", function(){' +
          'var f = document.getElementById("file").files[0];' +
          'if (!f) { document.getElementById("status").textContent = "Pick a file first."; return; }' +
          'document.getElementById("go").disabled = true;' +
          'document.getElementById("status").textContent = "Reading file...";' +
          'var reader = new FileReader();' +
          'reader.onload = function(e){' +
            'var text = e.target.result;' +
            'if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);' +
            'document.getElementById("status").textContent = "Processing in Sheets... (this can take 10-20s)";' +
            'google.script.run' +
              '.withSuccessHandler(function(msg){' +
                'document.getElementById("status").textContent = msg;' +
                'setTimeout(function(){ google.script.host.close(); }, 2500);' +
              '})' +
              '.withFailureHandler(function(err){' +
                'document.getElementById("status").textContent = "Error: " + err.message;' +
                'document.getElementById("go").disabled = false;' +
              '})' +
              '.processUploadedCsv(text);' +
          '};' +
          'reader.onerror = function(){ document.getElementById("status").textContent = "Could not read file."; };' +
          'reader.readAsText(f, "UTF-16");' +
        '});' +
      '</script>' +
    '</div>'
  ).setWidth(440).setHeight(260);
  SpreadsheetApp.getUi().showModalDialog(html, "Import Raw CSV");
}

// Rep Churn CSV import dialog
function showChurnImportDialog() {
  _showRepImportDialog("Import Rep Churn CSV", "processRepChurnCsv");
}
function showActivationImportDialog() {
  _showRepImportDialog("Import Activation Office CSV", "processRepActivationCsv");
}
function _showRepImportDialog(title, handler) {
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:18px;">' +
      '<h3 style="margin-top:0;">' + title + '</h3>' +
      '<p style="color:#555;font-size:13px;">Pick the CSV. UTF-16 tab-delimited supported.</p>' +
      '<input type="file" id="file" accept=".csv,.txt,.tsv" />' +
      '<p id="status" style="color:#1F4E78;font-weight:bold;min-height:18px;margin:14px 0;"></p>' +
      '<button id="go" style="background:#1F4E78;color:#fff;border:none;padding:10px 18px;border-radius:4px;cursor:pointer;font-size:14px;">Import</button>' +
      '<button onclick="google.script.host.close()" style="margin-left:8px;padding:10px 14px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;">Cancel</button>' +
      '<script>' +
        'var H = "' + handler + '";' +
        'document.getElementById("go").addEventListener("click", function(){' +
          'var f = document.getElementById("file").files[0];' +
          'if (!f) { document.getElementById("status").textContent = "Pick a file first."; return; }' +
          'document.getElementById("go").disabled = true;' +
          'document.getElementById("status").textContent = "Reading file...";' +
          'var reader = new FileReader();' +
          'reader.onload = function(e){' +
            'var text = e.target.result;' +
            'if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);' +
            'document.getElementById("status").textContent = "Processing...";' +
            'google.script.run' +
              '.withSuccessHandler(function(msg){ document.getElementById("status").textContent = msg; setTimeout(function(){ google.script.host.close(); }, 2000); })' +
              '.withFailureHandler(function(err){ document.getElementById("status").textContent = "Error: " + err.message; document.getElementById("go").disabled = false; })' +
              '[H](text);' +
          '};' +
          'reader.readAsText(f, "UTF-16");' +
        '});' +
      '</script>' +
    '</div>'
  ).setWidth(440).setHeight(240);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

// Parse the Rep Churn CSV. Each rep gets per-period data: percentage,
// color (per-cell from raw), Disconnect count (SPE/SP), Activated SPE/SP.
// Cell ratio is rendered as Disconnects/Activated.
function processRepChurnCsv(text) {
  const ss = SpreadsheetApp.getActive();
  const sample = text.substring(0, 500);
  const delim = sample.indexOf("\	") >= 0 ? "\	" : ",";
  const matrix = parseDelimitedText(text, delim);
  if (matrix.length < 2) throw new Error("File has no data rows.");

  const header = matrix[0].map(String);
  // Column 5+ are the period columns (0-30 Day, 30 Day, 60 Day, 90 Day, ...)
  const periodCols = [];
  for (let i = 4; i < header.length; i++) {
    if (String(header[i] || "").trim()) periodCols.push({idx: i, label: String(header[i]).trim()});
  }

  // {rep: {period: {pct, color, disc, act}}}
  const repData = {};

  const totals = {};
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const repFull = String(row[0] || "").replace(/\r/g, " ").trim();
    const repShort = String(row[1] || "").trim();
    const color = String(row[2] || "").trim();
    const metric = String(row[3] || "").trim();
    const isTotal = (repFull === "Grand Total" || repShort === "Total");
    if (!isTotal && (!repFull || !repShort)) continue;

    if (isTotal) {
      periodCols.forEach(function(p){
        const v = String(row[p.idx] || "").trim();
        if (!v) return;
        if (!totals[p.label]) totals[p.label] = {};
        if (metric === "Churn Rate") totals[p.label].pct = v;
        else if (metric === "Disconnect count (SPE/SP)") totals[p.label].disc = v;
        else if (metric === "Activated SPE/SP") totals[p.label].act = v;
      });
      continue;
    }

    if (!repData[repShort]) repData[repShort] = {};
    periodCols.forEach(function(p){
      const v = String(row[p.idx] || "").trim();
      if (!v) return;
      if (!repData[repShort][p.label]) repData[repShort][p.label] = {};
      const cell = repData[repShort][p.label];
      if (metric === "Churn Rate") {
        cell.pct = v;
        if (color) cell.color = color;
      } else if (metric === "Disconnect count (SPE/SP)") {
        cell.disc = v;
      } else if (metric === "Activated SPE/SP") {
        cell.act = v;
      }
    });
  }

  let sh = ss.getSheetByName(REP_CHURN_TAB);
  if (!sh) sh = ss.insertSheet(REP_CHURN_TAB);
  sh.clear();
  // 3 columns per period: % / Color / Ratio (Disconnects/Activated)
  const headerRow = ["Rep"];
  periodCols.forEach(function(p){
    headerRow.push(p.label + " %", p.label + " Color", p.label + " Ratio");
  });
  const cleanNum = function(s){ return s ? String(s).replace(/\.0$/, "") : ""; };
  const totalRow = ["_OFFICE_TOTAL"];
  periodCols.forEach(function(p){
    const t = totals[p.label] || {};
    totalRow.push(t.pct || "");
    totalRow.push("");
    const ratio = (t.disc != null && t.act != null) ? (cleanNum(t.disc) + "/" + cleanNum(t.act)) : "";
    totalRow.push(ratio);
  });
  const dataRows = [totalRow].concat(Object.keys(repData).sort().map(function(rep){
    const out = [rep];
    periodCols.forEach(function(p){
      const c = repData[rep][p.label] || {};
      out.push(c.pct || "");
      out.push(c.color || "");
      const ratio = (c.disc != null && c.act != null) ? (cleanNum(c.disc) + "/" + cleanNum(c.act)) : "";
      out.push(ratio);
    });
    return out;
  }));
  if (dataRows.length <= 1) throw new Error("No Churn Rate rows found.");
  sh.getRange(1, 1, dataRows.length + 1, headerRow.length).setNumberFormat("@");
  sh.getRange(1, 1, 1, headerRow.length).setValues([headerRow])
    .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF");
  sh.getRange(2, 1, dataRows.length, headerRow.length).setValues(dataRows);
  try { sh.hideSheet(); } catch(e) {}
  rebuildRepStatTabs(ss);
  return "Imported churn data for " + dataRows.length + " reps.";
}

// Parse the Activation Office CSV. Each rep gets per-period data:
// percentage, color (per-cell from raw), Total Activations, Total Volume.
function processRepActivationCsv(text) {
  const ss = SpreadsheetApp.getActive();
  const sample = text.substring(0, 500);
  const delim = sample.indexOf("\	") >= 0 ? "\	" : ",";
  const matrix = parseDelimitedText(text, delim);
  if (matrix.length < 2) throw new Error("File has no data rows.");

  const header = matrix[0].map(String);
  // Column 5+ are the period columns (0-7 Days, 8-14 Days, 15-30 Days, 31-60 Days)
  const periodCols = [];
  for (let i = 5; i < header.length; i++) {
    if (String(header[i] || "").trim()) periodCols.push({idx: i, label: String(header[i]).trim()});
  }

  // {rep: {period: {pct, color, act, vol}}}
  const repData = {};

  const totals = {};
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const owner = String(row[0] || "").replace(/\r/g, " ").trim();
    const repShort = String(row[1] || "").trim();
    const color = String(row[2] || "").trim();
    const metric = String(row[4] || "").trim();
    const isTotal = (owner === "Grand Total" || repShort === "Total");
    if (!isTotal && (!owner || !repShort)) continue;

    if (isTotal) {
      periodCols.forEach(function(p){
        const v = String(row[p.idx] || "").trim();
        if (!v) return;
        if (!totals[p.label]) totals[p.label] = {};
        if (metric === "Activation %") totals[p.label].pct = v;
        else if (metric === "Total Activations") totals[p.label].act = v;
        else if (metric === "Total Volume") totals[p.label].vol = v;
      });
      continue;
    }

    if (!repData[repShort]) repData[repShort] = {};
    periodCols.forEach(function(p){
      const v = String(row[p.idx] || "").trim();
      if (!v) return;
      if (!repData[repShort][p.label]) repData[repShort][p.label] = {};
      const cell = repData[repShort][p.label];
      if (metric === "Activation %") {
        cell.pct = v;
        if (color) cell.color = color;
      } else if (metric === "Total Activations") {
        cell.act = v;
      } else if (metric === "Total Volume") {
        cell.vol = v;
      }
    });
  }

  // Build the helper tab: 3 columns per period (% / Color / Ratio)
  let sh = ss.getSheetByName(REP_ACTIVATION_TAB);
  if (!sh) sh = ss.insertSheet(REP_ACTIVATION_TAB);
  sh.clear();
  const headerRow = ["Rep"];
  periodCols.forEach(function(p){
    headerRow.push(p.label + " %", p.label + " Color", p.label + " Ratio");
  });
  const totalRow = ["_OFFICE_TOTAL"];
  periodCols.forEach(function(p){
    const t = totals[p.label] || {};
    totalRow.push(t.pct || "");
    totalRow.push("");
    totalRow.push((t.act != null && t.vol != null) ? (t.act + "/" + t.vol) : "");
  });
  const dataRows = [totalRow].concat(Object.keys(repData).sort().map(function(rep){
    const out = [rep];
    periodCols.forEach(function(p){
      const c = repData[rep][p.label] || {};
      out.push(c.pct || "");
      out.push(c.color || "");
      out.push((c.act != null && c.vol != null) ? (c.act + "/" + c.vol) : "");
    });
    return out;
  }));
  if (dataRows.length <= 1) throw new Error("No Activation % rows found.");
  // Force text format BEFORE writing so "14/14" doesn\'t become a Date and "75%" doesn\'t become 0.75
  sh.getRange(1, 1, dataRows.length + 1, headerRow.length).setNumberFormat("@");
  sh.getRange(1, 1, 1, headerRow.length).setValues([headerRow])
    .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF");
  sh.getRange(2, 1, dataRows.length, headerRow.length).setValues(dataRows);
  try { sh.hideSheet(); } catch(e) {}
  rebuildRepStatTabs(ss);
  return "Imported activation data for " + dataRows.length + " reps.";
}

// Coerce a sheet cell value back to a "X/Y" ratio string. If Sheets stored
// it as a Date (e.g. "1/2" became Jan 2), reconstruct from month/day.
function _coerceRatio(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    return (v.getMonth() + 1) + "/" + v.getDate();
  }
  return String(v).trim();
}

// Coerce a sheet cell value back to a percentage string. If Sheets converted
// "75%" to 0.75 (a number), turn it back into "75%".
function _coercePct(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") {
    // Sheets converts "75%" to 0.75, so multiply back. Round to nearest int.
    return Math.round(v * 100) + "%";
  }
  return String(v).trim();
}

// Read the Activation helper tab into a rich structure with per-cell pct/color/ratio.
// Returns {data: {rep: {period: {pct, color, ratio}}}, periods: [...]}.
// Periods we don\'t want to show in the Daily Report or Rep Churn stat tab
const CHURN_HIDDEN_PERIODS = ["210 Day", "240 Day", "270 Day"];

// Daily Report shows only this many of the worst reps in each rep section.
// Full sortable tables live on the "Rep Activation" and "Rep Churn" tabs.
const TOP_WORST_N = 5;

function readChurnTab(ss) {
  const sh = ss.getSheetByName(REP_CHURN_TAB);
  if (!sh) return {data: {}, periods: []};
  const all = sh.getDataRange().getValues();
  if (all.length < 2) return {data: {}, periods: []};
  const header = all[0].map(String);
  const periods = [];
  const idxMap = {};
  for (let i = 1; i < header.length; i++) {
    const h = header[i];
    if (h.length > 2 && h.substr(h.length - 2) === " %") {
      const label = h.substr(0, h.length - 2);
      if (CHURN_HIDDEN_PERIODS.indexOf(label) >= 0) continue;
      periods.push(label);
      idxMap[label] = {pct: i};
    } else if (h.length > 6 && h.substr(h.length - 6) === " Color") {
      const label = h.substr(0, h.length - 6);
      if (idxMap[label]) idxMap[label].color = i;
    } else if (h.length > 6 && h.substr(h.length - 6) === " Ratio") {
      const label = h.substr(0, h.length - 6);
      if (idxMap[label]) idxMap[label].ratio = i;
    }
  }
  const data = {};
  let total = null;
  for (let i = 1; i < all.length; i++) {
    const rep = String(all[i][0] || "").trim();
    if (!rep) continue;
    const cells = {};
    periods.forEach(function(p){
      const idx = idxMap[p];
      const rawPct   = idx.pct   != null ? all[i][idx.pct]   : "";
      const rawColor = idx.color != null ? all[i][idx.color] : "";
      const rawRatio = idx.ratio != null ? all[i][idx.ratio] : "";
      cells[p] = {
        pct:   _coercePct(rawPct),
        color: String(rawColor || "").trim(),
        ratio: _coerceRatio(rawRatio)
      };
    });
    if (rep === "_OFFICE_TOTAL") total = cells;
    else data[rep] = cells;
  }
  return {data: data, periods: periods, total: total};
}

function writeRepStatTab(ss, tabName, bannerText, bannerColor, richReader, defaultSortPeriod) {
  const data = richReader(ss);
  if (data.periods.length === 0) {
    const sh0 = ss.getSheetByName(tabName);
    if (sh0) sh0.clear();
    return;
  }
  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  sh.clear();
  try { sh.getBandings().forEach(function(b){ b.remove(); }); } catch(e) {}
  try { if (sh.getFilter()) sh.getFilter().remove(); } catch(e) {}
  try { sh.getRange(1, 1, sh.getMaxRows(), Math.max(sh.getMaxColumns(), 1)).breakApart(); } catch(e) {}
  try { sh.clearConditionalFormatRules(); } catch(e) {}
  try { sh.clearNotes(); } catch(e) {}

  const totalCols = data.periods.length + 1;

  sh.getRange(1, 1, 1, totalCols).merge();
  sh.getRange(1, 1).setValue(bannerText)
    .setFontWeight("bold").setFontSize(13).setBackground(bannerColor)
    .setFontColor("#FFFFFF").setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(1, 32);

  const header = ["Rep"].concat(data.periods);
  sh.getRange(2, 1, 1, totalCols).setValues([header])
    .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center").setFontSize(11);
  sh.setRowHeight(2, 36);
  sh.setFrozenRows(2);

  const reps = Object.keys(data.data);
  reps.sort(function(a, b){
    const av = (data.data[a][defaultSortPeriod] || {}).pct || "";
    const bv = (data.data[b][defaultSortPeriod] || {}).pct || "";
    const an = av ? parseFloat(av.replace(/[^0-9.\-]/g, "")) : NaN;
    const bn = bv ? parseFloat(bv.replace(/[^0-9.\-]/g, "")) : NaN;
    if (isNaN(an) && isNaN(bn)) return cmp(a, b);
    if (isNaN(an)) return 1;
    if (isNaN(bn)) return -1;
    return bn - an;
  });

  if (reps.length === 0 && !data.total) return;

  const colorMap = {
    "Green":  {bg: "#C6EFCE", fg: "#1E5631"},
    "Yellow": {bg: "#FFF2CC", fg: "#7F6000"},
    "Red":    {bg: "#FCE4D6", fg: "#9C0006"}
  };

  // Office total row (if present) goes first, styled distinctly
  let bodyStart = 3;
  if (data.total) {
    const tValRow = ["OFFICE TOTAL"];
    const tNoteRow = [""];
    data.periods.forEach(function(p){
      const tc = data.total[p] || {};
      const pctRaw = tc.pct ? parseFloat(String(tc.pct).replace(/[^0-9.\-]/g, "")) : NaN;
      tValRow.push(!isNaN(pctRaw) ? (pctRaw / 100) : "");
      tNoteRow.push(tc.ratio ? "Ratio: " + tc.ratio : "");
    });
    sh.getRange(3, 1, 1, totalCols).setValues([tValRow]).setNotes([tNoteRow]);
    sh.getRange(3, 1, 1, totalCols)
      .setBackground("#1F4E78").setFontColor("#FFFFFF").setFontWeight("bold")
      .setVerticalAlignment("middle").setHorizontalAlignment("center").setFontSize(11);
    sh.getRange(3, 1).setHorizontalAlignment("left");
    for (let j = 2; j <= totalCols; j++) {
      sh.getRange(3, j).setNumberFormat("0.0%");
    }
    sh.setRowHeight(3, 30);
    bodyStart = 4;
  }

  const valueMatrix = [];
  const noteMatrix = [];
  reps.forEach(function(rep){
    const valRow = [rep];
    const noteRow = [""];
    data.periods.forEach(function(p){
      const cell = (data.data[rep] || {})[p] || {};
      const pctRaw = cell.pct ? parseFloat(String(cell.pct).replace(/[^0-9.\-]/g, "")) : NaN;
      if (!isNaN(pctRaw)) {
        valRow.push(pctRaw / 100);
      } else {
        valRow.push("");
      }
      noteRow.push(cell.ratio ? "Ratio: " + cell.ratio : "");
    });
    valueMatrix.push(valRow);
    noteMatrix.push(noteRow);
  });

  if (valueMatrix.length > 0) {
    const dataRange = sh.getRange(bodyStart, 1, valueMatrix.length, totalCols);
    dataRange.setValues(valueMatrix);
    dataRange.setNotes(noteMatrix);
    dataRange.setVerticalAlignment("middle").setHorizontalAlignment("center");
    dataRange.setBorder(true, true, true, true, true, true, "#D9D9D9", SpreadsheetApp.BorderStyle.SOLID);
    for (let j = 2; j <= totalCols; j++) {
      sh.getRange(bodyStart, j, valueMatrix.length, 1).setNumberFormat("0.0%");
    }
    sh.getRange(bodyStart, 1, valueMatrix.length, 1).setHorizontalAlignment("left").setFontWeight("bold");
    reps.forEach(function(rep, i){
      data.periods.forEach(function(p, j){
        const cell = (data.data[rep] || {})[p] || {};
        const c = colorMap[cell.color];
        if (c) {
          sh.getRange(bodyStart + i, 2 + j).setBackground(c.bg).setFontColor(c.fg).setFontWeight("bold");
        }
      });
    });
  }

  sh.setColumnWidth(1, 200);
  for (let i = 2; i <= totalCols; i++) sh.setColumnWidth(i, 110);

  const lastRow = bodyStart - 1 + valueMatrix.length;
  if (lastRow >= 2) {
    sh.getRange(2, 1, lastRow - 1, totalCols).createFilter();
  }
}

function rebuildRepStatTabs(ss) {
  writeRepStatTab(ss, REP_ACTIVATION_VIEW_TAB,
    "Rep Activation - click any column header to sort",
    "#548235", readActivationTab, "8-14 Days");
  writeRepStatTab(ss, REP_CHURN_VIEW_TAB,
    "Rep Churn - click any column header to sort",
    "#C00000", readChurnTab, "0-30 Day");
}

function readActivationTab(ss) {
  const sh = ss.getSheetByName(REP_ACTIVATION_TAB);
  if (!sh) return {data: {}, periods: []};
  const all = sh.getDataRange().getValues();
  if (all.length < 2) return {data: {}, periods: []};
  const header = all[0].map(String);
  // Detect period labels by scanning for "<label> %" columns
  const periods = [];
  const idxMap = {};
  for (let i = 1; i < header.length; i++) {
    const h = header[i];
    if (h.length > 2 && h.substr(h.length - 2) === " %") {
      const label = h.substr(0, h.length - 2);
      periods.push(label);
      idxMap[label] = {pct: i};
    } else if (h.length > 6 && h.substr(h.length - 6) === " Color") {
      const label = h.substr(0, h.length - 6);
      if (idxMap[label]) idxMap[label].color = i;
    } else if (h.length > 6 && h.substr(h.length - 6) === " Ratio") {
      const label = h.substr(0, h.length - 6);
      if (idxMap[label]) idxMap[label].ratio = i;
    }
  }
  const data = {};
  let total = null;
  for (let i = 1; i < all.length; i++) {
    const rep = String(all[i][0] || "").trim();
    if (!rep) continue;
    const cells = {};
    periods.forEach(function(p){
      const idx = idxMap[p];
      const rawPct   = idx.pct   != null ? all[i][idx.pct]   : "";
      const rawColor = idx.color != null ? all[i][idx.color] : "";
      const rawRatio = idx.ratio != null ? all[i][idx.ratio] : "";
      cells[p] = {
        pct:   _coercePct(rawPct),
        color: String(rawColor || "").trim(),
        ratio: _coerceRatio(rawRatio)
      };
    });
    if (rep === "_OFFICE_TOTAL") total = cells;
    else data[rep] = cells;
  }
  return {data: data, periods: periods, total: total};
}

// Read a rep helper tab into {data: {rep: {periodLabel: value}}, colors: {rep: color}, periods: [...]}
function readRepDataTab(ss, tabName) {
  const sh = ss.getSheetByName(tabName);
  if (!sh) return {data: {}, colors: {}, periods: []};
  const all = sh.getDataRange().getValues();
  if (all.length < 2) return {data: {}, colors: {}, periods: []};
  const header = all[0].map(String);
  const colorIdx = header.indexOf("Color");
  // Period columns are everything after Rep (col 0) and Color (if present)
  const periodStart = colorIdx >= 0 ? 2 : 1;
  const periods = header.slice(periodStart);
  const data = {};
  const colors = {};
  for (let i = 1; i < all.length; i++) {
    const rep = String(all[i][0] || "").trim();
    if (!rep) continue;
    data[rep] = {};
    if (colorIdx >= 0) colors[rep] = String(all[i][colorIdx] || "").trim();
    periods.forEach(function(p, j){ data[rep][p] = all[i][periodStart + j] || ""; });
  }
  return {data: data, colors: colors, periods: periods};
}

function processUploadedCsv(text) {
  if (!text || text.length < 10) throw new Error("File appears empty.");
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(RAW_TAB);
  if (!sh) sh = ss.insertSheet(RAW_TAB);
  sh.clear();

  const sample = text.substring(0, 500);
  const delim = sample.indexOf("\	") >= 0 ? "\	" : ",";

  const matrix = parseDelimitedText(text, delim);
  if (matrix.length < 2) throw new Error("File has no data rows.");

  let maxCols = 0;
  matrix.forEach(function(r){ if (r.length > maxCols) maxCols = r.length; });
  matrix.forEach(function(r){ while (r.length < maxCols) r.push(""); });

  sh.getRange(1, 1, matrix.length, maxCols).setValues(matrix);
  SpreadsheetApp.flush();

  const counts = buildCallList(true);
  return "Done!  Day-After: " + counts.dayAfter +
         "   Delivered: " + counts.delivered +
         "   Issues: " + counts.issues +
         "   Master: " + counts.master;
}

// RFC-4180-style parser - correctly handles quoted fields with embedded \r, \n, tabs.
function parseDelimitedText(text, delim) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else { cur += c; }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delim) { row.push(cur); cur = ""; continue; }
    if (c === "\r" || c === "\
") {
      row.push(cur); cur = "";
      if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
      row = [];
      if (c === "\r" && text.charAt(i + 1) === "\
") i++;
      continue;
    }
    cur += c;
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (c === '"') {
      if (q && line.charAt(i+1) === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === "," && !q) { out.push(cur); cur = ""; }
    else { cur += c; }
  }
  out.push(cur);
  return out;
}

// --- First-time setup ---------------------------------------------------- //
function firstTimeSetup() {
  const ss = SpreadsheetApp.getActive();
  const tabs = [
    {name: RAW_TAB,        note: "Paste your raw CSV here, OR use Call List > Import CSV & Build."},
    {name: MASTER_TAB,     headers: true},
    {name: DAY_AFTER_TAB,  headers: true},
    {name: DELIVERED_TAB,  headers: true},
    {name: ISSUES_TAB,        headers: true},
    {name: ESCALATIONS_TAB,   headers: true},
    {name: REPORT_TAB,        headers: false},
    {name: REP_ACTIVATION_VIEW_TAB, headers: false},
    {name: REP_CHURN_VIEW_TAB,      headers: false},
    {name: SUMMARY_TAB,       headers: false}
  ];
  tabs.forEach(function(t){
    let sh = ss.getSheetByName(t.name);
    if (!sh) sh = ss.insertSheet(t.name);
    if (t.headers) {
      sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
        .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF");
      sh.setFrozenRows(1);
    }
    if (t.note && sh.getLastRow() === 0) sh.getRange("A1").setValue(t.note);
  });
  SpreadsheetApp.getUi().alert("Setup complete. Use Call List > Import CSV & Build to load your daily pull.");
}

// --- Wrapper that always shows alert (for menu) -------------------------- //
function buildCallListAlerted() {
  const counts = buildCallList(false);
  if (counts) {
    SpreadsheetApp.getUi().alert(
      "Build complete.\
\
" +
      "Day-After: "             + counts.dayAfter  + "\
" +
      "Delivered Not Activated: "+ counts.delivered+ "\
" +
      "Order Issues: "          + counts.issues    + "\
" +
      "Active rows: "           + counts.master    + "\
" +
      "Resolved (carried): "    + counts.resolved
    );
  }
}

// Refresh ONLY the Daily Report tab using the current Raw Import data plus
// the latest notes/ratings from all tracker tabs. Does not touch Master,
// Day-After, Delivered, Issues, or Escalations.
function refreshDailyReport() {
  const ss = SpreadsheetApp.getActive();
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today.getTime() - 86400000);

  const raw = readRawTab(ss);
  if (raw.length === 0) {
    SpreadsheetApp.getUi().alert("Raw Import tab is empty. Run Import CSV & Build first.");
    return;
  }

  // Pull the freshest notes and ratings the user has typed today
  const meta = collectExistingMeta(ss);
  const grouped = groupRows(raw);
  applyNotes(grouped, meta.notes);
  applyRatings(grouped, meta.ratings);
  applyNoteTimestamps(grouped, meta.noteUpdated);

  // Issues (porting clusters + payment)
  const portingClusters = mergePortingIssues(grouped);
  const paymentRows = grouped.filter(function(r){ return r["Status"] === "Pending Valid Payment"; });
  const issues = portingClusters.concat(paymentRows);
  applyNotes(issues, meta.notes);
  applyRatings(issues, meta.ratings);
  applyNoteTimestamps(issues, meta.noteUpdated);

  // Customer-order merge for Day-After / Delivered views
  const groupedMerged = mergeByCustomerOrder(grouped);
  applyNotes(groupedMerged, meta.notes);
  applyRatings(groupedMerged, meta.ratings);
  applyNoteTimestamps(groupedMerged, meta.noteUpdated);

  const callableDates = getCallableOrderDates(today);
  const dayAfter = groupedMerged.filter(function(r){
    if (!r["Order Date"]) return false;
    for (let i = 0; i < callableDates.length; i++) {
      if (sameDay(r["Order Date"], callableDates[i])) return true;
    }
    return false;
  });
  const delivered = groupedMerged.filter(function(r){
    if (r["Status"] === "Delivered") return true;
    return String(r["Affected Statuses"] || "").indexOf("Delivered") >= 0;
  });

  // Escalations: active customer-orders rated Poor/Bad + any existing
  // Escalations rows still rated Poor/Bad
  const isEscalation = function(r){ return ESCALATION_RATINGS.indexOf(r["Rating"]) >= 0; };
  const escalations = groupedMerged.filter(isEscalation);
  const seenEscKeys = {};
  escalations.forEach(function(r){ seenEscKeys[r["Customer Name"] + "||" + r["SPM Number"]] = true; });
  const existingEsc = readEscalationsRows(ss);
  existingEsc.forEach(function(r){
    const k = r["Customer Name"] + "||" + r["SPM Number"];
    if (!seenEscKeys[k] && ESCALATION_RATINGS.indexOf(r["Rating"]) >= 0) {
      escalations.push(r);
      seenEscKeys[k] = true;
    }
  });

  writeDailyReportTab(ss, grouped, groupedMerged, dayAfter, delivered, issues, escalations, today);
  rebuildRepStatTabs(ss);

  // Switch to the report tab so they can see it
  const sh = ss.getSheetByName(REPORT_TAB);
  if (sh) ss.setActiveSheet(sh);

  SpreadsheetApp.getUi().alert(
    "Daily Report refreshed.\
\
" +
    "Day-After: "              + dayAfter.length    + "\
" +
    "Delivered Not Activated: "+ delivered.length   + "\
" +
    "Order Issues: "           + issues.length      + "\
" +
    "Escalations: "            + escalations.length + "\
\
" +
    "Ready to copy/paste into your email."
  );
}

// --- Main builder -------------------------------------------------------- //
function buildCallList(silent) {
  const ss = SpreadsheetApp.getActive();
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today.getTime() - 86400000);

  const raw = readRawTab(ss);
  if (raw.length === 0) {
    if (!silent) SpreadsheetApp.getUi().alert("Raw Import tab is empty. Use Import CSV & Build, or paste your CSV first.");
    return null;
  }

  const meta = collectExistingMeta(ss);
  const existingNotes = meta.notes;
  const existingRatings = meta.ratings;
  const grouped = groupRows(raw);

  // Issues tab uses the porting cluster merge (cross-day, customer-level)
  const portingClusters = mergePortingIssues(grouped);
  const paymentRows = grouped.filter(function(r){ return r["Status"] === "Pending Valid Payment"; });
  const issues = portingClusters.concat(paymentRows);

  // Customer-order merge for Day-After / Delivered / Master views
  // (one row per Customer + SPM + Order Date)
  const groupedMerged = mergeByCustomerOrder(grouped);

  applyNotes(grouped,        existingNotes);
  applyNotes(groupedMerged,  existingNotes);
  applyNotes(issues,         existingNotes);
  applyRatings(grouped,        existingRatings);
  applyRatings(groupedMerged,  existingRatings);
  applyRatings(issues,         existingRatings);
  applyNoteTimestamps(grouped,        meta.noteUpdated);
  applyNoteTimestamps(groupedMerged,  meta.noteUpdated);
  applyNoteTimestamps(issues,         meta.noteUpdated);

  const activeKeys = {};
  // Track active customer-orders by Customer + SPM (broader than per-status key)
  // so resolved detection only kicks in when the customer fully drops from raw.
  grouped.forEach(function(r){
    activeKeys["__cust__" + r["Customer Name"] + "||" + r["SPM Number"]] = true;
  });
  const resolved = buildResolvedRows(ss, activeKeys, today);

  // Day-After: merged customer-orders placed yesterday
  // (on Mondays this sweeps up Fri+Sat+Sun since we don't call on weekends)
  const callableDates = getCallableOrderDates(today);
  const dayAfter = groupedMerged.filter(function(r){
    if (!r["Order Date"]) return false;
    for (let i = 0; i < callableDates.length; i++) {
      if (sameDay(r["Order Date"], callableDates[i])) return true;
    }
    return false;
  });

  // Delivered Not Activated: any merged customer-order whose dominant or affected
  // statuses include "Delivered" (so 1-of-many delivered still surfaces here)
  const delivered = groupedMerged.filter(function(r){
    if (r["Status"] === "Delivered") return true;
    const aff = String(r["Affected Statuses"] || "");
    return aff.indexOf("Delivered") >= 0;
  });

  dayAfter.sort(function(a,b){ return cmp(a["Rep"]+a["Customer Name"], b["Rep"]+b["Customer Name"]); });
  delivered.sort(function(a,b){ return (dateOrMax(a["Ship Date"]) - dateOrMax(b["Ship Date"])) || cmp(a["Customer Name"], b["Customer Name"]); });
  issues.sort(function(a,b){ return cmp(a["Status"]+a["Customer Name"], b["Status"]+b["Customer Name"]); });

  // Master: merged customer-orders + resolved (one row per customer-order)
  const masterRows = groupedMerged.concat(resolved);
  masterRows.sort(function(a,b){ return cmp(a["Customer Name"], b["Customer Name"]); });

  const ydStr = describeCallableDates(callableDates);

  // Escalations = active or resolved customers rated Poor / Bad (customer-order level)
  const isEscalation = function(r){ return ESCALATION_RATINGS.indexOf(r["Rating"]) >= 0; };
  const escalations = groupedMerged.filter(isEscalation).concat(resolved.filter(isEscalation));
  // Preserve any existing escalations not covered by the active/resolved set
  // (e.g. customers added manually or rated via onEdit on rows now gone from raw)
  const seenEscKeys = {};
  escalations.forEach(function(r){ seenEscKeys[r["Customer Name"] + "||" + r["SPM Number"]] = true; });
  const existingEsc = readEscalationsRows(ss);
  existingEsc.forEach(function(r){
    const k = r["Customer Name"] + "||" + r["SPM Number"];
    if (!seenEscKeys[k] && ESCALATION_RATINGS.indexOf(r["Rating"]) >= 0) {
      escalations.push(r);
      seenEscKeys[k] = true;
    }
  });
  escalations.sort(function(a,b){
    return cmp(a["Rating"], b["Rating"]) || cmp(a["Customer Name"], b["Customer Name"]);
  });

  writeRowsToTab(ss, MASTER_TAB,      masterRows, today,
    "Master Tracker  |  " + grouped.length + " active  +  " + resolved.length + " resolved", "#1F4E78");
  writeRowsToTab(ss, DAY_AFTER_TAB,   dayAfter,   today,
    "Day-After Calls  |  orders placed " + ydStr + "  |  " + dayAfter.length + " customers", "#548235");
  writeRowsToTab(ss, DELIVERED_TAB,   delivered,  today,
    "Delivered, Not Yet Activated  |  " + delivered.length + " customers  |  oldest ship date first", "#2E75B6");
  writeRowsToTab(ss, ISSUES_TAB,      issues,     today,
    "Order Issues  |  " + issues.length + " customers  |  porting clusters merged", "#C00000");
  writeRowsToTab(ss, ESCALATIONS_TAB, escalations, today,
    "Escalations  |  " + escalations.length + " customers rated Poor / Bad  |  needs review", "#7030A0");
  writeDailyReportTab(ss, grouped, groupedMerged, dayAfter, delivered, issues, escalations, today);
  writeSummaryTab(ss, grouped, dayAfter, delivered, issues, resolved);
  rebuildRepStatTabs(ss);

  return {
    dayAfter: dayAfter.length,
    delivered: delivered.length,
    issues: issues.length,
    master: groupedMerged.length,
    resolved: resolved.length
  };
}

// --- Raw reader ---------------------------------------------------------- //
function readRawTab(ss) {
  const sh = ss.getSheetByName(RAW_TAB);
  if (!sh) throw new Error("'" + RAW_TAB + "' tab not found. Run First-Time Setup.");
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = data[i][j];
    if (!row[RAW_COLS.customer]) continue;
    if (String(row[RAW_COLS.bucket] || "").toLowerCase().trim() === "total") continue;
    out.push(row);
  }
  return out;
}

// --- Group ---------------------------------------------------------------- //
function groupRows(rows) {
  const groups = {};
  rows.forEach(function(r){
    const status = String(r[RAW_COLS.status] || "").trim() || "Null";
    const key = [
      String(r[RAW_COLS.bucket] || "").trim(),
      formatDate(r[RAW_COLS.order]),
      String(r[RAW_COLS.rep] || "").trim(),
      String(r[RAW_COLS.customer] || "").trim(),
      String(r[RAW_COLS.spm] || "").trim(),
      String(r[RAW_COLS.product] || "").trim(),
      status
    ].join("||");
    if (!groups[key]) groups[key] = {count: 0, ship: [], due: []};
    groups[key].count += 1;
    const ship = parseDate(r[RAW_COLS.ship]);
    if (ship) groups[key].ship.push(ship);
    const due = parseDate(r[RAW_COLS.due]);
    if (due) groups[key].due.push(due);
  });

  const out = [];
  Object.keys(groups).forEach(function(k){
    const p = k.split("||");
    const g = groups[k];
    out.push({
      "Activation Bucket": p[0],
      "Order Date":        parseDate(p[1]),
      "Rep":               p[2],
      "Customer Name":     p[3],
      "SPM Number":        p[4],
      "Product Type":      p[5],
      "Status":            p[6],
      "Lines In Status":   g.count,
      "Affected Statuses": "",
      "Ship Date":         g.ship.length ? minDate(g.ship) : null,
      "Current Due Date":  g.due.length  ? minDate(g.due)  : null,
      "Notes":             "",
      "Rating":            "",
      "Note Updated":      ""
    });
  });
  out.sort(function(a,b){
    return ((BUCKET_ORDER[a["Activation Bucket"]] || 99) - (BUCKET_ORDER[b["Activation Bucket"]] || 99))
        || cmp(a["Status"], b["Status"]) || cmp(a["Customer Name"], b["Customer Name"]);
  });
  return out;
}

// --- Porting cluster merge ----------------------------------------------- //
function mergePortingIssues(grouped) {
  const byCust = {};
  grouped.forEach(function(r){
    if (PORTING_RELATED.indexOf(r["Status"]) >= 0) {
      const k = r["Customer Name"] + "||" + r["SPM Number"];
      if (!byCust[k]) byCust[k] = [];
      byCust[k].push(r);
    }
  });
  const merged = [];
  Object.keys(byCust).forEach(function(k){
    const rows = byCust[k];
    if (!rows.some(function(r){ return r["Status"] === "Porting Issue"; })) return;

    const perStatus = {};
    rows.forEach(function(r){ perStatus[r["Status"]] = (perStatus[r["Status"]] || 0) + r["Lines In Status"]; });
    const primaryLines = perStatus["Porting Issue"] || 0;
    const secondary = Object.keys(perStatus)
      .filter(function(s){ return s !== "Porting Issue"; })
      .map(function(s){ return [s, perStatus[s]]; })
      .sort(function(a,b){ return b[1] - a[1] || cmp(a[0], b[0]); });
    const affected = secondary.map(function(p){ return p[0] + " (" + p[1] + ")"; }).join(", ");

    const portingRows = rows.filter(function(r){ return r["Status"] === "Porting Issue"; });
    portingRows.sort(function(a,b){ return (BUCKET_ORDER[b["Activation Bucket"]] || 99) - (BUCKET_ORDER[a["Activation Bucket"]] || 99); });
    const primary = portingRows[0];

    const productSet = {};
    rows.forEach(function(r){ productSet[r["Product Type"]] = true; });
    const productLabel = Object.keys(productSet).sort().join(", ");

    const ships = rows.map(function(r){ return r["Ship Date"]; }).filter(function(d){ return d; });
    const dues  = rows.map(function(r){ return r["Current Due Date"]; }).filter(function(d){ return d; });

    merged.push({
      "Activation Bucket": primary["Activation Bucket"],
      "Order Date":        primary["Order Date"],
      "Rep":               primary["Rep"],
      "Customer Name":     primary["Customer Name"],
      "SPM Number":        primary["SPM Number"],
      "Product Type":      productLabel,
      "Status":            "Porting Issue",
      "Lines In Status":   primaryLines,
      "Affected Statuses": affected,
      "Ship Date":         ships.length ? minDate(ships) : null,
      "Current Due Date":  dues.length  ? minDate(dues)  : null,
      "Notes":             "",
      "Rating":            "",
      "Note Updated":      ""
    });
  });
  return merged;
}

// Status priority for picking the dominant status when merging a customer-order.
// Higher number = higher priority (shown as the primary Status on the merged row).
const STATUS_PRIORITY = {
  "Porting Issue":         100,
  "Pending Valid Payment":  90,
  "Pending Order Port":     85,
  "Port Approved":          80,
  "Pending Shipment":       75,
  "Pending":                70,
  "Delivered":              60,
  "Shipped":                50,
  "Scheduled":              40,
  "BYOD":                   30,
  "Null":                   20
};

// Merge per-status grouped rows into one row per (Customer + SPM + Order Date).
// Keeps separate rows when DSI/SPM differs OR when ordered on a different day.
function mergeByCustomerOrder(grouped) {
  const groups = {};
  grouped.forEach(function(r){
    const dateKey = r["Order Date"] ? Utilities.formatDate(r["Order Date"], Session.getScriptTimeZone(), "yyyy-MM-dd") : "";
    const k = [String(r["Customer Name"]||"").trim(), String(r["SPM Number"]||"").trim(), dateKey].join("||");
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  const merged = [];
  Object.keys(groups).forEach(function(k){
    const rows = groups[k];
    if (rows.length === 1) {
      merged.push(rows[0]);
      return;
    }

    // Tally lines per status
    const perStatus = {};
    let totalLines = 0;
    rows.forEach(function(r){
      perStatus[r["Status"]] = (perStatus[r["Status"]] || 0) + r["Lines In Status"];
      totalLines += r["Lines In Status"];
    });

    // Pick dominant status by priority (ties broken by line count)
    const sortedStatuses = Object.keys(perStatus).sort(function(a,b){
      const pa = STATUS_PRIORITY[a] || 0;
      const pb = STATUS_PRIORITY[b] || 0;
      if (pa !== pb) return pb - pa;
      return perStatus[b] - perStatus[a];
    });
    const primaryStatus = sortedStatuses[0];
    const primaryLines = perStatus[primaryStatus];
    const secondary = sortedStatuses.slice(1).map(function(s){ return s + " (" + perStatus[s] + ")"; }).join(", ");

    // Pick the row with the dominant status as the source of bucket/rep
    const primaryRow = rows.filter(function(r){ return r["Status"] === primaryStatus; })[0] || rows[0];

    // Combine product types
    const productSet = {};
    rows.forEach(function(r){ productSet[r["Product Type"]] = true; });
    const products = Object.keys(productSet).sort().join(", ");

    // Earliest ship/due dates
    const ships = rows.map(function(r){ return r["Ship Date"]; }).filter(function(d){ return d; });
    const dues  = rows.map(function(r){ return r["Current Due Date"]; }).filter(function(d){ return d; });

    merged.push({
      "Activation Bucket": primaryRow["Activation Bucket"],
      "Order Date":        primaryRow["Order Date"],
      "Rep":               primaryRow["Rep"],
      "Customer Name":     primaryRow["Customer Name"],
      "SPM Number":        primaryRow["SPM Number"],
      "Product Type":      products,
      "Status":            primaryStatus,
      "Lines In Status":   primaryLines,
      "Affected Statuses": secondary,
      "Ship Date":         ships.length ? minDate(ships) : null,
      "Current Due Date":  dues.length  ? minDate(dues)  : null,
      "Notes":             "",
      "Rating":            ""
    });
  });

  merged.sort(function(a,b){
    return ((BUCKET_ORDER[a["Activation Bucket"]] || 99) - (BUCKET_ORDER[b["Activation Bucket"]] || 99))
        || cmp(a["Status"], b["Status"]) || cmp(a["Customer Name"], b["Customer Name"]);
  });
  return merged;
}

// --- Note preservation --------------------------------------------------- //
function noteKey(r) {
  return [r["Customer Name"], r["SPM Number"], r["Product Type"], r["Status"]].join("||");
}

// Find the row that contains the column headers. Tolerates banner rows above.
function findHeaderRowIdx(data) {
  for (let i = 0; i < Math.min(data.length, 5); i++) {
    const row = data[i];
    if (!row) continue;
    if (row.indexOf("Customer Name") >= 0 && row.indexOf("Notes") >= 0) return i;
  }
  return -1;
}

function collectExistingMeta(ss) {
  // Collect notes, ratings, AND note timestamps keyed by [customer, spm,
  // product, status], with a customer+spm fallback so values survive
  // status/product changes.
  const sources = [MASTER_TAB, DAY_AFTER_TAB, DELIVERED_TAB, ISSUES_TAB, ESCALATIONS_TAB];
  const notes = {};
  const ratings = {};
  const noteUpdated = {};
  sources.forEach(function(name){
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return;
    const hIdx = findHeaderRowIdx(data);
    if (hIdx < 0) return;
    const head = data[hIdx].map(String);
    const idx = {};
    HEADERS.forEach(function(h){ idx[h] = head.indexOf(h); });
    if (idx["Customer Name"] < 0 || idx["SPM Number"] < 0) return;
    for (let i = hIdx + 1; i < data.length; i++) {
      const cust = String(data[i][idx["Customer Name"]] || "").trim();
      const spm  = String(data[i][idx["SPM Number"]] || "").trim();
      if (!cust || !spm) continue;
      const product = String(data[i][idx["Product Type"]] || "").trim();
      const status  = String(data[i][idx["Status"]] || "").trim();
      const note   = idx["Notes"]  >= 0 ? String(data[i][idx["Notes"]]  || "").trim() : "";
      const rating = idx["Rating"] >= 0 ? String(data[i][idx["Rating"]] || "").trim() : "";
      const tsRaw  = idx["Note Updated"] >= 0 ? data[i][idx["Note Updated"]] : null;
      const ts     = tsRaw instanceof Date ? tsRaw : (tsRaw ? new Date(tsRaw) : null);
      const tsValid = ts && !isNaN(ts.getTime()) ? ts : null;
      const exact = [cust, spm, product, status].join("||");
      const fk = "__cust__" + cust + "||" + spm;
      if (note)     { notes[exact]       = note;     if (!notes[fk])       notes[fk]       = note; }
      if (rating)   { ratings[exact]     = rating;   if (!ratings[fk])     ratings[fk]     = rating; }
      if (tsValid)  { noteUpdated[exact] = tsValid;  if (!noteUpdated[fk]) noteUpdated[fk] = tsValid; }
    }
  });
  return {notes: notes, ratings: ratings, noteUpdated: noteUpdated};
}

// Backwards-compatible shim
function collectExistingNotes(ss) { return collectExistingMeta(ss).notes; }

function applyNotes(rows, notes) {
  rows.forEach(function(r){
    const exact = notes[noteKey(r)];
    if (exact) { r["Notes"] = exact; return; }
    const fb = notes["__cust__" + r["Customer Name"] + "||" + r["SPM Number"]];
    if (fb) r["Notes"] = fb;
  });
}

function applyRatings(rows, ratings) {
  rows.forEach(function(r){
    const exact = ratings[noteKey(r)];
    if (exact) { r["Rating"] = exact; return; }
    const fb = ratings["__cust__" + r["Customer Name"] + "||" + r["SPM Number"]];
    if (fb) r["Rating"] = fb;
    if (!r["Rating"]) r["Rating"] = "";
  });
}

function applyNoteTimestamps(rows, noteUpdated) {
  rows.forEach(function(r){
    const exact = noteUpdated[noteKey(r)];
    if (exact) { r["Note Updated"] = exact; return; }
    const fb = noteUpdated["__cust__" + r["Customer Name"] + "||" + r["SPM Number"]];
    if (fb) r["Note Updated"] = fb;
    if (!r["Note Updated"]) r["Note Updated"] = "";
  });
}

// --- Resolved rows ------------------------------------------------------- //
function buildResolvedRows(ss, activeKeys, today) {
  const sh = ss.getSheetByName(MASTER_TAB);
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const hIdx = findHeaderRowIdx(data);
  if (hIdx < 0) return [];
  const head = data[hIdx].map(String);
  const idx = {};
  HEADERS.forEach(function(h){ idx[h] = head.indexOf(h); });
  const out = [];
  for (let i = hIdx + 1; i < data.length; i++) {
    const row = {};
    HEADERS.forEach(function(h){ if (idx[h] >= 0) row[h] = data[i][idx[h]]; });
    if (!row["Customer Name"] || !row["SPM Number"]) continue;
    if (activeKeys["__cust__" + row["Customer Name"] + "||" + row["SPM Number"]]) continue;
    let st = String(row["Status"] || "");
    if (st.indexOf("Resolved") !== 0) st = "Resolved (was " + st + ")";
    out.push({
      "Activation Bucket": row["Activation Bucket"],
      "Order Date":        row["Order Date"] || null,
      "Rep":               row["Rep"] || "",
      "Customer Name":     row["Customer Name"],
      "SPM Number":        row["SPM Number"],
      "Product Type":      row["Product Type"] || "",
      "Status":            st,
      "Lines In Status":   row["Lines In Status"] || "",
      "Affected Statuses": row["Affected Statuses"] || "",
      "Ship Date":         row["Ship Date"] || null,
      "Current Due Date":  row["Current Due Date"] || null,
      "Notes":             row["Notes"] || "",
      "Rating":            row["Rating"] || "",
      "Last Seen":         row["Last Seen"] || row["Order Date"] || null,
      "Note Updated":      row["Note Updated"] || ""
    });
  }
  return out;
}

// --- Tab writers --------------------------------------------------------- //
const COL_WIDTHS_PX = [110, 90, 140, 170, 130, 170, 130, 60, 220, 90, 110, 230, 150, 90, 140];
const STATUS_COLORS = {
  "Porting Issue":         {bg:"#FCE4D6", fg:"#9C0006"},
  "Delivered":             {bg:"#D5E8D4", fg:"#385723"},
  "Pending Valid Payment": {bg:"#FFF2CC", fg:"#7F6000"},
  "Shipped":               {bg:"#D9E1F2", fg:"#0B2D5C"},
  "Null":                  {bg:"#F2F2F2", fg:"#666666"},
  "Pending Shipment":      {bg:"#FFF8E1", fg:"#8F6900"},
  "Pending Order Port":    {bg:"#E1D5E7", fg:"#4A2D70"},
  "Port Approved":         {bg:"#D5E8FA", fg:"#1F5582"},
  "Scheduled":             {bg:"#E2EFDA", fg:"#385723"},
  "BYOD":                  {bg:"#F4CCCC", fg:"#990000"}
};
const BUCKET_COLORS = {
  "0-7 Days":   {bg:"#E2EFDA", fg:"#385723"},
  "8-14 Days":  {bg:"#FFF2CC", fg:"#7F6000"},
  "15-30 Days": {bg:"#FCE4D6", fg:"#7F2704"},
  "31-60 Days": {bg:"#F8CBAD", fg:"#660000"}
};

// Read all rows from the Escalations tab as objects keyed by HEADERS.
function readEscalationsRows(ss) {
  const sh = ss.getSheetByName(ESCALATIONS_TAB);
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const hIdx = findHeaderRowIdx(data);
  if (hIdx < 0) return [];
  const head = data[hIdx].map(String);
  const idx = {};
  HEADERS.forEach(function(h){ idx[h] = head.indexOf(h); });
  const out = [];
  for (let i = hIdx + 1; i < data.length; i++) {
    const row = {};
    HEADERS.forEach(function(h){ if (idx[h] >= 0) row[h] = data[i][idx[h]]; });
    if (row["Customer Name"] && row["SPM Number"]) out.push(row);
  }
  return out;
}

function writeRowsToTab(ss, name, rows, today, bannerText, bannerColor) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  // Reset
  sh.clear();
  try { sh.getBandings().forEach(function(b){ b.remove(); }); } catch(e) {}
  try { sh.getRange(1,1,1,HEADERS.length).breakApart(); } catch(e) {}
  sh.clearConditionalFormatRules();

  // Column widths
  for (let i = 0; i < HEADERS.length; i++) {
    sh.setColumnWidth(i+1, COL_WIDTHS_PX[i] || 110);
  }

  // Banner row (row 1)
  sh.getRange(1, 1, 1, HEADERS.length).merge();
  sh.getRange(1, 1).setValue(bannerText || name)
    .setBackground(bannerColor || "#1F4E78")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(13)
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  sh.setRowHeight(1, 32);

  // Header row (row 2)
  const headerRange = sh.getRange(2, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS])
    .setFontWeight("bold")
    .setBackground("#1F4E78")
    .setFontColor("#FFFFFF")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setFontSize(11)
    .setBorder(true, true, true, true, false, false, "#1F4E78", SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(2, 36);
  sh.setFrozenRows(2);

  if (rows.length === 0) {
    sh.getRange(3, 1).setValue("No rows for this view")
      .setFontStyle("italic").setFontColor("#888888");
    return;
  }

  // Body
  const matrix = rows.map(function(r){
    return HEADERS.map(function(h){
      if (h === "Last Seen") return r["Last Seen"] || today;
      return (r[h] === undefined || r[h] === null) ? "" : r[h];
    });
  });
  const startRow = 3;
  const bodyRange = sh.getRange(startRow, 1, matrix.length, HEADERS.length);
  bodyRange.setValues(matrix);
  bodyRange.setVerticalAlignment("middle");
  bodyRange.setWrap(true);
  bodyRange.setBorder(true, true, true, true, true, true, "#D9D9D9", SpreadsheetApp.BorderStyle.SOLID);
  bodyRange.setFontSize(10);

  // Date columns
  ["Order Date", "Ship Date", "Current Due Date", "Last Seen"].forEach(function(h){
    const c = HEADERS.indexOf(h) + 1;
    if (c > 0) sh.getRange(startRow, c, matrix.length, 1).setNumberFormat("m/d/yyyy");
  });

  // Banding (light alternating rows)
  try {
    bodyRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  } catch(e) { /* ignore */ }

  // Auto-filter on the header row
  try {
    if (sh.getFilter()) sh.getFilter().remove();
    sh.getRange(2, 1, matrix.length + 1, HEADERS.length).createFilter();
  } catch(e) { /* ignore */ }

  // Conditional formatting
  const rules = [];

  // 1. Resolved rows greyed out (highest priority)
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=ISNUMBER(SEARCH("Resolved", $G' + startRow + '))')
    .setBackground("#F0F0F0").setFontColor("#999999")
    .setRanges([sh.getRange(startRow, 1, matrix.length, HEADERS.length)])
    .build());

  // 2. Status pills
  const statusCol = HEADERS.indexOf("Status") + 1;
  const statusRange = sh.getRange(startRow, statusCol, matrix.length, 1);
  Object.keys(STATUS_COLORS).forEach(function(st){
    const c = STATUS_COLORS[st];
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(st)
      .setBackground(c.bg).setFontColor(c.fg)
      .setRanges([statusRange]).build());
  });

  // 3. Activation Bucket urgency
  const bucketCol = HEADERS.indexOf("Activation Bucket") + 1;
  const bucketRange = sh.getRange(startRow, bucketCol, matrix.length, 1);
  Object.keys(BUCKET_COLORS).forEach(function(b){
    const c = BUCKET_COLORS[b];
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(b)
      .setBackground(c.bg).setFontColor(c.fg)
      .setRanges([bucketRange]).build());
  });

  // 4. Rating dropdown + colors
  const ratingCol = HEADERS.indexOf("Rating") + 1;
  const ratingRange = sh.getRange(startRow, ratingCol, matrix.length, 1);
  const ratingValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(RATINGS, true)
    .setAllowInvalid(true)
    .setHelpText("Pick a customer experience rating")
    .build();
  ratingRange.setDataValidation(ratingValidation);
  Object.keys(RATING_COLORS).forEach(function(rt){
    const c = RATING_COLORS[rt];
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(rt)
      .setBackground(c.bg).setFontColor(c.fg).setBold(true)
      .setRanges([ratingRange]).build());
  });

  sh.setConditionalFormatRules(rules);
}

// Daily Report tab: status breakdown + today\'s call notes, formatted for
// copy-paste into an email. Grouped by category for readability.
function writeDailyReportTab(ss, grouped, groupedMerged, dayAfter, delivered, issues, escalations, today) {
  let sh = ss.getSheetByName(REPORT_TAB);
  if (!sh) sh = ss.insertSheet(REPORT_TAB);
  sh.clear();
  try { sh.getBandings().forEach(function(b){ b.remove(); }); } catch(e) {}
  try { sh.getRange(1, 1, sh.getMaxRows(), 4).breakApart(); } catch(e) {}
  sh.clearConditionalFormatRules();

  // Column widths for readability
  sh.setColumnWidth(1, 240);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 160);
  sh.setColumnWidth(4, 480);

  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const dateStr = days[today.getDay()] + " " + (today.getMonth()+1) + "/" + today.getDate() + "/" + today.getFullYear();
  let r = 1;

  // Title
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("DAILY CALL REPORT  —  " + dateStr)
    .setFontWeight("bold").setFontSize(16).setBackground("#1F4E78").setFontColor("#FFFFFF")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(r, 36);
  r++;

  // Spacer
  r++;

  // --- Order Status Breakdown --- //
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("ORDER STATUS BREAKDOWN")
    .setFontWeight("bold").setFontSize(12).setBackground("#D9E1F2").setFontColor("#1F4E78");
  sh.setRowHeight(r, 26);
  r++;

  sh.getRange(r, 1, 1, 4).setValues([["Status", "Customer Rows", "Total Lines", ""]])
    .setFontWeight("bold").setBackground("#F2F2F2");
  r++;

  const statusTally = {};
  grouped.forEach(function(row){
    const s = row["Status"];
    if (!statusTally[s]) statusTally[s] = [0, 0];
    statusTally[s][0] += 1;
    statusTally[s][1] += row["Lines In Status"];
  });
  const statusKeys = Object.keys(statusTally).sort(function(a,b){
    return (STATUS_PRIORITY[b] || 0) - (STATUS_PRIORITY[a] || 0);
  });
  statusKeys.forEach(function(s){
    sh.getRange(r, 1, 1, 4).setValues([[s, statusTally[s][0], statusTally[s][1], ""]]);
    r++;
  });
  sh.getRange(r, 1).setValue("TOTAL").setFontWeight("bold");
  sh.getRange(r, 2).setValue(grouped.length).setFontWeight("bold");
  sh.getRange(r, 3).setValue(grouped.reduce(function(s,row){ return s + row["Lines In Status"]; }, 0)).setFontWeight("bold");
  sh.getRange(r, 1, 1, 4).setBackground("#F2F2F2");
  r += 2;

  // --- Activation Bucket Breakdown --- //
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("ACTIVATION BUCKET")
    .setFontWeight("bold").setFontSize(12).setBackground("#D9E1F2").setFontColor("#1F4E78");
  sh.setRowHeight(r, 26);
  r++;

  sh.getRange(r, 1, 1, 4).setValues([["Bucket", "Customer-Orders", "", ""]])
    .setFontWeight("bold").setBackground("#F2F2F2");
  r++;

  const bucketTally = {};
  groupedMerged.forEach(function(row){
    const b = row["Activation Bucket"] || "(unknown)";
    bucketTally[b] = (bucketTally[b] || 0) + 1;
  });
  const bucketKeys = Object.keys(bucketTally).sort(function(a,b){
    return (BUCKET_ORDER[a] || 99) - (BUCKET_ORDER[b] || 99);
  });
  bucketKeys.forEach(function(b){
    sh.getRange(r, 1, 1, 4).setValues([[b, bucketTally[b], "", ""]]);
    r++;
  });
  r += 1;

  // --- Tab counts --- //
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("TODAY\'S CALL CATEGORIES  (note sections below show only notes typed today)")
    .setFontWeight("bold").setFontSize(12).setBackground("#D9E1F2").setFontColor("#1F4E78");
  sh.setRowHeight(r, 26);
  r++;
  sh.getRange(r, 1, 1, 4).setValues([["Category", "Customers", "", ""]])
    .setFontWeight("bold").setBackground("#F2F2F2");
  r++;
  sh.getRange(r++, 1, 1, 4).setValues([["Day-After Orders (yesterday)", dayAfter.length, "", ""]]);
  sh.getRange(r++, 1, 1, 4).setValues([["Delivered, Not Activated", delivered.length, "", ""]]);
  sh.getRange(r++, 1, 1, 4).setValues([["Order Issues", issues.length, "", ""]]);
  sh.getRange(r++, 1, 1, 4).setValues([["Escalations", escalations.length, "", ""]]);
  r += 1;

  // Helper: is this timestamp today (script timezone)?
  function _isToday(d) {
    if (!d) return false;
    const t = d instanceof Date ? d : new Date(d);
    if (isNaN(t.getTime())) return false;
    return t.getFullYear() === today.getFullYear() &&
           t.getMonth()    === today.getMonth() &&
           t.getDate()     === today.getDate();
  }

  // Helper to render a notes section, filtered to today's notes only
  function renderNotesSection(title, rows, color) {
    if (!rows || rows.length === 0) return;
    const withNotes = rows.filter(function(x){
      return String(x["Notes"]||"").trim() && _isToday(x["Note Updated"]);
    });
    if (withNotes.length === 0) return;
    sh.getRange(r, 1, 1, 4).merge();
    sh.getRange(r, 1).setValue(title + "  —  " + withNotes.length + " note" + (withNotes.length === 1 ? "" : "s"))
      .setFontWeight("bold").setFontSize(12).setBackground(color || "#D9E1F2").setFontColor("#1F4E78");
    sh.setRowHeight(r, 26);
    r++;
    sh.getRange(r, 1, 1, 4).setValues([["Customer", "SPM", "Status / Rating", "Note"]])
      .setFontWeight("bold").setBackground("#F2F2F2");
    r++;
    withNotes.forEach(function(x){
      const statusRating = String(x["Status"] || "") + (x["Rating"] ? "  |  " + x["Rating"] : "");
      sh.getRange(r, 1, 1, 4).setValues([[
        x["Customer Name"] || "",
        x["SPM Number"] || "",
        statusRating,
        x["Notes"] || ""
      ]]);
      sh.getRange(r, 4).setWrap(true).setVerticalAlignment("top");
      r++;
    });
    r += 1;
  }

  renderNotesSection("DAY-AFTER CALL NOTES",         dayAfter,    "#E2EFDA");
  renderNotesSection("DELIVERED-NOT-ACTIVATED NOTES", delivered,  "#DDEBF7");
  renderNotesSection("ORDER ISSUE NOTES",             issues,     "#FCE4D6");
  renderNotesSection("ESCALATION NOTES",              escalations,"#F4CCCC");

  // --- Rep Performance ---
  const churn = readRepDataTab(ss, REP_CHURN_TAB);
  const act = readRepDataTab(ss, REP_ACTIVATION_TAB);
  const reps = {};
  Object.keys(act.data).forEach(function(rep){ reps[rep] = true; });
  Object.keys(churn.data).forEach(function(rep){ reps[rep] = true; });
  const repList = Object.keys(reps).sort();

  if (repList.length > 0) {
    sh.getRange(r, 1, 1, 4).merge();
    sh.getRange(r, 1).setValue("REP PERFORMANCE")
      .setFontWeight("bold").setFontSize(12).setBackground("#D9E1F2").setFontColor("#1F4E78");
    sh.setRowHeight(r, 26);
    r++;

    // Activation Rate sub-table - sorted by 8-14 Days descending, color-coded per cell
    const actRich = readActivationTab(ss);
    if (actRich.periods.length > 0) {
      const periods = actRich.periods;
      const colorMap = {
        "Green":  {bg: "#C6EFCE", fg: "#1E5631"},
        "Yellow": {bg: "#FFF2CC", fg: "#7F6000"},
        "Red":    {bg: "#FCE4D6", fg: "#9C0006"}
      };

      // Section header
      sh.getRange(r, 1).setValue("Activation Rate (Activated / Total)  -  bottom " + TOP_WORST_N + " by 8-14 Day  (full list on Rep Activation tab)")
        .setFontWeight("bold").setFontStyle("italic").setFontColor("#385723");
      r++;

      // Column headers
      const headerRow = ["Rep"].concat(periods);
      const writeWidth = Math.max(4, headerRow.length);
      while (headerRow.length < writeWidth) headerRow.push("");
      sh.getRange(r, 1, 1, writeWidth).setValues([headerRow.slice(0, writeWidth)])
        .setFontWeight("bold").setBackground("#F2F2F2").setHorizontalAlignment("center");
      r++;

      // Worst reps for activation: lowest 8-14 Day % (asc); take only TOP_WORST_N
      const sortKey = "8-14 Days";
      const allRepsAct = Object.keys(actRich.data);
      allRepsAct.sort(function(a, b){
        const av = (actRich.data[a][sortKey] || {}).pct || "";
        const bv = (actRich.data[b][sortKey] || {}).pct || "";
        const an = av ? parseFloat(av.replace(/[^0-9.\-]/g, "")) : NaN;
        const bn = bv ? parseFloat(bv.replace(/[^0-9.\-]/g, "")) : NaN;
        // Reps without an 8-14 value go to the bottom of the worst list
        if (isNaN(an) && isNaN(bn)) return cmp(a, b);
        if (isNaN(an)) return 1;
        if (isNaN(bn)) return -1;
        return an - bn;  // ascending = worst first
      });
      const allReps = allRepsAct.slice(0, TOP_WORST_N);

      // Office total row first (if present)
      if (actRich.total) {
        const tRow = ["OFFICE TOTAL"];
        periods.forEach(function(p){
          const tc = actRich.total[p] || {};
          if (tc.pct || tc.ratio) {
            const ratio = tc.ratio ? "(" + tc.ratio + ")\
" : "";
            tRow.push(ratio + (tc.pct || ""));
          } else {
            tRow.push("");
          }
        });
        while (tRow.length < writeWidth) tRow.push("");
        const tRange = sh.getRange(r, 1, 1, writeWidth);
        tRange.setNumberFormat("@");
        tRange.setValues([tRow.slice(0, writeWidth)]);
        tRange.setBackground("#1F4E78").setFontColor("#FFFFFF").setFontWeight("bold")
          .setVerticalAlignment("middle").setWrap(true).setHorizontalAlignment("center");
        sh.getRange(r, 1).setHorizontalAlignment("left");
        sh.setRowHeight(r, 36);
        r++;
      }

      // Render each rep row
      allReps.forEach(function(rep){
        const repRow = [rep];
        periods.forEach(function(p){
          const cell = (actRich.data[rep] || {})[p] || {};
          if (cell.pct || cell.ratio) {
            const ratio = cell.ratio ? "(" + cell.ratio + ")\
" : "";
            repRow.push(ratio + (cell.pct || ""));
          } else {
            repRow.push("");
          }
        });
        while (repRow.length < writeWidth) repRow.push("");

        const range = sh.getRange(r, 1, 1, writeWidth);
        range.setNumberFormat("@");
        range.setValues([repRow.slice(0, writeWidth)]);
        range.setVerticalAlignment("middle").setWrap(true);
        sh.getRange(r, 1).setHorizontalAlignment("left").setFontWeight("bold");
        // Per-cell colors (skip column 1 which is the rep name)
        periods.forEach(function(p, j){
          const cell = (actRich.data[rep] || {})[p] || {};
          const colorName = cell.color || "";
          const c = colorMap[colorName];
          const cellRange = sh.getRange(r, j + 2);
          cellRange.setHorizontalAlignment("center");
          if (c) cellRange.setBackground(c.bg).setFontColor(c.fg).setFontWeight("bold");
        });
        sh.setRowHeight(r, 34);
        r++;
      });
      r++;
    }

    // Churn Rate sub-table - sorted by 0-30 Day descending, color-coded per cell
    const churnRich = readChurnTab(ss);
    if (churnRich.periods.length > 0) {
      const periods = churnRich.periods;
      const colorMap = {
        "Green":  {bg: "#C6EFCE", fg: "#1E5631"},
        "Yellow": {bg: "#FFF2CC", fg: "#7F6000"},
        "Red":    {bg: "#FCE4D6", fg: "#9C0006"}
      };

      sh.getRange(r, 1).setValue("Churn Rate (Disconnects / Activated)  -  top " + TOP_WORST_N + " by 0-30 Day  (full list on Rep Churn tab)")
        .setFontWeight("bold").setFontStyle("italic").setFontColor("#9C0006");
      r++;

      // Column headers
      const cHead = ["Rep"].concat(periods);
      const cWriteWidth = Math.max(4, cHead.length);
      while (cHead.length < cWriteWidth) cHead.push("");
      sh.getRange(r, 1, 1, cWriteWidth).setValues([cHead.slice(0, cWriteWidth)])
        .setFontWeight("bold").setBackground("#F2F2F2").setHorizontalAlignment("center");
      r++;

      // Worst reps for churn: highest 0-30 Day % (desc); take only TOP_WORST_N
      const sortKey = "0-30 Day";
      const allRepsChurn = Object.keys(churnRich.data);
      allRepsChurn.sort(function(a, b){
        const av = (churnRich.data[a][sortKey] || {}).pct || "";
        const bv = (churnRich.data[b][sortKey] || {}).pct || "";
        const an = av ? parseFloat(av.replace(/[^0-9.\-]/g, "")) : NaN;
        const bn = bv ? parseFloat(bv.replace(/[^0-9.\-]/g, "")) : NaN;
        if (isNaN(an) && isNaN(bn)) return cmp(a, b);
        if (isNaN(an)) return 1;
        if (isNaN(bn)) return -1;
        return bn - an;  // descending = worst churn first
      });
      const allReps = allRepsChurn.slice(0, TOP_WORST_N);

      // Office total row first (if present)
      if (churnRich.total) {
        const tRow = ["OFFICE TOTAL"];
        periods.forEach(function(p){
          const tc = churnRich.total[p] || {};
          if (tc.pct || tc.ratio) {
            const ratio = tc.ratio ? "(" + tc.ratio + ")\
" : "";
            tRow.push(ratio + (tc.pct || ""));
          } else {
            tRow.push("");
          }
        });
        while (tRow.length < cWriteWidth) tRow.push("");
        const tRange = sh.getRange(r, 1, 1, cWriteWidth);
        tRange.setNumberFormat("@");
        tRange.setValues([tRow.slice(0, cWriteWidth)]);
        tRange.setBackground("#1F4E78").setFontColor("#FFFFFF").setFontWeight("bold")
          .setVerticalAlignment("middle").setWrap(true).setHorizontalAlignment("center");
        sh.getRange(r, 1).setHorizontalAlignment("left");
        sh.setRowHeight(r, 36);
        r++;
      }

      allReps.forEach(function(rep){
        const repRow = [rep];
        periods.forEach(function(p){
          const cell = (churnRich.data[rep] || {})[p] || {};
          if (cell.pct || cell.ratio) {
            const ratio = cell.ratio ? "(" + cell.ratio + ")\
" : "";
            repRow.push(ratio + (cell.pct || ""));
          } else {
            repRow.push("");
          }
        });
        while (repRow.length < cWriteWidth) repRow.push("");

        const range = sh.getRange(r, 1, 1, cWriteWidth);
        range.setNumberFormat("@");
        range.setValues([repRow.slice(0, cWriteWidth)]);
        range.setVerticalAlignment("middle").setWrap(true);
        sh.getRange(r, 1).setHorizontalAlignment("left").setFontWeight("bold");
        periods.forEach(function(p, j){
          const cell = (churnRich.data[rep] || {})[p] || {};
          const c = colorMap[cell.color || ""];
          const cellRange = sh.getRange(r, j + 2);
          cellRange.setHorizontalAlignment("center");
          if (c) cellRange.setBackground(c.bg).setFontColor(c.fg).setFontWeight("bold");
        });
        sh.setRowHeight(r, 34);
        r++;
      });
      r++;
    }
  }

  // Footer
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("Generated " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEE M/d/yyyy h:mm a") +
                              "  •  Select rows above and copy/paste into email.")
    .setFontStyle("italic").setFontColor("#888888").setFontSize(10);

  // Borders on data area
  sh.getRange(1, 1, r, 4).setBorder(true, true, true, true, false, false, "#BFBFBF", SpreadsheetApp.BorderStyle.SOLID);
}

function writeSummaryTab(ss, grouped, dayAfter, delivered, issues, resolved) {
  let sh = ss.getSheetByName(SUMMARY_TAB);
  if (!sh) sh = ss.insertSheet(SUMMARY_TAB);
  sh.clear();
  try { sh.clearConditionalFormatRules(); } catch(e) {}

  const tally = {};
  grouped.forEach(function(r){
    const s = r["Status"];
    if (!tally[s]) tally[s] = [0, 0];
    tally[s][0] += 1;
    tally[s][1] += r["Lines In Status"];
  });

  // Status table
  const out = [["Status", "Customer Rows", "Total Lines"]];
  Object.keys(tally).sort().forEach(function(s){ out.push([s, tally[s][0], tally[s][1]]); });
  out.push(["", "", ""]);
  out.push(["Tab", "Rows", ""]);
  out.push(["Day-After Orders",        dayAfter.length,  ""]);
  out.push(["Delivered Not Activated", delivered.length, ""]);
  out.push(["Order Issues",            issues.length,    ""]);
  out.push(["Resolved (carried)",      resolved.length,  ""]);
  out.push(["Last Run",                Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEE M/d/yyyy h:mm a"), ""]);

  sh.getRange(1, 1, out.length, 3).setValues(out);
  sh.getRange(1, 1, 1, 3)
    .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center").setFontSize(11);
  sh.setRowHeight(1, 30);
  sh.setColumnWidth(1, 220);
  sh.setColumnWidth(2, 130);
  sh.setColumnWidth(3, 130);

  // Status color rules in the Status column
  const statusRange = sh.getRange(2, 1, Object.keys(tally).length, 1);
  const rules = [];
  Object.keys(STATUS_COLORS).forEach(function(st){
    const c = STATUS_COLORS[st];
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(st)
      .setBackground(c.bg).setFontColor(c.fg)
      .setRanges([statusRange]).build());
  });
  sh.setConditionalFormatRules(rules);

  // Borders on the status table
  sh.getRange(1, 1, Object.keys(tally).length + 1, 3)
    .setBorder(true, true, true, true, true, true, "#BFBFBF", SpreadsheetApp.BorderStyle.SOLID);
}

// --- Date helpers -------------------------------------------------------- //
function parseDate(v) {
  if (!v && v !== 0) return null;
  if (v instanceof Date) return v;
  let s = String(v).trim();
  if (!s || s.indexOf("9999") === 0) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let yr = parseInt(m[3], 10);
    if (yr < 100) yr += 2000;
    return new Date(yr, parseInt(m[1],10)-1, parseInt(m[2],10));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function formatDate(v) { const d = parseDate(v); return d ? ((d.getMonth()+1) + "/" + d.getDate() + "/" + d.getFullYear()) : ""; }
function minDate(arr) { return new Date(Math.min.apply(null, arr.map(function(d){ return d.getTime(); }))); }
function dateOrMax(d) { return d ? d.getTime() : 8.64e15; }
// Returns the array of Order Date(s) that should be on today's Day-After list.
// Mondays sweep up Friday + Saturday + Sunday (no weekend calls).
// Other weekdays = just yesterday.
function getCallableOrderDates(today) {
  const day = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const out = [];
  if (day === 1) {
    // Monday: include Fri (-3), Sat (-2), Sun (-1)
    for (let back = 3; back >= 1; back--) {
      out.push(new Date(today.getTime() - back * 86400000));
    }
  } else {
    out.push(new Date(today.getTime() - 86400000));
  }
  return out;
}

// Human-readable description of the callable date range, e.g.
// "Fri 4/24/2026 - Sun 4/26/2026" or "Mon 4/27/2026".
function describeCallableDates(dates) {
  if (!dates || dates.length === 0) return "";
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const fmt = function(d){ return days[d.getDay()] + " " + (d.getMonth()+1) + "/" + d.getDate() + "/" + d.getFullYear(); };
  if (dates.length === 1) return fmt(dates[0]);
  return fmt(dates[0]) + " - " + fmt(dates[dates.length - 1]);
}

function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function cmp(a, b) { a = String(a||"").toLowerCase(); b = String(b||"").toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; }
// =========================================================================
// TABLEAU AUTOMATION
// =========================================================================

const TABLEAU_SERVER   = "https://us-east-1.online.tableau.com";
const TABLEAU_SITE_URL = "sci";
const TABLEAU_API_VER  = "3.19";
const WORKBOOK_NAME    = "ATTTRACKER-B2B";
const VIEW_ORDER_LOG   = "ActivationOpportunityReport";
const VIEW_ACTIVATION  = "ACTIVATIONRATES";
const VIEW_CHURN       = "CHURNRATES";

function tableauSignIn() {
  const props = PropertiesService.getScriptProperties();
  const user  = props.getProperty("TABLEAU_USER");
  const pass  = props.getProperty("TABLEAU_PASS");
  if (!user || !pass) throw new Error("TABLEAU_USER / TABLEAU_PASS not set in Script Properties.");
  const resp = UrlFetchApp.fetch(
    TABLEAU_SERVER + "/api/" + TABLEAU_API_VER + "/auth/signin",
    {
      method: "post",
      contentType: "application/json",
      headers: { "Accept": "application/json" },
      payload: JSON.stringify({
        credentials: { name: user, password: pass, site: { contentUrl: TABLEAU_SITE_URL } }
      }),
      muteHttpExceptions: true
    }
  );
  const body = JSON.parse(resp.getContentText());
  if (!body.credentials) {
    throw new Error("Tableau sign-in failed: " + resp.getContentText().substring(0, 300));
  }
  return { token: body.credentials.token, siteId: body.credentials.site.id };
}

function tableauSignOut(token) {
  try {
    UrlFetchApp.fetch(
      TABLEAU_SERVER + "/api/" + TABLEAU_API_VER + "/auth/signout",
      { method: "post", headers: { "X-Tableau-Auth": token }, muteHttpExceptions: true }
    );
  } catch(e) {}
}

function tableauGetViewId(token, siteId, viewUrlName) {
  const url = TABLEAU_SERVER + "/api/" + TABLEAU_API_VER +
    "/sites/" + siteId + "/views?filter=viewUrlName:eq:" + encodeURIComponent(viewUrlName);
  const resp = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { "X-Tableau-Auth": token, "Accept": "application/json" },
    muteHttpExceptions: true
  });
  const body = JSON.parse(resp.getContentText());
  const views = (body.views && body.views.view) ? body.views.view : [];
  for (var i = 0; i < views.length; i++) {
    var wb = views[i].workbook || {};
    if ((wb.name || "").toUpperCase() === WORKBOOK_NAME.toUpperCase()) return views[i].id;
  }
  if (views.length > 0) return views[0].id;
  throw new Error("View not found: " + viewUrlName + " in workbook " + WORKBOOK_NAME);
}

function tableauDownloadViewCsv(token, siteId, viewId) {
  const url = TABLEAU_SERVER + "/api/" + TABLEAU_API_VER +
    "/sites/" + siteId + "/views/" + viewId + "/data";
  const resp = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { "X-Tableau-Auth": token },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Download failed (HTTP " + resp.getResponseCode() + "): " +
                    resp.getContentText().substring(0, 300));
  }
  return resp.getContentText();
}

// --- Run this first to verify column formats before enabling the trigger ---
function testTableauDownload() {
  var token = null, siteId = null;
  try {
    var auth = tableauSignIn();
    token  = auth.token;
    siteId = auth.siteId;
    var views = [
      { name: "Order Log",        urlName: VIEW_ORDER_LOG  },
      { name: "Activation Rates", urlName: VIEW_ACTIVATION },
      { name: "Churn Rates",      urlName: VIEW_CHURN      }
    ];
    var report = "Tableau test — " + new Date().toString() + "\
\
";
    views.forEach(function(v) {
      try {
        var id  = tableauGetViewId(token, siteId, v.urlName);
        var csv = tableauDownloadViewCsv(token, siteId, id);
        var lines = csv.split("\
").slice(0, 4).join("\
");
        report += "=== " + v.name + " ===\
" + lines + "\
\
";
      } catch(e) {
        report += "=== " + v.name + " ERROR: " + e.message + " ===\
\
";
      }
    });
    console.log(report);
    SpreadsheetApp.getUi().alert(
      "Test done! Open Apps Script editor → Executions (left sidebar) to see the column headers for all 3 views."
    );
  } finally {
    if (token) tableauSignOut(token);
  }
}

// --- Main automated run ---
function automatedDailyRun() {
  var ss = SpreadsheetApp.getActive();
  var token = null, siteId = null;
  var log = [];
  try {
    var auth = tableauSignIn();
    token  = auth.token;
    siteId = auth.siteId;
    log.push("Signed in. Site: " + siteId);

    log.push("Fetching order log...");
    var orderId = tableauGetViewId(token, siteId, VIEW_ORDER_LOG);
    processUploadedCsv(tableauDownloadViewCsv(token, siteId, orderId));
    log.push("Order log done.");

    log.push("Fetching activation rates...");
    var actId = tableauGetViewId(token, siteId, VIEW_ACTIVATION);
    processRepActivationCsv(tableauDownloadViewCsv(token, siteId, actId));
    log.push("Activation rates done.");

    log.push("Fetching churn rates...");
    var churnId = tableauGetViewId(token, siteId, VIEW_CHURN);
    processRepChurnCsv(tableauDownloadViewCsv(token, siteId, churnId));
    log.push("Churn rates done.");

    _writeRunLog(ss, "SUCCESS", log.join(" | "));

    var notify = PropertiesService.getScriptProperties().getProperty("NOTIFY_EMAIL");
    if (notify) {
      MailApp.sendEmail(notify,
        "Daily Call List built — " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yyyy"),
        log.join("\
"));
    }
  } catch(err) {
    log.push("ERROR: " + (err.message || String(err)));
    _writeRunLog(ss, "ERROR", log.join(" | "));
    var notify = PropertiesService.getScriptProperties().getProperty("NOTIFY_EMAIL");
    if (notify) {
      MailApp.sendEmail(notify,
        "Daily Call List FAILED — " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yyyy"),
        log.join("\
"));
    }
    throw err;
  } finally {
    if (token) tableauSignOut(token);
  }
}

// --- Run once to create the 6am trigger ---
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "automatedDailyRun") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("automatedDailyRun")
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  SpreadsheetApp.getUi().alert(
    "Trigger set! Fires daily 6:00–7:00am.\
\
Current script timezone: " +
    Session.getScriptTimeZone() +
    "\
\
If wrong, go to Project Settings (gear icon) → Time zone, fix it, then run Setup Trigger again."
  );
}

function _writeRunLog(ss, status, message) {
  var sh = ss.getSheetByName(SUMMARY_TAB);
  if (!sh) return;
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 3).setValues([["Auto Run: " + status, new Date(), message]]);
  sh.getRange(row, 1, 1, 3).setBackground(status === "ERROR" ? "#F4CCCC" : "#C6EFCE");
}