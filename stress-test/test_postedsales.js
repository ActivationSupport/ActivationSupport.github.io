/* ===========================================================================
 * POSTED SALES feature test (TEST cloud only). Verifies: scoping, edit,
 * authorization, and soft-void propagation (LST/Training skip voided).
 * Usage:  PORTAL_URL=... API_KEY=TESTKEY123 node stress-test/test_postedsales.js
 * =========================================================================== */
const PORTAL = process.env.PORTAL_URL || '';
const KEY    = process.env.API_KEY    || '';
const PIN    = '123456';
const OFFICE = 'elevate';
const today  = new Date().toISOString().split('T')[0];
if (!PORTAL || !KEY) { console.error('Set PORTAL_URL + API_KEY'); process.exit(1); }

let passes = 0, fails = 0;
const ok = (n, c, d) => { (c ? passes++ : fails++); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  —  ' + d : ''}`); };
const hr = (t) => console.log('\n' + '='.repeat(70) + `\n${t}\n` + '='.repeat(70));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function _once(method, action, params, obj) {
  let r;
  if (method === 'GET') {
    const u = new URL(PORTAL); u.searchParams.set('key', KEY);
    if (action) u.searchParams.set('action', action);
    for (const k in (params || {})) if (params[k] != null) u.searchParams.set(k, params[k]);
    r = await fetch(u, { redirect: 'follow' });
  } else {
    r = await fetch(PORTAL, { method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: KEY, ...obj }) });
  }
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 120) }; }
}
const _transient = (res) => !res || res._raw || res.error === 'unauthorized';
async function gget(action, params = {}) { let res; for (let i = 0; i < 5; i++) { res = await _once('GET', action, params); if (!_transient(res)) return res; await sleep(600 * (i + 1)); } return res; }
async function ppost(obj) { let res; for (let i = 0; i < 5; i++) { res = await _once('POST', null, null, obj); if (!_transient(res)) return res; await sleep(600 * (i + 1)); } return res; }
async function login(email) { let res; for (let i = 0; i < 4; i++) { res = await ppost({ action: 'validatePin', officeId: OFFICE, email, pin: PIN }); if (res && res.token) return res; await sleep(700 * (i + 1)); } throw new Error('login failed ' + email + ': ' + JSON.stringify(res)); }

const R1 = 'rep1-elevate@test.local';
const R2 = 'rep2-elevate@test.local';
const ACT = 'act1-elevate@test.local';   // activator = see-everything
const MGR = 'mgr-elevate@test.local';     // manager = own-only (new rule)

async function postSale(tok, email, extra) {
  return ppost(Object.assign({ action: 'postSale', officeId: OFFICE, token: tok, repEmail: email, repName: email,
    dateOfSale: today, accountType: 'Consumer', processedVia: 'Sara', underSomeoneCodes: 'No', trainee: 'No' }, extra));
}
const mine     = (tok) => gget('readMyPostedSales', { officeId: OFFICE, token: tok });
const allSales = (tok) => gget('readPostedSales',   { officeId: OFFICE, token: tok });
const training = (tok) => gget('readTrainingOrders',{ officeId: OFFICE, token: tok });

