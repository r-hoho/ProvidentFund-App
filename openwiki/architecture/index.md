# Files

- [Frontend Single-Page App](frontend-spa.md) - The browser runtime of the Provident Fund app — the Index.html shell, its included partials, the DOMContentLoaded bootstrap, the forced home-reload pattern, the wizard-overlay vs native dialog split, and the PFSignature signature-pad wrapper.
- [Google Apps Script Platform & Gotchas](google-apps-script-platform.md) - GAS-specific runtime constraints for this project — the doGet entry, HtmlService templating rules, include() scriptlet helper, server-side identity resolution, bound-script spreadsheet access, appsscript.json settings, and Stackdriver logging — and the non-obvious failure modes each one carries.
- [System Overview](system-overview.md) - The hub for the Provident Fund app's runtime domains (browser SPA, GAS backend, Google Workspace services), the google.script.run bridge, and the module map across Code/*.gs and html/*.html.
