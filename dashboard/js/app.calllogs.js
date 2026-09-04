// ── ACTIVATION RATES ──────────────────────────────────────────────────────
var _AR_LINES = null;
/* Identity-free copy of the FULL office line set, used only for the grand total and Tableau's
   colour cutoffs now that _AR_LINES is scoped per badge. Carries no `rep` field at all.
   ⚠ Must be assigned EVERYWHERE _AR_LINES is — three fetch sites and four resets. Left behind on
   one path it would silently serve a stale office total (R-063: enumerate the call sites). */
var _AR_AGG = null;
var _AR_LOADING = false;

/* ── ROW ORDER — Activation Rates + Churn (user, 2026-09-04) ─────────────────────────────
   "Sort from highest to lowest": Churn = most lines churned, then highest percent; Activation
   Rates = most lines sitting INACTIVE (volume minus activations), then most lines active
   (user, later the same day: "who has the most lines sitting unactive and who has the most
   lines active" — the first cut ranked by volume, which is not the same question).
   🔑 THE DEFAULT COLUMN IS THE USER'S PICK from a rendered preview (ratesort_preview_build.js):
   Churn opens on 0-30 Day, Activation Rates on 8–14 Days — NOT the total across buckets, which
   was offered and declined ("B is closest to what we are wanting, churn 0-30 activation rate
   8-14"). 'total' remains reachable only through the sort logic, not a header.
   Clicking a bucket header sorts by that bucket alone with the same two keys; clicking Rep
   sorts A–Z; clicking the active header flips direction. Ties stay A–Z in either direction.
   Module-level state on purpose — every change re-renders the wrap through innerHTML.
   ⚠ Headers are only clickable when there are 2+ rep rows: a client-rep's own row and the
   Teams page's total-only churn table (app.people.js) get plain headers and no caption. */
var _AR_SORT = { col: 'b8_14', dir: -1 };
var _CH_SORT = { col: '0-30 Day', dir: -1 };
function _rateNextSort(st, col) {
  return { col: col, dir: (st.col === col) ? -st.dir : (col === 'rep' ? 1 : -1) };
}
/* One header emitter and one caption for BOTH tabs, so they cannot drift in how a sort shows. */
function _rateTh(col, label, sortable, st, handler, style) {
  var sty = style ? ' style="' + style + '"' : '';
  if (!sortable) return '<th' + sty + '>' + label + '</th>';
  var on = st.col === col;
  return '<th class="sort-th"' + sty + ' onclick="' + handler + '(\'' + col + '\')" title="Sort by ' + label + '">' +
    label + (on ? (st.dir === -1 ? ' ↓' : ' ↑') : '') + '</th>';
}
function _rateSortCaption(st, cols, noun) {
  var label = '';
  cols.forEach(function(c) { if (c[0] === st.col) label = c[1]; });
  var what = st.col === 'rep'   ? (st.dir === 1 ? 'Rep A–Z' : 'Rep Z–A')
           : st.col === 'total' ? ('total ' + noun + (st.dir === -1 ? ', most first' : ', fewest first'))
           :                      (label + ' ' + noun + (st.dir === -1 ? ', most first' : ', fewest first'));
  return '<div style="font-size:.78rem;color:var(--text2);margin:0 0 8px">Sorted by ' + what +
    ' &middot; click a column header to change</div>';
}
/* First non-zero difference along a key chain. Every key chain below ends in the rep's TOTALS
   across all buckets, so a rep with nothing in the sorted column still lands somewhere
   meaningful instead of in an alphabetical block at the bottom (user, 2026-09-04: "activations
   do not seem to be organized at all" — the 8–14 column was empty for most reps). */
function _rateCmp(kx, ky) {
  for (var i = 0; i < kx.length; i++) { var c = kx[i] - ky[i]; if (c) return c; }
  return 0;
}
function _arSortBy(col) { _AR_SORT = _rateNextSort(_AR_SORT, col); refreshActRates(); }
function _arSortedReps(repData) {
  var s = _AR_SORT;
  function tot(d, f) { return d.b0_7[f] + d.b8_14[f] + d.b15_30[f] + d.b31_60[f]; }
  function k(rep) {
    var d = repData[rep], ti = tot(d, 't') - tot(d, 'a'), ta = tot(d, 'a');
    if (s.col === 'total') return [ti, ta];
    var b = d[s.col] || { t: 0, a: 0 };
    return [b.t - b.a, b.a, ti, ta];   // bucket INACTIVE, bucket active, then the same totals
  }
  return Object.keys(repData).sort(function(x, y) {
    if (s.col === 'rep') return s.dir * x.localeCompare(y);
    var c = _rateCmp(k(x), k(y));
    return c ? s.dir * c : x.localeCompare(y);
  });
}

