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
  `[{"name":"นาย สมชาย ใจดี","rel":"Child","pct":50,"address":"..."}]`
  - `name` includes a **title prefix** baked in at the front (นาย/นาง/นางสาว/ด.ช./ด.ญ. or Mr./Ms./Mrs.) — the app merges the prefix into `name` on save, so migrated rows should carry it the same way (`"<prefix> <full name>"`).
  - `rel` = English key (not the Thai label): Parent/Spouse/Child/Sibling/Relative/Friend. (`Other` is no longer offered, but legacy `Other` rows still display fine.)
  - each `pct` ≥ 1 and all `pct` **sum to exactly 100**.
  - `name`, `rel`, `address` all non-empty.
- App reads the **bottom-most** matching row as active; order history oldest→newest.

---

## Audit_Log / App_Feedback

- **`Audit_Log`** — do not backfill. Append-only going forward; app works with it empty.
- **`App_Feedback`** — just ensure the sheet exists with headers in row 1.

---

# Automated build from `Data/Master.xlsx` (in progress — started 2026-06-27)

Reconstruct each **active** employee's enrollment state from a messy multi-source
workbook and emit an import-ready `Enrollments` sheet + full provenance/discrepancy
logs. Source file `Data/Master.xlsx` is **gitignored** (employee PII — never commit).
Decisions below are **locked with the data owner**; the actual calc script is the
next session's work. Effective "today" for cooldown math = the run date.

## Tooling note
No pandas locally (PEP-668 externally-managed Python). Use a venv:
`python3 -m venv venv && ./venv/bin/pip install openpyxl`. Read with
`openpyxl.load_workbook(path, read_only=True, data_only=True)`.

## The 7 source sheets (what each is + what it feeds)

| Sheet | Rows | Key | Role |
|---|---|---|---|
| `WorkingDB` | 6,012 active staff (clean, no dup IDs) | `Staff_ID` | **The spine** = who gets a `Users` row. Cols: Staff_ID, Hire_Date, Probation_End, PF_MemberID |
| `June_Payroll_Obfuscated` | 5,320 | `Employee Number` (=Staff_ID) | **Only source with an actual contribution %** (`PF Employee Rate`). Salary/wages obfuscated to `> 0`; rate is real |
| `BANK_ACTIVE` | 3,637 | `StaffId` (numeric) | Bank's current PF members + `1st or 2nd membership` (values: 1 or 2 only). Bank book-keeping = high trust |
| `BANK_Withdrawal_Report` | 5,686 | **`PF_MemberID`** (TAA-style, messy) | Withdrawal events: `Reason` + `Withdrawal Date` (string `DD-Mon-YY`, 5,681/5,686 parse) |
| `HRIS_OLD` | 8,966 | `Emp Id` | 2024 snapshot. `Pf Start`/`Pf End`/`Pf Reg Code` (many null/0) → **original** PF start |
| `HRIS_NEW` | 4,828 ids (has dup rows) | `Employee No` | Current HRIS. `PF Start Date` (100% coverage of enrolled), `PF End Date`, `PF Active Status` Y/N, `REG CODE` → **current/re-enroll** start |
| `Old_Registeration_Form` | 3,035 ids | `StaffID` | Old app action log: `Enroll` / `Change % Rate` / `Withdrawal` w/ `Timestamp` + `Chosen_Contribution_Rate`. Cross-check + fallback |

### Join-key gotcha ⚠️
`BANK_ACTIVE` joins on **numeric `Staff_ID`**, but `BANK_Withdrawal_Report` joins on
**`PF_MemberID`** (the `TAA`-style bank id). Bridge through `WorkingDB.PF_MemberID`.
`PF_MemberID` is messy — mixed numeric/string + inconsistent spacing (`TAA4316` vs
`TAA 0346`); **normalize** = strip spaces + uppercase. Proper normalized join lifts
withdrawal matches from ~244 to ~1,230.

## Scope
- **IN scope this pass:** `Users` spine (Staff_ID only) + `Enrollments` + provenance/discrepancy logs.
- **OUT of scope (owner handles separately):** `Work_Email` / `Name_English` /
  `Business_Title` (leave blank — owner maps emails later), `Beneficiaries`,
  `Investment_Plan` (leave blank).

