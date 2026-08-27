---
type: concept
title: Business Rules & Invariants
description: The non-negotiable domain rules the Provident Fund app enforces — the payroll cut-off, employer-match tenure tiers, plan-change and withdrawal locks, 5-year vesting, probation block, and beneficiary validation — where each lives in code and which actions it constrains.
tags: [business-rules, invariants, payroll-cutoff, employer-match, vesting, withdrawal-limits, plan-change-lock, probation, beneficiary-validation]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-27T08:53:10.517Z
sources:
  - id: openwiki-source-d96bce7863e078a22b36406f
    resource: repo://App%20Design%20Document%20-%20Internal%20Provident%20Fund%20Enrollment.md
  - id: openwiki-source-a2371d6362e5db4bc834ad03
    resource: repo://CLAUDE.md
  - id: openwiki-source-c7bfaaf4ee9e3e78d074addf
    resource: repo://Code/Action.gs
  - id: openwiki-source-95688f6a8ac3c427126ce925
    resource: repo://Code/Config.gs
  - id: openwiki-source-be72430c9ea6ec21d42b78cf
    resource: repo://Code/Profile.gs
  - id: openwiki-source-18dc44edee07990ce806b4c2
    resource: repo://Code/Utils.gs
  - id: openwiki-source-07de7be57227e3320e78ace3
    resource: repo://Code/Withdraw.gs
  - id: openwiki-source-668945266deb6bf0ce3014d3
    resource: repo://html/JS_Beneficiary.html
  - id: openwiki-source-734fb938319bf9c7cd82d85e
    resource: repo://html/JS_Utils.html
  - id: openwiki-source-ea131c734a8e36a6172ce537
    resource: repo://html/JS_Withdraw.html
  - id: openwiki-source-524fa0295f8d2fb28f0b8b39
    resource: repo://html/JS.html
  - id: openwiki-source-92ee68a3100ec2ab9d4eb076
    resource: repo://MIGRATION.md
generated: { by: "openwiki/0.4.3", at: "2026-08-27T08:53:10.517Z" }
---

# Business Rules & Invariants

The Provident Fund app encodes a set of policy rules that an employee's enrollment lifecycle must obey. These are not suggestions — they are the gates that decide whether a user can enroll, what match they earn, how often they can change their plan, and what happens when they withdraw. Every rule below is enforced (or at least surfaced) in real code; this page maps each rule to the functions that implement it and the actions it constrains.

The rules split into two families: **time-based** rules keyed off a date (the payroll cut-off, the plan-change lock, the withdrawal cooldown, the 5-year vesting, the probation block) and **structural** rules over the beneficiary list (max 5, each share ≥ 1, total exactly 100, required fields). The time-based rules read their inputs from the `Enrollments` and `Users` sheets and compute eligibility in `Profile.gs` (`getUserProfile`) and `Action.gs`; the structural rules live in the client-side wizard (`JS.html`) and beneficiary manager (`JS_Beneficiary.html`).

## State evaluation order

Before diving into the individual rules, the single most important invariant is the **order** in which they are evaluated. `populateUI` in `JS.html` checks user state in a strict, non-commutative cascade:

1. **Permanent lockout** — `Withdrawal_Count >= 3` → "หมดสิทธิ์ถาวร / Locked"
2. **Probation** — `Today < Probation_End` → "ระหว่างทดลองงาน / Probation"
3. **Withdrawal cooldown** — within 6 months of `Last_Withdrawal_Date` (after the 1st or 2nd withdrawal) → "ระงับสิทธิ์ชั่วคราว / Cooldown"
4. **Enrolled** — `Current_Plan` non-empty → "เป็นสมาชิก / Enrolled"
5. **Eligible** — default → "มีสิทธิ์สมัครได้ / Eligible"

A user who is permanently locked out is never also shown as "on probation" — the first matching state wins and short-circuits the rest. This ordering also has a subtle interaction: the cooldown check runs *before* the enrolled check, so a user whose `Last_Withdrawal_Date` is recent but who somehow has a non-blank `Current_Plan` is shown as "Cooldown" rather than "Enrolled". The `MIGRATION.md` consistency checklist calls this out — an enrolled re-enrollment row (states 5 and 10) must have a `Last_Withdrawal_Date` more than 6 months in the past, or the cooldown would wrongly mask the enrolled status.

> **Production-readiness gap:** this cascade currently runs **client-side only**. The server-side write functions (`processEnrollment`, `processWithdrawal`, `processUpdateBeneficiaries`) do **not** re-validate the probation / cooldown / lockout gates before writing — only `processChangePlan` re-checks the 6-month plan-change lock. Hardening the write paths to re-check these gates server-side is a known item.

## The payroll cut-off (15th rule)

