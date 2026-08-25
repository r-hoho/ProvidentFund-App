# Provident Fund App — Project Showcase & Context

> A portable summary of what this project is, how it's built, and what was accomplished.
> Written 2026-07-01 at v0.2.0 (first public BETA shipped). Intended as (a) a personal
> showcase and (b) a context primer to hand to a future AI session so it understands the
> project without re-deriving everything.

---

## 1. TL;DR

A **mobile-first, bilingual (Thai/English) self-service web app** that lets ~10,000 internal
employees manage their company Provident Fund (กองทุนสำรองเลี้ยงชีพ): check status, enroll,
change contribution %, manage beneficiaries, change investment plan, and withdraw — with all
the real-world business rules (vesting, cooldowns, payroll cut-offs, match tiers) enforced.

Built entirely on **Google Apps Script + Google Sheets** (zero external infrastructure, zero
hosting cost), it ships confirmation **emails**, **signed PDF letters** with in-app captured
digital signatures, **GA4 analytics**, and a **feedback** loop. A separate Python sub-project
reconstructed every active member's enrollment state from 7 messy source systems into a clean,
import-ready dataset.

- **~4,100 lines** of application code (≈2,270 GAS backend + ≈1,800 HTML/JS/CSS frontend)
- **~925 lines** of Python (data-migration tooling)
- **61 commits** over ~3 months (Apr 4 → Jul 1, 2026)
- Solo build, live and versioned (v0.1.0 → v0.2.0, git-tagged, `CHANGELOG.md`)

---

## 2. The Product

| | |
|---|---|
| **Users** | ~10,000 internal employees (Thai company) |
| **Primary device** | Mobile — **99% of usage**; the UI is designed phone-first |
| **Language** | Fully bilingual, Thai-primary / English-secondary, shown simultaneously (no toggle) |
| **Core jobs** | View PF status · Enroll · Change contribution % · Manage beneficiaries · Change investment plan · Withdraw |
| **Real scale** | Migration spine = **6,012 active staff**; observed peak concurrency of 8 users, avg 1.18 — deliberately low-concurrency, which shaped the architecture choices |

**Why it exists:** replace a manual/legacy process for provident-fund actions with a
self-service app that enforces the fund's rules correctly and produces the paperwork
(signed letters, confirmation emails) the bank and payroll require.

---

## 3. Architecture & Tech Stack

**A deliberately "boring", zero-infrastructure stack** — chosen because the app is
low-concurrency, internal, and needs tight Google Workspace integration (identity, Sheets,
Drive, Docs, Gmail) with no ops burden.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (mobile-first SPA)                                  │
│  Vanilla JS + Pico.css v2 (CDN, classless semantic UI)       │
│  Full-screen wizard overlays + native <dialog> modals        │
└───────────────┬─────────────────────────────────────────────┘
                │  google.script.run  (no REST/fetch — GAS bridge)
