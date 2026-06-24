/* ===========================================================================
 * ACTIVATION SUPPORT — STRESS TEST, LAYER 2 (real cloud, TEST environment)
 * ---------------------------------------------------------------------------
 * Hits the DEPLOYED test backends (test Sheet only — never live). Confirms the
 * things Layer 1 couldn't: Apps Script's real concurrency behavior under load,
 * actual Sheets write contention, and that the deployed booking lock + scoping
 * fixes hold. Run AFTER seedTestData() has populated the test Sheet.
 *
 * Usage (PowerShell):
 *   $env:PORTAL_URL="https://script.google.com/macros/s/AKfy.../exec"
 *   $env:SCHEDULER_URL="https://script.google.com/macros/s/AKfy.../exec"
 *   $env:API_KEY="TESTKEY123"
 *   node stress-test/layer2.js
 * (or pass them inline: PORTAL_URL=... SCHEDULER_URL=... API_KEY=... node ...)
 * =========================================================================== */

const PORTAL = process.env.PORTAL_URL    || '';
const SCHED  = process.env.SCHEDULER_URL || '';
const KEY    = process.env.API_KEY       || '';
const PIN    = '123456';
const OFFICES = ['elevate', 'midspire', 'viridian', 'ignite', 'vanguard'];
const today  = new Date().toISOString().split('T')[0];

if (!PORTAL || !SCHED || !KEY) {
  console.error('Missing config. Set PORTAL_URL, SCHEDULER_URL, API_KEY env vars.');
  process.exit(1);
}