The payroll cut-off decides which month's salary a deduction lands in. It is the rule with the broadest reach: it governs the **effective date** of three of the five actions, and it defines the **cancellation window** for those same three.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    Submit["Submission date (Asia/Bangkok)"] --> Q{"Day of month > 15?"}
    Q -->|Yes, 16th or later| Next["Effective: end of <b>next</b> month"]
    Q -->|No, 15th or earlier| This["Effective: end of <b>this</b> month"]
    Next --> Eff["getEffectiveDate / getEffectiveMonthLabel"]
    This --> Eff
```

**Rule:** a submission made on or before the 15th of the month takes effect at the end of that same month; a submission on the 16th or later takes effect at the end of the following month.

**Scope — applies to:** enrollment (`processEnrollment`), contribution % change (`processChangePlan`), and withdrawal (`processWithdrawal`). These are the three "payroll-deduction" actions.

**Scope — does NOT apply to:** investment-plan changes and beneficiary updates. Those are effective immediately (no cut-off, no cancellable pending state). `processUpdateBeneficiaries` stamps `effectiveDate: today` in its letter context precisely because there is no payroll cycle to defer to.

### Where it is computed

The cut-off is computed in four server-side helpers in `Utils.gs`, all operating in `Asia/Bangkok` time so the day boundary is correct regardless of the GAS project's default timezone:

| Function | Returns | Used for |
|---|---|---|
| `getEffectiveDate(submittedAt)` | End-of-month date string, e.g. `"30 Jun 2026"` | Effective date display |
| `getEffectiveMonthLabel(submittedAt)` | Bilingual `{th, en}` month label, e.g. `{th: "มิถุนายน 2026", en: "June 2026"}` | Confirmation emails + signed letters (framed as a salary month, not a day) |
| `getEditableUntil(submittedAt)` | The next upcoming 15th at 23:59:59 Bangkok time | Cancellation window deadline |
| `isWithinEditableWindow(submittedAt)` | `boolean` — is the submission still cancellable? | `getPendingTransactions` filter |

The cut-off is mirrored **client-side** by `getEffectiveDateInfo()` in `JS_Utils.html`, which renders the effective-date banner in the enrollment wizard and the change-plan modal. The two copies must stay in sync — the backend formats a date, the frontend formats a month, but both apply the same `day > 15` boundary.

### The cancellation window

Only the three payroll-deduction actions are cancellable, and only while the cut-off window is still open. `getPendingTransactions` filters the `Audit_Log` for rows where the action is in `CANCELLABLE_ACTIONS` (`["Enroll", "Change Plan", "Withdraw"]`), the latest event is `SUBMITTED` or `EDITED`, and `isWithinEditableWindow(submittedAt)` is true. Beneficiary and investment-plan actions log a `SUBMITTED` row but are deliberately excluded — they are effective immediately and have no cancel state. `cancelTransaction` re-checks `isWithinEditableWindow` before reverting, and a cancelled `Withdraw` rolls back the withdrawal count and the `Last_Withdrawal_Date` (no penalty persists).

## Employer match tiers by tenure

The employer match percentage rises in four tenure bands, computed by `calculateMatchTier(years)` in `Utils.gs`:

| Tenure (years from `memberSinceDate`) | Employer match |
|---|---|
| `< 5` | `3%` |
| `5 – < 7` | `5%` |
| `7 – < 10` | `7%` |
| `≥ 10` | `10%` |

The function is a simple ladder of thresholds — `< 5` → `3%`, `< 7` → `5%`, `< 10` → `7%`, else `10%` — so the upper bound of each band is exclusive. The match is surfaced in three places: the enrolled dashboard ("infoMatch" in `populateUI`), the enrollment confirmation letter (`ctx.employerMatchPct` in `processEnrollment`), and (inversely, as a gate) the withdrawal vesting check.

### Membership start date — the basis for tenure

Which date tenure is measured from is itself a rule, and it changes on re-enrollment:

- **First enrollment:** `memberSinceDate` = `Hire_Date` (from the `Users` sheet).
- **Re-enrollment after a withdrawal** (`Withdrawal_Count >= 1`): `memberSinceDate` = `Current_Enrolled_Date` — the new enrollment date, **not** the original hire date.

`getUserProfile` computes this in `Profile.gs`: `startDateForMath` defaults to `rawHireDate`, but switches to `enrollmentData.enrolledDate` when `withdrawalCount >= 1` and a real enrolled date exists. From `startDateForMath` it derives `tenureYears` (fractional, for the match tier), `tenureY` (whole years, for vesting), and `tenureM` (whole months, for display). The dashboard consumes `memberSinceDate` / `tenureY` / `tenureM` from `getUserProfile` — **never** the raw `enrolledDate`, which is a sheet column that does not recompute on re-enrollment.

`processEnrollment` mirrors the same logic for the letter: `memberSinceDate` is `Hire_Date` when `wasFirstEnrollment` is true, else `today` (the re-enrollment date). `First_Enrolled_Date` is set once on the first enrollment and never overwritten; its emptiness drives the `wasFirstEnrollment` flag.

## 6-month plan-change lock

A member may change their contribution % **once per 6 months**. The lock is measured from `max(Current_Enrolled_Date, Last_Plan_Change_Date)` — whichever of the current enrollment date or the most recent plan change is later.

### Two enforcement points

1. **`checkPlanChangeEligibility()`** — called on page load (`JS.html` DOMContentLoaded) to pre-compute the lock state. It reads `Last_Plan_Change_Date` and `Current_Enrolled_Date`, takes `Math.max` of the two, adds 6 months, and returns `{ locked: true, nextDate }` if today is before that date. The frontend uses this to show the change-plan modal in its locked variant (disabled selector + "you can change again on …" message).

2. **`processChangePlan(newPlan, deviceData)`** — the server-side write function **re-validates the same lock** before writing. It re-derives `mostRecentAction` from `max(lastChangeDate, enrollDate)`, adds 6 months, and returns a failure with the next-eligible date if the window hasn't opened. This is the one server-side gate that is actually enforced at write time (unlike probation / cooldown / lockout, which are client-side only). On success it sets `Current_Plan` and stamps `Last_Plan_Change_Date = today`, which becomes the new anchor for the next 6-month window.

The lock applies **only to contribution %** — investment-plan changes and beneficiary updates are not throttled by it (and are not payroll-cycled, per the cut-off rule above).

## Withdrawal limits — cooldown and permanent lockout

A member gets **up to 3 enrollments** over their lifecycle. `Withdrawal_Count` holds steady through each enrollment (it is `0` through the 1st, `1` through the 2nd, `2` through the 3rd) and only ticks up when a withdrawal is processed. `processWithdrawal` increments the count and sets `Last_Withdrawal_Date = today`, while clearing `Current_Plan` and `Investment_Plan` (a blank `Current_Plan` is the "not enrolled" signal).

### The 6-month re-enrollment cooldown

After the **1st and 2nd** withdrawals, a 6-month cooldown blocks re-enrollment. `getUserProfile` computes it:

- Only when `Withdrawal_Count === 1 || Withdrawal_Count === 2` **and** `Last_Withdrawal_Date` is a real date.
- `unlockDate = Last_Withdrawal_Date + 6 months`.
- If `today < unlockDate` → `isCoolingDown = true`, `cooldownEndDate` is surfaced for the dashboard's "Re-enroll on …" message.

The cooldown-vs-ready distinction is decided **purely** by `Last_Withdrawal_Date + 6 months` relative to today — there is no separate flag; the date *is* the switch. A member in cooldown sees the withdrawal-in-progress timeline and the next-eligible date in `#cooldownMessage` (rendered by `showWithdrawalMessage`).

