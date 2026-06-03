// ===================================================================
// Campaign Dashboard - Google Apps Script Middleware
// ===================================================================
const TAB = {
  SALES: '_Sales', ROSTER: '_Roster', TEAMS: '_Teams',
  TEAM_CUSTOM: '_TeamCustom', OVERRIDES: '_Overrides',
  UNLOCKS: '_Unlocks', SETTINGS: '_Settings', CHALLENGE: '_Challenge'
};
const TABLEAU_TAB = '_TableauOrderLog';
const CHURN_REPORT_TAB = '_TableauChurnReport';
const AOR_TAB = '_TableauAOR';
const ACTIVATION_RATES_TAB = '_TableauActivationRates';
var OFFICE_OWNER_MAP = {
  'midspire': 'atomic marketing, inc.',
  'viridian': 'viridian, inc.',
  'elevate': 'elevate marketing team, inc.',
  'ignite': 'ignite solutions, inc.'
};
var RATINGS_VALID = ['No Answer','1 Star','2 Stars','3 Stars','4 Stars','5 Stars'];
function officeTab(base, officeId) { return base + '_' + officeId; }
const DEFAULT_OFFICE_ID = 'midspire';
function buildTeamEmojiMaps(ss, officeId) {
  var emojiMap = {}, nameMap = {};
  var sheet = ss.getSheetByName(officeTab(TAB.TEAMS, officeId));
  if (!sheet) return { emojiMap: emojiMap, nameMap: nameMap };
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][1] || '').trim();
    var emoji = String(data[i][4] || '').trim();
    if (name && emoji) { emojiMap[emoji] = name; nameMap[name] = emoji; }
  }
  return { emojiMap: emojiMap, nameMap: nameMap };
}
const LEADER_RANKS = ["master-admin","owner","admin","activator","manager","jd","l1"];
const OL = {
  TIMESTAMP: 0, EMAIL: 1, REP_NAME: 2, DATE_OF_SALE: 3, CAMPAIGN: 4,
  DSI: 5, ACCOUNT_TYPE: 6, CLIENT_NAME: 7, TRAINEE: 8, TRAINEE_NAME: 9,
  AIR: 10, NEW_PHONES: 11, BYODS: 12, CELL: 13, FIBER: 14,
  FIBER_PACKAGE: 15, INSTALL_DATE: 16, VOIP_QTY: 17, DTV: 18, DTV_PACKAGE: 19,
  OOMA_PACKAGE: 20, ACCOUNT_NOTES: 21, ACTIVATION_SUPPORT: 22, TEAM_EMOJI: 23,
  YESES: 24, UNITS: 25, STATUS: 26, NOTES: 27, PAID_OUT: 28, TICKETS: 29,
  ORDER_CHANNEL: 30, CODES_USED_BY: 31, SPE_CACHE: 32
};
const OL_LEGACY = {
  TIMESTAMP: 0, EMAIL: 2, DATE_OF_SALE: 3, REP_NAME: 4, DSI: 5,
  TRAINEE: 6, TRAINEE_NAME: 7, VOIP_QTY: 20, TEAM_EMOJI: 26,
  FIBER: 31, AIR: 32, DTV: 33, YESES: 34, CELL: 35, UNITS: 36,
  STATUS: 38, NOTES: 39, PAID_OUT: 40, TICKETS: 41
};
const TOL_HEADER_MAP = {
  "owner & office": "OWNER_OFFICE", "owner and office": "OWNER_OFFICE",
  "rep": "REP", "icd.lead rep id": "LEAD_REP_ID", "lead rep id": "LEAD_REP_ID",
  "rep.rep number": "REP_NUMBER", "rep number": "REP_NUMBER",
  "sp.order date (copy)": "ORDER_DATE", "order date (copy)": "ORDER_DATE", "order date": "ORDER_DATE",
  "order time (timezone)": "ORDER_TIME", "order time": "ORDER_TIME",
  "sp.spm number": "DSI", "spm number": "DSI", "dsi": "DSI",
  "spe.name": "SPE", "spe name": "SPE", "spe": "SPE",
  "spe.account ban": "BAN", "account ban": "BAN", "ban": "BAN",
  "product type (broken out)": "PRODUCT_TYPE", "product type": "PRODUCT_TYPE",
  "cru/iru": "CRU_IRU", "cru / iru": "CRU_IRU",
  "dtr status (enriched)": "DTR_STATUS", "dtr status": "DTR_STATUS",
  "disconnect reason (consolidated)": "DISCO_REASON",
  "disconnect reason": "DISCO_REASON", "disco reason": "DISCO_REASON",
  "spe.port carrier": "PORT_CARRIER", "port carrier": "PORT_CARRIER",
  "notes.note": "NOTES", "notes": "NOTES",
  "dtr status date": "DTR_STATUS_DATE", "order status": "ORDER_STATUS",
  "spe.dtr posted date (copy)": "POSTED_DATE",
  "posted date (copy)": "POSTED_DATE", "posted date": "POSTED_DATE",
  "max posted": "MAX_POSTED", "first streaming date": "FIRST_STREAMING",
  "first streaming": "FIRST_STREAMING", "voice line count": "VOICE_LINE_COUNT",
  "spe.tn type": "TN_TYPE", "tn type": "TN_TYPE",
  "spe.phone": "PHONE", "phone": "PHONE",
  "spe.install date": "INSTALL_DATE", "install date": "INSTALL_DATE",
  "b2b rep volume bonus tiers": "BONUS_TIERS", "bonus tiers": "BONUS_TIERS",
  "tier bonus payout/dnq reason": "PAYOUT_REASON", "payout reason": "PAYOUT_REASON",
  "unit count": "UNIT_COUNT", "total volume": "TOTAL_VOLUME",
  "total activations": "TOTAL_ACTS", "total acts": "TOTAL_ACTS"
};
function buildTableauColumnMap(headerRow) {
  var col = {};
  for (var i = 0; i < headerRow.length; i++) {
    var raw = String(headerRow[i] || '').trim().toLowerCase();
    var key = TOL_HEADER_MAP[raw];
    if (key && !col.hasOwnProperty(key)) col[key] = i;
  }
  return col;
}
function tCol(row, col, key) { return col.hasOwnProperty(key) ? row[col[key]] : ''; }
function getApiKey() { return PropertiesService.getScriptProperties().getProperty('API_KEY') || ''; }
function validateKey(key) { const expected = getApiKey(); if (!expected) return true; return key === expected; }
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function getSheet(params) {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '';
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(ss, tabName, baseName) {
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    switch (baseName) {
      case TAB.SALES:
        sheet.appendRow(['Timestamp','Email','Rep Name','Date of Sale','Campaign','DSI','Account Type','Client Name','Trainee','Trainee Name','Air','New Phones','BYODs','Cell','Fiber','Fiber Package','Install Date','VoIP Qty','DTV','DTV Package','Ooma Package','Account Notes','Activation Support','Team Emoji','Yeses','Units','Status','Notes','Paid Out','Tickets','Order Channel','Codes Used By','SPE Cache']); break;
      case TAB.ROSTER: sheet.appendRow(['email','name','team','rank','deactivated','dateAdded','pinHash','phone','tableauName','permissions']); break;
      case TAB.OVERRIDES: sheet.appendRow(['key','product','status','date','order','notes_json']); break;
      case TAB.TEAM_CUSTOM: sheet.appendRow(['persona','emoji','displayName']); break;
      case TAB.UNLOCKS: sheet.appendRow(['persona','status']); break;
      case TAB.TEAMS: sheet.appendRow(['teamId','name','parentId','leaderId','emoji','createdDate']); break;
      case TAB.SETTINGS: sheet.appendRow(['key','value']); break;
      case TAB.CHALLENGE: sheet.appendRow(['rowType','key','value']); break;
    }
  }
  return sheet;
}
function findRow(sheet, colIndex, value) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]).trim() === String(value).trim()) return i + 1;
  }
  return -1;
}
function findRowCI(sheet, colIndex, value) {
  const data = sheet.getDataRange().getValues();
  const target = String(value).trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]).trim().toLowerCase() === target) return i + 1;
  }
  return -1;
}
function hashPin(email, pin) {
  var input = String(email).trim().toLowerCase() + ':' + String(pin).trim();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return digest.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

// ── OFFICE FILTERING ─────────────────────────────────────────────────────
function _officeMatch(officeId) { return (OFFICE_OWNER_MAP[officeId]||'').toLowerCase(); }

function _filterByOffice(rows, col, officeId) {
  var match = _officeMatch(officeId);
  if (!match) return rows;
  return rows.filter(function(row) {
    return String(tCol(row,col,'OWNER_OFFICE')||'').toLowerCase().indexOf(match) !== -1;
  });
}

function _buildTolRow(row, col, allRows) {
  var rawDate = tCol(row,col,'ORDER_DATE');
  var d = rawDate instanceof Date ? rawDate : (rawDate ? new Date(rawDate) : null);
  var productCounts = {}, statusCounts = {};
  (allRows || [row]).forEach(function(r) {
    var pt = String(tCol(r,col,'PRODUCT_TYPE')||'').trim();
    if (pt) productCounts[pt] = (productCounts[pt]||0) + 1;
    var st = String(tCol(r,col,'DTR_STATUS')||'').trim() || 'Null';
    statusCounts[st] = (statusCounts[st]||0) + 1;
  });
  return {
    dsi:           String(tCol(row,col,'DSI')||'').trim(),
    rep:           String(tCol(row,col,'REP')||'').trim(),
    ownerOffice:   String(tCol(row,col,'OWNER_OFFICE')||'').trim(),
    spe:           String(tCol(row,col,'SPE')||'').trim(),
    productType:   String(tCol(row,col,'PRODUCT_TYPE')||'').trim(),
    productCounts: productCounts,
    orderDate:     (d && !isNaN(d.getTime())) ? d.toISOString().split('T')[0] : '',
    dtrStatus:     String(tCol(row,col,'DTR_STATUS')||'').trim(),
    statusCounts:  statusCounts,
    orderStatus:   String(tCol(row,col,'ORDER_STATUS')||'').trim(),
    portCarrier:   String(tCol(row,col,'PORT_CARRIER')||'').trim(),
    discoReason:   String(tCol(row,col,'DISCO_REASON')||'').trim(),
    phone:         String(tCol(row,col,'PHONE')||'').trim(),
    installDate:   String(tCol(row,col,'INSTALL_DATE')||'').trim(),
    unitCount:     Number(tCol(row,col,'UNIT_COUNT'))||0
  };
}

// Returns filtered rows from both _TableauOrderLog and _TableauAOR.
// TOL is primary; AOR fills in DSIs not already seen in TOL.
// Collects ALL lines per DSI, then calls processFn(firstRow, col, dsi, allRows).
function _readBothLogs(ss, officeId, processFn) {
  var dsiRows = {}, dsiCols = {}, tolDsis = {};
  var tabs = [TABLEAU_TAB, AOR_TAB];
  for (var t = 0; t < tabs.length; t++) {
    var sheet = ss.getSheetByName(tabs[t]); if (!sheet) continue;
    var sheetData = sheet.getDataRange().getValues(); if (sheetData.length < 2) continue;
    var col = buildTableauColumnMap(sheetData[0]);
    var filtered = _filterByOffice(sheetData.slice(1), col, officeId);
    for (var i = 0; i < filtered.length; i++) {
      var row = filtered[i];
      var dsi = String(tCol(row,col,'DSI')||'').trim();
      if (!dsi) continue;
      if (t === 1 && tolDsis[dsi]) continue;
      if (!dsiRows[dsi]) { dsiRows[dsi] = []; dsiCols[dsi] = col; }
      dsiRows[dsi].push(row);
    }
    if (t === 0) Object.keys(dsiRows).forEach(function(d) { tolDsis[d] = true; });
  }
  var results = [];
  Object.keys(dsiRows).forEach(function(dsi) {
    var rows = dsiRows[dsi]; var col = dsiCols[dsi];
    var result = processFn(rows[0], col, dsi, rows);
    if (result) results.push(result);
  });
  return results;
}

function _parseDateLocal(raw) {
  if (raw instanceof Date) { var d=new Date(raw.getTime()); d.setHours(0,0,0,0); return d; }
  var s=String(raw).trim(); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { var d2=new Date(Number(m[1]),Number(m[2])-1,Number(m[3])); return d2; }
  var d3=new Date(s); if (!isNaN(d3.getTime())) { d3.setHours(0,0,0,0); return d3; }
  return null;
}
function readDayAfterOrders(ss, officeId) {
  var today = new Date(); today.setHours(0,0,0,0);
  var dow = today.getDay();
  var targets = [];
  if (dow === 1) {
    targets.push(new Date(today.getTime()-3*86400000).getTime()); // Fri
    targets.push(new Date(today.getTime()-2*86400000).getTime()); // Sat
    targets.push(new Date(today.getTime()-1*86400000).getTime()); // Sun
  } else {
    targets.push(new Date(today.getTime()-86400000).getTime()); // yesterday
  }
  // Scan BOTH logs independently — check every row's date, then deduplicate by DSI.
  // This ensures a DSI whose yesterday entry is only in AOR (but has an older TOL entry)
  // is not silently dropped.
  var dsiRows={}, dsiCols={};
  var tabs=[TABLEAU_TAB,AOR_TAB];
  for (var t=0;t<tabs.length;t++) {
    var sheet=ss.getSheetByName(tabs[t]); if (!sheet) continue;
    var sheetData=sheet.getDataRange().getValues(); if (sheetData.length<2) continue;
    var col=buildTableauColumnMap(sheetData[0]);
    var filtered=_filterByOffice(sheetData.slice(1),col,officeId);
    for (var i=0;i<filtered.length;i++) {
      var row=filtered[i];
      var dsi=String(tCol(row,col,'DSI')||'').trim(); if (!dsi) continue;
      var od=_parseDateLocal(tCol(row,col,'ORDER_DATE')); if (!od) continue;
      if (targets.indexOf(od.getTime())===-1) continue;
      if (!dsiRows[dsi]) { dsiRows[dsi]=[]; dsiCols[dsi]=col; }
      dsiRows[dsi].push(row);
    }
  }
  var results=[];
  Object.keys(dsiRows).forEach(function(dsi) {
    results.push(_buildTolRow(dsiRows[dsi][0],dsiCols[dsi],dsiRows[dsi]));
  });
  return results;
}

function readDeliveredNotActive(ss, officeId) {
  var MATCH = ['delivered','shipped','open'];
  return _readBothLogs(ss, officeId, function(row, col, dsi, allRows) {
    var qualifies = allRows.some(function(r) {
      var s = String(tCol(r,col,'DTR_STATUS')||'').toLowerCase();
      return MATCH.some(function(m) { return s.indexOf(m) !== -1; });
    });
    if (!qualifies) return null;
    return _buildTolRow(row, col, allRows);
  });
}

function readOrderIssues(ss, officeId) {
  var portLines = {}, byDsi = {}, dsiAllRows = {}, dsiCols = {}, tolDsis = {};
  var tabs = [TABLEAU_TAB, AOR_TAB];
  for (var t = 0; t < tabs.length; t++) {
    var sheet = ss.getSheetByName(tabs[t]); if (!sheet) continue;
    var sheetData = sheet.getDataRange().getValues(); if (sheetData.length < 2) continue;
    var col = buildTableauColumnMap(sheetData[0]);
    var filtered = _filterByOffice(sheetData.slice(1), col, officeId);
    for (var i = 0; i < filtered.length; i++) {
      var row = filtered[i];
      var dsi = String(tCol(row,col,'DSI')||'').trim(); if (!dsi) continue;
      if (t === 1 && tolDsis[dsi]) continue;
      var portCarrier = String(tCol(row,col,'PORT_CARRIER')||'').trim();
      var productType = String(tCol(row,col,'PRODUCT_TYPE')||'').toLowerCase();
      var dtrStatus   = String(tCol(row,col,'DTR_STATUS')||'').toLowerCase();
      var isPorting   = portCarrier.length > 0;
      var isBYOD      = productType.indexOf('byod') !== -1;
      var isPayment   = dtrStatus.indexOf('valid payment') !== -1 || dtrStatus.indexOf('payment') !== -1;
      if (isPorting) portLines[dsi] = (portLines[dsi]||0) + 1;
      if (isPorting||isBYOD||isPayment) {
        if (!dsiAllRows[dsi]) { dsiAllRows[dsi] = []; dsiCols[dsi] = col; }
        dsiAllRows[dsi].push(row);
        if (!byDsi[dsi]) {
          var r = _buildTolRow(row, col);
          r.issueType = isPorting ? 'Porting' : isPayment ? 'Pending Payment' : 'BYOD';
          byDsi[dsi] = r;
        }
      }
    }
    if (t === 0) { Object.keys(byDsi).forEach(function(d) { tolDsis[d] = true; }); }
  }
  return Object.keys(byDsi).map(function(dsi) {
    var result = byDsi[dsi];
    result.heldBackLines = portLines[dsi]||0;
    if (dsiAllRows[dsi]) {
      var productCounts = {}, statusCounts = {};
      dsiAllRows[dsi].forEach(function(r) {
        var pt = String(tCol(r,dsiCols[dsi],'PRODUCT_TYPE')||'').trim();
        if (pt) productCounts[pt] = (productCounts[pt]||0) + 1;
        var st = String(tCol(r,dsiCols[dsi],'DTR_STATUS')||'').trim() || 'Null';
        statusCounts[st] = (statusCounts[st]||0) + 1;
      });
      result.productCounts = productCounts;
      result.statusCounts = statusCounts;
    }
    return result;
  });
}

// ── NOTES & RATINGS ──────────────────────────────────────────────────────
function readNotes(ss, officeId) {
  var sheet = ss.getSheetByName('_Notes_'+officeId); if (!sheet) return {};
  var data = sheet.getDataRange().getValues(); if (data.length < 2) return {};
  var out = {};
  for (var i=1;i<data.length;i++) {
    var dsi = String(data[i][0]||'').trim(); if (!dsi) continue;
    if (!out[dsi]) out[dsi] = [];
    out[dsi].push({ ts: data[i][1]?new Date(data[i][1]).toISOString():'', authorEmail:String(data[i][2]||'').trim(), authorName:String(data[i][3]||'').trim(), noteText:String(data[i][4]||'').trim(), noteType:String(data[i][5]||'activation').trim() });
  }
  return out;
}

function readRatings(ss, officeId) {
  var sheet = ss.getSheetByName('_Ratings_'+officeId); if (!sheet) return {};
  var data = sheet.getDataRange().getValues(); if (data.length < 2) return {};
  var out = {};
  for (var i=1;i<data.length;i++) { var dsi=String(data[i][0]||'').trim(); if (dsi) out[dsi]=String(data[i][1]||'').trim(); }
  return out;
}

function writeNoteEntry(body, ss, officeId) {
  var dsi=String(body.dsi||'').trim(), noteText=String(body.noteText||'').trim();
  var authorEmail=String(body.authorEmail||'').trim().toLowerCase(), authorName=String(body.authorName||'').trim();
  var noteType=String(body.noteType||'activation').trim();
  if (!dsi||!noteText) return { error:'missing dsi or noteText' };
  var tabName='_Notes_'+officeId;
  var sheet=ss.getSheetByName(tabName);
  if (!sheet) { sheet=ss.insertSheet(tabName); sheet.appendRow(['dsi','timestamp','authorEmail','authorName','noteText','noteType']); sheet.getRange(1,1,1,6).setFontWeight('bold'); sheet.setFrozenRows(1); }
  sheet.appendRow([dsi, new Date(), authorEmail, authorName, noteText, noteType]);
  return { ok:true, ts:new Date().toISOString() };
}

function writeRatingEntry(body, ss, officeId) {
  var dsi=String(body.dsi||'').trim(), rating=String(body.rating||'').trim();
  var updatedBy=String(body.updatedBy||'').trim().toLowerCase();
  if (!dsi||!rating) return { error:'missing dsi or rating' };
  if (RATINGS_VALID.indexOf(rating)===-1) return { error:'invalid rating' };
  var tabName='_Ratings_'+officeId;
  var sheet=ss.getSheetByName(tabName);
  if (!sheet) { sheet=ss.insertSheet(tabName); sheet.appendRow(['dsi','rating','lastUpdated','updatedBy']); sheet.getRange(1,1,1,4).setFontWeight('bold'); sheet.setFrozenRows(1); }
  var data=sheet.getDataRange().getValues();
  for (var i=1;i<data.length;i++) { if (String(data[i][0]||'').trim()===dsi) { sheet.getRange(i+1,2,1,3).setValues([[rating,new Date(),updatedBy]]); return { ok:true }; } }
  sheet.appendRow([dsi, rating, new Date(), updatedBy]);
  return { ok:true };
}

function doGet(e) {
  const key = (e && e.parameter && e.parameter.key) || '';
  if (!validateKey(key)) return jsonResponse({ error: 'unauthorized' });
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    const officeId = (e && e.parameter && e.parameter.officeId) || DEFAULT_OFFICE_ID;
    const ss = getSheet(e && e.parameter);
    if (action === 'debugOrderLog') {
      var sheet = ss.getSheetByName(TABLEAU_TAB);
      if (!sheet) return jsonResponse({ error: 'No _TableauOrderLog tab found' });
      var dbgData = sheet.getDataRange().getValues();
      var col = buildTableauColumnMap(dbgData[0]);
      var allRows = dbgData.slice(1);
      var officeRows = _filterByOffice(allRows, col, officeId);
      // Count DTR statuses in office rows
      var dtrCounts = {};
      officeRows.forEach(function(row) {
        var s = String(tCol(row,col,'DTR_STATUS')||'(empty)').trim();
        dtrCounts[s] = (dtrCounts[s]||0) + 1;
      });
      // Sample owner values from first 3 rows
      var ownerSamples = allRows.slice(0,3).map(function(row) {
        return JSON.stringify(String(tCol(row,col,'OWNER_OFFICE')||''));
      });
      return jsonResponse({
        totalRows: allRows.length,
        headers: dbgData[0],
        columnMap: col,
        officeFilteredRows: officeRows.length,
        dtrStatusCounts: dtrCounts,
        ownerSamples: ownerSamples,
        officeMatchString: _officeMatch(officeId)
      });
    }
    if (action === 'readOrders') {
      const filterEmail = (e.parameter && e.parameter.email) || '';
      return jsonResponse({ orders: readOrders(ss, officeId, filterEmail || null) });
    }
    if (action === 'readPayrollOrders') {
      var payrollMode = (e.parameter && e.parameter.payrollMode) || 'commission-split';
      return jsonResponse({ orders: readPayrollOrders(ss, officeId, payrollMode) });
    }
    if (action === 'readTableauSummary') return jsonResponse(getTableauSummaryWithCache(ss, officeId));
    if (action === 'readDayAfter') return jsonResponse({ orders: readDayAfterOrders(ss, officeId) });
    if (action === 'readDelivered') return jsonResponse({ orders: readDeliveredNotActive(ss, officeId) });
    if (action === 'readIssues') return jsonResponse({ orders: readOrderIssues(ss, officeId) });
    if (action === 'readNotes') return jsonResponse({ notes: readNotes(ss, officeId) });
    if (action === 'readRatings') return jsonResponse({ ratings: readRatings(ss, officeId) });
    if (action === 'readRepNames') {
      var rnSheet=ss.getSheetByName(TABLEAU_TAB); if (!rnSheet) return jsonResponse({ names:[] });
      var rnData=rnSheet.getDataRange().getValues(); if (rnData.length<2) return jsonResponse({ names:[] });
      var rnCol=buildTableauColumnMap(rnData[0]);
      var rnFiltered=_filterByOffice(rnData.slice(1),rnCol,officeId);
      var rnNames={};
      rnFiltered.forEach(function(row){ var n=String(tCol(row,rnCol,'REP')||'').trim(); if (n) rnNames[n]=true; });
      return jsonResponse({ names:Object.keys(rnNames).sort() });
    }
    if (action === 'debugDsi') {
      var targetDsi=(e.parameter&&e.parameter.dsi)||'';
      var today=new Date(); today.setHours(0,0,0,0);
      var yesterday=new Date(today.getTime()-86400000);
      var lines=['TODAY='+today.toDateString(),'YESTERDAY='+yesterday.toDateString(),'OFFICE_MATCH_STRING='+_officeMatch(officeId)];
      [TABLEAU_TAB,AOR_TAB].forEach(function(tabName){
        var s=ss.getSheetByName(tabName); if(!s){lines.push(tabName+':MISSING');return;}
        var d=s.getDataRange().getValues(); var col=buildTableauColumnMap(d[0]); var found=0;
        for(var i=1;i<d.length;i++){
          if(String(tCol(d[i],col,'DSI')||'').trim()!==targetDsi) continue; found++;
          var raw=tCol(d[i],col,'ORDER_DATE'); var od=_parseDateLocal(raw);
          var owner=String(tCol(d[i],col,'OWNER_OFFICE')||'');
          lines.push('['+tabName+'] rawDate='+String(raw)+' | parsed='+(od?od.toDateString():'null')+
            ' | matchYest='+(od?(od.getTime()===yesterday.getTime()):false)+
            ' | passOffice='+( owner.toLowerCase().indexOf(_officeMatch(officeId))!==-1 )+
            ' | rep='+String(tCol(d[i],col,'REP')||'')+
            ' | status='+String(tCol(d[i],col,'DTR_STATUS')||''));
        }
        if(!found) lines.push('['+tabName+'] DSI NOT FOUND');
      });
      return jsonResponse({debug:lines});
    }
    if (action === 'readTableauDetail') {
      const dsi = (e.parameter && e.parameter.dsi) || '';
      return jsonResponse({ devices: readTableauDetail(ss, dsi) });
    }
    if (action === 'readChallengeConfig') return jsonResponse({ config: readChallengeConfig(ss, officeId) });
    if (action === 'readChallengeSales') {
      var startDate = (e.parameter && e.parameter.startDate) || '';
      var endDate = (e.parameter && e.parameter.endDate) || '';
      return jsonResponse({ sales: readChallengeSales(ss, officeId, startDate, endDate) });
    }
    if (action === 'readChallengeBlood') return jsonResponse({ blood: readChallengeBlood(ss, officeId) });
    if (action === 'leaderboard') return jsonResponse(readLeaderboard(ss, officeId));
    if (action === 'leaderboardHtml') return jsonResponse({ html: buildLeaderboardHtml(readLeaderboard(ss, officeId)) });
    if (action === 'leaderboardText') {
      var officeName = (e.parameter && e.parameter.officeName) || 'OFFICE';
      return jsonResponse({ text: buildLeaderboardText(ss, officeId, officeName) });
    }
    if (action === 'readAdminSummary') return jsonResponse(readAdminSummary(ss));
    if (action === 'checkAdminEmail') {
      var cae = {}; cae.email = (e.parameter && e.parameter.email) || '';
      return jsonResponse(writeCheckAdminEmail(cae, ss));
    }
    if (action === 'validateAdminAccess') {
      var vaa = {}; vaa.email = (e.parameter && e.parameter.email) || ''; vaa.pin = (e.parameter && e.parameter.pin) || '';
      return jsonResponse(writeValidateAdminAccess(vaa, ss));
    }
    let roster = readRoster(ss, officeId);
    const teamMaps = buildTeamEmojiMaps(ss, officeId);
    const peopleResult = readPeople(ss, officeId, roster, teamMaps.nameMap);
    const tableauSummary = getTableauSummaryWithCache(ss, officeId);
    roster = autoAssignTableauNames(ss, officeId, roster, tableauSummary.possibleTableauNames);
    const data = {
      people: peopleResult.people || peopleResult,
      roster: roster,
      teamMap: teamMaps.emojiMap,
      teams: readTeams(ss, officeId),
      orderOverrides: readOrderOverrides(ss, officeId),
      teamCustomizations: readTeamCustomizations(ss, officeId),
      unlockRequests: readUnlockRequests(ss, officeId),
      settings: readSettings(ss, officeId),
      churnReport: readChurnReport(ss),
      aorData: readAOR(ss),
      activationRates: readActivationRates(ss),
      dayAfterOrders: readDayAfterOrders(ss, officeId),
      deliveredOrders: readDeliveredNotActive(ss, officeId),
      orderIssues: readOrderIssues(ss, officeId),
      notes: readNotes(ss, officeId),
      ratings: readRatings(ss, officeId),
      guestRoster: readCrossOfficeMembers(ss, officeId)
    };
    return jsonResponse(data);
  } catch (err) { return jsonResponse({ error: err.message }); }
}

