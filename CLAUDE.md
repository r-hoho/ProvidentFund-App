# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Active Backlog
See `TODO.md` for pending features, test cases, and polish items. Check it at the start of a session and update checkboxes as work is completed.

## What This Is

A Google Apps Script (GAS) web app that serves as an employee self-service portal for a Thai company's Provident Fund (กองทุนสำรองเลี้ยงชีพ). It runs entirely inside a Google Spreadsheet as a bound script and is deployed as a GAS Web App.

There is no local build/run/test toolchain. All code must be deployed to Google Apps Script to test it. Development workflow: edit locally → copy-paste into the GAS editor (or use `clasp push` if configured) → deploy as Web App → test in browser.

## Architecture

### Backend (`Code/` — Google Apps Script server-side `.gs` files)

| File | Responsibility |
|------|----------------|
| `Main.gs` | `doGet()` entry point; `include()` helper for HTML templating |
| `Config.gs` | Global sheet-name constants (`SHEET_USERS`, `SHEET_ENROLLMENTS`, etc.) |
| `Profile.gs` | `getUserProfile()` — the main data-fetching function; calculates eligibility, tenure, employer match tier |
| `Action.gs` | `processEnrollment()`, `processChangePlan()`, `processUpdateBeneficiaries()`, `checkPlanChangeEligibility()` |
| `Withdraw.gs` | `processWithdrawal()` — clears enrollment, increments withdrawal counter |
| `Utils.gs` | `calculateMatchTier(years)`, `reportIssueToAdmin()` |

### Frontend (`html/` — GAS HTML files, included via `<?!= include('filename'); ?>`)

| File | Responsibility |
|------|----------------|
| `Index.html` | Shell page; includes CSS, Modals, JS files via `<?!= include() ?>` |
| `CSS.html` | Custom styles; uses Pico.css v2 (loaded from CDN) |
| `JS.html` | Main dashboard logic: `populateUI()`, enrollment wizard (4-step), change-plan modal |
| `JS_Beneficiary.html` | Beneficiary manager overlay (3-view: current / edit / history) |
| `JS_Withdraw.html` | Withdrawal confirmation flow with 5-year vesting check |
| `Modals.html` | HTML for: enrollment wizard overlay, change-plan `<dialog>`, beneficiary manager overlay |
| `Modals_Withdraw.html` | HTML for withdrawal `<dialog>` |

### Google Sheets data model

| Sheet | Purpose |
|-------|---------|
| `Users` | Employee master data — `Allstars_ID`, `Work_Email`, `Name_English`, `Business_Title`, `Hire_Date`, `Probation_End` |
| `Enrollments` | One row per employee — `Current_Plan`, `Investment_Plan`, `Withdrawal_Count`, `Last_Withdrawal_Date`, `Last_Plan_Change_Date` |
| `Beneficiaries` | Append-only ledger — `Timestamp`, `Allstars_ID`, `Work_Email`, `Beneficiary_Data` (JSON string) |
| `Audit_Log` | Append-only audit trail for all user actions |
| `Monthly_Reporting` | (Referenced in Config.gs; reporting sheet) |

## Key Business Rules

- **Payroll cut-off / effective date**: The payroll cut-off is the **15th of each month**. Any transaction submitted on or before the 15th takes effect at that month's end. Any transaction submitted on the 16th or later is queued and takes effect at the end of the *following* month. Applies only to payroll-deduction actions: **enrollment, contribution plan change, and withdrawal**. Beneficiary updates and investment plan changes are not payroll-related and do not follow this rule. Users must be shown their calculated effective date at the point of each applicable submission.
- **Membership start date**: 1st enrollment → hire date is the membership start; 2nd enrollment (after one withdrawal) → the new `Current_Enrolled_Date` is the start. The backend computes this as `startDateForMath` and exposes it as `memberSinceDate` in the profile response. `tenureY`/`tenureM` are derived from the same date, so always use those fields (not `enrolledDate`) for membership duration display.
- **Employer match tiers** (`Utils.gs:calculateMatchTier`): <5 yrs → 3%, 5–7 → 5%, 7–10 → 7%, 10+ → 10%
- **Plan change lock**: can only change contribution % once per 12 months (checked against `max(Current_Enrolled_Date, Last_Plan_Change_Date)`)
- **Withdrawal limits**: first withdrawal triggers 1-year re-enroll cooldown; second withdrawal is a permanent lockout (`Withdrawal_Count >= 2`)
- **5-year vesting**: employer match is only paid out on withdrawal if tenure ≥ 5 years (shown in the withdrawal modal)
- **Probation block**: users with a future `Probation_End` date cannot enroll
- **Beneficiaries**: stored as a JSON-stringified array in the `Beneficiary_Data` column; max 4 beneficiaries, must total exactly 100%

## GAS-Specific Patterns

- `google.script.run.withSuccessHandler(fn).withFailureHandler(fn).serverFunction(args)` is the only way frontend JS can call backend `.gs` functions — there is no REST API or fetch().
- `Session.getActiveUser().getEmail()` is how the backend identifies the current user.
- HTML templating uses `<?!= include('filename') ?>` (scriptlet syntax) in `Index.html`. The entry point **must** use `HtmlService.createTemplateFromFile().evaluate()`, not `createHtmlOutputFromFile()`, or scriptlets won't render.
- Sheet lookups use `headers.indexOf('ColumnName')` for positional column access — column order in the spreadsheet matters.
- The `SPREADSHEET_ID` in `Config.gs` uses `SpreadsheetApp.getActiveSpreadsheet()` because it is a bound script.

## UI Framework

Pico.css v2 (CDN). Use Pico's semantic HTML conventions (`<article>`, `<dialog>`, `<header>`, `<footer>`, `aria-busy`) for loading states and modals. Custom overlay/wizard pattern uses a `position: fixed` div with `display: flex` (class `wizard-overlay`) — not a native `<dialog>`.
