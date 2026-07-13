// ── ACTIVATION RATES ──────────────────────────────────────────────────────
var _AR_LINES = null;
var _AR_LOADING = false;

function renderActRates() {
  if (_AR_LINES) return _renderActRatesWithData();
  if (_AR_LOADING) return '<div class="empty">Loading activation rates…</div>';
  _AR_LOADING = true;
  api({ action: 'readActRateLines' }).then(function(resp) {
    _AR_LOADING = false;
    _AR_LINES = (resp && resp.actRateLines) ? resp.actRateLines : [];
    if (CURRENT_TAB === 'actrates') {
      var c = document.getElementById('main-content');
      if (c) c.innerHTML = _renderActRatesWithData();
    }
  }).catch(function() {
    _AR_LOADING = false;
    _AR_LINES = [];
  });
  return '<div class="empty">Loading activation rates…</div>';
}

function _renderActRatesWithData() {
  if (!_AR_LINES || !_AR_LINES.length) return noData('No activation rate data available.', {icon:'actrates'});

  var role = SESSION.role || 'client-rep';
  var myName = (SESSION.tableauName || '').toLowerCase();
  var isTeamScoped = role === 'leader';   // jd is office-wide (manager-equivalent)
  var isRep = role === 'client-rep' || isTeamScoped;

  var repSet = {};
  _AR_LINES.forEach(function(l) { repSet[l.rep]=true; });
  var reps = Object.keys(repSet).sort();

  var filterHtml = isRep ? '' :
    '<div class="filter-row">' +
    '<select class="ar-select" id="ar-rep-sel" onchange="refreshActRates()"><option value="">All Reps</option>' +
    reps.map(function(r){ return '<option value="'+esc(r)+'">'+esc(r)+'</option>'; }).join('') + '</select>' +
    '</div>';

  return '<div class="card"><div class="card-header dark">Activation Rates</div><div class="card-body">' +
    filterHtml + '<div id="ar-table-wrap">' + _buildArTable('') + '</div></div></div>';
}

function refreshActRates() {
  var rs = document.getElementById('ar-rep-sel');
  var wrap = document.getElementById('ar-table-wrap');
  if (wrap) wrap.innerHTML = _buildArTable(rs ? rs.value : '');
}

function _buildArTable(repFilter) {
  if (!_AR_LINES) return '';
  var role = SESSION.role || 'client-rep';
  var myName = (SESSION.tableauName || '').toLowerCase();
  var isClientRep = role === 'client-rep';
  var isTeamRole = role === 'leader';   // jd is office-wide (manager-equivalent)

  var BKT_MAP = { '0-7 Days':'b0_7', '8-14 Days':'b8_14', '15-30 Days':'b15_30', '31-60 Days':'b31_60' };

  // All office lines (respects admin rep-filter dropdown only)
  var allLines = _AR_LINES.filter(function(l) {
    if (repFilter && l.rep !== repFilter) return false;
    return true;
  });

  // Determine visible individual rows
  var indivLines;
  if (isClientRep && myName) {
    indivLines = allLines.filter(function(l) { return l.rep.toLowerCase() === myName; });
  } else if (isTeamRole) {
    var _arTeam = _myTeam();
    var _arTns = _arTeam ? _teamTableauNames(_arTeam.name) : [];
    if (_arTns.length) {
      indivLines = allLines.filter(function(l) { return _arTns.indexOf(l.rep.trim().toLowerCase()) !== -1; });
    } else if (myName) {
      indivLines = allLines.filter(function(l) { return l.rep.toLowerCase() === myName; });
    } else {
      indivLines = [];
    }
  } else {
    indivLines = allLines;
  }

  // Aggregate individual rows
  var repData = {};
  indivLines.forEach(function(l) {
    var b=BKT_MAP[l.bucket]; if (!b) return;
    if (!repData[l.rep]) repData[l.rep]={b0_7:{t:0,a:0},b8_14:{t:0,a:0},b15_30:{t:0,a:0},b31_60:{t:0,a:0}};
    repData[l.rep][b].t+=(l.vol||0); repData[l.rep][b].a+=(l.acts||0); repData[l.rep][b].color=l.color;
  });

  // Grand total: team roles use team lines; others use full office lines
  var grandLines = isTeamRole ? indivLines : allLines;
  var totals={b0_7:{t:0,a:0},b8_14:{t:0,a:0},b15_30:{t:0,a:0},b31_60:{t:0,a:0}};
  grandLines.forEach(function(l) {
    var b=BKT_MAP[l.bucket]; if (!b) return;
    totals[b].t+=(l.vol||0); totals[b].a+=(l.acts||0);
  });

  // Portal's own thresholds — kept ONLY as a fallback when Tableau's color isn't
  // present (e.g. before the backend that supplies it is redeployed).
  function bktCls(bktKey, pct) {
    if (bktKey==='b0_7')   return pct>=21?'ar-green':pct>=10?'ar-yellow':'ar-red';
    if (bktKey==='b8_14')  return pct>=71?'ar-green':pct>=51?'ar-yellow':'ar-red';
    if (bktKey==='b15_30') return pct>=75?'ar-green':pct>=70?'ar-yellow':'ar-red';
    if (bktKey==='b31_60') return pct>=86?'ar-green':pct>=79?'ar-yellow':'ar-red';
    return pct>=80?'ar-green':pct>=60?'ar-yellow':'ar-red';
  }
  // Tableau's "Activation Color" (Green/Yellow/Red) -> our cell class. Empty when absent.
  function arColorCls(color) {
    var c = String(color||'').toLowerCase();
    return c==='green'?'ar-green':c==='yellow'?'ar-yellow':c==='red'?'ar-red':'';
  }
  // Tableau colors each cell by the bucket's rate (a fixed Green/Yellow/Red step),
  // but exports per-rep rows only — no Grand Total. Derive each bucket's cutoffs
  // from Tableau's own colored rows so the Grand Total is colored Tableau's way.
  var arCuts = {};
  (_AR_LINES||[]).forEach(function(l) {
    var bk = BKT_MAP[l.bucket]; if (!bk || !l.vol) return;
    var p = Math.round(l.acts/l.vol*100), cc = String(l.color||'').toLowerCase();
    if (!arCuts[bk]) arCuts[bk] = { greenMin: Infinity, redMax: -Infinity };
    if (cc==='green' && p < arCuts[bk].greenMin) arCuts[bk].greenMin = p;
    if (cc==='red'   && p > arCuts[bk].redMax)   arCuts[bk].redMax = p;
  });
  function arTotalCls(bktKey, pct) {
    var c = arCuts[bktKey];
    if (c && c.greenMin!==Infinity && c.redMax!==-Infinity && c.redMax < c.greenMin) {
      if (pct >= c.greenMin) return 'ar-green';
      if (pct <= c.redMax)   return 'ar-red';
      return 'ar-yellow';
    }
    return bktCls(bktKey, pct);   // fallback when cutoffs can't be derived cleanly
  }

  function cell(b, bktKey, isTotal) {
    if (!isTotal && b.t===0) return '<td></td>';
    if (b.t===0) return '<td class="ar-cell"><div class="ar-badge ar-blue">(0/0)<br>—</div></td>';
    var pct=Math.round(b.a/b.t*100);
    var cls = isTotal ? arTotalCls(bktKey, pct) : (arColorCls(b.color) || bktCls(bktKey, pct));
    return '<td class="ar-cell"><div class="ar-badge '+cls+'">('+b.a+'/'+b.t+')<br>'+pct+'%</div></td>';
  }

  var repRows = Object.keys(repData).sort().map(function(rep) {
    var d=repData[rep];
    return '<tr><td class="ar-rep">'+esc(rep)+'</td>'+cell(d.b0_7,'b0_7',false)+cell(d.b8_14,'b8_14',false)+cell(d.b15_30,'b15_30',false)+cell(d.b31_60,'b31_60',false)+'</tr>';
  }).join('');

  if (!repRows) return '<div class="empty">No data for the selected filters.</div>';

  var grandRow = '<tr class="ar-grand-row"><td class="ar-rep ar-grand-rep">Grand Total</td>'+cell(totals.b0_7,'b0_7',true)+cell(totals.b8_14,'b8_14',true)+cell(totals.b15_30,'b15_30',true)+cell(totals.b31_60,'b31_60',true)+'</tr>';

  return '<div class="tbl-wrap"><table class="call-table"><thead><tr>' +
    '<th>Rep</th><th>0–7 Days</th><th>8–14 Days</th><th>15–30 Days</th><th>31–60 Days</th>' +
    '</tr></thead><tbody>'+grandRow+repRows+'</tbody></table></div>';
}

// ── CALL TABLE HELPERS ────────────────────────────────────────────────────
var RATING_OPTS = ['No Answer','1 Star','2 Stars','3 Stars','4 Stars','5 Stars'];

// ── STATUS PILL ───────────────────────────────────────────────────────────
function spCls(s) {
  if (!s) return 'sp-pale-yellow';
  var sl = s.toLowerCase().trim();
  if (!sl || sl === 'null' || sl === '—' || sl === '-') return 'sp-pale-yellow';
  if (sl === 'active')                                           return 'sp-active';
  if (sl === 'posted' || sl === 'approved')                     return 'sp-posted';
  if (sl.indexOf('cancel') !== -1)                              return 'sp-canceled';
  if (sl.indexOf('disco') !== -1)                               return 'sp-disconnected';
  if (sl === 'porting issue' || sl === 'pending valid payment') return 'sp-orange-bright';
  if (sl === 'byod')                                            return 'sp-orange';
  if (sl === 'port approved' || sl === 'pending order port')    return 'sp-dark-orange';
  if (sl.indexOf('deliver') !== -1)                             return 'sp-purple';
  if (sl.indexOf('ship') !== -1)                                return 'sp-yellow-bright';
  if (sl === 'scheduled' || sl.indexOf('sched') !== -1)         return 'sp-yellow';
  if (sl.indexOf('pend') !== -1 || sl === 'open' || sl === 'confirmed') return 'sp-pale-yellow';
  if (sl.indexOf('backorder') !== -1 || sl.indexOf('back order') !== -1) return 'sp-pale-yellow';
  return 'sp-default';
}
function statusPill(s) {
  if (!s) return '<span class="sp sp-pale-yellow">Null</span>';
  return '<span class="sp ' + spCls(s) + '">' + esc(s) + '</span>';
}

var SARA_URL = 'https://www.saraplus.com/e/ServicePages/Login.aspx';
var _openedDsis = new Set();

function clickDsi(dsi) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(dsi);
  } else {
    var el = document.createElement('textarea');
    el.value = dsi; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.select(); document.execCommand('copy');
    document.body.removeChild(el);
  }
  if (!_openedDsis.has(dsi)) {
    _openedDsis.add(dsi);
    window.open(SARA_URL, '_blank');
    showToast('Copied & opened SARA: ' + dsi);
  } else {
    showToast('Copied: ' + dsi);
  }
}
function copyDsiAndOpen(dsi) { clickDsi(dsi); }