function emptyPeriod() { return { y:0, air:0, cell:0, fiber:0, voip:0, dtv:0, units:0 }; }
function addToPeriod(target, sale) { target.y+=sale.y; target.air+=sale.air; target.cell+=sale.cell; target.fiber+=sale.fiber; target.voip+=sale.voip; target.dtv+=sale.dtv; target.units+=sale.units; }
function sumDays(days) { const r=emptyPeriod(); days.forEach(d=>addToPeriod(r,d)); return r; }
function sumAllPeriods(agg) {
  const r=emptyPeriod(); agg.days.forEach(d=>addToPeriod(r,d));
  addToPeriod(r,agg.priorWeek); addToPeriod(r,agg.twoWkPrior); addToPeriod(r,agg.threeWkPrior); addToPeriod(r,agg.fourWkPrior); addToPeriod(r,agg.fiveWkPrior);
  return r;
}
function getWeekStart() {
  const now=new Date(); const dow=now.getDay(); const daysFromMon=dow===0?6:dow-1;
  const mon=new Date(now); mon.setDate(now.getDate()-daysFromMon); mon.setHours(0,0,0,0); return mon;
}
function readCrossOfficeMembers(ss, officeId) {
  var allOffices=Object.keys(OFFICE_OWNER_MAP); var result={};
  for (var i=0;i<allOffices.length;i++) {
    var other=allOffices[i]; if (other===officeId) continue;
    var sheet=ss.getSheetByName(officeTab(TAB.ROSTER,other)); if (!sheet) continue;
    var data=sheet.getDataRange().getValues();
    for (var j=1;j<data.length;j++) {
      var email=String(data[j][0]||'').trim().toLowerCase(); if (!email) continue;
      var deactivated=data[j][4]===true||String(data[j][4]).toUpperCase()==='TRUE'; if (deactivated) continue;
      var permissions=String(data[j][9]||'').trim()||other;
      if (permissions.split(',').map(function(p){return p.trim();}).indexOf(officeId)===-1) continue;
      var pinVal=String(data[j][6]||'').trim();
      result[email]={ name:String(data[j][1]||'').trim(), team:String(data[j][2]||'').trim(),
        rank:String(data[j][3]||'rep').trim(), deactivated:false, dateAdded:data[j][5]||'',
        hasPin:pinVal.length>0&&pinVal!=='undefined', phone:String(data[j][7]||'').trim(),
        tableauName:String(data[j][8]||'').trim(), permissions:permissions, homeOffice:other };
    }
  }
  return result;
}
function readRoster(ss, officeId) {
  const sheet=ss.getSheetByName(officeTab(TAB.ROSTER,officeId));
  if (!sheet) return {};
  const data=sheet.getDataRange().getValues(); const result={};
  for (let i=1;i<data.length;i++) {
    const email=String(data[i][0]||'').trim().toLowerCase();
    if (!email) continue;
    var pinVal=String(data[i][6]||'').trim();
    var homePermissions=String(data[i][9]||'').trim()||officeId;
    result[email]={ name:String(data[i][1]||'').trim(), team:String(data[i][2]||'').trim(),
      rank:String(data[i][3]||'rep').trim(),
      deactivated:data[i][4]===true||String(data[i][4]).toUpperCase()==='TRUE',
      dateAdded:data[i][5]||'', hasPin:pinVal.length>0&&pinVal!=='undefined',
      phone:String(data[i][7]||'').trim(), tableauName:String(data[i][8]||'').trim(),
      permissions:homePermissions };
  }
  return result;
}
function readPeople(ss, officeId, roster, teamNameToEmoji) {
  const olSheet=ss.getSheetByName(officeTab(TAB.SALES,officeId));
  if (!olSheet) return { people:[], _debug:{ error:'No Sales sheet' } };
  if (!roster||Object.keys(roster).length===0) return { people:[], _debug:{ error:'Empty roster' } };
  const olData=olSheet.getDataRange().getValues(); const hasSalesData=olData.length>=2;
  var _dbg={ totalRows:olData.length-1, noEmail:0, emailNotInRoster:0, noDate:0, badDate:0, tooOld:0, matched:0,
    headerRow:olData[0].slice(0,10).map(String),
    sampleRow2:olData.length>1?['col1(email)='+String(olData[1][OL.EMAIL]),'col3(date)='+String(olData[1][OL.DATE_OF_SALE])]:[], rosterEmails:Object.keys(roster).slice(0,5), olEmails:[] };
  var seenEmails={};
  for (var d=1;d<olData.length&&_dbg.olEmails.length<5;d++) {
    var de=String(olData[d][OL.EMAIL]||'').trim().toLowerCase();
    if (de&&!seenEmails[de]) { seenEmails[de]=true; _dbg.olEmails.push(de); }
  }
  const thisWeekStart=getWeekStart(); const DAY_MS=86400000;
  const priorWeekStart=new Date(thisWeekStart.getTime()-7*DAY_MS);
  const twoWkStart=new Date(thisWeekStart.getTime()-14*DAY_MS);
  const threeWkStart=new Date(thisWeekStart.getTime()-21*DAY_MS);
  const fourWkStart=new Date(thisWeekStart.getTime()-28*DAY_MS);
  const fiveWkStart=new Date(thisWeekStart.getTime()-35*DAY_MS);
  const agg={};
  Object.keys(roster).forEach(email=>{
    agg[email]={ days:Array.from({length:7},()=>emptyPeriod()), lwDays:Array.from({length:7},()=>emptyPeriod()),
      w2Days:Array.from({length:7},()=>emptyPeriod()), w3Days:Array.from({length:7},()=>emptyPeriod()),
      w4Days:Array.from({length:7},()=>emptyPeriod()), w5Days:Array.from({length:7},()=>emptyPeriod()),
      priorWeek:emptyPeriod(), twoWkPrior:emptyPeriod(), threeWkPrior:emptyPeriod(),
      fourWkPrior:emptyPeriod(), fiveWkPrior:emptyPeriod(), recentTime:[0,0,0,0], fw4Time:[0,0,0,0] };
  });
  if (hasSalesData) for (let i=1;i<olData.length;i++) {
    const row=olData[i];
    const email=String(row[OL.EMAIL]||'').trim().toLowerCase();
    if (!email) { _dbg.noEmail++; continue; }
    if (!roster[email]) { _dbg.emailNotInRoster++; continue; }
    var orderChannel=String(row[OL.ORDER_CHANNEL]||'Sara').trim();
    if (orderChannel==='Tower') continue;
    let rawDate=row[OL.DATE_OF_SALE];
    if (!rawDate) { _dbg.noDate++; continue; }
    let saleDate=new Date(rawDate);
    if (isNaN(saleDate.getTime())) { _dbg.badDate++; continue; }
    saleDate.setHours(0,0,0,0);
    const sale={ y:Number(row[OL.YESES])||0, air:Number(row[OL.AIR])||0, cell:Number(row[OL.CELL])||0,
      fiber:Number(row[OL.FIBER])||0, voip:Number(row[OL.VOIP_QTY])||0, dtv:Number(row[OL.DTV])||0, units:Number(row[OL.UNITS])||0 };
    const pa=agg[email]; var weekOffset=-1;
    if (saleDate>=thisWeekStart) {
      weekOffset=0; const dayIdx=Math.floor((saleDate.getTime()-thisWeekStart.getTime())/DAY_MS);
      if (dayIdx>=0&&dayIdx<7) { addToPeriod(pa.days[dayIdx],sale); _dbg.matched++; }
    } else if (saleDate>=priorWeekStart) {
      weekOffset=1; addToPeriod(pa.priorWeek,sale);
      var lwDayIdx=Math.floor((saleDate.getTime()-priorWeekStart.getTime())/DAY_MS);
      if (lwDayIdx>=0&&lwDayIdx<7) addToPeriod(pa.lwDays[lwDayIdx],sale); _dbg.matched++;
    } else if (saleDate>=twoWkStart) {
      weekOffset=2; addToPeriod(pa.twoWkPrior,sale);
      var w2DayIdx=Math.floor((saleDate.getTime()-twoWkStart.getTime())/DAY_MS);
      if (w2DayIdx>=0&&w2DayIdx<7) addToPeriod(pa.w2Days[w2DayIdx],sale); _dbg.matched++;
    } else if (saleDate>=threeWkStart) {
      weekOffset=3; addToPeriod(pa.threeWkPrior,sale);
      var w3DayIdx=Math.floor((saleDate.getTime()-threeWkStart.getTime())/DAY_MS);
      if (w3DayIdx>=0&&w3DayIdx<7) addToPeriod(pa.w3Days[w3DayIdx],sale); _dbg.matched++;
    } else if (saleDate>=fourWkStart) {
      weekOffset=4; addToPeriod(pa.fourWkPrior,sale);
      var w4DayIdx=Math.floor((saleDate.getTime()-fourWkStart.getTime())/DAY_MS);
      if (w4DayIdx>=0&&w4DayIdx<7) addToPeriod(pa.w4Days[w4DayIdx],sale); _dbg.matched++;
    } else if (saleDate>=fiveWkStart) {
      weekOffset=5; addToPeriod(pa.fiveWkPrior,sale);
      var w5DayIdx=Math.floor((saleDate.getTime()-fiveWkStart.getTime())/DAY_MS);
      if (w5DayIdx>=0&&w5DayIdx<7) addToPeriod(pa.w5Days[w5DayIdx],sale); _dbg.matched++;
    } else { _dbg.tooOld++; }
    if (weekOffset>=0) {
      var ts=row[OL.TIMESTAMP];
      if (ts instanceof Date) {
        var h=ts.getHours()+ts.getMinutes()/60; var slotIdx=-1;
        if (h>=10.5&&h<16) slotIdx=0; else if (h>=16&&h<18) slotIdx=1;
        else if (h>=18&&h<21) slotIdx=2; else if (h>=21||h<10.5) slotIdx=3;
        if (slotIdx>=0) { if (weekOffset<=1) pa.recentTime[slotIdx]++; if (weekOffset>=2&&weekOffset<=5) pa.fw4Time[slotIdx]++; }
      }
    }
  }
  const people=[];
  Object.entries(roster).forEach(([email,info])=>{
    const pa=agg[email]; const type=LEADER_RANKS.includes(info.rank)?'leader':'rep';
    const teamEmoji=(teamNameToEmoji||{})[info.team]||'';
    people.push({ name:info.name, type:type, email:email, rank:info.rank, teamEmoji:teamEmoji, team:info.team,
      deactivated:info.deactivated||false, days:pa.days, lwDays:pa.lwDays, w2Days:pa.w2Days,
      w3Days:pa.w3Days, w4Days:pa.w4Days, w5Days:pa.w5Days, thisWeek:sumDays(pa.days),
      priorWeek:pa.priorWeek, twoWkPrior:pa.twoWkPrior, threeWkPrior:pa.threeWkPrior,
      fourWkPrior:pa.fourWkPrior, fiveWkPrior:pa.fiveWkPrior, fourWkRunning:sumAllPeriods(pa),
      recentTime:pa.recentTime, fw4Time:pa.fw4Time });
  });
  return { people:people, _debug:_dbg };
}

