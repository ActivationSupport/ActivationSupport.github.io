// ── CONFIG ──────────────────────────────────────────────────────────────
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw9hfE_HDTDueNr-s-wQRNDvqWfQX-EkYkSFVQQeitc3_ccO8FqBabAhKe7YTqVzPQ21Q/exec';
var APPT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxDy8ZMiho7BL5U1-CV29CpPQ2odQZ4TmPkO51uIAsomrJWuJYCQCV_xycNBGeYhO6tAw/exec';
// Public booking page — now on GitHub Pages (off Apps Script, dodges the multi-account
// "unable to open the file" glitch). Per-office link = this + ?office=<id>. (Booking step 2c.)
var CUSTOMER_BOOKING_URL = 'https://activationsupport.github.io/book.html';
var API_KEY = 'activation-dash-2026-secret';
// ── OFFICE CONFIG — single source of truth (O1) ─────────────────────────────
// One object per office holds everything the FRONT END needs; the legacy per-map
// views below are DERIVED from it, so onboarding/editing an office is a single edit
// here (all downstream code is unchanged). Backend maps (Code.gs / the Scheduler /
// Customer Booking) still mirror these — keep in sync; see _private/OFFICE_ONBOARDING.md.
// ⚠ Key ORDER matters: OFFICE_NAMES is iterated for the office switcher + the People
// permission checkboxes, so keep this order (midspire, viridian, elevate, …).
// Fields: name; color (accent sampled from the logo); theme (applyOfficeTheme: btn=
// primary fill/--blue, accent=bright accent/--blue2, dark/--blue3, hover, glow=login
// glow, band/onBand=header; gold offices add lightInk for legible light-mode accent
// text; loginAccent/onAccent/btnText/accent2b optional); reportBrand (Daily-Report
// EMAIL brand, mirror of Code.gs OFFICE_BRAND); logos ({full,emblem,sidebarH?,loginH?,
// logoBg?} — files must exist in dashboard/assets/); bookTint + bookLogo (booking UI).
var OFFICE_CONFIG = {
  midspire: {
    name:'Midspire', color:'#0E7BD4',
    theme:{ btn:'#4FB0FF', accent:'#4FB0FF', dark:'#0f2f44', hover:'#2e97ec', glow:'#0f3f5e', band:'#0E7BD4', onBand:'#ffffff', sidebar:'#0c1d2e' },
    reportBrand:{ band:'#0c1d2e', headerText:'#ffffff', headerSub:'#a8c8e4', accent:'#4FB0FF', accentText:'#4FB0FF', logo:'midspire-logo-full.png', logoH:38 },
    logos:{ full:'assets/midspire-logo-full.png', emblem:'assets/midspire-logo-symbol.png' },
    bookTint:'#4FB0FF', bookLogo:'midspire-logo-symbol.png'
  },
  viridian: {
    // Accent is GOLD (#C9A23C); the green is the fill/band. lightInk keeps gold accent text legible in light mode.
    name:'Viridian', color:'#C9A23C',
    theme:{ btn:'#16382A', accent:'#D9C87E', dark:'#16281e', hover:'#0e2a1f', glow:'#7a5f18', band:'#1B3A2D', onBand:'#EFE2A2', sidebar:'#10221a', loginAccent:'#16382A', onAccent:'#16382A', lightInk:'#7a6a2e' },
    reportBrand:{ band:'#1B3A2D', headerText:'#EAF1EA', headerSub:'#cfd9cf', accent:'#D9C87E', accentText:'#D9C87E', logo:'viridian-logo-full.png', logoH:54 },
    logos:{ full:'assets/viridian-logo-full.png', emblem:'assets/viridian-logo-full.png', sidebarH:68 },
    bookTint:'#2E7A4E', bookLogo:'viridian-logo-full.png'
  },
  elevate: {
    name:'Elevate', color:'#0B2E9C',
    theme:{ btn:'#0A1FFF', accent:'#3D5BFF', dark:'#14224a', hover:'#0816cc', glow:'#16306a', band:'#0B2E9C', onBand:'#ffffff', sidebar:'#111827' },
    reportBrand:{ band:'#111827', headerText:'#ffffff', headerSub:'#aab8d6', accent:'#0A1FFF', accentText:'#0A1FFF', logo:'elevate-logo-full-standard-blue.png', logoH:40 },
    logos:{ full:'assets/elevate-logo-full-standard-blue.png', emblem:'assets/elevate-logo-symbol-only-blue.png' },
    bookTint:'#3D5BFF', bookLogo:'elevate-logo-symbol-only-blue.png'
  },
  vanguard: {
    // Charcoal structure + BLUE app accent; RED (accent2b) on login/logo/badge; btnText white.
    name:'Vanguard', color:'#D81F1F',
    theme:{ btn:'#1C1C1C', accent:'#3D67E8', accent2b:'#D81F1F', dark:'#19202e', hover:'#333333', glow:'#241416', band:'#1C1C1C', onBand:'#ffffff', sidebar:'#161616', btnText:'#ffffff', loginAccent:'#E2483A', onAccent:'#ffffff' },
    reportBrand:{ band:'#1C1C1C', headerText:'#ffffff', headerSub:'#c9b3b1', accent:'#D81F1F', accentText:'#D81F1F', logo:'vanguard-logo-full-reverse.png', logoH:40 },
    logos:{ full:'assets/vanguard-logo-full-reverse.png', emblem:'assets/vanguard-logo-symbol-reverse.png', sidebarH:42 },
    bookTint:'#2652D7', bookLogo:'vanguard-logo-symbol.png'
  },
  bayview: {
    // NAVY structure + GOLD accent; gold fills take navy text (onAccent); lightInk for light mode. logoBg = gold panel behind the navy logo.
    name:'Bayview Horizons', color:'#CDAB5A',
    theme:{ btn:'#0F2439', accent:'#CDAB5A', dark:'#15233a', hover:'#0a1a2c', glow:'#173a63', band:'#0F2439', onBand:'#ffffff', sidebar:'#0d1a29', loginAccent:'#CDAB5A', onAccent:'#0F2439', lightInk:'#8C6E22' },
    reportBrand:{ band:'#0F2439', headerText:'#ffffff', headerSub:'#c9b58a', accent:'#CDAB5A', accentText:'#8C6E22', logo:'bayview-logo-full.png', logoH:48 },
    logos:{ full:'assets/bayview-logo-full.png', emblem:'assets/bayview-logo-symbol.png', sidebarH:78, loginH:92, logoBg:'#D3B364' },
    bookTint:'#1E4D7B', bookLogo:'bayview-logo-symbol.png'
  },
  leadsphere: {
    // NAVY structure + BRIGHT-BLUE buttons/accent. White logo on dark chrome.
    name:'LeadSphere Solutions', color:'#2B6AFF',
    theme:{ btn:'#2B6AFF', accent:'#2B6AFF', dark:'#132a45', hover:'#1B4EC4', glow:'#173a63', band:'#0A2540', onBand:'#ffffff', sidebar:'#0b1a2b' },
    reportBrand:{ band:'#0A2540', headerText:'#ffffff', headerSub:'#9db4d8', accent:'#2B6AFF', accentText:'#2B6AFF', logo:'leadsphere-logo-full-reverse.png', logoH:42 },
    logos:{ full:'assets/leadsphere-logo-full-reverse.png', emblem:'assets/leadsphere-logo-symbol.png', sidebarH:40 },
    bookTint:'#2B6AFF', bookLogo:'leadsphere-logo-symbol.png'
  }
};
// Legacy per-map views, DERIVED from OFFICE_CONFIG (downstream code + key order unchanged).
function _ocfg(field){ var o={}; for (var k in OFFICE_CONFIG) o[k] = OFFICE_CONFIG[k][field]; return o; }
var OFFICE_NAMES        = _ocfg('name');
var OFFICE_COLORS       = _ocfg('color');
var OFFICE_THEME        = _ocfg('theme');
var OFFICE_REPORT_BRAND = _ocfg('reportBrand');
var DR_ASSET_BASE = 'https://activationsupport.github.io/dashboard/assets/';
function _drReportBrand(officeId) {
  return OFFICE_REPORT_BRAND[officeId] ||
    { band:'#0f2740', headerText:'#ffffff', headerSub:'#9fb4c7', accent:'#0f2740', accentText:'#0f2740', logo:'', logoH:40 };
}
// Recolor the entire portal to an office's brand by overriding the accent CSS
// variables (every button/heading/border/highlight reads these) + the login glow.
function applyOfficeTheme(officeId) {
  var t = OFFICE_THEME[officeId]; if (!t) return;
  var r = document.documentElement.style;
  r.setProperty('--blue', t.btn);
  // In LIGHT mode, gold offices (Viridian/Bayview) swap their pale accent for a darker
  // "ink" so accent TEXT/borders stay legible on the white surfaces; the accent FILLS then
  // need white on-accent text. One pair of var swaps cascades to every --blue2 usage.
  var isLight = document.documentElement.getAttribute('data-theme') === 'light';
  var ink = (isLight && t.lightInk) ? t.lightInk : t.accent;
  r.setProperty('--blue2', ink);
  r.setProperty('--accent2b', t.accent2b || ink);   // dual accent; non-vanguard offices fall back to their main accent (no change)
  r.setProperty('--blue3', t.dark);
  r.setProperty('--blueHover', t.hover);
  r.setProperty('--blueText', t.btnText || '#fff');
  r.setProperty('--login-accent', t.loginAccent || t.accent);   // login is ALWAYS dark → keep the brand accent (not the ink)
  r.setProperty('--on-accent', (isLight && t.lightInk) ? '#fff' : (t.onAccent || '#fff'));   // dark ink fill needs white text
  r.setProperty('--sidebar-bg', t.sidebar || '#111827');
  r.setProperty('--blue2-fade', _hexToRgba(ink, 0.14));
  r.setProperty('--blue2-faint', _hexToRgba(ink, 0.06));
  r.setProperty('--blue2-rgb', _hexToRgbTriplet(ink));   // accent "r,g,b" for rgba(var(--blue2-rgb),a) tints
  var ls = document.getElementById('login-screen');
  if (ls) ls.style.background = 'radial-gradient(ellipse at center, '+t.glow+' 0%, #111 65%)';
}
// hex (#rgb or #rrggbb) → rgba() string at the given alpha.
function _hexToRgba(hex, a) {
  hex = String(hex || '').replace('#','');
  if (hex.length === 3) hex = hex.split('').map(function(c){return c+c;}).join('');
  var n = parseInt(hex, 16);
  return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';
}
// hex → "r,g,b" triplet for use inside rgba(var(--blue2-rgb), a).
function _hexToRgbTriplet(hex) {
  hex = String(hex || '').replace('#','');
  if (hex.length === 3) hex = hex.split('').map(function(c){return c+c;}).join('');
  var n = parseInt(hex, 16);
  return ((n>>16)&255)+','+((n>>8)&255)+','+(n&255);
}
var OFFICE_LOGOS = _ocfg('logos');   // derived from OFFICE_CONFIG (see top of file)

