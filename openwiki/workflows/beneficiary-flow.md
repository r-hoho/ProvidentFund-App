---
type: workflow
title: Beneficiary Flow
description: The beneficiary manager's four frontend views (current / edit / history / sign), the {name, rel, pct, address} JSON model with title-prefix merge/split, max-5 + sum=100 validation, the Same-as-Above address copy, signature capture, and processUpdateBeneficiaries — the append-only ledger write, audit row, immediate-effective best-effort letter/email, and letter-failure admin alert.
tags: [beneficiary, frontend, server-handler, ledger, signature, letter, audit]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-27T08:53:10.517Z
sources:
  - id: openwiki-source-c7bfaaf4ee9e3e78d074addf
    resource: repo://Code/Action.gs
  - id: openwiki-source-95688f6a8ac3c427126ce925
    resource: repo://Code/Config.gs
  - id: openwiki-source-117498b4e7e28f80ffc3bda9
    resource: repo://Code/Email.gs
  - id: openwiki-source-3b1cba3f000133303a1612d7
    resource: repo://Code/Letter.gs
  - id: openwiki-source-be72430c9ea6ec21d42b78cf
    resource: repo://Code/Profile.gs
  - id: openwiki-source-668945266deb6bf0ce3014d3
    resource: repo://html/JS_Beneficiary.html
  - id: openwiki-source-8d63d50cf67b75eb44476b01
    resource: repo://html/JS_Signature.html
  - id: openwiki-source-734fb938319bf9c7cd82d85e
    resource: repo://html/JS_Utils.html
  - id: openwiki-source-524fa0295f8d2fb28f0b8b39
    resource: repo://html/JS.html
  - id: openwiki-source-4765ea1964f200c6687770e7
    resource: repo://html/Modals.html
generated: { by: "openwiki/0.4.3", at: "2026-08-27T08:53:10.517Z" }
---

# Beneficiary Flow

The beneficiary flow lets an enrolled member view, edit, review the history of, and sign-for their provident-fund beneficiaries. Unlike enrollment / plan-change / withdrawal, a beneficiary change is **effective immediately** — there is no payroll cut-off, no cancellation window, and therefore no pending-transaction row. The change is recorded as a new row in the append-only `Beneficiaries` ledger (the prior set survives as the previous row), audited in `Audit_Log`, and a signed PDF letter + confirmation email are dispatched best-effort.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    A[openManageBen] -->|view A| B[renderCurrentBeneficiaries<br/>reads globalEnrollmentData.beneficiariesJSON]
    B --> F{footer}
    F -->|Update| C[switchBenView B<br/>initUpdateBeneficiaries<br/>splitPrefix → editBenData]
    F -->|History| E[switchBenView C<br/>renderHistoryBeneficiaries<br/>globalEnrollmentData.beneficiaryHistory]
    C -->|validateUpdateBen<br/>pct≥1, sum=100, all filled| G[switchBenView D<br/>mountBenSignature]
    E -->|Back| B
    G -->|sign + Save| H[submitUpdateBeneficiaries<br/>mergePrefixes → JSON]
    H -->|google.script.run| I[processUpdateBeneficiaries]
    I --> J[appendRow Beneficiaries ledger]
    I --> K[appendRow Audit_Log<br/>Action=Update Beneficiaries<br/>BN-…, no priorValues]
    I --> L[generateLetter BENEFICIARY<br/>best-effort]
    I --> M[sendActionConfirmation<br/>best-effort]
    L -.letterError.-> N[sendLetterFailureAlert<br/>admin + CC user]
    H --> OK{success} -->|closeManageBen + toast| R[re-fetch profile]