function readOrders(ss, officeId, filterEmail) {
  const olSheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!olSheet) return [];
  const olData=olSheet.getDataRange().getValues(); if (olData.length<2) return [];
  const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-30); cutoff.setHours(0,0,0,0);
  const targetEmail=filterEmail?String(filterEmail).trim().toLowerCase():null; const orders=[];
  for (let i=1;i<olData.length;i++) {
    const row=olData[i]; const email=String(row[OL.EMAIL]||'').trim().toLowerCase();
    if (!email) continue; if (targetEmail&&email!==targetEmail) continue;
    const rawDate=row[OL.DATE_OF_SALE]; if (!rawDate) continue;
    const saleDate=new Date(rawDate); if (isNaN(saleDate.getTime())) continue;
    saleDate.setHours(0,0,0,0); if (saleDate<cutoff) continue;
    orders.push({ rowIndex:i+1, email:email, repName:String(row[OL.REP_NAME]||'').trim(),
      dsi:String(row[OL.DSI]||'').trim(), dateOfSale:saleDate.toISOString().split('T')[0],
      campaign:String(row[OL.CAMPAIGN]||'').trim(), accountType:String(row[OL.ACCOUNT_TYPE]||'').trim(),
      clientName:String(row[OL.CLIENT_NAME]||'').trim(), air:Number(row[OL.AIR])||0,
      newPhones:Number(row[OL.NEW_PHONES])||0, byods:Number(row[OL.BYODS])||0,
      cell:Number(row[OL.CELL])||0, fiber:Number(row[OL.FIBER])||0,
      fiberPackage:String(row[OL.FIBER_PACKAGE]||'').trim(), installDate:String(row[OL.INSTALL_DATE]||'').trim(),
      voip:Number(row[OL.VOIP_QTY])||0, dtv:Number(row[OL.DTV])||0,
      dtvPackage:String(row[OL.DTV_PACKAGE]||'').trim(), oomaPackage:String(row[OL.OOMA_PACKAGE]||'').trim(),
      units:Number(row[OL.UNITS])||0, status:String(row[OL.STATUS]||'Pending').trim(),
      notes:String(row[OL.NOTES]||'').trim(),
      tickets:(function(){ try { return JSON.parse(row[OL.TICKETS]||'[]'); } catch(e) { return []; } })(),
      orderChannel:String(row[OL.ORDER_CHANNEL]||'Sara').trim(),
      codesUsedBy:String(row[OL.CODES_USED_BY]||'').trim().toLowerCase() });
  }
  orders.sort((a,b)=>b.dateOfSale.localeCompare(a.dateOfSale)); return orders;
}

function readPayrollOrders(ss, officeId, payrollMode) {
  const olSheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!olSheet) return [];
  const olData=olSheet.getDataRange().getValues(); if (olData.length<2) return [];
  const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-60); cutoff.setHours(0,0,0,0);
  var mode=String(payrollMode||'commission-split').trim(); const orders=[];
  for (let i=1;i<olData.length;i++) {
    const row=olData[i]; const email=String(row[OL.EMAIL]||'').trim().toLowerCase(); if (!email) continue;
    const trainee=String(row[OL.TRAINEE]||'').trim().toLowerCase();
    const codesUsedBy=String(row[OL.CODES_USED_BY]||'').trim().toLowerCase();
    var isTraineeOrder=(trainee==='yes'); var isCodesSwap=(codesUsedBy!=='');
    if (mode==='flat-rate') { if (!isCodesSwap) continue; } else { if (!isTraineeOrder&&!isCodesSwap) continue; }
    const rawDate=row[OL.DATE_OF_SALE]; if (!rawDate) continue;
    const saleDate=new Date(rawDate); if (isNaN(saleDate.getTime())) continue;
    saleDate.setHours(0,0,0,0); if (saleDate<cutoff) continue;
    let paidOut={}; try { const rp=String(row[OL.PAID_OUT]||'').trim(); if (rp) paidOut=JSON.parse(rp); } catch(e) {}
    let speCache=[]; try { const rs=String(row[OL.SPE_CACHE]||'').trim(); if (rs) speCache=JSON.parse(rs); } catch(e) {}
    orders.push({ rowIndex:i+1, sheetRow:i, email:email, repName:String(row[OL.REP_NAME]||'').trim(),
      traineeName:String(row[OL.TRAINEE_NAME]||'').trim(), dsi:String(row[OL.DSI]||'').trim(),
      dateOfSale:saleDate.toISOString().split('T')[0], air:Number(row[OL.AIR])||0,
      cell:Number(row[OL.CELL])||0, fiber:Number(row[OL.FIBER])||0, voip:Number(row[OL.VOIP_QTY])||0,
      units:Number(row[OL.UNITS])||0, status:String(row[OL.STATUS]||'Pending').trim(),
      notes:String(row[OL.NOTES]||'').trim(), paidOut:paidOut,
      orderChannel:String(row[OL.ORDER_CHANNEL]||'Sara').trim(), codesUsedBy:codesUsedBy, speCache:speCache });
  }
  var tableauSummary=getTableauSummaryWithCache(ss,officeId); var dsiSummary=tableauSummary.dsiSummary||{};
  var speCacheWrites=[];
  orders.forEach(function(order) {
    var ts=dsiSummary[order.dsi];
    if (ts&&ts.speList&&ts.speList.length>0) {
      order.speList=ts.speList; order.tableauStatusCounts=ts.statusCounts||{};
      if (!order.speCache||order.speCache.length===0) speCacheWrites.push([order.rowIndex,OL.SPE_CACHE+1,JSON.stringify(ts.speList)]);
    } else if (order.speCache&&order.speCache.length>0) { order.speList=order.speCache; }
  });
  speCacheWrites.forEach(function(w) { olSheet.getRange(w[0],w[1]).setValue(w[2]); });
  orders.forEach(function(o) { delete o.speCache; delete o.sheetRow; });
  orders.sort((a,b)=>b.dateOfSale.localeCompare(a.dateOfSale)); return orders;
}

function readSettings(ss, officeId) {
  const sheet=ss.getSheetByName(officeTab(TAB.SETTINGS,officeId)); if (!sheet) return {};
  const data=sheet.getDataRange().getValues(); const result={};
  for (let i=1;i<data.length;i++) { const key=String(data[i][0]||'').trim(); if (key) result[key]=String(data[i][1]||'').trim(); }
  return result;
}

