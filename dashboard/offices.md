# Activation Support Portal — Admin Reference

---

## Office URLs

| Office | Owner | URL |
|--------|-------|-----|
| Midspire | Jamis | `https://ActivationSupport.github.io/dashboard/index.html?office=midspire` |
| Viridian | Stefan | `https://ActivationSupport.github.io/dashboard/index.html?office=viridian` |
| Elevate | Jackie | `https://ActivationSupport.github.io/dashboard/index.html?office=elevate` |
| Vanguard | Ellen Dent | `https://ActivationSupport.github.io/dashboard/index.html?office=vanguard` |
| Bayview Horizons | Tim Ewing | `https://ActivationSupport.github.io/dashboard/index.html?office=bayview` |

> **Bayview Horizons** is being onboarded (navy/gold brand, ET, booking on) to **replace Ignite**. Owner login email + roster pending. **Ignite has been deactivated** — removed from all active config so `?office=ignite` no longer loads and it's gone from the switchers; its sheet data is retained/archived (not deleted). Bayview-on / Ignite-off go live together at the Bayview cutover.

Keep these URLs private — share only with the designated owner/admin for each office.

---

## Roles

Set in the `rank` column of each office's roster tab (`_Roster_elevate`, etc.).

| Role | ID to use in roster | What they can do |
|------|---------------------|-----------------|
| Master Admin | `master-admin` | Full access — all offices, all tabs, add/edit Activation & Rep notes, manage all rosters |
| Owner | `owner` | Full access to their office — all tabs, add Rep notes, manage their roster |
| Admin | `admin` | Same as Owner — all tabs, add Rep notes, manage their roster |
| Activator/QC | `activator` | All tabs (view), add Activation notes, cross-office access via permissions |
| Rep | `rep` | All tabs filtered to their own orders only, add Rep notes |

---

## Office Permissions

Set in the `permissions` column (column 10) of each roster tab.

- Value is a comma-separated list of office IDs the person can view
- Default: just their home office (e.g. `elevate`)
- Cross-office access: `elevate,viridian`
- Master Admin sees all offices automatically — no permissions column setup needed

| Value | What it grants |
|-------|---------------|
| `midspire` | Midspire only |
| `viridian` | Viridian only |
| `elevate` | Elevate only |
| `vanguard` | Vanguard only |
| `bayview` | Bayview Horizons only |
| `elevate,viridian` | Elevate + Viridian (switcher appears in sidebar) |
| `midspire,viridian,elevate,vanguard,bayview` | All offices |

---

## Roster Tab Setup

Each office has its own roster tab named `_Roster_<officeId>` (e.g. `_Roster_elevate`).

**Column layout:**

| Col | Header | Notes |
|-----|--------|-------|
| A | `email` | Login email (lowercase) |
| B | `name` | Display name |
| C | `team` | Team name |
| D | `rank` | Role ID from table above |
| E | `deactivated` | `TRUE` / `FALSE` |
| F | `dateAdded` | ISO date |
| G | `pinHash` | Auto-set when user creates PIN |
| H | `phone` | Optional |
| I | `tableauName` | Must match the `REP` column value in Tableau data exactly |
| J | `permissions` | Comma-separated office IDs (defaults to home office if blank) |

**Rep Tableau Name mapping:**
The `tableauName` field (column I) links a rep's portal login to their orders in Tableau.
If a rep's name in Tableau differs from how they're listed in the roster, set `tableauName`
to exactly match the `REP` column value in `_TableauOrderLog`. Admins can set this from
the People tab in the portal using the Tableau name dropdown.

---

## Apps Script

| Item | Value |
|------|-------|
| Deployment URL | `https://script.google.com/macros/s/AKfycbw9hfE_HDTDueNr-s-wQRNDvqWfQX-EkYkSFVQQeitc3_ccO8FqBabAhKe7YTqVzPQ21Q/exec` |
| API Key (Script Property) | `API_KEY` |
| Sheet ID (Script Property) | `SHEET_ID` |

Both `API_KEY` and `SHEET_ID` are stored in Apps Script → Project Settings → Script Properties.
They are **not** in any URL or frontend file.

---

## Data Pipeline

Run in this order (or `nightlySync()` handles it automatically at 1 AM):

1. `syncAllReports()` — pulls data from Tableau into intermediate tabs
2. `distributeToOffices()` — writes to `_TableauOrderLog`, `_TableauAOR`, `_TableauActivationRates`, `_TableauChurnReport`
3. Portal reads from those `_Tableau*` tabs on every login