```

## The data model

Each beneficiary is a small JSON object:

```
{ "name": "<title-prefixed full name>", "rel": "<English key>", "pct": <int>, "address": "<home address>" }
```

<!-- openwiki: broken internal link [#title-prefix] heading anchor "title-prefix" does not exist in /openwiki/workflows/beneficiary-flow.md. Fix the href or restore the target, then delete this comment. -->
- **`name`** — the full name **including the title prefix**, which is merged in at submit time (see [Title prefix](#title-prefix)).
- **`rel`** — stored as an English key (`Parent`, `Spouse`, `Child`, `Sibling`, `Relative`, `Friend`). Display is mapped through `relLabel()` / `REL_LABELS` to a bilingual Thai-first label. `Other` is kept in `REL_LABELS` for legacy display but is **not** offered in the picker.
- **`pct`** — integer percentage share; each value must be `≥ 1` and the list must sum to exactly `100`.
- **`address`** — home address (bank requirement). Required, threaded through both forms, the summary, the current view, and the PDF letter. The email body intentionally omits the address.

The whole list is stored as a JSON string in the `Beneficiary_Data` column of the `Beneficiaries` sheet (and duplicated into `Beneficiary_Data` on the `Audit_Log` row). The stored model is always `{name, rel, pct, address}` — the title prefix is never a stored field.

### REL_LABELS duplication

`REL_LABELS` exists in **both** `Code/Config.gs` (server) and `html/JS_Utils.html` (client), and they must be kept in sync. The stored `rel` value is the English key; only display is mapped. Editing either copy without the other makes the two sides disagree on labels.

## The four frontend views

The manager is a single `.wizard-overlay` (`#beneficiaryManager` in `html/Modals.html`) containing four stacked view containers `benViewA`–`benViewD`, each with its own footer. `switchBenView(view, preserve)` shows one view + its footer, hides the others, swaps the header title, and re-renders the relevant content. Opening the manager (`openManageBen`) guards only on a missing profile, never on an empty beneficiary list — a migrated/enrolled member with no record yet still opens view A's empty state.

- **View A — Current** (`renderCurrentBeneficiaries`): reads `globalEnrollmentData.beneficiariesJSON` and renders each beneficiary's name, `relLabel(rel)`, percentage, and address. Shows an empty state ("No beneficiaries yet — tap Update to add") when the list is blank.
- **View B — Edit** (`initUpdateBeneficiaries` → `renderUpdateBeneficiaries`): the editable form. On entry it parses the saved JSON through `splitPrefix` so the title dropdown is populated, and seeds `editBenData`; if empty it seeds a single blank row at 100%. Up to 5 cards (`addUpdateBeneficiary` refuses beyond 5 and hides the Add button); `removeUpdateBeneficiary` is hidden on card 0.
- **View C — History** (`renderHistoryBeneficiaries`): renders `globalEnrollmentData.beneficiaryHistory` as a timeline, newest first, with a "ล่าสุด / Latest" badge on entry 0. Each entry's `data` JSON is parsed to a compact "name (pct%)" list.
- **View D — Sign** (`mountBenSignature`): mounts a fresh signature pad on `#benSigCanvas` and gates the Save button purely on a signature being present (`validateBenSignature`).

The `preserve` flag matters for the B → D → B round-trip: pressing Back from the Sign view calls `switchBenView('B', true)`, which re-renders the edit list from `editBenData` **without** resetting it, so in-progress edits survive the detour to sign and back.

### Validation (view B → D gate)

`validateUpdateBen` runs on every field change. It sums the percentages, and requires every card to have a non-empty `prefix`, non-blank `name`, a `rel`, a non-blank `address`, and `pct ≥ 1`. The "Next" button (`benToSignBtn`) is enabled only when the total is **exactly 100** *and* all fields are filled. A helper message distinguishes "exceeds 100%" from "must equal exactly 100%". This mirrors `validateStep` step 3 in the enrollment wizard — both flows share the same `prefixOptions`/`relOptions` fragments and the same 100% rule.

### Same-as-Above address copy

For every card after the first, the form renders a "ที่อยู่เดียวกัน / Same as Above" checkbox. `toggleUpdateSameAsAbove(index, checked)` copies the **previous** beneficiary's current address into this card's `address` (and into the textarea). Toggling it off clears the address. Unchecking does not re-blank a manually edited address beyond setting it to `''`. The first card has no checkbox.