function renderActRates() {
  if (_AR_LINES) return _renderActRatesWithData();
  if (_AR_LOADING) return loadingState('Loading activation rates…', { icon:'actrates', bare:true });
  _AR_LOADING = true;
  var _reqOffice = CFG.officeId;
  api({ action: 'readActRateLines' }).then(function(resp) {
    _AR_LOADING = false;
    /* Office guard. ⚠ _AR_LOADING is cleared ABOVE the return deliberately — bail first and
       the flag stays true for the session, so this tab could never load again. */
    if (CFG.officeId !== _reqOffice) return;
    _AR_LINES = (resp && resp.actRateLines) ? resp.actRateLines : [];
    _AR_AGG   = (resp && resp.arAgg) ? resp.arAgg : null;
    if (CURRENT_TAB === 'actrates') {
      var c = document.getElementById('main-content');
      if (c) c.innerHTML = _renderActRatesWithData();
    }
  }).catch(function() {
    _AR_LOADING = false;
    _AR_LINES = []; _AR_AGG = null;
  });
  return loadingState('Loading activation rates…', { icon:'actrates', bare:true });
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
    // Teams they LEAD + everything beneath them (2026-08-30) — was a single-team `_myTeam()`
    // lookup, the last place besides Churn where a leader stayed flat.
    var _arTns = _leaderTeamTableauNames();
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
  /* Office grand total. ⚠ `allLines` is now SCOPED, so for a client-rep it is just their own
     rows — the office comparison the user asked to keep has to come from the anonymised
     aggregate. Team roles still total their own team, as before. */
  var grandLines = isTeamRole ? indivLines : (_AR_AGG || allLines);
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
  (_AR_AGG || _AR_LINES || []).forEach(function(l) {
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
    if (b.t===0) return '<td class="ar-cell"><div class="ar-badge ar-none">(0/0)<br>—</div></td>';
    var pct=Math.round(b.a/b.t*100);
    var cls = isTotal ? arTotalCls(bktKey, pct) : (arColorCls(b.color) || bktCls(bktKey, pct));
    return '<td class="ar-cell"><div class="ar-badge '+cls+'">('+b.a+'/'+b.t+')<br>'+pct+'%</div></td>';
  }

  var repOrder = _arSortedReps(repData);
  var repRows = repOrder.map(function(rep) {
    var d=repData[rep];
    return '<tr><td class="ar-rep">'+esc(rep)+'</td>'+cell(d.b0_7,'b0_7',false)+cell(d.b8_14,'b8_14',false)+cell(d.b15_30,'b15_30',false)+cell(d.b31_60,'b31_60',false)+'</tr>';
  }).join('');

  if (!repRows) return noData('No data for the selected filters.', { icon:'actrates', bare:true });

  var grandRow = '<tr class="ar-grand-row"><td class="ar-rep ar-grand-rep">Grand Total</td>'+cell(totals.b0_7,'b0_7',true)+cell(totals.b8_14,'b8_14',true)+cell(totals.b15_30,'b15_30',true)+cell(totals.b31_60,'b31_60',true)+'</tr>';

  var sortable = repOrder.length > 1;
  var AR_COLS = [['rep','Rep'],['b0_7','0–7 Days'],['b8_14','8–14 Days'],['b15_30','15–30 Days'],['b31_60','31–60 Days']];
  var ths = AR_COLS.map(function(c) { return _rateTh(c[0], c[1], sortable, _AR_SORT, '_arSortBy'); }).join('');
  return (sortable ? _rateSortCaption(_AR_SORT, AR_COLS, 'inactive lines') : '') +
    '<div class="tbl-wrap"><table class="call-table"><thead><tr>' + ths +
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
  var _reqOffice = CFG.officeId;
  api({ action: 'readRepNames' }).then(function(res) {
    /* Office guard. These are ROSTER names for one office; filling them from a response that
       outlived a switch puts the previous office's people into every picker that reads this.
       🔑 cb() is deliberately NOT called on the stale path: the office switch re-renders the
       tab anyway, and PEOPLE_TABLEAU_NAMES stays null so the next call refetches for the new
       office. There is no in-flight flag here, so bailing cannot wedge anything. */
    if (CFG.officeId !== _reqOffice) return;
    PEOPLE_TABLEAU_NAMES = res.names || [];
    cb();
  }).catch(function() { PEOPLE_TABLEAU_NAMES = []; cb(); });
}

// ── NOTES MODAL ───────────────────────────────────────────────────────────
// Who wrote a note, as a NAME. authorName is captured at write time as
// `SESSION.name || SESSION.email`, and for an activator or master-admin working across
// offices SESSION.name is frequently blank — so the raw EMAIL got persisted and shown.
// Resolving here rather than at write time means every historical note is corrected on
// the next render; no sheet backfill, and notes written by someone since removed from the
// roster still resolve as long as they are reachable in any of the sources below.
function _noteAuthor(n){
  var raw = String((n && n.authorName) || '').trim();
  if (raw && raw.indexOf('@') === -1) return raw;   // already a real name — leave it alone
  var email = String((n && n.authorEmail) || raw || '').trim().toLowerCase();
  if (!email) return 'Unknown';
  var hit = ((DATA.roster || {})[email] || {}).name;
  // Cross-office members: guestRoster may be a map OR an array depending on the caller.
  if (!hit) {
    var g = DATA.guestRoster;
    if (g && !Array.isArray(g) && g[email]) hit = g[email].name;
    else if (Array.isArray(g)) {
      for (var i = 0; i < g.length; i++)
        if (String(g[i] && g[i].email || '').toLowerCase() === email) { hit = g[i].name; break; }
    }
  }
  // Activators are not necessarily on THIS office's roster at all.
  if (!hit && typeof _APPT !== 'undefined' && _APPT && Array.isArray(_APPT.activators)) {
    for (var j = 0; j < _APPT.activators.length; j++)
      if (String(_APPT.activators[j].email || '').toLowerCase() === email) { hit = _APPT.activators[j].name; break; }
  }
  if (hit) return hit;
  // Nothing matched — make the local part presentable instead of showing a bare address.
  var lp = email.split('@')[0].replace(/[._\-]+/g, ' ').replace(/\d+/g, '').trim();
  return lp ? lp.replace(/\b\w/g, function(c){ return c.toUpperCase(); }) : email;
}
var _modalDsi = '';
var _modalOffice = '';   // office the modal's notes belong to (cross-office dashboard support)
var _modalApptId = '';   // set when opened from an appointment → note adds route via addAppointmentNote

function _noteItemHtml(n) {
  var la=Math.max(0,parseInt(n.linesActivated,10)||0);
  var badge=la>0?' <span class="nm-lines-badge">'+icon('zap')+' '+la+' line'+(la===1?'':'s')+' activated</span>':'';
  return '<div class="nm-note"><div class="nm-note-meta">'+fmtDateTime(n.ts)+' &mdash; '+esc(_noteAuthor(n))+badge+'</div><div class="nm-note-text">'+esc(n.noteText)+'</div></div>';
}

// NEWEST FIRST. The history boxes are only ~200px tall, so whatever renders first is
// what you actually see — and on a heavily-called order that has to be the most recent
// call, not the oldest. Neither the FE nor readNotes() sorted before: order was sheet
// APPEND order, which is chronological only for as long as nobody edits the sheet.
// Sorts a COPY — DATA.notes stays in append order for _daysSinceLastNote and friends.
// Ties (equal or missing ts) fall back to append order, reversed, so a note added later
// still reads as newer; a missing ts sorts to the bottom rather than jumping the list.
function _notesNewestFirst(notes) {
  return (notes||[]).map(function(n, i) { return { n:n, i:i, t:n.ts ? new Date(n.ts).getTime() : 0 }; })
    .sort(function(a, b) {
      if (isNaN(a.t)) a.t = 0;
      if (isNaN(b.t)) b.t = 0;
      return b.t !== a.t ? b.t - a.t : b.i - a.i;
    })
    .map(function(x) { return x.n; });
}

// opts, when opened from an appointment. NOTE the two note keys are DIFFERENT stores —
// conflating them double-renders the list:
//   opts.notes       the DSI's own notes (_Notes_<office>), fetched by the caller because
//                    the appointment may belong to another office. Same data as
//                    DATA.notes[dsi], just office-correct. From openDashNotes.
//   opts.apptNotes   the LEGACY per-appointment staff thread (_ApptNotes), keyed on the
//                    appointment, not the DSI, and written by a UI that no longer exists.
//                    Read-only archive — nothing can add to it any more. From openApptNotes.
//   opts.customerNote  what the customer typed when they self-booked.
// ── CX REQUEST TO CANCEL ──────────────────────────────────────────────────
// A cancel request is an ordinary _Notes_<office> row with noteType 'cancel'. The
// reason rides inside noteText as a "[Reason] detail" prefix rather than in a new
// column: the sheet schema is fixed at 7 columns, and keeping to it means the whole
// capture side works with NO backend redeploy. The Daily Report parses the same
// prefix to bucket by reason, so the two stay in step by construction.
//
// Reasons are save-as-you-go, exactly like the Sales Support lookups: pick an
// existing one or add a new one that persists for everyone. Until the backend
// serves getCancelReasons, the seed list below stands in — so the picker is never
// empty, even before a redeploy.
var CANCEL_REASONS = null;      // null = not loaded yet
var _CANCEL_REASON_FLIGHT = false;
var CANCEL_REASON_SEED = [
  'Price / bill too high',
  'Coverage or speed',
  'Found a better offer',
  'Buyer’s remorse',
  'Moving / no longer needs service',
  'Service never installed',
  'Unhappy with rep or process',
  'Other'
];
function cancelReasonList() { return CANCEL_REASONS && CANCEL_REASONS.length ? CANCEL_REASONS : CANCEL_REASON_SEED.slice(); }

// Fetches once per session. Any failure (including an older backend that doesn't
// know the action) just leaves the seed in place — the picker still works.
function ensureCancelReasons(cb) {
  cb = cb || function(){};
  if (CANCEL_REASONS !== null || _CANCEL_REASON_FLIGHT) { cb(); return; }
  _CANCEL_REASON_FLIGHT = true;
  api({ action:'getCancelReasons' }).then(function(res) {
    _CANCEL_REASON_FLIGHT = false;
    CANCEL_REASONS = (res && !res.error && res.reasons && res.reasons.length) ? res.reasons : CANCEL_REASON_SEED.slice();
    cb();
  }).catch(function() { _CANCEL_REASON_FLIGHT = false; CANCEL_REASONS = CANCEL_REASON_SEED.slice(); cb(); });
}

// "[Reason] detail" → {reason, detail}. A row without the prefix (hand-typed into the
// sheet, or written before this shipped) degrades to reason '' + the whole text as detail
// rather than being dropped.
function _cancelParse(noteText) {
  var s = String(noteText || '');
  var m = s.match(/^\s*\[([^\]]+)\]\s*([\s\S]*)$/);
  return m ? { reason: m[1].trim(), detail: m[2].trim() } : { reason: '', detail: s.trim() };
}
// ']' is the one character that could break the prefix back out, so it never enters it.
function _cancelFmt(reason, detail) {
  var r = String(reason || '').replace(/[\[\]]/g, '').trim();
  var d = String(detail || '').trim();
  return '[' + r + ']' + (d ? ' ' + d : '');
}

// The spotlight block: pinned high in the modal, never collapsed, never hidden behind
// a scroll. Only rendered when the order actually has a request.
function notesCancelBlockHtml(cancelNotes) {
  if (!cancelNotes || !cancelNotes.length) return '';
  var items = cancelNotes.map(function(n) {
    var p = _cancelParse(n.noteText);
    return '<div class="nm-cx-item">' +
        '<div class="nm-cx-reason">'+esc(p.reason || 'No reason recorded')+'</div>' +
        (p.detail ? '<div class="nm-cx-detail">'+esc(p.detail)+'</div>' : '') +
        '<div class="nm-cx-meta">'+fmtDateTime(n.ts)+' &mdash; '+esc(_noteAuthor(n))+'</div>' +
      '</div>';
  }).join('');
  return '<div class="nm-cx-block" id="nm-cx-block">' +
      '<div class="nm-cx-hdr">'+icon('issues')+' Cx Requested to Cancel' +
        (cancelNotes.length > 1 ? '<span class="nm-cx-count">'+cancelNotes.length+'</span>' : '') +
      '</div>' + items +
    '</div>';
}

