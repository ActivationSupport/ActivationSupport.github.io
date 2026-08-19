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
// } — files must exist in dashboard/assets/); bookTint + bookLogo (booking UI).
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
    /* ⚠ btn/hover LIFTED 2026-08-18. The old pair (#16382A on #0e2a1f) had NO SEPARATION
       FROM THE CARD — measured 1.21:1 resting and 1.01:1 on hover, i.e. hovering made the
       only clickable thing on the login screen MORE invisible. The label was never the
       problem (12.9:1); the button SHAPE was. Now 2.96:1 / 2.07:1, still green, green on
       hover. ⚠ Gold was rejected here: a gold button needs dark ink, and dark ink on any
       green hover is ~1.2:1 — and --blueText has no hover variant to swap it. */
    theme:{ btn:'#2E7A4E', accent:'#D9C87E', dark:'#16281e', hover:'#226039', glow:'#7a5f18', band:'#1B3A2D', onBand:'#EFE2A2', sidebar:'#10221a', loginAccent:'#16382A', onAccent:'#16382A', lightInk:'#7a6a2e' },
    reportBrand:{ band:'#1B3A2D', headerText:'#EAF1EA', headerSub:'#cfd9cf', accent:'#D9C87E', accentText:'#D9C87E', logo:'viridian-logo-full.png', logoH:54 },
    /* ⚠⚠ HEIGHTS ARE BALANCED ON RENDERED AREA, NOT ON THE NUMBER. Source aspect ratios
       run 1:1 (this square monogram) to 5.5:1 (elevate), so identical heights gave a 3x
       spread on login and 5.5x in the DR header. Viridian is the extreme: it hits the
       HEIGHT cap where wide lockups hit the WIDTH cap, so it needs the largest values.
       ⚠ It still cannot fully match in the sidebar/DR — a square in a fixed-height row
       will always read smaller than a wide bar. Only a horizontal lockup would fix that. */
    logos:{ full:'assets/viridian-logo-full.png', emblem:'assets/viridian-logo-full.png', sidebarH:72, loginH:100, drHeaderH:40 },
    bookTint:'#2E7A4E', bookLogo:'viridian-logo-full.png'
  },
  elevate: {
    name:'Elevate', color:'#0B2E9C',
    theme:{ btn:'#0A1FFF', accent:'#3D5BFF', dark:'#14224a', hover:'#0816cc', glow:'#16306a', band:'#0B2E9C', onBand:'#ffffff', sidebar:'#111827' },
    reportBrand:{ band:'#111827', headerText:'#ffffff', headerSub:'#aab8d6', accent:'#0A1FFF', accentText:'#0A1FFF', logo:'elevate-logo-full-standard-blue.png', logoH:40 },
    logos:{ full:'assets/elevate-logo-full-standard-blue.png', emblem:'assets/elevate-logo-symbol-only-blue.png', sidebarH:36 },
    bookTint:'#3D5BFF', bookLogo:'elevate-logo-symbol-only-blue.png'
  },
  vanguard: {
    // Charcoal structure + BLUE app accent; RED (accent2b) on login/logo/badge; btnText white.
    name:'Vanguard', color:'#D81F1F',
    /* ⚠ btn/hover LIFTED 2026-08-18, same reason as viridian: charcoal-on-charcoal
       measured 1.10:1 resting / 1.23:1 hover against the card, so the primary action
       read as a disabled control. ⚠ MERELY LIGHTENING DOES NOT WORK — #3A3A3A only
       reached 1.36:1; a neutral has no hue to fall back on, so it needed a real colour.
       Red is not new here: it is already accent2b, loginAccent and the logo's swoosh.
       Now 3.06:1 / 2.26:1. ⚠ `accent` stays BLUE — the in-app accent is unchanged. */
    theme:{ btn:'#D81F1F', accent:'#3D67E8', accent2b:'#D81F1F', dark:'#19202e', hover:'#B31818', glow:'#241416', band:'#1C1C1C', onBand:'#ffffff', sidebar:'#161616', btnText:'#ffffff', loginAccent:'#E2483A', onAccent:'#ffffff' },
    reportBrand:{ band:'#1C1C1C', headerText:'#ffffff', headerSub:'#c9b3b1', accent:'#D81F1F', accentText:'#D81F1F', logo:'vanguard-logo-full-reverse.png', logoH:40 },
    logos:{ full:'assets/vanguard-logo-full-reverse.png', emblem:'assets/vanguard-logo-symbol-reverse.png', sidebarH:42, drHeaderH:27 },
    bookTint:'#2652D7', bookLogo:'vanguard-logo-symbol.png'
  },
  /* ── 🦴 OFFICE SKELETON — the working template for onboarding the next office ─────────
     Bayview Horizons was wired through all four projects and then never launched (2026-08-06,
     user). Its slot is kept as a live PLACEHOLDER rather than deleted, because every
     integration point is already threaded — which is exactly what a new office needs and
     what took the longest to get right the last two times.
     🔑 TO ONBOARD: rename this key, fill in name/colors, add a `logos` block, then mirror the
     SAME key into the other THREE projects — portal `Code.gs` (OFFICE_CONFIG + the
     weekly-report schedule), Appointment Scheduler (tz + emailBrand), Customer Booking
     (tz + the THEMES table in all three public pages). Miss one and the office half-works.
     ⚠ Neutral slate ON PURPOSE: unbranded should LOOK unbranded, not like a broken brand.
     ⚠ NO `logos` BLOCK, and that is the correct unbranded state — `loadConfig` and
     `_setSidebarOfficeLogo` both fall back to the office NAME when there is no logo.
     ⚠ `bookLogo:''` is a proven-safe value (salessupport ships it).
     ⚠⚠ `bookTint` MUST stay set — app.appts.js uses it for the cross-office booked-slot
     tint, which is the DOUBLE-BOOKING GUARD, not decoration. */
  bayview: {
    /* 🦴 SKELETON SLOT — retired, NOT an office. `skeleton:true` keeps it out of every
       user-facing office list (the master-admin switcher, the People permission checkboxes).
       ⚠ ONBOARDING = DELETE THIS ONE LINE. Do NOT infer skeleton-ness from a missing logo:
       a REAL office can be live before its artwork lands (see project-logos-pending), and
       inferring would silently hide it. */
    skeleton:true,
    name:'New Office', color:'#64748B',
    theme:{ btn:'#334155', accent:'#64748B', dark:'#1e293b', hover:'#475569', glow:'#1e293b', band:'#334155', onBand:'#ffffff', sidebar:'#1e293b' },
    reportBrand:{ band:'#334155', headerText:'#ffffff', headerSub:'#cbd5e1', accent:'#64748B', accentText:'#475569', logo:'', logoH:40 },
    bookTint:'#64748B', bookLogo:''
  },
  leadsphere: {
    // NAVY structure + BRIGHT-BLUE buttons/accent. White logo on dark chrome.
    name:'LeadSphere Solutions', color:'#2B6AFF',
    theme:{ btn:'#2B6AFF', accent:'#2B6AFF', dark:'#132a45', hover:'#1B4EC4', glow:'#173a63', band:'#0A2540', onBand:'#ffffff', sidebar:'#0b1a2b' },
    reportBrand:{ band:'#0A2540', headerText:'#ffffff', headerSub:'#9db4d8', accent:'#2B6AFF', accentText:'#2B6AFF', logo:'leadsphere-logo-full-reverse.png', logoH:42 },
    logos:{ full:'assets/leadsphere-logo-full-reverse.png', emblem:'assets/leadsphere-logo-symbol.png', sidebarH:44, drHeaderH:30 },
    bookTint:'#2B6AFF', bookLogo:'leadsphere-logo-symbol.png'
  },
  evolution: {
    // GOLD office — the second one, so it follows viridian's pattern, not leadsphere's.
    // Colours pixel-sampled from their own artwork: gold #F7C45D is 54% of the logo's
    // opaque pixels, orange #FDA243 is the emblem. Black chrome, per their site.
    // ⚠ Gold is BRIGHT (L=0.600): white on it is 1.9:1, so `onAccent` MUST stay dark —
    // and `lightInk` exists because gold accent TEXT is illegible on a light surface.
    name:'Evolution Concepts', color:'#F7C45D',
    theme:{ btn:'#8A4B12', accent:'#F7C45D', dark:'#2A1D10', hover:'#A85C18', glow:'#4A3110', band:'#1A1512', onBand:'#ffffff', sidebar:'#151110', onAccent:'#2A1B08', lightInk:'#8A6410' },
    reportBrand:{ band:'#1A1512', headerText:'#ffffff', headerSub:'#D9C7A5', accent:'#F7C45D', accentText:'#B4791C', logo:'evolution-logo-full.png', logoH:46 },
    // ⚠ Two-line lockup (3:1), so it needs MORE height than the wide offices to reach
    // the same visual weight, and slightly LESS on login where it was already largest.
    logos:{ full:'assets/evolution-logo-full.png', emblem:'assets/evolution-logo-symbol.png', sidebarH:50, loginH:62, drHeaderH:31 },
    bookTint:'#F7C45D', bookLogo:'evolution-logo-symbol.png'
  },
  revamped: {
    // DEEP VIOLET structure + bright purple accent. Their mark is purple on black.
    // ⚠ Accent sits at L≈0.17 deliberately — the same band as the shipped elevate
    // (#3D5BFF) and leadsphere (#2B6AFF) accents, so white `onAccent` clears 4.5:1.
    // The sampled #601CA5 was far too dark to use as an accent on dark chrome.
    name:'Revamped Strategies', color:'#9E48E4',
    theme:{ btn:'#7A2CBE', accent:'#9E48E4', dark:'#241338', hover:'#9442D8', glow:'#3A1A5E', band:'#1A0F28', onBand:'#ffffff', sidebar:'#150C20' },
    reportBrand:{ band:'#1A0F28', headerText:'#ffffff', headerSub:'#C9AEE4', accent:'#9E48E4', accentText:'#7A2CBE', logo:'revamped-logo-full-reverse.png', logoH:44 },
    // `fullLight` is the LIGHT-SURFACE twin. Revamped's wordmark is a thin
    // high-contrast serif, so the light-theme outline other offices use thickens its
    // hairlines into mush instead of defining them; it ships a dark-ink logo instead.
    // ⚠ Both files are emitted into the Daily Report header and CSS chooses — see
    // .dr-logo-light in app.css. _toggleTheme never re-renders the tab, so anything
    // that swapped the src in JS would show a stale logo until you changed tabs.
    logos:{ full:'assets/revamped-logo-full-reverse.png', fullLight:'assets/revamped-logo-full.png', emblem:'assets/revamped-logo-symbol.png', sidebarH:40 },
    bookTint:'#9E48E4', bookLogo:'revamped-logo-symbol.png'
  },
  // ── Sales Support — NOT a sales office: a Jedi-themed ticketing desk with its own
  // screens (app.tickets.js). No Tableau data, no daily report, no booking. Deep-space
  // dark is FORCED (see _applyTheme + the html[data-office="salessupport"] block in
  // app.css); the blue+green "lightsaber" accents come from theme.accent (blue) +
  // theme.accent2b (green). No logo yet → the login/sidebar fall back to the name text.
  salessupport: {
    name:'Sales Support', color:'#5AB0FF',
    theme:{ btn:'#1C55D4', accent:'#57ABFF', accent2b:'#38E08A', dark:'#0f1b3a', hover:'#1746b8', glow:'#12305f', band:'#0a1330', onBand:'#eaf2ff', sidebar:'#080c18', loginAccent:'#57ABFF', onAccent:'#ffffff', btnText:'#ffffff' },
    reportBrand:{ band:'#0a1330', headerText:'#ffffff', headerSub:'#9db4d8', accent:'#57ABFF', accentText:'#57ABFF', logo:'', logoH:40 },
    logos:{ full:'', emblem:'' },
    bookTint:'#57ABFF', bookLogo:''
  }
};
// Legacy per-map views, DERIVED from OFFICE_CONFIG (downstream code + key order unchanged).
function _ocfg(field){ var o={}; for (var k in OFFICE_CONFIG) o[k] = OFFICE_CONFIG[k][field]; return o; }
var OFFICE_NAMES        = _ocfg('name');
/* 🦴 A retired/unfilled slot must never appear in a list a PERSON reads. The office switcher
   and the People permission checkboxes both enumerated OFFICE_NAMES, so "New Office" showed up
   as switchable and as a tickable permission. Onboarding = drop `skeleton:true` and it returns. */
