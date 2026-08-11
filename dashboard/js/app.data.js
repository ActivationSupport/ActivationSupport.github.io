// ── DATA ─────────────────────────────────────────────────────────────────
var TAB_CACHE = {};

function skelLoader() {
  function lines(widths) {
    return widths.map(function(w){ return '<div class="skel skel-line" style="width:'+w+'%"></div>'; }).join('');
  }
  return '<div id="skel-note" class="skel-note" style="display:none"></div>' +
         '<div class="skel-card"><div class="skel skel-hdr"></div>'+lines([80,55,70,45,85,60,75,50])+'</div>' +
         '<div class="skel-card"><div class="skel skel-hdr"></div>'+lines([70,50,65,40,80,55])+'</div>';
}

/* ⚠⚠ THE SKELETON LOOKS IDENTICAL AT 2s AND AT 40s, AND THAT IS WHY IT READS AS BROKEN.
   A rep reported the portal "loading endlessly" on a first load — it was not endless, but a
   shimmer that never changes gives you no way to tell a slow load from a dead one, so the
   rational move is to hard-refresh. This says out loud what is happening.
   🔑 Measured: the blob is ~2.3s warm / ~5.8s cold, so 6s genuinely IS unusual — the first
   message is not crying wolf. The second lands before the 20s attempt timeout so the rep is
   told they may act before the transport gives up on its own.
   ⚠ NOT a timeout and it cancels nothing — purely what the screen admits to. The actual
   bounds live in _AS_TIMEOUT_* / _AS_DEADLINE_* in app.core.js.
   ⚠ Must be cleared by EVERY exit path or a stale "still trying" outlives the load. */
var _SKEL_TIMERS = [];
function _skelClearNote() {
  _SKEL_TIMERS.forEach(clearTimeout); _SKEL_TIMERS = [];
}
function _skelStartNote() {
  _skelClearNote();
  var say = function (msg) {
    return function () {
      var el = document.getElementById('skel-note');
      if (!el) return;                    // skeleton already replaced — nothing to say
      el.textContent = msg; el.style.display = 'block';
    };
  };
  _SKEL_TIMERS.push(setTimeout(say('Taking longer than usual — still loading your data…'), 6000));
  _SKEL_TIMERS.push(setTimeout(say('Still trying. You can keep waiting, or reload the page.'), 15000));
}

// ── Stale-while-revalidate cache for the main data blob ──
// The Apps Script fetch is the slow part. We stash the last data blob per (office, user)
// so a reload / office-switch / return / NEXT MORNING paints INSTANTLY from the last copy,
// then a fresh fetch runs in the background and re-renders. Cleared on sign-out.
/* ── INSTANT PAINT ACROSS SESSIONS ───────────────────────────────────────────────────
   This cache used to live in sessionStorage, which dies with the tab — so there was NO
   instant paint on the first login of the day, a new tab, a browser restart, or after iOS
   Safari discarded a backgrounded tab. Every one of those fell through to skelLoader() and
   blocked on the full blob (~5.8s cold). Reps ate that every morning.
   It is now localStorage, so yesterday's data paints immediately and the live blob swaps in
   behind it. FOUR GUARDS make that safe:
     1. PER USER — the key carries the signed-in email. localStorage is shared by everyone
        on the device, and these are shared handhelds. Without this, rep B opening the
        portal would paint rep A's orders. The blob is ROLE-SCOPED server-side, so this is
        not cosmetic.
     2. PER OFFICE — the existing office stamp, still proved before painting.
     3. MAX AGE — never paint anything older than _MAIN_CACHE_MAX_AGE. Stale-but-labelled
        is useful; yesterday-morning's data silently presented as current is not.
     4. CLEARED ON SIGN-OUT — logout and the inactivity/forced re-auth paths wipe it, so
        signing out actually removes the customer data from the device.
   ⚠ The "X ago" label (_updateLastUpdated) is what tells the user this is a cached paint.
     It is load-bearing here, not decoration — don't remove it. */
