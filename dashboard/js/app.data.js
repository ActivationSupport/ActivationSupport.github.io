// ── DATA ─────────────────────────────────────────────────────────────────
var TAB_CACHE = {};

function skelLoader() {
  function lines(widths) {
    return widths.map(function(w){ return '<div class="skel skel-line" style="width:'+w+'%"></div>'; }).join('');
  }
  return '<div class="skel-card"><div class="skel skel-hdr"></div>'+lines([80,55,70,45,85,60,75,50])+'</div>' +
         '<div class="skel-card"><div class="skel skel-hdr"></div>'+lines([70,50,65,40,80,55])+'</div>';
}

// ── Stale-while-revalidate cache for the main data blob ──
// The Apps Script fetch is the slow part. We stash each office's last data blob in
// sessionStorage so a reload / office-switch / return paints INSTANTLY from the last
// copy, then a fresh fetch runs in the background and re-renders. Cleared on sign-out.
function _mainDataKey() { return 'as_data_' + CFG.officeId; }
function _cacheMainData(res) {
  // Stamp the blob with the office it belongs to so the reader can prove it before
  // painting (office-isolation guard — see _readCachedMainData).
  try { sessionStorage.setItem(_mainDataKey(), JSON.stringify({ ts: Date.now(), office: CFG.officeId, data: res })); } catch (e) {}
}
function _readCachedMainData() {
  try {
    var raw = sessionStorage.getItem(_mainDataKey());
    if (!raw) return null;
    var o = JSON.parse(raw);
    // OFFICE-ISOLATION GUARD: never instant-paint a blob that isn't stamped for the
    // CURRENT office. Drops (a) any cache poisoned by a response that landed after an
    // office switch and (b) older blobs written before this stamp existed. On a miss
    // we just fall back to the loading skeleton, so a fresh login can never flash
    // another office's orders.
    if (!o || !o.data || o.office !== CFG.officeId) return null;
    return o;
  } catch (e) { return null; }
}
function _clearDataCache() {
  try {
    var rm = [];
    for (var i = 0; i < sessionStorage.length; i++) { var k = sessionStorage.key(i); if (k && k.indexOf('as_data_') === 0) rm.push(k); }
    rm.forEach(function(k) { sessionStorage.removeItem(k); });
  } catch (e) {}
}
function _applyMainData(res, ts) {
  DATA = res;
  if (_LST_POSTED !== null) _LST_SALES = _LST_POSTED.concat(_lstLegacyRows());   // re-merge legacy once the bundle (with legacyLstSales) is loaded
  _CACHE.mainDataTs = ts || Date.now();
  var roster = DATA.roster || {};
  var me = roster[SESSION.email];
  if (SESSION.isMaster) {
    // Master-admin is a global role — it never downgrades to this office's
    // roster rank (or to client-rep when absent from this office's roster).
    SESSION.role = 'master-admin';
    if (me) { SESSION.name = me.name || SESSION.email; SESSION.tableauName = me.tableauName || ''; }
    else if (!SESSION.name) { SESSION.name = SESSION.email; SESSION.tableauName = ''; }
  } else if (me) {
    SESSION.role = me.rank || 'client-rep';
    SESSION.name = me.name || SESSION.email;
    SESSION.tableauName = me.tableauName || '';
  } else if (!SESSION.role) {
    SESSION.role = 'client-rep';
    SESSION.name = SESSION.email;
    SESSION.tableauName = '';
  }
  SESSION._actualRole = SESSION.role;
  try { sessionStorage.setItem('as_session_' + (SESSION.homeOffice || CFG.officeId), JSON.stringify(SESSION)); } catch (e) {}
  var nameEl = document.getElementById('sb-user-name');
  if (nameEl) nameEl.textContent = SESSION.name + ' · ' + SESSION.role;
  _updateLastUpdated();
  var devWrap = document.getElementById('dev-toggle-wrap');
  if (devWrap) { devWrap.style.display = SESSION._actualRole === 'master-admin' ? 'block' : 'none'; if (SESSION._actualRole === 'master-admin') devWrap.innerHTML = _devToggleHtml(); }
  buildNav();
  var tab = TABS.find(function(t) { return t.id === CURRENT_TAB; });
  if (!tab || !tab.roles.includes(SESSION.role)) {
    CURRENT_TAB = TABS.find(function(t) { return t.roles.includes(SESSION.role); }).id;
  }
}
function loadData(forceFresh) {
  TAB_CACHE = {};
  // Fire the independent secondary fetches NOW (parallel with the main blob) instead
  // of waiting for it to resolve first.
  _bgRefreshLst();
  _preloadArLines();
  // Instant paint from the cached blob (skipped on a manual refresh).
  var painted = false;
  if (!forceFresh) {
    var cached = _readCachedMainData();
    if (cached) {
      try { _applyMainData(cached.data, cached.ts); switchTab(CURRENT_TAB); painted = true; _preloadTabs(); } catch (e) { painted = false; }
    }
  }
  if (!painted) document.getElementById('main-content').innerHTML = skelLoader();
  _CACHE.mainFlight = true;
  var _reqOffice = CFG.officeId;
  api({}).then(function(res) {
    _CACHE.mainFlight = false;
    // Office switched while this fetch was in flight — discard it so we never apply,
    // cache, or render one office's data under another.
    if (CFG.officeId !== _reqOffice) return;
    if (res.error) { if (!painted) document.getElementById('main-content').innerHTML = '<div class="spinner">Error: ' + esc(res.error) + '</div>'; return; }
    var firstPaint = !painted;
    _applyMainData(res, Date.now());
    _cacheMainData(res);
    if (firstPaint) {
      switchTab(CURRENT_TAB);
    } else {
      // Already showed cached data — refresh the current tab in place (skip tabs that
      // manage their own state, same as the background refresher).
      var skipRender = { postsale:1, postedsales:1, dailyreport:1, training:1 };
      if (!skipRender[CURRENT_TAB]) { TAB_CACHE = {}; renderTab(CURRENT_TAB); }
    }
    _preloadTabs();
  }).catch(function() {
    _CACHE.mainFlight = false;
    if (!painted) document.getElementById('main-content').innerHTML = '<div class="spinner">Connection error. <a href="#" onclick="loadData()">Retry</a></div>';
  });
}

