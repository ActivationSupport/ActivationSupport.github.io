// ── LIVE SALES TRACKER ────────────────────────────────────────────────────
var _LST_SALES = null;
var _LST_POSTED = null;   // raw posted sales (pre-legacy-merge), so legacy can be re-merged once the bundle loads
var _LST_VIEW = 'days';
// Click-to-sort state, kept per view so switching DAYS<->WEEKS doesn't clobber
// the other view's choice. null = that view's default (its current period, by
// units, descending). col is a day/week column index, or 'name'.
var _LST_SORT = { days: null, weeks: null };
// The sort each table ACTUALLY rendered with, recorded at render time. While
// _LST_SORT is null the board is on its default column — this is what lets a
// click on that default column flip it, instead of re-applying the same sort.
var _LST_SORT_RESOLVED = { days: null, weeks: null };
var _LST_DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
var _LST_RNKL = {
  'master-admin':'Master Admin','owner':'Owner','admin':'Admin',
  'activator':'Activator','client-rep':'Client Rep','manager':'Manager',
  'jd':'JD','l1':'Team Leader','leader':'Team Leader'
};
// Office-leaderboard "Leaders" group = Team Leader, JD, Manager, Owner (low→high rank).
// All four always show on the board (none are in _LST_SKIP_UNLESS_SOLD).
// master-admin/admin/activator are excluded — they appear among reps only if they sell.
var _LST_LDR_RANKS = ['owner','manager','jd','leader'];

function renderLiveSalesTracker() {
  var c = document.getElementById('main-content');
  if (_LST_SALES !== null) { c.innerHTML = _lstBuild(); return; }
  c.innerHTML = skelLoader();
  api({ action:'readPostedSales', officeId:CFG.officeId }).then(function(res) {
    _LST_POSTED = res.sales || []; _LST_SALES = _LST_POSTED.concat(_lstLegacyRows());   // legacy re-merged in _applyMainData once DATA is ready
    c.innerHTML = _lstBuild();
  }).catch(function() {
    c.innerHTML = '<div class="empty">Failed to load sales data.</div>';
  });
}

function lstSetView(v) {
  _LST_VIEW = v;
  document.getElementById('main-content').innerHTML = _lstBuild();
}

function lstRefresh() {
  _LST_SALES = null;
  renderLiveSalesTracker();
}

// Click a column header to sort the board by it. Clicking the column that's
// already active flips the direction; clicking a new one starts at the sensible
// default for its type (numbers high->low, names A->Z). Clicking the ACTIVE
// column while it's already flipped clears back to the view's default sort.
function lstSortBy(view, col, metric) {
  var cur = _LST_SORT[view] || _LST_SORT_RESOLVED[view];
  var isNum = col !== 'name';
  var first = isNum ? 'desc' : 'asc';
  if (cur && String(cur.col) === String(col) && cur.metric === metric) {
    if (cur.dir !== first) { _LST_SORT[view] = null; }          // 3rd click -> default
    else { _LST_SORT[view] = { col: col, metric: metric, dir: first === 'desc' ? 'asc' : 'desc' }; }
  } else {
    _LST_SORT[view] = { col: col, metric: metric, dir: first };
  }
  document.getElementById('main-content').innerHTML = _lstBuild();
}

// Sortable <th>. `active` is the resolved sort for this view (never null), so
// the arrow also marks the DEFAULT column before anything has been clicked.
function _lstSortTh(view, col, metric, label, active, cls, style) {
  var on = String(active.col) === String(col) && active.metric === metric;
  var arrow = on ? '<span class="lst-sort-arw">' + (active.dir === 'asc' ? '↑' : '↓') + '</span>' : '';
  return '<th class="lst-sort-th' + (on ? ' lst-sort-active' : '') + (cls ? ' ' + cls : '') + '"' +
    (style ? ' style="' + style + '"' : '') +
    ' onclick="lstSortBy(\'' + view + '\',\'' + col + '\',\'' + metric + '\')"' +
    ' title="Sort by ' + label + '">' + label + arrow + '</th>';
}

// Shared comparator factory. `get(item, col, metric)` pulls the cell value.
function _lstCmp(active, get, fallback) {
  var f = active.dir === 'asc' ? -1 : 1;
  return function(a, b) {
    if (active.col === 'name') {
      var an = String((a.d && a.d.name) || '').toLowerCase();
      var bn = String((b.d && b.d.name) || '').toLowerCase();
      return (an < bn ? -1 : an > bn ? 1 : 0) * (active.dir === 'asc' ? 1 : -1);
    }
    var av = get(a, active.col, active.metric), bv = get(b, active.col, active.metric);
    if (bv !== av) return (bv - av) * f;
    // Same-cell tie: fall back to the other metric in that column, then to the
    // view's default ranking, so equal rows stay in a stable, meaningful order.
    var om = active.metric === 'units' ? 'orders' : 'units';
    var ao = get(a, active.col, om), bo = get(b, active.col, om);
    if (bo !== ao) return (bo - ao) * f;
    return fallback ? fallback(a, b) : 0;
  };
}

function _lstWeekStart() {
  var n = new Date(), dow = n.getDay(), dfm = dow === 0 ? 6 : dow - 1;
  var m = new Date(n); m.setDate(n.getDate() - dfm); m.setHours(0,0,0,0); return m;
}

function _lstTodayIdx() {
  var d = new Date().getDay(); return d === 0 ? 6 : d - 1;
}

function _lstUCls(n) {
  return n === 0 ? 'lst-u-red' : n <= 2 ? 'lst-u-orange' : n <= 5 ? 'lst-u-yellow' : 'lst-u-green';
}

// Hidden from the tracker unless they personally post a sale. The four leader
// ranks (owner/manager/jd/leader) are intentionally NOT here — they always show.
var _LST_SKIP_UNLESS_SOLD = ['master-admin','admin','activator'];