var CFG = {};
var SESSION = {};
var DATA = {};
var SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 60 min inactivity
var _lastActivity = Date.now();
var _inactivityInterval = null;

// ── CACHE STATE ───────────────────────────────────────────────────────────
var _CACHE = {
  mainDataTs: 0, lstSalesTs: 0,
  mainFlight: false, lstFlight: false, notesFlight: false,
  MAIN_TTL: 90000, LST_TTL: 90000, NOTES_TTL: 25000
};
var _pendingRefresh = false;
var _bgInterval = null;
var _luInterval = null;
var _notesInterval = null;
var _noteAddFlight = false;   // true while a local note is being saved (pauses the notes poll)
var CURRENT_TAB = 'master';

function loadConfig() {
  var params = new URLSearchParams(window.location.search);
  var officeId = (params.get('office') || '').toLowerCase().trim();
  if (!officeId || !OFFICE_NAMES[officeId]) {
    showError('Invalid office URL. Contact your admin for the correct link.');
    return false;
  }
  CFG = { officeId: officeId, officeName: OFFICE_NAMES[officeId] };
  document.title = CFG.officeName + ' Dashboard';
  var _lg = OFFICE_LOGOS[officeId];
  if (_lg && _lg.full) {
    var _logoEl = document.getElementById('login-office-logo');
    _logoEl.innerHTML = '<img src="'+_lg.full+'" alt="'+CFG.officeName+'" style="max-width:230px;max-height:'+(_lg.loginH||66)+'px;object-fit:contain">';
    _logoEl.style.display = 'block';
    // Bayview: gold login-card background (same layout as other offices) — navy text +
    // white inputs via .lc-gold so it stays readable; the navy logo sits on the gold.
    var _lcard = document.querySelector('.login-card');
    if (_lcard) _lcard.classList.toggle('lc-gold', officeId === 'bayview');
    document.getElementById('login-office-name').style.display = 'none';
  } else {
    document.getElementById('login-office-name').textContent = CFG.officeName;
  }
  // Recolor the whole portal (buttons, accents, login glow) to this office.
  applyOfficeTheme(officeId);
  return true;
}