function readChurnReport(ss) {
  const sheet=ss.getSheetByName(CHURN_REPORT_TAB); if (!sheet) return [];
  const data=sheet.getDataRange().getValues(); if (data.length<2) return [];
  const rawHeaders=data[0].map((h)=>String(h).trim());
  var metricTypeCol=-1;
  var KNOWN_METRICS=['Activated SPE/SP','Disconnect count (SPE/SP)','Churn Rate'];
  for (var ri=1;ri<Math.min(data.length,20);ri++) {
    for (var ci=0;ci<data[ri].length;ci++) {
      if (KNOWN_METRICS.indexOf(String(data[ri][ci]||'').trim())!==-1) { metricTypeCol=ci; break; }
    }
    if (metricTypeCol!==-1) break;
  }
  const headers=rawHeaders.map((h,j)=>{ if (j===metricTypeCol) return 'metricType'; return h===''?('_blank_'+j):h; });
  const rows=[];
  for (let i=1;i<data.length;i++) {
    const row={}; headers.forEach((h,j)=>{ row[h]=data[i][j]!==undefined&&data[i][j]!==null?data[i][j]:''; }); rows.push(row);
  }
  return rows;
}

// === readAOR() — Read shared _TableauAOR tab ===
function readAOR(ss) {
  var sheet=ss.getSheetByName(AOR_TAB); if (!sheet) return [];
  var data=sheet.getDataRange().getValues(); if (data.length<2) return [];
  var headers=data[0].map(function(h) { return String(h).trim(); });
  var rows=[];
  for (var i=1;i<data.length;i++) {
    var row={}; headers.forEach(function(h,j) { row[h||('_col'+j)]=data[i][j]!==undefined?data[i][j]:''; }); rows.push(row);
  }
  return rows;
}

// === readActivationRates() — Read shared _TableauActivationRates tab ===
function readActivationRates(ss) {
  var sheet=ss.getSheetByName(ACTIVATION_RATES_TAB); if (!sheet) return [];
  var data=sheet.getDataRange().getValues(); if (data.length<2) return [];
  var headers=data[0].map(function(h) { return String(h).trim(); });
  var rows=[];
  for (var i=1;i<data.length;i++) {
    var row={}; headers.forEach(function(h,j) { row[h||('_col'+j)]=data[i][j]!==undefined?data[i][j]:''; }); rows.push(row);
  }
  return rows;
}

function writeSetting(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.SETTINGS,officeId),TAB.SETTINGS);
  const key=String(body.key||'').trim(); const value=String(body.value||'').trim();
  if (!key) return { error:'missing key' };
  const data=sheet.getDataRange().getValues();
  for (let i=1;i<data.length;i++) { if (String(data[i][0]).trim()===key) { sheet.getRange(i+1,2).setValue(value); return { ok:true }; } }
  sheet.appendRow([key,value]); return { ok:true };
}

function readChallengeConfig(ss, officeId) {
  var sheet=ss.getSheetByName(officeTab(TAB.CHALLENGE,officeId)); if (!sheet) return null;
  var data=sheet.getDataRange().getValues();
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0]).trim()==='config'&&String(data[i][1]).trim()==='challengeConfig') {
      try { return JSON.parse(String(data[i][2])); } catch(e) { return null; }
    }
  }
  return null;
}
function readChallengeSales(ss, officeId, startDate, endDate) {
  var olSheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!olSheet) return {};
  var olData=olSheet.getDataRange().getValues(); if (olData.length<2) return {};
  var start=new Date(startDate+'T12:00:00'); start.setHours(0,0,0,0);
  var end=new Date(endDate+'T12:00:00'); end.setHours(23,59,59,999);
  if (isNaN(start.getTime())||isNaN(end.getTime())) return {};
  var sales={};
  for (var i=1;i<olData.length;i++) {
    var row=olData[i]; var email=String(row[OL.EMAIL]||'').trim().toLowerCase(); if (!email) continue;
    var rawDate=row[OL.DATE_OF_SALE]; if (!rawDate) continue;
    var saleDate=new Date(rawDate); if (isNaN(saleDate.getTime())) continue;
    saleDate.setHours(0,0,0,0); if (saleDate<start||saleDate>end) continue;
    if (String(row[OL.ORDER_CHANNEL]||'Sara').trim()==='Tower') continue;
    var units=Number(row[OL.UNITS])||0; var dateKey=saleDate.toISOString().split('T')[0];
    if (!sales[email]) sales[email]={ dailyUnits:{}, totalUnits:0 };
    sales[email].dailyUnits[dateKey]=(sales[email].dailyUnits[dateKey]||0)+units;
    sales[email].totalUnits+=units;
  }
  return sales;
}
function readChallengeBlood(ss, officeId) {
  var sheet=ss.getSheetByName(officeTab(TAB.CHALLENGE,officeId)); if (!sheet) return {};
  var data=sheet.getDataRange().getValues(); var blood={};
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0]).trim()!=='blood') continue;
    var key=String(data[i][1]).trim(); var dateStr=key.replace('blood_','');
    try { blood[dateStr]=JSON.parse(String(data[i][2])); } catch(e) {}
  }
  return blood;
}
function writeChallengeConfig(body, ss, officeId) {
  var sheet=getOrCreateSheet(ss,officeTab(TAB.CHALLENGE,officeId),TAB.CHALLENGE);
  var configJson=JSON.stringify(body.config||{});
  var data=sheet.getDataRange().getValues();
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0]).trim()==='config'&&String(data[i][1]).trim()==='challengeConfig') { sheet.getRange(i+1,3).setValue(configJson); return { ok:true }; }
  }
  sheet.appendRow(['config','challengeConfig',configJson]); return { ok:true };
}
function writeEndChallenge(body, ss, officeId) {
  var config=readChallengeConfig(ss,officeId); if (!config) return { error:'no active challenge' };
  config.status='ended'; return writeChallengeConfig({ config:config },ss,officeId);
}
function writeCalculateBlood(body, ss, officeId) {
  var targetDate=String(body.date||'').trim(); if (!targetDate) return { error:'missing date' };
  var target=new Date(targetDate); if (isNaN(target.getTime())) return { error:'invalid date' };
  target.setHours(0,0,0,0); var targetStr=target.toISOString().split('T')[0];
  var dsiMap=buildDsiEmailMap(ss,officeId); var dsiToEmail=dsiMap.dsiToEmail||{};
  var roster=readRoster(ss,officeId); var officeEmails={};
  Object.keys(roster).forEach(function(email) { if (!roster[email].deactivated) officeEmails[email]=roster[email].name||email; });
  var tolSheet=ss.getSheetByName(TABLEAU_TAB); if (!tolSheet) return { error:'no _TableauOrderLog tab' };
  var tolData=tolSheet.getDataRange().getValues(); if (tolData.length<2) return { error:'empty _TableauOrderLog' };
  var col=buildTableauColumnMap(tolData[0]); var earliest=null, latest=null;
  for (var i=1;i<tolData.length;i++) {
    var row=tolData[i]; var rawDate=tCol(row,col,'ORDER_DATE'); if (!rawDate) continue;
    var rowDate=rawDate instanceof Date?rawDate:new Date(rawDate); if (isNaN(rowDate.getTime())) continue;
    rowDate.setHours(0,0,0,0); if (rowDate.getTime()!==target.getTime()) continue;
    var dsi=String(tCol(row,col,'DSI')||'').trim(); if (!dsi) continue;
    var email=dsiToEmail[dsi]; if (!email||!officeEmails[email]) continue;
    var rawTime=tCol(row,col,'ORDER_TIME'); if (!rawTime) continue;
    var decimal=parseOrderTime(rawTime); if (decimal===null) continue;
    var timeStr=formatDecimalTime(decimal); var entry={ email:email, name:officeEmails[email], time:timeStr, decimal:decimal };
    if (!earliest||decimal<earliest.decimal) earliest=entry;
    if (!latest||decimal>latest.decimal) latest=entry;
  }
  var result={ date:targetStr, firstBlood:null, lastBlood:null };
  if (earliest) result.firstBlood={ email:earliest.email, name:earliest.name, time:earliest.time };
  if (latest)   result.lastBlood={ email:latest.email, name:latest.name, time:latest.time };
  var sheet=getOrCreateSheet(ss,officeTab(TAB.CHALLENGE,officeId),TAB.CHALLENGE);
  var bloodKey='blood_'+targetStr; var data=sheet.getDataRange().getValues();
  for (var j=1;j<data.length;j++) {
    if (String(data[j][0]).trim()==='blood'&&String(data[j][1]).trim()===bloodKey) { sheet.getRange(j+1,3).setValue(JSON.stringify(result)); return { ok:true, blood:result }; }
  }
  sheet.appendRow(['blood',bloodKey,JSON.stringify(result)]); return { ok:true, blood:result };
}
function parseOrderTime(raw) {
  if (raw instanceof Date) return raw.getHours()+raw.getMinutes()/60;
  var s=String(raw).trim(); if (!s) return null;
  var match=s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i); if (!match) return null;
  var hours=parseInt(match[1]), minutes=parseInt(match[2]), ampm=(match[4]||'').toUpperCase();
  if (ampm==='PM'&&hours<12) hours+=12; if (ampm==='AM'&&hours===12) hours=0;
  return hours+minutes/60;
}
function formatDecimalTime(decimal) {
  var h=Math.floor(decimal), m=Math.round((decimal-h)*60);
  var ampm=h>=12?'PM':'AM'; var h12=h>12?h-12:(h===0?12:h);
  return h12+':'+(m<10?'0':'')+m+' '+ampm;
}
function readOrderOverrides(ss, officeId) {
  const sheet=ss.getSheetByName(officeTab(TAB.OVERRIDES,officeId)); if (!sheet) return {};
  const data=sheet.getDataRange().getValues(); const result={};
  for (let i=1;i<data.length;i++) {
    const key=String(data[i][0]||'').trim(); if (!key) continue;
    let notes=[]; try { notes=JSON.parse(data[i][5]||'[]'); } catch(e) { notes=[]; }
    result[key]={ product:data[i][1]||'', status:data[i][2]||'', date:data[i][3]||'', order:data[i][4]||'', notes };
  }
  return result;
}
function readTeamCustomizations(ss, officeId) {
  const sheet=ss.getSheetByName(officeTab(TAB.TEAM_CUSTOM,officeId)); if (!sheet) return {};
  const data=sheet.getDataRange().getValues(); const result={};
  for (let i=1;i<data.length;i++) {
    const persona=String(data[i][0]||'').trim(); if (!persona) continue;
    result[persona]={ emoji:data[i][1]||'⚡', name:data[i][2]||'' };
  }
  return result;
}
function readUnlockRequests(ss, officeId) {
  const sheet=ss.getSheetByName(officeTab(TAB.UNLOCKS,officeId)); if (!sheet) return {};
  const data=sheet.getDataRange().getValues(); const result={};
  for (let i=1;i<data.length;i++) {
    const persona=String(data[i][0]||'').trim(); if (!persona) continue;
    result[persona]=data[i][1]||'pending';
  }
  return result;
}
function readTeams(ss, officeId) {
  const sheet=ss.getSheetByName(officeTab(TAB.TEAMS,officeId)); if (!sheet) return {};
  const data=sheet.getDataRange().getValues(); const result={};
  for (let i=1;i<data.length;i++) {
    const teamId=String(data[i][0]||'').trim(); if (!teamId) continue;
    result[teamId]={ teamId:teamId, name:String(data[i][1]||'').trim(), parentId:String(data[i][2]||'').trim(),
      leaderId:String(data[i][3]||'').trim(), emoji:String(data[i][4]||'').trim(), createdDate:data[i][5]||'' };
  }
  return result;
}

function buildDsiEmailMap(ss, officeId) {
  var olSheet=ss.getSheetByName(officeTab(TAB.SALES,officeId));
  if (!olSheet) return { dsiToEmail:{}, emailToDsis:{} };
  var olData=olSheet.getDataRange().getValues(); var dsiToEmail={}, emailToDsis={};
  for (var i=1;i<olData.length;i++) {
    var dsi=String(olData[i][OL.DSI]||'').trim(); var email=String(olData[i][OL.EMAIL]||'').trim().toLowerCase();
    if (dsi&&email) {
      if (!dsiToEmail[dsi]) dsiToEmail[dsi]=email;
      if (!emailToDsis[email]) emailToDsis[email]={};
      emailToDsis[email][dsi]=true;
    }
  }
  return { dsiToEmail:dsiToEmail, emailToDsis:emailToDsis };
}

