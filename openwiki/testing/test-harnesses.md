---
type: testing
title: Test Harnesses & Editor-Run Validation
description: How the GAS Provident Fund app is validated without a CI test runner — the Apps Script editor-run policy suite, GA4 analytics harness, signed-letter harnesses, the Python migration workbook structural check, and the OpenWiki doc-refresh workflow.
tags: [testing, apps-script, analytics, data-migration, openwiki, harness]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-27T08:53:10.517Z
sources:
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-f4562d168afe0472674501cd
    resource: repo://Code/Analytics.gs
  - id: openwiki-source-3b1cba3f000133303a1612d7
    resource: repo://Code/Letter.gs
  - id: openwiki-source-be72430c9ea6ec21d42b78cf
    resource: repo://Code/Profile.gs
  - id: openwiki-source-9484d06c52ae3841eedff859
    resource: repo://Code/TestCases.gs
  - id: openwiki-source-18dc44edee07990ce806b4c2
    resource: repo://Code/Utils.gs
  - id: openwiki-source-b66f0da6fc970f0508bb8de0
    resource: repo://Data/verify.py
generated: { by: "openwiki/0.4.3", at: "2026-08-27T08:53:10.517Z" }
---

# Test Harnesses & Editor-Run Validation

This app has **no automated CI test runner for the Google Apps Script (GAS) application code itself**. The `.gs` files can only execute inside the Apps Script runtime bound to the live Google Spreadsheet (they depend on `SpreadsheetApp`, `DriveApp`, `PropertiesService`, etc.), so a generic unit-test framework outside that runtime cannot exercise them. Validation is therefore done by **editor-run harness functions** invoked manually from the Apps Script editor, which emit `[PASS]`/`[FAIL]` or diagnostic output to the `Logger`. The one piece of offline validation is a Python structural check over the migration workbook. Separately, a GitHub Actions workflow keeps the *documentation* (not the app) refreshed.

## 1. Policy rule suite — `Code/TestCases.gs`

`testAugustPolicyRules()` is the single entry point of the policy suite. It defines an inline `assert(condition, message)` that logs `[PASS]` / `[FAIL]` and counts pass/fail, then runs five try/catch-guarded test cases, ending with a `=== TEST SUITE COMPLETED: N PASSED, M FAILED ===` summary line.

A defining characteristic of this suite is that it **re-implements the policy logic in-place rather than calling the live functions**. Each test case builds a local helper (`simulateCooldown`, `getStartDateForMath`, `simulateActionTenure`) that mirrors the relevant branch of `Profile.gs`/`Action.gs`, then asserts on the re-implemented copy. This is deliberate: it verifies the *intended* rule, not just that the production function returned something. The trade-off is that drift between the copy and the live code is possible — the suite is a logic cross-check, not an integration test.

The one exception is **Test Case 5 (Employer Match Tier)**, which calls the real `calculateMatchTier(years)` from `Utils.gs` directly. That function is pure (tier boundaries: `<5 → "3%"`, `<7 → "5%"`, `<10 → "7%"`, `>=10 → "10%"`) and has no GAS-bound dependencies, so it can be exercised by reference without a spreadsheet context.

The cases and the August 2026 rules they pin down:

| Case | Rule verified | Logic tested |
|------|---------------|--------------|
| 1 | Plan-change 6-month lock | Last action 5 months ago → locked; 7 months ago → unlocked. Next-eligible date = `lastActionDate + 6 months`. |
| 2 | 1st/2nd-withdrawal cooldown & 3rd permanent lockout | `simulateCooldown` returns `isCoolingDown` only for `withdrawalCount` 1 or 2 with a real `lastWithdrawalDate` and `today < lastWithdrawal + 6mo`. The 3rd withdrawal asserts `isCoolingDown === false` because the 3rd withdrawal is a **permanent lockout**, not a cooldown. |
| 3 | Tenure restart on re-enrollment (`Profile.gs`) | `getStartDateForMath(count, enrolledDate, hireDate)` returns the hire date when `count === 0`, and switches to the re-enrollment date once `count >= 1`. |
| 4 | Action-handler tenure reset | First enrollment computes tenure from hire date; re-enrollment (`wasFirstEnrollment === false`) resets tenure to 0. |
| 5 | Employer match tier | Direct call to `calculateMatchTier` at the boundary values 3, 5, 6.5, 7, 9.9, 10, 15. |

Because the tests run in-editor, they operate against `new Date()` ("today") in case 1's plan-change lock and case 2's cooldown, so the suite is date-relative rather than pinned to a fixed calendar day. Case 3 and 4 use fixed dates (`2020-01-01`, `2026-01-01`) for deterministic tenure math.

## 2. GA4 analytics harness — `Code/Analytics.gs::testTrackEvent`

The analytics module sends server-side GA4 Measurement Protocol hits (the app renders in a sandboxed `googleusercontent.com` iframe where third-party cookies break client-side `gtag.js`, so tracking is done server-side with a stable hashed `user_id`). Everything in the module is best-effort and **never throws** — analytics must not affect any user action. If `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` are unset, `trackEvent` is a silent no-op.

`testTrackEvent()` is the editor-run harness for this stack:

1. **Config presence** — logs whether each of `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `GA4_USER_ID_SALT` is set (the salt is optional). If the two required properties are missing it logs that `trackEvent()` is a no-op and returns early.
2. **Hashed user_id** — prints `currentUserHash_()`, the SHA-256 (`salt + email`) hex digest of the active editor user, so the operator can recognize themselves in GA4.
3. **Debug validation** — builds a sample `feature_action(test, success)` payload and POSTs it to the GA4 **`/debug/mp/collect`** endpoint. Unlike the live `/collect` endpoint (which is silent), the debug endpoint returns `validationMessages`, so the response body is logged verbatim to reveal payload/schema errors.
4. **Live send** — calls `trackFeatureAction("test", "success")`, which POSTs one real hit to `/mp/collect` that can be watched in GA4 Realtime.

A companion harness, `testDeviceTracking()`, unit-checks `parseDevice_` (the low-cardinality device-category/OS/browser bucketing of a forwarded `navigator.userAgent`) against seven representative UA strings, then sends one live `feature_action` tagged as an Android/Chrome/mobile device to confirm the `device_*` custom dimensions land in GA4.

## 3. Signed-letter harnesses — `Code/Letter.gs`

`generateLetter(type, ctx, sigDataUrl)` builds a bilingual confirmation letter: copies a Google Docs template, fills `{{placeholders}}`, fills the beneficiary list, inserts the decoded signature PNG (scaled to fit a 220×80 pt box, aspect preserved, never upscaled), exports to PDF, archives it in Drive under an `Enrollment`/`Beneficiary` subfolder, trashes the intermediate Doc, and returns `{fileId, fileUrl, fileName}`. Unlike Analytics, this module **is allowed to throw** — the calling action handler wraps it in try/catch so a letter failure is logged but never blocks the action.

Two editor-run harnesses exercise the end-to-end PDF pipeline with hardcoded `ctx` and a tiny 200×80 sample signature PNG (base64 data URL):

- **`testGenerateLetter()`** — generates an **ENROLLMENT** letter, requiring `PF_ENROLLMENT_TEMPLATE_ID` (and optionally `PF_BENEFICIARY_TEMPLATE_ID`, `PF_LETTERS_FOLDER_ID`) to be set in Script Properties. The sample `ctx` carries `effectiveMonth` (`"มิถุนายน 2026 / June 2026"`) and five beneficiaries with Thai/English addresses. Logs the resulting PDF name and URL.
- **`testGenerateBeneficiaryLetter()`** — generates a **BENEFICIARY** letter (the page-2-only template), reusing the same sample beneficiaries and signature but with a precise `effectiveDate` ("06 Jun 2026") instead of a payroll month, since beneficiary letters have no cut-off.

These harnesses exist to let the PDF be eyeballed before the real action handlers are wired; they return the metadata object so the URL can be opened directly.

## 4. Migration workbook structural check — `Data/verify.py`

This is the only piece of validation that runs **outside the GAS runtime**, via `python Data/verify.py` against `Data/Migration_Build.xlsx` (loaded with `data_only=True`). It is a structural sanity check, not a policy test — it uses `openpyxl` to inspect sheets and print diagnostics. It performs:

- **Sheet/structure** — prints sheet names, the `Enrollments` headers, and the `Enrollments` data row count (`max_row - 1`).
- **dtype spot-check** — prints `(type, value)` for the first 3 enrolled rows so date/number cells can be eyeballed.
- **The flagged six** — scans `_Enrollments_Build` for rows where `_State` is set, `Withdrawal_Count >= 1`, and `Last_Withdrawal_Date` is `None`, printing the staff's state/bank-membership/count-events/confidence/flags and the total. These are the count≥1-no-date rows that the migration must reconcile.
- **Discrepancy summary** — tallies `_Discrepancy_Log` by `_Issue` using a `Counter`.
- **State-5 (re-enrolled) sanity** — prints up to five state-5 rows to confirm `First_Enrolled_Date < Current_Enrolled_Date` and that the withdrawal date precedes the current enrollment. It then asserts two invariants: state-5/10 rows where `Last_Withdrawal_Date >= Current_Enrolled_Date` (invalid re-enroll) should be **0**, and enrolled re-enrollees whose `Last_Withdrawal_Date` is <6 months before a fixed `TODAY = 2026-06-29` (`CD = 183 days`) — which would wrongly display as Cooldown — are counted as `cdbad`.

This script is the offline guard for the migration data lineage, complementing the in-app policy suite.

## 5. Documentation refresh — OpenWiki GitHub Actions workflow

Distinct from app testing, `.github/workflows/openwiki-update.yml` keeps the wiki itself current. It triggers on `workflow_dispatch` and a daily schedule (`cron: "0 8 * * *"`), checks out the repo with full history (`fetch-depth: 0` so `openwiki code --update` can diff `HEAD` against the commit it last documented), installs `openwiki@0.4.3` plus `mermaid`/`jsdom` for diagram validation, and runs `openwiki code --update --print` against an OpenRouter model. The run is traced to LangSmith when its key is present. It then opens a `docs: update OpenWiki` pull request scoped to `openwiki`, `AGENTS.md`, `CLAUDE.md`, and the workflow file itself. This refreshes documentation; it does **not** test or deploy the GAS app.

## Relationship to other pages

The policy rules these harnesses verify are the business rules documented in [Business Rules](../concepts/business-rules.md); the migration workbook that `verify.py` audits is described in [Data Migration](../operations/data-migration.md); the Script Properties the harnesses depend on (`PF_*` letter IDs, `GA4_*` analytics config) are configured per [Deployment Config](../operations/deployment-config.md); and the signed-letter pipeline that the Letter harnesses exercise is part of the [Confirmation Pipeline](../workflows/confirmation-pipeline.md).