function showToast(msg) {
  var t = document.getElementById('dsi-toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2200);
}

var PRODUCT_LABELS = { 'WIRELESS':'Wireless','AIR/AWB':'Air','TABLET/WEARABLE':'Tablet','FIBER':'Fiber','VOIP':'VoIP','DTV':'DTV' };

function productBreakdown(productCounts, clickable) {
  if (!productCounts || !Object.keys(productCounts).length) return '<span class="sp sp-default">—</span>';
  return Object.keys(productCounts).map(function(pt) {
    var label = PRODUCT_LABELS[pt.toUpperCase()] || pt;
    var count = productCounts[pt];
    var attrs = clickable ? ' ct-clk" onclick="_ctAddFilter(\'product\',\''+esc(pt)+'\')" title="Click to filter by this product"' : '"';
    return '<span class="prod-pill'+attrs+'>' + esc(label) + (count > 1 ? ' \xd7' + count : '') + '</span>';
  }).join('');
}

function statusBreakdown(statusCounts, clickable) {
  if (!statusCounts || !Object.keys(statusCounts).length) return '<span class="sp sp-yellow">—</span>';
  return Object.keys(statusCounts).map(function(s) {
    var count = statusCounts[s];
    var attrs = clickable ? ' ct-clk" onclick="_ctAddFilter(\'status\',\''+esc(s)+'\')" title="Click to filter by this status"' : '"';
    return '<span class="sp ' + spCls(s) + attrs + '>' + esc(s) + (count > 1 ? ' \xd7' + count : '') + '</span>';
  }).join(' ');
}

function ratingPill(dsi, safeId) {
  var r = (DATA.ratings||{})[dsi] || '';
  var cls = r==='No Answer'?'rp-na':r==='1 Star'?'rp-1':r==='2 Stars'?'rp-2':r==='3 Stars'?'rp-3':r==='4 Stars'?'rp-4':r==='5 Stars'?'rp-5':'';
  var id = safeId ? ' id="rp-'+safeId+'"' : '';
  return '<span class="rating-pill '+cls+'"'+id+'>'+esc(r)+'</span>';
}

// ── TABLEAU NAMES LOADER ─────────────────────────────────────────────────
var PEOPLE_TABLEAU_NAMES = null;
function ensureTableauNames(cb) {
  if (PEOPLE_TABLEAU_NAMES !== null) { cb(); return; }
  api({ action: 'readRepNames' }).then(function(res) {
    PEOPLE_TABLEAU_NAMES = res.names || [];
    cb();
  }).catch(function() { PEOPLE_TABLEAU_NAMES = []; cb(); });
}

// ── NOTES MODAL ───────────────────────────────────────────────────────────
var _modalDsi = '';
var _modalOffice = '';   // office the modal's notes belong to (cross-office dashboard support)
var _modalApptId = '';   // set when opened from an appointment → note adds route via addAppointmentNote

function _noteItemHtml(n) {
  var la=Math.max(0,parseInt(n.linesActivated,10)||0);
  var badge=la>0?' <span class="nm-lines-badge">'+icon('zap')+' '+la+' line'+(la===1?'':'s')+' activated</span>':'';
  return '<div class="nm-note"><div class="nm-note-meta">'+fmtDate(n.ts)+' &mdash; '+esc(n.authorName)+badge+'</div><div class="nm-note-text">'+esc(n.noteText)+'</div></div>';
}

function openNotesModal(dsi, customer, rep, opts) {
  opts = opts || {};
  _modalDsi = dsi;
  _modalOffice = opts.office || CFG.officeId;
  _modalApptId = opts.appointmentId || '';
  var _cross = !!_modalApptId && _modalOffice !== CFG.officeId;
  var notes = _cross ? (opts.notes || []) : ((DATA.notes||{})[dsi] || opts.notes || []);
  var rating = (DATA.ratings||{})[dsi] || '';
  var role = SESSION.role || 'client-rep';
  var canAddActivation = role==='master-admin' || role==='activator';
  var canAddRep = ['master-admin','owner','admin','activator','client-rep','leader','jd','manager'].indexOf(role) !== -1;

  var actNotes = notes.filter(function(n){ return (n.noteType||'activation')==='activation'; });
  var repNotes = notes.filter(function(n){ return n.noteType==='rep' || n.noteType==='note'; });

  var actHistHtml = actNotes.length ? actNotes.map(_noteItemHtml).join('') : '<div class="nm-empty">No activation notes yet.</div>';
  var repHistHtml = repNotes.length ? repNotes.map(_noteItemHtml).join('') : '<div class="nm-empty">No rep notes yet.</div>';

  // Only the activation team may SET ratings (mirrors the backend setRating gate);
  // everyone else sees the current rating read-only.
  var canRate = ['master-admin','admin','activator'].indexOf(role) !== -1;
  var ratingHtml;
  if (canRate) {
    ratingHtml = RATING_OPTS.map(function(r) {
      var active = r===rating ? ' active-'+( r==='No Answer'?'na': r.replace(' Stars','').replace(' Star','') ) : '';
      return '<button class="nm-r-btn'+active+'" onclick="modalSetRating(\''+r+'\')">'+r+'</button>';
    }).join('');
  } else if (rating) {
    var roCls = rating==='No Answer'?'rp-na':rating==='1 Star'?'rp-1':rating==='2 Stars'?'rp-2':rating==='3 Stars'?'rp-3':rating==='4 Stars'?'rp-4':rating==='5 Stars'?'rp-5':'';
    ratingHtml = '<span class="rating-pill '+roCls+'">'+rating+'</span>';
  } else {
    ratingHtml = '<span class="nm-empty">Not rated yet.</span>';
  }

  document.getElementById('modal-title').innerHTML =
    '<div class="nm-dsi">DSI: '+esc(dsi)+'</div>' +
    '<div class="nm-sub">'+(rep?esc(rep):'')+'</div>';

  document.getElementById('modal-body').innerHTML =
    '<div class="nm-section-label nm-act-label">Activation Notes</div>' +
    '<div class="nm-history" id="nm-act-hist">'+actHistHtml+'</div>' +
    (canAddActivation ? '<textarea class="nm-textarea" id="nm-act-input" placeholder="Add activation note…" style="margin-bottom:8px"></textarea>'+_linesFieldHtml('modal-body',icon('zap')+' Lines activated on this order')+'<button class="nm-add-btn" onclick="modalAddNote(\'activation\')" style="margin-bottom:14px">ADD ACTIVATION NOTE</button>' : '') +
    '<div class="nm-section-label nm-rep-label" style="margin-top:8px">Rep Notes</div>' +
    '<div class="nm-history" id="nm-rep-hist">'+repHistHtml+'</div>' +
    (canAddRep ? '<textarea class="nm-textarea" id="nm-rep-input" placeholder="Add rep note…"></textarea><button class="nm-add-btn nm-rep-add-btn" onclick="modalAddNote(\'rep\')" style="margin-bottom:14px">ADD REP NOTE</button>' : '') +
    (_cross ? '' :
      '<div class="nm-section-label" style="margin-top:8px">Rating</div>' +
      '<div class="nm-rating-row" id="nm-rating-row">'+ratingHtml+'</div>') +
    '<div class="nm-actions"><button class="nm-close-btn" style="width:100%" onclick="closeModal()">CLOSE</button></div>';

  document.getElementById('detail-modal').classList.add('open');
}

function modalSetRating(rating) {
  if (!_modalDsi) return;
  if (!DATA.ratings) DATA.ratings = {};
  DATA.ratings[_modalDsi] = rating;
  // Update modal buttons
  document.querySelectorAll('#nm-rating-row .nm-r-btn').forEach(function(btn) {
    var r = btn.textContent.trim();
    var active = r===rating ? ' active-'+(r==='No Answer'?'na':r.replace(' Stars','').replace(' Star','')) : '';
    btn.className = 'nm-r-btn' + active;
  });
  // Update rating pill on the row
  var pill = document.getElementById('rp-'+_modalDsi.replace(/\W/g,'_'));
  if (pill) {
    var cls = rating==='No Answer'?'rp-na':rating==='1 Star'?'rp-1':rating==='2 Stars'?'rp-2':rating==='3 Stars'?'rp-3':rating==='4 Stars'?'rp-4':rating==='5 Stars'?'rp-5':'';
    pill.className = 'rating-pill '+cls;
    pill.textContent = rating;
  }
  apiPost({ action:'setRating', dsi:_modalDsi, rating:rating, updatedBy:SESSION.email });
}

// Activator-only "Lines activated" picker. Container-scoped (class-based, no
// shared id) so it works in BOTH the notes modal and the appointment-outcome
// modal without element-id collisions. boxId = the container element's id.
function _linesFieldHtml(boxId, label) {
  var btns=[0,1,2,3].map(function(v){
    return '<button type="button" class="nm-lines-btn'+(v===0?' active':'')+'" data-v="'+v+'" onclick="_linesSet(\''+boxId+'\','+v+')">'+v+'</button>';
  }).join('');
  return '<div class="nm-lines-row">'+
      '<span class="nm-lines-label">'+label+'</span>'+
      '<div class="nm-lines-btns">'+btns+
        '<input type="number" min="0" step="1" class="nm-lines-input lines-input" value="0" oninput="_linesSync(\''+boxId+'\')" title="Lines activated">'+
      '</div>'+
    '</div>';
}
function _linesSet(boxId, v) {
  var box=document.getElementById(boxId); if (!box) return;
  var inp=box.querySelector('.lines-input'); if (inp) inp.value=v;
  _linesSync(boxId);
}
function _linesSync(boxId) {
  var box=document.getElementById(boxId); if (!box) return;
  var inp=box.querySelector('.lines-input'); if (!inp) return;
  var v=parseInt(inp.value,10); if (isNaN(v)||v<0) v=0;
  box.querySelectorAll('.nm-lines-btn').forEach(function(b){
    b.classList.toggle('active', String(b.getAttribute('data-v'))===String(v));
  });
}
function _linesGet(boxId) {
  var box=document.getElementById(boxId); if (!box) return 0;
  var inp=box.querySelector('.lines-input');
  return inp?Math.max(0,parseInt(inp.value,10)||0):0;
}

function modalAddNote(noteType) {
  noteType = noteType || 'activation';
  var inputId = noteType === 'rep' ? 'nm-rep-input' : 'nm-act-input';
  var histId  = noteType === 'rep' ? 'nm-rep-hist'  : 'nm-act-hist';
  var input = document.getElementById(inputId);
  if (!input) return;
  var text = input.value.trim(); if (!text) return;
  // Lines activated — only on activation notes.
  var lines = (noteType === 'activation') ? _linesGet('modal-body') : 0;
  input.value = ''; input.disabled = true;
  if (noteType === 'activation') _linesSet('modal-body', 0);
  var now = new Date().toISOString();
  var entry = { ts:now, authorEmail:SESSION.email, authorName:SESSION.name||SESSION.email, noteText:text, noteType:noteType, linesActivated:lines };
  // Optimistic in-modal append — only the note list updates, never a full reload.
  var hist = document.getElementById(histId);
  if (hist) {
    hist.querySelectorAll('.nm-empty').forEach(function(e) { e.remove(); });
    hist.innerHTML += _noteItemHtml(entry);
    hist.scrollTop = hist.scrollHeight;
  }
  _noteAddFlight = true;
  var _done = function() { input.disabled = false; _noteAddFlight = false; };
  if (_modalApptId && _modalOffice !== CFG.officeId) {
    // Cross-office (activator dashboard): route to the appointment's own office via the
    // scheduler; update the dashboard's cached notes + count badge (not DATA.notes).
    if (typeof _MYAPPT !== 'undefined' && _MYAPPT.appointments) {
      var ap = _MYAPPT.appointments.filter(function(x){ return x.appointmentId === _modalApptId; })[0];
      if (ap) { ap.notes = ap.notes || []; ap.notes.push(entry);
        var mb = document.getElementById('manote-' + _modalApptId); if (mb) mb.textContent = ' ' + ap.notes.length; }
    }
    _apptPost({ action:'addAppointmentNote', appointmentId:_modalApptId, noteText:text, noteType:noteType, linesActivated:lines, email:SESSION.email, authorName:SESSION.name||SESSION.email }).then(_done).catch(_done);
  } else {
    if (!DATA.notes) DATA.notes = {};
    if (!DATA.notes[_modalDsi]) DATA.notes[_modalDsi] = [];
    DATA.notes[_modalDsi].push(entry);
    var noteCount = document.getElementById('nc-'+_modalDsi.replace(/\W/g,'_'));
    if (noteCount) noteCount.textContent = DATA.notes[_modalDsi].length;
    apiPost({ action:'addNote', dsi:_modalDsi, noteText:text, noteType:noteType, linesActivated:lines, authorEmail:SESSION.email, authorName:SESSION.name||SESSION.email }).then(_done).catch(_done);
  }
}

// ── CALL TABLE ────────────────────────────────────────────────────────────
var _tabOrders = [], _sortTblId = '', _sortState = { col: null, dir: 1 };
var _activeFilters = { products: [], statuses: [], dateFrom: '', dateTo: '', lastCalled: '' };
var _extraColFn = null;

function _applyView() {
  var result = _tabOrders.filter(function(o) {
    if (_activeFilters.products.length) {
      var pk = Object.keys(o.productCounts||{}).map(function(k){ return k.toLowerCase(); });
      if (!_activeFilters.products.some(function(p){ return pk.indexOf(p.toLowerCase()) !== -1; })) return false;
    }
    if (_activeFilters.statuses.length) {
      var sk = Object.keys(o.statusCounts||{}).map(function(k){ return k.toLowerCase(); });
      if (!_activeFilters.statuses.some(function(s){ return sk.indexOf(s.toLowerCase()) !== -1; })) return false;
    }
    if (_activeFilters.dateFrom && o.orderDate < _activeFilters.dateFrom) return false;
    if (_activeFilters.dateTo   && o.orderDate > _activeFilters.dateTo)   return false;
    if (_activeFilters.lastCalled) {
      var d = o._daysSince === undefined ? _daysSinceLastNote(o.dsi) : o._daysSince;
      if (_activeFilters.lastCalled === 'recent'  && !(d !== null && d <= 2))  return false;
      if (_activeFilters.lastCalled === 'mid'     && !(d !== null && d >= 3 && d <= 7)) return false;
      if (_activeFilters.lastCalled === 'overdue' && !(d !== null && d >= 8))  return false;
      if (_activeFilters.lastCalled === 'never'   && d !== null)               return false;
    }
    if (_activeFilters.risk) {
      if (_activeFilters.risk === 'atrisk'  && !_isAtRisk(o.dsi))    return false;
      if (_activeFilters.risk === 'rotting' && !_rottingShown(o.dsi)) return false;
      if (_activeFilters.risk === 'booked'  && !_bookedFor(o.dsi))   return false;
    }
    return true;
  });
  if (_sortState.col) {
    var col = _sortState.col;
    result.sort(function(a, b) {
      var va, vb;
      if      (col==='rep')     { va=(a.rep||'').toLowerCase();                      vb=(b.rep||'').toLowerCase(); }
      else if (col==='dsi')     { va=a.dsi||'';                                      vb=b.dsi||''; }
      else if (col==='date')    { va=a.orderDate||'';                                vb=b.orderDate||''; }
      else if (col==='product') { va=Object.keys(a.productCounts||{}).sort()[0]||''; vb=Object.keys(b.productCounts||{}).sort()[0]||''; }
      else if (col==='status')     { va=Object.keys(a.statusCounts||{}).sort()[0]||''; vb=Object.keys(b.statusCounts||{}).sort()[0]||''; }
      else if (col==='lastcalled') {
        var da2 = a._daysSince === undefined ? _daysSinceLastNote(a.dsi) : a._daysSince;
        var db2 = b._daysSince === undefined ? _daysSinceLastNote(b.dsi) : b._daysSince;
        va = da2 === null ? 9999 : da2; vb = db2 === null ? 9999 : db2;
        return (va - vb) * _sortState.dir;
      }
      else return 0;
      return va<vb ? -_sortState.dir : va>vb ? _sortState.dir : 0;
    });
  }
  var tbody = document.querySelector('#'+_sortTblId+' tbody');
  if (tbody) tbody.innerHTML = callTableRows(result, _extraColFn);
  var inp = document.getElementById('f-'+_sortTblId.replace('-table',''));
  if (inp && inp.value) {
    var q = inp.value.toLowerCase();
    Array.from(document.querySelectorAll('#'+_sortTblId+' tbody tr')).forEach(function(tr) {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }
  var countEl = document.getElementById('ct-count');
  if (countEl) {
    var visible = Array.from(document.querySelectorAll('#ct-table tbody tr')).filter(function(tr){ return tr.style.display !== 'none'; }).length;
    countEl.textContent = visible === _tabOrders.length
      ? 'Showing all ' + _tabOrders.length + ' orders'
      : 'Showing ' + visible + ' of ' + _tabOrders.length + ' orders';
  }
  var chipsEl = document.getElementById('ct-chips');
  if (chipsEl) chipsEl.innerHTML = _ctChipsInner(_tabOrders);   // keep chip counts/active state fresh (e.g. after booked load)
  var afEl = document.getElementById('ct-active-filters');
  if (afEl) afEl.innerHTML = _ctActiveFilterBar();              // active-filter chip bar (Phase 2 #3)
}

function sortCallTable(col) {
  _sortState.dir = _sortState.col === col ? -_sortState.dir : 1;
  _sortState.col = col;
  _applyView();
  var labels = { rep:'Name', dsi:'DSI', date:'Date', product:'Product', status:'Status', lastcalled:'Last Called' };
  document.querySelectorAll('#'+_sortTblId+' th[data-col]').forEach(function(th) {
    th.textContent = (labels[th.dataset.col]||th.dataset.col) + (th.dataset.col===col ? (_sortState.dir===1?' ↑':' ↓') : '');
  });
}

function ddSelectAll(ddId) {
  document.querySelectorAll('#ddp-'+ddId+' input[type=checkbox]').forEach(function(cb){ cb.checked = true; });
  applyCallFilters();
}
function ddClearAll(ddId) {
  document.querySelectorAll('#ddp-'+ddId+' input[type=checkbox]').forEach(function(cb){ cb.checked = false; });
  applyCallFilters();
}

function toggleDd(id, event) {
  if (event) event.stopPropagation();
  var panel = document.querySelector('#'+id+' .dd-panel');
  var wasOpen = panel.classList.contains('open');
  document.querySelectorAll('.dd-panel.open').forEach(function(p){ p.classList.remove('open'); });
  if (!wasOpen) panel.classList.add('open');
}

function _updateFilterBadge() {
  var inp = document.getElementById('f-ct');
  var count = _activeFilters.products.length + _activeFilters.statuses.length +
    (_activeFilters.dateFrom ? 1 : 0) + (_activeFilters.dateTo ? 1 : 0) +
    (inp && inp.value ? 1 : 0);
  var badge = document.getElementById('filter-active-badge');
  var btn = document.querySelector('.clear-filters-btn');
  if (badge) badge.textContent = count > 0 ? count + ' active' : '';
  if (btn) btn.classList.toggle('active', count > 0);
}

function applyCallFilters() {
  _activeFilters.products = [];
  _activeFilters.statuses = [];
  document.querySelectorAll('#ddp-product input:checked').forEach(function(cb){ _activeFilters.products.push(cb.value); });
  document.querySelectorAll('#ddp-status input:checked').forEach(function(cb){ _activeFilters.statuses.push(cb.value); });
  var fe = document.getElementById('f-date-from'), te = document.getElementById('f-date-to');
  _activeFilters.dateFrom = fe ? fe.value : '';
  _activeFilters.dateTo   = te ? te.value : '';
  _applyView();
  var pb = document.querySelector('#dd-product .dd-btn');
  if (pb) pb.textContent = (_activeFilters.products.length ? 'Product ('+_activeFilters.products.length+')' : 'Product') + ' ▾';
  var sb = document.querySelector('#dd-status .dd-btn');
  if (sb) sb.textContent = (_activeFilters.statuses.length ? 'Status ('+_activeFilters.statuses.length+')' : 'Status') + ' ▾';
  _updateFilterBadge();
}

function clearCallFilters() {
  _activeFilters = { products: [], statuses: [], dateFrom: '', dateTo: '', risk: '' };
  document.querySelectorAll('#ddp-product input, #ddp-status input').forEach(function(cb){ cb.checked = false; });
  var fe = document.getElementById('f-date-from'); if (fe) fe.value = '';
  var te = document.getElementById('f-date-to');   if (te) te.value = '';
  var rk = document.querySelector('.ct-risk-filter'); if (rk) rk.value = '';
  var se = document.getElementById('f-'+_sortTblId.replace('-table','')); if (se) se.value = '';
  var pb = document.querySelector('#dd-product .dd-btn'); if (pb) pb.textContent = 'Product ▾';
  var sb = document.querySelector('#dd-status .dd-btn');  if (sb) sb.textContent = 'Status ▾';
  _applyView();
  _updateFilterBadge();
}

function _buildFilterRow(searchId) {
  var products = {}, statuses = {};
  _tabOrders.forEach(function(o) {
    Object.keys(o.productCounts||{}).forEach(function(k){ products[k]=true; });
    Object.keys(o.statusCounts||{}).forEach(function(k){ statuses[k]=true; });
  });
  function ddHtml(ddId, label, items) {
    return '<div class="dd-filter" id="dd-'+ddId+'">' +
      '<button class="dd-btn" onclick="toggleDd(\'dd-'+ddId+'\',event)">'+label+' ▾</button>' +
      '<div class="dd-panel" id="ddp-'+ddId+'">' +
      '<div class="dd-panel-hdr">Filter by '+label+'</div>' +
      items.map(function(v){ return '<label><input type="checkbox" value="'+esc(v)+'" onchange="applyCallFilters()"> '+esc(v)+'</label>'; }).join('') +
      '<div class="dd-panel-actions"><span onclick="ddSelectAll(\''+ddId+'\')">Select all</span><span onclick="ddClearAll(\''+ddId+'\')">Clear</span></div>' +
      '</div></div>';
  }
  return '<div class="filter-row">' +
    '<input id="'+searchId+'" placeholder="Search rep, DSI…">' +
    ddHtml('product','Product',Object.keys(products).sort()) +
    ddHtml('status','Status',Object.keys(statuses).sort()) +
    '<div class="date-filter-wrap"><span>From</span><input type="date" id="f-date-from" onchange="applyCallFilters()"><span>To</span><input type="date" id="f-date-to" onchange="applyCallFilters()"></div>' +
    '<button class="clear-filters-btn" onclick="clearCallFilters()">Clear</button>' +
    '<span id="filter-active-badge" class="filter-active-badge"></span>' +
    '</div>';
}

// ── At-risk / rotting / booked classification (call-log row signals) ──────
// At-risk  = order rated 1–2★ OR present in the Order Issues log.
// Rotting  = order rated "No Answer" AND 8+ days since the last note/call.
// Booked   = the customer's DSI has a future, non-cancelled appointment.
var _ISSUE_DSI = null;        // {dsi:true} — rebuilt each render from DATA.orderIssues
var _BOOKED_MAP = null;       // dsi -> {date,timeSlot} nearest future appt (null = not loaded)
var _bookedLoading = false;
var _ctShowRiskFlags = true;  // show ⚠/⏳ flags on generic call tables, not on No Answer/Escalations

function _issueDsiSet() {
  if (_ISSUE_DSI) return _ISSUE_DSI;
  _ISSUE_DSI = {};
  (DATA.orderIssues||[]).forEach(function(o){ if(o.dsi) _ISSUE_DSI[o.dsi]=true; });
  return _ISSUE_DSI;
}
function _isAtRisk(dsi) {
  var r=(DATA.ratings||{})[dsi]||'';
  return r==='1 Star' || r==='2 Stars' || !!_issueDsiSet()[dsi];
}
function _isRotting(dsi) {
  if (((DATA.ratings||{})[dsi]||'') !== 'No Answer') return false;
  var d=_daysSinceLastNote(dsi);
  return d!==null && d>=8;
}
function _bookedFor(dsi) { return (_BOOKED_MAP||{})[dsi]||null; }
// Rotting only counts as "rotting" if it ISN'T already handled by a future
// booking. A booked order shows the 📅 badge instead. (At-risk is NOT suppressed
// by a booking — order issues / 1–2★ still need attention.)
function _rottingShown(dsi) { return _isRotting(dsi) && !_bookedFor(dsi); }
function _ctShortDate(s) { var p=String(s||'').split('-'); return p.length===3 ? (Number(p[1])+'/'+Number(p[2])) : s; }

// Column summary chips above a call table — counts over the whole tab, each a
// one-click shortcut into the matching show-only risk filter.
function _ctChipsInner(orders) {
  var risk=_activeFilters.risk||'', n=orders.length, ar=0, rot=0, bk=0;
  orders.forEach(function(o){ if(_isAtRisk(o.dsi))ar++; if(_rottingShown(o.dsi))rot++; if(_bookedFor(o.dsi))bk++; });
  function chip(val,label,count,cls){
    return '<span class="ct-chip'+(cls?' '+cls:'')+(risk===val?' ct-chip-active':'')+'" onclick="_ctSetRisk(\''+val+'\')">'+label+' <b>'+count+'</b></span>';
  }
  return chip('','Orders',n,'') +
    chip('atrisk',icon('issues')+' At-risk',ar,'ct-chip-atrisk') +
    chip('rotting',icon('clock')+' Rotting',rot,'ct-chip-rotting') +
    chip('booked',icon('appointments')+' Booked',bk,'ct-chip-booked');
}
function _ctSetRisk(val) {
  _activeFilters.risk = (_activeFilters.risk===val ? '' : val);   // toggle off if same chip
  var sel=document.querySelector('.ct-risk-filter'); if(sel) sel.value=_activeFilters.risk;
  _applyView();
}

// ── Cross-filter: active-filter chip bar + click-to-filter on row values ───
// One pill per applied filter (product/status/risk/last-called/date), each with
// its own ✕, plus a "Clear all". Re-rendered by _applyView on every filter
// change. Only ever narrows the already role-scoped _tabOrders — never reveals
// rows the user couldn't already see.
function _ctSyncDdLabels() {
  var pb=document.querySelector('#dd-product .dd-btn');
  if(pb) pb.textContent=(_activeFilters.products.length?'Product ('+_activeFilters.products.length+')':'Product')+' ▾';
  var sb=document.querySelector('#dd-status .dd-btn');
  if(sb) sb.textContent=(_activeFilters.statuses.length?'Status ('+_activeFilters.statuses.length+')':'Status')+' ▾';
}
// Click a product/status pill inside a row → toggle that value in the filter
// (and keep the matching dropdown checkbox in sync).
function _ctAddFilter(type, value) {
  var arr = type==='product' ? _activeFilters.products : _activeFilters.statuses;
  var present = arr.indexOf(value) !== -1;
  if (present) arr.splice(arr.indexOf(value),1); else arr.push(value);
  var ddp=document.getElementById('ddp-'+type);
  if(ddp) ddp.querySelectorAll('input[type=checkbox]').forEach(function(cb){ if(cb.value===value) cb.checked = !present; });
  _ctSyncDdLabels();
  _applyView();
  _updateFilterBadge();
}
function _ctRemoveFilter(type, value) {
  if (type==='product' || type==='status') {
    var arr = type==='product' ? _activeFilters.products : _activeFilters.statuses;
    var i=arr.indexOf(value); if(i!==-1) arr.splice(i,1);
    var ddp=document.getElementById('ddp-'+type);
    if(ddp) ddp.querySelectorAll('input[type=checkbox]').forEach(function(cb){ if(cb.value===value) cb.checked=false; });
    _ctSyncDdLabels();
  } else if (type==='risk') {
    _activeFilters.risk='';
    var rk=document.querySelector('.ct-risk-filter'); if(rk) rk.value='';
  } else if (type==='lastCalled') {
    _activeFilters.lastCalled='';
    var lc=document.getElementById('lc-filter'); if(lc) lc.value='';
  } else if (type==='dateFrom') {
    _activeFilters.dateFrom=''; var fe=document.getElementById('f-date-from'); if(fe) fe.value='';
  } else if (type==='dateTo') {
    _activeFilters.dateTo=''; var te=document.getElementById('f-date-to'); if(te) te.value='';
  }
  _applyView();
  _updateFilterBadge();
}
function _ctFilterChip(prefix, label, type, value) {
  return '<span class="ct-af-chip">'+(prefix?esc(prefix)+': ':'')+esc(label)+
    '<span class="ct-af-x" title="Remove" onclick="_ctRemoveFilter(\''+type+'\',\''+esc(value)+'\')">&times;</span></span>';
}
function _ctActiveFilterBar() {
  var chips=[];
  (_activeFilters.products||[]).forEach(function(p){
    chips.push(_ctFilterChip('Product', PRODUCT_LABELS[p.toUpperCase()]||p, 'product', p));
  });
  (_activeFilters.statuses||[]).forEach(function(s){
    chips.push(_ctFilterChip('Status', s, 'status', s));
  });
  if (_activeFilters.risk) {
    var rl={atrisk:icon('issues')+' At-risk',rotting:icon('clock')+' Rotting',booked:icon('appointments')+' Booked'}[_activeFilters.risk]||_activeFilters.risk;
    chips.push(_ctFilterChip('', rl, 'risk', ''));
  }
  if (_activeFilters.lastCalled) {
    var ll={recent:'Recent (0–2d)',mid:'Due (3–7d)',overdue:'Overdue (8+d)',never:'Never called'}[_activeFilters.lastCalled]||_activeFilters.lastCalled;
    chips.push(_ctFilterChip('Last call', ll, 'lastCalled', ''));
  }
  if (_activeFilters.dateFrom) chips.push(_ctFilterChip('From', _activeFilters.dateFrom, 'dateFrom', ''));
  if (_activeFilters.dateTo)   chips.push(_ctFilterChip('To',   _activeFilters.dateTo,   'dateTo', ''));
  if (!chips.length) return '';
  return '<span class="ct-af-lbl">Filters</span>'+chips.join('')+
    '<span class="ct-af-clear" onclick="clearCallFilters()">Clear all</span>';
}

// Lazily pull the appointment list once and map DSI -> nearest future appt, so
// Resolve an activator's timezone for the booked badge: prefer the appointments
// activator list (loaded once that tab is opened), else the roster timezone (col K,
// always present in DATA.roster), else the office tz (=> no-op for same-zone).
function _bookedActTz(email) {
  var e = String(email || '').trim().toLowerCase();
  var a = (_APPT.activators || []).find(function(x) { return String(x.email || '').toLowerCase() === e; });
  if (a && a.timezone) return a.timezone;
  var r = (DATA.roster || {})[e];
  if (r && r.timezone) return r.timezone;
  return _apptOfficeTzId();
}
// Booked slot is stored in the activator's tz — convert to office tz for display,
// matching every other appointment view. No-op when the zones already match.
function _bookedSlotOfficeTz(dateStr, slot, email) {
  return _tzConvertClock(dateStr, slot, _bookedActTz(email), _apptOfficeTzId());
}

// call-log rows can show a "📅 Booked" badge. Uses the existing (already
// deployed) getAppointments endpoint. DSIs are privacy-masked for some roles —
// masked entries are skipped, so the badge degrades gracefully.
function _loadBookedAppts() {
  if (_bookedLoading) return;
  _bookedLoading = true;
  _apptGet({action:'getAppointments',officeId:CFG.officeId,bookerEmail:SESSION.email,role:SESSION.role}).then(function(res){
    var map={}, today=_apptDateStr(new Date());
    (res.appointments||[]).forEach(function(a){
      var d=a.customerDSI||'';
      if(!d || d.indexOf('•')!==-1) return;            // missing or masked
      if(a.status==='cancelled') return;
      if(!a.date || a.date<today) return;              // only upcoming / today
      if(!map[d] || a.date<map[d].date) map[d]={date:a.date,timeSlot:_bookedSlotOfficeTz(a.date,a.timeSlot,a.activatorEmail),activator:((DATA.roster||{})[a.activatorEmail]||{}).name||a.activatorEmail};
    });
    _BOOKED_MAP=map; _bookedLoading=false;
    if(_sortTblId && document.getElementById(_sortTblId)) _applyView();   // re-stamp badges
  }).catch(function(){ _BOOKED_MAP={}; _bookedLoading=false; });
}

function callTableRows(orders, extraColFn) {
  return orders.map(function(o) {
    var dsi = o.dsi || '';
    var safeId = dsi.replace(/\W/g,'_');
    var noteCount = ((DATA.notes||{})[dsi]||[]).length;
    var extra = extraColFn ? extraColFn(o) : '';
    var booked=_bookedFor(dsi);
    var rotting=_isRotting(dsi) && !booked;   // a booked order is handled → drop rotting flag
    var atrisk=_isAtRisk(dsi);                 // order issues / 1–2★ persist regardless of a booking
    var rowCls = rotting ? ' class="ct-row-rotting"' : (atrisk ? ' class="ct-row-atrisk"' : '');
    var flags='';
    if (_ctShowRiskFlags && rotting) flags+='<span class="ct-flag ct-flag-rotting" title="No Answer · 8+ days since last call">'+icon('clock')+' Rotting</span>';
    if (_ctShowRiskFlags && atrisk) flags+='<span class="ct-flag ct-flag-atrisk" title="1–2★ rating or Order Issue">'+icon('issues')+' At-risk</span>';
    var dsiCell='<span class="dsi-link" onclick="clickDsi(\''+esc(dsi)+'\')">'+esc(dsi)+'</span>'+(flags?'<div class="ct-flags">'+flags+'</div>':'');
    return '<tr'+rowCls+'>' +
      '<td><span class="rep-name">'+esc(o.rep)+'</span></td>' +
      '<td>'+dsiCell+'</td>' +
      '<td>'+esc(o.orderDate)+'</td>' +
      '<td>'+productBreakdown(o.productCounts, true)+'</td>' +
      extra +
      '<td>'+statusBreakdown(o.statusCounts, true)+'</td>' +
      _bookedCell(booked) +
      '<td>' + ratingPill(dsi, safeId) + '</td>' +
      '<td>' +
        '<button class="notes-btn'+(noteCount>0?' has-notes':'')+'" data-dsi="'+esc(dsi)+'" onclick="openNotesModal(\''+esc(dsi)+'\',\''+esc(o.spe)+'\',\''+esc(o.rep)+'\')">NOTES' +
        (noteCount>0?'<span class="notes-count" id="nc-'+safeId+'">'+noteCount+'</span>':'') +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

// The "Appointment" column cell — shows the next booking (date · time · activator) or —.
function _bookedCell(booked) {
  if (!booked) return '<td class="ct-appt-cell">—</td>';
  var bTxt=_ctShortDate(booked.date)+(booked.timeSlot?' '+_apptFmt12(booked.timeSlot):'')+(booked.activator?' · '+String(booked.activator).split(' ')[0]:'');
  return '<td class="ct-appt-cell"><span class="ct-flag ct-flag-booked" title="Next appointment: '+esc(_apptFmtDate(booked.date))+' at '+esc(_apptFmt12(booked.timeSlot))+(booked.activator?' · '+esc(booked.activator):'')+'">'+icon('appointments')+' '+esc(bTxt)+'</span></td>';
}

function _sortHeaders(tblId) {
  var cols = [['rep','Name'],['dsi','DSI'],['date','Date'],['product','Product'],['status','Status']];
  return cols.map(function(c) {
    return '<th class="sort-th" data-col="'+c[0]+'" onclick="sortCallTable(\''+c[0]+'\')">'+c[1]+'</th>';
  }).join('') + '<th>Appointment</th><th>Rating</th><th>Notes</th>';
}

// Default call-list order: newest Order Date first; blank/unknown dates sink to the
// bottom (so they don't masquerade as "newest"). Default only — clicking a column
// header still overrides it. No Answer is intentionally excluded (it keeps its own
// "never-called / most-overdue first" calling-priority sort).
function _byOrderDateDesc(a, b) {
  var da = /^\d{4}-\d{2}-\d{2}/.test(a.orderDate || '') ? a.orderDate : '';
  var db = /^\d{4}-\d{2}-\d{2}/.test(b.orderDate || '') ? b.orderDate : '';
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da < db ? 1 : da > db ? -1 : 0;
}
// Safety-net banner: shown when the backend reports no Tableau rows matched this
// office (OFFICE_OWNER_MAP drift) — otherwise the call-log tabs would just look empty.
function _tableauWarnBanner() {
  var w = DATA && DATA.tableauWarning;
  if (!w) return '';
  return '<div style="background:#3d1a0a;border:1px solid #7a3b10;color:#ffcda0;' +
    'padding:12px 16px;border-radius:8px;margin-bottom:14px;font-size:.88rem;font-weight:600">' +
    icon('issues') + ' ' + esc(w) + '</div>';
}

function renderCallTable(orders, title, emptyMsg) {
  var _warn = _tableauWarnBanner();
  if (!orders.length) return _warn + noData(emptyMsg);
  orders = orders.slice().sort(_byOrderDateDesc);   // default: newest order first
  _tabOrders = orders.slice(); _sortTblId = 'ct-table'; _sortState = { col: null, dir: 1 }; _activeFilters = { products: [], statuses: [], dateFrom: '', dateTo: '', risk: '' }; _extraColFn = null;
  _ctShowRiskFlags = true; _ISSUE_DSI = null;
  if (_BOOKED_MAP === null) _loadBookedAppts();   // lazy one-time appointment pull for booked badges
  var riskSel = '<select class="ct-risk-filter" onchange="_activeFilters.risk=this.value;_applyView()">' +
    '<option value="">All orders</option>' +
    '<option value="atrisk">&#x26A0; At-risk only</option>' +
    '<option value="rotting">&#x23F3; Rotting only</option>' +
    '<option value="booked">&#x1F4C5; Booked only</option>' +
    '</select>';
  return _warn + '<div class="card"><div class="card-header dark">'+esc(title)+' &nbsp;<span style="font-weight:400;font-size:.82rem;opacity:.8">'+orders.length+' orders</span></div><div class="card-body">' +
    _buildFilterRow('f-ct') +
    '<div class="ct-active-filters" id="ct-active-filters"></div>' +
    '<div class="ct-chips" id="ct-chips">'+_ctChipsInner(orders)+'</div>' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
      '<div id="ct-count" class="tbl-count" style="margin:0">Showing all '+orders.length+' orders</div>' +
      riskSel +
    '</div>' +
    '<div class="call-table-wrap"><table class="call-table" id="ct-table"><thead><tr>' +
    _sortHeaders('ct-table') +
    '</tr></thead><tbody>'+callTableRows(orders, null)+'</tbody></table></div></div></div>';
}


// ── ACTIVATION SUPPORT (Pending / Activation sheets · Date → Rep → Product → Status) ──
// One tab, two toggled pages. Pending = only lines NOT yet Active/Posted/Cancelled/
// Disconnected (from masterTracker). Activation = every line, every status (master ∪
// completed). Both role-scoped via repFilter. Also shows the auto-email "last sent" badge.
var _asPage = 'pending';        // 'pending' | 'activation'
var _AS_STATUS = null;          // cached readAutoEmailStatus result (global, not per-office)
var _asStatusFlight = false;

function _asIsDone(s){ var l=String(s||'').toLowerCase().trim(); return l==='active'||l==='posted'||l.indexOf('cancel')!==-1||l.indexOf('disco')!==-1; }
function _asProdLabelFE(p){
  var s=String(p||'').trim(); if(!s) return 'Other'; var l=s.toLowerCase();
  if(l.indexOf('wireless')!==-1||l==='cell'||l==='new phones'||l==='byod') return 'Wireless';
  if(l.indexOf('fiber')!==-1) return 'Fiber';
  if(l.indexOf('air')!==-1||l.indexOf('awb')!==-1) return 'Air';
  if(l.indexOf('voip')!==-1||l.indexOf('ooma')!==-1) return 'VoIP';
  if(l.indexOf('dtv')!==-1||l.indexOf('directv')!==-1) return 'DTV';
  if(l.indexOf('internet')!==-1) return 'Internet';
  return s;
}
// Per-line pairs. Uses the backend o.lines when present; otherwise (pre-redeploy) synthesizes
// from productCounts/statusCounts so the drill-down still renders live — self-corrects once
// Code.gs is redeployed with the real per-line pairing.
function _asLinesOf(o){
  if(o.lines && o.lines.length) return o.lines;
  var prods=[], pc=o.productCounts||{}; Object.keys(pc).forEach(function(p){ var n=pc[p]||0; for(var i=0;i<n;i++) prods.push(p); });
  var stats=[], sc=o.statusCounts||{}; Object.keys(sc).forEach(function(s){ var n=sc[s]||0; for(var i=0;i<n;i++) stats.push(s); });
  if(!prods.length) prods.push(o.productType||'Other');
  if(!stats.length) stats.push(o.dtrStatus||'Null');
  var n=Math.max(prods.length,stats.length), out=[];
  for(var i=0;i<n;i++) out.push({ product:prods[i%prods.length], status:stats[i%stats.length] });
  return out;
}
function _asSum(node){
  if(node && typeof node.count==='number' && node.dsis) return node.count;
  var n=0; for(var k in node){ if(node.hasOwnProperty(k)) n+=_asSum(node[k]); } return n;
}
function _asFmtDateFE(iso){
  if(!iso||iso==='Unknown') return 'Unknown date';
  var d=new Date(String(iso)+'T12:00:00'); if(isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
}
function _asDetails(headBg, title, meta, innerHtml, open){
  return '<details '+(open?'open ':'')+'style="margin:6px 0;border-radius:8px;overflow:hidden;border:1px solid var(--border)">'+
    '<summary style="background:'+headBg+';color:var(--text);padding:9px 12px;font-size:.85rem;font-weight:700;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px">'+
      '<span class="as-caret" style="opacity:.55;font-size:.66rem">'+icon('chev-right')+'</span>'+
      '<span>'+esc(title)+'</span>'+
      '<span style="margin-left:auto;font-weight:500;font-size:.76rem;opacity:.85">'+esc(meta)+'</span>'+
    '</summary>'+
    '<div style="padding:2px 10px 8px">'+innerHtml+'</div>'+
  '</details>';
}
// orders → { rep: [ {date, dsi, product, status}, … ] } — one entry per line.
function _asLineRows(orders, includeDone){
  var byRep={};
  (orders||[]).forEach(function(o){
    var rep=o.rep||'Unknown', date=o.orderDate||'', dsi=o.dsi||'';
    _asLinesOf(o).forEach(function(ln){
      if(!includeDone && _asIsDone(ln.status)) return;
      (byRep[rep]=byRep[rep]||[]).push({ date:date, dsi:dsi, product:_asProdLabelFE(ln.product), status:String(ln.status||'Null').trim()||'Null' });
    });
  });
  return byRep;
}
// A rep's FULL order list as a flat table — all their orders, newest first, clickable DSIs.
function _asRepTable(lines){
  lines=lines.slice().sort(function(a,b){ return a.date<b.date?1:a.date>b.date?-1:(a.dsi<b.dsi?-1:1); });
  var th='padding:6px 8px;text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.03em;color:var(--text2);border-bottom:2px solid var(--border)';
  var td='padding:5px 8px;border-bottom:1px solid var(--border);font-size:.82rem';
  var rows=lines.map(function(l){
    var dsiCell = l.dsi ? '<span style="cursor:pointer;color:var(--blue2);text-decoration:underline" title="Open in SaraPlus + copy" onclick="clickDsi(\''+esc(l.dsi)+'\')">'+esc(l.dsi)+'</span>' : '—';
    return '<tr>'+
      '<td style="'+td+';white-space:nowrap">'+esc(_asFmtDateFE(l.date))+'</td>'+
      '<td style="'+td+'">'+dsiCell+'</td>'+
      '<td style="'+td+';font-weight:600">'+esc(l.product)+'</td>'+
      '<td style="'+td+'">'+statusPill(l.status)+'</td>'+
    '</tr>';
  }).join('');
  return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>'+
    '<th style="'+th+'">Date</th><th style="'+th+'">DSI</th><th style="'+th+'">Product</th><th style="'+th+'">Status</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>';
}
// Rep-first: one collapsible section PER REP → a table of ALL their orders (last 30 days).
function _asRenderTree(byRep){
  var reps=Object.keys(byRep).sort(function(a,b){ return a.localeCompare(b); });
  if(!reps.length) return noData(_asPage==='pending' ? 'Everyone is caught up!' : 'No orders in the last 30 days.', {icon:_asPage==='pending'?'completed':'inbox'});
  // A single rep in view (a rep seeing only their own) → skip the rep header, show their table directly.
  if(reps.length===1) return _asRepTable(byRep[reps[0]]);
  return reps.map(function(rep){
    var n=byRep[rep].length;
    return _asDetails('rgba(var(--blue2-rgb),.14)', rep, n+' line'+(n===1?'':'s'), _asRepTable(byRep[rep]), false);
  }).join('');
}
function _asCutoff30(){ var d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10); }
function _asPageOrders(){
  var base = _asPage==='activation' ? (DATA.masterTracker||[]).concat(DATA.completedOrders||[]) : (DATA.masterTracker||[]);
  var cutoff=_asCutoff30();
  return repFilter(base).filter(function(o){ return (o.orderDate||'') >= cutoff; });   // today → back 30 days
}
function _asToggleHtml(){
  function btn(page,ico,label,sub){
    var on=_asPage===page;
    return '<button onclick="_asSwitchPage(\''+page+'\')" style="flex:1;min-width:170px;border:1px solid '+(on?'var(--blue2)':'var(--border)')+';background:'+(on?'rgba(var(--blue2-rgb),.14)':'var(--surface)')+';color:var(--text);padding:10px 14px;border-radius:10px;cursor:pointer;font-weight:700;font-size:.92rem;text-align:left">'+
      ico+' '+esc(label)+'<div style="font-weight:400;font-size:.75rem;color:var(--text2);margin-top:2px">'+esc(sub)+'</div></button>';
  }
  return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">'+
    btn('pending',icon('clock'),'Pending','Not yet Active / Cancelled / Disconnected / Posted')+
    btn('activation',icon('actsupport'),'Activation','Every line, every status')+
  '</div>';
}
function _asRenderSignifier(){
  var s=_AS_STATUS;
  function row(type,label,day){
    var d=s&&s[type], body;
    if(!s){ body='<span style="color:var(--text2)">Loading…</span>'; }
    else if(!d){ body='<span style="color:var(--text2)">No send recorded yet</span>'; }
    else {
      var when=d.ts?new Date(d.ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):(d.date||'');
      var statusGlyph=d.ok?icon('completed'):icon('issues');
      var detail=d.sent+' sent'+(d.qualifying?(' / '+d.qualifying+' qualified'):'')+(d.failed?(' · '+d.failed+' failed'):'')+(d.quotaHit?' · quota hit':'');
      body=statusGlyph+' Last sent <b>'+esc(when)+'</b> &nbsp;·&nbsp; '+esc(detail);
    }
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;flex-wrap:wrap">'+
      '<span style="font-weight:700;min-width:128px">'+esc(label)+'</span>'+
      '<span style="font-size:.78rem;color:var(--text2);min-width:132px">Auto-sends '+esc(day)+' · 6pm PT</span>'+
      '<span style="font-size:.84rem">'+body+'</span>'+
    '</div>';
  }
  return '<div style="border:1px solid var(--border);border-radius:10px;padding:9px 14px;margin-bottom:12px;background:var(--surface)">'+
    '<div style="font-weight:700;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);margin-bottom:2px">Auto-email status</div>'+
    row('pending','Pending Sheet','Fridays')+
    row('activation','Activation Sheet','Mondays')+
  '</div>';
}
function _asShell(){
  var orders=_asPageOrders();
  var byRep=_asLineRows(orders, _asPage==='activation');
  var lineCount=0; Object.keys(byRep).forEach(function(r){ lineCount+=byRep[r].length; });
  return _tableauWarnBanner()+
    '<style>.as-wrap details>summary::-webkit-details-marker{display:none}.as-wrap .as-caret{transition:transform .12s ease;display:inline-block}.as-wrap details[open]>summary .as-caret{transform:rotate(90deg)}</style>'+
    '<div class="as-wrap">'+
      '<div id="as-signifier">'+_asRenderSignifier()+'</div>'+
      _asToggleHtml()+
      '<div class="card"><div class="card-header dark">'+
        (_asPage==='pending'?'Pending Sheet':'Activation Sheet')+
        ' &nbsp;<span style="font-weight:400;font-size:.82rem;opacity:.8">'+lineCount+' line'+(lineCount===1?'':'s')+' · last 30 days</span>'+
      '</div><div class="card-body">'+_asRenderTree(byRep)+'</div></div>'+
    '</div>';
}
function _asSwitchPage(page){
  _asPage=(page==='activation')?'activation':'pending';
  renderActivationSupport();
}
function renderActivationSupport(){
  var c=document.getElementById('main-content');
  c.innerHTML=_asShell();
  if(!_asStatusFlight){
    _asStatusFlight=true;
    api({action:'readAutoEmailStatus'}).then(function(res){
      _asStatusFlight=false;
      if(res && !res.error){ _AS_STATUS=res; }
      if(CURRENT_TAB==='actsupport'){ var sc=document.getElementById('as-signifier'); if(sc) sc.innerHTML=_asRenderSignifier(); }
    }).catch(function(){ _asStatusFlight=false; });
  }
}


// ── TRAINING & TRACKING (trainee / profit-transfer / Sunday payouts) ──────
var _TRAINING_ORDERS = null;
var _trSearch = '';
var _trHidePaid = false;
var _trTimer = null;
var _trFlight = false;

function renderTrainingTab() {
  var c = document.getElementById('main-content');
  var have = _TRAINING_ORDERS !== null;
  if (have) { _trPaint(); _trStartLive(); }   // instant paint from the in-memory cache
  else c.innerHTML = skelLoader();
  if (_trFlight) return;                       // a preload / live fetch is already running
  _trFlight = true;
  api({ action:'readTrainingOrders' }).then(function(res) {
    _trFlight = false;
    if (res && !res.error) {
      _TRAINING_ORDERS = res.orders || [];
      if (CURRENT_TAB === 'training') { if (have) _trRenderRows(); else { _trPaint(); _trStartLive(); } }
    } else if (!have && CURRENT_TAB === 'training' && res && res.error) {
      c.innerHTML = '<div class="spinner">Error: ' + esc(res.error) + '</div>';
    }
  }).catch(function() {
    _trFlight = false;
    if (!have && CURRENT_TAB === 'training') c.innerHTML = '<div class="spinner">Connection error. <a href="#" onclick="renderTrainingTab()">Retry</a></div>';
  });
}
// Warm the Training cache in the background after login (payroll roles only).
function _preloadTraining() {
  if (_TRAINING_ORDERS !== null || _trFlight) return;
  if (ROLES_PAYROLL.indexOf(SESSION.role) === -1) return;
  _trFlight = true;
  api({ action:'readTrainingOrders' }).then(function(res) {
    _trFlight = false;
    if (!res || res.error) return;
    _TRAINING_ORDERS = res.orders || [];
    if (CURRENT_TAB === 'training') { _trPaint(); _trStartLive(); }
  }).catch(function() { _trFlight = false; });
}

// Live page: silently re-pull every 30s while the tab is open and refresh rows
// in place (keeps search box, scroll, and saved checkbox state). Self-stops on
// navigating away.
function _trStartLive() {
  if (_trTimer) return;
  _trTimer = setInterval(function() {
    if (CURRENT_TAB !== 'training') { clearInterval(_trTimer); _trTimer = null; return; }
    if (document.hidden) return;   // background tab — skip this pull
    if (_trFlight) return;
    _trFlight = true;
    api({ action:'readTrainingOrders' }).then(function(res) {
      _trFlight = false;
      if (CURRENT_TAB !== 'training' || !res || res.error) return;
      _TRAINING_ORDERS = res.orders || [];
      _trRenderRows();
    }).catch(function() { _trFlight = false; });
  }, 30000);
}

var _TR_BADGE_MAP = {
  'sunday':         ['tr-badge-sunday',   "Sunday/Owner's Stroke"],
  'profit-transfer':['tr-badge-transfer', 'Profit Transfer'],
  'split':          ['tr-badge-split',    'Split']
};
// Every applicable type shows — badges stack (display order Sunday > Profit Transfer > Split).
function _trBadge(o) {
  var types = o.payTypes || (o.payType ? [o.payType] : []);
  return types.map(function(k) {
    var m = _TR_BADGE_MAP[k];
    return m ? '<span class="tr-badge ' + m[0] + '">' + m[1] + '</span>' : '';
  }).join('');
}

function _trProducts(o) {
  var parts = [];
  if (o.air)   parts.push('Air'   + (o.air>1   ? ' x'+o.air   : ''));
  if (o.cell)  parts.push('Cell'  + (o.cell>1  ? ' x'+o.cell  : ''));
  if (o.fiber) parts.push('Fiber' + (o.fiber>1 ? ' x'+o.fiber : ''));
  if (o.voip)  parts.push('VoIP'  + (o.voip>1  ? ' x'+o.voip  : ''));
  return parts.length ? parts.join(', ') : '—';
}

// Paid-out line items: one per SPE number if Tableau supplied them, else one per product type.
function _trPayItems(o) {
  if (o.speList && o.speList.length) return o.speList.map(function(s) { return { id:String(s), label:String(s) }; });
  var items = [];
  if (o.air)   items.push({ id:'air',   label:'Air' });
  if (o.cell)  items.push({ id:'cell',  label:'Cell' });
  if (o.fiber) items.push({ id:'fiber', label:'Fiber' });
  if (o.voip)  items.push({ id:'voip',  label:'VoIP' });
  return items;
}

function _trIsFullyPaid(o) {
  var items = _trPayItems(o);
  if (!items.length) return false;
  var po = o.paidOut || {};
  return items.every(function(it) { return !!po[it.id]; });
}

function _trMatch(o) {
  if (!_trSearch) return true;
  var hay = (o.repName||'') + ' ' + (o.traineeName||'') + ' ' + (o.dsi||'') + ' ' + ((o.speList||[]).join(' '));
  return hay.toLowerCase().indexOf(_trSearch.toLowerCase()) !== -1;
}

function _trPaint() {
  var c = document.getElementById('main-content');
  var total = (_TRAINING_ORDERS||[]).length;
  c.innerHTML =
    '<div class="card"><div class="card-header dark">Training &amp; Tracking &nbsp;' +
      '<span style="font-weight:400;font-size:.82rem;opacity:.8">' + total + ' orders &middot; Past 2 months &middot; <span style="color:#22c55e">&#9679; live</span></span></div>' +
    '<div class="card-body">' +
      '<div class="tr-controls">' +
        '<input id="tr-search" class="tr-search" type="text" placeholder="Search by rep, trainee, DSI, or SPE…" value="' + esc(_trSearch) + '" oninput="_trOnSearch(this.value)">' +
        '<label class="tr-hidepaid"><input type="checkbox" ' + (_trHidePaid?'checked':'') + ' onchange="_trToggleHidePaid(this.checked)"> Hide fully paid</label>' +
      '</div>' +
      '<div id="tr-count" class="tbl-count" style="margin:0 0 8px"></div>' +
      '<div class="tr-wrap"><table class="tr-table"><thead><tr>' +
        '<th>Rep</th><th>Trainee</th><th>DSI</th><th>Business/Consumer</th><th>Date</th><th>Products</th><th>Paid Out</th><th>Notes</th>' +
      '</tr></thead><tbody id="tr-tbody"></tbody></table></div>' +
    '</div></div>';
  _trRenderRows();
}

function _trOnSearch(v) { _trSearch = v; _trRenderRows(); }
function _trToggleHidePaid(ch) { _trHidePaid = ch; _trRenderRows(); }

function _trRenderRows() {
  var tbody = document.getElementById('tr-tbody'); if (!tbody) return;
  var rows = '', shown = 0;
  (_TRAINING_ORDERS||[]).forEach(function(o, idx) {
    if (!_trMatch(o)) return;
    if (_trHidePaid && _trIsFullyPaid(o)) return;
    shown++;
    var items = _trPayItems(o);
    var po = o.paidOut || {};
    var allChecked = items.length && items.every(function(it) { return !!po[it.id]; });
    var paid = '<div class="tr-paid"><label class="tr-all"><input type="checkbox" ' + (allChecked?'checked':'') + ' ' + (items.length?'':'disabled') + ' onchange="_trToggleAll(' + idx + ',this.checked)"> ALL</label>';
    items.forEach(function(it) {
      paid += '<label><input type="checkbox" ' + (po[it.id]?'checked':'') + ' onchange="_trToggleItem(' + idx + ',\'' + esc(it.id) + '\',this.checked)"> ' + esc(it.label) + '</label>';
    });
    paid += '</div>';
    var note = (o.notes||'').trim();
    var noteCell = note ? '<div class="tr-note" title="' + esc(note) + '">' + esc(note) + '</div>' : '<span style="color:var(--text2)">—</span>';
    rows +=
      '<tr>' +
        '<td><div class="tr-rep">' + esc(o.repName||'—') + '</div>' + _trBadge(o) + '</td>' +
        '<td class="tr-trainee">' + esc(o.traineeName||'—') + '</td>' +
        '<td>' + esc(o.dsi||'—') + '</td>' +
        '<td>' + esc(o.accountType||'—') + '</td>' +
        '<td>' + esc(o.dateOfSale||'—') + '</td>' +
        '<td>' + esc(_trProducts(o)) + '</td>' +
        '<td>' + paid + '</td>' +
        '<td>' + noteCell + '</td>' +
      '</tr>';
  });
  if (!shown) rows = '<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text2)">No orders match.</td></tr>';
  tbody.innerHTML = rows;
  var cnt = document.getElementById('tr-count');
  if (cnt) cnt.textContent = 'Showing ' + shown + ' of ' + (_TRAINING_ORDERS||[]).length;
}

function _trToggleItem(idx, itemId, checked) {
  var o = (_TRAINING_ORDERS||[])[idx]; if (!o) return;
  if (!o.paidOut) o.paidOut = {};
  if (checked) o.paidOut[itemId] = true; else delete o.paidOut[itemId];
  _trSave(o);
  _trRenderRows();
}

function _trToggleAll(idx, checked) {
  var o = (_TRAINING_ORDERS||[])[idx]; if (!o) return;
  if (!o.paidOut) o.paidOut = {};
  _trPayItems(o).forEach(function(it) { if (checked) o.paidOut[it.id] = true; else delete o.paidOut[it.id]; });
  _trSave(o);
  _trRenderRows();
}

function _trSave(o) {
  apiPost({ action:'saveTrainingPaid', rowIndex:o.rowIndex, paidOut:o.paidOut }).then(function(res) {
    if (res && res.error) showToast('Save failed: ' + res.error);
  }).catch(function() { showToast('Save failed — check connection'); });
}

// ── ORDER LOOKUP — call list data first, AOR as fallback ─────────────────
function buildOrderLookup() {
  var map = {};
  (DATA.masterTracker||[]).concat(DATA.completedOrders||[]).concat(DATA.dayAfterOrders||[]).concat(DATA.deliveredOrders||[]).concat(DATA.orderIssues||[]).forEach(function(o) {
    if (o.dsi && !map[o.dsi]) map[o.dsi] = o;
  });
  (DATA.aorData||[]).forEach(function(r) {
    var d = r['sp.SPM Number']; if (!d || map[d]) return;
    map[d] = { dsi:d, rep:r['Rep']||'—', spe:r['Customer Name']||'', productType:r['Product Type (Broken out lvl 2)']||'', orderDate:r['sp.Order Date (copy)']||'', dtrStatus:r['DTR Status (enriched)']||'' };
  });
  return map;
}

// ── NO ANSWER ─────────────────────────────────────────────────────────────
function _daysSinceLastNote(dsi) {
  var notes = (DATA.notes||{})[dsi];
  if (!notes || !notes.length) return null;
  var latest = notes.reduce(function(max, n) {
    var t = n.ts ? new Date(n.ts).getTime() : 0;
    return t > max ? t : max;
  }, 0);
  if (!latest) return null;
  return Math.floor((Date.now() - latest) / 86400000);
}

function _lastCallCell(o) {
  var days = _daysSinceLastNote(o.dsi);
  var label, style;
  if (days === null) {
    label = 'Never';
    style = 'background:var(--control-bg);color:#888';
  } else if (days <= 2) {
    label = days === 0 ? 'Today' : days + 'd ago';
    style = 'background:#0d2e1a;color:#4ade80';
  } else if (days <= 7) {
    label = days + 'd ago';
    style = 'background:#2a1e00;color:#eab308';
  } else {
    label = days + 'd ago';
    style = 'background:#2a0a0a;color:#ef4444';
  }
  return '<td><span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:.75rem;font-weight:700;white-space:nowrap;'+style+'">'+label+'</span></td>';
}

// No Answer order list (shared by the renderer + background soft-refresh).
// Never-called first, then longest-overdue first; within the 29-day window.
function _noAnswerOrders() {
  var ratings = DATA.ratings || {};
  var dsis = Object.keys(ratings).filter(function(dsi) { return ratings[dsi]==='No Answer'; });
  var lookup = buildOrderLookup();
  var cutoff = _cutoff29();
  var orders = dsis.map(function(dsi) {
    var o = lookup[dsi];
    var base = o ? o : { dsi:dsi, rep:'—', spe:'', productType:'—', orderDate:'—', dtrStatus:'—' };
    base._daysSince = _daysSinceLastNote(dsi);
    return base;
  }).filter(function(o) { return (o.orderDate || '') >= cutoff; });
  orders.sort(function(a, b) {
    var da = a._daysSince === null ? 9999 : a._daysSince;
    var db = b._daysSince === null ? 9999 : b._daysSince;
    return db - da;
  });
  return orders;
}

function renderNoAnswerTable() {
  var ratings = DATA.ratings || {};
  if (!Object.keys(ratings).some(function(dsi) { return ratings[dsi]==='No Answer'; })) return noData('No orders marked No Answer yet.', {icon:'noanswer'});
  var orders = _noAnswerOrders();
  _tabOrders = orders.slice(); _sortTblId = 'na-table'; _sortState = { col: null, dir: 1 }; _activeFilters = { products: [], statuses: [], dateFrom: '', dateTo: '', lastCalled: '' }; _extraColFn = _lastCallCell;
  _ctShowRiskFlags = false; _ISSUE_DSI = null;
  if (_BOOKED_MAP === null) _loadBookedAppts();
  var headers = [['rep','Name'],['dsi','DSI'],['date','Date'],['product','Product']].map(function(c) {
    return '<th class="sort-th" data-col="'+c[0]+'" onclick="sortCallTable(\''+c[0]+'\')">'+c[1]+'</th>';
  }).join('') + '<th class="sort-th" data-col="lastcalled" onclick="sortCallTable(\'lastcalled\')">Last Called</th><th class="sort-th" data-col="status" onclick="sortCallTable(\'status\')">Status</th><th>Appointment</th><th>Rating</th><th>Notes</th>';
  var lcFilter = '<select id="lc-filter" onchange="_activeFilters.lastCalled=this.value;_applyView()" style="height:32px;padding:0 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:.82rem;cursor:pointer">' +
    '<option value="">All Days</option>' +
    '<option value="recent">&#x1F7E2; Recent (0–2d)</option>' +
    '<option value="mid">&#x1F7E1; Due (3–7d)</option>' +
    '<option value="overdue">&#x1F534; Overdue (8+d)</option>' +
    '<option value="never">&#x26AA; Never Called</option>' +
    '</select>';
  return _tableauWarnBanner() + '<div class="card"><div class="card-header dark">No Answer &nbsp;<span style="font-weight:400;font-size:.82rem;opacity:.8">'+orders.length+' orders</span></div><div class="card-body">' +
    _buildFilterRow('f-na') +
    '<div class="ct-active-filters" id="ct-active-filters"></div>' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' + lcFilter + '</div>' +
    '<div class="call-table-wrap"><table class="call-table" id="na-table"><thead><tr>' +
    headers +
    '</tr></thead><tbody>'+callTableRows(orders, _lastCallCell)+'</tbody></table></div></div></div>';
}

// ── ESCALATIONS ───────────────────────────────────────────────────────────
// Escalations order list (shared by the renderer + background soft-refresh).
function _escalationOrders() {
  var ratings = DATA.ratings || {};
  var dsis = Object.keys(ratings).filter(function(dsi) { return ratings[dsi]==='1 Star'||ratings[dsi]==='2 Stars'; });
  var lookup = buildOrderLookup();
  var orders = dsis.map(function(dsi) {
    var o = lookup[dsi];
    return o ? o : { dsi:dsi, rep:'—', spe:'', productType:'—', orderDate:'—', dtrStatus:'—' };
  });
  orders.sort(_byOrderDateDesc);   // default: newest order first
  return orders;
}

function renderEscalationsTable() {
  var ratings = DATA.ratings || {};
  if (!Object.keys(ratings).some(function(dsi) { return ratings[dsi]==='1 Star'||ratings[dsi]==='2 Stars'; })) return noData('No escalations yet.', {icon:'escalations', sub:'Orders rated 1 or 2 Stars will appear here.'});
  var orders = _escalationOrders();
  _tabOrders = orders.slice(); _sortTblId = 'esc-table'; _sortState = { col: null, dir: 1 }; _activeFilters = { products: [], statuses: [], dateFrom: '', dateTo: '' }; _extraColFn = null;
  _ctShowRiskFlags = false; _ISSUE_DSI = null;
  if (_BOOKED_MAP === null) _loadBookedAppts();
  return _tableauWarnBanner() + '<div class="card"><div class="card-header dark">Escalations &nbsp;<span style="font-weight:400;font-size:.82rem;opacity:.8">'+orders.length+' orders</span></div><div class="card-body">' +
    _buildFilterRow('f-esc') +
    '<div class="ct-active-filters" id="ct-active-filters"></div>' +
    '<div class="call-table-wrap"><table class="call-table" id="esc-table"><thead><tr>' +
    _sortHeaders('esc-table') +
    '</tr></thead><tbody>'+callTableRows(orders,null)+'</tbody></table></div></div></div>';
}

// ── CHURN ─────────────────────────────────────────────────────────────────
var CHURN_BUCKETS = ['0-30 Day', '30 Day', '60 Day', '90 Day', '120 Day'];

function _churnCls(color) {
  var c = String(color||'').toLowerCase();
  return c==='green'?'ar-green':c==='yellow'?'ar-yellow':c==='red'?'ar-red':'';
}

function _buildChurnRepMap(rows, repFilter) {
  var repMap = {}, repList = [];
  (rows||[]).forEach(function(r) {
    if (!r.rep || CHURN_BUCKETS.indexOf(r.bucket) === -1) return;
    if (repFilter && r.rep !== repFilter) return;
    if (!repMap[r.rep]) { repMap[r.rep] = {}; repList.push(r.rep); }
    repMap[r.rep][r.bucket] = r;
  });
  repList.sort();
  return { repMap: repMap, repList: repList };
}

function _churnTableHtml(repList, repMap, gtRepList, gtRepMap) {
  // gtRepList/gtRepMap: full office data for grand total (falls back to repList/repMap)
  var _gtList = gtRepList || repList;
  var _gtMap  = gtRepMap  || repMap;
  function fmtN(n) { return Number(n).toLocaleString(); }
  function fmtRate(r) {
    var s = String(r == null ? '' : r).trim();
    if (s.indexOf('%') !== -1) return s;
    var n = parseFloat(s);
    if (isNaN(n)) return '0.0%';
    return (n <= 1 ? n * 100 : n).toFixed(1) + '%';
  }
  function cell(d) {
    if (!d) return '<td class="ar-cell"></td>';
    return '<td class="ar-cell"><span class="ar-badge '+_churnCls(d.color)+'">('+fmtN(d.disconnects)+'/'+fmtN(d.activated)+')<br>'+fmtRate(d.churnRate)+'</span></td>';
  }
  // Tableau colors each churn cell per bucket (lower rate = greener) but exports no
  // Grand Total row. Collect the rate of every colored per-rep cell per bucket, then
  // place each color boundary at the midpoint between the worst-green / best-red rates
  // Tableau actually shows — so the Grand Total is colored Tableau's way even when its
  // rate sits between samples, and it works for all-green buckets (e.g. 0-30 Day).
  var churnPts = {};
  _gtList.forEach(function(rep) {
    CHURN_BUCKETS.forEach(function(bkt) {
      var d = _gtMap[rep][bkt]; if (!d || !d.activated) return;
      var col = String(d.color||'').toLowerCase();
      if (col!=='green' && col!=='yellow' && col!=='red') return;
      (churnPts[bkt] = churnPts[bkt] || { green:[], yellow:[], red:[] })[col].push(d.disconnects/d.activated*100);
    });
  });
  function churnFixedCls(bkt, pctR) {   // fallback only when a bucket has no colored rows at all
    if (bkt==='0-30 Day') return pctR<=2.4 ?'ar-green':pctR<=3.0 ?'ar-yellow':'ar-red';
    if (bkt==='30 Day')   return pctR<=4.9 ?'ar-green':pctR<=6.9 ?'ar-yellow':'ar-red';
    if (bkt==='60 Day')   return pctR<=8.9 ?'ar-green':pctR<=9.9 ?'ar-yellow':'ar-red';
    if (bkt==='90 Day')   return pctR<=10.9?'ar-green':pctR<=13.9?'ar-yellow':'ar-red';
    if (bkt==='120 Day')  return pctR<=13.9?'ar-green':pctR<=17.9?'ar-yellow':'ar-red';
    return 'ar-blue';
  }
  function churnTotalCls(bkt, pct, pctR) {
    var P = churnPts[bkt];
    if (!P || (!P.green.length && !P.yellow.length && !P.red.length)) return churnFixedCls(bkt, pctR);
    var gMax = P.green.length  ? Math.max.apply(null, P.green)  : null;
    var yMin = P.yellow.length ? Math.min.apply(null, P.yellow) : null;
    var yMax = P.yellow.length ? Math.max.apply(null, P.yellow) : null;
    var rMin = P.red.length    ? Math.min.apply(null, P.red)    : null;
    // tGY = green->yellow boundary, tYR = yellow->red boundary (rate ascending = worse)
    var tGY = (gMax!==null) ? (yMin!==null ? (gMax+yMin)/2 : (rMin!==null ? (gMax+rMin)/2 : Infinity)) : -Infinity;
    var tYR = (rMin!==null) ? (yMax!==null ? (yMax+rMin)/2 : (gMax!==null ? (gMax+rMin)/2 : -Infinity)) : Infinity;
    if (pct < tGY) return 'ar-green';
    if (pct < tYR) return 'ar-yellow';
    return 'ar-red';
  }
  function totalCell(bkt) {
    var acts=0, disco=0;
    _gtList.forEach(function(rep){ var d=_gtMap[rep][bkt]; if(d){acts+=d.activated;disco+=d.disconnects;} });
    if (!acts) return '<td class="ar-cell"></td>';
    var pct = disco/acts*100;
    var pctR = Math.round(pct*10)/10;
    var cls = churnTotalCls(bkt, pct, pctR);
    return '<td class="ar-cell"><span class="ar-badge '+cls+'">('+fmtN(disco)+'/'+fmtN(acts)+')<br>'+pct.toFixed(1)+'%</span></td>';
  }
  var hdr = '<th style="min-width:160px">Rep</th>' +
    CHURN_BUCKETS.map(function(b){return '<th style="min-width:110px">'+esc(b)+'</th>';}).join('');
  var grandRow = '<tr class="ar-grand-row"><td class="ar-rep ar-grand-rep">Grand Total</td>'+CHURN_BUCKETS.map(totalCell).join('')+'</tr>';
  var repRows = repList.map(function(rep){
    return '<tr><td class="ar-rep">'+esc(rep)+'</td>'+CHURN_BUCKETS.map(function(bkt){return cell(repMap[rep][bkt]);}).join('')+'</tr>';
  }).join('');
  return '<div class="tbl-wrap"><table><thead><tr>'+hdr+'</tr></thead><tbody>'+grandRow+repRows+'</tbody></table></div>';
}

function renderChurn() {
  var rows = DATA.churnReport || [];
  if (!rows.length) return noData('No churn data yet.', {icon:'churn', sub:'Tableau sync runs nightly — check back soon.'});
  var role = SESSION.role || 'client-rep';
  var isTeamRole = role === 'leader';   // jd is office-wide (manager-equivalent)
  if (isTeamRole) {
    var churnTeam = _myTeam();
    if (churnTeam) {
      var churnTns = _teamTableauNames(churnTeam.name);
      var teamRows = rows.filter(function(r) { return churnTns.indexOf((r.rep || '').trim().toLowerCase()) !== -1; });
      var built = _buildChurnRepMap(teamRows, '');
      return '<div class="card"><div class="card-header dark">Churn Report — ICD</div><div class="card-body">' +
        '<div id="churn-table-wrap">'+_churnTableHtml(built.repList, built.repMap)+'</div>' +
        '</div></div>';
    }
    // No team found — show own row with office grand total
    var myNameC = (SESSION.tableauName || '').trim();
    var myBuiltC = _buildChurnRepMap(rows, myNameC);
    var allBuiltC = _buildChurnRepMap(rows, '');
    return '<div class="card"><div class="card-header dark">Churn Report — ICD</div><div class="card-body">' +
      '<div id="churn-table-wrap">'+_churnTableHtml(myBuiltC.repList, myBuiltC.repMap, allBuiltC.repList, allBuiltC.repMap)+'</div>' +
      '</div></div>';
  }
  if (role === 'client-rep') {
    var myName = (SESSION.tableauName || '').trim();
    var myBuilt  = _buildChurnRepMap(rows, myName);
    var allBuilt = _buildChurnRepMap(rows, '');
    return '<div class="card"><div class="card-header dark">Churn Report — ICD</div><div class="card-body">' +
      '<div id="churn-table-wrap">'+_churnTableHtml(myBuilt.repList, myBuilt.repMap, allBuilt.repList, allBuilt.repMap)+'</div>' +
      '</div></div>';
  }
  var allReps = [];
  var seen = {};
  (rows).forEach(function(r){ if(r.rep&&!seen[r.rep]){seen[r.rep]=true;allReps.push(r.rep);} });
  allReps.sort();
  var repSel = '<select class="ar-select" id="churn-rep-sel" onchange="refreshChurn()">' +
    '<option value="">All Reps</option>' +
    allReps.map(function(n){return '<option value="'+esc(n)+'">'+esc(n)+'</option>';}).join('') + '</select>';
  var built = _buildChurnRepMap(rows, '');
  return '<div class="card"><div class="card-header dark">Churn Report — ICD</div><div class="card-body">' +
    '<div class="filter-row">'+repSel+'</div>' +
    '<div id="churn-table-wrap">'+_churnTableHtml(built.repList, built.repMap)+'</div>' +
    '</div></div>';
}

function refreshChurn() {
  var sel = document.getElementById('churn-rep-sel');
  var filter = sel ? sel.value : '';
  var built = _buildChurnRepMap(DATA.churnReport||[], filter);
  var wrap = document.getElementById('churn-table-wrap');
  if (wrap) wrap.innerHTML = _churnTableHtml(built.repList, built.repMap);
}

