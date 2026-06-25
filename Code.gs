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
  'ignite': 'ignite solutions, inc.',
  'vanguard': 'tenacity solutions, inc'
};
var RATINGS_VALID = ['No Answer','1 Star','2 Stars','3 Stars','4 Stars','5 Stars'];
var _SHEET_CACHE = {};
function _getSheetData(ss, tabName) {
  if (_SHEET_CACHE[tabName] !== undefined) return _SHEET_CACHE[tabName];
  var sheet = ss.getSheetByName(tabName);
  _SHEET_CACHE[tabName] = sheet ? sheet.getDataRange().getValues() : null;
  return _SHEET_CACHE[tabName];
}
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
  "product type (broken out lvl 2)": "PRODUCT_TYPE", "product type (broken out lvl 3)": "PRODUCT_TYPE",
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
  "spe.install date": "INSTALL_DATE", "install date": "INSTALL_DATE",
  "b2b rep volume bonus tiers": "BONUS_TIERS", "bonus tiers": "BONUS_TIERS",
  "tier bonus payout/dnq reason": "PAYOUT_REASON", "payout reason": "PAYOUT_REASON",
  "unit count": "UNIT_COUNT", "total volume": "TOTAL_VOLUME",
  "total activations": "TOTAL_ACTS", "total acts": "TOTAL_ACTS",
  "measure names": "MEASURE_NAMES", "measure values": "MEASURE_VALUES",
  "activation bucket": "ACTIVATION_BUCKET",
  "activation color": "ACTIVATION_COLOR",
  "sales (all)  (activations)": "SALES_ACTS",
  "sales (all) activation rate": "SALES_ACT_RATE",
  "sales (all)": "SALES_VOL"
};
function buildTableauColumnMap(headerRow) {
  var col = {};
  for (var i = 0; i < headerRow.length; i++) {
    var raw = String(headerRow[i] || '').replace(/\s+/g, ' ').trim().toLowerCase();
    var key = TOL_HEADER_MAP[raw];
    if (key && !col.hasOwnProperty(key)) col[key] = i;
  }
  return col;
}
function tCol(row, col, key) { return col.hasOwnProperty(key) ? row[col[key]] : ''; }
function getApiKey() { return PropertiesService.getScriptProperties().getProperty('API_KEY') || ''; }
// Fail CLOSED (Phase 2): if API_KEY is unset/blank, deny — never default to allow.
// (API_KEY is confirmed set in production, so this only guards against the property
// being cleared by accident; it does not change normal behavior.)
function validateKey(key) { const expected = getApiKey(); if (!expected) return false; return key === expected; }
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function getSheet(params) {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '';
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

// Race-safe sheet creation: only the lock-winner that still finds the tab
// missing creates it; everyone else reuses it. The common already-exists path
// stays lock-free (no throughput cost). Fixes the cold-start race where many
// first-time posts to a new office all try to insert _PostedSales_<office> at
// once and the losers crash with "a sheet with that name already exists".
function _getOrInsertSheet(ss, tabName) {
  var existing = ss.getSheetByName(tabName);
  if (existing) return { sheet: existing, created: false };
  var lock = LockService.getScriptLock();
  var haveLock = false;
  try { lock.waitLock(20000); haveLock = true; } catch (e) {}
  try {
    var s = ss.getSheetByName(tabName);            // re-check inside the lock
    if (s) return { sheet: s, created: false };
    try {
      return { sheet: ss.insertSheet(tabName), created: true };
    } catch (e2) {                                 // lost the race anyway (lock timeout)
      var after = ss.getSheetByName(tabName);
      if (after) return { sheet: after, created: false };
      throw e2;
    }
  } finally { if (haveLock) lock.releaseLock(); }
}
// appendRow is NOT safe across simultaneous Apps Script executions -- concurrent
// appends to the same sheet clobber each other (load test: 25 concurrent posts
// landed only 8 rows). Serialize every hot-path append behind the script lock so
// no write is silently lost under a burst of reps.
function _safeAppend(sheet, row) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { throw new Error('busy - please retry'); }
  try { sheet.appendRow(row); } finally { lock.releaseLock(); }
}
function getOrCreateSheet(ss, tabName, baseName) {
  var _r = _getOrInsertSheet(ss, tabName);
  var sheet = _r.sheet;
  if (_r.created) {
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

// ── PIN brute-force lockout (Phase 2) ────────────────────────────────────────
// Per-email failed-attempt counter in CacheService. After _PIN_MAX_FAILS wrong
// PINs the account is locked for _PIN_LOCK_SECONDS; a successful login clears it.
// Cache-based (not a sheet) so it's fast and self-expiring; eviction only ever
// errs toward letting a legit user back in, never toward exposing the account.
var _PIN_MAX_FAILS = 5;
var _PIN_LOCK_SECONDS = 900; // 15 minutes
function _pinFailKey(email) { return 'pinfail_' + String(email||'').trim().toLowerCase(); }
// Returns seconds remaining on an active lockout, or 0 if not locked.
function _pinLockedSeconds(email) {
  try {
    var raw = CacheService.getScriptCache().get(_pinFailKey(email));
    if (!raw) return 0;
    var o = JSON.parse(raw);
    if ((o.n||0) >= _PIN_MAX_FAILS && o.until) {
      var left = Math.ceil((new Date(o.until).getTime() - new Date().getTime()) / 1000);
      return left > 0 ? left : 0;
    }
  } catch(e) {}
  return 0;
}
// Record one failed attempt; sets a lockout once the threshold is reached.
function _recordPinFail(email) {
  try {
    var cache = CacheService.getScriptCache(); var k = _pinFailKey(email);
    var n = 1; var raw = cache.get(k);
    if (raw) { try { n = (JSON.parse(raw).n || 0) + 1; } catch(e) {} }
    var until = n >= _PIN_MAX_FAILS ? new Date(new Date().getTime() + _PIN_LOCK_SECONDS*1000).toISOString() : null;
    cache.put(k, JSON.stringify({ n:n, until:until }), _PIN_LOCK_SECONDS);
  } catch(e) {}
}
function _clearPinFails(email) { try { CacheService.getScriptCache().remove(_pinFailKey(email)); } catch(e) {} }

// ── Light global rate-limit (Phase 2) — speed bump against bulk abuse ─────────
// Approximate fixed-window counter in cache. Generous enough never to bother
// real logins; caps a script hammering an endpoint (e.g. harvesting valid
// employee emails via checkEmail). Fails OPEN on any cache hiccup so it can
// never block legitimate use. Counter isn't strictly atomic — fine for a speed
// bump (a tiny over-count under concurrency is acceptable).
function _rateLimitOk(bucket, maxPerWindow, windowSeconds) {
  try {
    var cache = CacheService.getScriptCache();
    var win = Math.floor(new Date().getTime() / (windowSeconds*1000));
    var k = 'rl_' + bucket + '_' + win;
    var n = parseInt(cache.get(k) || '0', 10) || 0;
    if (n >= maxPerWindow) return false;
    cache.put(k, String(n+1), windowSeconds + 5);
    return true;
  } catch(e) { return true; }
}

// ── SESSION TOKENS ("badges") — Phase 1 Stage A (additive/invisible) ─────────
// On a successful login the backend issues a random session token tied to the
// user's server-verified email + real role, and stores only its HASH in a
// private _Sessions tab. The raw token is returned to the client, which may
// carry it. NOTHING is enforced yet — existing key-based calls keep working.
// Both backends share the spreadsheet (SHEET_ID), so either can validate a token.
var SESSIONS_TAB = '_Sessions';
var SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // 12 hours

function _hashToken(token) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  return digest.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function _sessionsSheet(ss) {
  var sh = ss.getSheetByName(SESSIONS_TAB);
  if (!sh) { sh = ss.insertSheet(SESSIONS_TAB); sh.appendRow(['tokenHash','email','rank','permissions','issuedAt','expiresAt']); }
  return sh;
}
// Issue a badge. Returns {token, expiresAt}; only the token HASH is stored.
function _issueSession(ss, email, rank, permissions) {
  var sh = _sessionsSheet(ss);
  _pruneSessions(sh);
  var token = Utilities.getUuid() + Utilities.getUuid();   // 256 bits of randomness
  var now = Date.now();
  var expIso = new Date(now + SESSION_TTL_MS).toISOString();
  sh.appendRow([_hashToken(token), String(email||'').trim().toLowerCase(), String(rank||''), String(permissions||''), new Date(now).toISOString(), expIso]);
  return { token: token, expiresAt: expIso };
}
// Validate a badge. Returns {valid:true,email,rank,permissions,expiresAt} or {valid:false}.
function _validateSession(ss, token) {
  if (!token) return { valid:false };
  var sh = ss.getSheetByName(SESSIONS_TAB); if (!sh) return { valid:false };
  var th = _hashToken(token);
  var data = sh.getDataRange().getValues();
  var nowIso = new Date().toISOString();
  for (var i=1;i<data.length;i++) {
    if (String(data[i][0])!==th) continue;
    if (String(data[i][5]) <= nowIso) return { valid:false, expired:true };
    return { valid:true, email:String(data[i][1]), rank:String(data[i][2]), permissions:String(data[i][3]), expiresAt:String(data[i][5]) };
  }
  return { valid:false };
}

// -- Server-side order scoping (badge-derived; mirrors the client repFilter) --
// Closes the data-layer leak: a client-rep/leader/jd must never RECEIVE another
// rep's orders, not merely have them hidden in the browser. Identity (email +
// rank) comes from the SERVER-ISSUED badge (gs), never from client input. With
// no valid badge (STRICT_AUTH grace period) orders pass through unchanged.
function _scopeOrders(orders, gs, roster, teams) {
  if (!gs || !gs.valid) return orders;
  var rank  = String(gs.rank  || '').trim();
  var email = String(gs.email || '').trim().toLowerCase();
  roster = roster || {}; teams = teams || {};
  if (rank === 'client-rep') {
    var me = roster[email] || {};
    var tn = String(me.tableauName || '').trim().toLowerCase();
    if (!tn) return [];
    return orders.filter(function(o){ return String(o.rep || '').trim().toLowerCase() === tn; });
  }
  if (rank === 'leader') {   // jd is office-wide (manager-equivalent)
    var team = _serverMyTeam(rank, email, roster, teams);
    if (team) {
      var tns = _serverTeamTableauNames(team.name, roster);
      if (!tns.length) return [];
      return orders.filter(function(o){ return tns.indexOf(String(o.rep || '').trim().toLowerCase()) !== -1; });
    }
    var me2 = roster[email] || {};
    var tn2 = String(me2.tableauName || '').trim().toLowerCase();
    return tn2 ? orders.filter(function(o){ return String(o.rep || '').trim().toLowerCase() === tn2; }) : [];
  }
  return orders;  // master-admin / owner / admin / activator / manager => office-wide
}
function _serverMyTeam(rank, email, roster, teams) {
  if (rank === 'leader') {
    var found = null;
    Object.keys(teams).forEach(function(tid){ if (String(teams[tid].leaderId || '').toLowerCase() === email) found = teams[tid]; });
    return found;
  }
  if (rank === 'jd') {
    var me = roster[email] || {};
    var teamName = me.team || '';
    if (!teamName) return null;
    var found2 = null;
    Object.keys(teams).forEach(function(tid){ if (teams[tid].name === teamName) found2 = teams[tid]; });
    return found2;
  }
  return null;
}
function _serverTeamTableauNames(teamName, roster) {
  if (!teamName) return [];
  var tns = [];
  Object.keys(roster).forEach(function(em){
    var p = roster[em];
    if ((p.team || '') === teamName && p.tableauName) tns.push(String(p.tableauName || '').trim().toLowerCase());
  });
  return tns;
}
// Individual order-read actions: skip the roster/teams read for office-wide
// roles; load them only when scoping is actually needed.
function _scopeOrdersAuthed(ss, officeId, orders, gs) {
  if (!gs || !gs.valid) return orders;
  var rank = String(gs.rank || '').trim();
  if (rank !== 'client-rep' && rank !== 'leader') return orders;   // jd office-wide
  return _scopeOrders(orders, gs, readRoster(ss, officeId), readTeams(ss, officeId));
}
// Revoke a badge (logout). Safe to call with an unknown/empty token.
function _revokeSession(ss, token) {
  if (!token) return { ok:true };
  var sh = ss.getSheetByName(SESSIONS_TAB); if (!sh) return { ok:true };
  var th = _hashToken(token);
  var data = sh.getDataRange().getValues();
  for (var i=data.length-1;i>=1;i--) { if (String(data[i][0])===th) sh.deleteRow(i+1); }
  return { ok:true };
}
// Drop expired rows so the tab can't grow unbounded (called on each issue).
function _pruneSessions(sh) {
  var data = sh.getDataRange().getValues();
  var nowIso = new Date().toISOString();
  for (var i=data.length-1;i>=1;i--) { if (data[i][0] && String(data[i][5]) <= nowIso) sh.deleteRow(i+1); }
}

// ── Phase 1 Stage C: server-side authorization (badge-derived role) ──────────
// STRICT_AUTH (Script Property 'true'/'false', default OFF) is the cutover switch.
//  OFF  = grace period: unchanged behavior, so clients not yet sending a badge keep
//         working. ON = privileged calls REQUIRE a valid badge and the caller's role
//         is taken from the badge, never from any client-supplied role/rank field.
function _strictAuth() {
  return String(PropertiesService.getScriptProperties().getProperty('STRICT_AUTH')||'').toLowerCase()==='true';
}
// Effective caller role: prefer the server-issued badge (authoritative); fall back
// to the client-claimed role only when no valid badge is present (grace period).
function _callerRole(ss, body) {
  var s = _validateSession(ss, body && body.token);
  if (s && s.valid) return { authed:true, role:String(s.rank||''), email:String(s.email||'') };
  return { authed:false, role:String((body&&body.role)||''), email:String((body&&body.email)||'') };
}
// Returns null to allow the call, or an {error} object to reject it.
function _authz(ss, body, allowedRoles) {
  var c = _callerRole(ss, body);
  if (_strictAuth() && !c.authed) return { error:'auth_required' };
  if (allowedRoles && allowedRoles.indexOf(c.role) === -1) return { error:'forbidden' };
  return null;
}
// Office-scoping on AUTH: a badged user may only act on offices their badge
// grants (permissions = comma/space list of office ids). master-admin = all.
// No valid badge => no-op (the STRICT_AUTH gate handles that). Empty permissions
// (legacy badge) fails OPEN so a data quirk can't lock out a real user.
function _officeAllowed(gs, officeId) {
  if (!gs || !gs.valid) return true;
  if (String(gs.rank||'').trim().toLowerCase()==='master-admin') return true;
  var perms = String(gs.permissions||'').toLowerCase().split(/[,\s]+/).filter(Boolean);
  if (!perms.length) return true;
  return perms.indexOf(String(officeId||'').trim().toLowerCase()) !== -1;
}
var _ADMIN_ROLES = ['master-admin','owner','admin','manager','jd'];   // jd = manager-equivalent (can add/edit people + teams)
// Login/utility actions need no badge (you don't have one yet at login).
var _PREAUTH_ACTIONS = { checkEmail:1, validatePin:1, setPin:1, changePin:1, checkAdminEmail:1, validateAdminAccess:1, validateSession:1, logout:1 };
// Actions restricted to specific roles. Anything not listed = any authenticated user.
var _ADMIN_ACTIONS = {
  addRosterEntry:_ADMIN_ROLES, updateRosterEntry:_ADMIN_ROLES, deleteRosterEntry:['master-admin'],
  toggleDeactivate:_ADMIN_ROLES, setTableauName:_ADMIN_ROLES,
  addTeam:_ADMIN_ROLES, updateTeam:_ADMIN_ROLES, deleteTeam:_ADMIN_ROLES,
  saveChallengeConfig:_ADMIN_ROLES, endChallenge:_ADMIN_ROLES,
  createOfficeTabs:['master-admin'], migrateFromLegacy:['master-admin'],
  migrateFromExternal:['master-admin'], migrateOfficeIds:['master-admin']
};
// Central authorization gate for doPost. Returns null to proceed.
function _authGate(ss, body) {
  var action = body && body.action;
  if (_PREAUTH_ACTIONS[action]) return null;
  var az = _authz(ss, body, _ADMIN_ACTIONS[action] || null);
  if (az) return az;
  // Office-scoping: a badged user can only act on an office their badge grants.
  if (_strictAuth() && body && body.officeId) {
    var _gsOff = _validateSession(ss, body.token);
    if (_gsOff && _gsOff.valid && !_officeAllowed(_gsOff, body.officeId)) return { error:'forbidden_office' };
  }
  // Only a master-admin may grant the master-admin rank or change office permissions.
  if ((action==='addRosterEntry' || action==='updateRosterEntry') && _strictAuth()) {
    var elevating = String(body.rank||'').trim().toLowerCase()==='master-admin' ||
                    (body.permissions!==undefined && String(body.permissions)!=='');
    if (elevating && _callerRole(ss, body).role!=='master-admin') return { error:'forbidden' };
  }
  return null;
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

// Safety net: detect OFFICE_OWNER_MAP drift. If the shared Tableau tab has rows
// but NONE match this office, the call-log tabs would silently go empty -- surface
// it instead. Unknown/blank mapping returns all rows (matched==raw) so it never
// false-positives on a genuinely empty office.
function _tableauMatchHealth(ss, officeId) {
  try {
    var data = _getSheetData(ss, TABLEAU_TAB);
    if (!data || data.length < 2) return { rawRows: 0, matchedRows: 0 };
    var raw = data.length - 1;
    var match = _officeMatch(officeId);
    if (!match) return { rawRows: raw, matchedRows: raw };
    var col = buildTableauColumnMap(data[0]);
    var matched = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(tCol(data[i], col, 'OWNER_OFFICE') || '').toLowerCase().indexOf(match) !== -1) matched++;
    }
    return { rawRows: raw, matchedRows: matched };
  } catch (e) { return { rawRows: 0, matchedRows: 0 }; }
}

function _buildTolRow(row, col, allRows) {
  var rawDate = tCol(row,col,'ORDER_DATE');
  var d = rawDate instanceof Date ? rawDate : (rawDate ? new Date(rawDate) : null);
  var productCounts = {}, statusCounts = {};
  (allRows || [row]).forEach(function(r) {
    var ptRaw = tCol(r,col,'PRODUCT_TYPE');
    if (!(ptRaw instanceof Date)) {
      var pt = String(ptRaw||'').trim();
      if (pt) productCounts[pt] = (productCounts[pt]||0) + 1;
    }
    var stRaw = tCol(r,col,'DTR_STATUS');
    var st = (stRaw instanceof Date) ? 'Null' : (String(stRaw||'').trim() || 'Null');
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
    var sheetData = _getSheetData(ss, tabs[t]); if (!sheetData || sheetData.length < 2) continue;
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

  var dsiRows = {}, dsiCols = {}, tolDsis = {};

  // Source 1: Tableau tabs (TOL + AOR) — office-filtered by OWNER_OFFICE. TOL primary; AOR fills missing DSIs only.
  var tabs = [TABLEAU_TAB, AOR_TAB];
  for (var t = 0; t < tabs.length; t++) {
    var sheetData = _getSheetData(ss, tabs[t]); if (!sheetData || sheetData.length < 2) continue;
    var col = buildTableauColumnMap(sheetData[0]);
    var filtered = _filterByOffice(sheetData.slice(1), col, officeId);
    for (var i = 0; i < filtered.length; i++) {
      var row = filtered[i];
      var dsi = String(tCol(row,col,'DSI')||'').trim(); if (!dsi) continue;
      if (t === 1 && tolDsis[dsi]) continue; // AOR: skip DSIs already sourced from TOL
      var od = _parseDateLocal(tCol(row,col,'ORDER_DATE')); if (!od) continue;
      if (targets.indexOf(od.getTime()) === -1) continue;
      if (!dsiRows[dsi]) { dsiRows[dsi] = []; dsiCols[dsi] = col; }
      dsiRows[dsi].push(row);
    }
    if (t === 0) Object.keys(dsiRows).forEach(function(d) { tolDsis[d] = true; });
  }

  // Source 2: Local sales sheet (_Sales_elevate) — catches orders not yet in Tableau sync
  var salesSheet = ss.getSheetByName(officeTab(TAB.SALES, officeId));
  if (salesSheet) {
    var salesData = salesSheet.getDataRange().getValues();
    for (var j = 1; j < salesData.length; j++) {
      var sr = salesData[j];
      var sDsi = String(sr[OL.DSI]||'').trim();
      if (dsiRows[sDsi]) continue; // Already captured from Tableau
      var sDate = _parseDateLocal(sr[OL.DATE_OF_SALE]);
      if (!sDate || targets.indexOf(sDate.getTime()) === -1) continue;
      // Build a result row in the same shape as _buildTolRow output
      var pCounts = {};
      if (Number(sr[OL.CELL])||0)     pCounts['WIRELESS']  = Number(sr[OL.CELL]);
      if (Number(sr[OL.AIR])||0)      pCounts['AIR/AWB']   = Number(sr[OL.AIR]);
      if (Number(sr[OL.FIBER])||0)    pCounts['FIBER']     = Number(sr[OL.FIBER]);
      if (Number(sr[OL.VOIP_QTY])||0) pCounts['VOIP']      = Number(sr[OL.VOIP_QTY]);
      if (Number(sr[OL.DTV])||0)      pCounts['DTV']       = Number(sr[OL.DTV]);
      var sStatus = String(sr[OL.STATUS]||'').trim() || 'Pending';
      var key = sDsi || ('_s' + j);
      dsiRows[key] = [{
        _fromSales: true,
        dsi: sDsi,
        rep: String(sr[OL.REP_NAME]||'').trim(),
        orderDate: sDate.toISOString().split('T')[0],
        productCounts: pCounts,
        statusCounts: {},
        unitCount: Number(sr[OL.UNITS])||0,
        spe: String(sr[OL.CLIENT_NAME]||'').trim(),
        installDate: String(sr[OL.INSTALL_DATE]||'').trim()
      }];
      dsiRows[key][0].statusCounts[sStatus] = 1;
      dsiCols[key] = null;
    }
  }

  var results = [];
  Object.keys(dsiRows).forEach(function(dsi) {
    var rows = dsiRows[dsi];
    if (rows[0]._fromSales) {
      results.push(rows[0]); // Already in output shape
    } else {
      results.push(_buildTolRow(rows[0], dsiCols[dsi], rows));
    }
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


// ── ORDER ISSUES ─────────────────────────────────────────────────────────
// Qualifies if ANY line on a DSI has one of these DTR_STATUS values:
// Porting Issue, Port Approved, Pending Order Port, BYOD, Pending Valid Payment
function _isIssueStatus(s) {
  var sl = String(s||'').toLowerCase().trim();
  return sl === 'porting issue'        || sl.indexOf('porting issue') !== -1 ||
         sl === 'port approved'        || sl.indexOf('port approved') !== -1 ||
         sl === 'pending order port'   || sl.indexOf('pending order port') !== -1 ||
         sl === 'byod'                 || sl.indexOf('byod') !== -1 ||
         sl === 'pending valid payment'|| sl.indexOf('pending valid payment') !== -1;
}
function readOrderIssues(ss, officeId) {
  // Collect all rows per DSI from TOL, then AOR for DSIs not in TOL
  var tolRows = {}, tolCols = {}, aorRows = {}, aorCols = {};
  var tabs = [TABLEAU_TAB, AOR_TAB];
  for (var t = 0; t < tabs.length; t++) {
    var sheet = ss.getSheetByName(tabs[t]); if (!sheet) continue;
    var data = sheet.getDataRange().getValues(); if (data.length < 2) continue;
    var col = buildTableauColumnMap(data[0]);
    var rows = _filterByOffice(data.slice(1), col, officeId);
    var store = t === 0 ? tolRows : aorRows;
    var storeCols = t === 0 ? tolCols : aorCols;
    for (var i = 0; i < rows.length; i++) {
      var dsi = String(tCol(rows[i],col,'DSI')||'').trim(); if (!dsi) continue;
      if (!store[dsi]) { store[dsi] = []; storeCols[dsi] = col; }
      store[dsi].push(rows[i]);
    }
  }
  // Merge: TOL primary, AOR fills in DSIs not in TOL
  var dsiRows = {}, dsiCols = {};
  Object.keys(tolRows).forEach(function(d) { dsiRows[d] = tolRows[d]; dsiCols[d] = tolCols[d]; });
  Object.keys(aorRows).forEach(function(d) {
    if (!dsiRows[d]) { dsiRows[d] = aorRows[d]; dsiCols[d] = aorCols[d]; }
  });
  // 29-day window
  var today = new Date(); today.setHours(0,0,0,0);
  var cutoff = new Date(today.getTime() - 28 * 86400000);
  var results = [];
  Object.keys(dsiRows).forEach(function(dsi) {
    var rows = dsiRows[dsi]; var col = dsiCols[dsi];
    // Date window check
    var od = _parseDateLocal(tCol(rows[0],col,'ORDER_DATE'));
    if (!od || od.getTime() < cutoff.getTime()) return;
    // Must have at least one qualifying status line
    if (!rows.some(function(r) { return _isIssueStatus(tCol(r,col,'DTR_STATUS')); })) return;
    results.push(_buildTolRow(rows[0], col, rows));
  });
  return results;
}

// ── MASTER TRACKER ───────────────────────────────────────────────────────
// Shows all orders in a 120-day window from both Tableau and local sales.
// Excludes DSIs where every single line is Active, Canceled, Disconnected, or Posted.
function _isExcludedStatus(s) {
  var sl = String(s||'').toLowerCase().trim();
  return sl === 'active' || sl === 'posted' ||
         sl.indexOf('cancel') !== -1 || sl.indexOf('disco') !== -1;
}
function readMasterTracker(ss, officeId) {
  var today = new Date(); today.setHours(0,0,0,0);
  var cutoff = new Date(today.getTime() - 119 * 86400000); // 120-day inclusive window
  var dsiRows = {}, dsiCols = {}, tolDsis = {};
  // Source 1: Tableau (TOL + AOR), office-filtered. TOL is primary; AOR fills missing DSIs only.
  var tabs = [TABLEAU_TAB, AOR_TAB];
  for (var t = 0; t < tabs.length; t++) {
    var sheetData = _getSheetData(ss, tabs[t]); if (!sheetData || sheetData.length < 2) continue;
    var col = buildTableauColumnMap(sheetData[0]);
    var filtered = _filterByOffice(sheetData.slice(1), col, officeId);
    for (var i = 0; i < filtered.length; i++) {
      var row = filtered[i];
      var dsi = String(tCol(row,col,'DSI')||'').trim(); if (!dsi) continue;
      if (t === 1 && tolDsis[dsi]) continue; // AOR: skip DSIs already sourced from TOL
      var od = _parseDateLocal(tCol(row,col,'ORDER_DATE')); if (!od) continue;
      if (od.getTime() < cutoff.getTime()) continue;
      if (!dsiRows[dsi]) { dsiRows[dsi] = []; dsiCols[dsi] = col; }
      dsiRows[dsi].push(row);
    }
    if (t === 0) Object.keys(dsiRows).forEach(function(d) { tolDsis[d] = true; });
  }
  // Source 2: Local sales sheet — fills in DSIs not yet synced to Tableau
  var salesSheet = ss.getSheetByName(officeTab(TAB.SALES, officeId));
  if (salesSheet) {
    var salesData = salesSheet.getDataRange().getValues();
    for (var j = 1; j < salesData.length; j++) {
      var sr = salesData[j];
      var sDsi = String(sr[OL.DSI]||'').trim();
      if (dsiRows[sDsi]) continue;
      var sDate = _parseDateLocal(sr[OL.DATE_OF_SALE]);
      if (!sDate || sDate.getTime() < cutoff.getTime()) continue;
      var key = sDsi || ('_s' + j);
      var pCounts = {};
      if (Number(sr[OL.CELL])||0)     pCounts['WIRELESS'] = Number(sr[OL.CELL]);
      if (Number(sr[OL.AIR])||0)      pCounts['AIR/AWB']  = Number(sr[OL.AIR]);
      if (Number(sr[OL.FIBER])||0)    pCounts['FIBER']    = Number(sr[OL.FIBER]);
      if (Number(sr[OL.VOIP_QTY])||0) pCounts['VOIP']     = Number(sr[OL.VOIP_QTY]);
      if (Number(sr[OL.DTV])||0)      pCounts['DTV']      = Number(sr[OL.DTV]);
      var sStatus = String(sr[OL.STATUS]||'').trim() || 'Pending';
      var sCounts = {}; sCounts[sStatus] = 1;
      dsiRows[key] = [{ _fromSales:true, dsi:sDsi, rep:String(sr[OL.REP_NAME]||'').trim(),
        orderDate:sDate.toISOString().split('T')[0], productCounts:pCounts, statusCounts:sCounts,
        unitCount:Number(sr[OL.UNITS])||0, spe:String(sr[OL.CLIENT_NAME]||'').trim(),
        installDate:String(sr[OL.INSTALL_DATE]||'').trim() }];
      dsiCols[key] = null;
    }
  }
  // Exclude DSIs where ALL lines have excluded statuses
  var results = [];
  Object.keys(dsiRows).forEach(function(dsi) {
    var rows = dsiRows[dsi]; var col = dsiCols[dsi];
    if (rows[0]._fromSales) {
      if (!_isExcludedStatus(Object.keys(rows[0].statusCounts)[0]||'')) results.push(rows[0]);
      return;
    }
    if (rows.every(function(r) { return _isExcludedStatus(tCol(r,col,'DTR_STATUS')); })) return;
    results.push(_buildTolRow(rows[0], col, rows));
  });
  return results;
}

function readCompletedOrders(ss, officeId) {
  var today = new Date(); today.setHours(0,0,0,0);
  var cutoff = new Date(today.getTime() - 119 * 86400000); // 120-day inclusive window
  var dsiRows = {}, dsiCols = {}, tolDsis = {};
  // Source 1: Tableau (TOL + AOR), office-filtered. TOL is primary; AOR fills missing DSIs only.
  var tabs = [TABLEAU_TAB, AOR_TAB];
  for (var t = 0; t < tabs.length; t++) {
    var sheetData = _getSheetData(ss, tabs[t]); if (!sheetData || sheetData.length < 2) continue;
    var col = buildTableauColumnMap(sheetData[0]);
    var filtered = _filterByOffice(sheetData.slice(1), col, officeId);
    for (var i = 0; i < filtered.length; i++) {
      var row = filtered[i];
      var dsi = String(tCol(row,col,'DSI')||'').trim(); if (!dsi) continue;
      if (t === 1 && tolDsis[dsi]) continue; // AOR: skip DSIs already sourced from TOL
      var od = _parseDateLocal(tCol(row,col,'ORDER_DATE')); if (!od) continue;
      if (od.getTime() < cutoff.getTime()) continue;
      if (!dsiRows[dsi]) { dsiRows[dsi] = []; dsiCols[dsi] = col; }
      dsiRows[dsi].push(row);
    }
    if (t === 0) Object.keys(dsiRows).forEach(function(d) { tolDsis[d] = true; });
  }
  // Source 2: Local sales sheet — fills in DSIs not yet synced to Tableau
  var salesSheet = ss.getSheetByName(officeTab(TAB.SALES, officeId));
  if (salesSheet) {
    var salesData = salesSheet.getDataRange().getValues();
    for (var j = 1; j < salesData.length; j++) {
      var sr = salesData[j];
      var sDsi = String(sr[OL.DSI]||'').trim();
      if (dsiRows[sDsi]) continue;
      var sDate = _parseDateLocal(sr[OL.DATE_OF_SALE]);
      if (!sDate || sDate.getTime() < cutoff.getTime()) continue;
      var key = sDsi || ('_s' + j);
      var pCounts = {};
      if (Number(sr[OL.CELL])||0)     pCounts['WIRELESS'] = Number(sr[OL.CELL]);
      if (Number(sr[OL.AIR])||0)      pCounts['AIR/AWB']  = Number(sr[OL.AIR]);
      if (Number(sr[OL.FIBER])||0)    pCounts['FIBER']    = Number(sr[OL.FIBER]);
      if (Number(sr[OL.VOIP_QTY])||0) pCounts['VOIP']     = Number(sr[OL.VOIP_QTY]);
      if (Number(sr[OL.DTV])||0)      pCounts['DTV']      = Number(sr[OL.DTV]);
      var sStatus = String(sr[OL.STATUS]||'').trim() || 'Pending';
      var sCounts = {}; sCounts[sStatus] = 1;
      dsiRows[key] = [{ _fromSales:true, dsi:sDsi, rep:String(sr[OL.REP_NAME]||'').trim(),
        orderDate:sDate.toISOString().split('T')[0], productCounts:pCounts, statusCounts:sCounts,
        unitCount:Number(sr[OL.UNITS])||0, spe:String(sr[OL.CLIENT_NAME]||'').trim(),
        installDate:String(sr[OL.INSTALL_DATE]||'').trim() }];
      dsiCols[key] = null;
    }
  }
  // Include only DSIs where ALL lines have completed statuses (Active, Posted, Canceled, Disconnected)
  var results = [];
  Object.keys(dsiRows).forEach(function(dsi) {
    var rows = dsiRows[dsi]; var col = dsiCols[dsi];
    if (rows[0]._fromSales) {
      if (_isExcludedStatus(Object.keys(rows[0].statusCounts)[0]||'')) results.push(rows[0]);
      return;
    }
    if (!rows.every(function(r) { return _isExcludedStatus(tCol(r,col,'DTR_STATUS')); })) return;
    results.push(_buildTolRow(rows[0], col, rows));
  });
  return results;
}

// ── NOTES & RATINGS ──────────────────────────────────────────────────────
function readNotes(ss, officeId) {
  var sheet = ss.getSheetByName('_Notes_'+officeId); if (!sheet) return {};
  var data = sheet.getDataRange().getValues(); if (data.length < 2) return {};
  var out = {};
  for (var i=1;i<data.length;i++) {
    var dsi = String(data[i][0]||'').trim(); if (!dsi) continue;
    if (!out[dsi]) out[dsi] = [];
    out[dsi].push({ ts: data[i][1]?new Date(data[i][1]).toISOString():'', authorEmail:String(data[i][2]||'').trim(), authorName:String(data[i][3]||'').trim(), noteText:String(data[i][4]||'').trim(), noteType:String(data[i][5]||'activation').trim(), linesActivated:Math.max(0,parseInt(data[i][6],10)||0) });
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
  // Lines activated — only meaningful on activation notes; coerced to a count.
  var linesActivated=Math.max(0,parseInt(body.linesActivated,10)||0);
  if (noteType!=='activation') linesActivated=0;
  if (!dsi||!noteText) return { error:'missing dsi or noteText' };
  var tabName='_Notes_'+officeId;
  var sheet=ss.getSheetByName(tabName);
  if (!sheet) { sheet=ss.insertSheet(tabName); sheet.appendRow(['dsi','timestamp','authorEmail','authorName','noteText','noteType','linesActivated']); sheet.getRange(1,1,1,7).setFontWeight('bold'); sheet.setFrozenRows(1); }
  _safeAppend(sheet, [dsi, new Date(), authorEmail, authorName, noteText, noteType, linesActivated]);
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
  _safeAppend(sheet, [dsi, rating, new Date(), updatedBy]);
  return { ok:true };
}

function doGet(e) {
  const key = (e && e.parameter && e.parameter.key) || '';
  if (!validateKey(key)) return jsonResponse({ error: 'unauthorized' });
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    const officeId = (e && e.parameter && e.parameter.officeId) || DEFAULT_OFFICE_ID;
    const ss = getSheet(e && e.parameter);
    // Stage C: in strict mode, reads also require a valid badge.
    if (_strictAuth()) {
      var _gs=_validateSession(ss, e.parameter && e.parameter.token);
      if (!_gs || !_gs.valid) return jsonResponse({ error:'auth_required' });
      if (e.parameter && e.parameter.officeId && !_officeAllowed(_gs, e.parameter.officeId)) return jsonResponse({ error:'forbidden_office' });
    }
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
      return jsonResponse({ orders: _scopeOrdersAuthed(ss, officeId, readOrders(ss, officeId, filterEmail || null), _gs) });
    }
    if (action === 'readPayrollOrders') {
      var payrollMode = (e.parameter && e.parameter.payrollMode) || 'commission-split';
      return jsonResponse({ orders: readPayrollOrders(ss, officeId, payrollMode) });
    }
    if (action === 'readTrainingOrders') return jsonResponse({ orders: readTrainingOrders(ss, officeId) });
    if (action === 'readTableauSummary') return jsonResponse(getTableauSummaryWithCache(ss, officeId));
    if (action === 'readDayAfter') return jsonResponse({ orders: _scopeOrdersAuthed(ss, officeId, readDayAfterOrders(ss, officeId), _gs) });
    if (action === 'readDelivered') return jsonResponse({ orders: _scopeOrdersAuthed(ss, officeId, readDeliveredNotActive(ss, officeId), _gs) });
    if (action === 'readIssues') return jsonResponse({ orders: _scopeOrdersAuthed(ss, officeId, readOrderIssues(ss, officeId), _gs) });
    if (action === 'readCompleted') return jsonResponse({ orders: _scopeOrdersAuthed(ss, officeId, readCompletedOrders(ss, officeId), _gs) });
    if (action === 'readActRateLines') return jsonResponse({ actRateLines: readActRateLines(ss, officeId), _v: 13 });
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
    if (action === 'getDailyReportDates') return jsonResponse({ dates: getDailyReportDates(ss, officeId) });
    if (action === 'readDailyReport') {
      var rdrDate = (e.parameter && e.parameter.date) || new Date().toISOString().split('T')[0];
      return jsonResponse({ report: readDailyReport(ss, officeId, rdrDate) });
    }
    if (action === 'readPostedSales') return jsonResponse({ sales: readPostedSales(ss, officeId) });
    if (action === 'readMyPostedSales') return jsonResponse({ sales: _scopePostedSales(readPostedSales(ss, officeId, true), _gs) });
    if (action === 'readRepLineStats') {
      var rls_email = (e.parameter && e.parameter.repEmail) || '';
      return jsonResponse(readRepLineStats(ss, officeId, rls_email));
    }
    let roster = readRoster(ss, officeId);
    const teamMaps = buildTeamEmojiMaps(ss, officeId);
    const peopleResult = readPeople(ss, officeId, roster, teamMaps.nameMap);
    const tableauSummary = getTableauSummaryWithCache(ss, officeId);
    roster = autoAssignTableauNames(ss, officeId, roster, tableauSummary.possibleTableauNames);
    const _teamsObj = readTeams(ss, officeId);
    const _tHealth = _tableauMatchHealth(ss, officeId);
    const tableauWarning = (_tHealth.rawRows > 0 && _tHealth.matchedRows === 0)
      ? 'No order data matched this office, so the call-log tabs may appear empty. This usually means the company-name mapping changed in the Tableau export - please let an admin know.'
      : '';
    if (tableauWarning) { try { console.warn('Tableau office-match returned 0 rows for ' + officeId + ' (raw rows ' + _tHealth.rawRows + ') - OFFICE_OWNER_MAP likely drifted.'); } catch (e) {} }
    const data = {
      people: peopleResult.people || peopleResult,
      roster: roster,
      teamMap: teamMaps.emojiMap,
      teams: _teamsObj,
      orderOverrides: readOrderOverrides(ss, officeId),
      teamCustomizations: readTeamCustomizations(ss, officeId),
      unlockRequests: readUnlockRequests(ss, officeId),
      settings: readSettings(ss, officeId),
      churnReport: readChurnReport(ss, officeId),
      aorData: readAOR(ss),
      dayAfterOrders: _scopeOrders(readDayAfterOrders(ss, officeId), _gs, roster, _teamsObj),
      deliveredOrders: _scopeOrders(readDeliveredNotActive(ss, officeId), _gs, roster, _teamsObj),
      orderIssues: _scopeOrders(readOrderIssues(ss, officeId), _gs, roster, _teamsObj),
      masterTracker: _scopeOrders(readMasterTracker(ss, officeId), _gs, roster, _teamsObj),
      completedOrders: _scopeOrders(readCompletedOrders(ss, officeId), _gs, roster, _teamsObj),
      notes: readNotes(ss, officeId),
      ratings: readRatings(ss, officeId),
      guestRoster: readCrossOfficeMembers(ss, officeId),
      tableauWarning: tableauWarning
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
      rank:String(data[i][3]||'client-rep').trim(),
      deactivated:data[i][4]===true||String(data[i][4]).toUpperCase()==='TRUE',
      dateAdded:data[i][5]||'', hasPin:pinVal.length>0&&pinVal!=='undefined',
      phone:String(data[i][7]||'').trim(), tableauName:String(data[i][8]||'').trim(),
      permissions:homePermissions, timezone:String(data[i][10]||'').trim() };
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

// ── TRAINING & TRACKING ───────────────────────────────────────────────────
// Source = the Post Sale form's sheet (_PostedSales_<office>) so orders appear
// as reps post them. Filters to the 3 payout types (trainee Split, codes-swap
// Profit Transfer, Sunday Order) over a 60-day window, attaches SPE numbers from
// the Tableau sync by DSI, and reads/writes a self-contained 'Paid Out' column.
var POSTED = { REP_NAME:2, DATE:4, DSI:5, ACCOUNT_TYPE:6, CODES_USED_BY:9, TRAINEE:10, TRAINEE_NAME:11,
               AIR:12, WIRELESS_NEW:13, WIRELESS_BYOD:14, FIBER_PKG:15, VOIP:17, NOTES:20 };

// Ensure the Post Sale sheet has a 'Paid Out' column; return its 1-based index.
function _ensurePostedPaidOutCol(sheet) {
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1,1,1,lastCol).getValues()[0];
  for (var c=0;c<header.length;c++) { if (String(header[c]||'').trim()==='Paid Out') return c+1; }
  var col = lastCol + 1;
  sheet.getRange(1,col).setValue('Paid Out').setFontWeight('bold');
  return col;
}

function readTrainingOrders(ss, officeId) {
  var sheet = ss.getSheetByName('_PostedSales_' + officeId); if (!sheet) return [];
  var paidCol = _ensurePostedPaidOutCol(sheet); var paidIdx = paidCol - 1;
  var voidedCol = _ensurePostedVoidedCol(sheet); var voidedIdx = voidedCol - 1;
  var data = sheet.getDataRange().getValues(); if (data.length < 2) return [];
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate()-60); cutoff.setHours(0,0,0,0);
  var orders = [];
  for (var i=1;i<data.length;i++) {
    var row = data[i];
    if (String(row[voidedIdx]||'').trim().toLowerCase() === 'true') continue;
    var dsi = String(row[POSTED.DSI]||'').trim();
    var trainee = String(row[POSTED.TRAINEE]||'').trim().toLowerCase();
    var codesUsedBy = String(row[POSTED.CODES_USED_BY]||'').trim().toLowerCase();
    var isTraineeOrder = (trainee==='yes'); var isCodesSwap = (codesUsedBy!=='');
    var rawDate = row[POSTED.DATE]; if (!rawDate) continue;
    var saleDate = new Date(rawDate); if (isNaN(saleDate.getTime())) continue;
    saleDate.setHours(0,0,0,0); if (saleDate < cutoff) continue;
    var isSunday = (saleDate.getDay()===0);
    // (no payout-type filter -- Training & Tracking lists every posted order)
    // Every applicable type stacks (display order Sunday > Profit Transfer > Split).
    var payTypes = [];
    if (isSunday) payTypes.push('sunday');
    if (isCodesSwap) payTypes.push('profit-transfer');
    if (isTraineeOrder) payTypes.push('split');
    var paidOut = {}; try { var rp = String(row[paidIdx]||'').trim(); if (rp) paidOut = JSON.parse(rp); } catch(e) {}
    orders.push({
      rowIndex: i+1, repName: String(row[POSTED.REP_NAME]||'').trim(),
      traineeName: String(row[POSTED.TRAINEE_NAME]||'').trim(), dsi: dsi,
      accountType: String(row[POSTED.ACCOUNT_TYPE]||'').trim(),
      dateOfSale: _drNormDate(saleDate),
      air: Number(row[POSTED.AIR])||0,
      cell: (Number(row[POSTED.WIRELESS_NEW])||0) + (Number(row[POSTED.WIRELESS_BYOD])||0),
      fiber: String(row[POSTED.FIBER_PKG]||'').trim() ? 1 : 0,
      voip: Number(row[POSTED.VOIP])||0,
      notes: String(row[POSTED.NOTES]||'').trim(), codesUsedBy: codesUsedBy,
      payTypes: payTypes, paidOut: paidOut, speList: []
    });
  }
  // Attach SPE numbers from the raw _TableauOrderLog tab, matched by DSI.
  // Normalized match (uppercase, strip non-alphanumerics, drop optional "DSI"
  // prefix) so a DSI typed into Post Sale matches the raw "DSI#########" format
  // regardless of casing/spacing/prefix.
  try {
    var summary = getTableauSummaryWithCache(ss, officeId);
    var dsiSummary = (summary && summary.dsiSummary) || {};
    var _normDsi = function(d) { return String(d||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^DSI/,''); };
    var speByDsi = {};
    Object.keys(dsiSummary).forEach(function(k) {
      var n = _normDsi(k); var sl = dsiSummary[k] && dsiSummary[k].speList;
      if (!n || !sl || !sl.length) return;
      var bucket = speByDsi[n] || (speByDsi[n] = []);
      sl.forEach(function(spe) { if (bucket.indexOf(spe) === -1) bucket.push(spe); });
    });
    orders.forEach(function(o) { var sl = speByDsi[_normDsi(o.dsi)]; if (sl && sl.length) o.speList = sl; });
  } catch(e) {}
  orders.sort(function(a,b) { return b.dateOfSale.localeCompare(a.dateOfSale); });
  return orders;
}

function readSettings(ss, officeId) {
  const sheet=ss.getSheetByName(officeTab(TAB.SETTINGS,officeId)); if (!sheet) return {};
  const data=sheet.getDataRange().getValues(); const result={};
  for (let i=1;i<data.length;i++) { const key=String(data[i][0]||'').trim(); if (key) result[key]=String(data[i][1]||'').trim(); }
  return result;
}

function readChurnReport(ss, officeId) {
  var data = _getSheetData(ss, CHURN_REPORT_TAB); if (!data || data.length < 2) return [];
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var bucketIdx = headers.indexOf('Churn Buckets');
  var officeIdx = -1;
  for (var hi = 0; hi < headers.length; hi++) {
    if (headers[hi].toUpperCase() === 'OWNER & OFFICE') { officeIdx = hi; break; }
  }
  var repIdx   = headers.indexOf('Rep');
  var colorIdx = headers.indexOf('30-60 Color Churn (copy)');
  var actIdx   = headers.indexOf('Activated SPE/SP');
  var rateIdx  = headers.indexOf('Churn Rate');
  var discoIdx = headers.indexOf('Disconnect count (SPE/SP)');
  var match = officeId ? (OFFICE_OWNER_MAP[officeId] || '').toLowerCase() : '';
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (match && officeIdx !== -1 && String(row[officeIdx]||'').toLowerCase().indexOf(match) === -1) continue;
    rows.push({
      bucket:      String(row[bucketIdx] || '').trim(),
      rep:         String(row[repIdx]    || '').trim(),
      color:       String(row[colorIdx]  || '').trim(),
      activated:   Number(row[actIdx])   || 0,
      churnRate:   String(row[rateIdx]   || '').trim(),
      disconnects: Number(row[discoIdx]) || 0
    });
  }
  return rows;
}

// === readAOR() — Read shared _TableauAOR tab ===
function readAOR(ss) {
  var data=_getSheetData(ss,AOR_TAB); if (!data||data.length<2) return [];
  var headers=data[0].map(function(h) { return String(h).trim(); });
  var rows=[];
  for (var i=1;i<data.length;i++) {
    var row={}; headers.forEach(function(h,j) { row[h||('_col'+j)]=data[i][j]!==undefined?data[i][j]:''; }); rows.push(row);
  }
  return rows;
}

function readActRateLines(ss, officeId) {
  var sheetData = _getSheetData(ss, '_TableauActivationRates'); if (!sheetData || sheetData.length < 2) return [];
  var col = buildTableauColumnMap(sheetData[0]);
  var filtered = _filterByOffice(sheetData.slice(1), col, officeId);
  var lines = [];
  for (var i = 0; i < filtered.length; i++) {
    var row = filtered[i];
    var rep = String(tCol(row,col,'REP')||'').trim(); if (!rep) continue;
    var bucket = String(tCol(row,col,'ACTIVATION_BUCKET')||'').trim(); if (!bucket) continue;
    var vol = Number(tCol(row,col,'SALES_VOL')) || 0;
    var acts = Number(tCol(row,col,'SALES_ACTS')) || 0;
    if (vol <= 0) continue;
    lines.push({ rep:rep, bucket:bucket, vol:vol, acts:acts });
  }
  return lines;
}

// ── DAILY REPORT ──────────────────────────────────────────────────────────
// Normalize a sheet date cell to YYYY-MM-DD.
// Google Sheets auto-converts "2026-06-07" strings to Date objects on write;
// getValues() then returns a Date, not the original string.
function _drNormDate(v) {
  if (v instanceof Date) {
    var y=v.getFullYear(), m=v.getMonth()+1, d=v.getDate();
    return y+'-'+(m<10?'0':'')+m+'-'+(d<10?'0':'')+d;
  }
  return String(v).trim();
}

function _getDailyReportSheet(ss, officeId) {
  var tabName = '_DailyReports_' + officeId;
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(['date','generatedAt','reportJson']);
    sheet.getRange(1,1,1,3).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,sheet.getMaxRows(),1).setNumberFormat('@STRING@');
  }
  return sheet;
}

// Appointments/bookings summary for one office on a given date, for the Daily
// Report. Reads the 'Appointments' tab (same master spreadsheet). Columns:
// 0 id,1 activatorEmail,2 booker,3 customerName,4 dsi,5 phone,6 email,7 services,
// 8 deviceCount,9 date,10 timeSlot,11 office,12 status,13 bookedAt,14 rem,
// 15 outcome,16 outcomeNote,17 outcomeBy,18 outcomeAt
// Three groups, all keyed to dateStr:
//   booked        — appts CREATED that day (bookedAt date part)
//   scheduled     — appts HAPPENING that day (date col, non-cancelled)
//   statusChanges — appts whose outcome was SET/changed that day (outcomeAt date
//                   part) — completed | no-show | rescheduled | canceled —
//                   regardless of the appt's own date.
function _drAppointments(ss, officeId, dateStr) {
  var out = { date: dateStr,
    scheduled:     { total:0, completed:0, noShow:0, rescheduled:0, canceled:0, unmarked:0, list:[], byActivator:[] },
    booked:        { total:0, list:[] },
    statusChanges: { total:0, completed:0, noShow:0, rescheduled:0, canceled:0, list:[] },
    bookedToday: 0, tomorrow: 0 };
  var sheet = ss.getSheetByName('Appointments');
  if (!sheet) return out;
  var TZ = Session.getScriptTimeZone();
  function nDate(v){ if(v instanceof Date) return Utilities.formatDate(v, TZ,'yyyy-MM-dd'); var s=String(v||'').trim(); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m?m[1]+'-'+m[2]+'-'+m[3]:s; }
  // Timestamp → local date (handles Date objects AND ISO strings like outcomeAt).
  function nTsDate(v){ if(v instanceof Date) return Utilities.formatDate(v, TZ,'yyyy-MM-dd'); var s=String(v||'').trim(); if(!s) return ''; var d=new Date(s); if(!isNaN(d.getTime())) return Utilities.formatDate(d, TZ,'yyyy-MM-dd'); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m?m[1]+'-'+m[2]+'-'+m[3]:s; }
  function nTime(v){ if(v instanceof Date) return Utilities.formatDate(v, TZ,'HH:mm'); var s=String(v||'').trim(); var m=s.match(/^(\d{1,2}):(\d{2})/); return m?('0'+m[1]).slice(-2)+':'+m[2]:s; }
  function tsTime(v){ if(!v) return ''; var d=(v instanceof Date)?v:new Date(String(v)); return isNaN(d.getTime())?'':Utilities.formatDate(d, TZ,'HH:mm'); }
  var nameMap = {};
  var rsheet = ss.getSheetByName('_Roster_'+officeId);
  if (rsheet){ var rd=rsheet.getDataRange().getValues(); for (var ri=1;ri<rd.length;ri++){ var em=String(rd[ri][0]||'').trim().toLowerCase(); if(em) nameMap[em]=String(rd[ri][1]||'').trim()||em; } }
  function nm(email){ var e=String(email||'').trim().toLowerCase(); return nameMap[e]||e; }
  var tomorrowStr = Utilities.formatDate(new Date(new Date(dateStr+'T12:00:00').getTime()+86400000), TZ,'yyyy-MM-dd');
  var data = sheet.getDataRange().getValues();
  var actAgg = {};
  var VALID_OUTCOMES = {'completed':1,'no-show':1,'rescheduled':1,'canceled':1};
  for (var i=1;i<data.length;i++){
    var r=data[i]; if(!r[0]) continue;
    if (String(r[11]||'').trim() !== officeId) continue;
    var status=String(r[12]||'').trim().toLowerCase();
    var dt=nDate(r[9]);
    var outcome=String(r[15]||'').trim().toLowerCase();
    var act=String(r[1]||'').trim().toLowerCase();
    var actName=nameMap[act]||act;

    // ── Booked that day (created on dateStr) ──
    if (r[13] && nTsDate(r[13])===dateStr) {
      out.bookedToday++; out.booked.total++;
      out.booked.list.push({ booker:nm(r[2]), activator:actName, customer:String(r[3]||'').trim(),
        dsi:String(r[4]||'').trim(), forDate:dt, timeSlot:nTime(r[10]),
        services:String(r[7]||'').trim(), devices:Number(r[8])||1, bookedTime:tsTime(r[13]) });
    }

    // ── Tomorrow lookahead ──
    if (dt===tomorrowStr && status!=='cancelled') out.tomorrow++;

    // ── Status changed that day (outcome set on dateStr) ──
    if (r[18] && VALID_OUTCOMES[outcome] && nTsDate(r[18])===dateStr) {
      out.statusChanges.total++;
      if (outcome==='completed') out.statusChanges.completed++;
      else if (outcome==='no-show') out.statusChanges.noShow++;
      else if (outcome==='rescheduled') out.statusChanges.rescheduled++;
      else if (outcome==='canceled') out.statusChanges.canceled++;
      out.statusChanges.list.push({ outcome:outcome, activator:actName, customer:String(r[3]||'').trim(),
        dsi:String(r[4]||'').trim(), apptDate:dt, timeSlot:nTime(r[10]),
        by:nm(r[17])||actName, at:tsTime(r[18]) });
    }

    // ── Scheduled (happening) that day ──
    if (dt!==dateStr || status==='cancelled') continue;
    out.scheduled.total++;
    if (outcome==='completed') out.scheduled.completed++;
    else if (outcome==='no-show') out.scheduled.noShow++;
    else if (outcome==='rescheduled') out.scheduled.rescheduled++;
    else if (outcome==='canceled') out.scheduled.canceled++;
    else out.scheduled.unmarked++;
    if(!actAgg[act]) actAgg[act]={name:actName,total:0,completed:0,noShow:0};
    actAgg[act].total++;
    if(outcome==='completed')actAgg[act].completed++;
    if(outcome==='no-show')actAgg[act].noShow++;
    out.scheduled.list.push({ timeSlot:nTime(r[10]), activator:actName, customer:String(r[3]||'').trim(), dsi:String(r[4]||'').trim(), services:String(r[7]||'').trim(), devices:Number(r[8])||1, outcome:outcome });
  }
  out.scheduled.byActivator = Object.keys(actAgg).map(function(k){return actAgg[k];}).sort(function(a,b){return b.total-a.total;});
  out.scheduled.list.sort(function(a,b){return String(a.timeSlot).localeCompare(String(b.timeSlot));});
  out.booked.list.sort(function(a,b){return String(a.timeSlot).localeCompare(String(b.timeSlot));});
  var OUT_ORDER={'completed':0,'no-show':1,'rescheduled':2,'canceled':3};
  out.statusChanges.list.sort(function(a,b){var d=(OUT_ORDER[a.outcome]||0)-(OUT_ORDER[b.outcome]||0); return d||String(a.at).localeCompare(String(b.at));});
  return out;
}

function generateDailyReport(ss, officeId, targetDateStr) {
  var refDate;
  if (targetDateStr) {
    refDate = new Date(targetDateStr+'T12:00:00'); refDate.setHours(0,0,0,0);
  } else {
    refDate = new Date(); refDate.setHours(0,0,0,0);
  }
  var todayStr = refDate.toISOString().split('T')[0];
  var refTomorrow = new Date(refDate.getTime()+86400000);

  // ── NOTES: entries timestamped on refDate ──
  // Also tallies activator-marked line activations ("Activated Today"): each
  // activation note carries a linesActivated count (col 7, 0-indexed 6).
  var notesSheet = ss.getSheetByName('_Notes_'+officeId);
  var todayNotes=[], todayDsiSet={};
  var activatedToday={ lines:0, orders:0, list:[] };
  var _actOrderSet={};
  if (notesSheet) {
    var nd=notesSheet.getDataRange().getValues();
    for (var ni=1;ni<nd.length;ni++) {
      var ndsi=String(nd[ni][0]||'').trim(); if (!ndsi) continue;
      var nts=nd[ni][1] instanceof Date?nd[ni][1]:(nd[ni][1]?new Date(nd[ni][1]):null);
      if (!nts||isNaN(nts.getTime())) continue;
      if (nts<refDate||nts>=refTomorrow) continue;
      todayDsiSet[ndsi]=true;
      var nType=String(nd[ni][5]||'activation').trim();
      var nLines=Math.max(0,parseInt(nd[ni][6],10)||0);
      var nAuthor=String(nd[ni][3]||'').trim();
      var nText=String(nd[ni][4]||'').trim();
      todayNotes.push({dsi:ndsi,ts:nts.toISOString(),authorName:nAuthor,noteText:nText});
      if (nType==='activation' && nLines>0) {
        activatedToday.lines+=nLines;
        _actOrderSet[ndsi]=true;
        activatedToday.list.push({dsi:ndsi,lines:nLines,activator:nAuthor,note:nText,ts:nts.toISOString()});
      }
    }
  }
  activatedToday.orders=Object.keys(_actOrderSet).length;
  activatedToday.list.sort(function(a,b){return String(a.ts).localeCompare(String(b.ts));});
  // Orders SUBMITTED on the Post Sale form for refDate (excludes voided). Separate
  // KPI from the Tableau-based metrics -- counts rep form posts, not synced orders.
  var ordersSubmitted=0;
  try { readPostedSales(ss, officeId).forEach(function(_ps){ if (_ps.dateOfSale===todayStr) ordersSubmitted++; }); } catch(_e) {}

  // ── RATINGS: entries updated on refDate ──
  var noAnswerDsis=[], escalationRatings=[];
  var ratingsSheet=ss.getSheetByName('_Ratings_'+officeId);
  if (ratingsSheet) {
    var ratData=ratingsSheet.getDataRange().getValues();
    for (var rii=1;rii<ratData.length;rii++) {
      var rDsi=String(ratData[rii][0]||'').trim(); if (!rDsi) continue;
      var rRating=String(ratData[rii][1]||'').trim();
      var rUpd=ratData[rii][2] instanceof Date?ratData[rii][2]:(ratData[rii][2]?new Date(String(ratData[rii][2])):null);
      if (!rUpd||isNaN(rUpd.getTime())) continue;
      if (rUpd<refDate||rUpd>=refTomorrow) continue;
      if (rRating==='No Answer') noAnswerDsis.push(rDsi);
      else if (rRating==='1 Star'||rRating==='2 Stars') escalationRatings.push({dsi:rDsi,rating:rRating});
    }
  }

  // ── DAY-AFTER ORDERS ──
  var dow=refDate.getDay();
  var daTargets=dow===1
    ?[new Date(refDate.getTime()-3*86400000).getTime(),new Date(refDate.getTime()-2*86400000).getTime(),new Date(refDate.getTime()-86400000).getTime()]
    :[new Date(refDate.getTime()-86400000).getTime()];
  var daDsiRows={},daDsiCols={},daTolDsis={};
  var daTabs=[TABLEAU_TAB,AOR_TAB];
  for (var dt=0;dt<daTabs.length;dt++) {
    var daSD=_getSheetData(ss,daTabs[dt]); if (!daSD||daSD.length<2) continue;
    var daCol=buildTableauColumnMap(daSD[0]);
    var daFiltered=_filterByOffice(daSD.slice(1),daCol,officeId);
    for (var dfi=0;dfi<daFiltered.length;dfi++) {
      var daRow=daFiltered[dfi];
      var daDsi=String(tCol(daRow,daCol,'DSI')||'').trim(); if (!daDsi) continue;
      if (dt===1&&daTolDsis[daDsi]) continue;
      var daOd=_parseDateLocal(tCol(daRow,daCol,'ORDER_DATE')); if (!daOd) continue;
      if (daTargets.indexOf(daOd.getTime())===-1) continue;
      if (!daDsiRows[daDsi]){daDsiRows[daDsi]=[];daDsiCols[daDsi]=daCol;}
      daDsiRows[daDsi].push(daRow);
    }
    if (dt===0) Object.keys(daDsiRows).forEach(function(d){daTolDsis[d]=true;});
  }
  var dayAfterOrders=[],dayAfterMap={};
  Object.keys(daDsiRows).forEach(function(d){
    var o=_buildTolRow(daDsiRows[d][0],daDsiCols[d],daDsiRows[d]);
    dayAfterOrders.push(o); dayAfterMap[d]=o;
  });

  // ── DELIVERED + ISSUES ──
  var deliveredOrders=readDeliveredNotActive(ss,officeId);
  var orderIssues=readOrderIssues(ss,officeId);
  var deliveredMap={},issuesMap={};
  deliveredOrders.forEach(function(o){if(o.dsi)deliveredMap[o.dsi]=o;});
  orderIssues.forEach(function(o){if(o.dsi)issuesMap[o.dsi]=o;});
  var dayAfterDsiSet={},deliveredDsiSet={},issuesDsiSet={};
  dayAfterOrders.forEach(function(o){if(o.dsi)dayAfterDsiSet[o.dsi]=true;});
  deliveredOrders.forEach(function(o){if(o.dsi)deliveredDsiSet[o.dsi]=true;});
  orderIssues.forEach(function(o){if(o.dsi)issuesDsiSet[o.dsi]=true;});

  // ── CALL ACTIVITY COUNTS ──
  var callCategories={
    dayAfterTotal:  dayAfterOrders.length,
    dayAfterWorked: dayAfterOrders.filter(function(o){return o.dsi&&todayDsiSet[o.dsi];}).length,
    deliveredWorked:deliveredOrders.filter(function(o){return o.dsi&&todayDsiSet[o.dsi];}).length,
    issuesWorked:   orderIssues.filter(function(o){return o.dsi&&todayDsiSet[o.dsi];}).length,
    noAnswerTotal:  noAnswerDsis.length,
    escalationTotal:escalationRatings.length
  };

  // ── ORDER DETAIL LOOKUP for calls worked ──
  var orderDetailMap={};
  dayAfterOrders.forEach(function(o){if(o.dsi)orderDetailMap[o.dsi]=o;});
  deliveredOrders.forEach(function(o){if(o.dsi&&!orderDetailMap[o.dsi])orderDetailMap[o.dsi]=o;});
  orderIssues.forEach(function(o){if(o.dsi&&!orderDetailMap[o.dsi])orderDetailMap[o.dsi]=o;});
  var otherDsis=Object.keys(todayDsiSet).filter(function(d){return !orderDetailMap[d];});
  if (otherDsis.length>0) {
    var otherSet={};
    otherDsis.forEach(function(d){otherSet[d]=true;});
    var fbData=_getSheetData(ss,TABLEAU_TAB);
    if (fbData&&fbData.length>=2) {
      var fbCol=buildTableauColumnMap(fbData[0]),fbDsiRows={};
      _filterByOffice(fbData.slice(1),fbCol,officeId).forEach(function(row){
        var d=String(tCol(row,fbCol,'DSI')||'').trim(); if (!otherSet[d]) return;
        if (!fbDsiRows[d]) fbDsiRows[d]=[];
        fbDsiRows[d].push(row);
      });
      Object.keys(fbDsiRows).forEach(function(d){
        orderDetailMap[d]=_buildTolRow(fbDsiRows[d][0],fbCol,fbDsiRows[d]);
      });
    }
  }

  // ── CALLS WORKED: grouped by category with order details ──
  var notesByDsi={};
  todayNotes.forEach(function(n){
    if (!notesByDsi[n.dsi]) notesByDsi[n.dsi]=[];
    notesByDsi[n.dsi].push({ts:n.ts,authorName:n.authorName,noteText:n.noteText});
  });
  function _workedEntry(dsi){
    var o=orderDetailMap[dsi]||{dsi:dsi,rep:'',orderDate:'',productCounts:{},statusCounts:{}};
    return {dsi:dsi,rep:o.rep||'',orderDate:o.orderDate||'',productCounts:o.productCounts||{},statusCounts:o.statusCounts||{},notes:notesByDsi[dsi]||[]};
  }
  var callsWorked={dayafter:[],delivered:[],issues:[],other:[]};
  Object.keys(todayDsiSet).forEach(function(dsi){
    if      (dayAfterDsiSet[dsi])  callsWorked.dayafter.push(_workedEntry(dsi));
    else if (deliveredDsiSet[dsi]) callsWorked.delivered.push(_workedEntry(dsi));
    else if (issuesDsiSet[dsi])    callsWorked.issues.push(_workedEntry(dsi));
    else                           callsWorked.other.push(_workedEntry(dsi));
  });

  // ── STATUS BREAKDOWN (housing cells) ──
  // "New Internet" cell counts ONLY internet lines (product type contains "internet",
  // Air excluded) — never the wireless/voice/DTV lines bundled on the same order. An
  // internet line whose product type contains "upgrade" => existing, else new. VoIP
  // attach = sum of the numeric Voice Line Count on the order's voice lines.
  // The other three cells (Completed/Issues/Pending) are unchanged: they bucket non-
  // internet orders by status exactly as before (any order with a fiber/internet line
  // is excluded from them).
  var sbCustOther={},sbLinesOther={};
  var niStatusCust={},niStatusLines={};
  var niOrders=0,niNew=0,niExisting=0,niVoipTotal=0,niWithVoip=0,niNoVoip=0;
  function _isInternetPt(pt){ pt=String(pt||'').toLowerCase(); return pt.indexOf('internet')!==-1 && pt.indexOf('air')===-1; }
  function _isVoicePt(pt){ return String(pt||'').toLowerCase().indexOf('voice')!==-1; }
  var tolData=_getSheetData(ss,TABLEAU_TAB);
  if (tolData&&tolData.length>=2) {
    var sbCol=buildTableauColumnMap(tolData[0]);
    var cutoff120=new Date(refDate.getTime()-119*86400000);
    var dsiLineMap={};
    _filterByOffice(tolData.slice(1),sbCol,officeId).forEach(function(row){
      var d=String(tCol(row,sbCol,'DSI')||'').trim(); if (!d) return;
      var od=_parseDateLocal(tCol(row,sbCol,'ORDER_DATE')); if (!od||od<cutoff120) return;
      if (!dsiLineMap[d]) dsiLineMap[d]=[];
      dsiLineMap[d].push(row);
    });
    Object.keys(dsiLineMap).forEach(function(d){
      var rows=dsiLineMap[d];
      // ── New Internet: internet lines only (Air excluded) ──
      var internetRows=rows.filter(function(r){return _isInternetPt(tCol(r,sbCol,'PRODUCT_TYPE'));});
      if (internetRows.length){
        niOrders++;
        var seenNi={};
        internetRows.forEach(function(r){
          var st=String(tCol(r,sbCol,'DTR_STATUS')||'').trim()||'Null';
          niStatusLines[st]=(niStatusLines[st]||0)+1;
          if (!seenNi[st]){seenNi[st]=true;niStatusCust[st]=(niStatusCust[st]||0)+1;}
        });
        var hasUpgrade=internetRows.some(function(r){return String(tCol(r,sbCol,'PRODUCT_TYPE')||'').toLowerCase().indexOf('upgrade')!==-1;});
        if (hasUpgrade) niExisting++; else niNew++;
        var voip=0;
        rows.forEach(function(r){ if (_isVoicePt(tCol(r,sbCol,'PRODUCT_TYPE'))) voip+=Number(tCol(r,sbCol,'VOICE_LINE_COUNT'))||0; });
        niVoipTotal+=voip;
        if (voip>0) niWithVoip++; else niNoVoip++;
      }
      // ── Other cells (unchanged): exclude any order with a fiber/internet line ──
      var excludeFromOther=rows.some(function(r){
        var pt=String(tCol(r,sbCol,'PRODUCT_TYPE')||'').trim().toLowerCase();
        return pt.indexOf('fiber')!==-1||pt.indexOf('internet')!==-1;
      });
      if (excludeFromOther) return;
      if (rows.every(function(r){return _isExcludedStatus(tCol(r,sbCol,'DTR_STATUS'));})) return;
      var seen={};
      rows.forEach(function(r){
        var st=String(tCol(r,sbCol,'DTR_STATUS')||'').trim()||'Null';
        sbLinesOther[st]=(sbLinesOther[st]||0)+1;
        if (!seen[st]){seen[st]=true;sbCustOther[st]=(sbCustOther[st]||0)+1;}
      });
    });
  }
  var HOUSING_DEF={
    completedOrders:['Active','Posted','Canceled','Disconnected'],
    orderIssues:    ['Porting Issue','Port Approved','Pending Order Port','BYOD','Pending Valid Payment'],
    allPendingLines:['Delivered','Shipped','Open','Null','Confirmed','Pending','Pending Shipment','Backordered']
  };
  function _sbCell(cm,lm,sts){
    var tc=0,tl=0,sub=[];
    (sts||Object.keys(cm)).forEach(function(st){
      var c=cm[st]||0,l=lm[st]||0; if(!c&&!l) return;
      tc+=c;tl+=l;sub.push({status:st,customers:c,lines:l});
    });
    return {customers:tc,lines:tl,sub:sub};
  }
  var sbCompleted=_sbCell(sbCustOther,sbLinesOther,HOUSING_DEF.completedOrders);
  var sbIssues   =_sbCell(sbCustOther,sbLinesOther,HOUSING_DEF.orderIssues);
  var sbPending  =_sbCell(sbCustOther,sbLinesOther,HOUSING_DEF.allPendingLines);
  var niSub=[],niTotL=0;
  Object.keys(niStatusCust).forEach(function(st){ niSub.push({status:st,customers:niStatusCust[st],lines:niStatusLines[st]}); niTotL+=niStatusLines[st]; });
  niSub.sort(function(a,b){ return (b.lines-a.lines)||String(a.status).localeCompare(String(b.status)); });
  var newInternet={ customers:niOrders, lines:niTotL, sub:niSub,
    newOrders:niNew, existingOrders:niExisting,
    voip:{ total:niVoipTotal, ordersWith:niWithVoip, ordersWithout:niNoVoip } };
  var sbGrandC=sbCompleted.customers+sbIssues.customers+sbPending.customers+newInternet.customers;
  var sbGrandL=sbCompleted.lines+sbIssues.lines+sbPending.lines+newInternet.lines;
  var statusBreakdown={completedOrders:sbCompleted,orderIssues:sbIssues,allPendingLines:sbPending,newInternet:newInternet,total:{customers:sbGrandC,lines:sbGrandL}};

  // ── ACTIVATION SUMMARY ──
  var AR_BUCKETS=['0-7 Days','8-14 Days','15-30 Days','31-60 Days'];
  var arData=_getSheetData(ss,ACTIVATION_RATES_TAB);
  var bktVol={},bktActs={},repArMap={};
  if (arData&&arData.length>=2) {
    var arCol=buildTableauColumnMap(arData[0]);
    _filterByOffice(arData.slice(1),arCol,officeId).forEach(function(row){
      var rep=String(tCol(row,arCol,'REP')||'').trim(); if (!rep) return;
      if (rep.toLowerCase()==='grand total') return;
      var bkt=String(tCol(row,arCol,'ACTIVATION_BUCKET')||'').trim(); if (!bkt) return;
      var vol=Number(tCol(row,arCol,'SALES_VOL'))||0,acts=Number(tCol(row,arCol,'SALES_ACTS'))||0;
      if (vol<=0) return;
      bktVol[bkt]=(bktVol[bkt]||0)+vol; bktActs[bkt]=(bktActs[bkt]||0)+acts;
      if (!repArMap[rep]) repArMap[rep]={};
      repArMap[rep][bkt]={vol:vol,acts:acts};
    });
  }
  var activationBuckets=AR_BUCKETS.map(function(b){var v=bktVol[b]||0,a=bktActs[b]||0;return {bucket:b,vol:v,acts:a,rate:v>0?Math.round(a/v*1000)/10:0};});
  var officeArTotal={}; AR_BUCKETS.forEach(function(b){var v=bktVol[b]||0,a=bktActs[b]||0;officeArTotal[b]={vol:v,acts:a};});
  var repArList=Object.keys(repArMap).sort(function(a,b){
    var da=repArMap[a]['8-14 Days']||{vol:0,acts:0},db=repArMap[b]['8-14 Days']||{vol:0,acts:0};
    var ra=da.vol>0?da.acts/da.vol:1,rb=db.vol>0?db.acts/db.vol:1; return ra-rb;
  });
  var bottom5Ar=repArList.slice(0,5).map(function(rep){return {rep:rep,buckets:repArMap[rep]};});

  // ── CHURN SUMMARY ──
  var churnRows=readChurnReport(ss,officeId);
  var repChurnMap={},officeTotalChurn={};
  churnRows.forEach(function(r){
    if (!r.rep||!r.bucket) return;
    if (r.rep.toLowerCase()==='grand total') return;
    if (!repChurnMap[r.rep]) repChurnMap[r.rep]={};
    repChurnMap[r.rep][r.bucket]={acts:r.activated,disco:r.disconnects,color:r.color};
    if (!officeTotalChurn[r.bucket]) officeTotalChurn[r.bucket]={acts:0,disco:0};
    officeTotalChurn[r.bucket].acts+=r.activated;
    officeTotalChurn[r.bucket].disco+=r.disconnects;
  });
  // Sort by highest raw disconnect count in 0-30 Day bucket
  var repChurnList=Object.keys(repChurnMap).sort(function(a,b){
    var ba=repChurnMap[a]['0-30 Day']||{acts:0,disco:0},bb=repChurnMap[b]['0-30 Day']||{acts:0,disco:0};
    return bb.disco-ba.disco;
  });
  var top5Churn=repChurnList.slice(0,5).map(function(rep){return {rep:rep,buckets:repChurnMap[rep]};});
  var CHURN_BUCKETS=['0-30 Day','30 Day','60 Day','90 Day','120 Day'];
  var churnBuckets=CHURN_BUCKETS.map(function(b){var d=officeTotalChurn[b]||{acts:0,disco:0};return {bucket:b,activated:d.acts,disconnected:d.disco,rate:d.acts>0?Math.round(d.disco/d.acts*1000)/10:0};});

  // ── NO ANSWERS + ESCALATIONS WITH NOTES ──
  var noAnswersOut=noAnswerDsis.map(function(dsi){return {dsi:dsi,notes:notesByDsi[dsi]||[]};});
  var escalationsOut=escalationRatings.map(function(e){return {dsi:e.dsi,rating:e.rating,notes:notesByDsi[e.dsi]||[]};});

  var report={
    date:todayStr, generatedAt:new Date().toISOString(),
    callCategories:callCategories,
    statusBreakdown:statusBreakdown,
    activationSummary:{buckets:activationBuckets,officeTotal:officeArTotal,repImpact:bottom5Ar},
    churnSummary:{buckets:churnBuckets,officeTotal:officeTotalChurn,repImpact:top5Churn},
    callsWorked:callsWorked,
    noAnswers:noAnswersOut,
    escalations:escalationsOut,
    activatedToday:activatedToday,
    ordersSubmitted:ordersSubmitted,
    appointments:_drAppointments(ss,officeId,todayStr)
  };

  // SAVE — upsert by date, append if new
  var drSheet=_getDailyReportSheet(ss,officeId);
  var drData=drSheet.getDataRange().getValues();
  var nowStr=new Date().toISOString();
  var rJson=JSON.stringify(report);
  for (var upi=1;upi<drData.length;upi++) {
    if (_drNormDate(drData[upi][0])===todayStr) {
      drSheet.getRange(upi+1,1,1,3).setValues([[todayStr,nowStr,rJson]]);
      return {ok:true,date:todayStr,action:'updated'};
    }
  }
  drSheet.appendRow([todayStr,nowStr,rJson]);

  // Auto-purge rows older than 365 days
  var cutoff365=new Date(refDate.getTime()-365*86400000).toISOString().split('T')[0];
  var fresh=drSheet.getDataRange().getValues(); var toDel=[];
  for (var fi=1;fi<fresh.length;fi++){if (_drNormDate(fresh[fi][0])<cutoff365) toDel.push(fi+1);}
  for (var di=toDel.length-1;di>=0;di--) drSheet.deleteRow(toDel[di]);

  return {ok:true,date:todayStr,action:'created'};
}

function readDailyReport(ss, officeId, date) {
  var sheet=ss.getSheetByName('_DailyReports_'+officeId); if (!sheet) return null;
  var data=sheet.getDataRange().getValues();
  for (var i=1;i<data.length;i++) {
    if (_drNormDate(data[i][0])===date) { try { return JSON.parse(String(data[i][2])); } catch(e) { return null; } }
  }
  return null;
}

function getDailyReportDates(ss, officeId) {
  var sheet=ss.getSheetByName('_DailyReports_'+officeId); if (!sheet) return [];
  var data=sheet.getDataRange().getValues();
  var seen={},dates=[];
  for (var i=1;i<data.length;i++){var d=_drNormDate(data[i][0]); if (!d||seen[d]) continue; seen[d]=true; dates.push(d);}
  dates.sort(function(a,b){return b.localeCompare(a);});
  return dates;
}

function runNightlyDailyReports() {
  var dow = new Date().getDay();
  if (dow===0||dow===6) return; // skip Saturday (6) and Sunday (0)
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID')||'';
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(OFFICE_OWNER_MAP).forEach(function(officeId) {
    try { generateDailyReport(ss, officeId); } catch(e) { Logger.log('Daily report error '+officeId+': '+e.message); }
  });
}

function setupDailyReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction()==='runNightlyDailyReports') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runNightlyDailyReports').timeBased().atHour(1).nearMinute(30).everyDays(1).create();
  return {ok:true};
}

