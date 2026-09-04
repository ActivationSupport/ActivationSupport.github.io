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
// (A fullscreen wallboard used to sit outside this system with its own Esc/arrow handler;
//  it was removed 2026-08-10, so every Esc-closable surface now goes through this one path.)
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
    /* ⚠ "WHO MADE THE SALE?", not "WHOSE CODES?" — the field holds a PERSON, and the answer
       feeds `codesUsedBy`. Asking for the codes invited a code/ID; asking who made the sale
       matches the placeholder ("Name or email...") and the value the sheet actually wants.
       ⚠ Keep this identical to the edit modal's copy of the label (_pseForm) — the same field
       asking two different questions depending on where it is opened is how it drifted before. */
    h += '<div class="ps-sub-field"><div class="ps-label">WHO MADE THE SALE?</div>';
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
  var _reqOffice = CFG.officeId;
  apiPost(payload).then(function(res) {
    /* Office guard. The SALE itself is safe — the server booked it against the office that
       sent it — but advancing to the step-4 confirmation and repainting would show a
       "submitted" screen under a DIFFERENT office's header if the user switched while it was
       in flight. Bail: the switch has already re-rendered the tab. */
    if (CFG.officeId !== _reqOffice) return;
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
/* The number a rep puts on the group thread: the office's QUALITY CONTROL line if it has one,
   otherwise its activation number (ATX_OFFICE_NUMBER, declared below — `var` so both are
   assigned long before a rep opens a tab).
   🔑 PREFERENCE, NOT A COPY. This used to read ATX_OFFICE_NUMBER alone, on the reasoning that
   one map cannot drift. That still holds for a DUPLICATE — but a QC line and an activation
   line are different numbers reaching different teams, so the office that has only the former
   would otherwise show "no number set" while a real number sat unused. Offices with no QC
   entry fall through and behave exactly as before.
   ⚠⚠ Do NOT "simplify" this by folding OFFICE_QC_NUMBER into ATX_OFFICE_NUMBER. That map is
   quoted to CUSTOMERS by the four Activator Text appointment messages as "our Office
   Activation Number", and a QC line must not be introduced to a customer under that name.
   ⚠ A blank entry is a REAL STATE, not a bug — evolution and revamped launched without a
   call-in number. It must be said out loud; an empty slot reads as "there isn't one". */
function _rehashOfficeNum() {
  if (typeof CFG === 'undefined' || !CFG) return '';
  if (typeof OFFICE_QC_NUMBER !== 'undefined' && OFFICE_QC_NUMBER[CFG.officeId]) {
    return OFFICE_QC_NUMBER[CFG.officeId];
  }
  if (typeof ATX_OFFICE_NUMBER === 'undefined') return '';
  return ATX_OFFICE_NUMBER[CFG.officeId] || '';
}
/* Which pane of the Rehash Text tab is showing. Module-level on purpose: every field edit
   re-renders the WHOLE tab through innerHTML, so a view held in the DOM would reset itself
   the moment a rep typed a letter. */
var _RH_VIEW = 'message';
function _rehashView(v) {
  _RH_VIEW = v;
  document.getElementById('main-content').innerHTML = renderRehashTab();
}
function renderRehashTab() {
  _rehashInit();
  /* ⚠ Sub-tabs, NOT the .ps-toggle used for Products/Account Type below. Those are FORM
     FIELDS that change the message; these change which screen you are on. Making them look
     identical would invite a rep to read "Business One-Pager" as a third account type. */
  var vtab = function(k, label, badge) {
    return '<div class="rh-tab'+(_RH_VIEW===k?' active':'')+'" onclick="_rehashView(\''+k+'\')">'+label+
           (badge ? '<span class="rh-tab-badge">'+badge+'</span>' : '')+'</div>';
  };
  return '<div class="card"><div class="card-header dark">'+icon('rehash')+' Rehash Text</div><div class="card-body">'+
    '<div class="rh-tabs">'+vtab('message','Message')+vtab('onepager','One-Pager','BUSINESS')+'</div>'+
    (_RH_VIEW === 'onepager' ? _rehashOnePagerPane() : _rehashMessagePane())+
    '</div></div>';
}
function _rehashMessagePane() {
  var d = _REHASH;
  var onum = _rehashOfficeNum();
  var tog  = function(v){ return '<div class="ps-toggle'+(d.acctType===v?' active':'')+'" onclick="_rehashPick(\'acctType\',\''+v+'\')">'+v+'</div>'; };
  var ptog = function(v){ return '<div class="ps-toggle'+(d.products[v]?' active':'')+'" onclick="_rehashToggleProduct(\''+v+'\')">'+v+'</div>'; };
  return ''+
    '<div style="font-size:.85rem;color:var(--text2);margin-bottom:18px;line-height:1.5">Pick the product + fill these in, then tap <b>Copy Text</b> and send it to the customer. Nothing here is saved — the account number is used only to build the message.</div>'+
    // ⚠ This is a REP instruction about HOW to send, not a line in the customer's message.
    //   It sits above the fields because it changes what they do before they start typing.
    '<div class="rh-groupnote">'+
      '<div class="rh-groupnote-hd">'+icon('people')+'Send this as a GROUP TEXT</div>'+
      (onum
        ? 'Put three people on the thread — the customer, you, and your activation team at <b class="rh-groupnum">'+esc(onum)+'</b>. That way we can step in without the customer having to repeat themselves.'
        : 'Put three people on the thread — the customer, you, and your activation team. <b>Your office does not have an activation number set yet — ask your manager for it before you send.</b>')+
    '</div>'+
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
    '</div>';
}
/* BUSINESS ONE-PAGER pane.
   🔴🔴 THE GUIDE'S TEXT IS NOT IN THIS REPO AND MUST NEVER BE. `dashboard/` is PUBLIC, and a
   commit publishes permanently — git history keeps a file after a later delete. The text lives
   in the _Knowledge sheet and arrives over the authenticated readKnowledge action, which is the
   pattern app.knowledge.js exists to enforce ("the article text lives ONLY in the _Knowledge
   sheet"). Every rep can read it there: the Resources tab is ALL_ROLES.
   ⚠ These titles must MATCH THE SHEET's Title column exactly, or the deep-link cannot expand
   the article. It degrades safely — the rep still lands on Resources with the guide in
   the list — but a renamed row makes this silently stop pre-opening. → [[decisions]] D-037 */
var RH_GUIDE_EN = 'Post Sale One Pager — Business (English)';
var RH_GUIDE_ES = 'Post Sale One Pager — Business (Español)';
function _rehashOpenGuide(title) {
  /* app.knowledge.js owns _KB_OPEN; both bundles are loaded long before a rep can click. */
  if (typeof _KB_OPEN !== 'undefined' && _KB_OPEN) _KB_OPEN[title] = true;
  switchTab('resources');   // the guides have their own tab under Knowledge
}
function _rehashOnePagerPane() {
  var biz = _REHASH && _REHASH.acctType === 'Business';
  var card = function(title, lang, sub) {
    return '<div class="rh-op-file" onclick="_rehashOpenGuide('+JSON.stringify(title).replace(/"/g,'&quot;')+')">'+
      icon('training')+'<div><b>'+lang+'</b><span>'+sub+'</span></div></div>';
  };
  return '<div class="rh-op">'+
    '<div class="rh-op-hd">'+icon('people')+'Business orders — send the Post Sale One Pager too</div>'+
    '<p class="rh-op-p">Send the Post Sale One Pager with the same group text, in whichever language the customer speaks. It covers billing reminders, tracking and activating devices, the trade-in process and fiber install expectations — the questions that otherwise come back to you as calls.</p>'+
    '<div class="rh-op-files">'+
      card(RH_GUIDE_EN, 'English', 'Open in Resources')+
      card(RH_GUIDE_ES, 'Espa&ntilde;ol', 'Abrir en Resources')+
    '</div>'+
    '<p class="rh-op-note">The One Pager lives under <b>Knowledge &rarr; Resources</b>, so every rep can read it in the portal. The VIP number printed on it (855 370 6941) is the <b>Business</b> line, which is why it is Business-only — a Consumer order uses 833 603 3270.</p>'+
    (biz
      ? '<div class="rh-op-flag on">'+icon('people')+'This order is set to <b>Business</b> — send the guide before you finish.</div>'
      : '<div class="rh-op-flag">This order is currently set to <b>Consumer</b>. The guide is for Business orders; switch Account Type on the Message tab if that is wrong.</div>')+
  '</div>';
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
  }
  // $150 gift card — Wireless CONSUMER only. Business orders do not get it (user, 2026-09-04),
  // so a Business text must not promise a redemption email that never comes.
  if (hasW && !isBiz) {
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
  // Trade-in is a WIRELESS thing — a Fiber-only or Air-only customer traded nothing in
  // (user, 2026-09-04). The blank line closes the block on whichever bullet came last.
  if (hasW) s.push('   • Trade-in credits (will be reimbursed)');
  s.push('');
  // The "$150 port credits" line was removed from every text 2026-09-04 (user) — do not re-add.
  s.push('2️⃣  Second Bill:');
  s.push('   • No more proration (only 30 days of service)');
  s.push('   • Delayed credits (not applied yet)', '');
  s.push('3️⃣  Third Bill:');
  s.push('   • Credit reimbursement');
  s.push('   • Credits from the 1st, 2nd, and 3rd bill all apply here', '');
  s.push('4️⃣  Fourth Bill:');
  s.push('   • The regular bill that was quoted', '');
  /* VOC (Voice of the Customer) survey — the user's framing, 2026-08-24, kept in substance:
     they may get a survey, fill it out as soon as it arrives, and it is about the REP.
     🔑 THE SCOPING SENTENCE IS THE POINT, NOT THE ASK. A customer who rates a slow UPS
     delivery or an install tech's arrival window is scoring the rep for something the rep
     could not affect — so naming what the survey is NOT about is what makes it fair.
     ⚠ Deliberately does not promise WHEN it arrives or that one is definitely coming — AT&T
     sends these, we do not, and a promise we cannot keep reads as a broken one. */
  s.push('⭐ A Quick Favor — AT&T May Send You a Survey');
  s.push('   • If one arrives, please fill it out as soon as you get it — they close fast');
  s.push('   • It is only about the service I gave you today, not delivery timing, install technicians, or anything outside my control');
  s.push('   • It takes about a minute and it genuinely helps me', '');
  s.push('———————————————————', '');
  s.push('Thank you again for choosing AT&T — we truly appreciate your business!');
  return s.join('\n');
}

// ── ACTIVATOR TEXT ────────────────────────────────────────────────────────
// Activator-side counterpart to Rehash Text: fill the order details once, pick the call
// type, copy the customer-facing message. CUSTOMER-FACING (addressed "Hi <first name>,"),
// with the sales rep's name + number included so the customer knows who to contact.
// Nothing is saved — no backend call; the account number only builds the message.
//
// ⚠ The per-type bodies in ATX_SCRIPTS are PLACEHOLDERS. The user is supplying the real
//   wording; drop it in verbatim rather than inventing a voice. Everything else — the
//   fields, the header/footer, the picker, copy-to-clipboard — is finished.
var ATX_TYPES = [
  { cat:'call', group:'Order issues', key:'payment',  label:'Pending Valid Payment' },
  { cat:'call', group:'Order issues', key:'porting',  label:'Porting Issue' },
  { cat:'call', group:'Order issues', key:'tcs',      label:'Missing T&Cs' },
  { cat:'call', group:'Order issues', key:'byod',     label:'BYOD Status' },
  { cat:'call', group:'Other calls',  key:'noanswer', label:'No Answer' },
  // Labelled to match the Call Logs tab it pairs with — "Delivery" alone reads like a
  // your-order-has-arrived message, which is NOT what this is.
  { cat:'call', group:'Other calls',  key:'delivery', label:'Delivered Not Active' },
  { cat:'call', group:'Other calls',  key:'fol',      label:'Fear of Loss' },
  { cat:'call', group:'Other calls',  key:'cancel',   label:'Cancellation / Disconnect' },
  { cat:'appt', group:'Appointment',  key:'confirm',  label:'Confirmation' },
  { cat:'appt', group:'Appointment',  key:'noshow',   label:'No Show' },
  { cat:'appt', group:'Appointment',  key:'apptcancel', label:'Cancellation' },
  { cat:'appt', group:'Appointment',  key:'wrapup',   label:'Wrap Up' }
];
// Types whose wording is MINE, not the user's — surfaced in the UI so nobody sends a draft
// believing it is approved copy. Delete a key here once its wording is signed off.
// Every message is now the user's own wording.
var ATX_DRAFT = {};
// The appointment messages quote an "Office Activation Number" — per office, and distinct
// from the VIP tower lines. Pre-fills the field for the activator's office; a blank entry
// just means they type it, and the message shows a visible [Office Activation Number]
// placeholder rather than a gap. Written in the same spaced style as the VIP numbers.
var ATX_OFFICE_NUMBER = {
  elevate:   '858 321 5699',
  viridian:  '314 789 1988',
  vanguard:  '813 524 7081',
  leadsphere:'417 429 7242',   // from Gabe, 2026-07-30
  evolution: '',   // ⏰ no call-in number yet — LeadSphere launched blank too
  revamped:  '',   // ⏰ ditto. Blank renders the [Office Activation Number] placeholder
  apexpremier: '', // ⏰ ditto — number is provisioned when the office starts taking calls (D-038)
  eaglespeak: ''   // ⏰ ditto — their QC line is in OFFICE_QC_NUMBER, which is NOT this number
};

/* An office's QUALITY CONTROL line — the number a rep adds to the Rehash GROUP TEXT so the
   office can step in on the thread. Read ONLY by _rehashOfficeNum(), which prefers it over
   ATX_OFFICE_NUMBER; an office with no entry here is unaffected.
   ⚠⚠ THIS IS NOT THE OFFICE ACTIVATION NUMBER and must not be merged into ATX_OFFICE_NUMBER.
   That map is read out to CUSTOMERS by the confirm / apptcancel / noshow / wrapup messages as
   "our Office Activation Number". Eagles' Peak has a QC line but its activation number is
   still unprovisioned (D-038), so those four messages correctly keep their placeholder. */
var OFFICE_QC_NUMBER = {
  eaglespeak: '832 820 2279'   // from the user, 2026-08-28
};

// key -> message body. Each entry is a function of the merge fields (see _atxFields) and
// returns the WHOLE message as an array of lines — these are conversational SMS, so there
// is no auto-appended header or details block. '' is a blank line.
//
// PROVENANCE: porting / noanswer / fol / delivery are the user's own templates, kept
// near-verbatim (only the activator name, rep, date and VIP number are merged in). The
// rest are drafts written to match that voice — see ATX_DRAFT.
var ATX_SCRIPTS = {
  // ── User's own wording ──
  porting: function(f) { return [
    'Hey, ' + f.activator + ' here from AT&T. I was calling in regard to the order placed recently. ' +
    'Upon reviewing your account there is a porting issue holding back the shipment of your devices. ' +
    'Please use the link https://www.att.com/portstatus/ to fix the port issue or call into our VIP tower ' +
    f.vip + ' to have it resolved with a live agent within two minutes. Please feel free to call or text me ' +
    'back for additional assistance.'
  ]; },
  noanswer: function(f) { return [
    'Hello ' + f.name + ', this is ' + f.activator + ' with AT&T Activation Support. I’m reaching out ' +
    'regarding the order you placed with ' + f.rep + ' on ' + f.date + '. We just wanted to check in and ' +
    'make sure you didn’t have any additional questions or concerns. If you did, or if you needed any ' +
    'assistance with setting up your devices, please just give us a text or call back.', '',
    'You can also book yourself an over-the-phone appointment for one of our specialists to reach out and ' +
    'assist:', f.bookUrl
  ]; },
  fol: function(f) { return [
    'Hi, this is ' + f.activator + ' with AT&T. I’m reaching out because our system is still showing ' +
    'your new device hasn’t been turned on or activated yet.', '',
    'If the phone isn’t activated soon, AT&T may flag it as lost or stolen, which can lead to the full ' +
    'retail cost of the device being charged to the account. We definitely want to help you avoid that.', '',
    'If you need any assistance, just let me know. I’m happy to walk you through the steps or set up a ' +
    'quick meeting to get everything activated for you.'
  ]; },
  // ⚠ NOT "your order has arrived". This is the DELIVERED-NOT-ACTIVE follow-up: the devices
  //   were delivered but nothing has been turned on yet. It is the gentle first nudge —
  //   `fol` below is the escalation that adds the lost/stolen warning. Keep them distinct.
  delivery: function(f) { return [
    'Hi ' + f.name + ', this is ' + f.activator + ' with AT&T. I’m following up on the new ' +
    f.deviceWord + ' you ordered with ' + f.rep + ' on ' + f.date + '. It looks like it has been ' +
    'delivered, but our system isn’t showing it as activated yet.', '',
    'If you’d like a hand getting it set up and switched over, just call or text me back and I’ll be ' +
    'glad to walk you through it — it usually only takes a few minutes.', '',
    'You can also book yourself an over-the-phone appointment for one of our specialists to reach out ' +
    'and assist:', f.bookUrl
  ]; },

  // ── Drafts, in the same voice (ATX_DRAFT) ──
  // "[Business or Consumer Tower Number]" in the source template -> f.vip, which already
  // follows the account-type toggle.
  payment: function(f) { return [
    'Hello ' + f.name + ', this is ' + f.activator + ' with AT&T Activation Support. I’m reaching out ' +
    'regarding the order you placed with ' + f.rep + ' on ' + f.date + '.', '',
    'It looks like we were unable to process the payment for your order. To avoid any delays, please ' +
    'reply to this text or give us a call at your earliest convenience. You can also reach us directly ' +
    'at ' + f.vip + ', and we’ll be happy to help get everything taken care of right away.', '',
    'Thank you, and we look forward to assisting you!'
  ]; },
  tcs: function(f) { return [
    'Hello ' + f.name + ', this is ' + f.activator + ' with AT&T Activation Support. I’m reaching out ' +
    'regarding the order you placed with ' + f.rep + ' on ' + f.date + '. We noticed that the Terms and ' +
    'Conditions for your order have not yet been accepted.', '',
    'To avoid your order being canceled, please note that the Terms and Conditions must be accepted ' +
    'within 72 hours of when your order was placed. If you believe you’ve already completed this step or ' +
    'you’re having any trouble, please reply to this text or give us a call. We’ll be happy to help you ' +
    'get everything completed. Thank you!'
  ]; },
  byod: function(f) { return [
    'Hi ' + f.name + ', this is ' + f.activator + ' with AT&T Activation Support. I was just trying to ' +
    'reach out regarding the phone(s) you had moved over with ' + f.rep + ' on ' + f.date + '. On our end ' +
    // ⚠ "HAS been turned off" — user-corrected. Port protection being ON is what blocks the
    //   transfer, so the original "hasn't" told customers to do the opposite of what is needed.
    'it seems they haven’t gone live yet. Please be sure that you have paid off those devices, and that ' +
    'the port protection has been turned off for the previous carrier. If you need assistance please ' +
    'give me a call back or call our VIP customer service line at ' + f.vip + '.'
  ]; },
  cancel: function(f) { return [
    'Hello ' + f.name + ', this is ' + f.activator + ' with AT&T Activation Support. I’m reaching out ' +
    'regarding the order you placed with ' + f.rep + ' on ' + f.date + '. We noticed the order was ' +
    'canceled and wanted to ask if there was anything about the process or your experience that led to ' +
    'your decision. We value your feedback and use it to improve our service. We appreciate any insight ' +
    'you’re willing to share. Thank you.'
  ]; },
  confirm: function(f) { return [
    'Hi, ' + f.name + '. This is ' + f.activator + ' with AT&T. I’m reaching out to confirm your ' +
    'appointment scheduled for ' + f.apptDate + ' at ' + f.apptTime + '. I just wanted to make sure this ' +
    'time still works for you.', '',
    'If anything has changed or you need to reschedule, simply reply to this message or call our Office ' +
    'Activation Number: ' + f.officeNumber + '. We’re happy to help. We look forward to speaking with you!'
  ]; },
  apptcancel: function(f) { return [
    'Hi, ' + f.name + '. This is ' + f.activator + ' with AT&T. I noticed your appointment has been ' +
    'canceled, and I wanted to check in to see if there was anything that led to your decision.', '',
    'If there’s anything I can assist with or if you’d like to reschedule for a more convenient time, ' +
    'I’d be happy to help. Just reply to this message or call our Office Activation Number: ' +
    f.officeNumber + '. We appreciate your feedback and hope to have the opportunity to assist you.'
  ]; },
  noshow: function(f) { return [
    'Hi, ' + f.name + '. This is ' + f.activator + ' with AT&T. I noticed we missed each other at your ' +
    'scheduled appointment today, so I wanted to check in and make sure everything is okay.', '',
    'If you’d still like to meet, I’d be happy to help you reschedule for a day and time that works best ' +
    'for you. Simply reply to this message or call our Office Activation Number: ' + f.officeNumber +
    ', and we’ll find a time that’s convenient. We look forward to hearing from you!'
  ]; },
  wrapup: function(f) { return [
    'Hi, ' + f.name + '. This is ' + f.activator + ' with AT&T. Thank you for taking the time to meet ' +
    'with me today. It was a pleasure speaking with you.', '',
    'If you have any questions about what we discussed or need additional assistance, please don’t ' +
    'hesitate to reply to this message or call our Office Activation Number: ' + f.officeNumber +
    '. We’re always happy to help.', '',
    'Thank you for choosing AT&T. We appreciate the opportunity to assist you and look forward to serving ' +
    'you again in the future. Have a wonderful day!'
  ]; }
};
var _ATX = null;
function _atxInit() {
  if (_ATX) return;
  _ATX = { cat:'call', type:'payment', accountNumber:'', repName:'', repPhone:'',
           // Wireless / Fiber / Air only — same set the reps' Rehash Text offers.
           products:{ Wireless:true, Fiber:false, Air:false },
           acctType:'Consumer', dateOfSale:_psOfficeToday(), custFirst:'', custInitial:'',
           // The activator signs the message ("this is Angel with AT&T"), so default to
           // whoever is logged in rather than making them type it every time.
           activator:(SESSION.name || '').split(' ')[0] || '',
           apptDate:'', apptTime:'',
           officeNumber:(ATX_OFFICE_NUMBER[(typeof CFG !== 'undefined' && CFG) ? CFG.officeId : ''] || '') };
}
function _atxTypeDef(key) {
  for (var i = 0; i < ATX_TYPES.length; i++) if (ATX_TYPES[i].key === key) return ATX_TYPES[i];
  return ATX_TYPES[0];
}
// Merge fields, each falling back to a visible [placeholder] so a half-filled message shows
// exactly what is still missing rather than a blank or a stray comma.
function _atxFields(d) {
  var sel = Object.keys(d.products || {}).filter(function(k){ return d.products[k]; });
  // Reads naturally mid-sentence ("the new cellphone you ordered"), which a raw product
  // list would not. Wireless is by far the common case.
  var deviceWord = 'device';
  if (sel.length === 1) {
    if (sel[0] === 'Wireless')   deviceWord = 'cellphone';
    else if (sel[0] === 'Fiber') deviceWord = 'Fiber service';
    else if (sel[0] === 'Air')   deviceWord = 'Internet Air service';
  } else if (sel.length > 1) { deviceWord = 'service'; }
  return {
    name:    (d.custFirst || '').trim() || '[Customer first name]',
    initial: (d.custInitial || '').trim().toUpperCase().slice(0, 1),
    acct:    (d.accountNumber || '').trim() || '[Account number]',
    rep:     (d.repName || '').trim() || '[Sales rep]',
    repPhone:(d.repPhone || '').trim() || '[Rep number]',
    date:    (d.dateOfSale || '').trim() || '[Date of sale]',
    activator:(d.activator || '').trim() || '[Your name]',
    apptDate:(d.apptDate || '').trim() || '[Date]',
    apptTime:(d.apptTime || '').trim() || '[Time]',
    officeNumber:(d.officeNumber || '').trim() || '[Office Activation Number]',
    // ⚠ sold / isBiz / initial are AVAILABLE BUT UNUSED by all 12 scripts:
    //   · sold + isBiz were superseded by _atxProductHeader (product title) and vip (segment)
    //   · initial: the user chose to drop the "Customer: Sarah M." line, matching the rehash
    //     text, which never restates the customer's own name — the form still collects it for
    //     the activator's on-screen reference.
    // Kept so a future pasted script can reference them without a code change.
    sold:    sel.length ? sel.join(' + ') : '[What was sold]',
    deviceWord: deviceWord,
    isBiz:   d.acctType === 'Business',
    vip:     d.acctType === 'Business' ? '855 370 6941' : '833 603 3270',
    // This office's public customer-booking page — same link the Appointments tab hands
    // out, so it is always the right one for whichever office the activator is in.
    bookUrl: (typeof CUSTOMER_BOOKING_URL !== 'undefined' ? CUSTOMER_BOOKING_URL : 'https://activationsupport.github.io/book.html') +
             '?office=' + encodeURIComponent((typeof CFG !== 'undefined' && CFG && CFG.officeId) ? CFG.officeId : ''),
    typeLabel: _atxTypeDef(d.type).label
  };
}
// Account number, what was sold and the rep's direct number are referenced by none of the 12
// scripts, so they are appended after the prose (the scripts each open with their own
// greeting, so a rehash-style block at the TOP would greet the customer twice).
//
// Deliberately mirrors the reps' Rehash Text: same emoji product title, same field labels
// ("Account number:" / "Order date:" / "Sales Rep:") and the same separator — a customer who
// got the rehash at point of sale then sees one consistent format in every follow-up.
// Like the rehash, it does NOT restate the customer's own name back to them.
function _atxProductHeader(d) {
  var P = d.products || {};
  var sel = [];
  if (P.Wireless) sel.push('Wireless');
  if (P.Fiber)    sel.push('Fiber');
  if (P.Air)      sel.push('Internet Air');
  if (!sel.length) return '📋 YOUR AT&T ORDER';
  if (sel.length === 1) {
    var ic = P.Wireless ? '📱' : P.Air ? '📡' : '🌐';
    return ic + ' YOUR ' + sel[0].toUpperCase() + ' ORDER';
  }
  return '📋 YOUR AT&T ORDER — ' + sel.join(' + ');
}
function _atxDetailsBlock(f, d) {
  return ['', '———————————————————', '',
    _atxProductHeader(d),
    'Account number: ' + f.acct,
    'Order date: ' + f.date,
    'Sales Rep: ' + f.rep + ' — ' + f.repPhone];
}
// The script supplies the prose; the details block is appended to every message.
function _atxText(d) {
  var f = _atxFields(d);
  var body = ATX_SCRIPTS[d.type];
  if (typeof body === 'function') body = body(f, d);
  if (typeof body === 'string' && body) body = [body];
  if (!Array.isArray(body)) {
    body = ['[ ' + f.typeLabel.toUpperCase() + ' — no wording added yet ]', '',
            'Add it to ATX_SCRIPTS.' + d.type + '.'];
  }
  return body.concat(_atxDetailsBlock(f, d)).join('\n');
}
function renderActivatorTextTab() {
  _atxInit();
  var d = _ATX;
  var catTog = function(v, label) {
    return '<div class="ps-toggle' + (d.cat === v ? ' active' : '') + '" onclick="_atxSetCat(\'' + v + '\')">' + esc(label) + '</div>';
  };
  var acctTog = function(v) {
    return '<div class="ps-toggle' + (d.acctType === v ? ' active' : '') + '" onclick="_atxPick(\'acctType\',\'' + v + '\')">' + v + '</div>';
  };
  var prodTog = function(v) {
    return '<div class="ps-toggle' + (d.products[v] ? ' active' : '') + '" onclick="_atxToggleProduct(\'' + v + '\')">' + v + '</div>';
  };
  // Type picker, grouped, showing only the active category.
  var picker = '', lastGroup = null;
  ATX_TYPES.filter(function(t){ return t.cat === d.cat; }).forEach(function(t) {
    if (t.group !== lastGroup) {
      if (lastGroup !== null) picker += '</div>';
      picker += '<div class="ps-label">' + esc(t.group.toUpperCase()) + '</div><div class="ps-toggle-row" style="flex-wrap:wrap">';
      lastGroup = t.group;
    }
    picker += '<div class="ps-toggle' + (d.type === t.key ? ' active' : '') + '" onclick="_atxPick(\'type\',\'' + t.key + '\')">' + esc(t.label) + '</div>';
  });
  if (lastGroup !== null) picker += '</div>';
  var missing = !ATX_SCRIPTS[d.type], isDraft = !!ATX_DRAFT[d.type];
  return '<div class="card"><div class="card-header dark">' + icon('smartphone') + ' Activator Text</div><div class="card-body">' +
    '<div style="font-size:.85rem;color:var(--text2);margin-bottom:16px;line-height:1.5">Fill in the order once, pick the call type, then tap <b>Copy Text</b> and send it to the customer. Nothing here is saved — the account number is used only to build the message.</div>' +
    (missing ? '<div style="border:1px solid var(--yellow);border-radius:8px;padding:9px 12px;margin-bottom:14px;background:rgba(240,180,41,.10);font-size:.83rem">' +
        '<b style="color:var(--yellow)">No wording yet for “' + esc(_atxTypeDef(d.type).label) + '”.</b></div>'
     : isDraft ? '<div style="border:1px solid var(--yellow);border-radius:8px;padding:9px 12px;margin-bottom:14px;background:rgba(240,180,41,.10);font-size:.83rem">' +
        '<b style="color:var(--yellow)">Draft wording.</b> “' + esc(_atxTypeDef(d.type).label) + '” was written to match your other templates — read it before sending, and tell me what to change.</div>' : '') +
    '<div class="ps-toggle-row" style="margin-bottom:4px">' + catTog('call', 'Call Text') + catTog('appt', 'Appointment Text') + '</div>' +
    picker +
    '<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;margin-top:14px">' +
      '<div style="flex:1 1 240px;min-width:220px">' +
        '<div class="ps-label" style="margin-top:0">YOUR NAME &mdash; how you sign the text</div>' +
        '<input class="ps-input" value="' + esc(d.activator) + '" placeholder="Angel" oninput="_atxSet(\'activator\',this.value)">' +
        '<div class="ps-label">ACCOUNT NUMBER</div>' +
        '<input class="ps-input" value="' + esc(d.accountNumber) + '" placeholder="Used only for this text — not saved" oninput="_atxSet(\'accountNumber\',this.value)">' +
        '<div class="ps-label">CUSTOMER FIRST NAME</div>' +
        '<input class="ps-input" value="' + esc(d.custFirst) + '" placeholder="First name" oninput="_atxSet(\'custFirst\',this.value)">' +
        '<div class="ps-label">CUSTOMER LAST INITIAL</div>' +
        '<input class="ps-input" maxlength="1" style="max-width:90px" value="' + esc(d.custInitial) + '" placeholder="M" oninput="_atxSet(\'custInitial\',this.value)">' +
        '<div class="ps-label">SALES REP</div>' +
        '<input class="ps-input" value="' + esc(d.repName) + '" placeholder="Rep name" oninput="_atxSet(\'repName\',this.value)">' +
        '<div class="ps-label">SALES REP NUMBER</div>' +
        '<input class="ps-input" type="tel" value="' + esc(d.repPhone) + '" placeholder="555-123-4567" oninput="_atxSet(\'repPhone\',this.value)">' +
      '</div>' +
      '<div style="flex:1 1 240px;min-width:220px">' +
        '<div class="ps-label" style="margin-top:0">WHAT WAS SOLD &mdash; select all that apply</div>' +
        '<div class="ps-toggle-row" style="flex-wrap:wrap">' + prodTog('Wireless') + prodTog('Fiber') + prodTog('Air') + '</div>' +
        '<div class="ps-label">ACCOUNT TYPE</div>' +
        '<div class="ps-toggle-row">' + acctTog('Consumer') + acctTog('Business') + '</div>' +
        '<div class="ps-label">DATE OF SALE</div>' +
        '<input class="ps-input" type="date" value="' + esc(d.dateOfSale) + '" onchange="_atxSet(\'dateOfSale\',this.value)">' +
        // All four appointment messages quote the office number; only Confirmation names a
        // date and time, so those two only appear for it.
        (d.cat === 'appt' ?
          '<div class="ps-label">OFFICE ACTIVATION NUMBER</div>' +
          '<input class="ps-input" type="tel" value="' + esc(d.officeNumber) + '" placeholder="Your office activation line" oninput="_atxSet(\'officeNumber\',this.value)">' +
          // Offices without a configured number would otherwise look like the field was
          // simply left empty by mistake.
          (!(ATX_OFFICE_NUMBER[(typeof CFG !== 'undefined' && CFG) ? CFG.officeId : ''] || '')
            ? '<div style="font-size:.75rem;color:var(--yellow);margin-top:4px">Not set up for this office yet — type it in, and it will pre-fill once it is added.</div>' : '') : '') +
        (d.type === 'confirm' ?
          '<div class="ps-label">APPOINTMENT DATE</div>' +
          '<input class="ps-input" value="' + esc(d.apptDate) + '" placeholder="Thursday, July 30" oninput="_atxSet(\'apptDate\',this.value)">' +
          '<div class="ps-label">APPOINTMENT TIME</div>' +
          '<input class="ps-input" value="' + esc(d.apptTime) + '" placeholder="2:00 PM" oninput="_atxSet(\'apptTime\',this.value)">' : '') +
      '</div>' +
      '<div style="flex:1.6 1 300px;min-width:260px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;gap:10px;flex-wrap:wrap">' +
          '<span class="ps-label" style="margin:0">MESSAGE PREVIEW</span>' +
          '<button class="ps-btn" onclick="_atxCopy(this)">' + icon('copy') + ' Copy Text</button>' +
        '</div>' +
        '<textarea id="atx-preview" readonly style="width:100%;min-height:420px;box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;line-height:1.5;padding:14px;white-space:pre-wrap;resize:vertical">' + esc(_atxText(d)) + '</textarea>' +
      '</div>' +
    '</div>' +
  '</div></div>';
}
// Typing only refreshes the preview — a repaint would steal focus from the input.
function _atxSet(field, val) {
  _atxInit(); _ATX[field] = val;
  var t = document.getElementById('atx-preview'); if (t) t.value = _atxText(_ATX);
}
function _atxPick(field, val) { _atxInit(); _ATX[field] = val; _atxRepaint(); }
function _atxSetCat(cat) {
  _atxInit(); _ATX.cat = cat;
  // Land on the first type of the newly selected category, so the preview never shows a
  // message belonging to the tab you just left.
  var first = ATX_TYPES.filter(function(t){ return t.cat === cat; })[0];
  if (first) _ATX.type = first.key;
  _atxRepaint();
}
function _atxToggleProduct(v) {
  _atxInit();
  var p = _ATX.products, on = Object.keys(p).filter(function(k){ return p[k]; });
  if (p[v] && on.length === 1) return;   // keep at least one selected
  p[v] = !p[v];
  _atxRepaint();
}
function _atxRepaint() { var c = document.getElementById('main-content'); if (c) c.innerHTML = renderActivatorTextTab(); }
function _atxCopy(btn) {
  var t = document.getElementById('atx-preview'); if (!t) return;
  t.select(); t.setSelectionRange(0, 999999);
  var done = function() {
    var old = btn.innerHTML; btn.innerHTML = icon('completed') + ' Copied';
    setTimeout(function(){ btn.innerHTML = old; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t.value).then(done, function(){ try { document.execCommand('copy'); done(); } catch(e) {} });
  } else { try { document.execCommand('copy'); done(); } catch(e) {} }
}

// ── FIRST BILL CALCULATOR ───────────────────────────────────────────────────
// Quick, rough estimate of a customer's first AT&T bill (no taxes/fees) — matches the
// billing explanation already sent in the Rehash text ("First Bill — starts higher due
// to proration [31-60 days of service] + activation fees"). AT&T bills wireless one month
// IN ADVANCE, so the first bill = 30 days billed forward + a 15-day partial = 1.5x the
// monthly plan charge. That plan charge is PER LINE, so it scales with the line count:
// per-line rate x lines x 1.5. The $35 activation fee is likewise per line (AT&T's fee
// schedule reads "Activation/upgrade fee per line"), and is charged in full on the first
// bill even though AT&T typically credits it back on a later bill, not this one. Device
// installments are NOT prorated (full amount from day one) and are entered as a single
// total for all devices. Next Up Anytime is account-level, a flat $10/mo. Nothing is saved.
//
// The plan prices below are PRE-discount rate-plan cost, which is what the first bill
// actually charges — AT&T's AutoPay/paperless and smartphone-line discounts arrive as bill
// credits that don't land for up to 2 bills, so they are correctly absent here.
//
// Plan prices per-line by line-count tier, read off the mst.att.com quote bars (2026-07-27).
// BOTH segments now top out at "4+" — Business used to be modelled as 1/2/3/4/5/6+, but MST
// only breaks it out to 4+, and _fbcTier() falls through to the last tier for anything above.
// ⚠ Business "Premium with Turbo" no longer exists — it is now **Ultimate**, and it is
//   dearer than the old entry at every tier ($110/100/85/75 vs $95/85/70/65), so quotes
//   built before 2026-07-27 understated that plan by $15-45 per line before the 1.5x.
var FBC_PLANS = {
  consumer: {
    label: 'AT&T Unlimited', lineTiers: ['1','2','3','4+'], order: ['Elite','Premium','Extra','Value'],
    prices: {
      '1':  { Elite:110, Premium:90, Extra:70, Value:50 },
      '2':  { Elite:100, Premium:80, Extra:60, Value:45 },
      '3':  { Elite:85,  Premium:65, Extra:50, Value:35 },
      '4+': { Elite:70,  Premium:50, Extra:40, Value:30 }
    }
  },
  business: {
    label: 'AT&T Business', lineTiers: ['1','2','3','4+'], order: ['Ultimate','Premium','Advanced','Standard'],
    prices: {
      '1':  { Ultimate:110, Premium:85, Advanced:70, Standard:50 },
      '2':  { Ultimate:100, Premium:75, Advanced:60, Standard:45 },
      '3':  { Ultimate:85,  Premium:60, Advanced:50, Standard:35 },
      '4+': { Ultimate:75,  Premium:50, Advanced:40, Standard:30 }
    }
  }
};
// Smartphone / Tablet / Wearable / Hotspot (2026-07-27): straight from the mst.att.com
// catalogue, so make/model AND the price are MST's own — no more hand-matching against
// att.com, and every row is priced.
//
// Every category is now MST-sourced. The Inseego Wavemaker FX4200 is an AIA device (user-
// confirmed), not a hotspot, so build-mst.js classifies it with an explicit rule:
//   node build-mst.js mst-wearables-hotspots-2026-07-27.txt "Wearable=/watch/i,AIA=/wavemaker/i,Hotspot=*" --write
// ⚠ That rebuild dropped the old hand-matched "Emblem AIA 5G Gateway - NCM112 - White"
//   (absent from MST's list and never priced). Re-add it here if it is still sold.
//
// installment = MSRP / 36 (AT&T's standard no-interest term), taken VERBATIM from the MST
// workbook's own Installment column — the portal rounds UP to the cent, and the older
// list-view builder used Math.round, which left 93 devices a cent light.
//
// 2026-08-27: ONE ROW PER CAPACITY (464 rows / 254 models). The old catalogue carried only
// the "MSRP from" base-storage price, so a 512GB quote read low; that limit is gone.
// ⚠ STILL MSRP, NOT the dealer rack rate (confidential). Rack rates must NOT be committed
//   to this PUBLIC repo — they belong in the private Sheet. The workbook export does NOT
//   contain them, so importing it did not resolve this.
// ⚠ Deliberately NOT imported from the workbook: EIP 24/30/36, 2-yr and 3-yr contract
//   prices, and bill codes. Those are the portal's Business-Pricing-view figures and
//   internal SKUs; none are needed to estimate a first bill, and this repo is PUBLIC.
//
// To refresh: export the MST workbook, then from _private/device-catalog/
//   python mst_xlsx_profile.py <file.xlsx>      # writes mst_xlsx_rows.json + a diff report
//   node   build-mst-xlsx.js --write            # preview without --write
// (build-mst.js still parses the portal's LIST view, but that only exposes base storage.)
var FBC_DEVICES = [
  { category:"AIA", make:"Inseego", model:"Wavemaker FX4200", storage:"", installment:24.98 },
  { category:"Hotspot", make:"AT&T", model:"Franklin A10", storage:"256MB", installment:2.23 },
  { category:"Hotspot", make:"AT&T", model:"Franklin A50", storage:"1GB", installment:5.84 },
  { category:"Hotspot", make:"AT&T", model:"Franklin A70", storage:"1GB", installment:5.84 },
  { category:"Hotspot", make:"AT&T", model:"GoLink 5G Hotspot", storage:"2GB", installment:2.5 },
  { category:"Hotspot", make:"AT&T", model:"Turbo Hotspot 2", storage:"", installment:2.23 },
  { category:"Hotspot", make:"AT&T", model:"Unite Express 2", storage:"", installment:4.03 },
  { category:"Hotspot", make:"AT&T", model:"Wireless Internet Data Only", storage:"", installment:5.56 },
  { category:"Hotspot", make:"NETGEAR®", model:"Nighthawk 5G Mobile Hotspot Pro", storage:"", installment:14.17 },
  { category:"Hotspot", make:"NETGEAR®", model:"Nighthawk M6", storage:"", installment:8.62 },
  { category:"Hotspot", make:"NETGEAR®", model:"Nighthawk M6 Pro", storage:"", installment:12.78 },
  { category:"Hotspot", make:"NETGEAR®", model:"Nighthawk® LTE Mobile Hotspot Router", storage:"", installment:6.95 },
  { category:"Hotspot", make:"NETGEAR®", model:"Nighthawk® M7 PRO HOTSPOT", storage:"", installment:12.5 },
  { category:"Smartphone", make:"Alcatel", model:"SMARTFLIP", storage:"", installment:1.95 },
  { category:"Smartphone", make:"Apple", model:"iPhone 12", storage:"64GB", installment:17.5 },
  { category:"Smartphone", make:"Apple", model:"iPhone 12", storage:"128GB", installment:18.89 },
  { category:"Smartphone", make:"Apple", model:"iPhone 12", storage:"256GB", installment:21.67 },
  { category:"Smartphone", make:"Apple", model:"iPhone 12 mini", storage:"64GB", installment:17.5 },
  { category:"Smartphone", make:"Apple", model:"iPhone 12 mini", storage:"128GB", installment:18.89 },
  { category:"Smartphone", make:"Apple", model:"iPhone 12 mini", storage:"256GB", installment:21.67 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13", storage:"128GB", installment:17.5 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13", storage:"256GB", installment:20.28 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13", storage:"512GB", installment:25.84 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 mini", storage:"128GB", installment:17.5 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 mini", storage:"256GB", installment:20.28 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 mini", storage:"512GB", installment:25.84 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 Pro", storage:"128GB", installment:25 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 Pro", storage:"256GB", installment:27.78 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 Pro", storage:"512GB", installment:33.34 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 Pro", storage:"1TB", installment:38.89 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 Pro Max", storage:"128GB", installment:27.78 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 Pro Max", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 Pro Max", storage:"512GB", installment:36.12 },
  { category:"Smartphone", make:"Apple", model:"iPhone 13 Pro Max", storage:"1TB", installment:41.67 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14", storage:"128GB", installment:17.5 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14", storage:"256GB", installment:20.28 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14", storage:"512GB", installment:25.84 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Plus", storage:"128GB", installment:20.28 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Plus", storage:"256GB", installment:23.06 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Plus", storage:"512GB", installment:28.62 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Pro", storage:"128GB", installment:25 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Pro", storage:"256GB", installment:27.78 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Pro", storage:"512GB", installment:33.34 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Pro", storage:"1TB", installment:38.89 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Pro Max", storage:"128GB", installment:27.78 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Pro Max", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Pro Max", storage:"512GB", installment:36.12 },
  { category:"Smartphone", make:"Apple", model:"iPhone 14 Pro Max", storage:"1TB", installment:41.67 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15", storage:"128GB", installment:17.5 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15", storage:"256GB", installment:20.28 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15", storage:"512GB", installment:25.84 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Plus", storage:"128GB", installment:20.28 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Plus", storage:"256GB", installment:25.84 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Plus", storage:"512GB", installment:31.39 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Pro", storage:"128GB", installment:25 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Pro", storage:"256GB", installment:27.78 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Pro", storage:"512GB", installment:33.34 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Pro", storage:"1TB", installment:38.89 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Pro Max", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Pro Max", storage:"512GB", installment:36.12 },
  { category:"Smartphone", make:"Apple", model:"iPhone 15 Pro Max", storage:"1TB", installment:41.67 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16", storage:"128GB", installment:20.28 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16", storage:"256GB", installment:23.06 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16", storage:"512GB", installment:28.62 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Plus", storage:"128GB", installment:23.06 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Plus", storage:"256GB", installment:25.84 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Plus", storage:"512GB", installment:31.39 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Pro", storage:"128GB", installment:25 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Pro", storage:"256GB", installment:27.78 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Pro", storage:"512GB", installment:33.34 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Pro", storage:"1TB", installment:38.89 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Pro Max", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Pro Max", storage:"512GB", installment:36.12 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16 Pro Max", storage:"1TB", installment:41.67 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16e", storage:"128GB", installment:16.67 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16e", storage:"256GB", installment:19.45 },
  { category:"Smartphone", make:"Apple", model:"iPhone 16e", storage:"512GB", installment:25 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17", storage:"256GB", installment:23.06 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17", storage:"512GB", installment:28.62 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17 Pro", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17 Pro", storage:"512GB", installment:36.12 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17 Pro", storage:"1TB", installment:41.67 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17 Pro Max", storage:"256GB", installment:33.34 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17 Pro Max", storage:"512GB", installment:38.89 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17 Pro Max", storage:"1TB", installment:44.45 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17 Pro Max", storage:"2TB", installment:55.56 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17e", storage:"256GB", installment:16.67 },
  { category:"Smartphone", make:"Apple", model:"iPhone 17e", storage:"512GB", installment:22.23 },
  { category:"Smartphone", make:"Apple", model:"iPhone 7 Plus", storage:"128GB", installment:12.5 },
  { category:"Smartphone", make:"Apple", model:"iPhone Air", storage:"256GB", installment:27.78 },
  { category:"Smartphone", make:"Apple", model:"iPhone Air", storage:"512GB", installment:33.34 },
  { category:"Smartphone", make:"Apple", model:"iPhone Air", storage:"1TB", installment:38.89 },
  { category:"Smartphone", make:"Apple", model:"iPhone SE (2020)", storage:"64GB", installment:5.56 },
  { category:"Smartphone", make:"Apple", model:"iPhone SE (2020)", storage:"128GB", installment:12.5 },
  { category:"Smartphone", make:"Apple", model:"iPhone SE (2020)", storage:"256GB", installment:15.28 },
  { category:"Smartphone", make:"Apple", model:"iPhone SE 5G (2022)", storage:"64GB", installment:11.95 },
  { category:"Smartphone", make:"Apple", model:"iPhone SE 5G (2022)", storage:"128GB", installment:13.34 },
  { category:"Smartphone", make:"Apple", model:"iPhone SE 5G (2022)", storage:"256GB", installment:16.12 },
  { category:"Smartphone", make:"Apple", model:"iPhone XR", storage:"64GB", installment:13.89 },
  { category:"Smartphone", make:"Apple", model:"iPhone XR", storage:"128GB", installment:15.28 },
  { category:"Smartphone", make:"Apple", model:"iPhone XS", storage:"64GB", installment:25 },
  { category:"Smartphone", make:"Apple", model:"iPhone XS", storage:"256GB", installment:29.17 },
  { category:"Smartphone", make:"Apple", model:"iPhone XS", storage:"512GB", installment:34.73 },
  { category:"Smartphone", make:"Apple", model:"iPhone XS Max", storage:"64GB", installment:27.78 },
  { category:"Smartphone", make:"Apple", model:"iPhone XS Max", storage:"256GB", installment:31.95 },
  { category:"Smartphone", make:"Apple", model:"iPhone XS Max", storage:"512GB", installment:37.5 },
  { category:"Smartphone", make:"AT&T", model:"amiGO™ Jr Phone", storage:"", installment:7.23 },
  { category:"Smartphone", make:"AT&T", model:"Calypso", storage:"", installment:2.48 },
  { category:"Smartphone", make:"AT&T", model:"Calypso 2", storage:"", installment:2.5 },
  { category:"Smartphone", make:"AT&T", model:"Cingular Flip IV", storage:"", installment:1.75 },
  { category:"Smartphone", make:"AT&T", model:"Fusion Z", storage:"", installment:2.23 },
  { category:"Smartphone", make:"Crosscall", model:"CORE P6 PTT", storage:"", installment:14.73 },
  { category:"Smartphone", make:"Google", model:"Pixel 10", storage:"128GB", installment:23.62 },
  { category:"Smartphone", make:"Google", model:"Pixel 10 Pro", storage:"128GB", installment:29.17 },
  { category:"Smartphone", make:"Google", model:"Pixel 10 Pro", storage:"256GB", installment:31.95 },
  { category:"Smartphone", make:"Google", model:"Pixel 10 Pro XL", storage:"256GB", installment:34.73 },
  { category:"Smartphone", make:"Google", model:"Pixel 10 Pro XL", storage:"512GB", installment:38.34 },
  { category:"Smartphone", make:"Google", model:"Pixel 10a", storage:"", installment:14.45 },
  { category:"Smartphone", make:"Google", model:"Pixel 11", storage:"256GB", installment:26.12 },
  { category:"Smartphone", make:"Google", model:"Pixel 11 Pro", storage:"256GB", installment:31.95 },
  { category:"Smartphone", make:"Google", model:"Pixel 11 Pro", storage:"512GB", installment:35.56 },
  { category:"Smartphone", make:"Google", model:"Pixel 11 Pro XL", storage:"256GB", installment:37.5 },
  { category:"Smartphone", make:"Google", model:"Pixel 11 Pro XL", storage:"512GB", installment:41.12 },
  { category:"Smartphone", make:"Google", model:"Pixel 4a (5G)", storage:"", installment:14.59 },
  { category:"Smartphone", make:"Google", model:"Pixel 5", storage:"", installment:20.14 },
  { category:"Smartphone", make:"Google", model:"Pixel 6a", storage:"128GB", installment:13.06 },
  { category:"Smartphone", make:"Google", model:"Pixel 7", storage:"128GB", installment:20.56 },
  { category:"Smartphone", make:"Google", model:"Pixel 7", storage:"256GB", installment:23.34 },
  { category:"Smartphone", make:"Google", model:"Pixel 7 Pro", storage:"128GB", installment:26.12 },
  { category:"Smartphone", make:"Google", model:"Pixel 7 Pro", storage:"256GB", installment:28.89 },
  { category:"Smartphone", make:"Google", model:"Pixel 7a", storage:"128GB", installment:14.45 },
  { category:"Smartphone", make:"Google", model:"Pixel 8", storage:"128GB", installment:23.34 },
  { category:"Smartphone", make:"Google", model:"Pixel 8", storage:"256GB", installment:25 },
  { category:"Smartphone", make:"Google", model:"Pixel 8 Pro", storage:"128GB", installment:28.89 },
  { category:"Smartphone", make:"Google", model:"Pixel 8 Pro", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Google", model:"Pixel 8a", storage:"128GB", installment:14.45 },
  { category:"Smartphone", make:"Google", model:"Pixel 9", storage:"128GB", installment:23.62 },
  { category:"Smartphone", make:"Google", model:"Pixel 9", storage:"256GB", installment:26.39 },
  { category:"Smartphone", make:"Google", model:"Pixel 9 Pro", storage:"128GB", installment:29.17 },
  { category:"Smartphone", make:"Google", model:"Pixel 9 Pro", storage:"256GB", installment:31.95 },
  { category:"Smartphone", make:"Google", model:"Pixel 9 Pro XL", storage:"256GB", installment:34.73 },
  { category:"Smartphone", make:"Google", model:"Pixel 9 Pro XL", storage:"512GB", installment:38.34 },
  { category:"Smartphone", make:"Google", model:"Pixel 9a", storage:"128GB", installment:14.45 },
  { category:"Smartphone", make:"Google", model:"Pixel Fold", storage:"256GB", installment:52.23 },
  { category:"Smartphone", make:"Google", model:"Pixel Fold", storage:"512GB", installment:55 },
  { category:"Smartphone", make:"Kyocera", model:"DuraForce PRO 2", storage:"", installment:12.5 },
  { category:"Smartphone", make:"Kyocera", model:"DuraXE", storage:"", installment:7.5 },
  { category:"Smartphone", make:"Kyocera", model:"DuraXE EPIC", storage:"", installment:7.5 },
  { category:"Smartphone", make:"LG", model:"K92 5G", storage:"", installment:10.98 },
  { category:"Smartphone", make:"LG", model:"V60 ThinQ™ 5G", storage:"", installment:25 },
  { category:"Smartphone", make:"LG", model:"Velvet 5G", storage:"128GB", installment:16.67 },
  { category:"Smartphone", make:"LG", model:"WING 5G", storage:"", installment:29.17 },
  { category:"Smartphone", make:"Microsoft", model:"Surface Duo", storage:"128GB", installment:19.45 },
  { category:"Smartphone", make:"Microsoft", model:"Surface Duo", storage:"256GB", installment:20.84 },
  { category:"Smartphone", make:"Motorola", model:"edge - 2022", storage:"", installment:13.89 },
  { category:"Smartphone", make:"Motorola", model:"Edge 2026", storage:"", installment:14.03 },
  { category:"Smartphone", make:"Motorola", model:"moto g 2026", storage:"", installment:6.67 },
  { category:"Smartphone", make:"Motorola", model:"moto g 5G (2022)", storage:"", installment:4.17 },
  { category:"Smartphone", make:"Motorola", model:"Moto G Stylus 2025", storage:"256GB", installment:8.2 },
  { category:"Smartphone", make:"Motorola", model:"moto g stylus 5G", storage:"128GB", installment:6.95 },
  { category:"Smartphone", make:"Motorola", model:"moto g stylus 5G 2022", storage:"128GB", installment:8.34 },
  { category:"Smartphone", make:"Motorola", model:"moto g stylus 5G 2023", storage:"128GB", installment:8.34 },
  { category:"Smartphone", make:"Motorola", model:"moto g stylus 5G 2024", storage:"128GB", installment:8.2 },
  { category:"Smartphone", make:"Motorola", model:"One 5G", storage:"128GB", installment:12.37 },
  { category:"Smartphone", make:"Motorola", model:"One 5G ACE", storage:"", installment:5.56 },
  { category:"Smartphone", make:"Motorola", model:"razr", storage:"", installment:38.89 },
  { category:"Smartphone", make:"Motorola", model:"razr - 2023", storage:"", installment:18.34 },
  { category:"Smartphone", make:"Motorola", model:"Razr Ultra", storage:"", installment:36.67 },
  { category:"Smartphone", make:"Motorola", model:"Razr+", storage:"", installment:27.78 },
  { category:"Smartphone", make:"Motorola", model:"razr+ 2024", storage:"", installment:27.78 },
  { category:"Smartphone", make:"Motorola", model:"Razr+ 2025", storage:"", installment:27.78 },
  { category:"Smartphone", make:"Motorola", model:"Razr+ 2026", storage:"", installment:29.03 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A02s", storage:"", installment:3.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A03s", storage:"", installment:3.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A12", storage:"", installment:5 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A13 (LTE)", storage:"", installment:5.28 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A13 5G", storage:"", installment:6.95 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A14 5G", storage:"64GB", installment:5 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A15 5g", storage:"256GB", installment:5.56 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A16 5g", storage:"128GB", installment:5.56 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A17 5g", storage:"", installment:6.95 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A23 5G", storage:"64GB", installment:8.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A32 5G", storage:"64GB", installment:7.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A35 5G", storage:"128GB", installment:11.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A36 5G", storage:"128GB", installment:11.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A37 5G", storage:"", installment:12.5 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A52 5G", storage:"", installment:13.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A53 5G", storage:"", installment:12.5 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A54 5G", storage:"", installment:12.5 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy A57 5G", storage:"", installment:15.28 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Fold", storage:"", installment:55 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Note10+ 5G", storage:"512GB", installment:38.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Note20 5G", storage:"128GB", installment:27.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Note20 Ultra 5G", storage:"128GB", installment:33.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Note20 Ultra 5G", storage:"512GB", installment:40.28 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S10", storage:"128GB", installment:20.84 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S10", storage:"512GB", installment:20.84 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S10+", storage:"128GB", installment:23.62 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S10+", storage:"512GB", installment:23.62 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S10+", storage:"1TB", installment:23.62 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S10e", storage:"128GB", installment:16.67 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S10e", storage:"256GB", installment:16.67 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S20 5G", storage:"128GB", installment:27.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S20 FE 5G", storage:"128GB", installment:16.67 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S20 FE 5G", storage:"256GB", installment:21.39 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S20 Ultra 5G", storage:"128GB", installment:38.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S20 Ultra 5G", storage:"512GB", installment:44.45 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S20+ 5G", storage:"128GB", installment:33.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S21 5G", storage:"128GB", installment:22.23 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S21 5G", storage:"256GB", installment:23.62 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S21+ 5G", storage:"128GB", installment:27.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S21+ 5G", storage:"256GB", installment:29.17 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S22", storage:"128GB", installment:19.45 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S22", storage:"256GB", installment:23.62 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S22 +", storage:"128GB", installment:27.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S22 +", storage:"256GB", installment:29.17 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S22 Ultra", storage:"128GB", installment:33.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S22 Ultra", storage:"256GB", installment:36.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S22 Ultra", storage:"512GB", installment:38.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S23", storage:"128GB", installment:22.23 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S23", storage:"256GB", installment:23.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S23 FE", storage:"", installment:16.67 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S23 Ultra", storage:"256GB", installment:33.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S23 Ultra", storage:"512GB", installment:38.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S23+", storage:"256GB", installment:27.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S23+", storage:"512GB", installment:31.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S24", storage:"128GB", installment:19.45 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S24", storage:"256GB", installment:23.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S24 FE", storage:"128GB", installment:18.06 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S24 Ultra", storage:"256GB", installment:36.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S24 Ultra", storage:"512GB", installment:39.45 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S24+", storage:"256GB", installment:27.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S24+", storage:"512GB", installment:31.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S25", storage:"128GB", installment:22.23 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S25", storage:"256GB", installment:23.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S25 Edge", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S25 Edge", storage:"512GB", installment:33.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S25 FE", storage:"128GB", installment:18.06 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S25 Ultra", storage:"256GB", installment:36.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S25 Ultra", storage:"512GB", installment:39.45 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S25+", storage:"256GB", installment:27.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S25+", storage:"512GB", installment:31.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S26", storage:"256GB", installment:25 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S26", storage:"512GB", installment:30.56 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S26 Plus", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S26 Plus", storage:"512GB", installment:36.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S26 Ultra", storage:"256GB", installment:36.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S26 Ultra", storage:"512GB", installment:41.67 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S26 Ultra", storage:"1TB", installment:50 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S9", storage:"", installment:13.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy S9+", storage:"", installment:19.45 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy XCover FieldPro", storage:"64GB", installment:30.7 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy XCover Pro", storage:"64GB", installment:14.17 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy XCover6 Pro", storage:"128GB", installment:16.67 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy XCover7 Pro", storage:"128GB", installment:16.67 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip 5G", storage:"", installment:33.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip4", storage:"128GB", installment:27.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip4", storage:"256GB", installment:29.45 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip5", storage:"256GB", installment:27.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip5", storage:"512GB", installment:31.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip6", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip6", storage:"512GB", installment:33.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip7", storage:"256GB", installment:30.56 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip7", storage:"512GB", installment:33.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip8", storage:"256GB", installment:33.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Flip8", storage:"512GB", installment:38.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold2 5G", storage:"", installment:50 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold4", storage:"256GB", installment:50 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold4", storage:"512GB", installment:53.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold5", storage:"256GB", installment:50 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold5", storage:"512GB", installment:53.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold6", storage:"256GB", installment:52.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold6", storage:"512GB", installment:56.12 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold7", storage:"256GB", installment:55.56 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold7", storage:"512GB", installment:58.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold8", storage:"256GB", installment:52.78 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold8", storage:"512GB", installment:58.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold8", storage:"1TB", installment:69.45 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold8 Ultra", storage:"256GB", installment:58.34 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold8 Ultra", storage:"512GB", installment:63.89 },
  { category:"Smartphone", make:"Samsung", model:"Galaxy Z Fold8 Ultra", storage:"1TB", installment:75 },
  { category:"Smartphone", make:"Sonim", model:"XP Pro", storage:"", installment:17.5 },
  { category:"Smartphone", make:"Sonim", model:"XP Pro Thermal", storage:"", installment:18.06 },
  { category:"Smartphone", make:"Sonim", model:"XP10", storage:"128GB", installment:15.84 },
  { category:"Smartphone", make:"Sonim", model:"XP3Plus", storage:"", installment:5.56 },
  { category:"Smartphone", make:"Sonim", model:"XP5plus", storage:"", installment:8.28 },
  { category:"Smartphone", make:"Sonim", model:"XP5plus 5G", storage:"", installment:10.42 },
  { category:"Smartphone", make:"Sonim", model:"XP5s®", storage:"", installment:9.45 },
  { category:"Smartphone", make:"Sonim", model:"XP8", storage:"", installment:19.45 },
  { category:"Smartphone", make:"TCL", model:"Classic", storage:"8GB", installment:2.09 },
  { category:"Tablet", make:"Apple", model:"iPad (A16) 2025", storage:"128GB", installment:16.67 },
  { category:"Tablet", make:"Apple", model:"iPad (A16) 2025", storage:"256GB", installment:19.45 },
  { category:"Tablet", make:"Apple", model:"iPad (A16) 2025", storage:"512GB", installment:25 },
  { category:"Tablet", make:"Apple", model:"iPad 8th Generation", storage:"32GB", installment:12.53 },
  { category:"Tablet", make:"Apple", model:"iPad 8th Generation", storage:"128GB", installment:15.31 },
  { category:"Tablet", make:"Apple", model:"iPad 9th Gen 2021", storage:"64GB", installment:12.78 },
  { category:"Tablet", make:"Apple", model:"iPad 9th Gen 2021", storage:"256GB", installment:16.95 },
  { category:"Tablet", make:"Apple", model:"iPad Air (5th Generation)", storage:"64GB", installment:19.45 },
  { category:"Tablet", make:"Apple", model:"iPad Air (5th Generation)", storage:"256GB", installment:22.23 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (2024)", storage:"128GB", installment:19.45 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (2024)", storage:"256GB", installment:22.23 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (2024)", storage:"512GB", installment:27.78 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (2024)", storage:"1TB", installment:33.34 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (M3) 2025", storage:"128GB", installment:19.45 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (M3) 2025", storage:"256GB", installment:22.23 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (M3) 2025", storage:"512GB", installment:27.78 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (M3) 2025", storage:"1TB", installment:33.34 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (M4) 2026", storage:"128GB", installment:25 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (M4) 2026", storage:"256GB", installment:27.78 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (M4) 2026", storage:"512GB", installment:33.34 },
  { category:"Tablet", make:"Apple", model:"iPad Air 11-inch (M4) 2026", storage:"1TB", installment:41.67 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (2024)", storage:"128GB", installment:25 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (2024)", storage:"256GB", installment:27.78 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (2024)", storage:"512GB", installment:33.34 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (2024)", storage:"1TB", installment:38.89 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (M3) 2025", storage:"128GB", installment:25 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (M3) 2025", storage:"256GB", installment:27.78 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (M3) 2025", storage:"512GB", installment:33.34 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (M3) 2025", storage:"1TB", installment:38.89 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (M4) 2026", storage:"128GB", installment:30.56 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (M4) 2026", storage:"256GB", installment:33.34 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (M4) 2026", storage:"512GB", installment:38.89 },
  { category:"Tablet", make:"Apple", model:"iPad Air 13-inch (M4) 2026", storage:"1TB", installment:47.23 },
  { category:"Tablet", make:"Apple", model:"iPad Air 2020", storage:"64GB", installment:18.89 },
  { category:"Tablet", make:"Apple", model:"iPad Air 2020", storage:"256GB", installment:23.06 },
  { category:"Tablet", make:"Apple", model:"iPad mini (2021)", storage:"64GB", installment:16.67 },
  { category:"Tablet", make:"Apple", model:"iPad mini (2021)", storage:"256GB", installment:19.45 },
  { category:"Tablet", make:"Apple", model:"iPad mini (2024)", storage:"128GB", installment:20.84 },
  { category:"Tablet", make:"Apple", model:"iPad mini 5th Generation", storage:"64GB", installment:14.73 },
  { category:"Tablet", make:"Apple", model:"iPad mini 5th Generation", storage:"256GB", installment:18.89 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11\" (2018)", storage:"64GB", installment:24.03 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11\" (2018)", storage:"256GB", installment:26.92 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11\" (2nd Generation)", storage:"128GB", installment:23.62 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11\" (2nd Generation)", storage:"256GB", installment:26.39 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11\" (2nd Generation)", storage:"512GB", installment:31.95 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11\" (2nd Generation)", storage:"1TB", installment:37.5 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (2024)", storage:"256GB", installment:30.56 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (2024)", storage:"512GB", installment:36.12 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (2024)", storage:"1TB Standard Glass", installment:47.23 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (2024)", storage:"1TB Nano-texture Glass", installment:50 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (2024)", storage:"2TB Standard Glass", installment:58.34 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (2024)", storage:"2TB Nano-texture Glass", installment:61.12 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (M5) 2025", storage:"256GB", installment:38.89 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (M5) 2025", storage:"512GB", installment:44.45 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (M5) 2025", storage:"1TB Standard Glass", installment:55.56 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (M5) 2025", storage:"1TB Nano-texture Glass", installment:58.34 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (M5) 2025", storage:"2TB Standard Glass", installment:69.45 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 11-inch (M5) 2025", storage:"2TB Nano-texture Glass", installment:72.23 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 12.9\" (2017)", storage:"64GB", installment:25.84 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 12.9\" (2018)", storage:"64GB", installment:29.64 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 12.9\" (2018)", storage:"256GB", installment:32.53 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 12.9\" (2018)", storage:"1TB", installment:43.75 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (2024)", storage:"256GB", installment:38.89 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (2024)", storage:"512GB", installment:44.45 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (2024)", storage:"1TB Standard Glass", installment:55.56 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (2024)", storage:"1TB Nano-texture Glass", installment:58.34 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (2024)", storage:"2TB Standard Glass", installment:66.67 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (2024)", storage:"2TB Nano-texture Glass", installment:69.45 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (M5) 2025", storage:"256GB", installment:47.23 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (M5) 2025", storage:"512GB", installment:52.78 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (M5) 2025", storage:"1TB Standard Glass", installment:63.89 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (M5) 2025", storage:"1TB Nano-texture Glass", installment:66.67 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (M5) 2025", storage:"2TB Standard Glass", installment:77.78 },
  { category:"Tablet", make:"Apple", model:"iPad Pro 13-inch (M5) 2025", storage:"2TB Nano-texture Glass", installment:80.56 },
  { category:"Tablet", make:"AT&T", model:"amiGO Jr. Tab™", storage:"", installment:4.62 },
  { category:"Tablet", make:"AT&T", model:"amiGO™ Jr. Tab 2", storage:"", installment:6.67 },
  { category:"Tablet", make:"Lenovo", model:"300e Chromebook LTE", storage:"", installment:11.67 },
  { category:"Tablet", make:"Lenovo", model:"ThinkPad X13 5G", storage:"", installment:41.64 },
  { category:"Tablet", make:"Lenovo", model:"ThinkPad X13s 5G", storage:"", installment:43.09 },
  { category:"Tablet", make:"Microsoft", model:"Surface Go 2", storage:"", installment:20.28 },
  { category:"Tablet", make:"Microsoft", model:"Surface Go 3", storage:"", installment:20.28 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Chromebook Go", storage:"", installment:9.73 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab A 8.4\"", storage:"", installment:6.67 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab A11 + 5G", storage:"", installment:9.17 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab A7 Lite", storage:"", installment:5.56 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab A7 Lite Kids Edition", storage:"32GB", installment:6.95 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab A9+ 5G", storage:"", installment:7.5 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab S10 + 5G", storage:"", installment:31.95 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab S10 FE 5G", storage:"", installment:18.06 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab S7 5G", storage:"", installment:23.62 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab S7 FE 5G", storage:"", installment:18.62 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab S8+ 5G", storage:"", installment:30.56 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab S9 FE 5G", storage:"", installment:15.28 },
  { category:"Tablet", make:"Samsung", model:"Galaxy Tab S9+ 5G", storage:"", installment:31.95 },
  { category:"Tablet", make:"TCL", model:"TAB 8 NXTPAPER 5G", storage:"", installment:5.56 },
  { category:"Tablet", make:"TCL", model:"TAB 8 SE", storage:"", installment:4 },
  { category:"Wearable", make:"Apple", model:"Watch SE (2022)", storage:"40mm Aluminum Case", installment:6.95 },
  { category:"Wearable", make:"Apple", model:"Watch SE (2022)", storage:"44mm Aluminum Case", installment:7.78 },
  { category:"Wearable", make:"Apple", model:"Watch SE 3", storage:"40mm Aluminum Case with Sport Band", installment:8.34 },
  { category:"Wearable", make:"Apple", model:"Watch SE 3", storage:"44mm Aluminum Case with Sport Band", installment:9.17 },
  { category:"Wearable", make:"Apple", model:"Watch Series 10", storage:"42mm Aluminum Case Sport Band/Loop", installment:12.5 },
  { category:"Wearable", make:"Apple", model:"Watch Series 10", storage:"46mm Aluminum Case Sport Band/Loop", installment:13.34 },
  { category:"Wearable", make:"Apple", model:"Watch Series 10", storage:"42mm Titanium Case Sport Band", installment:16.67 },
  { category:"Wearable", make:"Apple", model:"Watch Series 10", storage:"46mm Titanium Case Sport Band/Loop", installment:18.06 },
  { category:"Wearable", make:"Apple", model:"Watch Series 10", storage:"42mm Titanium Case Milanese Loop", installment:18.06 },
  { category:"Wearable", make:"Apple", model:"Watch Series 10", storage:"46mm Titanium Case Milanese Loop", installment:19.45 },
  { category:"Wearable", make:"Apple", model:"Watch Series 11", storage:"42mm Aluminum Case with Sport Band", installment:13.89 },
  { category:"Wearable", make:"Apple", model:"Watch Series 11", storage:"46mm Aluminum Case with Sport Band", installment:14.73 },
  { category:"Wearable", make:"Apple", model:"Watch Series 11", storage:"42mm Titanium Case with Sport Band", installment:19.45 },
  { category:"Wearable", make:"Apple", model:"Watch Series 11", storage:"42mm Titanium Case with Milanese Loop", installment:20.84 },
  { category:"Wearable", make:"Apple", model:"Watch Series 11", storage:"46mm Titanium Case with Sport Band", installment:20.84 },
  { category:"Wearable", make:"Apple", model:"Watch Series 11", storage:"46mm Titanium Case with Milanese Loop", installment:22.23 },
  { category:"Wearable", make:"Apple", model:"Watch Series 4 (GPS + Cellular)", storage:"40mm Aluminum", installment:12.5 },
  { category:"Wearable", make:"Apple", model:"Watch Series 4 (GPS + Cellular)", storage:"44mm Aluminum", installment:13.34 },
  { category:"Wearable", make:"Apple", model:"Watch Series 4 (GPS + Cellular)", storage:"40mm Stainless Steel", installment:18.06 },
  { category:"Wearable", make:"Apple", model:"Watch Series 4 (GPS + Cellular)", storage:"44mm Stainless Steel", installment:19.45 },
  { category:"Wearable", make:"Apple", model:"Watch Series 6", storage:"40mm Aluminum Sport Band", installment:12.5 },
  { category:"Wearable", make:"Apple", model:"Watch Series 6", storage:"44mm Aluminum Sport Band", installment:13.34 },
  { category:"Wearable", make:"Apple", model:"Watch Series 6", storage:"40mm Stainless Sport Band", installment:18.06 },
  { category:"Wearable", make:"Apple", model:"Watch Series 6", storage:"44mm Stainless Sport Band", installment:19.45 },
  { category:"Wearable", make:"Apple", model:"Watch Series 6", storage:"40mm Stainless Milanese Loop", installment:19.45 },
  { category:"Wearable", make:"Apple", model:"Watch Series 6", storage:"44mm Stainless Milanese Loop", installment:20.84 },
  { category:"Wearable", make:"Apple", model:"Watch Series 7", storage:"41mm Aluminum Nike Sport Band", installment:12.5 },
  { category:"Wearable", make:"Apple", model:"Watch Series 7", storage:"41mm Aluminum Sport Band", installment:13.34 },
  { category:"Wearable", make:"Apple", model:"Watch Series 7", storage:"45mm Aluminum Sport Band", installment:13.34 },
  { category:"Wearable", make:"Apple", model:"Watch Series 7", storage:"45mm Aluminum Nike Sport Band", installment:13.34 },
  { category:"Wearable", make:"Apple", model:"Watch Series 7", storage:"41mm Stainless Sport Band", installment:16.67 },
  { category:"Wearable", make:"Apple", model:"Watch Series 7", storage:"41mm Stainless Milanese Loop", installment:18.06 },
  { category:"Wearable", make:"Apple", model:"Watch Series 7", storage:"45mm Stainless Sport Band", installment:18.06 },
  { category:"Wearable", make:"Apple", model:"Watch Series 7", storage:"45mm Stainless Milanese Loop", installment:19.45 },
  { category:"Wearable", make:"Apple", model:"Watch Series 8", storage:"41mm Aluminum Case with Sport Band", installment:12.5 },
  { category:"Wearable", make:"Apple", model:"Watch Series 8", storage:"45mm Aluminum Case with Sport Band", installment:13.34 },
  { category:"Wearable", make:"Apple", model:"Watch Series 8", storage:"41mm Stainless Steel Case with Sport Band", installment:16.67 },
  { category:"Wearable", make:"Apple", model:"Watch Series 8", storage:"41mm Stainless Steel Case with Milanese Loop", installment:18.06 },
  { category:"Wearable", make:"Apple", model:"Watch Series 8", storage:"45mm Stainless Steel Case with Sport Band", installment:18.06 },
  { category:"Wearable", make:"Apple", model:"Watch Series 8", storage:"45mm Stainless Steel Case with Milanese Loop", installment:19.45 },
  { category:"Wearable", make:"Apple", model:"Watch Ultra", storage:"49mm Titanium Case", installment:19.45 },
  { category:"Wearable", make:"Apple", model:"Watch Ultra 2", storage:"49mm Natural/Black Titanium Case", installment:19.45 },
  { category:"Wearable", make:"Apple", model:"Watch Ultra 2", storage:"49mm with Milanese Loop", installment:22.23 },
  { category:"Wearable", make:"Apple", model:"Watch Ultra 3", storage:"49mm Titanium Case with Ocean Band", installment:22.23 },
  { category:"Wearable", make:"Apple", model:"Watch Ultra 3", storage:"49mm Titanium Case with Alpine Loop", installment:22.23 },
  { category:"Wearable", make:"Apple", model:"Watch Ultra 3", storage:"49mm Titanium Case with Trail Loop", installment:22.23 },
  { category:"Wearable", make:"Apple", model:"Watch Ultra 3", storage:"49mm Titanium Case with Milanese Loop", installment:25 },
  { category:"Wearable", make:"AT&T", model:"amiGO Jr. Watch™", storage:"1GB", installment:4.59 },
  { category:"Wearable", make:"AT&T", model:"amiGO™ Jr. Watch 2", storage:"", installment:5.28 },
  { category:"Wearable", make:"Google", model:"Pixel Watch", storage:"", installment:11.12 },
  { category:"Wearable", make:"Google", model:"Pixel Watch 2", storage:"", installment:11.12 },
  { category:"Wearable", make:"Google", model:"Pixel Watch 3 41mm", storage:"", installment:9.73 },
  { category:"Wearable", make:"Google", model:"Pixel Watch 3 45mm", storage:"", installment:11.12 },
  { category:"Wearable", make:"Google", model:"Pixel Watch 4 41mm", storage:"", installment:12.5 },
  { category:"Wearable", make:"Google", model:"Pixel Watch 4 45mm", storage:"", installment:13.89 },
  { category:"Wearable", make:"Google", model:"Pixel Watch 5 (41mm)", storage:"64GB", installment:13.89 },
  { category:"Wearable", make:"Google", model:"Pixel Watch 5 (45mm)", storage:"64GB", installment:14.73 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch Active2", storage:"40mm", installment:7.78 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch Active2", storage:"44mm", installment:8.34 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch FE", storage:"", installment:6.95 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch Ultra", storage:"", installment:18.06 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch Ultra2", storage:"", installment:19.45 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch3", storage:"41mm", installment:12.5 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch3", storage:"45mm", installment:13.34 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch5", storage:"40mm", installment:9.17 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch5", storage:"44mm", installment:10 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch5 Pro", storage:"16GB", installment:13.89 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch6", storage:"40mm", installment:9.73 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch6", storage:"44mm", installment:10.56 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch6 Classic", storage:"43mm", installment:12.5 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch6 Classic", storage:"47mm", installment:13.34 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch7", storage:"40mm", installment:9.73 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch7", storage:"44mm", installment:10.56 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch8", storage:"40mm", installment:11.12 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch8", storage:"44mm", installment:11.95 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch8 Classic", storage:"", installment:15.28 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch9 40mm", storage:"", installment:11.95 },
  { category:"Wearable", make:"Samsung", model:"Galaxy Watch9 44mm", storage:"", installment:12.78 }
];
var FBC_MAX_LINES = 10;
// Per line. $35 for BOTH consumer and business — user-confirmed 2026-07-27, closing the
// open question from 2026-07-20 (AT&T's business legal PDFs say "up to $50 per line", but
// $35 is what actually bills).
var FBC_ACTIVATION_FEE = 35;
var _FBC = null;
// Sentinel category for a line the customer is keeping their own handset on. Distinct from
// '' (nothing picked yet) so a deliberate BYOD line doesn't look like a half-filled quote.
var FBC_BYOD = '__byod__';
// `label` is the BASE device ("Apple iPhone 17 Pro Max"); `storage` is the chosen variant
// ("256GB", or a watch's case/band). They are stored apart so the picker can offer the model
// and the capacity as two short lists rather than one 464-entry dropdown.
function _fbcBlankDevice() { return { cat:'', label:'', storage:'', cost:'' }; }
function _fbcInit() {
  if (_FBC) return;
  _FBC = { segment:'consumer', lines:1, plan:FBC_PLANS.consumer.order[0], devices:[_fbcBlankDevice()], nextUp:false };
}
// One device row per line — a 4-line account rarely takes 4 of the same handset. Rows are
// kept in step with the line count: extra rows are dropped, new lines start blank, and rows
// already filled in keep their selection so going 3 -> 4 lines doesn't wipe the quote.
function _fbcSyncDevices(d) {
  var n = _fbcLines(d);
  if (!d.devices) d.devices = [];
  while (d.devices.length < n) d.devices.push(_fbcBlankDevice());
  if (d.devices.length > n) d.devices.length = n;
  return d.devices;
}
function _fbcDeviceAt(i) { var a = _fbcSyncDevices(_FBC); return a[i] || null; }
function _fbcDeviceTotal(d) {
  return _fbcSyncDevices(d).reduce(function(sum, x) { return sum + _fbcNum(x.cost); }, 0);
}
function _fbcNum(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _fbcLines(d) {
  var n = parseInt(d.lines, 10);
  if (isNaN(n) || n < 1) n = 1;
  return Math.min(n, FBC_MAX_LINES);
}
// The price tables are keyed by tier, and the top tier is open-ended ('4+' consumer, '6+'
// business) — so an exact line count above that tier falls back to the last tier's rate.
function _fbcTier(d) {
  var tiers = FBC_PLANS[d.segment].lineTiers;
  var key = String(_fbcLines(d));
  return tiers.indexOf(key) >= 0 ? key : tiers[tiers.length - 1];
}
function _fbcPlanPrice(d) {
  var seg = FBC_PLANS[d.segment];
  var tierPrices = seg.prices[_fbcTier(d)] || {};
  return tierPrices[d.plan] || 0;
}
// Plan rate and activation fee are both PER LINE, so both scale with the line count; the
// device cost is the sum of the per-line rows, and Next Up is account-level.
function _fbcTotal(d) {
  var lines = _fbcLines(d);
  return (_fbcPlanPrice(d) * lines * 1.5) + _fbcDeviceTotal(d)
       + (FBC_ACTIVATION_FEE * lines) + (d.nextUp ? 10 : 0);
}
function _fbcMoney(n) { return '$' + n.toFixed(2); }
function _fbcLineLabel(n) { return n + ' line' + (String(n) === '1' ? '' : 's'); }
function _fbcDeviceCategories() {
  var seen = {}, out = [];
  FBC_DEVICES.forEach(function(x){ if (!seen[x.category]) { seen[x.category] = 1; out.push(x.category); } });
  return out;
}
function _fbcDeviceLabel(x) { return x.make + ' ' + x.model + (x.storage ? ' - ' + x.storage : ''); }
// The model WITHOUT its capacity — the key the first dropdown lists and the device row stores.
function _fbcBaseLabel(x) { return x.make + ' ' + x.model; }
// Every catalogue row for one model, cheapest first. A single-SKU device returns one row
// whose storage is ''. Callers must treat "no variants" as "not a real selection".
function _fbcVariantsFor(cat, baseLabel) {
  return FBC_DEVICES.filter(function(y) {
    return y.category === cat && _fbcBaseLabel(y) === baseLabel;
  }).sort(function(a, b) { return (a.installment || 0) - (b.installment || 0); });
}
// Picking a model must land on a real price straight away, so we default to the cheapest
// variant — the same base-storage figure the calculator has always quoted.
function _fbcVariantFor(cat, baseLabel, storage) {
  var list = _fbcVariantsFor(cat, baseLabel);
  if (!list.length) return null;
  for (var i = 0; i < list.length; i++) if (list[i].storage === storage) return list[i];
  return list[0];
}
function _fbcBreakdownHtml(d) {
  var planPrice = _fbcPlanPrice(d), lines = _fbcLines(d);
  var rows = [
    ['Plan: ' + (d.plan || '—') + ' (' + _fbcLineLabel(lines) + ' x $' + planPrice + '/line x 1.5)', planPrice * lines * 1.5]
  ];
  // Itemise per line so the rep can see which handset drove the total, rather than one
  // opaque device figure. Lines still untouched are skipped; BYOD is shown deliberately.
  var touched = 0;
  _fbcSyncDevices(d).forEach(function(x, i) {
    var cost = _fbcNum(x.cost);
    if (!x.label && !cost && x.cat !== FBC_BYOD) return;
    touched++;
    var name = x.label ? (x.label + (x.storage ? ' - ' + x.storage : '')) : 'device';
    rows.push(['Line ' + (i + 1) + ': ' + (x.cat === FBC_BYOD ? 'BYOD — no device' : name), cost]);
  });
  if (!touched) rows.push(['Devices — none selected', 0]);
  rows.push(['Activation fee ($' + FBC_ACTIVATION_FEE + ' x ' + _fbcLineLabel(lines) + ')', FBC_ACTIVATION_FEE * lines]);
  if (d.nextUp) rows.push(['Next Up Anytime', 10]);
  return rows.map(function(r) {
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0"><span>' + esc(r[0]) + '</span><span>' + _fbcMoney(r[1]) + '</span></div>';
  }).join('');
}
function renderFirstBillCalc() {
  _fbcInit();
  var d = _FBC;
  var seg = FBC_PLANS[d.segment];
  var segTog = function(label, val) { return '<div class="ps-toggle' + (d.segment === val ? ' active' : '') + '" onclick="_fbcSetSegment(\'' + val + '\')">' + label + '</div>'; };
  var nextUpTog = function(label, val) { return '<div class="ps-toggle' + (d.nextUp === val ? ' active' : '') + '" onclick="_fbcSetNextUp(' + val + ')">' + label + '</div>'; };
  var lines = _fbcLines(d), tierPrices = seg.prices[_fbcTier(d)] || {};
  var lineOpts = '';
  for (var n = 1; n <= FBC_MAX_LINES; n++) {
    lineOpts += '<option value="' + n + '"' + (n === lines ? ' selected' : '') + '>' + esc(_fbcLineLabel(n)) + '</option>';
  }
  var planOpts = seg.order.map(function(p) {
    var price = tierPrices[p] || 0;
    return '<option value="' + esc(p) + '"' + (p === d.plan ? ' selected' : '') + '>' + esc(p) + ' — $' + price + '/line</option>';
  }).join('');
  var deviceRows = _fbcSyncDevices(d).map(_fbcDeviceRowHtml).join('');
  return '<div class="card"><div class="card-header dark">' + icon('firstbill') + ' First Bill Calculator</div><div class="card-body">' +
    '<div style="border:1px solid var(--yellow);border-radius:8px;padding:10px 13px;margin-bottom:16px;background:rgba(240,180,41,.10);font-size:.85rem;line-height:1.5">' +
      '<b style="color:var(--yellow)">ESTIMATE ONLY — this is not the customer\'s actual first bill.</b> ' +
      'Excludes taxes &amp; fees, and any promotional or trade-in credits (AutoPay and ' +
      'smartphone-line discounts arrive as bill credits and can take up to 2 bills to appear). ' +
      'Assumes AT&amp;T\'s standard advance-billing proration (1 full month + a half-month partial).' +
      '<div style="margin-top:6px">Device costs are <b>MSRP for the capacity you pick</b>, ' +
      'divided over 36 months. This is <b>MSRP, not the dealer rack rate</b> — enter the real ' +
      'rack rate to make the total accurate.</div>' +
      '<div style="margin-top:6px;color:var(--text2)">Quote it to the customer as an approximate range, not a figure. Nothing here is saved.</div>' +
    '</div>' +
    '<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">' +
      '<div style="flex:1 1 260px;min-width:240px">' +
        '<div class="ps-label" style="margin-top:0">CONSUMER OR BUSINESS</div>' +
        '<div class="ps-toggle-row">' + segTog('Consumer', 'consumer') + segTog('Business', 'business') + '</div>' +
        '<div class="ps-label">LINE COUNT</div>' +
        '<select class="ps-select" id="fbc-lines" onchange="_fbcSetLines(this.value)">' + lineOpts + '</select>' +
        '<div class="ps-label">PLAN</div>' +
        '<select class="ps-select" id="fbc-plan" onchange="_fbcSetPlan(this.value)">' + planOpts + '</select>' +
        '<div class="ps-label">NEXT UP ANYTIME ($10/mo)</div>' +
        '<div class="ps-toggle-row">' + nextUpTog('No', false) + nextUpTog('Yes', true) + '</div>' +
      '</div>' +
      '<div style="flex:1.5 1 260px;min-width:240px">' +
        '<div class="ps-label" style="margin-top:0">ESTIMATED FIRST BILL</div>' +
        '<div id="fbc-total" style="font-size:2.4rem;font-weight:700;color:var(--text)">' + _fbcMoney(_fbcTotal(d)) + '</div>' +
        // Repeated next to the figure itself — this is the number that gets read out or
        // screenshotted, often without the banner above it.
        '<div style="font-size:.76rem;color:var(--yellow);margin-top:2px">Estimate — not the actual first bill. Devices priced at MSRP, not rack rate.</div>' +
        '<div id="fbc-breakdown" style="margin-top:14px;font-size:.85rem;color:var(--text2)">' + _fbcBreakdownHtml(d) + '</div>' +
      '</div>' +
    '</div>' +
    // Devices get the full width below the two columns — one row per line, and at 10 lines
    // this would be unusably cramped in the narrow left column.
    '<div style="margin-top:20px;border-top:1px solid var(--border);padding-top:14px">' +
      '<div class="ps-label" style="margin-top:0">DEVICES &mdash; ONE PER LINE. PICK THE MODEL, THEN THE CAPACITY, TO FILL IN MSRP &divide; 36; ' +
        'REPLACE IT WITH THE RACK RATE. LINES BRINGING THEIR OWN HANDSET &rarr; NONE / BYOD</div>' +
      deviceRows +
      '<div style="display:flex;justify-content:flex-end;gap:12px;align-items:baseline;padding:10px 2px 0;font-size:.9rem">' +
        '<span style="color:var(--text2)">Devices total</span>' +
        '<span id="fbc-devtotal" style="font-weight:700;min-width:90px;text-align:right">' + _fbcMoney(_fbcDeviceTotal(d)) + '</span>' +
      '</div>' +
    '</div>' +
  '</div></div>';
}
// One device row = one line on the account: [Line n] [category] [model] [$ /mo].
function _fbcDeviceRowHtml(x, i) {
  var catOpts = '<option value="">&mdash; select &mdash;</option>' +
    '<option value="' + FBC_BYOD + '"' + (x.cat === FBC_BYOD ? ' selected' : '') + '>None / BYOD</option>' +
    _fbcDeviceCategories().map(function(c) {
      return '<option value="' + esc(c) + '"' + (c === x.cat ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
  var modelSel = '', storageSel = '';
  if (x.cat && x.cat !== FBC_BYOD) {
    // One entry per MODEL, not per SKU: the catalogue carries a row per capacity, so a flat
    // list would repeat "Apple Watch Series 11" six times. Capacity is the second dropdown.
    var seen = {}, list = [];
    FBC_DEVICES.forEach(function(y) {
      if (y.category !== x.cat) return;
      var base = _fbcBaseLabel(y);
      if (seen[base]) { seen[base].push(y); return; }
      seen[base] = [y]; list.push(base);
    });
    list.sort(function(a, b) { return a.localeCompare(b); });
    var modelOpts = '<option value="">&mdash; select &mdash;</option>' + list.map(function(base) {
      var vs = seen[base].slice().sort(function(a, b) { return (a.installment || 0) - (b.installment || 0); });
      var lo = vs[0] && vs[0].installment;
      // Multi-capacity models quote "from", because the row's price depends on the second pick.
      var tag = lo == null ? ' — no price found'
              : (vs.length > 1 ? ' — from $' + lo + '/mo' : ' — ~$' + lo + '/mo');
      return '<option value="' + esc(base) + '"' + (base === x.label ? ' selected' : '') + '>' + esc(base + tag) + '</option>';
    }).join('');
    modelSel = '<select class="ps-select" style="flex:1 1 240px;min-width:170px;margin:0" ' +
      'onchange="_fbcSetDeviceLabelAt(' + i + ', this.value)">' + modelOpts + '</select>';

    // Only shown when the model actually has a choice to make — a single-SKU device would
    // otherwise render a one-option dropdown that looks broken.
    var variants = x.label ? _fbcVariantsFor(x.cat, x.label) : [];
    if (variants.length > 1) {
      var vOpts = variants.map(function(v) {
        return '<option value="' + esc(v.storage) + '"' + (v.storage === x.storage ? ' selected' : '') + '>' +
          esc(v.storage + ' — $' + v.installment + '/mo') + '</option>';
      }).join('');
      // Grows into the free space: a watch variant runs to 44 characters ("46mm Titanium
      // Case with Milanese Loop"), which a fixed 210px clips mid-word.
      storageSel = '<select class="ps-select" style="flex:1 1 220px;min-width:160px;max-width:340px;margin:0" ' +
        'aria-label="Line ' + (i + 1) + ' capacity" ' +
        'onchange="_fbcSetDeviceStorageAt(' + i + ', this.value)">' + vOpts + '</select>';
    }
  } else {
    modelSel = '<span style="flex:1 1 240px;min-width:170px;font-size:.82rem;color:var(--text2)">' +
      (x.cat === FBC_BYOD ? 'Keeping their own device &mdash; no installment' : 'Pick a device type') + '</span>';
  }
  var byod = x.cat === FBC_BYOD;
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:7px 2px;border-bottom:1px solid var(--border)">' +
      '<span style="flex:0 0 56px;font-weight:600;font-size:.8rem;color:var(--text2)">Line ' + (i + 1) + '</span>' +
      '<select class="ps-select" style="flex:0 0 155px;margin:0" onchange="_fbcSetDeviceCatAt(' + i + ', this.value)">' + catOpts + '</select>' +
      modelSel + storageSel +
      '<input class="ps-input" type="number" min="0" step="0.01" style="flex:0 0 110px;margin:0"' +
        (byod ? ' disabled' : '') + ' placeholder="0.00" value="' + esc(byod ? '' : x.cost) + '" ' +
        'oninput="_fbcSetDeviceCostAt(' + i + ', this.value)" aria-label="Line ' + (i + 1) + ' monthly device cost">' +
    '</div>';
}
function _fbcRepaint() { var c = document.getElementById('main-content'); if (c) c.innerHTML = renderFirstBillCalc(); }
// Line count survives a segment switch (the tier resolves per-segment); the plan can't, since
// Consumer and Business use different plan names.
function _fbcSetSegment(val) {
  _fbcInit(); _FBC.segment = val; _FBC.plan = FBC_PLANS[val].order[0];
  _fbcRepaint();
}
function _fbcSetLines(val) { _fbcInit(); _FBC.lines = parseInt(val, 10) || 1; _fbcRepaint(); }
function _fbcSetPlan(val) { _fbcInit(); _FBC.plan = val; _fbcRepaint(); }
// Per-line device setters. Changing type or model repaints (the row's controls change);
// typing a cost must NOT repaint or the input loses focus mid-keystroke, so it updates the
// totals in place instead.
function _fbcSetDeviceCatAt(i, val) {
  _fbcInit(); var x = _fbcDeviceAt(i); if (!x) return;
  x.cat = val; x.label = ''; x.storage = '';
  x.cost = (val === FBC_BYOD) ? '0' : '';
  _fbcRepaint();
}
// Picking a model auto-fills an estimated installment (MSRP / 36mo) when we have one — a
// starting point; the rep can overwrite it with the rack rate either way. A model with
// several capacities defaults to the CHEAPEST, which is the figure this tool always quoted;
// the capacity dropdown that appears alongside is how they move off it.
function _fbcSetDeviceLabelAt(i, val) {
  _fbcInit(); var x = _fbcDeviceAt(i); if (!x) return;
  x.label = val;
  var match = _fbcVariantFor(x.cat, val, '');
  x.storage = match ? match.storage : '';
  x.cost = (match && match.installment != null) ? String(match.installment) : '';
  _fbcRepaint();
}
// Changing capacity re-prices the line. Repaints because the dropdown's own selection and
// the breakdown text both have to follow.
function _fbcSetDeviceStorageAt(i, val) {
  _fbcInit(); var x = _fbcDeviceAt(i); if (!x) return;
  var match = _fbcVariantFor(x.cat, x.label, val);
  x.storage = match ? match.storage : val;
  x.cost = (match && match.installment != null) ? String(match.installment) : '';
  _fbcRepaint();
}
function _fbcSetDeviceCostAt(i, val) {
  _fbcInit(); var x = _fbcDeviceAt(i); if (!x) return;
  x.cost = val; _fbcLiveTotals();
}
function _fbcLiveTotals() {
  var t = document.getElementById('fbc-total');    if (t) t.textContent = _fbcMoney(_fbcTotal(_FBC));
  var b = document.getElementById('fbc-breakdown'); if (b) b.innerHTML = _fbcBreakdownHtml(_FBC);
  var s = document.getElementById('fbc-devtotal');  if (s) s.textContent = _fbcMoney(_fbcDeviceTotal(_FBC));
}
function _fbcSetNextUp(val) { _fbcInit(); _FBC.nextUp = val; _fbcRepaint(); }

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
    var _reqOffice = CFG.officeId;
    api({ action:'readMyPostedSales', officeId:CFG.officeId }).then(function(res) {
      _PSV_FLIGHT = false;
      // Office guard. ⚠ _PSV_FLIGHT cleared above the return, or this tab never reloads.
      if (CFG.officeId !== _reqOffice) return;
      _PSV_SALES = (res && res.sales) ? res.sales : [];
      if (CURRENT_TAB === 'postedsales') _psvPaint();
    }).catch(function(e) {
      _PSV_FLIGHT = false;
      if (CURRENT_TAB === 'postedsales') document.getElementById('main-content').innerHTML =
        errorState('Couldn’t load posted sales.', { icon:'postedsales', code:errCode(e), retry:'renderPostedSalesTab()' });
    });
  }
  c.innerHTML = loadingState('Loading posted sales…', { icon:'postedsales' });
}
function _psvCanEditAll() {
  var r = (SESSION.role || '').toLowerCase();
  return r === 'owner' || r === 'admin' || r === 'master-admin' || r === 'activator' || SESSION.isMaster;
}
/* What the header says this list CONTAINS. 2026-08-30 leader/jd/manager went from own-only to
   own + team (server-side, `_scopePostedSales`), so "Your posted sales" became a lie for them —
   a caption that misdescribes its own list is how someone concludes a teammate's sale is theirs.
   ⚠ Label only. The server decides what arrives; this must never be used to filter. */
function _psvScopeLabel() {
  if (_psvCanEditAll()) return 'All posted sales';
  var r = (SESSION.role || '').toLowerCase();
  return (r === 'leader' || r === 'jd' || r === 'manager') ? 'You + your team' : 'Your posted sales';
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
  var scope = _psvScopeLabel();
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
  // ⚠ Must match the wizard's label in _psStep1 verbatim — same field, same question.
  if (d.underSomeoneCodes === 'Yes') h += '<div class="ps-sub-field"><div class="ps-label">WHO MADE THE SALE?</div><input class="ps-input" type="text" value="' + esc(d.codesUsedBy) + '" oninput="_pseSet(\'codesUsedBy\',this.value)"></div>';
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
  var _reqOffice = CFG.officeId;
  apiPost(payload).then(function(res) {
    /* Office guard. The edit is written server-side against the office that sent it; what
       must not happen is patching _PSV_SALES — which now holds a DIFFERENT office's posted
       sales — with this record. That would silently graft one office's sale into another's
       list, and the in-place patch below is exactly the path that would do it. */
    if (CFG.officeId !== _reqOffice) return;
    if (res && res.ok) {
      /* Patch the cached record in place instead of nulling _PSV_SALES, which forced a
         readMyPostedSales round trip on EVERY edit. _psvVoid above already does exactly this
         for the void toggle — the two paths in this same file were inconsistent.
         ✅ Safe because the stored record uses the SAME field names as the payload: _psvEdit
         reads s.airQty / s.wirelessNew / s.fiberPackage / s.dtvQty …, which is what we send.
         This is a field-for-field copy, not a reshape.
         ⚠ ONLY the fields we actually sent are copied. Anything the backend owns or derives —
         notes (not in the payload), rep, the row's identity — is left alone.
         ⚠ _psInvalidateDownstream() still runs: an edited sale genuinely changes the Live Sales
         Tracker and Training totals, so those caches must still go. They re-read lazily when
         their own tabs open, so nothing is requested here. */
      var _tgt = (_PSV_SALES || []).filter(function(x){ return x && x.rowIndex === d.rowIndex; })[0];
      if (_tgt) {
        ['dateOfSale','dsi','accountType','processedVia','underSomeoneCodes','codesUsedBy',
         'trainee','traineeName','airQty','wirelessNew','wirelessByod','fiberPackage',
         'fiberInstallDate','voipQty','dtvQty','dtvPackage'].forEach(function(k){ _tgt[k] = payload[k]; });
      } else {
        _PSV_SALES = null;   // not in the cache — fall back to a re-read rather than guess
      }
      _psInvalidateDownstream(); closeModal(); renderPostedSalesTab();
    }
    else { btn.disabled = false; btn.textContent = 'SAVE CHANGES'; alert('Error: ' + (res && res.error ? res.error : 'Unknown error')); }
  }).catch(function() { btn.disabled = false; btn.textContent = 'SAVE CHANGES'; alert('Save failed. Please try again.'); });
}

