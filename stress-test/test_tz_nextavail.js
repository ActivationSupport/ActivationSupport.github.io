/* ===========================================================================
 * CROSS-ZONE Next-Available test (TEST cloud only).
 * Sets a PT-office activator (act1-elevate) to an EASTERN schedule, then proves
 * getNextAvailableSlots speaks OFFICE tz (PT) and a __next__ booking stores the
 * activator's canonical tz (ET). 7:00 AM PT (=10:00 ET) is uniquely the
 * cross-zone activator's, so __next__ at 07:00 must resolve to them + store 10:00.
 *
 * Run AFTER the user redeploys the updated AppointmentScheduler.gs into the TEST
 * Scheduler:
 *   PORTAL_URL=<test portal> SCHEDULER_URL=<test scheduler> API_KEY=TESTKEY123 \
 *     node stress-test/test_tz_nextavail.js
 * =========================================================================== */
const PORTAL = process.env.PORTAL_URL    || '';
const SCHED  = process.env.SCHEDULER_URL || '';
const KEY    = process.env.API_KEY       || '';
const PIN    = '123456';
const OFFICE = 'elevate';                 // Pacific office
const ACT    = 'act1-elevate@test.local'; // we'll make this one Eastern
if (!PORTAL || !SCHED || !KEY) { console.error('Set PORTAL_URL, SCHEDULER_URL, API_KEY'); process.exit(1); }

let passes = 0, fails = 0;
const ok = (n, c, d) => { (c ? passes++ : fails++); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  —  ' + d : ''}`); };
const hr = (t) => console.log('\n' + '='.repeat(70) + `\n${t}\n` + '='.repeat(70));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function _once(method, base, action, params, obj) {
  let r;
  if (method === 'GET') {
    const u = new URL(base); u.searchParams.set('key', KEY);
    if (action) u.searchParams.set('action', action);
    for (const k in (params || {})) if (params[k] != null) u.searchParams.set(k, params[k]);
    r = await fetch(u, { redirect: 'follow' });
  } else {
    r = await fetch(base, { method:'POST', redirect:'follow', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({ key: KEY, ...obj }) });
  }
  const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0,140) }; }
}
const _bad = (res) => !res || res._raw || res.error === 'unauthorized';
async function gget(base, action, params={}) { let res; for (let i=0;i<5;i++){ res=await _once('GET',base,action,params); if(!_bad(res)) return res; await sleep(600*(i+1)); } return res; }
async function ppost(base, obj) { let res; for (let i=0;i<5;i++){ res=await _once('POST',base,null,null,obj); if(!_bad(res)) return res; await sleep(600*(i+1)); } return res; }
async function login(email) { let res; for (let i=0;i<4;i++){ res=await ppost(PORTAL,{action:'validatePin',officeId:OFFICE,email,pin:PIN}); if(res&&res.token) return res.token; await sleep(700*(i+1)); } throw new Error('login failed '+email+': '+JSON.stringify(res)); }

// Next weekday (Mon-Fri) strictly inside (tomorrow .. +7].
function pickWeekday(win){
  var d = new Date(); d.setDate(d.getDate()+1);
  for (var i=0;i<8;i++){ var s=d.toISOString().split('T')[0]; var dow=d.getDay();
    if (dow>=1 && dow<=5 && (!win.min||s>=win.min) && (!win.max||s<=win.max)) return s; d.setDate(d.getDate()+1); }
  return null;
}