function _isSkeletonOffice(o) { return !!(OFFICE_CONFIG[o] && OFFICE_CONFIG[o].skeleton); }
function _liveOfficeIds()     { return Object.keys(OFFICE_NAMES).filter(function(o){ return !_isSkeletonOffice(o); }); }
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
  // In LIGHT mode, gold offices (Viridian) swap their pale accent for a darker
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
  document.documentElement.setAttribute('data-office', officeId);   // scopes the per-office CSS block (e.g. Sales Support deep-space palette)
  document.title = CFG.officeName + ' Dashboard';
  var _lg = OFFICE_LOGOS[officeId];
  if (_lg && _lg.full) {
    var _logoEl = document.getElementById('login-office-logo');
    _logoEl.innerHTML = '<img src="'+_lg.full+'" alt="'+CFG.officeName+'" style="max-width:230px;max-height:'+(_lg.loginH||66)+'px;object-fit:contain">';
    _logoEl.style.display = 'block';
    document.getElementById('login-office-name').style.display = 'none';
  } else {
    document.getElementById('login-office-name').textContent = CFG.officeName;
  }
  // Recolor the whole portal (buttons, accents, login glow) to this office.
  applyOfficeTheme(officeId);
  if (typeof _ssApplyBranding === 'function') _ssApplyBranding(officeId);   // Sales Support: Jedi wordmark + starfield login
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
  var _who = (SESSION && SESSION.email) ? String(SESSION.email).toLowerCase() : '';
  try { sessionStorage.removeItem('as_session_' + CFG.officeId); } catch(e) {}
  /* 🔑 A BADGE EXPIRY DROPS THE KEY, NOT THE DATA — AND THAT IS THE WHOLE POINT OF ENCRYPTING.
     This used to call _clearDataCache(), wiping the instant-paint cache moments before the
     same rep signed back in — which is why the first load every morning was a full cold
     ~5.8s blob fetch with a skeleton. It had to, because the cache was PLAINTEXT and a
     sign-out was the only thing making it leave the device.
     Now the payload is AES-GCM ciphertext, so dropping the KEY is strictly stronger than
     deleting the file: what remains on disk is unreadable, and it becomes readable again only
     when the same person types the same password. An expiry is not a sign-out — it is the
     same human, on the same device, about to sign back in as themselves.
     ⚠⚠ AN EXPLICIT SIGN-OUT STILL CLEARS EVERYTHING (see signOut). That distinction is the
     security posture: "I am done here, possibly on a shared machine" is a different statement
     from "your 12 hours elapsed", and only the first one means the device may change hands. */
  _cacheKeyDrop(_who);
  /* 🔴 AND SWEEP ANY PRE-ENCRYPTION *PLAINTEXT* NOTES RECORD, BECAUSE DROPPING THE KEY ONLY
     PROTECTS DATA THAT IS ACTUALLY CIPHERTEXT. The notes cache was plaintext until
     2026-08-13 and rode entirely on the _clearDataCache() call this function used to make,
     so the change above quietly left readable customer notes on the device across every
     expiry — and the expiry is the COMMON path (12h TTL ⇒ ~daily), while an explicit
     sign-out is the rare one. Measured on a real device: 257KB / 850 note groups.
     ⚠⚠ MUST RUN BEFORE `SESSION = {}` BELOW. _notesCacheKey() reads SESSION.email through
     _mainDataUser(); after the reset it would compute a key for the empty user and delete
     nothing — a silent no-op indistinguishable from a working fix. (_purgeLegacyPlainNotes
     scans by prefix so it is not strictly bound to that, but the ordering is the rule here
     and the next edit to either function should not have to rediscover it.)
     ⚠ ENCRYPTED notes records are KEPT ON PURPOSE, exactly like the blob: the key is gone,
     so what remains is unreadable until this same person types their password again. That is
     the whole point of the expiry/sign-out distinction above — do not "tidy" this into a
     blanket delete, which would re-break the morning load it was written to fix. */
  if (typeof _purgeLegacyPlainNotes === 'function') _purgeLegacyPlainNotes();
  SESSION = {};
  var app = document.getElementById('app'); if (app) app.style.display = 'none';
  var ls = document.getElementById('login-screen'); if (ls) ls.style.display = 'flex';
  if (typeof loginShowStep === 'function') loginShowStep('email');
  var err = document.getElementById('login-error');
  if (err) { err.textContent = 'Your session expired — please sign in again.'; err.style.display = 'block'; }
}
function _authIntercept(j) { if (j && j.error === 'auth_required') _forceReauth(); return j; }

/* ⚠⚠ THE ERROR REPORTER MUST NEVER BE A HARD DEPENDENCY OF THE TRANSPORT.
   app.errors.js loads first, so AS_ERR is normally there — but "normally" is not good
   enough for the layer every read and write goes through. If that bundle ever fails to
   arrive (a 404, a truncated download, a blocked request, an ad-blocker rule), an
   unguarded _ERR.netStart() below would throw inside EVERY api() and apiPost() call and
   take the whole portal down — because its ERROR REPORTER was missing. That is the
   reporter breaking the page, which is the single thing app.errors.js promises not to do.
   🔑 Caught by readoverpost_live.js, which loads app.core.js on its own and so reproduces
   exactly that scenario. Degrading to a no-op is the only acceptable behaviour: without
   the reporter the portal loses its diagnostics, never its function. */
var _ERR = (typeof AS_ERR !== 'undefined' && AS_ERR) || {
  report: function (c) { return c; },
  crumb: function () {}, netStart: function () {}, netEnd: function () {},
  label: function () { return 'Something went wrong'; },
  hint:  function () { return 'Please try again.'; }
};

/* ⚠⚠ NEVER CALL r.json() DIRECTLY ON AN APPS SCRIPT RESPONSE.
   `/exec` does not always return JSON. Google serves an HTML page for an execution error, a
   timeout, a quota trip or an auth interstitial, and r.json() then throws a PARSER error
   whose text leaks straight to the user — on iOS Safari that reads "The string did not match
   the expected pattern.", which tells a rep nothing and tells us nothing either.

   This was fixed for Sales Support in 2026-08-04 (`_ticketParse`) — but since the PERF-1b
   split that bundle only loads for ?office=salessupport, so the FIVE ACTIVATION OFFICES
   still had the raw r.json(). This is that fix, ported to the shared transports, which is
   where it should have lived in the first place.
   ✅ 2026-08-07: the debt was paid in BOTH directions — `_ticketParse` is now deleted and
   `_ticketGet`/`_ticketPost` route through `_asFetch` like everything else, so Sales
   Support finally gets the timeout, deadline, retry and error codes too. One transport.

   Contract, deliberately narrow so the 58 call sites do not change:
     · A JSON response behaves EXACTLY as before — including `{error:…}`, which is still
       RETURNED, not thrown, because every caller handles res.error itself.
     · A non-JSON response threw before (an opaque SyntaxError) and still throws now — but
       the thrown Error carries `.asCode`, a human message and a did-it-save flag.

   🔑 A classified failure sets `.asCode`, which app.errors.js uses to skip re-reporting it
   as a generic APP-01. Precise beats loud.

   ⚠ Deliberately does NOT call _forceReauth() on an HTML login interstitial. Signing the rep
   out on a response we cannot fully trust would make sign-outs MORE frequent, and the
   intermittent Sales Support sign-in is still unexplained — the point of this pass is to get
   that event LOGGED with a code, not to add a new way to be logged out. */
