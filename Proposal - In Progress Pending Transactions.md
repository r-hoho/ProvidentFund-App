# Proposal: "In Progress" Pending Transactions

Status: **Phase 1 Complete**

Related: [Proposal - Email Confirmations](./Proposal%20-%20Email%20Confirmations.md) — every audit event written by this proposal also triggers a confirmation email.

## 1. Goal

Show users that their submission was received and is queued for the next payroll cut-off, with a safe edit/cancel option before it locks in.

Two user-facing wins:
- **Confidence** — visible confirmation the submission landed and what its effective date is.
- **Safe undo** — cancel before the cut-off has no penalty side-effects (no 12-month plan-change lock, no withdrawal-count increment, no re-enrollment cooldown).

## 2. Scope

**In scope** (cut-off-bound actions):
- Enrollment
- Plan change (contribution %)
- Withdrawal

**Out of scope** (effective immediately, no pending state):
- Beneficiary updates
- Investment plan changes

## 3. UX

A new dashboard element appears **only when the user has pending transactions**. Empty state: hidden entirely.

```
┌─ In Progress ───────────────────────────────┐
│ Plan change to 5%                           │
│ Submitted: 2026-05-18 14:32                 │
│ Effective: 2026-05-31                       │
│ Editable until: 2026-06-15 23:59 (BKK)      │
│                       [ Edit ]  [ Cancel ]  │
└─────────────────────────────────────────────┘
```

- Multiple pending transactions of different types stack as separate entries.
- After the editable window closes, the entry disappears from the box and the normal dashboard reflects the now-committed state.
- **Edit** button re-opens the original wizard/modal with the pending values pre-filled.
- **Cancel** button prompts for confirmation, then reverts.

## 4. Data model

**No new sheets.** Pending state is *derived* from `Audit_Log`.

### `Audit_Log` — new columns

| Column | Type | Purpose |
|---|---|---|
| `Transaction_ID` | string | Groups events for one logical transaction. Format: `<prefix>-<YYYYMMDD>-<short-random>`, e.g. `PC-20260518-a1b2c3`. Prefixes: `EN` enrollment, `PC` plan change, `WD` withdrawal. |
| `Event_Type` | enum | `SUBMITTED` / `EDITED` / `CANCELLED` |
| `Event_Data` | JSON string | Snapshot of values changed AND prior values (needed for cancel to revert). |

Existing rows remain valid — new columns are blank for historical entries.

### `Enrollments` — unchanged structurally

Stays a mutable "current state" sheet. The audit log captures history.

### Key invariant

**`Audit_Log` rows are never edited or deleted.** Cancel = append a new `CANCELLED` event with the same `Transaction_ID`. Edit = append a new `EDITED` event with the same `Transaction_ID`. Full lifecycle of any transaction is reconstructable by filtering `Audit_Log` by `Transaction_ID` and ordering by timestamp.

## 5. Backend changes

### New functions

| Function | Behavior |
|---|---|
| `getPendingTransactions(userEmail)` | For each `Transaction_ID` of this user, find latest event. If it's `SUBMITTED`/`EDITED` AND still within editable window, include it. Returns array of `{ transactionId, type, currentValues, submittedAt, effectiveDate, editableUntil }`. |
| `cancelTransaction(transactionId)` | Verify ownership + window. Revert affected `Enrollments` fields using prior values from `Event_Data` of the original `SUBMITTED` event. Append `CANCELLED` event. |
| `editTransaction(transactionId, newValues)` | Verify ownership + window. Update `Enrollments` fields to new values. Append a single `EDITED` event with both old and new values in `Event_Data`. |

### Modified functions

| Function | Change |
|---|---|
| `processEnrollment`, `processChangePlan`, `processWithdrawal` | Generate `Transaction_ID`. Capture prior field values. Write `SUBMITTED` event to `Audit_Log` with prior + new values in `Event_Data`. No change to mutation logic on `Enrollments`. |
| `getUserProfile` | Include `pendingTransactions` in the response so the dashboard renders in one round trip. |

### Helpers

| Helper | Behavior |
|---|---|
| `generateTransactionId(prefix)` | Returns e.g. `PC-20260518-a1b2c3`. |
| `isWithinEditableWindow(submittedAt)` | Returns boolean. See §6 for the rule. |
| `getEditableUntil(submittedAt)` | Returns the deadline timestamp for UI display. |