// ── AUTOMATED DAILY REPORT EMAIL (6pm Pacific, Mon–Fri) ─────────────────────
// Per-office recipient lists for the scheduled report email.
var DAILY_REPORT_RECIPIENTS = {
  elevate:  ['jackieleroyatt@gmail.com','ryan.turner.50@gmail.com','angelmilan1206@gmail.com'],
  midspire: ['jamisgaray18@gmail.com','brandonpurkett@gmail.com','angelmilan1206@gmail.com','midspireqc@gmail.com','ryan.turner.50@gmail.com'],
  ignite:   ['jacobdennett0902@gmail.com','ryan.turner.50@gmail.com','angelmilan1206@gmail.com','jackieleroyatt@gmail.com'],
  viridian: ['s.e.cameron21@gmail.com','jamisgaray18@gmail.com','ryan.turner.50@gmail.com','angelmilan1206@gmail.com']
};
var DAILY_REPORT_OFFICE_NAME = { midspire:'Midspire', viridian:'Viridian', elevate:'Elevate', ignite:'Ignite' };
var DAILY_REPORT_TZ = 'America/Los_Angeles';
// Where the daily admin heartbeat/status email goes. Silence on a weekday by
// ~6:05pm PT = the 6pm trigger did not fire. Set '' to disable the heartbeat.
var DAILY_REPORT_HEARTBEAT_TO = 'gavonfuller2024@gmail.com';

