---
type: operations
title: Deployment, Configuration & Operations
description: How the Provident Fund web app ships to Google Apps Script via clasp, what the .claspignore syncs, the Script Properties config surface, the maintenance-mode switch, and the GitHub Actions OpenWiki update workflow.
tags: [deployment, configuration, operations, clasp, google-apps-script, maintenance-mode, github-actions]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-27T08:53:10.517Z
sources:
  - id: openwiki-source-8c8af57734b72b2529c9eebd
    resource: repo://.claspignore
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-2d0286b97bb40af726f5cb49
    resource: repo://appsscript.json
  - id: openwiki-source-ca6cb4b1a14fd7969dfae3ec
    resource: repo://CHANGELOG.md
  - id: openwiki-source-a2371d6362e5db4bc834ad03
    resource: repo://CLAUDE.md
  - id: openwiki-source-c7bfaaf4ee9e3e78d074addf
    resource: repo://Code/Action.gs
  - id: openwiki-source-f4562d168afe0472674501cd
    resource: repo://Code/Analytics.gs
  - id: openwiki-source-95688f6a8ac3c427126ce925
    resource: repo://Code/Config.gs
  - id: openwiki-source-117498b4e7e28f80ffc3bda9
    resource: repo://Code/Email.gs
  - id: openwiki-source-3b1cba3f000133303a1612d7
    resource: repo://Code/Letter.gs
  - id: openwiki-source-3af8c1623658ce56873751e7
    resource: repo://Code/Main.gs
  - id: openwiki-source-18dc44edee07990ce806b4c2
    resource: repo://Code/Utils.gs
  - id: openwiki-source-12d6f9161fd01245753b4a09
    resource: repo://html/Index.html
generated: { by: "openwiki/0.4.3", at: "2026-08-27T08:53:10.517Z" }
---

# Deployment, Configuration & Operations

The Provident Fund app is a **container-bound Google Apps Script (GAS) project**. There is no build step and no server to host: source files are pushed from the repository into the GAS project's draft with the `clasp` toolchain, the `appsscript.json` manifest declares the runtime and web-app execution context, and all environment-specific values (template IDs, GA4 secrets, the maintenance-mode switch) live in **Script Properties** rather than in source. This page documents how that pipeline works, what is and isn't deployed, and how the app is configured and operated.

## Syncing source with clasp

### What clasp deploys

clasp syncs files between the local repository and the remote GAS project. The `.claspignore` file is an allowlist that **ignores everything by default and then re-permits a narrow set of files**:

```
# Ignore all files by default
**/*

# Permit only these files/directories
!appsscript.json
!Code/**/*.gs
!html/**/*.html
```

This means the deployment surface is exactly three things:

1. **`appsscript.json`** — the manifest (runtime, timezone, web-app access/execution mode).
2. **`Code/**/*.gs`** — every server-side `.gs` file (the backend).
3. **`html/**/*.html`** — every frontend HTML partial (included into the SPA shell via `<?!= include('filename') ?>`).

Everything else in the repo is **not** deployed to GAS. This deliberately excludes the `Data/` folder, the proposal and design documents (`*.md`), the Python tooling under `venv/`, the `openwiki/` documentation tree, and any other ancillary files. Data lives in the bound spreadsheet (not in the project), proposals and OpenWiki docs are repo-only artifacts, and the Python environment is local-only — none of these are part of the GAS project.

### How to push

The toolchain is configured natively in the repository root. To push local changes into the GAS project draft, run from the **root directory only**:

```
clasp.cmd push
```

Two operational rules are binding:

- **Use `clasp.cmd push` on Windows PowerShell.** On that shell, `clasp` is invoked through the `.cmd` shim, so `clasp.cmd push` is the correct command.
- **Never push from a subfolder.** The `.claspignore` paths and the `.clasp.json` project linkage are resolved relative to the repository root; running the push from a subdirectory would sync the wrong (or empty) file set. Always `cd` to the repo root first.

After a push, changes are in the GAS project's *draft*. A new deployment version must then be published from the Apps Script editor (Deploy → Manage deployments) for end users to see it — the push alone updates the draft, not necessarily the live deployment URL.

## The `appsscript.json` manifest

The manifest declares the execution environment for the whole project:

```json
{
  "timeZone": "Asia/Bangkok",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "DOMAIN"
  }
}
```

The key operational consequences:

- **V8 runtime** — modern JavaScript (`const`/`let`, template literals, arrow functions, destructuring) is available; the codebase relies on it.
- **`Asia/Bangkok` timezone** — all server-side date formatting defaults to Bangkok time, matching the payroll cut-off business rules.
- **`executeAs: USER_DEPLOYING`** — every server function runs as the identity of the *deploying* user, not the visiting end user. Identity is therefore inferred server-side via `Session.getActiveUser().getEmail()`; the client never sends credentials.
- **`access: DOMAIN`** — only authenticated users within the Google Workspace domain can open the web app. This is the access boundary; finer per-user gating (maintenance mode, user lookup) is enforced in code.
- **Stackdriver exception logging** — unhandled exceptions surface in the Apps Script editor's Stackdriver logs, the project's primary diagnostic channel.

