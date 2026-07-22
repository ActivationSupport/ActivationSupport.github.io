// ── FIBER INSTALL CALENDAR ──────────────────────────────────────────────────
// Month grid of fiber / new-internet installs, keyed on the SCHEDULED INSTALL
// DATE that comes off Tableau (backend: readFiberInstalls). Internet Air is
// excluded server-side — it has no truck-roll install.
//
// Client-reps are scoped SERVER-side by _scopeOrdersAuthed, so nothing here has
// to filter by rep: a client-rep simply receives only their own installs.
//
// Orders whose install date isn't set yet come back with installDate:'' and are
// listed under "N/A — not yet scheduled" beneath the grid rather than dropped.

var _FIB = { monthOffset: 0, installs: null, flight: false };

// Status → pill colors. Per-office spec: Scheduled yellow · Open light orange ·
// Pending pale orange · Delivered purple · Shipped yellow · Active green ·
// Canceled red · Disconnected maroon. Anything unmapped falls back to neutral.
// (Porting Issue intentionally has no entry — it doesn't apply to fiber.)
var FIB_STATUS = {
  'scheduled':        { bg:'#fef08a', fg:'#713f12' },
  'open':             { bg:'#fed7aa', fg:'#9a3412' },
  'pending':          { bg:'#ffedd5', fg:'#9a3412' },
  'pending shipment': { bg:'#ffedd5', fg:'#9a3412' },
  'delivered':        { bg:'#e9d5ff', fg:'#6b21a8' },
  'shipped':          { bg:'#fde047', fg:'#713f12' },
  'active':           { bg:'#bbf7d0', fg:'#166534' },
  'posted':           { bg:'#bbf7d0', fg:'#15803d' },
  'canceled':         { bg:'#fecaca', fg:'#991b1b' },
  'cancelled':        { bg:'#fecaca', fg:'#991b1b' },
  'disconnected':     { bg:'#7f1d1d', fg:'#ffe4e6' }
};
// Anything past its scheduled install date and not finished shouts the loudest.
var FIB_OVERDUE = { bg:'#fb923c', fg:'#7c2d12' };
var FIB_NEUTRAL = { bg:'#e2e8f0', fg:'#475569' };
// Statuses that mean the install is settled, so it can never read as "overdue".
var FIB_FINAL = { 'active':1, 'posted':1, 'canceled':1, 'cancelled':1, 'disconnected':1 };

