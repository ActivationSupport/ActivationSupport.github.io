/* ===========================================================================
 * seedTestData() — RUN ONCE in the TEST Portal Apps Script project
 * ---------------------------------------------------------------------------
 * Paste this whole file as a NEW .gs file inside the TEST Portal project (the
 * one whose SHEET_ID points at the "TEST — Activation Master" copy), then run
 * seedTestData() from the editor (Run ▶). Approve the permission prompt.
 *
 * It builds 50 test reps (5 offices x 10) with a KNOWN PIN, a team per office,
 * activators, and — so role-scoping has real data to filter — assigns some
 * client-reps the tableauNames of reps that already have orders in the copied
 * _TableauOrderLog. It also clears the write tabs so each load run starts clean.
 *
 * SAFETY: refuses to run unless the spreadsheet name contains "TEST", so it can
 * never touch the live master sheet.
 *
 * After it runs, open View ▶ Logs and paste me the JSON summary it prints.
 * =========================================================================== */
function seedTestData() {
  var ss = getSheet();                                  // resolves via SHEET_ID
  var sheetName = ss.getName();
  if (sheetName.toLowerCase().indexOf('test') === -1) {
    throw new Error('REFUSING TO SEED: spreadsheet name "' + sheetName +
      '" does not contain "TEST". Point this project\'s SHEET_ID at the TEST copy first.');
  }

  var PIN     = '123456';                               // login PIN for every test user
  var OFFICES = ['elevate', 'midspire', 'viridian', 'ignite', 'vanguard'];
  var today   = new Date().toISOString().split('T')[0];
  var summary = { pin: PIN, offices: {} };

  OFFICES.forEach(function (office) {
    // 1) Learn which tableauNames already own orders in this office (scoping data)
    var orderReps = [];
    try {
      var orders = readMasterTracker(ss, office) || [];
      var seen = {};
      orders.forEach(function (o) {
        var r = String(o.rep || '').trim();
        if (r && !seen[r]) { seen[r] = true; orderReps.push(r); }
      });
    } catch (e) { /* office may have no order log — scoping test will skip it */ }

    var team = 'TQ-' + office;
    var reps = [];
    function add(local, rank, teamName, tableau) {
      reps.push({
        email: local + '-' + office + '@test.local',
        name:  local.toUpperCase() + ' ' + office,
        team:  teamName || '', rank: rank, tableauName: tableau || ''
      });
    }
    //   role            on team?   owns orders?
    add('mgr',  'manager',    '',   '');                 // office-wide baseline
    add('lead', 'leader',     team, orderReps[3] || ''); // leads TQ-<office>
    add('jd',   'jd',         team, '');                 // jd on TQ-<office>
    add('act1', 'activator',  '',   '');                 // bookable activator
    add('act2', 'activator',  '',   '');
    add('rep1', 'client-rep', team, orderReps[0] || ''); // team member, owns orders
    add('rep2', 'client-rep', team, orderReps[1] || ''); // team member, owns orders
    add('rep3', 'client-rep', '',   orderReps[2] || ''); // NOT on team, owns orders
    add('rep4', 'client-rep', '',   '');
    add('rep5', 'client-rep', '',   '');

    // 2) Replace this office's roster with the test reps
    var rosterSheet = getOrCreateSheet(ss, officeTab(TAB.ROSTER, office), TAB.ROSTER);
    if (rosterSheet.getLastRow() > 1) {
      rosterSheet.getRange(2, 1, rosterSheet.getLastRow() - 1, 10).clearContent();
    }
    var rosterRows = reps.map(function (r) {
      return [ r.email, r.name, r.team, r.rank, false, today,
               hashPin(r.email, PIN), '555-0100', r.tableauName, office ];
    });
    rosterSheet.getRange(2, 1, rosterRows.length, 10).setValues(rosterRows);

    // 3) One team, led by lead-<office>
    var teamsSheet = getOrCreateSheet(ss, officeTab(TAB.TEAMS, office), TAB.TEAMS);
    if (teamsSheet.getLastRow() > 1) {
      teamsSheet.getRange(2, 1, teamsSheet.getLastRow() - 1, 6).clearContent();
    }
    teamsSheet.getRange(2, 1, 1, 6).setValues([
      ['TM-' + office, team, '', 'lead-' + office + '@test.local', 'star', today]
    ]);

    // 4) DELETE posted-sales so the concurrent-post run re-exercises the
    //    cold-start sheet-creation race — the fix must recreate it safely.
    var ps = ss.getSheetByName('_PostedSales_' + office);
    if (ps) ss.deleteSheet(ps);

    summary.offices[office] = {
      reps: reps.length,
      orderOwningRepsFound: orderReps.length,
      manager:   'mgr-'  + office + '@test.local',
      leader:    'lead-' + office + '@test.local',
      jd:        'jd-'   + office + '@test.local',
      activator: 'act1-' + office + '@test.local',
      scopingClientRep:        'rep1-' + office + '@test.local',
      scopingClientRepTableau: orderReps[0] || '(no orders — scoping skipped here)',
      teamOwnsTableaus:        [orderReps[0] || '', orderReps[1] || ''].filter(Boolean),
      offTeamOwnsTableau:      orderReps[2] || ''
    };
  });

  // 5) Clear the shared Appointments tab so the booking race-test starts empty
  var appt = ss.getSheetByName('Appointments');
  if (appt && appt.getLastRow() > 1) {
    appt.getRange(2, 1, appt.getLastRow() - 1, appt.getLastColumn()).clearContent();
  }

  Logger.log('SEED COMPLETE — every test user logs in with PIN ' + PIN);
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}
