
// =========================================================================
// BOOKING PORTAL TAB  —  Guide & Links, written on every open
// =========================================================================

function buildBookingPortalTab() {
  var ss  = SpreadsheetApp.getActive();
  var raw = (PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || '')
              .replace(/[?#].*$/, '').replace(/\/?$/, '');

  var bookingUrl = raw ? raw + '/exec'              : '[ Paste your Web App URL in Script Properties → WEB_APP_URL ]';
  var adminUrl   = raw ? raw + '/exec?page=admin'   : '[ Set WEB_APP_URL first ]';
  var setupUrl   = raw ? raw + '/exec?page=setup'   : '[ Set WEB_APP_URL first ]';

  var TAB_NAME = '📅 Booking Portal';
  var sh = ss.getSheetByName(TAB_NAME);
  if (!sh) sh = ss.insertSheet(TAB_NAME);
  sh.clear();
  sh.clearFormats();
  try { sh.getBandings().forEach(function(b){ b.remove(); }); } catch(e) {}
  try { sh.clearConditionalFormatRules(); } catch(e) {}

  // Position right after the How To Use tab
  try {
    ss.setActiveSheet(sh);
    var homeSheet = ss.getSheetByName(HOME_TAB);
    ss.moveActiveSheet(homeSheet ? homeSheet.getIndex() + 1 : 2);
  } catch(e) {}

  sh.setColumnWidth(1, 24);
  sh.setColumnWidth(2, 210);
  sh.setColumnWidth(3, 370);
  sh.setColumnWidth(4, 150);
  sh.setColumnWidth(5, 24);
  sh.setColumnWidths(6, 10, 60);

  var r = 1;

  function banner(text, bg, fg, size) {
    sh.getRange(r, 1, 1, 5).merge()
      .setValue(text)
      .setBackground(bg || '#1F4E78')
      .setFontColor(fg || '#FFFFFF')
      .setFontWeight('bold')
      .setFontSize(size || 14)
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle')
      .setWrap(true);
    sh.setRowHeight(r, (size || 14) > 14 ? 44 : 32);
    r++;
  }

  function sectionHeader(text, bg, fg) {
    sh.getRange(r, 2, 1, 4).merge()
      .setValue(text)
      .setBackground(bg || '#2E75B6')
      .setFontColor(fg || '#FFFFFF')
      .setFontWeight('bold')
      .setFontSize(11)
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('left');
    sh.setRowHeight(r, 28);
    r++;
  }

  function tableHeader(cols) {
    sh.getRange(r, 2, 1, cols.length).setValues([cols])
      .setFontWeight('bold')
      .setBackground('#D6E4F0')
      .setFontColor('#1F4E78')
      .setFontSize(10)
      .setVerticalAlignment('middle');
    sh.setRowHeight(r, 22);
    r++;
  }

  function tableRow(cols, bg) {
    var rng = sh.getRange(r, 2, 1, cols.length);
    rng.setValues([cols]).setFontSize(10).setVerticalAlignment('top').setWrap(true);
    if (bg) rng.setBackground(bg);
    sh.setRowHeight(r, 20);
    r++;
  }

  function urlRow(label, url, desc, bg) {
    sh.getRange(r, 2)
      .setValue(label)
      .setFontWeight('bold').setFontColor('#1F4E78').setFontSize(10).setVerticalAlignment('top');
    sh.getRange(r, 3)
      .setValue(url)
      .setFontColor(url.indexOf('http') === 0 ? '#1155CC' : '#CC0000')
      .setFontSize(10).setVerticalAlignment('top').setWrap(true);
    if (desc) {
      sh.getRange(r, 4)
        .setValue(desc)
        .setFontSize(9).setFontColor('#666666').setVerticalAlignment('top').setWrap(true);
    }
    if (bg) sh.getRange(r, 2, 1, 4).setBackground(bg);
    sh.setRowHeight(r, 40);
    r++;
  }

  function step(num, title, detail) {
    sh.getRange(r, 2)
      .setValue('Step ' + num + '  —  ' + title)
      .setFontWeight('bold').setFontColor('#1F4E78').setFontSize(10).setVerticalAlignment('top');
    sh.getRange(r, 3, 1, 2).merge()
      .setValue(detail)
      .setFontSize(10).setWrap(true).setVerticalAlignment('top');
    sh.setRowHeight(r, 44);
    r++;
  }

  function callout(text, bg, fg) {
    sh.getRange(r, 2, 1, 3).merge()
      .setValue(text)
      .setBackground(bg || '#FFF2CC')
      .setFontColor(fg || '#7F6000')
      .setFontSize(10).setWrap(true).setVerticalAlignment('top').setFontStyle('italic');
    sh.setRowHeight(r, 30);
    r++;
  }

  function body(text, height) {
    sh.getRange(r, 2, 1, 3).merge()
      .setValue(text)
      .setFontSize(10).setWrap(true).setVerticalAlignment('top');
    sh.setRowHeight(r, height || 80);
    r++;
  }

  function spacer(h) { sh.setRowHeight(r, h || 10); r++; }

  // ── Title ──────────────────────────────────────────────────────────────────
  banner('📅  ACTIVATION APPOINTMENT BOOKING PORTAL  —  GUIDE & LINKS', '#1F4E78', '#FFFFFF', 14);
  spacer(6);

  // ── Your Links ─────────────────────────────────────────────────────────────
  sectionHeader('YOUR BOOKING LINKS', '#1F4E78', '#FFFFFF');
  spacer(4);
  urlRow('🔗  Customer Booking Page', bookingUrl,
         'Share with customers or reps to book appointments online', '#EBF3FB');
  spacer(3);
  urlRow('🔧  Admin Dashboard', adminUrl,
         'View, edit, cancel, and report on all appointments', '#FFFFFF');
  spacer(3);
  urlRow('⚙️  Activator Setup', setupUrl,
         'One-time: activators enter their schedule & availability here', '#FFFFFF');
  spacer(10);

  // ── How Customers Book ──────────────────────────────────────────────────────
  sectionHeader('HOW CUSTOMERS BOOK AN APPOINTMENT  (5 Steps)');
  spacer(4);
  step(1, 'Open the Booking Page',
    'Send the Customer Booking Page link above to the customer or rep.\nThey open it in any browser — no login or account required.');
  step(2, 'Choose Appointment Type & Device Count',
    'Options: New Activation, Upgrade, or Other.\nCustomer selects how many devices need activating (counts toward workload).');
  step(3, 'Pick a Date & Time',
    'The calendar shows only available time slots based on each activator\'s saved schedule.\n' +
    'Slots are 1-hour blocks during available hours.  Already-booked slots are hidden automatically.');
  step(4, 'Enter Contact Information',
    'Customer fills in: Full Name, Email, Phone, Address, DSI / SPM.\n' +
    'All fields required — this is what goes on the appointment record and drives the confirmation email.');
  step(5, 'Submit — Confirmation & Reminders Fire Automatically',
    'The system emails a booking confirmation immediately upon submit.\n' +
    'Automated reminder emails go out 24 hours before and 1 hour before the appointment time.\n' +
    'The customer also receives cancel & reschedule links in the confirmation email.');
  spacer(10);

  // ── Customer Self-Service ──────────────────────────────────────────────────
  sectionHeader('CUSTOMER SELF-SERVICE  —  CANCEL & RESCHEDULE');
  spacer(4);
  body(
    'Every confirmation email includes a Cancel link and a Reschedule link.\n\n' +
    '  • Cancel:     Customer opens the cancel link, enters a required reason, confirms.\n' +
    '                Cancellation reason is stored in the Appointments sheet and shown in the Daily Report.\n\n' +
    '  • Reschedule: Customer opens the reschedule link, picks a new date/time, confirms.\n' +
    '                The old appointment is cancelled automatically and the new one is created.\n\n' +
    'No admin action is required for self-service cancellations or reschedules.',
    100
  );
  spacer(10);

  // ── Admin Dashboard ────────────────────────────────────────────────────────
  sectionHeader('MANAGING APPOINTMENTS  —  ADMIN DASHBOARD');
  spacer(4);
  tableHeader(['What You Can Do', 'How', '']);
  tableRow(['View all appointments',
            'Open the Admin Dashboard link  →  Appointments tab  →  filter by date / status', ''], '#FFFFFF');
  tableRow(['Edit an appointment',
            'Click the pencil icon on any row  →  update fields  →  Save', ''], '#F9F9F9');
  tableRow(['Cancel an appointment',
            'Click Cancel on any row  →  enter a required reason  →  Confirm\n' +
            'Reason is stored and appears in the Daily Report', ''], '#FFFFFF');
  tableRow(['View reports & counts',
            'Admin Dashboard  →  Reports tab  →  monthly totals, completion rates', ''], '#F9F9F9');
  tableRow(['Change admin password',
            'Apps Script editor  →  Project Settings  →  Script Properties  →  set ADMIN_PASSWORD', ''], '#FFFFFF');
  spacer(4);
  callout('⚠️  Default admin password is  admin123.  Change it in Script Properties before sharing the admin link.');
  spacer(10);

  // ── Activator Setup ────────────────────────────────────────────────────────
  sectionHeader('ACTIVATOR SETUP  —  ONE TIME PER ACTIVATOR', '#2E75B6', '#FFFFFF');
  spacer(4);
  step(1, 'Open the Activator Setup page',
    'Use the Activator Setup link above.  Each activator completes this once (and updates it when their schedule changes).');
  step(2, 'Create your activator profile',
    'Enter your name and set which days of the week you\'re available.\nExample: Monday – Friday.');
  step(3, 'Set your available hours per day',
    'For each available day, set your start and end time.\nExample: 9:00 AM – 5:00 PM.  Slots are 1-hour blocks within those hours.');
  step(4, 'Block off specific dates or times  (optional)',
    'Use the Blocked Times section to mark vacation days, training days, or any time you\'ll be unavailable.\n' +
    'Blocked slots are hidden from the booking calendar automatically.');
  step(5, 'Save — booking calendar updates immediately',
    'Customers can start booking your available slots as soon as you save.\n' +
    'Return to the Setup page any time to update your schedule or add blocked times.');
  spacer(10);

  // ── Daily Report ───────────────────────────────────────────────────────────
  sectionHeader('DAILY REPORT INTEGRATION');
  spacer(4);
  body(
    "Today's activation appointments are automatically included in your Daily Report.\n\n" +
    "At the bottom of the Daily Report you'll find an  ACTIVATION APPOINTMENTS  section showing:\n" +
    "   •  Upcoming appointments for today — customer name, time slot, appointment type, device count\n" +
    "   •  Completed appointments\n" +
    "   •  Cancelled appointments with the cancellation reason\n\n" +
    "No extra steps needed — it populates automatically when you run Refresh Daily Report.",
    110
  );
  spacer(10);

  // ── Footer ─────────────────────────────────────────────────────────────────
  sh.getRange(r, 1, 1, 5).merge()
    .setValue('This tab refreshes automatically every time you open the spreadsheet.  ' +
              'Booking links stay live as long as the Web App deployment is active.')
    .setFontColor('#AAAAAA').setFontStyle('italic').setFontSize(9)
    .setHorizontalAlignment('center');

  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  sh.setTabColor('#2E75B6');
}