function readTableauSummary(ss, officeId) {
  var sheet=ss.getSheetByName(TABLEAU_TAB);
  if (!sheet) return { dsiSummary:{}, repSummary:{} };
  var data=sheet.getDataRange().getValues();
  if (data.length<2) return { dsiSummary:{}, repSummary:{} };
  var col=buildTableauColumnMap(data[0]);
  var maps=buildDsiEmailMap(ss,officeId); var dsiEmailMap=maps.dsiToEmail; var emailToDsis=maps.emailToDsis;
  var thirtyDaysAgo=new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate()-30); thirtyDaysAgo.setHours(0,0,0,0);
  var now=new Date(); var dayOfWeek=(now.getDay()+6)%7;
  var thisMonday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-dayOfWeek); thisMonday.setHours(0,0,0,0);
  var dsiSummary={}, repTierData={};
  for (var i=1;i<data.length;i++) {
    var row=data[i]; var dsi=String(tCol(row,col,'DSI')||'').trim(); if (!dsi) continue;
    var ownerOffice=String(tCol(row,col,'OWNER_OFFICE')||'').trim();
    if (ownerOffice.toLowerCase()==='total'||dsi.toLowerCase()==='total') continue;
    var spe=String(tCol(row,col,'SPE')||'').trim();
    var productType=String(tCol(row,col,'PRODUCT_TYPE')||'').trim();
    var dtrStatus=String(tCol(row,col,'DTR_STATUS')||'').trim();
    var discoReason=String(tCol(row,col,'DISCO_REASON')||'').trim();
    var totalVolume=Number(tCol(row,col,'TOTAL_VOLUME'))||0;
    var totalActs=Number(tCol(row,col,'TOTAL_ACTS'))||0;
    var tableauRep=String(tCol(row,col,'REP')||'').trim();
    var orderStatus=String(tCol(row,col,'ORDER_STATUS')||'').trim();
    var rawOrderDate=tCol(row,col,'ORDER_DATE');
    var orderDate=rawOrderDate instanceof Date?rawOrderDate:(rawOrderDate?new Date(rawOrderDate):null);
    if (orderDate&&isNaN(orderDate.getTime())) orderDate=null;
    var bonusTier=String(tCol(row,col,'BONUS_TIERS')||'').trim();
    var payoutReason=String(tCol(row,col,'PAYOUT_REASON')||'').trim();
    if (bonusTier&&tableauRep&&orderDate&&orderDate>=thisMonday) repTierData[tableauRep]={ bonusTier:bonusTier, payoutReason:payoutReason };
    if (!dsiSummary[dsi]) dsiSummary[dsi]={ tableauRep:tableauRep, totalDevices:0, totalActivations:0, totalVolume:0, statusCounts:{}, productCounts:{}, disconnectReasons:{}, speList:[], devices:[], monthWirelessSPEs:{} };
    var s=dsiSummary[dsi]; s.totalDevices++; s.totalActivations+=totalActs; s.totalVolume+=totalVolume;
    if (dtrStatus) s.statusCounts[dtrStatus]=(s.statusCounts[dtrStatus]||0)+1;
    if (productType) s.productCounts[productType]=(s.productCounts[productType]||0)+1;
    if (discoReason) s.disconnectReasons[discoReason]=(s.disconnectReasons[discoReason]||0)+1;
    if (spe) {
      s.speList.push(spe);
      if (productType.toUpperCase()==='WIRELESS'&&orderDate&&orderDate>=thirtyDaysAgo) {
        s.monthWirelessSPEs[spe]={ orderStatus:orderStatus.toLowerCase(), dtrStatus:dtrStatus };
      }
    }
    s.devices.push({ spe:spe, productType:productType, cruIru:String(tCol(row,col,'CRU_IRU')||'').trim(),
      dtrStatus:dtrStatus, discoReason:discoReason, phone:String(tCol(row,col,'PHONE')||'').trim(),
      tnType:String(tCol(row,col,'TN_TYPE')||'').trim(), orderStatus:String(tCol(row,col,'ORDER_STATUS')||'').trim(),
      postedDate:String(tCol(row,col,'POSTED_DATE')||'').trim(), installDate:String(tCol(row,col,'INSTALL_DATE')||'').trim(),
      firstStreaming:String(tCol(row,col,'FIRST_STREAMING')||'').trim() });
  }
  var repSummary={};
  Object.keys(dsiSummary).forEach(function(dsi) {
    var email=dsiEmailMap[dsi]; if (!email) return;
    var ds=dsiSummary[dsi];
    if (!repSummary[email]) {
      var tierInfo=repTierData[ds.tableauRep]||{};
      repSummary[email]={ totalDevices:0, totalActivations:0, totalVolume:0, statusCounts:{}, productCounts:{},
        tableauName:ds.tableauRep, monthWirelessSPEs:{}, bonusTier:tierInfo.bonusTier||'', payoutReason:tierInfo.payoutReason||'' };
    }
    var rs=repSummary[email]; rs.totalDevices+=ds.totalDevices; rs.totalActivations+=ds.totalActivations; rs.totalVolume+=ds.totalVolume;
    Object.keys(ds.statusCounts).forEach(function(st) { rs.statusCounts[st]=(rs.statusCounts[st]||0)+ds.statusCounts[st]; });
    Object.keys(ds.productCounts).forEach(function(pt) { rs.productCounts[pt]=(rs.productCounts[pt]||0)+ds.productCounts[pt]; });
    Object.keys(ds.monthWirelessSPEs).forEach(function(spe) { rs.monthWirelessSPEs[spe]=ds.monthWirelessSPEs[spe]; });
  });
  function convertSPEs(obj) {
    var spes=Object.keys(obj.monthWirelessSPEs); obj.monthTotalSPEs=spes.length;
    obj.monthApprovedSPEs=0; obj.monthPendingSPEs=0; obj.monthCanceledSPEs=0; obj.monthDiscoSPEs=0;
    spes.forEach(function(spe) {
      var info=obj.monthWirelessSPEs[spe];
      if (info.orderStatus==='approved') obj.monthApprovedSPEs++;
      else if (info.orderStatus==='pending') obj.monthPendingSPEs++;
      else if (info.orderStatus==='canceled'||info.orderStatus==='cancelled') obj.monthCanceledSPEs++;
      if (info.dtrStatus==='Disconnected') obj.monthDiscoSPEs++;
    });
    delete obj.monthWirelessSPEs;
  }
  Object.keys(repSummary).forEach(function(email) { convertSPEs(repSummary[email]); });
  var possibleTableauNames={};
  Object.keys(emailToDsis).forEach(function(email) {
    var names={};
    Object.keys(emailToDsis[email]).forEach(function(dsi) { if (dsiSummary[dsi]&&dsiSummary[dsi].tableauRep) names[dsiSummary[dsi].tableauRep]=true; });
    var nameList=Object.keys(names); if (nameList.length>0) possibleTableauNames[email]=nameList;
  });
  var repByName={};
  Object.keys(dsiSummary).forEach(function(dsi) {
    var ds=dsiSummary[dsi]; var name=ds.tableauRep; if (!name) return;
    if (!repByName[name]) {
      var ti=repTierData[name]||{};
      repByName[name]={ totalDevices:0, totalActivations:0, totalVolume:0, statusCounts:{}, productCounts:{},
        tableauName:name, monthWirelessSPEs:{}, bonusTier:ti.bonusTier||'', payoutReason:ti.payoutReason||'' };
    }
    var rn=repByName[name]; rn.totalDevices+=ds.totalDevices; rn.totalActivations+=ds.totalActivations; rn.totalVolume+=ds.totalVolume;
    Object.keys(ds.statusCounts).forEach(function(st) { rn.statusCounts[st]=(rn.statusCounts[st]||0)+ds.statusCounts[st]; });
    Object.keys(ds.productCounts).forEach(function(pt) { rn.productCounts[pt]=(rn.productCounts[pt]||0)+ds.productCounts[pt]; });
    Object.keys(ds.monthWirelessSPEs).forEach(function(spe) { rn.monthWirelessSPEs[spe]=ds.monthWirelessSPEs[spe]; });
  });
  Object.keys(repByName).forEach(function(name) { convertSPEs(repByName[name]); });
  return { dsiSummary:dsiSummary, repSummary:repSummary, repByName:repByName, possibleTableauNames:possibleTableauNames };
}

function autoAssignTableauNames(ss, officeId, roster, possibleTableauNames) {
  if (!possibleTableauNames||Object.keys(possibleTableauNames).length===0) return roster;
  var RANK_ORDER=['rep','l1','jd','manager','admin','owner','superadmin'];
  var unassigned=[];
  Object.keys(roster).forEach(function(email) {
    var r=roster[email];
    if (!r.tableauName&&possibleTableauNames[email]) unassigned.push({ email:email, rank:r.rank||'rep' });
  });
  unassigned.sort(function(a,b) { return RANK_ORDER.indexOf(b.rank)-RANK_ORDER.indexOf(a.rank); });
  if (unassigned.length===0) return roster;
  var claimed={};
  Object.keys(roster).forEach(function(email) { if (roster[email].tableauName) claimed[roster[email].tableauName]=true; });
  var sheet=ss.getSheetByName(officeTab(TAB.ROSTER,officeId)); var newAssignments=[];
  unassigned.forEach(function(entry) {
    var possible=possibleTableauNames[entry.email]||[];
    var unclaimed=possible.filter(function(n) { return !claimed[n]; });
    if (unclaimed.length===1) { var name=unclaimed[0]; claimed[name]=true; roster[entry.email].tableauName=name; newAssignments.push({ email:entry.email, name:name }); }
  });
  if (newAssignments.length>0&&sheet) {
    var data=sheet.getDataRange().getValues();
    newAssignments.forEach(function(a) {
      for (var i=1;i<data.length;i++) { if (String(data[i][0]||'').trim().toLowerCase()===a.email) { sheet.getRange(i+1,9).setValue(a.name); break; } }
    });
  }
  return roster;
}

function readTableauDetail(ss, dsi) {
  var sheet=ss.getSheetByName(TABLEAU_TAB); if (!sheet) return [];
  var data=sheet.getDataRange().getValues(); if (data.length<2) return [];
  var targetDsi=String(dsi||'').trim(); if (!targetDsi) return [];
  var col=buildTableauColumnMap(data[0]); var devices=[];
  for (var i=1;i<data.length;i++) {
    var row=data[i]; if (String(tCol(row,col,'DSI')||'').trim()!==targetDsi) continue;
    devices.push({ spe:String(tCol(row,col,'SPE')||'').trim(), productType:String(tCol(row,col,'PRODUCT_TYPE')||'').trim(),
      cruIru:String(tCol(row,col,'CRU_IRU')||'').trim(), dtrStatus:String(tCol(row,col,'DTR_STATUS')||'').trim(),
      discoReason:String(tCol(row,col,'DISCO_REASON')||'').trim(), phone:String(tCol(row,col,'PHONE')||'').trim(),
      tnType:String(tCol(row,col,'TN_TYPE')||'').trim(), orderStatus:String(tCol(row,col,'ORDER_STATUS')||'').trim(),
      postedDate:String(tCol(row,col,'POSTED_DATE')||'').trim(), installDate:String(tCol(row,col,'INSTALL_DATE')||'').trim() });
  }
  return devices;
}

function getTableauSummaryWithCache(ss, officeId) {
  var cache=CacheService.getScriptCache(); var cacheKey='tableauSummary_v6_'+officeId;
  var cached=cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }
  var summary=readTableauSummary(ss,officeId);
  try { var json=JSON.stringify(summary); if (json.length<100000) cache.put(cacheKey,json,21600); } catch(e) {}
  return summary;
}

function writeBustTableauCache(officeId) {
  try { CacheService.getScriptCache().remove('tableauSummary_v6_'+officeId); } catch(e) {}
  return { ok:true, message:'Tableau cache cleared' };
}

function doPost(e) {
  let body; try { body=JSON.parse(e.postData.contents); } catch(err) { return jsonResponse({ error:'invalid JSON' }); }
  if (!validateKey(body.key||'')) return jsonResponse({ error:'unauthorized' });
  const officeId=body.officeId||DEFAULT_OFFICE_ID; const ss=getSheet(body);
  try {
    let result;
    switch (body.action) {
      case 'addRosterEntry':      result=writeAddRosterEntry(body,ss,officeId); break;
      case 'updateRosterEntry':   result=writeUpdateRosterEntry(body,ss,officeId); break;
      case 'setTableauName':      result=writeSetTableauName(body,ss,officeId); break;
      case 'deleteRosterEntry':   result=writeDeleteRosterEntry(body,ss,officeId); break;
      case 'toggleDeactivate':    result=writeToggleDeactivate(body,ss,officeId); break;
      case 'saveOrderOverride':   result=writeSaveOrderOverride(body,ss,officeId); break;
      case 'setTeamCustomization':result=writeSetTeamCustomization(body,ss,officeId); break;
      case 'setUnlockRequest':    result=writeSetUnlockRequest(body,ss,officeId); break;
      case 'deleteUnlockRequest': result=writeDeleteUnlockRequest(body,ss,officeId); break;
      case 'addTeam':             result=writeAddTeam(body,ss,officeId); break;
      case 'updateTeam':          result=writeUpdateTeam(body,ss,officeId); break;
      case 'deleteTeam':          result=writeDeleteTeam(body,ss,officeId); break;
      case 'checkAdminEmail':     result=writeCheckAdminEmail(body,ss); break;
      case 'validateAdminAccess': result=writeValidateAdminAccess(body,ss); break;
      case 'checkEmail':          result=writeCheckEmail(body,ss,officeId); break;
      case 'setPin':              result=writeSetPin(body,ss,officeId); break;
      case 'validatePin':         result=writeValidatePin(body,ss,officeId); break;
      case 'changePin':           result=writeChangePin(body,ss,officeId); break;
      case 'writeOrderNote':      result=writeOrderNote(body,ss,officeId); break;
      case 'setOrderStatus':      result=writeSetOrderStatus(body,ss,officeId); break;
      case 'updateOrder':         result=writeUpdateOrder(body,ss,officeId); break;
      case 'setSetting':          result=writeSetting(body,ss,officeId); break;
      case 'savePaidOut':         result=writeSavePaidOut(body,ss,officeId); break;
      case 'addTicket':           result=writeAddTicket(body,ss,officeId); break;
      case 'toggleTicket':        result=writeToggleTicket(body,ss,officeId); break;
      case 'addSale':             result=writeAddSale(body,ss,officeId); break;
      case 'replayWebhook':       result=replayWebhook(body,ss,officeId); break;
      case 'bustTableauCache':    result=writeBustTableauCache(officeId); break;
      case 'addNote':             result=writeNoteEntry(body,ss,officeId); break;
      case 'setRating':           result=writeRatingEntry(body,ss,officeId); break;
      case 'saveChallengeConfig': result=writeChallengeConfig(body,ss,officeId); break;
      case 'endChallenge':        result=writeEndChallenge(body,ss,officeId); break;
      case 'calculateBlood':      result=writeCalculateBlood(body,ss,officeId); break;
      case 'createOfficeTabs':    result=createOfficeTabs(body,ss); break;
      case 'migrateFromLegacy':   result=migrateFromLegacy(ss,officeId); break;
      case 'migrateFromExternal': result=migrateFromExternal(body,ss); break;
      case 'migrateOfficeIds':    result=migrateOfficeIds(ss); break;
      default: result={ error:'unknown action: '+body.action };
    }
    return jsonResponse(result);
  } catch(err) { return jsonResponse({ error:err.message }); }
}