/* ⚠⚠ 12h WAS THE WRONG NUMBER AND IT DEFEATED THE WHOLE FEATURE.
   The instant paint exists to kill the cold-load wait, and "first load of the day" is the
   case it most needs to cover — but a rep finishing at 6pm and starting at 8am is a 14h
   gap, so the cache was REFUSED every single morning. Monday after Friday is ~62h. The one
   scenario this was built for was the one scenario it excluded.
   72h covers overnight, a weekend, and a day off. Painting older data is safe here because
   it is never presented as current: the region carries the .data-unconfirmed banner and the
   "Updated Xh ago" label until the live fetch lands seconds later, and the per-user,
   per-office and cleared-on-sign-out guards are unchanged. The alternative is not "fresher
   data" — it is a blank skeleton for ~6s, which is not current either. */
var _MAIN_CACHE_MAX_AGE = 72 * 60 * 60 * 1000;   // 72h

function _mainDataUser() {
  return String((typeof SESSION !== 'undefined' && SESSION && SESSION.email) || '').trim().toLowerCase();
}
function _mainDataKey() { return 'as_data_' + CFG.officeId + '_' + _mainDataUser(); }
function _cacheMainData(res) {
  // Stamp the blob with the office it belongs to so the reader can prove it before
  // painting (office-isolation guard — see _readCachedMainData).
  // Never write an unattributed blob: without an email the key would be shared by every
  // user on the device, which is the one thing the per-user guard exists to prevent.
  if (!_mainDataUser()) return;
  try {
    localStorage.setItem(_mainDataKey(), JSON.stringify({
      ts: Date.now(), office: CFG.officeId, user: _mainDataUser(), data: res
    }));
  } catch (e) {
    // Quota is the expected failure (the blob is large and localStorage is ~5MB).
    // Drop our own older entries and retry once; if it still fails, we simply have no
    // instant paint — which is exactly the old behaviour, so failing here is harmless.
    try { _pruneDataCache(); localStorage.setItem(_mainDataKey(), JSON.stringify({
      ts: Date.now(), office: CFG.officeId, user: _mainDataUser(), data: res })); } catch (e2) {}
  }
}
function _readCachedMainData() {
  try {
    var me = _mainDataUser();
    if (!me) return null;                      // not signed in yet — nothing may be painted
    var raw = localStorage.getItem(_mainDataKey());
    if (!raw) return null;
    var o = JSON.parse(raw);
    // OFFICE-ISOLATION GUARD: never instant-paint a blob that isn't stamped for the
    // CURRENT office. Drops (a) any cache poisoned by a response that landed after an
    // office switch and (b) older blobs written before this stamp existed. On a miss
    // we just fall back to the loading skeleton, so a fresh login can never flash
    // another office's orders.
    if (!o || !o.data || o.office !== CFG.officeId) return null;
    // USER-ISOLATION GUARD: the key already carries the email, but prove it from the
    // payload too. localStorage outlives the session and these are shared devices, so a
    // key collision must never be able to paint someone else's orders.
    if (String(o.user || '') !== me) return null;
    // AGE GUARD: stale-but-labelled is useful, silently-ancient is not.
    if (!o.ts || (Date.now() - o.ts) > _MAIN_CACHE_MAX_AGE) return null;
    return o;
  } catch (e) { return null; }
}

/* Housekeeping. localStorage persists, so without this the device slowly accumulates a
   blob per (office, user) that was signed into on it. Drops everything except the current
   user's entry for the current office. */
function _pruneDataCache(keepCurrent) {
  try {
    var keep = keepCurrent === false ? null : _mainDataKey();
    var rm = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('as_data_') === 0 && k !== keep) rm.push(k);
    }
    rm.forEach(function(k) { localStorage.removeItem(k); });
  } catch (e) {}
}
/* Called by logout AND by _forceReauth (expired badge / inactivity sign-out).
   ⚠⚠ MUST clear localStorage now, not sessionStorage. The blob holds customer orders and
   now OUTLIVES the tab, so signing out is the moment it has to leave the device — that is
   the whole basis on which persisting it is acceptable. Clearing the old sessionStorage
   keys too, so a browser that still has pre-change entries is cleaned up on first sign-out. */