## Title prefix (merge / split)

Thai banking requires every beneficiary name to carry a title. Rather than grow the stored model, the prefix is a **transient UI-only field** on each edit card, provided by the shared `prefixOptions` fragment (Thai นาย/นาง/นางสาว/ด.ช./ด.ญ. and English Mr./Ms./Mrs.) with `PREFIX_LIST` enumerating the recognized tokens.

- **`mergePrefixes(list)`** (defined in `html/JS.html`, shared by the wizard and the manager) is run immediately before `JSON.stringify` on submit. It folds `{ prefix, name, ... }` into `{ name: "prefix name", ... }`, so the stored JSON model stays `{name, rel, pct, address}` and nothing downstream — ledger, audit, letter, email, profile read — had to change.
- **`splitPrefix(b)`** is the inverse, run when re-editing a saved beneficiary: it scans the leading `name` for a known prefix from `PREFIX_LIST` (matched as `prefix + " "`) and pulls it back out into `prefix`, leaving the remainder in `name`. This populates the dropdown and prevents a re-save from double-prefixing (e.g. "นาย นาย Somchai").

Because `splitPrefix` only recognizes tokens in `PREFIX_LIST`, a legacy name that already lacks a recognized prefix round-trips with an empty `prefix` and is re-merged unchanged.

## Signature capture

View D uses the shared `window.PFSignature` helper (`html/JS_Signature.html`), a thin handle-based wrapper over the `signature_pad` library. `mountBenSignature` destroys any prior pad and mounts a fresh one with `validateBenSignature` as the `endStroke` callback, so the Save button re-checks on every stroke. `PFSignature.getDataUrl(handle)` returns a PNG data URL auto-trimmed to the ink's bounding box (so a small corner signature exports tight); `PFSignature.isEmpty(handle)` gates the Save button. The pad is Hi-DPI aware and mounted fresh each open (a backing-store resize wipes the drawing, a `signature_pad` constraint). `closeManageBen` calls `PFSignature.destroy` to avoid leaks.

The same `PFSignature` API is used by the enrollment wizard's step 5 — each flow owns its own handle (`benSigHandle` vs `wizSigHandle`).

## Submit → `processUpdateBeneficiaries`

`submitUpdateBeneficiaries` serializes `mergePrefixes(editBenData)` and `PFSignature.getDataUrl(benSigHandle)` into `{ beneficiariesJSON, sigDataUrl }`, then calls `google.script.run.processUpdateBeneficiaries(payload, navigator.userAgent)`.

`processUpdateBeneficiaries` (in `Code/Action.gs`) accepts either the payload object or, for backward tolerance, a bare `beneficiariesJSON` string. Its steps:

1. **Resolve the user** from `Session.getActiveUser().getEmail()` against the `Users` sheet — retrieving `Allstars_ID`, `Name_English`, `Business_Title`, `Hire_Date` for the letter context. Returns a failure if the user is not found.
2. **Append the ledger row** — `Beneficiaries.appendRow([today, allstarsId, email, beneficiariesJSON])`. The sheet schema is `Timestamp | Allstars_ID | Work_Email | Beneficiary_Data`. This is the authoritative write; nothing else updates the `Beneficiaries` sheet. A missing sheet returns a hard failure.
3. **Append the audit row** — `Audit_Log` row with `Action = "Update Beneficiaries"`, a `BN-` transaction id (`generateTransactionId("BN")`), `Event_Type = SUBMITTED`, and `Event_Data` carrying only `newValues.Beneficiaries`. There are deliberately **no `priorValues`**: because the `Beneficiaries` sheet is append-only, the prior state is already preserved as the previous matching row. `Selected_Plan` / `Investment_Plan` are blanked (they did not change).
4. **Best-effort letter + email** — wrapped so a failure **never blocks** the update:
   - `generateLetter("BENEFICIARY", ctx, sigDataUrl)` builds a signed PDF. `ctx` carries the beneficiaries list and an `effectiveDate: fmtDate(today)` (immediate — no payroll month), with the enrollment-only placeholders (`planPct`, `employerMatchPct`, `investmentPlan`, `memberSinceDate`) left blank.
   - `sendActionConfirmation({ actionType: "Update Beneficiaries", eventType: "SUBMITTED", details: { beneficiaries, transactionId }, attachmentFileId })` sends the bilingual confirmation with the PDF attached. The beneficiary email body lists the full new set and (per the bank-confirmation design) **omits** the address.
   - `patchAuditEventData(transactionId, "SUBMITTED", …)` records `letterFileId`, `letterError`, `emailSent`, `emailError`, and `signedAt` back onto the audit row.