### The 3rd withdrawal — permanent lockout

When `Withdrawal_Count >= 3`, the user is **permanently locked out** — no further enrollments, no cooldown. `populateUI` checks this state first in the cascade and shows "หมดสิทธิ์ถาวร / Locked". `processWithdrawal` does not refuse the 3rd withdrawal (it simply increments the count), so the lockout takes effect on the *next* enrollment attempt. The `MIGRATION.md` state model confirms this: state 6 ("Withdrawn 3×, locked") has `Withdrawal_Count = 3` and no path back to an enrolled state.

### The 9 enrollment-cycle states

`MIGRATION.md` formalizes the lifecycle as 9 states plus a probation flag. States 1 and 7 (never enrolled, fresh) have no `Enrollments` row; states 2–10 cycle through enroll (`Current_Plan` set) → withdraw (`Current_Plan` blank, count ticks) → cooldown (count 1 or 2, ≤6 mo) → ready (>6 mo) → re-enroll. `Withdrawal_Count` is the spine: it is 0 through the first enrollment cycle, 1 through the second, 2 through the third, and 3 at permanent lockout.

## 5-year vesting (employer match on withdrawal)

On a withdrawal, the **employer match** is paid out **only if the member has ≥ 5 years of tenure** (`tenureY >= 5`). The employee's **own contributions and returns are always 100% vested**, regardless of tenure — vesting gates the employer portion only.

This is a **display rule**, surfaced in the withdrawal modal (`JS_Withdraw.html#openWithdraw`): it reads `globalUserProfile.tenureY` and renders two eligibility rows — "Your contributions + returns" (always green) and "Employer match + returns" (green if `tenureY >= 5`, red with "requires 5 years membership" otherwise). The actual payout calculation is handled outside the app; the modal only communicates eligibility. Note that `tenureY` here is the whole-years value from `getUserProfile`, which (per the membership-start rule) is measured from `Current_Enrolled_Date` on a re-enrollment — so a member who withdrew and re-enrolled restarts the vesting clock.