(async () => {
  hr('POSTED SALES feature test (TEST cloud)');
  const s1 = await login(R1), s2 = await login(R2), sa = await login(ACT), sm = await login(MGR);
  console.log(`  logged in: rep1=${s1.rank} rep2=${s2.rank} act1=${sa.rank} mgr=${sm.rank}`);

  // Seed: rep1 posts 2 (one a Sunday-DSI trainee order so it also shows in Training), rep2 posts 1.
  const dsi1 = 'PSEDITTEST1-' + Date.now();
  const dsi2 = 'PSEDITTEST2-' + Date.now();
  const dsiR2 = 'PSEDITR2X-' + Date.now();
  await postSale(s1.token, R1, { dsi: dsi1, airQty: 1, wirelessNew: 2, notes: 'orig note A', trainee: 'Yes', traineeName: 'Trainee Bob' });
  await postSale(s1.token, R1, { dsi: dsi2, voipQty: 3 });
  await postSale(s2.token, R2, { dsi: dsiR2, dtvQty: 1, dtvPackage: 'Choice' });
  await sleep(800);

  hr('1) SCOPING');
  const r1mine = await mine(s1.token);
  const r1rows = (r1mine.sales || []);
  ok('rep1 sees only own posted sales', r1rows.length >= 2 && r1rows.every(s => s.repEmail.toLowerCase() === R1), `${r1rows.length} rows`);
  const mgrMine = await mine(sm.token);
  ok('manager (own-only) does NOT see rep1/rep2 orders', !(mgrMine.sales || []).some(s => [R1, R2].includes(s.repEmail.toLowerCase())), `${(mgrMine.sales||[]).length} rows`);
  const actMine = await mine(sa.token);
  const actRows = (actMine.sales || []);
  ok('activator (see-all) sees rep1 AND rep2 orders', actRows.some(s => s.repEmail.toLowerCase() === R1) && actRows.some(s => s.repEmail.toLowerCase() === R2), `${actRows.length} rows`);
  ok('rows carry rowIndex', r1rows.every(s => s.rowIndex > 1));

  const target = r1rows.find(s => s.dsi === dsi1);
  if (!target) { ok('found seeded row dsi1', false); console.log(`\n${passes} pass / ${fails} fail`); return; }

  hr('2) EDIT (self-correction)');
  const newDsi = 'PSEDITED-' + Date.now();
  const ed = await ppost({ action: 'updatePostedSale', officeId: OFFICE, token: s1.token, rowIndex: target.rowIndex,
    dateOfSale: today, dsi: newDsi, accountType: 'Business', processedVia: 'Tower', underSomeoneCodes: 'No',
    trainee: 'Yes', traineeName: 'Trainee Bob', airQty: 0, wirelessNew: 5, wirelessByod: 1, voipQty: 0, dtvQty: 0 });
  ok('rep1 edit own row returns ok', ed && ed.ok, JSON.stringify(ed));
  ok('edit recomputed units (5 new + 1 byod = 6)', ed && ed.units === 6, 'units=' + (ed && ed.units));
  await sleep(600);
  const after = (await mine(s1.token)).sales.find(s => s.rowIndex === target.rowIndex);
  ok('DSI changed on read-back', after && after.dsi === newDsi, after && after.dsi);
  ok('account/products changed on read-back', after && after.accountType === 'Business' && after.wirelessNew === 5 && after.wirelessByod === 1);
  ok('NOTES preserved (not editable)', after && after.notes === 'orig note A', after && JSON.stringify(after.notes));

  hr('3) AUTHORIZATION');
  const cross = await ppost({ action: 'updatePostedSale', officeId: OFFICE, token: s2.token, rowIndex: target.rowIndex,
    dateOfSale: today, dsi: 'HACKHACKHACK1', accountType: 'Consumer', trainee: 'No', airQty: 1 });
  ok('rep2 CANNOT edit rep1 row (forbidden)', cross && cross.error === 'forbidden', JSON.stringify(cross));
  const actEdit = await ppost({ action: 'updatePostedSale', officeId: OFFICE, token: sa.token, rowIndex: target.rowIndex,
    dateOfSale: today, dsi: newDsi, accountType: 'Business', trainee: 'Yes', traineeName: 'Trainee Bob', wirelessNew: 5, wirelessByod: 1 });
  ok('activator (see-all) CAN edit rep1 row', actEdit && actEdit.ok, JSON.stringify(actEdit));

  hr('4) SOFT-VOID propagation');
  const before = await allSales(s1.token);   // unscoped LST read
  const beforeHas = (before.sales || []).some(s => s.rowIndex === target.rowIndex);
  const vd = await ppost({ action: 'voidPostedSale', officeId: OFFICE, token: s1.token, rowIndex: target.rowIndex, voided: true });
  ok('void returns ok', vd && vd.ok);
  await sleep(600);
  const lstAfter = await allSales(s1.token);
  ok('voided row REMOVED from Live Sales Tracker feed', beforeHas && !(lstAfter.sales || []).some(s => s.rowIndex === target.rowIndex));
  const trAfter = await training(sa.token);
  ok('voided row REMOVED from Training & Tracking', !(trAfter.orders || []).some(o => o.rowIndex === target.rowIndex));
  const mineAfter = (await mine(s1.token)).sales.find(s => s.rowIndex === target.rowIndex);
  ok('voided row STILL visible on Posted Sales tab, flagged voided', mineAfter && mineAfter.voided === true);
  // un-void
  const uv = await ppost({ action: 'voidPostedSale', officeId: OFFICE, token: s1.token, rowIndex: target.rowIndex, voided: false });
  await sleep(600);
  ok('un-void restores it to LST feed', uv && uv.ok && (await allSales(s1.token)).sales.some(s => s.rowIndex === target.rowIndex));

  console.log(`\n${'='.repeat(70)}\n  RESULT: ${passes} pass / ${fails} fail\n${'='.repeat(70)}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
