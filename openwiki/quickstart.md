---
type: "Reference"
title: "Quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-27T08:53:10.517Z
sources:
  - id: openwiki-source-2d0286b97bb40af726f5cb49
    resource: repo://appsscript.json
  - id: openwiki-source-a2371d6362e5db4bc834ad03
    resource: repo://CLAUDE.md
  - id: openwiki-source-c7bfaaf4ee9e3e78d074addf
    resource: repo://Code/Action.gs
  - id: openwiki-source-95688f6a8ac3c427126ce925
    resource: repo://Code/Config.gs
  - id: openwiki-source-117498b4e7e28f80ffc3bda9
    resource: repo://Code/Email.gs
  - id: openwiki-source-3af8c1623658ce56873751e7
    resource: repo://Code/Main.gs
  - id: openwiki-source-07de7be57227e3320e78ace3
    resource: repo://Code/Withdraw.gs
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "openwiki/0.4.3", at: "2026-08-27T08:53:10.517Z" }
---


# Quickstart

This is the entry point for a coding agent working on the Provident Fund app. Read this first, then follow the routing below to the page that owns your task.

## What this system is

A mobile-first, bilingual (Thai/English) self-service web app that lets employees enroll in and manage a company Provident Fund — check status, enroll, adjust contributions, manage beneficiaries, and process withdrawals — and produce the signed PDF letters and confirmation emails the process requires. It runs on **zero external infrastructure**: Google Workspace handles identity, data, documents, email, and analytics. It is a stable production release (`v1.1.0`).

The platform is a **Google Apps Script (GAS) web app** bound to a Google Spreadsheet, deployed via `clasp`. The manifest (`appsscript.json`) pins the V8 runtime, `Asia/Bangkok` timezone, `USER_DEPLOYING` execution, `DOMAIN` access, and Stackdriver exception logging. Source lives in `Code/*.gs` (server-side, one global namespace) and `html/*.html` (templated client partials composed by Apps Script scriptlets).

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart LR
  Browser["Browser SPA<br/>html/*.html + Pico.css v2"] -->|google.script.run| GAS["GAS Backend<br/>Code/*.gs"]
  GAS -->|HtmlService.evaluate + include| Browser
  GAS --> Sheets["Google Sheets<br/>system of record"]
  GAS --> Drive["Google Drive<br/>PDF letter archive"]
  GAS --> Docs["Google Docs<br/>letter templates"]
  GAS --> Gmail["Gmail<br/>confirmation emails"]
  GAS --> GA4["GA4 Measurement Protocol<br/>adoption metrics"]
