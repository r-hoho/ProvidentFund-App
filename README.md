# Provident Fund App

A mobile-first, bilingual (Thai / English) self-service web app for employees to manage their
company Provident Fund — check status, enroll, adjust contributions, manage beneficiaries, and
process withdrawals — built entirely on Google Apps Script and Google Sheets.

![status](https://img.shields.io/badge/status-BETA-orange)
![version](https://img.shields.io/badge/version-v0.2.0-blue)
![platform](https://img.shields.io/badge/platform-Google%20Apps%20Script-4285F4)

## Overview

The app gives employees a simple, phone-friendly interface for actions that were previously
manual, while producing the confirmation paperwork the process requires. It runs with **zero
external infrastructure** — Google Workspace handles identity, data, documents, and email.

## Features

- 📊 **Status dashboard** — membership status, contributions, and tenure at a glance
- 📝 **Guided enrollment** — a step-by-step wizard with in-app signature capture
- 👥 **Beneficiary manager** — add and update beneficiaries with full change history
- 💸 **Withdrawal flow** — clear eligibility and confirmation steps
- ✉️ **Confirmation emails** — bilingual, sent automatically after every action
- 📄 **Signed PDF letters** — generated from templates with the captured signature, archived automatically
- 📈 **Adoption analytics** — privacy-conscious usage metrics (pseudonymous)
- ⭐ **In-app feedback** — quick post-action star ratings

## Tech Stack

- **Frontend:** Vanilla JavaScript single-page app, [Pico.css](https://picocss.com/) for a
  lightweight, semantic, mobile-first UI
- **Backend:** Google Apps Script (`HtmlService` web app)
- **Data & services:** Google Sheets, Drive, Docs, Gmail, and GA4 (Measurement Protocol)

## Architecture

```
Browser (mobile-first SPA)
        │  google.script.run
Google Apps Script backend
        │
Google Sheets · Drive · Docs · Gmail · GA4
```

The frontend is composed from HTML partials via Apps Script templating; the backend is split by
responsibility (profile, actions, email, letters, analytics). All client–server communication uses
the `google.script.run` bridge — no external API layer.

## Status

Live in **BETA** (`v0.2.0`). See [`CHANGELOG.md`](./CHANGELOG.md) for release history.

## License

Internal project — not licensed for external use.
