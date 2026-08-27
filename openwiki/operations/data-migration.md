---
type: operations
title: Data Migration Toolchain
description: The gitignored Python toolchain in Data/ that reconstructs the Enrollments sheet from Master.xlsx for hand-import — build.py (emits Migration_Build.xlsx with Enrollments plus build-aid sheets, the count-rule and dedup decisions, cooldown math against a fixed TODAY), its companion verify/inspect/check_lpc/stack_update scripts, and the MIGRATION.md golden rules (sacred headers, real dates, numbers-as-numbers, trimmed IDs, Allstars_ID join key).
tags: [data-migration, openpyxl, enrollments, hand-migration, build-py, migration-build, golden-rules, gitignored, cooldown, withdrawal-count]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-27T08:53:10.517Z
sources:
  - id: openwiki-source-8c8af57734b72b2529c9eebd
    resource: repo://.claspignore
  - id: openwiki-source-ea70eb6c045047448e446296
    resource: repo://.gitignore
  - id: openwiki-source-b019e5c44198414b47399426
    resource: repo://Data/build.py
  - id: openwiki-source-71090108f9776c4466f27061
    resource: repo://Data/check_lpc.py
  - id: openwiki-source-667e44c1b02ee178a77add80
    resource: repo://Data/inspect_one.py
  - id: openwiki-source-9749881fcc9bb486f40abfa0
    resource: repo://Data/stack_update.py
  - id: openwiki-source-b66f0da6fc970f0508bb8de0
    resource: repo://Data/verify.py
  - id: openwiki-source-92ee68a3100ec2ab9d4eb076
    resource: repo://MIGRATION.md
generated: { by: "openwiki/0.4.3", at: "2026-08-27T08:53:10.517Z" }
---

# Data Migration Toolchain

The Provident Fund app persists its state in Google Sheets, but getting the initial state into those sheets is a **manual hand-migration**: a human types the values from a prepared workbook into the live spreadsheet. To make that hand-off safe, the repo carries a local-only Python toolchain in `Data/` that reconstructs the `Enrollments` sheet from a messy multi-source workbook (`Data/Master.xlsx`) and emits an import-ready `Migration_Build.xlsx` together with full provenance and discrepancy logs. The scripts **prepare and verify** the workbook; they never write to the live app sheet.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart LR
    subgraph Sources[Gitignored source workbooks — Data/]
        M[Master.xlsx]
        U["29_June_2026 update.xlsx"]
    end
    subgraph Build[build.py — resolves one state per staff]
        SP["WorkingDB spine"]
        PR["June + B Company Payroll"]
        BK["Bank_Active_29Jun26"]
        WD["BANK_Withdrawal_Report"]
        HR["HRIS_NEW / HRIS_OLD"]
        OF["Old_Registeration_Form"]
    end
    M --> Build
    U --> Build
    Build --> OUT["Migration_Build.xlsx<br/>Enrollments + _Users<br/>_Enrollments_Build<br/>_Discrepancy_Log<br/>_README"]
    OUT --> V[verify.py / inspect_one.py / check_lpc.py]
    OUT --> HAND["Hand-import Enrollments<br/>into live Google Sheet"]
    U -.-> SU[stack_update.py: re-checks new file against build]
