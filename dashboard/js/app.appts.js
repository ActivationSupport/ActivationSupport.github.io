// ── APPOINTMENTS ─────────────────────────────────────────────────────────
var _APPT = { activators:null, appointments:null, weekOffset:0, dayOffset:0, viewMode:'week', filterEmail:'', loading:false, blocked:{}, blockedLoaded:{} };

// Calendar/manual-block awareness for the grid. _APPT.blocked is keyed
// 'email|date' → { slot:true }. The backend (getOfficeBlocks) returns each
// activator's in-schedule slots that are unavailable (Google Calendar conflict,
// manual block, or buffer/cap) so blocked cells can render as 🔒 unavailable.
function _apptBlocked(email, ds, slot){ var m=_APPT.blocked[email+'|'+ds]; return (m && m[slot]) || ''; }
// Cross-office cell styling: each booking office's brand color + small logo
// (per-office tint, e.g. Viridian = their green). Parsed from the "Booked — <Office>"
// label; calendar/manual blocks have no office → generic red-hatch 🔒.
var OFFICE_BOOK_TINT = _ocfg('bookTint');   // derived from OFFICE_CONFIG in app.core.js
var OFFICE_BOOK_LOGO = _ocfg('bookLogo');
function _apptBlockOffice(label){
  if(!label || label.indexOf('Booked')!==0) return '';
  var p=label.split('—'); if(p.length<2) return '';
  var oid=p[1].trim().toLowerCase();
  return OFFICE_BOOK_TINT[oid] ? oid : '';
}
function _apptXofficeCell(label, oid){
  var c=OFFICE_BOOK_TINT[oid];
  return '<div class="appt-cal-cell appt-cell-blocked" style="background:'+_hexToRgba(c,.22)+';box-shadow:inset 3px 0 0 '+c+'" title="'+esc(label)+'"><img class="appt-xoffice-logo" src="assets/'+OFFICE_BOOK_LOGO[oid]+'" alt=""></div>';
}
// Fetch cross-office / calendar block state for `dates` (skips already-loaded +
// out-of-window). Stores into _APPT.blocked; resolves true if it actually fetched.
function _apptFetchBlocks(dates){
  var win=_apptWindow();
  var need=dates.filter(function(d){ return d>=win.min && d<=win.max && !_APPT.blockedLoaded[d]; });
  if(!need.length) return Promise.resolve(false);
  need.forEach(function(d){ _APPT.blockedLoaded[d]=true; });   // mark in-flight (avoid duplicate fetches)
  return _apptGet({action:'getOfficeBlocks',officeId:CFG.officeId,dates:need.join(','),role:SESSION.role}).then(function(res){
    var bl=res.blocks||{};
    Object.keys(bl).forEach(function(email){
      var byDate=bl[email]||{};
      Object.keys(byDate).forEach(function(d){ _APPT.blocked[email+'|'+d]=byDate[d]||{}; });
    });
    return true;
  }).catch(function(){ return false; });
}
// Dates the current view needs block data for (week = its 7 days; all = that day).
function _apptViewDates(){
  var mode=_APPT.viewMode||'week';
  if(mode==='week'){ var ws=_apptWeekStart(_APPT.weekOffset),out=[]; for(var i=0;i<7;i++){var x=new Date(ws);x.setDate(ws.getDate()+i);out.push(_apptDateStr(x));} return out; }
  if(mode==='all'){ var d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+(_APPT.dayOffset||0)); return [_apptDateStr(d)]; }
  return [];
}
// Lazy loader used during in-page navigation: fetch + re-render only if it loaded.
function _apptLoadBlocks(dates){ _apptFetchBlocks(dates).then(function(did){ if(did) _apptRerender(); }); }