// Per-office Daily Report branding (colors sampled from each office's real logo;
// see memory reference-office-branding). band = logo-strip background, header =
// title-bar bg, accent = section borders / glance bar, accentText = readable
// section-header text, logo = file under dashboard/assets, logoH = render height.
var DAILY_REPORT_ASSET_BASE = 'https://activationsupport.github.io/dashboard/assets/';
var OFFICE_BRAND = {
  elevate:  { band:'#111827', header:'#111827', headerText:'#ffffff', headerSub:'#aab8d6', accent:'#0A1FFF', accentText:'#0A1FFF', logo:'elevate-logo-full-standard-blue.png', logoH:40 },
  midspire: { band:'#0c1d2e', header:'#0c1d2e', headerText:'#ffffff', headerSub:'#a8c8e4', accent:'#4FB0FF', accentText:'#4FB0FF', logo:'midspire-logo-full.png',           logoH:38 },
  viridian: { band:'#1B3A2D', header:'#1B3A2D', headerText:'#EAF1EA', headerSub:'#cfd9cf', accent:'#D9C87E', accentText:'#D9C87E', logo:'viridian-logo-full.png',           logoH:54 },
  ignite:   { band:'#211210', header:'#211210', headerText:'#ffffff', headerSub:'#e3aaaa', accent:'#F0431E', accentText:'#F0431E', logo:'ignite-logo-full-reverse.png',     logoH:40 },
  vanguard: { band:'#1C1C1C', header:'#1C1C1C', headerText:'#ffffff', headerSub:'#c9b3b1', accent:'#D81F1F', accentText:'#D81F1F', logo:'vanguard-logo-full-reverse.png',   logoH:40 }
};
function _drBrand(officeId) {
  return OFFICE_BRAND[String(officeId||'').toLowerCase()] ||
    { band:'#0f2740', header:'#0f2740', headerText:'#ffffff', headerSub:'#9fb4c7', accent:'#0f2740', accentText:'#0f2740', logo:'', logoH:40 };
}
// Upgrade the report's external logo <img> to an inline (cid) image so it always
// shows in Gmail without "display images". Fetches the asset from the public site;
// on any failure (e.g. asset not yet live) it silently leaves the external URL.
// Mutates the GmailApp options object in place.
function _drInlineLogo(opts, officeId) {
  var BR = _drBrand(officeId);
  if (!BR.logo || !opts || !opts.htmlBody) return;
  var url = DAILY_REPORT_ASSET_BASE + BR.logo;
  if (opts.htmlBody.indexOf(url) === -1) return;
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions:true, followRedirects:true });
    if (resp.getResponseCode() === 200) {
      opts.inlineImages = opts.inlineImages || {};
      opts.inlineImages.drlogo = resp.getBlob().setName('drlogo');
      opts.htmlBody = opts.htmlBody.split(url).join('cid:drlogo');
    }
  } catch(e) { /* external URL stays as the fallback */ }
}