function _asParse(r, meta) {
  meta = meta || {};
  return r.text().then(function (t) {
    var j = null;
    try { j = JSON.parse(t); } catch (e) { j = null; }

    if (j) {
      /* ⚠⚠ `unauthorized` IS A TRANSPORT FAILURE, NOT A REFUSAL — THE ONE EXCEPTION TO THE
         "a JSON {error:…} is the server saying no on purpose" RULE BELOW.
         Measured 2026-08-06 from BOTH ENDS AT ONCE: `_Errors` carried 60 AUTH-02 rows across
         19 people, 4 offices and both portals, while the backend's `_KeyFailures` recorded 63
         requests that arrived as a bare GET with `params=0` and no post body — "the request
         carried no key". Same events, opposite ends of the wire.
         🔑 THE PROOF IS THAT A CLIENT CANNOT SEND A WRONG KEY. API_KEY is a build-time
         constant in this file — never reassigned, never user-supplied, never per-office. So
         the server answering `unauthorized` cannot mean "your key is wrong"; it can only mean
         the key never arrived, i.e. Google dropped the POST body upstream of the script.
         ⚠ THAT IS WHY THE 2026-08-06 TRANSPORT RETRY DID NOT COVER THIS. The script still
         RAN and answered cleanly, so this comes back as tidy JSON rather than the HTML 404
         handled below — it never looked like a transport failure to anything upstream.
         ⚠ Same reads-retry/writes-do-not rule as everything else: this throws into the very
         same _asMayRetry gate, so postSale is still never retried and validatePin — which
         calls _recordPinFail and could lock a rep out — is still never retried.
         ⚠⚠ ON THE FINAL ATTEMPT WE RETURN `j` UNCHANGED, exactly as today. Every caller
         checks `res.error`; rejecting here instead would change the contract of every read in
         the portal to diagnose one bug. The retry is added, the interface is not touched. */
      if (j.error === 'unauthorized') {
        if (meta.noReport) {                 // a retry is still coming — fail into it
          var kerr = new Error(_ERR.label('AUTH-02') + ' — ' + _ERR.hint('AUTH-02'));
          kerr.asCode = 'AUTH-02'; kerr.asTransport = true; kerr.asRetryable = true;
          throw kerr;
        }
        _ERR.report('AUTH-02', { message: 'unauthorized' }, {
          action: meta.action || '', kind: meta.write ? 'write' : 'read',
          attempts: meta.attempts || 1
        });
        return _authIntercept(j);
      }
      if (j.error && !_asExpectedRefusal(j, meta)) _asReportJsonError(j.error, meta);
      return _authIntercept(j);
    }

    var body = String(t || ''), code;
    if (/<form[^>]+accounts\.google\.com|ServiceLogin|signin\/v2/i.test(body)) code = 'AUTH-01';
    /* ⚠⚠ `too many`, NOT `too many requests` — GOOGLE'S REAL QUOTA PAGE SAYS NEITHER "quota"
       NOR "requests". The wording Apps Script actually serves is
         "Service invoked too many times for one day: urlfetch."
       which matches none of `exceeded`, `quota`, `too many requests` or `rate limit`, so it
       fell through to NET-01 ("No answer from the server") for a read and WRITE-02 ("that may
       not have saved — check before saving again") for a write. Both tell a rep to do the
       WRONG thing: the right advice for a quota trip is simply to wait, and NET-03 says so.
       🔑 THE CORRECT PATTERN WAS ALREADY IN THE CODEBASE AND WAS LOST IN THE PORT. Sales
       Support's `_ticketParse` had `/exceeded|quota|too many/i` from 2026-08-04; when that
       idea moved into this shared parser on 2026-08-06 the alternation was "tidied" to
       `too many requests`, which is HTTP 429 phrasing, not Google's. The narrowing was
       invisible because nothing tests against a real quota body.
       ⚠ Bare `too many` is safe here: this branch only ever sees a NON-JSON body we already
       failed to parse, i.e. a Google error page. Covered in salessupport_fixes_harness. */
    else if (/exceeded|quota|too many|rate limit/i.test(body))                code = 'NET-03';
    else if (!r.ok)                                                          code = 'NET-01';
    else                                                                     code = 'DATA-01';

    // For a WRITE we cannot tell whether the server acted before it failed to answer, and
    // that distinction is the difference between safely retrying and creating a duplicate.
    if (meta.write) code = (code === 'NET-01' || code === 'DATA-01') ? 'WRITE-02' : code;

    var err = new Error(_ERR.label(code) + ' — ' + _ERR.hint(code));
    err.asCode = code;
    err.asTransport = true;         // "we never got a usable answer", NOT "the server said no"
    err.asRetryable = code !== 'AUTH-01';
    /* ⚠ The status is already in the REPORT below; this puts it on the ERROR too, for the one
       caller that words it for a human (_ticketTransportMsg). Reading it off the response here
       is the only place it exists — `r` is gone by the time a .catch() sees this. */
    err.asHttp = r.status;
    /* ⚠ noReport = this attempt is about to be retried. Report only on the last one, or the log
       fills with failures the rep never saw and the real ones stop standing out.
       🔴🔴 …BUT "about to be retried" IS AN ASSUMPTION, AND FOR AUTH-01 IT IS FALSE. A
       non-retryable error is thrown straight out of the .catch below without a second attempt,
       so on attempt 0 `noReport` was true, nothing reported, and the error then left for good —
       THE HTML LOGIN INTERSTITIAL WAS NEVER LOGGED AT ALL. That is the one failure mode this
       whole pass exists to make visible (it is the long-unexplained intermittent sign-in), and
       it was the single case guaranteed to stay invisible.
       🔑 The condition is "is a retry actually coming", not "is this the last attempt". */
    if (!meta.noReport || err.asRetryable === false) {
      _ERR.report(code, err, {
        action: meta.action || '', http: r.status, kind: meta.write ? 'write' : 'read',
        bodyStart: body.slice(0, 200), bodyLen: body.length,
        attempts: meta.attempts || 1
      });
    }
    throw err;
  });
}

/* ⚠⚠ NOT EVERY `{error:…}` IS A DEFECT. Measured 2026-08-06: a rep mistyping their PIN
   produced 8 rows of "That did not save", and the post-a-sale duplicate guard WORKING
   ("already posted — it is saved, no need to re-submit") was filed as a failed write.
   Neither is a bug; both are the system correctly telling someone something.

   🔑 THE DISCRIMINATOR IS THE SERVER'S OWN VERDICT, not a list of message strings. These
   responses carry ok:true / valid:false / duplicate:true — the request was HANDLED, and
   `error` is the human-readable reason. A message allow-list would have to be updated
   every time anyone rewords a sentence, and would silently start logging noise again.

   ⚠ auth_required BEFORE THE REP HAS SIGNED IN is the same thing: the portal fires
   background reads while the login card is on screen (48 rows in a day), and the server
   is right to refuse them. Once a session exists, auth_required means the badge died
   mid-session — that one IS worth knowing about, so it is still reported. */
function _asExpectedRefusal(j, meta) {
  try {
    if (j.ok === true || j.duplicate === true) return true;
    if (String(j.error) === 'auth_required') {
      var haveSession = !!(typeof SESSION !== 'undefined' && SESSION && SESSION.token);
      return !haveSession;                 // not signed in yet ⇒ expected, not a fault
    }
    return false;
  } catch (_) { return false; }
}

/* 🔑 ROUTINE EXPIRY (AUTH-04) vs A LIVE BADGE BEING REFUSED (AUTH-01).
   `auth_required` used to always mean AUTH-01, which made one code cover the session
   lifecycle AND a genuine fault. Measured 2026-08-13 with dumpAuthSignouts: of 74 AUTH-01
   rows, 68 carried `badgeAge:'none'` — no badge on the client at all — and the rest were
   badges that had already expired. Zero were a live badge refused. So the code that was
   supposed to mean "something is wrong with auth" was, in practice, 100% normal behaviour,
   and it was ~10% of the error log people scan to find real problems.

   THE TEST IS SIMPLY WHETHER THE BADGE STILL HAD TIME LEFT AT THE MOMENT OF REFUSAL.
     · no tokenExpires, unparseable, or already past  ⇒ AUTH-04. Routine. Expected.
     · time remaining                                 ⇒ AUTH-01. The server refused a session
       the client had every reason to believe in. **This should never happen.**
   ⚠⚠ FAILS TOWARD 'ROUTINE' ON PURPOSE, AND THAT IS THE CONSERVATIVE DIRECTION HERE. If we
   cannot tell, calling it routine keeps AUTH-01 meaning "definitely anomalous" — a code that
   is sometimes noise is a code people stop reading, which is the exact failure we are undoing.
   The cost of a miscall is one under-reported oddity; the cost of the opposite is losing the
   signal again.
   ⚠ Date.parse, NOT Number — `tokenExpires` is an ISO STRING, and Number() on it is NaN. That
   mistake silently wrote "NaNmin-left" into every error row for months (see app.errors.js
   badgeAge). Making the same mistake here would send every refusal to AUTH-04 forever, and it
   would look like it was working. */
function _authCodeForRefusal() {
  try {
    var exp = (typeof SESSION !== 'undefined' && SESSION) ? SESSION.tokenExpires : null;
    if (!exp) return 'AUTH-04';                       // no badge at all — cannot be a live refusal
    var left = Date.parse(exp) - Date.now();
    return (isNaN(left) || left <= 0) ? 'AUTH-04' : 'AUTH-01';
  } catch (_) { return 'AUTH-04'; }
}

/* ⚠⚠ A POST IS NOT AUTOMATICALLY A SAVE, AND TREATING IT AS ONE BROKE THE PORTAL'S MOST
   SEVERE ERROR CODE. `apiPost` sets `write: true` on EVERY body, so the whole sign-in path —
   checkEmail, validatePin, logout — was classified WRITE-02 the moment a request failed.
   WRITE-02 means "we cannot tell whether the server acted, so a save may be LOST or
   DUPLICATED", and its copy tells the rep to *"Refresh and check before saving again, so you
   do not create a duplicate."*
   🔴 MEASURED 2026-08-17 FROM THE LIVE LOG: **all 202 WRITE-02 rows were auth actions** —
   checkEmail 110, validatePin 85, logout 7 — and **not one was a data save.** Every
   WRITE-01 validatePin row is the same mistake on the refusal path. So the one code that
   exists to say "go ask that office whether something is missing or entered twice" was
   reading as 100% false positives, and it had already cost a real investigation on 08-11.
   🔑 THE TEST IS "COULD A REPEAT CREATE OR DUPLICATE SOMETHING THE USER CARES ABOUT?", NOT
   "IS THIS A POST?" A failed roster lookup, a failed PIN check and a failed logout all
   answer no, so the honest classification is NET-01: no answer, try again.
   ⚠⚠ WHAT IS DELIBERATELY *NOT* ON THIS LIST MATTERS AS MUCH AS WHAT IS.
   setPin / changePin / upgradePin / requestPasswordReset / resetPasswordWithToken all CHANGE
   A CREDENTIAL or mail a token. After one of those times out the rep genuinely does not know
   whether it took — and that ambiguity is precisely what WRITE-02 is for. They stay WRITE-02.
   🔑 THE DEFAULT IS FAIL-SAFE: anything absent from this list keeps the cautious
   classification, so an incomplete list costs a false positive, never a missed lost save.
   ⚠⚠ THIS IS CLASSIFICATION ONLY. Retry eligibility lives in `_AS_RETRY_SAFE_WRITES` and is
   NOT touched here. DO NOT MERGE THE TWO LISTS — they answer different questions ("is a
   repeat SAFE?" vs "could a failure have created anything?"), and `addNote`/`createTicket`
   are retry-safe precisely BECAUSE they write and dedupe, which is the opposite property. */
