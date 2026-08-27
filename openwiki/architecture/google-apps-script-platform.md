---
type: platform-runtime-constraints
title: Google Apps Script Platform & Gotchas
description: GAS-specific runtime constraints for this project — the doGet entry, HtmlService templating rules, include() scriptlet helper, server-side identity resolution, bound-script spreadsheet access, appsscript.json settings, and Stackdriver logging — and the non-obvious failure modes each one carries.
tags: [gas, htmlservice, runtime, deployment, gotchas]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-27T08:53:10.517Z
sources:
  - id: openwiki-source-2d0286b97bb40af726f5cb49
    resource: repo://appsscript.json
  - id: openwiki-source-a2371d6362e5db4bc834ad03
    resource: repo://CLAUDE.md
  - id: openwiki-source-c7bfaaf4ee9e3e78d074addf
    resource: repo://Code/Action.gs
  - id: openwiki-source-95688f6a8ac3c427126ce925
    resource: repo://Code/Config.gs
  - id: openwiki-source-654f8d8845de5b163bd73af2
    resource: repo://Code/Feedback.gs
  - id: openwiki-source-3af8c1623658ce56873751e7
    resource: repo://Code/Main.gs
  - id: openwiki-source-be72430c9ea6ec21d42b78cf
    resource: repo://Code/Profile.gs
  - id: openwiki-source-07de7be57227e3320e78ace3
    resource: repo://Code/Withdraw.gs
  - id: openwiki-source-12d6f9161fd01245753b4a09
    resource: repo://html/Index.html
generated: { by: "openwiki/0.4.3", at: "2026-08-27T08:53:10.517Z" }
---

# Google Apps Script Platform & Gotchas

This page captures the Google Apps Script (GAS) runtime constraints that repeatedly trip up agents unfamiliar with the platform. The application is a **container-bound script**: the `.gs` files in `Code/` run server-side in the GAS V8 runtime, and the `html/` partials are rendered into a single `HtmlOutput` at request time. Almost every surprising behavior here stems from one of two facts: (a) GAS is not a general web server, and (b) the frontend talks to the backend over one narrow RPC channel, not REST.

## Entry point: `doGet()` and the templating trap

GAS web apps expose a single HTTP entry point, `doGet()`, which must return an `HtmlOutput`. The critical, non-obvious rule is **how** that output is produced.

```ts
// Main.gs
function doGet() {
  var isMaintenanceActive = PropertiesService.getScriptProperties()
      .getProperty('MAINTENANCE_MODE') === 'true';
  if (isMaintenanceActive) {
    var userEmail = Session.getActiveUser().getEmail().toLowerCase();
    var isAdmin = ADMIN_EMAILS.indexOf(userEmail) !== -1;
    if (!isAdmin) {
      return HtmlService.createTemplateFromFile('html/Maintenance')
        .evaluate()
        .setTitle('Provident Fund App - Under Maintenance')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no');
    }
  }

  var template = HtmlService.createTemplateFromFile('html/Index');
  template.maintenanceActive = isMaintenanceActive;
  return template.evaluate()
    .setTitle('Provident Fund App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no');
}
```

`doGet()` MUST use `HtmlService.createTemplateFromFile(...).evaluate()`. The twin API `createHtmlOutputFromFile(...)` is the wrong choice at the entry point because it returns raw HTML without evaluating scriptlets. The `html/Index.html` shell is laced with `<?!= include('html/...') ?>` scriptlets that pull in CSS, modals, and all JS partials:

```html
<?!= include('html/CSS'); ?>
...
<?!= include('html/Modals'); ?>
<?!= include('html/Modals_Withdraw'); ?>
<?!= include('html/JS_Utils'); ?>
<?!= include('html/JS_Signature'); ?>
<?!= include('html/JS'); ?>
<?!= include('html/JS_Beneficiary'); ?>
<?!= include('html/JS_Withdraw'); ?>
<?!= include('html/JS_Feedback'); ?>
```

If `doGet()` used `createHtmlOutputFromFile('html/Index')`, those `<?!= ?>` tags would pass through unevaluated — the page renders, the scriptlets are silently left as literal text (or stripped), and the whole frontend breaks with no thrown error. The code carries an inline warning specifically because this mistake is silent and easy to make.