function showError(msg) {
  document.getElementById('login-office-name').innerHTML = icon('issues') + ' ' + esc(msg);
}

// ── API ──────────────────────────────────────────────────────────────────
// Phase 1 Stage C: if the backend rejects a call because the badge is missing or
// expired (strict mode), clear the session and send the user back to sign in.
var _reauthing = false;
function _forceReauth() {
  if (_reauthing) return; _reauthing = true;
  try { sessionStorage.removeItem('as_session_' + CFG.officeId); } catch(e) {}
  _clearDataCache();
  SESSION = {};
  var app = document.getElementById('app'); if (app) app.style.display = 'none';
  var ls = document.getElementById('login-screen'); if (ls) ls.style.display = 'flex';
  if (typeof loginShowStep === 'function') loginShowStep('email');
  var err = document.getElementById('login-error');
  if (err) { err.textContent = 'Your session expired — please sign in again.'; err.style.display = 'block'; }
}
function _authIntercept(j) { if (j && j.error === 'auth_required') _forceReauth(); return j; }

// In-flight GET de-dupe: concurrent identical reads (same query string) share
// one network round-trip instead of each firing its own. Collapses the first-paint
// overlaps (e.g. readActRateLines preload + tab open, readPostedSales bg-refresh +
// modal open). Safe because every api() call is an idempotent read — all writes go
// through apiPost. The entry is cleared the moment the request settles, so periodic
// background refreshes (90s apart) never collide and always get fresh data.
var _API_INFLIGHT = {};
function api(params) {
  params.key = API_KEY;
  params.officeId = CFG.officeId;
  if (SESSION && SESSION.token) params.token = SESSION.token;   // Phase 1 Stage B: carry the badge
  var qs = Object.keys(params).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  if (_API_INFLIGHT[qs]) return _API_INFLIGHT[qs];
  var p = fetch(APPS_SCRIPT_URL + '?' + qs).then(function(r) { return r.json(); }).then(_authIntercept);
  _API_INFLIGHT[qs] = p;
  var clear = function() { delete _API_INFLIGHT[qs]; };
  p.then(clear, clear);
  return p;
}

function apiPost(body) {
  body.key = API_KEY;
  body.officeId = CFG.officeId;
  if (SESSION && SESSION.token) body.token = SESSION.token;     // Phase 1 Stage B: carry the badge
  return fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(function(r) { return r.json(); }).then(_authIntercept);
}

// ── AUTH ─────────────────────────────────────────────────────────────────
var LOGIN_EMAIL = '';

function initLogin() {
  if (!loadConfig()) return;
  document.getElementById('login-continue-btn').onclick = loginCheckEmail;
  document.getElementById('login-btn').onclick = doLogin;
  document.getElementById('login-set-pin-btn').onclick = doSetPin;
  document.getElementById('login-upg-btn').onclick = doUpgrade;
  document.getElementById('login-email').addEventListener('keydown', function(e) { if (e.key === 'Enter') loginCheckEmail(); });
  document.getElementById('login-pin').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-new-pin').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('login-confirm-pin').focus(); });
  document.getElementById('login-confirm-pin').addEventListener('keydown', function(e) { if (e.key === 'Enter') doSetPin(); });
  document.getElementById('login-upg-current').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('login-upg-pin').focus(); });
  document.getElementById('login-upg-pin').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('login-upg-confirm').focus(); });
  document.getElementById('login-upg-confirm').addEventListener('keydown', function(e) { if (e.key === 'Enter') doUpgrade(); });
  document.getElementById('login-reset-btn').onclick = doResetWithToken;
  document.getElementById('login-reset-pin').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('login-reset-confirm').focus(); });
  document.getElementById('login-reset-confirm').addEventListener('keydown', function(e) { if (e.key === 'Enter') doResetWithToken(); });

  // Arrived from a password-reset email (…?pwreset=<token>) → show the set-new-password
  // screen. Strip the token from the URL so it isn't left in history/the address bar.
  var _p = new URLSearchParams(window.location.search);
  var _pwreset = _p.get('pwreset');
  if (_pwreset) {
    LOGIN_RESET_TOKEN = _pwreset;
    try { _p.delete('pwreset'); var _q = _p.toString(); history.replaceState(null, '', window.location.pathname + (_q ? '?' + _q : '')); } catch(e) {}
    loginShowStep('resetset');
    _pwCheck('login-reset-pin', 'login-reset-req');
    document.getElementById('login-reset-pin').focus();
    return;   // don't auto-restore a session — they came here to reset
  }

  var saved = sessionStorage.getItem('as_session_' + CFG.officeId);
  if (saved) { try { SESSION = JSON.parse(saved); showApp(); } catch(e) {} }
}

function loginShowStep(step) {
  document.documentElement.setAttribute('data-theme', 'dark');   // the login screen is always dark
  document.getElementById('ls-email-step').style.display   = step === 'email'  ? '' : 'none';
  document.getElementById('ls-pin-step').style.display     = step === 'pin'    ? '' : 'none';
  document.getElementById('ls-set-pin-step').style.display = step === 'setpin' ? '' : 'none';
  document.getElementById('ls-upgrade-step').style.display = step === 'upgrade'? '' : 'none';
  document.getElementById('ls-reset-sent-step').style.display = step === 'resetsent' ? '' : 'none';
  document.getElementById('ls-reset-set-step').style.display  = step === 'resetset'  ? '' : 'none';
  document.getElementById('login-error').style.display = 'none';
  // Reset action buttons to their default enabled state every time a step is
  // shown. Fixes the "Sign In" button stuck on "Signing in…" — doLogin sets that
  // loading state and on SUCCESS navigates away without resetting it, so it would
  // carry over to the next sign-in until a hard refresh rebuilt the DOM.
  var _rb = function(id, txt){ var b = document.getElementById(id); if (b) { b.disabled = false; b.textContent = txt; } };
  _rb('login-continue-btn', 'Continue');
  _rb('login-btn', 'Sign In');
  _rb('login-set-pin-btn', 'Set Password & Sign In');
  _rb('login-upg-btn', 'Update Password & Sign In');
  _rb('login-reset-btn', 'Set Password & Sign In');
}