```

*Figure: the three runtime domains. The browser reaches the backend only through the `google.script.run` bridge (no fetch, no REST, no URL). The backend is the only party that touches Sheets, Drive, Docs, Gmail, and GA4.*

## The backend / frontend / data split

- **Frontend (`html/`)** — a vanilla JavaScript single-page app (no build step, no framework) styled with Pico.css v2 from a CDN. `Index.html` is the shell and composes partials (`CSS`, `Modals`, `JS`, `JS_Beneficiary`, `JS_Withdraw`, `JS_Feedback`, `JS_Utils`, `JS_Signature`) via `<?!= include('filename') ?>` scriptlets. It must be rendered with `HtmlService.createTemplateFromFile(...).evaluate()` — `createHtmlOutputFromFile` silently fails to expand includes. Multi-step flows use a custom `position:fixed` `wizard-overlay`; simple modals use native `<dialog>`.
- **Backend (`Code/*.gs`)** — the GAS web app. All client↔server calls go through exactly one mechanism: `google.script.run.withSuccessHandler(fn).withFailureHandler(fn).serverFunction(args)` — the backend is addressed by **function name**, never by URL. Files are split by responsibility: `Main.gs` (entry, templating, maintenance mode), `Config.gs` (constants, `REL_LABELS`), `Profile.gs` (read path + eligibility), `Action.gs` and `Withdraw.gs` (write handlers + cancel), `Email.gs`, `Letter.gs`, `Analytics.gs`, `Feedback.gs`, `Utils.gs`, `TestCases.gs`.
- **Data** — Google Sheets is the system of record. `SPREADSHEET_ID` is resolved from the bound spreadsheet via `SpreadsheetApp.getActiveSpreadsheet()`. Six sheets: `Users` (employee master), `Enrollments` (one row/employee), `Beneficiaries` (append-only JSON ledger), `Audit_Log` (append-only audit trail), `App_Feedback` (ratings), `Monthly_Reporting` (declared, not yet used). Column access is positional via `headers.indexOf('ColumnName')`, so **column order matters**.

## The one rule that dominates every change

> **Email, letter, and analytics calls are best-effort. They must NEVER block or roll back a user action.** Once an action handler's sheet writes succeed, the handler returns `{ success: true }` regardless of any side-effect failure.

Every write handler (`processEnrollment`, `processChangePlan`, `processUpdateBeneficiaries`, `processWithdrawal`, `cancelTransaction`) follows the same spine:

1. Resolve identity server-side (`Session.getActiveUser().getEmail()`) and look up the user.
2. Generate a transaction id up front so it threads through audit, letter, email, and later patching.
3. Write the business state to Sheets (upsert `Enrollments`, append the `Beneficiaries` ledger, append an `Audit_Log` row).
4. **Best-effort side effects**: `generateLetter` (wrapped in try/catch — it may throw) → `sendActionConfirmation` (never throws) → `patchAuditEventData` (stamp `emailSent`/`emailError`/`letterFileId`/`letterError`) → `trackFeatureAction` (GA4, never throws). A letter failure triggers a best-effort admin alert, still without affecting the result.
5. Return `{ success: true }`.

If you change any write handler, any side-effect code, or anything that touches the post-commit pipeline, you must preserve this invariant. Side-effect code is best-effort by design; the audit patch happens last precisely so it cannot roll back the action. See [Confirmation Pipeline](/openwiki/workflows/confirmation-pipeline.md) for the full sequence and the letter-failure admin alert.

## Where to go for your task

| If you are… | Go to |
|---|---|
| Changing business logic (payroll cut-off, match tiers, plan-change lock, withdrawal cooldowns, vesting, probation, beneficiary validation) | [Business Rules & Invariants](/openwiki/concepts/business-rules.md) and the relevant [workflow page](#write-workflows) below |
| Changing the data layer (sheets, columns, the JSON beneficiary model, header-name coupling, append-only ledger discipline) | [Data Model & Google Sheets Schema](/openwiki/concepts/data-model.md) |
| Deploying or configuring (clasp, `.claspignore`, Script Properties, maintenance mode, the GitHub Actions OpenWiki workflow) | [Deployment, Configuration & Operations](/openwiki/operations/deployment-config.md) |
| Testing (there is no CI test runner for the app — see editor-run harnesses and `Data/verify.py`) | [Test Harnesses & Editor-Run Validation](/openwiki/testing/test-harnesses.md) |

### Architecture & platform

- [System Overview](/openwiki/architecture/system-overview.md) — the hub: runtime domains, the `google.script.run` bridge, the full module map, identity, configuration, and the action-handler contract. Start here for any architecture question.
- [Frontend Single-Page App](/openwiki/architecture/frontend-spa.md) — the `Index.html` shell and partials, the `DOMContentLoaded` bootstrap (`getUserProfile` + `checkPlanChangeEligibility` + `trackAppOpen`), the forced home-reload after each action, the `wizard-overlay` vs native `<dialog>` split, and the `PFSignature` wrapper.
- [Google Apps Script Platform & Gotchas](/openwiki/architecture/google-apps-script-platform.md) — the GAS constraints that trip up agents: `doGet` entry, `createTemplateFromFile + evaluate`, the `include()` scriptlet helper, `Session.getActiveUser().getEmail()` identity, bound-script `SPREADSHEET_ID`, `appsscript.json`, and Stackdriver logging.

### Concepts

- [Business Rules & Invariants](/openwiki/concepts/business-rules.md) — the non-negotiable domain rules: payroll cut-off (≤15th → end of this month, ≥16th → end of next month; applies to enrollment/contribution%/withdrawal, **not** investment plan or beneficiaries), employer match tiers by tenure, the 6-month plan-change lock, the 6-month withdrawal cooldown after the 1st/2nd withdrawal, the 3rd-withdrawal permanent lockout, 5-year vesting, the probation block, and beneficiary validation.
- [Data Model & Google Sheets Schema](/openwiki/concepts/data-model.md) — the six sheets, exact columns, the `Allstars_ID` join key, header-name coupling, the JSON-in-a-cell `Beneficiary_Data` pattern, append-only ledger discipline, and the current-vs-history beneficiary read.
- [Enrollment Lifecycle & User States](/openwiki/concepts/enrollment-lifecycle.md) — the 9 enrollment states plus the probation flag that drive the UI and eligibility, how `Withdrawal_Count` ticks, per-state field values, and how `getPendingTransactions`/`cancelTransaction` derive cancellability from the audit log.
- [Bilingual Thai-First Design](/openwiki/concepts/bilingual-i18n.md) — the Thai-first, English-second convention across the UI, emails, letters, and labels, the `REL_LABELS` mirror (`Config.gs` ↔ `JS_Utils.html`), and the keep-in-sync traps.

### Write workflows

- [Confirmation Pipeline: Email, Letters & Analytics](/openwiki/workflows/confirmation-pipeline.md) — the cross-cutting post-commit side-effect discipline, the audit-log patching mechanism, the letter-failure admin alert, GA4 server-side Measurement Protocol, and the cancellable-action cancel-line rule in emails. **Read this before touching any handler's tail.**
- [Enrollment Flow](/openwiki/workflows/enrollment-flow.md) — the 5-step enrollment wizard (client) and `processEnrollment` (server), signature capture, and the best-effort post-commit side effects.
- [Plan Change, Withdrawal & Cancel](/openwiki/workflows/plan-change-withdraw-cancel.md) — `processChangePlan`, `processWithdrawal`, `cancelTransaction`, the pending-transaction box, and the lock/cooldown math.
- [Beneficiary Flow](/openwiki/workflows/beneficiary-flow.md) — the 4 frontend views, the JSON model with title-prefix merge/split, validation, the signature capture, and `processUpdateBeneficiaries` (append-only ledger + best-effort letter/email, including the beneficiary-only page-2 template).
- [Profile Read & Eligibility Path](/openwiki/workflows/profile-and-eligibility.md) — `getUserProfile()`, the join across sheets, the bottom-up beneficiary read, pending transactions, eligibility computation, and how `populateUI` renders the dashboard.

### Operations

- [Deployment, Configuration & Operations](/openwiki/operations/deployment-config.md) — the `clasp` toolchain (`clasp.cmd push` on Windows PowerShell, push from the root only, never subfolders), `.claspignore`, the Script Properties config surface (`PF_*` template IDs + folder, `GA4_*` keys, `GA4_USER_ID_SALT`, `MAINTENANCE_MODE`, `ADMIN_EMAILS`), maintenance mode with admin bypass, and the GitHub Actions OpenWiki update workflow.
- [Data Migration Toolchain](/openwiki/operations/data-migration.md) — the Python toolchain in `Data/` that rebuilds the `Enrollments` sheet from `Master.xlsx` for hand-import (`build.py`, `verify.py`, etc.) and the `MIGRATION.md` golden rules. The `Data/` tree is gitignored and not deployed.
- [Test Harnesses & Editor-Run Validation](/openwiki/testing/test-harnesses.md) — `TestCases.gs` editor-run policy suite, the `Analytics`/`Letter` test harnesses, and `Data/verify.py`.

## Before you start coding

- There is **no build step** and **no CI test runner** for the app. Validation is editor-run test harnesses (`TestCases.gs`, `testTrackEvent`, `testGenerateLetter`) plus `Data/verify.py` for migration workbooks.
- Never send identity from the client. It is always inferred server-side from `Session.getActiveUser().getEmail()`.
- Never change column order in a sheet without updating every `headers.indexOf('ColumnName')` that reads it.
- Keep the `REL_LABELS` maps in `Config.gs` and `JS_Utils.html` in sync — they are mirrors.
- Push with `clasp.cmd push` from the repo root only.