Server-side values are pushed into the template before evaluation by setting properties on the template object (e.g. `template.maintenanceActive = isMaintenanceActive`), which then become available inside the scriptlet context.

### The `include()` helper

The `<?!= include('html/CSS') ?>` scriptlets call a global server-side function that MUST be defined in a `.gs` file:

```ts
// Main.gs
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
```

Note the asymmetry: `doGet()` uses `createTemplateFromFile(...).evaluate()` (it must evaluate scriptlets nested inside `Index.html`), but `include()` itself uses `createHtmlOutputFromFile(...).getContent()` (it returns a raw string that is then spliced into the outer template by the `<?!= ?>` forcing scriptlet). This is intentional — `include()` is a *string-injection* helper, not a second evaluation pass; the outer `evaluate()` on `Index.html` is the only evaluation. If `include()` is deleted or renamed, every partial stops loading and the entry page breaks.

The `<?!=` (forcing) scriptlet is used rather than `<?=` (printing) so that included HTML containing quotes or angle brackets is inserted verbatim rather than HTML-escaped.

## Frontend → backend: `google.script.run` only

There is no REST surface and no `fetch` from the client. The single sanctioned channel from browser to server is:

```ts
google.script.run
  .withSuccessHandler(fn)
  .withFailureHandler(fn)
  .serverFunction(args)
```

Every server-side function exposed this way runs as the deploying user (see `executeAs` below) and has access to `Session.getActiveUser()`. Agents must not add `fetch()`/XHR calls to external endpoints from the client — the app is sandboxed and the GAS `google.script.run` RPC is the only intended path. (Server-side `UrlFetchApp` calls — e.g. GA4 Measurement Protocol hits in `Analytics.gs` — are a different matter and are fine, since they originate from the GAS runtime, not the browser.)

## User identity: server-side and trusted

The client **never** sends identity. User identity is resolved server-side, exclusively via:

```ts
const email = Session.getActiveUser().getEmail();
```

This is relied on everywhere a handler needs to know who is acting — `Profile.gs`, `Action.gs`, `Withdraw.gs`, `Feedback.gs`, `Utils.gs`, `Analytics.gs`, and the maintenance check in `Main.gs`. Because `executeAs` is `USER_DEPLOYING` (see below), `getActiveUser()` returns the *end user's* email for in-domain callers, which is the trusted identity for all sheet writes and audit logs. Do not add a "user email" parameter to any client→server call; identity is taken from the session, never from the payload.

## This is a bound script, not standalone

`SPREADSHEET_ID` is derived from the active spreadsheet, not hardcoded:

```ts
// Config.gs
const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
```

`getActiveSpreadsheet()` only returns a value when the script is **container-bound** to the spreadsheet (created via *Extensions → Apps Script* from the sheet). If this code were pushed to a standalone Apps Script project, `getActiveSpreadsheet()` would return `null` at load time and the global `SPREADSHEET_ID` constant would throw, breaking every sheet access in the app. The deployment assumption — the script lives bound to the master spreadsheet — is load-bearing and invisible from the source alone.

## Sheet column access: header-name lookup, not fixed indices

Columns are located by header name, not by positional index:

```ts
const emailCol   = headers.indexOf('Work_Email');
const nameCol    = headers.indexOf('Name_English');
const hireDateCol = headers.indexOf('Hire_Date');
// ...
const tsCol   = headers.indexOf("Timestamp");
const txIdCol = headers.indexOf("Transaction_ID");
const evtCol  = headers.indexOf("Event_Type");
```

This means **column order in a sheet does not matter**, but **header names are sacred**. A typo in a header (e.g. `Work_email` vs `Work_Email`) makes `indexOf` return `-1`, and any subsequent `row[colIdx]` access silently reads the wrong column (or, with `-1`, the last column) — there is no exception. When adding a new sheet-backed field, the header string in `indexOf(...)` and the header in row 1 of the actual sheet must match exactly and case-sensitively. This pattern is repeated across `Profile.gs`, `Action.gs`, and `Utils.gs`.

## `appsscript.json` deployment configuration

The project manifest (`appsscript.json`) pins four settings that shape runtime behavior:

```json
{
  "timeZone": "Asia/Bangkok",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "DOMAIN"
  }
}
```

- **`runtimeVersion: V8`** — the modern V8 runtime, not the legacy Rhino interpreter. All `.gs` code uses modern JS (`const`, arrow functions, template literals, `Array` methods). Do not introduce Rhino-only patterns.
- **`executeAs: USER_DEPLOYING`** — server functions run under the identity of the *deploying* user, but `Session.getActiveUser()` still resolves to the *calling* end user for in-domain access. This is what makes server-side identity resolution trustworthy and is why the client never needs to send identity.
- **`access: DOMAIN`** — the web app is reachable only by users within the Google Workspace domain (airasia.com). This is the access gate; combined with `USER_DEPLOYING` it means only authenticated in-domain users reach `doGet()` and the handlers.
- **`timeZone: Asia/Bangkok`** — drives `new Date()` and date arithmetic server-side. This matters for the payroll cut-off business rule (≤15th → end of this month; ≥16th → end of next month) and for effective-date labels; do not assume UTC.
- **`exceptionLogging: STACKDRIVER`** — uncaught exceptions surface in Google Cloud Logging (Stackdriver), the only observability backend for GAS. There are no application logs apart from this and the explicit GA4 Measurement Protocol events.

Because `executeAs` is `USER_DEPLOYING`, **redeploying the web app as a different user changes whose identity the script runs under** — a subtle operational hazard when rotating the deployment owner.

## Logging and observability

GAS has no filesystem, no `console.log` to a server stdout, and no in-process debugger for deployed runs. The two observability channels are:

1. **Stackdriver / Google Cloud Logging** — set via `exceptionLogging: STACKDRIVER` in the manifest. Uncaught server-side exceptions appear here. This is the primary debugging surface for production runs (the editor's debugger only covers runs launched from the IDE).
2. **GA4 Measurement Protocol** (`Analytics.gs`) — best-effort, never-throws adoption metrics POSTed server-side via `UrlFetchApp` to GA4 `/mp/collect`. This is separate from Stackdriver and is analytics, not error logging. `trackAppOpen` is intentionally fired **client-side** from `JS.html` on `DOMContentLoaded`, not from `doGet()`, because `doGet()` runs server-side and cannot see the browser's `navigator.userAgent`; firing it from `doGet()` would both double-count and lose device dimensions.

There is no other log sink. Anything an agent wants to observe at runtime must go through Stackdriver (errors) or the GA4 path (product analytics).

## Toolchain: `clasp` push, not browser edits

Source is synced to the Apps Script project draft with `clasp`:

```
clasp.cmd push   # Windows PowerShell — run from the repo root, never subfolders
```

The `.gs` and `.html` files are authored locally and pushed; the Apps Script editor's draft is overwritten. Because `clasp` operates per-project on the root `.clasp.json`, pushing from a subfolder silently targets the wrong project or none at all. This is a deployment-time gotcha, not a runtime one, but it is the most common reason a "fix" appears to not take effect.

## Failure-mode summary

| Trap | Symptom | Why |
|------|---------|-----|
| `createHtmlOutputFromFile` in `doGet()` | Page renders but `<?!= include() ?>` partials vanish silently; no error | That API does not evaluate scriptlets |
| Deleting/renaming `include()` | All `html/` partials stop loading | `<?!= include(...) ?>` scriptlets call it by name |
| Adding `fetch()` to client | Request fails / blocked | Only `google.script.run` is the sanctioned RPC channel |
| Client sending `email` in payload | Wrong or spoofable identity | Identity is `Session.getActiveUser().getEmail()` server-side, trusted |
| Pushing to a standalone project | Global `SPREADSHEET_ID` throws at load; all sheet access breaks | `getActiveSpreadsheet()` is null unless container-bound |
| Header typo (`Work_email`) | `indexOf` returns `-1`; reads wrong/last column, silently | Header-name lookup, no schema enforcement |
| Redeploying as a different user | Identity/permissions shift | `executeAs: USER_DEPLOYING` ties runs to the deployer |
| Expecting `console.log` output | Nothing visible | Only Stackdriver (errors) and GA4 (analytics) are sinks |