## Configuration surface: Script Properties

Per-environment and secret values are **never stored in source**. They live in **Script Properties** (Apps Script editor → Project Settings ⚙ → Script Properties), a key-value store scoped to the project. Three modules read from it:

### Letter template IDs and folder

`Letter.gs` reads its configuration via `getLetterConfig_()`, which pulls three keys from `PropertiesService.getScriptProperties()`:

| Property | Required? | Purpose |
|----------|-----------|---------|
| `PF_ENROLLMENT_TEMPLATE_ID` | **Required** | Google Docs template for enrollment confirmation letters. If unset, `generateLetter` throws an explicit error. |
| `PF_BENEFICIARY_TEMPLATE_ID` | Optional | Page-2-only beneficiary template. If unset, falls back to the enrollment template ID. |
| `PF_LETTERS_FOLDER_ID` | Optional | Drive folder to archive generated PDFs. If unset, falls back to the template's own parent folder. |

If `PF_ENROLLMENT_TEMPLATE_ID` is missing, the letter step fails hard with a message pointing the operator to Project Settings → Script Properties. This is the only config key whose absence raises a fatal error; the others degrade gracefully (fallback template, fallback folder).

### GA4 analytics secrets

`Analytics.gs` reads three keys via `getAnalyticsConfig_()`:

| Property | Required? | Purpose |
|----------|-----------|---------|
| `GA4_MEASUREMENT_ID` | Required (to enable analytics) | GA4 stream Measurement ID (e.g. `G-XXXXXXXXXX`). |
| `GA4_API_SECRET` | Required (to enable analytics) | Measurement Protocol API secret. |
| `GA4_USER_ID_SALT` | Optional | Random string salting the SHA-256 `user_id` hash for PDPA pseudonymity. |

If `GA4_MEASUREMENT_ID` or `GA4_API_SECRET` is unset, `trackEvent` **silently no-ops** — analytics is simply off until configured, and the app runs fine without it. This mirrors the discipline that side-effect code (analytics, email, letters) must never affect user actions.

### Maintenance-mode switch

`MAINTENANCE_MODE` is the single property that gates app availability (see below).

### How to set these

All Script Properties are set under **Project Settings ⚙ → Script Properties** in the Apps Script editor — not in any committed source file. This keeps secrets and per-environment IDs out of version control and lets different deployments (test vs. production projects) point at different templates, folders, and GA4 streams without code changes.

## Maintenance mode

Maintenance mode is a runtime switch that takes the app offline for everyone except a hardcoded set of admins. It is evaluated on every page load inside `doGet()` in `Main.gs`:

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    A["doGet()"] --> B["Read MAINTENANCE_MODE from Script Properties"]
    B --> C{"=== 'true'?"}
    C -- no --> D["Render html/Index (normal app)"]
    C -- yes --> E["Get active user email (lowercased)"]
    E --> F{"In ADMIN_EMAILS?"}
    F -- no --> G["Render html/Maintenance<br/>(non-admins see maintenance page)"]
    F -- yes --> H["Set maintenanceActive = true<br/>Render html/Index (live app)"]