var _AS_NONWRITE_ACTIONS = { checkEmail: 1, validatePin: 1, logout: 1 };

/* True only when a failed attempt could have created or duplicated a real record. Reads are
   always false; a POST is true unless it is one of the auth actions above. */
function _asCreatesRecord(action, write) {
  if (!write) return false;
  return !_AS_NONWRITE_ACTIONS[String(action || '')];
}

/* A JSON `{error:…}` is the server saying no, on purpose. We still want it CODED and
   COUNTED — "9 reps hit forbidden_office this week" is the kind of fact that is invisible
   today — but the value is returned to the caller unchanged. */
function _asReportJsonError(e, meta) {
  try {
    var s = String(e || ''), code;
    if (s === 'auth_required')       code = _authCodeForRefusal();
    else if (s === 'unauthorized')   code = 'AUTH-02';
    else if (s === 'forbidden_office') code = 'AUTH-03';
    else if (/busy|retry/i.test(s))  code = 'NET-03';
    else if (/unknown action/i.test(s)) code = 'DATA-03';   // FE is ahead of the deployed backend
    /* ⚠ `_asCreatesRecord`, not `meta.write` — a refused checkEmail/validatePin/logout saved
       nothing, so WRITE-01 ("it definitely did not save") is as wrong here as WRITE-02 is on
       the transport path. This is what produced the WRITE-01 validatePin rows. */
    else code = _asCreatesRecord(meta.action, meta.write) ? 'WRITE-01' : 'DATA-02';
    _ERR.report(code, { message: s }, { action: meta.action || '', kind: meta.write ? 'write' : 'read' });
  } catch (_) {}
}

/* fetch() itself rejected — we never reached the server at all (offline, DNS, TLS, a
   blocked request). Distinct from _asParse, which had a response to look at. */
function _asNetworkError(e, action, write, meta, timeoutMs) {
  try {
    meta = meta || {};
    /* A timeout we caused looks like any other rejected fetch, so name it in the log — otherwise
       "No answer from the server" cannot be told apart from "we hung up on it", and those have
       opposite fixes (Google being slow vs. our bound being too tight).
       ⚠ The CODE stays NET-01/WRITE-02 deliberately: for a READ "no answer" is literally true,
       and for a WRITE we still cannot tell whether the server acted — which is exactly what
       WRITE-02 means and why an aborted write must never be silently retried. */
    var aborted = !!(e && (e.name === 'AbortError' || e.code === 20));
    var offline = (navigator && navigator.onLine === false);
    /* ⚠ NET-02 (offline) still wins — "you have no connection" is truer and more actionable
       than anything about saving, whatever the action was. */
    var code = offline ? 'NET-02' : (_asCreatesRecord(action, write) ? 'WRITE-02' : 'NET-01');
    var err = new Error(_ERR.label(code) + ' — ' + _ERR.hint(code));
    err.asCode = code; err.asTransport = true; err.asRetryable = true;
    /* 🔑 CARRIED ON THE ERROR, not just written into the report's Extra. The retry gate in
       _asAttempt has to know "did WE hang up, or did the server fail?" — those have opposite
       implications for whether trying again can work, and the gate had no way to tell them
       apart. The Extra already recorded it for humans; nothing exposed it to the code. */
    err.asTimedOut = aborted || undefined;
    /* ⚠ Same rule as _asParse: quiet while a retry is still coming. iOS alone produced 42
       "Load failed" rows in a day — Safari aborting in-flight reads when the phone locks
       or the tab backgrounds — and most of those recover on the next attempt. */
    if (!meta.noReport) {
      _ERR.report(code, { message: aborted ? ('timed out after ' + timeoutMs + 'ms') : String(e && e.message || e),
                          stack: e && e.stack },
                    { action: action || '', kind: write ? 'write' : 'read',
                      attempts: meta.attempts || 1,
                      timedOut: aborted || undefined, timeoutMs: aborted ? timeoutMs : undefined });
    }
    return err;
  } catch (_) { return e; }
}

/* One wrapper so all four transports get identical breadcrumbs, timing and classification.
   ⚠ The breadcrumb pair is not decoration — AS_ERR uses in-flight count + time-since-last
   to decide when the network is quiet enough to flush a report, which is what keeps an
   error POST from queueing in front of the main blob. */
/* ⚠⚠ GOOGLE INTERMITTENTLY ANSWERS /exec WITH AN HTML ERROR PAGE INSTEAD OF JSON.
   Measured 2026-08-06 from the real error log: ~50 occurrences across 13 people in one
   day, both entities, every action — the body is the Google Docs error page and the
   status is usually 404. On iOS Safari the old r.json() worded that as "The string did
   not match the expected pattern.", which is the screenshot the reps sent.
   🔑 IT HITS LOGIN. checkEmail ×5 and validatePin ×3 came back as 404-HTML, which is
   what a rep experiences as "I can't sign in". It is transport flakiness, not a refusal
   — the very next attempt usually succeeds.

   ⚠⚠ READS RETRY, WRITES DO NOT. A 404-HTML tells us nothing about whether the server
   ALREADY ACTED, and that distinction is the whole reason WRITE-02 exists. Re-sending a
   write that did land creates a duplicate — worse than the error we are fixing.
   ⚠ checkEmail was the ONE write on the allow-list: it only looks a roster address up.
   ✅ validatePin JOINED IT 2026-08-12 — but only AFTER a server-side clientKey guard was added
   (see writeValidatePin in Code.gs). It calls _recordPinFail, so an unguarded retry could burn
   a PIN attempt and lock a rep out; the guard returns the FIRST verdict and never records a
   second failure. 🔑 The guard came first, as the rule below requires.
   ⚠ Intermediate attempts are NOT reported as errors, only breadcrumbed. An error log
   that fills up with failures the user never saw is one people stop reading; the report
   fires only when we finally give up, and carries the attempt count. */
var _AS_RETRY_BACKOFF = [400, 1200];
/* ⚠⚠ A WRITE EARNS A PLACE HERE ONLY BY BEING SAFE TO REPEAT — never because retrying it would
   be convenient. Two ways to qualify, and nothing else:
     · checkEmail — it only LOOKS AN ADDRESS UP. Nothing is written at all.
     · addNote    — the backend dedupes on `clientKey`, so a repeat returns the FIRST note
                    instead of appending a second (see _idemKey in Code.gs). This is the whole
                    reason the key exists: it converts "we cannot tell if it saved" (WRITE-02,
                    3 rows in one evening from one iOS rep) into a retry that simply works.
   🔴 postSale is NOT here even though it has a natural-key guard: that guard answers with an
   ERROR the rep must read, not a silent success, so an automatic retry would surface a
   confusing "already posted" on a write they never saw fail.
     · validatePin — added 2026-08-12, and ONLY because writeValidatePin now dedupes on
                    `clientKey` (scoped to the email) and returns the FIRST verdict without
                    calling _recordPinFail again. Before that guard existed a retry could burn
                    a PIN attempt and lock a rep out of their own account, which is why this
                    entry was forbidden for so long. Measured cause: its successful p90 was
                    9922ms against a 10000ms abort, so ~10% of sign-ins were being killed by
                    the bound and the rep saw "Connection error. Try again."
   ⚠⚠ IF THE SERVER-SIDE GUARD IS EVER REMOVED, THIS ENTRY MUST GO WITH IT.
   ⚠ Adding an action here WITHOUT a server-side guard reintroduces duplicate sales/notes. The
   guard comes first, always. */
/* 🔑 SALES SUPPORT (2026-08-07). Both earn their place the same way `addNote` did — a
   SERVER-SIDE clientKey guard that already exists and that the client already feeds:
     · createTicket  — Ticketing Code.gs:400. Records key→ticketId INSIDE the booking lock
                       and only AFTER the append succeeds, so a failed write leaves the key
                       unclaimed and the retry genuinely creates the ticket. A repeat comes
                       back `{ok:true, duplicate:true}` with the ORIGINAL id, which the UI
                       already words as "Already saved as ticket N — no duplicate created".
     · addTicketNote — Ticketing Code.gs:742. Same shape, caches the note itself.
   ⚠ The client side was already right and unused: `_NT_CLIENT_KEY` is generated once and
   held until a CONFIRMED save, and the note key is built into the payload literal — so both
   survive a retry without anyone tracking them. The guard has been live since 2026-08-04
   waiting for a retry that never came, because Sales Support was on a raw fetch.
   🔴 THE OTHER NINE TICKET WRITES STAY OFF THIS LIST. archiveTicket/unarchiveTicket/
   setTicketStatus/reassignTicket/saveContactLink LOOK naturally idempotent — they set a
   field to a value — but "looks idempotent" is not the standard this list uses, and
   deleteTicket/addLookup/addOffice are not even that. The guard comes first, always. */
var _AS_RETRY_SAFE_WRITES = { checkEmail: 1, addNote: 1, createTicket: 1, addTicketNote: 1, validatePin: 1 };

function _asMayRetry(meta) {
  if (!meta || !meta.write) return true;                       // reads are idempotent
  return !!_AS_RETRY_SAFE_WRITES[String(meta.action || '')];
}

/* ⚠⚠ A REQUEST THAT HANGS NEVER FAILS, SO NOTHING ABOVE CAN REACT TO IT.
   `fetch` has no native timeout: with no AbortController the promise simply never settles, the
   spinner never stops, and the retry below never fires because nothing was ever rejected.
   Measured 2026-08-06 against the live portal: 60 pre-auth reads, median 3.7s — and a MAX OF
   166 SECONDS. That is ~3 minutes of a rep staring at a spinner, and it is NOT the "No answer
   from the server" error they also report; it is the silent one that looks like a dead page.

   🔑 TWO SEPARATE BOUNDS, AND THEY DO DIFFERENT JOBS:
     · TIMEOUT  caps ONE attempt, so a hang becomes a fast failure the retry can act on.
     · DEADLINE caps ALL attempts, because a per-attempt timeout alone makes things WORSE —
       3 × 10s plus backoff is ~32s before the rep sees anything, which is worse than the
       error they get today. The deadline is what keeps a bad request from eating the session.
   ⚠ The deadline almost never bites in the common case: Google's HTML-404 comes back in ~2s,
   so three attempts plus backoff is ~8s and retry behaviour is unchanged. It only engages when
   attempts are genuinely slow, which is exactly when giving up early is the kind thing to do.

   ⚠⚠ THE MAIN DATA BLOB GETS A LONGER LEASH ON PURPOSE — it is 652KB and legitimately takes
   seconds to build server-side, and Apps Script SERIALISES same-user requests, so under load it
   waits behind other work. Timing it out at the same bound as a small read would abort a
   request that was going to succeed and then retry it, tripling load on the very thing that is
   already the bottleneck.
   ⚠ `api({})` — no action — IS the main blob (app.data.js `loadData`), which is why the test is
   `action === 'read'`. Asserted in transport_retry_harness so a renamed action cannot silently
   put the blob on the short bound.
   ⚠ NO AbortController (very old iOS) degrades to NO timeout, never to a throw. Losing the
   timeout costs us a hang; throwing here would break every read and write in the portal. */
