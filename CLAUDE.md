# CLAUDE.md

Working notes for Claude Code when editing this repo. For design rationale, scale metrics, and feature history, see `App Design Document - Internal Provident Fund Enrollment.md`. For the live backlog (features, test cases, polish), see `TODO.md` — check at session start, update as work completes.

## Layout

### Backend (`Code/` — `.gs` files run server-side in GAS)

| File | Responsibility |
|------|----------------|
| `Main.gs` | `doGet()` entry; `include()` helper for HTML templating |
| `Config.gs` | Sheet-name constants (`SHEET_USERS`, etc.) |
| `Profile.gs` | `getUserProfile()` — main data fetch; calculates eligibility, tenure, match tier |
| `Action.gs` | `processEnrollment`, `processChangePlan`, `processUpdateBeneficiaries`, `checkPlanChangeEligibility` |
| `Withdraw.gs` | `processWithdrawal` |
| `Utils.gs` | `calculateMatchTier(years)`, `reportIssueToAdmin()` |

### Frontend (`html/` — included via `<?!= include('filename') ?>`)

| File | Responsibility |
|------|----------------|
| `Index.html` | Shell; includes CSS / Modals / JS partials |
| `CSS.html` | Custom styles over Pico.css v2 |
| `JS.html` | Dashboard logic, enrollment wizard (4-step), change-plan modal |
| `JS_Beneficiary.html` | Beneficiary manager (3 views: current / edit / history) |
| `JS_Withdraw.html` | Withdrawal flow with 5-year vesting check |
| `JS_Utils.html` | Shared helpers (`getEffectiveDateInfo`, effective-date banner) |
| `Modals.html` | Enrollment wizard, change-plan dialog, beneficiary manager markup |
| `Modals_Withdraw.html` | Withdrawal `<dialog>` markup |

### Sheets

| Sheet | Purpose |
|-------|---------|
| `Users` | Employee master — `Allstars_ID`, `Work_Email`, `Name_English`, `Business_Title`, `Hire_Date`, `Probation_End` |
| `Enrollments` | One row/employee — `First_Enrolled_Date`, `Current_Enrolled_Date`, `Current_Plan`, `Investment_Plan`, `Withdrawal_Count`, `Last_Withdrawal_Date`, `Last_Plan_Change_Date` |
| `Beneficiaries` | Append-only ledger — `Timestamp`, `Allstars_ID`, `Work_Email`, `Beneficiary_Data` (JSON string) |
| `Audit_Log` | Append-only audit trail of all user actions |
| `Monthly_Reporting` | Declared in `Config.gs` but not yet used |

## Business rule invariants (don't violate)

- **Payroll cut-off:** submitted ≤15th → effective end of this month; ≥16th → end of next month. Applies only to enrollment, contribution % change, and withdrawal — NOT investment plan or beneficiaries.
- **Membership start date:** first enrollment → `Hire_Date`; re-enrollment after a withdrawal → new `Current_Enrolled_Date`. Use `memberSinceDate` / `tenureY` / `tenureM` from `getUserProfile()`, not `enrolledDate`.
- **Employer match tiers** (`Utils.gs:calculateMatchTier`): <5y → 3%, 5–7 → 5%, 7–10 → 7%, ≥10 → 10%.
- **Plan-change lock:** contribution % changeable once per 12 months, measured from `max(Current_Enrolled_Date, Last_Plan_Change_Date)`.
- **Withdrawal limits:** 1st triggers 12-month re-enroll cooldown; 2nd is permanent lockout (`Withdrawal_Count >= 2`).
- **5-year vesting:** employer match only paid out on withdrawal if `tenureY >= 5` (shown in withdrawal modal).
- **Probation block:** future `Probation_End` → cannot enroll.
- **Beneficiaries:** stored as JSON in `Beneficiary_Data`; max 4; pct must sum to exactly 100.

## GAS-specific gotchas

- **No local toolchain.** Edit → `clasp push` (or paste into GAS editor) → deploy as Web App → test in browser. No automated tests.
- **Frontend → backend:** only `google.script.run.withSuccessHandler(fn).withFailureHandler(fn).serverFunction(args)`. No fetch / REST.
- **User identity:** `Session.getActiveUser().getEmail()` server-side.
- **HTML templating:** entry point MUST use `HtmlService.createTemplateFromFile(...).evaluate()` — `createHtmlOutputFromFile` will silently fail to render `<?!= include() ?>` scriptlets.
- **Sheet column access:** uses `headers.indexOf('ColumnName')` — column order in the sheet matters.
- **`SPREADSHEET_ID`** uses `SpreadsheetApp.getActiveSpreadsheet()` (bound script).

## UI

Pico.css v2 via CDN. Multi-step flows (enrollment wizard, beneficiary manager) use a custom `position:fixed` overlay (class `wizard-overlay`), not native `<dialog>`. Simple modals (change-plan, withdraw) use native `<dialog>`.
