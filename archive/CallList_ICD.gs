/**
 * Daily Call List Tracker — ICD Consumer Division
 * ------------------------------------------------
 * Standalone tracker for ICD offices (Rudy Soto / Eli Goldberg).
 * Uses the ICD Activation Opportunity Report (different column layout from
 * the standard AOR) and the ICD Order Log. Activation rates are computed
 * automatically from the Order Log — no separate Activation CSV needed.
 *
 * ICD AOR columns:  sp.Customer Full Name | Order Date | Current Status |
 *                   Wireless Device | Ship Date  (no Activation Bucket, no Due Date)
 * ICD OL columns:   DTR Status | Product Type (Broken Out) | spe.Status |
 *                   Sales (All) (1)  (used to compute per-rep activation %)
 *
 * Daily flow (option A): click "Import CSV & Build", select the ICD AOR file, done.
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
const NOTES_ARCHIVE_TAB  = "_Notes Archive";
const NOTE_STORE_TAB     = "_Note Store";        // permanent note persistence — never cleared
const REP_ACTIVATION_VIEW_TAB = "Rep Activation";
const REP_CHURN_VIEW_TAB      = "Rep Churn";
const HOME_TAB                = "📋 How To Use";
const COMPLETED_TAB           = "Completed Orders";
const FORCE_COMPLETE_TAB      = "_Force Complete";   // hidden override sheet
const PENDING_TAB             = "Pending Sheet";      // non-completed AOR lines, one row per TN
const ALL_LINES_TAB           = "Activation Sheet";   // every OL line including completed

// Canonical statuses that mark a line as "done."
// After normalizeStatus() runs, "Active/Posted" and "Posted" both become "Active",
// and "Canceled" (single-l) becomes "Cancelled" — so these three cover every variant.
//
// Routing rules (applied per Customer+SPM group in the Order Log import):
//   ALL lines done     → Master Tracker (all lines)  +  Completed Orders (retained 1 year)
//   SOME/NONE done     → Master Tracker only (all lines, regardless of individual line status)
//   Force-complete     → same as "ALL lines done"
//
//   Master Tracker always shows every order ever imported (1-year carry-forward).
//   "Resolved" status is only for Issues and Escalations tabs — never Master Tracker.
const COMPLETED_STATUSES = ["Active", "Cancelled", "Disconnected"];

// Customer experience ratings
const RATINGS = [
  "⭐⭐⭐⭐⭐ Excellent",
  "⭐⭐⭐⭐ Good",
  "⭐⭐⭐ OK",
  "⭐⭐ Poor",
  "⭐ Bad",
  "📵 No Answer"
];
const ESCALATION_RATINGS = ["⭐⭐ Poor", "⭐ Bad"];
// Resolved rating — only shown on Issues and Escalations tabs
const RESOLVED_RATING = "✓ Resolved";
const RATING_COLORS = {
  "⭐⭐⭐⭐⭐ Excellent": {bg:"#C6EFCE", fg:"#1E5631"},
  "⭐⭐⭐⭐ Good":        {bg:"#E2EFDA", fg:"#385723"},
  "⭐⭐⭐ OK":            {bg:"#FFF2CC", fg:"#7F6000"},
  "⭐⭐ Poor":            {bg:"#FCE4D6", fg:"#9C0006"},
  "⭐ Bad":               {bg:"#F4CCCC", fg:"#660000"},
  "📵 No Answer":         {bg:"#EFEFEF", fg:"#555555"},
  "✓ Resolved":           {bg:"#F0F0F0", fg:"#999999"}
};

const HEADERS = [
  "Activation Bucket", "Order Date", "Rep", "Customer Name", "SPM Number",
  "Product Type", "Status", "Lines In Status", "Affected Statuses",
  "Ship Date", "Current Due Date", "Notes", "Rating", "Last Seen", "Note Updated"
];

// ICD AOR column mapping — differs from the standard AOR format.
// Activation Bucket is NOT in the CSV; it is computed from Order Date in readRawTab().
// Due Date is not present in the ICD AOR, so due is null (ignored in groupRows).
const RAW_COLS = {
  bucket:   "Activation Bucket",         // virtual — injected by readRawTab, not a CSV column
  order:    "Order Date",                 // was: sp.Order Date (copy)
  rep:      "Rep",
  customer: "sp.Customer Full Name",      // was: Customer Name
  spm:      "sp.SPM Number",
  product:  "Wireless Device",            // was: Product Type (Broken out lvl 2)
  status:   "Current Status",             // was: spe.Status
  ship:     "Ship Date",                  // was: Ship Date (SP)
  due:      null,                         // ICD AOR has no due-date column
  tn:       "Wireless Number"             // phone number / line identifier
};

const PORTING_RELATED = ["Porting Issue","Pending Order Port","Port Approved","Pending Shipment","Pending"];
const BUCKET_ORDER = {"0-7 Days":0,"8-14 Days":1,"15-30 Days":2,"31-60 Days":3};

// --- Menu ----------------------------------------------------------------- //
function onOpen() {
  try { buildHomeTab(); } catch(e) {}
  try {
    SpreadsheetApp.getUi()
      .createMenu("Call List")
      .addItem("Import CSV & Build (recommended)", "showImportDialog")
      .addItem("Build / Refresh (after manual paste)", "buildCallListAlerted")
      .addSeparator()
      .addItem("Refresh Daily Report (end of day)", "refreshDailyReport")
      .addSeparator()
      .addItem("Import Order Log CSV...",          "showOrderLogImportDialog")
      .addSeparator()
      .addItem("Import Rep Churn CSV...",        "showChurnImportDialog")
      // NOTE: Activation rates are computed automatically from the Order Log — no separate CSV needed.
      .addSeparator()
      .addItem("Force Selected Row(s) to Completed", "forceSelectedToCompleted")
      .addItem("View / Edit Force Complete List",    "viewForceCompleteList")
      .addSeparator()
      .addItem("First-Time Setup", "firstTimeSetup")
      .addToUi();
  } catch(e) {
    // SpreadsheetApp.getUi() is unavailable when the sheet is accessed via the
    // API, run from the Apps Script editor, or opened in a restricted context.
    // Silently skip menu creation — it will appear normally on the next real open.
  }
}

// --- onEdit trigger: instant escalation ---------------------------------- //
// Fires on every user edit. When a Rating cell is set to Poor or Bad on any
// tracker tab, copies that row to the Escalations tab immediately.
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    // Watch all tracker tabs including Completed Orders so late note edits are persisted
    const watched = [MASTER_TAB, DAY_AFTER_TAB, DELIVERED_TAB, ISSUES_TAB, ESCALATIONS_TAB, COMPLETED_TAB];
    if (watched.indexOf(sheetName) < 0) return;

    const allData = sheet.getDataRange().getValues();
    const hIdx = findHeaderRowIdx(allData);
    if (hIdx < 0) return;
    const headerRow = allData[hIdx].map(String);
    const editedRow = e.range.getRow();
    const editedCol = e.range.getColumn();
    if (editedRow <= hIdx + 1) return;

    const noteCol        = headerRow.indexOf("Notes") + 1;
    const ratingCol      = headerRow.indexOf("Rating") + 1;
    const noteUpdatedCol = headerRow.indexOf("Note Updated") + 1;
    const custCol        = headerRow.indexOf("Customer Name");
    const spmCol         = headerRow.indexOf("SPM Number");
    const prodCol        = headerRow.indexOf("Product Type");

    // ----- Notes edit: stamp Note Updated + persist to _Note Store -----
    if (noteCol > 0 && editedCol === noteCol) {
      const now = new Date();
      if (noteUpdatedCol > 0) {
        sheet.getRange(editedRow, noteUpdatedCol).setValue(now)
          .setNumberFormat("m/d/yyyy h:mm am/pm");
      }
      if (custCol >= 0 && spmCol >= 0) {
        const r = allData[editedRow - 1];
        saveNoteToStore(SpreadsheetApp.getActive(),
          String(r[custCol] || "").trim(),
          String(r[spmCol]  || "").trim(),
          prodCol >= 0 ? String(r[prodCol] || "").trim() : "",
          String(e.value || "").trim(),
          ratingCol > 0 ? String(r[ratingCol - 1] || "").trim() : "",
          now);
      }
    }

    // ----- Rating edit -----
    if (ratingCol > 0 && editedCol === ratingCol) {
      const newValue = String(e.range.getValue() || "").trim();

      // Persist rating to _Note Store
      if (custCol >= 0 && spmCol >= 0) {
        const r = allData[editedRow - 1];
        saveNoteToStore(SpreadsheetApp.getActive(),
          String(r[custCol] || "").trim(),
          String(r[spmCol]  || "").trim(),
          prodCol >= 0 ? String(r[prodCol] || "").trim() : "",
          noteCol > 0  ? String(r[noteCol - 1] || "").trim() : "",
          newValue,
          new Date());
      }

      // ✓ Resolved on Issues or Escalations: gray out the whole row, stop here
      if (newValue === RESOLVED_RATING &&
          (sheetName === ISSUES_TAB || sheetName === ESCALATIONS_TAB)) {
        sheet.getRange(editedRow, 1, 1, headerRow.length)
          .setBackground("#F0F0F0")
          .setFontColor("#999999");
        return;
      }

      // Push to Escalations tab if Poor/Bad
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
                'document.getElementById("status").textContent = "Error: " + (err && (err.message || JSON.stringify(err)) || "Unknown error");' +
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
// ICD offices do not use a separate Activation CSV.
// Activation rates are calculated automatically when importing the Order Log CSV.
function showActivationImportDialog() {
  SpreadsheetApp.getUi().alert(
    "ICD Activation Rates",
    "Activation rates for ICD offices are calculated automatically\n" +
    "when you import the Order Log CSV.\n\n" +
    "Use: Call List  >  Import Order Log CSV...",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
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
              '.withFailureHandler(function(err){ document.getElementById("status").textContent = "Error: " + (err && (err.message || JSON.stringify(err)) || "Unknown error"); document.getElementById("go").disabled = false; })' +
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
  // Auto-detect column layout: new exports have an extra OWNER & OFFICE col at index 2,
  // pushing color to col 3 and metric to col 4 (periods start at 5).
  // Old exports: color=2, metric=3, periods start at 4.
  const hasOwnerCol = String(header[2] || "").toUpperCase().indexOf("OWNER") >= 0 ||
                      String(header[2] || "").toUpperCase().indexOf("OFFICE") >= 0;
  const colorIdx  = hasOwnerCol ? 3 : 2;
  const metricIdx = hasOwnerCol ? 4 : 3;
  const periodStart = hasOwnerCol ? 5 : 4;

  // Period columns start after the metric column
  const periodCols = [];
  for (let i = periodStart; i < header.length; i++) {
    if (String(header[i] || "").trim()) periodCols.push({idx: i, label: String(header[i]).trim()});
  }

  // {rep: {period: {pct, color, disc, act}}}
  const repData = {};

  const totals = {};
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const repFull = String(row[0] || "").replace(/\r/g, " ").trim();
    const repShort = String(row[1] || "").trim();
    const color = String(row[colorIdx] || "").trim();
    const metric = String(row[metricIdx] || "").trim();
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

// ICD offices do not use a separate Activation CSV.
// Activation data is built by computeActivationFromOrderLog(), called at
// the end of processOrderLogCsv().  This stub is kept so any stale menu
// references don't crash the script.
function processRepActivationCsv(text) {
  throw new Error(
    "ICD offices do not use an Activation Office CSV.\n" +
    "Import the Order Log CSV instead — activation rates are computed automatically."
  );
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
  if (tabName === REP_ACTIVATION_VIEW_TAB) sh.setTabColor("#38761D");
  else if (tabName === REP_CHURN_VIEW_TAB)  sh.setTabColor("#85200C");

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

// =========================================================================
// FORCE-COMPLETE OVERRIDES
// =========================================================================

/**
 * Returns a lookup object { "CustomerName||SPMNumber": true } for every
 * row in the hidden _Force Complete sheet. Used by both import paths.
 */
function readForceCompleteKeys(ss) {
  const out = {};
  const sh = ss.getSheetByName(FORCE_COMPLETE_TAB);
  if (!sh) return out;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const cust = String(data[i][0] || "").trim();
    const spm  = String(data[i][1] || "").trim();
    if (cust || spm) out[cust + "||" + spm] = true;
  }
  return out;
}

/**
 * Ensures the _Force Complete sheet exists, is set up, and is hidden.
 * Returns the sheet.
 */