```

## Scope and deployment boundary

This toolchain is **not deployed**. `.claspignore` permits only `appsscript.json`, `Code/**/*.gs`, and `html/**/*.html` to push to Google Apps Script, and `.gitignore` excludes `Data/`, `*.xlsx`, `*.xls`, and `*.csv`. So the Python scripts, `MIGRATION.md`, and all source/build workbooks (which contain employee PII) live only on the operator's machine — never in version-control output and never on the GAS server. The `.gs` server code is the consumer of the migrated data, not a producer of it.

The page covers:

- **`Data/build.py`** — the resolver that emits the build workbook.
- **`Data/verify.py`, `Data/inspect_one.py`, `Data/check_lpc.py`, `Data/stack_update.py`** — read-only companion scripts that audit the output.
- **`MIGRATION.md`** — the golden rules every migrated sheet must satisfy, plus the locked per-source precedence decisions the build encodes.

See [Data Model & Google Sheets Schema](/openwiki/concepts/data-model.md) for the exact sheet/column schema the build targets, and [Enrollment Lifecycle & User States](/openwiki/concepts/enrollment-lifecycle.md) for the 9+1 state machine the build reconstructs.

## MIGRATION.md golden rules

`MIGRATION.md` is the contract between the build and the live app. It states five rules that apply to **every** sheet, all rooted in how the `.gs` code reads cells:

1. **Header names are sacred; column order is not.** The code looks columns up with `headers.indexOf('ColumnName')`. A typo, extra space, or wrong wording returns `-1` and the field **silently breaks**. Column order is irrelevant.
2. **Dates must be real dates, not text.** Cells are checked with `instanceof Date`. A string like `"2024-01-15"` is treated as *no date* and silently skips cooldown/tenure logic.
3. **Numbers must be numbers.** `Withdrawal_Count` is `0/1/2/3` (not `"0"`); `Current_Plan` is a decimal (e.g. `0.05`) because the UI multiplies by 100.
4. **No stray whitespace** in `Allstars_ID` / `Work_Email` (trim at source), and watch for invisible **trailing spaces in headers** (`"Current Plan "` breaks too).
5. **`Allstars_ID` is the join key** linking `Users`, `Enrollments`, `Beneficiaries`, `Audit_Log`. It must be named exactly that and hold the same value in all four.

The build honors these mechanically: it writes the exact app header list, emits real `datetime` values (and formats the date columns with `yyyy-mm-dd`), writes `Withdrawal_Count` and `Current_Plan` as numbers, and keys every row on `Staff_ID → Allstars_ID`.

### The 9+1 states and per-state Enrollments values

`MIGRATION.md` formalizes the lifecycle as **9 enrollment-cycle states (numbered 1–10, with 6 the terminal lockout) plus a probation flag**. The spine is `Withdrawal_Count`, which holds steady through each enrollment and ticks up only on a withdrawal. States **1 and 7 have no `Enrollments` row** — they are the only no-row states, and the only difference between them is `Users.Probation_End` (a future date in state 7 blocks enrollment).

| State | Name | `Withdrawal_Count` | `Current_Plan` | `Last_Withdrawal_Date` | Row? |
|---|---|---|---|---|---|
| 1 | Fresh, cleared | — | — | — | no |
| 7 | Fresh, on probation | — | — | — | no |
| 2 | Enrolled, 1st | 0 | set | blank | yes |
| 3 | Withdrawn 1×, in cooldown | 1 | blank | ≤6 mo ago | yes |
| 4 | Withdrawn 1×, ready | 1 | blank | >6 mo ago | yes |
| 5 | Enrolled, 2nd | 1 | set | >6 mo ago | yes |
| 8 | Withdrawn 2×, in cooldown | 2 | blank | ≤6 mo ago | yes |
| 9 | Withdrawn 2×, ready | 2 | blank | >6 mo ago | yes |
| 10 | Enrolled, 3rd | 2 | set | >6 mo ago | yes |
| 6 | Withdrawn 3×, locked | 3 | blank | date of 3rd withdrawal | yes |

Two constraints are easy to get wrong: (a) cooldown-vs-ready is decided **purely** by `Last_Withdrawal_Date` (`+6 months` vs today) — there is no separate flag, the date *is* the switch; (b) an enrolled re-enrollment (states 5 and 10) must have `Last_Withdrawal_Date` >6 months ago, because the app checks cooldown *before* enrolled-status and a recent date would wrongly display an enrolled member as "Cooldown".

## build.py: the resolver

`build.py` reads `Data/Master.xlsx` plus a second update workbook (`Data/29_June_2026 update.xlsx`), resolves one enrollment state per active staff member, and writes a wall-clock-stamped workbook (`Migration_Build_YYYYMMDD_HHMM.xlsx`) **and** refreshes a stable pointer `Data/Migration_Build.xlsx` that the companion scripts read.

### Configuration constants and the deferred decisions

The build hard-codes its temporal anchors and exposes two open decision switches near the top of the file:

```python
TODAY = datetime.datetime(2026, 6, 29)       # effective "today" for cooldown math
COOLDOWN = datetime.timedelta(days=183)     # ~6 months
DEDUP_DAYS = 120                            # form-vs-bank withdrawal merge window
COUNT_RULE = "max"                          # Q1: bank vs withdrawal-events
COUNT_TERMINAL_REASONS = True               # Q2: count Resigned/Retired on active staff
```

`TODAY` is a **fixed** date, not `now()`, so cooldown is reproducible. `DEDUP_DAYS` merges Old-Form withdrawals with bank events that represent the same real event (bank-processing lag); it is kept well under `COOLDOWN` so two distinct withdrawals are never merged. The two deferred decisions:

- **`COUNT_RULE`** decides `Withdrawal_Count` when `BANK_ACTIVE` membership and the count of qualifying withdrawal events disagree. `"max"` (provisional/recommended) = `max(bank_membership − 1, qualifying_event_count)`; `"events"` = event count only; `"bank"` = bank membership − 1 only (the literal locked decision 3).
- **`COUNT_TERMINAL_REASONS`** decides whether `Resigned from Company` / `Retired` / `Death` events attributed to *active* staff count as withdrawals (the rehire scenario). `True` includes them and forces `Confidence = Low`.

### Source sheets and the join-key bridge

The build loads seven source sheets and a bridge between them. `WorkingDB` is the **spine** — every active staff gets a `Users` row, keyed by `Staff_ID` (→ `Allstars_ID`). The trick is that `BANK_ACTIVE` joins on a numeric `Staff_ID`, but `BANK_Withdrawal_Report` joins on a messy `PF_MemberID` (TAA-style, mixed numeric/string, inconsistent spacing). The build bridges through `WorkingDB.PF_MemberID`, normalized with `norm_pm` (strip spaces + uppercase; placeholders → `None`). Proper normalization lifts withdrawal matches from ~244 to ~1,230.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart LR
    WDB["WorkingDB<br/>Staff_ID (spine)"] -- "PF_MemberID" --> BR["norm_pm bridge<br/>pm_to_staff"]
    BANK["Bank_Active_29Jun26<br/>PF Member ID"] --> BR
    WD["BANK_Withdrawal_Report<br/>PF_MemberID"] --> BR
    BR -- Staff_ID --> RES[resolve per staff]
    PAY["June + B Company Payroll<br/>Employee Number"] --> RES
    HN["HRIS_NEW Employee No"] --> RES
    HO["HRIS_OLD Emp Id"] --> RES
    OF["Old_Registeration_Form StaffID"] --> RES
```