var FIB_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var FIB_DOW    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function _fibToday() { var d = new Date(); d.setHours(0,0,0,0); return d; }
// Local yyyy-MM-dd — built from the local parts, never via toISOString (which
// would shift a day in western timezones).
function _fibYmd(d) { return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
function _fibFmtYmd(s) {
  if (!s) return 'N/A';
  var p = String(s).split('-');
  if (p.length !== 3) return s;
  return FIB_MONTHS[Number(p[1])-1].slice(0,3)+' '+Number(p[2])+', '+p[0];
}
// One order can carry several lines; show the dominant status.
function _fibStatusOf(o) {
  var s = String(o.dtrStatus || '').trim();
  if (s) return s;
  var sc = o.statusCounts || {}, best = '', n = -1;
  Object.keys(sc).forEach(function(k) { if (sc[k] > n) { n = sc[k]; best = k; } });
  return best || 'Null';
}
function _fibIsOverdue(o) {
  if (!o.installDate) return false;
  if (FIB_FINAL[_fibStatusOf(o).toLowerCase()]) return false;
  return o.installDate < _fibYmd(_fibToday());
}
function _fibStyleOf(o) {
  if (_fibIsOverdue(o)) return FIB_OVERDUE;
  return FIB_STATUS[_fibStatusOf(o).toLowerCase()] || FIB_NEUTRAL;
}
function _fibCustomer(o) { return String(o.spe || '').trim(); }

function renderFiberCalendarTab() {
  var c = document.getElementById('main-content');
  if (_FIB.installs !== null) { _fibPaint(); return; }
  if (!_FIB.flight) {
    _FIB.flight = true;
    api({ action:'readFiberInstalls', officeId:CFG.officeId }).then(function(res) {
      _FIB.flight = false;
      _FIB.installs = (res && res.installs) ? res.installs : [];
      if (CURRENT_TAB === 'fibercal') _fibPaint();
    }).catch(function() {
      _FIB.flight = false;
      if (CURRENT_TAB === 'fibercal') document.getElementById('main-content').innerHTML =
        '<div class="card"><div class="card-body"><div class="empty">Connection error. <a href="#" onclick="renderFiberCalendarTab()">Retry</a></div></div></div>';
    });
  }
  c.innerHTML = '<div class="card"><div class="card-body"><div class="empty">Loading fiber installs…</div></div></div>';
}

function _fibPaint() {
  var c = document.getElementById('main-content'); if (!c) return;
  c.innerHTML = _fibBuild();
}

function _fibNav(delta) { _FIB.monthOffset += delta; _fibPaint(); }
function _fibThisMonth() { _FIB.monthOffset = 0; _fibPaint(); }

function _fibLegend() {
  var items = [
    ['Scheduled', FIB_STATUS['scheduled']], ['Open', FIB_STATUS['open']],
    ['Pending', FIB_STATUS['pending']], ['Shipped', FIB_STATUS['shipped']],
    ['Delivered', FIB_STATUS['delivered']], ['Active', FIB_STATUS['active']],
    ['Canceled', FIB_STATUS['canceled']], ['Disconnected', FIB_STATUS['disconnected']],
    ['Past install date', FIB_OVERDUE]
  ];
  return '<div class="fib-legend">' + items.map(function(it) {
    return '<span class="fib-legend-item"><span class="fib-swatch" style="background:'+it[1].bg+'"></span>'+esc(it[0])+'</span>';
  }).join('') + '</div>';
}

function _fibBuild() {
  var all = _FIB.installs || [];
  var base = _fibToday();
  var first = new Date(base.getFullYear(), base.getMonth() + _FIB.monthOffset, 1);
  var year = first.getFullYear(), month = first.getMonth();
  var todayYmd = _fibYmd(base);

  // Bucket by install date; unscheduled orders go to their own list.
  var byDay = {}, na = [];
  all.forEach(function(o) {
    if (o.installDate) { (byDay[o.installDate] = byDay[o.installDate] || []).push(o); }
    else na.push(o);
  });

  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var lead = first.getDay();                       // blank cells before the 1st
  var monthPrefix = year + '-' + ('0'+(month+1)).slice(-2) + '-';
  var monthCount = 0, overdueCount = 0;
  Object.keys(byDay).forEach(function(ymd) {
    if (ymd.indexOf(monthPrefix) === 0) monthCount += byDay[ymd].length;
  });
  all.forEach(function(o) { if (_fibIsOverdue(o)) overdueCount++; });

  var head =
    '<div class="fib-bar">' +
      '<div class="fib-nav">' +
        '<button class="fib-navbtn" onclick="_fibNav(-1)" title="Previous month">'+icon('chev-left')+'</button>' +
        '<div class="fib-month">'+esc(FIB_MONTHS[month]+' '+year)+'</div>' +
        '<button class="fib-navbtn" onclick="_fibNav(1)" title="Next month">'+icon('chev-right')+'</button>' +
        '<button class="fib-todaybtn" onclick="_fibThisMonth()">This month</button>' +
      '</div>' +
      '<div class="fib-counts">' +
        '<span class="fib-count">'+monthCount+' install'+(monthCount===1?'':'s')+' this month</span>' +
        (overdueCount ? '<span class="fib-count fib-count-warn">'+overdueCount+' past install date</span>' : '') +
      '</div>' +
    '</div>' + _fibLegend();

  // ── month grid ──
  var cells = '';
  for (var i = 0; i < lead; i++) cells += '<div class="fib-cell fib-cell-blank"></div>';
  for (var day = 1; day <= daysInMonth; day++) {
    var ymd = monthPrefix + ('0'+day).slice(-2);
    var list = byDay[ymd] || [];
    var isToday = ymd === todayYmd;
    var chips = list.slice(0, 3).map(function(o) {
      var st = _fibStyleOf(o);
      return '<div class="fib-chip" style="background:'+st.bg+';color:'+st.fg+'" title="'+esc(_fibStatusOf(o)+' — '+(_fibCustomer(o)||o.dsi))+'"'+
        ' onclick="_fibOpenDetail(\''+esc(o.dsi)+'\')">'+esc(o.dsi)+'</div>';
    }).join('');
    if (list.length > 3) {
      chips += '<div class="fib-more" onclick="_fibOpenDay(\''+ymd+'\')">+'+(list.length-3)+' more</div>';
    }
    cells += '<div class="fib-cell'+(isToday?' fib-cell-today':'')+(list.length?' fib-cell-has':'')+'">' +
        '<div class="fib-daynum"'+(list.length?' onclick="_fibOpenDay(\''+ymd+'\')"':'')+'>'+day+'</div>' +
        chips +
      '</div>';
  }
  // Pad the final week so the grid always ends on a complete row.
  var trail = (7 - ((lead + daysInMonth) % 7)) % 7;
  for (var k = 0; k < trail; k++) cells += '<div class="fib-cell fib-cell-blank"></div>';
  var grid =
    '<div class="fib-grid">' +
      FIB_DOW.map(function(d){ return '<div class="fib-dow">'+d+'</div>'; }).join('') +
      cells +
    '</div>';

  // ── not-yet-scheduled ──
  var naSec = '';
  if (na.length) {
    naSec =
      '<div class="card" style="margin-top:16px"><div class="card-header dark">'+icon('clock')+' N/A — not yet scheduled <span class="fib-nacount">'+na.length+'</span></div>' +
      '<div class="card-body"><div class="fib-na-wrap"><table class="fib-na-table">' +
        '<thead><tr><th>DSI</th><th>Customer</th><th>Rep</th><th>Order date</th><th>Status</th></tr></thead><tbody>' +
        na.map(function(o) {
          var st = _fibStyleOf(o);
          return '<tr onclick="_fibOpenDetail(\''+esc(o.dsi)+'\')">' +
            '<td class="fib-na-dsi">'+esc(o.dsi)+'</td>' +
            '<td>'+esc(_fibCustomer(o)||'—')+'</td>' +
            '<td>'+esc(o.rep||'—')+'</td>' +
            '<td>'+esc(o.orderDate||'—')+'</td>' +
            '<td><span class="fib-pill" style="background:'+st.bg+';color:'+st.fg+'">'+esc(_fibStatusOf(o))+'</span></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div></div></div>';
  }

  var empty = (!all.length)
    ? '<div class="empty">No fiber or new-internet installs found for this office.</div>' : '';

  return '<div class="card"><div class="card-header dark">'+icon('globe')+' Fiber Install Calendar</div>' +
    '<div class="card-body">' + head + (empty || grid) + '</div></div>' + naSec;
}

// Every install on one day.
function _fibOpenDay(ymd) {
  var list = (_FIB.installs||[]).filter(function(o){ return o.installDate === ymd; });
  if (!list.length) return;
  document.getElementById('modal-body').innerHTML =
    '<div class="nm-title">'+esc(_fibFmtYmd(ymd))+'</div>' +
    '<div class="nm-sub">'+list.length+' install'+(list.length===1?'':'s')+'</div>' +
    '<div class="fib-daylist">' + list.map(function(o) {
      var st = _fibStyleOf(o);
      return '<div class="fib-dayrow" onclick="_fibOpenDetail(\''+esc(o.dsi)+'\')">' +
        '<span class="fib-na-dsi">'+esc(o.dsi)+'</span>' +
        '<span class="fib-dayrow-cust">'+esc(_fibCustomer(o)||'—')+'</span>' +
        '<span class="fib-pill" style="background:'+st.bg+';color:'+st.fg+'">'+esc(_fibStatusOf(o))+'</span>' +
      '</div>';
    }).join('') + '</div>' +
    '<div class="nm-actions"><button class="nm-close-btn" style="width:100%" onclick="closeModal()">CLOSE</button></div>';
  document.getElementById('detail-modal').classList.add('open');
}

// One install: the Tableau facts (read-only — they come from AT&T), the Tableau
// order note, and a jump into the shared notes modal for the portal's own thread.
function _fibOpenDetail(dsi) {
  var o = (_FIB.installs||[]).filter(function(x){ return x.dsi === dsi; })[0];
  if (!o) return;
  var st = _fibStyleOf(o), overdue = _fibIsOverdue(o);
  var portalNotes = ((DATA.notes || {})[dsi] || []).length;
  function row(label, val) {
    return '<div class="fib-drow"><span class="fib-dlabel">'+esc(label)+'</span><span class="fib-dval">'+val+'</span></div>';
  }
  var prods = Object.keys(o.productCounts || {}).map(function(p){ return p+' x'+o.productCounts[p]; }).join(', ');
  document.getElementById('modal-body').innerHTML =
    '<div class="nm-title">'+esc(_fibCustomer(o) || dsi)+'</div>' +
    '<div class="nm-sub">DSI '+esc(dsi)+'</div>' +
    '<div class="fib-detail">' +
      row('Install date', '<b>'+esc(_fibFmtYmd(o.installDate))+'</b>' +
        (overdue ? ' <span class="fib-pill" style="background:'+FIB_OVERDUE.bg+';color:'+FIB_OVERDUE.fg+'">Past install date</span>' : '')) +
      row('Status', '<span class="fib-pill" style="background:'+st.bg+';color:'+st.fg+'">'+esc(_fibStatusOf(o))+'</span>') +
      row('Rep', esc(o.rep || '—')) +
      row('Order date', esc(o.orderDate || '—')) +
      (prods ? row('Product', esc(prods)) : '') +
    '</div>' +
    '<div class="nm-section-label" style="margin-top:12px">Tableau order note</div>' +
    '<div class="fib-tnote">'+(o.tableauNotes ? esc(o.tableauNotes) : '<span class="fib-muted">No note on the order.</span>')+'</div>' +
    '<div class="nm-actions" style="display:flex;gap:8px">' +
      '<button class="nm-add-btn" style="flex:1" onclick="openNotesModal(\''+esc(dsi)+'\',\''+esc(_fibCustomer(o)).replace(/'/g,"\\'")+'\',\''+esc(o.rep||'').replace(/'/g,"\\'")+'\')">' +
        'PORTAL NOTES'+(portalNotes?' ('+portalNotes+')':'')+'</button>' +
      '<button class="nm-close-btn" style="flex:1" onclick="closeModal()">CLOSE</button>' +
    '</div>';
  document.getElementById('detail-modal').classList.add('open');
}