// Trigger handler: generates today's report fresh per office and emails the
// branded HTML (same layout as the in-portal "Copy for Email"). Skips weekends.
// Sends from whichever Google account owns/authorizes this script — set that to
// gavonfuller2024@gmail.com (no alias needed) so the From is correct.
function runDailyReportEmails() {
  // Self-heal: re-assert the 6pm trigger so a deletion in the editor can't
  // silently kill future sends. (Any run that happens re-creates it if gone.)
  try { _ensureDailyReportEmailTrigger(); } catch(e) { Logger.log('ensure trigger: '+e.message); }

  var dow = Number(Utilities.formatDate(new Date(), DAILY_REPORT_TZ, 'u')); // 1=Mon … 7=Sun
  if (dow > 5) return; // Mon–Fri only
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID')||'';
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActiveSpreadsheet();
  var todayStr = Utilities.formatDate(new Date(), DAILY_REPORT_TZ, 'yyyy-MM-dd');
  var sent = [], failed = [];
  Object.keys(DAILY_REPORT_RECIPIENTS).forEach(function(officeId) {
    var officeName = DAILY_REPORT_OFFICE_NAME[officeId] || officeId;
    var to = (DAILY_REPORT_RECIPIENTS[officeId]||[]).filter(function(x){return x;});
    if (!to.length) return; // no recipients configured → intentionally skipped
    try {
      generateDailyReport(ss, officeId, todayStr);           // fresh today
      var rpt = readDailyReport(ss, officeId, todayStr);
      if (!rpt) throw new Error('no report generated');
      var html = _buildDailyReportEmailHtml(rpt, officeName, todayStr, officeId);
      var subject = officeName + ' — Daily Report — ' + Utilities.formatDate(new Date(todayStr+'T12:00:00'), DAILY_REPORT_TZ, 'EEE, MMM d');
      var opts = { htmlBody: html, name: 'Activation Support' };
      _drInlineLogo(opts, officeId);
      GmailApp.sendEmail(to.join(','), subject, 'This report is best viewed in an HTML-capable email client.', opts);
      sent.push(officeName);
    } catch(e) {
      Logger.log('runDailyReportEmails '+officeId+': '+e.message);
      failed.push(officeName + ' — ' + e.message);
    }
  });

  // Record the last actual run + email an admin heartbeat. On a weekday, NO
  // heartbeat by ~6:05pm PT means the trigger never fired → go re-run setup.
  try { PropertiesService.getScriptProperties().setProperty('lastDailyEmailRun', new Date().toISOString()); } catch(e) {}
  _sendDailyEmailHeartbeat(sent, failed, todayStr);
}

