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