## Locked decisions
1. **Spine = `Staff_ID`** (`→ Allstars_ID`). Identity columns left blank for the owner.
2. **Enrolled-now + rate ← June Payroll.** `PF Employee Rate > 0` ⇒ enrolled,
   `Current_Plan` = that rate (decimal). Payroll is primary; **log uncertain cases**.
   (Payroll says 3,692 enrolled vs BANK_ACTIVE 3,633 — ~173 disagree: 116 payroll-only,
   57 bank-only. Payroll wins on enrolled-status; log each.)
3. **`Withdrawal_Count` ← BANK_ACTIVE `1st or 2nd membership`** (primary):
   **"1st" → 0** (never withdrew), **"2nd" → 1** (one withdrawal). Maxes at 2, so **no
   active staff is at 3rd-enroll or permanent lockout.** Cross-check vs withdrawal-event
   count; **log mismatches**.
4. **`Transfer within Group` is NOT a withdrawal.** Staff moved to another company in
   the group; PF continues seamlessly. Excluded everywhere — never increments the count,
   never sets `Last_Withdrawal_Date`. Same for HRIS "PF End → PF Start next day" gaps
   (book-keeping, not a real withdrawal).
5. **`Last_Withdrawal_Date` ← `BANK_Withdrawal_Report.Withdrawal Date`** (real, dated),
   excluding `Transfer within Group`. Take the latest qualifying withdrawal.
6. **Dates:** `Current_Enrolled_Date` = **HRIS_NEW `PF Start Date`** (100% coverage,
   drives tenure/vesting for re-enrolled). `First_Enrolled_Date` = **earliest** PF start
   = `min(HRIS_OLD Pf Start, HRIS_NEW PF Start)`; for count=0 it equals current.
   Old-Form `Enroll` timestamp = cross-check + fallback if HRIS missing. Log contradictions.
7. **`Last_Plan_Change_Date` ← latest Old-Form `Change % Rate` timestamp** (drives the
   6-month plan-change lock). Blank if none.

## Output workbook structure (agreed)
1. **`Enrollments`** — import-ready, ONLY the exact app headers (see table above).
2. **`_Users`** — Staff_ID + Hire_Date + Probation_End; Work_Email/Name/Title blank.
3. **`_Enrollments_Build`** — one row/staff aligned to `Enrollments`, with a **per-field
   `_*_why`** justification column + `_State` (the 1–10 state) + `_Confidence`
   (High/Med/Low) + `_Flags`. (Decided: per-field "why" columns, not one combined cell.)
4. **`_Discrepancy_Log`** — long format, one row per issue:
   `_Staff_ID | _Field | _Issue | _Value_A (source) | _Value_B (source) | _Resolution_taken`.
5. **`_README`** — restate the precedence rules above so the file self-documents.

`_`-prefixed sheets/columns are build aids → delete before importing to the live app.

## Known anomalies to flag (not blocking)
- Payroll rates not in {0.03,0.05,0.07,0.10,0.15}: `0.06, 0.0006, 0.0467, 0.09, 0.0332`
  (1 each) → leave as-is + flag.
- `BANK_ACTIVE` has ~18 junk rows with `StaffId = "x"` → ignore.
- 8 `WorkingDB` staff have a **future** `Probation_End` (vs 2026-06-27) → State 7
  (probation block) — lives in `Users`, no `Enrollments` row.
- ~17 active staff withdrew within the last 6 months (Staff_ID match) → in cooldown;
  re-check count after the normalized PF_MemberID join.

## Resume checklist (next session)
- [ ] Rebuild venv + reload `Data/Master.xlsx` (read-only, data_only).
- [ ] Normalize `PF_MemberID` (strip spaces/upper); build Staff_ID↔PF_MemberID bridge.
- [ ] Compute per-staff state per decisions 1–7; assign 1–10 state + confidence.
- [ ] Emit the 5-sheet workbook to `Data/` (gitignored).
- [ ] Sanity pass: state distribution, every count≥1 has a `Last_Withdrawal_Date`,
      enrolled rows have `Current_Plan`, date columns are real dates.