function _apptGet(params) {
  var p = Object.assign({}, params, { key: API_KEY });
  if (SESSION && SESSION.token) p.token = SESSION.token;   // Phase 1 Stage B: carry the badge
  var qs = Object.keys(p).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(p[k]||''); }).join('&');
  return fetch(APPT_SCRIPT_URL+'?'+qs, { redirect:'follow' }).then(function(r){ return r.json(); }).then(_authIntercept);
}
function _apptPost(body) {
  var extra = (SESSION && SESSION.token) ? { key: API_KEY, token: SESSION.token } : { key: API_KEY };
  return fetch(APPT_SCRIPT_URL, {
    method:'POST', redirect:'follow',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({}, body, extra))
  }).then(function(r){ return r.json(); }).then(_authIntercept);
}
function _apptWeekStart(offset) {
  var d = new Date(); var dow = d.getDay();
  d.setDate(d.getDate() + (dow===0?-6:1-dow) + (offset||0)*7);
  d.setHours(0,0,0,0); return d;
}
function _apptDateStr(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// Phase 1 booking window: NO same-day. Earliest = tomorrow, latest = +7 days
// (rolling, slides forward daily). Mirrors the backend _bookingWindow().
function _apptWindow(allowSameDay) {
  var t=new Date(); t.setHours(0,0,0,0);
  var min=new Date(t); min.setDate(t.getDate()+(allowSameDay?0:1));   // same-day override drops the floor to today
  var max=new Date(t); max.setDate(t.getDate()+7);
  return { min:_apptDateStr(min), max:_apptDateStr(max) };
}
// Phase 3 #1b: only activators + master-admins get the same-day booking override.
function _apptCanSameDay(){ return SESSION.role==='master-admin'||SESSION.role==='activator'; }
function _apptFmt12(t) {
  if (!t) return ''; var p=t.split(':').map(Number); var h=p[0],m=p[1];
  return (h>12?h-12:h===0?12:h)+':'+String(m).padStart(2,'0')+' '+(h>=12?'PM':'AM');
}
function _apptFmtDate(s) {
  if (!s) return ''; var p=s.split('-').map(Number);
  var mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return mo[p[1]-1]+' '+p[2]+', '+p[0];
}
function _apptSlotInSched(slot, start, end) {
  if (!start||!end) return false;
  var toM=function(t){var p=t.split(':').map(Number);return p[0]*60+p[1];};
  var s=toM(slot); return s>=toM(start)&&(s+60)<=toM(end);
}
function _apptActName(email) {
  var a=(_APPT.activators||[]).find(function(x){return x.email===email;});
  return a?a.name:email;
}
// Per-office timezone — mirrors the backend AppointmentScheduler.gs OFFICE_TZ.
// Used to label appointment times so reps/customers know which zone they're in.
var APPT_OFFICE_TZ = { midspire:'America/Chicago', viridian:'America/Chicago', elevate:'America/Los_Angeles', vanguard:'America/New_York', bayview:'America/New_York', leadsphere:'America/Chicago' };
// Activators share their Google Calendar with THIS account (the Appointment
// Scheduler's deploy-owner) to enable two-way sync. One constant → shown in the
// "My Schedule" linking step; update here if the backend's owner account changes.
var APPT_CAL_SHARE_EMAIL = 'gavonfuller2024@gmail.com';
var _TZ_ABBR = { 'America/Chicago':'CT', 'America/Los_Angeles':'PT', 'America/New_York':'ET', 'America/Denver':'MT', 'America/Anchorage':'AKT', 'Pacific/Honolulu':'HT' };
function _tzAbbr(tz){ return _TZ_ABBR[tz] || ''; }
// "Elevate time (PT)" — for the current office (or a given one).
function _officeTzLabel(officeId){
  var tz = APPT_OFFICE_TZ[officeId]; if (!tz) return '';
  var ab = _tzAbbr(tz), name = (typeof OFFICE_NAMES!=='undefined' && OFFICE_NAMES[officeId]) ? OFFICE_NAMES[officeId] : officeId;
  return name + ' time' + (ab ? ' (' + ab + ')' : '');
}
// ── Slice 2: activator-TZ <-> office-TZ display conversion ──────────────────
// Stored appointment slots are in the activator's local clock (their schedule
// timezone). The office's SHARED calendar + rep/customer views DISPLAY them in
// the office timezone; storage is never changed. Critical safety property: when
// the activator's zone == the office zone (the normal case) every convert below
// is a guaranteed no-op, so same-zone behavior stays byte-identical.
function _partsInTz(utcMs, tz){
  var dtf = new Intl.DateTimeFormat('en-US', { timeZone:tz, hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  var o = {}; dtf.formatToParts(new Date(utcMs)).forEach(function(p){ if (p.type!=='literal') o[p.type]=p.value; });
  var h = +o.hour; if (h===24) h=0;   // some engines emit '24' for midnight
  return { y:+o.year, mo:+o.month, d:+o.day, h:h, mi:+o.minute };
}
// The UTC instant whose wall-clock in `tz` reads dateStr + hhmm.
function _wallToUtc(dateStr, hhmm, tz){
  var y=+dateStr.slice(0,4), mo=+dateStr.slice(5,7), d=+dateStr.slice(8,10);
  var h=+hhmm.slice(0,2), mi=+hhmm.slice(3,5);
  var guess = Date.UTC(y, mo-1, d, h, mi);
  var p = _partsInTz(guess, tz);
  var shown = Date.UTC(p.y, p.mo-1, p.d, p.h, p.mi);
  var want  = Date.UTC(y, mo-1, d, h, mi);
  return guess + (want - shown);
}
// Convert "HH:MM" wall-clock on dateStr from fromTz to toTz. Returns "HH:MM".
function _tzConvertClock(dateStr, hhmm, fromTz, toTz){
  if (!fromTz || !toTz || fromTz===toTz || !dateStr || !hhmm) return hhmm;
  var p = _partsInTz(_wallToUtc(dateStr, hhmm, fromTz), toTz);
  return String(p.h).padStart(2,'0') + ':' + String(p.mi).padStart(2,'0');
}
function _apptOfficeTzId(){ return APPT_OFFICE_TZ[CFG.officeId] || ''; }
function _apptActTz(email){
  var a = (_APPT.activators||[]).find(function(x){ return x.email===email; });
  return (a && a.timezone) ? a.timezone : _apptOfficeTzId();   // unset => office tz => no-op
}
// activator-stored slot -> office-TZ slot (place/display on the office grid)
function _apptToOffice(dateStr, slot, email){ return _tzConvertClock(dateStr, slot, _apptActTz(email), _apptOfficeTzId()); }
// office-TZ slot -> activator-stored slot (check an activator's schedule/blocks at an office slot)
function _apptToAct(dateStr, slot, email){ return _tzConvertClock(dateStr, slot, _apptOfficeTzId(), _apptActTz(email)); }
// ── Item 3: dual-time display — customer (office) time + activator (call) time ──
// A booking's stored slot is the activator's local clock. Staff surfaces show the
// OFFICE (customer) time; when the activator works a DIFFERENT timezone we ALSO show
// their local time — "the time you'll actually be on the phone". When the activator's
// zone == the office zone (the normal case) these return just the one office time, so
// same-zone surfaces stay byte-identical.
function _apptDualParts(dateStr, storedSlot, email){
  var oTz=_apptOfficeTzId(), aTz=_apptActTz(email);
  return { same: (!aTz || aTz===oTz),
           custLbl:_apptFmt12(_apptToOffice(dateStr, storedSlot, email)), custAbbr:_tzAbbr(oTz),
           actLbl: _apptFmt12(storedSlot),                                actAbbr:_tzAbbr(aTz) };
}
// Compact one-liner: "2:00 PM CT · call 12:00 PM PT" (or just "2:00 PM" when same-tz).
function _apptDualInline(dateStr, storedSlot, email){
  var d=_apptDualParts(dateStr, storedSlot, email);
  if (d.same) return d.custLbl;
  return d.custLbl+(d.custAbbr?' '+d.custAbbr:'')+' · call '+d.actLbl+(d.actAbbr?' '+d.actAbbr:'');
}
// Stacked HTML for a table/card cell (customer time over the activator call time).
function _apptDualCell(dateStr, storedSlot, email){
  var d=_apptDualParts(dateStr, storedSlot, email);
  if (d.same) return esc(d.custLbl);
  return '<div class="appt-dtime">'+
    '<div class="appt-dtime-cust"><span class="appt-dtime-tag">Customer</span>'+esc(d.custLbl+(d.custAbbr?' '+d.custAbbr:''))+'</div>'+
    '<div class="appt-dtime-act"><span class="appt-dtime-tag">You call</span>'+esc(d.actLbl+(d.actAbbr?' '+d.actAbbr:''))+'</div>'+
  '</div>';
}
// Default booking hours — mirrors the backend AppointmentScheduler.gs DEFAULT_HOURS
// (Mon–Fri 10:00–17:00 in the office/activator home TZ; weekends closed unless set).
var _APPT_DEFAULT_HOURS = { start:'10:00', end:'17:00', days:['mon','tue','wed','thu','fri'] };
// Effective working hours for an activator on a given day-key, applying the
// default fallback when they haven't set custom hours for that weekday. Returns
// {start,end} or null (closed). Keeps the grid + utilization consistent with the
// backend, which falls back to the same defaults when actually booking.
function _apptDaySched(sched, dk){
  var s=(sched||{})[dk];
  if (s && s.start && s.end) return s;
  if (_APPT_DEFAULT_HOURS.days.indexOf(dk)!==-1) return { start:_APPT_DEFAULT_HOURS.start, end:_APPT_DEFAULT_HOURS.end };
  return null;
}

// Phase 1: stable per-activator color (assigned by sorted email so it's
// consistent across renders), service glyphs (W/A/F), device + outcome glyphs.
var _APPT_PALETTE=['#5B9BD5','#70AD47','#ED7D31','#FFC000','#9B59B6','#1ABC9C','#E74C3C','#3498DB','#E67E22','#16A085','#2ECC71','#F39C12'];
function _apptColorMap(){
  if(_APPT._colorMap) return _APPT._colorMap;
  var m={};
  (_APPT.activators||[]).slice().sort(function(a,b){return a.email<b.email?-1:1;}).forEach(function(a,i){ m[a.email]=_APPT_PALETTE[i%_APPT_PALETTE.length]; });
  _APPT._colorMap=m; return m;
}
function _apptActColor(email){ return _apptColorMap()[email]||'#888'; }
function _apptSvcGlyphs(servicesStr){
  var s=String(servicesStr||'').toLowerCase(), g='';
  if(s.indexOf('wireless')!==-1) g+='<span class="appt-svc-glyph svc-w" title="Wireless">W</span>';
  if(s.indexOf('air')!==-1)      g+='<span class="appt-svc-glyph svc-a" title="Air">A</span>';
  if(s.indexOf('fiber')!==-1||s.indexOf('internet')!==-1) g+='<span class="appt-svc-glyph svc-f" title="Fiber">F</span>';
  return g;
}
// 🌐 badge for appointments the customer booked themselves (source==='customer'),
// vs rep-booked. Source comes from getAppointments.
function _apptSrcBadge(a){
  return String(a&&a.source||'').toLowerCase()==='customer'
    ? '<span class="appt-src-badge" title="Booked online by the customer">'+icon('globe')+'</span>' : '';
}
function _apptOutcomeGlyph(a){
  var o=String(a.outcome||'').toLowerCase();
  if(o==='completed')   return '<span class="appt-oc-glyph oc-done" title="Completed">✓ </span>';
  if(o==='no-show')     return '<span class="appt-oc-glyph oc-noshow" title="No-Show">✗ </span>';
  if(o==='rescheduled') return '<span class="appt-oc-glyph oc-resched" title="Rescheduled">↻ </span>';
  if(o==='canceled')    return '<span class="appt-oc-glyph oc-canc" title="Canceled">⊘ </span>';
  return '';
}
// Phase 2 #1a: Booking Performance panel (top of Appointments tab, 30-day window).
// Client-side over _APPT.appointments (office-scoped by getAppointments).
// Visible to booking managers + activators only.
function _apptMetricsPanel(appts){
  if (['master-admin','owner','admin','manager','activator'].indexOf(SESSION.role) === -1) return '';
  var today=_apptDateStr(new Date());
  var f=new Date(); f.setDate(f.getDate()-30); var floor=_apptDateStr(f);
  var recent=appts.filter(function(a){ return a.date>=floor && a.date<=today && a.status!=='cancelled'; });
  var marked=recent.filter(function(a){ return a.outcome; });
  var ns=marked.filter(function(a){return a.outcome==='no-show';}).length;
  var comp=marked.filter(function(a){return a.outcome==='completed';}).length;
  var nsRate=marked.length? Math.round(ns/marked.length*1000)/10 : 0;
  var compRate=marked.length? Math.round(comp/marked.length*1000)/10 : 0;
  var upcoming=appts.filter(function(a){return a.date>today && a.status!=='cancelled';});
  var upDevices=upcoming.reduce(function(s,a){return s+(Number(a.deviceCount)||0);},0);
  var byAct={};
  recent.forEach(function(a){
    var e=a.activatorEmail; if(!byAct[e]) byAct[e]={name:_apptActName(e),total:0,comp:0,ns:0};
    byAct[e].total++; if(a.outcome==='completed')byAct[e].comp++; if(a.outcome==='no-show')byAct[e].ns++;
  });
  var actRows=Object.keys(byAct).map(function(e){return byAct[e];}).sort(function(a,b){return b.total-a.total;});
  function card(label,val,sub,color){
    return '<div class="appt-metric"><div class="appt-metric-val"'+(color?' style="color:'+color+'"':'')+'>'+val+'</div>'+
      '<div class="appt-metric-lbl">'+label+'</div>'+(sub?'<div class="appt-metric-sub">'+sub+'</div>':'')+'</div>';
  }
  var cards=card('Bookings (30d)', recent.length, marked.length+' marked', '#5B9BD5')+
    card('No-Show Rate', nsRate+'%', ns+' of '+marked.length, nsRate>=15?'#e9756a':'#70AD47')+
    card('Completed', compRate+'%', comp+' of '+marked.length, '#70AD47')+
    card('Upcoming', upcoming.length, upDevices+' devices', '#FFC000');
  var actHtml='';
  if(actRows.length){
    actHtml='<div class="appt-metric-acts"><div class="appt-metric-acts-hdr">By Activator (30d)</div>'+
      actRows.map(function(r){
        return '<div class="appt-metric-act-row"><span class="appt-metric-act-name">'+esc(r.name)+'</span>'+
          '<span class="appt-metric-act-stat">'+r.total+' booked</span>'+
          '<span class="appt-metric-act-stat" style="color:#70AD47">'+r.comp+' ✓</span>'+
          '<span class="appt-metric-act-stat" style="color:#e9756a">'+r.ns+' ✗</span></div>';
      }).join('')+'</div>';
  }
  return '<details class="appt-metrics-wrap" open><summary class="appt-metrics-summary">'+icon('actrates')+' Booking Performance <span style="font-weight:400;color:var(--text2);font-size:.8rem">· last 30 days</span></summary>'+
    '<div class="appt-metrics">'+cards+'</div>'+actHtml+'</details>';
}

function _apptLegend(appts, acts, ws){
  if(!acts.length) return '';
  var we=new Date(ws); we.setDate(ws.getDate()+6);
  var wsS=_apptDateStr(ws), weS=_apptDateStr(we);
  var load={}; appts.forEach(function(a){ if(a.status==='cancelled')return; if(a.date>=wsS&&a.date<=weS) load[a.activatorEmail]=(load[a.activatorEmail]||0)+1; });
  var items=acts.slice().sort(function(a,b){return a.email<b.email?-1:1;}).map(function(a){
    var c=_apptActColor(a.email), n=load[a.email]||0;
    var dim=(_APPT.filterEmail!=='' && _APPT.filterEmail!==a.email);
    return '<span class="appt-leg-item'+(dim?' appt-leg-dim':'')+'" onclick="_apptFilter(\''+(_APPT.filterEmail===a.email?'':esc(a.email))+'\')" title="Click to filter">'+
      '<span class="appt-leg-dot" style="background:'+c+'"></span>'+esc(a.name)+
      '<span class="appt-leg-count" title="Appointments this week">'+n+'</span></span>';
  }).join('');
  return '<div class="appt-legend">'+items+'</div>';
}

// Shared fetch for the Appointments tab — one in-flight promise dedupes the on-open
// render and the background preload. Refreshes activators + appointments + the block
// state for the opening view. Office-guarded so a mid-flight office switch is discarded.
var _apptFlight = null;
function _apptFetchAll() {
  if (_apptFlight) return _apptFlight;
  var office = CFG.officeId;
  _APPT.loading = true;
  var actsP = _APPT.activators ? Promise.resolve({activators:_APPT.activators}) : _apptGet({action:'getActivators',officeId:office});
  var apptP = _apptGet({action:'getAppointments',officeId:office,bookerEmail:SESSION.email,role:SESSION.role});
  _apptFlight = Promise.all([actsP, apptP]).then(function(res) {
    if (office !== CFG.officeId) { _APPT.loading = false; _apptFlight = null; return false; }
    if (res[0].activators) _APPT.activators = res[0].activators;
    _APPT.appointments = res[1].appointments || [];
    // Refresh cross-office / calendar block state for the opening view.
    _APPT.blocked = {}; _APPT.blockedLoaded = {};
    return _apptFetchBlocks(_apptViewDates());
  }).then(function(r) {
    _APPT.loading = false; _apptFlight = null; return r;
  }).catch(function() {
    _APPT.loading = false; _apptFlight = null; return false;
  });
  return _apptFlight;
}
function renderAppointmentsTab() {
  var c = document.getElementById('main-content');
  var have = _APPT.appointments !== null;
  if (have) { c.innerHTML = _apptBuildView(); _apptBindEvents(); }   // instant from cache
  else c.innerHTML = '<div class="empty">Loading appointments…</div>';
  _apptFetchAll().then(function(ok) {
    if (CURRENT_TAB !== 'appointments') return;
    if (ok) { c.innerHTML = _apptBuildView(); _apptBindEvents(); }
    else if (!have) c.innerHTML = '<div class="empty">Failed to load. Check your connection and try refreshing.</div>';
  });
}
// Warm the Appointments cache in the background after login.
function _preloadAppointments() {
  if (_APPT.appointments !== null || _apptFlight) return;
  _apptFetchAll().then(function(ok) {
    if (ok && CURRENT_TAB === 'appointments') { var c = document.getElementById('main-content'); if (c) { c.innerHTML = _apptBuildView(); _apptBindEvents(); } }
  });
}

// Per-office public booking link, shown at the top of the Appointments tab so any
// staffer can copy it to send a customer (self-booking flows into the same pool).
function _apptBookingLinkPanel() {
  if (!CUSTOMER_BOOKING_URL) return '';
  var url = CUSTOMER_BOOKING_URL + '?office=' + encodeURIComponent(CFG.officeId || '');
  return '<div class="appt-booklink">'+
    '<span class="appt-booklink-label">'+icon('link')+' Customer booking link</span>'+
    '<input class="appt-booklink-url" id="apptBookUrl" readonly value="'+esc(url)+'" onclick="this.select()">'+
    '<button class="appt-booklink-btn" onclick="_apptCopyBookLink(this)">Copy</button>'+
    '<a class="appt-booklink-btn ghost" href="'+esc(url)+'" target="_blank" rel="noopener">Open</a>'+
  '</div>';
}
function _apptCopyBookLink(btn) {
  var i = document.getElementById('apptBookUrl'); if (!i) return;
  i.focus(); i.select(); try { i.setSelectionRange(0, 99999); } catch(e){}
  var done = function(){ var t=btn.getAttribute('data-l')||btn.textContent; btn.setAttribute('data-l',t); btn.textContent='Copied!'; setTimeout(function(){ btn.textContent=t; },1400); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(i.value).then(done, function(){ try{ document.execCommand('copy'); done(); }catch(e){} });
  } else { try{ document.execCommand('copy'); done(); }catch(e){} }
}

function _apptBuildView() {
  _APPT._colorMap = null;   // recompute per render so colors track the current activator set
  var acts = _APPT.activators||[], appts = _APPT.appointments||[];
  var mode = _APPT.viewMode||'week';
  var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var dFull = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var ws = _apptWeekStart(_APPT.weekOffset);
  var we = new Date(ws); we.setDate(ws.getDate()+6);
  // Chosen day for Day / All-Activators modes (offset in days from today).
  var dDate = new Date(); dDate.setHours(0,0,0,0); dDate.setDate(dDate.getDate()+(_APPT.dayOffset||0));
  var dStr = _apptDateStr(dDate);
  // Kick off the block-state fetch for the dates this view shows (lazy; no-ops if
  // already loaded). On arrival it re-renders so blocked cells flip to 🔒.
  if (mode==='week') { var _wd=[]; for(var _i=0;_i<7;_i++){var _x=new Date(ws);_x.setDate(ws.getDate()+_i);_wd.push(_apptDateStr(_x));} _apptLoadBlocks(_wd); }
  else if (mode==='all') { _apptLoadBlocks([dStr]); }
  var label, body;
  if (mode==='week') {
    label = mo[ws.getMonth()]+' '+ws.getDate()+' – '+mo[we.getMonth()]+' '+we.getDate()+', '+we.getFullYear();
    body = _apptCalGrid(appts, acts, ws) + _apptLegend(appts, acts, ws);
  } else if (mode==='all') {
    label = dFull[dDate.getDay()]+' · '+mo[dDate.getMonth()]+' '+dDate.getDate();
    body = _apptAllActGrid(appts, acts, dStr);
  } else {
    label = dFull[dDate.getDay()]+' · '+mo[dDate.getMonth()]+' '+dDate.getDate();
    body = _apptDayAgenda(appts, acts, dStr);
  }
  var isAdmin = SESSION.role==='activator'||SESSION.role==='master-admin';
  var actOpts = '<option value="">All Activators</option>'+acts.map(function(a){
    return '<option value="'+esc(a.email)+'"'+(a.email===_APPT.filterEmail?' selected':'')+'>'+esc(a.name)+'</option>';
  }).join('');
  function vbtn(m,lbl){ return '<button class="appt-view-btn'+(mode===m?' active':'')+'" onclick="_apptSetView(\''+m+'\')">'+lbl+'</button>'; }
  var html = '<div class="appt-wrap">'+
    _apptBookingLinkPanel()+
    _apptMetricsPanel(appts)+
    '<div class="appt-controls">'+
      '<div class="appt-nav">'+
        '<button class="appt-nav-btn" aria-label="Previous week" onclick="_apptNav(-1)">'+icon('chev-left')+'</button>'+
        '<span class="appt-week-label">'+esc(label)+'</span>'+
        '<button class="appt-nav-btn" aria-label="Next week" onclick="_apptNav(1)">'+icon('chev-right')+'</button>'+
      '</div>'+
      '<div class="appt-view-toggle">'+vbtn('week','Week')+vbtn('day','Day')+vbtn('all','All-Activators')+'</div>'+
      '<div class="appt-filter-row">'+
        (mode==='week' ? '<select class="appt-select" id="appt-act-filter" onchange="_apptFilter(this.value)">'+actOpts+'</select>' : '')+
        '<button class="appt-book-btn" onclick="openApptBookingModal(\'\',\'\',\'\')">+ Book Appointment</button>'+
      '</div>'+
    '</div>'+
    (_officeTzLabel(CFG.officeId) ? '<div class="appt-tz-note">'+icon('clock')+' Times shown in <strong>'+esc(_officeTzLabel(CFG.officeId))+'</strong>. Each activator works the hours &amp; timezone set in their own schedule.</div>' : '')+
    _apptUtilStrip(appts, acts, mode, ws, dStr)+
    body+
    _apptUpcomingTable(appts)+(
    isAdmin ? '<div style="margin-top:16px;text-align:right"><button class="appt-manage-btn" onclick="openApptSchedModal()">'+icon('settings')+' Manage My Schedule</button></div>' : ''
  )+'</div>';
  return html;
}

function _apptCalGrid(appts, acts, ws) {
  var slots = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00'];
  var dnames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var dayKeys = ['sun','mon','tue','wed','thu','fri','sat'];
  var dates = []; for (var d=0;d<7;d++){var x=new Date(ws);x.setDate(ws.getDate()+d);dates.push(_apptDateStr(x));}
  var today = _apptDateStr(new Date());
  var win = _apptWindow();
  var fe = _APPT.filterEmail;
  var aMap = {}; appts.forEach(function(a){
    if(!a.date||!a.timeSlot||a.status==='cancelled') return;
    // Place each booking on the office-TZ grid (no-op when activator tz == office tz).
    var k=a.date+'|'+_apptToOffice(a.date,a.timeSlot,a.activatorEmail); if(!aMap[k]) aMap[k]=[]; aMap[k].push(a);
  });
  var sMap = {}; acts.forEach(function(a){ sMap[a.email]=a.schedule||{}; });

  // Single source of truth for "is this (day,slot) a bookable open cell in the
  // current view?" — used by both the header pill counts and the cell render.
  function availAt(ds, slot){
    if (ds<win.min || ds>win.max) return false;
    var dk=dayKeys[new Date(ds+'T12:00:00').getDay()];
    var slotAppts=aMap[ds+'|'+slot]||[];
    if (fe){
      var sc=_apptDaySched(sMap[fe],dk), asl=_apptToAct(ds,slot,fe);
      if(!sc||!_apptSlotInSched(asl,sc.start,sc.end)) return false;
      return !slotAppts.some(function(a){return a.activatorEmail===fe;}) && !_apptBlocked(fe,ds,asl);
    }
    if (slotAppts.length>0) return false;
    return Object.keys(sMap).some(function(em){var s=_apptDaySched(sMap[em],dk),asl=_apptToAct(ds,slot,em);return s&&_apptSlotInSched(asl,s.start,s.end)&&!_apptBlocked(em,ds,asl);});
  }
  // How many activators are free at (ds,slot) — in-schedule, in-window, not blocked.
  // Drives the per-cell count on the default (no-filter) week view.
  function freeCount(ds, slot){
    if (ds<win.min || ds>win.max) return 0;
    var dk=dayKeys[new Date(ds+'T12:00:00').getDay()], n=0;
    Object.keys(sMap).forEach(function(em){
      var s=_apptDaySched(sMap[em],dk), asl=_apptToAct(ds,slot,em);
      if(s && _apptSlotInSched(asl,s.start,s.end) && !_apptBlocked(em,ds,asl)) n++;
    });
    return n;
  }
  var availCount=[0,0,0,0,0,0,0];
  for (var di=0;di<7;di++){ slots.forEach(function(slot){ if(availAt(dates[di],slot)) availCount[di]++; }); }

  var html = '<div class="appt-cal-outer"><div class="appt-cal-grid">';
  html += '<div class="appt-cal-time-hdr"></div>';
  for (var d=0;d<7;d++){
    var dt=new Date(dates[d]+'T12:00:00');
    var pill = availCount[d]>0 ? '<span class="appt-avail-pill" title="'+availCount[d]+' open slot'+(availCount[d]===1?'':'s')+'">'+availCount[d]+' open</span>' : '';
    html += '<div class="appt-cal-th'+(dates[d]===today?' appt-today-hdr':'')+'">'+
      '<div class="appt-cal-dayname">'+dnames[d]+'</div>'+
      '<div class="appt-cal-daynum">'+(dt.getMonth()+1)+'/'+dt.getDate()+'</div>'+
      pill+
    '</div>';
  }
  slots.forEach(function(slot){
    html += '<div class="appt-cal-time">'+_apptFmt12(slot)+'</div>';
    for (var d=0;d<7;d++){
      var ds=dates[d], k=ds+'|'+slot, slotAppts=aMap[k]||[];
      var offWin = ds<win.min || ds>win.max;
      if (fe) {
        var mine=slotAppts.find(function(a){return a.activatorEmail===fe;});
        if (mine) {
          var ok=SESSION.role==='master-admin'||SESSION.role==='activator'||mine.bookerEmail===SESSION.email;
          var col=_apptActColor(fe);
          var _ct=_apptDualParts(mine.date,mine.timeSlot,mine.activatorEmail);
          html+='<div class="appt-cal-cell appt-cell-booked" style="box-shadow:inset 3px 0 0 '+col+'" title="'+(ok?esc(mine.customerName):'Booked')+' · '+esc(mine.services||'')+' ×'+(mine.deviceCount||1)+(_ct.same?'':' · call '+esc(_ct.actLbl+(_ct.actAbbr?' '+_ct.actAbbr:'')))+'">'+
            '<div class="appt-cell-name">'+_apptOutcomeGlyph(mine)+(ok?esc(mine.customerName):'••••••')+_apptSrcBadge(mine)+'</div>'+
            '<div class="appt-cell-glyphs">'+_apptSvcGlyphs(mine.services)+'<span class="appt-dev-badge">×'+(mine.deviceCount||1)+'</span></div></div>';
        } else if(offWin){
          html+='<div class="appt-cal-cell appt-cell-offwindow" title="Outside the booking window">·</div>';
        } else if(_apptBlocked(fe,ds,_apptToAct(ds,slot,fe))){
          var _bl=_apptBlocked(fe,ds,_apptToAct(ds,slot,fe)), _oid=_apptBlockOffice(_bl);
          html+= _oid ? _apptXofficeCell(_bl,_oid)
                      : '<div class="appt-cal-cell appt-cell-blocked" title="'+esc(_bl)+'">'+icon('lock')+'</div>';
        } else if(availAt(ds,slot)){
          html+='<div class="appt-cal-cell appt-cell-avail" onclick="openApptBookingModal(\''+ds+'\',\''+esc(fe)+'\',\''+_apptToAct(ds,slot,fe)+'\')">'+
            '<span class="appt-avail-plus">+</span> Book</div>';
        } else {
          html+='<div class="appt-cal-cell appt-cell-closed">—</div>';
        }
      } else {
        if (slotAppts.length>0){
          html+='<div class="appt-cal-cell appt-cell-booked-multi" title="'+slotAppts.length+' booked">';
          var distinct=acts.filter(function(a){return slotAppts.some(function(ap){return ap.activatorEmail===a.email;});});
          distinct.slice(0,2).forEach(function(a){ var c=_apptActColor(a.email);
            html+='<div class="appt-cell-act-tag" style="background:'+c+'2e;color:'+c+'">'+esc(a.name.split(' ')[0])+'</div>'; });
          if(distinct.length>2) html+='<div class="appt-cell-more">+'+(distinct.length-2)+'</div>';
          html+='</div>';
        } else if(offWin){
          html+='<div class="appt-cal-cell appt-cell-offwindow" title="Outside the booking window">·</div>';
        } else if(availAt(ds,slot)){
          var _fc=freeCount(ds,slot);
          html+='<div class="appt-cal-cell appt-cell-avail" onclick="openApptBookingModal(\''+ds+'\',\'\',\''+slot+'\')" title="'+_fc+' activator'+(_fc===1?'':'s')+' free">'+
            '<span class="appt-avail-plus">+</span> Book<span class="appt-avail-freecount">'+_fc+' free</span></div>';
        } else {
          html+='<div class="appt-cal-cell appt-cell-closed">—</div>';
        }
      }
    }
  });
  return html+'</div></div>';
}

// Outcome option metadata (value → label + badge class suffix).
var _APPT_OUTCOMES = [
  ['completed','Completed','completed'],
  ['rescheduled','Rescheduled','rescheduled'],
  ['no-show','No-Show','noshow'],
  ['canceled','Canceled','canceled']
];
function _apptOutcomeBadge(v) {
  var m=_APPT_OUTCOMES.filter(function(o){return o[0]===v;})[0]; if(!m) return '—';
  return '<span class="appt-outcome appt-outcome-'+m[2]+'">'+esc(m[1])+'</span>';
}
function _apptOutcomeSelect(a) {
  var opts='<option value="">Mark…</option>'+_APPT_OUTCOMES.map(function(o){
    return '<option value="'+o[0]+'"'+(a.outcome===o[0]?' selected':'')+'>'+o[1]+'</option>';
  }).join('');
  return '<select class="appt-outcome-sel" onchange="setApptOutcomeUI(\''+esc(a.appointmentId)+'\',this.value)">'+opts+'</select>';
}

function _apptUpcomingTable(appts) {
  var today = _apptDateStr(new Date());
  // Window back 7 days so recently-finished appointments that still need an
  // outcome remain visible alongside upcoming ones.
  var floor = new Date(); floor.setDate(floor.getDate()-7); floor=_apptDateStr(floor);
  var rows = appts.filter(function(a){ return a.date>=floor; })
    .sort(function(a,b){ return a.date!==b.date?a.date.localeCompare(b.date):a.timeSlot.localeCompare(b.timeSlot); })
    .slice(0,50);
  if (!rows.length) return '<div class="card" style="margin-top:16px"><div class="card-body"><div class="empty">No upcoming appointments.</div></div></div>';
  var canAll = SESSION.role==='master-admin'||SESSION.role==='activator';
  var h='<div class="card" style="margin-top:16px"><div class="card-header dark">Appointments</div>'+
    '<div class="card-body" style="padding:0;overflow-x:auto"><table class="tbl"><thead><tr>'+
    '<th>Date</th><th>Time</th><th>Activator</th><th>Customer</th><th>DSI</th><th>Services</th><th>Status</th><th>Outcome</th><th>Actions</th>'+
    '</tr></thead><tbody>';
  rows.forEach(function(a){
    var ok=canAll||a.bookerEmail===SESSION.email;       // may see customer / DSI
    var canX=canAll||a.bookerEmail===SESSION.email;      // may modify
    var cancelled = a.status==='cancelled';
    var occurred  = a.date<=today;                       // happened or happening today
    var terminal  = a.outcome==='completed'||a.outcome==='canceled';
    // Outcome cell: editable select for occurred, non-cancelled appts; else badge / dash.
    var outcomeCell;
    if (cancelled) outcomeCell='<span class="appt-outcome appt-outcome-canceled">Canceled</span>';
    else if (occurred && canX) outcomeCell=_apptOutcomeSelect(a);
    else if (a.outcome) outcomeCell=_apptOutcomeBadge(a.outcome);
    else outcomeCell='—';
    // Actions: reschedule (non-cancelled, non-terminal) + cancel (non-cancelled).
    var actions='';
    if (ok) {   // notes reference the customer → only for viewers who can see them
      var _nN=(a.notes?a.notes.length:0)+(a.customerNote?1:0);
      actions+='<button class="appt-resched-btn" title="Notes" aria-label="Appointment notes" onclick="openApptNotes(\''+esc(a.appointmentId)+'\')">'+icon('edit')+(_nN?' '+_nN:'')+'</button>';
    }
    if (canX && !cancelled && !terminal)
      actions+='<button class="appt-resched-btn" onclick="rescheduleApptUI(\''+esc(a.appointmentId)+'\')">Reschedule</button>';
    if (canX && !cancelled)
      actions+='<button class="appt-do-cancel-btn" onclick="cancelAppt(\''+esc(a.appointmentId)+'\')">Cancel</button>';
    if (SESSION.role==='master-admin')
      actions+='<button class="appt-del-btn" title="Delete permanently (master-admin)" aria-label="Delete appointment" onclick="deleteApptUI(\''+esc(a.appointmentId)+'\')">'+icon('trash')+'</button>';
    var dsiCell = ok && a.customerDSI
      ? '<span class="appt-dsi-link" title="Open in SaraPlus + copy" onclick="clickDsi(\''+esc(a.customerDSI)+'\')">'+esc(a.customerDSI)+'</span>'
      : (ok?'—':'••••');
    h+='<tr'+(occurred&&!cancelled&&!a.outcome?' class="appt-row-needsoutcome"':'')+'>'+
      '<td>'+esc(_apptFmtDate(a.date))+'</td><td>'+_apptDualCell(a.date,a.timeSlot,a.activatorEmail)+'</td>'+
      '<td>'+esc(_apptActName(a.activatorEmail))+'</td>'+
      '<td>'+(ok?esc(a.customerName):'••••••')+_apptSrcBadge(a)+'</td>'+
      '<td>'+dsiCell+'</td>'+
      '<td style="font-size:.78rem">'+esc(a.services||'—')+'</td>'+
      '<td><span class="appt-status-'+esc(a.status)+'">'+esc(a.status)+'</span></td>'+
      '<td>'+outcomeCell+'</td>'+
      '<td style="white-space:nowrap">'+(actions||'—')+'</td>'+
    '</tr>';
  });
  return h+'</tbody></table></div></div>';
}

function _apptNavWeek(dir) { _APPT.weekOffset+=dir; _APPT.appointments=null; renderAppointmentsTab(); }
function _apptFilter(email) { _APPT.filterEmail=email; var c=document.getElementById('main-content'); if(c) c.innerHTML=_apptBuildView(); _apptBindEvents(); }
function _apptBindEvents() { var s=document.getElementById('appt-act-filter'); if(s) s.value=_APPT.filterEmail; }

// Phase 2 #6: Week | Day | All-Activators switcher + booking-utilization strip.
// (_apptRerender is defined once, further down, with a CURRENT_TAB guard.)
function _apptSetView(m){ _APPT.viewMode=m; _apptRerender(); }
function _apptNav(dir){
  if ((_APPT.viewMode||'week')==='week'){ _apptNavWeek(dir); }   // week step refetches (existing behavior)
  else { _APPT.dayOffset+=dir; _apptRerender(); }                // day/all step is a pure client re-render
}

// All-Activators: one day, activators side by side as columns, time slots down.
function _apptAllActGrid(appts, acts, dStr){
  if(!acts.length) return '<div class="card" style="margin-bottom:16px"><div class="card-body"><div class="empty">No activators in this office.</div></div></div>';
  var slots = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00'];
  var dayKeys = ['sun','mon','tue','wed','thu','fri','sat'];
  var win = _apptWindow();
  var dk = dayKeys[new Date(dStr+'T12:00:00').getDay()];
  var offWin = dStr<win.min || dStr>win.max;
  var aMap = {}; appts.forEach(function(a){
    if(a.date!==dStr||!a.timeSlot||a.status==='cancelled') return;
    aMap[a.activatorEmail+'|'+_apptToOffice(dStr,a.timeSlot,a.activatorEmail)]=a;   // office-TZ key
  });
  var sorted = acts.slice().sort(function(a,b){return a.email<b.email?-1:1;});
  var html = '<div class="appt-cal-outer"><div class="appt-allact-grid" style="grid-template-columns:72px repeat('+sorted.length+',minmax(116px,1fr))">';
  html += '<div class="appt-cal-time-hdr"></div>';
  sorted.forEach(function(a){
    var c=_apptActColor(a.email), cap=0, bk=0, sc=_apptDaySched(a.schedule,dk);
    if(sc && !offWin) slots.forEach(function(slot){ if(_apptSlotInSched(_apptToAct(dStr,slot,a.email),sc.start,sc.end)){ cap++; if(aMap[a.email+'|'+slot]) bk++; } });
    html += '<div class="appt-cal-th"><div class="appt-allact-name" style="color:'+c+'" title="'+esc(a.name)+'">'+esc(a.name.split(' ')[0])+'</div>'+
      '<div class="appt-allact-load" title="Booked / capacity this day">'+bk+'/'+cap+'</div></div>';
  });
  slots.forEach(function(slot){
    html += '<div class="appt-cal-time">'+_apptFmt12(slot)+'</div>';
    sorted.forEach(function(a){
      var ap=aMap[a.email+'|'+slot], sc=_apptDaySched(a.schedule,dk), asl=_apptToAct(dStr,slot,a.email);
      var inSched=sc&&_apptSlotInSched(asl,sc.start,sc.end);
      if(ap){
        var ok=SESSION.role==='master-admin'||SESSION.role==='activator'||ap.bookerEmail===SESSION.email;
        var col=_apptActColor(a.email);
        html+='<div class="appt-cal-cell appt-cell-booked" style="box-shadow:inset 3px 0 0 '+col+'" title="'+(ok?esc(ap.customerName):'Booked')+' · '+esc(ap.services||'')+' ×'+(ap.deviceCount||1)+'">'+
          '<div class="appt-cell-name">'+_apptOutcomeGlyph(ap)+(ok?esc(ap.customerName):'••••••')+_apptSrcBadge(ap)+'</div>'+
          '<div class="appt-cell-glyphs">'+_apptSvcGlyphs(ap.services)+'<span class="appt-dev-badge">×'+(ap.deviceCount||1)+'</span></div></div>';
      } else if(offWin){
        html+='<div class="appt-cal-cell appt-cell-offwindow" title="Outside the booking window">·</div>';
      } else if(inSched && _apptBlocked(a.email,dStr,asl)){
        var _bl=_apptBlocked(a.email,dStr,asl), _oid=_apptBlockOffice(_bl);
        html+= _oid ? _apptXofficeCell(_bl,_oid)
                    : '<div class="appt-cal-cell appt-cell-blocked" title="'+esc(_bl)+'">'+icon('lock')+'</div>';
      } else if(inSched){
        html+='<div class="appt-cal-cell appt-cell-avail" onclick="openApptBookingModal(\''+dStr+'\',\''+esc(a.email)+'\',\''+asl+'\')"><span class="appt-avail-plus">+</span> Book</div>';
      } else {
        html+='<div class="appt-cal-cell appt-cell-closed">—</div>';
      }
    });
  });
  return html+'</div></div>';
}

// Day: chronological agenda of every appointment that day across all activators.
function _apptDayAgenda(appts, acts, dStr){
  var rows = appts.filter(function(a){ return a.date===dStr && a.status!=='cancelled'; })
    .sort(function(a,b){ return (a.timeSlot||'').localeCompare(b.timeSlot||''); });
  if(!rows.length) return '<div class="card" style="margin-bottom:16px"><div class="card-body"><div class="empty">No appointments scheduled for this day.</div></div></div>';
  var canAll = SESSION.role==='master-admin'||SESSION.role==='activator';
  var today = _apptDateStr(new Date());
  var h='<div class="appt-agenda">';
  rows.forEach(function(a){
    var ok=canAll||a.bookerEmail===SESSION.email, col=_apptActColor(a.activatorEmail);
    var dsi = ok && a.customerDSI ? ' <span class="appt-dsi-link" title="Open in SaraPlus + copy" onclick="clickDsi(\''+esc(a.customerDSI)+'\')">'+esc(a.customerDSI)+'</span>' : '';
    h+='<div class="appt-agenda-row" style="border-left:3px solid '+col+'">'+
      '<div class="appt-agenda-time">'+esc(_apptFmt12(_apptToOffice(a.date,a.timeSlot,a.activatorEmail)))+'</div>'+
      '<div class="appt-agenda-main">'+
        '<div class="appt-agenda-cust">'+(ok?esc(a.customerName):'••••••')+_apptSrcBadge(a)+dsi+'</div>'+
        '<div class="appt-agenda-sub"><span style="color:'+col+';font-weight:700">'+esc(_apptActName(a.activatorEmail))+'</span> · '+_apptSvcGlyphs(a.services)+'<span class="appt-dev-badge">×'+(a.deviceCount||1)+'</span></div>'+
        _apptLifecyclePath(a, today)+
      '</div>'+
    '</div>';
  });
  return h+'</div>';
}

// Phase 3 #4: Salesforce-style lifecycle Path chevron for an appointment.
// Read-only — outcomes are still marked from the Appointments table.
function _apptLifecyclePath(a, today){
  var oc = String(a.outcome||'').toLowerCase();
  var occurred = a.date <= today;
  var TERM = {
    'completed':   ['✓ Completed',   'st-done-green'],
    'no-show':     ['✗ No-Show',     'st-done-red'],
    'rescheduled': ['↻ Rescheduled', 'st-done-amber'],
    'canceled':    ['⊘ Canceled',    'st-done-canc']
  };
  function step(label, cls){ return '<span class="appt-path-step '+cls+'">'+esc(label)+'</span>'; }
  // Canceled short-circuits the path.
  if (oc==='canceled' || a.status==='cancelled')
    return '<div class="appt-path">'+step('Booked','st-done')+step('⊘ Canceled','st-term st-done-canc')+'</div>';
  var stages;
  if (TERM[oc])      stages=[['Booked','st-done'],['Upcoming','st-done'],['Occurred','st-done'],[TERM[oc][0],'st-term '+TERM[oc][1]]];
  else if (occurred) stages=[['Booked','st-done'],['Upcoming','st-done'],['Occurred','st-active'],['Outcome','st-pending']];
  else               stages=[['Booked','st-done'],['Upcoming','st-active'],['Occurred','st-pending'],['Outcome','st-pending']];
  return '<div class="appt-path">'+stages.map(function(s){return step(s[0],s[1]);}).join('')+'</div>';
}

// Booking-utilization strip: booked ÷ capacity for the period in view.
// Capacity = schedulable 1-hr slots (effective schedule, in-window). Booking
// managers + activators only — same audience as the Booking Performance panel.
function _apptUtilStrip(appts, acts, mode, ws, dStr){
  if (['master-admin','owner','admin','manager','activator'].indexOf(SESSION.role)===-1) return '';
  if(!acts.length) return '';
  var slots = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00'];
  var dayKeys = ['sun','mon','tue','wed','thu','fri','sat'];
  var win = _apptWindow();
  var dates=[];
  if(mode==='week'){ for(var d=0;d<7;d++){ var x=new Date(ws); x.setDate(ws.getDate()+d); dates.push(_apptDateStr(x)); } }
  else { dates=[dStr]; }
  var bMap={}; appts.forEach(function(a){ if(a.status!=='cancelled'&&a.timeSlot) bMap[a.activatorEmail+'|'+a.date+'|'+a.timeSlot]=true; });
  var perAct={}; acts.forEach(function(a){ perAct[a.email]={name:a.name,cap:0,bk:0}; });
  var totCap=0, totBk=0;
  dates.forEach(function(ds){
    if(ds<win.min||ds>win.max) return;   // only in-window dates have bookable capacity
    var dk=dayKeys[new Date(ds+'T12:00:00').getDay()];
    acts.forEach(function(a){
      var sc=_apptDaySched(a.schedule,dk); if(!sc) return;
      slots.forEach(function(slot){
        // slot is office-tz; the activator's schedule (sc) is in the activator's own tz —
        // convert before checking, matching _apptAllActStrip / the grid. (O4: was comparing
        // office-tz slots to an activator-tz window → capacity off for cross-tz activators.)
        if(!_apptSlotInSched(_apptToAct(ds,slot,a.email),sc.start,sc.end)) return;
        perAct[a.email].cap++; totCap++;
        if(bMap[a.email+'|'+ds+'|'+slot]){ perAct[a.email].bk++; totBk++; }
      });
    });
  });
  var periodLbl = mode==='week'?'this week':'this day';
  if(!totCap){
    return '<div class="appt-util"><div class="appt-util-head"><span class="appt-util-title">'+icon('trending-up')+' Booking Utilization</span>'+
      '<span class="appt-util-note">No bookable capacity in view (outside the booking window).</span></div></div>';
  }
  var pct=Math.round(totBk/totCap*100), open=totCap-totBk;
  function barCol(p){ return p>=80?'#e9756a':p>=50?'#FFC000':'#70AD47'; }
  var actRows=Object.keys(perAct).map(function(e){return perAct[e];}).filter(function(r){return r.cap>0;})
    .sort(function(a,b){return (b.bk/b.cap)-(a.bk/a.cap);});
  var actHtml=actRows.map(function(r){
    var p=Math.round(r.bk/r.cap*100);
    return '<div class="appt-util-act"><span class="appt-util-act-name">'+esc(r.name)+'</span>'+
      '<div class="appt-util-actbar"><div class="appt-util-actbar-fill" style="width:'+p+'%;background:'+barCol(p)+'"></div></div>'+
      '<span class="appt-util-act-num">'+r.bk+'/'+r.cap+'</span></div>';
  }).join('');
  return '<div class="appt-util">'+
    '<div class="appt-util-head"><span class="appt-util-title">'+icon('trending-up')+' Booking Utilization <span style="font-weight:400;color:var(--text2);font-size:.78rem">· '+periodLbl+'</span></span>'+
      '<span class="appt-util-summary">'+pct+'% · <b>'+totBk+'</b> booked / '+totCap+' capacity · <b style="color:#70AD47">'+open+'</b> open</span></div>'+
    '<div class="appt-util-bar"><div class="appt-util-bar-fill" style="width:'+pct+'%;background:'+barCol(pct)+'"></div></div>'+
    '<details class="appt-util-acts-wrap"><summary class="appt-util-acts-sum">Per-activator breakdown</summary>'+actHtml+'</details>'+
  '</div>';
}

// ── Booking Modal ─────────────────────────────────────────────
// Phase 3 #1 redesign: booker chooses EITHER "Soonest available" (auto-find the
// earliest opening) OR "Pick a date". Round-robin is a single "Balance workload"
// toggle shown only for Next Available Agent. Same-day is a privileged override.
var _ABM = { when:'soonest', soonest:null };
function _abmNiceDate(ds){
  if(!ds) return ''; var p=ds.split('-').map(Number); var d=new Date(p[0],p[1]-1,p[2]);
  var wd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  var mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][p[1]-1];
  return wd+' '+mo+' '+p[2];
}
// Per-product quantity picker (mirrors the customer booking page): tap a row to
// select, then −/+ sets quantity per product; 0 deselects. One delegated click
// handler (bound in openApptBookingModal) survives every re-render.
var _ABM_PRODUCTS = ['Wireless','Air','Fiber - Self Install'];
var _ABM_QTY = {};   // product name -> quantity (0 = not selected)
function _abmRenderSvcs() {
  var box=document.getElementById('abm-svcs'); if(!box) return; box.innerHTML='';
  _ABM_PRODUCTS.forEach(function(p){
    _ABM_QTY[p]=_ABM_QTY[p]||0;
    var on=_ABM_QTY[p]>0;
    var row=document.createElement('div');
    row.className='abm-prod'+(on?' on':'');
    row.setAttribute('data-p',p);
    row.innerHTML='<div class="abm-prod-tap"><span class="abm-prod-box">'+(on?'✓':'')+'</span><span class="abm-prod-name">'+esc(p)+'</span></div>'+
      '<div class="abm-qty'+(on?'':' hidden')+'">'+
        '<button type="button" class="abm-dec">−</button>'+
        '<span class="abm-n">'+(on?_ABM_QTY[p]:1)+'</span>'+
        '<button type="button" class="abm-inc">+</button>'+
      '</div>';
    box.appendChild(row);
  });
}
function _abmSvcsClick(e) {
  var row=e.target.closest('.abm-prod'); if(!row) return;
  var p=row.getAttribute('data-p'); if(!p) return;
  if(e.target.closest('.abm-inc'))           _ABM_QTY[p]=Math.min(20,(_ABM_QTY[p]||1)+1);
  else if(e.target.closest('.abm-dec'))      _ABM_QTY[p]=Math.max(0,(_ABM_QTY[p]||1)-1);
  else if(e.target.closest('.abm-prod-tap')) _ABM_QTY[p]=_ABM_QTY[p]>0?0:1;
  else return;
  _abmRenderSvcs();
}
function openApptBookingModal(date, activatorEmail, timeSlot) {
  _ABM = { when:'soonest', soonest:null };
  var acts = _APPT.activators||[];
  var actOpts='<option value="">Select activator…</option>'+
    '<option value="__next__">⚡ Next Available Agent</option>'+
    acts.map(function(a){
      return '<option value="'+esc(a.email)+'">'+esc(a.name)+' ('+esc(a.timezone||'TZ not set')+')</option>';
    }).join('');
  document.getElementById('appt-booking-body').innerHTML =
    '<div class="abm-section">'+
      '<div class="abm-section-title">Appointment</div>'+
      '<div class="appt-form-grid">'+
        '<div class="field" style="grid-column:1/-1"><label>Activator</label>'+
          '<select class="appt-form-input" id="abm-act" onchange="_abmActChange()">'+actOpts+'</select>'+
          '<div class="abm-act-hint" id="abm-balance-row" style="display:none">⚖ Balanced — assigns the least-busy activator</div>'+
        '</div>'+
        '<div class="field" style="grid-column:1/-1"><label>When</label>'+
          '<div class="abm-seg">'+
            '<button type="button" class="abm-seg-btn" id="abm-seg-soonest" onclick="_abmSetWhen(\'soonest\')">'+icon('zap')+' Soonest available</button>'+
            '<button type="button" class="abm-seg-btn" id="abm-seg-date" onclick="_abmSetWhen(\'date\')">'+icon('appointments')+' Pick a date</button>'+
          '</div>'+
          (_apptCanSameDay() ? '<label class="appt-chk abm-inline-chk abm-sameday-chk"><input type="checkbox" id="abm-sameday" onchange="_abmSameDayToggle()"> '+icon('issues')+' Include same-day <span class="appt-nextmode-hint">override — normally earliest is tomorrow</span></label>' : '')+
          '<div id="abm-when-body" style="margin-top:12px"></div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="abm-divider"></div>'+
    '<div class="abm-section">'+
      '<div class="abm-section-title">Customer</div>'+
      '<div class="appt-form-grid">'+
        '<div class="field"><label>First Name + Last Initial</label><input type="text" class="appt-form-input" id="abm-name" placeholder="e.g. John D."></div>'+
        '<div class="field"><label>DSI Number</label><input type="text" class="appt-form-input" id="abm-dsi" placeholder="DSI #"></div>'+
        '<div class="field"><label>Contact Number</label><input type="tel" class="appt-form-input" id="abm-phone" placeholder="(555) 555-5555"></div>'+
        '<div class="field"><label>Customer Email</label><input type="email" class="appt-form-input" id="abm-email" placeholder="customer@email.com"></div>'+
        '<div class="field"><label>Notes (optional)</label><textarea class="appt-form-input" id="abm-note" rows="2" placeholder="Special requests, context, best time to reach…" style="resize:vertical"></textarea></div>'+
        '<div class="field" style="grid-column:1/-1"><label>Services &amp; quantity (tap to select)</label>'+
          '<div class="abm-prod-list" id="abm-svcs"></div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div id="abm-error" style="color:var(--red);font-size:.82rem;margin-top:10px;display:none"></div>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">'+
      '<button class="appt-do-cancel-btn" style="border-color:var(--text2);color:var(--text2)" onclick="closeApptModal()">Cancel</button>'+
      '<button class="appt-book-btn" id="abm-submit-btn" onclick="submitApptBooking()">Confirm Booking</button>'+
    '</div>';
  document.getElementById('appt-booking-modal').classList.add('open');
  _ABM_QTY = {};
  _abmRenderSvcs();
  var svcsBox = document.getElementById('abm-svcs');
  if (svcsBox) svcsBox.addEventListener('click', _abmSvcsClick);
  // Pre-fill from a clicked grid cell → start in "Pick a date" mode; otherwise
  // default to the streamlined "Soonest available".
  if (activatorEmail) document.getElementById('abm-act').value = activatorEmail;
  var brow=document.getElementById('abm-balance-row');
  if(brow) brow.style.display = (document.getElementById('abm-act').value==='__next__') ? 'flex' : 'none';   // Next Available always balances
  if (date) {
    _abmSetWhen('date');
    var di=document.getElementById('abm-date'); if(di) di.value=date;
    _abmLoadSlots(timeSlot);
  } else {
    _abmSetWhen('soonest');
  }
}

// Toggle the When mode: rebuild the body for soonest (auto-find chip) or date.
function _abmSetWhen(mode) {
  _ABM.when = mode; _ABM.soonest = null;
  var sB=document.getElementById('abm-seg-soonest'), dB=document.getElementById('abm-seg-date');
  if(sB) sB.classList.toggle('active', mode==='soonest');
  if(dB) dB.classList.toggle('active', mode==='date');
  var body=document.getElementById('abm-when-body'); if(!body) return;
  if (mode==='soonest') {
    body.innerHTML='<div class="abm-soonest-chip" id="abm-soonest-chip"><span class="abm-chip-muted">Select an activator to find the soonest opening…</span></div>';
    _abmFindSoonest();
  } else {
    var sameday=!!(document.getElementById('abm-sameday')||{}).checked;
    var win=_apptWindow(sameday);
    body.innerHTML='<div class="appt-form-grid">'+
      '<div class="field"><label>Date</label><input type="date" class="appt-form-input" id="abm-date" min="'+win.min+'" max="'+win.max+'" onchange="_abmLoadSlots()"></div>'+
      '<div class="field"><label>Time Slot</label><select class="appt-form-input" id="abm-slot"><option value="">Select a date first…</option></select></div>'+
    '</div>'+
    (_officeTzLabel(CFG.officeId) ? '<div class="appt-tz-note" style="margin:10px 0 0">'+icon('clock')+' Times are in <strong>'+esc(_officeTzLabel(CFG.officeId))+'</strong>.</div>' : '');
  }
}

// Activator change: show Balance only for Next Available Agent, then refresh.
function _abmActChange() {
  var email=(document.getElementById('abm-act')||{}).value||'';
  var brow=document.getElementById('abm-balance-row');
  if(brow) brow.style.display = (email==='__next__') ? 'flex' : 'none';   // hint only; balancing is automatic
  if(_ABM.when==='soonest') _abmFindSoonest(); else _abmLoadSlots();
}

// Same-day override: affects both modes (soonest search floor + date min).
function _abmSameDayToggle() {
  var chk=!!(document.getElementById('abm-sameday')||{}).checked;
  if(_ABM.when==='date'){
    var di=document.getElementById('abm-date');
    if(di){ di.min=_apptWindow(chk).min; if(di.value && di.value<di.min) di.value=''; }
    _abmLoadSlots();
  } else {
    _abmFindSoonest();
  }
}

// "Soonest available": probe every day in the window in parallel, pick the
// earliest day that has an opening, and its earliest slot.
function _abmFindSoonest() {
  var chip=document.getElementById('abm-soonest-chip'); if(!chip) return;
  _ABM.soonest=null;
  var act=(document.getElementById('abm-act')||{}).value||'';
  if(!act){ chip.innerHTML='<span class="abm-chip-muted">Select an activator to find the soonest opening…</span>'; return; }
  var sameday=!!(document.getElementById('abm-sameday')||{}).checked;
  var role=sameday?SESSION.role:'';
  var win=_apptWindow(sameday);
  var dates=[], d=new Date(win.min+'T12:00:00'), end=new Date(win.max+'T12:00:00');
  while(d<=end){ dates.push(_apptDateStr(d)); d.setDate(d.getDate()+1); }
  chip.innerHTML='<span class="abm-chip-muted">'+icon('clock')+' Finding the soonest opening…</span>';
  var reqs=dates.map(function(ds){
    var req = act==='__next__' ? {action:'getNextAvailableSlots',officeId:CFG.officeId,date:ds,role:role}
                               : {action:'getAvailableSlots',activatorEmail:act,date:ds,role:role};
    return _apptGet(req).then(function(res){return {date:ds,slots:res.slots||[]};}).catch(function(){return {date:ds,slots:[]};});
  });
  Promise.all(reqs).then(function(results){
    if(_ABM.when!=='soonest') return;   // user switched modes mid-flight
    for(var i=0;i<results.length;i++){
      if(results[i].slots.length){
        var _ss=results[i].slots.slice().sort()[0];
        _ABM.soonest={date:results[i].date, slot:_ss};
        // Submit value stays canonical (act-tz for a specific activator, office-tz for __next__);
        // only the displayed label converts to office tz for a specific cross-zone activator.
        var _lbl=(act && act!=='__next__') ? _apptDualInline(results[i].date,_ss,act) : _apptFmt12(_ss);
        chip.innerHTML='<span class="abm-chip-ok">Earliest opening: <b>'+esc(_abmNiceDate(_ABM.soonest.date))+' · '+esc(_lbl)+'</b></span>';
        return;
      }
    }
    chip.innerHTML='<span class="abm-chip-muted">No openings in the next 7 days — try Pick a date.</span>';
  });
}

function _abmLoadSlots(preselect) {
  var email=(document.getElementById('abm-act')||{}).value||'';
  var date=(document.getElementById('abm-date')||{}).value||'';
  var sameday=!!(document.getElementById('abm-sameday')||{}).checked;
  var role = sameday ? SESSION.role : '';   // role sent only on explicit same-day opt-in
  var sel=document.getElementById('abm-slot');
  if (!email||!date){if(sel)sel.innerHTML='<option value="">Select activator &amp; date first…</option>';return;}
  if(sel)sel.innerHTML='<option value="">Loading available slots…</option>';
  var req = email==='__next__'
    ? {action:'getNextAvailableSlots',officeId:CFG.officeId,date:date,role:role}
    : {action:'getAvailableSlots',activatorEmail:email,date:date,role:role};
  _apptGet(req).then(function(res){
    var slots=res.slots||[];
    if(!slots.length){sel.innerHTML='<option value="">No available slots for this date</option>';return;}
    // Specific activator: stored slots are activator-TZ; show office-TZ labels (value stays canonical).
    var _conv = (email && email!=='__next__');
    sel.innerHTML='<option value="">Select a time…</option>'+slots.map(function(s){
      var lbl=_conv ? _apptDualInline(date,s,email) : _apptFmt12(s);
      return '<option value="'+esc(s)+'"'+(s===preselect?' selected':'')+'>'+lbl+'</option>';
    }).join('');
  }).catch(function(){if(sel)sel.innerHTML='<option value="">Error loading slots</option>';});
}

function submitApptBooking() {
  var actEmail=(document.getElementById('abm-act')||{}).value||'';
  var date, slot;
  if(_ABM.when==='soonest'){
    date=_ABM.soonest?_ABM.soonest.date:'';
    slot=_ABM.soonest?_ABM.soonest.slot:'';
  } else {
    date=(document.getElementById('abm-date')||{}).value||'';
    slot=(document.getElementById('abm-slot')||{}).value||'';
  }
  var name=(document.getElementById('abm-name')||{}).value||'';
  var dsi=(document.getElementById('abm-dsi')||{}).value||'';
  var phone=(document.getElementById('abm-phone')||{}).value||'';
  var email=(document.getElementById('abm-email')||{}).value||'';
  var note=((document.getElementById('abm-note')||{}).value||'').trim().slice(0,500);
  // Encode per-product quantities into the existing fields (no backend change):
  // services becomes ["Wireless x2","Air x1"] (backend joins with ", "); deviceCount = total.
  // NB: plain ASCII "x" (not "×") — the × multiplication sign gets mangled in the
  // booking POST's non-ASCII decode, so it would store/show as a broken character.
  var products=_ABM_PRODUCTS.filter(function(p){return _ABM_QTY[p]>0;}).map(function(p){return {name:p,qty:_ABM_QTY[p]};});
  var svcs=products.map(function(p){return p.name+' x'+p.qty;});
  var devices=products.reduce(function(s,p){return s+p.qty;},0);
  var sameday=!!(document.getElementById('abm-sameday')||{}).checked;
  var nextMode='balance';   // Next Available Agent always balances the load (backend only uses this for __next__)
  var errEl=document.getElementById('abm-error');
  if (!actEmail){errEl.textContent='Please choose an activator.';errEl.style.display='block';return;}
  if (_ABM.when==='soonest' && !slot){errEl.textContent='No opening found yet — try “Pick a date”.';errEl.style.display='block';return;}
  if (!date||!slot||!name||!dsi||!phone||!email){errEl.textContent='Please fill in all fields.';errEl.style.display='block';return;}
  if (!svcs.length){errEl.textContent='Please select at least one service.';errEl.style.display='block';return;}
  errEl.style.display='none';
  var btn=document.getElementById('abm-submit-btn');
  if(btn){btn.disabled=true;btn.textContent='Booking…';}
  _apptPost({action:'bookAppointment',bookerEmail:SESSION.email,activatorEmail:actEmail,
    date:date,timeSlot:slot,customerName:name,customerDSI:dsi,customerPhone:phone,
    customerEmail:email,customerNote:note,services:svcs,deviceCount:devices,office:CFG.officeId,
    nextMode:nextMode, role:(sameday?SESSION.role:'')   // role sent only on explicit same-day opt-in
  }).then(function(res){
    if(btn){btn.disabled=false;btn.textContent='Confirm Booking';}
    if(res.ok){closeApptModal();_APPT.appointments=null;renderAppointmentsTab();}
    else{errEl.textContent=res.error==='slot_unavailable'?'That slot was just taken — please pick another time.':(res.error==='outside_window'?'That date is outside the booking window.':(res.error||'Booking failed. Try again.'));errEl.style.display='block';}
  }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Confirm Booking';}errEl.textContent='Connection error. Try again.';errEl.style.display='block';});
}

function closeApptModal() { document.getElementById('appt-booking-modal').classList.remove('open'); }

// ── Appointment notes (customer note + internal staff thread) ──
function _apptNoteTime(iso){ if(!iso) return ''; var d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function _apptNotesBody(a){
  var cust = a.customerNote
    ? '<div style="background:rgba(var(--blue2-rgb),.1);border:1px solid rgba(var(--blue2-rgb),.25);border-radius:8px;padding:10px 12px;margin-bottom:14px">'+
        '<div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);margin-bottom:3px">Customer note</div>'+
        '<div style="white-space:pre-wrap">'+esc(a.customerNote)+'</div></div>'
    : '';
  var thread = (a.notes&&a.notes.length)
    ? a.notes.map(function(n){
        return '<div style="border-bottom:1px solid var(--border);padding:8px 0">'+
          '<div style="font-size:.74rem;color:var(--text2)">'+esc(n.authorName||n.authorEmail||'Staff')+' &middot; '+esc(_apptNoteTime(n.ts))+'</div>'+
          '<div style="margin-top:2px;white-space:pre-wrap">'+esc(n.noteText)+'</div></div>';
      }).join('')
    : '<div style="color:var(--text2);font-size:.85rem;padding:6px 0">No staff notes yet.</div>';
  return cust +
    '<div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);margin-bottom:4px">Staff notes (internal)</div>'+
    '<div id="appt-note-thread">'+thread+'</div>'+
    '<textarea id="appt-note-input" class="nm-textarea" rows="2" placeholder="Add an internal note…" style="margin-top:10px"></textarea>'+
    '<div class="nm-actions"><button class="nm-add-btn" onclick="addApptNoteUI(\''+esc(a.appointmentId)+'\')">ADD NOTE</button><button class="nm-close-btn" onclick="closeModal()">CLOSE</button></div>';
}
function openApptNotes(id){
  var a=((window._APPT&&_APPT.appointments)||[]).filter(function(x){return x.appointmentId===id;})[0];
  if(!a) return;
  document.getElementById('modal-title').innerHTML='<div class="nm-dsi">Appointment Notes — '+esc(a.customerName||'')+'</div>';
  document.getElementById('modal-body').innerHTML=_apptNotesBody(a);
  document.getElementById('detail-modal').classList.add('open');
}
function addApptNoteUI(id){
  var inp=document.getElementById('appt-note-input'); var txt=(inp?inp.value:'').trim().slice(0,1000); if(!txt) return;
  var a=((window._APPT&&_APPT.appointments)||[]).filter(function(x){return x.appointmentId===id;})[0];
  _apptPost({action:'addApptNote',appointmentId:id,noteText:txt,authorEmail:SESSION.email,authorName:SESSION.name,role:SESSION.role}).then(function(res){
    if(res&&res.ok){
      if(a){ a.notes=a.notes||[]; a.notes.push({ts:new Date().toISOString(),authorEmail:SESSION.email,authorName:SESSION.name,noteText:txt}); document.getElementById('modal-body').innerHTML=_apptNotesBody(a); }
    } else alert((res&&res.error)||'Could not add note.');
  }).catch(function(){ alert('Connection error.'); });
}

function cancelAppt(id) {
  if (!confirm('Cancel this appointment?')) return;
  _apptPost({action:'cancelAppointment',appointmentId:id,role:SESSION.role,email:SESSION.email}).then(function(res){
    if(res.ok){_APPT.appointments=null;renderAppointmentsTab();}
    else alert(res.error||'Cancel failed.');
  });
}

// Hard-delete (master-admin only) — permanently removes the appointment row.
// For clearing bad/test bookings; cancel only flags, this purges.
function deleteApptUI(id) {
  if (SESSION.role!=='master-admin') return;
  if (!confirm('Permanently DELETE this appointment? This removes the row entirely and cannot be undone.')) return;
  _apptPost({action:'deleteAppointment',appointmentId:id,role:SESSION.role,email:SESSION.email}).then(function(res){
    if(res.ok){_APPT.appointments=null;renderAppointmentsTab();}
    else alert(res.error||'Delete failed.');
  }).catch(function(){ alert('Connection error.'); });
}

// Rebuild the appointments view from cached data (no refetch) — used to revert
// an outcome <select> when the activator backs out of the note prompt.
function _apptRerender() {
  var c=document.getElementById('main-content');
  if(c&&CURRENT_TAB==='appointments'){ c.innerHTML=_apptBuildView(); _apptBindEvents(); }
}

// ── Outcome (manual marking by the activator) ─────────────────
var _APPT_OUTCOME = { id:'', outcome:'' };
var _OUTCOME_LABELS = { completed:'✓ Completed','no-show':'✗ No-Show', rescheduled:'↻ Rescheduled', canceled:'⊘ Canceled' };
function setApptOutcomeUI(id, outcome) {
  if (!outcome) return;
  _APPT_OUTCOME = { id:id, outcome:outcome };
  var canActivate = SESSION.role==='master-admin' || SESSION.role==='activator';
  // Lines-activated only makes sense when the appointment actually happened.
  var showLines = canActivate && outcome==='completed';
  var linesField = showLines ? _linesFieldHtml('appt-outcome-body',icon('zap')+' Lines activated during this appointment') : '';
  document.getElementById('appt-outcome-title').textContent = 'Mark Outcome — '+(_OUTCOME_LABELS[outcome]||outcome);
  document.getElementById('appt-outcome-body').innerHTML =
    '<label class="ao-label">Note '+(showLines?'':'(optional)')+'</label>'+
    '<textarea id="appt-outcome-note" class="nm-textarea" placeholder="Activation note for this appointment (saved to the customer’s notes)…" style="margin-bottom:10px"></textarea>'+
    linesField+
    '<div class="nm-actions" style="margin-top:14px">'+
      '<button class="nm-close-btn" style="flex:1" onclick="closeApptOutcomeModal(true)">Cancel</button>'+
      '<button class="nm-add-btn" style="flex:2" onclick="submitApptOutcome()">Save Outcome</button>'+
    '</div>';
  document.getElementById('appt-outcome-modal').classList.add('open');
}
function closeApptOutcomeModal(revert) {
  document.getElementById('appt-outcome-modal').classList.remove('open');
  if (revert) _apptRerender();   // backed out → revert the select
}
function submitApptOutcome() {
  var id=_APPT_OUTCOME.id, outcome=_APPT_OUTCOME.outcome;
  if (!id||!outcome) return;
  var noteEl=document.getElementById('appt-outcome-note');
  var note=noteEl?noteEl.value.trim():'';
  var lines=_linesGet('appt-outcome-body');
  document.getElementById('appt-outcome-modal').classList.remove('open');
  _apptPost({action:'setApptOutcome',appointmentId:id,outcome:outcome,note:note,linesActivated:lines,
    role:SESSION.role,email:SESSION.email}).then(function(res){
    if(res.ok){ _APPT.appointments=null; renderAppointmentsTab(); }
    else { alert(res.error||'Failed to set outcome.'); _apptRerender(); }
  }).catch(function(){ alert('Connection error.'); _apptRerender(); });
}

// ── Reschedule in place ───────────────────────────────────────
function rescheduleApptUI(id) {
  var a=(_APPT.appointments||[]).find(function(x){return x.appointmentId===id;});
  if(!a) return;
  var acts=_APPT.activators||[], win=_apptWindow();
  var actOpts='<option value="">Keep current — '+esc(_apptActName(a.activatorEmail))+'</option>'+
    '<option value="__next__">⚡ Next Available Agent</option>'+
    acts.map(function(x){return '<option value="'+esc(x.email)+'">'+esc(x.name)+'</option>';}).join('');
  document.getElementById('appt-resched-body').innerHTML=
    '<div style="font-size:.82rem;color:var(--text2);margin-bottom:12px">'+
      '<strong style="color:var(--text)">'+esc(a.customerName||'Customer')+'</strong> — currently '+
      esc(_apptFmtDate(a.date))+' at '+esc(_apptFmt12(_apptToOffice(a.date,a.timeSlot,a.activatorEmail)))+'</div>'+
    '<div class="appt-form-grid">'+
      '<div class="field"><label>New Date</label><input type="date" class="appt-form-input" id="rsd-date" min="'+win.min+'" max="'+win.max+'" onchange="_reschedLoadSlots()"></div>'+
      '<div class="field"><label>Activator</label><select class="appt-form-input" id="rsd-act" onchange="_reschedLoadSlots()">'+actOpts+'</select></div>'+
      '<div class="field" style="grid-column:1/-1"><label>New Time Slot</label><select class="appt-form-input" id="rsd-slot"><option value="">Pick a date first…</option></select></div>'+
    '</div>'+
    (_officeTzLabel(CFG.officeId) ? '<div class="appt-tz-note" style="margin:10px 0 0">'+icon('clock')+' Times are in <strong>'+esc(_officeTzLabel(CFG.officeId))+'</strong>.</div>' : '')+
    '<div id="rsd-error" style="color:var(--red);font-size:.82rem;margin-top:10px;display:none"></div>'+
    '<input type="hidden" id="rsd-id" value="'+esc(id)+'">'+
    '<input type="hidden" id="rsd-curact" value="'+esc(a.activatorEmail)+'">'+
    '<input type="hidden" id="rsd-office" value="'+esc(a.office||CFG.officeId)+'">'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">'+
      '<button class="appt-do-cancel-btn" style="border-color:var(--text2);color:var(--text2)" onclick="closeApptReschedModal()">Cancel</button>'+
      '<button class="appt-book-btn" id="rsd-submit" onclick="submitReschedule()">Confirm New Time</button>'+
    '</div>';
  document.getElementById('appt-resched-modal').classList.add('open');
}

function _reschedLoadSlots() {
  var date=(document.getElementById('rsd-date')||{}).value||'';
  var chosen=(document.getElementById('rsd-act')||{}).value||'';
  var cur=(document.getElementById('rsd-curact')||{}).value||'';
  var office=(document.getElementById('rsd-office')||{}).value||CFG.officeId;
  var id=(document.getElementById('rsd-id')||{}).value||'';
  var act=chosen||cur;   // blank choice = keep current activator
  var sel=document.getElementById('rsd-slot');
  if(!date){if(sel)sel.innerHTML='<option value="">Pick a date first…</option>';return;}
  if(sel)sel.innerHTML='<option value="">Loading…</option>';
  var req = act==='__next__'
    ? {action:'getNextAvailableSlots',officeId:office,date:date}
    : {action:'getAvailableSlots',activatorEmail:act,date:date,excludeId:id};
  _apptGet(req).then(function(res){
    var slots=res.slots||[];
    if(!slots.length){sel.innerHTML='<option value="">No open slots for this date</option>';return;}
    var _conv = (act && act!=='__next__');
    sel.innerHTML='<option value="">Select a time…</option>'+slots.map(function(s){
      var lbl=_conv ? _apptFmt12(_tzConvertClock(date,s,_apptActTz(act),APPT_OFFICE_TZ[office]||_apptOfficeTzId())) : _apptFmt12(s);
      return '<option value="'+esc(s)+'">'+lbl+'</option>';
    }).join('');
  }).catch(function(){if(sel)sel.innerHTML='<option value="">Error loading slots</option>';});
}

function submitReschedule() {
  var id=(document.getElementById('rsd-id')||{}).value||'';
  var date=(document.getElementById('rsd-date')||{}).value||'';
  var slot=(document.getElementById('rsd-slot')||{}).value||'';
  var chosen=(document.getElementById('rsd-act')||{}).value||'';
  var err=document.getElementById('rsd-error');
  if(!date||!slot){err.textContent='Pick a new date and time.';err.style.display='block';return;}
  err.style.display='none';
  var btn=document.getElementById('rsd-submit'); if(btn){btn.disabled=true;btn.textContent='Saving…';}
  var body={action:'rescheduleAppointment',appointmentId:id,date:date,timeSlot:slot,role:SESSION.role,email:SESSION.email};
  if(chosen) body.activatorEmail=chosen;
  _apptPost(body).then(function(res){
    if(btn){btn.disabled=false;btn.textContent='Confirm New Time';}
    if(res.ok){closeApptReschedModal();_APPT.appointments=null;renderAppointmentsTab();}
    else{err.textContent=res.error==='slot_unavailable'?'That slot is no longer open — pick another.':
      (res.error==='outside_window'?'Pick a date within the next 7 days.':(res.error||'Reschedule failed.'));
      err.style.display='block';}
  }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Confirm New Time';}err.textContent='Connection error. Try again.';err.style.display='block';});
}

function closeApptReschedModal() { document.getElementById('appt-resched-modal').classList.remove('open'); }

// ── Schedule Modal ─────────────────────────────────────────────
function openApptSchedModal() {
  // Fetch the user's OWN schedule directly (not via _APPT.activators) so a
  // master-admin who has opted OUT of the booking pool — and is therefore no
  // longer in getActivators — can still open this modal and opt back in.
  document.getElementById('appt-sched-body').innerHTML='<div class="empty">Loading your schedule…</div>';
  document.getElementById('appt-sched-modal').classList.add('open');
  _apptGet({action:'getActivatorSchedule',email:SESSION.email}).then(function(res){
    _renderSchedModal(res.schedule||{});
  }).catch(function(){
    document.getElementById('appt-sched-body').innerHTML='<div class="empty">Failed to load. Close and try again.</div>';
  });
}
function _copyCalShareEmail() {
  var e = APPT_CAL_SHARE_EMAIL;
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(e); }
  else {
    var t=document.createElement('textarea'); t.value=e; t.style.position='fixed'; t.style.opacity='0';
    document.body.appendChild(t); t.select(); try{document.execCommand('copy');}catch(_){} document.body.removeChild(t);
  }
  showToast('Copied: '+e);
}
function _renderSchedModal(sched) {
  var me=SESSION.email, myAct=(_APPT.activators||[]).find(function(a){return a.email===me;})||{};
  var tz=sched.timezone||myAct.timezone||'';
  // Effective booking-pool state: explicit flag wins, else role default
  // (master-admin OFF, activator ON).
  var canBook = sched.bookable==='true' ? true : (sched.bookable==='false' ? false : (SESSION.role!=='master-admin'));
  var tzOpts=[
    ['America/New_York','Eastern (ET)'],['America/Chicago','Central (CT)'],
    ['America/Denver','Mountain (MT)'],['America/Los_Angeles','Pacific (PT)'],
    ['America/Anchorage','Alaska (AKT)'],['Pacific/Honolulu','Hawaii (HT)']
  ].map(function(t){return '<option value="'+t[0]+'"'+(t[0]===tz?' selected':'')+'>'+t[1]+'</option>';}).join('');
  var days=[['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],['thu','Thursday'],['fri','Friday'],['sat','Saturday'],['sun','Sunday']];
  var schedHtml=days.map(function(day){
    var ds=sched[day[0]]||{},on=!!(ds.start&&ds.end);
    return '<div class="appt-sched-row">'+
      '<label class="appt-day-toggle"><input type="checkbox" class="appt-day-cb" data-day="'+day[0]+'"'+(on?' checked':'')+'>'+day[1]+'</label>'+
      '<div class="appt-day-times"'+(on?'':' style="display:none"')+'>'+
        '<input type="time" class="appt-time-inp" id="sc-'+day[0]+'-s" value="'+(ds.start||'10:00')+'">'+
        '<span style="color:var(--text2);font-size:.8rem">to</span>'+
        '<input type="time" class="appt-time-inp" id="sc-'+day[0]+'-e" value="'+(ds.end||'17:00')+'">'+
      '</div></div>';
  }).join('');
  document.getElementById('appt-sched-body').innerHTML=
    '<div class="sc-bookable-box">'+
      '<label class="appt-chk"><input type="checkbox" id="sc-bookable"'+(canBook?' checked':'')+'> <b>Available for appointment booking</b></label>'+
      '<div class="sc-bookable-hint">When on, you appear in the booking pool + Next Available Agent. '+(SESSION.role==='master-admin'?'Master-admins are off by default — turn this on only if you take appointments.':'Turn off if you temporarily aren’t taking appointments.')+'</div>'+
    '</div>'+
    '<div style="border:1px solid rgba(var(--blue2-rgb),.35);background:rgba(var(--blue2-rgb),.08);border-radius:10px;padding:12px 14px;margin-bottom:16px">'+
      '<div style="font-weight:700;margin-bottom:4px">'+icon('appointments')+' Link your Google Calendar <span style="font-weight:400;color:var(--text2);font-size:.82rem">— recommended</span></div>'+
      '<div style="font-size:.84rem;color:var(--text);line-height:1.5">'+
        'So the system automatically <b>blocks the times you’re busy</b> and adds <b>booked appointments onto your calendar</b>, share your calendar once:'+
        '<ol style="margin:8px 0 6px 18px;padding:0;font-size:.83rem;color:var(--text2);line-height:1.65">'+
          '<li>Open <b>Google Calendar</b> on a computer (calendar.google.com).</li>'+
          '<li>Hover <b>your calendar</b> in the left list → <b>⋮</b> → <b>Settings and sharing</b>.</li>'+
          '<li>Under <b>Share with specific people or groups</b> → <b>Add people</b>.</li>'+
          '<li>Add the address below, set permission to <b>“Make changes to events,”</b> then <b>Send</b>.</li>'+
        '</ol>'+
        '<div style="display:flex;align-items:center;gap:8px;margin:6px 0 2px;flex-wrap:wrap">'+
          '<code style="background:var(--surface2);padding:4px 9px;border-radius:6px;font-size:.84rem;user-select:all">'+esc(APPT_CAL_SHARE_EMAIL)+'</code>'+
          '<button type="button" class="appt-book-btn" style="padding:4px 12px;font-size:.78rem" onclick="_copyCalShareEmail()">Copy address</button>'+
        '</div>'+
        '<div class="sc-bookable-hint" style="margin-top:8px">One-time, ~30 seconds. We only read your <b>busy times</b> (never event titles). Not linked? Booking still works — your calendar just won’t auto-block.</div>'+
      '</div>'+
    '</div>'+
    '<div class="field" style="margin-bottom:16px"><label>My Timezone</label>'+
      '<select class="appt-form-input" id="sc-tz">'+tzOpts+'</select>'+
      '<div class="sc-bookable-hint" style="margin-top:6px">Your working hours below are in <strong>your</strong> timezone. Reps and customers booking you see those times converted to the office’s timezone.</div></div>'+
    '<div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:10px">Working Hours</div>'+
    schedHtml+
    '<div style="margin-top:18px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:8px">Booking Guardrails (optional)</div>'+
    '<div class="appt-sched-row">'+
      '<label class="appt-day-toggle" style="min-width:150px">Buffer between appts</label>'+
      '<input type="number" class="appt-time-inp" id="sc-buffer" min="0" max="240" step="15" value="'+(Number(sched.bufferMins)||0)+'" style="width:72px">'+
      '<span style="color:var(--text2);font-size:.8rem">min (0 = off)</span>'+
    '</div>'+
    '<div class="appt-sched-row">'+
      '<label class="appt-day-toggle" style="min-width:150px">Max appts per day</label>'+
      '<input type="number" class="appt-time-inp" id="sc-maxday" min="0" max="20" step="1" value="'+(Number(sched.maxPerDay)||0)+'" style="width:72px">'+
      '<span style="color:var(--text2);font-size:.8rem">(0 = unlimited)</span>'+
    '</div>'+
    '<div style="margin-top:18px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:8px">Blocked Dates / Times</div>'+
    '<div id="sc-blocks"></div>'+
    '<div class="appt-block-add-row">'+
      '<input type="date" class="appt-form-input" style="width:auto" id="blk-dt" min="'+_apptDateStr(new Date())+'">'+
      '<label class="appt-chk"><input type="checkbox" id="blk-ad" checked onchange="document.getElementById(\'blk-times\').style.display=this.checked?\'none\':\'flex\'"> All Day</label>'+
      '<div id="blk-times" style="display:none;gap:8px;align-items:center">'+
        '<input type="time" class="appt-time-inp" id="blk-ts" value="09:00">'+
        '<span style="color:var(--text2);font-size:.8rem">to</span>'+
        '<input type="time" class="appt-time-inp" id="blk-te" value="17:00">'+
      '</div>'+
      '<input type="text" class="appt-form-input" id="blk-rsn" placeholder="Reason (optional)" style="flex:1;min-width:120px">'+
      '<button class="appt-book-btn" onclick="_addBlk()">+ Add</button>'+
    '</div>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">'+
      '<button class="appt-do-cancel-btn" style="border-color:var(--text2);color:var(--text2)" onclick="closeApptSchedModal()">Cancel</button>'+
      '<button class="appt-book-btn" id="sc-save-btn" onclick="saveApptSched()">Save Schedule</button>'+
    '</div>';
  document.querySelectorAll('.appt-day-cb').forEach(function(cb){
    cb.addEventListener('change',function(){
      this.closest('.appt-sched-row').querySelector('.appt-day-times').style.display=this.checked?'flex':'none';
    });
  });
  _loadBlocks(me);
  document.getElementById('appt-sched-modal').classList.add('open');
}

function _loadBlocks(email) {
  var el=document.getElementById('sc-blocks'); if(!el) return;
  el.innerHTML='<div style="color:var(--text2);font-size:.82rem;padding:4px 0">Loading blocks…</div>';
  _apptGet({action:'getActivatorBlocks',email:email}).then(function(res){
    var blocks=res.blocks||[];
    if(!blocks.length){el.innerHTML='<div style="color:var(--text2);font-size:.82rem;padding:4px 0">No blocks set.</div>';return;}
    el.innerHTML=blocks.map(function(b){
      var t=b.allDay?'All Day':_apptFmt12(b.startTime)+' – '+_apptFmt12(b.endTime);
      return '<div class="appt-block-row">'+
        '<span class="appt-block-date">'+esc(_apptFmtDate(b.date))+'</span>'+
        '<span class="appt-block-time">'+esc(t)+'</span>'+
        '<span class="appt-block-reason">'+esc(b.reason||'')+'</span>'+
        '<button class="appt-do-cancel-btn" onclick="_removeBlk(\''+esc(b.blockId)+'\',\''+esc(email)+'\')"><span class="ico"><svg><use href="#i-x"></use></svg></span></button>'+
      '</div>';
    }).join('');
  });
}

function _addBlk() {
  var date=(document.getElementById('blk-dt')||{}).value||'';
  if(!date){alert('Select a date for the block.');return;}
  var allDay=(document.getElementById('blk-ad')||{}).checked!==false;
  _apptPost({action:'addActivatorBlock',activatorEmail:SESSION.email,date:date,
    allDay:allDay,startTime:(document.getElementById('blk-ts')||{}).value||'',
    endTime:(document.getElementById('blk-te')||{}).value||'',
    reason:(document.getElementById('blk-rsn')||{}).value||''
  }).then(function(res){
    if(res.ok){_loadBlocks(SESSION.email);document.getElementById('blk-dt').value='';document.getElementById('blk-rsn').value='';}
    else alert(res.error||'Failed to add block.');
  });
}

function _removeBlk(blockId,email) {
  _apptPost({action:'removeActivatorBlock',blockId:blockId}).then(function(res){
    if(res.ok)_loadBlocks(email); else alert(res.error||'Failed.');
  });
}

function saveApptSched() {
  var tz=(document.getElementById('sc-tz')||{}).value||'';
  var sched={};
  ['mon','tue','wed','thu','fri','sat','sun'].forEach(function(day){
    var cb=document.querySelector('[data-day="'+day+'"]');
    var s=(document.getElementById('sc-'+day+'-s')||{}).value||'';
    var e=(document.getElementById('sc-'+day+'-e')||{}).value||'';
    sched[day]=(cb&&cb.checked&&s&&e)?{start:s,end:e}:{start:'',end:''};
  });
  var buffer=parseInt((document.getElementById('sc-buffer')||{}).value||'0')||0;
  var maxday=parseInt((document.getElementById('sc-maxday')||{}).value||'0')||0;
  var bookable=!!(document.getElementById('sc-bookable')||{}).checked;
  var btn=document.getElementById('sc-save-btn');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  Promise.all([
    _apptPost({action:'setActivatorSchedule',email:SESSION.email,timezone:tz,schedule:sched,bufferMins:buffer,maxPerDay:maxday,bookable:bookable}),
    _apptPost({action:'setActivatorTimezone',email:SESSION.email,timezone:tz})
  ]).then(function(){
    if(btn){btn.disabled=false;btn.textContent='Save Schedule';}
    closeApptSchedModal(); _APPT.activators=null; renderAppointmentsTab();
  }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Save Schedule';}alert('Save failed. Try again.');});
}

function closeApptSchedModal() { document.getElementById('appt-sched-modal').classList.remove('open'); }