## Probation block on enrollment

A user whose `Probation_End` (in the `Users` sheet) is a **future** date cannot enroll. `getUserProfile` checks `rawProbationDate instanceof Date && rawProbationDate > today` and sets `isOnProbation = true` with `probationEndDate` for the dashboard's "Eligible to enroll after …" message. Probation lives entirely in the `Users` sheet — a probation-blocked user (state 7) has no `Enrollments` row. The gate is evaluated **after** permanent lockout in the state cascade but **before** cooldown and enrolled, so a user who is both on probation and in a withdrawal cooldown sees the probation message.

## Beneficiary validation

Beneficiaries are stored as a JSON-stringified array in `Beneficiary_Data`, appended to the `Beneficiaries` ledger (newest row = active). Each entry is `{name, rel, pct, address}`. The structural rules are enforced client-side in the enrollment wizard (`JS.html#validateStep`, step 3) and the beneficiary manager (`JS_Beneficiary.html#validateUpdateBen`):

- **Maximum 5 entries.** `addBeneficiary` / `addUpdateBeneficiary` refuse to push once `editBenData.length >= 5`, and the "Add" button hides.
- **Each `pct` ≥ 1.** The `<input type="number" min="1" max="100">` enforces it at the DOM level; the validator rejects any row with `pct < 1`.
- **All `pct` sum to exactly 100.** The validator totals the percentages and enables the Next/Sign button only when the total is exactly 100 — not 99, not 101. A helper message distinguishes "Total exceeds 100%" from "Must equal exactly 100%".
- **All fields required:** title prefix, name, relationship (`rel`), and address are all non-empty for every row. A row missing any of these fails `allFilled` and blocks progression.

### Title prefix — a transient UI field

The beneficiary **title prefix** (นาย / นาง / นางสาว / ด.ช. / ด.ญ. for Thai, Mr. / Ms. / Mrs. for English) is a bank requirement on every beneficiary name, but it is **not** part of the stored model. It is a *transient UI-only field* that is merged into `name` at submit time by `mergePrefixes()`:

```
{prefix: "นาย", name: "สมชาย ใจดี", ...}  →  {name: "นาย สมชาย ใจดี", ...}
```

This keeps the stored model `{name, rel, pct, address}` unchanged so nothing downstream needed modification. `splitPrefix()` is the inverse — when re-editing a saved beneficiary, it scans the leading `name` for a known prefix from `PREFIX_LIST` and pulls it back out into the dropdown, so a re-save does not double-prefix the name. Both the wizard and the beneficiary manager call `mergePrefixes` right before `JSON.stringify` on submit.

### Relationship — stored as English key, displayed in Thai

`rel` is stored as one of the English keys `Parent` / `Spouse` / `Child` / `Sibling` / `Relative` / `Friend` — the `<select>` option value, the audit-log value, and the JSON-in-sheet value. `Other` was removed from the picker but retained in `REL_LABELS` so legacy rows still display. Display is mapped to a Thai-first label (`"บิดา/มารดา (Parent)"`) via `relLabel()`, which exists in two places that must stay in sync — `Config.gs` (server) and `JS_Utils.html` (client).

## Rule ownership — where each lives

| Rule | Computed in | Enforced at write time? |
|---|---|---|
| Payroll cut-off | `Utils.gs` (server) + `JS_Utils.html` (client mirror) | N/A — drives effective-date display + cancellation window |
| Employer match tier | `Utils.gs#calculateMatchTier`, called by `Profile.gs` | Display only (letter + dashboard) |
| Membership start date | `Profile.gs#getUserProfile` | Drives tenure/match/vesting math |
| Plan-change lock (6 mo) | `Action.gs#checkPlanChangeEligibility` + `processChangePlan` | **Yes** — `processChangePlan` re-validates |
| Withdrawal cooldown (6 mo) | `Profile.gs#getUserProfile` | No — client-side cascade only |
| Permanent lockout (3rd wd) | `Profile.gs` (`Withdrawal_Count >= 3`) | No — client-side cascade only |
| 5-year vesting | `JS_Withdraw.html#openWithdraw` (display) | Display only |
| Probation block | `Profile.gs#getUserProfile` | No — client-side cascade only |
| Beneficiary validation | `JS.html#validateStep` + `JS_Beneficiary.html#validateUpdateBen` | No — client-side only |
| Cancellation window | `Utils.gs#isWithinEditableWindow` + `Profile.gs#getPendingTransactions` | `cancelTransaction` re-checks the window |
