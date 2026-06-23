/* ===========================================================================
 * ACTIVATION SUPPORT — STRESS TEST, LAYER 1 (local logic harness)
 * ---------------------------------------------------------------------------
 * Runs fully on your machine. NO Google, NO network, NOTHING live touched.
 * It ports the ACTUAL logic from the portal so the results reflect the real
 * design — not an approximation:
 *   • Scoping  : repFilter / _myTeam / _teamTableauNames  (dashboard/index.html)
 *                + readMasterTracker(officeId)            (Code.gs:832 — no role scope)
 *   • Posting  : appendRow post path                      (Code.gs)
 *   • Booking  : bookAppointment check-then-write         (AppointmentScheduler.gs)
 *
 * What Layer 1 CAN prove: logic correctness + the algorithmic race conditions.
 * What it CANNOT prove (needs Layer 2 / real cloud): Apps Script's ~30
 * simultaneous-execution ceiling, real Google Sheets write contention, Gmail
 * send quotas. Those only exist on Google's servers.
 * =========================================================================== */

const LOAD = 50;                       // user asked us to plan for 50 reps
let passes = 0, fails = 0;
const ok   = (name, cond, detail) => { (cond ? passes++ : fails++);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`); };
const hr   = (t) => console.log('\n' + '='.repeat(74) + `\n${t}\n` + '='.repeat(74));

// A tiny async boundary — forces the event loop to interleave concurrent
// "requests", which is exactly what lets a check-then-write race surface.
const tick = () => new Promise(r => setTimeout(r, Math.floor(Math.random() * 5)));

/* ===========================================================================
 * TEST A — ROLE SCOPING ("can a rep only see their own orders?")
 * =========================================================================== */
async function testScoping() {
  hr('TEST A — ROLE SCOPING');

  // --- Test roster: 2 offices, 2 teams in elevate -------------------------
  // roster: email -> { team, tableauName, rank, office }
  const roster = {
    'rep1@x.com':    { team: 'Sharks', tableauName: 'rep one',   rank: 'client-rep', office: 'elevate' },
    'rep2@x.com':    { team: 'Sharks', tableauName: 'rep two',   rank: 'client-rep', office: 'elevate' },
    'rep3@x.com':    { team: 'Aces',   tableauName: 'rep three', rank: 'client-rep', office: 'elevate' },
    'lead1@x.com':   { team: 'Sharks', tableauName: 'lead one',  rank: 'leader',     office: 'elevate' },
    'jd1@x.com':     { team: 'Sharks', tableauName: 'jd one',    rank: 'jd',         office: 'elevate' },
    'mgr1@x.com':    { team: '',       tableauName: 'mgr one',   rank: 'manager',    office: 'elevate' },
    'ig1@x.com':     { team: 'Reds',   tableauName: 'ignite rep',rank: 'client-rep', office: 'ignite'  },
  };
  const teams = {
    t1: { teamId: 't1', name: 'Sharks', leaderId: 'lead1@x.com' },
    t2: { teamId: 't2', name: 'Aces',   leaderId: '' },
  };
  // Orders (rep = tableauName, exactly as the Tableau sync stores them).
  const allOrders = [
    { dsi: 'E-A1', rep: 'rep one',    office: 'elevate' },
    { dsi: 'E-A2', rep: 'rep one',    office: 'elevate' },
    { dsi: 'E-B1', rep: 'rep two',    office: 'elevate' },
    { dsi: 'E-C1', rep: 'rep three',  office: 'elevate' },  // Aces, not Sharks
    { dsi: 'I-Z1', rep: 'ignite rep', office: 'ignite'  },
  ];

  // --- Backend: readMasterTracker(officeId) — FAITHFUL to Code.gs:832 ------
  // Scopes by OFFICE only. No role / email / team filtering server-side.
  const readMasterTracker = (officeId) => allOrders.filter(o => o.office === officeId);

  // --- Frontend scoping — ported verbatim from dashboard/index.html -------
  let SESSION, DATA;
  const _myTeam = () => {
    const role = SESSION.role;
    if (role === 'leader') {
      const myEmail = (SESSION.email || '').toLowerCase();
      let found = null;
      Object.keys(teams).forEach(tid => { if ((teams[tid].leaderId || '').toLowerCase() === myEmail) found = teams[tid]; });
      return found;
    }
    if (role === 'jd') {
      const me = DATA.roster[SESSION.email] || {};
      const teamName = me.team || '';
      if (!teamName) return null;
      let found2 = null;
      Object.keys(teams).forEach(tid => { if (teams[tid].name === teamName) found2 = teams[tid]; });
      return found2;
    }
    return null;
  };
  const _teamTableauNames = (teamName) => {
    if (!teamName) return [];
    const tns = [];
    Object.keys(DATA.roster).forEach(email => {
      const p = DATA.roster[email];
      if ((p.team || '') === teamName && p.tableauName) tns.push((p.tableauName || '').trim().toLowerCase());
    });
    return tns;
  };
  const repFilter = (orders) => {
    const role = SESSION.role;
    if (role === 'client-rep') {
      const tn = (SESSION.tableauName || '').trim();
      if (!tn) return [];
      return orders.filter(o => o.rep === tn);
    }
    if (role === 'leader' || role === 'jd') {
      const team = _myTeam();
      if (team) {
        const tns = _teamTableauNames(team.name);
        if (!tns.length) return [];
        return orders.filter(o => tns.indexOf((o.rep || '').trim().toLowerCase()) !== -1);
      }
      const tn2 = (SESSION.tableauName || '').trim();
      return tn2 ? orders.filter(o => o.rep === tn2) : [];
    }
    return orders;  // master-admin / owner / admin / activator / manager => office-wide
  };

  // Helper: simulate a real user session (login → fetch payload → render-scope).
  const asUser = (email) => {
    const r = roster[email];
    SESSION = { email, role: r.rank, tableauName: r.tableauName, office: r.office };
    DATA    = { roster, teams };
    const payload = readMasterTracker(r.office);   // what the BROWSER receives
    const visible = repFilter(payload);            // what the SCREEN shows
    return { payload, visible };
  };

  // 1) client-rep sees ONLY their own orders (on screen)
  {
    const { visible, payload } = asUser('rep1@x.com');
    ok('client-rep — screen shows only own orders',
       visible.length === 2 && visible.every(o => o.rep === 'rep one'),
       `sees ${visible.map(o => o.dsi).join(',')}`);
    // 2) ...but the PAYLOAD already contains other reps' orders (the leak)
    ok('client-rep — payload is NOT role-scoped (data-layer leak)',
       payload.length === 4 && payload.some(o => o.rep !== 'rep one'),
       `browser received ${payload.length} orders incl. ${payload.filter(o=>o.rep!=='rep one').map(o=>o.dsi).join(',')}`);
  }

  // 3) leader sees their whole team (Sharks: rep one + rep two + lead/jd), NOT Aces
  {
    const { visible } = asUser('lead1@x.com');
    const dsis = visible.map(o => o.dsi).sort().join(',');
    ok('leader — sees team (Sharks) orders, excludes Aces',
       dsis === 'E-A1,E-A2,E-B1' && !visible.some(o => o.rep === 'rep three'),
       `sees ${dsis}`);
  }

  // 4) jd (team Sharks) — same team scope
  {
    const { visible } = asUser('jd1@x.com');
    const dsis = visible.map(o => o.dsi).sort().join(',');
    ok('jd — sees team (Sharks) orders only', dsis === 'E-A1,E-A2,E-B1', `sees ${dsis}`);
  }

  // 5) manager — office-wide (all elevate), but never ignite
  {
    const { visible } = asUser('mgr1@x.com');
    ok('manager — sees all of own office', visible.length === 4 && visible.every(o => o.office === 'elevate'),
       `sees ${visible.length} elevate orders`);
    ok('manager — does NOT receive another office (cross-office isolation)',
       !visible.some(o => o.office === 'ignite'), 'no ignite rows in elevate payload');
  }

  // 6) cross-office: an ignite client-rep only ever fetches ignite
  {
    const { payload, visible } = asUser('ig1@x.com');
    ok('cross-office — ignite user fetches ignite only (structural isolation)',
       payload.every(o => o.office === 'ignite') && visible.length === 1, 'ok');
  }

  // 7) KNOWN EDGE: client-rep match is case-SENSITIVE (o.rep === tn), while
  //    leader/jd lowercases. A casing mismatch makes a rep see nothing.
  {
    SESSION = { email: 'rep1@x.com', role: 'client-rep', tableauName: 'REP ONE' };  // wrong casing
    DATA = { roster, teams };
    const visible = repFilter(readMasterTracker('elevate'));
    ok('client-rep — casing-sensitive match is a latent footgun',
       visible.length === 0,
       'tableauName "REP ONE" vs order rep "rep one" => rep sees 0 orders (real risk if casing drifts)');
  }
}

/* ===========================================================================
 * TEST A2 — SCOPING *AFTER* THE SERVER-SIDE FIX
 * Ports the new Code.gs _scopeOrders (badge-derived) + the case-insensitive
 * client repFilter, and proves the data-layer leak + casing footgun are gone.
 * =========================================================================== */
async function testScopingFixed() {
  hr('TEST A2 — SCOPING AFTER FIX (server-side _scopeOrders)');

  const roster = {
    'rep1@x.com':  { team: 'Sharks', tableauName: 'rep one',  rank: 'client-rep', office: 'elevate' },
    'rep2@x.com':  { team: 'Sharks', tableauName: 'rep two',  rank: 'client-rep', office: 'elevate' },
    'rep3@x.com':  { team: 'Aces',   tableauName: 'rep three',rank: 'client-rep', office: 'elevate' },
    'lead1@x.com': { team: 'Sharks', tableauName: 'lead one', rank: 'leader',     office: 'elevate' },
  };
  const teams = { t1: { teamId: 't1', name: 'Sharks', leaderId: 'lead1@x.com' } };
  const allOrders = [
    { dsi: 'E-A1', rep: 'rep one',   office: 'elevate' },
    { dsi: 'E-A2', rep: 'rep one',   office: 'elevate' },
    { dsi: 'E-B1', rep: 'rep two',   office: 'elevate' },
    { dsi: 'E-C1', rep: 'rep three', office: 'elevate' },
  ];

  // --- Ported verbatim from the new Code.gs server helpers ----------------
  const _serverMyTeam = (rank, email, roster, teams) => {
    if (rank === 'leader') { let f = null; Object.keys(teams).forEach(t => { if (String(teams[t].leaderId||'').toLowerCase() === email) f = teams[t]; }); return f; }
    if (rank === 'jd') { const me = roster[email]||{}; const tn = me.team||''; if (!tn) return null; let f=null; Object.keys(teams).forEach(t=>{ if (teams[t].name===tn) f=teams[t]; }); return f; }
    return null;
  };
  const _serverTeamTableauNames = (teamName, roster) => {
    if (!teamName) return [];
    const tns = [];
    Object.keys(roster).forEach(em => { const p = roster[em]; if ((p.team||'')===teamName && p.tableauName) tns.push(String(p.tableauName||'').trim().toLowerCase()); });
    return tns;
  };
  const _scopeOrders = (orders, gs, roster, teams) => {
    if (!gs || !gs.valid) return orders;
    const rank = String(gs.rank||'').trim(), email = String(gs.email||'').trim().toLowerCase();
    if (rank === 'client-rep') {
      const tn = String((roster[email]||{}).tableauName||'').trim().toLowerCase();
      if (!tn) return [];
      return orders.filter(o => String(o.rep||'').trim().toLowerCase() === tn);
    }
    if (rank === 'leader' || rank === 'jd') {
      const team = _serverMyTeam(rank, email, roster, teams);
      if (team) { const tns = _serverTeamTableauNames(team.name, roster); if (!tns.length) return []; return orders.filter(o => tns.indexOf(String(o.rep||'').trim().toLowerCase()) !== -1); }
      return [];
    }
    return orders;
  };

  // Backend bundle now scopes BEFORE sending (Code.gs:832 fixed).
  const serverBundle = (officeId, gs) => _scopeOrders(allOrders.filter(o => o.office === officeId), gs, roster, teams);

  // 1) client-rep — the PAYLOAD itself now contains only their own orders
  {
    const gs = { valid: true, email: 'rep1@x.com', rank: 'client-rep' };
    const payload = serverBundle('elevate', gs);
    ok('client-rep — server payload now contains ONLY own orders (leak CLOSED)',
       payload.length === 2 && payload.every(o => o.rep === 'rep one'),
       `browser receives ${payload.map(o => o.dsi).join(',')} — nothing else`);
  }
  // 2) leader — payload scoped to the team server-side
  {
    const gs = { valid: true, email: 'lead1@x.com', rank: 'leader' };
    const payload = serverBundle('elevate', gs);
    const dsis = payload.map(o => o.dsi).sort().join(',');
    ok('leader — server payload scoped to team (Sharks), excludes Aces',
       dsis === 'E-A1,E-A2,E-B1', `receives ${dsis}`);
  }
  // 3) casing footgun — badge identity is server-trusted; casing in roster is
  //    lowercased both sides, so a client-rep still gets their orders
  {
    const rosterUpper = JSON.parse(JSON.stringify(roster));
    rosterUpper['rep1@x.com'].tableauName = 'REP ONE';   // drifted casing in roster
    const gs = { valid: true, email: 'rep1@x.com', rank: 'client-rep' };
    const payload = _scopeOrders(allOrders, gs, rosterUpper, teams);
    ok('casing footgun — CLOSED (server lowercases both sides)',
       payload.length === 2, `"REP ONE" still resolves to ${payload.map(o=>o.dsi).join(',')}`);
  }
  // 4) grace period (STRICT_AUTH off / no badge) — unchanged passthrough
  {
    const payload = _scopeOrders(allOrders, null, roster, teams);
    ok('grace period (no badge) — passthrough unchanged (safe cutover preserved)',
       payload.length === 4, 'all orders pass through when no valid badge');
  }
}

/* ===========================================================================
 * TEST B — CONCURRENT POSTING (50 reps posting orders at once)
 * Your code uses appendRow (atomic). We prove it doesn't lose rows, and show
 * what WOULD happen with the common unsafe pattern, for contrast.
 * =========================================================================== */
async function testPosting() {
  hr(`TEST B — ${LOAD} CONCURRENT ORDER POSTS`);

  // --- SAFE model: appendRow (faithful to Code.gs post path) --------------
  // Apps Script appendRow atomically writes to the next free row.
  const safeSheet = [];
  const appendRow = async (row) => { await tick(); safeSheet.push(row); };   // atomic add
  await Promise.all(Array.from({ length: LOAD }, (_, i) =>
    appendRow({ dsi: 'POST-' + i, rep: 'rep' + i })));
  const uniqueSafe = new Set(safeSheet.map(r => r.dsi)).size;
  ok(`appendRow path — all ${LOAD} posts land, none lost/overwritten`,
     safeSheet.length === LOAD && uniqueSafe === LOAD,
     `${safeSheet.length} rows, ${uniqueSafe} unique`);

  // --- UNSAFE model (NOT your code) — read getLastRow()+1 then setValues ---
  // Shown only to demonstrate WHY appendRow is the right call.
  let lastRow = 0;
  const unsafeSheet = [];
  const unsafeWrite = async (row) => {
    const target = lastRow;        // read current length  (race window opens)
    await tick();                  // ...other writers read the SAME target...
    unsafeSheet[target] = row;     // write -> clobbers
    lastRow = target + 1;
  };
  await Promise.all(Array.from({ length: LOAD }, (_, i) =>
    unsafeWrite({ dsi: 'U-' + i })));
  const landedUnsafe = unsafeSheet.filter(Boolean).length;
  ok('unsafe read-then-write — DOES lose rows (this is why appendRow matters)',
     landedUnsafe < LOAD,
     `${landedUnsafe}/${LOAD} survived — ${LOAD - landedUnsafe} clobbered`);

  console.log('\n  NOTE: row-loss is safe in your design. The real posting risk is' +
              '\n  Apps Script\'s ~30 simultaneous-execution ceiling under a burst —' +
              '\n  that is a Layer 2 (real-cloud) check, not visible locally.');
}

/* ===========================================================================
 * TEST C — BOOKING DOUBLE-BOOK RACE (the headline risk)
 * Ports bookAppointment: read getAvailableSlots -> check -> appendRow, with
 * NO lock between check and write (faithful to AppointmentScheduler.gs).
 * =========================================================================== */
async function testBookingRace() {
  hr('TEST C — CONCURRENT BOOKING OF THE SAME SLOT');

  const SLOT = '10:00', ACT = 'activator@x.com', DATE = '2026-07-01';

  // shared appointments "sheet"
  const makeBooker = (useLock) => {
    const appts = [];
    // _getBookedSlots — faithful: scan rows for same activator+date, non-cancelled
    const getBooked = async (act, date) => {
      await tick();   // models the read round-trip
      const booked = {};
      appts.forEach(a => { if (a.activator === act && a.date === date && a.status !== 'cancelled') booked[a.slot] = true; });
      return booked;
    };
    const appendRow = async (a) => { await tick(); appts.push(a); };

    // Optional async mutex == the LockService fix we'd add server-side.
    let chain = Promise.resolve();
    const withLock = (fn) => {
      if (!useLock) return fn();
      const run = chain.then(fn, fn);
      chain = run.catch(() => {});
      return run;
    };

    const bookAppointment = (act, date, slot, who) => withLock(async () => {
      const booked = await getBooked(act, date);       // CHECK
      if (booked[slot]) return { error: 'slot_unavailable', who };
      await appendRow({ activator: act, date, slot, who, status: 'confirmed' });  // WRITE
      return { ok: true, who };
    });

    return { appts, bookAppointment };
  };

  // --- Fire many reps at the SAME slot simultaneously ---------------------
  const CONTENDERS = 8;
  {
    const { appts, bookAppointment } = makeBooker(false);   // current code (no lock)
    const results = await Promise.all(Array.from({ length: CONTENDERS }, (_, i) =>
      bookAppointment(ACT, DATE, SLOT, 'rep' + i)));
    const wins = results.filter(r => r.ok).length;
    const booked = appts.filter(a => a.slot === SLOT && a.status !== 'cancelled').length;
    ok('CURRENT booking code — DOUBLE-BOOKS under contention (expected to FAIL)',
       wins === 1 && booked === 1,
       `${CONTENDERS} reps hit one slot => ${wins} "success" replies, ${booked} rows written`);
  }

  // --- Same test, WITH the lock fix ---------------------------------------
  {
    const { appts, bookAppointment } = makeBooker(true);    // proposed fix
    const results = await Promise.all(Array.from({ length: CONTENDERS }, (_, i) =>
      bookAppointment(ACT, DATE, SLOT, 'rep' + i)));
    const wins = results.filter(r => r.ok).length;
    const booked = appts.filter(a => a.slot === SLOT && a.status !== 'cancelled').length;
    ok('WITH LockService fix — exactly one rep wins the slot',
       wins === 1 && booked === 1,
       `${CONTENDERS} reps hit one slot => ${wins} success, ${booked} row`);
  }
}

/* ========================================================================= */
(async () => {
  console.log('ACTIVATION SUPPORT — STRESS TEST LAYER 1 (local, nothing live touched)');
  await testScoping();
  await testScopingFixed();
  await testPosting();
  await testBookingRace();
  hr('SUMMARY');
  console.log(`  ${passes} checks passed, ${fails} failed.`);
  console.log('  (A "FAIL" on the CURRENT booking code is the bug we are hunting —' +
              '\n   see Test C: the lock fix makes it pass.)');
})();