function writeAddRosterEntry(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  const email=String(body.email||'').trim().toLowerCase(); if (!email) return { error:'missing email' };
  if (findRowCI(sheet,0,email)>0) return { error:'email already exists' };
  sheet.appendRow([email,body.name||'',body.team||'',body.rank||'rep',false,new Date().toISOString().split('T')[0],'',body.phone||'','',body.permissions||officeId]);
  return { ok:true };
}
function writeUpdateRosterEntry(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  const email=String(body.email||'').trim().toLowerCase(); if (!email) return { error:'missing email' };
  const rowIdx=findRowCI(sheet,0,email); if (rowIdx<0) return { error:'email not found' };
  const newEmail=body.newEmail?String(body.newEmail).trim().toLowerCase():'';
  if (newEmail&&newEmail!==email&&findRowCI(sheet,0,newEmail)>0) return { error:'new email already exists in roster' };
  const cur=sheet.getRange(rowIdx,1,1,10).getValues()[0];
  sheet.getRange(rowIdx,1,1,10).setValues([[newEmail||email,
    body.name!==undefined?body.name:cur[1], body.team!==undefined?body.team:cur[2],
    body.rank!==undefined?body.rank:cur[3], body.deactivated!==undefined?body.deactivated:cur[4],
    cur[5], cur[6], body.phone!==undefined?body.phone:(cur[7]||''),
    body.tableauName!==undefined?body.tableauName:(cur[8]||''),
    body.permissions!==undefined?body.permissions:(cur[9]||officeId)]]);
  return { ok:true };
}
function writeDeleteRosterEntry(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  const email=String(body.email||'').trim().toLowerCase(); if (!email) return { error:'missing email' };
  const rowIdx=findRowCI(sheet,0,email); if (rowIdx>0) sheet.deleteRow(rowIdx); return { ok:true };
}
function writeToggleDeactivate(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  const email=String(body.email||'').trim().toLowerCase(); if (!email) return { error:'missing email' };
  const rowIdx=findRowCI(sheet,0,email);
  if (rowIdx>0) sheet.getRange(rowIdx,5).setValue(body.deactivated===true||body.deactivated==='true');
  return { ok:true };
}
function writeSetTableauName(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  const email=String(body.email||'').trim().toLowerCase(); if (!email) return { error:'missing email' };
  const tableauName=String(body.tableauName||'').trim(); if (!tableauName) return { error:'missing tableauName' };
  const rowIdx=findRowCI(sheet,0,email); if (rowIdx<0) return { error:'email not found' };
  sheet.getRange(rowIdx,9).setValue(tableauName); return { ok:true };
}
function writeSaveOrderOverride(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.OVERRIDES,officeId),TAB.OVERRIDES);
  const key=String(body.key||'').trim(); if (!key) return { error:'missing key' };
  const rowData=[key,body.product||'',body.status||'',body.date||'',body.order||'',JSON.stringify(body.notes||[])];
  const rowIdx=findRow(sheet,0,key);
  if (rowIdx>0) sheet.getRange(rowIdx,1,1,rowData.length).setValues([rowData]); else sheet.appendRow(rowData);
  return { ok:true };
}
function writeSetTeamCustomization(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.TEAM_CUSTOM,officeId),TAB.TEAM_CUSTOM);
  const persona=String(body.persona||'').trim(); if (!persona) return { error:'missing persona' };
  const rowData=[persona,body.emoji||'⚡',body.displayName||''];
  const rowIdx=findRow(sheet,0,persona);
  if (rowIdx>0) sheet.getRange(rowIdx,1,1,rowData.length).setValues([rowData]); else sheet.appendRow(rowData);
  return { ok:true };
}
function writeSetUnlockRequest(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.UNLOCKS,officeId),TAB.UNLOCKS);
  const persona=String(body.persona||'').trim(); if (!persona) return { error:'missing persona' };
  const rowData=[persona,body.status||'pending']; const rowIdx=findRow(sheet,0,persona);
  if (rowIdx>0) sheet.getRange(rowIdx,1,1,rowData.length).setValues([rowData]); else sheet.appendRow(rowData);
  return { ok:true };
}
function writeDeleteUnlockRequest(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.UNLOCKS,officeId),TAB.UNLOCKS);
  const persona=String(body.persona||'').trim(); if (!persona) return { error:'missing persona' };
  const rowIdx=findRow(sheet,0,persona); if (rowIdx>0) sheet.deleteRow(rowIdx); return { ok:true };
}
function readAdminSummary(ss) {
  var allOffices=Object.keys(OFFICE_OWNER_MAP); var result={};
  for (var i=0;i<allOffices.length;i++) {
    var oid=allOffices[i];
    var rSheet=ss.getSheetByName(officeTab(TAB.ROSTER,oid)); var activeReps=0;
    if (rSheet) {
      var rd=rSheet.getDataRange().getValues();
      for (var j=1;j<rd.length;j++) {
        if (!String(rd[j][0]||'').trim()) continue;
        if (!(rd[j][4]===true||String(rd[j][4]).toUpperCase()==='TRUE')) activeReps++;
      }
    }
    var da=readDayAfterOrders(ss,oid); var dna=readDeliveredNotActive(ss,oid); var iss=readOrderIssues(ss,oid);
    result[oid]={ activeReps:activeReps, dayAfterCount:(da||[]).length, deliveredCount:(dna||[]).length, issuesCount:(iss||[]).length };
  }
  return { ok:true, summary:result };
}
function writeCheckAdminEmail(body, ss) {
  var email=String(body.email||'').trim().toLowerCase(); if (!email) return { error:'missing email' };
  var allOffices=Object.keys(OFFICE_OWNER_MAP);
  for (var i=0;i<allOffices.length;i++) {
    var sheet=ss.getSheetByName(officeTab(TAB.ROSTER,allOffices[i])); if (!sheet) continue;
    var rowIdx=findRowCI(sheet,0,email); if (rowIdx<0) continue;
    var rowData=sheet.getRange(rowIdx,1,1,10).getValues()[0];
    if (rowData[4]===true||String(rowData[4]).toUpperCase()==='TRUE') continue;
    var storedHash=String(rowData[6]||'').trim();
    return { ok:true, found:true, hasPin:!!storedHash&&storedHash!=='undefined' };
  }
  return { ok:true, found:false };
}
function writeValidateAdminAccess(body, ss) {
  var email=String(body.email||'').trim().toLowerCase(); var pin=String(body.pin||'').trim();
  if (!email||!pin) return { error:'missing fields' };
  var allOffices=Object.keys(OFFICE_OWNER_MAP);
  for (var i=0;i<allOffices.length;i++) {
    var sheet=ss.getSheetByName(officeTab(TAB.ROSTER,allOffices[i])); if (!sheet) continue;
    var rowIdx=findRowCI(sheet,0,email); if (rowIdx<0) continue;
    var rowData=sheet.getRange(rowIdx,1,1,10).getValues()[0];
    if (rowData[4]===true||String(rowData[4]).toUpperCase()==='TRUE') return { error:'Account deactivated.' };
    var storedHash=String(rowData[6]||'').trim();
    if (!storedHash||storedHash==='undefined') return { error:'No PIN set. Log in through your office portal first.' };
    if (hashPin(email,pin)!==storedHash) return { ok:true, valid:false, error:'Incorrect PIN.' };
    var rank=String(rowData[3]||'').trim();
    if (rank!=='master-admin') return { error:'Admin dashboard requires Master Admin access.' };
    return { ok:true, valid:true, rank:rank, homeOffice:allOffices[i] };
  }
  return { ok:true, valid:false, error:'Email not recognized.' };
}
function writeCheckEmail(body, ss, officeId) {
  var sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  var email=String(body.email||'').trim().toLowerCase();
  if (!email) return { error:'missing email' };
  var rowIdx=findRowCI(sheet,0,email);
  if (rowIdx<0) return { ok:true, found:false };
  var rowData=sheet.getRange(rowIdx,1,1,10).getValues()[0];
  var deactivated=rowData[4]===true||String(rowData[4]).toUpperCase()==='TRUE';
  if (deactivated) return { ok:true, found:false };
  var storedHash=String(rowData[6]||'').trim();
  return { ok:true, found:true, hasPin:!!storedHash&&storedHash!=='undefined' };
}
function writeSetPin(body, ss, officeId) {
  var sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  var email=String(body.email||'').trim().toLowerCase(); var pin=String(body.pin||'').trim();
  if (!email) return { error:'missing email' }; if (!pin) return { error:'missing pin' };
  if (!/^\d{4,6}$/.test(pin)) return { error:'PIN must be 4-6 digits' };
  var rowIdx=findRowCI(sheet,0,email); if (rowIdx<0) return { error:'email not found' };
  var rowData=sheet.getRange(rowIdx,1,1,10).getValues()[0];
  var deactivated=rowData[4]===true||String(rowData[4]).toUpperCase()==='TRUE';
  if (deactivated) return { error:'Account deactivated. Contact your Admin.' };
  var existingHash=String(rowData[6]||'').trim();
  if (existingHash.length>0&&existingHash!=='undefined') return { error:'PIN already set. Use Sign In.' };
  sheet.getRange(rowIdx,7).setValue(hashPin(email,pin));
  var permissions=String(rowData[9]||'').trim()||officeId;
  return { ok:true, valid:true, permissions:permissions };
}
function writeValidatePin(body, ss, officeId) {
  var sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  var email=String(body.email||'').trim().toLowerCase(); var pin=String(body.pin||'').trim();
  if (!email) return { error:'missing email' }; if (!pin) return { error:'missing pin' };
  var rowIdx=findRowCI(sheet,0,email);
  if (rowIdx<0) return { error:'Not authorized for this office' };
  var rowData=sheet.getRange(rowIdx,1,1,10).getValues()[0];
  var deactivated=rowData[4]===true||String(rowData[4]).toUpperCase()==='TRUE';
  if (deactivated) return { error:'Account deactivated. Contact your Admin.' };
  var storedHash=String(rowData[6]||'').trim();
  if (!storedHash||storedHash==='undefined') return { error:'No PIN set for this account' };
  if (hashPin(email,pin)===storedHash) {
    var permissions=String(rowData[9]||'').trim()||officeId;
    return { ok:true, valid:true, permissions:permissions };
  }
  return { ok:true, valid:false, error:'Incorrect PIN' };
}
function writeChangePin(body, ss, officeId) {
  var sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  var email=String(body.email||'').trim().toLowerCase(); var currentPin=String(body.currentPin||'').trim(); var newPin=String(body.newPin||'').trim();
  if (!email||!currentPin||!newPin) return { error:'missing fields' };
  if (!/^\d{4,6}$/.test(newPin)) return { error:'New PIN must be 4-6 digits' };
  var rowIdx=findRowCI(sheet,0,email); if (rowIdx<0) return { error:'email not found' };
  var storedHash=String(sheet.getRange(rowIdx,7).getValue()||'').trim();
  if (!storedHash||storedHash==='undefined') return { error:'No PIN currently set' };
  if (hashPin(email,currentPin)!==storedHash) return { error:'Current PIN is incorrect' };
  sheet.getRange(rowIdx,7).setValue(hashPin(email,newPin)); return { ok:true };
}
function writeAddTeam(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.TEAMS,officeId),TAB.TEAMS);
  const teamId=String(body.teamId||'').trim(); const name=String(body.name||'').trim();
  if (!teamId||!name) return { error:'missing teamId or name' };
  if (findRow(sheet,0,teamId)>0) return { error:'teamId already exists' };
  if (findRow(sheet,1,name)>0) return { error:'team name already exists' };
  sheet.appendRow([teamId,name,body.parentId||'',body.leaderId||'',body.emoji||'',new Date().toISOString().split('T')[0]]);
  return { ok:true };
}
function writeUpdateTeam(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.TEAMS,officeId),TAB.TEAMS);
  const teamId=String(body.teamId||'').trim(); if (!teamId) return { error:'missing teamId' };
  const rowIdx=findRow(sheet,0,teamId); if (rowIdx<0) return { error:'team not found' };
  const cur=sheet.getRange(rowIdx,1,1,6).getValues()[0];
  var newParentId=body.parentId!==undefined?String(body.parentId||'').trim():String(cur[2]||'').trim();
  if (newParentId) {
    var visited={}; visited[teamId]=true; var walkId=newParentId;
    var allData=sheet.getDataRange().getValues(); var idToParent={};
    for (var i=1;i<allData.length;i++) idToParent[String(allData[i][0]||'').trim()]=String(allData[i][2]||'').trim();
    while (walkId) { if (visited[walkId]) return { error:'circular parent reference' }; visited[walkId]=true; walkId=idToParent[walkId]||''; }
  }
  if (body.name!==undefined) { var newName=String(body.name).trim(); var nameRow=findRow(sheet,1,newName); if (nameRow>0&&nameRow!==rowIdx) return { error:'team name already exists' }; }
  sheet.getRange(rowIdx,1,1,6).setValues([[teamId, body.name!==undefined?body.name:cur[1], body.parentId!==undefined?body.parentId:cur[2], body.leaderId!==undefined?body.leaderId:cur[3], body.emoji!==undefined?body.emoji:cur[4], cur[5]]]);
  return { ok:true };
}
function writeDeleteTeam(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.TEAMS,officeId),TAB.TEAMS);
  const teamId=String(body.teamId||'').trim(); if (!teamId) return { error:'missing teamId' };
  const rowIdx=findRow(sheet,0,teamId); if (rowIdx>0) sheet.deleteRow(rowIdx); return { ok:true };
}
function writeOrderNote(body, ss, officeId) {
  var sheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!sheet) return { error:'Sales sheet not found' };
  var rowIndex=Number(body.rowIndex); if (!rowIndex||rowIndex<2) return { error:'Invalid row' };
  var authorName=String(body.authorName||'').trim(); var noteText=String(body.noteText||'').trim(); if (!noteText) return { error:'Empty note' };
  var now=new Date(); var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var newEntry='['+months[now.getMonth()]+' '+now.getDate()+' \u2014 '+authorName+'] '+noteText;
  var existing=String(sheet.getRange(rowIndex,OL.NOTES+1).getValue()||'').trim();
  sheet.getRange(rowIndex,OL.NOTES+1).setValue(existing?existing+'\n'+newEntry:newEntry);
  return { ok:true, notes:existing?existing+'\n'+newEntry:newEntry };
}
function writeAddTicket(body, ss, officeId) {
  var sheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!sheet) return { error:'Sales sheet not found' };
  var rowIndex=Number(body.rowIndex); if (!rowIndex||rowIndex<2) return { error:'Invalid row' };
  var ticketId=String(body.ticketId||'').trim(); if (!ticketId) return { error:'Ticket ID required' };
  var now=new Date(); var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var existing=String(sheet.getRange(rowIndex,OL.TICKETS+1).getValue()||'').trim();
  var tickets; try { tickets=JSON.parse(existing||'[]'); } catch(e) { tickets=[]; }
  tickets.push({ id:ticketId, text:String(body.ticketText||'').trim(), author:String(body.authorName||'').trim(), date:months[now.getMonth()]+' '+now.getDate(), resolved:false });
  sheet.getRange(rowIndex,OL.TICKETS+1).setValue(JSON.stringify(tickets)); return { ok:true, tickets:tickets };
}
function writeToggleTicket(body, ss, officeId) {
  var sheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!sheet) return { error:'Sales sheet not found' };
  var rowIndex=Number(body.rowIndex); if (!rowIndex||rowIndex<2) return { error:'Invalid row' };
  var ticketId=String(body.ticketId||'').trim(); if (!ticketId) return { error:'Ticket ID required' };
  var existing=String(sheet.getRange(rowIndex,OL.TICKETS+1).getValue()||'').trim();
  var tickets; try { tickets=JSON.parse(existing||'[]'); } catch(e) { tickets=[]; }
  var found=false;
  for (var i=0;i<tickets.length;i++) { if (tickets[i].id===ticketId) { tickets[i].resolved=!tickets[i].resolved; found=true; break; } }
  if (!found) return { error:'Ticket not found' };
  sheet.getRange(rowIndex,OL.TICKETS+1).setValue(JSON.stringify(tickets)); return { ok:true, tickets:tickets };
}
function writeSetOrderStatus(body, ss, officeId) {
  var sheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!sheet) return { error:'Sales sheet not found' };
  var rowIndex=Number(body.rowIndex); if (!rowIndex||rowIndex<2) return { error:'Invalid row' };
  sheet.getRange(rowIndex,OL.STATUS+1).setValue(String(body.status||'Pending').trim()); return { ok:true };
}
function writeUpdateOrder(body, ss, officeId) {
  var sheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!sheet) return { error:'Sales sheet not found' };
  var rowIndex=Number(body.rowIndex); if (!rowIndex||rowIndex<2) return { error:'Invalid row' };
  if (body.repName!==undefined) sheet.getRange(rowIndex,OL.REP_NAME+1).setValue(String(body.repName).trim());
  if (body.dsi!==undefined) sheet.getRange(rowIndex,OL.DSI+1).setValue(String(body.dsi).trim());
  if (body.dateOfSale!==undefined) sheet.getRange(rowIndex,OL.DATE_OF_SALE+1).setValue(new Date(body.dateOfSale+'T12:00:00'));
  if (body.air!==undefined) sheet.getRange(rowIndex,OL.AIR+1).setValue(Number(body.air)||0);
  if (body.cell!==undefined) sheet.getRange(rowIndex,OL.CELL+1).setValue(Number(body.cell)||0);
  if (body.fiber!==undefined) sheet.getRange(rowIndex,OL.FIBER+1).setValue(Number(body.fiber)||0);
  if (body.voip!==undefined) sheet.getRange(rowIndex,OL.VOIP_QTY+1).setValue(Number(body.voip)||0);
  if (body.status!==undefined) sheet.getRange(rowIndex,OL.STATUS+1).setValue(String(body.status).trim());
  return { ok:true };
}
function writeSavePaidOut(body, ss, officeId) {
  var sheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!sheet) return { error:'Sales sheet not found' };
  var rowIndex=Number(body.rowIndex); if (!rowIndex||rowIndex<2) return { error:'Invalid row' };
  sheet.getRange(rowIndex,OL.PAID_OUT+1).setValue(JSON.stringify(body.paidOut||{})); return { ok:true };
}