// A button that sits under the rating row, alongside the other things you'd mark about
// a call. The reason capture stays COLLAPSED until it's pressed — a cancel request is
// rare, and an always-open form invites half-filled ones. Pressing it opens the fields
// inline (not a second modal, which would fight the reason picker's own "+ Add" popup).
// Reason is REQUIRED; 'Other' additionally requires the detail, since "Other" on its
// own tells the Daily Report nothing.
function notesCancelFormHtml() {
  var reasons = cancelReasonList();
  var picker;
  if (typeof _comboField === 'function') {
    // The same save-as-you-go widget the Sales Support portal uses — pick one, or
    // "+ Add" a new reason that persists for every office next time.
    picker = _comboField('nm-cancel-reason', {
      placeholder: 'Reason for cancel (required)',
      options: function(){ return cancelReasonList(); },
      onAdd: function(typed){ _cancelReasonAddPopup(typed); }
    });
  } else {
    // Degraded: pick-existing only. Reached only if app.tickets.js failed to load.
    picker = '<select id="nm-cancel-reason" class="ps-input"><option value="">Reason for cancel (required)</option>' +
      reasons.map(function(r){ return '<option value="'+esc(r)+'">'+esc(r)+'</option>'; }).join('') + '</select>';
  }
  return '<div id="nm-cx-wrap">' +
      '<button type="button" class="nm-cx-open-btn" id="nm-cx-open" onclick="toggleCancelForm()">' +
        icon('issues') + ' Cx Requested to Cancel</button>' +
      '<div class="nm-cx-form" id="nm-cx-form" style="display:none">' +
        '<div class="nm-cx-form-label">Why are they cancelling? <span class="nm-cx-req">required</span></div>' +
        picker +
        '<textarea class="nm-textarea" id="nm-cancel-detail" placeholder="What did they say? (required if the reason is Other)" style="margin:9px 0 0"></textarea>' +
        '<div class="nm-cx-err" id="nm-cancel-err"></div>' +
        '<div class="nm-cx-form-actions">' +
          '<button class="nm-add-btn nm-cx-add-btn" onclick="modalAddCancelRequest()">LOG CANCEL REQUEST</button>' +
          '<button class="nm-close-btn" onclick="toggleCancelForm(false)">CANCEL</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// open === undefined toggles; pass false to force closed (used after a save and by the
// form's own CANCEL button). Closing always clears the fields and any error, so the
// next press starts clean rather than resurfacing a half-typed abandoned request.
function toggleCancelForm(open) {
  var form = document.getElementById('nm-cx-form'), btn = document.getElementById('nm-cx-open');
  if (!form) return;
  var isOpen = form.style.display !== 'none';
  var next = (open === undefined) ? !isOpen : !!open;
  form.style.display = next ? 'block' : 'none';
  if (btn) btn.classList.toggle('active', next);
  if (!next) {
    var r = document.getElementById('nm-cancel-reason'); if (r) r.value = '';
    var d = document.getElementById('nm-cancel-detail'); if (d) d.value = '';
    _cancelErr('');
  } else {
    var r2 = document.getElementById('nm-cancel-reason'); if (r2 && r2.focus) r2.focus();
  }
}

// Add a reason to the picker NOW and persist it for everyone, mirroring
// _ticketRememberValue: local list first so it appears immediately, then the backend.
function _cancelReasonAddPopup(typed) {
  _ssAddPopup('Add cancel reason', [{ id:'val', label:'New reason', value:typed || '' }], function(v) {
    var val = String(v.val || '').replace(/[\[\]]/g, '').trim();
    if (!val) return 'Enter a reason.';
    var list = cancelReasonList();
    if (!list.some(function(r){ return r.toLowerCase() === val.toLowerCase(); })) list.push(val);
    CANCEL_REASONS = list;
    var inp = document.getElementById('nm-cancel-reason'); if (inp) inp.value = val;
    apiPost({ action:'addCancelReason', value: val, addedBy: SESSION.email });
  });
}

function _cancelErr(msg) {
  var e = document.getElementById('nm-cancel-err'); if (!e) return;
  e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none';
}

function modalAddCancelRequest() {
  var rEl = document.getElementById('nm-cancel-reason');
  var dEl = document.getElementById('nm-cancel-detail');
  var reason = rEl ? String(rEl.value || '').trim() : '';
  var detail = dEl ? String(dEl.value || '').trim() : '';
  if (!reason) { _cancelErr('Pick a reason — a cancel request without one can’t be reported on.'); if (rEl) rEl.focus(); return; }
  if (reason.toLowerCase() === 'other' && !detail) { _cancelErr('“Other” needs a detail — say what they told you.'); if (dEl) dEl.focus(); return; }
  _cancelErr('');
  var noteText = _cancelFmt(reason, detail);
  var entry = { ts:new Date().toISOString(), authorEmail:SESSION.email, authorName:SESSION.name||SESSION.email,
                noteText:noteText, noteType:'cancel', linesActivated:0 };

  toggleCancelForm(false);   // clears the fields and collapses back to the button
  if (!DATA.notes) DATA.notes = {};
  if (!DATA.notes[_modalDsi]) DATA.notes[_modalDsi] = [];
  DATA.notes[_modalDsi].push(entry);
  var noteCount = document.getElementById('nc-'+_modalDsi.replace(/\W/g,'_'));
  if (noteCount) noteCount.textContent = DATA.notes[_modalDsi].length;

  // Repaint the spotlight in place so the request appears where it will live.
  var all = _notesNewestFirst((DATA.notes[_modalDsi]||[]).filter(function(n){ return n.noteType==='cancel'; }));
  var block = document.getElementById('nm-cx-block');
  if (block) block.outerHTML = notesCancelBlockHtml(all);
  else {
    var body = document.getElementById('modal-body');
    if (body) body.insertAdjacentHTML('afterbegin', notesCancelBlockHtml(all));
  }

  _noteAddFlight = true;
  var _done = function(){ _noteAddFlight = false; };
  if (_modalApptId && _modalOffice !== CFG.officeId) {
    _apptPost({ action:'addAppointmentNote', appointmentId:_modalApptId, noteText:noteText, noteType:'cancel',
                linesActivated:0, email:SESSION.email, authorName:SESSION.name||SESSION.email }).then(_done).catch(_done);
  } else {
    apiPost({ action:'addNote', dsi:_modalDsi, noteText:noteText, noteType:'cancel',
              clientKey:_clientKey('note'),
              authorEmail:SESSION.email, authorName:SESSION.name||SESSION.email }).then(_done).catch(_done);
  }
}

// The customer's booking note. One definition, shared by the notes modal and the
// no-DSI appointment fallback in app.appts.js — they used to be two copies of the
// same inline-styled block that could drift apart.
function notesCustomerNoteHtml(text) {
  return '<div class="nm-custnote">' +
      '<div class="nm-custnote-label">Customer note &middot; from their booking</div>' +
      '<div class="nm-custnote-text">'+esc(text)+'</div>' +
    '</div>';
}

function openNotesModal(dsi, customer, rep, opts) {
  opts = opts || {};
  _modalDsi = dsi;
  _modalOffice = opts.office || CFG.officeId;
  _modalApptId = opts.appointmentId || '';
  var _cross = !!_modalApptId && _modalOffice !== CFG.officeId;
  var notes = _cross ? (opts.notes || []) : ((DATA.notes||{})[dsi] || opts.notes || []);
  var apptNotes = _notesNewestFirst(opts.apptNotes || []);
  var custNote = String(opts.customerNote || '').trim();
  var rating = (DATA.ratings||{})[dsi] || '';
  var role = SESSION.role || 'client-rep';
  var canAddActivation = role==='master-admin' || role==='activator';
  var canAddRep = ['master-admin','owner','admin','activator','client-rep','leader','jd','manager'].indexOf(role) !== -1;

  // 'cancel' matches none of these filters, so cancel requests never leak into the
  // activation or rep lists — they get their own spotlight instead.
  var actNotes = _notesNewestFirst(notes.filter(function(n){ return (n.noteType||'activation')==='activation'; }));
  var repNotes = _notesNewestFirst(notes.filter(function(n){ return n.noteType==='rep' || n.noteType==='note'; }));
  var cancelNotes = _notesNewestFirst(notes.filter(function(n){ return n.noteType==='cancel'; }));

  var actHistHtml = actNotes.length ? actNotes.map(_noteItemHtml).join('') : _notesEmptyHtml('activation');
  var repHistHtml = repNotes.length ? repNotes.map(_noteItemHtml).join('') : _notesEmptyHtml('rep');

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
    // Pinned above everything: the customer's own words from the booking. It used to
    // show ONLY on no-DSI bookings, so it vanished the moment the order became workable.
    (custNote ? notesCustomerNoteHtml(custNote) : '') +
    // Spotlight: an order the customer has asked to cancel says so before anything else.
    notesCancelBlockHtml(cancelNotes) +
    '<div class="nm-section-label nm-act-label">Activation Notes</div>' +
    '<div class="nm-history" id="nm-act-hist">'+actHistHtml+'</div>' +
    (canAddActivation ? '<textarea class="nm-textarea" id="nm-act-input" placeholder="Add activation note…" style="margin-bottom:8px"></textarea>'+_linesFieldHtml('modal-body',icon('zap')+' Lines activated on this order')+'<button class="nm-add-btn" onclick="modalAddNote(\'activation\')" style="margin-bottom:14px">ADD ACTIVATION NOTE</button>' : '') +
    '<div class="nm-section-label nm-rep-label" style="margin-top:8px">Rep Notes</div>' +
    '<div class="nm-history" id="nm-rep-hist">'+repHistHtml+'</div>' +
    (canAddRep ? '<textarea class="nm-textarea" id="nm-rep-input" placeholder="Add rep note…"></textarea><button class="nm-add-btn nm-rep-add-btn" onclick="modalAddNote(\'rep\')" style="margin-bottom:14px">ADD REP NOTE</button>' : '') +
    // Legacy _ApptNotes thread — read-only, and only rendered when the appointment
    // actually has one, so it stays invisible on the ~all appointments that don't.
    (apptNotes.length ?
      '<div class="nm-section-label nm-appt-label" style="margin-top:8px">Appointment Notes'+
        '<span class="nm-archive-tag">archive</span></div>' +
      '<div class="nm-history" id="nm-appt-hist">'+apptNotes.map(_noteItemHtml).join('')+'</div>' : '') +
    (_cross ? '' :
      '<div class="nm-section-label" style="margin-top:8px">Rating</div>' +
      '<div class="nm-rating-row" id="nm-rating-row">'+ratingHtml+'</div>') +
    // Sits UNDER the rating row — the other thing you mark about a call. Outside the
    // _cross guard on purpose: a cancel request isn't a rating, and a cross-office
    // appointment can hear one just the same.
    (canAddRep ? notesCancelFormHtml() : '') +
    '<div class="nm-actions"><button class="nm-close-btn" style="width:100%" onclick="closeModal()">CLOSE</button></div>';

  document.getElementById('detail-modal').classList.add('open');
  // Reasons load once per session. If they land after the modal is already open,
  // repaint just the capture section — preserving whether it was open and anything
  // already typed into it, so the fetch never yanks a form out from under someone.
  if (canAddRep) ensureCancelReasons(function() {
    var wrap = document.getElementById('nm-cx-wrap'); if (!wrap) return;
    var f0 = document.getElementById('nm-cx-form');
    var wasOpen = !!f0 && f0.style.display !== 'none';
    var d0 = document.getElementById('nm-cancel-detail'), r0 = document.getElementById('nm-cancel-reason');
    var keptDetail = d0 ? d0.value : '', keptReason = r0 ? r0.value : '';
    wrap.outerHTML = notesCancelFormHtml();
    if (wasOpen) {
      toggleCancelForm(true);
      var d1 = document.getElementById('nm-cancel-detail'); if (d1) d1.value = keptDetail;
      var r1 = document.getElementById('nm-cancel-reason'); if (r1) r1.value = keptReason;
    }
  });
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
  // Optimistic in-modal insert — only the note list updates, never a full reload.
  // PREPENDS, and scrolls to the TOP: the list is newest-first, so the note you just
  // wrote belongs at the head, not the tail.
  var hist = document.getElementById(histId);
  if (hist) {
    hist.querySelectorAll('.nm-empty').forEach(function(e) { e.remove(); });
    hist.innerHTML = _noteItemHtml(entry) + hist.innerHTML;
    hist.scrollTop = 0;
  }
  _noteAddFlight = true;
  var _done = function() { input.disabled = false; _noteAddFlight = false; };
  if (_modalApptId && _modalOffice !== CFG.officeId) {
    // Cross-office (activator dashboard): route to the appointment's own office via the
    // scheduler; update the dashboard's cached notes + count badge (not DATA.notes).
    if (typeof _MYAPPT !== 'undefined' && _MYAPPT.appointments) {
      var ap = _MYAPPT.appointments.filter(function(x){ return x.appointmentId === _modalApptId; })[0];
      if (ap) { ap.notes = ap.notes || []; ap.notes.push(entry);
        // Recount through the same helper the row uses, so the booking note keeps
        // being counted instead of being dropped on the first add.
        var mb = document.getElementById('manote-' + _modalApptId);
        if (mb) mb.textContent = ' ' + (typeof _dashNotesCount === 'function' ? _dashNotesCount(ap) : ap.notes.length); }
    }
    _apptPost({ action:'addAppointmentNote', appointmentId:_modalApptId, noteText:text, noteType:noteType, linesActivated:lines, email:SESSION.email, authorName:SESSION.name||SESSION.email }).then(_done).catch(_done);
  } else {
    if (!DATA.notes) DATA.notes = {};
    if (!DATA.notes[_modalDsi]) DATA.notes[_modalDsi] = [];
    DATA.notes[_modalDsi].push(entry);
    var noteCount = document.getElementById('nc-'+_modalDsi.replace(/\W/g,'_'));
    if (noteCount) noteCount.textContent = DATA.notes[_modalDsi].length;
    apiPost({ action:'addNote', dsi:_modalDsi, noteText:text, noteType:noteType, linesActivated:lines, clientKey:_clientKey('note'), authorEmail:SESSION.email, authorName:SESSION.name||SESSION.email }).then(_done).catch(_done);
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
    // ⚠ Stand down entirely until notes exist. Filtering on "days since last call" before we
    //   know it would hide rows on evidence we do not have — 'never' would match everything and
    //   the other three would match nothing.
    if (_activeFilters.lastCalled && (typeof _NOTES_LOADED === 'undefined' || _NOTES_LOADED)) {
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
// Has the customer asked to cancel? Reads the same 'cancel' notes the notes-modal
// spotlight and the Daily Report use, so all three agree by construction.
function _hasCancelRequest(dsi) {
  return ((DATA.notes||{})[dsi]||[]).some(function(n){ return n.noteType === 'cancel'; });
}
// The most recent cancel reason, for the flag's tooltip — the flag is only useful if
// it says WHY without making you open the order.
function _cancelReasonFor(dsi) {
  var c = _notesNewestFirst(((DATA.notes||{})[dsi]||[]).filter(function(n){ return n.noteType === 'cancel'; }));
  if (!c.length) return '';
  return _cancelParse(c[0].noteText).reason || '';
}
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

// The NOTES button. Pass dsi / customer / rep as data-* attributes (safe in an
// attribute) and read them back in JS — NEVER interpolate them into an inline
// onclick JS string, or a name with an apostrophe (e.g. "Bri'an Key") breaks the
// handler: esc() encodes ' as &#39;, the browser decodes it back to ' inside the
// attribute, and that prematurely closes the JS string → the button does nothing.
/* ⚠⚠ "NOT LOADED YET" MUST NOT RENDER AS "NO NOTES" — the same rule _NOTES_LOADED already
   enforces for _daysSinceLastNote and the lastCalled filter. Notes arrive on their own fetch,
   so between first paint and that response every button would otherwise show the bare NOTES
   pill: byte-for-byte identical to a record with nothing saved. That is the ONE question this
   button exists to answer, and a confident wrong answer is worse than an honest "…".
   🔑 Cleared by _applyNoteCounts on the first arrival — it drops the pill and the class. */
function _notesPending() {
  return (typeof _NOTES_LOADED !== 'undefined' && !_NOTES_LOADED);
}
/* ONE implementation of what an EMPTY notes list says, shared by the modal's first render and
   its live refresh. Two copies would drift, and the drift would land in the exact place a rep
   goes to check whether their note saved. */
function _notesEmptyHtml(kind) {
  return '<div class="nm-empty">' + (_notesPending() ? 'Loading notes…' : 'No ' + kind + ' notes yet.') + '</div>';
}
function notesBtnHtml(dsi, customer, rep, noteCount) {
  var safeId = String(dsi||'').replace(/\W/g,'_');
  var pending = noteCount > 0 ? false : _notesPending();
  return '<button class="notes-btn'+(noteCount>0?' has-notes':'')+(pending?' notes-pending':'')+'" ' +
    'data-dsi="'+esc(dsi)+'" data-customer="'+esc(customer||'')+'" data-rep="'+esc(rep||'')+'" ' +
    (pending?'title="Notes still loading" ':'') +
    'onclick="openNotesFromEl(this)">NOTES' +
    (noteCount>0?'<span class="notes-count" id="nc-'+safeId+'">'+noteCount+'</span>'
               : pending?'<span class="notes-count notes-count-pending" id="nc-'+safeId+'" aria-label="Notes still loading">…</span>':'') +
    '</button>';
}
function openNotesFromEl(el) {
  if (!el) return;
  openNotesModal(el.getAttribute('data-dsi')||'', el.getAttribute('data-customer')||'', el.getAttribute('data-rep')||'');
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
    var cxCancel=_hasCancelRequest(dsi);
    // Cancel outranks both for the row tint: an order the customer is trying to leave
    // is the most urgent thing a row can say about itself.
    var rowCls = cxCancel ? ' class="ct-row-cancel"' : (rotting ? ' class="ct-row-rotting"' : (atrisk ? ' class="ct-row-atrisk"' : ''));
    var flags='';
    // NOT gated on _ctShowRiskFlags. That flag suppresses Rotting/At-risk on the No
    // Answer and Escalations tabs because those tabs ARE that risk list — but a cancel
    // request is separate information those tabs don't otherwise surface at all.
    if (cxCancel) {
      var _cxr=_cancelReasonFor(dsi);
      flags+='<span class="ct-flag ct-flag-cancel" title="Customer requested to cancel'+(_cxr?' · '+esc(_cxr):'')+'">'+icon('issues')+' Cancel requested</span>';
    }
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
      '<td>' + notesBtnHtml(dsi, o.spe, o.rep, noteCount) + '</td>' +
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

// ── MY TEAM'S ORDERS — grouped by team ────────────────────────────────────
// For a parent leader whose team has sub-teams split off it: show EVERYONE on
// those teams' orders, cleanly SEPARATED into one collapsible section per team
// (own team first). A leader with no sub-teams keeps the plain renderCallTable
// path, so nothing changes for them.
//
// Own-team orders are already in DATA.masterTracker; sub-team orders auto-load
// from readTeamOrders (per-team, cached in _TM_ORDERS) and re-render as they
// arrive via _mtoRerenderIfActive. Office-wide roles (jd/manager) have the whole
// office in masterTracker, so nothing is fetched and no section shows "loading".
function _mtoHeaders() {
  return '<th>Name</th><th>DSI</th><th>Date</th><th>Product</th><th>Status</th><th>Appointment</th><th>Rating</th><th>Notes</th>';
}
// Per-team filter state + the full (unfiltered) orders for each section this
// render. Both are keyed by teamId so every team section filters INDEPENDENTLY.
var _MTO_F = {};            // teamId -> { q, status, product, from, to }
var _MTO_TEAM_ORDERS = {};  // teamId -> orders[] (repopulated each full render)

function _mtoFEmpty() { return { q:'', status:'', product:'', from:'', to:'' }; }
function _mtoFilterOrders(orders, f) {
  if (!f) return orders;
  var q = (f.q||'').toLowerCase();
  return orders.filter(function(o) {
    if (f.status  && !((o.statusCounts ||{})[f.status]))  return false;
    if (f.product && !((o.productCounts||{})[f.product])) return false;
    var od = String(o.orderDate||'').slice(0,10);
    if (f.from && od < f.from) return false;
    if (f.to   && od > f.to)   return false;
    if (q) {
      var hay = ((o.rep||'')+' '+(o.dsi||'')+' '+(o.orderDate||'')+' '+
        Object.keys(o.statusCounts||{}).join(' ')+' '+Object.keys(o.productCounts||{}).join(' ')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}
function _mtoFilteredRows(tid) {
  var all = _MTO_TEAM_ORDERS[tid] || [];
  return _mtoFilterOrders(all, _MTO_F[tid]).slice().sort(_byOrderDateDesc);
}
function _mtoTbodyHtml(tid) {
  var rows = _mtoFilteredRows(tid);
  return rows.length ? callTableRows(rows, null)
    : '<tr><td colspan="8" style="text-align:center;padding:16px;color:var(--text2)">No orders match these filters.</td></tr>';
}
function _mtoCountText(tid) {
  var total = (_MTO_TEAM_ORDERS[tid]||[]).length, shown = _mtoFilteredRows(tid).length;
  return shown === total ? (total + ' order' + (total===1?'':'s')) : ('Showing ' + shown + ' of ' + total);
}
// Live re-filter of a single team section — rebuilds just its tbody + count.
function _mtoApply(tid) {
  var tb = document.getElementById('mto-tbody-'+tid); if (tb) tb.innerHTML = _mtoTbodyHtml(tid);
  var ct = document.getElementById('mto-cnt-'+tid);   if (ct) ct.textContent = _mtoCountText(tid);
}
function _mtoFSet(tid, field, val) {
  (_MTO_F[tid] = _MTO_F[tid] || _mtoFEmpty())[field] = val;
  _mtoApply(tid);
}
function _mtoFClear(tid) {
  _MTO_F[tid] = _mtoFEmpty();
  var mid = _myTeamId(); if (!mid) return;                 // full re-render to reset the input fields
  var c = document.getElementById('main-content'); if (c) c.innerHTML = renderMyTeamGrouped(mid);
}
function _mtoFilterRow(tid) {
  var all = _MTO_TEAM_ORDERS[tid] || [], f = _MTO_F[tid] || _mtoFEmpty();
  var stats = {}, prods = {};
  all.forEach(function(o){
    Object.keys(o.statusCounts ||{}).forEach(function(s){ if(s) stats[s]=1; });
    Object.keys(o.productCounts||{}).forEach(function(p){ if(p) prods[p]=1; });
  });
  var statOpts = '<option value="">All statuses</option>'+Object.keys(stats).sort().map(function(s){ return '<option'+(f.status===s?' selected':'')+' value="'+esc(s)+'">'+esc(s)+'</option>'; }).join('');
  var prodOpts = '<option value="">All products</option>'+Object.keys(prods).sort().map(function(p){ return '<option'+(f.product===p?' selected':'')+' value="'+esc(p)+'">'+esc(p)+'</option>'; }).join('');
  var any = f.q||f.status||f.product||f.from||f.to;
  var cS = 'width:auto;min-width:130px;max-width:190px';
  return '<div class="mto-filters">' +
    '<input class="ps-input" style="'+cS+'" type="text" placeholder="Search rep / DSI…" value="'+esc(f.q)+'" oninput="_mtoFSet(\''+tid+'\',\'q\',this.value)">' +
    '<select class="ps-select" style="'+cS+'" onchange="_mtoFSet(\''+tid+'\',\'status\',this.value)">'+statOpts+'</select>' +
    '<select class="ps-select" style="'+cS+'" onchange="_mtoFSet(\''+tid+'\',\'product\',this.value)">'+prodOpts+'</select>' +
    '<input class="ps-input" style="'+cS+'" type="date" value="'+esc(f.from)+'" onchange="_mtoFSet(\''+tid+'\',\'from\',this.value)" title="From date">' +
    '<input class="ps-input" style="'+cS+'" type="date" value="'+esc(f.to)+'" onchange="_mtoFSet(\''+tid+'\',\'to\',this.value)" title="To date">' +
    (any?'<button class="lst-toggle-btn" onclick="_mtoFClear(\''+tid+'\')">Clear</button>':'') +
    '</div>';
}
function renderMyTeamGrouped(myTeamId) {
  _tmEnsureAllOrders(myTeamId);                         // auto-load every sub-team's orders
  _ctShowRiskFlags = true; _ISSUE_DSI = null;           // same risk/booked wiring renderCallTable uses
  if (_BOOKED_MAP === null) _loadBookedAppts();
  _MTO_TEAM_ORDERS = {};                                // rebuilt below; drop last render's teams
  var teams = DATA.teams || {}, roster = DATA.roster || {};
  var ids = _tmEffectiveTeamIds(myTeamId).slice().sort(function(a, b) {
    if (a === myTeamId) return -1; if (b === myTeamId) return 1;   // own team first
    return String(teams[a] ? teams[a].name : '').localeCompare(String(teams[b] ? teams[b].name : ''));
  });
  var pool = _tmCombinedOrders(myTeamId);
  var totalOrders = 0, anyPending = false;
  var sections = ids.map(function(id) {
    var t = teams[id]; if (!t) return '';
    var tabs = Object.keys(roster)
      .filter(function(e){ return !roster[e].deactivated && roster[e].team === t.name; })
      .map(function(e){ return (roster[e].tableauName||'').toLowerCase(); }).filter(Boolean);
    var pending = _tmOrdersPending(id);
    var orders = pending ? [] : pool.filter(function(o){ return tabs.indexOf((o.rep||'').toLowerCase()) !== -1; }).slice().sort(_byOrderDateDesc);
    _MTO_TEAM_ORDERS[id] = orders;                       // full set for this section's filter
    if (pending) anyPending = true; else totalOrders += orders.length;
    var isSelf = (id === myTeamId);
    var body;
    if (pending) {
      body = loadingState('Loading ' + t.name + ' orders…', { icon:'myorders', bare:true });
    } else if (!orders.length) {
      body = noData('No orders for this team.', { icon:'myorders', bare:true });
    } else {
      body = _mtoFilterRow(id) +
        '<div class="call-table-wrap"><table class="call-table" id="mto-tbl-'+id+'"><thead><tr>'+_mtoHeaders()+'</tr></thead>' +
        '<tbody id="mto-tbody-'+id+'">'+_mtoTbodyHtml(id)+'</tbody></table></div>' +
        '<div class="tbl-count" id="mto-cnt-'+id+'" style="margin-top:6px">'+_mtoCountText(id)+'</div>';
    }
    var cntTxt = pending ? '…' : (orders.length + ' order' + (orders.length===1?'':'s'));
    return '<details class="mto-team" open>' +
      '<summary class="mto-team-hdr'+(isSelf?' mto-self':'')+'">' +
        '<span class="mto-caret">'+icon('chev-right')+'</span>' +
        '<span class="mto-emoji">'+(t.emoji||'👥')+'</span>' +
        '<span class="mto-name">'+esc(t.name)+'</span>' +
        (isSelf?'<span class="tm-role-tag" style="margin-left:6px">(your team)</span>':'') +
        '<span class="mto-count">'+cntTxt+'</span>' +
      '</summary>' +
      '<div class="mto-body">'+body+'</div>' +
    '</details>';
  }).join('');
  var countLbl = (anyPending ? totalOrders+'+' : totalOrders) + ' orders · ' + ids.length + ' teams';
  return _tableauWarnBanner() +
    '<div class="card"><div class="card-header dark">My Team&rsquo;s Orders &nbsp;' +
    '<span style="font-weight:400;font-size:.82rem;opacity:.8">'+countLbl+'</span></div>' +
    '<div class="card-body">'+sections+'</div></div>';
}
// A sub-team's orders just landed — refresh the grouped view if it's the one on
// screen and the team belongs to it.
function _mtoRerenderIfActive(teamId) {
  if (CURRENT_TAB !== 'myteam') return;
  var mid = _myTeamId(); if (!mid) return;
  if (_tmEffectiveTeamIds(mid).indexOf(teamId) === -1) return;
  var c = document.getElementById('main-content');
  if (c) c.innerHTML = renderMyTeamGrouped(mid);
}


// ── ACTIVATION SUPPORT (Pending / Activation sheets · Date → Rep → Product → Status) ──
// One tab, two toggled pages. Pending = only lines NOT yet Active/Posted/Cancelled/
// Disconnected (from masterTracker). Activation = every line, every status (master ∪
// completed). Both role-scoped via repFilter. Also shows the auto-email "last sent" badge.
var _asPage = 'pending';        // 'pending' | 'activation'
var _AS_STATUS = null;          // cached readAutoEmailStatus result (global, not per-office)
var _asStatusFlight = false;
var _AS_STATUS_ERR = false;     // last fetch failed → show a retry instead of a stuck "Loading…"

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
// Why a rep on the roster did NOT get an email. The first two are failures; the next two
// are roster data the office can fix (and the reason a rep can NEVER receive one). The
// rest are expected and come back as counts only — see AS_NAMED_REASONS in Code.gs.
var _AS_REASON = {
  error:         { label:'Send failed',                          tone:'bad'  },
  quota:         { label:'Dropped — daily email quota ran out',  tone:'bad'  },
  noTableauName: { label:'No Tableau name linked in the roster', tone:'warn' },
  noOrders:      { label:'Tableau name matches no orders',       tone:'warn' }
};
var _AS_SKIP_LABEL = {
  noProduction:   'no production in the last 14 days',
  nothingToShow:  'nothing to show — all caught up',
  staffNoTableau: 'office staff (no Tableau name — expected)',
  staffNoOrders:  'office staff (no orders — expected)',
  deactivated:    'deactivated'
};
var _AS_DETAIL_OPEN = { pending:false, activation:false };

function _asToggleDetail(type){
  if(type!=='pending' && type!=='activation') return;
  _AS_DETAIL_OPEN[type] = !_AS_DETAIL_OPEN[type];
  _asPaintSignifier();
}
// The expanded per-run breakdown: named non-recipients grouped by reason, then the
// expected skips as a single counts line.
function _asDetailPanel(type, d){
  if(!d.hasDetail){
    return '<div style="padding:8px 0 10px 138px;font-size:.8rem;color:var(--text2)">'+
      'This run finished before the breakdown was recorded, so there is no per-rep detail for it. '+
      'The next send will have one.</div>';
  }
  // The run refused to start because it would have sent from the personal Google account.
  if(d.aborted){
    return '<div style="padding:8px 0 10px 138px;font-size:.82rem;color:var(--red)">'+
      '<b>Run aborted — nothing was sent.</b> The office mail relay is not configured, so these '+
      'would have gone out from the personal portal account instead of ActivationSupport@AspireQc.com.</div>';
  }
  var people=d.people||[], groups={}, order=[];
  people.forEach(function(p){
    var r=_AS_REASON[p.r]?p.r:'error';
    if(!groups[r]){ groups[r]=[]; order.push(r); }
    groups[r].push(p);
  });
  order.sort(function(a,b){                                     // failures first, then fixable
    var w={error:0,quota:1,noTableauName:2,noOrders:3};
    return (w[a]==null?9:w[a]) - (w[b]==null?9:w[b]);
  });
  var out='';
  order.forEach(function(r){
    var meta=_AS_REASON[r], list=groups[r];
    var col = meta.tone==='bad' ? 'var(--red)' : 'var(--yellow)';
    out+='<div style="margin:8px 0 2px">'+
      '<div style="font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:'+col+'">'+
        esc(meta.label)+' ('+list.length+')</div>'+
      list.map(function(p){
        var office=(typeof OFFICE_NAMES!=='undefined'&&OFFICE_NAMES[p.o])||p.o;
        return '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:3px 0 3px 2px;font-size:.82rem;border-bottom:1px solid var(--border)">'+
          '<span style="font-weight:600;min-width:150px">'+esc(p.n||p.e||'—')+'</span>'+
          '<span style="color:var(--text2);min-width:104px">'+esc(office)+'</span>'+
          (p.d?'<span style="color:var(--text2);flex:1;min-width:180px">'+esc(p.d)+'</span>':'')+
        '</div>';
      }).join('')+
    '</div>';
  });
  if(!order.length){
    out+='<div style="padding:6px 0;font-size:.83rem;color:var(--green)">'+
      'Everyone who qualified got their email — nothing failed and no roster gaps.</div>';
  }
  if(d.truncated){
    out+='<div style="padding:6px 0 0;font-size:.78rem;color:var(--text2)">'+
      '+ '+d.truncated+' more not listed (the run log caps how many it stores).</div>';
  }
  var skips=d.skips||{}, parts=[];
  Object.keys(_AS_SKIP_LABEL).forEach(function(k){ if(skips[k]) parts.push(skips[k]+' '+_AS_SKIP_LABEL[k]); });
  if(parts.length){
    out+='<div style="padding:8px 0 2px;font-size:.78rem;color:var(--text2)">'+
      '<b>Not sent for expected reasons:</b> '+esc(parts.join(' · '))+'</div>';
  }
  // Which account these actually went out from — the relay means the Workspace mailbox.
  var sn=d.sender;
  if(sn && (sn.relay||sn.direct)){
    out += sn.direct
      ? '<div style="padding:6px 0 2px;font-size:.78rem;color:var(--red)"><b>⚠ '+sn.direct+
        ' sent from the personal portal account</b>'+(sn.relay?(' · '+sn.relay+' via the relay'):'')+
        ' — the relay should be handling every send.</div>'
      : '<div style="padding:6px 0 2px;font-size:.78rem;color:var(--text2)">Sent from '+
        '<b>ActivationSupport@AspireQc.com</b> via the office mail relay.</div>';
  }
  return '<div style="padding:2px 0 8px 138px">'+out+'</div>';
}
function _asRenderSignifier(){
  var s=_AS_STATUS;
  function row(type,label,day){
    var d=s&&s[type], body, expandable=false, open=_AS_DETAIL_OPEN[type];
    if(!s && _AS_STATUS_ERR){ body='<span style="color:var(--text2)">Couldn’t load send status · <a href="#" onclick="_asReloadStatus();return false">retry</a></span>'; }
    else if(!s){ body='<span style="color:var(--text2)">Loading…</span>'; }
    else if(!d){ body='<span style="color:var(--text2)">No send recorded yet</span>'; }
    else {
      expandable=true;
      var when=d.ts?new Date(d.ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):(d.date||'');
      var statusGlyph=d.ok?icon('completed'):icon('issues');
      var detail=d.sent+' sent'+(d.qualifying?(' / '+d.qualifying+' qualified'):'')+(d.failed?(' · '+d.failed+' failed'):'')+(d.quotaHit?' · quota hit':'');
      var flagged=(d.people||[]).length+(d.truncated||0);
      var tail = !d.hasDetail
        ? '<span style="color:var(--text2)">· no breakdown</span>'
        : (flagged
            ? '<span style="color:var(--yellow);font-weight:600">· '+flagged+' need'+(flagged===1?'s':'')+' attention</span>'
            : '<span style="color:var(--text2)">· none missed</span>');
      body=statusGlyph+' Last sent <b>'+esc(when)+'</b> &nbsp;·&nbsp; '+esc(detail)+' &nbsp;'+tail;
    }
    var caret = expandable
      ? '<span style="display:inline-block;opacity:.55;font-size:.66rem;transition:transform .12s ease'+(open?';transform:rotate(90deg)':'')+'">'+icon('chev-right')+'</span>'
      : '<span style="width:9px;display:inline-block"></span>';
    return '<div '+(expandable?'onclick="_asToggleDetail(\''+type+'\')" title="Click to see who did not get one" style="cursor:pointer;':'style="')+
        'display:flex;align-items:center;gap:10px;padding:6px 0;flex-wrap:wrap">'+
      caret+
      '<span style="font-weight:700;min-width:118px">'+esc(label)+'</span>'+
      '<span style="font-size:.78rem;color:var(--text2);min-width:132px">Auto-sends '+esc(day)+' · 6pm PT</span>'+
      '<span style="font-size:.84rem">'+body+'</span>'+
    '</div>'+
    (expandable && open ? _asDetailPanel(type, d) : '');
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
function _asPaintSignifier(){
  if(CURRENT_TAB!=='actsupport') return;
  var sc=document.getElementById('as-signifier'); if(sc) sc.innerHTML=_asRenderSignifier();
}
// Fetched once per session and cached — the badge tracks a WEEKLY send, so re-pulling on
// every page toggle is pointless load now that every rep opens this tab. `force` is the
// retry link. A failure sets _AS_STATUS_ERR so the row offers a retry instead of hanging
// on "Loading…" forever.
function _asFetchStatus(force){
  if(_asStatusFlight) return;
  if(_AS_STATUS && !force) return;
  _asStatusFlight=true; _AS_STATUS_ERR=false;
  var _reqOffice = CFG.officeId;
  api({action:'readAutoEmailStatus'}).then(function(res){
    _asStatusFlight=false;
    // Office guard. ⚠ flight flag cleared above the return, or this never fetches again.
    if (CFG.officeId !== _reqOffice) return;
    if(res && !res.error) _AS_STATUS=res; else _AS_STATUS_ERR=true;
    _asPaintSignifier();
  }).catch(function(){ _asStatusFlight=false; _AS_STATUS_ERR=true; _asPaintSignifier(); });
}
function _asReloadStatus(){ _AS_STATUS_ERR=false; _asPaintSignifier(); _asFetchStatus(true); }
function renderActivationSupport(){
  var c=document.getElementById('main-content');
  c.innerHTML=_asShell();
  _asFetchStatus(false);
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
  var _reqOffice = CFG.officeId;
  api({ action:'readTrainingOrders' }).then(function(res) {
    _trFlight = false;
    // Office guard. ⚠ _trFlight cleared above the return, or Training wedges on "Loading…".
    if (CFG.officeId !== _reqOffice) return;
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
/* Warm the Training cache in the background after login, for anyone who can SEE the tab.
   ⚠ This tracks the VIEW set (ROLES_TRAINING), not the edit set — it was ROLES_PAYROLL, which
   2026-08-30 stopped meaning "can see Training" and now only means "can mark paid". Left on the
   old constant this would have silently skipped the warm-up for the four newly-added roles. */
function _preloadTraining() {
  if (_TRAINING_ORDERS !== null || _trFlight) return;
  if (ROLES_TRAINING.indexOf(SESSION.role) === -1) return;
  _trFlight = true;
  var _reqOffice = CFG.officeId;
  api({ action:'readTrainingOrders' }).then(function(res) {
    _trFlight = false;
    // Office guard — a background warm-up must never seed another office's training orders.
    if (CFG.officeId !== _reqOffice) return;
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
    var _reqOffice = CFG.officeId;
    api({ action:'readTrainingOrders' }).then(function(res) {
      _trFlight = false;
      /* Office guard. This 30s poller is the likeliest of the three to straddle a switch,
         because it keeps firing while the user navigates. */
      if (CFG.officeId !== _reqOffice) return;
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
    /* 🔒 Four roles gained the Training tab 2026-08-30 but NOT the right to mark a payout paid.
       They see the paid state read-only; the boundary is `saveTrainingPaid` on the backend and
       a disabled checkbox is only the courtesy half of it. */
    var _trRO = ROLES_PAYOUT_EDIT.indexOf(SESSION.role) === -1;
    var _dis = _trRO ? ' disabled' : '';
    var paid = '<div class="tr-paid"' + (_trRO ? ' title="Read-only — only Master Admin, Owner and Admin can mark a payout paid"' : '') +
      '><label class="tr-all"><input type="checkbox" ' + (allChecked?'checked':'') + (items.length && !_trRO ? '' : ' disabled') + ' onchange="_trToggleAll(' + idx + ',this.checked)"> ALL</label>';
    items.forEach(function(it) {
      paid += '<label><input type="checkbox" ' + (po[it.id]?'checked':'') + _dis + ' onchange="_trToggleItem(' + idx + ',\'' + esc(it.id) + '\',this.checked)"> ' + esc(it.label) + '</label>';
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

/* A disabled checkbox fires no onchange, so these guards are for the case where one is
   re-enabled by hand. `saveTrainingPaid` would refuse the write anyway — but WITHOUT this the
   local object is mutated and repainted BEFORE the refusal comes back, leaving a ticked box
   that never persisted. That is the optimistic-repaint trap that hid a backend rejection once
   already (changelog 2026-07-31): never paint a state the server has not agreed to. */
function _trCanEditPayout() { return ROLES_PAYOUT_EDIT.indexOf(SESSION.role) !== -1; }

function _trToggleItem(idx, itemId, checked) {
  var o = (_TRAINING_ORDERS||[])[idx]; if (!o) return;
  if (!_trCanEditPayout()) { _trRenderRows(); return; }
  if (!o.paidOut) o.paidOut = {};
  if (checked) o.paidOut[itemId] = true; else delete o.paidOut[itemId];
  _trSave(o);
  _trRenderRows();
}

function _trToggleAll(idx, checked) {
  var o = (_TRAINING_ORDERS||[])[idx]; if (!o) return;
  if (!_trCanEditPayout()) { _trRenderRows(); return; }
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
/* Returns: a NUMBER of days · null = genuinely never called · undefined = NOT YET KNOWN.
   ⚠⚠ The third case is new and load-bearing. `notes` is fetched after the main blob now, so
   between first paint and its arrival we do not know when anyone was last called. Returning
   null there would print "Never" on every row and make the lastCalled filter act on a table it
   cannot yet judge. Callers must treat undefined as "no opinion", not as "never". */
function _daysSinceLastNote(dsi) {
  if (typeof _NOTES_LOADED !== 'undefined' && !_NOTES_LOADED) return undefined;
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
  if (days === undefined) {
    // Notes have not arrived yet — say nothing rather than "Never". A dash reads as
    // "unknown"; "Never" reads as a fact, and a rep would work the list off it.
    label = '·';
    style = 'background:var(--control-bg);color:#666';
  } else if (days === null) {
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

// Posted AND Approved. _statusClass already renders them as the same green 'sp-posted'
// pill, so on screen they were indistinguishable — excluding one and not the other read
// as a bug. Both mean the line is finished and doesn't need a call.
function _isPostedStatus(s) {
  var l = String(s || '').trim().toLowerCase();
  return l === 'posted' || l === 'approved';
}

// Strips Posted lines off one order for the No Answer log — a posted line is finished
// work and doesn't need a call. Returns null when NOTHING survives (the whole order is
// posted → drop the row), and the untouched order when nothing was posted.
// Rebuilds productCounts/statusCounts from the survivors so the row's breakdown shows
// only what's still open, rather than still advertising "Posted x2".
// Partly-posted orders are KEPT: if 2 of 3 lines are posted, that third line still
// needs the call, and dropping the order would hide real work.
function _withoutPostedLines(o) {
  var lines = _asLinesOf(o);                       // real o.lines when the backend sent them
  var kept = lines.filter(function(l) { return !_isPostedStatus(l.status); });
  if (!kept.length) return null;
  if (kept.length === lines.length) return o;      // nothing posted → leave it alone
  var clone = {};
  for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) clone[k] = o[k];
  var pc = {}, sc = {};
  kept.forEach(function(l) {
    var p = l.product || 'Other', s = l.status || 'Null';
    pc[p] = (pc[p] || 0) + 1;
    sc[s] = (sc[s] || 0) + 1;
  });
  clone.productCounts = pc; clone.statusCounts = sc; clone.lines = kept;
  return clone;
}

// No Answer order list (shared by the renderer + background soft-refresh).
// Never-called first, then longest-overdue first; within the 29-day window; Posted
// lines excluded.
function _noAnswerOrders() {
  var ratings = DATA.ratings || {};
  var dsis = Object.keys(ratings).filter(function(dsi) { return ratings[dsi]==='No Answer'; });
  var lookup = buildOrderLookup();
  var orders = dsis.map(function(dsi) {
    var o = lookup[dsi];
    // No order record (aged out of the Tableau window) → a placeholder with no real
    // date, which within29Days now correctly rejects instead of always admitting.
    var base = o ? o : { dsi:dsi, rep:'—', spe:'', productType:'—', orderDate:'', dtrStatus:'—' };
    base._daysSince = _daysSinceLastNote(dsi);
    return base;
  });
  orders = within29Days(orders).map(_withoutPostedLines).filter(Boolean);
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
// The 29-day window from the No Answer log — and ONLY the window.
// ⚠ Status is deliberately NOT filtered here. Unlike No Answer ("this order needs a
// call", where a posted line is finished work), an escalation is the customer's 1–2★
// rating: it still stands after the order posts, so every rated order in the window
// shows with all of its lines and its real status. Don't add _withoutPostedLines here.
function _escalationOrders() {
  var ratings = DATA.ratings || {};
  var dsis = Object.keys(ratings).filter(function(dsi) { return ratings[dsi]==='1 Star'||ratings[dsi]==='2 Stars'; });
  var lookup = buildOrderLookup();
  var orders = dsis.map(function(dsi) {
    var o = lookup[dsi];
    // No order record (aged out of the Tableau window) → a placeholder with no real
    // date, which within29Days rejects. Mirrors _noAnswerOrders: '—' would compare
    // GREATER than any date string and sneak the stalest rows through.
    return o ? o : { dsi:dsi, rep:'—', spe:'', productType:'—', orderDate:'', dtrStatus:'—' };
  });
  orders = within29Days(orders);
  orders.sort(_byOrderDateDesc);   // default: newest order first
  return orders;
}

function renderEscalationsTable() {
  var ratings = DATA.ratings || {};
  if (!Object.keys(ratings).some(function(dsi) { return ratings[dsi]==='1 Star'||ratings[dsi]==='2 Stars'; })) return noData('No escalations yet.', {icon:'escalations', sub:'Orders rated 1 or 2 Stars will appear here.'});
  var orders = _escalationOrders();
  // Ratings exist but every one of them fell outside the window. Without this the tab
  // renders an empty table headed "0 orders", which reads as broken rather than as
  // "nothing recent".
  if (!orders.length) return noData('No escalations in the last 29 days.',
    {icon:'escalations', sub:'Older 1–2★ orders are outside the window.'});
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

/* Churn sort — see the ROW ORDER block at the top of this file. Column ids are the bucket
   strings themselves (they are the repMap keys); 'total' sums every bucket; 'rep' is A–Z.
   ⚠ Re-renders through renderChurn(), NOT refreshChurn(): refreshChurn reads DATA.churnReport
   unscoped and is only ever reached from the admin-tier rep dropdown. Going through renderChurn
   keeps a leader's team scope and a client-rep's own-row scope intact. The dropdown value is
   carried across so an admin's rep filter survives the click. */
function _chSortBy(col) {
  _CH_SORT = _rateNextSort(_CH_SORT, col);
  var sel = document.getElementById('churn-rep-sel'), v = sel ? sel.value : '';
  var c = document.getElementById('main-content'); if (!c) return;
  c.innerHTML = renderChurn();
  if (v) { var s2 = document.getElementById('churn-rep-sel'); if (s2) { s2.value = v; refreshChurn(); } }
}
function _chSortedReps(repList, repMap) {
  var s = _CH_SORT;
  function k(rep) {
    var m = repMap[rep] || {}, td = 0, ta = 0;
    CHURN_BUCKETS.forEach(function(b) { var r = m[b]; if (r) { td += r.disconnects || 0; ta += r.activated || 0; } });
    if (s.col === 'total') return [td, ta ? td / ta : 0, ta];
    var d = 0, a = 0, r1 = m[s.col]; if (r1) { d = r1.disconnects || 0; a = r1.activated || 0; }
    /* lines churned, then percent, then ACTIVATED lines — so the reps with sales and no churn
       (user, 2026-09-04: "reps who have sales but no churn [need] to be sorted as well") rank
       by how much they sold rather than by name — then the totals across buckets. */
    return [d, a ? d / a : 0, a, td, ta];
  }
  return repList.slice().sort(function(x, y) {
    if (s.col === 'rep') return s.dir * x.localeCompare(y);
    var c = _rateCmp(k(x), k(y));
    return c ? s.dir * c : x.localeCompare(y);
  });
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
    if (!d) return '<td class="ar-cell"><span class="ar-badge ar-none">—</span></td>';
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
    if (!acts) return '<td class="ar-cell"><span class="ar-badge ar-none">—</span></td>';
    var pct = disco/acts*100;
    var pctR = Math.round(pct*10)/10;
    var cls = churnTotalCls(bkt, pct, pctR);
    return '<td class="ar-cell"><span class="ar-badge '+cls+'">('+fmtN(disco)+'/'+fmtN(acts)+')<br>'+pct.toFixed(1)+'%</span></td>';
  }
  var order = _chSortedReps(repList, repMap);
  var sortable = order.length > 1;
  var CH_COLS = [['rep','Rep']].concat(CHURN_BUCKETS.map(function(b) { return [b, esc(b)]; }));
  var hdr = _rateTh('rep', 'Rep', sortable, _CH_SORT, '_chSortBy', 'min-width:160px') +
    CHURN_BUCKETS.map(function(b){ return _rateTh(b, esc(b), sortable, _CH_SORT, '_chSortBy', 'min-width:110px'); }).join('');
  var grandRow = '<tr class="ar-grand-row"><td class="ar-rep ar-grand-rep">Grand Total</td>'+CHURN_BUCKETS.map(totalCell).join('')+'</tr>';
  var repRows = order.map(function(rep){
    return '<tr><td class="ar-rep">'+esc(rep)+'</td>'+CHURN_BUCKETS.map(function(bkt){return cell(repMap[rep][bkt]);}).join('')+'</tr>';
  }).join('');
  return (sortable ? _rateSortCaption(_CH_SORT, CH_COLS, 'lines churned') : '') +
    '<div class="tbl-wrap"><table><thead><tr>'+hdr+'</tr></thead><tbody>'+grandRow+repRows+'</tbody></table></div>';
}

/* Expand the identity-free `churnAgg` into the (repList, repMap) shape `_churnTableHtml`
   already consumes, so the office GRAND TOTAL and Tableau's colour calibration survive now that
   `DATA.churnReport` is scoped per badge.
   🔑 EACH AGG ROW BECOMES ITS OWN OPAQUE "rep". That is safe because the gt arguments are only
   ever SUMMED and sampled for colour — never rendered as rows — so one bucket per synthetic rep
   produces identical totals and an identical rate distribution.
   ⚠ Returns null when the backend has not been redeployed yet; every caller falls back to the
   rows it already had, which is the pre-2026-08-30 behaviour rather than a blank total. */
function _churnAggBuilt() {
  var agg = (typeof DATA !== 'undefined' && DATA) ? DATA.churnAgg : null;
  if (!agg || !agg.length) return null;
  var repMap = {}, repList = [];
  agg.forEach(function(r, i) {
    if (!r || CHURN_BUCKETS.indexOf(r.bucket) === -1) return;
    var k = ' agg' + i;                 // cannot collide with a real Tableau name
    repMap[k] = {}; repMap[k][r.bucket] = r; repList.push(k);
  });
  return repList.length ? { repMap: repMap, repList: repList } : null;
}

function renderChurn() {
  var rows = DATA.churnReport || [];
  if (!rows.length) return noData('No churn data yet.', {icon:'churn', sub:'Tableau sync runs nightly — check back soon.'});
  var role = SESSION.role || 'client-rep';
  var isTeamRole = role === 'leader';   // jd is office-wide (manager-equivalent)
  if (isTeamRole) {
    /* Teams they LEAD **plus everything beneath them** — the same roll-up `_scopeOrders`,
       `_teamScopeEmails` and `readTeamOrdersScoped` use. Until 2026-08-30 this called
       `_myTeam()` + `_teamTableauNames(one team)`, so Churn and Activation Rates were the last
       two places a leader stayed FLAT while every other surface rolled up. */
    var churnTns = _leaderTeamTableauNames();
    if (churnTns.length) {
      var teamRows = rows.filter(function(r) { return churnTns.indexOf((r.rep || '').trim().toLowerCase()) !== -1; });
      var built = _buildChurnRepMap(teamRows, '');
      return '<div class="card"><div class="card-header dark">Churn Report — ICD</div><div class="card-body">' +
        '<div id="churn-table-wrap">'+_churnTableHtml(built.repList, built.repMap)+'</div>' +
        '</div></div>';
    }
    // No team found — show own row with office grand total
    var myNameC = (SESSION.tableauName || '').trim();
    var myBuiltC = _buildChurnRepMap(rows, myNameC);
    var allBuiltC = _churnAggBuilt() || _buildChurnRepMap(rows, '');
    return '<div class="card"><div class="card-header dark">Churn Report — ICD</div><div class="card-body">' +
      '<div id="churn-table-wrap">'+_churnTableHtml(myBuiltC.repList, myBuiltC.repMap, allBuiltC.repList, allBuiltC.repMap)+'</div>' +
      '</div></div>';
  }
  if (role === 'client-rep') {
    var myName = (SESSION.tableauName || '').trim();
    var myBuilt  = _buildChurnRepMap(rows, myName);
    var allBuilt = _churnAggBuilt() || _buildChurnRepMap(rows, '');
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

