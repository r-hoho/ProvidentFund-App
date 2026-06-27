# MIGRATION.md

Reference for hand-migrating data into the Provident Fund app's Google Sheets.
This is a **manual** migration (typed by hand, no script). See `CLAUDE.md` for the
authoritative sheet/column list and business rules.

---

## Golden rules (apply to every sheet)

1. **Header names are sacred; column order is not.** The code reads columns with
   `headers.indexOf('ColumnName')`. A typo, extra space, or wrong wording returns
   `-1` and that field **silently breaks**. Match the names below exactly. Columns
   may be in any order.
2. **Dates must be real dates, not text.** Cells are checked with `instanceof Date`.
   A string like `"2024-01-15"` is treated as *no date* and silently skips
   cooldown/tenure logic. After pasting, select date columns → Format → Number → Date.
3. **Numbers must be numbers.** `Withdrawal_Count` = `0/1/2/3` (not `"0"`).
   `Current_Plan` is a decimal (e.g. `0.05` for 5%) because the UI does `× 100`.
4. **No stray whitespace** in `Allstars_ID` / `Work_Email` — trim at source.
   Also check headers for invisible **trailing spaces** (`"Current Plan "` breaks too).
5. **`Allstars_ID` is the join key** linking `Users`, `Enrollments`, `Beneficiaries`,
   `Audit_Log`. It must be named `Allstars_ID` and hold the same value in all four.

---

## Exact column headers the code expects

> Common pitfall: source sheets often use spaces/different wording. Rename to these.

**`Enrollments`** (rename map from a typical source on the left):

| Likely source header | MUST be renamed to |
|---|---|
| `Staff_ID` | `Allstars_ID` |
| `First Enroll Date` | `First_Enrolled_Date` |
| `Current Enroll date` | `Current_Enrolled_Date` |
| `Current Plan` | `Current_Plan` |
| `Investment Plan` | `Investment_Plan` |
| `Last Plan Change Date` | `Last_Plan_Change_Date` |
| `Withdrawal Count` | `Withdrawal_Count` |
| `Last Withdraw Date` | `Last_Withdrawal_Date` |

Other sheets (verify exact headers): `Users` → `Allstars_ID`, `Work_Email`,
`Name_English`, `Business_Title`, `Hire_Date`, `Probation_End`.
`Beneficiaries` → `Timestamp`, `Allstars_ID`, `Work_Email`, `Beneficiary_Data`.

---

## User states

There are **9 enrollment-cycle states + a probation flag**. `Withdrawal_Count` holds
steady through each enrollment (`0` through the 1st, `1` through the 2nd, `2` through
the 3rd); it only ticks up on a withdrawal. Members get **up to 3 enrollments**, with
a **6-month cooldown** after the 1st and 2nd withdrawals; the **3rd withdrawal is a
permanent lockout**.

- **State 1 — Fresh, cleared:** never enrolled. **No `Enrollments` row.**
- **State 7 — Fresh, on probation:** never enrolled. **No `Enrollments` row.**
  The *only* difference from state 1 is `Users.Probation_End` = a **future** date
  (blocks enrollment). Probation lives entirely in the `Users` sheet.
- **State 2 — Enrolled, 1st** (`Withdrawal_Count = 0`)
- **State 3 — Withdrawn 1×, in cooldown** (`Count = 1`, ≤6 mo)
- **State 4 — Withdrawn 1×, ready to re-enroll** (`Count = 1`, >6 mo)
- **State 5 — Enrolled, 2nd** (`Count = 1`)
- **State 8 — Withdrawn 2×, in cooldown** (`Count = 2`, ≤6 mo)
- **State 9 — Withdrawn 2×, ready to re-enroll** (`Count = 2`, >6 mo)
- **State 10 — Enrolled, 3rd** (`Count = 2`)
- **State 6 — Withdrawn 3×, permanently locked** (`Count = 3`)

---

## Per-state values for the `Enrollments` sheet

States 1 & 7 have **no row**. Legend: `D0` = original 1st-enroll date ·
`D1` = 2nd-enroll (re-enroll) date · `D2` = 3rd-enroll date · `—` = blank.