/* ⚠⚠ 15s, RAISED FROM 10s ON MEASURED EVIDENCE (2026-08-12) — do not "tidy" it back.
   4,459 round-trips parsed out of the error log's own breadcrumbs (dumpErrorLatency):
     · 15% of requests that SUCCEEDED took longer than 10s — work this bound was throwing away
     · 59% of all recorded failures landed within ±500ms of 10000ms, i.e. they WERE this bound
       firing, not the server failing
     · validatePin's successful p90 was 9922ms — 78ms under the old bound
     · coverage of successful work: 10s → 85.5%, 15s → 90.6%, 20s → 92.8% (the knee is 15s)
   🔑 THIS DOES NOT MAKE ANYONE WAIT LONGER. _AS_DEADLINE_MS still caps ALL attempts at 20s, so
   the rep's worst case is unchanged — what changes is how that budget is SPENT: one attempt
   that can actually finish, instead of two that were always going to be killed. Given the
   server frequently needs more than 10s, one 15s attempt beats two doomed 10s ones. */
/* ⚠⚠ THE MEASURED TRANSPORT FLOOR, AND THE ONLY EVIDENCE-BASED "TOO SMALL TO TRY" LINE WE HAVE.
   2.1–3.7s is what a request that does NO WORK costs (60 pre-auth reads, 2026-08-06), so a
   budget under this cannot complete a real one — that is hopeless by measurement, not by taste.
   🔑 IT IS DELIBERATELY *NOT* SET TO "WHATEVER ATTEMPT 1 NEEDED". That stronger rule — skip the
   retry whenever the remaining budget is less than the timeout we just blew — sounds airtight
   ("we were told it needs >15s, so 4.6s is pointless") and is NOT: this transport is measurably
   NON-STATIONARY (solo reads of 4.5s, 7s, 15s and 34.8s within minutes), and the recent
   successful p50 is 3481ms. A 4.6s second attempt therefore beats the median comfortably —
   it is often unsuccessful, which is not the same as hopeless. Killing it would trade real
   recoveries for ~5s less waiting on a failure, and 131 measured rescues say that trade is bad.
   ⏰ What decides it is whether SURVIVING retries followed a TIMED-OUT first attempt; the crumb
   below now records that, so dumpRetryOutcomes can answer it. Do not tighten this until it has. */
var _AS_MIN_ATTEMPT_MS = 3700;   // below this an attempt cannot finish — do not burn a retry on it
var _AS_TIMEOUT_MS    = 15000;   // one attempt, ordinary request
var _AS_TIMEOUT_BLOB  = 20000;   // one attempt, main data blob
var _AS_DEADLINE_MS   = 20000;   // all attempts, ordinary request
var _AS_DEADLINE_BLOB = 30000;   // all attempts, main data blob

function _asIsMainBlob(meta) { return !meta.write && String(meta.action || 'read') === 'read'; }
function _asTimeoutMs(meta)  { return _asIsMainBlob(meta) ? _AS_TIMEOUT_BLOB  : _AS_TIMEOUT_MS; }
function _asDeadlineMs(meta) { return _asIsMainBlob(meta) ? _AS_DEADLINE_BLOB : _AS_DEADLINE_MS; }

function _asFetch(url, payload, meta) {
  var m = {};
  for (var k in (meta || {})) if (Object.prototype.hasOwnProperty.call(meta, k)) m[k] = meta[k];
  m.deadlineAt = Date.now() + _asDeadlineMs(m);      // copied, not mutated — callers reuse meta
  return _asAttempt(url, payload, m, 0);
}

function _asAttempt(url, payload, meta, attempt) {
  var act = meta.action || 'read', t0 = Date.now();
  var isLast = !_asMayRetry(meta) || attempt >= _AS_RETRY_BACKOFF.length;
  var m = {};
  for (var k in meta) if (Object.prototype.hasOwnProperty.call(meta, k)) m[k] = meta[k];
  m.noReport = !isLast;                 // stay quiet until we are actually giving up
  if (attempt) m.attempts = attempt + 1;

  /* 🔴 THE DEADLINE ONLY BOUNDED THE RETRY *COUNT*, NOT THE WALL-CLOCK — and its name says
     otherwise, which is how I shipped it believing the worst case was 30s.
     It was checked only AFTER an attempt finished, so each attempt still ran its FULL timeout
     first: blob 20s + 20s = ~40s before the rep saw anything, on a "30s deadline". For a first
     load that is 40 seconds of shimmer, which is indistinguishable from broken and is the
     "loads endlessly" a rep actually reported.
     🔑 Clamping the attempt to whatever budget REMAINS makes the deadline mean what it says.

     🔴 AND THE OLD `Math.max(2000, …)` FLOOR BROKE EXACTLY THAT. A floor RAISES the value it is
     applied to, so with under 2s of budget left it handed the attempt MORE time than the
     deadline had, and a final attempt could overshoot the 20s deadline by up to 2 SECONDS —
     on the one bound whose entire job is to be the ceiling. The comment that used to sit here
     also claimed "if less than that is left, this is the last attempt regardless", and NO SUCH
     CHECK EXISTED; the only gate was `Date.now() >= deadlineAt`. The intent was right and it was
     never implemented, so it is implemented now — in the retry gate below, where it belongs,
     rather than by inflating a timeout. */
  var _left = meta.deadlineAt ? (meta.deadlineAt - Date.now()) : Infinity;
  var tmo = Math.min(_asTimeoutMs(meta), Math.max(0, _left));
  var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  /* ⚠ Cleared the moment the RESPONSE arrives, not when parsing finishes. Aborting mid-`r.text()`
     would reject outside _asNetworkError and arrive unclassified; and Apps Script sends the body
     in one go, so time-to-response is where the 166s actually lives. */
  var timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (_) {} }, tmo) : null;
  var stopTimer = function () { if (timer) { clearTimeout(timer); timer = null; } };

  _ERR.netStart(act);
  return fetch(url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // no CORS preflight
    body: JSON.stringify(payload),
    signal: ctl ? ctl.signal : undefined
  }).then(function (r) {
    stopTimer();
    _ERR.netEnd(act, r.ok, Date.now() - t0);
    return _asParse(r, m);
  }, function (e) {
    stopTimer();
    _ERR.netEnd(act, false, Date.now() - t0);
    throw _asNetworkError(e, act, meta.write, m, tmo);
  }).catch(function (err) {
    /* Only TRANSPORT failures retry. A JSON {error:…} is the server deliberately saying
       no — asking again just asks again. asRetryable is already false for AUTH-01, the
       HTML login interstitial, where a retry cannot help either. */
    if (isLast || !err || !err.asTransport || err.asRetryable === false) throw err;
    /* ⚠⚠ AND NOT PAST THE DEADLINE. Without this a slow request costs 3 × the timeout plus
       backoff before the rep sees anything — the retry would be making the wait worse, which is
       the opposite of the point. Re-report so the log records the real, final attempt count. */
    if (meta.deadlineAt && Date.now() >= meta.deadlineAt) {
      if (m.noReport) _ERR.report(err.asCode || 'NET-01', err, {
        action: act, kind: meta.write ? 'write' : 'read',
        attempts: attempt + 1, gaveUp: 'deadline'
      });
      throw err;
    }
    /* ⚠⚠ AND NOT INTO A BUDGET THAT CANNOT FINISH. The deadline gate above only asks "is there
       any time left", so a retry could start with 400ms and be aborted on arrival — burning an
       attempt, adding latency, and logging a failure that was arithmetically certain. The
       backoff comes out of the SAME budget, which is why it is subtracted here: measured on
       readNotes 2026-08-17, attempt 1 burned 15016ms of a 20000ms deadline and attempt 2 was
       handed 4584ms.
       ⚠⚠ CORRECTION — NOBODY WAITED THOSE 20 SECONDS. This comment first said "then the rep
       waited the full 20s", and that was wrong. Every one of those readNotes rows came from
       `_bgRefreshNotes`, a 25s BACKGROUND POLL whose `.catch` swallows the failure with no UI
       at all; the notes already on screen stayed there. `api()` reports to the error log BEFORE
       that .catch runs, which is why an invisible failure still looks like an incident.
       🔑 SAME TRAP AS readPostedSales (600 of 811 breadcrumb rows) — A FAILURE NOBODY IS
       WAITING FOR IS LOG NOISE WEARING THE COSTUME OF AN INCIDENT. Ask who was waiting BEFORE
       reading a duration as a user-visible wait. The budget arithmetic below is still right;
       only the harm it was thought to cause was overstated.
       🔑 `gaveUp:'no-budget'` IS A DISTINCT REASON FROM `'deadline'`. Collapsing them would hide
       exactly the population this gate creates, and the next person would re-derive it from
       scratch — 'deadline' means the clock ran out, 'no-budget' means we declined to pretend. */
    var _leftNow = meta.deadlineAt ? (meta.deadlineAt - Date.now()) : Infinity;
    var _nextBudget = _leftNow - (_AS_RETRY_BACKOFF[attempt] || 0);
    if (_nextBudget < _AS_MIN_ATTEMPT_MS) {
      if (m.noReport) _ERR.report(err.asCode || 'NET-01', err, {
        action: act, kind: meta.write ? 'write' : 'read',
        attempts: attempt + 1, gaveUp: 'no-budget',
        leftMs: Math.max(0, Math.round(_nextBudget)), needMs: _AS_MIN_ATTEMPT_MS,
        firstTimedOut: err.asTimedOut || undefined
      });
      throw err;
    }
    /* ⚠ `timedOut` is appended so dumpRetryOutcomes can split SURVIVING retries by whether the
       first attempt was our own abort or a fast server failure. That split is the missing
       measurement — it is what licenses (or kills) the stronger skip rule described on
       _AS_MIN_ATTEMPT_MS. Appended at the END so the existing `<action> after <CODE>` parse in
       every current dump keeps working unchanged. */
    _ERR.crumb('retry', act + ' after ' + (err.asCode || '?') + (err.asTimedOut ? ' timedOut' : ''));
    return new Promise(function (resolve) { setTimeout(resolve, _AS_RETRY_BACKOFF[attempt]); })
      .then(function () { return _asAttempt(url, payload, meta, attempt + 1); });
  });
}