// Remap legacy (old-portal) rows onto the NEW roster. The old system uses different
// emails, so a rep's legacy sales would land on a duplicate "client-rep" row instead
// of their real roster row. Match by rep NAME (consistent across both systems) and use
// the roster's email; leave unmatched rows as-is (they show under their own name).
function _lstLegacyRows() {
  var rows = DATA.legacyLstSales || [];
  if (!rows.length) return rows;
  var roster = DATA.roster || {};
  var nameToEmail = {};
  Object.keys(roster).forEach(function(em) {
    var nm = String(roster[em].name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (nm && !nameToEmail[nm]) nameToEmail[nm] = em;
  });
  return rows.map(function(s) {
    var em = String(s.repEmail || '').trim().toLowerCase();
    if (roster[em]) return s;                         // old email already matches the roster
    var nm = String(s.repName || '').trim().toLowerCase().replace(/\s+/g, ' ');
    var match = nameToEmail[nm];
    if (!match) return s;                             // no name match -> leave as its own row
    return { repEmail: match, repName: s.repName, dateOfSale: s.dateOfSale, units: s.units, voided: false, _legacy: true };
  });
}

function _lstAgg(sales, roster) {
  var ws = _lstWeekStart(), DAY = 86400000, agg = {};
  Object.keys(roster || {}).forEach(function(e) {
    var r = roster[e];
    if (r.deactivated) return;
    if (_LST_SKIP_UNLESS_SOLD.indexOf(r.rank) !== -1) return;
    agg[e] = {
      name: r.name || e, team: r.team || '', rank: r.rank || 'client-rep',
      orders: 0, units: 0,
      days: [0,1,2,3,4,5,6].map(function() { return { orders: 0, units: 0 }; })
    };
  });
  (sales || []).forEach(function(s) {
    if (!s.dateOfSale) return;
    // Match the roster case-insensitively (roster keys are lowercased). If the
    // seller isn't found in the roster at all, STILL count the sale under the name
    // stored on the sale — a posted sale must never silently vanish from the board.
    var email = String(s.repEmail || '').trim().toLowerCase();
    if (!email) return;
    if (!agg[email]) {
      var r = roster[email];
      if (r && r.deactivated) return;   // deactivated roster rep -> excluded (unchanged)
      agg[email] = {
        name: (r && r.name) || s.repName || email,
        team: (r && r.team) || '',
        rank: (r && r.rank) || 'client-rep',
        orders: 0, units: 0,
        days: [0,1,2,3,4,5,6].map(function() { return { orders: 0, units: 0 }; })
      };
    }
    var sd = new Date(s.dateOfSale + 'T12:00:00'); sd.setHours(0,0,0,0);
    var diff = Math.floor((sd.getTime() - ws.getTime()) / DAY);
    if (isNaN(diff) || diff < 0 || diff > 6) return;   // NaN guard: a malformed sale date must never crash the board
    agg[email].orders++;
    agg[email].units += s.units || 0;
    agg[email].days[diff].orders++;
    agg[email].days[diff].units += s.units || 0;
  });
  return agg;
}

function _lstTeamAgg(repAgg, teams) {
  var tAgg = {};
  Object.keys(teams || {}).forEach(function(tid) {
    var t = teams[tid]; if (!t.name) return;
    tAgg[t.name] = { name: t.name, emoji: t.emoji || '', orders: 0, units: 0, members: 0 };
  });
  Object.keys(repAgg).forEach(function(e) {
    var r = repAgg[e]; if (!r.team) return;
    if (!tAgg[r.team]) tAgg[r.team] = { name: r.team, emoji: '', orders: 0, units: 0, members: 0 };
    tAgg[r.team].orders += r.orders;
    tAgg[r.team].units += r.units;
    tAgg[r.team].members++;
  });
  return tAgg;
}

// ── Per-rep relative-baseline flagging (Phase 2 #5) ───────────────────────
// Flags reps doing unusually well/poorly FOR THEM: this week-so-far vs the
// average of the same portion (Mon..today) of the prior 4 weeks — so the
// comparison is fair before the week is over. Floor guards keep tiny-volume /
// thin-history reps unflagged. Metric = units. 🔥 hot ≥140%, ❄️ cold ≤55%.
var _LST_BASE_CACHE = null;
var _LST_BASE_HOT = 1.40, _LST_BASE_COLD = 0.55, _LST_BASE_MIN_AVG = 3, _LST_BASE_MIN_WEEKS = 3;

function _lstBaselineMap() {
  var ws = _lstWeekStart(), DAY = 86400000, todayIdx = _lstTodayIdx();
  var monStart = []; for (var k = 0; k <= 4; k++) monStart[k] = ws.getTime() - k * 7 * DAY;
  var acc = {};   // email -> {full:[5], partial:[5]}  (idx 0=this week, 1..4=prior weeks)
  (_LST_SALES || []).forEach(function(s) {
    var em = String(s.repEmail || '').trim().toLowerCase();
    if (!s.dateOfSale || !em) return;
    var sd = new Date(s.dateOfSale + 'T12:00:00'); sd.setHours(0,0,0,0);
    var t = sd.getTime();
    for (var k = 0; k <= 4; k++) {
      if (t >= monStart[k] && t < monStart[k] + 7 * DAY) {
        if (!acc[em]) acc[em] = { full:[0,0,0,0,0], partial:[0,0,0,0,0] };
        var dayIdx = Math.floor((t - monStart[k]) / DAY);
        acc[em].full[k] += s.units || 0;
        if (dayIdx <= todayIdx) acc[em].partial[k] += s.units || 0;
        break;
      }
    }
  });
  var out = {};
  Object.keys(acc).forEach(function(e) {
    var a = acc[e];
    var priorFull = [a.full[1], a.full[2], a.full[3], a.full[4]];
    var weeksWithData = priorFull.filter(function(u){ return u > 0; }).length;
    var avgFull = (priorFull[0] + priorFull[1] + priorFull[2] + priorFull[3]) / 4;
    if (weeksWithData < _LST_BASE_MIN_WEEKS || avgFull < _LST_BASE_MIN_AVG) { out[e] = null; return; }
    var thisWk = a.partial[0];
    var avgPartial = (a.partial[1] + a.partial[2] + a.partial[3] + a.partial[4]) / 4;
    var state = null;
    if (avgPartial <= 0) {
      if (thisWk >= 2) state = 'hot';   // usually nothing sold by now, but they have sales → hot
    } else {
      var ratio = thisWk / avgPartial;
      if (ratio >= _LST_BASE_HOT) state = 'hot';
      else if (ratio <= _LST_BASE_COLD) state = 'cold';
    }
    out[e] = state ? { state:state, thisWk:thisWk, avg:avgFull } : null;
  });
  return out;
}

function _lstBaselineBadge(email) {
  var f = (_LST_BASE_CACHE || {})[email];
  if (!f) return '';
  var stateIco = f.state === 'hot' ? iconc('fire','#f97316',true) : iconc('snowflake','#38bdf8',true);
  var avg = f.avg.toFixed(1);
  var unit = f.thisWk === 1 ? 'unit' : 'units';
  var tip = f.state === 'hot'
    ? 'Hot streak — ' + f.thisWk + ' ' + unit + ' this week, ahead of their usual pace (4-wk avg ' + avg + '/wk)'
    : 'Cooling off — ' + f.thisWk + ' ' + unit + ' this week, behind their usual pace (4-wk avg ' + avg + '/wk)';
  return ' <span class="lst-base-flag lst-base-' + f.state + '" title="' + esc(tip) + '">' + stateIco + '</span>';
}

function _lstBuild() {
  var roster = DATA.roster || {}, teams = DATA.teams || {};
  _LST_BASE_CACHE = _lstBaselineMap();   // per-rep relative-baseline flags (Phase 2 #5)
  var repAgg = _lstAgg(_LST_SALES, roster);
  var tAgg = _lstTeamAgg(repAgg, teams);
  var todayIdx = _lstTodayIdx();

  var role = SESSION.role;
  var isTeamScoped = role === 'leader';   // jd is office-wide (manager-equivalent)
  var lstTeamName = '';
  var kpiTeamSet = null;
  if (isTeamScoped) {
    var lstTeam = _myTeam();
    if (lstTeam) {
      lstTeamName = lstTeam.name;
      var teamEmailSet = {};
      _teamEmails(lstTeamName).forEach(function(e) { teamEmailSet[e] = true; });
      kpiTeamSet = teamEmailSet;
      var filteredRepAgg = {};
      Object.keys(repAgg).forEach(function(e) {
        if (teamEmailSet[e]) filteredRepAgg[e] = repAgg[e];
      });
      repAgg = filteredRepAgg;
      var filteredTAgg = {};
      if (tAgg[lstTeamName]) filteredTAgg[lstTeamName] = tAgg[lstTeamName];
      tAgg = filteredTAgg;
    }
  }

  var all = Object.keys(repAgg).map(function(e) { return { email: e, d: repAgg[e] }; })
    .sort(function(a, b) { return b.d.units - a.d.units || b.d.orders - a.d.orders; });
  var leaders = all.filter(function(x) { return _LST_LDR_RANKS.indexOf(x.d.rank) !== -1; });
  var reps    = all.filter(function(x) { return _LST_LDR_RANKS.indexOf(x.d.rank) === -1; });
  var tArr = Object.keys(tAgg).map(function(k) { return tAgg[k]; })
    .sort(function(a, b) { return b.units - a.units || b.orders - a.orders; });

  var totOrd = all.reduce(function(s, x) { return s + x.d.orders; }, 0);
  var totUni = all.reduce(function(s, x) { return s + x.d.units; }, 0);

  var boardTitle = (isTeamScoped && lstTeamName) ? lstTeamName.toUpperCase() + ' LEADERBOARD' : 'OFFICE LEADERBOARD';

  return '<div class="lst-wrap">' +
    '<div class="lst-wb-bar"><button class="lst-wb-btn" onclick="openWallboard()">'+icon('monitor')+' Wallboard</button></div>' +
    _lstKpiCards(_LST_SALES, roster, _LST_VIEW, kpiTeamSet) +
    _lstTopPerf(all.slice(0, 3), tArr.slice(0, 3)) +
    _lstBoard(leaders, reps, tArr, todayIdx, boardTitle) +
    '</div>';
}

// ── WALLBOARD / TV MODE ───────────────────────────────────────
// Full-screen, big-type, auto-cycling office display for a TV. Reuses the LST
// data (_LST_SALES), office-wide. Panels: This Week (KPIs) → Top Performers → Teams.
var _WB = { panel:0, timer:null, clock:null, n:3 };

function _wbData() {
  var roster=DATA.roster||{}, teams=DATA.teams||{};
  var repAgg=_lstAgg(_LST_SALES||[], roster);
  var tAgg=_lstTeamAgg(repAgg, teams);
  var all=Object.keys(repAgg).map(function(e){return {email:e,d:repAgg[e]};})
    .sort(function(a,b){return b.d.units-a.d.units||b.d.orders-a.d.orders;});
  var tArr=Object.keys(tAgg).map(function(k){return tAgg[k];})
    .sort(function(a,b){return b.units-a.units||b.orders-a.orders;});
  var totOrd=all.reduce(function(s,x){return s+x.d.orders;},0);
  var totUni=all.reduce(function(s,x){return s+x.d.units;},0);
  var sellers=all.filter(function(x){return x.d.orders>0;}).length;
  return {all:all,tArr:tArr,totOrd:totOrd,totUni:totUni,sellers:sellers};
}

function openWallboard() {
  var wb=document.getElementById('wallboard'); if(!wb) return;
  document.getElementById('wb-office').textContent=(CFG.officeId||'').toUpperCase();
  _WB.panel=0;
  wb.classList.remove('wb-hidden');
  _wbRender();
  _wbStartTimer();
  _wbTickClock(); _WB.clock=setInterval(_wbTickClock,1000);
  document.addEventListener('keydown', _wbKey);
  if(wb.requestFullscreen){ try{ wb.requestFullscreen(); }catch(e){} }
}
function closeWallboard() {
  var wb=document.getElementById('wallboard'); if(!wb) return;
  wb.classList.add('wb-hidden');
  if(_WB.timer){clearInterval(_WB.timer);_WB.timer=null;}
  if(_WB.clock){clearInterval(_WB.clock);_WB.clock=null;}
  document.removeEventListener('keydown', _wbKey);
  if(document.fullscreenElement){ try{ document.exitFullscreen(); }catch(e){} }
}
function _wbKey(e){ if(e.key==='Escape') closeWallboard(); else if(e.key==='ArrowRight') _wbGo(_WB.panel+1); else if(e.key==='ArrowLeft') _wbGo(_WB.panel-1); }
function _wbStartTimer(){ if(_WB.timer)clearInterval(_WB.timer); _WB.timer=setInterval(function(){ _wbGo(_WB.panel+1); },12000); }
function _wbGo(i){ _WB.panel=((i%_WB.n)+_WB.n)%_WB.n; _wbRender(); _wbStartTimer(); }
function _wbTickClock(){ var el=document.getElementById('wb-clock'); if(!el)return; var d=new Date(),h=d.getHours(),m=d.getMinutes(); el.textContent=((h%12)||12)+':'+String(m).padStart(2,'0')+' '+(h>=12?'PM':'AM'); }

function _wbHead(label){
  return '<div class="wb-row wb-head"><div class="wb-rank">#</div>'+
    '<div class="wb-name">'+label+'</div>'+
    '<div class="wb-ord">Orders</div>'+
    '<div class="wb-units">Units</div></div>';
}
function _wbRow(rank,name,orders,units){
  var medal = rank<3?medalSvg(rank):(rank+1);
  return '<div class="wb-row"><div class="wb-rank">'+medal+'</div>'+
    '<div class="wb-name">'+name+'</div>'+
    '<div class="wb-ord">'+orders+'</div>'+
    '<div class="wb-units">'+units+'</div></div>';
}
function _wbKpi(label,val,color){
  return '<div class="wb-kpi"><div class="wb-kpi-val" style="color:'+color+'">'+val+'</div><div class="wb-kpi-lbl">'+label+'</div></div>';
}
function _wbRender(){
  var data=_wbData();
  var titles=['This Week','Top Performers','Team Standings'];
  var tEl=document.getElementById('wb-title'); if(tEl) tEl.textContent=titles[_WB.panel]||'Live Sales';
  var stage=document.getElementById('wb-stage'); if(!stage) return;
  var html='';
  if(_WB.panel===0){
    var upo=data.totOrd?(data.totUni/data.totOrd):0;
    html='<div class="wb-kpis">'+
      _wbKpi('Orders', data.totOrd, '#5B9BD5')+
      _wbKpi('Units', data.totUni, '#70AD47')+
      _wbKpi('Units / Order', upo.toFixed(2), '#ED7D31')+
      _wbKpi('Active Sellers', data.sellers, '#FFC000')+
    '</div>';
  } else if(_WB.panel===1){
    var top=data.all.slice(0,5);
    html='<div class="wb-list">'+(top.length?_wbHead('Rep')+top.map(function(x,i){return _wbRow(i,esc(x.d.name),x.d.orders,x.d.units);}).join(''):'<div class="wb-empty">No sales yet this week.</div>')+'</div>';
  } else {
    var tt=data.tArr.slice(0,8);
    html='<div class="wb-list">'+(tt.length?_wbHead('Team')+tt.map(function(t,i){return _wbRow(i,(t.emoji?esc(t.emoji)+' ':'')+esc(t.name),t.orders,t.units);}).join(''):'<div class="wb-empty">No team sales yet this week.</div>')+'</div>';
  }
  stage.innerHTML=html;
  var dots=document.getElementById('wb-dots');
  if(dots) dots.innerHTML=[0,1,2].map(function(i){return '<span class="wb-dot'+(i===_WB.panel?' wb-dot-on':'')+'" onclick="_wbGo('+i+')"></span>';}).join('');
}

// ── KPI SUMMARY CARDS (client-side over _LST_SALES; respects role scoping) ──
function _lstKpiDateKey(d){ return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function _lstKpiDayLabel(d){ return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]+' '+(d.getMonth()+1)+'/'+d.getDate(); }

function _lstKpiAddSale(b, email, roster, s){
  b.orders++;
  b.units += s.units || 0;
  if (!b.reps[email]) b.reps[email] = { name: (roster[email] && roster[email].name) || email, orders:0, units:0 };
  b.reps[email].orders++;
  b.reps[email].units += s.units || 0;
}

// Build period buckets oldest→newest. days: last 14 calendar days; weeks: last 8 Mon-start weeks.
function _lstKpiBuckets(sales, roster, view, teamSet) {
  var DAY = 86400000;
  var now = new Date(); now.setHours(0,0,0,0);
  var buckets = [], index = {};
  function mk(key, label){ var b={key:key,label:label,orders:0,units:0,reps:{}}; buckets.push(b); index[key]=b; return b; }

  function eligible(email){
    if (!roster[email] || roster[email].deactivated) return false;
    if (teamSet && !teamSet[email]) return false;
    return true;
  }

  if (view === 'weeks') {
    var dow = now.getDay(), dfm = dow === 0 ? 6 : dow - 1;
    var curMon = new Date(now); curMon.setDate(now.getDate() - dfm); curMon.setHours(0,0,0,0);
    for (var i = 7; i >= 0; i--) {
      var ms = new Date(curMon.getTime() - i * 7 * DAY);
      mk(_lstKpiDateKey(ms), (ms.getMonth()+1)+'/'+ms.getDate());
    }
    (sales || []).forEach(function(s){
      if (!s.dateOfSale || !eligible(s.repEmail)) return;
      var sd = new Date(s.dateOfSale + 'T12:00:00'); sd.setHours(0,0,0,0);
      var wdow = sd.getDay(), wdfm = wdow === 0 ? 6 : wdow - 1;
      var sMon = new Date(sd); sMon.setDate(sd.getDate() - wdfm); sMon.setHours(0,0,0,0);
      var b = index[_lstKpiDateKey(sMon)];
      if (b) _lstKpiAddSale(b, s.repEmail, roster, s);
    });
  } else {
    for (var j = 13; j >= 0; j--) {
      var dms = new Date(now.getTime() - j * DAY);
      mk(_lstKpiDateKey(dms), _lstKpiDayLabel(dms));
    }
    (sales || []).forEach(function(s){
      if (!s.dateOfSale || !eligible(s.repEmail)) return;
      var sd2 = new Date(s.dateOfSale + 'T12:00:00'); sd2.setHours(0,0,0,0);
      var b2 = index[_lstKpiDateKey(sd2)];
      if (b2) _lstKpiAddSale(b2, s.repEmail, roster, s);
    });
  }
  return buckets;
}

function _lstDelta(cur, prev, word, decimals) {
  var d = cur - prev;
  var cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  var arrow = d > 0 ? icon('chev-up') : d < 0 ? icon('chev-down') : '—';
  var mag = decimals ? Math.abs(d).toFixed(decimals) : Math.abs(d);
  var sign = d > 0 ? '+' : d < 0 ? '−' : '';
  var pct = '';
  if (prev > 0) pct = ' ('+sign+Math.round(Math.abs(d)/prev*100)+'%)';
  var txt = d === 0 ? 'no change' : sign+mag+pct;
  return '<div class="lst-kpi-delta '+cls+'"><span class="lst-kpi-arrow">'+arrow+'</span>'+txt+
    ' <span class="lst-kpi-vs">vs prior '+word+'</span></div>';
}

function _lstSpark(series, color) {
  if (!series || !series.length) return '';
  var w = 120, h = 34, pad = 2, n = series.length;
  var max = Math.max.apply(null, series), min = Math.min.apply(null, series);
  var range = max - min || 1;
  var stepX = n > 1 ? (w - pad*2)/(n-1) : 0;
  var pts = series.map(function(v, i){
    var x = pad + i*stepX;
    var y = pad + (h - pad*2) * (1 - (v - min)/range);
    return x.toFixed(1)+','+y.toFixed(1);
  });
  var line = pts.join(' ');
  var lastX = (pad+(n-1)*stepX).toFixed(1);
  var lastY = (pad + (h-pad*2)*(1-(series[n-1]-min)/range)).toFixed(1);
  var area = pad+','+(h-pad)+' '+line+' '+lastX+','+(h-pad);
  return '<svg class="lst-spark" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+
    '<polygon points="'+area+'" fill="'+color+'" opacity="0.10"/>'+
    '<polyline points="'+line+'" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'+
    '<circle cx="'+lastX+'" cy="'+lastY+'" r="2.2" fill="'+color+'"/>'+
    '</svg>';
}

function _lstKpiCard(label, value, deltaHtml, sparkHtml, color, metric) {
  var attrs = metric
    ? ' lst-kpi-clickable" onclick="_lstKpiDrill(\''+metric+'\')" title="Click to see the orders behind this number"'
    : '"';
  return '<div class="lst-kpi-card'+attrs+' style="--kpi-accent:'+color+'">'+
    '<div class="lst-kpi-lbl">'+esc(label)+(metric?'<span class="lst-kpi-drill-hint">⤢</span>':'')+'</div>'+
    '<div class="lst-kpi-val">'+value+'</div>'+
    deltaHtml+
    '<div class="lst-kpi-spark-wrap">'+sparkHtml+'</div>'+
    '</div>';
}

function _lstKpiTopCard(top, view) {
  var body = top
    ? '<div class="lst-kpi-top-name">'+medalSvg(0)+' '+esc(top.name)+'</div>'+
      '<div class="lst-kpi-top-stats">'+top.units+' units · '+top.orders+' orders</div>'
    : '<div class="lst-kpi-top-name lst-kpi-top-empty">No sales yet</div>';
  return '<div class="lst-kpi-card lst-kpi-card-top" style="--kpi-accent:#FFC000">'+
    '<div class="lst-kpi-lbl">Top Performer</div>'+body+
    '<div class="lst-kpi-top-period">'+(view==='weeks'?'this week':'today')+'</div>'+
    '</div>';
}

// ── KPI card drill-down (Phase 2 #4) ──────────────────────────────────────
// Click a summary card → the posted sales that compose the current-period
// number, in a modal. Uses the SAME eligibility + period window as
// _lstKpiBuckets so the list always matches the card value. Scope is whatever
// produced the cards (office-wide, or team for leader/jd) — never wider.
var _LST_KPI_CTX = null;

function _lstSaleProducts(s) {
  var p = [];
  if (s.airQty > 0)     p.push('Air'+(s.airQty>1?' \xd7'+s.airQty:''));
  var w = (s.wirelessNew||0) + (s.wirelessByod||0);
  if (w > 0)            p.push('Wireless'+(w>1?' \xd7'+w:''));
  if (s.fiberPackage)   p.push('Fiber');
  if (s.voipQty > 0)    p.push('VoIP'+(s.voipQty>1?' \xd7'+s.voipQty:''));
  if (s.dtvQty > 0)     p.push('DTV');
  return p.length ? p.map(function(x){ return '<span class="prod-pill">'+esc(x)+'</span>'; }).join('')
                  : '<span class="sp sp-default">—</span>';
}

// Sales in the CURRENT period bucket (today for days view, this week for weeks),
// scoped to the same roster/team set used to render the cards.
function _lstKpiCurrentSales() {
  var ctx = _LST_KPI_CTX || { view:_LST_VIEW, teamSet:null };
  var roster = DATA.roster || {}, view = ctx.view, teamSet = ctx.teamSet, DAY = 86400000;
  var now = new Date(); now.setHours(0,0,0,0);
  function eligible(email){
    if (!roster[email] || roster[email].deactivated) return false;
    if (teamSet && !teamSet[email]) return false;
    return true;
  }
  var lo, hi;
  if (view === 'weeks') {
    var dow = now.getDay(), dfm = dow === 0 ? 6 : dow - 1;
    lo = new Date(now); lo.setDate(now.getDate()-dfm); lo.setHours(0,0,0,0);
    hi = new Date(lo.getTime() + 7*DAY);
  } else {
    lo = now; hi = new Date(now.getTime() + DAY);
  }
  return (_LST_SALES || []).filter(function(s){
    if (!s.dateOfSale || !eligible(s.repEmail)) return false;
    var sd = new Date(s.dateOfSale + 'T12:00:00'); sd.setHours(0,0,0,0);
    return sd >= lo && sd < hi;
  });
}

function _lstKpiSalesTable(sales) {
  if (!sales.length) return '<div class="empty">No sales in this period.</div>';
  var roster = DATA.roster || {};
  var rows = sales.slice().sort(function(a,b){
    return (b.dateOfSale||'').localeCompare(a.dateOfSale||'') || (b.units||0)-(a.units||0);
  });
  var totUnits = rows.reduce(function(s,x){ return s + (x.units||0); }, 0);
  var head = '<div class="lst-drill-sum">'+rows.length+' order'+(rows.length!==1?'s':'')+' &middot; '+totUnits+' unit'+(totUnits!==1?'s':'')+'</div>';
  var trs = rows.map(function(s){
    var nm = (roster[s.repEmail] && roster[s.repEmail].name) || s.repName || s.repEmail || '—';
    return '<tr><td>'+esc(nm)+'</td>'+
      '<td style="white-space:nowrap">'+esc(_ctShortDate(s.dateOfSale))+'</td>'+
      '<td>'+(s.dsi?'<span class="dsi-link" onclick="clickDsi(\''+esc(s.dsi)+'\')">'+esc(s.dsi)+'</span>':'—')+'</td>'+
      '<td>'+_lstSaleProducts(s)+'</td>'+
      '<td style="text-align:center;font-weight:700">'+(s.units||0)+'</td></tr>';
  }).join('');
  return head + '<div class="lst-drill-wrap"><table class="call-table lst-drill-tbl"><thead><tr>'+
    '<th>Rep</th><th>Date</th><th>DSI</th><th>Products</th><th style="text-align:center">Units</th>'+
    '</tr></thead><tbody>'+trs+'</tbody></table></div>';
}

function _lstKpiSellersTable(sales) {
  if (!sales.length) return '<div class="empty">No sellers in this period.</div>';
  var roster = DATA.roster || {}, agg = {};
  sales.forEach(function(s){
    var e = s.repEmail;
    if (!agg[e]) agg[e] = { name:(roster[e]&&roster[e].name)||s.repName||e, orders:0, units:0 };
    agg[e].orders++; agg[e].units += s.units||0;
  });
  var list = Object.keys(agg).map(function(e){ return agg[e]; })
    .sort(function(a,b){ return b.units-a.units || b.orders-a.orders; });
  var head = '<div class="lst-drill-sum">'+list.length+' active seller'+(list.length!==1?'s':'')+'</div>';
  var trs = list.map(function(r,i){
    return '<tr><td style="color:var(--text2)">'+(i+1)+'</td><td>'+esc(r.name)+'</td>'+
      '<td style="text-align:center">'+r.orders+'</td>'+
      '<td style="text-align:center;font-weight:700">'+r.units+'</td></tr>';
  }).join('');
  return head + '<div class="lst-drill-wrap"><table class="call-table lst-drill-tbl"><thead><tr>'+
    '<th style="width:32px">#</th><th>Rep</th><th style="text-align:center">Orders</th><th style="text-align:center">Units</th>'+
    '</tr></thead><tbody>'+trs+'</tbody></table></div>';
}

function _lstKpiDrill(metric) {
  if (!_LST_KPI_CTX || !_LST_KPI_CTX.drillable) return;
  var sales = _lstKpiCurrentSales();
  var period = (_LST_KPI_CTX.view === 'weeks') ? 'this week' : 'today';
  var title, body;
  if (metric === 'sellers') {
    title = 'Active Sellers · ' + period;
    body = _lstKpiSellersTable(sales);
  } else {
    var lbl = { orders:'Orders', units:'Units', upo:'Units / Order' }[metric] || 'Sales';
    title = lbl + ' · ' + period;
    body = _lstKpiSalesTable(sales);
  }
  document.getElementById('modal-title').innerHTML = esc(title);
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('detail-modal').classList.add('open');
}

function _lstKpiCards(sales, roster, view, teamSet) {
  var buckets = _lstKpiBuckets(sales, roster, view, teamSet);
  var n = buckets.length;
  var cur  = buckets[n-1] || {orders:0,units:0,reps:{}};
  var prev = buckets[n-2] || {orders:0,units:0,reps:{}};

  var ordSeries  = buckets.map(function(b){return b.orders;});
  var uniSeries  = buckets.map(function(b){return b.units;});
  var sellSeries = buckets.map(function(b){return Object.keys(b.reps).length;});
  var upoSeries  = buckets.map(function(b){return b.orders ? b.units/b.orders : 0;});

  var curSellers  = Object.keys(cur.reps).length;
  var prevSellers = Object.keys(prev.reps).length;
  var curUpo  = cur.orders  ? cur.units/cur.orders   : 0;
  var prevUpo = prev.orders ? prev.units/prev.orders : 0;

  var top = null;
  Object.keys(cur.reps).forEach(function(e){
    var r = cur.reps[e];
    if (!top || r.units > top.units || (r.units === top.units && r.orders > top.orders))
      top = { name:r.name, units:r.units, orders:r.orders };
  });

  var word = view === 'weeks' ? 'wk' : 'day';
  var EX = { blue:'#5B9BD5', green:'#70AD47', orange:'#ED7D31', gold:'#FFC000' };

  // Drill context for _lstKpiDrill (Phase 2 #4). Drill is gated to roles whose
  // KPI-card scope == their row visibility: client-rep sees office-wide cards
  // but is row-scoped to own orders, so it is NOT drillable for them. leader/jd
  // drill stays team-scoped via teamSet (matches their call-tab scope).
  var drillable = (SESSION.role||'') !== 'client-rep';
  _LST_KPI_CTX = { view: view, teamSet: teamSet || null, drillable: drillable };
  function M(m){ return drillable ? m : null; }

  var cards =
    _lstKpiCard('Orders',        cur.orders, _lstDelta(cur.orders, prev.orders, word),       _lstSpark(ordSeries,  EX.blue),   EX.blue,   M('orders')) +
    _lstKpiCard('Units',         cur.units,  _lstDelta(cur.units,  prev.units,  word),       _lstSpark(uniSeries,  EX.green),  EX.green,  M('units')) +
    _lstKpiCard('Units / Order', (cur.orders ? curUpo.toFixed(1) : '—'), _lstDelta(curUpo, prevUpo, word, 1), _lstSpark(upoSeries, EX.orange), EX.orange, M('upo')) +
    _lstKpiCard('Active Sellers',curSellers, _lstDelta(curSellers, prevSellers, word),       _lstSpark(sellSeries, EX.gold),   EX.gold,   M('sellers')) +
    _lstKpiTopCard(top, view);

  var hint = view === 'weeks' ? 'This week vs last week · 8-week trend' : 'Today vs yesterday · 14-day trend';
  return '<div class="lst-kpi-head"><div class="lst-sec-lbl">SUMMARY</div><div class="lst-kpi-hint">'+hint+'</div></div>'+
    '<div class="lst-kpi-row">'+cards+'</div>';
}

function _lstTopPerf(topAll, topTeams) {
  var medals = [medalSvg(0),medalSvg(1),medalSvg(2)], podCls = ['gold','silver','bronze'];
  var order = [1, 0, 2]; // render 2nd | 1st | 3rd

  function indCard(i) {
    var item = topAll[i];
    if (!item) return '<div class="lst-pod ' + podCls[i] + '"></div>';
    var d = item.d;
    return '<div class="lst-pod ' + podCls[i] + '">' +
      '<div class="lst-pod-medal">' + medals[i] + '</div>' +
      '<div class="lst-pod-name lst-rep-link" onclick="_lstShowRepProfile(\'' + item.email + '\')">' + esc(d.name) + '</div>' +
      '<div class="lst-pod-role">' + esc(_LST_RNKL[d.rank] || d.rank) + '</div>' +
      '<div class="lst-pod-stats">' +
        '<div class="lst-pod-stat"><div class="lst-pod-num">' + d.units + '</div><div class="lst-pod-lbl">UNITS</div></div>' +
        '<div class="lst-pod-stat"><div class="lst-pod-num sm">' + d.orders + '</div><div class="lst-pod-lbl">ORDERS</div></div>' +
      '</div></div>';
  }

  function teamCard(i) {
    var t = topTeams[i];
    if (!t) return '<div class="lst-pod ' + podCls[i] + '"></div>';
    return '<div class="lst-pod ' + podCls[i] + '">' +
      '<div class="lst-pod-medal">' + medals[i] + '</div>' +
      '<div class="lst-pod-name">' + esc(t.name) + '</div>' +
      (t.emoji ? '<div class="lst-pod-emoji">' + esc(t.emoji) + '</div>' : '') +
      '<div class="lst-pod-stats">' +
        '<div class="lst-pod-stat"><div class="lst-pod-num">' + t.units + '</div><div class="lst-pod-lbl">UNITS THIS WK</div></div>' +
        '<div class="lst-pod-stat"><div class="lst-pod-num sm">' + t.orders + '</div><div class="lst-pod-lbl">ORDERS</div></div>' +
      '</div></div>';
  }

  var h = '<div style="margin-bottom:32px">';
  h += '<div class="lst-top-hdr"><div class="lst-sec-lbl">TOP PERFORMERS</div><div class="lst-wk-tag">This week</div></div>';
  if (topAll.length > 0) {
    h += '<div class="lst-sub-lbl">INDIVIDUALS</div>';
    h += '<div class="lst-podium">' + indCard(order[0]) + indCard(order[1]) + indCard(order[2]) + '</div>';
  }
  if (topTeams.length > 0) {
    h += '<div class="lst-sub-lbl">TEAMS</div>';
    h += '<div class="lst-podium">' + teamCard(order[0]) + teamCard(order[1]) + teamCard(order[2]) + '</div>';
  }
  return h + '</div>';
}

function _lstBoard(leaders, reps, tArr, todayIdx, boardTitle) {
  var h = '<div>';
  h += '<div class="lst-board-hdr">';
  h += '<div><div class="lst-board-title">' + esc(boardTitle || 'OFFICE LEADERBOARD') +
    '<span class="lst-refresh-btn" onclick="lstRefresh()" title="Refresh">'+icon('refresh')+'</span></div>' +
    '<div class="lst-board-cnt">' + leaders.length + ' leaders &middot; ' + reps.length + ' reps</div></div>';
  h += '<div class="lst-view-toggle">' +
    '<div class="lst-view-btn' + (_LST_VIEW === 'days' ? ' active' : '') + '" onclick="lstSetView(\'days\')">DAYS</div>' +
    '<div class="lst-view-btn' + (_LST_VIEW === 'weeks' ? ' active' : '') + '" onclick="lstSetView(\'weeks\')">WEEKS</div>' +
    '</div>';
  h += '</div>';
  h += '<div class="lst-tbl-wrap"><table class="lst-tbl">';
  h += _LST_VIEW === 'days' ? _lstDaysTbl(leaders, reps, todayIdx) : _lstWeeksTbl(leaders, reps);
  h += '</table></div>';

  if (tArr.length > 0) {
    h += '<div class="lst-team-rankings">';
    h += '<div class="lst-sec-lbl">TEAM RANKINGS</div>';
    h += '<div class="lst-team-grid">';
    tArr.forEach(function(t, i) {
      h += '<div class="lst-team-card' + (i === 0 ? ' first' : '') + '">' +
        '<div class="lst-team-rnk">#' + (i + 1) + '</div>' +
        (t.emoji ? '<div class="lst-team-emo">' + esc(t.emoji) + '</div>' : '') +
        '<div class="lst-team-nm">' + esc(t.name) + '</div>' +
        '<div><span class="lst-team-u">' + t.units + '</span><span class="lst-team-o">' + t.orders + ' orders</span></div>' +
        '<div class="lst-team-sub">UNITS THIS WEEK &bull; ' + t.members + ' MEMBERS</div>' +
        '</div>';
    });
    h += '</div></div>';
  }
  return h + '</div>';
}

function _lstDaysTbl(leaders, reps, todayIdx) {
  // The DAYS view defaults to ranking by TODAY's production (not the week-to-date
  // total the board is built with), so #1 is whoever sold the most today. Any
  // day column can be clicked to sort by it instead. Sorted per-group so the
  // LEADERS / CLIENT REPS split is preserved.
  var active = _LST_SORT.days || { col: todayIdx, metric: 'units', dir: 'desc' };
  _LST_SORT_RESOLVED.days = active;
  var cmp = _lstCmp(active,
    function(x, col, metric) { return x.d.days[col][metric]; },
    function(a, b) { return b.d.units - a.d.units || b.d.orders - a.d.orders; });
  leaders = leaders.slice().sort(cmp);
  reps    = reps.slice().sort(cmp);

  var medals = [medalSvg(0),medalSvg(1),medalSvg(2)];
  var h = '<thead><tr>';
  h += '<th style="width:36px">#</th>';
  h += _lstSortTh('days', 'name', 'name', 'NAME', active, 'll', 'min-width:160px');
  _LST_DAYS.forEach(function(d) { h += '<th colspan="2">' + d + '</th>'; });
  h += '</tr><tr><th></th><th></th>';
  _LST_DAYS.forEach(function(_, i) {
    // Future days are all zeros (they render as "—"), so they aren't sortable.
    if (i > todayIdx) { h += '<th></th><th></th>'; return; }
    h += _lstSortTh('days', i, 'orders', 'ORD', active);
    h += _lstSortTh('days', i, 'units',  'UNITS', active);
  });
  h += '</tr></thead><tbody>';

  function row(item, rank) {
    var d = item.d;
    var r = '<tr><td style="color:var(--text2)">' + (rank <= 3 ? medals[rank - 1] : rank) + '</td>';
    r += '<td class="ll"><div class="lst-rep-name lst-rep-link" onclick="_lstShowRepProfile(\'' + item.email + '\')">' + esc(d.name) + _lstBaselineBadge(item.email) + '</div>' +
      '<div class="lst-rep-role">' + esc(_LST_RNKL[d.rank] || d.rank) + '</div></td>';
    for (var i = 0; i < 7; i++) {
      if (i > todayIdx) {
        r += '<td class="lst-dash">—</td><td class="lst-dash">—</td>';
      } else {
        r += '<td style="color:var(--text2)">' + d.days[i].orders + '</td>';
        r += '<td class="' + _lstUCls(d.days[i].units) + '">' + d.days[i].units + '</td>';
      }
    }
    return r + '</tr>';
  }

  function dayTotals(items) {
    return [0,1,2,3,4,5,6].map(function(i) {
      return {
        orders: items.reduce(function(s, x) { return s + x.d.days[i].orders; }, 0),
        units:  items.reduce(function(s, x) { return s + x.d.days[i].units;  }, 0)
      };
    });
  }

  function totalRow(label, items, extraCls) {
    var dt = dayTotals(items);
    var r = '<tr class="lst-total-row' + (extraCls ? ' ' + extraCls : '') + '">';
    r += '<td></td><td class="ll">' + label + '</td>';
    for (var i = 0; i < 7; i++) {
      if (i > todayIdx) { r += '<td class="lst-dash">—</td><td class="lst-dash">—</td>'; }
      else { r += '<td>' + dt[i].orders + '</td><td class="' + _lstUCls(dt[i].units) + '">' + dt[i].units + '</td>'; }
    }
    return r + '</tr>';
  }

  h += '<tr class="lst-section-sep"><td colspan="' + (2 + 14) + '">LEADERS</td></tr>';
  leaders.forEach(function(item, i) { h += row(item, i + 1); });
  h += totalRow(icon('crown')+' LEADER TOTAL', leaders);

  h += '<tr class="lst-section-sep"><td colspan="' + (2 + 14) + '">CLIENT REPS</td></tr>';
  reps.forEach(function(item, i) { h += row(item, i + 1); });
  h += totalRow(icon('zap')+' REP TOTAL', reps);
  h += totalRow('OFFICE TOTAL', leaders.concat(reps), 'lst-grand-row');

  return h + '</tbody>';
}

function _lstWeeksTbl(leaders, reps) {
  var ws = _lstWeekStart(), DAY = 86400000;
  // Oldest → newest left-to-right (current week rightmost), matching the Days view's chronological order.
  var weeks = [4,3,2,1,0].map(function(i) {
    var s = new Date(ws.getTime() - i * 7 * DAY);
    var m = s.getMonth() + 1, d = s.getDate();
    return { start: s, end: new Date(s.getTime() + 7 * DAY),
      wk: i === 0 ? 'This Week' : 'Week ' + (5 - i),
      label: (m < 10 ? '0' : '') + m + '/' + (d < 10 ? '0' : '') + d };
  });
  var wAgg = {}, roster = DATA.roster || {};
  Object.keys(roster).forEach(function(e) {
    var r = roster[e];
    if (r.deactivated) return;
    if (_LST_SKIP_UNLESS_SOLD.indexOf(r.rank) !== -1) return;
    wAgg[e] = { name: r.name, rank: r.rank,
      weeks: weeks.map(function() { return { orders: 0, units: 0 }; }) };
  });
  (_LST_SALES || []).forEach(function(s) {
    if (!s.dateOfSale) return;
    var email = s.repEmail;
    if (!wAgg[email] && roster[email] && !roster[email].deactivated) {
      var r = roster[email];
      wAgg[email] = { name: r.name, rank: r.rank,
        weeks: weeks.map(function() { return { orders: 0, units: 0 }; }) };
    }
    if (!wAgg[email]) return;
    var sd = new Date(s.dateOfSale + 'T12:00:00'); sd.setHours(0,0,0,0);
    for (var i = 0; i < weeks.length; i++) {
      if (sd >= weeks[i].start && sd < weeks[i].end) {
        wAgg[email].weeks[i].orders++;
        wAgg[email].weeks[i].units += s.units || 0;
        break;
      }
    }
  });

  // The WEEKS view defaults to ranking by THIS week's production, read off the
  // weeks-view's own aggregate (weeks are oldest→newest, so the current week is
  // the last column). Any week column can be clicked to sort by it instead.
  // Sorted per-group so the LEADERS / CLIENT REPS split is preserved.
  var cur = weeks.length - 1, prev = cur - 1;
  var active = _LST_SORT.weeks || { col: cur, metric: 'units', dir: 'desc' };
  _LST_SORT_RESOLVED.weeks = active;
  // Rows with no week aggregate can't be ranked on a week value; treat them as 0
  // so they sink to the bottom of a descending sort instead of throwing.
  var cell = function(x, col, metric) {
    var w = wAgg[x.email];
    return w ? w.weeks[col][metric] : 0;
  };
  var cmp = _lstCmp(active, cell, function(a, b) {
    return cell(b, cur, 'units')  - cell(a, cur, 'units') ||
           cell(b, cur, 'orders') - cell(a, cur, 'orders') ||
           cell(b, prev, 'units') - cell(a, prev, 'units');
  });
  leaders = leaders.slice().sort(cmp);
  reps    = reps.slice().sort(cmp);

  var medals = [medalSvg(0),medalSvg(1),medalSvg(2)];
  var h = '<thead><tr><th style="width:36px">#</th>';
  h += _lstSortTh('weeks', 'name', 'name', 'NAME', active, 'll', 'min-width:160px');
  weeks.forEach(function(w) { h += '<th colspan="2">' + w.wk + '<span class="lst-wk-date">' + w.label + '</span></th>'; });
  h += '</tr><tr><th></th><th></th>';
  weeks.forEach(function(_, i) {
    h += _lstSortTh('weeks', i, 'orders', 'ORD', active);
    h += _lstSortTh('weeks', i, 'units',  'UNITS', active);
  });
  h += '</tr></thead><tbody>';

  function row(item, rank) {
    var wr = wAgg[item.email]; if (!wr) return '';
    var r = '<tr><td style="color:var(--text2)">' + (rank <= 3 ? medals[rank - 1] : rank) + '</td>';
    r += '<td class="ll"><div class="lst-rep-name lst-rep-link" onclick="_lstShowRepProfile(\'' + item.email + '\')">' + esc(wr.name) + _lstBaselineBadge(item.email) + '</div>' +
      '<div class="lst-rep-role">' + esc(_LST_RNKL[wr.rank] || wr.rank) + '</div></td>';
    wr.weeks.forEach(function(w) {
      r += '<td style="color:var(--text2)">' + w.orders + '</td>';
      r += '<td class="' + _lstUCls(w.units) + '">' + w.units + '</td>';
    });
    return r + '</tr>';
  }

  function totalRow(label, items, extraCls) {
    var r = '<tr class="lst-total-row' + (extraCls ? ' ' + extraCls : '') + '">';
    r += '<td></td><td class="ll">' + label + '</td>';
    weeks.forEach(function(_, wi) {
      var o = items.reduce(function(s, x) { return s + (wAgg[x.email] ? wAgg[x.email].weeks[wi].orders : 0); }, 0);
      var u = items.reduce(function(s, x) { return s + (wAgg[x.email] ? wAgg[x.email].weeks[wi].units  : 0); }, 0);
      r += '<td>' + o + '</td><td class="' + _lstUCls(u) + '">' + u + '</td>';
    });
    return r + '</tr>';
  }

  h += '<tr class="lst-section-sep"><td colspan="' + (2 + weeks.length * 2) + '">LEADERS</td></tr>';
  leaders.forEach(function(item, i) { h += row(item, i + 1); });
  h += totalRow(icon('crown')+' LEADER TOTAL', leaders);
  h += '<tr class="lst-section-sep"><td colspan="' + (2 + weeks.length * 2) + '">CLIENT REPS</td></tr>';
  reps.forEach(function(item, i) { h += row(item, i + 1); });
  h += totalRow(icon('zap')+' REP TOTAL', reps);
  h += totalRow('OFFICE TOTAL', leaders.concat(reps), 'lst-grand-row');

  return h + '</tbody>';
}

// ── REP PROFILE ───────────────────────────────────────────────────────────
var _LST_PROFILE = null;
var _LST_TBL_NAMES = null;

function _lstShowRepProfile(email) {
  _LST_PROFILE = email;
  _RP_ORD = { dsi:'', status:'', from:'', to:'' };   // fresh Order Log filters per rep
  var c = document.getElementById('main-content');
  c.innerHTML = skelLoader();
  var p1 = api({ action:'readRepNames', officeId:CFG.officeId });
  var p2 = api({ action:'readRepLineStats', officeId:CFG.officeId, repEmail:email });
  var p3 = _AR_LINES ? null : api({ action:'readActRateLines' });
  Promise.all(p3 ? [p1,p2,p3] : [p1,p2]).then(function(res) {
    _LST_TBL_NAMES = res[0].names || [];
    var lineStats = res[1];
    if (res[2] && res[2].actRateLines) _AR_LINES = res[2].actRateLines;
    c.innerHTML = _lstProfileHtml(email, lineStats, _LST_TBL_NAMES);
  }).catch(function() {
    c.innerHTML = '<div class="empty">Failed to load rep profile.</div>';
  });
}

function lstBackToLeaderboard() {
  _LST_PROFILE = null;
  renderLiveSalesTracker();
}

function lstSaveTableauName(email, btn) {
  var sel = document.getElementById('rp-tbl-sel');
  if (!sel || !sel.value) return;
  btn.disabled = true; btn.textContent = 'Saving…';
  apiPost({ action:'setTableauName', email:email, tableauName:sel.value }).then(function(r) {
    if (r && r.ok) {
      if (DATA.roster && DATA.roster[email]) DATA.roster[email].tableauName = sel.value;
      _lstShowRepProfile(email);
    } else {
      btn.disabled = false; btn.textContent = 'Save';
      alert(r && r.error ? r.error : 'Error saving.');
    }
  }).catch(function() {
    btn.disabled = false; btn.textContent = 'Save';
    alert('Save failed.');
  });
}

function _lstPct(n, total) { return total > 0 ? Math.round(n / total * 100) : 0; }

function _lstProfileHtml(email, lineStats, tableauNames) {
  var roster = DATA.roster || {};
  var r = roster[email] || {};
  var name = r.name || email;
  var rank = r.rank || 'client-rep';
  var team = r.team || '';
  var tableauName = r.tableauName || '';
  var role = SESSION.role || 'client-rep';
  var canEdit = ['owner','admin','master-admin'].indexOf(role) !== -1;

  // This week + all-time posted sales from _LST_SALES
  var ws = _lstWeekStart(), DAY = 86400000;
  var weekOrders=0, weekUnits=0, allOrders=0, allUnits=0;
  (_LST_SALES||[]).forEach(function(s) {
    if (s.repEmail !== email) return;
    allOrders++; allUnits += s.units||0;
    if (!s.dateOfSale) return;
    var sd = new Date(s.dateOfSale+'T12:00:00'); sd.setHours(0,0,0,0);
    var diff = Math.floor((sd.getTime()-ws.getTime())/DAY);
    if (diff >= 0 && diff <= 6) { weekOrders++; weekUnits += s.units||0; }
  });

  var h = '<div class="rp-wrap">';
  h += '<div class="rp-back" onclick="lstBackToLeaderboard()">'+icon('arrow-left')+' LEADERBOARD</div>';
  h += '<div class="rp-name">' + esc(name) + '</div>';
  h += '<div class="rp-meta">';
  h += '<span class="rp-badge blue">' + esc(_LST_RNKL[rank]||rank) + '</span>';
  if (team) h += '<span class="rp-badge">' + esc(team) + '</span>';
  if (tableauName) h += '<span class="rp-badge">'+icon('actrates')+' ' + esc(tableauName) + '</span>';
  h += '</div>';

  // Tableau Name assignment (owner/admin only)
  if (canEdit) {
    h += '<div class="rp-card"><div class="rp-card-title">Tableau Name</div>';
    if (tableauNames.length > 0) {
      h += '<div class="rp-tbl-row">';
      h += '<select class="rp-tbl-sel" id="rp-tbl-sel">';
      h += '<option value="">— Select —</option>';
      tableauNames.forEach(function(n) {
        h += '<option value="'+esc(n)+'"'+(n===tableauName?' selected':'')+'>'+esc(n)+'</option>';
      });
      h += '</select>';
      h += '<button class="rp-save-btn" onclick="lstSaveTableauName(\''+email+'\',this)">Save</button>';
      h += '</div>';
      if (!tableauName) h += '<div class="rp-no-data" style="margin-top:8px">No Tableau name linked — rates and line stats require this.</div>';
    } else {
      h += '<div class="rp-no-data">No Tableau names found. Run a sync first.</div>';
    }
    h += '</div>';
  }

  // Posted Sales stats
  h += '<div class="rp-card"><div class="rp-card-title">Posted Sales</div>';
  h += '<div class="rp-stats-row">';
  h += '<div class="rp-stat"><div class="rp-stat-num">'+weekOrders+'</div><div class="rp-stat-lbl">Orders This Week</div></div>';
  h += '<div class="rp-stat"><div class="rp-stat-num">'+weekUnits+'</div><div class="rp-stat-lbl">Units This Week</div></div>';
  h += '<div class="rp-stat"><div class="rp-stat-num">'+allOrders+'</div><div class="rp-stat-lbl">All-Time Posted</div></div>';
  h += '</div></div>';

  if (!tableauName) {
    h += '<div class="rp-card" style="text-align:center;padding:24px;color:var(--text2)">Link a Tableau name above to see line metrics and rates.</div>';
    return h + '</div>';
  }

  // Line Stats
  h += _lstLineStatsHtml(lineStats);
  // Activation Rates
  h += _lstRepArHtml(tableauName);
  // Churn
  h += _lstRepChurnHtml(tableauName);
  // Order Log — this rep's individual orders
  h += _lstRepOrdersHtml(tableauName);

  return h + '</div>';
}

function _lstLineStatsHtml(ls) {
  if (!ls || ls.noLink) return '';
  if (ls.error) return '<div class="rp-card"><div class="rp-card-title">Line Stats</div><div class="rp-no-data">'+esc(ls.error)+'</div></div>';
  var total = ls.total || 0;
  if (!total) return '<div class="rp-card"><div class="rp-card-title">Line Stats</div><div class="rp-no-data">No lines found in the 60-day window.</div></div>';

  var goodN = (ls.active||0) + (ls.posted||0);
  var pendN = ls.pending||0;
  var issueN = ls.orderIssues||0;
  var cancN = ls.canceled||0;
  var goodP = _lstPct(goodN,total), pendP = _lstPct(pendN,total), issueP = _lstPct(issueN,total), cancP = _lstPct(cancN,total);

  function pctRow(lbl, n, p, colorCls, barColor) {
    return '<div class="rp-pct-item">' +
      '<div class="rp-pct-header"><span class="rp-pct-lbl">'+lbl+'</span><span class="rp-pct-val '+colorCls+'">'+n+' lines &nbsp;'+p+'%</span></div>' +
      '<div class="rp-bar"><div class="rp-bar-fill" style="width:'+p+'%;background:'+barColor+'"></div></div>' +
      '</div>';
  }

  var h = '<div class="rp-card"><div class="rp-card-title">Line Stats — 60-day window</div>';
  h += '<div style="font-size:12px;color:var(--text2);margin-bottom:14px">'+total+' total lines</div>';
  h += '<div class="rp-pct-list">';
  h += pctRow('Active / Posted', goodN, goodP, 'green', '#4ade80');
  h += pctRow('Pending (not Active, Posted, Canceled, Disconnected, or Order Issue)', pendN, pendP, 'orange', '#fb923c');
  h += pctRow('Order Issues (BYOD, Porting Issue, Port Approved, Pending Order Port, Pending Valid Payment)', issueN, issueP, 'yellow', '#fbbf24');
  h += pctRow('Canceled', cancN, cancP, 'red', '#f87171');
  h += '</div></div>';
  return h;
}

function _lstRepArHtml(tableauName) {
  if (!_AR_LINES || !_AR_LINES.length) return '<div class="rp-card"><div class="rp-card-title">Activation Rates</div><div class="rp-no-data">No data. Visit the Activation Rates tab first to load it.</div></div>';
  // Same badge-table format + Tableau colors as the Activation Rates tab (_buildArTable),
  // scoped to this one rep (no Grand Total row — it would just duplicate the rep row).
  var BKT_MAP = {'0-7 Days':'b0_7','8-14 Days':'b8_14','15-30 Days':'b15_30','31-60 Days':'b31_60'};
  var d = {b0_7:{t:0,a:0},b8_14:{t:0,a:0},b15_30:{t:0,a:0},b31_60:{t:0,a:0}};
  _AR_LINES.forEach(function(l) {
    if (l.rep !== tableauName) return;
    var b = BKT_MAP[l.bucket]; if (!b) return;
    d[b].t += l.vol||0; d[b].a += l.acts||0; d[b].color = l.color;
  });
  var hasData = ['b0_7','b8_14','b15_30','b31_60'].some(function(k){ return d[k].t > 0; });
  if (!hasData) return '<div class="rp-card"><div class="rp-card-title">Activation Rates</div><div class="rp-no-data">No activation rate data for this rep.</div></div>';

  // Portal fallback thresholds — used only when Tableau's color isn't present.
  function bktCls(bktKey, pct) {
    if (bktKey==='b0_7')   return pct>=21?'ar-green':pct>=10?'ar-yellow':'ar-red';
    if (bktKey==='b8_14')  return pct>=71?'ar-green':pct>=51?'ar-yellow':'ar-red';
    if (bktKey==='b15_30') return pct>=75?'ar-green':pct>=70?'ar-yellow':'ar-red';
    if (bktKey==='b31_60') return pct>=86?'ar-green':pct>=79?'ar-yellow':'ar-red';
    return pct>=80?'ar-green':pct>=60?'ar-yellow':'ar-red';
  }
  function arColorCls(color) {
    var c = String(color||'').toLowerCase();
    return c==='green'?'ar-green':c==='yellow'?'ar-yellow':c==='red'?'ar-red':'';
  }
  function cell(b, bktKey) {
    if (b.t===0) return '<td class="ar-cell"><div class="ar-badge ar-blue">(0/0)<br>—</div></td>';
    var pct=Math.round(b.a/b.t*100);
    var cls = arColorCls(b.color) || bktCls(bktKey, pct);
    return '<td class="ar-cell"><div class="ar-badge '+cls+'">('+b.a+'/'+b.t+')<br>'+pct+'%</div></td>';
  }
  return '<div class="rp-card"><div class="rp-card-title">Activation Rates</div>' +
    '<div class="tbl-wrap"><table class="call-table"><thead><tr>' +
    '<th>0–7 Days</th><th>8–14 Days</th><th>15–30 Days</th><th>31–60 Days</th>' +
    '</tr></thead><tbody><tr>' +
    cell(d.b0_7,'b0_7')+cell(d.b8_14,'b8_14')+cell(d.b15_30,'b15_30')+cell(d.b31_60,'b31_60') +
    '</tr></tbody></table></div></div>';
}

function _lstRepChurnHtml(tableauName) {
  // Same badge-table format + Tableau colors as the Churn tab (_churnTableHtml),
  // scoped to this one rep (no Grand Total row — it would just duplicate the rep row).
  function fmtR(s) {
    var str = String(s==null?'':s).trim();
    if (str.indexOf('%')!==-1) return str;
    var n = parseFloat(str); if (isNaN(n)) return '0.0%';
    return (n<=1?n*100:n).toFixed(1)+'%';
  }
  function fmtN(n) { return Number(n).toLocaleString(); }
  var rows = (DATA.churnReport||[]).filter(function(r){ return r.rep===tableauName; });
  if (!rows.length) return '<div class="rp-card"><div class="rp-card-title">Churn</div><div class="rp-no-data">No churn data for this rep.</div></div>';
  var rowMap = {}; rows.forEach(function(r){ rowMap[r.bucket]=r; });
  function cell(d) {
    if (!d) return '<td class="ar-cell"></td>';
    return '<td class="ar-cell"><span class="ar-badge '+_churnCls(d.color)+'">('+fmtN(d.disconnects)+'/'+fmtN(d.activated)+')<br>'+fmtR(d.churnRate)+'</span></td>';
  }
  return '<div class="rp-card"><div class="rp-card-title">Churn</div>' +
    '<div class="tbl-wrap"><table class="call-table"><thead><tr>' +
    CHURN_BUCKETS.map(function(b){ return '<th style="min-width:110px">'+esc(b)+'</th>'; }).join('') +
    '</tr></thead><tbody><tr>' +
    CHURN_BUCKETS.map(function(b){ return cell(rowMap[b]); }).join('') +
    '</tr></tbody></table></div></div>';
}

// Order Log — this rep's individual orders from the Tableau order log (60-day
// window, one row per DSI). Search by DSI + filter by Status / Date. Same table
// format as Team Orders (_tmOrdersHtml) minus the Rep column (single-rep page).
var _RP_ORD = { dsi:'', status:'', from:'', to:'' };   // Rep profile Order Log filters
function _rpOrdSet(field, val){ _RP_ORD[field]=val; _rpOrdRerender(); }
function _rpOrdClear(){ _RP_ORD={dsi:'',status:'',from:'',to:''}; _rpOrdRerender(); }
function _rpOrdRerender(){
  var w=document.getElementById('rp-ord-wrap'); if(!w||!_LST_PROFILE) return;
  var tn=((DATA.roster||{})[_LST_PROFILE]||{}).tableauName||'';
  w.outerHTML=_lstRepOrdersHtml(tn);
}
// This rep's orders (60-day Tableau log) for the current Order Log.
function _rpOrdOrders(){
  if(!_LST_PROFILE) return [];
  var tnl=(((DATA.roster||{})[_LST_PROFILE]||{}).tableauName||'').toLowerCase();
  return (DATA.masterTracker||[]).filter(function(o){ return (o.rep||'').toLowerCase()===tnl; });
}
function _rpOrdFilter(orders){
  var q=String(_RP_ORD.dsi||'').trim().toLowerCase();
  return orders.filter(function(o){
    if(q && String(o.dsi||'').toLowerCase().indexOf(q)===-1) return false;
    if(_RP_ORD.status && !((o.statusCounts||{})[_RP_ORD.status])) return false;
    var od=String(o.orderDate||'').slice(0,10);
    if(_RP_ORD.from && od < _RP_ORD.from) return false;
    if(_RP_ORD.to   && od > _RP_ORD.to)   return false;
    return true;
  }).slice().sort(_byOrderDateDesc);
}
function _rpOrdBody(rows){
  return rows.length ? rows.map(function(o){
    var nc=((DATA.notes||{})[o.dsi]||[]).length, sid=String(o.dsi||'').replace(/\W/g,'_');
    return '<tr>'+
      '<td>'+esc(o.dsi)+'</td>'+
      '<td>'+esc(o.orderDate)+'</td>'+
      '<td>'+productBreakdown(o.productCounts,false)+'</td>'+
      '<td>'+statusBreakdown(o.statusCounts,false)+'</td>'+
      '<td><button class="notes-btn'+(nc>0?' has-notes':'')+'" data-dsi="'+esc(o.dsi)+'" onclick="openNotesModal(\''+esc(o.dsi)+'\',\''+esc(o.spe||'')+'\',\''+esc(o.rep)+'\')">NOTES'+(nc>0?'<span class="notes-count" id="nc-'+sid+'">'+nc+'</span>':'')+'</button></td>'+
    '</tr>';
  }).join('') : '<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--text2)">No orders match this search.</td></tr>';
}
// Live DSI search: update only the table body + count so the search box keeps focus
// (a full rerender via outerHTML would drop the caret on every keystroke).
function _rpOrdSearch(val){
  _RP_ORD.dsi=val;
  var rows=_rpOrdFilter(_rpOrdOrders());
  var tb=document.getElementById('rp-ord-tbody'); if(tb) tb.innerHTML=_rpOrdBody(rows);
  var ct=document.getElementById('rp-ord-count'); if(ct) ct.textContent=rows.length+' order'+(rows.length!==1?'s':'')+' · last 60 days';
}

function _lstRepOrdersHtml(tableauName) {
  var tnl=(tableauName||'').toLowerCase();
  var orders=(DATA.masterTracker||[]).filter(function(o){ return (o.rep||'').toLowerCase()===tnl; });

  var stats={};
  orders.forEach(function(o){ Object.keys(o.statusCounts||{}).forEach(function(s){ if(s) stats[s]=true; }); });
  var statOpts='<option value="">All statuses</option>'+Object.keys(stats).sort().map(function(s){return '<option value="'+esc(s)+'"'+(_RP_ORD.status===s?' selected':'')+'>'+esc(s)+'</option>';}).join('');

  var rows=_rpOrdFilter(orders);
  var body=_rpOrdBody(rows);

  var anyFilter=_RP_ORD.dsi||_RP_ORD.status||_RP_ORD.from||_RP_ORD.to;
  var cS='width:auto;min-width:140px;max-width:220px';
  var filters='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">'+
    '<input class="ps-input" style="flex:1;min-width:180px;max-width:280px" type="text" value="'+esc(_RP_ORD.dsi)+'" oninput="_rpOrdSearch(this.value)" placeholder="🔍 Search DSI…">'+
    '<select class="ps-select" style="'+cS+'" onchange="_rpOrdSet(\'status\',this.value)">'+statOpts+'</select>'+
    '<input class="ps-input" style="'+cS+'" type="date" value="'+esc(_RP_ORD.from)+'" onchange="_rpOrdSet(\'from\',this.value)" title="From date">'+
    '<input class="ps-input" style="'+cS+'" type="date" value="'+esc(_RP_ORD.to)+'" onchange="_rpOrdSet(\'to\',this.value)" title="To date">'+
    (anyFilter?'<button class="lst-toggle-btn" onclick="_rpOrdClear()">Clear</button>':'')+
    '</div>';

  return '<div class="rp-card" id="rp-ord-wrap"><div class="rp-card-title">Order Log</div>'+filters+
    '<div class="tbl-wrap"><table class="call-table"><thead><tr><th>DSI</th><th>Date</th><th>Products</th><th>Status</th><th>Notes</th></tr></thead><tbody id="rp-ord-tbody">'+body+'</tbody></table></div>'+
    '<div id="rp-ord-count" style="font-size:11px;color:var(--text2);margin-top:8px">'+rows.length+' order'+(rows.length!==1?'s':'')+' · last 60 days</div></div>';
}