| State | First_Enrolled_Date | Current_Enrolled_Date | Current_Plan | Investment_Plan | Last_Plan_Change_Date | Withdrawal_Count | Last_Withdrawal_Date |
|---|---|---|---|---|---|---|---|
| **2** Enrolled 1st | `D0` | `D0` | **set** | **set** | `—` (or change date) | `0` | `—` |
| **3** Withdrawn 1×, cooldown | `D0` | `D0` (ended) | **blank** | **blank** | `—` | `1` | **≤6 mo ago** |
| **4** Withdrawn 1×, ready | `D0` | `D0` (ended) | **blank** | **blank** | `—` | `1` | **>6 mo ago** |
| **5** Enrolled 2nd | `D0` | `D1` | **set** | **set** | `—` (or change date) | `1` | **>6 mo ago** |
| **8** Withdrawn 2×, cooldown | `D0` | `D1` (ended) | **blank** | **blank** | `—` | `2` | **≤6 mo ago** |
| **9** Withdrawn 2×, ready | `D0` | `D1` (ended) | **blank** | **blank** | `—` | `2` | **>6 mo ago** |
| **10** Enrolled 3rd | `D0` | `D2` | **set** | **set** | `—` (or change date) | `2` | **>6 mo ago** |
| **6** Withdrawn 3×, locked | `D0` | `D2` (ended) | **blank** | **blank** | `—` | `3` | date of 3rd withdrawal |

`Allstars_ID` is always the employee ID (omitted from the table for width).

---

## Column meanings & gotchas

- **First_Enrolled_Date** — original date; set once for every row, never overwritten.
  Not read for any math, BUT its *emptiness* drives the `wasFirstEnrollment` flag in
  `processEnrollment`. **Populate it for anyone in the sheet.** If you don't know the
  true date, copy `Current_Enrolled_Date` (identical for `Withdrawal_Count = 0`).
  Leaving it blank on an enrolled member causes a wrong-date bug on their next
  re-enrollment (letter would show hire date instead of the re-enroll date).
- **Current_Enrolled_Date** — current cycle's start. **Drives tenure / match-tier /
  5-year vesting when `Withdrawal_Count >= 1`.** For state 5 this MUST be the
  re-enroll date `D1`; for state 10 the 3rd-enroll date `D2`. For states 3/4/8/9/6 it's
  harmless leftover (not read while unenrolled).
- **Current_Plan** — this is the **enrolled flag**. Set (decimal) = enrolled;
  **blank = not enrolled**. Get this wrong and status flips.
- **Investment_Plan** — set when enrolled; blank when not (pairs with Current_Plan).
  The *column* must exist or `processEnrollment` errors.
- **Last_Plan_Change_Date** — optional. 6-month plan-change lock measures from
  `max(Current_Enrolled_Date, Last_Plan_Change_Date)`. Blank = no recent change.
- **Withdrawal_Count** — numeric `0/1/2/3`. `3` = permanent lockout.
- **Last_Withdrawal_Date** — blank until withdrawn. For `Count = 1` or `2` the cooldown
  math runs against `this date + 6 months`.

### Two constraints that are easy to get wrong ⚠️

1. **Cooldown vs ready is decided purely by `Last_Withdrawal_Date`** (`+6 months` vs
   today) — states 3 vs 4 (`Count = 1`) and 8 vs 9 (`Count = 2`). No separate flag —
   the date *is* the switch.
2. **An enrolled re-enrollment's `Last_Withdrawal_Date` must be >6 months ago** —
   state 5 (`Count = 1`) and state 10 (`Count = 2`). A real re-enrollment can only
   happen after the prior cooldown expired. The app checks cooldown *before*
   enrolled-status, so a recent date would wrongly show an enrolled member as "Cooldown".

---

## Pre-go-live consistency checks

- [ ] Every `Enrollments.Allstars_ID` and `Beneficiaries.Allstars_ID` exists in `Users`.
- [ ] No enrolled-ever person has a blank `First_Enrolled_Date`.
- [ ] Every `Withdrawal_Count ≥ 1` row has a `Last_Withdrawal_Date`.
- [ ] Enrolled re-enrollment rows (states 5 & 10) have `Last_Withdrawal_Date` > 6 months ago.
- [ ] Date columns are real dates (right-aligned), not text.
- [ ] `Withdrawal_Count` cells are numeric.
- [ ] Spot-check a few users in the live app: "member since", tenure, and match %
      look correct, and status pill matches the intended state.

---

## Beneficiaries (append-only ledger — newest row wins)

- Append order: `Timestamp | Allstars_ID | Work_Email | Beneficiary_Data`.
- `Beneficiary_Data` is a **valid JSON string**:
  `[{"name":"...","rel":"...","pct":50,"address":"..."}]`
  - `rel` = English key (not the Thai label).
  - each `pct` ≥ 1 and all `pct` **sum to exactly 100**.
  - `name`, `rel`, `address` all non-empty.
- App reads the **bottom-most** matching row as active; order history oldest→newest.

---

## Audit_Log / App_Feedback

- **`Audit_Log`** — do not backfill. Append-only going forward; app works with it empty.
- **`App_Feedback`** — just ensure the sheet exists with headers in row 1.