function refreshData() {
  TAB_CACHE = {};
  _CACHE.mainDataTs = 0; _CACHE.lstSalesTs = 0;
  _LST_SALES = null; _AR_LINES = null; _AR_LOADING = false;
  _TRAINING_ORDERS = null; _PSV_SALES = null; _APPT.appointments = null;   // re-warm the secondary tabs too
  loadData(true);   // manual refresh: skip the instant-cache paint, fetch fresh
}

// ── CACHE MANAGER ─────────────────────────────────────────────────────────
function _updateLastUpdated() {
  var el = document.getElementById('last-updated'); if (!el || !_CACHE.mainDataTs) return;
  var s = Math.round((Date.now() - _CACHE.mainDataTs) / 1000);
  var txt = s < 10 ? 'just now' : s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s/60) + 'min ago' : Math.floor(s/3600) + 'h ago';
  el.textContent = 'Updated ' + txt;
}

function _bgRefreshMain() {
  if (_CACHE.mainFlight) return;
  _CACHE.mainFlight = true;
  var _reqOffice = CFG.officeId;
  api({}).then(function(res) {
    _CACHE.mainFlight = false;
    if (CFG.officeId !== _reqOffice) return;   // office switched mid-refresh — discard (no cross-office DATA)
    if (res.error) return;
    DATA = res;
    _CACHE.mainDataTs = Date.now();
    var me = (DATA.roster || {})[SESSION.email];
    if (me) SESSION.tableauName = me.tableauName || SESSION.tableauName;
    _updateLastUpdated();
    // Tabs that manage their own state/refresh, or run off their own cache so a
    // main-tick rebuild brings no new data and only risks disrupting the view.
    // (postsale form, dailyreport, training live-refresh, postedsales + actrates
    // caches, livesales handled by _bgRefreshLst.)
    var skipRender = { postsale:1, dailyreport:1, training:1, postedsales:1, actrates:1, livesales:1 };
    if (skipRender[CURRENT_TAB]) return;
    // In-place soft refresh for the call-log/order list tabs — updates rows only,
    // so search, sort, filters, scroll and open menus are all kept (no flash, no reset).
    if (_SOFT_REFRESH_TABS[CURRENT_TAB] && _softRefreshTab(CURRENT_TAB)) return;
    // If the user is actively typing/focused in a field, don't yank the view — the
    // data is already fresh in DATA; the view re-renders on their next action.
    var ae = document.activeElement, mc = document.getElementById('main-content');
    if (ae && mc && mc.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    // Otherwise rebuild (appointments/teams keep their state in module vars), keeping
    // scroll position and re-applying any DOM-only filter field the tab relies on.
    var snap = _snapScroll();
    var _fields = _SOFT_FIELDS[CURRENT_TAB] || [], _saved = {};
    _fields.forEach(function(id) { var el = document.getElementById(id); if (el) _saved[id] = el.value; });
    TAB_CACHE = {};
    if (CURRENT_TAB === 'people' && PEOPLE_TABLEAU_NAMES !== null) {
      document.getElementById('main-content').innerHTML = renderPeople(); bindFilters();   // skip the loading-skeleton flash
    } else {
      renderTab(CURRENT_TAB);
    }
    _fields.forEach(function(id) {
      if (_saved[id] === undefined || _saved[id] === '') return;
      var el = document.getElementById(id); if (!el) return;
      el.value = _saved[id];
      try { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); } catch (e) {}
    });
    _restoreScroll(snap);
  }).catch(function() { _CACHE.mainFlight = false; });
}
// Capture / restore scroll so a background re-render doesn't jump the page or table.
function _snapScroll() {
  var main = document.querySelector('.main');
  var wrap = document.querySelector('#main-content .call-table-wrap, #main-content .tbl-wrap, #main-content .tr-wrap');
  return { main: main ? main.scrollTop : 0, top: wrap ? wrap.scrollTop : 0, left: wrap ? wrap.scrollLeft : 0 };
}
function _restoreScroll(s) {
  if (!s) return;
  var main = document.querySelector('.main');
  if (main) main.scrollTop = s.main;
  var wrap = document.querySelector('#main-content .call-table-wrap, #main-content .tbl-wrap, #main-content .tr-wrap');
  if (wrap) { wrap.scrollTop = s.top; wrap.scrollLeft = s.left; }
}

