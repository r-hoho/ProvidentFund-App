---
type: concept
title: Bilingual Thai-First Design
description: The Thai-first, English-second convention threaded through the UI, confirmation emails, signed letters, and status messages — the REL_LABELS mirror between server and client, the Thai-block-then-English-block email layout, the Thai-month letter placeholders, the bilingual status pills, and the keep-in-sync traps where the same mapping lives in two places.
tags: [i18n, bilingual, thai-first, ui-conventions, email-layout, letter-template]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-27T08:53:10.517Z
sources:
  - id: openwiki-source-95688f6a8ac3c427126ce925
    resource: repo://Code/Config.gs
  - id: openwiki-source-117498b4e7e28f80ffc3bda9
    resource: repo://Code/Email.gs
  - id: openwiki-source-3b1cba3f000133303a1612d7
    resource: repo://Code/Letter.gs
  - id: openwiki-source-18dc44edee07990ce806b4c2
    resource: repo://Code/Utils.gs
  - id: openwiki-source-12d6f9161fd01245753b4a09
    resource: repo://html/Index.html
  - id: openwiki-source-734fb938319bf9c7cd82d85e
    resource: repo://html/JS_Utils.html
  - id: openwiki-source-524fa0295f8d2fb28f0b8b39
    resource: repo://html/JS.html
generated: { by: "openwiki/0.4.3", at: "2026-08-27T08:53:10.517Z" }
---

# Bilingual Thai-First Design

The Provident Fund app serves a Thai-speaking workforce, so the product convention is unambiguous: **Thai is the primary language and English the secondary, trailing reference.** This is not a runtime i18n framework — there is no locale switch, no message catalog, no translation layer. It is a hard authoring rule, applied manually to every surface the user touches: dashboard labels, status pills, the effective-date banner, confirmation emails, signed PDF letters, and the ineligible/cooldown notices. Thai leads everywhere; English follows, either in parentheses, after a separator, or in a parallel block.

The convention shows up in five recurring shapes, and a few of them are duplicated across the server/client boundary into "keep-in-sync" traps that any future change must touch in two places at once.

## The five shapes

| Shape | Where | Form |
|---|---|---|
| **Inline label** — Thai, then English in brackets | Status pills, relationship dropdown labels | `บิดา/มารดา (Parent)` |
| **Two-line label** — Thai line, then `<br>`, then English line | Effective-date banner, cooldown message, pending-tx descriptions | `ส่งเมื่อ<br>Submitted:` |
| **Thai block — divider — English block** | Confirmation emails (plain text + HTML) | Thai lines, `\n\n---\n\n`, English lines, signature |
| **Bilingual value pair** — `{th, en}` object | Payroll effective month, passed into emails and letters | `{ th: "มิถุนายน 2026", en: "June 2026" }` |
| **Rendered `th / en` slash** — single line, both | Withdrawal timeline steps, status pills in compact form | `ยื่นคำขอลาออก / Withdrawal Submission` |

The first four are the rule; the fifth is the variation used where the two languages share one line in a tight UI element. They are not interchangeable — the email block shape never collapses to a slash, and the two-line `<br>` shape exists specifically so a long Thai run can break cleanly on mobile.

## 1. The `REL_LABELS` mirror (the biggest keep-in-sync trap)

Beneficiary relationships are stored and selected by their **English key** (`Parent`, `Spouse`, `Child`, `Sibling`, `Relative`, `Friend`, `Other`). The English key is the `<select>` option value, the audit-log value, and the JSON-in-sheet value. **Display** is the only place the Thai label appears, and it appears as `Thai (English)` — Thai primary, the English key echoed in brackets so an English-only reader can still decode the row.

That display map, `REL_LABELS`, is defined **twice**, identically, because the browser and the Apps Script server do not share a scope:

- `Code/Config.gs` — server-side, used by `Utils.gs#relLabel()` when the server renders an email body, a letter, or a beneficiary list.
- `html/JS_Utils.html` — client-side, used by the identical `relLabel()` in `JS_Utils.html`, which the dashboard markup (`JS.html`, `JS_Beneficiary.html`) calls when rendering the beneficiary list and confirmation screen.

Both definitions carry an explicit comment: *Mirror of REL_LABELS in … — keep in sync.* Adding or renaming a relationship means editing both files or the two surfaces drift, and a beneficiary saved with a `rel` the other side does not recognize falls back to the raw key (see the `relLabel` fallback below).

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart LR
  subgraph Server["Code/ (.gs)"]
    Cfg["REL_LABELS<br/>Config.gs"]
    UtilS["relLabel()<br/>Utils.gs"]
  end
  subgraph Client["html/JS_Utils.html"]
    Cfg2["REL_LABELS<br/>(mirror)"]
    UtilC["relLabel()<br/>(mirror)"]
  end
  Cfg --> UtilS
  Cfg2 --> UtilC
  Cfg -. keep in sync .-> Cfg2
  UtilS -->|email + letter + audit| OutS["Thai (English) label"]
  UtilC -->|dashboard + confirm| OutC["Thai (English) label"]
