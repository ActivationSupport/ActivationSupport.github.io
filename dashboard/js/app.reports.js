// ── DAILY REPORT ──────────────────────────────────────────────────────────
var _DR_DATA = undefined; // undefined=not loaded, null=no report for this date
var _DR_DATES = null;
var _DR_SEL_DATE = null;
var _DR_LOADING = false;

function _drTodayStr() {
  var d = new Date();
  return d.getFullYear()+'-'+(d.getMonth()<9?'0':'')+(d.getMonth()+1)+'-'+(d.getDate()<10?'0':'')+d.getDate();
}

function renderDailyReport() {
  // Opening the tab always REGENERATES today's report for the CURRENT office,
  // from live data, so it's never stale and never another office's (user choice).
  // The date picker can still pull older SAVED reports afterward via drSelectDate.
  _DR_SEL_DATE = _drTodayStr();            // reset to today on every entry (handles midnight rollover)
  if (_DR_LOADING) return '<div class="card"><div class="card-body"><div class="empty">Generating today’s report…</div></div></div>';
  _DR_LOADING = true;
  _DR_DATA    = undefined;
  var selDate   = _DR_SEL_DATE;
  var selOffice = CFG.officeId;             // pin office so a stale regen can't paint over a new one
  // Dates list (for the picker) loads in parallel with the generate→read chain.
  var datesP  = api({action:'getDailyReportDates'}).then(function(d){ return d.dates || []; }).catch(function(){ return _DR_DATES || []; });
  var reportP = apiPost({action:'generateDailyReport', date:selDate}).then(function(){ return api({action:'readDailyReport', date:selDate}); });
  Promise.all([datesP, reportP]).then(function(res) {
    _DR_LOADING = false;
    // Bail if the user navigated away, switched office, or changed the date mid-flight.
    if (CURRENT_TAB !== 'dailyreport' || CFG.officeId !== selOffice || _DR_SEL_DATE !== selDate) return;
    _DR_DATES = res[0];
    _DR_DATA  = (res[1] && res[1].report) ? res[1].report : null;
    var c = document.getElementById('main-content'); if (c) c.innerHTML = _drBuildHtml();
  }).catch(function() {
    _DR_LOADING = false;
    if (CURRENT_TAB !== 'dailyreport' || CFG.officeId !== selOffice || _DR_SEL_DATE !== selDate) return;
    _DR_DATA = null;
    var c = document.getElementById('main-content'); if (c) c.innerHTML = _drBuildHtml();
  });
  return '<div class="card"><div class="card-body"><div class="empty">Generating today’s report for '+esc(CFG.officeName||CFG.officeId)+'… this may take a moment.</div></div></div>';
}

function drSelectDate(date) {
  _DR_SEL_DATE = date;
  _DR_DATA = undefined;
  _DR_LOADING = true;
  var c = document.getElementById('main-content');
  if (c) c.innerHTML = '<div class="card"><div class="card-body"><div class="empty">Loading…</div></div></div>';
  api({action:'readDailyReport', date:date}).then(function(r) {
    _DR_DATA = (r && r.report) ? r.report : null;
    _DR_LOADING = false;
    var c2 = document.getElementById('main-content'); if (c2) c2.innerHTML = _drBuildHtml();
  }).catch(function() { _DR_LOADING = false; });
}

function drRefresh() {
  _DR_LOADING = true;
  var selDate = _DR_SEL_DATE || _drTodayStr();
  var c = document.getElementById('main-content');
  if (c) c.innerHTML = '<div class="card"><div class="card-body"><div class="empty">Generating report for '+esc(selDate)+'… this may take a moment.</div></div></div>';
  apiPost({action:'generateDailyReport', date:selDate}).then(function() {
    _DR_DATA = undefined;
    return api({action:'readDailyReport', date:selDate});
  }).then(function(r) {
    _DR_DATA = (r && r.report) ? r.report : null;
    _DR_LOADING = false;
    var c2 = document.getElementById('main-content'); if (c2) c2.innerHTML = _drBuildHtml();
  }).catch(function() { _DR_LOADING = false; });
}