// ── BACKGROUND SOFT-REFRESH (in-place, non-disruptive) ────────────────────
// Tabs listed here update their ROWS in place on a background refresh — keeping
// the user's search, sort, filters, scroll and open menus — instead of a full
// rebuild (no flash, nothing resets). Rolled out one tab at a time as verified.
var _SOFT_REFRESH_TABS = { master:1, myorders:1, myteam:1, dayafter:1, delivered:1, issues:1, completed:1, noanswer:1, escalations:1 };
// Tabs that DO get fresh data from the main refresh but hold a DOM-only filter
// field — preserve + re-apply it across the rebuild so the view doesn't reset.
var _SOFT_FIELDS = { people: ['f-people'], churn: ['churn-rep-sel'] };

// The base (role-scoped) order list a call-table tab is built from — mirrors the
// renderTab() switch exactly, so a soft refresh reuses the same source.
function _tabOrderSource(tab) {
  switch (tab) {
    case 'master':    return repFilter(DATA.masterTracker || []).slice().sort(_byOrderDateDesc);
    case 'myorders':  return _myOrdersFilter(DATA.masterTracker || []).slice().sort(_byOrderDateDesc);
    case 'myteam':    return _myTeamFilter(DATA.masterTracker || []).slice().sort(_byOrderDateDesc);
    case 'dayafter':  return repFilter(DATA.dayAfterOrders || []).slice().sort(_byOrderDateDesc);
    case 'delivered': return repFilter(within29Days(DATA.deliveredOrders || [])).slice().sort(_byOrderDateDesc);
    case 'issues':    return repFilter(issueFilter(DATA.orderIssues || [])).slice().sort(_byOrderDateDesc);
    case 'completed': return repFilter(DATA.completedOrders || []).slice().sort(_byOrderDateDesc);
    case 'noanswer':    return _noAnswerOrders();      // already default-sorted (never-called first)
    case 'escalations': return _escalationOrders();    // already default-sorted (newest first)
    default:          return null;
  }
}