// Idempotent: creates the 6pm Pacific trigger only if it isn't already present.
function _ensureDailyReportEmailTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction()==='runDailyReportEmails'; });
  if (!has) {
    ScriptApp.newTrigger('runDailyReportEmails').timeBased().atHour(18).nearMinute(0).everyDays(1).inTimezone(DAILY_REPORT_TZ).create();
  }
}

// Admin status email after each run so silent failures become visible.
function _sendDailyEmailHeartbeat(sent, failed, todayStr) {
  if (!DAILY_REPORT_HEARTBEAT_TO) return;
  try {
    var dateLabel = Utilities.formatDate(new Date(todayStr+'T12:00:00'), DAILY_REPORT_TZ, 'EEE, MMM d');
    var ok = !failed.length;
    var subject = (ok ? '✅' : '⚠️') + ' Daily Report email ' + (ok ? 'sent' : 'PARTIAL/FAILED') + ' — ' + dateLabel;
    var lines = [];
    lines.push('Daily Report automated email run — ' + dateLabel);
    lines.push('');
    lines.push('Sent OK (' + sent.length + '): ' + (sent.length ? sent.join(', ') : 'none'));
    lines.push('Failed (' + failed.length + '):' + (failed.length ? '' : ' none'));
    failed.forEach(function(f){ lines.push('  - ' + f); });
    lines.push('');
    lines.push('If you do NOT receive this email on a weekday by ~6:05pm Pacific, the 6pm trigger did not fire — re-run setupDailyReportEmailTrigger() in the Apps Script editor.');
    GmailApp.sendEmail(DAILY_REPORT_HEARTBEAT_TO, subject, lines.join('\n'), { name: 'Activation Support' });
  } catch(e) { Logger.log('heartbeat: '+e.message); }
}

function setupDailyReportEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction()==='runDailyReportEmails') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runDailyReportEmails').timeBased().atHour(18).nearMinute(0).everyDays(1).inTimezone(DAILY_REPORT_TZ).create();
  return {ok:true};
}