(async () => {
  hr('CROSS-ZONE Next-Available test (TEST cloud)');
  const tok = await login(ACT);
  const win = (await gget(SCHED, 'getBookingWindow', { token: tok, role:'activator' })).window || {};
  const date = pickWeekday(win);
  if (!date) { ok('found a bookable weekday', false); return; }
  const dk = ['sun','mon','tue','wed','thu','fri','sat'][new Date(date+'T12:00:00').getDay()];
  console.log(`  target date ${date} (${dk}), window ${win.min}..${win.max}`);

  // Make act1-elevate EASTERN, 10:00-17:00 on the target weekday, bookable.
  const sched = {}; sched[dk] = { start:'10:00', end:'17:00' };
  const setRes = await ppost(SCHED, { action:'setActivatorSchedule', token: tok,
    email: ACT, timezone:'America/New_York', schedule: sched, bufferMins:0, maxPerDay:0, bookable:'true' });
  ok('set act1-elevate to Eastern schedule', setRes && (setRes.ok || setRes.success), JSON.stringify(setRes));
  await sleep(800);

  // Activator slots are in THEIR tz (ET). getNextAvailableSlots is OFFICE tz (PT).
  const actSlots = (await gget(SCHED, 'getAvailableSlots', { activatorEmail: ACT, date, token: tok })).slots || [];
  const nextSlots = (await gget(SCHED, 'getNextAvailableSlots', { officeId: OFFICE, date, token: tok })).slots || [];
  console.log(`  act1 own-tz (ET) slots: ${actSlots.join(',')}`);
  console.log(`  office next-avail (PT) slots: ${nextSlots.join(',')}`);
  // A PT slot before 10:00 can ONLY come from a cross-zone activator (same-zone PT
  // activators start at 10:00). Its presence proves act-tz -> office-tz conversion.
  const xz = nextSlots.filter(s => s < '10:00').sort();
  ok('office next-avail contains a sub-10:00 PT slot (proves ET->PT conversion)', xz.length > 0, xz.join(','));
  const ptSlot = xz[0];
  if (!ptSlot) { console.log(`\n${passes} pass / ${fails} fail`); return; }
  const etExpected = String((+ptSlot.slice(0,2)) + 3).padStart(2,'0') + ':00';   // ET = PT+3 (June/DST)
  console.log(`  booking __next__ at ${ptSlot} PT -> expect stored ${etExpected} ET`);

  const book = await ppost(SCHED, { action:'bookAppointment', token: tok, source:'rep', bookerEmail: ACT,
    activatorEmail:'__next__', date, timeSlot: ptSlot, office: OFFICE,
    customerName:'TZ Test', customerDSI:'TZCROSSZONE1', customerPhone:'555-0199', customerEmail:'tz@test.local',
    services:'VOIP', deviceCount:1 });
  ok('__next__ booking at the PT slot succeeds', book && book.ok, JSON.stringify(book));
  await sleep(800);

  const appts = (await gget(SCHED, 'getAppointments', { officeId: OFFICE, token: tok })).appointments || [];
  const mine = appts.find(a => a.customerDSI === 'TZCROSSZONE1' && String(a.status).toLowerCase()!=='cancelled');
  ok('booking resolved to the cross-zone activator', mine && mine.activatorEmail.toLowerCase()===ACT, mine && mine.activatorEmail);
  ok('stored slot is the activator-tz canonical (ET '+etExpected+'), NOT the PT slot', mine && mine.timeSlot===etExpected, mine && mine.timeSlot);

  // Slot consumed in both zones.
  const actSlots2 = (await gget(SCHED, 'getAvailableSlots', { activatorEmail: ACT, date, token: tok })).slots || [];
  ok('activator '+etExpected+' ET no longer available', actSlots2.indexOf(etExpected)===-1, actSlots2.join(','));
  const nextSlots2 = (await gget(SCHED, 'getNextAvailableSlots', { officeId: OFFICE, date, token: tok })).slots || [];
  ok('office '+ptSlot+' PT no longer offered', nextSlots2.indexOf(ptSlot)===-1, nextSlots2.join(','));

  // Cleanup: cancel the test booking.
  if (mine) { await ppost(SCHED, { action:'cancelAppointment', token: tok, appointmentId: mine.appointmentId }); console.log('  (cleaned up test booking)'); }

  console.log(`\n${'='.repeat(70)}\n  RESULT: ${passes} pass / ${fails} fail\n${'='.repeat(70)}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