┌───────────────▼─────────────────────────────────────────────┐
│  Google Apps Script backend (Code/*.gs)                      │
│  doGet() → HtmlService template → include() partials         │
│  Profile / Action / Withdraw / Email / Letter / Analytics…   │
└───────────────┬─────────────────────────────────────────────┘
                │  SpreadsheetApp / DriveApp / DocumentApp / MailApp / UrlFetchApp
┌───────────────▼─────────────────────────────────────────────┐
│  Google Sheets (DB) · Drive (letter archive) · Docs (tmpl)   │
│  Gmail (confirmations) · GA4 Measurement Protocol (metrics)  │
└─────────────────────────────────────────────────────────────┘
```

- **Frontend:** Single-page app served by `HtmlService.createTemplateFromFile('Index').evaluate()`.
  `Index.html` composes partials via `<?!= include('filename') ?>` scriptlets. **Pico.css v2**
  gives a semantic, near-classless mobile UI; multi-step flows use custom `position:fixed`
  overlays, simple modals use native `<dialog>`.
- **Backend:** GAS `.gs` files, split by responsibility (see repo map). No toolchain, no `clasp` —
  code is synced into the GAS editor by hand and deployed as a Web App.
- **Frontend↔Backend:** only `google.script.run.withSuccessHandler().withFailureHandler()`.
  No fetch/REST exists in the platform.
- **Database:** Google Sheets, bound script (`SpreadsheetApp.getActiveSpreadsheet()`).
  Column access via `headers.indexOf('ColumnName')` — header *names* matter, order doesn't.
- **Identity:** `Session.getActiveUser().getEmail()` server-side; every write re-resolves
  email → `Allstars_ID` against the `Users` sheet.

---

## 4. What Was Delivered (shipped feature set)

Everything below is **live and verified** (v0.1.0 go-live), unless noted.

**Core self-service**
- **Dashboard** with strict priority-state evaluation: Permanent Lockout → Probation →
  Withdrawal Cooldown → Enrolled → Not Enrolled. Shows contribution %, employer-match tier,
  member-since date + tenure.
- **5-step enrollment wizard** (full-screen): contribution % → investment plan → beneficiaries
  → summary → **signature capture**.
- **Beneficiary manager** (4 views: current / edit / history / sign) over an append-only ledger.
- **Withdrawal flow** with dual eligibility display (own contributions always vested; employer
  match gated by 5-year vesting) and penalty acknowledgement.
- **Contribution % change** with a 6-month lock (locked-variant modal when applicable).
- **Investment-plan info modal** — routes users to the bank's app (PVD Connext), which is the
  source of truth post-enrollment.
- **"In Progress" pending-transactions box** — shows submitted-but-not-yet-effective actions
  with a no-penalty Cancel that reverts sheet fields and appends a `CANCELLED` audit row.

**Compliance / paperwork**
- **Bilingual confirmation emails** on every audit event (submit / cancel) for all actions —
  styled responsive HTML tables, every value `escapeHtml`'d, Thai-first. Never block the action.
- **Signed PDF letters** for Enrollment & Beneficiary changes: Google Doc template → placeholder
  fill → embed the drawn signature (scaled to fit, aspect preserved) → PDF → email attachment →
  Drive archive. Letter failure never blocks the action and raises an **admin alert email** (CC user).
- **Digital signatures** via a shared `signature_pad` helper (hi-DPI, dark-blue ink, auto-trimmed
  to the ink bounding box on export).

**Insight / feedback**
- **GA4 server-side analytics** (Measurement Protocol via `UrlFetchApp`) — `app_open` +
  per-action `feature_action(success|fail)`, with low-cardinality device dimensions and a
  **SHA-256-hashed pseudonymous `user_id`** (PDPA-aligned). Chosen over client-side `gtag.js`
  precisely because the GAS iframe blocks third-party cookies (see §5).
- **Post-action star feedback** (1–5 + optional comment) written to `App_Feedback`.

**Data**
- **Full data migration** of active members from a 7-source master workbook into the live sheets.

---

## 5. Notable Engineering Decisions (the interesting parts)

These are the choices worth showcasing — where a real constraint forced a non-obvious solution.

1. **Server-side GA4 to beat the iframe cookie problem.** GAS web apps render in a sandboxed
   `googleusercontent.com` iframe where GA's third-party cookies are usually blocked, so
   client-side `gtag.js` can't reliably count users/returning-visitors. The app instead POSTs
   to the GA4 **Measurement Protocol** from `.gs`, where it *knows* the user server-side and can
   set a stable hashed `user_id` — making returning-vs-new work despite the iframe.

2. **Device analytics that the protocol can't infer.** MP hits go out via `UrlFetchApp` from
   Google's IP/UA, so native GA4 device detection is useless. The app parses `navigator.userAgent`
   (already threaded through for the audit log) into low-cardinality `device_category/os/browser`
   params — never raw UA — as the only real device signal.

3. **Signature capture → embedded PDF, entirely in Google Workspace.** A canvas signature is
   trimmed to its ink bounding box client-side, passed as a data URL, decoded server-side, and
   embedded into a Google Doc template scaled to fit a fixed box (aspect preserved), then exported
   to PDF and archived — no third-party e-sign service.

4. **Append-only ledgers over mutable rows.** `Beneficiaries` and `Audit_Log` are append-only;
   the newest matching row is "active," and the full set is the user-visible history timeline.
   Cancel is modeled as a new `CANCELLED` event carrying a JSON snapshot to revert from, not a
   destructive edit — clean audit trail, natural undo.

5. **A transient UI-only field that never touches the data model.** The bank later required a
   name **title prefix** (นาย/นาง/…). Rather than migrate the stored `{name, rel, pct, address}`
   model, the prefix is a dropdown merged into `name` at submit (`mergePrefixes`) and re-split
   when editing (`splitPrefix`) — so nothing downstream changed.

6. **"Fail-open" side effects.** Emails and letters are best-effort and can *never* roll back or
   block the core action; the handler still returns success and stamps `emailSent`/`emailError`
   into the audit row afterward. A missing PDF is itself the user's signal, plus an admin alert.

7. **Effective-date reframing.** Users misread a month-end date as a money-movement day, so the
   copy was reframed to a payroll *month* ("First applies to payroll for June 2026"), with the
   meaning flipped for withdrawals ("final contribution month") using the same 15th-cut-off math.

---

## 6. The Business-Rules Engine (domain complexity)

The real substance of the app is correctly enforcing fund rules:

- **Payroll cut-off (15th rule):** submitted ≤15th → effective end of this month; ≥16th → end of
  next month. Applies to enrollment, % change, and withdrawal — **not** investment plan or beneficiaries.
- **Membership start:** first enrollment → `Hire_Date`; re-enrollment after a withdrawal → new
  `Current_Enrolled_Date`. Drives tenure, match tier, and vesting.
- **Employer match tiers:** <5y → 3% · 5–7 → 5% · 7–10 → 7% · ≥10 → 10%.
- **5-year vesting:** employer match only paid out on withdrawal if tenure ≥ 5y.
- **Plan-change lock:** contribution % changeable once per 6 months, from
  `max(Current_Enrolled_Date, Last_Plan_Change_Date)`.
- **Withdrawal lifecycle:** up to 3 enrollments; 1st & 2nd withdrawals each trigger a 6-month
  re-enroll cooldown; 3rd withdrawal = permanent lockout. (Encoded as a **10-state model** in
  `MIGRATION.md`.)
- **Probation block:** future `Probation_End` → cannot enroll.
- **Beneficiaries:** max 5, each pct ≥ 1, must sum to exactly 100; prefix + name + rel + address
  all required.

> Note (policy versioning): `main` currently runs the **OLD** policy (1-year cooldown, 2nd
> withdrawal is the max). A `new-policy` branch holds the **NEW** policy (6-month, 3rd allowed),
> scheduled to switch in **Aug 2026** via `git revert` — a material rules change that will be its
> own changelog entry / version bump.

---

## 7. The Data-Migration Sub-Project (Python)

A standalone effort to reconstruct each active employee's enrollment state and emit an
import-ready dataset — a good showcase of messy-data reconciliation.

- **Input:** one master workbook, **7 source sheets** from different systems (WorkingDB payroll,
  bank active-members, bank withdrawal report, two HRIS snapshots, an old registration form).
- **Hard problem — join keys don't line up:** the bank's active list joins on numeric `Staff_ID`
  but its withdrawal report joins on a messy `TAA`-style `PF_MemberID` (mixed spacing/case).
  Normalizing (strip spaces + uppercase) and bridging through `WorkingDB` lifted withdrawal
  matches from **~244 to ~1,230**.
- **Locked precedence rules** with the data owner: payroll is primary for enrolled-status + rate;
  bank's "1st/2nd membership" sets `Withdrawal_Count`; "Transfer within Group" is explicitly *not*
  a withdrawal; HRIS provides start dates; old-form timestamps are cross-check/fallback.
- **Output:** a 5-sheet workbook — clean import-ready `Enrollments`, plus provenance sheets with
  a **per-field `_why` justification column**, a per-state confidence rating, and a long-format
  discrepancy log — so every value is traceable and the file self-documents.
- **Tooling:** `openpyxl` in a venv (no pandas locally due to PEP-668). Source workbook is
  gitignored (employee PII, never committed). Build emits a timestamped `Migration_Build_*.xlsx`.

---

## 8. Constraints Navigated (the GAS reality)

Working within Apps Script imposed real limits that shaped the whole build:

- **No local toolchain / no automated tests.** Edit → paste into the GAS editor → deploy Web App
  → test in the browser. Verification is manual and live; harness functions (`testTrackEvent`,
  `testGenerateLetter`) are run from the editor.
- **No REST.** All client↔server traffic is `google.script.run` with success/failure handlers.
- **`doGet(e)` can't see the browser.** No request headers/UA server-side → `app_open` fires
  **client-side** on `DOMContentLoaded` so it can carry device data; device is threaded into
  action calls the same way.
- **Templating gotcha:** the entry point *must* use `createTemplateFromFile().evaluate()` —
  `createHtmlOutputFromFile` silently fails to render `include()` scriptlets.
- **Secrets in Script Properties,** not source (letter template/folder IDs, GA4 measurement ID +
  API secret + hash salt), read via small config helpers.
- **Config kept in sync by hand** where it must live in two places (e.g. the `REL_LABELS`
  relationship map mirrored in `Config.gs` and `JS_Utils.html`).

---

## 9. Repo Map

**Backend (`Code/` — server-side GAS)**
| File | Lines | Responsibility |
|------|------:|----------------|
| `Main.gs` | 22 | `doGet()` entry + `include()` helper |
| `Config.gs` | 23 | Sheet-name constants + `REL_LABELS` |
| `Profile.gs` | 253 | `getUserProfile()` (eligibility/tenure/tier), `getPendingTransactions()` |
| `Action.gs` | 660 | enroll / change-plan / update-beneficiaries / cancel + eligibility checks |
| `Withdraw.gs` | 106 | `processWithdrawal` |
| `Email.gs` | 367 | bilingual HTML confirmation emails (never throws) |
| `Letter.gs` | 298 | Google Doc → signed PDF → Drive archive |
| `Analytics.gs` | 260 | GA4 Measurement Protocol (best-effort) |
| `Utils.gs` | 225 | match tiers, effective-date/month, audit helpers |
| `Feedback.gs` | 58 | star-rating capture |

**Frontend (`html/` — included partials)**
| File | Lines | Responsibility |
|------|------:|----------------|
| `JS.html` | 555 | dashboard logic + enrollment wizard + change-plan |
| `Modals.html` | 319 | wizard / change-plan / beneficiary markup |
| `JS_Beneficiary.html` | 224 | beneficiary manager (4 views) |
| `CSS.html` | 168 | custom styles over Pico.css |
| `Index.html` | 162 | shell + includes |
| `JS_Signature.html` | 118 | shared signature-pad helper |
| `JS_Withdraw.html` / `JS_Utils.html` / `JS_Feedback.html` / `Modals_Withdraw.html` | 49–73 | withdrawal flow, shared helpers, feedback modal |

**Data (`Data/` — Python migration, gitignored inputs)**: `build.py` (647) + `stack_update.py`,
`verify.py`, `inspect_one.py`, `check_lpc.py`.

**Docs**: `App Design Document…md` (rationale/scale), `MIGRATION.md` (hand-migration + 10-state
model + automated-build plan), `CLAUDE.md` (working notes), `CHANGELOG.md`, `TODO.md`,
two `Proposal - …md` design docs.

**Sheets (DB)**: `Users` · `Enrollments` · `Beneficiaries` (ledger) · `Audit_Log` (ledger) ·
`App_Feedback` · `Monthly_Reporting` (reserved).

---

## 10. Status & Roadmap

**Status (2026-07-01):** Shipped and live. v0.1.0 (full go-live) and v0.2.0 (BETA badge, changelog,
beneficiary empty-state fix) are committed, pushed, and git-tagged. `CHANGELOG.md` is in place.
The project is intentionally in a **feedback-hold** — no new features until real user feedback.

**Known deferred items** (in `TODO.md`):
- Run the 7 core business-rule test cases against migrated data, live.
- Fix stale `TODO.md` test-case lines that describe the NEW policy while `main` runs OLD.
- Aug 2026 OLD→NEW policy switch (own version bump, likely v0.3).
- Post-launch enhancements: Help/FAQ, issue-report FAB, in-house `System_Log`, GA4 device/department
  segmentation, user-downloadable summary, HR read-only view, state-transition notification emails.

**Production-readiness notes** (from the design doc — low real-world risk given ≤8 peak concurrency,
but worth knowing): `LockService` is not yet wrapping write paths; most server-side rule re-checks
rely on the client as the gate (change-plan re-validates its 6-month lock server-side); effective
date is computed client-side and not persisted.

---

## 11. One-Paragraph Version (for pasting into a new chat)

> Provident Fund App: a mobile-first, bilingual (Thai/English) Google Apps Script + Google Sheets
> web app for ~10,000 employees to manage their company provident fund — enroll, change contribution
> %, manage beneficiaries, change investment plan, withdraw — enforcing real fund rules (5-year
> vesting, 6-month plan-change lock, withdrawal cooldowns/lockout, 15th payroll cut-off, tenure-based
> employer-match tiers). It generates bilingual confirmation emails and signed PDF letters (in-app
> signature capture embedded into Google Doc templates, archived in Drive), tracks adoption via
> server-side GA4 (Measurement Protocol, hashed pseudonymous user_id — chosen because the GAS iframe
> blocks client-side analytics cookies), and captures post-action star feedback. A Python sub-project
> reconciled 7 messy source systems (payroll, bank, HRIS) into a clean, fully-provenanced,
> import-ready enrollment dataset. No toolchain/clasp — code is hand-synced into the GAS editor and
> deployed as a Web App. Live at v0.2.0, git-tagged, currently in a feedback-hold.
