# Changelog

All notable changes to the Internal Provident Fund Enrollment app are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While in BETA the app stays in the `0.x` range; it graduates to `1.0.0` when stable
and the BETA badge is dropped.

## [1.0.0] - 2026-08-01

### Added
- Created a programmatical test harness (`Code/TestCases.gs`) containing 5 comprehensive mock-data tests to verify withdrawal cooldowns, permanent lockout counts, membership tenure math, and plan-change lock periods in the Apps Script editor.

### Changed
- Transitioned the app from BETA to **v1.0.0 Production Stable**:
  - Dropped the client-facing `BETA` badge from the header of `html/Index.html`.
  - Bumped client-facing version string in `html/Index.html` to `v1.0.0`.
- Implemented the official **August 2026 Policy Switch**:
  - Reduced the withdrawal cooldown duration from 12 months to **6 months** (applied after 1st and 2nd withdrawals).
  - Raised the permanent lockout limit to **3 withdrawals** (allowing up to a 3rd enrollment cycle).
  - Reduced the contribution plan-change lock duration from 1 year to **6 months**.
  - Reset membership tenure calculations correctly to `0` upon any re-enrollment cycle, fully resolving the 8th business-rule test case.
- Updated bilingual modals, warning messages, cancellation banners, and status pill displays across `html/JS.html`, `html/Modals.html`, and `html/Modals_Withdraw.html` to reflect the new 6-month locks and 3-withdrawal limits.

## [0.2.2-beta] - 2026-08-01

### Added
- Created a beautiful, responsive, and light-themed corporate Maintenance Page (`html/Maintenance.html`) featuring corporate red highlights and bilingual support details.
- Integrated a compact warning banner (`MAINTENANCE_MODE (Non-admin bypass active)`) visible at the top of the dashboard only to administrators when maintenance mode is active.

### Changed
- Configured dynamic, real-time maintenance checks in `doGet()` inside `Code/Main.gs` powered by the `MAINTENANCE_MODE` Google Apps Script property.
- Added secure Admin Bypass logic (`ADMIN_EMAILS` defined in `Code/Config.gs`) to permit administrators to test on development branches (`/dev`) and access the app during periods of downtime.
- Bumped client-facing version string in `html/Index.html` to `v0.2.2-beta`.

## [0.2.1-beta] - 2026-08-01

### Added
- Configured native `clasp` integration in the project root directory via `.clasp.json` and `.claspignore`.
- Brought the Apps Script manifest (`appsscript.json`) under source control.

### Changed
- Migrated Google Apps Script structure to follow the local organized folder structure (`Code/` for backend, `html/` for frontend) to enable seamless command-line sync.
- Updated template loading in `Main.gs` and includes in `Index.html` to support the folder-based namespaces (e.g. `'html/Index'`, `'html/CSS'`).
- Bumped client-facing version string in `html/Index.html` to `v0.2.1-beta` for easier tracking in production preview.

## [0.2.0] - 2026-07-01

### Added
- **BETA badge** on the header title and a `v0.2` version string in the subtitle,
  so users can see the app is pre-release and which build they're on.
- Beneficiary manager now opens for enrolled/migrated users who have **no
  beneficiary record yet** — showing an empty state ("No beneficiaries yet — tap
  Update to add") and a pre-seeded blank row in the edit view, instead of the
  button being a dead tap.

### Changed
- `openManageBen()` guards only on a missing profile, not on a blank
  beneficiary list.

## [0.1.0] - 2026-07-01

First public (BETA) release — the complete self-service provident fund tool.

### Added
- **Dashboard** with live eligibility, membership start date, service length
  (tenure), and employer match tier (3/5/7/10% by years of service).
- **Enrollment wizard** — 5-step full-screen flow ending in a drawn signature,
  with payroll cut-off handling (submitted ≤15th → end of this month; ≥16th →
  end of next month).
- **Beneficiary manager** — 4-view flow (current / edit / history / sign):
  append-only ledger, max 5 beneficiaries, each ≥1% and summing to exactly 100%,
  required title prefix + name + relationship + address, and a "Same as Above"
  address copy.
- **Withdrawal flow** with 5-year vesting check (employer match paid out only at
  `tenure ≥ 5y`), self-portion vs. company-portion display, and withdrawal
  limits (1st/2nd trigger a 6-month re-enroll cooldown; 3rd is permanent lockout).
- **Plan (contribution %) change** — changeable once per 6 months, with the lock
  date surfaced in the modal.
- **In-progress box** — shows submitted requests and allows cancelling/reverting
  cancellable actions (Enroll / Change Plan / Withdraw).
- **Bilingual confirmation emails** (Thai-first) — styled responsive HTML, sent
  after every action; failure never blocks or rolls back the action.
- **PDF letter generation** — Google Doc template → PDF for enrollment and
  beneficiary changes, with the drawn signature embedded and archived in Drive.
- **Digital signatures** — shared signature-pad helper (hi-DPI, ink-trimmed
  export) used by enrollment step 5 and the beneficiary sign view.
- **GA4 server-side analytics** (Measurement Protocol) — app-open and
  per-action success/fail metrics with low-cardinality device dimensions and a
  SHA-256-hashed pseudonymous `user_id` (PDPA-aligned).
- **Post-action feedback** — 1-5 star rating + optional comment written to the
  `App_Feedback` sheet.
- **Effective-date banner** and Thai relationship labels throughout.
- **Data migration** of existing members from the master workbook into the
  `Enrollments` sheet.

### Notes
- Active policy on this release: **1-year** re-enroll cooldown, **2nd withdrawal
  is the maximum** (the OLD policy). The NEW 6-month / 3rd-withdrawal policy lives
  on a separate branch, scheduled to switch in Aug 2026.

[0.2.0]: https://github.com/r-hoho/ProvidentFund-App/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/r-hoho/ProvidentFund-App/releases/tag/v0.1.0
