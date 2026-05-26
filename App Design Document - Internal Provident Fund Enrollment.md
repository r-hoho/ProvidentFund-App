
## 1. Project Overview
* **App Name:** Provident Fund App
* **Target Users:** ~10,000 internal employees
* **Primary Device:** Mobile-first (99% mobile usage)
* **Core Purpose:** Allow employees to view status, enroll, manage beneficiaries, change contribution %, change investment plan, and withdraw from the company Provident Fund (กองทุนสำรองเลี้ยงชีพ).

---

## 2. Architecture & Tech Stack
* **Frontend:** Google Apps Script (HTML Web App) served via `HtmlService.createTemplateFromFile('Index').evaluate()`.
  * **Framework:** Single Page Application (SPA) using Vanilla JavaScript and **PicoCSS (v2 via CDN)** for a semantic, lightweight, classless mobile UI.
  * **HTML composition:** `Index.html` includes partials via `<?!= include('filename') ?>` scriptlets (`CSS`, `Modals`, `Modals_Withdraw`, `JS_Utils`, `JS`, `JS_Beneficiary`, `JS_Withdraw`).
* **Backend:** Google Apps Script in the `Code/` folder, split across:
  * `Main.gs` — entry (`doGet`) and `include()` helper
  * `Config.gs` — sheet-name constants
  * `Profile.gs` — `getUserProfile()` (the main data-fetching function)
  * `Action.gs` — `processEnrollment`, `processChangePlan`, `processUpdateBeneficiaries`, `checkPlanChangeEligibility`
  * `Withdraw.gs` — `processWithdrawal`
  * `Utils.gs` — `calculateMatchTier`, `reportIssueToAdmin`
  * Frontend ↔ backend communication uses `google.script.run.withSuccessHandler(...).withFailureHandler(...)`.
* **Database:** Google Sheets (bound script — `SpreadsheetApp.getActiveSpreadsheet()`).
* **Automation & Reporting:** Planned — n8n for scheduled reporting + GAS `MailApp` for transactional and error emails. See §7 for current implementation status.

---

## 3. Performance & Scale
* **Observation Period:** Feb 2023 – Mar 2026 (3,735 events, 10-min session window)
* **Concurrency Metrics:**
  * **Peak Concurrent Users (PCU):** 8 (Observed Apr 18, 2024 at 12:39 PM)
  * **Average Concurrent Users:** 1.18
  * **Peak Events (Single Hour):** 18
* **Load Distribution (Active Time):**
  * 1 user at a time: ~87%
  * 2–3 users at a time: ~11%
  * 4+ users (high load): <2%
* **Infrastructure Note:** The app is extremely low-concurrency in practice. **`LockService` is NOT yet wired into the write paths** — this is a known production-readiness gap (see §8 and `TODO.md`). All four write functions (`processEnrollment`, `processChangePlan`, `processWithdrawal`, `processUpdateBeneficiaries`) currently do read-modify-write on the sheet without a script lock.

---

## 4. Database Schema (Google Sheets)

### Sheet 1: `Users`
* `Allstars_ID` (Primary Key)
* `Name_English`
* `Work_Email`
* `Business_Title`
* `Hire_Date`
* `Probation_End`

### Sheet 2: `Enrollments`
* `Allstars_ID`
* `First_Enrolled_Date` — set on the very first enrollment, never overwritten.
* `Current_Enrolled_Date` — overwritten on each new enrollment (i.e. re-enrollment after a withdrawal).
* `Current_Plan` (stored as decimal: `0.03`, `0.05`, `0.07`, `0.10`, `0.15`; displayed as %)
* `Investment_Plan` (`Plan 1` Conservative / `Plan 2` Moderate / `Plan 3` Growth / `Plan 4` Aggressive) — **captured at initial enrollment only.** Users change their investment plan via the bank's app afterward, so this field may not reflect the current truth and is intentionally not displayed on the dashboard. Treated as a historical record of the initial selection.
* `Withdrawal_Count` (Integer: 0, 1, or 2)
* `Last_Withdrawal_Date`
* `Last_Plan_Change_Date` — set on contribution % change; drives the 12-month plan-change lock.

### Sheet 3: `Beneficiaries` (append-only ledger)
* `Timestamp | Allstars_ID | Work_Email | Beneficiary_Data`
* `Beneficiary_Data` is a JSON-stringified array (max 4 entries, each with `name`, `rel`, `pct`; pct values must sum to exactly 100).
* The newest matching row is the active record; the full set of matching rows forms the user-visible history timeline.

### Sheet 4: `Audit_Log` (append-only)
* `Timestamp | Allstars_ID | Work_Email | Action | Plan | Investment | Beneficiaries | Device`
* `Action` values currently emitted: `Enroll`, `Change Plan`, `Update Beneficiaries`, `Withdraw`.
* **Implemented additions** (see [Proposal - In Progress Pending Transactions](./Proposal%20-%20In%20Progress%20Pending%20Transactions.md)): `Transaction_ID`, `Event_Type` (`SUBMITTED` / `CANCELLED`), `Event_Data` (JSON snapshot of prior + new values, used by Cancel to revert). Existing rows remain valid; new columns are blank for historical entries. Rows are strictly append-only and never modified or deleted.