```

The mirrored function is the same in both files:

```js
// Maps a stored relationship key to its Thai-first label. Unknown/blank keys
// pass through unchanged.
function relLabel(rel) {
  return rel ? (REL_LABELS[rel] || rel) : rel;
}
```

The `|| rel` fallback is the safety valve: if a row carries a `rel` value that is not in the map (a legacy `Other`, a typo, a future value added on one side only), it renders the raw key rather than `undefined`. That keeps a mismatched mirror from blanking the row, but it does leave an English-only string on a Thai-primary surface — another reason the two copies must not drift.

The same `Parent/Spouse/Child/Sibling/Relative/Friend` options appear a third time, inline, as the enrollment wizard and beneficiary-manager `<option>` markup in `JS.html` (`relOptions`). `Other` was removed from the picker but kept in `REL_LABELS` so historical rows still display. The display labels in the `<option>` text (`บิดา/มารดา (Parent)`, …) are the same strings as in `REL_LABELS`, but the `relOptions` literal is not a variable — it is hand-typed HTML, so it is a third place that must stay visually consistent even though it is not a literal mirror.

## 2. The email layout: Thai block, `---`, English block, signature

`Email.gs#sendActionConfirmation` builds every confirmation email in two parallel halves. `buildEmailContent(actionType, eventType, details)` returns `{ subject, thaiAction, thaiDetails[], enAction, enDetails[] }`; the caller assembles each half into its own indented block and joins them with a literal `\n\n---\n\n` divider, then appends the `— Allstars Provident Fund System` signature line after both.

The plain-text body is, exactly:

```
<thai greeting and block>
---
<english block>

— Allstars Provident Fund System
```

The HTML variant (`buildHtmlEmail`) mirrors the same split: a Thai `block(true)`, a `<hr>` divider, an English `block(false)`, then a footer line that itself is bilingual on two `<br>` lines (`อีเมลนี้จัดทำโดยระบบอัตโนมัติ โปรดอย่าตอบกลับ` / `This is an automated message — please do not reply.`) followed by the signature. The subject line is itself bilingual: `[กองทุนสำรองเลี้ยงชีพ / Provident Fund] <Thai subject> / <English subject>`.

The cancel-line ("หากต้องการยกเลิกคำขอนี้ กรุณาเข้าสู่ระบบแอปพลิเคชัน" / "To cancel this request, please open the application.") is shown **only** for `SUBMITTED` events of cancellable actions (`Enroll`, `Change Plan`, `Withdraw`). Beneficiary and investment-plan updates take effect immediately and have no cancel state, so the bilingual cancel copy is intentionally suppressed for them.

`sendLetterFailureAlert` (the admin alert when a PDF could not be generated) uses the identical Thai-block-then-`---`-then-English-block layout, with a separate bilingual subject.

## 3. Letters and the Thai-month placeholders

`Letter.gs#generateLetter` fills a Google Docs template by swapping `{{snake_case}}` placeholders. Two of them carry bilingual date content:

- **`{{date_today}}`** — the letter's issue date. Built in `buildPlaceholderMap` from the `PF_THAI_MONTHS` array (Gregorian year, not Thai lunar calendar), it renders as `5 มิถุนายน 2026 / 5 June 2026` — Thai month + Gregorian year, a slash, English month + year. `PF_THAI_MONTHS` is the single source of Thai month names for the letter module.
- **`{{effective_date}}`** — the payroll month the action applies to. For enrollment it takes the `{th, en}` pair from `ctx.effectiveMonth` and renders `มิถุนายน 2026 / June 2026`; for the beneficiary letter (which has no cut-off) it falls back to `ctx.effectiveDate`.

The `{th, en}` pair itself comes from `Utils.gs#getEffectiveMonthLabel`, which applies the same ≤15th/≥16th cut-off rule as `getEffectiveDate` but returns a *month* label rather than a month-end date, so the email and letter don't read the day as a literal money-movement date. `getEffectiveMonthLabel` is the server-side author of that `{th, en}` value; the client has its own mirror of the cut-off logic in `JS_Utils.html#getEffectiveDateInfo`, which also returns `{ monthTH, monthEN }` (see trap #5 below).

The beneficiary table placeholder, `{{beneficiary_table}}`, is rendered as a plain-text list where each row is `- Name — <relLabel> — 60%`, and an optional second indented line `ที่อยู่ / Address: ...` when a beneficiary carries an address. The `relLabel()` call here is the **server-side** one, so the letter's relationship strings flow through `Config.gs`'s `REL_LABELS` — the same map the email uses.

## 4. Status pills and the cooldown message's `<br>` discipline

