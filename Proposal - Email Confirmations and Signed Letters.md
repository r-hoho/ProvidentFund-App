# Proposal: Email Confirmations and Signed Letters

Status: **Draft** — pairs with [Proposal - In Progress Pending Transactions](./Proposal%20-%20In%20Progress%20Pending%20Transactions.md) for cancel coverage.

## 1. Goal

Two user-facing wins, layered:

- **Email confirmation (all actions)** — a plain bilingual (Thai + English) email sent to the user on every audit event. Written record outside the app, reassurance the submission was received.
- **Signed PDF letter (enrollment + beneficiary only)** — capture a drawn signature in the app, embed it into a bilingual letter generated from a Google Docs template, attach the PDF to the confirmation email, archive in Drive. Captures user intent for the two flows where it matters most (enrollment is the entry contract; beneficiary designation is the legal directive on payout).

Plan change and withdrawal stay email-only — these are bounded by the payroll cut-off and reversible via Cancel during the cancellable window, so a drawn signature would add friction without adding much assurance.

## 2. Scope

### Email confirmation
One email per audit event. Recipient: acting user only. No CC to HR/Admin (they receive monthly reports after the 15th cut-off).

| Action | Trigger event(s) | PDF attached? |
|---|---|---|
| Enrollment | `SUBMITTED` / `CANCELLED` | Yes on SUBMITTED |
| Plan change | `SUBMITTED` / `CANCELLED` | No |
| Withdrawal | `SUBMITTED` / `CANCELLED` | No |
| Beneficiary update | `SUBMITTED` (effective immediately, no cancel state) | Yes |
| Investment plan change | `SUBMITTED` (effective immediately, no cancel state) | No |

`EDITED` events are not in scope — Edit was dropped from the [In Progress Pending Transactions](./Proposal%20-%20In%20Progress%20Pending%20Transactions.md) proposal.

If a new user action is added later, it should send a confirmation email by default.

### Signature requirement
- **Enrollment** — signature required on the final step of the wizard before Submit enables.
- **Beneficiary** — signature required on the edit view before Save enables. Every save re-triggers signature capture and produces a new letter (no merging of revisions).

## 3. Signature capture UX

Reusable signature pad component, dropped into both flows.

