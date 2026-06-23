# AT&T Activation Scheduler — Setup Instructions

## What You're Getting
- **Booking Page** — Clients, reps, or activators book 1-hour appointments
- **Admin Dashboard** — View, edit, cancel, and filter all appointments (password protected)
- **Activator Setup Page** — Each activator sets their own hours and timezone
- **Email Confirmations** — Auto-sent to customer + activator on every booking
- **Google Sheets backend** — All data stored in your spreadsheet, no database needed

---

## Option A: Stand-Alone Setup (new spreadsheet, no existing system)

Follow Steps 1–8 below.

## Option B: One Central Scheduler for Multiple Offices ⭐ (Recommended)

**Set up the scheduler once. Every office's Daily Report pulls from it automatically.**

### Part 1 — Set up the central scheduler (do this once)

1. Go to [sheets.google.com](https://sheets.google.com) → create a new spreadsheet named **"Activation Scheduler"**
2. Open **Extensions → Apps Script** in that new spreadsheet
3. Follow Steps 3–8 below (paste Code.gs + all 5 HTML files, run `initializeSystem()`, deploy as Web App)
4. Copy the **Spreadsheet ID** from the URL: `docs.google.com/spreadsheets/d/**THIS_PART**/edit`
5. Copy the **Web App URL** (the `...exec` link)

### Part 2 — Connect each office's Call List (repeat per office, ~2 minutes each)

1. Open the office's Google Sheet → **Extensions → Apps Script**
2. Click **+** → Script → name it `SchedulerBridge`
3. Paste the entire contents of `SchedulerBridge.gs` from this folder
4. Fill in the two constants at the top:
   ```
   var SCHEDULER_SPREADSHEET_ID = 'paste-your-spreadsheet-id-here';
   var SCHEDULER_WEB_APP_URL    = 'paste-your-web-app-url-here';
   ```
5. Save — **no redeploy needed** for the Call List. Changes take effect immediately.
6. Next time you run **Refresh Daily Report**, the appointment section will appear automatically with clickable links to the Booking Page and Admin Dashboard.

---

## Step 1: Create a New Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a **New Spreadsheet**
2. Name it something like **"Activation Scheduler"**

---

## Step 2: Open Apps Script

1. In your spreadsheet, click **Extensions → Apps Script**
2. This opens the script editor — you'll see a default `Code.gs` file

---

## Step 3: Paste the Code Files

You need to create **4 files** in the Apps Script editor.

### File 1 — Code.gs (already exists)
- Click on `Code.gs` in the left sidebar
- **Delete everything** in it
- Copy and paste the entire contents of `Code.gs` from this folder

### File 2 — booking.html
- Click the **+** button next to "Files" in the sidebar → choose **HTML**
- Name it exactly: `booking`
- Paste the entire contents of `booking.html` from this folder

### File 3 — admin.html
- Click **+** → **HTML**
- Name it exactly: `admin`
- Paste the entire contents of `admin.html` from this folder

### File 4 — setup.html
- Click **+** → **HTML**
- Name it exactly: `setup`
- Paste the entire contents of `setup.html` from this folder

### File 5 — cancel.html
- Click **+** → **HTML**
- Name it exactly: `cancel`
- Paste the entire contents of `cancel.html` from this folder

### File 6 — reschedule.html
- Click **+** → **HTML**
- Name it exactly: `reschedule`
- Paste the entire contents of `reschedule.html` from this folder

---

## Step 4: Initialize the Spreadsheet Sheets

1. In the Apps Script editor, open `Code.gs`
2. In the toolbar, find the function dropdown (it may say "select function")
3. Select **`initializeSystem`** from the dropdown
4. Click the **▶ Run** button
5. You'll be asked to authorize — click **Review Permissions → Allow**
6. This creates the `Appointments` and `Activators` tabs in your spreadsheet

---

## Step 5: Deploy as a Web App

1. In Apps Script, click **Deploy → New Deployment**
2. Click the gear icon ⚙ next to "Select type" → choose **Web App**
3. Fill in:
   - **Description:** Activation Scheduler
   - **Execute as:** Me
   - **Who has access:** Anyone  *(so clients can book without signing in)*
4. Click **Deploy**
5. Copy the **Web App URL** — this is your main link

---

## Step 6: Your Three Links

Once deployed, your Web App URL will look like:
`https://script.google.com/macros/s/XXXXXXX/exec`

| Page | URL |
|------|-----|
| **Booking Page** (share with clients/reps) | `...exec` |
| **Admin Dashboard** | `...exec?page=admin` |
| **Activator Setup** | `...exec?page=setup` |

---

## Step 6b: Save Your Web App URL (Required for cancel/reschedule links)

After deploying, copy your Web App URL and save it as a Script Property so it appears in confirmation emails:

1. In Apps Script, go to **Project Settings** (gear icon on left)
2. Scroll to **Script Properties** → click **Add Script Property**
3. Key: `WEB_APP_URL` | Value: your full Web App URL (the `...exec` link)
4. Click **Save**

---

## Step 6c: Set Up Reminder Emails

1. In the Apps Script editor, open `Code.gs`
2. In the function dropdown, select **`setupReminderTrigger`**
3. Click **▶ Run**
4. This creates an hourly trigger — customers will now receive a **24-hour reminder** and a **1-hour reminder** automatically before every appointment

---

## Step 7: Set Up Your Activators

1. Send each activator the **Setup Page URL** (`...exec?page=setup`)
2. They enter their name, email, timezone, and working hours
3. They click **Save My Profile** — they're immediately bookable

---

## Step 8: Change the Admin Password (Recommended)

The default admin password is `admin123`. To change it:

1. In Apps Script, go to **Project Settings** (gear icon on left)
2. Scroll to **Script Properties**
3. Click **Add Script Property**
4. Key: `ADMIN_PASSWORD` | Value: your new password
5. Click **Save**

---

## How Each Role Uses the System

| Role | What They Do |
|------|-------------|
| **Client** | Opens the booking link, picks phone or in-person, picks activator or next available, fills in their info |
| **Rep** | Same booking link — selects "Rep" in the "Booking as" dropdown |
| **Activator** | Uses the setup page to manage their hours; can also book via the booking page |
| **Owner/Admin** | Uses the admin dashboard to view all appointments, edit details, change status, cancel |

---

## Making Updates After Deployment

Any time you change the code, you must **redeploy**:
1. Apps Script → **Deploy → Manage Deployments**
2. Click the pencil ✏ on your deployment
3. Change version to **"New Version"**
4. Click **Deploy**

---

## Adding a New Activator

Just send them the Setup Page URL. No code changes needed — the system has no user limit.

---

## Cancellation Reasons

Every cancellation — whether done by the customer via their email link, or by you in the Admin Dashboard — **requires a reason**. The reason is:
- Saved in column S of the `Appointments` sheet
- Shown in the **Cancelled** section of the Daily Report tab
- Visible in the admin dashboard's edit modal

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Script function not found" | Make sure all files are named exactly as listed above |
| Blank page on booking | Re-run `initializeSystem` in Apps Script |
| Emails not sending | Make sure you authorized the app with your Google account in Step 4 |
| Can't log into admin | Default password is `admin123` — or check Script Properties |
| Time slots not showing | Activator hasn't saved their profile yet via the setup page |
| Appointments section missing from Daily Report | Run `initializeSystem()` to create the Appointments sheet, then re-run Refresh Daily Report |
| Can't cancel without reason | Both the customer cancel page and admin Cancel button require a reason — this is intentional |