function readLeaderboard(ss, officeId) {
  const roster=readRoster(ss,officeId); const teams=readTeams(ss,officeId);
  const olSheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!olSheet) return { error:'No Sales sheet' };
  const olData=olSheet.getDataRange().getValues(); const thisWeekStart=getWeekStart();
  const personAgg={};
  Object.keys(roster).forEach(function(email) { if (roster[email].deactivated) return; personAgg[email]={ units:0, yeses:0 }; });
  for (var i=1;i<olData.length;i++) {
    var row=olData[i]; var email=String(row[OL.EMAIL]||'').trim().toLowerCase();
    if (!email||!personAgg[email]) continue;
    var rawDate=row[OL.DATE_OF_SALE]; if (!rawDate) continue;
    var saleDate=new Date(rawDate); if (isNaN(saleDate.getTime())) continue;
    saleDate.setHours(0,0,0,0);
    if (saleDate>=thisWeekStart) { personAgg[email].units+=Number(row[OL.UNITS])||0; personAgg[email].yeses+=Number(row[OL.YESES])||0; }
  }
  var ROLE_LABELS={ owner:'Owner', manager:'Manager', jd:'Jr. Director', l1:'Team Leader', rep:'Client Rep' };
  var NON_SALES={ superadmin:true, admin:true }; var individuals=[];
  Object.keys(personAgg).forEach(function(email) {
    var info=roster[email]; var rank=(info.rank||'rep').toLowerCase();
    if (NON_SALES[rank]) return; var agg=personAgg[email];
    if (rank==='owner'&&agg.units===0) return;
    individuals.push({ name:info.name, rank:ROLE_LABELS[rank]||rank, team:info.team, units:agg.units, yeses:agg.yeses });
  });
  individuals.sort(function(a,b) { return b.units-a.units||b.yeses-a.yeses; });
  var weekUnits=0, weekYeses=0;
  individuals.forEach(function(p) { weekUnits+=p.units; weekYeses+=p.yeses; });
  var teamAgg={};
  individuals.forEach(function(p) {
    var t=p.team||'Unassigned'; if (!teamAgg[t]) teamAgg[t]={ name:t, emoji:'', units:0, yeses:0 };
    teamAgg[t].units+=p.units; teamAgg[t].yeses+=p.yeses;
  });
  Object.keys(teams).forEach(function(tid) { var t=teams[tid]; if (teamAgg[t.name]) teamAgg[t.name].emoji=t.emoji||''; });
  var sortedTeams=[];
  Object.keys(teamAgg).forEach(function(k) { if (k!=='Unassigned') sortedTeams.push(teamAgg[k]); });
  sortedTeams.sort(function(a,b) { return b.units-a.units||b.yeses-a.yeses; });
  var now=new Date(); var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return { weekUnits:weekUnits, weekYeses:weekYeses, topIndividuals:individuals.slice(0,3), topTeams:sortedTeams.slice(0,3), date:months[now.getMonth()]+' '+now.getDate()+', '+now.getFullYear() };
}

function buildLeaderboardHtml(data) {
  var wY=data.weekYeses, wU=data.weekUnits, top3=data.topIndividuals||[], topT=data.topTeams||[], dateStr=data.date||'';
  var indOrder=top3.length>=3?[top3[1],top3[0],top3[2]]:top3;
  var teamOrder=topT.length>=3?[topT[1],topT[0],topT[2]]:topT;
  var medals=['\uD83E\uDD48','\uD83E\uDD47','\uD83E\uDD49'];
  var topGrad=['linear-gradient(90deg,#C0C0C0,#94a3b8)','linear-gradient(90deg,#FFD700,#fbbf24)','linear-gradient(90deg,#CD7F32,#b45309)'];
  function card(item,idx,isTeam) {
    var isGold=idx===1;
    var bg=isGold?'linear-gradient(180deg,rgba(255,215,0,0.06) 0%,#F5F2EE 60%)':'rgba(255,255,255,0.5)';
    var bdr=isGold?'rgba(255,215,0,0.4)':'rgba(0,0,0,0.2)'; var pad=isGold?'32px 20px 20px':'24px 20px 20px';
    var sub=isTeam?'<div style="font-size:28px">'+( item.emoji||'')+'</div>':'<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#708090">'+(item.rank||'')+'</div>';
    return '<div style="flex:1;max-width:340px;border-radius:12px;padding:'+pad+';display:flex;flex-direction:column;align-items:center;gap:8px;position:relative;border:1px solid '+bdr+';background:'+bg+'">'+
      '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:'+topGrad[idx]+'"></div>'+
      '<div style="font-size:28px">'+medals[idx]+'</div>'+
      '<div style="font-size:22px;font-weight:700;color:#242124;text-align:center">'+item.name+'</div>'+sub+
      '<div style="display:flex;gap:20px;margin-top:8px">'+
        '<div style="display:flex;flex-direction:column;align-items:center"><div style="font-size:32px;font-weight:700;color:#43B3AE">'+item.units+'</div><div style="font-size:10px;text-transform:uppercase;color:#708090">Units</div></div>'+
        '<div style="display:flex;flex-direction:column;align-items:center"><div style="font-size:32px;font-weight:700;color:#4A5568">'+item.yeses+'</div><div style="font-size:10px;text-transform:uppercase;color:#708090">Yeses</div></div>'+
      '</div></div>';
  }
  function podiumRow(items,isTeam) { var h=''; for (var i=0;i<items.length;i++) h+=card(items[i],i,isTeam); return '<div style="display:flex;gap:16px;align-items:flex-end;justify-content:center;margin-bottom:28px">'+h+'</div>'; }
  return '<div style="width:800px;background:#FEFAF3;padding:32px;font-family:Inter,sans-serif">'+
    '<div style="display:flex;align-items:center;background:rgba(255,255,255,0.5);border:1px solid rgba(0,0,0,0.3);border-radius:14px;margin-bottom:32px;overflow:hidden">'+
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;padding:24px 40px;gap:6px"><div style="font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#708090">Week Yeses</div><div style="font-size:56px;font-weight:700;color:#242124">'+wY+'</div></div>'+
      '<div style="width:1px;height:60px;background:rgba(0,0,0,0.3)"></div>'+
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;padding:24px 40px;gap:6px"><div style="font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#708090">Week Units</div><div style="font-size:56px;font-weight:700;color:#43B3AE">'+wU+'</div></div>'+
    '</div>'+
    '<div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#708090;margin-bottom:12px">Individuals</div>'+podiumRow(indOrder,false)+
    '<div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#708090;margin-bottom:12px">Teams</div>'+podiumRow(teamOrder,true)+
    '<div style="text-align:center;padding-top:8px;border-top:1px solid rgba(0,0,0,0.08)"><div style="font-size:11px;color:#708090">End of Day Snapshot \u00B7 '+dateStr+'</div></div>'+
  '</div>';
}

function writeAddSale(body, ss, officeId) {
  var sheet=getOrCreateSheet(ss,officeTab(TAB.SALES,officeId),TAB.SALES);
  var email=String(body.email||'').trim().toLowerCase(); if (!email) return { error:'Missing email' };
  var dateOfSale=body.dateOfSale; if (!dateOfSale) return { error:'Missing date of sale' };
  var teamEmoji='';
  try {
    var rosterSheet=ss.getSheetByName(officeTab(TAB.ROSTER,officeId));
    if (rosterSheet) {
      var rosterData=rosterSheet.getDataRange().getValues(); var teamName='';
      for (var r=1;r<rosterData.length;r++) { if (String(rosterData[r][0]).trim().toLowerCase()===email) { teamName=String(rosterData[r][2]||'').trim(); break; } }
      if (teamName) {
        var teamsSheet=ss.getSheetByName(officeTab(TAB.TEAMS,officeId));
        if (teamsSheet) { var teamsData=teamsSheet.getDataRange().getValues(); for (var t=1;t<teamsData.length;t++) { if (String(teamsData[t][1]||'').trim()===teamName) { teamEmoji=String(teamsData[t][4]||'').trim(); break; } } }
      }
    }
  } catch(e) {}
  var air=Number(body.air)||0, newPhones=Number(body.newPhones)||0, byods=Number(body.byods)||0;
  var cell=newPhones+byods, fiber=Number(body.fiber)||0, voipQty=Number(body.voipQty)||0, dtv=Number(body.dtv)||0;
  var yeses=0; if (air>0) yeses++; if (cell>0) yeses++; if (fiber>0) yeses++; if (voipQty>0) yeses++; if (dtv>0) yeses++;
  var units=air+cell+fiber+voipQty;
  var newRow=[new Date(),email,String(body.repName||'').trim(),new Date(dateOfSale+'T12:00:00'),
    String(body.campaign||'').trim(),String(body.dsi||'').trim(),String(body.accountType||'').trim(),
    String(body.clientName||'').trim(),body.trainee?'Yes':'No',body.trainee?String(body.traineeName||'').trim():'',
    air,newPhones,byods,cell,fiber,String(body.fiberPackage||'').trim(),String(body.installDate||'').trim(),
    voipQty,dtv,String(body.dtvPackage||'').trim(),String(body.oomaPackage||'').trim(),
    String(body.accountNotes||'').trim(),body.activationSupport?'Yes':'No',teamEmoji,yeses,units,'Pending','','','[]',
    String(body.orderChannel||'Sara').trim(),String(body.codesUsedBy||'').trim().toLowerCase()];
  sheet.appendRow(newRow);
  try { CacheService.getScriptCache().remove('tableauSummary_v6_'+officeId); } catch(e) {}
  var webhookDebug=''; try { webhookDebug=_fireWebhook(body,units,teamEmoji); } catch(e) { webhookDebug='CATCH: '+e.message; }
  return { ok:true, rowIndex:sheet.getLastRow(), units:units, yeses:yeses, webhookDebug:webhookDebug||'no-return' };
}

function _fireWebhook(body, units, teamEmoji) {
  var platform=String(body.chatPlatform||'discord').toLowerCase();
  var webhookUrl=String(body.discordWebhookUrl||'').trim();
  if (!webhookUrl||platform==='none') return 'SKIP: url='+!!webhookUrl+' platform='+platform;
  var bold=(platform==='discord')?'**':'';
  var repName=String(body.repName||'').trim();
  var traineeName=(body.trainee===true||body.trainee==='Yes')?String(body.traineeName||'').trim():'';
  var who=traineeName?(repName+' and '+traineeName):repName;
  var campaign=String(body.campaign||'').trim(); var msg='';
  if (campaign==='attb2b') {
    msg+=bold+who+bold+' made a sale with AT&T: B2B!\n';
    msg+=(body.accountType||'Business')+' Account\n'+String(body.dsi||'')+'\n';
    if (Number(body.air)>0) msg+='\u2022 Internet Air\n';
    var np=Number(body.newPhones)||0, by=Number(body.byods)||0;
    if (np>0||by>0) msg+='\u2022 '+np+' New Phone(s)|'+by+' BYOD(s)\n';
    if (Number(body.fiber)>0) msg+='\u2022 '+(body.fiberPackage||'Fiber')+'\n';
    if (Number(body.voipQty)>0) msg+='\u2022 '+Number(body.voipQty)+' VoIP(s)\n';
    if (Number(body.dtv)>0) msg+='\u2022 DIRECTV '+(body.dtvPackage||'')+'\n';
  } else if (campaign==='ooma') {
    msg+=bold+who+bold+' made a sale with Ooma!\n'+String(body.clientName||'')+'\n\u2022 '+(body.oomaPackage||'Ooma Pro')+'\n';
  }
  var tags=String(body.hashtags||'').trim(); if (tags) msg+=tags+'\n';
  if (teamEmoji&&units>0) { var count=Math.min(units,20); for (var i=0;i<count;i++) msg+=teamEmoji; }
  msg=msg.trim(); if (!msg) return 'SKIP: empty msg';
  var fetchPayload, url;
  if (platform==='groupme') { url='https://api.groupme.com/v3/bots/post'; fetchPayload=JSON.stringify({ bot_id:webhookUrl, text:msg }); }
  else { url=webhookUrl; fetchPayload=JSON.stringify({ content:msg }); }
  var fetchOpts={ method:'post', contentType:'application/json', payload:fetchPayload, muteHttpExceptions:true };
  var maxAttempts=3;
  for (var attempt=1;attempt<=maxAttempts;attempt++) {
    try {
      var resp=UrlFetchApp.fetch(url,fetchOpts); var code=resp.getResponseCode();
      if (code>=200&&code<300) return 'HTTP '+code+(attempt>1?' (retry '+(attempt-1)+')':'')+' | msg='+msg.substring(0,50);
      if (code===429&&attempt<maxAttempts) { var retryAfter=2; try { var ra=resp.getHeaders()['Retry-After']||resp.getHeaders()['retry-after']; if (ra) retryAfter=Math.min(Math.ceil(Number(ra)),5); } catch(e) {} Utilities.sleep(retryAfter*1000); continue; }
      if (code>=500&&attempt<maxAttempts) { Utilities.sleep(2000); continue; }
      return 'HTTP '+code+' attempt '+attempt+' | '+resp.getContentText().substring(0,80);
    } catch(e) { if (attempt<maxAttempts) { Utilities.sleep(2000); continue; } return 'FETCH_ERROR attempt '+attempt+': '+e.message; }
  }
  return 'EXHAUSTED_RETRIES';
}

function replayWebhook(body, ss, officeId) {
  var dsi=String(body.dsi||'').trim(); if (!dsi) return { error:'Missing dsi' };
  var webhookUrl=String(body.discordWebhookUrl||'').trim(); var chatPlatform=String(body.chatPlatform||'discord').toLowerCase();
  if (!webhookUrl) return { error:'Missing discordWebhookUrl' };
  var sheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!sheet) return { error:'Sales tab not found' };
  var data=sheet.getDataRange().getValues(); var found=null;
  for (var r=data.length-1;r>=1;r--) { if (String(data[r][5]).trim().toUpperCase()===dsi.toUpperCase()) { found=data[r]; break; } }
  if (!found) return { error:'DSI not found: '+dsi };
  var replayBody={ repName:String(found[2]||''), campaign:String(found[4]||''), dsi:String(found[5]||''),
    accountType:String(found[6]||''), clientName:String(found[7]||''), trainee:String(found[8]||'').trim(),
    traineeName:String(found[9]||'').trim(), air:Number(found[10])||0, newPhones:Number(found[11])||0,
    byods:Number(found[12])||0, fiber:Number(found[14])||0, fiberPackage:String(found[15]||''),
    voipQty:Number(found[17])||0, dtv:Number(found[18])||0, dtvPackage:String(found[19]||''),
    oomaPackage:String(found[20]||''), hashtags:'', discordWebhookUrl:webhookUrl, chatPlatform:chatPlatform };
  var result=''; try { result=_fireWebhook(replayBody,Number(found[25])||0,String(found[23]||'')); } catch(e) { result='ERROR: '+e.message; }
  return { ok:true, dsi:dsi, webhook:result };
}

function createOfficeTabs(body, ss) {
  var oid=String(body.officeId||'').trim(); if (!oid) return { error:'Missing officeId' };
  var created=[];
  [TAB.SALES,TAB.ROSTER,TAB.TEAMS,TAB.TEAM_CUSTOM,TAB.OVERRIDES,TAB.UNLOCKS,TAB.SETTINGS].forEach(function(base) {
    getOrCreateSheet(ss,officeTab(base,oid),base); created.push(officeTab(base,oid));
  });
  return { success:true, officeId:oid, tabs:created };
}