function _drBuildHtml() {
  var rpt = _DR_DATA;
  var dates = _DR_DATES || [];
  var selDate = _DR_SEL_DATE || _drTodayStr();
  var todayStr = _drTodayStr();

  var d = new Date(selDate+'T12:00:00');
  var DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var dayLabel = DAY_NAMES[d.getDay()]+', '+MONTH_NAMES[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();

  var dateSet={};
  dates.forEach(function(dt){dateSet[dt]=true;});
  var opts=[];
  if (!dateSet[todayStr]) opts.push('<option value="'+esc(todayStr)+'"'+(todayStr===selDate?' selected':'')+'>'+esc(todayStr)+'</option>');
  dates.forEach(function(dt){opts.push('<option value="'+esc(dt)+'"'+(dt===selDate?' selected':'')+'>'+esc(dt)+'</option>');});

  var officeNm = (typeof CFG!=='undefined' && CFG.officeName) ? CFG.officeName : '';
  var _drLg = (typeof OFFICE_LOGOS!=='undefined' && typeof CFG!=='undefined' && CFG.officeId) ? OFFICE_LOGOS[CFG.officeId] : null;
  var drLogoImg = (_drLg && _drLg.full) ? '<img class="dr-logo" src="'+_drLg.full+'" alt="'+esc(officeNm)+'" style="height:'+(_drLg.drHeaderH||26)+'px">' : '';
  var genAt = rpt ? '<span class="dr-gents">Generated '+_drFmtTs(rpt.generatedAt)+'</span>' : '';
  var header = '<div class="card-header dark dr-header">'+
    '<div class="dr-titlewrap">'+
      drLogoImg+
      (officeNm?'<span class="dr-office">'+esc(officeNm)+'</span>':'')+
      '<span class="dr-title">'+icon('dailyreport')+' Daily Call Report</span>'+
      '<span class="dr-daylabel">'+esc(dayLabel)+'</span>'+genAt+
    '</div>'+
    '<div class="dr-controls">'+
      (opts.length?'<select class="dr-date-sel" onchange="drSelectDate(this.value)">'+opts.join('')+'</select>':'')+
      '<button class="dr-refresh-btn" onclick="drRefresh()">⟳ Refresh</button>'+
      '<button class="dr-copy-btn" onclick="drCopyEmail()">'+icon('mail')+' Copy for Email</button>'+
    '</div></div>';

  if (!rpt) {
    return '<div class="card">'+header+'<div class="card-body">'+
      '<div class="dr-no-report"><p>No report for this date yet.</p>'+
      '<button class="dr-refresh-btn" onclick="drRefresh()">Generate Now</button></div>'+
      '</div></div>';
  }

  // Notes live in ONE section only — highest priority first (Escalations > No Answers).
  // A worked order that's also escalated/no-answer still lists under Calls Worked, but
  // note-less (with a pointer up to where its notes are shown).
  var _drDup = _drNotesShownSet(rpt);
  return '<div class="card">'+header+'<div class="card-body dr-body">'+
    _drAtAGlance(rpt)+
    _drStatBar(rpt.callCategories||{}, rpt.appointments, rpt.activatedToday, rpt.ordersSubmitted)+
    _drSectionEscalations(rpt.escalations||[])+
    _drSectionNoAnswers(rpt.noAnswers||[])+
    _drSectionCallsWorked(rpt.callsWorked||{}, _drDup)+
    _drSectionActivatedToday(rpt.activatedToday)+
    _drSectionStatus(rpt.statusBreakdown||[])+
    _drSectionActivation(rpt.activationSummary||{})+
    _drSectionChurn(rpt.churnSummary||{})+
    _drSectionAppointments(rpt.appointments)+
    '</div></div>';
}

// DSIs whose notes are shown in a higher-priority section (so Calls Worked omits them).
function _drNotesShownSet(rpt) {
  var escSet={}, naSet={};
  (rpt.escalations||[]).forEach(function(e){ if(e.dsi) escSet[e.dsi]=true; });
  (rpt.noAnswers||[]).forEach(function(e){ if(e.dsi) naSet[e.dsi]=true; });
  return { esc:escSet, na:naSet };
}

function _drFmtTs(iso) {
  if (!iso) return '';
  var d=new Date(iso); if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' at '+
    d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
}
function _drFmtDate(iso) {
  if (!iso) return '—';
  var d=new Date(iso+'T12:00:00'); if (isNaN(d.getTime())) return iso;
  var MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return MN[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();
}

// ── KPI SUMMARY ROW ───────────────────────────────────────────────────────
function _drStatBar(cats, ap, act, ordersSubmitted) {
  ap = ap || {};
  act = act || { lines:0, orders:0 };
  var bk = ap.booked || { total: (ap.bookedToday||0) };
  var sc = ap.statusChanges || { completed: 0 };
  var daT=cats.dayAfterTotal||0, daW=cats.dayAfterWorked||0;
  var covPct = daT>0 ? Math.round(daW/daT*100) : null;
  var covAccent = covPct===null?'#475569':covPct>=80?'#52c785':covPct>=50?'#eab308':'#e9756a';
  function tile(value,label,accent,sub){
    return '<div class="dr-kpi" style="border-top:2px solid '+(accent||'#3a4250')+'">'+
      '<div class="dr-kpi-val">'+value+'</div>'+
      '<div class="dr-kpi-lbl">'+label+'</div>'+
      (sub?'<div class="dr-kpi-sub">'+sub+'</div>':'')+
    '</div>';
  }
  var actOrders=act.orders||0;
  return '<div class="dr-kpi-row">'+
    tile(act.lines||0,'Activated Today','#52c785',actOrders+' order'+(actOrders===1?'':'s'))+
    tile(ordersSubmitted||0,'Orders Submitted','#4A9FD4','Post Sale form')+
    tile(covPct===null?'—':covPct+'%','Day-After Coverage',covAccent,daW+' / '+daT+' worked')+
    tile(cats.deliveredWorked||0,'Delivered Worked','#60a5fa')+
    tile(cats.issuesWorked||0,'Issues Worked','#a78bfa')+
    tile(cats.noAnswerTotal||0,'No Answers','#e9756a')+
    tile(cats.escalationTotal||0,'Escalations','#cf6b62')+
    tile(bk.total||0,'Appts Booked','#4A9FD4')+
    tile(sc.completed||0,'Appts Completed','#3b82f6')+
  '</div>';
}

// "Today at a glance" — one-line takeaway (the 5-second read).
function _drAtAGlance(rpt) {
  var cats=rpt.callCategories||{}, ap=rpt.appointments||{}, act=rpt.activatedToday||{lines:0,orders:0};
  var sc=ap.statusChanges||{};
  var daT=cats.dayAfterTotal||0, daW=cats.dayAfterWorked||0;
  var parts=[];
  var L=act.lines||0, O=act.orders||0;
  parts.push('<b>'+L+'</b> line'+(L===1?'':'s')+' activated'+(O?' across <b>'+O+'</b> order'+(O===1?'':'s'):''));
  if (daT) parts.push('<b>'+daW+'/'+daT+'</b> day-after calls worked');
  if (ap.scheduled&&ap.scheduled.total) parts.push('<b>'+(sc.completed||0)+'</b> appt'+((sc.completed||0)===1?'':'s')+' completed'+(sc.noShow?', <b>'+sc.noShow+'</b> no-show':''));
  var attn=(cats.noAnswerTotal||0)+(cats.escalationTotal||0);
  if (attn) parts.push('<b>'+attn+'</b> item'+(attn===1?'':'s')+' need attention');
  return '<div class="dr-glance">'+parts.join(' &nbsp;·&nbsp; ')+'</div>';
}

// Detail list of activator-marked line activations for the day.
function _drSectionActivatedToday(act) {
  act = act || { lines:0, orders:0, list:[] };
  if (!act.list || !act.list.length) return '';
  var rows=act.list.map(function(x){
    return '<tr><td class="dr-nw">'+_drDsiCell(x.dsi)+'</td>'+
      '<td class="dr-nw"><b>'+(x.lines||0)+'</b></td>'+
      '<td>'+esc(x.activator||'—')+'</td>'+
      '<td>'+esc(x.note||'—')+'</td></tr>';
  }).join('');
  return '<div class="dr-section"><div class="dr-sec-hdr">'+icon('zap')+' Lines Activated Today '+
    '<span class="dr-subhdr">'+act.lines+' line'+(act.lines===1?'':'s')+' across '+act.orders+' order'+(act.orders===1?'':'s')+'</span></div>'+
    '<div class="tbl-wrap"><table class="dr-table"><thead><tr><th>DSI</th><th>Lines</th><th>Activator</th><th>Note</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

// ── STATUS BREAKDOWN ──────────────────────────────────────────────────────
var _DR_ST_CLS = {
  'Active':'sp-active','Posted':'sp-posted','Approved':'sp-posted','Confirmed':'sp-pale-yellow',
  'Canceled':'sp-canceled','Disconnected':'sp-disconnected',
  'Porting Issue':'sp-orange-bright','Pending Valid Payment':'sp-orange-bright',
  'BYOD':'sp-orange','Port Approved':'sp-dark-orange','Pending Order Port':'sp-dark-orange',
  'Delivered':'sp-purple','Shipped':'sp-yellow-bright','Scheduled':'sp-yellow',
  'Pending':'sp-pale-yellow','Pending Shipment':'sp-pale-yellow',
  'Null':'sp-pale-yellow','Open':'sp-pale-yellow','Backordered':'sp-pale-yellow','TOTAL':''
};
var _DR_CARD_STYLE = {
  'sp-active':        'background:rgba(74,222,128,.07);border-color:rgba(74,222,128,.22)',
  'sp-posted':        'background:rgba(34,197,94,.07);border-color:rgba(34,197,94,.22)',
  'sp-canceled':      'background:rgba(239,68,68,.07);border-color:rgba(239,68,68,.22)',
  'sp-disconnected':  'background:rgba(185,28,28,.1); border-color:rgba(185,28,28,.28)',
  'sp-orange-bright': 'background:rgba(251,146,60,.07);border-color:rgba(251,146,60,.22)',
  'sp-orange':        'background:rgba(249,115,22,.07);border-color:rgba(249,115,22,.22)',
  'sp-dark-orange':   'background:rgba(234,88,12,.07); border-color:rgba(234,88,12,.22)',
  'sp-purple':        'background:rgba(168,85,247,.07);border-color:rgba(168,85,247,.22)',
  'sp-yellow-bright': 'background:rgba(250,204,21,.07);border-color:rgba(250,204,21,.22)',
  'sp-yellow':        'background:rgba(234,179,8,.07); border-color:rgba(234,179,8,.22)',
  'sp-pale-yellow':   'background:rgba(254,240,138,.04);border-color:rgba(254,240,138,.14)',
  '':                 'background:var(--panel2-bg);border-color:var(--panel2-border)'
};
function _toggleHousing(id, uid) {
  var hdr  = document.getElementById('drhdr-' +id+uid);
  var body = document.getElementById('drbody-'+id+uid);
  if (!body) return;
  var open = body.style.display === 'block';
  body.style.display = open ? 'none' : 'block';
  if (hdr) { open ? hdr.classList.remove('open') : hdr.classList.add('open'); }
}

function _drSectionStatus(sb) {
  // Legacy: old reports saved as flat array
  if (Array.isArray(sb)) {
    if (!sb.length) return '';
    var total=sb.find(function(r){return r.status==='TOTAL';})||{customerRows:0,totalLines:0};
    var cards=sb.filter(function(r){return r.status!=='TOTAL';}).map(function(r){
      var cls=_DR_ST_CLS[r.status]||'';
      return '<div class="dr-status-card" style="'+(_DR_CARD_STYLE[cls]||_DR_CARD_STYLE[''])+'">'+
        '<span class="sp '+cls+'" style="font-size:.7rem">'+esc(r.status)+'</span>'+
        '<div class="dr-sc-metrics">'+
          '<div class="dr-sc-metric"><div class="dr-sc-num">'+r.customerRows+'</div><div class="dr-sc-lbl">Customers</div></div>'+
          '<div class="dr-sc-divider"></div>'+
          '<div class="dr-sc-metric"><div class="dr-sc-num">'+r.totalLines+'</div><div class="dr-sc-lbl">Lines</div></div>'+
        '</div></div>';
    }).join('');
    var tot='<div class="dr-status-card dr-sc-total"><span class="dr-sc-total-label">Total</span><div class="dr-sc-total-nums"><span><span class="dr-sc-total-big">'+total.customerRows+'</span> <span class="dr-sc-total-sub">customers</span></span><span><span class="dr-sc-total-big">'+total.totalLines+'</span> <span class="dr-sc-total-sub">lines</span></span></div></div>';
    return '<div class="dr-section"><div class="dr-sec-hdr">Order Status Breakdown</div><div class="dr-status-cards">'+cards+tot+'</div></div>';
  }
  if (!sb || typeof sb !== 'object') return '';
  var uid = '_'+Date.now();
  function _subCards(sub) {
    return (sub||[]).map(function(s){
      var cls=_DR_ST_CLS[s.status]||'';
      return '<div class="dr-status-card" style="'+(_DR_CARD_STYLE[cls]||_DR_CARD_STYLE[''])+'">'+
        '<span class="sp '+cls+'" style="font-size:.7rem">'+esc(s.status)+'</span>'+
        '<div class="dr-sc-metrics">'+
          '<div class="dr-sc-metric"><div class="dr-sc-num">'+s.customers+'</div><div class="dr-sc-lbl">Customers</div></div>'+
          '<div class="dr-sc-divider"></div>'+
          '<div class="dr-sc-metric"><div class="dr-sc-num">'+s.lines+'</div><div class="dr-sc-lbl">Lines</div></div>'+
        '</div></div>';
    }).join('');
  }
  function _hCell(id, label, color, data) {
    if (!data||(!data.customers&&!data.lines)) return '';
    var hid='drhdr-'+id+uid, bid='drbody-'+id+uid;
    return '<div class="dr-housing-cell">'+
      '<div class="dr-housing-hdr dr-housing-hdr-'+color+'" id="'+hid+'" onclick="_toggleHousing(\''+id+'\',\''+uid+'\')">'+
        '<span class="dr-housing-label">'+esc(label)+'</span>'+
        '<div class="dr-housing-counts"><span>'+data.customers+' customers</span><span>'+data.lines+' lines</span></div>'+
        '<span class="dr-housing-arrow">▾</span>'+
      '</div>'+
      '<div class="dr-housing-body dr-housing-body-'+color+'" id="'+bid+'">'+
        '<div class="dr-status-cards" style="padding:4px 0">'+_subCards(data.sub)+'</div>'+
      '</div>'+
    '</div>';
  }
  function _niCell(data){
    if(!data||(!data.customers&&!data.lines)) return '';
    var hid='drhdr-ni'+uid, bid='drbody-ni'+uid, v=data.voip||{};
    function _st(k,val){ return '<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 10px;font-size:.8rem"><span style="color:var(--text2)">'+k+'</span><span style="font-weight:600">'+(val||0)+'</span></div>'; }
    var summary='<div style="background:var(--panel2-bg);border:1px solid var(--panel2-border);border-radius:6px;padding:5px 0;margin:4px 0 8px">'+
      _st('New', data.newOrders)+
      _st('Existing (upgrade)', data.existingOrders)+
      _st('VoIPs attached (total)', v.total)+
      _st('Orders with VoIP', v.ordersWith)+
      _st('Orders without VoIP', v.ordersWithout)+
    '</div>';
    return '<div class="dr-housing-cell">'+
      '<div class="dr-housing-hdr dr-housing-hdr-yellow" id="'+hid+'" onclick="_toggleHousing(\'ni\',\''+uid+'\')">'+
        '<span class="dr-housing-label">New Internet</span>'+
        '<div class="dr-housing-counts"><span>'+data.customers+' orders</span><span>'+data.lines+' lines</span></div>'+
        '<span class="dr-housing-arrow">▾</span>'+
      '</div>'+
      '<div class="dr-housing-body dr-housing-body-yellow" id="'+bid+'">'+
        summary+
        '<div class="dr-status-cards" style="padding:4px 0">'+_subCards(data.sub)+'</div>'+
      '</div>'+
    '</div>';
  }
  var total=sb.total||{customers:0,lines:0};
  var tot='<div class="dr-status-card dr-sc-total"><span class="dr-sc-total-label">Total</span><div class="dr-sc-total-nums"><span><span class="dr-sc-total-big">'+total.customers+'</span> <span class="dr-sc-total-sub">customers</span></span><span><span class="dr-sc-total-big">'+total.lines+'</span> <span class="dr-sc-total-sub">lines</span></span></div></div>';
  return '<div class="dr-section">'+
    '<div class="dr-sec-hdr">Order Status Breakdown</div>'+
    _hCell('co','Completed Orders','green', sb.completedOrders)+
    _hCell('oi','Order Issues',    'orange',sb.orderIssues)+
    _hCell('ap','All Pending Lines','purple',sb.allPendingLines)+
    _niCell(sb.newInternet||sb.fiber)+
    '<div class="dr-status-cards" style="margin-top:8px">'+tot+'</div>'+
  '</div>';
}

// ── ACTIVATION RATES ──────────────────────────────────────────────────────
var _DR_AR_BUCKETS = ['0-7 Days','8-14 Days','15-30 Days','31-60 Days'];
function _drArCls(vol,acts,bkt) {
  if (!vol) return '';
  var p=acts/vol*100;
  if (bkt==='0-7 Days')   return p>=21?'ar-green':p>=10?'ar-yellow':'ar-red';
  if (bkt==='8-14 Days')  return p>=71?'ar-green':p>=51?'ar-yellow':'ar-red';
  if (bkt==='15-30 Days') return p>=75?'ar-green':p>=70?'ar-yellow':'ar-red';
  if (bkt==='31-60 Days') return p>=86?'ar-green':p>=79?'ar-yellow':'ar-red';
  return '';
}
function _drArCell(bktData,bkt) {
  if (!bktData||!bktData.vol) return '<td class="ar-cell"></td>';
  var vol=bktData.vol,acts=bktData.acts||0,p=Math.round(acts/vol*100);
  var cls=_drChurnCls(bktData.color)||_drArCls(vol,acts,bkt);   // Tableau color, else fixed threshold
  return '<td class="ar-cell"><span class="ar-badge '+cls+'">'+p+'% ('+acts+'/'+vol+')</span></td>';
}
function _drSectionActivation(arSummary) {
  var officeTotal=arSummary.officeTotal||{},repImpact=arSummary.repImpact||[];
  if (!Object.keys(officeTotal).length&&!repImpact.length) return '';
  var hdr='<th>Rep</th>'+
    _DR_AR_BUCKETS.map(function(b){return '<th style="min-width:100px">'+esc(b)+'</th>';}).join('');
  var totRow='<tr class="ar-grand-row"><td class="ar-rep ar-grand-rep">Grand Total</td>'+
    _DR_AR_BUCKETS.map(function(b){return _drArCell(officeTotal[b],b);}).join('')+'</tr>';
  var repRows=repImpact.map(function(r){
    return '<tr><td class="ar-rep">'+esc(r.rep)+'</td>'+
      _DR_AR_BUCKETS.map(function(b){return _drArCell(r.buckets[b],b);}).join('')+'</tr>';
  }).join('');
  return '<div class="dr-section"><div class="dr-sec-hdr">Activation Rates '+
    '<span class="dr-subhdr">office summary + bottom 5 reps</span></div>'+
    '<div class="tbl-wrap"><table class="call-table"><thead><tr>'+hdr+
    '</tr></thead><tbody>'+totRow+repRows+'</tbody></table></div></div>';
}

// ── CHURN RATES ───────────────────────────────────────────────────────────
var _DR_CHURN_BUCKETS = ['0-30 Day','30 Day','60 Day','90 Day','120 Day'];
var _DR_CHURN_THRESH  = {'0-30 Day':[2.4,3.0],'30 Day':[4.9,6.9],'60 Day':[8.9,9.9],'90 Day':[10.9,13.9],'120 Day':[13.9,17.9]};
function _drChurnCls(color) {
  var c=String(color||'').toLowerCase();
  if (c.indexOf('green')!==-1) return 'ar-green';
  if (c.indexOf('red')!==-1||c.indexOf('orange')!==-1) return 'ar-red';
  if (c.indexOf('yellow')!==-1||c.indexOf('blue')!==-1) return 'ar-yellow';
  return '';
}
function _drChurnTotalCls(bkt,pct) {
  var t=_DR_CHURN_THRESH[bkt]; if (!t) return '';
  return pct<=t[0]?'ar-green':pct<=t[1]?'ar-yellow':'ar-red';
}
function _drChurnCell(bktData,bkt,isTotal) {
  if (!bktData||!bktData.acts) return '<td class="ar-cell"></td>';
  var disco=bktData.disco||0,acts=bktData.acts,pct=disco/acts*100;
  var cls=_drChurnCls(bktData.color||'')||(isTotal?_drChurnTotalCls(bkt,pct):'');   // Tableau color (total now carries one), else threshold
  return '<td class="ar-cell"><span class="ar-badge '+cls+'">'+pct.toFixed(1)+'% ('+disco+'/'+acts+')</span></td>';
}
function _drSectionChurn(churnSummary) {
  var officeTotal=churnSummary.officeTotal||{},repImpact=churnSummary.repImpact||[];
  if (!Object.keys(officeTotal).length&&!repImpact.length) return '';
  var hdr='<th>Rep</th>'+
    _DR_CHURN_BUCKETS.map(function(b){return '<th style="min-width:90px">'+esc(b)+'</th>';}).join('');
  var totRow='<tr class="ar-grand-row"><td class="ar-rep ar-grand-rep">Grand Total</td>'+
    _DR_CHURN_BUCKETS.map(function(b){return _drChurnCell(officeTotal[b],b,true);}).join('')+'</tr>';
  var repRows=repImpact.map(function(r){
    return '<tr><td class="ar-rep">'+esc(r.rep)+'</td>'+
      _DR_CHURN_BUCKETS.map(function(b){return _drChurnCell(r.buckets[b],b,false);}).join('')+'</tr>';
  }).join('');
  return '<div class="dr-section"><div class="dr-sec-hdr">Churn Rates '+
    '<span class="dr-subhdr">office summary + top 5 reps by 0-30 Day disconnects</span></div>'+
    '<div class="tbl-wrap"><table class="call-table"><thead><tr>'+hdr+
    '</tr></thead><tbody>'+totRow+repRows+'</tbody></table></div></div>';
}

// ── CALLS WORKED ──────────────────────────────────────────────────────────
function _drProductPills(pc) {
  return Object.keys(pc||{}).map(function(p){
    return '<span class="pill-product">'+esc(p)+' &times;'+pc[p]+'</span>';
  }).join('');
}
function _drStatusPills(sc) {
  return Object.keys(sc||{}).map(function(s){
    return '<span class="status-pill '+esc(_DR_ST_CLS[s]||'')+'">'+esc(s)+' &times;'+sc[s]+'</span>';
  }).join(' ');
}
function _drNoteItems(notes) {
  if (!notes||!notes.length) return '<span class="dr-muted">No notes</span>';
  return notes.map(function(n){
    var timeStr='';
    try{var td=new Date(n.ts);timeStr=td.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});}catch(e){}
    return '<div class="dr-note-item"><span class="dr-note-who">'+esc(n.authorName||'Unknown')+'</span>'+
      (timeStr?'<span class="dr-note-time"> '+esc(timeStr)+'</span>':'')+
      ' — '+esc(n.noteText)+'</div>';
  }).join('');
}
// Quiet one-line order summary (date · products · statuses) — replaces the pill rainbow.
function _drOrderLine(e) {
  var parts=[];
  var dt=_drFmtDate(e.orderDate); if (dt&&dt!=='—') parts.push(dt);
  var prods=Object.keys(e.productCounts||{}).map(function(p){return p+' ×'+e.productCounts[p];});
  if (prods.length) parts.push(prods.join(', '));
  var stats=Object.keys(e.statusCounts||{}).map(function(s){return s+' ×'+e.statusCounts[s];});
  if (stats.length) parts.push(stats.join(', '));
  return parts.join(' · ');
}
function _drCwGroup(entries,label,cls,dup) {
  if (!entries||!entries.length) return '';
  dup = dup || {esc:{},na:{}};
  var rows=entries.map(function(e){
    var detail=_drOrderLine(e);
    var notesCell;
    if (dup.esc&&dup.esc[e.dsi])      notesCell='<span class="dr-muted">↑ Notes under Escalations</span>';
    else if (dup.na&&dup.na[e.dsi])   notesCell='<span class="dr-muted">↑ Notes under No Answers</span>';
    else                              notesCell=_drNoteItems(e.notes);
    return '<tr>'+
      '<td class="dr-nw">'+esc(e.rep||'—')+'</td>'+
      '<td>'+_drDsiCell(e.dsi)+(detail?'<div class="dr-cw-detail">'+esc(detail)+'</div>':'')+'</td>'+
      '<td class="dr-notes-cell">'+notesCell+'</td>'+
      '</tr>';
  }).join('');
  return '<div class="dr-cw-group">'+
    '<div class="dr-cw-group-hdr '+cls+'">'+esc(label)+' <span class="dr-cw-cnt">'+entries.length+'</span></div>'+
    '<div class="tbl-wrap"><table class="dr-table"><thead><tr>'+
    '<th>Rep</th><th>Order</th><th>Notes</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}
function _drSectionCallsWorked(cw, dup) {
  var total=(cw.dayafter||[]).length+(cw.delivered||[]).length+(cw.issues||[]).length+(cw.other||[]).length;
  if (!total) return '<div class="dr-section"><div class="dr-sec-hdr">Calls Worked That Day</div>'+
    '<div class="dr-muted" style="padding:.5rem .25rem">No notes recorded for this date.</div></div>';
  return '<div class="dr-section"><div class="dr-sec-hdr">Calls Worked That Day '+
    '<span class="dr-subhdr">'+total+' orders with notes</span></div>'+
    _drCwGroup(cw.dayafter||[],  'Day-After',            'dr-cw-da',    dup)+
    _drCwGroup(cw.issues||[],    'Order Issues',         'dr-cw-oi',    dup)+
    _drCwGroup(cw.delivered||[], 'Delivered Not Active', 'dr-cw-dna',   dup)+
    _drCwGroup(cw.other||[],     'Other',                'dr-cw-other', dup)+
    '</div>';
}

// ── NO ANSWERS ────────────────────────────────────────────────────────────
function _drSectionNoAnswers(list) {
  if (!list||!list.length) return '';
  var rows=list.map(function(e){
    return '<tr>'+
      '<td><span class="dsi-link" onclick="copyDsiAndOpen(\''+esc(e.dsi)+'\')">'+esc(e.dsi)+'</span></td>'+
      '<td class="dr-notes-cell">'+_drNoteItems(e.notes)+'</td></tr>';
  }).join('');
  return '<div class="dr-section"><div class="dr-sec-hdr">No Answers That Day '+
    '<span class="dr-subhdr">'+list.length+' orders marked No Answer</span></div>'+
    '<table class="dr-table"><thead><tr><th>DSI</th><th>Notes</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

// ── ESCALATIONS ───────────────────────────────────────────────────────────
function _drSectionEscalations(list) {
  if (!list||!list.length) return '';
  var rows=list.map(function(e){
    var rpCls=e.rating==='1 Star'?'rp-1':'rp-2';
    return '<tr>'+
      '<td><span class="rating-pill '+rpCls+'">'+esc(e.rating)+'</span></td>'+
      '<td><span class="dsi-link" onclick="copyDsiAndOpen(\''+esc(e.dsi)+'\')">'+esc(e.dsi)+'</span></td>'+
      '<td class="dr-notes-cell">'+_drNoteItems(e.notes)+'</td></tr>';
  }).join('');
  return '<div class="dr-section"><div class="dr-sec-hdr">Escalations That Day '+
    '<span class="dr-subhdr">'+list.length+' orders rated 1–2 Stars</span></div>'+
    '<table class="dr-table"><thead><tr><th>Rating</th><th>DSI</th><th>Notes</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

// ── APPOINTMENTS & BOOKINGS (Phase 2 #1b → 3-group, clean layout) ─────────
function _drApptTime(t){ if(!t) return ''; var p=String(t).split(':'); var h=+p[0],m=p[1]; return ((h%12)||12)+':'+m+' '+(h>=12?'PM':'AM'); }
function _drApptOutcomeLabel(o){ var m={completed:'✓ Completed','no-show':'✗ No-Show',rescheduled:'↻ Rescheduled',canceled:'⊘ Canceled'}; return m[o]||'—'; }
var _DR_OUTCOME_COLOR={completed:'#52c785','no-show':'#e9756a',rescheduled:'#f0995a',canceled:'#cf6b62'};
function _drOutcomePill(o){
  var c=_DR_OUTCOME_COLOR[o]||'#9aa0a6';
  return '<span style="display:inline-block;padding:2px 9px;border-radius:12px;font-size:.72rem;font-weight:700;background:'+c+'22;color:'+c+'">'+esc(_drApptOutcomeLabel(o))+'</span>';
}
function _drDsiCell(dsi){ return dsi?'<span class="dsi-link" onclick="copyDsiAndOpen(\''+esc(dsi)+'\')">'+esc(dsi)+'</span>':'<span class="dr-muted">—</span>'; }
// One quiet grey line of nonzero outcome counts (replaces the chip rainbow).
function _drOutcomeBreakdown(o, includeUnmarked){
  var parts=[];
  if(o.completed)   parts.push(o.completed+' completed');
  if(o.noShow)      parts.push(o.noShow+' no-show');
  if(o.rescheduled) parts.push(o.rescheduled+' rescheduled');
  if(o.canceled)    parts.push(o.canceled+' canceled');
  if(includeUnmarked && o.unmarked) parts.push(o.unmarked+' unmarked');
  return parts.join(' · ');
}
// Tooltip for secondary detail kept off the main grid.
function _drApptTip(x){
  var bits=[];
  if(x.services) bits.push('Services: '+x.services+(x.devices?' ('+x.devices+' device'+(x.devices>1?'s':'')+')':''));
  else if(x.devices) bits.push(x.devices+' device'+(x.devices>1?'s':''));
  if(x.booker) bits.push('Booked by '+x.booker);
  return bits.length?' title="'+esc(bits.join(' · '))+'"':'';
}

function _drSectionAppointments(ap) {
  if (!ap) return '';
  var s  = ap.scheduled || {total:0,completed:0,noShow:0,rescheduled:0,canceled:0,unmarked:0,list:[],byActivator:[]};
  var bk = ap.booked || {total:(ap.bookedToday||0),list:[]};
  var sc = ap.statusChanges || {total:0,completed:0,noShow:0,rescheduled:0,canceled:0,list:[]};
  if (!s.total && !bk.total && !sc.total && !ap.bookedToday && !ap.tomorrow) {
    return '<div class="dr-section"><div class="dr-sec-hdr">Appointments &amp; Bookings</div>'+
      '<div class="dr-muted" style="padding:.5rem .25rem">No appointment activity for this date.</div></div>';
  }
  function group(label,cnt,breakdown,inner){
    return '<div class="dr-appt-group">'+
      '<div class="dr-appt-ghdr">'+label+'<span class="dr-appt-gcnt">'+cnt+'</span>'+
        (breakdown?'<span class="dr-appt-gbd">'+breakdown+'</span>':'')+'</div>'+
      inner+'</div>';
  }

  // ── Group 1: Booked that day ── Time · Date · Customer · DSI · Activator
  var bookedHtml='';
  if (bk.total) {
    var inner;
    if ((bk.list||[]).length) {
      var bRows=bk.list.map(function(x){
        return '<tr'+_drApptTip(x)+'><td class="dr-nw">'+esc(_drApptTime(x.timeSlot))+'</td>'+
          '<td class="dr-nw">'+esc(_drFmtDate(x.forDate))+'</td>'+
          '<td>'+esc(x.customer||'—')+'</td>'+
          '<td class="dr-nw">'+_drDsiCell(x.dsi)+'</td>'+
          '<td>'+esc(x.activator||'—')+'</td></tr>';
      }).join('');
      inner='<div class="tbl-wrap"><table class="dr-table"><thead><tr><th>Time</th><th>Date</th><th>Customer</th><th>DSI</th><th>Activator</th></tr></thead><tbody>'+bRows+'</tbody></table></div>';
    } else { inner='<div class="dr-muted" style="padding:.2rem .1rem">'+bk.total+' booked.</div>'; }
    bookedHtml=group(icon('appointments')+' Booked That Day',bk.total,'',inner);
  }

  // ── Group 2: Scheduled this day ── Time · Customer · DSI · Activator · Outcome
  var schedHtml='';
  if (s.total) {
    var sRows=(s.list||[]).map(function(x){
      return '<tr'+_drApptTip(x)+'><td class="dr-nw">'+esc(_drApptTime(x.timeSlot))+'</td>'+
        '<td>'+esc(x.customer||'—')+'</td>'+
        '<td class="dr-nw">'+_drDsiCell(x.dsi)+'</td>'+
        '<td>'+esc(x.activator||'—')+'</td>'+
        '<td>'+(x.outcome?_drOutcomePill(x.outcome):'<span class="dr-muted">— not marked</span>')+'</td></tr>';
    }).join('');
    var sInner='<div class="tbl-wrap"><table class="dr-table"><thead><tr><th>Time</th><th>Customer</th><th>DSI</th><th>Activator</th><th>Outcome</th></tr></thead><tbody>'+sRows+'</tbody></table></div>';
    schedHtml=group(icon('appointments')+' Scheduled For This Day',s.total,_drOutcomeBreakdown(s,true),sInner);
  }

  // ── Group 3: Status changed that day ── Outcome · Customer · DSI · Activator · When
  var changeHtml='';
  if (sc.total) {
    var cRows=(sc.list||[]).map(function(x){
      return '<tr><td>'+_drOutcomePill(x.outcome)+'</td>'+
        '<td>'+esc(x.customer||'—')+'</td>'+
        '<td class="dr-nw">'+_drDsiCell(x.dsi)+'</td>'+
        '<td>'+esc(x.activator||'—')+'</td>'+
        '<td class="dr-nw">'+esc(_drFmtDate(x.apptDate))+' · '+esc(_drApptTime(x.timeSlot))+'</td></tr>';
    }).join('');
    var cInner='<div class="tbl-wrap"><table class="dr-table"><thead><tr><th>Outcome</th><th>Customer</th><th>DSI</th><th>Activator</th><th>Appt</th></tr></thead><tbody>'+cRows+'</tbody></table></div>';
    changeHtml=group(icon('refresh')+' Status Changed That Day',sc.total,_drOutcomeBreakdown(sc,false),cInner);
  }

  var sub=(bk.total||0)+' booked · '+(s.total||0)+' scheduled · '+(sc.total||0)+' status changes'+
    (ap.tomorrow?' · '+ap.tomorrow+' tomorrow':'');
  return '<div class="dr-section"><div class="dr-sec-hdr">Appointments &amp; Bookings '+
    '<span class="dr-subhdr">'+sub+'</span></div>'+
    bookedHtml+schedHtml+changeHtml+'</div>';
}

// ── EMAIL COPY ───────────────────────────────────────────────────────────
function drCopyEmail() {
  if (!_DR_DATA) { _drToast('Generate a report first.'); return; }
  var html = _drBuildEmailHtml();
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
    navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'})})]).then(function(){
      _drToast('Copied! Paste into your email.');
    }).catch(function(){ _drFallbackCopy(html); });
  } else { _drFallbackCopy(html); }
}
function _drFallbackCopy(html) {
  var el=document.createElement('div');
  el.innerHTML=html;
  el.style.cssText='position:fixed;top:-9999px;left:-9999px;opacity:.01;';
  document.body.appendChild(el);
  var r=document.createRange(); r.selectNodeContents(el);
  var s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  try { document.execCommand('copy'); _drToast('Copied! Paste into your email.'); }
  catch(e) { _drToast('Copy failed — try Chrome or Edge.'); }
  s.removeAllRanges(); document.body.removeChild(el);
}
function _drToast(msg) {
  var t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f8fafc;padding:10px 20px;border-radius:8px;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:none';
  document.body.appendChild(t);
  setTimeout(function(){if(document.body.contains(t))document.body.removeChild(t);},3000);
}

function _drBuildEmailHtml() {
  var rpt=_DR_DATA; if (!rpt) return '';
  var BR=_drReportBrand((typeof CFG!=='undefined')?CFG.officeId:'');
  var logoUrl=BR.logo?(DR_ASSET_BASE+BR.logo):'';
  var selDate=_DR_SEL_DATE||_drTodayStr();
  var d=new Date(selDate+'T12:00:00');
  var DN=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var dayLabel=DN[d.getDay()]+', '+MN[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();

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

  function eArCls(vol,acts,bkt){
    if (!vol) return BADGE+';background:#e2e8f0;color:#334155';
    var p=acts/vol*100;
    if (bkt==='0-7 Days')   return p>=21?GRN:p>=10?YEL:RED;
    if (bkt==='8-14 Days')  return p>=71?GRN:p>=51?YEL:RED;
    if (bkt==='15-30 Days') return p>=75?GRN:p>=70?YEL:RED;
    if (bkt==='31-60 Days') return p>=86?GRN:p>=79?YEL:RED;
    return BADGE+';background:#e2e8f0;color:#334155';
  }
  function eArCell(bd,bkt){
    if (!bd||!bd.vol) return '<td style="'+TD+'"></td>';
    var p=Math.round(bd.acts/bd.vol*100);
    var cc=String(bd.color||'').toLowerCase();
    var sty=cc.indexOf('green')!==-1?GRN:(cc.indexOf('red')!==-1||cc.indexOf('orange')!==-1)?RED:(cc.indexOf('yellow')!==-1||cc.indexOf('blue')!==-1)?YEL:eArCls(bd.vol,bd.acts,bkt);
    return '<td style="'+TD+'"><span style="'+sty+'">'+p+'% ('+bd.acts+'/'+bd.vol+')</span></td>';
  }
  function eCrTotCls(bkt,pct){
    var t={'0-30 Day':[2.4,3.0],'30 Day':[4.9,6.9],'60 Day':[8.9,9.9],'90 Day':[10.9,13.9],'120 Day':[13.9,17.9]};
    var th=t[bkt]; if (!th) return BADGE+';background:#e2e8f0;color:#334155';
    return pct<=th[0]?GRN:pct<=th[1]?YEL:RED;
  }
  function eCrRepCls(color){
    var c=String(color||'').toLowerCase();
    if (c.indexOf('green')!==-1) return GRN;
    if (c.indexOf('red')!==-1||c.indexOf('orange')!==-1) return RED;
    if (c.indexOf('yellow')!==-1||c.indexOf('blue')!==-1) return YEL;
    return BADGE+';background:#e2e8f0;color:#334155';
  }
  function eCrCell(bd,bkt,isT){
    if (!bd||!bd.acts) return '<td style="'+TD+'"></td>';
    var disco=bd.disco||0,pct=disco/bd.acts*100;
    var cc=String(bd.color||'').toLowerCase();
    var sty=cc.indexOf('green')!==-1?GRN:(cc.indexOf('red')!==-1||cc.indexOf('orange')!==-1)?RED:(cc.indexOf('yellow')!==-1||cc.indexOf('blue')!==-1)?YEL:(isT?eCrTotCls(bkt,pct):eCrRepCls(bd.color||''));
    return '<td style="'+TD+'"><span style="'+sty+'">'+pct.toFixed(1)+'% ('+disco+'/'+bd.acts+')</span></td>';
  }

  // KPI summary tiles (light, email-safe inline-block)
  var cats=rpt.callCategories||{};
  var eAp=rpt.appointments||{};
  var eBk=eAp.booked||{total:(eAp.bookedToday||0)};
  var eSc=eAp.statusChanges||{completed:0};
  var eAct=rpt.activatedToday||{lines:0,orders:0};
  var daT=cats.dayAfterTotal||0,daW=cats.dayAfterWorked||0;
  var covPct=daT>0?Math.round(daW/daT*100):null;
  var covColor=covPct===null?'#64748b':covPct>=80?'#16a34a':covPct>=50?'#ca8a04':'#dc2626';
  function eTile(value,label,accent,sub){
    return '<div style="display:inline-block;vertical-align:top;background:#f8fafc;border:1px solid #e2e8f0;border-top:3px solid '+accent+';border-radius:8px;padding:9px 13px;margin:0 6px 6px 0;min-width:92px">'+
      '<div style="font-size:20px;font-weight:800;color:#0f172a;line-height:1">'+value+'</div>'+
      '<div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;font-weight:700;margin-top:3px">'+label+'</div>'+
      (sub?'<div style="font-size:10px;color:#94a3b8;margin-top:1px">'+sub+'</div>':'')+
    '</div>';
  }
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

  // Status breakdown — housing cells
  var EC={'sp-active':'background:#f0fdf4;border:1px solid #86efac','sp-posted':'background:#f0fdf4;border:1px solid #4ade80','sp-canceled':'background:#fef2f2;border:1px solid #fca5a5','sp-disconnected':'background:#fff1f2;border:1px solid #fda4af','sp-orange-bright':'background:#fff7ed;border:1px solid #fdba74','sp-orange':'background:#fff7ed;border:1px solid #fb923c','sp-dark-orange':'background:#fff7ed;border:1px solid #f97316','sp-purple':'background:#faf5ff;border:1px solid #d8b4fe','sp-yellow-bright':'background:#fefce8;border:1px solid #fde047','sp-yellow':'background:#fefce8;border:1px solid #fde68a','sp-pale-yellow':'background:#fefce8;border:1px solid #fef08a','':'background:#f8fafc;border:1px solid #e2e8f0'};
  var HOUSING_HDR={'green':'background:#f0fdf4;border:1px solid #86efac;color:#166534','orange':'background:#fff7ed;border:1px solid #fdba74;color:#9a3412','purple':'background:#faf5ff;border:1px solid #d8b4fe;color:#581c87','yellow':'background:#fefce8;border:1px solid #fde68a;color:#713f12'};
  function eSubCards(sub){
    return (sub||[]).map(function(s){
      var cls=_DR_ST_CLS[s.status]||'';
      return '<div style="display:inline-block;'+(EC[cls]||EC[''])+';border-radius:6px;padding:7px 9px;text-align:center;vertical-align:top;margin:3px;min-width:90px">'+
        '<div style="padding:1px 7px;border-radius:3px;font-size:11px;font-weight:700;'+(PILL_MAP[cls]||PILL_MAP[''])+'">'+esc(s.status)+'</div>'+
        '<table style="width:100%;border-collapse:collapse;margin-top:4px"><tr>'+
          '<td style="text-align:center;padding:2px 3px;border:none"><div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1">'+s.customers+'</div><div style="font-size:9px;color:#64748b;text-transform:uppercase">Customers</div></td>'+
          '<td style="width:1px;background:#e2e8f0;padding:0;border:none"></td>'+
          '<td style="text-align:center;padding:2px 3px;border:none"><div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1">'+s.lines+'</div><div style="font-size:9px;color:#64748b;text-transform:uppercase">Lines</div></td>'+
        '</tr></table></div>';
    }).join('');
  }
  function eHousingCell(label,colorKey,data){
    if (!data||(!data.customers&&!data.lines)) return '';
    var hdrStyle=HOUSING_HDR[colorKey]||HOUSING_HDR['green'];
    return '<details style="margin-bottom:8px;border-radius:8px;overflow:hidden">'+
      '<summary style="'+hdrStyle+';padding:9px 13px;font-size:13px;font-weight:700;cursor:pointer;list-style:none;display:block">'+
        esc(label)+
        ' &nbsp;<span style="font-size:11px;font-weight:400">'+data.customers+' customers &nbsp;·&nbsp; '+data.lines+' lines</span>'+
        '&nbsp;&nbsp;<span style="font-size:11px;opacity:.7">▾</span>'+
      '</summary>'+
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:6px">'+eSubCards(data.sub)+'</div>'+
    '</details>';
  }
  function eNiCell(data){
    if (!data||(!data.customers&&!data.lines)) return '';
    var hdrStyle=HOUSING_HDR['yellow'], v=data.voip||{};
    function row(k,val){ return '<tr><td style="padding:3px 12px;font-size:12px;color:#475569;border:none">'+k+'</td><td style="padding:3px 12px;font-size:12px;font-weight:700;color:#0f172a;text-align:right;border:none">'+(val||0)+'</td></tr>'; }
    var summary='<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px">'+
      row('New',data.newOrders)+row('Existing (upgrade)',data.existingOrders)+
      row('VoIPs attached (total)',v.total)+row('Orders with VoIP',v.ordersWith)+row('Orders without VoIP',v.ordersWithout)+
    '</table>';
    return '<details style="margin-bottom:8px;border-radius:8px;overflow:hidden">'+
      '<summary style="'+hdrStyle+';padding:9px 13px;font-size:13px;font-weight:700;cursor:pointer;list-style:none;display:block">'+
        'New Internet'+
        ' &nbsp;<span style="font-size:11px;font-weight:400">'+data.customers+' orders &nbsp;·&nbsp; '+data.lines+' lines</span>'+
        '&nbsp;&nbsp;<span style="font-size:11px;opacity:.7">▾</span>'+
      '</summary>'+
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:6px">'+summary+eSubCards(data.sub)+'</div>'+
    '</details>';
  }
  var sbRaw=rpt.statusBreakdown||{};
  var sbTotal=Array.isArray(sbRaw)
    ? (sbRaw.find(function(r){return r.status==='TOTAL';})||{customerRows:0,totalLines:0})
    : (sbRaw.total||{customers:0,lines:0});
  var sbTotCust=sbTotal.customers||sbTotal.customerRows||0;
  var sbTotLines=sbTotal.lines||sbTotal.totalLines||0;
  var sbContent='';
  if (Array.isArray(sbRaw)) {
    sbContent=sbRaw.filter(function(r){return r.status!=='TOTAL';}).map(function(r){
      var cls=_DR_ST_CLS[r.status]||'';
      return '<div style="display:inline-block;'+(EC[cls]||EC[''])+';border-radius:6px;padding:7px 9px;text-align:center;vertical-align:top;margin:3px;min-width:90px">'+
        '<div style="padding:1px 7px;border-radius:3px;font-size:11px;font-weight:700;'+(PILL_MAP[cls]||PILL_MAP[''])+'">'+esc(r.status)+'</div>'+
        '<table style="width:100%;border-collapse:collapse;margin-top:4px"><tr>'+
          '<td style="text-align:center;padding:2px 3px;border:none"><div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1">'+r.customerRows+'</div><div style="font-size:9px;color:#64748b;text-transform:uppercase">Customers</div></td>'+
          '<td style="width:1px;background:#e2e8f0;padding:0;border:none"></td>'+
          '<td style="text-align:center;padding:2px 3px;border:none"><div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1">'+r.totalLines+'</div><div style="font-size:9px;color:#64748b;text-transform:uppercase">Lines</div></td>'+
        '</tr></table></div>';
    }).join('');
  } else {
    sbContent=eHousingCell('Completed Orders','green', sbRaw.completedOrders)+
              eHousingCell('Order Issues',    'orange',sbRaw.orderIssues)+
              eHousingCell('All Pending Lines','purple',sbRaw.allPendingLines)+
              eNiCell(sbRaw.newInternet||sbRaw.fiber);
  }
  var sbTotalBar='<table style="width:100%;border-collapse:collapse;background:#f0f9ff;border:1px solid #bae6fd;border-radius:7px;margin-top:4px"><tr>'+
    '<td style="padding:9px 14px;border:none;font-size:12px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.06em">Total</td>'+
    '<td style="padding:9px 14px;border:none;text-align:right">'+
      '<span style="font-size:16px;font-weight:700;color:#0f172a">'+sbTotCust+'</span> <span style="font-size:11px;color:#64748b">customers</span>&nbsp;&nbsp;'+
      '<span style="font-size:16px;font-weight:700;color:#0f172a">'+sbTotLines+'</span> <span style="font-size:11px;color:#64748b">lines</span>'+
    '</td></tr></table>';
  var statusSec=eHdr('Order Status Breakdown')+'<div style="padding:6px 0">'+sbContent+'</div>'+sbTotalBar;

  // Activation rates
  var arSum=rpt.activationSummary||{},offAr=arSum.officeTotal||{},repAr=arSum.repImpact||[];
  var arHdr='<tr><th style="'+TH+'">Rep</th>'+_DR_AR_BUCKETS.map(function(b){return '<th style="'+TH+'">'+b+'</th>';}).join('')+'</tr>';
  var arTot='<tr><td style="'+TDG+'">Grand Total</td>'+_DR_AR_BUCKETS.map(function(b){return eArCell(offAr[b],b);}).join('')+'</tr>';
  var arReps=repAr.map(function(r,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(r.rep)+'</td>'+_DR_AR_BUCKETS.map(function(b){return eArCell(r.buckets[b],b);}).join('')+'</tr>';}).join('');
  var arSec=eHdr('Activation Rates — office summary + bottom 5 reps')+eTbl(arHdr,arTot+arReps);

  // Churn rates
  var crSum=rpt.churnSummary||{},offCr=crSum.officeTotal||{},repCr=crSum.repImpact||[];
  var CR_BKTS=['0-30 Day','30 Day','60 Day','90 Day','120 Day'];
  var crHdr='<tr><th style="'+TH+'">Rep</th>'+CR_BKTS.map(function(b){return '<th style="'+TH+'">'+b+'</th>';}).join('')+'</tr>';
  var crTot='<tr><td style="'+TDG+'">Grand Total</td>'+CR_BKTS.map(function(b){return eCrCell(offCr[b],b,true);}).join('')+'</tr>';
  var crReps=repCr.map(function(r,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(r.rep)+'</td>'+CR_BKTS.map(function(b){return eCrCell(r.buckets[b],b,false);}).join('')+'</tr>';}).join('');
  var crSec=eHdr('Churn Rates — office summary + top 5 reps by 0-30 Day disconnects')+eTbl(crHdr,crTot+crReps);

  // Calls worked — slim Rep | Order | Notes; notes dedupe to the highest-priority section.
  var cwDupEsc={},cwDupNa={};
  (rpt.escalations||[]).forEach(function(e){ if(e.dsi) cwDupEsc[e.dsi]=true; });
  (rpt.noAnswers||[]).forEach(function(e){ if(e.dsi) cwDupNa[e.dsi]=true; });
  function eOrderLine(e){
    var parts=[];
    var dt=_drFmtDate(e.orderDate); if(dt&&dt!=='—') parts.push(dt);
    var prods=Object.keys(e.productCounts||{}).map(function(p){return p+' ×'+e.productCounts[p];}); if(prods.length) parts.push(prods.join(', '));
    var stats=Object.keys(e.statusCounts||{}).map(function(s){return s+' ×'+e.statusCounts[s];}); if(stats.length) parts.push(stats.join(', '));
    return parts.join(' · ');
  }
  function eCwGroup(entries,label){
    if (!entries||!entries.length) return '';
    var rows=entries.map(function(e,i){
      var detail=eOrderLine(e);
      var notes;
      if (cwDupEsc[e.dsi])    notes='<span style="color:#94a3b8;font-size:11px">↑ Notes under Escalations</span>';
      else if (cwDupNa[e.dsi])notes='<span style="color:#94a3b8;font-size:11px">↑ Notes under No Answers</span>';
      else notes=(e.notes||[]).length?e.notes.map(function(n){return '<div style="margin:1px 0;font-size:11px"><b>'+esc(n.authorName||'?')+'</b>: '+esc(n.noteText)+'</div>';}).join(''):'<span style="color:#94a3b8;font-size:11px">No notes</span>';
      return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+';white-space:nowrap">'+esc(e.rep||'—')+'</td><td style="'+TD+'">'+esc(e.dsi)+(detail?'<div style="font-size:10px;color:#64748b;margin-top:2px">'+esc(detail)+'</div>':'')+'</td><td style="'+TD+'">'+notes+'</td></tr>';
    }).join('');
    return '<div style="margin-bottom:6px"><div style="'+SUB+'">'+esc(label)+' <span style="font-weight:400;color:#94a3b8;font-size:11px">('+entries.length+')</span></div>'+eTbl('<tr><th style="'+TH+'">Rep</th><th style="'+TH+'">Order</th><th style="'+TH+'">Notes</th></tr>',rows)+'</div>';
  }
  var cw=rpt.callsWorked||{};
  var cwTotal=(cw.dayafter||[]).length+(cw.delivered||[]).length+(cw.issues||[]).length+(cw.other||[]).length;
  var cwSec=cwTotal?eHdr('Calls Worked That Day ('+cwTotal+' orders)')+eCwGroup(cw.dayafter,'Day-After')+eCwGroup(cw.issues,'Order Issues')+eCwGroup(cw.delivered,'Delivered Not Active')+eCwGroup(cw.other,'Other'):'';

  // No answers
  var naList=rpt.noAnswers||[];
  var naSec='';
  if (naList.length) {
    var naRows=naList.map(function(e,i){
      var notes=(e.notes||[]).length?e.notes.map(function(n){return '<div style="font-size:11px"><b>'+esc(n.authorName||'?')+'</b>: '+esc(n.noteText)+'</div>';}).join(''):'<span style="color:#94a3b8;font-size:11px">No notes</span>';
      return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+';white-space:nowrap">'+esc(e.dsi)+'</td><td style="'+TD+'">'+notes+'</td></tr>';
    }).join('');
    naSec=eHdr('No Answers That Day ('+naList.length+')')+eTbl('<tr><th style="'+TH+'">DSI</th><th style="'+TH+'">Notes</th></tr>',naRows);
  }

  // Escalations
  var escList=rpt.escalations||[];
  var escSec='';
  if (escList.length) {
    var escRows=escList.map(function(e,i){
      var rbg=e.rating==='1 Star'?'#fee2e2':'#ffe4e6', rtx=e.rating==='1 Star'?'#991b1b':'#9f1239';
      var notes=(e.notes||[]).length?e.notes.map(function(n){return '<div style="font-size:11px"><b>'+esc(n.authorName||'?')+'</b>: '+esc(n.noteText)+'</div>';}).join(''):'<span style="color:#94a3b8;font-size:11px">No notes</span>';
      return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+';white-space:nowrap"><span style="background:'+rbg+';color:'+rtx+';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">'+esc(e.rating)+'</span></td><td style="'+TD+';white-space:nowrap">'+esc(e.dsi)+'</td><td style="'+TD+'">'+notes+'</td></tr>';
    }).join('');
    escSec=eHdr('Escalations That Day ('+escList.length+')')+eTbl('<tr><th style="'+TH+'">Rating</th><th style="'+TH+'">DSI</th><th style="'+TH+'">Notes</th></tr>',escRows);
  }

  // Today at a glance (one-line takeaway)
  var glParts=[];
  var gL=eAct.lines||0, gO=eAct.orders||0;
  glParts.push('<b>'+gL+'</b> line'+(gL===1?'':'s')+' activated'+(gO?' across <b>'+gO+'</b> order'+(gO===1?'':'s'):''));
  if (daT) glParts.push('<b>'+daW+'/'+daT+'</b> day-after calls worked');
  if (eAp.scheduled&&eAp.scheduled.total) glParts.push('<b>'+(eSc.completed||0)+'</b> appt'+((eSc.completed||0)===1?'':'s')+' completed'+(eSc.noShow?', <b>'+eSc.noShow+'</b> no-show':''));
  var gAttn=(cats.noAnswerTotal||0)+(cats.escalationTotal||0);
  if (gAttn) glParts.push('<b>'+gAttn+'</b> item'+(gAttn===1?'':'s')+' need attention');
  var glanceSec='<div style="font-size:13px;line-height:1.5;color:#1e293b;background:#f6f8fb;border:1px solid #e2e8f0;border-left:3px solid '+BR.accent+';border-radius:0 7px 7px 0;padding:10px 14px">'+glParts.join(' &nbsp;·&nbsp; ')+'</div>';

  // Lines Activated Today
  var actSec='';
  if ((eAct.list||[]).length) {
    var actRows=eAct.list.map(function(x,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(x.dsi)+'</td><td style="'+TD+'"><b>'+(x.lines||0)+'</b></td><td style="'+TD+'">'+esc(x.activator||'—')+'</td><td style="'+TD+'">'+esc(x.note||'—')+'</td></tr>';}).join('');
    actSec=eHdr('⚡ Lines Activated Today — '+eAct.lines+' line'+(eAct.lines===1?'':'s')+' across '+eAct.orders+' order'+(eAct.orders===1?'':'s'))+
      eTbl('<tr><th style="'+TH+'">DSI</th><th style="'+TH+'">Lines</th><th style="'+TH+'">Activator</th><th style="'+TH+'">Note</th></tr>',actRows);
  }

  // Appointments & bookings — 3 clean groups
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

      // Group 1: Booked that day — Time · Date · Customer · DSI · Activator
      var apBooked='';
      if (apbk.total) {
        var bRows=(apbk.list||[]).map(function(x,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(_drApptTime(x.timeSlot))+'</td><td style="'+TD+'">'+esc(_drFmtDate(x.forDate))+'</td><td style="'+TD+'">'+esc(x.customer||'—')+'</td><td style="'+TD+'">'+esc(x.dsi||'—')+'</td><td style="'+TD+'">'+esc(x.activator||'—')+'</td></tr>';}).join('');
        apBooked=eGroupBar('📅 Booked That Day ('+apbk.total+')','')+
          ((apbk.list||[]).length?eTbl('<tr><th style="'+TH+'">Time</th><th style="'+TH+'">Date</th><th style="'+TH+'">Customer</th><th style="'+TH+'">DSI</th><th style="'+TH+'">Activator</th></tr>',bRows):'');
      }

      // Group 2: Scheduled this day — Time · Customer · DSI · Activator · Outcome
      var apSched='';
      if (aps.total) {
        var apList=(aps.list||[]).length
          ? eTbl('<tr><th style="'+TH+'">Time</th><th style="'+TH+'">Customer</th><th style="'+TH+'">DSI</th><th style="'+TH+'">Activator</th><th style="'+TH+'">Outcome</th></tr>',
              aps.list.map(function(x,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+esc(_drApptTime(x.timeSlot))+'</td><td style="'+TD+'">'+esc(x.customer||'—')+'</td><td style="'+TD+'">'+esc(x.dsi||'—')+'</td><td style="'+TD+'">'+esc(x.activator)+'</td><td style="'+TD+'">'+(x.outcome?eOutcome(x.outcome):'<span style="color:#94a3b8">— not marked</span>')+'</td></tr>';}).join('')) : '';
        apSched=eGroupBar('🗓️ Scheduled For This Day ('+aps.total+')',eBd(aps,true))+apList;
      }

      // Group 3: Status changed that day — Outcome · Customer · DSI · Activator · Appt
      var apChange='';
      if (apsc.total) {
        var cRows=(apsc.list||[]).map(function(x,i){return '<tr'+(i%2?' style="'+ZEB+'"':'')+'><td style="'+TD+'">'+eOutcome(x.outcome)+'</td><td style="'+TD+'">'+esc(x.customer||'—')+'</td><td style="'+TD+'">'+esc(x.dsi||'—')+'</td><td style="'+TD+'">'+esc(x.activator||'—')+'</td><td style="'+TD+'">'+esc(_drFmtDate(x.apptDate))+' · '+esc(_drApptTime(x.timeSlot))+'</td></tr>';}).join('');
        apChange=eGroupBar('🔄 Status Changed That Day ('+apsc.total+')',eBd(apsc,false))+
          ((apsc.list||[]).length?eTbl('<tr><th style="'+TH+'">Outcome</th><th style="'+TH+'">Customer</th><th style="'+TH+'">DSI</th><th style="'+TH+'">Activator</th><th style="'+TH+'">Appt</th></tr>',cRows):'');
      }

      var apTitle='Appointments &amp; Bookings — '+(apbk.total||0)+' booked · '+(aps.total||0)+' scheduled · '+(apsc.total||0)+' changes'+(ap.tomorrow?' · '+ap.tomorrow+' tomorrow':'');
      apSec=eHdr(apTitle)+apBooked+apSched+apChange;
    }
  }

  var officeNm=(typeof CFG!=='undefined'&&CFG.officeName)?CFG.officeName:'';
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;background:#fff;max-width:960px;margin:0 auto;border:1px solid #e2e8f0;border-radius:9px;overflow:hidden">'+
    (logoUrl
      ? '<div style="background:'+BR.band+';text-align:center;padding:16px 20px'+(BR.band==='#ffffff'?';border-bottom:1px solid #eef1f5':'')+'">'+
          '<img src="'+logoUrl+'" alt="'+esc(officeNm)+'" style="max-height:'+BR.logoH+'px;max-width:240px;vertical-align:middle">'+
        '</div>'
      : '')+
    '<div style="background:'+BR.band+';padding:13px 22px">'+
      '<div style="font-size:15px;font-weight:700;color:'+BR.headerText+'">📋 Daily Call Report'+((!logoUrl&&officeNm)?' · '+esc(officeNm):'')+'</div>'+
      '<div style="font-size:12px;color:'+BR.headerSub+';margin-top:3px">'+esc(dayLabel)+' &nbsp;·&nbsp; Generated '+_drFmtTs(rpt.generatedAt)+'</div>'+
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
    '</div></div>';
}