function getOrCreateForceCompleteSheet(ss) {
  let sh = ss.getSheetByName(FORCE_COMPLETE_TAB);
  if (!sh) {
    sh = ss.insertSheet(FORCE_COMPLETE_TAB);
    sh.getRange(1, 1, 1, 4)
      .setValues([["Customer Name", "SPM Number", "Forced On", "Reason"]])
      .setFontWeight("bold")
      .setBackground("#1F4E78")
      .setFontColor("#FFFFFF");
    sh.setColumnWidth(1, 220);
    sh.setColumnWidth(2, 140);
    sh.setColumnWidth(3, 120);
    sh.setColumnWidth(4, 260);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

/**
 * Menu action: mark the selected row(s) on any tracker tab as Force Complete.
 * Adds the Customer + SPM to the hidden override sheet so next import routes
 * them to Completed Orders regardless of their status in the CSV.
 */
function forceSelectedToCompleted() {
  const ss  = SpreadsheetApp.getActive();
  const sh  = ss.getActiveSheet();
  const ui  = SpreadsheetApp.getUi();

  const data = sh.getDataRange().getValues();
  const hIdx = findHeaderRowIdx(data);
  if (hIdx < 0) {
    ui.alert("Could not find a header row on this tab. Select a row on the Master Tracker, Day-After Orders, or any tracker tab.");
    return;
  }
  const head    = data[hIdx].map(String);
  const custCol = head.indexOf("Customer Name");
  const spmCol  = head.indexOf("SPM Number");
  if (custCol < 0 || spmCol < 0) {
    ui.alert("This tab does not have Customer Name / SPM Number columns. Run this from a tracker tab.");
    return;
  }

  const sel     = sh.getActiveRange();
  const selData = sel.getValues();
  const toAdd   = [];
  selData.forEach(function(row) {
    const cust = String(row[custCol] || "").trim();
    const spm  = String(row[spmCol]  || "").trim();
    if (cust && spm) toAdd.push([cust, spm]);
  });

  if (toAdd.length === 0) {
    ui.alert("No valid rows selected — make sure the selected rows have both a Customer Name and SPM Number.");
    return;
  }

  const fsh      = getOrCreateForceCompleteSheet(ss);
  const existing = readForceCompleteKeys(ss);
  const today    = new Date();
  const newRows  = toAdd.filter(function(p) { return !existing[p[0] + "||" + p[1]]; });

  if (newRows.length > 0) {
    fsh.showSheet();   // briefly unhide to write, then re-hide
    fsh.getRange(fsh.getLastRow() + 1, 1, newRows.length, 4)
       .setValues(newRows.map(function(p) { return [p[0], p[1], today, ""]; }));
    fsh.hideSheet();
  }

  const already = toAdd.length - newRows.length;
  let msg = newRows.length + " order" + (newRows.length === 1 ? "" : "s") + " marked as Force Complete.";
  if (already > 0) msg += "\n(" + already + " already in the override list.)";
  msg += "\n\nRe-import the Order Log CSV to move them to the Completed Orders tab.";
  ui.alert("Force Complete", msg, ui.ButtonSet.OK);
}

/**
 * Menu action: show the hidden _Force Complete override list so the user
 * can review or delete entries.
 */
function viewForceCompleteList() {
  const ss  = SpreadsheetApp.getActive();
  const fsh = getOrCreateForceCompleteSheet(ss);
  fsh.showSheet();
  ss.setActiveSheet(fsh);
  SpreadsheetApp.getUi().alert(
    "Force Complete List",
    "The override list is now visible.\n\n" +
    "To REMOVE an override: delete the row for that customer, then save.\n" +
    "The sheet will be hidden automatically on next import.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function processUploadedCsv(text) {
  try {
    if (!text || text.length < 10) throw new Error("File appears empty.");
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(RAW_TAB);
    if (!sh) sh = ss.insertSheet(RAW_TAB);
    sh.clear();

    const sample = text.substring(0, 500);
    const delim = sample.indexOf("\t") >= 0 ? "\t" : ",";

    const matrix = parseDelimitedText(text, delim);
    if (matrix.length < 2) throw new Error("File has no data rows.");

    let maxCols = 0;
    matrix.forEach(function(r){ if (r.length > maxCols) maxCols = r.length; });
    matrix.forEach(function(r){ while (r.length < maxCols) r.push(""); });

    sh.getRange(1, 1, matrix.length, maxCols).setValues(matrix);
    SpreadsheetApp.flush();

    const counts = buildCallList(true);
    if (!counts) throw new Error("Build failed — Raw Import tab is empty or could not be read.");
    return "Done!  Day-After: " + counts.dayAfter +
           "   Delivered: " + counts.delivered +
           "   Issues: " + counts.issues;
  } catch(e) {
    throw new Error(e.message || String(e) || "Unknown error in processUploadedCsv");
  }
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
    if (c === "\r" || c === "\n") {
      row.push(cur); cur = "";
      if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
      row = [];
      if (c === "\r" && text.charAt(i + 1) === "\n") i++;
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
      "(Master Tracker updated separately via Import Order Log CSV)"
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

  // Remove any orders that have been manually force-completed — they live in the
  // Completed Orders tab and should not appear in Day-After, Delivered, Issues, etc.
  // Mutate in-place (const prevents reassignment, not mutation) so every downstream
  // array derived from grouped is automatically clean.
  const _fcKeys = readForceCompleteKeys(ss);
  if (Object.keys(_fcKeys).length > 0) {
    const _keep = grouped.filter(function(r) {
      return !_fcKeys[r["Customer Name"] + "||" + r["SPM Number"]];
    });
    grouped.splice(0, grouped.length);
    _keep.forEach(function(r){ grouped.push(r); });
  }

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

  // Master Tracker — all pending orders, one row per Customer+SPM, sorted by bucket.
  // Driven by the Activation CSV so it always reflects the live pending order list.
  // Notes, ratings, and timestamps are already applied to groupedMerged above.
  writeRowsToTab(ss, MASTER_TAB, groupedMerged, today,
    "Master Tracker  |  All Pending Orders  —  " + groupedMerged.length + " customers",
    "#1F4E78");

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

  // Build Pending Lines tab from AOR data (cross-referenced with last OL import)
  writePendingLinesTab(ss, raw, today);

  return {
    dayAfter: dayAfter.length,
    delivered: delivered.length,
    issues: issues.length
  };
}

// --- Raw reader ---------------------------------------------------------- //
// ICD version: the AOR has no "Activation Bucket" column, so we compute it
// from the Order Date and inject it as row["Activation Bucket"] so all
// downstream logic (groupRows, mergeByCustomerOrder, etc.) works unchanged.
function readRawTab(ss) {
  const sh = ss.getSheetByName(RAW_TAB);
  if (!sh) throw new Error("'" + RAW_TAB + "' tab not found. Run First-Time Setup.");
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  const today = new Date(); today.setHours(0,0,0,0);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = data[i][j];
    if (!row[RAW_COLS.customer]) continue;
    // Compute and inject Activation Bucket from the Order Date
    const od = parseDate(row[RAW_COLS.order]);
    row["Activation Bucket"] = _computeBucket(od, today);
    // Normalize the device name to a standard ICD product category
    row[RAW_COLS.product] = normalizeProductTypeICD(row[RAW_COLS.product]);
    out.push(row);
  }
  return out;
}

// Derive the standard activation-bucket label from an order date.
// Used by readRawTab() and processOrderLogCsv().
function _computeBucket(d, today) {
  if (!d || isNaN(d.getTime())) return "";
  var diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (diff <= 7)  return "0-7 Days";
  if (diff <= 14) return "8-14 Days";
  if (diff <= 30) return "15-30 Days";
  return "31-60 Days";
}

// Normalize a raw product name (from "Wireless Device" in the AOR or
// "Product Type (Broken Out)" in the Order Log) into one of five
// canonical ICD categories.  Matching is case-insensitive and keyword-based.
function normalizeProductTypeICD(raw) {
  if (!raw) return "";
  var s = String(raw).trim().toLowerCase();

  // Fiber — check early (some fiber modems contain "wireless" in the name)
  if (s.indexOf("fiber") >= 0 || s.indexOf("fios") >= 0) return "Fiber";

  // VoIP
  if (s.indexOf("voip") >= 0 || s.indexOf("voice over ip") >= 0 ||
      s.indexOf("magicjack") >= 0 || s.indexOf("ooma") >= 0) return "VoIP";

  // Air — mobile hotspot / aircard / jetpack (check before generic "wireless")
  if (s.indexOf("hotspot") >= 0 || s.indexOf("jetpack") >= 0 ||
      s.indexOf("aircard") >= 0 || s.indexOf("mifi")    >= 0 ||
      s.indexOf("air ")    >= 0 || s === "air") return "Air";

  // Tablet / Wearable
  if (s.indexOf("ipad")       >= 0 || s.indexOf("tablet")   >= 0 ||
      s.indexOf("watch")      >= 0 || s.indexOf("wearable")  >= 0 ||
      s.indexOf("galaxy tab") >= 0 || s.indexOf("surface")   >= 0 ||
      s.indexOf("kindle")     >= 0 || s.indexOf("chromebook") >= 0) return "Tablet/Wearable";

  // Wireless — phones and anything else flagged "wireless"
  if (s.indexOf("iphone")   >= 0 || s.indexOf("samsung")  >= 0 ||
      s.indexOf("pixel")    >= 0 || s.indexOf("motorola") >= 0 ||
      s.indexOf("moto")     >= 0 || s.indexOf("lg ")      >= 0 ||
      s.indexOf("oneplus")  >= 0 || s.indexOf("nokia")    >= 0 ||
      s.indexOf("wireless") >= 0 || s.indexOf("phone")    >= 0) return "Wireless";

  // Unknown — return as-is so nothing is silently swallowed
  return String(raw).trim();
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
    return ((BUCKET_ORDER[a["Activation Bucket"]] != null ? BUCKET_ORDER[a["Activation Bucket"]] : 99) - (BUCKET_ORDER[b["Activation Bucket"]] != null ? BUCKET_ORDER[b["Activation Bucket"]] : 99))
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
    portingRows.sort(function(a,b){ return (BUCKET_ORDER[a["Activation Bucket"]] != null ? BUCKET_ORDER[a["Activation Bucket"]] : 99) - (BUCKET_ORDER[b["Activation Bucket"]] != null ? BUCKET_ORDER[b["Activation Bucket"]] : 99); });
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
    return ((BUCKET_ORDER[a["Activation Bucket"]] != null ? BUCKET_ORDER[a["Activation Bucket"]] : 99) - (BUCKET_ORDER[b["Activation Bucket"]] != null ? BUCKET_ORDER[b["Activation Bucket"]] : 99))
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
  const sources = [MASTER_TAB, DAY_AFTER_TAB, DELIVERED_TAB, ISSUES_TAB, ESCALATIONS_TAB, COMPLETED_TAB];
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
  // Read from permanent _Note Store — fallback for orders no longer in any active tab.
  // Values here only fill gaps; fresher values from the active tabs above take priority.
  (function() {
    var nsh = ss.getSheetByName(NOTE_STORE_TAB);
    if (!nsh) return;
    var nData = nsh.getDataRange().getValues();
    if (nData.length < 2) return;
    var nHead = nData[0].map(String);
    var nCust = nHead.indexOf("Customer Name");
    var nSpm  = nHead.indexOf("SPM Number");
    var nNote = nHead.indexOf("Notes");
    var nRat  = nHead.indexOf("Rating");
    var nTs   = nHead.indexOf("Note Updated");
    if (nCust < 0 || nSpm < 0) return;
    for (var i = 1; i < nData.length; i++) {
      var nc = String(nData[i][nCust] || "").trim();
      var ns = String(nData[i][nSpm]  || "").trim();
      if (!nc || !ns) continue;
      var fk  = "__cust__" + nc + "||" + ns;
      var nn  = nNote >= 0 ? String(nData[i][nNote] || "").trim() : "";
      var nr  = nRat  >= 0 ? String(nData[i][nRat]  || "").trim() : "";
      var nts = nTs   >= 0 ? nData[i][nTs] : null;
      var ntd = nts instanceof Date ? nts : (nts ? new Date(nts) : null);
      var ntv = ntd && !isNaN(ntd.getTime()) ? ntd : null;
      if (nn  && !notes[fk])       notes[fk]       = nn;
      if (nr  && !ratings[fk])     ratings[fk]     = nr;
      if (ntv && !noteUpdated[fk]) noteUpdated[fk] = ntv;
    }
  })();

  return {notes: notes, ratings: ratings, noteUpdated: noteUpdated};
}

// Backwards-compatible shim
function collectExistingNotes(ss) { return collectExistingMeta(ss).notes; }

// ---------------------------------------------------------------------------
// Permanent note persistence — writes to _Note Store on every note/rating edit
// so notes survive CSV rebuilds and never fall off regardless of which tab the
// order was last seen in.
// ---------------------------------------------------------------------------
function saveNoteToStore(ss, cust, spm, prod, note, rating, timestamp) {
  if (!cust || !spm) return;
  try {
    var sh = ss.getSheetByName(NOTE_STORE_TAB);
    if (!sh) {
      sh = ss.insertSheet(NOTE_STORE_TAB);
      sh.getRange(1, 1, 1, 6).setValues([[
        "Customer Name", "SPM Number", "Product Type", "Notes", "Rating", "Note Updated"
      ]]).setFontWeight("bold").setBackground("#4A235A").setFontColor("#FFFFFF");
      sh.setFrozenRows(1);
      try { sh.hideSheet(); } catch(e2) {}
    }
    var custN = String(cust).trim().toUpperCase();
    var spmN  = String(spm).trim().toUpperCase();
    var data  = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toUpperCase() === custN &&
          String(data[i][1]).trim().toUpperCase() === spmN) {
        // Update existing row — only overwrite non-empty incoming values
        if (note)      sh.getRange(i + 1, 4).setValue(note);
        if (rating)    sh.getRange(i + 1, 5).setValue(rating);
        if (timestamp) sh.getRange(i + 1, 6).setValue(timestamp);
        return;
      }
    }
    // Not found — append new row
    sh.getRange(sh.getLastRow() + 1, 1, 1, 6).setValues([[
      String(cust).trim(), String(spm).trim(), String(prod || "").trim(),
      String(note || "").trim(), String(rating || "").trim(), timestamp || ""
    ]]);
  } catch(e) {
    console.log("saveNoteToStore error: " + (e && e.message));
  }
}

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
    out.push({
      "Activation Bucket": row["Activation Bucket"],
      "Order Date":        row["Order Date"] || null,
      "Rep":               row["Rep"] || "",
      "Customer Name":     row["Customer Name"],
      "SPM Number":        row["SPM Number"],
      "Product Type":      row["Product Type"] || "",
      "Status":            row["Status"] || "",
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

// --- Status normalization ------------------------------------------------ //
// Maps raw values from DTR Status (enriched) to the canonical display names
// used throughout the tracker. Case-insensitive lookup (key in lowercase).
// Add new entries here whenever you see an unexpected status string come through.
const STATUS_NORMALIZE = {
  // Active variants
  "active":                "Active",
  "active/posted":         "Active",
  "posted":                "Active",

  // Cancelled variants
  "cancelled":             "Cancelled",
  "canceled":              "Cancelled",
  "cancel":                "Cancelled",

  // Disconnected variants
  "disconnected":          "Disconnected",
  "disconnect":            "Disconnected",

  // Delivered variants
  "delivered":             "Delivered",

  // Shipped variants
  "shipped":               "Shipped",

  // Scheduled variants
  "scheduled":             "Scheduled",

  // Open variants
  "open":                  "Open",

  // Pending Shipment variants
  "pending shipment":      "Pending Shipment",
  "pending ship":          "Pending Shipment",

  // Pending variants
  "pending":               "Pending",
  "pending activation":    "Pending",

  // Porting Issue variants
  "porting issue":         "Porting Issue",
  "port issue":            "Porting Issue",

  // Pending Valid Payment variants
  "pending valid payment": "Pending Valid Payment",
  "pending payment":       "Pending Valid Payment",

  // BYOD variants
  "byod":                  "BYOD",

  // Pending Order Port variants
  "pending order port":    "Pending Order Port",

  // Port Approved variants
  "port approved":         "Port Approved",

  // Null / blank
  "null":                  "Null",
  "":                      "Null"
};

/**
 * Normalize a raw status string from the Order Log CSV to a canonical
 * display name. Unknown values pass through unchanged (trimmed).
 */
function normalizeStatus(raw) {
  if (raw === null || raw === undefined) return "Null";
  const trimmed = String(raw).trim();
  return STATUS_NORMALIZE[trimmed.toLowerCase()] || trimmed || "Null";
}

// --- Tab writers --------------------------------------------------------- //
const COL_WIDTHS_PX = [110, 90, 140, 170, 130, 170, 130, 60, 220, 90, 110, 230, 150, 90, 140];
const STATUS_COLORS = {
  // Green
  "Active":                {bg:"#D5E8D4", fg:"#385723"},
  // Lavender
  "Delivered":             {bg:"#E8D5F5", fg:"#5B2C6F"},
  // Yellow (same shade)
  "Shipped":               {bg:"#FFF2CC", fg:"#7F6000"},
  "Null":                  {bg:"#FFF2CC", fg:"#7F6000"},
  "Scheduled":             {bg:"#FFF2CC", fg:"#7F6000"},
  // Light Yellow
  "Open":                  {bg:"#FEFDE8", fg:"#7F6000"},
  // Light Orange (same shade)
  "Pending Shipment":      {bg:"#FDEBD0", fg:"#974706"},
  "Pending":               {bg:"#FDEBD0", fg:"#974706"},
  // Orange (same shade)
  "Porting Issue":         {bg:"#F8CBAD", fg:"#7F3B00"},
  "Pending Valid Payment": {bg:"#F8CBAD", fg:"#7F3B00"},
  "BYOD":                  {bg:"#F8CBAD", fg:"#7F3B00"},
  // Dark Orange (same shade)
  "Pending Order Port":    {bg:"#F4B183", fg:"#662D00"},
  "Port Approved":         {bg:"#F4B183", fg:"#662D00"},
  // Red
  "Cancelled":             {bg:"#F4CCCC", fg:"#9C0006"},
  // Dark Red
  "Disconnected":          {bg:"#E06666", fg:"#FFFFFF"}
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

  // For Issues and Escalations: sort resolved rows to the bottom
  var displayRows = rows.slice();
  if (name === ISSUES_TAB || name === ESCALATIONS_TAB) {
    displayRows.sort(function(a, b) {
      var aRes = String(a["Rating"] || "") === RESOLVED_RATING ? 1 : 0;
      var bRes = String(b["Rating"] || "") === RESOLVED_RATING ? 1 : 0;
      return aRes - bRes;
    });
  }

  // Body
  const matrix = displayRows.map(function(r){
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

  // 1. Status pills
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
  // Issues and Escalations tabs get the "✓ Resolved" option; other tabs do not
  var ratingList = (name === ISSUES_TAB || name === ESCALATIONS_TAB)
    ? RATINGS.concat([RESOLVED_RATING])
    : RATINGS;
  const ratingValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(ratingList, true)
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

  // 5. Resolved rows: gray out the entire row (Issues and Escalations only)
  if (name === ISSUES_TAB || name === ESCALATIONS_TAB) {
    const resolvedRatingColLetter = String.fromCharCode(64 + ratingCol);
    rules.unshift(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + resolvedRatingColLetter + startRow + '="' + RESOLVED_RATING + '"')
      .setBackground("#F0F0F0").setFontColor("#999999")
      .setRanges([sh.getRange(startRow, 1, matrix.length, HEADERS.length)])
      .build());
  }

  sh.setConditionalFormatRules(rules);

  // Tab color coding
  const _tabColorMap = {};
  _tabColorMap[MASTER_TAB]      = "#203864";
  _tabColorMap[DAY_AFTER_TAB]   = "#375623";
  _tabColorMap[DELIVERED_TAB]   = "#0B5394";
  _tabColorMap[ISSUES_TAB]      = "#974706";
  _tabColorMap[ESCALATIONS_TAB] = "#C00000";
  _tabColorMap[COMPLETED_TAB]   = "#375623";
  const _tc = _tabColorMap[name];
  if (_tc) sh.setTabColor(_tc);
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
  const statusSectionStart = r;
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("ORDER STATUS BREAKDOWN")
    .setFontWeight("bold").setFontSize(11).setBackground("#2E75B6").setFontColor("#FFFFFF")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(r, 28);
  r++;

  sh.getRange(r, 1, 1, 4).setValues([["Status", "Customer Rows", "Total Lines", ""]])
    .setFontWeight("bold").setBackground("#D6E4F0").setFontColor("#1F4E78").setFontSize(10);
  sh.getRange(r, 2, 1, 2).setHorizontalAlignment("right");
  sh.setRowHeight(r, 22);
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
  statusKeys.forEach(function(s, i){
    sh.getRange(r, 1, 1, 4).setValues([[s, statusTally[s][0], statusTally[s][1], ""]]).setFontSize(10);
    const sc = STATUS_COLORS[s];
    if (sc) {
      sh.getRange(r, 1).setBackground(sc.bg).setFontColor(sc.fg).setFontWeight("bold");
      sh.getRange(r, 2, 1, 2).setBackground(sc.bg).setFontColor(sc.fg);
    } else {
      sh.getRange(r, 1, 1, 3).setBackground(i % 2 === 0 ? "#FFFFFF" : "#F7FBFF");
    }
    sh.getRange(r, 2, 1, 2).setHorizontalAlignment("right");
    sh.setRowHeight(r, 22);
    r++;
  });
  sh.getRange(r, 1, 1, 4).setValues([["TOTAL", grouped.length, grouped.reduce(function(s,row){ return s + row["Lines In Status"]; }, 0), ""]])
    .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF").setFontSize(10);
  sh.getRange(r, 2, 1, 2).setHorizontalAlignment("right");
  sh.setRowHeight(r, 22);
  r++;
  sh.getRange(statusSectionStart, 1, r - statusSectionStart, 3)
    .setBorder(true, true, true, true, true, true, "#BDD7EE", SpreadsheetApp.BorderStyle.SOLID);
  r++;

  // --- Activation Bucket Breakdown --- //
  const bucketSectionStart = r;
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("ACTIVATION BUCKET")
    .setFontWeight("bold").setFontSize(11).setBackground("#2E75B6").setFontColor("#FFFFFF")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(r, 28);
  r++;

  sh.getRange(r, 1, 1, 4).setValues([["Bucket", "Customer-Orders", "", ""]])
    .setFontWeight("bold").setBackground("#D6E4F0").setFontColor("#1F4E78").setFontSize(10);
  sh.getRange(r, 2).setHorizontalAlignment("right");
  sh.setRowHeight(r, 22);
  r++;

  const bucketTally = {};
  groupedMerged.forEach(function(row){
    const b = row["Activation Bucket"] || "(unknown)";
    bucketTally[b] = (bucketTally[b] || 0) + 1;
  });
  const bucketKeys = Object.keys(bucketTally).sort(function(a,b){
    return (BUCKET_ORDER[a] != null ? BUCKET_ORDER[a] : 99) - (BUCKET_ORDER[b] != null ? BUCKET_ORDER[b] : 99);
  });
  bucketKeys.forEach(function(b){
    sh.getRange(r, 1, 1, 4).setValues([[b, bucketTally[b], "", ""]]).setFontSize(10);
    const bc = BUCKET_COLORS[b];
    if (bc) {
      sh.getRange(r, 1).setBackground(bc.bg).setFontColor(bc.fg).setFontWeight("bold");
      sh.getRange(r, 2).setBackground(bc.bg).setFontColor(bc.fg);
    }
    sh.getRange(r, 2).setHorizontalAlignment("right");
    sh.setRowHeight(r, 22);
    r++;
  });
  sh.getRange(bucketSectionStart, 1, r - bucketSectionStart, 2)
    .setBorder(true, true, true, true, true, true, "#BDD7EE", SpreadsheetApp.BorderStyle.SOLID);
  r++;

  // --- Tab counts --- //
  const catSectionStart = r;
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("TODAY\'S CALL CATEGORIES  (note sections below show only notes typed today)")
    .setFontWeight("bold").setFontSize(11).setBackground("#2E75B6").setFontColor("#FFFFFF")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(r, 28);
  r++;
  sh.getRange(r, 1, 1, 4).setValues([["Category", "Customers", "", ""]])
    .setFontWeight("bold").setBackground("#D6E4F0").setFontColor("#1F4E78").setFontSize(10);
  sh.getRange(r, 2).setHorizontalAlignment("right");
  sh.setRowHeight(r, 22);
  r++;
  const catRows = [
    ["Day-After Orders (yesterday)", dayAfter.length],
    ["Delivered, Not Activated",     delivered.length],
    ["Order Issues",                 issues.length],
    ["Escalations",                  escalations.length]
  ];
  catRows.forEach(function(row, i){
    sh.getRange(r, 1, 1, 4).setValues([[row[0], row[1], "", ""]]).setFontSize(10)
      .setBackground(i % 2 === 0 ? "#FFFFFF" : "#F7FBFF");
    sh.getRange(r, 2).setHorizontalAlignment("right");
    sh.setRowHeight(r, 22);
    r++;
  });
  sh.getRange(catSectionStart, 1, r - catSectionStart, 2)
    .setBorder(true, true, true, true, true, true, "#BDD7EE", SpreadsheetApp.BorderStyle.SOLID);
  r++;

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
    withNotes.sort(function(a, b){
      const av = BUCKET_ORDER[a["Activation Bucket"]] != null ? BUCKET_ORDER[a["Activation Bucket"]] : 99;
      const bv = BUCKET_ORDER[b["Activation Bucket"]] != null ? BUCKET_ORDER[b["Activation Bucket"]] : 99;
      return av - bv;
    });
    sh.getRange(r, 1, 1, 4).merge();
    sh.getRange(r, 1).setValue(title + "  —  " + withNotes.length + " note" + (withNotes.length === 1 ? "" : "s"))
      .setFontWeight("bold").setFontSize(11).setBackground(color || "#2E75B6").setFontColor("#FFFFFF")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sh.setRowHeight(r, 28);
    r++;
    sh.getRange(r, 1, 1, 4).setValues([["Customer", "SPM", "Status / Rating", "Note"]])
      .setFontWeight("bold").setBackground("#F2F2F2").setFontColor("#333333").setFontSize(10);
    sh.setRowHeight(r, 22);
    r++;
    withNotes.forEach(function(x, i){
      const statusRating = String(x["Status"] || "") + (x["Rating"] ? "  |  " + x["Rating"] : "");
      sh.getRange(r, 1, 1, 4).setValues([[
        x["Customer Name"] || "",
        x["SPM Number"] || "",
        statusRating,
        x["Notes"] || ""
      ]]).setFontSize(10).setBackground(i % 2 === 0 ? "#FFFFFF" : "#F7FBFF");
      sh.getRange(r, 4).setWrap(true).setVerticalAlignment("top");
      sh.setRowHeight(r, 20);
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
      .setFontWeight("bold").setFontSize(11).setBackground("#2E75B6").setFontColor("#FFFFFF")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sh.setRowHeight(r, 28);
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
        .setFontWeight("bold").setBackground("#D6E4F0").setFontColor("#1F4E78").setFontSize(10).setHorizontalAlignment("center");
      sh.getRange(r, 1).setHorizontalAlignment("left");
      sh.setRowHeight(r, 22);
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
        .setFontWeight("bold").setBackground("#D6E4F0").setFontColor("#1F4E78").setFontSize(10).setHorizontalAlignment("center");
      sh.getRange(r, 1).setHorizontalAlignment("left");
      sh.setRowHeight(r, 22);
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

  // --- Activation Appointments --- //
  try {
    const todayIso = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const apptSummary = getAppointmentDailySummary(todayIso);
    const apptUrls    = (typeof getSchedulerUrls === 'function') ? getSchedulerUrls() : { bookingUrl:'', adminUrl:'' };

    const apptSectionStart = r;
    sh.getRange(r, 1, 1, 4).merge();
    sh.getRange(r, 1).setValue("ACTIVATION APPOINTMENTS  —  " + dateStr)
      .setFontWeight("bold").setFontSize(11).setBackground("#1F4E78").setFontColor("#FFFFFF")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sh.setRowHeight(r, 28);
    r++;

    // Scheduler quick-links row
    if (apptUrls.bookingUrl) {
      sh.getRange(r, 1, 1, 4).setValues([["📅 Book an Appointment","🔧 Admin Dashboard","",""]])
        .setFontSize(10).setFontColor("#00A8E0").setBackground("#EFF6FF").setFontWeight("bold");
      sh.getRange(r, 1).setFormula('=HYPERLINK("' + apptUrls.bookingUrl + '","📅 Book an Appointment")');
      sh.getRange(r, 2).setFormula('=HYPERLINK("' + apptUrls.adminUrl   + '","🔧 Admin Dashboard")');
      sh.setRowHeight(r, 22);
      r++;
    }

    // Quick summary counts row
    sh.getRange(r, 1, 1, 4).setValues([[
      "Scheduled: " + apptSummary.scheduled.length,
      "Completed: " + apptSummary.completed.length + "  (" + apptSummary.totalDevicesCompleted + " device" + (apptSummary.totalDevicesCompleted !== 1 ? "s" : "") + ")",
      "No-Shows: " + apptSummary.noShows.length,
      "Cancelled: " + apptSummary.cancelled.length
    ]]).setFontWeight("bold").setBackground("#D6E4F0").setFontColor("#1F4E78").setFontSize(10);
    sh.setRowHeight(r, 22);
    r++;

    // Helper to render one appointment group
    function renderApptGroup(label, bgHeader, fgHeader, entries, showCancel) {
      if (!entries || entries.length === 0) return;
      sh.getRange(r, 1, 1, 4).merge();
      sh.getRange(r, 1).setValue(label + "  (" + entries.length + ")")
        .setFontWeight("bold").setFontSize(10).setBackground(bgHeader).setFontColor(fgHeader)
        .setHorizontalAlignment("left").setVerticalAlignment("middle");
      sh.setRowHeight(r, 22);
      r++;

      const colHeaders = showCancel
        ? [["Time", "Customer", "Activator / DSI-SPM", "Reason for Cancellation"]]
        : [["Time", "Customer", "Activator / DSI-SPM", "Devices"]];
      sh.getRange(r, 1, 1, 4).setValues(colHeaders)
        .setFontWeight("bold").setBackground("#F2F2F2").setFontColor("#333333").setFontSize(10);
      sh.setRowHeight(r, 20);
      r++;

      entries.forEach(function(e, i) {
        const timeStr = (function() {
          if (!e.time) return "";
          var parts = String(e.time).split(":").map(Number);
          var h = parts[0], m = parts[1];
          var per = h >= 12 ? "PM" : "AM";
          var h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
          return h12 + ":" + String(m).padStart(2, "0") + " " + per;
        })();
        const col4 = showCancel ? (e.cancelReason || "—") : (e.deviceCount + " device" + (e.deviceCount !== 1 ? "s" : ""));
        sh.getRange(r, 1, 1, 4).setValues([[
          timeStr,
          e.customerName,
          e.activatorName + (e.dsiSpmNumber ? "  |  " + e.dsiSpmNumber : ""),
          col4
        ]]).setFontSize(10).setBackground(i % 2 === 0 ? "#FFFFFF" : "#F7FBFF");
        sh.getRange(r, 4).setWrap(true).setVerticalAlignment("top");
        sh.setRowHeight(r, 20);
        r++;
      });
    }

    renderApptGroup("SCHEDULED (TODAY)",   "#2E75B6", "#FFFFFF", apptSummary.scheduled,  false);
    renderApptGroup("COMPLETED",           "#C6EFCE", "#1E5631", apptSummary.completed,  false);
    renderApptGroup("NO-SHOWS",            "#FFF2CC", "#7F6000", apptSummary.noShows,    false);
    renderApptGroup("CANCELLED",           "#FCE4D6", "#9C0006", apptSummary.cancelled,  true);

    if (apptSummary.scheduled.length + apptSummary.completed.length +
        apptSummary.noShows.length + apptSummary.cancelled.length === 0) {
      sh.getRange(r, 1, 1, 4).merge();
      sh.getRange(r, 1).setValue("No activation appointments found for today.")
        .setFontStyle("italic").setFontColor("#888888").setFontSize(10)
        .setHorizontalAlignment("center");
      sh.setRowHeight(r, 22);
      r++;
    }

    sh.getRange(apptSectionStart, 1, r - apptSectionStart, 4)
      .setBorder(true, true, true, true, false, false, "#BDD7EE", SpreadsheetApp.BorderStyle.SOLID);
    r++;
  } catch(apptErr) {
    // If the Appointments sheet doesn't exist yet, skip gracefully
    sh.getRange(r, 1, 1, 4).merge();
    sh.getRange(r, 1).setValue("Activation appointments not available. Run initializeSystem() to set up the scheduler.")
      .setFontStyle("italic").setFontColor("#888888").setFontSize(10);
    sh.setRowHeight(r, 20);
    r += 2;
  }

  // Footer
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("Generated " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEE M/d/yyyy h:mm a") +
                              "  •  Select rows above and copy/paste into email.")
    .setFontStyle("italic").setFontColor("#888888").setFontSize(10);

  // Outer border + tab styling
  sh.getRange(1, 1, r, 4).setBorder(true, true, true, true, false, false, "#2E75B6", SpreadsheetApp.BorderStyle.SOLID);
  sh.setFrozenRows(1);
  sh.setTabColor("#2E75B6");
}

function writeSummaryTab(ss, grouped, dayAfter, delivered, issues, resolved) {
  let sh = ss.getSheetByName(SUMMARY_TAB);
  if (!sh) sh = ss.insertSheet(SUMMARY_TAB);
  sh.clear();
  try { sh.getBandings().forEach(function(b){ b.remove(); }); } catch(e) {}
  try { sh.getRange(1,1,sh.getMaxRows(),sh.getMaxColumns()).breakApart(); } catch(e) {}
  try { sh.clearConditionalFormatRules(); } catch(e) {}

  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 130);
  sh.setColumnWidth(3, 130);
  sh.setColumnWidth(4, 28);

  const _days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const _now  = new Date();
  const _ds   = _days[_now.getDay()] + " " + (_now.getMonth()+1) + "/" + _now.getDate() + "/" + _now.getFullYear();
  let r = 1;

  // Title banner
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("SUMMARY  —  " + _ds)
    .setFontWeight("bold").setFontSize(14).setBackground("#1F4E78").setFontColor("#FFFFFF")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(r, 36);
  r += 2; // title + spacer

  // Build tally
  const tally = {};
  grouped.forEach(function(row){
    const s = row["Status"];
    if (!tally[s]) tally[s] = [0, 0];
    tally[s][0] += 1;
    tally[s][1] += row["Lines In Status"];
  });

  // --- Order Status Breakdown ---
  const _statusStart = r;
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("ORDER STATUS BREAKDOWN")
    .setFontWeight("bold").setFontSize(11).setBackground("#2E75B6").setFontColor("#FFFFFF")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(r, 28);
  r++;

  sh.getRange(r, 1, 1, 3).setValues([["Status", "Customer Rows", "Total Lines"]])
    .setFontWeight("bold").setBackground("#D6E4F0").setFontColor("#1F4E78").setFontSize(10);
  sh.getRange(r, 2, 1, 2).setHorizontalAlignment("right");
  sh.setRowHeight(r, 22);
  r++;

  const _sKeys = Object.keys(tally).sort(function(a,b){
    return (STATUS_PRIORITY[b] || 0) - (STATUS_PRIORITY[a] || 0);
  });
  _sKeys.forEach(function(s, i){
    sh.getRange(r, 1, 1, 3).setValues([[s, tally[s][0], tally[s][1]]]).setFontSize(10);
    const sc = STATUS_COLORS[s];
    if (sc) {
      sh.getRange(r, 1).setBackground(sc.bg).setFontColor(sc.fg).setFontWeight("bold");
      sh.getRange(r, 2, 1, 2).setBackground(sc.bg).setFontColor(sc.fg);
    } else {
      sh.getRange(r, 1, 1, 3).setBackground(i % 2 === 0 ? "#FFFFFF" : "#F7FBFF");
    }
    sh.getRange(r, 2, 1, 2).setHorizontalAlignment("right");
    sh.setRowHeight(r, 22);
    r++;
  });
  const _totalLines = grouped.reduce(function(s,row){ return s + row["Lines In Status"]; }, 0);
  sh.getRange(r, 1, 1, 3).setValues([["TOTAL", grouped.length, _totalLines]])
    .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF").setFontSize(10);
  sh.getRange(r, 2, 1, 2).setHorizontalAlignment("right");
  sh.setRowHeight(r, 22);
  r++;
  sh.getRange(_statusStart, 1, r - _statusStart, 3)
    .setBorder(true, true, true, true, true, true, "#BDD7EE", SpreadsheetApp.BorderStyle.SOLID);
  r++;

  // --- Tab Summary ---
  const _tabStart = r;
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1).setValue("TAB SUMMARY")
    .setFontWeight("bold").setFontSize(11).setBackground("#2E75B6").setFontColor("#FFFFFF")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(r, 28);
  r++;

  sh.getRange(r, 1, 1, 2).setValues([["Tab", "Rows"]])
    .setFontWeight("bold").setBackground("#D6E4F0").setFontColor("#1F4E78").setFontSize(10);
  sh.getRange(r, 2).setHorizontalAlignment("right");
  sh.setRowHeight(r, 22);
  r++;

  [
    ["Day-After Orders",        dayAfter.length],
    ["Delivered Not Activated", delivered.length],
    ["Order Issues",            issues.length],
    ["Resolved (carried)",      resolved.length]
  ].forEach(function(row, i){
    sh.getRange(r, 1, 1, 2).setValues([row]).setFontSize(10)
      .setBackground(i % 2 === 0 ? "#FFFFFF" : "#F7FBFF");
    sh.getRange(r, 2).setHorizontalAlignment("right");
    sh.setRowHeight(r, 22);
    r++;
  });
  sh.getRange(_tabStart, 1, r - _tabStart, 2)
    .setBorder(true, true, true, true, true, true, "#BDD7EE", SpreadsheetApp.BorderStyle.SOLID);
  r++;

  // Footer
  sh.getRange(r, 1, 1, 4).merge();
  sh.getRange(r, 1)
    .setValue("Last updated: " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEE M/d/yyyy h:mm a"))
    .setFontStyle("italic").setFontColor("#888888").setFontSize(9).setHorizontalAlignment("right");
  sh.setRowHeight(r, 20);

  sh.setFrozenRows(1);
  sh.setTabColor("#434343");
}

// --- Date helpers -------------------------------------------------------- //
function parseDate(v) {
  if (!v && v !== 0) return null;
  if (v instanceof Date) {
    // Strip any time component so comparisons are date-only
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  let s = String(v).trim();
  if (!s || s.indexOf("9999") === 0) return null;
  // Strip trailing time component (e.g. "5/26/2026 12:00:00 AM" → "5/26/2026")
  s = s.replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*(AM|PM))?$/i, "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let yr = parseInt(m[3], 10);
    if (yr < 100) yr += 2000;
    return new Date(yr, parseInt(m[1],10)-1, parseInt(m[2],10));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function formatDate(v) { const d = parseDate(v); return d ? ((d.getMonth()+1) + "/" + d.getDate() + "/" + d.getFullYear()) : ""; }
function minDate(arr) { return new Date(Math.min.apply(null, arr.map(function(d){ return d.getTime(); }))); }
function dateOrMax(d) { return d ? d.getTime() : 8.64e15; }
// Returns the array of Order Date(s) that should be on today's Day-After list.
// Mondays sweep up Friday + Saturday + Sunday (no weekend calls).
// Other weekdays = just yesterday.
// Uses calendar arithmetic (not ms subtraction) to be DST-safe.
function getCallableOrderDates(today) {
  const y = today.getFullYear(), mo = today.getMonth(), d = today.getDate();
  const day = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const out = [];
  if (day === 1) {
    // Monday: include Fri (-3), Sat (-2), Sun (-1)
    for (let back = 3; back >= 1; back--) {
      out.push(new Date(y, mo, d - back));
    }
  } else {
    out.push(new Date(y, mo, d - 1));
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
// ORDER LOG IMPORT  (Master Tracker — all statuses, grouped by Customer+DSI)
// =========================================================================

function showOrderLogImportDialog() {
  _showRepImportDialog("Import Order Log CSV", "processOrderLogCsv");
}

function processOrderLogCsv(text) {
  try {
  if (!text || text.length < 10) throw new Error("File appears empty.");
  const ss = SpreadsheetApp.getActive();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const sample = text.substring(0, 500);
  const delim = sample.indexOf("\t") >= 0 ? "\t" : ",";
  const matrix = parseDelimitedText(text, delim);
  if (matrix.length < 2) throw new Error("File has no data rows.");

  // Map header names to column indices dynamically
  const header = matrix[0].map(function(h){ return String(h || "").trim(); });
  var col = function(name) { return header.indexOf(name); };

  const cRep       = col("Rep");
  const cCust      = col("Customer Name");
  const cSpm       = col("sp.SPM Number");
  const cOrder     = col("sp.Order Date (copy)");
  const cStatus    = col("Order Status");
  const cDtrStatus = col("DTR Status");                       // ICD OL: no "(enriched)" suffix
  const cProduct   = col("Product Type (Broken Out)");        // ICD OL: different capitalization
  const cDue       = col("SPE.DTR Current Due Date (date)");
  const cUnits     = col("Unit Count");
  const cNotes     = col("Notes.Note");
  // ICD-specific columns used to compute per-rep activation rates
  const cSpeStatus = col("spe.Status");                       // "Active" = activated line
  const cSalesAll  = col("Sales (All) (1)");                  // "1" = valid counted sale
  // Additional detail columns for Pending Lines and Activations tabs
  const cTn         = col("spe.TN");
  const cAcctBan    = col("spe.Account BAN");
  const cStatusDate = col("Status Date");
  const cDdDate     = col("cl.DD Date");
  const cShipDate   = col("Ship Date");

  // Preserve any notes / ratings already typed in the sheet
  const meta = collectExistingMeta(ss);

  // Build legacy notes lookup from _Notes Archive tab (DSI → note)
  const archiveLookup = {};
  (function() {
    var ash = ss.getSheetByName(NOTES_ARCHIVE_TAB);
    if (!ash) return;
    var aData = ash.getDataRange().getValues();
    for (var ai = 1; ai < aData.length; ai++) {
      var adsi  = String(aData[ai][0] || "").trim().toUpperCase();
      var anote = String(aData[ai][3] || "").trim();
      if (adsi && anote) archiveLookup[adsi] = anote;
    }
  })();

  // Derive activation bucket from order date
  var getBucket = function(d) {
    if (!d || isNaN(d.getTime())) return "";
    var diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
    if (diff <= 7)  return "0-7 Days";
    if (diff <= 14) return "8-14 Days";
    if (diff <= 30) return "15-30 Days";
    return "31-60 Days";
  };

  var parseDate = function(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  // ---- Pass 1: parse every raw line into a flat object ----
  const rawRows = [];
  for (var i = 1; i < matrix.length; i++) {
    var row = matrix[i];
    var get = function(c){ return c >= 0 ? String(row[c] || "").trim() : ""; };

    var rep      = get(cRep);
    var cust     = get(cCust);
    var spm      = get(cSpm);
    if (!rep && !cust) continue;

    var orderDate = parseDate(get(cOrder));
    var dueDate   = parseDate(get(cDue));
    var dtrStatus = get(cDtrStatus);
    var orderStatus = get(cStatus);
    // Use DTR Status as the primary status; fall back to Order Status if blank.
    var status    = normalizeStatus(dtrStatus || orderStatus);
    // Normalize product to a standard ICD category (Wireless / Air / Tablet/Wearable / Fiber / VoIP)
    var product   = normalizeProductTypeICD(get(cProduct));
    var units     = parseInt(get(cUnits), 10) || 1;
    var srcNote   = get(cNotes);

    rawRows.push({
      rep: rep, cust: cust, spm: spm,
      orderDate: orderDate, dueDate: dueDate,
      status: status,
      product: product, units: units, srcNote: srcNote,
      // ICD fields for activation rate computation
      speStatus:  get(cSpeStatus),
      salesAll:   get(cSalesAll),
      // Detail fields for Pending Lines / Activations tabs
      tn:         get(cTn),
      accountBan: get(cAcctBan),
      statusDate: parseDate(get(cStatusDate)),
      ddDate:     parseDate(get(cDdDate)),
      shipDate:   parseDate(get(cShipDate))
    });
  }

  // Load force-complete overrides (Customer+SPM pairs manually marked via menu)
  var forceCompleteKeys = readForceCompleteKeys(ss);

  // ---- Pass 2: group by Customer + SPM (same DSI = same group) ----
  var groups = {};
  var groupOrder = [];
  rawRows.forEach(function(r) {
    var k = r.cust + "||" + r.spm;
    if (!groups[k]) { groups[k] = []; groupOrder.push(k); }
    groups[k].push(r);
  });

  // ---- Pass 3: for each Customer+SPM group, build a merged tracker row.
  //      Master Tracker ALWAYS gets ALL lines for every customer.
  //      Completed Orders gets a row ONLY when ALL lines are done (or force-complete).
  //      Notes/ratings always reflect the full group — nothing is ever "resolved" here.
  // -----------------------------------------------------------------------

  // Helper: build one merged tracker row from a set of raw lines.
  // Notes/ratings are looked up from the full customer key so they survive
  // regardless of which subset we're building the row from.
  var buildRow = function(lineSet, custKey, products, allLines) {
    var perStatus = {};
    var totalLines = 0;
    lineSet.forEach(function(r) {
      perStatus[r.status] = (perStatus[r.status] || 0) + r.units;
      totalLines += r.units;
    });

    var sortedStatuses = Object.keys(perStatus).sort(function(a, b) {
      var pa = STATUS_PRIORITY[a] || 0, pb = STATUS_PRIORITY[b] || 0;
      if (pa !== pb) return pb - pa;
      return perStatus[b] - perStatus[a];
    });
    var primaryStatus = sortedStatuses[0];

    var affectedStatuses = sortedStatuses.map(function(s) {
      return s + " (" + perStatus[s] + (perStatus[s] === 1 ? " line" : " lines") + ")";
    }).join(", ");

    var latestOrderDate = null;
    lineSet.forEach(function(r) {
      if (r.orderDate && (!latestOrderDate || r.orderDate > latestOrderDate)) latestOrderDate = r.orderDate;
    });

    var earliestDue = null;
    lineSet.forEach(function(r) {
      if (r.dueDate && (!earliestDue || r.dueDate < earliestDue)) earliestDue = r.dueDate;
    });

    // Notes/ratings keyed on full customer (not subset) so they are shared
    var primaryRow = lineSet.filter(function(r){ return r.status === primaryStatus; })[0] || lineSet[0];
    var exact = [primaryRow.cust, primaryRow.spm, products, primaryStatus].join("||");
    var fk    = "__cust__" + primaryRow.cust + "||" + primaryRow.spm;
    var archiveNote = archiveLookup[primaryRow.spm.toUpperCase()] || "";
    var note        = meta.notes[exact]       || meta.notes[fk]       || archiveNote || primaryRow.srcNote || "";
    var rating      = meta.ratings[exact]     || meta.ratings[fk]     || "";
    var noteUpdated = meta.noteUpdated[exact] || meta.noteUpdated[fk] || "";

    return {
      "Activation Bucket": getBucket(latestOrderDate),
      "Order Date":        latestOrderDate || "",
      "Rep":               primaryRow.rep,
      "Customer Name":     primaryRow.cust,
      "SPM Number":        primaryRow.spm,
      "Product Type":      products,
      "Status":            primaryStatus,
      "Lines In Status":   totalLines,
      "Affected Statuses": affectedStatuses,
      "Ship Date":         "",
      "Current Due Date":  earliestDue || "",
      "Notes":             note,
      "Rating":            rating,
      "Last Seen":         today,
      "Note Updated":      noteUpdated
    };
  };  // end buildRow

  // ---- Pass 3: build Completed Orders rows --------------------------------
  // Master Tracker is now driven exclusively by the Activation CSV (buildCallList).
  // This import only populates Completed Orders: rows where ALL lines are done
  // (Active / Cancelled / Disconnected) or manually force-completed.
  var completedRows = [];

  groupOrder.forEach(function(k) {
    var lines = groups[k];

    // Collect all product types across the full order
    var productSet = {};
    lines.forEach(function(r) { if (r.product) productSet[r.product] = true; });
    var products = Object.keys(productSet).sort().join(", ");

    var custSpmKey  = lines[0].cust + "||" + lines[0].spm;
    var forceFinish = !!forceCompleteKeys[custSpmKey];

    // Pending lines: any line NOT in a completed status
    var pendingLines = lines.filter(function(r) { return COMPLETED_STATUSES.indexOf(r.status) < 0; });

    // Only write to Completed Orders when ALL lines are done (or force-complete)
    if (forceFinish || pendingLines.length === 0) {
      completedRows.push(buildRow(lines, custSpmKey, products, lines));
    }
  });

  if (rawRows.length === 0) throw new Error("No data rows found in file.");

  var sortRows = function(arr) {
    arr.sort(function(a, b) {
      var ba = BUCKET_ORDER[a["Activation Bucket"]] != null ? BUCKET_ORDER[a["Activation Bucket"]] : 99;
      var bb = BUCKET_ORDER[b["Activation Bucket"]] != null ? BUCKET_ORDER[b["Activation Bucket"]] : 99;
      if (ba !== bb) return ba - bb;
      return (STATUS_PRIORITY[b["Status"]] || 0) - (STATUS_PRIORITY[a["Status"]] || 0);
    });
  };
  sortRows(completedRows);

  // ---- Carry forward Completed Orders rows that dropped off this export ----
  // Use ALL customer+SPM keys from the current import as the dedup set so
  // carry-forward never re-adds anything that's still in the file.
  var activeKeys = {};
  groupOrder.forEach(function(k) { activeKeys[k] = true; });

  var resolvedForCompleted = [];

  var _carryForwardFrom = function(maxDays) {
    var prevSh = ss.getSheetByName(COMPLETED_TAB);
    if (!prevSh) return;
    var pData = prevSh.getDataRange().getValues();
    var pHIdx = findHeaderRowIdx(pData);
    if (pHIdx < 0) return;
    var pHead = pData[pHIdx].map(String);
    var pIdx  = {};
    HEADERS.forEach(function(h){ pIdx[h] = pHead.indexOf(h); });
    for (var ri = pHIdx + 1; ri < pData.length; ri++) {
      var mCust = String(pData[ri][pIdx["Customer Name"]] || "").trim();
      var mSpm  = String(pData[ri][pIdx["SPM Number"]]   || "").trim();
      if (!mCust || !mSpm) continue;
      if (activeKeys[mCust + "||" + mSpm]) continue;  // in current export — skip
      var mLastSeen = pData[ri][pIdx["Last Seen"]];
      if (mLastSeen instanceof Date && !isNaN(mLastSeen.getTime())) {
        if ((today.getTime() - mLastSeen.getTime()) / 86400000 > maxDays) continue;
      }
      var row = {};
      HEADERS.forEach(function(h){ if (pIdx[h] >= 0) row[h] = pData[ri][pIdx[h]]; });
      row["Last Seen"] = row["Last Seen"] || today;
      resolvedForCompleted.push(row);
    }
  };  // end _carryForwardFrom

  _carryForwardFrom(365);   // 1-year window for completed orders

  var allCompletedRows = completedRows.concat(resolvedForCompleted);

  writeRowsToTab(ss, COMPLETED_TAB, allCompletedRows, today,
    "Completed Orders  |  " + completedRows.length + " from today's log  +  " + resolvedForCompleted.length + " retained  (" + allCompletedRows.length + " total)",
    "#375623");

  // Re-hide the force-complete override sheet (it may have been opened via the menu)
  var _fcSh = ss.getSheetByName(FORCE_COMPLETE_TAB);
  if (_fcSh) try { _fcSh.hideSheet(); } catch(e) {}

  // ICD: compute per-rep activation rates from this Order Log import
  // (replaces the separate Activation Office CSV used in the standard tracker)
  computeActivationFromOrderLog(ss, rawRows, today);

  // ICD: build Day-After Orders from the Order Log (more reliable than the AOR
  // for ICD offices — overwrites whatever the AOR import may have written)
  writeDayAfterFromOl(ss, rawRows, today);

  // Build the Activations tab (all OL lines, cross-referenced against AOR)
  writeAllLinesTab(ss, rawRows, today);

  ss.setActiveSheet(ss.getSheetByName(COMPLETED_TAB));
  return "Done!  Completed: " + allCompletedRows.length +
         "  |  Raw lines: " + rawRows.length +
         (resolvedForCompleted.length > 0
           ? "  |  Carried forward: " + resolvedForCompleted.length
           : "");
  } catch(e) {
    throw new Error(e.message || String(e) || "Unknown error in processOrderLogCsv");
  }
}

// =========================================================================
// ICD DAY-AFTER ORDERS  (from Order Log — replaces AOR-based version)
// =========================================================================
//
// For ICD offices the Order Log is the more reliable source for Day-After
// because it captures every submitted order line with a precise order date.
// This function is called at the end of processOrderLogCsv() and overwrites
// whatever the AOR import may have written to the Day-After tab.
//
// Date rules (same as the standard tracker):
//   Monday  → show Friday, Saturday, and Sunday orders
//   All other days → show yesterday's orders
// =========================================================================

function writeDayAfterFromOl(ss, rawRows, today) {
  try {
    var callableDates = getCallableOrderDates(today);
    var dateDesc      = describeCallableDates(callableDates);

    // Filter OL rows whose order date falls on a callable date
    var filtered = rawRows.filter(function(r) {
      for (var i = 0; i < callableDates.length; i++) {
        if (sameDay(r.orderDate, callableDates[i])) return true;
      }
      return false;
    });

    if (filtered.length === 0) {
      writeRowsToTab(ss, DAY_AFTER_TAB, [], today,
        "Day-After Calls  |  orders placed " + dateDesc + "  (Order Log)  |  0 orders",
        "#548235");
      return;
    }

    // Group by Customer + SPM — one merged row per order, same as other tracker tabs
    var groups = {};
    var groupOrder = [];
    filtered.forEach(function(r) {
      var k = r.cust + "||" + r.spm;
      if (!groups[k]) { groups[k] = []; groupOrder.push(k); }
      groups[k].push(r);
    });

    var meta = collectExistingMeta(ss);

    var _getBucket = function(d) {
      if (!d || isNaN(d.getTime())) return "";
      var diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
      if (diff <= 7)  return "0-7 Days";
      if (diff <= 14) return "8-14 Days";
      if (diff <= 30) return "15-30 Days";
      return "31-60 Days";
    };

    var dayAfterRows = [];
    groupOrder.forEach(function(k) {
      var lines = groups[k];
      var first = lines[0];

      // Tally lines per status
      var perStatus  = {};
      var totalLines = 0;
      lines.forEach(function(r) {
        perStatus[r.status] = (perStatus[r.status] || 0) + r.units;
        totalLines += r.units;
      });

      var sortedStatuses = Object.keys(perStatus).sort(function(a, b) {
        return (STATUS_PRIORITY[b] || 0) - (STATUS_PRIORITY[a] || 0);
      });
      var primaryStatus = sortedStatuses[0];

      var affectedStatuses = sortedStatuses.map(function(s) {
        return s + " (" + perStatus[s] + (perStatus[s] === 1 ? " line" : " lines") + ")";
      }).join(", ");

      // Collect all product types across the order
      var productSet = {};
      lines.forEach(function(r) { if (r.product) productSet[r.product] = true; });
      var products = Object.keys(productSet).sort().join(", ");

      // Restore any saved notes / ratings
      var exact       = [first.cust, first.spm, products, primaryStatus].join("||");
      var fk          = "__cust__" + first.cust + "||" + first.spm;
      var note        = meta.notes[exact]       || meta.notes[fk]       || first.srcNote || "";
      var rating      = meta.ratings[exact]     || meta.ratings[fk]     || "";
      var noteUpdated = meta.noteUpdated[exact] || meta.noteUpdated[fk] || "";

      dayAfterRows.push({
        "Activation Bucket": _getBucket(first.orderDate),
        "Order Date":        first.orderDate || "",
        "Rep":               first.rep,
        "Customer Name":     first.cust,
        "SPM Number":        first.spm,
        "Product Type":      products,
        "Status":            primaryStatus,
        "Lines In Status":   totalLines,
        "Affected Statuses": affectedStatuses,
        "Ship Date":         "",
        "Current Due Date":  "",
        "Notes":             note,
        "Rating":            rating,
        "Last Seen":         today,
        "Note Updated":      noteUpdated
      });
    });

    // Sort: Rep A→Z, then oldest Order Date first within each rep
    dayAfterRows.sort(function(a, b) {
      var ra = (a["Rep"] || "").toLowerCase(), rb = (b["Rep"] || "").toLowerCase();
      if (ra < rb) return -1;
      if (ra > rb) return  1;
      var da = a["Order Date"] instanceof Date ? a["Order Date"].getTime() : 0;
      var db = b["Order Date"] instanceof Date ? b["Order Date"].getTime() : 0;
      return da - db;
    });

    writeRowsToTab(ss, DAY_AFTER_TAB, dayAfterRows, today,
      "Day-After Calls  |  orders placed " + dateDesc + "  (Order Log)  |  " + dayAfterRows.length + " orders",
      "#548235");
  } catch(err) {
    console.log("writeDayAfterFromOl error: " + (err && err.message));
  }
}

// =========================================================================
// ICD ACTIVATION RATE COMPUTATION  (from Order Log — no separate CSV)
// =========================================================================
//
// For ICD offices there is no "Activation Office CSV" from Tableau.
// Instead we calculate per-rep activation rates directly from the Order Log:
//   • "Sales (All) (1)" = 1  →  the line is a valid counted sale (volume)
//   • spe.Status = "Active"  →  the line activated
// We group by Rep + Activation Bucket (derived from sp.Order Date (copy)),
// compute Activated / Total and a %, then write the _Rep Activation Data
// helper tab in exactly the same format processRepActivationCsv() uses, so
// all downstream reporting (Rep Activation tab, Daily Report) works unchanged.
//
// Color thresholds (same convention as the imported CSV color flags):
//   Green  = activation rate >= 80 %
//   Yellow = activation rate >= 50 %
//   Red    = activation rate < 50 %
// =========================================================================

function computeActivationFromOrderLog(ss, rawRows, today) {
  try {
    // rawRows already has {rep, orderDate, speStatus, salesAll, ...}
    // Bucket periods we want to show (in order)
    var PERIODS = ["0-7 Days", "8-14 Days", "15-30 Days", "31-60 Days"];

    // repData[repName][period] = {act: N, vol: N}
    var repData   = {};
    var totals    = {};
    PERIODS.forEach(function(p){ totals[p] = {act: 0, vol: 0}; });

    rawRows.forEach(function(r) {
      var rep = (r.rep || "").trim();
      if (!rep) return;
      // Only count valid sales lines
      var isSale = String(r.salesAll || "").trim() === "1";
      if (!isSale) return;
      var bucket = _computeBucket(r.orderDate, today);
      if (!bucket) return;

      if (!repData[rep]) repData[rep] = {};
      if (!repData[rep][bucket]) repData[rep][bucket] = {act: 0, vol: 0};

      repData[rep][bucket].vol += 1;
      totals[bucket].vol        += 1;

      if (String(r.speStatus || "").trim().toLowerCase() === "active") {
        repData[rep][bucket].act += 1;
        totals[bucket].act        += 1;
      }
    });

    // Helper: build pct string + color label from act/vol
    var _pctAndColor = function(act, vol) {
      if (!vol) return {pct: "", color: "", ratio: ""};
      var pct    = Math.round(act / vol * 100);
      var color  = pct >= 80 ? "Green" : pct >= 50 ? "Yellow" : "Red";
      return {
        pct:   pct + "%",
        color: color,
        ratio: act + "/" + vol
      };
    };

    // Build the header row: Rep | 0-7 Days % | 0-7 Days Color | 0-7 Days Ratio | ...
    var headerRow = ["Rep"];
    PERIODS.forEach(function(p){
      headerRow.push(p + " %", p + " Color", p + " Ratio");
    });

    // Office total row
    var totalRow = ["_OFFICE_TOTAL"];
    PERIODS.forEach(function(p){
      var c = _pctAndColor(totals[p].act, totals[p].vol);
      totalRow.push(c.pct, "", c.ratio);   // Color left blank for office total
    });

    // Per-rep rows, sorted alphabetically
    var dataRows = [totalRow].concat(Object.keys(repData).sort().map(function(rep) {
      var row = [rep];
      PERIODS.forEach(function(p){
        var d = repData[rep][p] || {act: 0, vol: 0};
        var c = _pctAndColor(d.act, d.vol);
        row.push(c.pct, c.color, c.ratio);
      });
      return row;
    }));

    // Write helper tab (same format as processRepActivationCsv output)
    var sh = ss.getSheetByName(REP_ACTIVATION_TAB);
    if (!sh) sh = ss.insertSheet(REP_ACTIVATION_TAB);
    sh.clear();
    var totalCols = headerRow.length;
    sh.getRange(1, 1, dataRows.length + 1, totalCols).setNumberFormat("@");
    sh.getRange(1, 1, 1, totalCols).setValues([headerRow])
      .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF");
    sh.getRange(2, 1, dataRows.length, totalCols).setValues(dataRows);
    try { sh.hideSheet(); } catch(e) {}

    // Rebuild the visible Rep Activation + Rep Churn view tabs
    rebuildRepStatTabs(ss);
  } catch(err) {
    // Non-fatal: log but don't blow up the Order Log import
    console.log("computeActivationFromOrderLog error: " + (err && err.message));
  }
}

// =========================================================================
// LEGACY NOTES IMPORT  (Ignite / Elevate migration)
// =========================================================================

function showLegacyNotesImportDialog() {
  // These files are UTF-8 (Google Form exports) — NOT UTF-16 like Tableau exports
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:18px;">' +
      '<h3 style="margin-top:0;">Import Legacy Notes (Ignite / Elevate)</h3>' +
      '<p style="color:#555;font-size:13px;">Pick the CSV exported from the office Google Sheet. Run once per office file.</p>' +
      '<input type="file" id="file" accept=".csv,.txt" />' +
      '<p id="status" style="color:#1F4E78;font-weight:bold;min-height:18px;margin:14px 0;"></p>' +
      '<button id="go" style="background:#1F4E78;color:#fff;border:none;padding:10px 18px;border-radius:4px;cursor:pointer;font-size:14px;">Import</button>' +
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
            'document.getElementById("status").textContent = "Processing...";' +
            'google.script.run' +
              '.withSuccessHandler(function(msg){ document.getElementById("status").textContent = msg; setTimeout(function(){ google.script.host.close(); }, 3000); })' +
              '.withFailureHandler(function(err){ document.getElementById("status").textContent = "Error: " + (err && (err.message || JSON.stringify(err)) || "Unknown error"); document.getElementById("go").disabled = false; })' +
              '.processLegacyNotesCsv(text);' +
          '};' +
          'reader.onerror = function(){ document.getElementById("status").textContent = "Could not read file."; };' +
          'reader.readAsText(f, "UTF-8");' +
        '});' +
      '</script>' +
    '</div>'
  ).setWidth(460).setHeight(260);
  SpreadsheetApp.getUi().showModalDialog(html, "Import Legacy Notes");
}

function processLegacyNotesCsv(text) {
  if (!text || text.length < 10) throw new Error("File appears empty.");
  const ss = SpreadsheetApp.getActive();

  // These files are comma-delimited (Google Form exports)
  const matrix = parseDelimitedText(text, ",");
  if (matrix.length < 2) throw new Error("File has no data rows.");

  const header = matrix[0].map(function(h){ return String(h || "").trim(); });
  const cDsi    = header.indexOf("DSI");
  const cRep    = header.indexOf("Rep Name");
  const cClient = header.indexOf("Client Name");
  const cNotes  = header.indexOf("Notes");
  const cStatus = header.indexOf("Status");
  const cDate   = header.indexOf("Date of Sale");

  if (cDsi   < 0) throw new Error("DSI column not found — is this the right file?");
  if (cNotes < 0) throw new Error("Notes column not found — is this the right file?");

  // Get or create the hidden archive tab
  var sh = ss.getSheetByName(NOTES_ARCHIVE_TAB);
  if (!sh) {
    sh = ss.insertSheet(NOTES_ARCHIVE_TAB);
    sh.getRange(1, 1, 1, 6).setValues([["DSI", "Client Name", "Rep", "Notes", "Status", "Sale Date"]])
      .setFontWeight("bold").setBackground("#1F4E78").setFontColor("#FFFFFF");
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch(e) {}
  }

  // Build lookup of already-archived DSIs → sheet row number
  const existing = {};
  const archiveData = sh.getDataRange().getValues();
  for (var ai = 1; ai < archiveData.length; ai++) {
    var key = String(archiveData[ai][0] || "").trim().toUpperCase();
    if (key) existing[key] = ai + 1; // 1-based sheet row
  }

  var added = 0, updated = 0;
  const newRows = [];

  for (var i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const get = function(c){ return c >= 0 ? String(row[c] || "").trim() : ""; };

    const dsi    = get(cDsi).toUpperCase();
    const notes  = get(cNotes);
    const rep    = get(cRep);
    const client = get(cClient);
    const status = get(cStatus);
    const saleDate = get(cDate);

    if (!dsi || !notes) continue; // skip rows with no DSI or no note

    if (existing[dsi]) {
      // Update notes for an existing DSI — append if different
      const existingNote = String(archiveData[existing[dsi] - 1][3] || "").trim();
      if (existingNote !== notes) {
        sh.getRange(existing[dsi], 4).setValue(notes);
        updated++;
      }
    } else {
      newRows.push([dsi, client, rep, notes, status, saleDate]);
      existing[dsi] = true;
      added++;
    }
  }

  if (newRows.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, newRows.length, 6)
      .setNumberFormat("@") // prevent date coercion
      .setValues(newRows);
  }

  return "Legacy notes imported: " + added + " new DSIs added, " + updated + " updated. " +
         "Re-import your Order Log CSV to see the notes appear in the Master Tracker.";
}


// =========================================================================
// HOME TAB  — How To Use guide, written as the first sheet on open
// =========================================================================

function buildHomeTab() {
  var ss = SpreadsheetApp.getActive();

  var sh = ss.getSheetByName(HOME_TAB);
  if (!sh) sh = ss.insertSheet(HOME_TAB);
  sh.clear();
  sh.clearFormats();
  try { sh.getBandings().forEach(function(b){ b.remove(); }); } catch(e) {}
  try { sh.clearConditionalFormatRules(); } catch(e) {}

  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);

  sh.setColumnWidth(1, 28);
  sh.setColumnWidth(2, 220);
  sh.setColumnWidth(3, 340);
  sh.setColumnWidth(4, 200);
  sh.setColumnWidth(5, 28);
  sh.setColumnWidths(6, 10, 60);

  var r = 1;

  function banner(text, bg, fg, size) {
    sh.getRange(r, 1, 1, 5).merge()
      .setValue(text)
      .setBackground(bg || "#1F4E78")
      .setFontColor(fg || "#FFFFFF")
      .setFontWeight("bold")
      .setFontSize(size || 14)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle")
      .setWrap(true);
    sh.setRowHeight(r, (size || 14) > 14 ? 44 : 32);
    r++;
  }

  function sectionHeader(text, bg, fg) {
    sh.getRange(r, 2, 1, 4).merge()
      .setValue(text)
      .setBackground(bg || "#2E75B6")
      .setFontColor(fg || "#FFFFFF")
      .setFontWeight("bold")
      .setFontSize(11)
      .setVerticalAlignment("middle")
      .setHorizontalAlignment("left");
    sh.setRowHeight(r, 28);
    r++;
  }

  function tableHeader(cols) {
    sh.getRange(r, 2, 1, cols.length).setValues([cols])
      .setFontWeight("bold")
      .setBackground("#D6E4F0")
      .setFontColor("#1F4E78")
      .setFontSize(10)
      .setVerticalAlignment("middle");
    sh.setRowHeight(r, 22);
    r++;
  }

  function tableRow(cols, bg) {
    var range = sh.getRange(r, 2, 1, cols.length);
    range.setValues([cols]).setFontSize(10).setVerticalAlignment("top").setWrap(true);
    if (bg) range.setBackground(bg);
    sh.setRowHeight(r, 20);
    r++;
  }

  function step(num, title, detail) {
    sh.getRange(r, 2).setValue("Step " + num + "  —  " + title)
      .setFontWeight("bold").setFontColor("#1F4E78").setFontSize(10).setVerticalAlignment("top");
    sh.getRange(r, 3, 1, 2).merge().setValue(detail)
      .setFontSize(10).setWrap(true).setVerticalAlignment("top");
    sh.setRowHeight(r, 42);
    r++;
  }

  function spacer(h) { sh.setRowHeight(r, h || 10); r++; }

  // Title
  banner("DAILY CALL LIST  —  ICD CONSUMER DIVISION  —  HOW TO USE THIS SHEET", "#1F4E78", "#FFFFFF", 16);
  spacer(6);

  // Daily Workflow
  sectionHeader("DAILY WORKFLOW  (Do These Every Day In Order)", "#1F4E78", "#FFFFFF");
  spacer(4);
  step(1, "Import Order Log CSV",
    "Call List  >  Import Order Log CSV\nFile:  ICD Order Log.csv\nUpdates Completed Orders AND calculates Rep Activation rates automatically.");
  step(2, "Import ICD Activation Report",
    "Call List  >  Import CSV & Build\nFile:  ICD Activation Opportunity Report.csv\nUpdates Master Tracker, Day-After, Delivered, Issues, Escalations, and Daily Report.");
  step(3, "Make your calls  —  add notes and ratings",
    "Click any row on any tab  >  type in the Notes column  >  pick a Rating from the dropdown.\nNotes are preserved automatically on the next import.");
  step(4, "Force an order to Completed  (optional)",
    "Select the row on any tracker tab  >  Call List  >  Force Selected Row(s) to Completed.\nUse this when the reporting system hasn't updated yet but you know the order is done.\nRe-import the Order Log CSV to move the row to the Completed Orders tab.");
  step(5, "End of day  —  Refresh Daily Report",
    "Call List  >  Refresh Daily Report  (no file needed)\nBuilds the daily summary  —  copy and paste into your email recap.");
  spacer(8);

  // File Reference
  sectionHeader("CSV FILES  —  WHAT TO SELECT FOR EACH IMPORT");
  spacer(4);
  tableHeader(["Menu Item", "File to Select", "How Often"]);
  tableRow(["Import Order Log CSV",               "ICD Order Log.csv  (also computes activation rates)",  "Daily"], "#FFFFFF");
  tableRow(["Import CSV & Build",                 "ICD Activation Opportunity Report.csv",                 "Daily"], "#F9F9F9");
  tableRow(["Refresh Daily Report",               "(no file needed)",                                      "End of each day"], "#FFFFFF");
  tableRow(["Force Selected Row(s) to Completed", "(no file — select a row first)",                       "As needed"], "#FFFFFF");
  tableRow(["Import Rep Churn CSV",               "ICD Rep Churn.csv",                                     "When updated in Tableau"], "#F9F9F9");
  spacer(8);

  // Tabs Explained
  sectionHeader("TABS EXPLAINED");
  spacer(4);
  tableHeader(["Tab Name", "What Is In It", ""]);
  tableRow(["Master Tracker",           "Every active order across all statuses, grouped by Customer + DSI", ""], "#FFFFFF");
  tableRow(["Completed Orders",         "Orders where every line is Active, Cancelled, or Disconnected  —  fully done.\nAlso includes any orders manually forced here via the menu.", ""], "#F9F9F9");
  tableRow(["Day-After Orders",         "Yesterday's orders  —  your calls for today", ""], "#FFFFFF");
  tableRow(["Delivered Not Activated",  "Delivered but customer has not activated yet", ""], "#F9F9F9");
  tableRow(["Order Issues",             "Porting issues, payment problems, clusters", ""], "#FFFFFF");
  tableRow(["Escalations",              "Customers rated Poor or Bad  —  auto-added when rated", ""], "#F9F9F9");
  tableRow(["Rep Activation",           "Activation rate scorecard per rep", ""], "#FFFFFF");
  tableRow(["Rep Churn",                "Churn rate scorecard per rep", ""], "#F9F9F9");
  tableRow(["Daily Report",             "End-of-day summary formatted for email", ""], "#FFFFFF");
  tableRow(["Summary",                  "Running stats overview", ""], "#F9F9F9");
  spacer(8);

  // Ratings
  sectionHeader("RATINGS  —  USE THE DROPDOWN IN THE RATING COLUMN");
  spacer(4);
  tableHeader(["Rating", "What It Means", ""]);
  var ratings = [
    ["5 Stars  Excellent", "Great call  —  customer is happy",                   "#C6EFCE", "#1E5631"],
    ["4 Stars  Good",      "Solid call  —  no issues",                           "#E2EFDA", "#385723"],
    ["3 Stars  OK",        "Neutral  —  no major concerns",                      "#FFF2CC", "#7F6000"],
    ["2 Stars  Poor",      "Problem  —  automatically flags to Escalations tab", "#FCE4D6", "#9C0006"],
    ["1 Star   Bad",       "Serious issue  —  automatically flags to Escalations tab", "#F4CCCC", "#660000"],
    ["No Answer",          "Called  —  no response",                             "#EFEFEF", "#555555"]
  ];
  ratings.forEach(function(row) {
    sh.getRange(r, 2).setValue(row[0]).setBackground(row[2]).setFontColor(row[3]).setFontWeight("bold").setFontSize(10).setVerticalAlignment("middle");
    sh.getRange(r, 3, 1, 2).merge().setValue(row[1]).setBackground(row[2]).setFontColor(row[3]).setFontSize(10).setVerticalAlignment("middle");
    sh.setRowHeight(r, 22);
    r++;
  });
  spacer(8);

  // Activation Buckets
  sectionHeader("ACTIVATION BUCKETS  —  ORDER AGE COLOR CODING");
  spacer(4);
  tableHeader(["Bucket", "What It Means", ""]);
  var buckets = [
    ["0-7 Days",   "Order placed in the last week  —  newest",      "#C6EFCE", "#1E5631"],
    ["8-14 Days",  "1 to 2 weeks old",                              "#FFF2CC", "#7F6000"],
    ["15-30 Days", "Getting older  —  needs attention",             "#FCE4D6", "#7F2704"],
    ["31-60 Days", "Oldest  —  high priority follow-up",            "#F8CBAD", "#660000"]
  ];
  buckets.forEach(function(row) {
    sh.getRange(r, 2).setValue(row[0]).setBackground(row[2]).setFontColor(row[3]).setFontWeight("bold").setFontSize(10).setVerticalAlignment("middle");
    sh.getRange(r, 3, 1, 2).merge().setValue(row[1]).setFontSize(10).setVerticalAlignment("middle");
    sh.setRowHeight(r, 22);
    r++;
  });
  spacer(8);

  // Notes System
  sectionHeader("NOTES  —  HOW THEY ARE SAVED");
  spacer(4);
  sh.getRange(r, 2, 1, 3).merge()
    .setValue(
      "Notes are NEVER deleted when you re-import a CSV.\n" +
      "The script matches each customer by Customer Name + DSI and restores your notes automatically.\n\n" +
      "Notes priority order:\n" +
      "   1.  Notes you typed in any tab\n" +
      "   2.  Notes from the source CSV itself\n\n" +
      "Ratings work the same way  —  once set, they stick across imports.\n" +
      "Rating Poor or Bad  =  customer auto-appears in the Escalations tab."
    )
    .setFontSize(10).setWrap(true).setVerticalAlignment("top");
  sh.setRowHeight(r, 120);
  r++;
  spacer(10);

  // Scheduling / Appointments
  sectionHeader("ACTIVATION APPOINTMENTS  —  SCHEDULING SYSTEM");
  spacer(4);
  sh.getRange(r, 2, 1, 3).merge()
    .setValue(
      "Your spreadsheet includes a live online Activation Appointment Scheduler.\n" +
      "Customers and reps can book appointments at any time — confirmation and reminder emails are sent automatically.\n\n" +
      "See the 📅 Booking Portal tab for your booking links and a complete step-by-step guide."
    )
    .setFontSize(10).setWrap(true).setVerticalAlignment("top");
  sh.setRowHeight(r, 64);
  r++;
  spacer(4);
  tableHeader(["Tab", "What Is In It", ""]);
  tableRow(["Appointments",  "Every booking — upcoming, completed, and cancelled",    ""], "#FFFFFF");
  tableRow(["Activators",    "Activator profiles and weekly availability schedules",  ""], "#F9F9F9");
  tableRow(["Blocked Times", "One-off blocked dates/times per activator",             ""], "#FFFFFF");
  tableRow(["Admins",        "Admin users for the appointment dashboard",             ""], "#F9F9F9");
  spacer(8);

  // Footer
  sh.getRange(r, 1, 1, 5).merge()
    .setValue("This tab refreshes automatically every time you open the spreadsheet.")
    .setFontColor("#AAAAAA").setFontStyle("italic").setFontSize(9)
    .setHorizontalAlignment("center");

  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  sh.setTabColor("#1F4E78");

  // Build the companion Booking Portal tab
  try { buildBookingPortalTab(); } catch(e) {}
}

// =========================================================================
// PENDING LINES TAB  —  non-completed OL lines, one row per TN
// ACTIVATIONS TAB   —  every OL line (all statuses), one row per TN
// Both tabs are rebuilt fresh on every Order Log import.
// =========================================================================

/**
 * Writes the "Pending Lines" tab.
 *
 * PRIMARY SOURCE: AOR (Activation Opportunity Report) — the `aorRawRows` passed in
 * are the raw keyed objects from readRawTab(), one per individual line/TN.
 *
 * CROSS-REFERENCE: also reads the Activations tab (last OL import) and looks up
 * each line's SPM+TN.  If the OL reports the line as completed (Active / Cancelled /
 * Disconnected), that line is suppressed from Pending.  If the OL has a higher-
 * priority pending status (e.g. OL = "Porting Issue", AOR = "Pending"), the OL
 * status is shown so the rep sees the most actionable picture.
 *
 * Sorted oldest bucket first, then oldest order date within each bucket.
 */
function writePendingLinesTab(ss, aorRawRows, today) {
  try {
    var PENDING_HEADERS = [
      "Activation Bucket", "Order Date", "Rep", "Customer Name",
      "SPM Number", "Product Type", "Status", "Ship Date"
    ];
    var COL_WIDTHS = [130, 95, 120, 210, 120, 140, 140, 95];

    // ---- Build OL status lookup from the Activations tab (last OL import) ----
    // Key: "SPM|TN" → normalized OL status
    var olLookup = {};
    (function() {
      var actSh = ss.getSheetByName(ALL_LINES_TAB);
      if (!actSh) return;
      var d = actSh.getDataRange().getValues();
      if (d.length < 2) return;
      var hdr = d[0].map(String);
      var iSpm = hdr.indexOf("SPM Number");
      var iTn  = hdr.indexOf("TN");
      var iSt  = hdr.indexOf("Status");
      if (iSpm < 0 || iSt < 0) return;
      for (var ri = 1; ri < d.length; ri++) {
        var spm = String(d[ri][iSpm] || "").trim();
        var tn  = iTn >= 0 ? String(d[ri][iTn] || "").trim() : "";
        var st  = String(d[ri][iSt]  || "").trim();
        if (spm) {
          olLookup[spm + "|" + tn] = st;
          if (!olLookup[spm + "|"])    olLookup[spm + "|"] = st; // SPM-only fallback
        }
      }
    })();

    // ---- Convert AOR keyed-rows → normalized format, applying cross-reference ----
    var rows = [];
    aorRawRows.forEach(function(r) {
      var spm      = String(r[RAW_COLS.spm]      || "").trim();
      var tn       = RAW_COLS.tn ? String(r[RAW_COLS.tn] || "").trim() : "";
      var aorStatus = normalizeStatus(String(r[RAW_COLS.status] || "").trim());

      // Pick the "truer" status between AOR and OL
      var olStatus = olLookup[spm + "|" + tn] || olLookup[spm + "|"] || "";
      var finalStatus;
      if (olStatus && COMPLETED_STATUSES.indexOf(olStatus) >= 0) {
        finalStatus = olStatus;   // OL confirms line is done — will be filtered out below
      } else if (olStatus && (STATUS_PRIORITY[olStatus] || 0) > (STATUS_PRIORITY[aorStatus] || 0)) {
        finalStatus = olStatus;   // OL has a more urgent / specific pending status
      } else {
        finalStatus = aorStatus;  // AOR status is equal or better
      }

      // Pending tab only shows non-completed lines
      if (COMPLETED_STATUSES.indexOf(finalStatus) >= 0) return;

      rows.push({
        rep:       String(r[RAW_COLS.rep]      || "").trim(),
        cust:      String(r[RAW_COLS.customer] || "").trim(),
        spm:       spm,
        orderDate: parseDate(r[RAW_COLS.order]),
        status:    finalStatus,
        product:   String(r[RAW_COLS.product]  || "").trim(),
        tn:        tn,
        shipDate:  RAW_COLS.ship ? parseDate(r[RAW_COLS.ship]) : null
      });
    });

    // Sort: Rep A→Z, then oldest Order Date first within each rep
    rows.sort(function(a, b) {
      var ra = (a.rep || "").toLowerCase(), rb = (b.rep || "").toLowerCase();
      if (ra < rb) return -1;
      if (ra > rb) return  1;
      return (a.orderDate ? a.orderDate.getTime() : 0) -
             (b.orderDate ? b.orderDate.getTime() : 0);
    });

    _writeOlTab(ss, PENDING_TAB, PENDING_HEADERS, COL_WIDTHS, rows, today);
  } catch(err) {
    console.log("writePendingLinesTab error: " + (err && err.message));
  }
}

/**
 * Writes the "Activations" tab.
 *
 * PRIMARY SOURCE: Order Log — `olRawRows` are the structured {rep, cust, spm, ...}
 * objects from processOrderLogCsv(), one per individual OL line.
 *
 * CROSS-REFERENCE: also reads the Raw Import tab (AOR data) and looks up each
 * line's SPM+TN.  If the AOR has a higher-priority pending status than the OL
 * (e.g. AOR = "Porting Issue", OL = "Pending"), the AOR status is shown so the
 * Activations view reflects the most current picture across both sources.
 *
 * Shows ALL lines (pending + completed).  Sorted oldest order date first.
 */
function writeAllLinesTab(ss, olRawRows, today) {
  try {
    var ALL_HEADERS = [
      "Activation Bucket", "Order Date", "Rep", "Customer Name",
      "SPM Number", "Product Type", "Status", "Status Date", "DD Date"
    ];
    var COL_WIDTHS = [130, 95, 120, 210, 120, 140, 140, 95, 95];

    // ---- Build AOR status lookup from the Raw Import tab ----
    // Key: "SPM|TN" → normalized AOR status
    var aorLookup = {};
    (function() {
      var rawSh = ss.getSheetByName(RAW_TAB);
      if (!rawSh) return;
      var d = rawSh.getDataRange().getValues();
      if (d.length < 2) return;
      var hdr = d[0].map(String);
      var iSpm = hdr.indexOf(RAW_COLS.spm);
      var iTn  = RAW_COLS.tn  ? hdr.indexOf(RAW_COLS.tn)     : -1;
      var iSt  = hdr.indexOf(RAW_COLS.status);
      if (iSpm < 0 || iSt < 0) return;
      for (var ri = 1; ri < d.length; ri++) {
        var spm = String(d[ri][iSpm] || "").trim();
        var tn  = iTn >= 0 ? String(d[ri][iTn] || "").trim() : "";
        var st  = normalizeStatus(String(d[ri][iSt] || "").trim());
        if (spm) {
          aorLookup[spm + "|" + tn] = st;
          if (!aorLookup[spm + "|"]) aorLookup[spm + "|"] = st;
        }
      }
    })();

    // Apply cross-reference: prefer AOR status when it's a higher-priority pending status
    var rows = olRawRows.map(function(r) {
      var aorStatus = aorLookup[r.spm + "|" + (r.tn || "")] ||
                      aorLookup[r.spm + "|"] || "";
      var finalStatus = r.status;
      // Only override OL status with AOR if: AOR is a known pending status AND
      // has higher priority (more urgent) than what OL says.
      if (aorStatus &&
          COMPLETED_STATUSES.indexOf(aorStatus) < 0 &&
          (STATUS_PRIORITY[aorStatus] || 0) > (STATUS_PRIORITY[r.status] || 0)) {
        finalStatus = aorStatus;
      }
      // Return a shallow copy with the resolved status
      return {
        rep: r.rep, cust: r.cust, spm: r.spm,
        orderDate: r.orderDate, status: finalStatus,
        product: r.product, tn: r.tn,
        accountBan: r.accountBan, statusDate: r.statusDate,
        ddDate: r.ddDate, shipDate: r.shipDate
      };
    });

    // Sort: Rep A→Z, then oldest Order Date first within each rep
    rows.sort(function(a, b) {
      var ra = (a.rep || "").toLowerCase(), rb = (b.rep || "").toLowerCase();
      if (ra < rb) return -1;
      if (ra > rb) return  1;
      return (a.orderDate ? a.orderDate.getTime() : 0) -
             (b.orderDate ? b.orderDate.getTime() : 0);
    });

    _writeOlTab(ss, ALL_LINES_TAB, ALL_HEADERS, COL_WIDTHS, rows, today);
  } catch(err) {
    console.log("writeAllLinesTab error: " + (err && err.message));
  }
}

/**
 * Shared sheet-writer for the two per-line OL tabs.
 * Clears the tab, writes a header row, data rows, colour-codes
 * Activation Bucket and Status columns, sets column widths, and adds an auto-filter.
 */
function _writeOlTab(ss, tabName, headers, colWidths, rows, today) {
  var sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);
  sh.clear();
  sh.clearFormats();
  try { var f = sh.getFilter(); if (f) f.remove(); } catch(e) {}

  var nCols = headers.length;

  // Header row — dark-blue banner
  sh.getRange(1, 1, 1, nCols)
    .setValues([headers])
    .setFontWeight("bold")
    .setBackground("#1F4E78")
    .setFontColor("#FFFFFF")
    .setFontSize(10);
  sh.setFrozenRows(1);

  // Set column widths
  for (var ci = 0; ci < Math.min(colWidths.length, nCols); ci++) {
    sh.setColumnWidth(ci + 1, colWidths[ci]);
  }

  if (!rows || rows.length === 0) {
    try { sh.getRange(1, 1, 1, nCols).createFilter(); } catch(e) {}
    sh.setTabColor("#4472C4");
    return;
  }

  // --- Helpers -------------------------------------------------------

  var _getBucket = function(d) {
    if (!d || isNaN(d.getTime())) return "";
    var diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
    if (diff <= 7)  return "0-7 Days";
    if (diff <= 14) return "8-14 Days";
    if (diff <= 30) return "15-30 Days";
    return "31-60 Days";
  };

  var _fmt = function(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
  };

  // Column-name → value extractor (matches every possible header)
  var colMap = {
    "Activation Bucket": function(r) { return _getBucket(r.orderDate); },
    "Order Date":        function(r) { return _fmt(r.orderDate); },
    "Rep":               function(r) { return r.rep        || ""; },
    "Customer Name":     function(r) { return r.cust       || ""; },
    "SPM Number":        function(r) { return r.spm        || ""; },
    "Product Type":      function(r) { return r.product    || ""; },
    "TN":                function(r) { return r.tn         || ""; },
    "Status":            function(r) { return r.status     || ""; },
    "Ship Date":         function(r) { return _fmt(r.shipDate); },
    "Account BAN":       function(r) { return r.accountBan || ""; },
    "Status Date":       function(r) { return _fmt(r.statusDate); },
    "DD Date":           function(r) { return _fmt(r.ddDate); }
  };

  // --- Build value matrix and colour arrays in one pass ---------------

  var bucketColIdx = headers.indexOf("Activation Bucket");
  var statusColIdx  = headers.indexOf("Status");

  var values  = [];
  var bgArr   = [];
  var fgArr   = [];
  var fwArr   = [];

  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];

    // Values
    values.push(headers.map(function(h) {
      return colMap[h] ? colMap[h](r) : "";
    }));

    // Colour arrays (default = white bg, black fg, normal weight)
    var bg = []; var fg = []; var fw = [];
    for (var ci2 = 0; ci2 < nCols; ci2++) {
      bg.push(null);
      fg.push("#000000");
      fw.push("normal");
    }

    if (bucketColIdx >= 0) {
      var bc = BUCKET_COLORS[_getBucket(r.orderDate)];
      if (bc) { bg[bucketColIdx] = bc.bg; fg[bucketColIdx] = bc.fg; fw[bucketColIdx] = "bold"; }
    }
    if (statusColIdx >= 0) {
      var sc = STATUS_COLORS[r.status];
      if (sc) { bg[statusColIdx] = sc.bg; fg[statusColIdx] = sc.fg; fw[statusColIdx] = "bold"; }
    }

    bgArr.push(bg);
    fgArr.push(fg);
    fwArr.push(fw);
  }

  // --- Write data and formatting in batch calls -----------------------

  var dataRange = sh.getRange(2, 1, rows.length, nCols);
  dataRange.setNumberFormat("@").setValues(values);
  dataRange.setBackgrounds(bgArr).setFontColors(fgArr).setFontWeights(fwArr);

  // Auto-filter spanning header + data
  try { sh.getRange(1, 1, rows.length + 1, nCols).createFilter(); } catch(e) {}

  sh.setTabColor("#4472C4");
}