let passes = 0, fails = 0;
const ok = (name, cond, detail) => { (cond ? passes++ : fails++);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`); };
const note = (m) => console.log('  ·  ' + m);
const hr = (t) => console.log('\n' + '='.repeat(74) + `\n${t}\n` + '='.repeat(74));

// ── HTTP helpers (Node fetch follows Apps Script's 302 → googleusercontent) ──
// Apps Script intermittently returns a transient HTML error page or a spurious
// {error:unauthorized} under rapid calls — retry a few times before believing it.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function _once(method, base, action, params, obj) {
  let r;
  if (method === 'GET') {
    const u = new URL(base); u.searchParams.set('key', KEY);
    if (action) u.searchParams.set('action', action);
    for (const k in (params || {})) if (params[k] != null) u.searchParams.set(k, params[k]);
    r = await fetch(u, { redirect: 'follow' });
  } else {
    r = await fetch(base, { method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: KEY, ...obj }) });
  }
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 120), _status: r.status }; }
}
const _transient = (res) => !res || res._raw || res.error === 'unauthorized';
async function gget(base, action, params = {}) {
  let res; for (let i = 0; i < 5; i++) { res = await _once('GET', base, action, params); if (!_transient(res)) return res; await sleep(600 * (i + 1)); }
  return res;
}
async function ppost(base, obj) {
  let res; for (let i = 0; i < 5; i++) { res = await _once('POST', base, null, null, obj); if (!_transient(res)) return res; await sleep(600 * (i + 1)); }
  return res;
}
const officeOf = (email) => email.split('@')[0].split('-').slice(1).join('-');
async function login(email) {
  let res; for (let i = 0; i < 4; i++) { res = await ppost(PORTAL, { action: 'validatePin', officeId: officeOf(email), email, pin: PIN }); if (res && res.token) return res.token; await sleep(700 * (i + 1)); }
  throw new Error('login failed for ' + email + ': ' + JSON.stringify(res));
}
const bundle = (office, token) => gget(PORTAL, '', { officeId: office, token });
const lc = (x) => String(x || '').trim().toLowerCase();

/* ===========================================================================
 * TEST A — ROLE SCOPING on the DEPLOYED server (leak closed?)
 * =========================================================================== */
async function testScoping() {
  hr('TEST A — ROLE SCOPING (deployed server)');
  let used = null;

  for (const office of OFFICES) {
    let mgrTok;
    try { mgrTok = await login('mgr-' + office + '@test.local'); } catch (e) { continue; }
    const mb = await bundle(office, mgrTok);
    const master = mb.masterTracker || [];
    const roster = mb.roster || {};
    const rep1 = roster['rep1-' + office + '@test.local'];
    const tn1 = lc(rep1 && rep1.tableauName);
    const ownByRep1 = master.filter(o => lc(o.rep) === tn1).length;
    if (!tn1 || ownByRep1 === 0) continue;   // no order data here — try next office
    used = office;

    // manager sees the whole office (baseline)
    ok(`[${office}] manager bundle returns office-wide orders`, master.length > ownByRep1,
       `${master.length} orders office-wide, ${ownByRep1} belong to rep1`);

    // client-rep: PAYLOAD must contain ONLY their own orders (leak closed)
    const repTok = await login('rep1-' + office + '@test.local');
    const rm = (await bundle(office, repTok)).masterTracker || [];
    const foreign = rm.filter(o => lc(o.rep) !== tn1);
    ok(`[${office}] client-rep payload is scoped server-side (LEAK CLOSED)`,
       rm.length === ownByRep1 && foreign.length === 0,
       `rep1 receives ${rm.length} rows, all own; ${foreign.length} foreign`);

    // leader: payload == team union, excludes a known off-team owner
    const team = 'TQ-' + office;
    const teamTns = Object.keys(roster).filter(e => roster[e].team === team)
      .map(e => lc(roster[e].tableauName)).filter(Boolean);
    const rep3 = roster['rep3-' + office + '@test.local'];
    const tn3 = lc(rep3 && rep3.tableauName);
    const leadTok = await login('lead-' + office + '@test.local');
    const lm = (await bundle(office, leadTok)).masterTracker || [];
    const outOfTeam = lm.filter(o => teamTns.indexOf(lc(o.rep)) === -1);
    const leaksRep3 = tn3 && tn3 !== '' && teamTns.indexOf(tn3) === -1 && lm.some(o => lc(o.rep) === tn3);
    const expectedTeam = master.filter(o => teamTns.indexOf(lc(o.rep)) !== -1).length;
    ok(`[${office}] leader payload == team rows (expected ${expectedTeam}), excludes off-team rep`,
       lm.length === expectedTeam && expectedTeam > 0 && outOfTeam.length === 0 && !leaksRep3,
       `leader ${lm.length} rows vs expected ${expectedTeam}; team [${teamTns.join(', ')}]`);
    break;
  }
  if (!used) note('No test office had order data in _TableauOrderLog — scoping logic already proven in Layer 1; deploy-level check skipped.');
}

/* ===========================================================================
 * TEST B — 50 CONCURRENT POST-ORDERS (real Apps Script load)
 * =========================================================================== */
async function testPosting() {
  hr('TEST B — 50 CONCURRENT POST-ORDERS (deployed)');

  const reps = [];
  OFFICES.forEach(o => ['mgr','lead','jd','act1','act2','rep1','rep2','rep3','rep4','rep5']
    .forEach(r => reps.push(r + '-' + o + '@test.local')));   // 50 emails

  const authTok = await login('mgr-elevate@test.local');   // any valid badge satisfies the write gate
  const stamp = Date.now();
  const mkBody = (email, i) => ({
    action: 'postSale', token: authTok, officeId: officeOf(email), repEmail: email,
    dateOfSale: today, dsi: 'LOADTEST' + stamp + '-' + i,     // >= 12 chars, unique
    accountType: 'Business', processedVia: 'Sara',
    airQty: 1, wirelessNew: 1, voipQty: 0, dtvQty: 0, notes: 'layer2-loadtest'
  });

  const t0 = Date.now();
  const results = await Promise.all(reps.map((e, i) => ppost(PORTAL, mkBody(e, i))));
  const ms = Date.now() - t0;
  const okCount = results.filter(r => r && r.ok).length;
  const errs = results.filter(r => !r || !r.ok);
  ok(`all ${reps.length} concurrent posts returned ok`, okCount === reps.length,
     `${okCount}/${reps.length} ok in ${ms}ms`);
  if (errs.length) note(`${errs.length} non-ok (possible concurrency ceiling): ` +
     JSON.stringify(errs.slice(0, 3).map(e => (e && (e.error || e._raw || e._status)) || e)));

  // Verify none LOST: read back posted-sales count per office, compare to ok posts
  let landed = 0;
  for (const o of OFFICES) {
    let tok; try { tok = await login('mgr-' + o + '@test.local'); } catch { continue; }
    const sales = (await gget(PORTAL, 'readPostedSales', { officeId: o, token: tok })).sales || [];
    landed += sales.filter(s => String(s.dsi || s.DSI || '').indexOf('LOADTEST' + stamp) === 0).length;
  }
  ok('no posts lost/overwritten (readback == successful posts)', landed === okCount,
     `${landed} rows on the sheet vs ${okCount} ok responses`);
  note('If okCount < 50, that is Apps Script\'s ~30 simultaneous-execution ceiling, ' +
       'not data loss — real reps trickle orders in, so this is the worst case.');
}

/* ===========================================================================
 * TEST C — CONCURRENT BOOKING OF THE SAME SLOT (deployed lock holds?)
 * =========================================================================== */
async function testBookingRace() {
  hr('TEST C — CONCURRENT BOOKING OF ONE SLOT (deployed)');

  const office = 'elevate';
  const activator = 'act1-' + office + '@test.local';
  const probeTok = await login(activator);

  // Find a real open slot inside the booking window.
  const win = (await gget(SCHED, 'getBookingWindow', { token: probeTok, role: 'activator' })).window || {};
  let date = null, slot = null;
  // Start at TOMORROW (skip same-day): client-rep bookers can't book today, so a
  // same-day slot would leave only the activator eligible = fake contention.
  const tomorrow = addDay(today);
  for (let d = (win.min && win.min > tomorrow ? win.min : tomorrow); d && d <= win.max && !slot; d = addDay(d)) {
    const slots = (await gget(SCHED, 'getAvailableSlots',
      { activatorEmail: activator, date: d, token: probeTok })).slots || [];
    if (slots.length) { date = d; slot = slots[0]; }
  }
  if (!slot) { note('No open slot found for ' + activator + ' in window — check seed/schedule.'); fails++; return; }
  note(`Contending for ${activator} @ ${date} ${slot}`);

  // Eight different bookers (own tokens) hit the SAME slot at once.
  const bookers = ['rep1','rep2','rep3','rep4','rep5','mgr','jd','act2'].map(r => r + '-' + office + '@test.local');
  const toks = await Promise.all(bookers.map(login));
  const book = (tok, who, i) => ppost(SCHED, {
    action: 'bookAppointment', token: tok, source: 'rep', bookerEmail: who,
    activatorEmail: activator, date, timeSlot: slot, office,
    customerName: 'LoadTest C' + i, customerDSI: 'LOADTESTBOOK' + i,
    customerPhone: '555-0101', customerEmail: 'lt@test.local',
    services: 'VOIP', deviceCount: 1
  });
  const res = await Promise.all(toks.map((t, i) => book(t, bookers[i], i)));
  const wins = res.filter(r => r && r.ok).length;

  // Ground truth: how many rows actually got written for that slot?
  const appts = (await gget(SCHED, 'getAppointments',
    { officeId: office, token: probeTok })).appointments || [];
  const booked = appts.filter(a => lc(a.activatorEmail) === lc(activator) &&
    a.date === date && a.timeSlot === slot && lc(a.status) !== 'cancelled').length;

  ok('deployed lock holds — exactly ONE booking wins the slot',
     wins === 1 && booked === 1,
     `${bookers.length} reps hit one slot => ${wins} ok replies, ${booked} row(s) written`);
  if (booked > 1) note('DOUBLE-BOOK on the deployed server — the lock fix is NOT deployed yet ' +
     '(redeploy the Scheduler as activationsupport.bookings).');
}
function addDay(d) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 1); return x.toISOString().split('T')[0]; }

/* ========================================================================= */
(async () => {
  console.log('ACTIVATION SUPPORT — STRESS TEST LAYER 2 (TEST cloud only)');
  console.log('Portal:    ' + PORTAL.slice(0, 60) + '…');
  console.log('Scheduler: ' + SCHED.slice(0, 60) + '…');
  for (const [n, fn] of [['A scoping', testScoping], ['B posting', testPosting], ['C booking', testBookingRace]]) {
    try { await fn(); } catch (e) { console.error(`\n${n} ERROR: ${e.message}`); fails++; }
  }
  hr('SUMMARY');
  console.log(`  ${passes} passed, ${fails} failed.`);
})();