5. **Letter-failure admin alert** — if `generateLetter` threw, `sendLetterFailureAlert` emails the admin (CC the user) noting the action was recorded but only the PDF failed. Best-effort; never affects the result.
6. **Analytics + result** — `trackFeatureAction("beneficiary", "success"|"fail", deviceData)` and return `{ success: true }` (or `{ success: false, msg }` on a thrown error). The frontend, on success, closes the manager and shows a toast; the next profile re-fetch reads the new ledger row bottom-up.

### Immediate-effect invariant

Because beneficiary changes are effective immediately, `processUpdateBeneficiaries` does **not** compute a payroll `effectiveMonth` and the audit row is not cancellable. This is enforced in two places:

- `getPendingTransactions` (`Code/Profile.gs`) only considers `CANCELLABLE_ACTIONS = ["Enroll", "Change Plan", "Withdraw"]` for the in-progress pending-transaction box — `"Update Beneficiaries"` is excluded, so it never appears there.
- The `Update Beneficiaries` confirmation email has no cancel line.

## Letter template: beneficiary vs enrollment

`generateLetter` selects the template by type. For `"BENEFICIARY"` it uses `PF_BENEFICIARY_TEMPLATE_ID` when set, **falling back to `PF_ENROLLMENT_TEMPLATE_ID`** otherwise. The beneficiary template is a trimmed, page-2-only letter (no rate/match/investment/member-since section); while it is absent, the enrollment template is reused with those placeholders rendering blank. Both template IDs and the letters folder live in Script Properties (set in the Apps Script editor), not in source. The intermediate Google Doc is trashed after PDF export; the PDF is the artifact of record, filed under a `Beneficiary` subfolder.

## Ledger read-back (profile load)

The current active set and history are reconstructed by `getUserProfile` (`Code/Profile.gs`), which scans the `Beneficiaries` sheet **bottom-up**. The first matching row (scanning from the bottom) is the current active set → `enrollmentData.beneficiariesJSON`; every matching row is pushed into `enrollmentData.beneficiaryHistory` in newest→oldest order. Because updates only ever append, the prior state is always recoverable as the previous matching row. The same ledger is also written during enrollment: `processEnrollment` appends the initial `beneficiariesJSON` as a ledger row, so the first enrollment is itself the first history entry.

## Relationships to other pages

- **[Enrollment flow](/openwiki/workflows/enrollment-flow.md)** — the enrollment wizard's step 3 uses the same `prefixOptions`/`relOptions`, the same `mergePrefixes`/`splitPrefix` round-trip, the same 100% validation, the same `PFSignature` helper, and writes its initial beneficiaries to the same ledger.
- **[Confirmation pipeline](/openwiki/workflows/confirmation-pipeline.md)** — the best-effort letter + email + audit patch + letter-failure alert pattern is shared across all action handlers.
- **[Data model](/openwiki/concepts/data-model.md)** — the `Beneficiaries` append-only ledger and bottom-up read.
- **[Bilingual i18n](/openwiki/concepts/bilingual-i18n.md)** — `REL_LABELS`, the Thai-first labels, and the bilingual email/letter copy.