// Refresh just the rows of a call-table tab from fresh DATA, preserving all UI
// state. Returns true if handled; false to fall back to a full render (e.g. the
// table isn't on screen because the tab was showing its empty state).
function _softRefreshTab(tab) {
  var src = _tabOrderSource(tab);
  if (src === null) return false;
  if (!_sortTblId || !document.getElementById(_sortTblId)) return false;   // table not on screen (empty state) -> needs a full build
  var snap = _snapScroll();
  _tabOrders = src.slice();                                // src is already in the tab's default order
  _applyView();                                            // re-applies the user's filters/sort/search in place
  _restoreScroll(snap);
  return true;
}

// ── NOTES POLL (frequent + non-disruptive) ────────────────────────────────
// Notes are the one thing that needs to reach everyone fast. We poll the small
// readNotes endpoint every ~25s ONLY where notes are shown, and update the note
// counts + an open notes window IN PLACE — no table rebuild, so nothing is disrupted.
function _notesTabActive() {
  var t = { master:1, myorders:1, myteam:1, dayafter:1, delivered:1, issues:1, escalations:1, noanswer:1, completed:1 };
  if (t[CURRENT_TAB]) return true;
  var dm = document.getElementById('detail-modal');
  return !!(dm && dm.classList.contains('open') && document.getElementById('nm-act-hist'));
}
function _bgRefreshNotes() {
  if (_CACHE.notesFlight || _noteAddFlight) return;   // skip while a fetch or a local add is running
  if (!_notesTabActive()) return;                     // only poll where notes are visible
  _CACHE.notesFlight = true;
  api({ action:'readNotes' }).then(function(res) {
    _CACHE.notesFlight = false;
    if (!res || res.error || !res.notes) return;
    DATA.notes = res.notes;
    _applyNoteCounts();
    _refreshOpenNotesModal();
  }).catch(function() { _CACHE.notesFlight = false; });
}
// Update the NOTES button counts in the current table without rebuilding it.
function _applyNoteCounts() {
  var btns = document.querySelectorAll('.notes-btn[data-dsi]');
  for (var i = 0; i < btns.length; i++) {
    var btn = btns[i], dsi = btn.getAttribute('data-dsi');
    var n = ((DATA.notes || {})[dsi] || []).length;
    var span = btn.querySelector('.notes-count');
    if (n > 0) {
      btn.classList.add('has-notes');
      if (span) span.textContent = n;
      else { var s = document.createElement('span'); s.className = 'notes-count'; s.id = 'nc-' + dsi.replace(/\W/g, '_'); s.textContent = n; btn.appendChild(s); }
    } else {
      btn.classList.remove('has-notes');
      if (span) span.parentNode.removeChild(span);
    }
  }
}
// If the notes window is open, refresh its history lists live (leaves the textareas
// you're typing in untouched; keeps each list pinned to the bottom if it was there).
function _refreshOpenNotesModal() {
  var dm = document.getElementById('detail-modal');
  if (!dm || !dm.classList.contains('open') || !_modalDsi) return;
  var actHist = document.getElementById('nm-act-hist'), repHist = document.getElementById('nm-rep-hist');
  if (!actHist && !repHist) return;   // a different modal is reusing detail-modal
  var notes = (DATA.notes || {})[_modalDsi] || [];
  var actNotes = notes.filter(function(n) { return (n.noteType || 'activation') === 'activation'; });
  var repNotes = notes.filter(function(n) { return n.noteType === 'rep' || n.noteType === 'note'; });
  if (actHist) {
    var atBottomA = actHist.scrollHeight - actHist.scrollTop - actHist.clientHeight < 4;
    actHist.innerHTML = actNotes.length ? actNotes.map(_noteItemHtml).join('') : '<div class="nm-empty">No activation notes yet.</div>';
    if (atBottomA) actHist.scrollTop = actHist.scrollHeight;
  }
  if (repHist) {
    var atBottomR = repHist.scrollHeight - repHist.scrollTop - repHist.clientHeight < 4;
    repHist.innerHTML = repNotes.length ? repNotes.map(_noteItemHtml).join('') : '<div class="nm-empty">No rep notes yet.</div>';
    if (atBottomR) repHist.scrollTop = repHist.scrollHeight;
  }
}