// In-flight GET de-dupe: concurrent identical reads (same query string) share
// one network round-trip instead of each firing its own. Collapses the first-paint
// overlaps (e.g. readActRateLines preload + tab open, readPostedSales bg-refresh +
// modal open). Safe because every api() call is an idempotent read — all writes go
// through apiPost. The entry is cleared the moment the request settles, so periodic
// background refreshes (90s apart) never collide and always get fresh data.
var _API_INFLIGHT = {};
/* ⚠⚠ READS ARE POSTED, NOT GET, AND THAT IS DELIBERATE — DO NOT "TIDY" IT BACK.
   A GET puts the whole payload in the URL, so a LIVE SESSION BADGE ends up in browser
   history, the Referer header of anything the page links to, and every proxy/CDN access log
   on the way. Apps Script exposes no request headers to doGet/doPost, so the POST body is
   the only place a token can go.
   The backend routes `_read:true` straight into doGet, so gating, role checks and the P2
   blob cache are unchanged — this is a transport change only.
   🔴 REQUIRES the backend to understand `_read` (all three redeployed + verified
   2026-08-04 via readoverpost_deploycheck.js). Shipping this against an older backend
   kills EVERY read in the portal.
   ⚠ The in-flight de-dupe still keys on the same serialised params — it just is not a URL
   any more. Keep it: it is what collapses the first-paint overlaps. */
function api(params) {
  params.key = API_KEY;
  params.officeId = CFG.officeId;
  if (SESSION && SESSION.token) params.token = SESSION.token;   // Phase 1 Stage B: carry the badge
  /* ⚠⚠ THE DE-DUPE KEY MUST BE UNAMBIGUOUS, NOT JUST STABLE.
     Two requirements, and an early version of this satisfied only the first:
       · STABLE — sorted, so the same read requested with the params in a different order
         shares one round trip. The OLD key used insertion order and quietly failed this.
       · UNAMBIGUOUS — a naive k+'='+v join is not. With a value containing the delimiter,
         {a:'1&b=2'} and {a:'1',b:'2'} both serialise to "a=1&b=2", so two DIFFERENT reads
         collide and one caller receives the OTHER's response. "AT&T" in any filter value is
         enough to trigger it. The old code was safe only because it URL-encoded; dropping
         the URL dropped the encoding with it.
     JSON.stringify over sorted pairs escapes the separators, so no value can forge a key. */
  var key = JSON.stringify(Object.keys(params).sort().map(function(k) { return [k, params[k]]; }));
  if (_API_INFLIGHT[key]) return _API_INFLIGHT[key];
  var body = {};
  Object.keys(params).forEach(function(k) { body[k] = params[k]; });
  body._read = true;
  var p = _asFetch(APPS_SCRIPT_URL, body, { action: params.action || 'read' });
  _API_INFLIGHT[key] = p;
  var clear = function() { delete _API_INFLIGHT[key]; };
  p.then(clear, clear);
  return p;
}

/* 🔑 IDEMPOTENCY KEY for a write that appends. The backend records key→result on the first
   successful write and returns that same result for any repeat, which is what makes the write
   safe to auto-retry (see _AS_RETRY_SAFE_WRITES).
   ⚠⚠ GENERATED AT THE CALL SITE, ONCE, AND THAT IS THE WHOLE TRICK — `_asAttempt` retries with
   the SAME payload object, so every attempt carries the same key without anyone tracking it.
   A key made per-attempt would defeat the entire mechanism while looking correct.
   ⚠ NOT a security token: it only has to be unique per submit, so Date.now()+random is right;
   crypto.randomUUID is not available on the older iOS these reps carry. */