function _clearDataCache() {
  try {
    var rm = [];
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('as_data_') === 0) rm.push(k); }
    rm.forEach(function(k) { localStorage.removeItem(k); });
  } catch (e) {}
  try {
    var rs = [];
    for (var j = 0; j < sessionStorage.length; j++) { var sk = sessionStorage.key(j); if (sk && sk.indexOf('as_data_') === 0) rs.push(sk); }
    rs.forEach(function(k) { sessionStorage.removeItem(k); });
  } catch (e) {}
}
function _applyMainData(res, ts) {
  /* 🔴🔴 NOTES MUST SURVIVE THIS SWAP — this is a WHOLESALE replace, not a merge.
     Since `a3f3612` (2026-08-07) the blob deliberately carries NO `notes` key: notes are fetched
     by their own `readNotes` action every ~25s. But `DATA = res` then dropped `DATA.notes` on the
     floor every ~90s main refresh, so notes VANISHED AND REAPPEARED ON A LOOP — absent for up to
     ~25s out of every ~90s, across every office. Reported 2026-08-11 as "notes are missing".
     ⚠⚠ The DATA WAS NEVER AT RISK — `_Notes_<office>` held 2,962 rows throughout. A wholesale
     object swap on the client looked exactly like data loss to the people using it.
     🔑 The `_LST_SALES` line directly below does this same restore — the hazard was already known
     and notes were simply missed when they moved out of the blob. **Anything fetched OUTSIDE the
     blob must be re-attached here, or the next main refresh erases it.** */
  var _keepNotes = DATA && DATA.notes;
  DATA = res;
  if (_keepNotes && !DATA.notes) DATA.notes = _keepNotes;
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
  /* ⚠⚠ THE MAIN BLOB IS ISSUED FIRST — see below. This used to fire _bgRefreshLst() and
     _preloadArLines() here, on the stated reasoning that they run "parallel with the main
     blob instead of waiting for it to resolve". That premise does not hold: APPS SCRIPT
     SERIALISES CONCURRENT REQUESTS FROM THE SAME USER, so they do not run alongside the
     blob — they run BEFORE it, and the screen waits out both at ~2s each.
     Issuing order is execution order, so the blob goes first and these follow immediately
     after. They are still in flight early; they just no longer queue in front of the one
     request the visible tab depends on. */
  // Instant paint from the cached blob (skipped on a manual refresh).
  var painted = false;
  if (!forceFresh) {
    var cached = _readCachedMainData();
    if (cached) {
      // ts is the CACHED blob's timestamp, so "Updated 7h ago" appears immediately and the
      // user can see this is yesterday's data until the live fetch below swaps it out.
      try {
        _applyMainData(cached.data, cached.ts); switchTab(CURRENT_TAB); painted = true;
        // Real data, instantly — but say plainly that it is last session's until the
        // fetch below confirms it. Cleared by _applyMainData on the fresh response.
        _markDataStale();
        /* 🔴 DO NOT _preloadTabs() HERE. It warms People/Appointments/Training, which is
           several more Apps Script calls, and APPS SCRIPT SERIALISES CONCURRENT REQUESTS
           FROM THE SAME USER — so they do not run "in parallel", they QUEUE, and the main
           blob below (the only thing the screen is actually waiting for) ends up behind
           all of them at ~2s each.
           This is what made the first load and hard refresh slow: before the cache started
           hitting reliably, `painted` was false on a cold tab and the preloads only ran
           AFTER the blob landed. Making the cache hit more often moved the whole storm in
           front of the thing the user is waiting for.
           The .then() below still calls _preloadTabs() once the blob is in — warming a tab
           the rep has not opened yet is never more urgent than the tab they are looking at. */
      } catch (e) { painted = false; }
    }
    // Only one blob per device is worth keeping; drop other users'/offices' leftovers.
    _pruneDataCache();
  }
  // Only when the skeleton is what the rep is actually staring at — a cached paint already
  // shows real data and carries its own "Updated X ago" treatment.
  if (!painted) { document.getElementById('main-content').innerHTML = skelLoader(); _skelStartNote(); }
  _CACHE.mainFlight = true;
  var _reqOffice = CFG.officeId;
  var _mainP = api({});                  // FIRST in the queue — the visible tab needs it
  _bgRefreshLst();                       // then the secondaries, behind it rather than ahead
  _preloadArLines();
  _mainP.then(function(res) {
    _CACHE.mainFlight = false;
    _skelClearNote();                    // settled — nothing left to narrate
    // Office switched while this fetch was in flight — discard it so we never apply,
    // cache, or render one office's data under another.
    if (CFG.officeId !== _reqOffice) return;
    if (res.error) { if (!painted) document.getElementById('main-content').innerHTML = '<div class="spinner">Error: ' + esc(res.error) + '</div>'; return; }
    var firstPaint = !painted;
    _applyMainData(res, Date.now());
    _markDataFresh();   // confirmed — drop the cached-data treatment
    _cacheMainData(res);
    if (firstPaint) {
      switchTab(CURRENT_TAB);
    } else {
      // Already showed cached data — refresh the current tab in place (skip tabs that
      // manage their own state, same as the background refresher).
      var skipRender = { postsale:1, postedsales:1, dailyreport:1, training:1 };
      if (!skipRender[CURRENT_TAB]) { TAB_CACHE = {}; renderTab(CURRENT_TAB); }
    }
    /* Notes are no longer in the blob (see the note where it used to be built). Fetch them NOW
       rather than waiting up to 25s for the next poll tick, so the "last called" column resolves
       within a second of first paint instead of a rep staring at placeholders.
       ⚠⚠ ISSUED AFTER THE BLOB HAS LANDED, NEVER ALONGSIDE IT. Apps Script serialises same-user
       requests, so anything sent earlier executes earlier — firing this in parallel would put it
       IN FRONT of the payload the whole screen is waiting on. That mistake has been made here
       before, when a caching win reordered _preloadTabs() ahead of the main blob.
       ⚠ _bgRefreshNotes gates on _notesTabActive(), so a tab that shows no notes still pays
       nothing — which is the point of taking it out of the blob. */
    _bgRefreshNotes();
    _preloadTabs();
  }).catch(function() {
    _CACHE.mainFlight = false;
    _skelClearNote();                    // settled — the error message below takes over
    // Same reasoning as _bgRefreshMain: don't let one failure buy a full TTL of silence.
    _CACHE.mainDataTs = Date.now() - (_CACHE.MAIN_TTL - 15000);
    if (!painted) document.getElementById('main-content').innerHTML = '<div class="spinner">Connection error. <a href="#" onclick="loadData()">Retry</a></div>';
  });
}