## 6. Business rules

### Editable window

A pending transaction is editable/cancellable **until the next upcoming 15th of the month at 23:59:59 Asia/Bangkok time** (UTC+7).

| Submitted (BKK) | Editable until (BKK) |
|---|---|
| 2026-05-01 09:00 | 2026-05-15 23:59:59 |
| 2026-05-14 12:00 | 2026-05-15 23:59:59 |
| 2026-05-15 10:00 | 2026-05-15 23:59:59 |
| 2026-05-16 00:01 | 2026-06-15 23:59:59 |
| 2026-05-20 14:30 | 2026-06-15 23:59:59 |

Implementation note: use `Utilities.formatDate(date, "Asia/Bangkok", ...)` and construct the deadline explicitly in Bangkok time, never relying on the script's default timezone.

### Cancel side-effects (must all be captured in `Event_Data` so revert works)

| Action | Fields to restore on cancel |
|---|---|
| Enrollment | Clear `First_Enrolled_Date`, `Current_Enrolled_Date`, `Current_Plan`, `Investment_Plan`. (Prior values are blank if this was the user's first-ever enrollment.) |
| Plan change | Restore prior `Current_Plan`. Clear `Last_Plan_Change_Date`. |
| Withdrawal | Restore prior `Withdrawal_Count`. Clear `Last_Withdrawal_Date`. Restore prior `Current_Enrolled_Date` (the re-enrollment cooldown stamp). |

### Edit semantics

A single `EDITED` event per edit, capturing both old and new values in `Event_Data`. Multiple edits within the window produce multiple `EDITED` rows. The audit narrative reads naturally: `SUBMITTED → EDITED → EDITED → CANCELLED` or `SUBMITTED → EDITED` (then implicit commit when window closes).

## 7. Edge cases

| Case | Handling |
|---|---|
| User has plan change + withdrawal both pending | Two separate `Transaction_ID`s, both shown stacked in the box. |
| Cancel then resubmit within same window | Two separate transactions, both audited. The lock fields cleared by cancel allow the resubmit to succeed. |
| Two tabs open, both edit | Last-write-wins. Both `EDITED` events appear in audit. Acceptable at this scale. |
| Cancelling first-ever enrollment | Prior values are blank, so revert clears the fields. Trivial. |
| Submitted at 23:58 on the 15th | Editable for ~90 seconds. Technically correct; user knows the cut-off rule. |
| Server timezone drift | All window math done explicitly in `Asia/Bangkok`, never relying on default tz. |
| Audit_Log read for pending state is slow at scale | Acceptable at current scale (one row per event, typically <10 events per user per year). Revisit if user count grows materially. |

## 8. Phased rollout

| Phase | Scope | Risk |
|---|---|---|
| **1. Read-only** | ✅ **Done.** Add `Transaction_ID`, `Event_Type`, `Event_Data` columns to `Audit_Log`. Modify submit handlers to write them. Add `getPendingTransactions` and the In Progress box (no action buttons). | Low — schema-additive, no behavior change. Shippable on its own and already valuable (visible confirmation). |
| **2. Cancel** | Implement `cancelTransaction` and the Cancel button. Revert logic per action type. | Medium — revert logic must be exhaustive per action. Test all three action types. |
| **3. Edit** | Implement `editTransaction` and the Edit button. Re-open original wizard/modal with current pending values pre-filled. | Low–medium — mostly UI wiring on top of phase 2. |

## 9. Open items

1. **`Audit_Log` current schema** — ✅ **Done.** Schema confirmed and new columns added.
2. **HR payroll lock date** — does HR have a hard lock distinct from the 15th cut-off (e.g. payroll team locks the file 2 days before EOM)? If so, the editable window may need to end earlier than 15th 23:59 BKK for some transactions. Currently assumed: no separate HR lock; cut-off boundary is the only relevant deadline.

## 10. Decisions made

- Commit-on-submit model retained (option A); cancel reverts `Enrollments` and appends a `CANCELLED` audit event. No new `Pending_Transactions` sheet.
- Editable window: next upcoming 15th of the month at 23:59:59 `Asia/Bangkok`.
- Single `EDITED` event per edit (not `CANCELLED` + new `SUBMITTED`).
- One `Transaction_ID` per logical transaction, shared across all its lifecycle events.
- `Audit_Log` is strictly append-only — no row is ever modified or deleted.
