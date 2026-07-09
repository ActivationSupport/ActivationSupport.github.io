// ── MODAL ─────────────────────────────────────────────────────────────────
function closeModal() {
  document.getElementById('detail-modal').classList.remove('open');
  if (_pendingRefresh) {
    _pendingRefresh = false;
    _bgRefreshMain();
    _bgRefreshLst();
  }
}
document.getElementById('detail-modal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });

// ── V2 a11y slice 2: keyboard support for every .modal-bg dialog (generic + additive) ──
// Esc closes the open modal (clicks its .modal-close so the correct teardown runs); Tab is
// trapped inside the dialog; focus moves into the dialog on open and restores on close.
// The wallboard (#wallboard, not a .modal-bg) keeps its own Esc/arrow handler — no overlap.
(function () {
  var _modalPrevFocus = null;
  function openModalEl() { return document.querySelector('.modal-bg.open'); }
  function focusable(c) {
    return Array.prototype.slice.call(c.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return el.offsetParent !== null; });
  }
  document.addEventListener('keydown', function (e) {
    var m = openModalEl(); if (!m) return;
    if (e.key === 'Escape') {
      var x = m.querySelector('.modal-close');
      if (x) { e.preventDefault(); x.click(); }
    } else if (e.key === 'Tab') {
      var f = focusable(m); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!m.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.modal-bg'), function (m) {
    var inner = m.querySelector('.modal');
    if (inner) { inner.setAttribute('role', 'dialog'); inner.setAttribute('aria-modal', 'true'); inner.setAttribute('tabindex', '-1'); }
    new MutationObserver(function () {
      var isOpen = m.classList.contains('open');
      if (isOpen && !m._a11yOpen) {
        m._a11yOpen = true;
        _modalPrevFocus = document.activeElement;
        setTimeout(function () { try { (inner || m).focus(); } catch (_) {} }, 0);
      } else if (!isOpen && m._a11yOpen) {
        m._a11yOpen = false;
        if (_modalPrevFocus && _modalPrevFocus.focus) { try { _modalPrevFocus.focus(); } catch (_) {} }
        _modalPrevFocus = null;
      }
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
  });
})();

// ── POST SALE ─────────────────────────────────────────────────────────────
var _PS_STEP = 1;
var _PS_DATA = null;

// "Today" as YYYY-MM-DD in the CURRENT OFFICE's timezone, so the Post Sale date rolls at
// office-midnight — not UTC (rolled at ~5pm Pacific → pre-filled tomorrow), and not the
// rep's browser zone (a rep may sit in a different timezone than their office).
function _psOfficeToday() {
  var tz = (typeof APPT_OFFICE_TZ !== 'undefined') ? APPT_OFFICE_TZ[CFG.officeId] : '';
  var now = new Date();
  if (tz) {
    try {
      var m = {};
      new Intl.DateTimeFormat('en-US', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' })
        .formatToParts(now).forEach(function(p){ m[p.type] = p.value; });
      if (m.year && m.month && m.day) return m.year + '-' + m.month + '-' + m.day;
    } catch (e) {}
  }
  return _apptDateStr(now);   // fallback: browser-local
}

function _psInit() {
  if (_PS_DATA) return;
  _PS_DATA = {
    dateOfSale: _psOfficeToday(),
    dsi: '', accountType: 'Consumer', processedVia: 'Sara',
    underSomeoneCodes: 'No', codesUsedBy: '', trainee: '', traineeName: '', notes: '',
    products: { air: false, wireless: false, fiber: false, voip: false, dtv: false },
    airQty: 1, wirelessNew: 0, wirelessByod: 0,
    fiberPackage: '', fiberInstallDate: '', voipQty: 0, dtvQty: 0, dtvPackage: ''
  };
}
function resetPostSaleForm() {
  _PS_STEP = 1; _PS_DATA = null; _psInit();
  document.getElementById('main-content').innerHTML = renderPostSale();
}
function renderPostSale() {
  _psInit();
  var html = '<div class="ps-wrap">';
  html += '<div class="ps-header"><h2>Post Sale</h2>';
  html += '<p class="ps-sub">Logging sale for ' + esc(SESSION.name || SESSION.email) + '</p></div>';
  html += _psStepIndicator();
  if (_PS_STEP === 1)      html += _psStep1Html();
  else if (_PS_STEP === 2) html += _psStep2Html();
  else if (_PS_STEP === 3) html += _psStep3Html();
  else                     html += _psStep4Html();
  html += '</div>';
  return html;
}
function _psStepIndicator() {
  var h = '<div class="ps-steps">';
  for (var i = 1; i <= 4; i++) {
    if (i > 1) h += '<div class="ps-step-line' + (_PS_STEP > i - 1 ? ' done' : '') + '"></div>';
    var cls = _PS_STEP === i ? 'active' : (_PS_STEP > i ? 'done' : '');
    h += '<div class="ps-step-dot ' + cls + '">' + (_PS_STEP > i ? '&#10003;' : i) + '</div>';
  }
  return h + '</div>';
}
function _psStep1Html() {
  var d = _PS_DATA;
  var h = '';
  h += '<div class="ps-label">DATE OF SALE</div>';
  h += '<input class="ps-input" type="date" id="ps-date" value="' + d.dateOfSale + '" onchange="_PS_DATA.dateOfSale=this.value">';
  h += '<div class="ps-label">DSI NUMBER</div>';
  h += '<input class="ps-input" type="text" id="ps-dsi" placeholder="ENTER 12-CHARACTER DSI" maxlength="12" value="' + esc(d.dsi) + '" oninput="_psDsiInput(this)">';
  h += '<div class="ps-char-count' + (d.dsi.length > 0 && d.dsi.length !== 12 ? ' warn' : '') + '" id="ps-dsi-count">' + d.dsi.length + '/12 characters</div>';
  h += '<div class="ps-label">TYPE OF ACCOUNT</div>';
  h += '<div class="ps-toggle-row">';
  h += '<div class="ps-toggle' + (d.accountType === 'Consumer' ? ' active' : '') + '" onclick="_psToggle(\'accountType\',\'Consumer\',this)">Consumer</div>';
  h += '<div class="ps-toggle' + (d.accountType === 'Business' ? ' active' : '') + '" onclick="_psToggle(\'accountType\',\'Business\',this)">Business</div>';
  h += '</div>';
  h += '<div class="ps-label">DID YOU HAVE A TRAINEE?</div>';
  h += '<div class="ps-toggle-row">';
  h += '<div class="ps-toggle' + (d.trainee === 'Yes' ? ' active' : '') + '" onclick="_psToggleRerender(\'trainee\',\'Yes\')">Yes</div>';
  h += '<div class="ps-toggle' + (d.trainee === 'No' ? ' active' : '') + '" onclick="_psToggleRerender(\'trainee\',\'No\')">No</div>';
  h += '</div>';
  if (d.trainee === 'Yes') {
    // Free-text: trainees aren't in the portal roster until they get their own code.
    h += '<div class="ps-sub-field"><div class="ps-label">WHO?</div>';
    h += '<input class="ps-input" type="text" placeholder="Trainee name" value="' + esc(d.traineeName) + '" oninput="_PS_DATA.traineeName=this.value"></div>';
  }
  h += '<div class="ps-label">HOW WAS THIS ORDER PROCESSED?</div>';
  h += '<div class="ps-toggle-row">';
  h += '<div class="ps-toggle' + (d.processedVia === 'Sara' ? ' active' : '') + '" onclick="_psToggle(\'processedVia\',\'Sara\',this)">Sara</div>';
  h += '<div class="ps-toggle' + (d.processedVia === 'Tower' ? ' active' : '') + '" onclick="_psToggle(\'processedVia\',\'Tower\',this)">Tower</div>';
  h += '</div>';
  h += '<div class="ps-label">WAS THIS SALE MADE UNDER SOMEONE ELSE\'S CODES?</div>';
  h += '<div class="ps-toggle-row">';
  h += '<div class="ps-toggle' + (d.underSomeoneCodes === 'Yes' ? ' active' : '') + '" onclick="_psToggleRerender(\'underSomeoneCodes\',\'Yes\')">Yes</div>';
  h += '<div class="ps-toggle' + (d.underSomeoneCodes === 'No' ? ' active' : '') + '" onclick="_psToggleRerender(\'underSomeoneCodes\',\'No\')">No</div>';
  h += '</div>';
  if (d.underSomeoneCodes === 'Yes') {
    h += '<div class="ps-sub-field"><div class="ps-label">WHOSE CODES?</div>';
    h += '<input class="ps-input" type="text" placeholder="Name or email..." value="' + esc(d.codesUsedBy) + '" oninput="_PS_DATA.codesUsedBy=this.value"></div>';
  }
  h += '<div class="ps-label">ADDITIONAL NOTES <span style="font-weight:400;text-transform:none;color:var(--text2);letter-spacing:0">(optional)</span></div>';
  h += '<textarea class="ps-textarea" placeholder="Any extra details about the account..." oninput="_PS_DATA.notes=this.value">' + esc(d.notes) + '</textarea>';
  h += '<div class="ps-btn-row"><button class="ps-btn" onclick="_psNext1()">NEXT</button></div>';
  return h;
}
function _psDsiInput(el) {
  _PS_DATA.dsi = el.value;
  var c = document.getElementById('ps-dsi-count'); if (!c) return;
  c.textContent = el.value.length + '/12 characters';
  c.className = 'ps-char-count' + (el.value.length > 0 && el.value.length !== 12 ? ' warn' : '');
}
function _psToggle(field, val, el) {
  _PS_DATA[field] = val;
  if (el) {
    var row = el.closest('.ps-toggle-row');
    if (row) row.querySelectorAll('.ps-toggle').forEach(function(t){ t.classList.remove('active'); });
    el.classList.add('active');
  }
}
function _psToggleRerender(field, val) {
  _PS_DATA[field] = val;
  document.getElementById('main-content').innerHTML = renderPostSale();
}
function _psNext1() {
  var dsiEl = document.getElementById('ps-dsi');
  var dateEl = document.getElementById('ps-date');
  if (dsiEl) _PS_DATA.dsi = dsiEl.value.trim();
  if (dateEl) _PS_DATA.dateOfSale = dateEl.value.trim();
  if (!_PS_DATA.dateOfSale) { alert('Please enter a date of sale.'); return; }
  if (_PS_DATA.dsi.length !== 12) { alert('DSI must be exactly 12 characters.'); return; }
  if (_PS_DATA.trainee !== 'Yes' && _PS_DATA.trainee !== 'No') { alert('Please answer: did you have a trainee?'); return; }
  if (_PS_DATA.trainee === 'Yes' && !(_PS_DATA.traineeName || '').trim()) { alert("Please enter the trainee's name."); return; }
  _PS_STEP = 2;
  document.getElementById('main-content').innerHTML = renderPostSale();
}
function _psStep2Html() {
  var d = _PS_DATA;
  var h = '<div class="ps-label" style="margin-top:0">SELECT PRODUCTS SOLD</div>';
  h += '<div class="ps-products">';
  // Air
  h += _psProductCardHtml('air', icon('wind'), 'Internet Air', d.products.air, '');
  // Wireless
  var wDetail = '';
  if (d.products.wireless) {
    wDetail = '<div class="ps-product-detail"><div class="ps-qty-row">';
    wDetail += '<div class="ps-qty-col"><div class="ps-qty-label">NEW PHONES</div>' + _psQtyStepperHtml('wirelessNew') + '</div>';
    wDetail += '<div class="ps-qty-col"><div class="ps-qty-label">BYODS</div>' + _psQtyStepperHtml('wirelessByod') + '</div>';
    wDetail += '</div><div class="ps-total-lines" id="ps-wl-total">Total lines: ' + ((d.wirelessNew||0)+(d.wirelessByod||0)) + '</div></div>';
  }
  h += _psProductCardHtml('wireless', icon('smartphone'), 'Wireless', d.products.wireless, wDetail);
  // Fiber
  var fDetail = '';
  if (d.products.fiber) {
    var fOpts = ['Fiber 300','Fiber 500','Fiber 1 Gig','Fiber 2 Gig','Fiber 5 Gig'].map(function(p){
      return '<option value="' + p + '"' + (d.fiberPackage===p?' selected':'') + '>' + p + '</option>';
    }).join('');
    fDetail = '<div class="ps-product-detail">';
    fDetail += '<div class="ps-qty-label">PACKAGE</div>';
    fDetail += '<select class="ps-select" onchange="_PS_DATA.fiberPackage=this.value"><option value="">Select package...</option>' + fOpts + '</select>';
    fDetail += '<div class="ps-qty-label" style="margin-top:10px">INSTALL DATE</div>';
    fDetail += '<input class="ps-input" type="date" value="' + (d.fiberInstallDate||'') + '" onchange="_PS_DATA.fiberInstallDate=this.value">';
    fDetail += '</div>';
  }
  h += _psProductCardHtml('fiber', icon('globe'), 'Fiber', d.products.fiber, fDetail);
  // VoIP
  var vDetail = '';
  if (d.products.voip) {
    vDetail = '<div class="ps-product-detail"><div class="ps-qty-label">QUANTITY OF LINES</div>';
    vDetail += _psQtyStepperHtml('voipQty') + '</div>';
  }
  h += _psProductCardHtml('voip', icon('headphones'), 'VoIP', d.products.voip, vDetail);
  // DirecTV
  var dtvDetail = '';
  if (d.products.dtv) {
    var dtvOpts = ['Entertainment','Choice','Ultimate','Premier'].map(function(p){
      return '<option value="' + p + '"' + (d.dtvPackage===p?' selected':'') + '>' + p + '</option>';
    }).join('');
    dtvDetail = '<div class="ps-product-detail">';
    dtvDetail += '<div class="ps-qty-label">PACKAGE</div>';
    dtvDetail += '<select class="ps-select" onchange="_PS_DATA.dtvPackage=this.value"><option value="">Select...</option>' + dtvOpts + '</select>';
    dtvDetail += '</div>';
  }
  h += _psProductCardHtml('dtv', icon('tv'), 'DirecTV', d.products.dtv, dtvDetail);
  h += '</div>';
  h += '<div class="ps-btn-row"><button class="ps-btn secondary" onclick="_psGoStep(1)">BACK</button>';
  h += '<button class="ps-btn" onclick="_psNext2()">NEXT</button></div>';
  return h;
}
function _psProductCardHtml(key, icon, label, sel, detail) {
  return '<div class="ps-product-card' + (sel ? ' selected' : '') + '" onclick="_psToggleProduct(\'' + key + '\')">' +
    '<div class="ps-check"></div>' +
    '<div class="ps-product-icon">' + icon + '</div>' +
    '<div class="ps-product-label">' + label + '</div>' +
    (detail ? '<div onclick="event.stopPropagation()">' + detail + '</div>' : '') +
    '</div>';
}
function _psToggleProduct(key) {
  _PS_DATA.products[key] = !_PS_DATA.products[key];
  if (!_PS_DATA.products[key]) {
    if (key==='wireless'){_PS_DATA.wirelessNew=0;_PS_DATA.wirelessByod=0;}
    if (key==='fiber'){_PS_DATA.fiberPackage='';_PS_DATA.fiberInstallDate='';}
    if (key==='voip') _PS_DATA.voipQty=0;
    if (key==='dtv'){_PS_DATA.dtvQty=0;_PS_DATA.dtvPackage='';}
  }
  document.getElementById('main-content').innerHTML = renderPostSale();
}
function _psQty(field, val) {
  _PS_DATA[field] = parseInt(val)||0;
  if (field==='wirelessNew'||field==='wirelessByod') {
    var t = document.getElementById('ps-wl-total');
    if (t) t.textContent = 'Total lines: ' + ((_PS_DATA.wirelessNew||0)+(_PS_DATA.wirelessByod||0));
  }
}
function _psStepQty(field, delta) {
  var v = (parseInt(_PS_DATA[field])||0) + delta;
  if (v < 0) v = 0;
  _PS_DATA[field] = v;
  var inp = document.getElementById('ps-q-' + field);
  if (inp) inp.value = v;
  if (field==='wirelessNew'||field==='wirelessByod') {
    var t = document.getElementById('ps-wl-total');
    if (t) t.textContent = 'Total lines: ' + ((_PS_DATA.wirelessNew||0)+(_PS_DATA.wirelessByod||0));
  }
}
function _psQtyStepperHtml(field) {
  var v = _PS_DATA[field]||0;
  return '<div class="ps-stepper">' +
    '<button type="button" class="ps-step-btn" aria-label="decrease" onclick="_psStepQty(\'' + field + '\',-1)">&minus;</button>' +
    '<input class="ps-qty-input ps-step-input" id="ps-q-' + field + '" type="number" inputmode="numeric" min="0" value="' + v + '" oninput="_psQty(\'' + field + '\',this.value)">' +
    '<button type="button" class="ps-step-btn" aria-label="increase" onclick="_psStepQty(\'' + field + '\',1)">+</button>' +
    '</div>';
}
function _psNext2() {
  if (!Object.keys(_PS_DATA.products).some(function(k){return _PS_DATA.products[k];})) { alert('Please select at least one product.'); return; }
  if (_PS_DATA.products.fiber && !_PS_DATA.fiberPackage) { alert('Please select a Fiber package.'); return; }
  if (_PS_DATA.products.fiber && !_PS_DATA.fiberInstallDate) { alert('Please enter the Fiber install date.'); return; }
  _PS_STEP = 3;
  document.getElementById('main-content').innerHTML = renderPostSale();
}
function _psGoStep(n) { _PS_STEP = n; document.getElementById('main-content').innerHTML = renderPostSale(); }
// Shared sale recap (SALE INFO + PRODUCTS). showEdit=true on the review step
// (with EDIT links); false on the success screen (read-only confirmation).
function _psRecapHtml(showEdit) {
  var d = _PS_DATA;
  var e1 = showEdit ? '<div class="ps-edit-btn" onclick="_psGoStep(1)">EDIT</div>' : '';
  var e2 = showEdit ? '<div class="ps-edit-btn" onclick="_psGoStep(2)">EDIT</div>' : '';
  var h = '';
  h += '<div class="ps-review-section">';
  h += '<div class="ps-review-header"><div class="ps-review-title">SALE INFO</div>'+e1+'</div>';
  h += _psRRow('Rep', SESSION.name||SESSION.email);
  h += _psRRow('Date', d.dateOfSale);
  h += _psRRow('DSI', d.dsi);
  h += _psRRow('Account Type', d.accountType);
  h += _psRRow('Processed Via', d.processedVia);
  if (d.trainee==='Yes'&&d.traineeName) h+=_psRRow('Trainee', d.traineeName);
  if (d.underSomeoneCodes==='Yes'&&d.codesUsedBy) h+=_psRRow('Codes Used By',d.codesUsedBy);
  if (d.notes) h+=_psRRow('Notes',d.notes);
  h += '</div>';
  h += '<div class="ps-review-section">';
  h += '<div class="ps-review-header"><div class="ps-review-title">PRODUCTS</div>'+e2+'</div>';
  if (d.products.air) h+='<div class="ps-product-line">Internet Air ×1</div>';
  if (d.products.wireless) { var wl=(d.wirelessNew||0)+(d.wirelessByod||0); h+='<div class="ps-product-line">Wireless ×'+wl+(d.wirelessNew?' ('+d.wirelessNew+' New)':'')+(d.wirelessByod?' ('+d.wirelessByod+' BYOD)':'')+'</div>'; }
  if (d.products.fiber) h+='<div class="ps-product-line">Fiber — '+esc(d.fiberPackage)+(d.fiberInstallDate?' | Install: '+d.fiberInstallDate:'')+'</div>';
  if (d.products.voip) h+='<div class="ps-product-line">VoIP ×'+(d.voipQty||0)+'</div>';
  if (d.products.dtv) h+='<div class="ps-product-line">DirecTV'+(d.dtvPackage?' — '+esc(d.dtvPackage):'')+'</div>';
  h += '</div>';
  return h;
}
function _psStep3Html() {
  var h = _psRecapHtml(true);
  h += '<div class="ps-btn-row"><button class="ps-btn secondary" onclick="_psGoStep(2)">BACK</button>';
  h += '<button class="ps-btn" id="ps-submit-btn" onclick="_psSubmit(this)">SUBMIT</button></div>';
  return h;
}
function _psRRow(label, val) {
  return '<div class="ps-review-row"><span class="ps-rl">'+label+'</span><span class="ps-rv">'+esc(String(val||''))+'</span></div>';
}
function _psCalcUnits() {
  var d = _PS_DATA;
  return (d.products.air?1:0)+(d.wirelessNew||0)+(d.wirelessByod||0)+
    (d.products.fiber&&d.fiberPackage?1:0)+(d.voipQty||0)+(d.products.dtv?1:0);
}
function _psStep4Html() {
  var units = _psCalcUnits();
  var h = '<div class="ps-success"><div class="ps-success-icon">&#10003;</div>' +
    '<div class="ps-success-title">Sale Posted!</div>' +
    '<div class="ps-success-sub">Saved successfully &mdash; here\'s what was logged:</div>' +
    '<div class="ps-success-units"><span>' + units + '</span> unit' + (units!==1?'s':'') + ' logged</div></div>';
  h += _psRecapHtml(false);   // read-only recap of exactly what was submitted
  h += '<div class="ps-btn-row"><button class="ps-btn secondary" onclick="resetPostSaleForm()">Post Another Sale</button><button class="ps-btn" onclick="_psToRehash()">Create Rehash Text '+icon('arrow-right')+'</button></div>';
  return h;
}
// Journey handoff: carry the just-posted sale into the Rehash Text tab, pre-filling
// everything Post Sale captured (products, date, account type). The rep only adds the
// customer's first name + AT&T account number (Post Sale doesn't collect those).
function _psToRehash() {
  var p = _PS_DATA || {}, prods = p.products || {};
  var rp = { Wireless: !!prods.wireless, Fiber: !!prods.fiber, Air: !!prods.air };
  if (!rp.Wireless && !rp.Fiber && !rp.Air) rp.Wireless = true;   // never empty (e.g. VoIP/DTV-only sale)
  _REHASH = {
    products: rp,
    firstName: '',
    repName: (SESSION.name || ''),
    dateOfSale: p.dateOfSale || _psOfficeToday(),
    accountNumber: '',
    acctType: (p.accountType === 'Business') ? 'Business' : 'Consumer'
  };
  switchTab('rehash');
}
function _psSubmit(btn) {
  btn.disabled = true; btn.textContent = 'Submitting...';
  var d = _PS_DATA;
  var traineeName = (d.trainee==='Yes') ? (d.traineeName||'').trim() : '';
  var payload = {
    action:'postSale', key:API_KEY, officeId:CFG.officeId,
    repEmail:SESSION.email, repName:SESSION.name||'',
    dateOfSale:d.dateOfSale, dsi:d.dsi,
    accountType:d.accountType, processedVia:d.processedVia,
    underSomeoneCodes:d.underSomeoneCodes, codesUsedBy:d.codesUsedBy,
    trainee:d.trainee, traineeName:traineeName,
    airQty:d.products.air?1:0,
    wirelessNew:d.wirelessNew||0, wirelessByod:d.wirelessByod||0,
    fiberPackage:d.products.fiber?d.fiberPackage:'',
    fiberInstallDate:d.products.fiber?d.fiberInstallDate:'',
    voipQty:d.products.voip?(d.voipQty||0):0,
    dtvQty:d.products.dtv?1:0,
    dtvPackage:d.products.dtv?d.dtvPackage:'',
    notes:d.notes
  };
  apiPost(payload).then(function(res) {
    if (res&&res.ok) {
      _PS_STEP=4;
      document.getElementById('main-content').innerHTML=renderPostSale();
    }
    else {
      btn.disabled=false; btn.textContent='SUBMIT';
      // Duplicate = the order already saved (option A): show the plain message, no scary "Error:".
      alert((res&&res.duplicate) ? (res.error||'This order was already posted today.') : ('Error: '+(res&&res.error?res.error:'Unknown error')));
    }
  }).catch(function(){ btn.disabled=false; btn.textContent='SUBMIT'; alert('Submission failed. Please try again.'); });
}

// ── REHASH TEXT ───────────────────────────────────────────────────────────
// Reps fill 4 fields → generates the AT&T welcome/rehash text to copy & send to
// the customer. NOTHING is saved (no backend call); the account number is used
// only to build the message. VIP line number switches on Consumer vs Business.
var _REHASH = null;
function _rehashInit() {
  if (_REHASH) return;
  _REHASH = { products:{ Wireless:true, Fiber:false, Air:false }, firstName:'', repName:(SESSION.name||''), dateOfSale:_psOfficeToday(), accountNumber:'', acctType:'Consumer' };
}
function renderRehashTab() {
  _rehashInit();
  var d = _REHASH;
  var tog  = function(v){ return '<div class="ps-toggle'+(d.acctType===v?' active':'')+'" onclick="_rehashPick(\'acctType\',\''+v+'\')">'+v+'</div>'; };
  var ptog = function(v){ return '<div class="ps-toggle'+(d.products[v]?' active':'')+'" onclick="_rehashToggleProduct(\''+v+'\')">'+v+'</div>'; };
  return '<div class="card"><div class="card-header dark">'+icon('rehash')+' Rehash Text</div><div class="card-body">'+
    '<div style="font-size:.85rem;color:var(--text2);margin-bottom:18px;line-height:1.5">Pick the product + fill these in, then tap <b>Copy Text</b> and send it to the customer. Nothing here is saved — the account number is used only to build the message.</div>'+
    '<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">'+
      // ── Left: the fields (side-by-side on desktop, stacks full-width on phones) ──
      '<div style="flex:1 1 240px;min-width:220px">'+
        '<div class="ps-label" style="margin-top:0">PRODUCTS SOLD &mdash; select all that apply</div>'+
        '<div class="ps-toggle-row">'+ptog('Wireless')+ptog('Fiber')+ptog('Air')+'</div>'+
        '<div class="ps-label">CUSTOMER FIRST NAME</div>'+
        '<input class="ps-input" id="rh-first" value="'+esc(d.firstName)+'" placeholder="Customer first name" oninput="_rehashSet(\'firstName\',this.value)">'+
        '<div class="ps-label">SALES REP</div>'+
        '<input class="ps-input" id="rh-rep" value="'+esc(d.repName)+'" oninput="_rehashSet(\'repName\',this.value)">'+
        '<div class="ps-label">DATE OF SALE</div>'+
        '<input class="ps-input" type="date" id="rh-date" value="'+esc(d.dateOfSale)+'" onchange="_rehashSet(\'dateOfSale\',this.value)">'+
        '<div class="ps-label">ACCOUNT NUMBER</div>'+
        '<input class="ps-input" id="rh-acct" value="'+esc(d.accountNumber)+'" placeholder="Used only for this text — not saved" oninput="_rehashSet(\'accountNumber\',this.value)">'+
        '<div class="ps-label">ACCOUNT TYPE</div>'+
        '<div class="ps-toggle-row">'+tog('Consumer')+tog('Business')+'</div>'+
      '</div>'+
      // ── Right: the live message preview ──
      '<div style="flex:1.5 1 300px;min-width:260px">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;gap:10px;flex-wrap:wrap">'+
          '<span class="ps-label" style="margin:0">MESSAGE PREVIEW</span>'+
          '<button class="ps-btn" onclick="_rehashCopy(this)">'+icon('copy')+' Copy Text</button>'+
        '</div>'+
        '<textarea id="rh-preview" readonly style="width:100%;min-height:520px;box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;line-height:1.5;padding:14px;white-space:pre-wrap;resize:vertical">'+esc(_rehashText(d))+'</textarea>'+
      '</div>'+
    '</div>'+
    '</div></div>';
}
function _rehashSet(field, val) {
  _rehashInit(); _REHASH[field] = val;
  var t = document.getElementById('rh-preview'); if (t) t.value = _rehashText(_REHASH);
}
function _rehashPick(field, val) {
  _rehashInit(); _REHASH[field] = val;
  document.getElementById('main-content').innerHTML = renderRehashTab();
}
function _rehashToggleProduct(v) {
  _rehashInit();
  var p = _REHASH.products, on = Object.keys(p).filter(function(k){ return p[k]; });
  if (p[v] && on.length === 1) return;   // keep at least one product selected
  p[v] = !p[v];
  document.getElementById('main-content').innerHTML = renderRehashTab();
}
function _rehashCopy(btn) {
  var t = document.getElementById('rh-preview'); if (!t) return;
  var txt = t.value;
  var done = function(){ var o = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(function(){ btn.textContent = o; }, 1500); };
  var fallback = function(){ t.removeAttribute('readonly'); t.select(); try{ document.execCommand('copy'); done(); }catch(e){} t.setAttribute('readonly','readonly'); };
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, fallback); }
  else { fallback(); }
}
function _rehashText(d) {
  var name = (d.firstName || '').trim() || '[Customer first name]';
  var rep  = (d.repName || '').trim() || '[Rep name]';
  var date = (d.dateOfSale || '').trim() || '[Date of sale]';
  var acct = (d.accountNumber || '').trim() || '[Account number]';
  var P = d.products || { Wireless:true };
  var hasW = !!P.Wireless, hasF = !!P.Fiber, hasA = !!P.Air;
  if (!hasW && !hasF && !hasA) hasW = true;   // safety: never empty
  var isBiz = (d.acctType === 'Business');
  var vip  = isBiz ? '855 370 6941' : '833 603 3270';
  // Current office's public customer booking portal (same source as the Appointments-tab link).
  var bookUrl = (typeof CUSTOMER_BOOKING_URL !== 'undefined' ? CUSTOMER_BOOKING_URL : 'https://activationsupport.github.io/book.html') +
    '?office=' + encodeURIComponent((typeof CFG !== 'undefined' && CFG && CFG.officeId) ? CFG.officeId : '');
  // Header lists whatever was selected; single product keeps its own icon.
  var sel = []; if (hasW) sel.push('Wireless'); if (hasF) sel.push('Fiber'); if (hasA) sel.push('Internet Air');
  var hdr;
  if (sel.length === 1) { var ic = hasW ? '📱' : hasA ? '📡' : '🌐'; hdr = ic + ' YOUR ' + sel[0].toUpperCase() + ' ORDER'; }
  else { hdr = '📋 YOUR AT&T ORDER — ' + sel.join(' + '); }
  var s = [];
  s.push('Hi ' + name + ',', '');
  s.push(hdr);
  s.push('Sales Rep: ' + rep);
  s.push('Order date: ' + date);
  if (hasW || hasA) s.push('Delivery date: 1-3 business days');   // Fiber-only = install appointment, no delivery line
  s.push('Account number: ' + acct);
  s.push('PIN: Created by the customer at point of sale', '');
  s.push('Thank you for joining the AT&T family! Here is what to expect — and please keep an eye on your email for any updates.', '');
  s.push('If you have any questions or run into any issues, please contact your VIP Support Line first. Your dedicated activation team is also available in your group chat and is your main point of contact.', '');
  s.push('———————————————————', '');
  // Booking portal — everything EXCEPT Fiber-only (Fiber is an install appointment, not an activation call)
  if (hasW || hasA) {
    s.push('📅 Schedule Your Activation Appointment');
    s.push('   • ' + bookUrl, '');
  }
  // VIP Support — always
  s.push('📞 VIP Support Line');
  s.push('   • Dedicated hotline for your neighborhood');
  s.push('   • ' + vip, '');
  // Wireless-only sections
  if (hasW) {
    s.push('📦 Trade-In + Next Up');
    s.push('   • Call ' + vip + ' to request boxes for your trade-in', '');
    s.push('💳 Phone Reimbursement');
    s.push('   • After activating your new AT&T phones, your old carrier will send a final bill with the remaining balance of any unpaid devices');
    s.push('   • Submit that bill here: https://rewardcenteroffers.com/ETF');
    s.push('   • Can take 8-11 weeks to receive', '');
    s.push('🎁 $150 Gift Card');
    s.push('   • Redemption will be emailed 3 weeks after activation');
    s.push('   • https://rewardcenter.att.com/home.aspx', '');
  }
  // Apps — myAT&T on every order; Smart Home Manager only on internet products (Fiber/Air)
  s.push('📲 Download the AT&T Apps');
  s.push('   • myAT&T (Android): https://play.google.com/store/apps/details?id=com.att.myWireless&hl=en_US');
  s.push('   • myAT&T (Apple): https://apps.apple.com/us/app/at-t/id309172177');
  if (hasF || hasA) {
    s.push('   • Smart Home Manager (Android): https://play.google.com/store/apps/details?id=com.att.shm&hl=en_US');
    s.push('   • Smart Home Manager (Apple): https://apps.apple.com/us/app/smart-home-manager/id1258654743');
  }
  s.push('');
  // AIR Compass — Air + Business
  if (hasA && isBiz) {
    s.push('🧭 AIR Compass');
    s.push('   • https://aiab-signal.att.com/', '');
  }
  // Appointment Manager Portal — Fiber + Business
  if (hasF && isBiz) {
    s.push('📅 Appointment Manager Portal');
    s.push('   • https://www.att.com/support/article/u-verse-high-speed-internet/KM1046993/', '');
  }
  // Always
  s.push('🔕 Opt Out of AutoPay with Your Old Provider', '');
  s.push('✅ Validate Signature / Appreciation Discounts');
  s.push('   • www.ATT.com/verification/signaturehub', '');
  // Order status — Wireless (all), Air (all), Fiber (Consumer only)
  if (hasW || hasA || (hasF && !isBiz)) {
    s.push('🔎 Check Your Order Status');
    s.push('   • https://www.att.com/orders/checkmyorder', '');
  }
  s.push('———————————————————', '');
  // Billing — same block across all products
  s.push('🧾 YOUR BILLING', '');
  s.push('1️⃣  First Bill — starts higher due to:');
  s.push('   • Proration (31-60 days of service)');
  s.push('   • Activation fees (will be reimbursed)');
  s.push('   • Delayed credits (not applied yet)');
  s.push('   • Trade-in credits (will be reimbursed)');
  s.push('   • $150 port credits (will be reimbursed)', '');
  s.push('2️⃣  Second Bill:');
  s.push('   • No more proration (only 30 days of service)');
  s.push('   • Delayed credits (not applied yet)', '');
  s.push('3️⃣  Third Bill:');
  s.push('   • Credit reimbursement');
  s.push('   • Credits from the 1st, 2nd, and 3rd bill all apply here', '');
  s.push('4️⃣  Fourth Bill:');
  s.push('   • The regular bill that was quoted', '');
  s.push('———————————————————', '');
  s.push('Thank you again for choosing AT&T — we truly appreciate your business!');
  return s.join('\n');
}

// ── POSTED SALES (view + self-correct + void) ─────────────────────────────
var _PSV_SALES = null;        // cached scoped list (own-only roles see only theirs)
var _PSV_SHOW_VOIDED = false;
var _PSV_FLIGHT = false;
var _PSE = null;              // edit-modal working state

function _psvPaint() {
  var c = document.getElementById('main-content'); if (!c) return;
  c.innerHTML = _psvBuild();
  bindFilters();   // wire the f-psv search box (same convention as the call tables)
}
function renderPostedSalesTab() {
  var c = document.getElementById('main-content');
  if (_PSV_SALES !== null) { _psvPaint(); return; }
  if (!_PSV_FLIGHT) {
    _PSV_FLIGHT = true;
    api({ action:'readMyPostedSales', officeId:CFG.officeId }).then(function(res) {
      _PSV_FLIGHT = false;
      _PSV_SALES = (res && res.sales) ? res.sales : [];
      if (CURRENT_TAB === 'postedsales') _psvPaint();
    }).catch(function() {
      _PSV_FLIGHT = false;
      if (CURRENT_TAB === 'postedsales') document.getElementById('main-content').innerHTML =
        '<div class="card"><div class="card-body"><div class="empty">Connection error. <a href="#" onclick="renderPostedSalesTab()">Retry</a></div></div></div>';
    });
  }
  c.innerHTML = '<div class="card"><div class="card-body"><div class="empty">Loading posted sales…</div></div></div>';
}
function _psvCanEditAll() {
  var r = (SESSION.role || '').toLowerCase();
  return r === 'owner' || r === 'admin' || r === 'master-admin' || r === 'activator' || SESSION.isMaster;
}
function _psvProductSummary(s) {
  var p = [];
  if (s.airQty > 0) p.push('Air x1');
  var wl = (s.wirelessNew || 0) + (s.wirelessByod || 0);
  if (wl > 0) p.push('Wireless x' + wl);
  if (s.fiberPackage) p.push('Fiber (' + s.fiberPackage + ')');
  if (s.voipQty > 0) p.push('VoIP x' + s.voipQty);
  if (s.dtvQty > 0) p.push('DirecTV' + (s.dtvPackage ? ' (' + s.dtvPackage + ')' : ''));
  return p.length ? p.join(', ') : '—';
}
function _psvBuild() {
  var all = _PSV_SALES || [];
  var voidedCount = all.filter(function(s) { return s.voided; }).length;
  var list = all.filter(function(s) { return _PSV_SHOW_VOIDED || !s.voided; })
    .slice().sort(function(a, b) {
      return (b.dateOfSale || '').localeCompare(a.dateOfSale || '') ||
             (b.timestamp || '').localeCompare(a.timestamp || '');
    });
  var scope = _psvCanEditAll() ? 'All posted sales' : 'Your posted sales';
  var h = '<div class="card"><div class="card-header dark">Posted Sales &nbsp;' +
    '<span style="font-weight:400;font-size:.82rem;opacity:.8">' + list.length + (list.length === 1 ? ' sale' : ' sales') + '</span>' +
    '</div><div class="card-body">';
  h += '<div class="filter-row"><input id="f-psv" placeholder="Search rep, DSI, account, products…">';
  if (voidedCount) h += '<label class="psv-show-voided"><input type="checkbox" ' + (_PSV_SHOW_VOIDED ? 'checked' : '') +
    ' onchange="_psvToggleVoided(this.checked)"> Show voided (' + voidedCount + ')</label>';
  h += '<button class="clear-filters-btn" onclick="_psvRefresh()">'+icon('refresh')+' Refresh</button></div>';
  h += '<div class="tbl-count">' + esc(scope) + ' &middot; showing ' + list.length + '</div>';
  if (!list.length) return noData('No posted sales yet.', {icon:'postedsales'});
  h += '<div class="call-table-wrap"><table class="call-table" id="psv-table"><thead><tr>' +
       '<th>Rep</th><th>Date</th><th>DSI</th><th>Account</th><th>Products</th><th>Units</th>' +
       '<th>Trainee</th><th>Notes</th><th></th></tr></thead><tbody>';
  list.forEach(function(s) {
    var idx = _PSV_SALES.indexOf(s);
    var note = s.notes || '';
    var repNm = ((DATA.roster || {})[s.repEmail] && (DATA.roster || {})[s.repEmail].name) || s.repName || s.repEmail || '—';
    h += '<tr' + (s.voided ? ' class="psv-voided"' : '') + '>';
    h += '<td>' + esc(repNm) + '</td>';
    h += '<td>' + esc(s.dateOfSale || '—') + (s.voided ? ' <span class="psv-badge">VOID</span>' : '') + '</td>';
    h += '<td>' + esc(s.dsi || '—') + '</td>';
    h += '<td>' + esc(s.accountType || '—') + '</td>';
    h += '<td>' + esc(_psvProductSummary(s)) + '</td>';
    h += '<td>' + (s.units || 0) + '</td>';
    h += '<td>' + (s.trainee === 'Yes' ? esc(s.traineeName || 'Yes') : '—') + '</td>';
    h += '<td>' + (note ? '<span class="psv-note" title="' + esc(note) + '">' +
         esc(note.length > 40 ? note.slice(0, 40) + '…' : note) + '</span>' : '—') + '</td>';
    h += '<td class="psv-actions">';
    h += '<button class="psv-btn" onclick="_psvEdit(' + idx + ')">Edit</button>';
    if (s.voided) h += '<button class="psv-btn psv-unvoid" onclick="_psvVoid(' + idx + ',false)">Unvoid</button>';
    else          h += '<button class="psv-btn psv-void" onclick="_psvVoid(' + idx + ',true)">Void</button>';
    h += '</td></tr>';
  });
  h += '</tbody></table></div></div></div>';
  return h;
}
function _psvToggleVoided(v) { _PSV_SHOW_VOIDED = v; _psvPaint(); }
function _psvRefresh() { _PSV_SALES = null; renderPostedSalesTab(); }
// A posted-sale edit/void changes downstream tallies — drop those caches so the
// Live Sales Tracker, Teams, and Training & Tracking re-fetch the new numbers.
function _psInvalidateDownstream() {
  _LST_SALES = null;        // Live Sales Tracker + Teams
  _TRAINING_ORDERS = null;  // Training & Tracking
}

function _psvVoid(idx, makeVoid) {
  var s = (_PSV_SALES || [])[idx]; if (!s) return;
  var msg = (makeVoid ? 'Void' : 'Restore') + ' this sale?\n\n' + (s.dateOfSale || '') + '  ·  DSI ' + (s.dsi || '') +
    '\n\n' + (makeVoid ? 'It will stop counting in the Live Sales Tracker, Teams, and Training & Tracking.'
                       : 'It will count again everywhere.');
  if (!confirm(msg)) return;
  apiPost({ action:'voidPostedSale', key:API_KEY, officeId:CFG.officeId, rowIndex:s.rowIndex, voided:makeVoid })
    .then(function(res) {
      if (res && res.ok) {
        // Update the record in place + repaint locally (no re-fetch / no spinner / keep scroll).
        s.voided = makeVoid;
        _psInvalidateDownstream();
        var _sc = _snapScroll();
        _psvPaint();
        _restoreScroll(_sc);
      }
      else alert('Error: ' + (res && res.error ? res.error : 'Unknown error'));
    }).catch(function() { alert('Action failed. Please try again.'); });
}

// ── Posted Sales — edit modal (reuses #detail-modal; notes are read-only) ──
function _psvEdit(idx) {
  var s = (_PSV_SALES || [])[idx]; if (!s) return;
  _PSE = {
    rowIndex: s.rowIndex,
    dateOfSale: s.dateOfSale || '', dsi: s.dsi || '',
    accountType: s.accountType || 'Consumer', processedVia: s.processedVia || 'Sara',
    underSomeoneCodes: s.underSomeoneCodes || 'No', codesUsedBy: s.codesUsedBy || '',
    trainee: s.trainee || 'No', traineeName: s.traineeName || '',
    air: (s.airQty > 0),
    wireless: ((s.wirelessNew || 0) + (s.wirelessByod || 0)) > 0,
    wirelessNew: s.wirelessNew || 0, wirelessByod: s.wirelessByod || 0,
    fiber: !!s.fiberPackage, fiberPackage: s.fiberPackage || '', fiberInstallDate: s.fiberInstallDate || '',
    voip: (s.voipQty > 0), voipQty: s.voipQty || 0,
    dtv: (s.dtvQty > 0), dtvPackage: s.dtvPackage || '',
    notes: s.notes || ''
  };
  document.getElementById('modal-title').textContent = 'Edit Posted Sale';
  document.getElementById('modal-body').innerHTML = _pseFormHtml();
  document.getElementById('detail-modal').classList.add('open');
}
function _pseFormHtml() {
  var d = _PSE;
  function tog(field, val, label) {
    return '<div class="ps-toggle' + (d[field] === val ? ' active' : '') +
      '" onclick="_pseSetR(\'' + field + '\',\'' + val + '\')">' + label + '</div>';
  }
  var h = '<div class="pse-form">';
  h += '<div class="ps-label">DATE OF SALE</div>';
  h += '<input class="ps-input" type="date" value="' + esc(d.dateOfSale) + '" onchange="_pseSet(\'dateOfSale\',this.value)">';
  h += '<div class="ps-label">DSI NUMBER</div>';
  h += '<input class="ps-input" type="text" maxlength="12" value="' + esc(d.dsi) + '" oninput="_pseSet(\'dsi\',this.value)">';
  h += '<div class="ps-label">TYPE OF ACCOUNT</div><div class="ps-toggle-row">' + tog('accountType','Consumer','Consumer') + tog('accountType','Business','Business') + '</div>';
  h += '<div class="ps-label">HOW WAS THIS ORDER PROCESSED?</div><div class="ps-toggle-row">' + tog('processedVia','Sara','Sara') + tog('processedVia','Tower','Tower') + '</div>';
  h += '<div class="ps-label">TRAINEE?</div><div class="ps-toggle-row">' + tog('trainee','Yes','Yes') + tog('trainee','No','No') + '</div>';
  if (d.trainee === 'Yes') h += '<div class="ps-sub-field"><div class="ps-label">WHO?</div><input class="ps-input" type="text" value="' + esc(d.traineeName) + '" oninput="_pseSet(\'traineeName\',this.value)"></div>';
  h += '<div class="ps-label">UNDER SOMEONE ELSE\'S CODES?</div><div class="ps-toggle-row">' + tog('underSomeoneCodes','Yes','Yes') + tog('underSomeoneCodes','No','No') + '</div>';
  if (d.underSomeoneCodes === 'Yes') h += '<div class="ps-sub-field"><div class="ps-label">WHOSE CODES?</div><input class="ps-input" type="text" value="' + esc(d.codesUsedBy) + '" oninput="_pseSet(\'codesUsedBy\',this.value)"></div>';
  h += '<div class="ps-label" style="margin-top:14px">PRODUCTS SOLD</div><div class="pse-prods">';
  h += _psePc('air', 'Internet Air', '');
  var wd = '';
  if (d.wireless) wd = '<div class="pse-detail"><div class="ps-qty-label">NEW PHONES</div><input class="ps-qty-input" type="number" min="0" inputmode="numeric" value="' + (d.wirelessNew || 0) + '" oninput="_pseSet(\'wirelessNew\',this.value)"><div class="ps-qty-label" style="margin-top:6px">BYODS</div><input class="ps-qty-input" type="number" min="0" inputmode="numeric" value="' + (d.wirelessByod || 0) + '" oninput="_pseSet(\'wirelessByod\',this.value)"></div>';
  h += _psePc('wireless', 'Wireless', wd);
  var fd = '';
  if (d.fiber) {
    var fOpts = ['Fiber 300','Fiber 500','Fiber 1 Gig','Fiber 2 Gig','Fiber 5 Gig'].map(function(p) {
      return '<option value="' + p + '"' + (d.fiberPackage === p ? ' selected' : '') + '>' + p + '</option>'; }).join('');
    fd = '<div class="pse-detail"><div class="ps-qty-label">PACKAGE</div><select class="ps-select" onchange="_pseSet(\'fiberPackage\',this.value)"><option value="">Select…</option>' + fOpts + '</select><div class="ps-qty-label" style="margin-top:6px">INSTALL DATE</div><input class="ps-input" type="date" value="' + esc(d.fiberInstallDate) + '" onchange="_pseSet(\'fiberInstallDate\',this.value)"></div>';
  }
  h += _psePc('fiber', 'Fiber', fd);
  var vd = '';
  if (d.voip) vd = '<div class="pse-detail"><div class="ps-qty-label">LINES</div><input class="ps-qty-input" type="number" min="0" inputmode="numeric" value="' + (d.voipQty || 0) + '" oninput="_pseSet(\'voipQty\',this.value)"></div>';
  h += _psePc('voip', 'VoIP', vd);
  var td = '';
  if (d.dtv) {
    var dOpts = ['Entertainment','Choice','Ultimate','Premier'].map(function(p) {
      return '<option value="' + p + '"' + (d.dtvPackage === p ? ' selected' : '') + '>' + p + '</option>'; }).join('');
    td = '<div class="pse-detail"><div class="ps-qty-label">PACKAGE</div><select class="ps-select" onchange="_pseSet(\'dtvPackage\',this.value)"><option value="">Select…</option>' + dOpts + '</select></div>';
  }
  h += _psePc('dtv', 'DirecTV', td);
  h += '</div>';
  h += '<div class="ps-label" style="margin-top:14px">NOTES <span style="font-weight:400;text-transform:none;color:var(--text2);letter-spacing:0">(not editable)</span></div>';
  h += '<div class="pse-notes-ro">' + (d.notes ? esc(d.notes) : '<span style="color:var(--text2)">No notes</span>') + '</div>';
  h += '<div class="pse-btn-row"><button class="ps-btn secondary" onclick="closeModal()">CANCEL</button>';
  h += '<button class="ps-btn" id="pse-save" onclick="_pseSave(this)">SAVE CHANGES</button></div>';
  h += '</div>';
  return h;
}
function _psePc(key, label, detail) {
  var sel = _PSE[key];
  return '<div class="pse-pc' + (sel ? ' selected' : '') + '">' +
    '<div class="pse-pc-row" onclick="_pseToggleProd(\'' + key + '\')"><span class="pse-pc-check">' + (sel ? '✓' : '') + '</span><span>' + label + '</span></div>' +
    (detail ? '<div onclick="event.stopPropagation()">' + detail + '</div>' : '') + '</div>';
}
function _pseSet(field, val) {
  if (field === 'wirelessNew' || field === 'wirelessByod' || field === 'voipQty') _PSE[field] = parseInt(val) || 0;
  else _PSE[field] = val;
}
function _pseSetR(field, val) { _PSE[field] = val; _pseRerender(); }
function _pseToggleProd(key) {
  _PSE[key] = !_PSE[key];
  if (!_PSE[key]) {
    if (key === 'wireless') { _PSE.wirelessNew = 0; _PSE.wirelessByod = 0; }
    if (key === 'fiber') { _PSE.fiberPackage = ''; _PSE.fiberInstallDate = ''; }
    if (key === 'voip') _PSE.voipQty = 0;
    if (key === 'dtv') _PSE.dtvPackage = '';
  }
  _pseRerender();
}
function _pseRerender() { document.getElementById('modal-body').innerHTML = _pseFormHtml(); }
function _pseSave(btn) {
  var d = _PSE;
  if (!d.dateOfSale) { alert('Please enter a date of sale.'); return; }
  if ((d.dsi || '').trim().length !== 12) { alert('DSI must be exactly 12 characters.'); return; }
  if (d.trainee === 'Yes' && !(d.traineeName || '').trim()) { alert("Please enter the trainee's name."); return; }
  if (!(d.air || d.wireless || d.fiber || d.voip || d.dtv)) { alert('Please select at least one product.'); return; }
  if (d.fiber && !d.fiberPackage) { alert('Please select a Fiber package.'); return; }
  if (d.fiber && !d.fiberInstallDate) { alert('Please enter the Fiber install date.'); return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  var payload = {
    action:'updatePostedSale', key:API_KEY, officeId:CFG.officeId, rowIndex:d.rowIndex,
    dateOfSale:d.dateOfSale, dsi:(d.dsi || '').trim(),
    accountType:d.accountType, processedVia:d.processedVia,
    underSomeoneCodes:d.underSomeoneCodes, codesUsedBy:(d.underSomeoneCodes === 'Yes') ? d.codesUsedBy : '',
    trainee:d.trainee, traineeName:(d.trainee === 'Yes') ? (d.traineeName || '').trim() : '',
    airQty:d.air ? 1 : 0,
    wirelessNew:d.wireless ? (d.wirelessNew || 0) : 0, wirelessByod:d.wireless ? (d.wirelessByod || 0) : 0,
    fiberPackage:d.fiber ? d.fiberPackage : '', fiberInstallDate:d.fiber ? d.fiberInstallDate : '',
    voipQty:d.voip ? (d.voipQty || 0) : 0,
    dtvQty:d.dtv ? 1 : 0, dtvPackage:d.dtv ? d.dtvPackage : ''
  };
  apiPost(payload).then(function(res) {
    if (res && res.ok) { _PSV_SALES = null; _psInvalidateDownstream(); closeModal(); renderPostedSalesTab(); }
    else { btn.disabled = false; btn.textContent = 'SAVE CHANGES'; alert('Error: ' + (res && res.error ? res.error : 'Unknown error')); }
  }).catch(function() { btn.disabled = false; btn.textContent = 'SAVE CHANGES'; alert('Save failed. Please try again.'); });
}