```

The behavior, step by step:

1. `doGet()` reads `MAINTENANCE_MODE` from `PropertiesService.getScriptProperties()`. Only the exact string `'true'` activates maintenance; unset, `'false'`, or any other value leaves the app live.
2. When active, it reads the current user's email via `Session.getActiveUser().getEmail()` and lowercases it.
3. It checks membership in `ADMIN_EMAILS` (a constant array in `Config.gs`).
4. **Non-admins** are served the `html/Maintenance` template — a standalone page (Pico.css, AirAsia-red maintenance card) that says the app is under maintenance. They never see the dashboard.
5. **Admins** bypass the gate: they see the normal `html/Index` app, but `doGet()` passes `maintenanceActive = true` into the template. `Index.html` renders this as a red **"MAINTENANCE MODE (Non-admin bypass active)"** warning banner at the top of the dashboard, so admins know they are viewing the app during a maintenance window while ordinary users are blocked.

Because the check runs in `doGet()` on every load and reads the live Script Property, toggling `MAINTENANCE_MODE` takes effect immediately on the next page load — there is no redeploy or cache to clear. This makes it a safe operational kill switch.

## The `ADMIN_EMAILS` set and admin alerting

`ADMIN_EMAILS` is a hardcoded constant array in `Config.gs`:

```js
const ADMIN_EMAILS = [
  'navananyeamsiri@airasia.com',
  'taa_pd_department@airasia.com'
];
```

These are AirAsia domain addresses. Two related operational alert paths also hardcode the same admin address:

- **`reportIssueToAdmin()`** (`Utils.gs`) — fired when a user logs in but is not found in the `Users` sheet. It emails the admin (`navananyeamsiri@airasia.com`, CCing the affected user) so the missing record can be investigated.
- **`sendLetterFailureAlert()`** (`Email.gs`) — fired from the enrollment and beneficiary handlers when the signed PDF letter fails to generate *after* the action itself succeeded. It emails the admin (CCing the user) a bilingual alert so the document can be re-issued manually. The letter/email failure never blocks or rolls back the action — the handler still returns `{ success: true }`; the alert is best-effort follow-up.

The operational rule for this set: **update the addresses, do not remove them.** These are the human recipients of "user-not-found" and "letter-generation-failed" alerts, plus the maintenance-bypass list. If the responsible admin changes, edit the addresses in all three places (`ADMIN_EMAILS` in `Config.gs`, `reportIssueToAdmin` in `Utils.gs`, `sendLetterFailureAlert` in `Email.gs`); they are intentionally not consolidated into a single source beyond the maintenance list, so all must be kept consistent.

## GitHub Actions: the OpenWiki update workflow

The repository's own documentation is kept in sync by an automated OpenWiki workflow at `.github/workflows/openwiki-update.yml`. It is independent of the GAS deployment — it updates the `openwiki/` docs (and the agent instruction files), not the app.

**Triggers:**

- `schedule: cron: "0 8 * * *"` — runs daily at 08:00 UTC.
- `workflow_dispatch:` — can be triggered manually from the Actions tab.

**Permissions:** `contents: write` and `pull-requests: write` (so the workflow can commit and open a PR).

**Job steps:**

1. **Check out** with `fetch-depth: 0` — a full clone, not shallow. OpenWiki's `code --update` diffs `HEAD` against the commit it last documented; a shallow clone hides that commit and would run against an empty change summary.
2. **Set up Node.js 22.**
3. **Install OpenWiki** globally: `openwiki@0.4.3` plus `mermaid@11.16.0` and `jsdom@29.1.1` (the latter two add high-fidelity Mermaid diagram validation; removable if the wiki has no diagrams).
4. **Run OpenWiki**: `openwiki code --update --print`, driven by environment variables:
   - `OPENWIKI_PROVIDER: openrouter` with `OPENROUTER_API_KEY` (the LLM provider).
   - `OPENWIKI_MODEL_ID: "deepseek/deepseek-v4-flash-0731"`.
   - `OPENWIKI_LANGSMITH_API_KEY` — authenticates the LangSmith connector's code-mode pull.
   - `LANGSMITH_API_KEY` / `LANGCHAIN_PROJECT` / `LANGCHAIN_TRACING_V2` — optionally trace this workflow's own OpenWiki run to LangSmith.
5. **Create a pull request** via `peter-evans/create-pull-request@v7`, committing only the paths under `add-paths`:
   ```
   openwiki
   AGENTS.md
   CLAUDE.md
   .github/workflows/openwiki-update.yml
   ```
   onto a branch named `openwiki/update`, with the commit message and title `docs: update OpenWiki`.

The workflow is pinned to specific action versions by commit SHA (`actions/checkout@34e1148...`, `actions/setup-node@49933ea...`, `peter-evans/create-pull-request@22a908...`) for supply-chain stability. Because the add-paths are scoped to the docs and agent files, the workflow never modifies the application source (`Code/`, `html/`, `appsscript.json`) — documentation updates are cleanly separated from code changes and arrive as a reviewable PR.

## Operational invariants

A few rules hold across the deployment and configuration system:

- **Secrets and per-environment IDs stay in Script Properties, never in source.** The only values that live in source are the `ADMIN_EMAILS` allowlist and the sheet-name constants in `Config.gs`; everything environment-specific is a Script Property.
- **Side-effect code degrades, never breaks.** GA4 analytics no-ops when unconfigured; email and letter failures never block or roll back a successful action; the admin alerts are best-effort. The one exception is `PF_ENROLLMENT_TEMPLATE_ID`, whose absence is a hard letter-generation error (because there is no template to fall back to).
- **Maintenance mode is live and immediate.** It reads the Script Property on every `doGet()`, so flipping `MAINTENANCE_MODE` is an instant kill switch with admin bypass.
- **Push from the root only, with `clasp.cmd push`.** The `.claspignore` allowlist and project linkage are root-relative; pushing from a subfolder breaks the sync.

## Related pages

- [Google Apps Script Platform](/openwiki/architecture/google-apps-script-platform.md) — the platform constraints (templating, identity, Script Properties) this build targets.
- [System Overview](/openwiki/architecture/system-overview.md) — where configuration and operations fit in the end-to-end architecture.
- [Confirmation Pipeline](/openwiki/workflows/confirmation-pipeline.md) — the audit → letter → email → patch sequence whose best-effort failure discipline the config surface supports.
- [Test Harnesses](/openwiki/testing/test-harnesses.md) — the editor-run harnesses (`testTrackEvent`, `testGenerateLetter`, etc.) used to validate configuration before going live.