function _clientKey(prefix) {
  return (prefix || 'ck') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function apiPost(body) {
  body.key = API_KEY;
  body.officeId = CFG.officeId;
  if (SESSION && SESSION.token) body.token = SESSION.token;     // Phase 1 Stage B: carry the badge
  return _asFetch(APPS_SCRIPT_URL, body, { action: body.action || 'write', write: true });
}

/* ════════════════════════════════════════════════════════════════════════════
   INSTANT-PAINT CACHE — ENCRYPTION AT REST
   ════════════════════════════════════════════════════════════════════════════
   🔴 WHAT THIS FIXES, AND IT IS A SECURITY FIX FIRST. The main data blob — customer orders,
   names, DSIs — has been written to localStorage IN PLAINTEXT, surviving browser restarts.
   The only thing protecting it was `_clearDataCache()` at logout and at badge expiry. That is
   a real mitigation, but it means the protection is an EVENT FIRING, not a property of the
   data: a rep who simply closes the tab and never returns leaves readable customer records on
   the device indefinitely.

   Now the blob is AES-GCM encrypted before it ever touches disk, so what is at rest is
   useless on its own. This is strictly better than the previous posture even if nothing else
   changes — it is not a concession made to buy speed.

   🔑 KEY DERIVATION — PBKDF2-SHA256 FROM THE USER'S PASSWORD, NEVER TRANSMITTED, NEVER STORED
   ON THE SERVER. The server therefore CANNOT decrypt a device's cache, which a server-issued
   key would have allowed. The password policy is genuinely strong (8+ chars, upper, lower,
   digit, special — see _pwPolicyError), so the derived key is not the weak link a 4-digit PIN
   would have made it.
   ⚠ The salt is random per user, kept beside the ciphertext. Salts are not secrets; it exists
   so the same password on two devices does not produce the same key, and it MUST be stable
   across logins or yesterday's cache can never be read back.

   🔑 KEY LIFETIME IS THE WHOLE SECURITY ARGUMENT, so it is stated plainly:
     · ciphertext + salt → localStorage. Persists. Useless alone.
     · derived key       → sessionStorage, beside the session token that is ALREADY there.
       Dies when the tab closes.
   ⇒ Once the browser is closed, only ciphertext remains on the device. That is what makes it
   safe to KEEP the cache across a badge expiry (the win: a rep signing in next morning paints
   instantly) while a lost or shared device gives up nothing.
   ⚠⚠ THIS ADDS NO NEW EXPOSURE CLASS. Anyone who can read sessionStorage already holds the
   live session token and can simply use the portal as that person. The key is no more
   reachable than the credential it sits next to.
   ⚠ Honest caveat: some browsers persist sessionStorage to disk for crash/session restore, so
   "memory only" is not guaranteed. The token has always had that same property.

   ⚠⚠ NO SUBTLECRYPTO ⇒ NO CACHE AT ALL. It requires a secure context; GitHub Pages is HTTPS,
   but a very old browser could still lack it. In that case we DO NOT fall back to writing
   plaintext — the rep gets today's cold load instead. Degrading to slower is acceptable;
   degrading to less private is not, and a silent plaintext fallback would quietly undo the
   entire point of this block.
   ════════════════════════════════════════════════════════════════════════════ */
var _CACHE_KDF_ITER = 210000;          // PBKDF2-SHA256 rounds
var _CACHE_SALT_KEY = 'as_cache_salt_';   // localStorage, per user — not a secret
var _CACHE_KEY_SS   = 'as_cache_key_';    // sessionStorage, dies with the tab

function _subtle() {
  try {
    return (typeof crypto !== 'undefined' && crypto && crypto.subtle) ? crypto.subtle : null;
  } catch (e) { return null; }
}
function _b64(buf) {
  var b = new Uint8Array(buf), s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function _unb64(s) {
  var raw = atob(String(s || '')), out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
/* Stable per-user salt. Created once and reused, because changing it would orphan every
   previously written cache entry for that person. */
function _cacheSalt(user) {
  var k = _CACHE_SALT_KEY + user;
  try {
    var have = localStorage.getItem(k);
    if (have) return _unb64(have);
    var s = new Uint8Array(16);
    crypto.getRandomValues(s);
    localStorage.setItem(k, _b64(s));
    return s;
  } catch (e) { return null; }
}

/* Derive and stash. Called on the login path with the password the rep just typed.
   ⚠ RUN IT ALONGSIDE THE NETWORK CALL, NOT AFTER IT. PBKDF2 at these iterations costs real
   CPU on the phones these reps carry; overlapped with a multi-second validatePin round-trip
   it costs approximately nothing in wall-clock, but run serially afterwards it would be a
   visible tax on every single sign-in. */
function _cacheKeyDerive(password, user) {
  var sub = _subtle();
  if (!sub || !password || !user) return Promise.resolve(null);
  var salt = _cacheSalt(user);
  if (!salt) return Promise.resolve(null);
  var enc = new TextEncoder();
  return sub.importKey('raw', enc.encode(String(password)), { name: 'PBKDF2' }, false, ['deriveKey'])
    .then(function (base) {
      return sub.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: _CACHE_KDF_ITER, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    })
    .then(function (key) { return sub.exportKey('raw', key).then(function (raw) {
        try { sessionStorage.setItem(_CACHE_KEY_SS + user, _b64(raw)); } catch (e) {}
        return key;
      }); })
    .catch(function () { return null; });     // never let a crypto hiccup block a sign-in
}

/* The key for THIS tab, if the rep signed in during it. Absent after a tab close — which is
   the point — and absent on a session merely restored from sessionStorage without a password
   only if the stash was cleared, so a same-tab reload still paints instantly. */
function _cacheKeyGet(user) {
  var sub = _subtle();
  if (!sub || !user) return Promise.resolve(null);
  var raw;
  try { raw = sessionStorage.getItem(_CACHE_KEY_SS + user); } catch (e) { raw = null; }
  if (!raw) return Promise.resolve(null);
  return sub.importKey('raw', _unb64(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    .catch(function () { return null; });
}
function _cacheKeyDrop(user) {
  try { sessionStorage.removeItem(_CACHE_KEY_SS + user); } catch (e) {}
}
/* ⚠ A FRESH IV FOR EVERY WRITE. Reusing an IV under one AES-GCM key is the classic way to
   destroy the cipher's guarantees outright, and the blob is rewritten on every refresh. */
function _cacheEncrypt(key, obj) {
  var sub = _subtle();
  if (!sub || !key) return Promise.resolve(null);
  var iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  var data = new TextEncoder().encode(JSON.stringify(obj));
  return sub.encrypt({ name: 'AES-GCM', iv: iv }, key, data)
    .then(function (ct) { return { v: 1, iv: _b64(iv), ct: _b64(ct) }; })
    .catch(function () { return null; });
}
function _cacheDecrypt(key, rec) {
  var sub = _subtle();
  if (!sub || !key || !rec || rec.v !== 1 || !rec.iv || !rec.ct) return Promise.resolve(null);
  return sub.decrypt({ name: 'AES-GCM', iv: _unb64(rec.iv) }, key, _unb64(rec.ct))
    .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); })
    /* A failure here is EXPECTED and must be silent: a changed password, a cleared salt or a
       tampered record all land here, and the right answer to every one of them is the same —
       no instant paint, fall through to the network. Never surface it as an error. */
    .catch(function () { return null; });
}

/* ════════════════════════════════════════════════════════════════════════════
   STALE-TAB RELOAD — WHY A REP CAN RUN A WEEK-OLD BUNDLE
   ════════════════════════════════════════════════════════════════════════════
   🔴 MEASURED 2026-08-13 (`dumpBoundsByVersion`): SEVEN distinct `app.core` ?v were active in
   ONE 24-hour window, spanning 08-07 → 08-14. The LARGEST cohort — 11 people — was on a
   two-day-old bundle; three were on the newest. Two people on a three-day-old bundle produced
   43 of the 64 "aborted at 10s" errors, against a bound retired days earlier.

   THE CAUSE IS NOT HTTP CACHING. `index.html` is served `Cache-Control: max-age=600` and there
   is no service worker — a reload always gets the current bundle within ten minutes.
   🔑 THE CAUSE IS THAT NOTHING EVER RELOADS. Before this, the ONLY navigation in the entire
   portal was the Sales Support office switch. `_forceReauth` and `signOut` both just hide #app
   and show #login-screen IN THE SAME DOCUMENT, and signing back in calls showApp() — same
   document again. So a tab opened on Monday still runs Monday's JavaScript on Friday, through
   any number of expiries and re-logins. AUTH-01's own evidence had already shown this and it
   was read as a curiosity: `up=63441s` is ONE page open for 17.6 hours.
   ⚠⚠ THIS CORRUPTS EVERY MEASUREMENT TAKEN FROM THE ERROR LOG. It is why fixed bugs keep being
   reported, and it is why a p90 that had stopped existing sent a whole session chasing it.

   WHY SIGN-IN IS THE RIGHT MOMENT. The 12h SESSION_TTL guarantees every rep re-authenticates at
   least daily, and at that instant nothing is in flight and no form holds unsaved input — unlike
   `_forceReauth`, which fires mid-work when a request is refused and would destroy a half-typed
   Post Sale. Reloading here caps fleet staleness at roughly one working day.

   ⚠⚠ GATED ON DOCUMENT AGE, NOT ON A FLAG — AND THAT IS THE WHOLE DESIGN. The obvious guard is
   a "have I reloaded yet" marker in sessionStorage, and it is WRONG: it survives for the life of
   the tab, so the three-day-old tab this exists to fix would reload once and never again.
   `performance.now()` IS document age by definition and it resets to zero on reload, so this is
   loop-proof by construction rather than by bookkeeping.
   ⚠ No `performance.now()` ⇒ NEVER reload. Failing safe means behaving exactly as before. */
var _STALE_TAB_MS = 2 * 60 * 60 * 1000;   // a tab older than this gets a fresh bundle at sign-in
/* 🔑 HELD SO THE RELOAD CAN WAIT FOR IT. `_cacheKeyDerive` is fired concurrently with
   validatePin and deliberately not awaited (see doLogin). Reloading the instant the response
   lands would throw that derivation away mid-flight — and the reloaded document CANNOT redo it,
   because the password only exists during the sign-in that just ended. That tab would then have
   no key: no instant paint, and `_cacheMainData` silently refusing to write for the rest of its
   life. The wait is only ever paid on the reload path, which is already discarding the page. */
var _KDF_INFLIGHT = null;

function _tabAgeMs() {
  try {
    return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? performance.now() : -1;
  } catch (e) { return -1; }
}
/* Returns TRUE if a reload was started — callers must `return` immediately rather than fall
   through to showApp(), whose work would be discarded a moment later anyway. */
function _reloadIfStaleTab() {
  var age = _tabAgeMs();
  if (age < 0 || age < _STALE_TAB_MS) return false;
  try {
    Promise.resolve(_KDF_INFLIGHT).catch(function () {}).then(function () { location.reload(); });
  } catch (e) { location.reload(); }
  return true;
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
  /* ⚠⚠ THE clientKey IS WHAT MAKES THE RETRY SAFE — without it the server cannot dedupe and a
     retry would burn a PIN attempt (see writeValidatePin). Generated per SUBMIT, not per
     attempt, so the automatic retries of one sign-in share a key while a genuinely new attempt
     gets a fresh one. If this is ever dropped, validatePin must come off _AS_RETRY_SAFE_WRITES
     in the same edit. */
  /* ⚠⚠ FIRED HERE, DELIBERATELY BEFORE THE `.then` — SO IT OVERLAPS THE ROUND-TRIP.
     PBKDF2 at _CACHE_KDF_ITER costs real CPU on the phones these reps carry. validatePin
     takes seconds (measured p50 5690ms), so run concurrently the derivation is effectively
     free; moved into the success handler it would become a visible tax on every sign-in.
     🔑 This is the ONLY moment the password exists in the client, which is why the cache key
     can be derived from it at all — and why it is never transmitted or stored server-side.
     ⚠ Deliberately not awaited and its failure is swallowed: a crypto problem must degrade to
     "no instant paint", never to "cannot sign in". */
  try { _KDF_INFLIGHT = _cacheKeyDerive(pin, String(LOGIN_EMAIL || '').toLowerCase()); } catch (e) {}
  apiPost({ action: 'validatePin', email: LOGIN_EMAIL, pin: pin, clientKey: _clientKey('vp') }).then(function(res) {
    if (res.ok && res.valid) {
      SESSION = { email: LOGIN_EMAIL, homeOffice: CFG.officeId, permissions: res.permissions || CFG.officeId };
      if (res.rank) { SESSION.role = res.rank; SESSION._actualRole = res.rank; }
      SESSION.isMaster = res.rank === 'master-admin';
      if (res.token) { SESSION.token = res.token; SESSION.tokenExpires = res.tokenExpires; }   // Phase 1 Stage B: keep the badge
      _reauthing = false;   // fresh session — re-arm the expiry handler
      /* ⚠⚠ THE SESSION IS STASHED BEFORE THE RELOAD, AND THE ORDER IS LOAD-BEARING. The
         reloaded document restores SESSION from this exact key on boot; reload first and the
         rep lands back on the login screen having just signed in successfully. */
      sessionStorage.setItem('as_session_' + CFG.officeId, JSON.stringify(SESSION));
      if (_reloadIfStaleTab()) return;   // week-old tab → take the current bundle instead
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
  // Same ordering rule as doLogin: stash the session, THEN consider reloading.
  sessionStorage.setItem('as_session_' + CFG.officeId, JSON.stringify(SESSION));
  /* ⚠ This path (set-password / upgrade / reset) never derives a cache key — `_cacheKeyDerive`
     has exactly one call site, in doLogin — so there is nothing in flight to wait for and the
     reloaded tab is no worse off than it already was. */
  if (_reloadIfStaleTab()) return;
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
  /* ⚠⚠ AN EXPLICIT SIGN-OUT CLEARS BOTH, AND THAT IS UNCHANGED. This is the statement "I am
     done on this machine" — possibly a shared one — so the ciphertext goes as well as the key.
     Only a BADGE EXPIRY now keeps the ciphertext (see _forceReauth), because that is the same
     person about to sign straight back in. Deleting the key first means that even if the
     localStorage sweep were to fail (quota, private mode, a browser quirk), what is left
     behind is already unreadable. */
  _cacheKeyDrop(SESSION && SESSION.email ? String(SESSION.email).toLowerCase() : '');
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
  return true;   // every role can see + use the toggle; ALL roles now DEFAULT to dark (see _applyTheme)
}
function _applyTheme() {
  var allowed = _themeAllowed(), pref = '';
  try { pref = localStorage.getItem('as_theme') || ''; } catch (e) {}
  var theme;
  if (!allowed) theme = 'dark';                                 // (reserved) force dark if a role is ever disallowed
  else if (pref === 'light' || pref === 'dark') theme = pref;   // an explicit toggle choice wins
  // ⚠ EVERY role now defaults to DARK. Owners used to default to LIGHT, which meant the
  //   office owner landed in light mode without ever choosing it — and that default is
  //   how the white-on-white Daily Report headers went unnoticed for so long. The toggle
  //   is unchanged and still available to every role; an explicit choice is remembered in
  //   localStorage and wins over this line.
  else theme = 'dark';
  var _ssOffice = (typeof CFG !== 'undefined' && CFG && CFG.officeId === 'salessupport');
  if (_ssOffice) theme = 'dark';   // Sales Support is locked to its deep-space dark theme
  document.documentElement.setAttribute('data-theme', theme);
  var tg = document.getElementById('theme-toggle');
  if (tg) {
    tg.style.display = (allowed && !_ssOffice) ? '' : 'none';
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

/* app.tickets.js is loaded CONDITIONALLY — index.html injects it only for
   ?office=salessupport — so it can land either BEFORE or AFTER showApp() runs, and neither
   order is guaranteed (a dynamically inserted script does not join the defer queue).
   Whoever finds the flag still set performs the init, exactly once.
   ⚠⚠ THE OLD SHAPE WAS `if (_ssApp && typeof initTicketApp === 'function') … else loadData()`.
   With a conditional load that is a live bug: if the bundle hasn't landed, a Sales Support
   session falls into the else and calls loadData(), fetching a main-data blob Sales Support
   does not have. The flag is what makes the race harmless — do not collapse it back. */
var _SS_INIT_PENDING = false;
function _ssTryInitTickets() {
  if (!_SS_INIT_PENDING || typeof initTicketApp !== 'function') return;
  _SS_INIT_PENDING = false;
  initTicketApp();
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  _applyTheme();   // master-admin/activator forced dark; others honor their saved choice
  var _ssApp = (CFG.officeId === 'salessupport');   // ticketing office → its own screens, no main-data blob
  // On phones/tablets, land new sessions on Post Sale (reps log sales in the field).
  // Only runs at session entry — Refresh and office-switch go through loadData (not
  // showApp), so they keep whatever tab the user is on. loadData's role guard still
  // redirects any role that can't access Post Sale to its first allowed tab.
  if (window.innerWidth <= 768) CURRENT_TAB = _ssApp ? 'newticket' : 'postsale';
  if (_ssApp && (!window.SALESSUPPORT_TABS || !window.SALESSUPPORT_TABS.some(function(t){ return t.id === CURRENT_TAB; }))) CURRENT_TAB = 'newticket';   // sign-in lands on New Ticket
  _setSidebarOfficeLogo(CFG.officeId);
  buildOfficeSwitcher();
  buildNav();
  if (_ssApp) { _SS_INIT_PENDING = true; _ssTryInitTickets(); }   // ticketing UI (app.tickets.js)
  else { loadData(); }
  _startInactivityWatcher();
  if (!_ssApp) _startBgRefresh();   // Sales Support has no main-data blob to poll
}


function _setSidebarOfficeLogo(officeId) {
  var el = document.getElementById('sb-office-name');
  var lg = OFFICE_LOGOS[officeId];
  if (lg && lg.full) {
    el.innerHTML = '<img src="'+lg.full+'" alt="'+(OFFICE_NAMES[officeId]||officeId)+'" style="height:'+(lg.sidebarH||34)+'px;max-width:200px;object-fit:contain;object-position:left center">';
  } else {
    el.textContent = OFFICE_NAMES[officeId] || '—';
  }
}

function buildOfficeSwitcher() { updateOfficeDropdown(); }

function updateOfficeDropdown() {
  var wrap = document.getElementById('office-dd-wrap'); if (!wrap) return;
  var permitted = SESSION.role === 'master-admin'
    ? _liveOfficeIds()                                  // 🦴 never offer the skeleton slot
    : (SESSION.permissions || CFG.officeId).split(',').map(function(o){ return o.trim(); }).filter(function(o){ return OFFICE_NAMES[o] && !_isSkeletonOffice(o); });
  // Sales Support is switcher-visible ONLY to its own people (allowlist email OR 'salessupport'
  // in permissions) — never to other master-admins — but for them it shows from ANY office.
  var _ssEmail = String(SESSION.email || '').toLowerCase();
  var _ssPerms = String(SESSION.permissions || '').toLowerCase().split(',').map(function(o){ return o.trim(); });
  var _ssAllowed = ((typeof SALESSUPPORT_AGENTS !== 'undefined' ? SALESSUPPORT_AGENTS : []).indexOf(_ssEmail) !== -1) || (_ssPerms.indexOf('salessupport') !== -1);
  permitted = permitted.filter(function(o){ return o !== 'salessupport'; });
  if (_ssAllowed && OFFICE_NAMES['salessupport']) permitted.push('salessupport');
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
  // Sales Support runs a different app (ticketing, no main-data blob) — switching in or
  // out needs a clean re-init, so do a full reload rather than the in-place office swap.
  if (newOfficeId === 'salessupport' || CFG.officeId === 'salessupport') { window.location.href = window.location.pathname + '?office=' + newOfficeId; return; }
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
  { id: 'firstbill',   label: 'First Bill Calc',       roles: ROLES_REP,  group: 'Sales',       sub: "Estimate a customer's first bill" },
  { id: 'appointments', label: 'Appointments',         roles: ALL_ROLES,  group: 'Scheduling',  sub: 'Book & manage LD appointments' },
  /* ⚠ icon:'clock' is REQUIRED, not decoration. buildNav resolves `t.icon || t.id`, and there is
     no `i-myappts` symbol — so without this the row rendered with NO ICON AT ALL and no error,
     looking exactly like a tab that was never meant to have one. Reuses an existing sprite
     symbol; `appointments` already owns the calendar, and this is the personal, time-based
     subset of it. */
  { id: 'myappts',      label: 'My Appointments',      roles: ['master-admin','activator'], group: 'Scheduling', sub: 'Your booked appointments across every office', icon: 'clock' },
  // Everyone sees the tab; client-reps are scoped SERVER-side to their own installs.
  { id: 'fibercal',     label: 'Fiber Install Calendar', roles: ALL_ROLES, group: 'Scheduling', sub: 'Fiber & new-internet installs by scheduled date', icon: 'globe' },
  { id: 'myorders',    label: 'My Orders',           roles: ['client-rep','leader','jd','manager'], group: 'Orders', sub: 'Your own orders — 120-day window' },
  { id: 'myteam',      label: "My Team's Orders",      roles: ['leader','jd','manager'],              group: 'Orders', sub: "Your team's orders — 120-day window" },
  // Everyone sees the tab; repFilter() scopes it — client-rep to their own lines, leader to
  // their team, everyone else office-wide (the server scopes masterTracker the same way).
  /* ⚠ The tab is named for what it SHOWS, not for the company. "Activation Support" is the
     entity/product name — it stays in the page <title>, the login card and the activator scripts,
     and renaming those would retitle the whole portal. Only this nav label changed (2026-08-12).
     ⚠ `sub` no longer repeats the label; it was "Pending & Activation sheets — Date → …", which
     read as the same words twice once the label said it. */
  { id: 'actsupport',  label: 'Activation/Pending Sheets', roles: ALL_ROLES, group: 'Orders',    sub: 'Date → Rep → Product → Status' },
  // Activator-side counterpart to the reps' Rehash Text — customer-facing messages for the
  // call/appointment types activators work out of the Call Logs tabs.
  { id: 'acttext',     label: 'Activator Text',       roles: ['activator','master-admin'], group: 'Call Logs', sub: 'Customer texts for order issues & appointments', icon: 'smartphone' },
  { id: 'master',      label: 'Master Tracker',       roles: ROLES_CALL, group: 'Call Logs',   sub: '120-day window' },
  { id: 'dayafter',    label: 'Day-After Calls',      roles: ROLES_CALL, group: 'Call Logs',   sub: "Yesterday's deliveries" },
  { id: 'delivered',   label: 'Delivered Not Active', roles: ROLES_CALL, group: 'Call Logs',   sub: 'Open & delivered orders' },
  { id: 'issues',      label: 'Order Issues',        roles: ROLES_CALL, group: 'Call Logs',   sub: 'Porting, BYOD & payment — 29-day window' },
  { id: 'escalations', label: 'Escalations',          roles: ROLES_CALL, group: 'Call Logs',   sub: '1 & 2 star ratings' },
  { id: 'noanswer',    label: 'No Answer',            roles: ROLES_CALL, group: 'Call Logs',   sub: 'No answer ratings' },
  // Its own group, directly under Call Logs — that's where someone is standing when they
  // hit an order issue. Content is served from the _Knowledge sheet, never committed.
  { id: 'knowledge',   label: 'Issue Resolution',     roles: ALL_ROLES,  group: 'Knowledge',   sub: 'Order issue playbooks & scripts', icon: 'training' },
  { id: 'livesales',   label: 'Live Sales Tracker',   roles: ROLES_REP,  group: 'Performance', sub: "This week's leaderboard" },
  { id: 'dailyreport', label: 'Daily Report',         roles: ROLES_CALL, group: 'Performance', sub: 'Office daily summary' },
  { id: 'actrates',    label: 'Activation Rates',     roles: ROLES_REP,  group: 'Performance', sub: 'Rep activation breakdown' },
  { id: 'churn',       label: 'Churn Report',         roles: ROLES_REP,  group: 'Performance', sub: 'ICD disconnect breakdown' },
  { id: 'completed',   label: 'Completed Orders',     roles: ALL_ROLES,  group: 'Performance', sub: 'Fully completed — 120-day window' },
  { id: 'training',    label: 'Training & Tracking',   roles: ROLES_PAYROLL, group: 'Payroll',  sub: 'Every posted order + payout tracking' },
  /* ── ADMIN PORTAL (phase 1) ──
     ⚠⚠ `roles` HIDES A NAV ITEM; IT DOES NOT PROTECT THE DATA. readErrorLog and
     readErrorDetail are gated in _READ_ROLES on the backend against the badge's
     server-verified rank. Never rely on this list alone for anything sensitive. */
  /* ⚠ icon:'monitor' is REQUIRED for the same reason — there is no `i-adminerrors` symbol, so
     this row rendered blank. `monitor` was already in the sprite and referenced by nothing, and
     an admin monitoring console is what this tab is. ⚠ Deliberately NOT an alert glyph: issues
     owns alert-triangle and escalations owns alert-octagon, and a third warning shape in the nav
     would read as a third severity level rather than a place to look. */
  { id: 'adminerrors', label: 'Error Log',             roles: ['master-admin'], group: 'Admin', sub: 'Live client errors across every portal', icon: 'monitor' },
  { id: 'people',       label: 'People',               roles: ALL_ROLES,  group: 'Team',        sub: 'Roster & guests' },
  { id: 'teams',        label: 'Teams',                roles: ALL_ROLES,  group: 'Team',        sub: 'Team rosters & stats' },
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

// Sales Support runs a different set of screens (app.tickets.js) — swap the tab set.
// Every other office is unchanged (returns TABS).
function _activeTabs() {
  if (typeof CFG !== 'undefined' && CFG && CFG.officeId === 'salessupport' && window.SALESSUPPORT_TABS) return window.SALESSUPPORT_TABS;
  return TABS;
}

function buildNav() {
  var role = SESSION.role || 'client-rep';
  var nav = document.getElementById('sidebar-nav');
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Primary');
  nav.innerHTML = '';
  var lastGroup = null;
  var _ss = (typeof CFG !== 'undefined' && CFG && CFG.officeId === 'salessupport');
  _activeTabs().forEach(function(t) {
    if (!_ss && !t.roles.includes(role)) return;   // Sales Support is roster-gated → show all its tabs
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
    el.innerHTML = '<span class="nav-icon"><svg><use href="#i-' + (t.icon || t.id) + '"></use></svg></span><span>' + t.label + '</span>';
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
  var tab = _activeTabs().find(function(t) { return t.id === id; });
  document.getElementById('page-title').textContent = tab ? tab.label : id;
  document.getElementById('page-subtitle').textContent = tab && tab.sub ? tab.sub : '';
  renderTab(id);
  /* Notes live OUTSIDE the blob and their poll is gated on being on a notes tab, so entering
     one has to re-arm the fetch or the notes simply are not there yet. See _notesKickOnTab —
     it owns the staleness + in-flight rules, deliberately, so this stays one line. */
  if (typeof _notesKickOnTab === 'function') _notesKickOnTab();
}