// Manual preview — emails ONLY gavonfuller2024@gmail.com today's report for one
// office, so the layout can be checked before turning on the scheduled send.
// Run from the editor, e.g. sendDailyReportEmailTest('elevate').
function sendDailyReportEmailTest(officeId) {
  officeId = officeId || 'elevate';
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID')||'';
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActiveSpreadsheet();
  var todayStr = Utilities.formatDate(new Date(), DAILY_REPORT_TZ, 'yyyy-MM-dd');
  generateDailyReport(ss, officeId, todayStr);
  var rpt = readDailyReport(ss, officeId, todayStr);
  if (!rpt) return { error:'no report for '+officeId };
  var officeName = DAILY_REPORT_OFFICE_NAME[officeId] || officeId;
  var html = _buildDailyReportEmailHtml(rpt, officeName, todayStr, officeId);
  var opts = { htmlBody: html, name: 'Activation Support' };
  _drInlineLogo(opts, officeId);
  GmailApp.sendEmail('gavonfuller2024@gmail.com', '[TEST] '+officeName+' — Daily Report — '+Utilities.formatDate(new Date(todayStr+'T12:00:00'), DAILY_REPORT_TZ, 'EEE, MMM d'), 'This report is best viewed in an HTML-capable email client.', opts);
  return { ok:true, office:officeId, sentTo:'gavonfuller2024@gmail.com' };
}

// No-email preview — renders today's report for one office to an HTML file in
// Drive and returns its link. Sends NO email to anyone. Run from the editor,
// e.g. previewDailyReportToDrive('elevate'), then open the returned url.
function previewDailyReportToDrive(officeId) {
  officeId = officeId || 'elevate';
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID')||'';
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActiveSpreadsheet();
  var todayStr = Utilities.formatDate(new Date(), DAILY_REPORT_TZ, 'yyyy-MM-dd');
  generateDailyReport(ss, officeId, todayStr);
  var rpt = readDailyReport(ss, officeId, todayStr);
  if (!rpt) return { error:'no report for '+officeId };
  var officeName = DAILY_REPORT_OFFICE_NAME[officeId] || officeId;
  var html = _buildDailyReportEmailHtml(rpt, officeName, todayStr, officeId);
  var file = DriveApp.createFile('DailyReportPreview-'+officeId+'-'+todayStr+'.html', html, MimeType.HTML);
  var url = file.getUrl();
  Logger.log('Preview ('+officeId+'): '+url);
  return { ok:true, office:officeId, url:url };
}

