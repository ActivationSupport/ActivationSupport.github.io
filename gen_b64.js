const fs = require('fs');

// Build the scheduling section with literal \n sequences in GAS strings
// Using array-join to avoid shell escaping entirely
const schedulingLines = [
  '  // Scheduling / Appointments',
  '  sectionHeader("ACTIVATION APPOINTMENTS  —  SCHEDULING SYSTEM");',
  '  spacer(4);',
  '  sh.getRange(r, 2, 1, 3).merge()',
  '    .setValue(',
  '      "Your spreadsheet includes a live online Activation Appointment Scheduler.\\n" +',
  '      "Customers and reps can book appointments at any time — confirmation and reminder emails are sent automatically.\\n\\n" +',
  '      "See the 📅 Booking Portal tab for your booking links and a complete step-by-step guide."',
  '    )',
  '    .setFontSize(10).setWrap(true).setVerticalAlignment("top");',
  '  sh.setRowHeight(r, 64);',
  '  r++;',
  '  spacer(4);',
  '  tableHeader(["Tab", "What Is In It", ""]);',
  '  tableRow(["Appointments",  "Every booking — upcoming, completed, and cancelled",    ""], "#FFFFFF");',
  '  tableRow(["Activators",    "Activator profiles and weekly availability schedules",  ""], "#F9F9F9");',
  '  tableRow(["Blocked Times", "One-off blocked dates/times per activator",             ""], "#FFFFFF");',
  '  tableRow(["Admins",        "Admin users for the appointment dashboard",             ""], "#F9F9F9");',
  '  spacer(8);',
  '',
  '  // Footer',
  '  sh.getRange(r, 1, 1, 5).merge()',
  '    .setValue("This tab refreshes automatically every time you open the spreadsheet.")',
  '    .setFontColor("#AAAAAA").setFontStyle("italic").setFontSize(9)',
  '    .setHorizontalAlignment("center");',
  '',
  '  sh.setFrozenRows(0);',
  '  sh.setFrozenColumns(0);',
  '  sh.setTabColor("#1F4E78");',
  '',
  '  // Build the companion Booking Portal tab',
  '  try { buildBookingPortalTab(); } catch(e) {}',
  '}'
];

const newSection = schedulingLines.join('\n');

// Verify no real newlines inside GAS string literals (only the line breaks between lines are real newlines)
const lines = newSection.split('\n');
let ok = true;
lines.forEach((line, i) => {
  // Each line itself should not contain a real newline char
  if (line.includes('\n')) { console.error('BAD line ' + i + ': ' + JSON.stringify(line)); ok = false; }
});

// Verify the \n sequences appear correctly in the string value lines
const l5 = lines[5]; // "Your spreadsheet...\\n" +
console.log('Line 6 (idx 5):', JSON.stringify(l5));
console.log('Contains literal backslash-n:', l5.includes('\\n'));

const bookingPortal = fs.readFileSync('C:/Users/gavon/Downloads/Jamis Pending/bookingPortalTab.gs', 'utf8');
const fullReplacement = newSection + '\n' + bookingPortal;
const encoded = Buffer.from(fullReplacement, 'utf8').toString('base64');

console.log('All lines OK:', ok);
console.log('Replacement length:', fullReplacement.length);
console.log('Base64 length:', encoded.length);
console.log('BASE64:');
console.log(encoded);
