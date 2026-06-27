# CLAUDE.md

Working notes for Claude Code when editing this repo. For design rationale, scale metrics, and feature history, see `App Design Document - Internal Provident Fund Enrollment.md`. For the live backlog (features, test cases, polish), see `TODO.md` — check at session start, update as work completes.

## Layout

### Backend (`Code/` — `.gs` files run server-side in GAS)

| File | Responsibility |
|------|----------------|
| `Main.gs` | `doGet()` entry; `include()` helper for HTML templating |
| `Config.gs` | Sheet-name constants (`SHEET_USERS`, `SHEET_FEEDBACK`, etc.) + `REL_LABELS` (beneficiary-relationship display map, Thai-first; mirror of the one in `JS_Utils.html`) |
| `Profile.gs` | `getUserProfile()` — main data fetch; calculates eligibility, tenure, match tier; `getPendingTransactions()` (in-progress box; cancellable actions only) |
| `Action.gs` | `processEnrollment`, `processChangePlan`, `processUpdateBeneficiaries`, `checkPlanChangeEligibility`, `cancelTransaction` |
| `Withdraw.gs` | `processWithdrawal` |
| `Email.gs` | `sendActionConfirmation({...})` — bilingual (Thai-first) confirmation emails; never throws. Body is a styled responsive HTML table (`buildHtmlEmail()`); all user-supplied values run through `escapeHtml()`. Wired into enrollment, beneficiary, change-plan, withdrawal, and cancel. Cancel-line shown only for cancellable actions (`Enroll`/`Change Plan`/`Withdraw`) |
| `Letter.gs` | `generateLetter(type, ctx, sigDataUrl)` — Google Doc template → PDF (placeholder fill, plain-text beneficiary list, drawn signature embedded scaled to fit `PF_SIG_MAX_WIDTH × PF_SIG_MAX_HEIGHT` preserving aspect), archived in Drive. May throw — caller wraps in try/catch. Template/folder IDs read from Script Properties via `getLetterConfig_()` (`PF_ENROLLMENT_TEMPLATE_ID`, `PF_BENEFICIARY_TEMPLATE_ID`, `PF_LETTERS_FOLDER_ID`); set them under Project Settings → Script Properties (not in source). Wired into enrollment + beneficiary — beneficiary uses its own page-2-only template (`PF_BENEFICIARY_TEMPLATE_ID`, set; falls back to the enrollment template only if unset). `testGenerateLetter()` / `testGenerateBeneficiaryLetter()` are editor-run harnesses |
| `Utils.gs` | `calculateMatchTier(years)`, `relLabel(key)` (relationship key→Thai label via `REL_LABELS`), `reportIssueToAdmin()`, `generateTransactionId(prefix)`, `appendRowToSheet(sheet, rowObj)`, `getEffectiveDate(submittedAt)`, `getEffectiveMonthLabel(submittedAt)`, `patchAuditEventData(txId, eventType, fields)` |
| `Feedback.gs` | `submitFeedback({action, rating, comment})` — appends a 1-5 star rating + optional comment to the `App_Feedback` sheet (must exist; no-ops best-effort if missing). Identity (Allstars_ID/email) resolved server-side. Best-effort; called after a successful main action |
| `Analytics.gs` | GA4 server-side adoption metrics (Measurement Protocol). `trackEvent(name, params)` → POSTs to `/mp/collect`; `trackAppOpen()` (visits/returning, in `doGet()`) + `trackFeatureAction(feature, outcome)` (success/fail per action, in the 5 handlers). `user_id` is a **SHA-256 hash** of the email (pseudonymous, PDPA) via `hashUserId_()` + optional `GA4_USER_ID_SALT`. All best-effort — never throws, no-ops if unconfigured. Config in Script Properties (`GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `GA4_USER_ID_SALT`). `testTrackEvent()` is the editor-run harness (validates via `/debug/mp/collect`) |

### Frontend (`html/` — included via `<?!= include('filename') ?>`)

| File | Responsibility |
|------|----------------|
| `Index.html` | Shell; includes CSS / Modals / JS partials |
| `CSS.html` | Custom styles over Pico.css v2 |
| `JS.html` | Dashboard logic, enrollment wizard (5-step; step 5 = signature), change-plan modal |
| `JS_Beneficiary.html` | Beneficiary manager (4 views: current / edit / history / sign) |
| `JS_Withdraw.html` | Withdrawal flow with 5-year vesting check |
| `JS_Feedback.html` | Post-action star-rating modal (`openFeedback`/`setFeedbackRating`/`submitFeedbackForm`). Triggered from `populateUI` via the `pendingFeedbackAction` flag (set in each main-action success handler) so it lands *after* the forced home-reload. Star required, comment optional, Skip always available |
| `JS_Utils.html` | Shared helpers (`getEffectiveDateInfo`, effective-date banner) + `REL_LABELS`/`relLabel()` beneficiary-relationship display map (mirror of the one in `Config.gs` — keep in sync) |
| `JS_Signature.html` | Shared `window.PFSignature` helper over signature_pad (CDN): `mount/isEmpty/getDataUrl/clear/destroy`; hi-DPI, dark-blue ink. `getDataUrl()` auto-trims the export to the ink's bounding box (`trimToInk`, alpha-scan + 8px pad) so a small/corner signature exports tight. Used by enrollment step 5 + beneficiary sign view |
| `Modals.html` | Enrollment wizard, change-plan dialog, beneficiary manager markup |
| `Modals_Withdraw.html` | Withdrawal `<dialog>` markup |

### Sheets

| Sheet | Purpose |
|-------|---------|
| `Users` | Employee master — `Allstars_ID`, `Work_Email`, `Name_English`, `Business_Title`, `Hire_Date`, `Probation_End` |
| `Enrollments` | One row/employee — `First_Enrolled_Date`, `Current_Enrolled_Date`, `Current_Plan`, `Investment_Plan`, `Withdrawal_Count`, `Last_Withdrawal_Date`, `Last_Plan_Change_Date` |
| `Beneficiaries` | Append-only ledger — `Timestamp`, `Allstars_ID`, `Work_Email`, `Beneficiary_Data` (JSON string) |
| `Audit_Log` | Append-only audit trail of all user actions |
| `App_Feedback` | Post-action star ratings — `Timestamp`, `Allstars_ID`, `Email`, `Action`, `Rating` (1-5), `Comment`. Create manually (headers in row 1) |
| `Monthly_Reporting` | Declared in `Config.gs` but not yet used |

## Business rule invariants (don't violate)

- **Payroll cut-off:** submitted ≤15th → effective end of this month; ≥16th → end of next month. Applies only to enrollment, contribution % change, and withdrawal — NOT investment plan or beneficiaries.
- **Membership start date:** first enrollment → `Hire_Date`; re-enrollment after a withdrawal → new `Current_Enrolled_Date`. Use `memberSinceDate` / `tenureY` / `tenureM` from `getUserProfile()`, not `enrolledDate`.
- **Employer match tiers** (`Utils.gs:calculateMatchTier`): <5y → 3%, 5–7 → 5%, 7–10 → 7%, ≥10 → 10%.
- **Plan-change lock:** contribution % changeable once per 6 months, measured from `max(Current_Enrolled_Date, Last_Plan_Change_Date)`.
- **Withdrawal limits:** 1st and 2nd each trigger a 6-month re-enroll cooldown (up to a 3rd enrollment); 3rd is permanent lockout (`Withdrawal_Count >= 3`).
- **5-year vesting:** employer match only paid out on withdrawal if `tenureY >= 5` (shown in withdrawal modal).
- **Probation block:** future `Probation_End` → cannot enroll.
- **Beneficiaries:** stored as JSON in `Beneficiary_Data` — `{name, rel, pct, address}`; max 5; **each pct ≥ 1** and they must sum to exactly 100; `name` + `rel` + `address` all required (validated in `validateStep`/`validateUpdateBen`). `rel` stored as English key; displayed via `relLabel()`. Address required as of bank confirmation; the "Same as Above" checkbox copies the previous beneficiary's address.
- **Confirmation emails:** every action handler calls `sendActionConfirmation(...)` *after* sheet writes succeed, then `patchAuditEventData(...)` to stamp `emailSent`/`emailError`. Email/letter failure must NEVER block or roll back the action — the handler still returns success. The cancel-line ("To cancel this request…") is added only for `SUBMITTED` events of cancellable actions; exclude beneficiary/investment SUBMITTED when those get wired.

## GAS-specific gotchas

- **No local toolchain.** Edit → paste/sync into the GAS editor → deploy as Web App → test in browser. No automated tests, no `clasp`.
- **Frontend → backend:** only `google.script.run.withSuccessHandler(fn).withFailureHandler(fn).serverFunction(args)`. No fetch / REST.
- **User identity:** `Session.getActiveUser().getEmail()` server-side.
- **HTML templating:** entry point MUST use `HtmlService.createTemplateFromFile(...).evaluate()` — `createHtmlOutputFromFile` will silently fail to render `<?!= include() ?>` scriptlets.
- **Sheet column access:** uses `headers.indexOf('ColumnName')` — column order in the sheet matters.
- **`SPREADSHEET_ID`** uses `SpreadsheetApp.getActiveSpreadsheet()` (bound script).

## UI

Pico.css v2 via CDN. Multi-step flows (enrollment wizard, beneficiary manager) use a custom `position:fixed` overlay (class `wizard-overlay`), not native `<dialog>`. Simple modals (change-plan, withdraw, feedback) use native `<dialog>`.

**Ineligible-user "eligible after" message:** for probation (future `Probation_End`) and post-withdrawal cooldown (`Last_Withdrawal_Date + 6mo`, after the 1st or 2nd withdrawal), `populateUI` shows the next-eligible date in `#cooldownMessage`. That div MUST live directly in the Actions `<article>`, NOT inside `#enrolledActionsGroup` (which is `display:none` for non-enrolled users) — otherwise the message is set visible but its hidden parent keeps it invisible (a bug that was fixed). Thai/English/date are on separate `<br>` lines so the long Thai run never wraps awkwardly on mobile.