/* ── "SHOWING CACHED DATA" TREATMENT ─────────────────────────────────────────────────
   The practical version of "hold the numbers until they're confirmed". Painting the layout
   with values blanked would mean teaching ~10 tab renderers a values-empty mode — and the
   rep still could not act on it, so it buys nothing over the skeleton it replaced.
   Instead: paint the real cached data immediately (no waiting) and mark the whole region as
   not-yet-confirmed until the live fetch lands. One class on one container, no renderer
   changes, and it is honest about what is on screen.
   ⚠ It must be cleared by EVERY path that lands fresh data, or the portal would sit there
   looking permanently unconfirmed. */
function _markDataStale() {
  var mc = document.getElementById('main-content');
  if (mc) mc.classList.add('data-unconfirmed');
}
function _markDataFresh() {
  var mc = document.getElementById('main-content');
  if (mc) mc.classList.remove('data-unconfirmed');
}

function refreshData() {
  TAB_CACHE = {};
  _CACHE.mainDataTs = 0; _CACHE.lstSalesTs = 0;
  _LST_SALES = null; _AR_LINES = null; _AR_LOADING = false;
  _TRAINING_ORDERS = null; _PSV_SALES = null; _APPT.appointments = null;   // re-warm the secondary tabs too
  _TM_ORDERS = {}; _TM_ORD_LOADING = {};   // Teams tab: re-pull any sub-team order payloads
  if (typeof _MTO_F !== 'undefined') { _MTO_F = {}; _MTO_TEAM_ORDERS = {}; }   // grouped My Team's Orders filters
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
    /* ⚠ A FAILED REFRESH USED TO COST A FULL TTL. mainDataTs was left untouched, so the
       next attempt waited the whole 90s and one failure put us at ~183s behind — outside
       the 2-minute budget on a single hiccup. Back the clock off instead, so the next tick
       (≤15s away) retries. */
    if (res.error) { _CACHE.mainDataTs = Date.now() - (_CACHE.MAIN_TTL - 15000); return; }
    DATA = res;
    _CACHE.mainDataTs = Date.now();
    _markDataFresh();
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
    case 'myteam':    { var _mid=_myTeamId(); if (_mid && _tmHasSubTeams(_mid)) return null;   // grouped view → force a full re-render on refresh
                        return _myTeamFilter(DATA.masterTracker || []).slice().sort(_byOrderDateDesc); }
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

/* ⚠⚠ "NOT YET LOADED" IS NOT "NO NOTES", AND CONFLATING THEM RENDERS A LIE.
   `notes` left the main blob on 2026-08-07 (307 KB and a whole extra sheet read — the single
   most expensive key). It now arrives a beat later, which means there is a window where
   DATA.notes is genuinely EMPTY rather than genuinely known-to-be-empty.
   In that window `_daysSinceLastNote` would return null for every DSI, `_lastCallCell` would
   print "Never" on EVERY ROW, and the lastCalled filter would treat the whole table as
   never-called. That is confidently wrong, which is worse than blank — a rep would act on it.
   🔑 This flag is what lets those three places say "not yet" instead of "never". */
var _NOTES_LOADED = false;

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
    var first = !_NOTES_LOADED;
    _NOTES_LOADED = true;
    _applyNoteCounts();
    _refreshOpenNotesModal();
    /* The FIRST arrival changes what the table should say — every "last called" cell was
       showing the not-yet-known placeholder, and the lastCalled filter was standing down.
       Repaint once so those become real. Later polls only need the counts updated in place. */
    if (first && typeof renderTab === 'function' && typeof CURRENT_TAB !== 'undefined') {
      var skip = { postsale:1, postedsales:1, dailyreport:1, training:1 };
      if (!skip[CURRENT_TAB]) { TAB_CACHE = {}; renderTab(CURRENT_TAB); }
    }
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
// you're typing in untouched). The lists are NEWEST-FIRST, so incoming notes land at
// the TOP — each list stays pinned to the top if that's where you were, and holds its
// place if you had scrolled down to read older notes.
function _refreshOpenNotesModal() {
  var dm = document.getElementById('detail-modal');
  if (!dm || !dm.classList.contains('open') || !_modalDsi) return;
  var actHist = document.getElementById('nm-act-hist'), repHist = document.getElementById('nm-rep-hist');
  if (!actHist && !repHist) return;   // a different modal is reusing detail-modal
  var notes = (DATA.notes || {})[_modalDsi] || [];
  var actNotes = _notesNewestFirst(notes.filter(function(n) { return (n.noteType || 'activation') === 'activation'; }));
  var repNotes = _notesNewestFirst(notes.filter(function(n) { return n.noteType === 'rep' || n.noteType === 'note'; }));
  if (actHist) {
    var atTopA = actHist.scrollTop < 4;
    actHist.innerHTML = actNotes.length ? actNotes.map(_noteItemHtml).join('') : '<div class="nm-empty">No activation notes yet.</div>';
    if (atTopA) actHist.scrollTop = 0;
  }
  if (repHist) {
    var atTopR = repHist.scrollTop < 4;
    repHist.innerHTML = repNotes.length ? repNotes.map(_noteItemHtml).join('') : '<div class="nm-empty">No rep notes yet.</div>';
    if (atTopR) repHist.scrollTop = 0;
  }
  // A cancel request logged by someone else has to reach the open modal too — it's the
  // one note type where being 25s stale actually matters.
  var cancels = _notesNewestFirst(notes.filter(function(n) { return n.noteType === 'cancel'; }));
  var cxBlock = document.getElementById('nm-cx-block');
  if (cxBlock) cxBlock.outerHTML = notesCancelBlockHtml(cancels);
  else if (cancels.length) {
    var mb = document.getElementById('modal-body');
    if (mb) mb.insertAdjacentHTML('afterbegin', notesCancelBlockHtml(cancels));
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
/* ── FRESHNESS BUDGET ────────────────────────────────────────────────────────────────
   REQUIREMENT (user, 2026-08-04): nothing on screen may be more than 2 MINUTES behind.
   🔴 The background cycle used to refresh exactly THREE things — the main blob, notes and
   the Live Sales Tracker. Everything else (Appointments, Training, Posted Sales,
   activation-rate lines, Team orders) was fetched once at preload or first open and then
   ONLY cleared by a manual Refresh, an office switch, or a mutation the rep made
   themselves. A rep sitting on the Appointments tab was looking at data from whenever they
   logged in — hours, not minutes. That was the real violation, far bigger than any cache.
   These surfaces are now age-stamped and invalidated, so the next render refetches. */
/* Budget arithmetic: 15s tick granularity + 75s TTL + ~3s fetch ≈ 93s worst case, which
   leaves real headroom under the 2-minute rule. Don't raise this past ~95s without redoing
   that sum. */
var _SECONDARY_TTL = 75000;
/* Per-surface override. APPOINTMENTS is the one secondary surface where OTHER people's
   writes have to surface promptly — customer self-bookings and other reps' bookings land
   continuously, and a slot that is already taken reading as free is the single worst thing
   this tab can show. The rep's OWN book/cancel/reschedule already null the cache and repaint
   on the spot (app.appts.js), so this window never governed their own actions — only how
   long they wait to see everyone else's.
   30s ⇒ 15s tick + 30s TTL + ~3s fetch ≈ 48s worst case, well inside the 2-minute rule above.
   ⚠ Deliberately NOT global. The other four surfaces change slowly; giving them the same
   short window would refetch on a timer for data nobody is waiting on — the exact shape of
   the live slowdown recorded in _bgTick. Only the tab actually in view ever refetches. */
var _SECONDARY_TTL_BY = { appointments: 30000 };
function _secTtl(name) { return _SECONDARY_TTL_BY[name] || _SECONDARY_TTL; }
var _SEC_TS = {};

/* Which secondary surface each tab actually reads. A tab absent from this map reads only
   the main blob (call logs, master tracker, escalations…), which has its own 90s cycle —
   so an expiring secondary surface must NEVER repaint it.
   ⚠ Getting this wrong is expensive in both directions: too broad and every rep refetches
   on a timer for data their tab doesn't show (that was the live slowdown); too narrow and
   the visible tab silently drifts past the 2-minute budget. */
var _TAB_SURFACE = {
  appointments: 'appointments',
  myappts:      'appointments',
  training:     'training',
  postedsales:  'postedsales',
  actrates:     'arlines',
  churn:        'arlines',
  teams:        'teamorders',
  myteam:       'teamorders'
};
function _secStale(name) { return !!_SEC_TS[name] && (Date.now() - _SEC_TS[name]) >= _secTtl(name); }

/* Each entry: the cache to drop, and how to tell whether it currently holds anything.
   Dropping the cache is enough — every one of these renderers refetches when its cache is
   null, which is the same path a manual Refresh already uses and is therefore proven. */
function _invalidateStaleSecondary() {
  var dropped = [];
  /* SELF-STAMPING. These surfaces are populated in five different bundles, and threading a
     _secTouch() call into every one of them is five files of edits for a timestamp we can
     observe here instead. First tick that SEES data stamps it; the clock starts then. The
     only cost is up to one tick (15s) of imprecision, which the budget above accounts for.
     ⚠ Stamp-then-return, never stamp-and-drop — otherwise freshly loaded data would be
     thrown away on the very first tick that noticed it. */
  function drop(name, has, clear) {
    if (!has()) { delete _SEC_TS[name]; return; }   // gone already (mutation/office switch)
    if (!_SEC_TS[name]) { _SEC_TS[name] = Date.now(); return; }
    if (!_secStale(name)) return;
    clear(); delete _SEC_TS[name]; dropped.push(name);
  }
  try {
    drop('appointments',
      function(){ return typeof _APPT !== 'undefined' && _APPT && _APPT.appointments; },
      function(){ _APPT.appointments = null; });
    drop('training',
      function(){ return typeof _TRAINING_ORDERS !== 'undefined' && _TRAINING_ORDERS; },
      function(){ _TRAINING_ORDERS = null; });
    drop('postedsales',
      function(){ return typeof _PSV_SALES !== 'undefined' && _PSV_SALES; },
      function(){ _PSV_SALES = null; });
    drop('arlines',
      function(){ return typeof _AR_LINES !== 'undefined' && _AR_LINES; },
      function(){ _AR_LINES = null; if (typeof _AR_LOADING !== 'undefined') _AR_LOADING = false; });
    drop('teamorders',
      function(){ return typeof _TM_ORDERS !== 'undefined' && _TM_ORDERS && Object.keys(_TM_ORDERS).length; },
      function(){ _TM_ORDERS = {}; if (typeof _TM_ORD_LOADING !== 'undefined') _TM_ORD_LOADING = {}; });
  } catch (e) {}
  return dropped;
}

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

  /* Keep whatever the rep is LOOKING AT inside the freshness budget.
     🔴 THE FIRST VERSION OF THIS CAUSED A LIVE SLOWDOWN. It re-rendered the current tab
     whenever ANY of the five surfaces expired, so a rep on Call Logs got a full repaint —
     and the refetches that come with it — every 75s because the APPOINTMENTS cache had
     aged out. Call Logs does not use appointments. Five surfaces that previously fetched
     once each were suddenly refetching on a timer, for every rep, against an Apps Script
     backend that takes ~2s a call.
     Now: only the surface THIS tab actually reads can trigger a repaint. Everything else
     is still invalidated (free — no fetch) so it refetches when that tab is next opened,
     which is what the ≤2min budget actually requires. */
  var dropped = _invalidateStaleSecondary();
  if (!dropped.length) return;
  var need = _TAB_SURFACE[CURRENT_TAB];
  if (!need || dropped.indexOf(need) === -1) return;

  /* These manage their own form/scroll state — invalidating is enough, repainting is not
     safe. (Same exclusion list the main refresh uses.) */
  var skipRender = { postsale:1, postedsales:1, dailyreport:1, training:1 };
  if (skipRender[CURRENT_TAB]) return;

  /* ⚠ Don't yank the view out from under someone mid-interaction. _bgRefreshMain already
     bails when focus is in a field; the first version of this skipped that guard entirely
     and hard-repainted every 75s regardless. */
  var ae = document.activeElement, mc = document.getElementById('main-content');
  if (ae && mc && mc.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;

  TAB_CACHE = {}; renderTab(CURRENT_TAB);
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
/* _teamEmails(teamName) lived here and was removed 2026-08-11. Its ONLY caller was the LST's
   Team-Leader scoping (`isTeamScoped`), deleted when the board went office-wide for everyone.
   ⚠ Do not confuse it with _myTeam()/_myTeamId()/_teamTableauNames(), which are all still live
   in call-logs and this file. */

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
// The teamId of the user's "my team" — the team they LEAD, else the team they're
// ON. Powers the grouped "My Team's Orders" view (which rolls sub-teams in).
function _myTeamId() {
  var teams = DATA.teams || {}, myEmail = (SESSION.email || '').toLowerCase();
  var led = null;
  Object.keys(teams).forEach(function(tid){ if ((teams[tid].leaderId || '').toLowerCase() === myEmail) led = tid; });
  if (led) return led;
  var myName = ((DATA.roster || {})[SESSION.email] || {}).team || '';
  var found = null;
  Object.keys(teams).forEach(function(tid){ if (teams[tid].name === myName) found = tid; });
  return found;
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
// 'YYYY-MM-DD' for anything we can date with certainty, '' otherwise. No `new Date()`
// parsing anywhere — that would shift the day across timezones. readAOR returns raw
// sheet cells, so an orderDate can arrive as ISO, ISO-with-time, or US sheet text.
function _isoDay(v) {
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);            // ISO, with or without a time
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);          // M/D/YYYY
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return '';                                               // '—', '', or unparseable
}
function within29Days(orders) {
  var cutoff = _cutoff29();
  // Must be a REAL date, not just `>= cutoff`. A placeholder like '—' compares GREATER
  // than any digit string in JS (U+2014 is 8212, '2' is 50), so the bare comparison
  // silently admitted every undated row — which is exactly the aged-out ones.
  return orders.filter(function(o) {
    var d = _isoDay(o.orderDate);
    return !!d && d >= cutoff;
  });
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
    case 'myteam':      { var _mtid=_myTeamId();
                          c.innerHTML = (_mtid && _tmHasSubTeams(_mtid))
                            ? renderMyTeamGrouped(_mtid)                                          // parent leader → group by team
                            : renderCallTable(_myTeamFilter(DATA.masterTracker||[]), "My Team's Orders", 'No orders found.'); break; }
    case 'master':      c.innerHTML = renderCallTable(repFilter(DATA.masterTracker||[]), 'Master Tracker', 'No orders found.'); break;
    case 'actsupport':  renderActivationSupport(); break;
    case 'dayafter':    c.innerHTML = renderCallTable(repFilter(DATA.dayAfterOrders||[]), 'Day-After Calls', 'No day-after orders found.'); break;
    case 'delivered':   c.innerHTML = renderCallTable(repFilter(within29Days(DATA.deliveredOrders||[])), 'Delivered Not Active', 'No delivered-not-active orders found.'); break;
    case 'issues':      c.innerHTML = renderCallTable(repFilter(issueFilter(DATA.orderIssues||[])), 'Order Issues', 'No order issues found.'); break;
    case 'completed':   c.innerHTML = renderCallTable(repFilter(DATA.completedOrders||[]), 'Completed Order Log', 'No completed orders found.'); break;
    case 'noanswer':    c.innerHTML = renderNoAnswerTable(); break;
    case 'knowledge':   c.innerHTML = renderKnowledge(); break;
    case 'escalations': c.innerHTML = renderEscalationsTable(); break;
    case 'churn':       c.innerHTML = renderChurn();       break;
    /* Admin Portal — the Error Log reads LIVE rather than from DATA, so it paints a
       loading state and fills itself in. _adminStartTimer refreshes while the tab is
       open and stops the moment it is left or the window loses focus. */
    case 'adminerrors': c.innerHTML = renderAdminErrors(); _adminStartTimer(); break;
    case 'dailyreport': c.innerHTML = renderDailyReport(); break;
    case 'postsale':    c.innerHTML = renderPostSale();    break;
    case 'rehash':      c.innerHTML = renderRehashTab();   break;
    case 'acttext':     c.innerHTML = renderActivatorTextTab(); break;
    case 'firstbill':   c.innerHTML = renderFirstBillCalc(); break;
    case 'postedsales': renderPostedSalesTab();           break;
    case 'livesales':   renderLiveSalesTracker();          break;
    case 'teams':        renderTeamsTab();          break;
    case 'appointments': _APPT.weekOffset=0; _APPT.dayOffset=0; renderAppointmentsTab();  break;  // always open on the current week/day
    case 'fibercal':     _FIB.monthOffset=0; renderFiberCalendarTab();                    break;  // always open on the current month
    case 'myappts':      renderMyAppointments();     break;   // Item 4: activator cross-office dashboard
    case 'training':     renderTrainingTab();       break;
    default: c.innerHTML = noData('Coming soon.', { icon:'clock' });
  }
  bindFilters();
}

// ── HELPERS ───────────────────────────────────────────────────────────────
// Note timestamps carry the TIME as well as the date — the same customer often gets
// called more than once in a day, and "Jul 21" alone can't tell those calls apart.
// Rendered in the VIEWER's local timezone (n.ts is UTC ISO off the sheet), matching
// the Them/You clocks.
function fmtDateTime(v) {
  if (!v) return '—';
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v).split('T')[0];
  return d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
}

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;'); }