function _bgRefreshLst() {
  if (_CACHE.lstFlight) return;
  _CACHE.lstFlight = true;
  api({ action:'readPostedSales', officeId:CFG.officeId }).then(function(res) {
    _CACHE.lstFlight = false;
    _LST_POSTED = res.sales || []; _LST_SALES = _LST_POSTED.concat(_lstLegacyRows());   // legacy re-merged in _applyMainData once DATA is ready
    _CACHE.lstSalesTs = Date.now();
    if (CURRENT_TAB === 'livesales') document.getElementById('main-content').innerHTML = _lstBuild();
  }).catch(function() { _CACHE.lstFlight = false; });
}

function _preloadArLines() {
  if (_AR_LINES !== null || _AR_LOADING) return;
  _AR_LOADING = true;
  api({ action:'readActRateLines' }).then(function(resp) {
    _AR_LOADING = false;
    _AR_LINES = (resp && resp.actRateLines) ? resp.actRateLines : [];
    if (CURRENT_TAB === 'actrates') {
      var c = document.getElementById('main-content');
      if (c) c.innerHTML = _renderActRatesWithData();
    } else if (CURRENT_TAB === 'teams' && _TM_VIEW === 'detail' && _TM_DETAIL_ID) {
      var tc = document.getElementById('main-content');
      if (tc) tc.innerHTML = _tmBuildDetail(_TM_DETAIL_ID);   // team AR table was waiting on this
    }
  }).catch(function() { _AR_LOADING = false; _AR_LINES = []; });
}
// Warm the People tab's roster-name lookup in the background (one cheap call).
function _preloadPeople() {
  if (PEOPLE_TABLEAU_NAMES !== null) return;
  ensureTableauNames(function() {
    if (CURRENT_TAB === 'people') { var c = document.getElementById('main-content'); if (c) { c.innerHTML = renderPeople(); bindFilters(); } }
  });
}
// After login, quietly warm the slower secondary tabs so they open instantly.
function _preloadTabs() {
  try { _preloadPeople(); } catch (e) {}
  try { _preloadAppointments(); } catch (e) {}
  try { _preloadTraining(); } catch (e) {}
}

// One main-refresh tick — shared by the 15s interval and the visibilitychange
// catch-up below, so a backgrounded tab stops polling but refreshes the moment
// the user comes back to it.
function _bgTick() {
  if (document.hidden) return;   // background tab — skip (catch-up runs on return)
  if (document.getElementById('app').style.display === 'none') return;
  var modalOpen = document.getElementById('detail-modal').classList.contains('open');
  if (modalOpen) {
    if (Date.now() - _CACHE.mainDataTs >= _CACHE.MAIN_TTL) _pendingRefresh = true;
    return;
  }
  if (Date.now() - _CACHE.mainDataTs >= _CACHE.MAIN_TTL) _bgRefreshMain();
  if (Date.now() - _CACHE.lstSalesTs  >= _CACHE.LST_TTL)  _bgRefreshLst();
}

function _startBgRefresh() {
  clearInterval(_bgInterval);
  clearInterval(_luInterval);
  clearInterval(_notesInterval);
  // Notes poll — frequent + non-disruptive. Runs even while the notes window is open
  // (so notes appear live there) and only when notes are on screen. Pauses when hidden.
  _notesInterval = setInterval(function() {
    if (document.hidden) return;   // background tab — skip (catch-up runs on return)
    if (document.getElementById('app').style.display === 'none') return;
    _bgRefreshNotes();
  }, _CACHE.NOTES_TTL);
  // Check every 15s — fires a refresh once the TTL (90s) has passed
  _bgInterval = setInterval(_bgTick, 15000);
  // Tick the "X ago" label every 20s
  _luInterval = setInterval(_updateLastUpdated, 20000);
}