var LOGIN_RESET_TOKEN = '';   // reset token from the ?pwreset= link, held only for the reset step
var _resendTimer = null;      // interval driving the visible countdown
var _resetCooldownUntil = 0;  // ms timestamp; NO new reset email may be sent before this (global — survives navigation)
// Send a reset email only if the 30s cooldown has elapsed; either way (re)start the
// visible countdown. Global by timestamp, so it can't be bypassed by re-navigating
// to "Forgot password?". Backend also hard-caps at 3 per 15 min as the real backstop.
function _sendResetIfAllowed() {
  if (!LOGIN_EMAIL) return;
  if (Date.now() >= _resetCooldownUntil) {
    _resetCooldownUntil = Date.now() + 30000;
    // Always fire-and-forget the same request (the backend never reveals whether the email exists).
    apiPost({ action:'requestPasswordReset', email:LOGIN_EMAIL });
  }
  _startResendCountdown();
}
// "Forgot password?" — show the confirmation and request a link (rate-limited above).
function doForgotPassword() {
  document.getElementById('login-error').style.display = 'none';
  if (!LOGIN_EMAIL) { loginBack(); return; }
  document.getElementById('login-reset-sent-who').textContent = LOGIN_EMAIL;
  loginShowStep('resetsent');
  _sendResetIfAllowed();
}
// Resend button — same cooldown-guarded request.
function doResendReset() { _sendResetIfAllowed(); }
// Drive the countdown label from the shared cooldown timestamp; disable the button
// until it elapses. Recomputes each tick so it stays correct across navigation.
function _startResendCountdown() {
  var btn = document.getElementById('login-resend-btn');
  if (_resendTimer) { clearInterval(_resendTimer); _resendTimer = null; }
  var tick = function() {
    var secs = Math.ceil((_resetCooldownUntil - Date.now()) / 1000);
    if (secs <= 0) { clearInterval(_resendTimer); _resendTimer = null; btn.disabled = false; btn.textContent = 'Resend link'; }
    else { btn.disabled = true; btn.textContent = 'Resend link in ' + secs + 's'; }
  };
  tick();
  _resendTimer = setInterval(tick, 1000);
}
// Set a new password using the token from the emailed link, then sign in.
function doResetWithToken() {
  var newPw  = document.getElementById('login-reset-pin').value;
  var confirm = document.getElementById('login-reset-confirm').value;
  var err = document.getElementById('login-error');
  var btn = document.getElementById('login-reset-btn');
  err.style.display = 'none';
  var pErr = _pwClientError(newPw);
  if (pErr) { err.textContent = pErr; err.style.display = 'block'; return; }
  if (newPw !== confirm) { err.textContent = "Passwords don't match. Try again."; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Setting password…';
  apiPost({ action: 'resetPasswordWithToken', token: LOGIN_RESET_TOKEN, newPin: newPw }).then(function(res) {
    if (res && res.ok && res.valid) { LOGIN_RESET_TOKEN = ''; if (res.email) LOGIN_EMAIL = res.email; _adoptSession(res); }
    else {
      err.textContent = (res && res.error) || 'Could not reset your password. The link may have expired — request a new one.';
      err.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Set Password & Sign In';
    }
  }).catch(function() {
    err.textContent = 'Connection error. Try again.';
    err.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Set Password & Sign In';
  });
}
function _resetCancel() { LOGIN_RESET_TOKEN = ''; loginBack(); }

// Password policy (mirrors the backend _pwPolicyError exactly). Returns an error
// string or null. The backend re-checks — this is UX only.
function _pwClientError(pw) {
  pw = String(pw || '');
  if (pw.length < 8)            return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(pw))        return 'Password needs an uppercase letter.';
  if (!/[a-z]/.test(pw))        return 'Password needs a lowercase letter.';
  if (!/[0-9]/.test(pw))        return 'Password needs a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password needs a special character (e.g. !?@#$).';
  return null;
}
// Live-tick the requirements checklist under a password field as the user types.
function _pwCheck(inputId, listId) {
  var pw = document.getElementById(inputId).value;
  var checks = { len: pw.length >= 8, upper: /[A-Z]/.test(pw), lower: /[a-z]/.test(pw), num: /[0-9]/.test(pw), special: /[^A-Za-z0-9]/.test(pw) };
  var items = document.querySelectorAll('#' + listId + ' li');
  for (var i = 0; i < items.length; i++) { items[i].classList.toggle('ok', !!checks[items[i].getAttribute('data-k')]); }
}

function loginBack() {
  LOGIN_EMAIL = '';
  if (_resendTimer) { clearInterval(_resendTimer); _resendTimer = null; }
  loginShowStep('email');
  document.getElementById('login-email').value = '';
  document.getElementById('login-email').focus();
}