### Sheet 5: `Monthly_Reporting`
* Constant `SHEET_REPORTING` declared in `Config.gs` but **not currently read or written** by any GAS code. Reserved for the planned n8n integration (see §7).

---

## 5. Business Logic & Rules

### Authentication & Identification
* Auto-authenticate via `Session.getActiveUser().getEmail()`.
* All write functions re-resolve email → `Allstars_ID` against the `Users` sheet on every call.

### Priority State Evaluation (Crucial Logic)
The frontend evaluates user state in this *exact* strict order (`JS.html:populateUI`):
1. **Permanent Lockout:** If `Withdrawal_Count >= 2` → "หมดสิทธิ์ถาวร / Locked".
2. **Probation:** If `Today < Probation_End` → "ทดลองงาน / Probation".
3. **Withdrawal Cooldown:** If user is within the 12-month penalty from `Last_Withdrawal_Date` → "ระงับสิทธิ์ชั่วคราว / Cooldown".
4. **Enrolled:** If `Current_Plan` is non-empty → "เป็นสมาชิก / Enrolled".
5. **Not Enrolled:** Default fallback → "ยังไม่เข้าร่วม / Not Enrolled".

> **Note:** This evaluation currently happens client-side only. Server-side write functions do not re-check these gates (except `processChangePlan`, which does re-validate the 12-month plan-change lock). Hardening this is a production-readiness item (§8).

### Membership-Start Math (Re-enrollment)
* First enrollment: `memberSinceDate` = `Hire_Date`.
* Re-enrollment (after one withdrawal): `memberSinceDate` = `Current_Enrolled_Date` of the new enrollment.
* `tenureY` / `tenureM` are derived from this and used everywhere membership age is displayed.

### Employer Match Tiers (`Utils.gs:calculateMatchTier`)
| Tenure (years from `memberSinceDate`) | Employer Match |
|---|---|
| < 5 | 3% |
| 5 – <7 | 5% |
| 7 – <10 | 7% |
| ≥ 10 | 10% |

### 5-Year Vesting (Withdrawal Modal)
* Employer match is paid out on withdrawal **only if `tenureY >= 5`**.
* The withdrawal modal renders a red "not eligible" banner for sub-5-year users and a green "eligible" banner otherwise. (This is a display rule — the actual payout calculation is handled outside the app.)

### Payroll Cut-off / Effective Date (15th rule)
* Applies to **enrollment**, **contribution % change**, and **withdrawal** (the three payroll-deduction actions). Does **not** apply to investment-plan changes or beneficiary updates.
* Submitted on or before the 15th → effective end of current month.
* Submitted on the 16th or later → effective end of following month.
* Calculated client-side by `getEffectiveDateInfo()` in `JS_Utils.html` and shown to the user in a banner at the point of submission. (Not yet persisted server-side — see §8.)

### Action Limitations
* **Plan Change Cooldown:** Contribution % can only be changed once per 12 months, measured from `max(Current_Enrolled_Date, Last_Plan_Change_Date)`. `checkPlanChangeEligibility()` returns the locked state + next eligible date; the modal shows a locked variant when applicable.
* **Lifetime Withdrawal Limit:** 2 withdrawals per employee lifecycle. 2nd withdrawal puts the user into permanent lockout.
* **Withdrawal Cooldown:** 12-month re-enrollment lockout after the first withdrawal.
* **Probation Block:** Users with a future `Probation_End` cannot enroll.
* **Beneficiaries:** Max 4 entries; percentages must sum to exactly 100.

---

## 6. User Journey & UI States (SPA Flow)

### UI & Language Policy
* **Framework:** PicoCSS v2. Minimal utility classes; rely on semantic tags (`<article>`, `<dialog>`, `<hgroup>`). Custom full-screen overlays (class `wizard-overlay`) are used for multi-step flows (enrollment wizard, beneficiary manager) instead of native `<dialog>`.
* **Dual-Language Interface:** All static text and dynamic status messages display Thai (primary) and English (secondary, muted/smaller) simultaneously. No language toggle.
* **Soft Reloading:** After successful POST actions, a toast (`#successToast`) is shown and `getUserProfile()` + `checkPlanChangeEligibility()` are re-triggered to refresh the dashboard without a full page reload.

### The Primary UI States

**1. Loading:** "กำลังโหลดข้อมูลผู้ใช้งาน... / Loading user profile..."

**2. Error:** Red error box with a "แจ้งปัญหาการใช้งาน" (Report Issue) button. *Note:* the `sendReport()` frontend handler is currently a stub — the backend `reportIssueToAdmin()` exists but is not wired up (§8).

**3. Dashboard Loaded (Global Header):** Displays ID, Name, Hire Date.

*Depending on the Priority State Evaluation, ONE of the following is rendered:*

