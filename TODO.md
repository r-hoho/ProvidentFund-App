# Project TODO

## Features
- [x] **Payroll cut-off notice** — for enrollment, contribution plan change, and withdrawal: compute and display the effective date at the point of submission. Rule: submitted on or before the 15th → effective end of this month; submitted on the 16th or later → effective end of next month. A shared helper function `getEffectiveDate()` should handle the logic and be reused across all three flows.
- [ ] **Email confirmation** — send a confirmation email to the user upon completing any transaction (enrollment, plan change, beneficiary update, withdrawal), including relevant details as proof (e.g. selected plan %, effective date, beneficiary list, timestamp)
- [ ] **Withdrawal modal — dual eligibility display** — currently only shows employer match eligibility; also show eligibility for the user's own investment return, with clear labels distinguishing the two
- [ ] Implement Investment Plan change flow — `openChangeInvest()` in `JS.html` is currently a stub (`alert("coming soon")`); needs a modal like the contribution change, with same 1-year lock rule
- [ ] Display current investment plan on dashboard — `investmentPlan` is already fetched by the backend and in `globalEnrollmentData` but never rendered in the Fund Status box

## Test Cases
- [ ] Enrollment: submit with beneficiary % that doesn't add up to 100% — wizard Next button should stay disabled
- [ ] Enrollment: user still on probation — Enroll button should not appear
- [ ] Plan change: attempt to change within 12 months — locked modal should appear with correct eligible date
- [ ] Plan change: select the same % as current — Confirm button should be disabled
- [ ] Withdrawal: user with < 5 years tenure — modal should show "not eligible for employer match" in red
- [ ] Withdrawal: complete a 2nd withdrawal — status should permanently show "หมดสิทธิ์ถาวร / Locked" with no action buttons
- [ ] Member since: user who has withdrawn once and re-enrolled — "Member Since" date and duration should reflect 2nd enrollment date, not hire date

## Polish
- [ ] `sendReport()` in `JS.html` is an empty function (`/* Unchanged */`) — wire it up to `reportIssueToAdmin()` on the backend or remove the dead stub
- [ ] Stale variable declarations in `populateUI()` — `changePlanBtn` and `withdrawBtn` reference element IDs (`mainChangePlanBtn`, `mainWithdrawBtn`) that no longer exist in the HTML; clean them up
- [ ] `Monthly_Reporting` sheet is defined in `Config.gs` but never read or written anywhere — either implement reporting logic or remove the constant
- [ ] Effective date banner — polish styling and spacing across all three flows (enrollment, plan change, withdrawal)