// When the tab returns to the foreground, catch up immediately — the polls above
// skip their ticks while document.hidden, so anything past its TTL refreshes now
// instead of waiting for the next interval.
document.addEventListener('visibilitychange', function() {
  if (document.hidden) return;
  var app = document.getElementById('app');
  if (!app || app.style.display === 'none') return;
  _updateLastUpdated();
  _bgTick();
  _bgRefreshNotes();
});

// ── TEAM HELPERS ─────────────────────────────────────────────────────────
function _myTeam() {
  var role = SESSION.role, teams = DATA.teams || {}, roster = DATA.roster || {};
  if (role === 'leader') {
    var myEmail = (SESSION.email || '').toLowerCase();
    var found = null;
    Object.keys(teams).forEach(function(tid) {
      if ((teams[tid].leaderId || '').toLowerCase() === myEmail) found = teams[tid];
    });
    return found;
  }
  if (role === 'jd') {
    var me = roster[SESSION.email] || {};
    var teamName = me.team || '';
    if (!teamName) return null;
    var found2 = null;
    Object.keys(teams).forEach(function(tid) {
      if (teams[tid].name === teamName) found2 = teams[tid];
    });
    return found2;
  }
  return null;
}
function _teamTableauNames(teamName) {
  if (!teamName) return [];
  var roster = DATA.roster || {};
  var tns = [];
  Object.keys(roster).forEach(function(email) {
    var p = roster[email];
    if ((p.team || '') === teamName && p.tableauName)
      tns.push((p.tableauName || '').trim().toLowerCase());
  });
  return tns;
}
function _teamEmails(teamName) {
  if (!teamName) return [];
  var roster = DATA.roster || {};
  return Object.keys(roster).filter(function(email) {
    return (roster[email].team || '') === teamName;
  });
}

// ── REP FILTER ────────────────────────────────────────────────────────────
function repFilter(orders) {
  var role = SESSION.role;
  if (role === 'client-rep') {
    var tn = (SESSION.tableauName || '').trim().toLowerCase();
    if (!tn) return [];
    // case-insensitive (matches leader/jd below) so a casing drift between the
    // rep's tableauName and the order's rep field can't silently hide all orders
    return orders.filter(function(o) { return (o.rep || '').trim().toLowerCase() === tn; });
  }
  if (role === 'leader') {   // jd is office-wide (manager-equivalent); only leader is team-scoped
    var team = _myTeam();
    if (team) {
      var tns = _teamTableauNames(team.name);
      if (!tns.length) return [];
      return orders.filter(function(o) { return tns.indexOf((o.rep || '').trim().toLowerCase()) !== -1; });
    }
    var tn2 = (SESSION.tableauName || '').trim().toLowerCase();
    return tn2 ? orders.filter(function(o) { return (o.rep || '').trim().toLowerCase() === tn2; }) : [];
  }
  return orders;
}
// ── My Orders / My Team's Orders scoping (role-based tracker tabs) ──────────
// Each role already receives a server-scoped masterTracker (own / team / office);
// these filter that payload down to the specific view.
function _myTeamName() {
  var teams = DATA.teams || {}, myEmail = (SESSION.email || '').toLowerCase();
  var led = null;
  Object.keys(teams).forEach(function(tid){ if ((teams[tid].leaderId || '').toLowerCase() === myEmail) led = teams[tid]; });
  if (led) return led.name;                          // a team they LEAD
  var me = (DATA.roster || {})[SESSION.email] || {};
  return me.team || '';                              // else the team they're ON
}
function _myOrdersFilter(orders) {
  var tn = (SESSION.tableauName || '').trim().toLowerCase();
  if (!tn) return [];
  return orders.filter(function(o) { return (o.rep || '').trim().toLowerCase() === tn; });
}
function _myTeamFilter(orders) {
  var tns = _teamTableauNames(_myTeamName());
  if (!tns.length) return [];
  return orders.filter(function(o) { return tns.indexOf((o.rep || '').trim().toLowerCase()) !== -1; });
}
function isIssueStatus(s) {
  var sl = String(s||'').toLowerCase().trim();
  return sl.indexOf('porting issue') !== -1 ||
         sl.indexOf('port approved') !== -1 ||
         sl.indexOf('pending order port') !== -1 ||
         sl.indexOf('byod') !== -1 ||
         sl.indexOf('pending valid payment') !== -1;
}
function issueFilter(orders) {
  return orders.filter(function(o) {
    return Object.keys(o.statusCounts||{}).some(isIssueStatus);
  });
}
function _cutoff29() {
  var d = new Date(); d.setDate(d.getDate() - 29);
  return d.toISOString().slice(0, 10);
}
function within29Days(orders) {
  var cutoff = _cutoff29();
  return orders.filter(function(o) { return (o.orderDate || '') >= cutoff; });
}

