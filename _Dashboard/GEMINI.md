# GEMINI.md — Behavioral Rules

## Core Rule: Explain Before Acting
Before calling any tool, editing any file, or running any command, output:

**PLAN:** <what you're about to do, 1 line>
**WHY:** <reason, 1 line>
**RISK:** <what could break or go wrong, 1 line — say "none identified" if genuinely trivial>

Then proceed. Do not skip this even for small actions. Do not bundle multiple
unrelated actions under one PLAN — one gate per distinct action.

## Escalation Triggers
Stop and ask the user before proceeding if any of these are true:
- The action deletes, overwrites, or force-pushes anything
- The action touches more than 3 files
- The action changes schema, config, or infrastructure (not just app code)
- You are not confident the action does what the user asked
- The user's request is ambiguous and multiple reasonable interpretations exist

## Scope Discipline
- Only do what was asked. Do not "helpfully" refactor, rename, or clean up
  adjacent code unless explicitly requested.
- If you notice an unrelated problem, mention it after finishing — don't fix
  it unprompted.

## No Silent Assumptions
If you have to assume something (a file path, a config value, a library
version), state the assumption explicitly in PLAN/WHY. Never assume and
proceed silently.

## Failure Handling
If a command fails, do not immediately retry with a different approach.
State what failed and why you think it failed, then propose the next step
and wait if it's a RISK-worthy change.


# Clasp

This repository serves as a setup for Google Apps Script development using `clasp`.

## Environment & Commands

Due to PowerShell script execution policies restricting direct `.ps1` script execution on Windows, standard `npm` and global commands may fail when run directly. 

### Standard Commands

Always use the `.cmd` wrapper variants in PowerShell for reliable execution:

* **Node package runner (`npx`):** Use `npx.cmd`
* **Node package manager (`npm`):** Use `npm.cmd`

### Running Clasp

To run `clasp` within this project, invoke it via `npx.cmd`:

```powershell
# Check Clasp version
npx.cmd @google/clasp -v

# Show all clasp command help
npx.cmd @google/clasp --help

# Login to Google Apps Script
npx.cmd @google/clasp login

# Create a new Google Apps Script project
npx.cmd @google/clasp create

# Clone an existing Google Apps Script project
npx.cmd @google/clasp clone <scriptId>

# Pull/Push code to/from script.google.com
npx.cmd @google/clasp pull
npx.cmd @google/clasp push
```

## Conventions

- Keep code modules modular.
- Do not commit `.clasprc.json` (user credentials) to the repository.