// Server-side port of the front-end "Copy for Email" report (_drBuildEmailHtml).
// rpt = the saved report object; officeName = display name; dateStr = yyyy-MM-dd.
function _buildDailyReportEmailHtml(rpt, officeName, dateStr, officeId) {
  if (!rpt) return '';
  var BR = _drBrand(officeId);
  var logoUrl = BR.logo ? (DAILY_REPORT_ASSET_BASE + BR.logo) : '';
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var DN=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(iso){ if(!iso) return '—'; var dd=new Date(String(iso)+'T12:00:00'); if(isNaN(dd.getTime())) return String(iso); return MN[dd.getMonth()]+' '+dd.getDate()+', '+dd.getFullYear(); }
  function fmtTs(iso){ if(!iso) return ''; var dd=new Date(iso); if(isNaN(dd.getTime())) return String(iso); return Utilities.formatDate(dd, DAILY_REPORT_TZ, "MMM d, yyyy 'at' h:mm a"); }
  function apptTime(t){ if(!t) return ''; var p=String(t).split(':'); var h=+p[0],m=p[1]; return ((h%12)||12)+':'+m+' '+(h>=12?'PM':'AM'); }
  var d=new Date(String(dateStr)+'T12:00:00');
  var dayLabel=DN[d.getDay()]+', '+MN[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();
  var AR_BUCKETS=['0-7 Days','8-14 Days','15-30 Days','31-60 Days'];
  var ST_CLS={'Active':'sp-active','Posted':'sp-posted','Approved':'sp-posted','Confirmed':'sp-pale-yellow','Canceled':'sp-canceled','Disconnected':'sp-disconnected','Porting Issue':'sp-orange-bright','Pending Valid Payment':'sp-orange-bright','BYOD':'sp-orange','Port Approved':'sp-dark-orange','Pending Order Port':'sp-dark-orange','Delivered':'sp-purple','Shipped':'sp-yellow-bright','Scheduled':'sp-yellow','Pending':'sp-pale-yellow','Pending Shipment':'sp-pale-yellow','Null':'sp-pale-yellow','Open':'sp-pale-yellow','Backordered':'sp-pale-yellow','TOTAL':''};

  var TBL='border-collapse:collapse;width:100%;font-size:12px;margin:0';
  var TH='padding:7px 10px;background:#f8fafc;color:#475569;font-weight:700;text-align:left;white-space:nowrap;font-size:10px;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e2e8f0';
  var TD='padding:8px 10px;color:#1e293b;vertical-align:top;border-bottom:1px solid #e2e8f0';
  var TDG='padding:8px 10px;background:#eef4fb;font-weight:700;color:#0f172a;vertical-align:top;border-bottom:1px solid #e2e8f0';
  var SEC='background:#f2f5f8;color:'+BR.accentText+';font-size:13px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:9px 13px;border-left:4px solid '+BR.accent+';border-radius:0 5px 5px 0;margin:0';
  var SUB='font-size:12px;font-weight:700;color:#1e293b;padding:6px 10px;background:#eef2f7;border-left:3px solid #94a3b8;border-radius:4px;margin:14px 0 7px';
  var ZEB='background:#f4f7fa';
  var BADGE='padding:2px 8px;border-radius:10px;font-weight:700;font-size:11px;white-space:nowrap;display:inline-block';
  var GRN=BADGE+';background:#dcfce7;color:#166534';
  var YEL=BADGE+';background:#fef9c3;color:#854d0e';
  var RED=BADGE+';background:#fee2e2;color:#991b1b';
  var PILL_MAP={'sp-active':'background:#dcfce7;color:#166534','sp-posted':'background:#dcfce7;color:#15803d','sp-canceled':'background:#fee2e2;color:#991b1b','sp-disconnected':'background:#ffe4e6;color:#9f1239','sp-orange-bright':'background:#ffedd5;color:#9a3412','sp-orange':'background:#ffedd5;color:#c2410c','sp-dark-orange':'background:#fed7aa;color:#9a3412','sp-purple':'background:#f3e8ff;color:#6b21a8','sp-yellow-bright':'background:#fef9c3;color:#854d0e','sp-yellow':'background:#fef9c3;color:#a16207','sp-pale-yellow':'background:#fefce8;color:#a16207','':'background:#f1f5f9;color:#475569'};
  function ePill(text,cls){return '<span style="display:inline-block;padding:1px 7px;border-radius:3px;font-size:11px;font-weight:600;'+(PILL_MAP[cls]||PILL_MAP[''])+'">'+esc(text)+'</span>';}
  function eHdr(t){return '<div style="'+SEC+'">'+t+'</div>';}
  function eTbl(thead,tbody){return '<table style="'+TBL+'"><thead>'+thead+'</thead><tbody>'+tbody+'</tbody></table>';}
  function eArCls(vol,acts,bkt){ if(!vol) return BADGE+';background:#e2e8f0;color:#334155'; var p=acts/vol*100; if(bkt==='0-7 Days') return p>=21?GRN:p>=10?YEL:RED; if(bkt==='8-14 Days') return p>=71?GRN:p>=51?YEL:RED; if(bkt==='15-30 Days') return p>=75?GRN:p>=70?YEL:RED; if(bkt==='31-60 Days') return p>=86?GRN:p>=79?YEL:RED; return BADGE+';background:#e2e8f0;color:#334155'; }
  function eArCell(bd,bkt){ if(!bd||!bd.vol) return '<td style="'+TD+'"></td>'; var p=Math.round(bd.acts/bd.vol*100); return '<td style="'+TD+'"><span style="'+eArCls(bd.vol,bd.acts,bkt)+'">'+p+'% ('+bd.acts+'/'+bd.vol+')</span></td>'; }
  function eCrTotCls(bkt,pct){ var t={'0-30 Day':[2.4,3.0],'30 Day':[4.9,6.9],'60 Day':[8.9,9.9],'90 Day':[10.9,13.9],'120 Day':[13.9,17.9]}; var th=t[bkt]; if(!th) return BADGE+';background:#e2e8f0;color:#334155'; return pct<=th[0]?GRN:pct<=th[1]?YEL:RED; }
  function eCrRepCls(color){ var c=String(color||'').toLowerCase(); if(c.indexOf('green')!==-1) return GRN; if(c.indexOf('red')!==-1||c.indexOf('orange')!==-1) return RED; if(c.indexOf('yellow')!==-1||c.indexOf('blue')!==-1) return YEL; return BADGE+';background:#e2e8f0;color:#334155'; }
  function eCrCell(bd,bkt,isT){ if(!bd||!bd.acts) return '<td style="'+TD+'"></td>'; var disco=bd.disco||0,pct=disco/bd.acts*100; return '<td style="'+TD+'"><span style="'+(isT?eCrTotCls(bkt,pct):eCrRepCls(bd.color||''))+'">'+pct.toFixed(1)+'% ('+disco+'/'+bd.acts+')</span></td>'; }

  var cats=rpt.callCategories||{};
  var eAp=rpt.appointments||{};
  var eBk=eAp.booked||{total:(eAp.bookedToday||0)};
  var eSc=eAp.statusChanges||{completed:0};
  var eAct=rpt.activatedToday||{lines:0,orders:0};
  var daT=cats.dayAfterTotal||0,daW=cats.dayAfterWorked||0;
  var covPct=daT>0?Math.round(daW/daT*100):null;
  var covColor=covPct===null?'#64748b':covPct>=80?'#16a34a':covPct>=50?'#ca8a04':'#dc2626';
  function eTile(value,label,accent,sub){ return '<div style="display:inline-block;vertical-align:top;background:#f8fafc;border:1px solid #e2e8f0;border-top:3px solid '+accent+';border-radius:8px;padding:9px 13px;margin:0 6px 6px 0;min-width:92px">'+'<div style="font-size:20px;font-weight:800;color:#0f172a;line-height:1">'+value+'</div>'+'<div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;font-weight:700;margin-top:3px">'+label+'</div>'+(sub?'<div style="font-size:10px;color:#94a3b8;margin-top:1px">'+sub+'</div>':'')+'</div>'; }
  var eActOrders=eAct.orders||0;
  var statBar=eTile(eAct.lines||0,'Activated Today','#16a34a',eActOrders+' order'+(eActOrders===1?'':'s'))+
    eTile(rpt.ordersSubmitted||0,'Orders Submitted','#4A9FD4','Post Sale form')+
    eTile(covPct===null?'—':covPct+'%','Day-After Coverage',covColor,daW+'/'+daT+' worked')+
    eTile(cats.deliveredWorked||0,'Delivered','#2563eb')+
    eTile(cats.issuesWorked||0,'Issues','#7c3aed')+
    eTile(cats.noAnswerTotal||0,'No Answers','#dc2626')+
    eTile(cats.escalationTotal||0,'Escalations','#b91c1c')+
    eTile(eBk.total||0,'Appts Booked','#0891b2')+
    eTile(eSc.completed||0,'Appts Completed','#3b82f6');

  var EC={'sp-active':'background:#f0fdf4;border:1px solid #86efac','sp-posted':'background:#f0fdf4;border:1px solid #4ade80','sp-canceled':'background:#fef2f2;border:1px solid #fca5a5','sp-disconnected':'background:#fff1f2;border:1px solid #fda4af','sp-orange-bright':'background:#fff7ed;border:1px solid #fdba74','sp-orange':'background:#fff7ed;border:1px solid #fb923c','sp-dark-orange':'background:#fff7ed;border:1px solid #f97316','sp-purple':'background:#faf5ff;border:1px solid #d8b4fe','sp-yellow-bright':'background:#fefce8;border:1px solid #fde047','sp-yellow':'background:#fefce8;border:1px solid #fde68a','sp-pale-yellow':'background:#fefce8;border:1px solid #fef08a','':'background:#f8fafc;border:1px solid #e2e8f0'};
  var HOUSING_HDR={'green':'background:#f0fdf4;border:1px solid #86efac;color:#166534','orange':'background:#fff7ed;border:1px solid #fdba74;color:#9a3412','purple':'background:#faf5ff;border:1px solid #d8b4fe;color:#581c87','yellow':'background:#fefce8;border:1px solid #fde68a;color:#713f12'};
  function eSubCards(sub){ return (sub||[]).map(function(s){ var cls=ST_CLS[s.status]||''; return '<div style="display:inline-block;'+(EC[cls]||EC[''])+';border-radius:6px;padding:7px 9px;text-align:center;vertical-align:top;margin:3px;min-width:90px">'+'<div style="padding:1px 7px;border-radius:3px;font-size:11px;font-weight:700;'+(PILL_MAP[cls]||PILL_MAP[''])+'">'+esc(s.status)+'</div>'+'<table style="width:100%;border-collapse:collapse;margin-top:4px"><tr>'+'<td style="text-align:center;padding:2px 3px;border:none"><div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1">'+s.customers+'</div><div style="font-size:9px;color:#64748b;text-transform:uppercase">Customers</div></td>'+'<td style="width:1px;background:#e2e8f0;padding:0;border:none"></td>'+'<td style="text-align:center;padding:2px 3px;border:none"><div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1">'+s.lines+'</div><div style="font-size:9px;color:#64748b;text-transform:uppercase">Lines</div></td>'+'</tr></table></div>'; }).join(''); }
  function eHousingCell(label,colorKey,data){ if(!data||(!data.customers&&!data.lines)) return ''; var hdrStyle=HOUSING_HDR[colorKey]||HOUSING_HDR['green']; return '<details style="margin-bottom:8px;border-radius:8px;overflow:hidden">'+'<summary style="'+hdrStyle+';padding:9px 13px;font-size:13px;font-weight:700;cursor:pointer;list-style:none;display:block">'+esc(label)+' &nbsp;<span style="font-size:11px;font-weight:400">'+data.customers+' customers &nbsp;&middot;&nbsp; '+data.lines+' lines</span>'+'&nbsp;&nbsp;<span style="font-size:11px;opacity:.7">&#9662;</span>'+'</summary>'+'<div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:6px">'+eSubCards(data.sub)+'</div>'+'</details>'; }
  function eNiCell(data){ if(!data||(!data.customers&&!data.lines)) return ''; var hdrStyle=HOUSING_HDR['yellow'], v=data.voip||{}; function row(k,val){ return '<tr><td style="padding:3px 12px;font-size:12px;color:#475569;border:none">'+k+'</td><td style="padding:3px 12px;font-size:12px;font-weight:700;color:#0f172a;text-align:right;border:none">'+(val||0)+'</td></tr>'; } var summary='<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px">'+row('New',data.newOrders)+row('Existing (upgrade)',data.existingOrders)+row('VoIPs attached (total)',v.total)+row('Orders with VoIP',v.ordersWith)+row('Orders without VoIP',v.ordersWithout)+'</table>'; return '<details style="margin-bottom:8px;border-radius:8px;overflow:hidden">'+'<summary style="'+hdrStyle+';padding:9px 13px;font-size:13px;font-weight:700;cursor:pointer;list-style:none;display:block">'+'New Internet'+' &nbsp;<span style="font-size:11px;font-weight:400">'+data.customers+' orders &nbsp;&middot;&nbsp; '+data.lines+' lines</span>'+'&nbsp;&nbsp;<span style="font-size:11px;opacity:.7">&#9662;</span>'+'</summary>'+'<div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:6px">'+summary+eSubCards(data.sub)+'</div>'+'</details>'; }
  var sbRaw=rpt.statusBreakdown||{};
  var sbTotal=Array.isArray(sbRaw) ? (function(){ for(var i=0;i<sbRaw.length;i++){ if(sbRaw[i].status==='TOTAL') return sbRaw[i]; } return {customerRows:0,totalLines:0}; })() : (sbRaw.total||{customers:0,lines:0});
  var sbTotCust=sbTotal.customers||sbTotal.customerRows||0;
  var sbTotLines=sbTotal.lines||sbTotal.totalLines||0;
  var sbContent='';
  if (Array.isArray(sbRaw)) {
    sbContent=sbRaw.filter(function(r){return r.status!=='TOTAL';}).map(function(r){ var cls=ST_CLS[r.status]||''; return '<div style="display:inline-block;'+(EC[cls]||EC[''])+';border-radius:6px;padding:7px 9px;text-align:center;vertical-align:top;margin:3px;min-width:90px">'+'<div style="padding:1px 7px;border-radius:3px;font-size:11px;font-weight:700;'+(PILL_MAP[cls]||PILL_MAP[''])+'">'+esc(r.status)+'</div>'+'<table style="width:100%;border-collapse:collapse;margin-top:4px"><tr>'+'<td style="text-align:center;padding:2px 3px;border:none"><div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1">'+r.customerRows+'</div><div style="font-size:9px;color:#64748b;text-transform:uppercase">Customers</div></td>'+'<td style="width:1px;background:#e2e8f0;padding:0;border:none"></td>'+'<td style="text-align:center;padding:2px 3px;border:none"><div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1">'+r.totalLines+'</div><div style="font-size:9px;color:#64748b;text-transform:uppercase">Lines</div></td>'+'</tr></table></div>'; }).join('');
  } else {
    sbContent=eHousingCell('Completed Orders','green', sbRaw.completedOrders)+eHousingCell('Order Issues','orange',sbRaw.orderIssues)+eHousingCell('All Pending Lines','purple',sbRaw.allPendingLines)+eNiCell(sbRaw.newInternet||sbRaw.fiber);
  }
  var sbTotalBar='<table style="width:100%;border-collapse:collapse;background:#f0f9ff;border:1px solid #bae6fd;border-radius:7px;margin-top:4px"><tr>'+'<td style="padding:9px 14px;border:none;font-size:12px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.06em">Total</td>'+'<td style="padding:9px 14px;border:none;text-align:right">'+'<span style="font-size:16px;font-weight:700;color:#0f172a">'+sbTotCust+'</span> <span style="font-size:11px;color:#64748b">customers</span>&nbsp;&nbsp;'+'<span style="font-size:16px;font-weight:700;color:#0f172a">'+sbTotLines+'</span> <span style="font-size:11px;color:#64748b">lines</span>'+'</td></tr></table>';
  var statusSec=eHdr('Order Status Breakdown')+'<div style="padding:6px 0">'+sbContent+'</div>'+sbTotalBar;

  var arSum=rpt.activationSummary||{},offAr=arSum.officeTotal||{},repAr=arSum.repImpact||[];
  var arHdr='<tr><th style="'+TH+'">Rep</th>'+AR_BUCKETS.map(function(b){return '<th style="'+TH+'">'+b+'</th>';}).join('')+'</tr>';
  var arTot='<tr><td style="'+TDG+'">Grand Total</td>'+AR_BUCKETS.map(function(b){return eArCell(offAr[b],b);}).join('')+'</tr>';
  var arReps=repAr.map(function(r,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(r.rep)+'</td>'+AR_BUCKETS.map(function(b){return eArCell(r.buckets[b],b);}).join('')+'</tr>';}).join('');
  var arSec=eHdr('Activation Rates — office summary + bottom 5 reps')+eTbl(arHdr,arTot+arReps);

  var crSum=rpt.churnSummary||{},offCr=crSum.officeTotal||{},repCr=crSum.repImpact||[];
  var CR_BKTS=['0-30 Day','30 Day','60 Day','90 Day','120 Day'];
  var crHdr='<tr><th style="'+TH+'">Rep</th>'+CR_BKTS.map(function(b){return '<th style="'+TH+'">'+b+'</th>';}).join('')+'</tr>';
  var crTot='<tr><td style="'+TDG+'">Grand Total</td>'+CR_BKTS.map(function(b){return eCrCell(offCr[b],b,true);}).join('')+'</tr>';
  var crReps=repCr.map(function(r,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(r.rep)+'</td>'+CR_BKTS.map(function(b){return eCrCell(r.buckets[b],b,false);}).join('')+'</tr>';}).join('');
  var crSec=eHdr('Churn Rates — office summary + top 5 reps by 0-30 Day disconnects')+eTbl(crHdr,crTot+crReps);

  var cwDupEsc={},cwDupNa={};
  (rpt.escalations||[]).forEach(function(e){ if(e.dsi) cwDupEsc[e.dsi]=true; });
  (rpt.noAnswers||[]).forEach(function(e){ if(e.dsi) cwDupNa[e.dsi]=true; });
  function eOrderLine(e){ var parts=[]; var dt=fmtDate(e.orderDate); if(dt&&dt!=='—') parts.push(dt); var prods=Object.keys(e.productCounts||{}).map(function(p){return p+' x'+e.productCounts[p];}); if(prods.length) parts.push(prods.join(', ')); var stats=Object.keys(e.statusCounts||{}).map(function(s){return s+' x'+e.statusCounts[s];}); if(stats.length) parts.push(stats.join(', ')); return parts.join(' · '); }
  function eCwGroup(entries,label){ if(!entries||!entries.length) return ''; var rows=entries.map(function(e,i){ var detail=eOrderLine(e); var notes; if(cwDupEsc[e.dsi]) notes='<span style="color:#94a3b8;font-size:11px">&#8593; Notes under Escalations</span>'; else if(cwDupNa[e.dsi]) notes='<span style="color:#94a3b8;font-size:11px">&#8593; Notes under No Answers</span>'; else notes=(e.notes||[]).length?e.notes.map(function(n){return '<div style="margin:1px 0;font-size:11px"><b>'+esc(n.authorName||'?')+'</b>: '+esc(n.noteText)+'</div>';}).join(''):'<span style="color:#94a3b8;font-size:11px">No notes</span>'; return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+';white-space:nowrap">'+esc(e.rep||'—')+'</td><td style="'+TD+'">'+esc(e.dsi)+(detail?'<div style="font-size:10px;color:#64748b;margin-top:2px">'+esc(detail)+'</div>':'')+'</td><td style="'+TD+'">'+notes+'</td></tr>'; }).join(''); return '<div style="margin-bottom:6px"><div style="'+SUB+'">'+esc(label)+' <span style="font-weight:400;color:#94a3b8;font-size:11px">('+entries.length+')</span></div>'+eTbl('<tr><th style="'+TH+'">Rep</th><th style="'+TH+'">Order</th><th style="'+TH+'">Notes</th></tr>',rows)+'</div>'; }
  var cw=rpt.callsWorked||{};
  var cwTotal=(cw.dayafter||[]).length+(cw.delivered||[]).length+(cw.issues||[]).length+(cw.other||[]).length;
  var cwSec=cwTotal?eHdr('Calls Worked That Day ('+cwTotal+' orders)')+eCwGroup(cw.dayafter,'Day-After')+eCwGroup(cw.issues,'Order Issues')+eCwGroup(cw.delivered,'Delivered Not Active')+eCwGroup(cw.other,'Other'):'';

  var naList=rpt.noAnswers||[];
  var naSec='';
  if (naList.length) {
    var naRows=naList.map(function(e,i){ var notes=(e.notes||[]).length?e.notes.map(function(n){return '<div style="font-size:11px"><b>'+esc(n.authorName||'?')+'</b>: '+esc(n.noteText)+'</div>';}).join(''):'<span style="color:#94a3b8;font-size:11px">No notes</span>'; return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+';white-space:nowrap">'+esc(e.dsi)+'</td><td style="'+TD+'">'+notes+'</td></tr>'; }).join('');
    naSec=eHdr('No Answers That Day ('+naList.length+')')+eTbl('<tr><th style="'+TH+'">DSI</th><th style="'+TH+'">Notes</th></tr>',naRows);
  }

  var escList=rpt.escalations||[];
  var escSec='';
  if (escList.length) {
    var escRows=escList.map(function(e,i){ var rbg=e.rating==='1 Star'?'#fee2e2':'#ffe4e6', rtx=e.rating==='1 Star'?'#991b1b':'#9f1239'; var notes=(e.notes||[]).length?e.notes.map(function(n){return '<div style="font-size:11px"><b>'+esc(n.authorName||'?')+'</b>: '+esc(n.noteText)+'</div>';}).join(''):'<span style="color:#94a3b8;font-size:11px">No notes</span>'; return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+';white-space:nowrap"><span style="background:'+rbg+';color:'+rtx+';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">'+esc(e.rating)+'</span></td><td style="'+TD+';white-space:nowrap">'+esc(e.dsi)+'</td><td style="'+TD+'">'+notes+'</td></tr>'; }).join('');
    escSec=eHdr('Escalations That Day ('+escList.length+')')+eTbl('<tr><th style="'+TH+'">Rating</th><th style="'+TH+'">DSI</th><th style="'+TH+'">Notes</th></tr>',escRows);
  }

  var glParts=[];
  var gL=eAct.lines||0, gO=eAct.orders||0;
  glParts.push('<b>'+gL+'</b> line'+(gL===1?'':'s')+' activated'+(gO?' across <b>'+gO+'</b> order'+(gO===1?'':'s'):''));
  if (daT) glParts.push('<b>'+daW+'/'+daT+'</b> day-after calls worked');
  if (eAp.scheduled&&eAp.scheduled.total) glParts.push('<b>'+(eSc.completed||0)+'</b> appt'+((eSc.completed||0)===1?'':'s')+' completed'+(eSc.noShow?', <b>'+eSc.noShow+'</b> no-show':''));
  var gAttn=(cats.noAnswerTotal||0)+(cats.escalationTotal||0);
  if (gAttn) glParts.push('<b>'+gAttn+'</b> item'+(gAttn===1?'':'s')+' need attention');
  var glanceSec='<div style="font-size:13px;line-height:1.5;color:#1e293b;background:#f6f8fb;border:1px solid #e2e8f0;border-left:3px solid '+BR.accent+';border-radius:0 7px 7px 0;padding:10px 14px">'+glParts.join(' &nbsp;&middot;&nbsp; ')+'</div>';

  var actSec='';
  if ((eAct.list||[]).length) {
    var actRows=eAct.list.map(function(x,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(x.dsi)+'</td><td style="'+TD+'"><b>'+(x.lines||0)+'</b></td><td style="'+TD+'">'+esc(x.activator||'—')+'</td><td style="'+TD+'">'+esc(x.note||'—')+'</td></tr>';}).join('');
    actSec=eHdr('⚡ Lines Activated Today — '+eAct.lines+' line'+(eAct.lines===1?'':'s')+' across '+eAct.orders+' order'+(eAct.orders===1?'':'s'))+eTbl('<tr><th style="'+TH+'">DSI</th><th style="'+TH+'">Lines</th><th style="'+TH+'">Activator</th><th style="'+TH+'">Note</th></tr>',actRows);
  }

  var ap=rpt.appointments||null, apSec='';
  if (ap) {
    var aps=ap.scheduled||{total:0,list:[],byActivator:[]};
    var apbk=ap.booked||{total:(ap.bookedToday||0),list:[]};
    var apsc=ap.statusChanges||{total:0,completed:0,noShow:0,rescheduled:0,canceled:0,list:[]};
    if (aps.total || apbk.total || apsc.total || ap.bookedToday || ap.tomorrow) {
      var EOUT={completed:['✓ Completed','#dcfce7','#166534'],'no-show':['✗ No-Show','#fee2e2','#991b1b'],rescheduled:['↻ Rescheduled','#ffedd5','#9a3412'],canceled:['⊘ Canceled','#fee2e2','#7f1d1d']};
      function eOutcome(o){var x=EOUT[o]||['—','#f1f5f9','#475569'];return '<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;background:'+x[1]+';color:'+x[2]+'">'+x[0]+'</span>';}
      function eBd(o,inclU){var p=[];if(o.completed)p.push(o.completed+' completed');if(o.noShow)p.push(o.noShow+' no-show');if(o.rescheduled)p.push(o.rescheduled+' rescheduled');if(o.canceled)p.push(o.canceled+' canceled');if(inclU&&o.unmarked)p.push(o.unmarked+' unmarked');return p.join(' · ');}
      function eGroupBar(label,bd){return '<div style="'+SUB+'">'+label+(bd?'<span style="font-weight:400;color:#64748b;font-size:11px"> &nbsp;'+bd+'</span>':'')+'</div>';}
      var apBooked='';
      if (apbk.total) {
        var bRows=(apbk.list||[]).map(function(x,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(apptTime(x.timeSlot))+'</td><td style="'+TD+'">'+esc(fmtDate(x.forDate))+'</td><td style="'+TD+'">'+esc(x.customer||'—')+'</td><td style="'+TD+'">'+esc(x.dsi||'—')+'</td><td style="'+TD+'">'+esc(x.activator||'—')+'</td></tr>';}).join('');
        apBooked=eGroupBar('📅 Booked That Day ('+apbk.total+')','')+((apbk.list||[]).length?eTbl('<tr><th style="'+TH+'">Time</th><th style="'+TH+'">Date</th><th style="'+TH+'">Customer</th><th style="'+TH+'">DSI</th><th style="'+TH+'">Activator</th></tr>',bRows):'');
      }
      var apSched='';
      if (aps.total) {
        var apList=(aps.list||[]).length ? eTbl('<tr><th style="'+TH+'">Time</th><th style="'+TH+'">Customer</th><th style="'+TH+'">DSI</th><th style="'+TH+'">Activator</th><th style="'+TH+'">Outcome</th></tr>', aps.list.map(function(x,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(apptTime(x.timeSlot))+'</td><td style="'+TD+'">'+esc(x.customer||'—')+'</td><td style="'+TD+'">'+esc(x.dsi||'—')+'</td><td style="'+TD+'">'+esc(x.activator)+'</td><td style="'+TD+'">'+(x.outcome?eOutcome(x.outcome):'<span style="color:#94a3b8">— not marked</span>')+'</td></tr>';}).join('')) : '';
        apSched=eGroupBar('🗓️ Scheduled For This Day ('+aps.total+')',eBd(aps,true))+apList;
      }
      var apChange='';
      if (apsc.total) {
        var cRows=(apsc.list||[]).map(function(x,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+eOutcome(x.outcome)+'</td><td style="'+TD+'">'+esc(x.customer||'—')+'</td><td style="'+TD+'">'+esc(x.dsi||'—')+'</td><td style="'+TD+'">'+esc(x.activator||'—')+'</td><td style="'+TD+'">'+esc(fmtDate(x.apptDate))+' · '+esc(apptTime(x.timeSlot))+'</td></tr>';}).join('');
        apChange=eGroupBar('🔄 Status Changed That Day ('+apsc.total+')',eBd(apsc,false))+((apsc.list||[]).length?eTbl('<tr><th style="'+TH+'">Outcome</th><th style="'+TH+'">Customer</th><th style="'+TH+'">DSI</th><th style="'+TH+'">Activator</th><th style="'+TH+'">Appt</th></tr>',cRows):'');
      }
      var apTitle='Appointments &amp; Bookings — '+(apbk.total||0)+' booked · '+(aps.total||0)+' scheduled · '+(apsc.total||0)+' changes'+(ap.tomorrow?' · '+ap.tomorrow+' tomorrow':'');
      apSec=eHdr(apTitle)+apBooked+apSched+apChange;
    }
  }

  var officeNm=officeName||'';
  var __html='<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#fff">'+
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;background:#fff;max-width:960px;margin:0 auto;border:1px solid #e2e8f0;border-radius:9px;overflow:hidden">'+
    (logoUrl
      ? '<div style="background:'+BR.band+';text-align:center;padding:16px 20px'+(BR.band==='#ffffff'?';border-bottom:1px solid #eef1f5':'')+'">'+
          '<img src="'+logoUrl+'" alt="'+esc(officeNm)+'" style="max-height:'+BR.logoH+'px;max-width:240px;vertical-align:middle">'+
        '</div>'
      : '')+
    '<div style="background:'+BR.header+';padding:13px 22px">'+
      '<div style="font-size:15px;font-weight:700;color:'+BR.headerText+'">📋 Daily Call Report'+((!logoUrl&&officeNm)?' &middot; '+esc(officeNm):'')+'</div>'+
      '<div style="font-size:12px;color:'+BR.headerSub+';margin-top:3px">'+esc(dayLabel)+' &nbsp;&middot;&nbsp; Generated '+fmtTs(rpt.generatedAt)+'</div>'+
    '</div>'+
    '<div style="padding:18px 22px">'+
    '<div style="margin-bottom:14px">'+glanceSec+'</div>'+
    '<div style="margin-bottom:16px">'+statBar+'</div>'+
    (escSec?'<div style="margin-top:18px">'+escSec+'</div>':'')+
    (naSec?'<div style="margin-top:18px">'+naSec+'</div>':'')+
    (cwSec?'<div style="margin-top:18px">'+cwSec+'</div>':'')+
    (actSec?'<div style="margin-top:18px">'+actSec+'</div>':'')+
    '<div style="margin-top:18px">'+statusSec+'</div>'+
    '<div style="margin-top:18px">'+arSec+'</div>'+
    '<div style="margin-top:18px">'+crSec+'</div>'+
    (apSec?'<div style="margin-top:18px">'+apSec+'</div>':'')+
    '</div></div></body></html>';
  // Force every non-ASCII char (emoji, em-dashes, ·) to a numeric HTML entity so it
  // renders regardless of source-file/MIME/client charset — literal emoji garbled in Gmail.
  return __html.replace(/[^ -]/gu, function(ch){ return '&#'+ch.codePointAt(0)+';'; });
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
  var data=_getSheetData(ss,TABLEAU_TAB);
  if (!data||data.length<2) return { dsiSummary:{}, repSummary:{} };
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
      dtrStatus:dtrStatus, discoReason:discoReason,
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
      discoReason:String(tCol(row,col,'DISCO_REASON')||'').trim(),
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
    var _gate=_authGate(ss, body); if (_gate) return jsonResponse(_gate);   // Stage C: server-side authorization
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
      case 'saveTrainingPaid':    result=writeTrainingPaid(body,ss,officeId); break;
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
      case 'generateDailyReport': result=generateDailyReport(ss,officeId,body.date||null); break;
      case 'postSale':            result=writePostSale(body,ss,officeId); break;
      case 'updatePostedSale':    result=updatePostedSale(body,ss,officeId); break;
      case 'voidPostedSale':      result=voidPostedSale(body,ss,officeId); break;
      case 'createOfficeTabs':    result=createOfficeTabs(body,ss); break;
      case 'migrateFromLegacy':   result=migrateFromLegacy(ss,officeId); break;
      case 'migrateFromExternal': result=migrateFromExternal(body,ss); break;
      case 'migrateOfficeIds':    result=migrateOfficeIds(ss); break;
      case 'validateSession':     result=_validateSession(ss, body.token); break;
      case 'logout':              result=_revokeSession(ss, body.token); break;
      default: result={ error:'unknown action: '+body.action };
    }
    // Phase 1 Stage A: on a successful login, also issue a session "badge".
    // Additive only — the client may ignore the token; nothing is enforced yet.
    if (result && result.ok && result.valid &&
        (body.action==='validatePin'||body.action==='setPin'||body.action==='validateAdminAccess')) {
      try {
        var _email = String(body.email||'').trim().toLowerCase();
        var _perms = result.permissions || (result.homeOffice ? _allOfficeIds() : officeId);
        var _sess = _issueSession(ss, _email, result.rank, _perms);
        result.token = _sess.token; result.tokenExpires = _sess.expiresAt;
      } catch(_e) { /* never block login if the session store hiccups */ }
    }
    return jsonResponse(result);
  } catch(err) { return jsonResponse({ error:err.message }); }
}

