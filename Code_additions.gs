// ============================================================
//  Code_additions.gs — Changes to apply to the campaign Code.gs
//  Apply these three additions to the shared Code.gs in Apps Script
// ============================================================


// ── CHANGE 1 ─────────────────────────────────────────────────
// Find this line in Code.gs:
//   const CHURN_REPORT_TAB = '_TableauChurnReport';
// Add these two lines directly after it:

const AOR_TAB = '_TableauAOR';
const ACTIVATION_RATES_TAB = '_TableauActivationRates';


// ── CHANGE 2 ─────────────────────────────────────────────────
// Find the readChurnReport() function in Code.gs.
// Add these two functions immediately after it:

function readAOR(ss) {
  var sheet = ss.getSheetByName(AOR_TAB);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    headers.forEach(function(h, j) {
      row[h || ('_col' + j)] = data[i][j] !== undefined ? data[i][j] : '';
    });
    rows.push(row);
  }
  return rows;
}

function readActivationRates(ss) {
  var sheet = ss.getSheetByName(ACTIVATION_RATES_TAB);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    headers.forEach(function(h, j) {
      row[h || ('_col' + j)] = data[i][j] !== undefined ? data[i][j] : '';
    });
    rows.push(row);
  }
  return rows;
}


// ── CHANGE 3 ─────────────────────────────────────────────────
// Find the data object in doGet() — it looks like this:
//   const data = {
//     ...
//     churnReport: readChurnReport(ss)
//   };
// Change the churnReport line to:
//     churnReport: readChurnReport(ss),
//     aorData: readAOR(ss),
//     activationRates: readActivationRates(ss)