function loginCheckEmail() {
  var email = document.getElementById('login-email').value.trim().toLowerCase();
  var err = document.getElementById('login-error');
  var btn = document.getElementById('login-continue-btn');
  err.style.display = 'none';
  if (!email) { err.textContent = 'Enter your email address.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Checking…';
  apiPost({ action: 'checkEmail', email: email }).then(function(res) {
    btn.disabled = false; btn.textContent = 'Continue';
    if (!res.ok) { err.textContent = res.error || 'Something went wrong. Try again.'; err.style.display = 'block'; return; }
    LOGIN_EMAIL = email;
    if (!res.found) {
      err.textContent = "Your email isn't recognized. Contact your Owner or Admin to be added to the system.";
      err.style.display = 'block';
      return;
    }
    if (res.hasPin && res.needsUpgrade) {
      // Still on the old PIN format — go straight to the combined upgrade screen
      // (enter current PIN once + choose a new password), no confusing password prompt.
      document.getElementById('login-who-upg').textContent = email;
      loginShowStep('upgrade');
      document.getElementById('login-upg-current').value = '';
      document.getElementById('login-upg-pin').value = '';
      document.getElementById('login-upg-confirm').value = '';
      _pwCheck('login-upg-pin', 'login-upg-req');
      document.getElementById('login-upg-current').focus();
    } else if (res.hasPin) {
      document.getElementById('login-who').textContent = email;
      loginShowStep('pin');
      document.getElementById('login-pin').value = '';
      document.getElementById('login-pin').focus();
    } else {
      document.getElementById('login-who-set').textContent = email;
      loginShowStep('setpin');
      document.getElementById('login-new-pin').value = '';
      document.getElementById('login-confirm-pin').value = '';
      _pwCheck('login-new-pin', 'login-new-pin-req');
      document.getElementById('login-new-pin').focus();
    }
  }).catch(function() {
    btn.disabled = false; btn.textContent = 'Continue';
    err.textContent = 'Connection error. Try again.';
    err.style.display = 'block';
  });
}

function doLogin() {
  var pin = document.getElementById('login-pin').value.trim();
  var err = document.getElementById('login-error');
  var btn = document.getElementById('login-btn');
  err.style.display = 'none';
  if (!pin) { err.textContent = 'Enter your PIN.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  apiPost({ action: 'validatePin', email: LOGIN_EMAIL, pin: pin }).then(function(res) {
    if (res.ok && res.valid) {
      SESSION = { email: LOGIN_EMAIL, homeOffice: CFG.officeId, permissions: res.permissions || CFG.officeId };
      if (res.rank) { SESSION.role = res.rank; SESSION._actualRole = res.rank; }
      SESSION.isMaster = res.rank === 'master-admin';
      if (res.token) { SESSION.token = res.token; SESSION.tokenExpires = res.tokenExpires; }   // Phase 1 Stage B: keep the badge
      _reauthing = false;   // fresh session — re-arm the expiry handler
      sessionStorage.setItem('as_session_' + CFG.officeId, JSON.stringify(SESSION));
      showApp();
    } else if (res.mustUpgrade) {
      // Fallback: a correct old PIN reached the sign-in path (e.g. checkEmail's
      // needsUpgrade wasn't honored). Route to the upgrade screen with the
      // just-verified PIN pre-filled so they only choose a new password.
      document.getElementById('login-who-upg').textContent = LOGIN_EMAIL;
      loginShowStep('upgrade');
      document.getElementById('login-upg-current').value = pin;
      document.getElementById('login-upg-pin').value = '';
      document.getElementById('login-upg-confirm').value = '';
      _pwCheck('login-upg-pin', 'login-upg-req');
      document.getElementById('login-upg-pin').focus();
    } else {
      err.textContent = res.error || 'Incorrect password. Try again.';
      err.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  }).catch(function() {
    err.textContent = 'Connection error. Try again.';
    err.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Sign In';
  });
}
// Shared: adopt a successful login/upgrade/set response into SESSION + enter app.
function _adoptSession(res) {
  SESSION = { email: LOGIN_EMAIL, homeOffice: CFG.officeId, permissions: res.permissions || CFG.officeId };
  if (res.rank) { SESSION.role = res.rank; SESSION._actualRole = res.rank; }
  SESSION.isMaster = res.rank === 'master-admin';
  if (res.token) { SESSION.token = res.token; SESSION.tokenExpires = res.tokenExpires; }
  _reauthing = false;
  sessionStorage.setItem('as_session_' + CFG.officeId, JSON.stringify(SESSION));
  showApp();
}

function doUpgrade() {
  var curPin = document.getElementById('login-upg-current').value.trim();
  var newPw  = document.getElementById('login-upg-pin').value;
  var confirm = document.getElementById('login-upg-confirm').value;
  var err = document.getElementById('login-error');
  var btn = document.getElementById('login-upg-btn');
  err.style.display = 'none';
  if (!curPin) { err.textContent = 'Enter your current PIN.'; err.style.display = 'block'; return; }
  var pErr = _pwClientError(newPw);
  if (pErr) { err.textContent = pErr; err.style.display = 'block'; return; }
  if (newPw !== confirm) { err.textContent = "Passwords don't match. Try again."; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  apiPost({ action: 'upgradePin', email: LOGIN_EMAIL, currentPin: curPin, newPin: newPw }).then(function(res) {
    if (res.ok && res.valid) { _adoptSession(res); }
    else {
      err.textContent = res.error || 'Could not update your password. Try again.';
      err.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Update Password & Sign In';
    }
  }).catch(function() {
    err.textContent = 'Connection error. Try again.';
    err.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Update Password & Sign In';
  });
}

function doSetPin() {
  var newPin     = document.getElementById('login-new-pin').value.trim();
  var confirmPin = document.getElementById('login-confirm-pin').value.trim();
  var err = document.getElementById('login-error');
  var btn = document.getElementById('login-set-pin-btn');
  err.style.display = 'none';
  var pErr = _pwClientError(newPin);
  if (pErr) { err.textContent = pErr; err.style.display = 'block'; return; }
  if (newPin !== confirmPin) { err.textContent = "Passwords don't match. Try again."; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Setting password…';
  apiPost({ action: 'setPin', email: LOGIN_EMAIL, pin: newPin }).then(function(res) {
    if (res.ok && res.valid) {
      _adoptSession(res);
    } else {
      err.textContent = res.error || 'Failed to set password. Try again.';
      err.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Set Password & Sign In';
    }
  }).catch(function() {
    err.textContent = 'Connection error. Try again.';
    err.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Set Password & Sign In';
  });
}

function signOut() {
  clearInterval(_inactivityInterval);
  clearInterval(_bgInterval);
  clearInterval(_luInterval);
  clearInterval(_notesInterval);
  _CACHE.mainDataTs = 0; _CACHE.lstSalesTs = 0;
  _pendingRefresh = false;
  // Phase 1 Stage B: best-effort revoke the badge server-side on sign-out.
  try { if (SESSION && SESSION.token) apiPost({ action: 'logout', token: SESSION.token }); } catch(e) {}
  sessionStorage.removeItem('as_session_' + CFG.officeId);
  _clearDataCache();
  DATA = {}; SESSION = {}; LOGIN_EMAIL = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  loginShowStep('email');
  document.getElementById('login-email').value = '';
}

function _startInactivityWatcher() {
  _lastActivity = Date.now();
  document.addEventListener('click',   function() { _lastActivity = Date.now(); });
  document.addEventListener('keydown', function() { _lastActivity = Date.now(); });
  clearInterval(_inactivityInterval);
  _inactivityInterval = setInterval(function() {
    if (document.getElementById('app').style.display === 'none') return;
    if (Date.now() - _lastActivity > SESSION_TIMEOUT_MS) {
      clearInterval(_inactivityInterval);
      signOut();
      var err = document.getElementById('login-error');
      if (err) { err.textContent = 'Signed out due to inactivity.'; err.style.display = 'block'; }
    }
  }, 60000);
}

// ── APP INIT ─────────────────────────────────────────────────────────────
// ── Light/Dark theme toggle ────────────────────────────────────────────────
// Master-admin + activator always stay on the dark theme. Everyone else can
// toggle; the choice persists per browser (localStorage 'as_theme').
function _themeAllowed() {
  return true;   // every role can see + use the toggle (defaults still differ: owner = light, others = dark)
}
function _applyTheme() {
  var allowed = _themeAllowed(), pref = '';
  try { pref = localStorage.getItem('as_theme') || ''; } catch (e) {}
  var theme;
  if (!allowed) theme = 'dark';                                 // (reserved) force dark if a role is ever disallowed
  else if (pref === 'light' || pref === 'dark') theme = pref;   // an explicit toggle choice wins
  else theme = ((SESSION.role || '').toLowerCase() === 'owner') ? 'light' : 'dark';  // default: owner = light, everyone else dark
  document.documentElement.setAttribute('data-theme', theme);
  var tg = document.getElementById('theme-toggle');
  if (tg) {
    tg.style.display = allowed ? '' : 'none';
    tg.innerHTML = theme === 'light' ? icon('moon') : icon('sun');
    tg.title = theme === 'light' ? 'Switch to dark' : 'Switch to light';
  }
  // Recompute the office accent for the new theme (gold offices use a darker ink in light mode).
  if (typeof CFG !== 'undefined' && CFG && CFG.officeId) applyOfficeTheme(CFG.officeId);
}
function _toggleTheme() {
  if (!_themeAllowed()) return;
  var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('as_theme', next); } catch (e) {}
  _applyTheme();
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  _applyTheme();   // master-admin/activator forced dark; others honor their saved choice
  // On phones/tablets, land new sessions on Post Sale (reps log sales in the field).
  // Only runs at session entry — Refresh and office-switch go through loadData (not
  // showApp), so they keep whatever tab the user is on. loadData's role guard still
  // redirects any role that can't access Post Sale to its first allowed tab.
  if (window.innerWidth <= 768) CURRENT_TAB = 'postsale';
  _setSidebarOfficeLogo(CFG.officeId);
  buildOfficeSwitcher();
  buildNav();
  loadData();
  _startInactivityWatcher();
  _startBgRefresh();
}


function _setSidebarOfficeLogo(officeId) {
  var el = document.getElementById('sb-office-name');
  var lg = OFFICE_LOGOS[officeId];
  if (lg && lg.full) {
    if (lg.logoBg) {
      // Bayview: the whole sidebar is gold (.sb-gold), so the logo just sits on it,
      // centered + larger. (Logo art unchanged.)
      el.style.cssText = 'display:block;margin:4px 0;text-align:center';
      el.innerHTML = '<img src="'+lg.full+'" alt="'+(OFFICE_NAMES[officeId]||officeId)+'" style="height:'+(lg.sidebarH||34)+'px;max-width:100%;object-fit:contain">';
    } else {
      el.innerHTML = '<img src="'+lg.full+'" alt="'+(OFFICE_NAMES[officeId]||officeId)+'" style="height:'+(lg.sidebarH||34)+'px;max-width:200px;object-fit:contain;object-position:left center">';
    }
  } else {
    el.textContent = OFFICE_NAMES[officeId] || '—';
  }
  // Bayview: flip the whole sidebar to gold + navy text (offices with logoBg).
  var _sb = document.querySelector('.sidebar');
  if (_sb) _sb.classList.toggle('sb-gold', !!(lg && lg.logoBg));
}

function buildOfficeSwitcher() { updateOfficeDropdown(); }

function updateOfficeDropdown() {
  var wrap = document.getElementById('office-dd-wrap'); if (!wrap) return;
  var permitted = SESSION.role === 'master-admin'
    ? Object.keys(OFFICE_NAMES)
    : (SESSION.permissions || CFG.officeId).split(',').map(function(o){ return o.trim(); }).filter(function(o){ return OFFICE_NAMES[o]; });
  if (permitted.length <= 1) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'inline-block';
  var _ddLbl = document.getElementById('office-dd-label');
  var _curLogo = OFFICE_LOGOS[CFG.officeId];
  if (_curLogo && _curLogo.emblem) {
    _ddLbl.innerHTML = '<img src="'+_curLogo.emblem+'" alt="'+(OFFICE_NAMES[CFG.officeId]||CFG.officeId)+'" style="height:22px;object-fit:contain;vertical-align:middle">';
  } else {
    _ddLbl.textContent = OFFICE_NAMES[CFG.officeId] || CFG.officeId;
  }
  document.getElementById('office-dd-panel').innerHTML = permitted.map(function(o) {
    var isCurrent = o === CFG.officeId;
    var color = OFFICE_COLORS[o] || '#555';
    var oLogo = OFFICE_LOGOS[o];
    // Gold/light emblems (Viridian) wash out on white — give them a dark tile.
    var _iconBg = (OFFICE_THEME[o] && o === 'viridian') ? OFFICE_THEME[o].band : '#fff';
    var iconHtml = oLogo && oLogo.emblem
      ? '<div class="office-dd-icon" style="background:'+_iconBg+';padding:2px;overflow:hidden"><img src="'+oLogo.emblem+'" alt="'+(OFFICE_NAMES[o]||o)+'" style="width:100%;height:100%;object-fit:contain"></div>'
      : '<div class="office-dd-icon" style="background:'+color+'">'+((OFFICE_NAMES[o]||o).charAt(0).toUpperCase())+'</div>';
    return '<div class="office-dd-item" onclick="selectOffice(\''+o+'\')">'+
      iconHtml+
      '<span>'+OFFICE_NAMES[o]+'</span>'+
      (isCurrent ? '<span class="office-dd-current">Current</span>' : '')+
      '</div>';
  }).join('');
}

function toggleOfficeDropdown(e) {
  e.stopPropagation();
  document.getElementById('office-dd-panel').classList.toggle('open');
}

function selectOffice(officeId) {
  document.getElementById('office-dd-panel').classList.remove('open');
  switchOffice(officeId);
}

function switchOffice(newOfficeId) {
  if (!OFFICE_NAMES[newOfficeId] || newOfficeId === CFG.officeId) return;
  CFG.officeId = newOfficeId;
  CFG.officeName = OFFICE_NAMES[newOfficeId];
  applyOfficeTheme(newOfficeId);   // recolor the UI to the new office
  _setSidebarOfficeLogo(newOfficeId);
  window.history.pushState({}, '', window.location.pathname + '?office=' + newOfficeId);
  updateOfficeDropdown();
  TAB_CACHE = {};
  // Daily Report keeps its own cache (loadData skips re-rendering it). Clear it
  // on office switch so the tab can't show the previous office's report, and
  // re-render now if the user is sitting on it (regenerates for the new office).
  _DR_DATA = undefined; _DR_DATES = null; _DR_SEL_DATE = null; _DR_LOADING = false;
  if (CURRENT_TAB === 'dailyreport') {
    var _drc = document.getElementById('main-content');
    if (_drc) _drc.innerHTML = renderDailyReport();
  }
  // Tab data caches are office-specific — clear them so the new office refetches.
  _APPT.appointments = null; _APPT.activators = null; _APPT.blocked = {}; _APPT.blockedLoaded = {}; _APPT.filterEmail = ''; _apptFlight = null;
  if (_trTimer) { clearInterval(_trTimer); _trTimer = null; }
  _TRAINING_ORDERS = null;
  _PSV_SALES = null;
  PEOPLE_TABLEAU_NAMES = null;
  loadData();
}

// All 8 portal roles
var ALL_ROLES  = ['master-admin','owner','admin','activator','client-rep','leader','jd','manager'];
// Call-log tabs + Master Tracker: not visible to client-rep or leader (who get
// the My Orders / My Team's Orders tabs instead). jd is included — jd has the
// same office-wide visibility as a manager.
var ROLES_CALL = ['master-admin','owner','admin','activator','jd','manager'];
// Rep-side tabs: not visible to activator
var ROLES_REP  = ['master-admin','owner','admin','client-rep','leader','jd','manager'];
// Payroll/tracking tabs: leadership only
var ROLES_PAYROLL = ['master-admin','owner','admin'];
var TABS = [
  { id: 'postsale',    label: 'Post Sale',            roles: ROLES_REP,  group: 'Sales',       sub: 'Log a new sale' },
  { id: 'rehash',      label: 'Rehash Text',          roles: ROLES_REP,  group: 'Sales',       sub: 'Generate the customer welcome text' },
  { id: 'postedsales', label: 'Posted Sales',         roles: ALL_ROLES,  group: 'Sales',       sub: 'View & correct posted sales' },
  { id: 'appointments', label: 'Appointments',         roles: ALL_ROLES,  group: 'Scheduling',  sub: 'Book & manage LD appointments' },
  { id: 'myappts',      label: 'My Appointments',      roles: ['master-admin','activator'], group: 'Scheduling', sub: 'Your booked appointments across every office' },
  { id: 'myorders',    label: 'My Orders',           roles: ['client-rep','leader','jd','manager'], group: 'Orders', sub: 'Your own orders — 120-day window' },
  { id: 'myteam',      label: "My Team's Orders",      roles: ['leader','jd','manager'],              group: 'Orders', sub: "Your team's orders — 120-day window" },
  { id: 'master',      label: 'Master Tracker',       roles: ROLES_CALL, group: 'Call Logs',   sub: '120-day window' },
  { id: 'dayafter',    label: 'Day-After Calls',      roles: ROLES_CALL, group: 'Call Logs',   sub: "Yesterday's deliveries" },
  { id: 'delivered',   label: 'Delivered Not Active', roles: ROLES_CALL, group: 'Call Logs',   sub: 'Open & delivered orders' },
  { id: 'issues',      label: 'Order Issues',        roles: ROLES_CALL, group: 'Call Logs',   sub: 'Porting, BYOD & payment — 29-day window' },
  { id: 'escalations', label: 'Escalations',          roles: ROLES_CALL, group: 'Call Logs',   sub: '1 & 2 star ratings' },
  { id: 'noanswer',    label: 'No Answer',            roles: ROLES_CALL, group: 'Call Logs',   sub: 'No answer ratings' },
  { id: 'livesales',   label: 'Live Sales Tracker',   roles: ROLES_REP,  group: 'Performance', sub: "This week's leaderboard" },
  { id: 'dailyreport', label: 'Daily Report',         roles: ROLES_CALL, group: 'Performance', sub: 'Office daily summary' },
  { id: 'actrates',    label: 'Activation Rates',     roles: ROLES_REP,  group: 'Performance', sub: 'Rep activation breakdown' },
  { id: 'churn',       label: 'Churn Report',         roles: ROLES_REP,  group: 'Performance', sub: 'ICD disconnect breakdown' },
  { id: 'completed',   label: 'Completed Orders',     roles: ALL_ROLES,  group: 'Performance', sub: 'Fully completed — 120-day window' },
  { id: 'training',    label: 'Training & Tracking',   roles: ROLES_PAYROLL, group: 'Payroll',  sub: 'Every posted order + payout tracking' },
  { id: 'people',       label: 'People',               roles: ALL_ROLES,  group: 'Team',        sub: 'Roster & guests' },
  { id: 'teams',        label: 'Teams',                roles: ALL_ROLES,  group: 'Team',        sub: 'Team rosters & stats' },
  // TEMP: Activation Support parked at the very bottom + master-admin-only until the auto-emails go live;
  // then move it back into the 'Orders' group and reopen roles to the intended set.
  { id: 'actsupport',  label: 'Activation Support',    roles: ['master-admin'],  group: 'Beta',   sub: 'Pending & Activation sheets — Date → Rep → Product → Status (preview)' },
];

var _DEV_ROLE = null;

function _devToggleHtml() {
  var pills = PORTAL_ROLES
    .filter(function(r){ return r !== 'master-admin'; })
    .map(function(r){
      var active = _DEV_ROLE === r;
      return '<button class="dev-pill'+(active?' active':'')+'" onclick="_devSwitchRole(\''+ r +'\')" title="'+(active?'Click to reset':'Preview as ')+(_ROLE_LABELS[r]||r)+'">'+(_ROLE_LABELS[r]||r)+'</button>';
    }).join('');
  return '<div class="dev-label">Preview as</div><div class="dev-pills">'+pills+'</div>';
}

function _devSwitchRole(role) {
  // Clicking the active role resets back to master-admin
  _DEV_ROLE = (_DEV_ROLE === role) ? null : role;
  SESSION.role = _DEV_ROLE || SESSION._actualRole || 'master-admin';
  var nameEl = document.getElementById('sb-user-name');
  if (nameEl) nameEl.innerHTML = esc(SESSION.name) + ' · ' + (_DEV_ROLE ? icon('eye')+' '+esc(_ROLE_LABELS[_DEV_ROLE]||_DEV_ROLE) : esc(SESSION._actualRole));
  var wrap = document.getElementById('dev-toggle-wrap');
  if (wrap) wrap.innerHTML = _devToggleHtml();
  TAB_CACHE = {};
  buildNav();
  var tab = TABS.find(function(t){ return t.id === CURRENT_TAB; });
  if (!tab || !tab.roles.includes(SESSION.role)) {
    CURRENT_TAB = TABS.find(function(t){ return t.roles.includes(SESSION.role); }).id;
  }
  switchTab(CURRENT_TAB);
}

// ── MOBILE NAV DRAWER ───────────────────────────────────────────────────
function toggleDrawer() {
  var sb = document.querySelector('.sidebar');
  var open = sb.classList.toggle('open');
  document.getElementById('scrim').classList.toggle('show', open);
}
function closeDrawer() {
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('scrim').classList.remove('show');
}
window.addEventListener('resize', function() {
  if (window.innerWidth > 768) closeDrawer();
});

// SVG icon helper — references a <symbol> in the sprite at the top of <body>.
// currentColor makes the icon inherit the surrounding text color (auto-themes),
// and it renders identically on every device (unlike emoji). See the sprite comment.
function icon(name) { return '<span class="ico"><svg><use href="#i-' + name + '"></use></svg></span>'; }
// Colored icon variant — for the few semantic glyphs that carry meaning through color
// (gold/silver/bronze medals, orange/blue hot/cold). `filled` uses the .ico-fill class
// for solid Unicons glyphs; otherwise a stroked Feather glyph tinted via `color`.
function iconc(name, color, filled) { return '<span class="' + (filled ? 'ico-fill' : 'ico') + '" style="color:' + color + '"><svg><use href="#i-' + name + '"></use></svg></span>'; }
// Real medal graphic (gold/silver/bronze) — a filled disc + ribbon + engraved star, in
// the metal's own two tones (meaning IS the color, so it is not themed). Rendered inline
// rather than via the sprite because the sprite forces a single currentColor. rank: 0=gold.
function medalSvg(rank) {
  var C = [['#FFCB3D','#C88A1E'],['#DCE1E8','#98A2AF'],['#DB9153','#A6612C']][rank] || ['#FFCB3D','#C88A1E'];
  var face = C[0], edge = C[1];
  return '<span class="medal"><svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M7.5 1.5 L10.8 1.5 L12.4 9.5 L9.2 11 Z" fill="' + edge + '"/>' +
    '<path d="M16.5 1.5 L13.2 1.5 L11.6 9.5 L14.8 11 Z" fill="' + face + '"/>' +
    '<circle cx="12" cy="15" r="6.3" fill="' + face + '" stroke="' + edge + '" stroke-width="1"/>' +
    '<circle cx="12" cy="15" r="4.5" fill="none" stroke="' + edge + '" stroke-width="0.7" opacity="0.55"/>' +
    '<path d="M12 11.6 L12.91 13.75 L15.23 13.95 L13.47 15.48 L14 17.75 L12 16.55 L10 17.75 L10.53 15.48 L8.77 13.95 L11.09 13.75 Z" fill="' + edge + '"/>' +
    '</svg></span>';
}

function buildNav() {
  var role = SESSION.role || 'client-rep';
  var nav = document.getElementById('sidebar-nav');
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Primary');
  nav.innerHTML = '';
  var lastGroup = null;
  TABS.forEach(function(t) {
    if (!t.roles.includes(role)) return;
    if (t.group && t.group !== lastGroup) {
      var lbl = document.createElement('div');
      lbl.className = 'nav-group-label';
      lbl.textContent = t.group;
      nav.appendChild(lbl);
      lastGroup = t.group;
    }
    var el = document.createElement('div');
    el.className = 'nav-item' + (t.id === CURRENT_TAB ? ' active' : '');
    el.dataset.tab = t.id;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', t.label);
    el.setAttribute('aria-current', t.id === CURRENT_TAB ? 'page' : 'false');
    el.innerHTML = '<span class="nav-icon"><svg><use href="#i-' + t.id + '"></use></svg></span><span>' + t.label + '</span>';
    el.onclick = function() { switchTab(t.id); };
    el.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(t.id); } };
    nav.appendChild(el);
  });
}

function switchTab(id) {
  CURRENT_TAB = id;
  closeDrawer();
  document.querySelectorAll('.nav-item').forEach(function(el) {
    var on = el.dataset.tab === id;
    el.classList.toggle('active', on);
    el.setAttribute('aria-current', on ? 'page' : 'false');
  });
  var tab = TABS.find(function(t) { return t.id === id; });
  document.getElementById('page-title').textContent = tab ? tab.label : id;
  document.getElementById('page-subtitle').textContent = tab && tab.sub ? tab.sub : '';
  renderTab(id);
}