// ── RENDER TABS ───────────────────────────────────────────────────────────
function renderTab(id) {
  var c = document.getElementById('main-content');
  // Sales Support ticketing office → its own screens (app.tickets.js); every other office unchanged.
  if (typeof CFG !== 'undefined' && CFG && CFG.officeId === 'salessupport' && typeof renderTicketTab === 'function') { renderTicketTab(id); return; }
  if (id === 'people') {
    c.innerHTML = skelLoader();
    ensureTableauNames(function() { c.innerHTML = renderPeople(); bindFilters(); });
    return;
  }
  switch(id) {
    case 'actrates':    c.innerHTML = renderActRates();    break;
    case 'myorders':    c.innerHTML = renderCallTable(_myOrdersFilter(DATA.masterTracker||[]), 'My Orders', 'No orders found.'); break;
    case 'myteam':      c.innerHTML = renderCallTable(_myTeamFilter(DATA.masterTracker||[]), "My Team's Orders", 'No orders found.'); break;
    case 'master':      c.innerHTML = renderCallTable(repFilter(DATA.masterTracker||[]), 'Master Tracker', 'No orders found.'); break;
    case 'actsupport':  renderActivationSupport(); break;
    case 'dayafter':    c.innerHTML = renderCallTable(repFilter(DATA.dayAfterOrders||[]), 'Day-After Calls', 'No day-after orders found.'); break;
    case 'delivered':   c.innerHTML = renderCallTable(repFilter(within29Days(DATA.deliveredOrders||[])), 'Delivered Not Active', 'No delivered-not-active orders found.'); break;
    case 'issues':      c.innerHTML = renderCallTable(repFilter(issueFilter(DATA.orderIssues||[])), 'Order Issues', 'No order issues found.'); break;
    case 'completed':   c.innerHTML = renderCallTable(repFilter(DATA.completedOrders||[]), 'Completed Order Log', 'No completed orders found.'); break;
    case 'noanswer':    c.innerHTML = renderNoAnswerTable(); break;
    case 'escalations': c.innerHTML = renderEscalationsTable(); break;
    case 'churn':       c.innerHTML = renderChurn();       break;
    case 'dailyreport': c.innerHTML = renderDailyReport(); break;
    case 'postsale':    c.innerHTML = renderPostSale();    break;
    case 'rehash':      c.innerHTML = renderRehashTab();   break;
    case 'firstbill':   c.innerHTML = renderFirstBillCalc(); break;
    case 'postedsales': renderPostedSalesTab();           break;
    case 'livesales':   renderLiveSalesTracker();          break;
    case 'teams':        renderTeamsTab();          break;
    case 'appointments': _APPT.weekOffset=0; _APPT.dayOffset=0; renderAppointmentsTab();  break;  // always open on the current week/day
    case 'myappts':      renderMyAppointments();     break;   // Item 4: activator cross-office dashboard
    case 'training':     renderTrainingTab();       break;
    default: c.innerHTML = '<div class="empty">Coming soon.</div>';
  }
  bindFilters();
}

// ── HELPERS ───────────────────────────────────────────────────────────────
function fmtDate(v) {
  if (!v) return '—';
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v).split('T')[0];
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;'); }