function buildLeaderboardText(ss, officeId, officeName) {
  var roster=readRoster(ss,officeId);
  var olSheet=ss.getSheetByName(officeTab(TAB.SALES,officeId)); if (!olSheet) return 'No sales data available.';
  var olData=olSheet.getDataRange().getValues(); var thisWeekStart=getWeekStart();
  var personAgg={};
  Object.keys(roster).forEach(function(email) { if (roster[email].deactivated) return; personAgg[email]={ units:0, yeses:0 }; });
  for (var i=1;i<olData.length;i++) {
    var row=olData[i]; var email=String(row[OL.EMAIL]||'').trim().toLowerCase();
    if (!email||!personAgg[email]) continue;
    var rawDate=row[OL.DATE_OF_SALE]; if (!rawDate) continue;
    var saleDate=new Date(rawDate); if (isNaN(saleDate.getTime())) continue;
    saleDate.setHours(0,0,0,0);
    if (saleDate>=thisWeekStart) { personAgg[email].units+=Number(row[OL.UNITS])||0; personAgg[email].yeses+=Number(row[OL.YESES])||0; }
  }
  var NON_SALES={ superadmin:true, admin:true }; var individuals=[];
  Object.keys(personAgg).forEach(function(em) {
    var info=roster[em]; var rank=(info.rank||'rep').toLowerCase();
    if (NON_SALES[rank]) return; var agg=personAgg[em];
    if (rank==='owner'&&agg.units===0) return;
    individuals.push({ name:info.name, team:info.team, units:agg.units });
  });
  individuals.sort(function(a,b) { return b.units-a.units; });
  var medals=['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49']; var lines=[];
  lines.push('\uD83D\uDD25 '+officeName.toUpperCase()+' WEEKLY \uD83D\uDD25');
  lines.push('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
  lines.push('');
  var officeTotal=0, shown=0;
  for (var p=0;p<individuals.length;p++) {
    var person=individuals[p]; officeTotal+=person.units; if (person.units<=0) continue;
    var medal=shown<3?medals[shown]:'\uD83C\uDFC5';
    lines.push(medal+' '+person.name+' \u2014 '+person.units); shown++;
  }
  if (shown===0) lines.push('No sales this week yet.');
  var teamTotals={};
  for (var j=0;j<individuals.length;j++) {
    var ind=individuals[j]; var teamName=ind.team||'Unassigned';
    if (teamName==='Unassigned'||!teamName) continue;
    if (!teamTotals[teamName]) teamTotals[teamName]=0; teamTotals[teamName]+=ind.units;
  }
  var teamArr=[];
  for (var tName in teamTotals) { if (teamTotals[tName]>0) teamArr.push({ name:tName, units:teamTotals[tName] }); }
  teamArr.sort(function(a,b) { return b.units-a.units; });
  if (teamArr.length>0) {
    lines.push(''); lines.push('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
    lines.push('\u2694\uFE0F TEAM RANKINGS \u2694\uFE0F');
    lines.push('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501'); lines.push('');
    for (var t=0;t<teamArr.length;t++) { var tMedal=t<3?medals[t]:'\uD83C\uDFC5'; lines.push(tMedal+' '+teamArr[t].name+' \u2014 '+teamArr[t].units); }
  }
  lines.push(''); lines.push('\uD83D\uDCCA Office Total: '+officeTotal+' units');
  return lines.join('\n');
}

function postLeaderboardToChat(optOfficeId) {
  var props=PropertiesService.getScriptProperties();
  var webhookUrl=(props.getProperty('CHAT_WEBHOOK_URL')||'').trim();
  var platform=(props.getProperty('CHAT_PLATFORM')||'discord').trim().toLowerCase();
  if (!webhookUrl||platform==='none') { Logger.log('[LeaderboardPost] No webhook configured'); return; }
  var ss=getSheet({}); var officeId=optOfficeId||DEFAULT_OFFICE_ID;
  var officeName=props.getProperty('OFFICE_NAME')||'OFFICE';
  var message=buildLeaderboardText(ss,officeId,officeName);
  var url, payload;
  if (platform==='groupme') { url='https://api.groupme.com/v3/bots/post'; payload=JSON.stringify({ bot_id:webhookUrl, text:message }); }
  else { url=webhookUrl; payload=JSON.stringify({ content:message }); }
  var resp=UrlFetchApp.fetch(url,{ method:'post', contentType:'application/json', payload:payload, muteHttpExceptions:true });
  Logger.log('[LeaderboardPost] '+platform+' response: '+resp.getResponseCode());
}

function migrateOfficeIds(ss) {
  if (!ss) { var sid=PropertiesService.getScriptProperties().getProperty('SHEET_ID')||''; ss=sid?SpreadsheetApp.openById(sid):SpreadsheetApp.getActiveSpreadsheet(); }
  var officeMap = { 'off_001':'midspire', 'off_002':'viridian', 'off_003':'elevate', 'off_004':'ignite' };
  var tabBases = [TAB.SALES,TAB.ROSTER,TAB.TEAMS,TAB.TEAM_CUSTOM,TAB.OVERRIDES,TAB.UNLOCKS,TAB.SETTINGS,TAB.CHALLENGE,'_Notes','_Ratings'];
  var log = []; var renamed = 0; var skipped = 0;
  Object.keys(officeMap).forEach(function(oldId) {
    var newId = officeMap[oldId];
    tabBases.forEach(function(base) {
      var oldName = base + '_' + oldId;
      var newName = base + '_' + newId;
      if (ss.getSheetByName(newName)) { log.push('SKIP (exists): ' + newName); skipped++; return; }
      var sheet = ss.getSheetByName(oldName);
      if (sheet) { sheet.setName(newName); log.push('Renamed: ' + oldName + ' → ' + newName); renamed++; }
    });
  });
  return { success:true, renamed:renamed, skipped:skipped, log:log };
}

function migrateFromLegacy(ss, officeId) {
  if (!ss) ss=SpreadsheetApp.getActiveSpreadsheet(); if (!officeId) officeId='midspire';
  var log=[]; log.push('[Migration] Starting for '+officeId);
  var oldOL=ss.getSheetByName('Order Log'); var salesTabName=officeTab(TAB.SALES,officeId);
  var salesSheet=ss.getSheetByName(salesTabName); if (!salesSheet) salesSheet=getOrCreateSheet(ss,salesTabName,TAB.SALES);
  if (oldOL) {
    var oldData=oldOL.getDataRange().getValues(); var newRows=[];
    for (var i=1;i<oldData.length;i++) {
      var old=oldData[i]; var email=String(old[OL_LEGACY.EMAIL]||'').trim(); if (!email) continue;
      newRows.push([old[OL_LEGACY.TIMESTAMP]||'',email.toLowerCase(),String(old[OL_LEGACY.REP_NAME]||'').trim(),old[OL_LEGACY.DATE_OF_SALE]||'','attb2b',String(old[OL_LEGACY.DSI]||'').trim(),'','',String(old[OL_LEGACY.TRAINEE]||'').trim(),String(old[OL_LEGACY.TRAINEE_NAME]||'').trim(),Number(old[OL_LEGACY.AIR])||0,0,0,Number(old[OL_LEGACY.CELL])||0,Number(old[OL_LEGACY.FIBER])||0,'','',Number(old[OL_LEGACY.VOIP_QTY])||0,Number(old[OL_LEGACY.DTV])||0,'','','','',String(old[OL_LEGACY.TEAM_EMOJI]||'').trim(),Number(old[OL_LEGACY.YESES])||0,Number(old[OL_LEGACY.UNITS])||0,String(old[OL_LEGACY.STATUS]||'Pending').trim(),String(old[OL_LEGACY.NOTES]||'').trim(),String(old[OL_LEGACY.PAID_OUT]||'').trim(),String(old[OL_LEGACY.TICKETS]||'[]').trim()]);
    }
    if (newRows.length>0) {
      if (salesSheet.getLastRow()>1) salesSheet.getRange(2,1,salesSheet.getLastRow()-1,30).clearContent();
      salesSheet.getRange(2,1,newRows.length,30).setValues(newRows);
    }
    oldOL.setName('_OrderLog_Legacy');
    log.push('[Migration] Migrated '+newRows.length+' rows');
  }
  var copyMap=[
    { old:'_Roster', newTab:officeTab(TAB.ROSTER,officeId) },
    { old:'_Teams', newTab:officeTab(TAB.TEAMS,officeId) },
    { old:'_TeamCustomizations', newTab:officeTab(TAB.TEAM_CUSTOM,officeId) },
    { old:'_OrderOverrides', newTab:officeTab(TAB.OVERRIDES,officeId) },
    { old:'_UnlockRequests', newTab:officeTab(TAB.UNLOCKS,officeId) },
    { old:'_Settings', newTab:officeTab(TAB.SETTINGS,officeId) }
  ];
  copyMap.forEach(function(entry) {
    var oldSheet=ss.getSheetByName(entry.old); if (!oldSheet) return;
    var newSheet=ss.getSheetByName(entry.newTab);
    if (!newSheet) { oldSheet.setName(entry.newTab); return; }
    var oldData=oldSheet.getDataRange().getValues();
    if (oldData.length>1) { var dr=oldData.slice(1); if (newSheet.getLastRow()>1) newSheet.getRange(2,1,newSheet.getLastRow()-1,dr[0].length).clearContent(); newSheet.getRange(2,1,dr.length,dr[0].length).setValues(dr); }
    oldSheet.setName(entry.old+'_Legacy');
  });
  Logger.log(log.join('\n'));
  return { success:true, officeId:officeId, log:log };
}

function migrateFromExternal(body, ss) {
  var sourceSheetId=body.sourceSheetId; var officeId=body.officeId; var sourceTabName=body.sourceTabName||'Order Log'; var salesOnly=body.salesOnly||false;
  if (!sourceSheetId) return { error:'Missing sourceSheetId' }; if (!officeId) return { error:'Missing officeId' };
  if (!ss) ss=SpreadsheetApp.getActiveSpreadsheet();
  var log=[]; var sourceSS; try { sourceSS=SpreadsheetApp.openById(sourceSheetId); } catch(e) { return { error:'Cannot open source sheet: '+e.message }; }
  var sourceOL=sourceSS.getSheetByName(sourceTabName); if (!sourceOL) return { error:'Source tab "'+sourceTabName+'" not found' };
  var salesTabName=officeTab(TAB.SALES,officeId); var salesSheet=getOrCreateSheet(ss,salesTabName,TAB.SALES);
  var sourceData=sourceOL.getDataRange().getValues();
  if (sourceData.length>1) {
    var headers=sourceData[0].map(function(h) { return String(h).trim().toLowerCase(); });
    function findCol(keywords) { for (var h=0;h<headers.length;h++) { for (var k=0;k<keywords.length;k++) { if (headers[h].indexOf(keywords[k])>=0) return h; } } return -1; }
    var IGN={ EMAIL:findCol(['email']), DATE_OF_SALE:findCol(['date of sale']), REP_NAME:findCol(["representative's name",'rep name','representative']),
      TRAINEE:findCol(['train someone','someone else','under someone']), TRAINEE_NAME:findCol(['whose codes','trainee name']),
      CAMPAIGN:findCol(['which campaign','campaign']), DSI:findCol(['dsi']), ACCOUNT_NOTES:findCol(['account notes']),
      ACCOUNT_TYPE:findCol(['type of account','account type']), AIR_COUNTER:findCol(['air counter']),
      NEW_PHONES:findCol(['new phones','quantity of new']), BYODS:findCol(['byod']),
      FIBER_PACKAGE:findCol(['which package was sold','fiber package']), INSTALL_DATE:findCol(['install date']),
      VOIP_COUNTER:findCol(['voip counter','voip qty counter']), VOIP_QTY:findCol(['quantity sold']),
      DTV_COUNTER:findCol(['dtv counter']), DTV_PACKAGE:findCol(['package sold']),
      CLIENT_NAME:findCol(['client name']), FIBER_COUNTER:findCol(['fiber counter']),
      YES_COUNTER:findCol(['yes counter']), NUM_LINES:findCol(['wireless counter','num lines','# of lines']),
      UNITS:findCol(['units']), TIMESTAMP:findCol(['timestamp']) };
    var newRows=[];
    for (var i=1;i<sourceData.length;i++) {
      var src=sourceData[i]; var email=String(src[IGN.EMAIL]||'').trim(); if (!email) continue;
      function g(idx) { return idx>=0?(src[idx]||''):''; }
      function gn(idx) { return idx>=0?(Number(src[idx])||0):0; }
      var rawCampaign=String(g(IGN.CAMPAIGN)).trim().toLowerCase(); var campaign=rawCampaign.indexOf('ooma')>=0?'ooma':'attb2b';
      var newPhones=gn(IGN.NEW_PHONES), byods=gn(IGN.BYODS), cell=newPhones+byods;
      var cellFromCounter=gn(IGN.NUM_LINES); if (cellFromCounter>0&&cell===0) cell=cellFromCounter;
      newRows.push([g(IGN.TIMESTAMP),email.toLowerCase(),String(g(IGN.REP_NAME)).trim(),g(IGN.DATE_OF_SALE),campaign,String(g(IGN.DSI)).trim(),String(g(IGN.ACCOUNT_TYPE)).trim(),String(g(IGN.CLIENT_NAME)).trim(),String(g(IGN.TRAINEE)).trim(),String(g(IGN.TRAINEE_NAME)).trim(),gn(IGN.AIR_COUNTER),newPhones,byods,cell,gn(IGN.FIBER_COUNTER),String(g(IGN.FIBER_PACKAGE)).trim(),g(IGN.INSTALL_DATE),gn(IGN.VOIP_COUNTER)||gn(IGN.VOIP_QTY),gn(IGN.DTV_COUNTER),String(g(IGN.DTV_PACKAGE)).trim(),'','','','',gn(IGN.YES_COUNTER),gn(IGN.UNITS),'Pending','','','[]']);
    }
    if (newRows.length>0) {
      if (salesSheet.getLastRow()>1) salesSheet.getRange(2,1,salesSheet.getLastRow()-1,30).clearContent();
      salesSheet.getRange(2,1,newRows.length,30).setValues(newRows);
      log.push('[Migration] Wrote '+newRows.length+' orders to '+salesTabName);
    }
  }
  if (!salesOnly) {
    ['_Roster','_Teams'].forEach(function(tabName) {
      var src=sourceSS.getSheetByName(tabName); var base=tabName==='_Roster'?TAB.ROSTER:TAB.TEAMS;
      var targetTab=officeTab(base,officeId); var targetSheet=getOrCreateSheet(ss,targetTab,base);
      if (src) { var d=src.getDataRange().getValues(); if (d.length>1) { var rows=d.slice(1); if (targetSheet.getLastRow()>1) targetSheet.getRange(2,1,targetSheet.getLastRow()-1,rows[0].length).clearContent(); targetSheet.getRange(2,1,rows.length,rows[0].length).setValues(rows); } }
    });
  }
  [TAB.TEAM_CUSTOM,TAB.OVERRIDES,TAB.UNLOCKS,TAB.SETTINGS].forEach(function(base) { getOrCreateSheet(ss,officeTab(base,officeId),base); });
  Logger.log(log.join('\n'));
  return { success:true, officeId:officeId, salesRows:salesSheet.getLastRow()-1, log:log };
}