The dashboard's status pill (`#statusPill` in `Index.html`) is set by `populateUI` in `JS.html`. Every value it writes is bilingual in the compact `Thai / English` slash form:

- `หมดสิทธิ์ถาวร / Locked` (3+ withdrawals)
- `ระหว่างทดลองงาน / Probation`
- `ระงับสิทธิ์ชั่วคราว / Cooldown`
- `เป็นสมาชิก ครั้งที่ N / Enrolled #N`
- `มีสิทธิ์สมัครได้ ครั้งที่ N / Eligible #N`

The **cooldown / ineligible message** (`#cooldownMessage`) uses the two-line shape instead, and the specific arrangement is load-bearing for mobile layout. The message is built so Thai, English, and the date sit on **separate `<br>` lines**:

```html
* สามารถสมัครได้เมื่อผ่านทดลองงาน<br>
Eligible to enroll after:<br>
<strong>16 Jun 2026</strong>
```

The reason, documented in `CLAUDE.md`, is that the Thai sentence is long and, if placed on one line with the English and the date, would wrap awkwardly on a narrow phone. Putting Thai on its own line, English on its own, and the date bolded on a third lets the long Thai run break at its natural phrase boundary rather than mid-sentence. The `#cooldownMessage` div also lives **directly in the Actions `<article>`**, not inside `#enrolledActionsGroup` (which is `display:none` for non-enrolled users) — otherwise setting the message visible would still be hidden by its parent.

The withdrawal timeline (built by `buildWithdrawalTimeline`) renders each step as `<strong>dateLabel</strong><div>th / en</div>` — the slash form again, with the bilingual label under the date. The footer of that message reuses the two-line form for the re-enroll date: `สามารถสมัครใหม่ได้ในวันที่ / Re-enroll on:<br><strong>…</strong>`.

The effective-date banner (`JS_Utils.html#effectiveDateBannerHTML`) is another two-line instance: a bold Thai status, `<br>`, the English status, `<br><br>`, a Thai label, `<br>`, the English label, then a single bolded `monthTH / monthEN` line. Both the cut-off status and the "first applies / final deduction" label are translated per `context` (`'withdraw'` flips the copy to the last-contribution month).

## 5. The other keep-in-sync mirror: cut-off date logic

`REL_LABELS` is not the only duplicated mapping. The payroll cut-off rule (submitted ≤ 15th → end of this month; ≥ 16th → end of next month) is implemented twice, with an explicit "mirror" comment on each:

- `Utils.gs#getEffectiveDate` — server-side, returns a month-end date string like `30 Jun 2026`; used by the audit log and any server-side date computation.
- `Utils.gs#getEffectiveMonthLabel` — server-side, returns the `{th, en}` payroll-month pair; this is what emails and letters consume.
- `html/JS_Utils.html#getEffectiveDateInfo` — client-side, returns `{ withinCutoff, monthTH, monthEN }`; the banner and any client-side display consume this.

The two `monthTH`/`monthEN` strings (Thai month name + Gregorian year) must be identical across the server `getEffectiveMonthLabel` and the client `getEffectiveDateInfo`, because the banner shows the same payroll month the email will later cite. The Thai month arrays (`["มกราคม","กุมภาพันธ์",…]`) are inlined in both `Utils.gs` and `JS_Utils.html`, and again in `Letter.gs#PF_THAI_MONTHS` — three copies of the same twelve strings. `Letter.gs` is the only one that uses them to fill the `{{date_today}}` template placeholder; the other two use them for email and UI labels respectively.

## What the convention is not

- **Not a locale system.** There is no `navigator.language` check, no Thai/English toggle, no per-user preference. Every user sees Thai-first on every surface.
- **Not a message catalog.** Strings are inline literals in `.gs` and `.html` files; there is no `t("key")` function. Bilingual means "two string literals next to each other", not "one key, two translations".
- **Not symmetric.** English is always secondary: it sits in brackets, after a slash, on the second `<br>` line, or in the second block after `---`. It never leads.
- **Not lossy.** The English key is always preserved — either as the stored value (relationships) or as the trailing bracket/slash/second-block text — so an English-only reader or auditor can always recover the canonical English term.

## Related pages

- [/openwiki/architecture/frontend-spa.md](/openwiki/architecture/frontend-spa.md) — the shell and partials where `JS_Utils.html` lives and `relLabel()` is called from the dashboard.
- [/openwiki/concepts/business-rules.md](/openwiki/concepts/business-rules.md) — the payroll cut-off, beneficiary, and withdrawal-count rules whose *values* are rendered bilingual here.
- [/openwiki/workflows/beneficiary-flow.md](/openwiki/workflows/beneficiary-flow.md) — the beneficiary update flow that stores `rel` as the English key and displays it via `relLabel`.
- [/openwiki/workflows/confirmation-pipeline.md](/openwiki/workflows/confirmation-pipeline.md) — the email + letter pipeline whose bilingual layout this page describes.
