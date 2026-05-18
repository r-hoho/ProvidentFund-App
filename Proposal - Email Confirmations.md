# Proposal: Email Confirmations

Status: **Draft** — pairs with [Proposal - In Progress Pending Transactions](./Proposal%20-%20In%20Progress%20Pending%20Transactions.md) for edit/cancel coverage.

## 1. Goal

Send a simple, bilingual (Thai + English) confirmation email to the user every time they take an action in the system. Gives users a written record outside the app and reassurance that their submission was received.

## 2. Scope

One email per audit event. Recipients: the acting user only. **No CC to HR/Admin** — they receive their own monthly report after the 15th cut-off.

### Actions covered

| Action | Trigger event(s) |
|---|---|
| Enrollment | `SUBMITTED` / `EDITED` / `CANCELLED` |
| Plan change (contribution %) | `SUBMITTED` / `EDITED` / `CANCELLED` |
| Withdrawal | `SUBMITTED` / `EDITED` / `CANCELLED` |
| Beneficiary update | `SUBMITTED` (effective immediately, no edit/cancel state) |
| Investment plan change | `SUBMITTED` (effective immediately, no edit/cancel state) — pending implementation per TODO |

If a new user action is added later, it should be expected to send a confirmation email by default.

## 3. Email design

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

---

Hi <Name>,

Your request has been received:
  Action: <action in English>
  Details: <key details in English>
  Effective date: <effective date>          (if applicable)
  Transaction ID: <Transaction_ID>
  Submitted at: <submitted at, BKK timezone>

— Allstars Provident Fund System
```

### Per-action content

| Action / Event | Key details in body |
|---|---|
| Enrollment SUBMITTED | Contribution %, investment plan, effective date, Transaction_ID |
| Enrollment EDITED | Latest contribution %, investment plan, effective date, Transaction_ID |
| Enrollment CANCELLED | Reference to original Transaction_ID, "no changes were applied / ไม่มีการเปลี่ยนแปลงข้อมูล" |
| Plan change SUBMITTED | Old % → new %, effective date, Transaction_ID |
| Plan change EDITED | Latest new %, effective date, Transaction_ID |
| Plan change CANCELLED | Reference to original Transaction_ID, "no changes were applied" |
| Withdrawal SUBMITTED | Amount summary, vesting status (eligible / not eligible for employer match), effective date, Transaction_ID |
| Withdrawal EDITED | Latest values, effective date, Transaction_ID |
| Withdrawal CANCELLED | Reference to original Transaction_ID, "withdrawal not processed / ไม่มีการลาออกจากกองทุน" |
| Beneficiary update SUBMITTED | **Full list**: for each entry — name, relationship, allocation %. Confirmation of new active beneficiary list. |
| Investment plan change SUBMITTED | New plan name, Transaction_ID |

## 4. Implementation

### New helper

`sendActionConfirmation(userEmail, userName, eventType, actionType, details)` in a new file `Code/Email.gs`.

- Looks up template for `(actionType, eventType)` combination.
- Renders bilingual body (Thai block first, then English block), injecting `details`.
- Calls `MailApp.sendEmail()`.
- Wrapped in try/catch — on failure, log via `reportIssueToAdmin()` (already in `Utils.gs`) and **return silently**. Never throw — email is a notification; the action is the source of truth.

### Trigger placement

Called at the **end** of each action handler in `Action.gs` / `Withdraw.gs` / (future) edit/cancel handlers, AFTER the sheet writes have succeeded and BEFORE returning success to the frontend. The user's action must not fail because of an email problem.

```javascript
// inside processChangePlan, after sheet writes succeed
sendActionConfirmation(userEmail, userName, 'SUBMITTED', 'PLAN_CHANGE', {
  oldPlan: 3,
  newPlan: 5,
  effectiveDate: '2026-05-31',
  transactionId: 'PC-20260518-a1b2c3'
});
return { ok: true, ... };
```

### Email metadata

| Field | Value |
|---|---|
| From | Script owner's Gmail address (Workspace account) |
| Reply-To | Defaults to From — replies go to the script owner |
| To | `Session.getActiveUser().getEmail()` (the acting user) |
| Subject | Bilingual, action-specific (e.g. `[กองทุนสำรองเลี้ยงชีพ / Provident Fund] ยืนยันการเปลี่ยนแผน / Plan Change Confirmation`) |

## 5. Operational concerns

| Concern | Handling |
|---|---|
| **Quota** | `MailApp` Workspace quota is 1500/day, counted per script owner. Comfortable at current scale. |
| **Email failure** | Caught + logged via `reportIssueToAdmin()`. User's action still succeeds. |
| **Spam filtering** | Thai characters in subject lines generally render fine in Gmail/Outlook; worth a test send to common recipient domains once implemented. |
| **Duplicate sends** | Each audit event triggers at most one email. The action handler is the only place that sends, and it runs once per request. |

## 6. Decisions made

- One email per audit event (`SUBMITTED` / `EDITED` / `CANCELLED`), recipient = acting user only.
- No CC to HR/Admin (they get monthly reports after the 15th).
- Bilingual body, **Thai first, then English**, matching dashboard convention.
- Plain text format — simple and renders consistently.
- Single helper function called from all action handlers.
- Email send failure must never block the user's action.
- Beneficiary update email includes **full list** (name, relationship, allocation %).
- From: script-owner Gmail (Workspace). No dedicated alias needed.

## 7. Phased rollout

| Phase | Scope | Dependencies |
|---|---|---|
| **1. Direct submissions** | Confirmation emails for enrollment, plan change, beneficiary update, withdrawal, investment plan change (when built) on `SUBMITTED` events. | None — ships standalone. |
| **2. Edit/cancel emails** | Add email sends for `EDITED` and `CANCELLED` events. | Depends on [In Progress Pending Transactions](./Proposal%20-%20In%20Progress%20Pending%20Transactions.md) phases 2 + 3 being built first. |