function writeAddRosterEntry(body, ss, officeId) {
  const sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  const email=String(body.email||'').trim().toLowerCase(); if (!email) return { error:'missing email' };
  if (findRowCI(sheet,0,email)>0) return { error:'email already exists' };
  sheet.appendRow([email,body.name||'',body.team||'',body.rank||'client-rep',false,new Date().toISOString().split('T')[0],'',body.phone||'','',body.permissions||officeId]);
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
// Master-admin is a GLOBAL role: anyone who is a (non-deactivated) master-admin
// in ANY office is treated as master-admin in every office, regardless of that
// office's roster (or absence from it). Returns {pinHash, permissions} from the
// first office where this email is a master-admin, or null.
function _findGlobalMasterAdmin(ss, email) {
  email=String(email||'').trim().toLowerCase(); if (!email) return null;
  var offices=Object.keys(OFFICE_OWNER_MAP);
  for (var i=0;i<offices.length;i++) {
    var sheet=ss.getSheetByName(officeTab(TAB.ROSTER,offices[i])); if (!sheet) continue;
    var rowIdx=findRowCI(sheet,0,email); if (rowIdx<0) continue;
    var row=sheet.getRange(rowIdx,1,1,10).getValues()[0];
    var deactivated=row[4]===true||String(row[4]).toUpperCase()==='TRUE'; if (deactivated) continue;
    if (String(row[3]||'').trim().toLowerCase()!=='master-admin') continue;
    return { pinHash:String(row[6]||'').trim(), permissions:String(row[9]||'').trim() };
  }
  return null;
}
function _allOfficeIds() { return Object.keys(OFFICE_OWNER_MAP).join(','); }

function writeCheckEmail(body, ss, officeId) {
  // Light speed-bump so the email-lookup step can't be used for bulk harvesting.
  if (!_rateLimitOk('checkEmail', 120, 60)) return { ok:false, error:'Too many requests. Please wait a moment and try again.' };
  var sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  var email=String(body.email||'').trim().toLowerCase();
  if (!email) return { error:'missing email' };
  var rowIdx=findRowCI(sheet,0,email);
  if (rowIdx<0) {
    // Not in this office's roster — but a global master-admin can sign in anywhere.
    var gma=_findGlobalMasterAdmin(ss,email);
    if (gma) return { ok:true, found:true, hasPin:!!gma.pinHash&&gma.pinHash!=='undefined' };
    return { ok:true, found:false };
  }
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
  if (_findGlobalMasterAdmin(ss,email)) return { ok:true, valid:true, rank:'master-admin', permissions:_allOfficeIds() };
  var permissions=String(rowData[9]||'').trim()||officeId;
  return { ok:true, valid:true, rank:String(rowData[3]||'client-rep').trim(), permissions:permissions };
}
function writeValidatePin(body, ss, officeId) {
  var sheet=getOrCreateSheet(ss,officeTab(TAB.ROSTER,officeId),TAB.ROSTER);
  var email=String(body.email||'').trim().toLowerCase(); var pin=String(body.pin||'').trim();
  if (!email) return { error:'missing email' }; if (!pin) return { error:'missing pin' };
  var _locked=_pinLockedSeconds(email);
  if (_locked>0) return { ok:true, valid:false, locked:true, error:'Too many incorrect attempts. Try again in '+Math.ceil(_locked/60)+' min.' };
  var rowIdx=findRowCI(sheet,0,email);
  if (rowIdx<0) {
    // Not in this office's roster — a global master-admin validates against their
    // master-admin row in another office and gets all-office access.
    var gma=_findGlobalMasterAdmin(ss,email);
    if (!gma) return { error:'Not authorized for this office' };
    if (!gma.pinHash||gma.pinHash==='undefined') return { error:'No PIN set for this account' };
    if (hashPin(email,pin)===gma.pinHash) { _clearPinFails(email); return { ok:true, valid:true, rank:'master-admin', permissions:_allOfficeIds() }; }
    _recordPinFail(email); return { ok:true, valid:false, error:'Incorrect PIN' };
  }
  var rowData=sheet.getRange(rowIdx,1,1,10).getValues()[0];
  var deactivated=rowData[4]===true||String(rowData[4]).toUpperCase()==='TRUE';
  if (deactivated) return { error:'Account deactivated. Contact your Admin.' };
  var storedHash=String(rowData[6]||'').trim();
  if (!storedHash||storedHash==='undefined') return { error:'No PIN set for this account' };
  if (hashPin(email,pin)===storedHash) {
    _clearPinFails(email);
    // Master-admin is global — elevate even if this office's row says otherwise.
    if (_findGlobalMasterAdmin(ss,email)) return { ok:true, valid:true, rank:'master-admin', permissions:_allOfficeIds() };
    var permissions=String(rowData[9]||'').trim()||officeId;
    return { ok:true, valid:true, rank:String(rowData[3]||'client-rep').trim(), permissions:permissions };
  }
  _recordPinFail(email); return { ok:true, valid:false, error:'Incorrect PIN' };
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
// Persist a Training & Tracking row's paid-out state to the Post Sale sheet's 'Paid Out' column.
function writeTrainingPaid(body, ss, officeId) {
  var sheet=ss.getSheetByName('_PostedSales_'+officeId); if (!sheet) return { error:'Post Sale sheet not found' };
  var rowIndex=Number(body.rowIndex); if (!rowIndex||rowIndex<2) return { error:'Invalid row' };
  var col=_ensurePostedPaidOutCol(sheet);
  sheet.getRange(rowIndex,col).setValue(JSON.stringify(body.paidOut||{})); return { ok:true };
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

// ── POST SALE ─────────────────────────────────────────────────────────────
// Separate from _Sales_<officeId> — these are rep self-reported sales for the
// Live Sales Tracker leaderboard. Never touches existing _Sales_ tabs.
function _getPostedSalesSheet(ss, officeId) {
  var _r = _getOrInsertSheet(ss, '_PostedSales_' + officeId);
  var sheet = _r.sheet;
  if (_r.created) {
    sheet.appendRow(['Timestamp','Rep Email','Rep Name','Rep Team','Date of Sale','DSI',
      'Account Type','Processed Via','Under Codes','Codes Used By','Trainee','Trainee Name',
      'Air Qty','Wireless New','Wireless BYOD','Fiber Package','Fiber Install Date',
      'VoIP Qty','DTV Qty','DTV Package','Notes','Units','Paid Out']);
    sheet.getRange(1,1,1,23).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function writePostSale(body, ss, officeId) {
  var email = String(body.repEmail||'').trim().toLowerCase();
  if (!email) return { error: 'Missing repEmail' };
  var dateOfSale = String(body.dateOfSale||'').trim();
  if (!dateOfSale) return { error: 'Missing dateOfSale' };
  var dsi = String(body.dsi||'').trim();
  if (!dsi || dsi.length < 12) return { error: 'DSI must be at least 12 characters' };
  var repName = String(body.repName||'').trim();
  var repTeam = '';
  try {
    var rosterSheet = ss.getSheetByName(officeTab(TAB.ROSTER, officeId));
    if (rosterSheet) {
      var rData = rosterSheet.getDataRange().getValues();
      for (var r = 1; r < rData.length; r++) {
        if (String(rData[r][0]||'').trim().toLowerCase() === email) {
          if (!repName) repName = String(rData[r][1]||'').trim();
          repTeam = String(rData[r][2]||'').trim();
          break;
        }
      }
    }
  } catch(e) {}
  var airQty      = Number(body.airQty)||0;
  var wirelessNew = Number(body.wirelessNew)||0;
  var wirelessByod= Number(body.wirelessByod)||0;
  var fiberPkg    = String(body.fiberPackage||'').trim();
  var fiberDate   = String(body.fiberInstallDate||'').trim();
  var voipQty     = Number(body.voipQty)||0;
  var dtvQty      = Number(body.dtvQty)||0;
  var dtvPkg      = String(body.dtvPackage||'').trim();
  var units = airQty + wirelessNew + wirelessByod + (fiberPkg ? 1 : 0) + voipQty + dtvQty;
  var sheet = _getPostedSalesSheet(ss, officeId);
  _safeAppend(sheet, [
    new Date(), email, repName, repTeam,
    new Date(dateOfSale + 'T12:00:00'), dsi,
    String(body.accountType||'').trim(), String(body.processedVia||'Sara').trim(),
    String(body.underSomeoneCodes||'No').trim(), String(body.codesUsedBy||'').trim().toLowerCase(),
    String(body.trainee||'No').trim(), String(body.traineeName||'').trim(),
    airQty, wirelessNew, wirelessByod, fiberPkg, fiberDate,
    voipQty, dtvQty, dtvPkg, String(body.notes||'').trim(), units
  ]);
  // Cross-post the rep's additional note into the call-log Rep Notes (keyed by
  // DSI) so notes typed on the Post Sale form show on that order in the call lists.
  var _psNote = String(body.notes||'').trim();
  if (_psNote) {
    try {
      writeNoteEntry({ dsi: dsi, noteText: _psNote, authorEmail: email, authorName: repName, noteType: 'rep' }, ss, officeId);
    } catch (e) {}
  }
  return { ok: true, units: units };
}

// ---- Posted Sales editing (rep self-correction + void) ----
function _ensurePostedVoidedCol(sheet) {
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1,1,1,lastCol).getValues()[0];
  for (var c=0;c<header.length;c++) { if (String(header[c]||'').trim()==='Voided') return c+1; }
  var col = lastCol + 1;
  sheet.getRange(1,col).setValue('Voided').setFontWeight('bold');
  return col;
}
// Posted Sales tab scoping: client-rep + leader/jd/manager see only their own
// posted orders; owner/admin/master-admin/activator see the whole office.
// Identity is badge-derived (gs); no valid badge (strict grace) => passthrough.
var _POSTED_OWN_ONLY = { 'client-rep':1, 'leader':1, 'jd':1, 'manager':1 };
var _POSTED_EDIT_ALL = { 'owner':1, 'admin':1, 'master-admin':1, 'activator':1 };
function _scopePostedSales(sales, gs) {
  if (!gs || !gs.valid) return sales;
  var rank = String(gs.rank||'').trim().toLowerCase();
  if (!_POSTED_OWN_ONLY[rank]) return sales;
  var email = String(gs.email||'').trim().toLowerCase();
  return sales.filter(function(s){ return String(s.repEmail||'').trim().toLowerCase() === email; });
}
// May this badge edit/void this posted-sale row? Own row, or a see-everything role.
function _authorizePostedEdit(sheet, rowIndex, gs) {
  if (!_strictAuth()) return { ok:true };
  if (!gs || !gs.valid) return { error:'auth_required' };
  var rank = String(gs.rank||'').trim().toLowerCase();
  if (_POSTED_EDIT_ALL[rank]) return { ok:true };
  var rowEmail = String(sheet.getRange(rowIndex, 2).getValue()||'').trim().toLowerCase();
  if (rowEmail && rowEmail === String(gs.email||'').trim().toLowerCase()) return { ok:true };
  return { error:'forbidden' };
}
// Edit a posted sale in place (self-correction). Notes (col 21) and identity
// columns (timestamp/email/repName/repTeam) are never changed here.
function updatePostedSale(body, ss, officeId) {
  var sheet = ss.getSheetByName('_PostedSales_' + officeId); if (!sheet) return { error:'Post Sale sheet not found' };
  var rowIndex = Number(body.rowIndex); if (!rowIndex || rowIndex < 2) return { error:'Invalid row' };
  if (rowIndex > sheet.getLastRow()) return { error:'Row not found' };
  var gs = _validateSession(ss, body.token);
  var auth = _authorizePostedEdit(sheet, rowIndex, gs); if (auth.error) return auth;
  var dateOfSale = String(body.dateOfSale||'').trim(); if (!dateOfSale) return { error:'Missing dateOfSale' };
  var dsi = String(body.dsi||'').trim(); if (dsi.length < 12) return { error:'DSI must be at least 12 characters' };
  var airQty = Number(body.airQty)||0, wn = Number(body.wirelessNew)||0, wb = Number(body.wirelessByod)||0;
  var fiberPkg = String(body.fiberPackage||'').trim();
  var voipQty = Number(body.voipQty)||0, dtvQty = Number(body.dtvQty)||0;
  var units = airQty + wn + wb + (fiberPkg ? 1 : 0) + voipQty + dtvQty;
  sheet.getRange(rowIndex, 5, 1, 16).setValues([[
    new Date(dateOfSale + 'T12:00:00'), dsi,
    String(body.accountType||'').trim(), String(body.processedVia||'Sara').trim(),
    String(body.underSomeoneCodes||'No').trim(), String(body.codesUsedBy||'').trim().toLowerCase(),
    String(body.trainee||'No').trim(), String(body.traineeName||'').trim(),
    airQty, wn, wb, fiberPkg, String(body.fiberInstallDate||'').trim(),
    voipQty, dtvQty, String(body.dtvPackage||'').trim()
  ]]);
  sheet.getRange(rowIndex, 22).setValue(units);
  return { ok:true, units:units };
}
// Soft-void / un-void a posted sale. Voided rows are skipped by the Live Sales
// Tracker, Teams, and Training & Tracking (still visible on the Posted Sales tab).
function voidPostedSale(body, ss, officeId) {
  var sheet = ss.getSheetByName('_PostedSales_' + officeId); if (!sheet) return { error:'Post Sale sheet not found' };
  var rowIndex = Number(body.rowIndex); if (!rowIndex || rowIndex < 2) return { error:'Invalid row' };
  if (rowIndex > sheet.getLastRow()) return { error:'Row not found' };
  var gs = _validateSession(ss, body.token);
  var auth = _authorizePostedEdit(sheet, rowIndex, gs); if (auth.error) return auth;
  var col = _ensurePostedVoidedCol(sheet);
  sheet.getRange(rowIndex, col).setValue(body.voided ? 'true' : '');
  return { ok:true, voided: !!body.voided };
}
function readPostedSales(ss, officeId, includeVoided) {
  var sheet = ss.getSheetByName('_PostedSales_' + officeId);
  if (!sheet) return [];
  var voidedCol = _ensurePostedVoidedCol(sheet); var voidedIdx = voidedCol - 1;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var sales = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var _vd = String(row[voidedIdx]||'').trim().toLowerCase() === 'true';
    if (_vd && !includeVoided) continue;
    var ts       = row[0] instanceof Date ? row[0].toISOString() : String(row[0]||'');
    var saleDateRaw = row[4];
    var saleDate = saleDateRaw instanceof Date ? saleDateRaw.toISOString().split('T')[0] : String(saleDateRaw||'').trim();
    var fiRaw    = row[16];
    var fiDate   = fiRaw instanceof Date ? fiRaw.toISOString().split('T')[0] : String(fiRaw||'').trim();
    sales.push({
      rowIndex:          i + 1,
      voided:            _vd,
      timestamp:         ts,
      repEmail:          String(row[1]||'').trim(),
      repName:           String(row[2]||'').trim(),
      repTeam:           String(row[3]||'').trim(),
      dateOfSale:        saleDate,
      dsi:               String(row[5]||'').trim(),
      accountType:       String(row[6]||'').trim(),
      processedVia:      String(row[7]||'').trim(),
      underSomeoneCodes: String(row[8]||'').trim(),
      codesUsedBy:       String(row[9]||'').trim(),
      trainee:           String(row[10]||'').trim(),
      traineeName:       String(row[11]||'').trim(),
      airQty:            Number(row[12])||0,
      wirelessNew:       Number(row[13])||0,
      wirelessByod:      Number(row[14])||0,
      fiberPackage:      String(row[15]||'').trim(),
      fiberInstallDate:  fiDate,
      voipQty:           Number(row[17])||0,
      dtvQty:            Number(row[18])||0,
      dtvPackage:        String(row[19]||'').trim(),
      notes:             String(row[20]||'').trim(),
      units:             Number(row[21])||0
    });
  }
  return sales;
}

function readRepLineStats(ss, officeId, repEmail) {
  if (!repEmail) return { error: 'Missing repEmail' };
  var roster = readRoster(ss, officeId);
  var repInfo = roster[repEmail.toLowerCase()];
  var tableauName = (repInfo && repInfo.tableauName) ? repInfo.tableauName.trim() : '';
  if (!tableauName) return { noLink: true };
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate()-120); cutoff.setHours(0,0,0,0);
  var total=0, active=0, posted=0, canceled=0, disconnected=0;
  _readBothLogs(ss, officeId, function(row, col, dsi, allRows) {
    var rep = String(tCol(row,col,'REP')||'').trim();
    if (rep !== tableauName) return null;
    var od = _parseDateLocal(tCol(row,col,'ORDER_DATE'));
    if (!od || od < cutoff) return null;
    allRows.forEach(function(r) {
      var st = String(tCol(r,col,'DTR_STATUS')||'').trim().toLowerCase();
      total++;
      if (st==='active') active++;
      else if (st==='posted') posted++;
      else if (st==='canceled') canceled++;
      else if (st==='disconnected') disconnected++;
    });
    return true;
  });
  var pending = total - active - posted - canceled - disconnected;
  return { tableauName:tableauName, total:total, active:active, posted:posted, canceled:canceled, disconnected:disconnected, pending:pending };
}