**4. Permanent Lockout (Red):** Pill "หมดสิทธิ์ถาวร / Locked" (color `--pico-del-color`). No action buttons.

**5. Probation (Orange):** Pill "ทดลองงาน / Probation" (`#ffb74d`) + earliest eligible enrollment date.

**6. Cooldown (Purple):** Pill "ระงับสิทธิ์ชั่วคราว / Cooldown" (`#ba68c8`) + re-enroll eligible date.

**7. Enrolled (Green):** Pill "เป็นสมาชิก / Enrolled" (`#2e7d32`). Shows Contribution %, Employer Match %, Member Since (date + duration). 2×2 action grid:
* **[เงินสะสม / Contribution %]**
* **[นโยบายลงทุน / Investment Plan]**
* **[ผู้รับผลประโยชน์ / Beneficiaries]**
* **[การลาออก / Withdraw]**

**8. Not Enrolled (Default):** Pill "ยังไม่เข้าร่วม / Not Enrolled". Action: **[สมัครสมาชิก / Enroll]**.

**9. In Progress (Implemented):** A dashboard element appears when the user has a submitted-but-not-yet-effective enrollment / plan change / withdrawal. It shows a summary of the action, the cancellation deadline, and a Cancel button that reverts the affected `Enrollments` fields and appends a `CANCELLED` audit row. While a transaction is pending, `Your Plan` shows `—`; the status pill also shows `—` if the pending transaction is an Enroll. See [Proposal - In Progress Pending Transactions](./Proposal%20-%20In%20Progress%20Pending%20Transactions.md).

### Action Modals / Overlays

* **Enrollment Wizard** (full-screen overlay, 4 steps):
  1. Select contribution % (3 / 5 / 7 / 10 / 15)
  2. Select investment plan (1–4, conservative → aggressive)
  3. Add beneficiaries (max 4, must sum to 100%)
  4. Summary + effective-date banner → `processEnrollment()`
* **Change Contribution Plan** (`<dialog>`): shows current %, lets user pick a new %, includes 1-year-lock warning + effective-date banner → `processChangePlan()`. Locked variant shown if within 12-month window.
* **Change Investment Plan:** Opens a bilingual informational modal explaining that investment plan changes are managed in the bank's app, with a button linking out (bank name + URL are placeholders until provided). No backend write, no audit event, no 12-month lock — the bank app is the source of truth for investment plan post-enrollment. Initial selection still happens in step 2 of the enrollment wizard.
* **Beneficiary Manager** (full-screen overlay, 3 views): Current → Edit (same 4-max / 100% rules) → History timeline (from the append-only ledger) → `processUpdateBeneficiaries()`.
* **Withdraw** (`<dialog>`): shows tenure, employer-match eligibility based on 5-year vesting, penalty list, effective-date banner, mandatory acknowledgement checkbox → `processWithdrawal()`.

---

## 7. Integrations & Automation

| Feature | Status |
|---|---|
| **Transactional Emails** (GAS `MailApp`) on every audit event (submit / cancel) across all actions, plus **signed PDF letter** attached for Enrollment and Beneficiary changes | **Not implemented.** Design finalized — see [Proposal - Email Confirmations and Signed Letters](./Proposal%20-%20Email%20Confirmations%20and%20Signed%20Letters.md). |
| **Admin Error Reporting** via `reportIssueToAdmin()` | **Backend exists** in `Utils.gs`. Frontend `sendReport()` button handler is a stub — needs wiring (§8). |
| **Monthly Reporting (n8n)** scheduled pull from `Monthly_Reporting` sheet | **Not implemented.** Sheet constant declared in `Config.gs` but never read or written. |

---

## 8. Known Gaps / Production-Readiness Items

(See `TODO.md` for the live checklist; the items below are the issues that affect doc-vs-code accuracy or block production readiness.)

* **`LockService`** not yet wrapping any write path (despite §3's original claim) — highest-priority concurrency hardening.
* **Server-side rule re-checks** missing on `processEnrollment` (probation, cooldown, permanent lockout) and `processWithdrawal` (permanent lockout, not-currently-enrolled). The client is currently the only gate.
* **Server-side beneficiary validation** missing — `processUpdateBeneficiaries` and `processEnrollment` accept whatever JSON the client sends; no array/length/sum/required-field checks.
* **HTML escaping** on beneficiary `name` / `rel` interpolation in `JS_Beneficiary.html` and the enrollment summary view (XSS surface).
* **Effective date** computed client-side only and not persisted — if payroll keys off this, it needs to be stored on `Enrollments` and/or `Audit_Log`.
* **Re-enrollment** does not clear `Last_Plan_Change_Date` from the prior enrollment — may incorrectly block the first plan change of a new enrollment.
* **Transactional confirmation emails** for all four user actions.
* **Change Investment Plan info modal** — `openChangeInvest()` is a stub; replace with an info modal pointing users to the bank's app. See `TODO.md`.
* **Dead / stale code:** `sendReport()` stub, stale `mainChangePlanBtn` / `mainWithdrawBtn` lookups in `populateUI`, unused `SHEET_REPORTING` constant.
