
// =========================================================================
// HOME TAB  — How To Use guide, written as the first sheet on open
// =========================================================================

function buildHomeTab() {
  var ss = SpreadsheetApp.getActive();

  var sh = ss.getSheetByName(HOME_TAB);
  if (!sh) sh = ss.insertSheet(HOME_TAB);
  sh.clear();
  sh.clearFormats();
  try { sh.getBandings().forEach(function(b){ b.remove(); }); } catch(e) {}
  try { sh.clearConditionalFormatRules(); } catch(e) {}

  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);

  sh.setColumnWidth(1, 28);
  sh.setColumnWidth(2, 220);
  sh.setColumnWidth(3, 340);
  sh.setColumnWidth(4, 200);
  sh.setColumnWidth(5, 28);
  sh.setColumnWidths(6, 10, 60);

  var r = 1;

  function banner(text, bg, fg, size) {
    sh.getRange(r, 1, 1, 5).merge()
      .setValue(text)
      .setBackground(bg || "#1F4E78")
      .setFontColor(fg || "#FFFFFF")
      .setFontWeight("bold")
      .setFontSize(size || 14)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle")
      .setWrap(true);
    sh.setRowHeight(r, (size || 14) > 14 ? 44 : 32);
    r++;
  }

  function sectionHeader(text, bg, fg) {
    sh.getRange(r, 2, 1, 4).merge()
      .setValue(text)
      .setBackground(bg || "#2E75B6")
      .setFontColor(fg || "#FFFFFF")
      .setFontWeight("bold")
      .setFontSize(11)
      .setVerticalAlignment("middle")
      .setHorizontalAlignment("left");
    sh.setRowHeight(r, 28);
    r++;
  }

  function tableHeader(cols) {
    sh.getRange(r, 2, 1, cols.length).setValues([cols])
      .setFontWeight("bold")
      .setBackground("#D6E4F0")
      .setFontColor("#1F4E78")
      .setFontSize(10)
      .setVerticalAlignment("middle");
    sh.setRowHeight(r, 22);
    r++;
  }

  function tableRow(cols, bg) {
    var range = sh.getRange(r, 2, 1, cols.length);
    range.setValues([cols]).setFontSize(10).setVerticalAlignment("top").setWrap(true);
    if (bg) range.setBackground(bg);
    sh.setRowHeight(r, 20);
    r++;
  }

  function step(num, title, detail) {
    sh.getRange(r, 2).setValue("Step " + num + "  —  " + title)
      .setFontWeight("bold").setFontColor("#1F4E78").setFontSize(10).setVerticalAlignment("top");
    sh.getRange(r, 3, 1, 2).merge().setValue(detail)
      .setFontSize(10).setWrap(true).setVerticalAlignment("top");
    sh.setRowHeight(r, 42);
    r++;
  }

  function spacer(h) { sh.setRowHeight(r, h || 10); r++; }

  // Title
  banner("DAILY CALL LIST  —  HOW TO USE THIS SHEET", "#1F4E78", "#FFFFFF", 16);
  spacer(6);

  // Daily Workflow
  sectionHeader("DAILY WORKFLOW  (Do These Every Day In Order)", "#1F4E78", "#FFFFFF");
  spacer(4);
  step(1, "Import Order Log CSV",
    "Call List  >  Import Order Log CSV\nFile:  Order Log.csv\nUpdates the Master Tracker with every order and all statuses.");
  step(2, "Import Activation Order Log",
    "Call List  >  Import CSV & Build\nFile:  Activation Oppt Order Log (X).csv\nUpdates Day-After, Delivered, Issues, Escalations, and Daily Report.");
  step(3, "Make your calls  —  add notes and ratings",
    "Click any row on any tab  >  type in the Notes column  >  pick a Rating from the dropdown.\nNotes are preserved automatically on the next import.");
  step(4, "End of day  —  Refresh Daily Report",
    "Call List  >  Refresh Daily Report  (no file needed)\nBuilds the daily summary  —  copy and paste into your email recap.");
  spacer(8);

  // File Reference
  sectionHeader("CSV FILES  —  WHAT TO SELECT FOR EACH IMPORT");
  spacer(4);
  tableHeader(["Menu Item", "File to Select", "How Often"]);
  tableRow(["Import Order Log CSV",          "Order Log.csv",                          "Daily"], "#FFFFFF");
  tableRow(["Import CSV & Build",             "Activation Oppt Order Log (X).csv",      "Daily"], "#F9F9F9");
  tableRow(["Refresh Daily Report",           "(no file needed)",                       "End of each day"], "#FFFFFF");
  tableRow(["Import Rep Churn CSV",           "1 Rep Churn (X).csv",                    "When updated in Tableau"], "#F9F9F9");
  tableRow(["Import Activation Office CSV",   "Activation Office (X).csv",              "When updated in Tableau"], "#FFFFFF");
  spacer(8);

  // Tabs Explained
  sectionHeader("TABS EXPLAINED");
  spacer(4);
  tableHeader(["Tab Name", "What Is In It", ""]);
  tableRow(["Master Tracker",           "Every active order across all statuses, grouped by Customer + DSI", ""], "#FFFFFF");
  tableRow(["Completed Orders",         "Orders where every line is Active, Cancelled, or Disconnected  —  fully done", ""], "#F9F9F9");
  tableRow(["Day-After Orders",         "Yesterday's orders  —  your calls for today", ""], "#FFFFFF");
  tableRow(["Delivered Not Activated",  "Delivered but customer has not activated yet", ""], "#F9F9F9");
  tableRow(["Order Issues",             "Porting issues, payment problems, clusters", ""], "#FFFFFF");
  tableRow(["Escalations",              "Customers rated Poor or Bad  —  auto-added when rated", ""], "#F9F9F9");
  tableRow(["Rep Activation",           "Activation rate scorecard per rep", ""], "#FFFFFF");
  tableRow(["Rep Churn",                "Churn rate scorecard per rep", ""], "#F9F9F9");
  tableRow(["Daily Report",             "End-of-day summary formatted for email", ""], "#FFFFFF");
  tableRow(["Summary",                  "Running stats overview", ""], "#F9F9F9");
  spacer(8);

  // Ratings
  sectionHeader("RATINGS  —  USE THE DROPDOWN IN THE RATING COLUMN");
  spacer(4);
  tableHeader(["Rating", "What It Means", ""]);
  var ratings = [
    ["5 Stars  Excellent", "Great call  —  customer is happy",                   "#C6EFCE", "#1E5631"],
    ["4 Stars  Good",      "Solid call  —  no issues",                           "#E2EFDA", "#385723"],
    ["3 Stars  OK",        "Neutral  —  no major concerns",                      "#FFF2CC", "#7F6000"],
    ["2 Stars  Poor",      "Problem  —  automatically flags to Escalations tab", "#FCE4D6", "#9C0006"],
    ["1 Star   Bad",       "Serious issue  —  automatically flags to Escalations tab", "#F4CCCC", "#660000"],
    ["No Answer",          "Called  —  no response",                             "#EFEFEF", "#555555"]
  ];
  ratings.forEach(function(row) {
    sh.getRange(r, 2).setValue(row[0]).setBackground(row[2]).setFontColor(row[3]).setFontWeight("bold").setFontSize(10).setVerticalAlignment("middle");
    sh.getRange(r, 3, 1, 2).merge().setValue(row[1]).setBackground(row[2]).setFontColor(row[3]).setFontSize(10).setVerticalAlignment("middle");
    sh.setRowHeight(r, 22);
    r++;
  });
  spacer(8);

  // Activation Buckets
  sectionHeader("ACTIVATION BUCKETS  —  ORDER AGE COLOR CODING");
  spacer(4);
  tableHeader(["Bucket", "What It Means", ""]);
  var buckets = [
    ["0-7 Days",   "Order placed in the last week  —  newest",      "#C6EFCE", "#1E5631"],
    ["8-14 Days",  "1 to 2 weeks old",                              "#FFF2CC", "#7F6000"],
    ["15-30 Days", "Getting older  —  needs attention",             "#FCE4D6", "#7F2704"],
    ["31-60 Days", "Oldest  —  high priority follow-up",            "#F8CBAD", "#660000"]
  ];
  buckets.forEach(function(row) {
    sh.getRange(r, 2).setValue(row[0]).setBackground(row[2]).setFontColor(row[3]).setFontWeight("bold").setFontSize(10).setVerticalAlignment("middle");
    sh.getRange(r, 3, 1, 2).merge().setValue(row[1]).setFontSize(10).setVerticalAlignment("middle");
    sh.setRowHeight(r, 22);
    r++;
  });
  spacer(8);

  // Notes System
  sectionHeader("NOTES  —  HOW THEY ARE SAVED");
  spacer(4);
  sh.getRange(r, 2, 1, 3).merge()
    .setValue(
      "Notes are NEVER deleted when you re-import a CSV.\n" +
      "The script matches each customer by Customer Name + DSI and restores your notes automatically.\n\n" +
      "Notes priority order:\n" +
      "   1.  Notes you typed in any tab\n" +
      "   2.  Notes from the source CSV itself\n\n" +
      "Ratings work the same way  —  once set, they stick across imports.\n" +
      "Rating Poor or Bad  =  customer auto-appears in the Escalations tab."
    )
    .setFontSize(10).setWrap(true).setVerticalAlignment("top");
  sh.setRowHeight(r, 120);
  r++;
  spacer(10);

  // Scheduling / Appointments
  sectionHeader("ACTIVATION APPOINTMENTS  —  SCHEDULING SYSTEM");
  spacer(4);
  sh.getRange(r, 2, 1, 3).merge()
    .setValue(
      "Your spreadsheet includes a live online Activation Appointment Scheduler.\n" +
      "Customers and reps can book appointments at any time — confirmation and reminder emails are sent automatically.\n\n" +
      "See the 📅 Booking Portal tab for your booking links and a complete step-by-step guide."
    )
    .setFontSize(10).setWrap(true).setVerticalAlignment("top");
  sh.setRowHeight(r, 64);
  r++;
  spacer(4);
  tableHeader(["Tab", "What Is In It", ""]);
  tableRow(["Appointments",  "Every booking — upcoming, completed, and cancelled",    ""], "#FFFFFF");
  tableRow(["Activators",    "Activator profiles and weekly availability schedules",  ""], "#F9F9F9");
  tableRow(["Blocked Times", "One-off blocked dates/times per activator",             ""], "#FFFFFF");
  tableRow(["Admins",        "Admin users for the appointment dashboard",             ""], "#F9F9F9");
  spacer(8);

  // Footer
  sh.getRange(r, 1, 1, 5).merge()
    .setValue("This tab refreshes automatically every time you open the spreadsheet.")
    .setFontColor("#AAAAAA").setFontStyle("italic").setFontSize(9)
    .setHorizontalAlignment("center");

  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  sh.setTabColor("#1F4E78");

  // Build the companion Booking Portal tab
  try { buildBookingPortalTab(); } catch(e) {}
}
