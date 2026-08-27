# Files

- [Data Migration Toolchain](data-migration.md) - The gitignored Python toolchain in Data/ that reconstructs the Enrollments sheet from Master.xlsx for hand-import — build.py (emits Migration_Build.xlsx with Enrollments plus build-aid sheets, the count-rule and dedup decisions, cooldown math against a fixed TODAY), its companion verify/inspect/check_lpc/stack_update scripts, and the MIGRATION.md golden rules (sacred headers, real dates, numbers-as-numbers, trimmed IDs, Allstars_ID join key).
- [Deployment, Configuration & Operations](deployment-config.md) - How the Provident Fund web app ships to Google Apps Script via clasp, what the .claspignore syncs, the Script Properties config surface, the maintenance-mode switch, and the GitHub Actions OpenWiki update workflow.