Enrolled-now status and rate come from `June_Payroll_Obfuscated` (`PF Employee Rate > 0` ⇒ enrolled, decimal rate) union the `B Company Payroll` batch from the update file (whole-number percent, divided by 100; **June takes precedence on overlap**). Bank membership comes from `Bank_Active_29Jun26` (update file), which **replaces** the stale `BANK_ACTIVE` and adds a `Member Start Date` used only as a cross-check. Bank membership values are only 1 or 2, so **no active staff is at 3rd-enroll or permanent lockout** — state 6 is unreachable from active staff.

### Per-staff resolution (`resolve`)

For each spine staff, `resolve()` builds a record with every `Enrollments` field plus provenance. The control flow:

1. **Qualifying withdrawals.** From `BANK_Withdrawal_Report`, exclude `Transfer within Group` (decision 4 — it's an intra-group company move, not a withdrawal) and `None` reasons. `Withdrawal without Resignation` always qualifies; terminal reasons qualify only if `COUNT_TERMINAL_REASONS`. Bank-report gaps are filled from Old-Form `Withdrawal` events, **deduped within `DEDUP_DAYS`** of a bank event (same event, processing lag); a form-sourced withdrawal sets `Confidence ≥ Med`.
2. **Count.** `count_bank = bank_membership − 1`, `count_events = min(qualifying, 3)`. The chosen count follows `COUNT_RULE`, capped at 3. A bank-vs-events disagreement logs a `_Discrepancy_Log` row and drops `Confidence` to `Med`; a counted terminal reason drops it to `Low`.
3. **Dates.** `Current_Enrolled_Date` ← HRIS_NEW `PF Start Date`, falling back to Old-Form `Enroll` timestamp, then HRIS_OLD `Pf Start`, then (last resort) the bank `Member Start Date` (flagged `bank-start-fallback`). `First_Enrolled_Date` = earliest PF start across sources; for `count == 0` it equals `Current`. `Last_Plan_Change_Date` ← latest Old-Form `Change % Rate` timestamp.
4. **State assignment.** A small map encodes the state machine: enrolled → `{0:2, 1:5, 2:10, 3:10}[count]`; not enrolled with `count≥1` → cooldown (3/8) if `last_wd + COOLDOWN > TODAY` else ready (4/9); `count==3` → 6; no PF history → `None` (no row, state 1/7).
5. **Conflict and sanity flags.** Payroll-enrolled-but-not-in-bank and bank-member-but-not-payroll-enrolled are `Blocking` go-live impacts (payroll wins on status). Nonstandard rates (outside `{0.03,0.05,0.07,0.10,0.15}`) are kept as-is and flagged `Cosmetic`. A re-enrollee whose latest withdrawal post-dates the HRIS enroll date is flagged `last-withdrawal-after-current-enroll-date` (stale tenure basis). Bank `Member Start Date` >31 days from the enroll date is logged as category `J` but does not change the value.

### Output workbook structure

`build.py` writes five sheets. Only `Enrollments` is import-ready; the `_`-prefixed sheets are build aids that **must be deleted before importing to the live app**.

| Sheet | Purpose |
|---|---|
| `Enrollments` | Import-ready, **only** the 8 exact app headers, rows only for states with a row. |
| `_Users` | `Allstars_ID` + `Hire_Date` + `Probation_End`; `Work_Email`/`Name_English`/`Business_Title` blank (owner maps later). |
| `_Enrollments_Build` | One row/staff with a **per-field `_*_why`** justification column, plus `_State`, `_Confidence`, `_GoLiveImpact`, `_Flags`, and the raw bank/event counts. |
| `_Discrepancy_Log` | Long-format, one row per issue: `_Staff_ID | _Field | _Issue | _Value_A | _Source_A | _Value_B | _Source_B | _Resolution_taken | _Category | _GoLiveImpact`. |
| `_README` | Restates the precedence rules and config so the file self-documents. |

`_Discrepancy_Log` carries a single-letter `_Category` (A–K) for every row, so reviewers can filter: `A` clean re-enroll (bank undercounts), `B` re-enroll with resigned/rehire (flips on Q2), `C` bank-claims-membership-but-no-event, `D` withdrawn-not-re-enrolled, `E`/`F` enrolled-status conflicts, `G` nonstandard rate, `H` stale enroll date, `I` enrolled while on probation, `J` bank-vs-enroll-date cross-check, `K` new bank member unmatched to the spine.

`_GoLiveImpact` is **separate from `_Confidence`**: `Blocking` = wrong enrolled-status or eligibility (enroll/re-enroll/cooldown/lockout) — verify before go-live; `Cosmetic` = only displayed tenure/match-tier/vesting/rate, no action gated — safe to go live, fix later. The rule of thumb the build encodes: enrolled members' count/date issues are `Cosmetic`; not-enrolled members' count/date issues are `Blocking` because they gate re-enroll eligibility. `golive_impact()` computes this from the record's enrolled-status, flags, and state.

### Sanity summary printed at run end

After writing, `build.py` prints a state distribution, confidence counts, the bank-vs-events disagreement sub-groups, the go-live impact tally, and three invariant checks that should trend to zero: `count>=1 with no Last_Withdrawal_Date`, `enrolled state with no plan`, and `enrolled with no Current_Enrolled_Date`.

## Companion scripts

All four are read-only against `Data/Migration_Build.xlsx` (and the source workbooks); they exist to audit the build before the hand-import.

### verify.py

Verifies the build workbook's structure and the invariants the golden rules demand: the `Enrollments` headers and row count, a dtype spot-check on the first three enrolled rows (date cells must be `datetime`, not strings), the count-`≥1`-no-`Last_Withdrawal_Date` rows (the flagged six), a `_Discrepancy_Log` summary grouped by `_Issue`, and targeted state-5/10 checks — confirming `First_Enrolled_Date < Current_Enrolled_Date`, that no state-5/10 row has `Last_Withdrawal_Date ≥ Current_Enrolled_Date` (an invalid re-enroll), and that no enrolled re-enrollee is still within cooldown (which would mis-display as "Cooldown").

### inspect_one.py

Traces a single `Staff_ID` (default `1000233`, or the first CLI arg) across **every** source sheet — `WorkingDB`, `June_Payroll_Obfuscated`, `BANK_ACTIVE`, `HRIS_NEW`, `HRIS_OLD`, `BANK_Withdrawal_Report`, `Old_Registeration_Form` — and then prints that staff's full `_Enrollments_Build` row and any `_Discrepancy_Log` rows. It is the diagnostic for "why did the build give this person this state?"

### check_lpc.py

Audits `Last_Plan_Change_Date` coverage: how many rows have it set, broken down by `_enroll_src` and `_State`, and how many of those are still within 6 months of the run date (i.e. currently plan-change-locked by the LPC). This validates the plan-change-lock seed for migrated re-enrollees.

### stack_update.py

Answers "how does the `29_June_2026 update.xlsx` stack against the current build?" It compares the new `Bank_Active_29Jun26` against the old `BANK_ACTIVE` (count distribution, coverage, membership changes, the Q1 recheck: does the new bank's "2nd member" now agree with withdrawal events?), and the `B Company Payroll` against June payroll (net-new enrolled, overlaps, nonstandard rates), then loads the existing build to report the current state of the B Company net-new enrollees. It is the script to re-run when a fresh bank/payroll batch arrives, before deciding whether to rebuild.

## Operational flow

The intended lifecycle is: run `build.py` (it prints a sanity summary and writes both the stamped and `Migration_Build.xlsx` pointers), run `verify.py` and `check_lpc.py` to confirm structure and invariants, spot-check anomalies with `inspect_one.py`, and when a new bank/payroll batch arrives use `stack_update.py` to decide whether to rebuild. Then the operator hand-imports **only the `Enrollments` sheet** into the live Google Sheet (mapping `_Users` into the real `Users` sheet), after deleting all `_`-prefixed build-aid sheets. The build does not touch the live app — the import is typed by hand from the build output, per `MIGRATION.md`'s pre-go-live consistency checklist.