- Library: [`signature_pad`](https://github.com/szimek/signature_pad) via CDN (~5KB)
- Canvas: 500 × 200 px
- Ink: dark blue (pen-ink tone), 2px stroke
- Clear button beneath the pad
- Submit/Save button disabled until any stroke is drawn — no minimum stroke length
- On submit: canvas exported as base64 PNG data URL, sent to backend

**Enrollment wizard** — currently 4 steps; becomes 5 with a new final "Sign & Submit" step that summarizes the selected values and renders the signature pad.

**Beneficiary edit view** — signature pad inline above the Save button.

## 4. Email design

**Format:** plain text, bilingual. Language order **Thai first, then English** — matches the dashboard convention (`ยืนยัน / Confirm`, `สถานะกองทุน / Fund Status`).

**Structure:**
```
Subject: [กองทุนสำรองเลี้ยงชีพ / Provident Fund] <action summary>

สวัสดีคุณ <Name>,

ระบบได้รับคำขอของคุณแล้ว:
  ประเภท: <action in Thai>
  รายละเอียด: <key details in Thai>
  วันที่มีผล: <effective date>            (ถ้ามี)
  รหัสรายการ: <Transaction_ID>
  เวลาที่ส่ง: <submitted at, BKK timezone>

(แนบจดหมายยืนยันที่ลงนามแล้วในอีเมลฉบับนี้)   (เฉพาะการสมัคร / ผู้รับผลประโยชน์)

---

Hi <Name>,

Your request has been received:
  Action: <action in English>
  Details: <key details in English>
  Effective date: <effective date>          (if applicable)
  Transaction ID: <Transaction_ID>
  Submitted at: <submitted at, BKK timezone>

(A signed confirmation letter is attached to this email)   (enrollment / beneficiary only)

— Allstars Provident Fund System
```

### Per-action content

| Action / Event | Key details in body |
|---|---|
| Enrollment SUBMITTED | Contribution %, investment plan, effective date, Transaction_ID. **PDF attached.** |
| Enrollment CANCELLED | Reference to original Transaction_ID, "no changes were applied / ไม่มีการเปลี่ยนแปลงข้อมูล" |
| Plan change SUBMITTED | Old % → new %, effective date, Transaction_ID |
| Plan change CANCELLED | Reference to original Transaction_ID, "no changes were applied" |
| Withdrawal SUBMITTED | Vesting status (eligible / not eligible for employer match), effective date, Transaction_ID |
| Withdrawal CANCELLED | Reference to original Transaction_ID, "withdrawal not processed / ไม่มีการลาออกจากกองทุน" |
| Beneficiary update SUBMITTED | **Full list** — name, relationship, allocation % per entry. Confirmation of new active beneficiary list. **PDF attached.** |
| Investment plan change SUBMITTED | New plan name, Transaction_ID |

## 5. Letter design (PDF)

Generated from a Google Docs template, exported as PDF.

### Templates
- Two templates created and maintained by HR/admin in Drive: one for Enrollment, one for Beneficiary
- Bilingual content: Thai paragraphs first, then English paragraphs, matching email convention
- Use a Thai-compatible font in the template (e.g. Sarabun) to ensure clean rendering
- Placeholders in `{{snake_case}}` form, filled programmatically per submission

### Placeholders

**Enrollment template:**

| Placeholder | Source |
|---|---|
| `{{date_today}}` | Now, formatted `26 พฤษภาคม 2026 / 26 May 2026` |
| `{{name_en}}` | `Users.Name_English` |
| `{{allstars_id}}` | `Users.Allstars_ID` |
| `{{business_title}}` | `Users.Business_Title` |
| `{{work_email}}` | `Users.Work_Email` |
| `{{hire_date}}` | `Users.Hire_Date` |
| `{{member_since_date}}` | Per existing rule (hire date if first enrollment, else `Current_Enrolled_Date`) |
| `{{plan_pct}}` | Submitted contribution % |
| `{{employer_match_pct}}` | Calculated via `Utils.calculateMatchTier(tenureYears)` |
| `{{investment_plan}}` | Submitted investment plan |
| `{{effective_date}}` | Payroll cut-off effective date |
| `{{beneficiary_table}}` | Inline table — one row per beneficiary: name, relationship, allocation % |
| `{{signature_image}}` | Replaced via `DocumentApp` with the user's signature PNG |
| `{{transaction_id}}` | From [In Progress Pending Transactions](./Proposal%20-%20In%20Progress%20Pending%20Transactions.md) |

**Beneficiary template:** subset — `{{date_today}}`, `{{name_en}}`, `{{allstars_id}}`, `{{business_title}}`, `{{work_email}}`, `{{beneficiary_table}}`, `{{effective_date}}` (= submission date, immediate), `{{signature_image}}`, `{{transaction_id}}`.

### File naming and storage

| | |
|---|---|
| File naming | `Provident-Fund-{Enrollment\|Beneficiary}-{Name_EN}-{YYYYMMDD}.pdf` |
| Drive folder | `/PF App/Letters/Enrollment/` and `/PF App/Letters/Beneficiary/` |
| Folder access | Script owner only. User receives via email attachment, not folder access. |

## 6. Data model

No new sheets.

| Sheet | New column / change |
|---|---|
| `Enrollments` | `Last_Letter_File_ID` — most recent enrollment PDF |
| `Beneficiaries` | `Letter_File_ID` — PDF for each ledger row (append-only) |
| `Audit_Log.Event_Data` (JSON) | Adds `letterFileId`, `signedAt` for signature flows. Adds `emailSent` (boolean) and `emailError` (string, optional) for all flows. |

### Config additions

Stored as Script Properties (preferred — keeps IDs out of source) or in `Config.gs`:

```
ENROLLMENT_TEMPLATE_ID = "<doc id>"
BENEFICIARY_TEMPLATE_ID = "<doc id>"
LETTERS_FOLDER_ID       = "<folder id>"
```

## 7. Implementation

### New module: `Code/Letter.gs`

```
generateLetter(type, profileData, sigDataUrl) → { fileId, fileUrl }
  - Copy template by ID to Letters folder
  - Fill placeholders via DocumentApp body.replaceText
  - Insert signature image: decode base64 PNG → Utilities.newBlob → body.replaceText pattern + appendImage
  - Save and close the Doc
  - Export as PDF, replace the Doc with the PDF (or keep both, depending on storage decision)
  - Return PDF file ID and URL

Helpers:
  fillPlaceholders(doc, values)
  insertSignatureImage(doc, sigDataUrl)
  buildBeneficiaryTable(doc, beneficiaries)   // inserts table at {{beneficiary_table}} marker
  exportAsPdf(doc) → blob
```

### New module: `Code/Email.gs`

```
sendActionConfirmation(userEmail, userName, eventType, actionType, details, attachmentFileId?)
  - Render bilingual body (Thai first, then English) from action+event templates
  - If attachmentFileId provided, attach the PDF Blob via DriveApp.getFileById(...).getBlob()
  - Call MailApp.sendEmail()
  - On any throw: log to Audit_Log.Event_Data.emailError, return silently — never throw upstream
```

### Modified handlers

| Handler | Change |
|---|---|
| `processEnrollment` | Accept `sigDataUrl`. After sheet writes succeed: call `Letter.generateLetter('ENROLLMENT', ...)` → call `Email.sendActionConfirmation(..., letterFileId)`. Store `letterFileId` in `Enrollments.Last_Letter_File_ID` and in `Audit_Log.Event_Data`. |
| `processUpdateBeneficiaries` | Accept `sigDataUrl`. Same pattern, with `'BENEFICIARY'` type. Store in `Beneficiaries.Letter_File_ID`. |
| `processChangePlan` | Call `Email.sendActionConfirmation` (no attachment) |
| `processWithdrawal` | Call `Email.sendActionConfirmation` (no attachment) |
| `cancelTransaction` (from In Progress Phase 2) | Call `Email.sendActionConfirmation` with `eventType = 'CANCELLED'`, no attachment |

### Trigger placement

At the end of each action handler, **after** sheet writes succeed and **before** returning success to the frontend. The user's action must not fail because of email or letter generation.

```javascript
// inside processEnrollment, after sheet writes succeed
const { fileId: letterFileId } = generateLetter('ENROLLMENT', profileData, sigDataUrl);
sendActionConfirmation(userEmail, userName, 'SUBMITTED', 'ENROLLMENT', {
  planPct, investmentPlan, effectiveDate, transactionId
}, letterFileId);
return { ok: true, ... };
```

### Email metadata

| Field | Value |
|---|---|
| From | Script owner's Gmail address (Workspace account) |
| Reply-To | Defaults to From |
| To | `Session.getActiveUser().getEmail()` |
| Subject | Bilingual, action-specific (e.g. `[กองทุนสำรองเลี้ยงชีพ / Provident Fund] ยืนยันการสมัครสมาชิก / Enrollment Confirmation`) |

## 8. Operational concerns

| Concern | Handling |
|---|---|
| **Email quota** | `MailApp` Workspace quota is 1500/day, counted per script owner. Comfortable at current scale. |
| **Email failure** | Caught, logged to `Audit_Log.Event_Data.emailError`. User's action still succeeds. Future enhancement: "Resend letter" link on dashboard. |
| **Letter generation failure** | Caught, logged to `Audit_Log.Event_Data.letterError`. The plain email still sends (no attachment). User sees a non-blocking toast: "Letter generation failed — please report via Help." |
| **Drive quota** | PDFs are small (~50–200 KB each). Negligible at current scale. |
| **PDF generation latency** | 1–3 seconds per call, synchronous in GAS. Acceptable; submit handler already takes that long. |
| **Thai font rendering** | Template author chooses a Thai-compatible font (Sarabun recommended). PDF export preserves it. |
| **Spam filtering** | Thai characters in subject lines render fine in Gmail/Outlook; worth a test send to common recipient domains once implemented. |
| **Duplicate sends** | Each audit event triggers at most one email. The action handler is the only sender and runs once per request. |

## 9. Decisions made

- Email confirmations on every action; recipient = acting user only; no CC to HR.
- Bilingual body, **Thai first, then English**, plain text.
- Signature required only for Enrollment and Beneficiary.
- Every Beneficiary save re-triggers signature + new letter — no merging revisions.
- Plan change and Withdrawal stay email-only (no signature, no PDF).
- Letter via Google Docs template → PDF; HR maintains template wording.
- Signature canvas: 500×200 px, dark-blue ink, 2px stroke, any stroke acceptable.
- File naming: `Provident-Fund-{Type}-{Name_EN}-{YYYYMMDD}.pdf`.
- Letters folder restricted to script owner; users access via email attachment.
- Email send failure must never block the user's action.
- Letter generation failure: action still succeeds, plain email sent without attachment, user notified to report.

## 10. Phased rollout

| Phase | Scope | Dependencies |
|---|---|---|
| **1. Template setup** | HR creates Doc templates + Letters folder; shares 3 IDs (Enrollment template, Beneficiary template, Letters folder) | None |
| **2. Backend `Letter.gs` + `Email.gs`** | New modules. Stub-friendly: works as soon as Phase 1 IDs land in Script Properties. | Phase 1 |
| **3. Frontend signature component** | `signature_pad` CDN + reusable canvas markup + JS helper (get base64, clear). No wiring yet. | None |
| **4. Wire enrollment** | New step 5 in wizard, plumb signature through `processEnrollment` | Phases 2 + 3 |
| **5. Wire beneficiary** | Signature pad in edit view, plumb through `processUpdateBeneficiaries` | Phases 2 + 3 |
| **6. Plain emails for other flows** | Plug `Email.gs` into `processChangePlan`, `processWithdrawal`, `processUpdateInvestmentPlan`, and (when built) `cancelTransaction` from In Progress Phase 2. | Phase 2 |

Phase 2 + 3 are independent and can run in parallel.

## 11. Open items

- **Letterhead / branding** — defer to template designer (HR).
- **PDPA consent** — whether to fold the PDPA acknowledgment text into the enrollment letter; revisit once PDPA scope from `TODO.md` is decided.
- **Resend letter from dashboard** — future enhancement, only worth building once letter / email failures are observed in practice.

---

# Implementation Plan (2026-05-27)

Detailed plan from a planning session — file/line refs, phasing, verification steps. Pairs with the proposal above.

## Context

Today the app commits actions silently — users have no off-system record of what they submitted. We're adding a confirmation email on every action and, for the two highest-stakes flows (enrollment and beneficiary update), a signed PDF letter attached to that email. The signed letter captures user intent at the moment of submission and gives HR a defensible paper trail.

The user is authoring a single new Google Doc template (the Thai PF beneficiary form, rebuilt cleanly with `{{snake_case}}` placeholders) that will be used for both enrollment and beneficiary letters. Other actions (plan change, withdrawal, cancellations) get a plain bilingual email only.

Failure to email or generate a PDF must never block the user's action — the action succeeds, the failure is logged in `Audit_Log.Event_Data`, and the user gets a soft-fail toast.

## Scope (locked)

| Action / Event | Signature | PDF | Email |
|---|---|---|---|
| Enrollment SUBMITTED | ✅ capture | ✅ beneficiary letter | ✅ |
| Beneficiary update SUBMITTED | ✅ recapture | ✅ beneficiary letter | ✅ |
| Plan change SUBMITTED / CANCELLED | — | — | ✅ plain |
| Withdrawal SUBMITTED / CANCELLED | — | — | ✅ plain |
| Enrollment CANCELLED | — | — | ✅ plain |
| (Beneficiary has no CANCELLED variant) | — | — | — |

Wizard gets a new **Step 5 = signature**. Beneficiary edit view gets a signature pad inline. **No HR CC**, recipient = acting user only. Intermediate Docs are **trashed** after PDF export; the PDF in the user's inbox is the artifact of record.

## Critical files

**Modified:**
- `Code/Action.gs` — `processEnrollment` (line 4), `processChangePlan` (line 182), `processUpdateBeneficiaries` (line 274), `cancelTransaction` (line 328)
- `Code/Withdraw.gs` — `processWithdrawal` (line 4)
- `Code/Utils.gs` — add `patchAuditEventData()` and `getEffectiveDate(submittedAt)` helpers
- `Code/Config.gs` — add `setupScriptProperties()` admin bootstrap
- `html/Index.html` — include `JS_Signature.html` partial + `signature_pad` CDN script
- `html/JS.html` — wizard ceiling 4 → 5, new step-5 mount, validate, pass `sigDataUrl` in `submitEnrollWizard` (line 318)
- `html/JS_Beneficiary.html` — mount pad in `initUpdateBeneficiaries`, gate Save in `validateUpdateBen`, pass `sigDataUrl` in `submitUpdateBeneficiaries` (line 142)
- `html/Modals.html` — `<canvas>` markup in `#wizStep5` and `#benViewB`
- `CLAUDE.md` — short section on Script Properties + template authoring conventions

**New:**
- `Code/Letter.gs` — Doc template merge + PDF export
- `Code/Email.gs` — bilingual confirmation emails
- `html/JS_Signature.html` — shared `signature_pad` helper

## Existing utilities to reuse

- `Code/Utils.gs:45` `generateTransactionId(prefix)` — use `'BN'` prefix for beneficiary updates (the only handler not generating one today)
- `Code/Utils.gs` `appendRowToSheet(sheet, rowObject)` — already used in 4 of 5 handlers; replace the raw `appendRow()` in `processUpdateBeneficiaries` (line 307–309) with this
- `Code/Utils.gs:12` `reportIssueToAdmin` — reference pattern for `MailApp.sendEmail({ to, subject, body })`
- `Code/Action.gs` `writeEnrollmentAudit` (line 94) — refactor to **return** the `transactionId` it generates, so `processEnrollment` can thread it into letter/email/patch calls (single source of truth)

## Approach

### 1. Audit upgrade (pre-req, ship standalone)

`processUpdateBeneficiaries` currently writes a raw 8-column row with no `Transaction_ID` and no structured `Event_Data`. Bring it up to par before anything else:

- Generate `transactionId = generateTransactionId('BN')`.
- `Event_Data` carries **`newValues` only** (`newValues.Beneficiaries = JSON.parse(beneficiariesJSON)`). **No `priorValues`** — unlike `Enrollments` (one row per employee, mutated in place), the `Beneficiaries` sheet is an append-only ledger, so the prior state is already preserved losslessly as the previous row by `Timestamp`. Storing it again in the audit log would just duplicate the ledger.
- Replace raw `appendRow` with `appendRowToSheet(auditSheet, { ...named fields including Transaction_ID, Event_Type: 'SUBMITTED', Event_Data })`.

The mandatory part here is `Transaction_ID` + `Event_Type` — those are what `patchAuditEventData()` (later phases) needs to re-find the row and stamp `letterFileId` / `emailSent`. This is independent of the email/letter work and unblocks that helper.

### 2. New module: `Code/Email.gs`

Single public function — never throws:

```
sendActionConfirmation({ userEmail, userName, actionType, eventType, details, attachmentFileId? })
  → { sent: boolean, error?: string }
```

Internals: bilingual body assembly (Thai first, `---` separator, then English). Subject is single-line bilingual. Time formatting via `Utilities.formatDate(date, 'Asia/Bangkok', '...')`. If `attachmentFileId` provided, `DriveApp.getFileById(id).getBlob()` and pass to `MailApp.sendEmail({ ..., attachments: [blob] })`. Full bilingual strings for all 7 (action × event) combinations are pre-drafted (see Plan agent output, §8) — covers enrollment SUBMITTED/CANCELLED, plan change SUBMITTED/CANCELLED, withdrawal SUBMITTED/CANCELLED, beneficiary SUBMITTED.

### 3. New module: `Code/Letter.gs`

Single public function:

```
generateLetter(type, ctx, sigDataUrl) → { fileId, fileUrl, fileName }
```

Type is `'ENROLLMENT'` or `'BENEFICIARY'`. Reads template ID from Script Properties (`ENROLLMENT_TEMPLATE_ID`, `BENEFICIARY_TEMPLATE_ID` — beneficiary falls back to enrollment ID when unset, so day-1 with one template is fine and a second template later is a config-only change).

Flow: copy template to Letters folder (auto-create `Enrollment/` and `Beneficiary/` subfolders inside `LETTERS_FOLDER_ID` on first use), `body.replaceText()` all `{{snake_case}}` placeholders, custom-replace `{{beneficiary_table}}` (find paragraph, locate the next sibling table, copy formatting, append one row per beneficiary, remove the placeholder paragraph), custom-replace `{{signature_image}}` (find paragraph, capture parent + child-index, `removeFromParent()`, `insertParagraph(idx, '')`, `appendInlineImage(sigBlob).setWidth(180).setHeight(72)`), save & close, `docFile.getAs('application/pdf')` to produce the PDF in the same folder, **trash** the intermediate Doc, return PDF metadata.

Signature decode: strip the `data:image/png;base64,` prefix from the data URL, `Utilities.base64Decode()`, `Utilities.newBlob(bytes, 'image/png', 'signature.png')`.

File naming: `Provident-Fund-{Enrollment|Beneficiary}-{Name_EN-spaces-as-dashes}-{YYYYMMDD}.pdf`.

### 4. Handler insertion pattern (uniform across all 5 handlers)

After sheet writes and audit append succeed, before `return`:

```
let letterFileId = null, letterError = null;
try { const r = generateLetter('ENROLLMENT', ctx, payload.sigDataUrl);
      letterFileId = r.fileId; }
catch (e) { letterError = e.toString(); }
const emailResult = sendActionConfirmation({ ..., attachmentFileId: letterFileId });
patchAuditEventData(transactionId, 'SUBMITTED',
  { letterFileId, letterError, emailSent: emailResult.sent,
    emailError: emailResult.error || null, signedAt: today });
```

For non-letter handlers (plan change, withdrawal, cancellation): skip the `generateLetter` block and the `letterFileId` / `letterError` audit fields.

`patchAuditEventData(transactionId, eventType, extraFields)` is a new helper in `Utils.gs` that re-finds the just-appended audit row by `Transaction_ID + Event_Type`, parses `Event_Data`, merges `extraFields`, writes back. Best-effort; its own try/catch; failure of the patch never propagates.

`writeEnrollmentAudit` needs a small refactor to return `transactionId` (currently generates it internally and discards). Alternative: hoist the generation up into `processEnrollment` — preferred, since the handler then owns the ID for letter + email + patch.

**`cancelTransaction` reuses the original transaction's ID** (not a new one) — the CANCELLED row already does this today; the email and patch both reference that same ID for continuity.

### 5. Script Properties

Three keys, configured once via a `setupScriptProperties()` admin function in `Code/Config.gs` (runnable from the Apps Script editor):

```
ENROLLMENT_TEMPLATE_ID  = "<google doc id>"
BENEFICIARY_TEMPLATE_ID = "<google doc id, optional — falls back to enrollment template>"
LETTERS_FOLDER_ID       = "<google drive folder id>"
```

`Code/Letter.gs` reads via `PropertiesService.getScriptProperties().getProperty(...)`. Missing required property → throw with a clear message → handler catches → action still succeeds → audit records `letterError`.

### 6. Sheet schema

**No new columns.** The audit log is the single source of truth — `Event_Data` JSON gains `letterFileId`, `letterError`, `emailSent`, `emailError`, `signedAt` (last one only on signature flows). Adds zero migration cost. If we later build "View past letters" UI, we add the column then and backfill.

### 7. Frontend signature capture

CDN: `https://cdn.jsdelivr.net/npm/signature_pad@4.2.0/dist/signature_pad.umd.min.js` (pinned major version), loaded in `html/Index.html`.

New `html/JS_Signature.html` exposes `window.PFSignature` with `mount(canvasEl)`, `isEmpty(handle)`, `getDataUrl(handle)`, `clear(handle)`, `destroy(handle)`. Encapsulates: hi-DPI canvas resize on mount + window resize (mobile is primary platform — without this, strokes look fuzzy), dark-blue ink `#1e3a8a`, `minWidth: 2 / maxWidth: 2.5`. `destroy()` is called from `closeWizard()` and `closeManageBen()` to prevent handle leaks across overlay reopens.

**Wizard Step 5** (`html/JS.html` + `html/Modals.html`): new `<div id="wizStep5">` with canvas + Clear button. `currentStep` ceiling → 5, `Step X of 4` → `of 5`, `validateStep` gains `else if (currentStep === 5) isValid = !PFSignature.isEmpty(handle)`, `onEnd` callback triggers re-validation so Submit enables on first stroke. `submitEnrollWizard` (line 318) adds `sigDataUrl: PFSignature.getDataUrl(handle)` to the payload sent to `processEnrollment`.

**Beneficiary edit** (`html/JS_Beneficiary.html` + `html/Modals.html`): canvas inside `#benViewB` above the Save button. Mount/reset in `initUpdateBeneficiaries`. Save button gating in `validateUpdateBen` (line 128) gains `&& !PFSignature.isEmpty(handle)`. `submitUpdateBeneficiaries` (line 142) switches to a payload object: `processUpdateBeneficiaries({ beneficiariesJSON, sigDataUrl }, deviceData)` — matches `processEnrollment`'s shape; the backend signature changes accordingly.

### 8. Phasing (so user can author template in parallel with backend work)

| Phase | Deliverable | Template needed? | Status |
|---|---|---|---|
| A | `processUpdateBeneficiaries` audit upgrade (Transaction_ID + structured Event_Data) | No | ✅ Done |
| B | `Code/Email.gs` + wire into `processChangePlan` only | No | ✅ Done |
| C | Plain emails for `processWithdrawal` + `cancelTransaction`; `patchAuditEventData` everywhere | No | ✅ Done |
| D | `Code/Letter.gs` + manual test harness (calls `generateLetter` with fake ctx + fake signature, eyeball the PDF) | **Yes — template ID lands here** | ✅ Done (tested) |
| E | `JS_Signature.html` + wizard Step 5 + plumb `sigDataUrl` through `processEnrollment` | Yes | ◑ Backend done; front-end pad pending |
| F | Signature pad inline in beneficiary edit + plumb through `processUpdateBeneficiaries` | Yes | ☐ |
| G | Polish: bilingual soft-fail toast, CLAUDE.md notes | — | ☐ |

**As-built notes (Phases A–C):**
- Phase A dropped `priorValues` for beneficiaries — the `Beneficiaries` sheet is an append-only ledger, so prior state is already preserved as the previous row. Also fixed `getPendingTransactions` to whitelist cancellable actions (`Enroll`/`Change Plan`/`Withdraw`) so beneficiary updates don't surface in the in-progress box.
- Withdrawal email omits the vesting line (vesting is acknowledged in the modal before submit; the receipt doesn't repeat it).
- Cancellation email omits the "Status / no changes applied" line.
- `SUBMITTED` emails carry a cancel-only line ("To cancel this request, please visit the application." — Edit is not a feature). Gate is `eventType === "SUBMITTED"`; exclude beneficiary/investment SUBMITTED when wired in F.

**As-built notes (Phases D + E backend):**
- **Beneficiary table dropped** — `{{beneficiary_table}}` is replaced with a plain-text list ("- Name (Rel) — 60%"), not a Docs table (user preference, leaner code). `fillBeneficiaryList` in `Letter.gs`.
- **Config: hard-coded, not Script Properties** — template/folder IDs live as `PF_ENROLLMENT_TEMPLATE_ID` / `PF_BENEFICIARY_TEMPLATE_ID` (`""` → falls back to enrollment) / `PF_LETTERS_FOLDER_ID` consts at the top of `Letter.gs`. `PF_LETTERS_FOLDER_ID=""` falls back to the template's parent folder. Move to Script Properties in Phase G before prod.
- **`Letter.gs` flow** — copy template → `fillPlaceholders` → `fillBeneficiaryList` → `insertSignatureImage` (clears the `{{signature_image}}` marker paragraph and appends the PNG at 180×72; missing/blank sig just clears the marker) → export PDF → trash the intermediate Doc. PDF archived under `Enrollment/` (or `Beneficiary/`) subfolder.
- **Phase E backend** — `processEnrollment` hoists the `EN-` transaction id (so it threads into audit + letter + email + patch), gathers Name/Title/Hire_Date from `Users`, computes match tier from tenure and member-since per the first-vs-re-enroll rule, then generates the letter + sends the email with the PDF attached (best-effort try/catch — never blocks enrollment), and patches `letterFileId`/`letterError`/`emailSent`/`signedAt` onto the audit row. **Verified live.** Signature is blank until the front-end pad (rest of E) lands.

Phases A–C ship value with zero template dependency. Natural intermediate ship line at end of C: full confirmation-email coverage live, no PDF yet. Phase D gates E + F; D and the user's template authoring are the only gate.

## Verification

Plan to test end-to-end before declaring each phase done. There is no automated test harness — manual through the deployed web app.

**Phase A**: Submit a beneficiary update → open `Audit_Log` sheet → confirm row has `Transaction_ID` of form `BN-YYYYMMDD-xxxx`, `Event_Type = 'SUBMITTED'`, `Event_Data` JSON with `newValues` (no `priorValues` — recoverable from the ledger).

**Phase B**: Submit a plan change → check inbox for bilingual confirmation email with correct old/new %, effective date, transaction ID. Cancel it → check for cancellation email. Re-open the audit row → `Event_Data` has `emailSent: true`.

**Phase C**: Same drill for withdrawal SUBMITTED + CANCELLED, enrollment CANCELLED. Verify `emailSent` recorded in every audit row.

**Phase D**: Run the test harness function from the Apps Script editor with a hardcoded `ctx` + a base64 PNG signature. Confirm the resulting PDF in the Letters folder: text placeholders all replaced, beneficiary table rendered, signature image visible at the expected size, intermediate Doc is gone (trashed).

**Phase E**: Full enrollment in the deployed web app. Confirm:
- Step 5 mounts a working canvas; Submit disabled until any stroke
- Email arrives with PDF attached
- PDF opens correctly on desktop Acrobat + mobile preview (Thai font renders cleanly — Sarabun recommended in template)
- Audit row's `Event_Data` has `letterFileId`, `emailSent: true`, `signedAt`

**Phase F**: Beneficiary update via dashboard. Same checks as Phase E. Specifically: signature pad re-mounts cleanly on second open (no leaked handle), each save produces a new PDF (no merging revisions).

**Failure-path checks**:
- Set `ENROLLMENT_TEMPLATE_ID` to an invalid ID → submit enrollment → action still succeeds, email still sends without attachment, audit row has `letterError`, user sees soft-fail toast.
- Temporarily make `MailApp.sendEmail` throw (e.g., set To to `""`) → submit → action still succeeds, audit row has `emailSent: false` with error.

## Open items deferred (not in this scope)

- "Resend letter" / "Download past letter" UI on dashboard — design supports it (audit log carries `letterFileId`), build later if needed.
- Auto-retry on email failure — manual recovery via Apps Script editor function if observed in practice.
- Adding template fields we don't currently capture (Thai name, นาย/นาง/นางสาว prefix, department, ฝ่าย, company name, beneficiary address) — user designs the new template using only what we have; these fields can be added in a future iteration if HR pushes back.
- Increasing beneficiary cap from 4 to 5 (TODO already notes this) — independent change, can ride along or wait.

## Risks worth knowing

- **GAS 6-min execution limit**: PDF export adds 1–3s typical, 8–10s worst case. Acceptable at current scale but generate PDF *after* sheet commits so failure doesn't roll back the action.
- **Signature image insertion** is the fiddliest piece: `body.replaceText` cannot place images, so we capture the placeholder paragraph's index, remove it, and `insertParagraph().appendInlineImage()`. If wrong, image lands at end of document — explicit harness test in Phase D catches this.
- **`MailApp` quota** 1500/day (Workspace) is comfortable at current scale. Cancellations + submissions both send mail, so a single user thrashing enroll → cancel can burn ~4 sends per cycle. Negligible.
- **Thai font rendering** on PDF export inherits from the Doc template — user must pick Sarabun or Noto Sans Thai in the template, validated visually in Phase D.
- **`Session.getActiveUser().getEmail()` empty in some sharing modes** — handled upstream in every handler; same recipient path, no new failure mode.
