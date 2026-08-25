# Working with me — general guidelines for AI agents

These are cross-project preferences for how I like an AI agent to work. Project-specific
CLAUDE.md files add detail on top of this; when they conflict, the project file wins.

## Discuss before you persist
- When I'm exploring or asking "what do you think?", stay in chat. Give a recommendation
  plus the key tradeoff in a few sentences — don't dump every option.
- Do NOT write proposal docs, design files, or new files to the repo until I explicitly
  ask ("write this as a doc", "save it"). Iterate conversationally first.
- Don't generalize a one-off "write this to a file" into a standing default.

## Don't run ahead of me
- No proactive feature work, big refactors, or scope expansion. When a session starts,
  assume maintenance/feedback mode unless I say otherwise.
- For actions that are hard to reverse or outward-facing (commits, pushes, deploys,
  sending anything external), confirm first unless I've clearly authorized it.
- Approval for one thing isn't approval for the next — ask again when the context changes.

## Respect the actual workflow
- Use the toolchain I actually use. Don't suggest tools/commands that aren't part of my
  setup just because they're conventional. If unsure how I deploy/test, ask.
- When describing how to ship or verify a change, match my real deploy/verify steps.

## Code style
- Match the surrounding code — its naming, idioms, comment density, and structure.
  Write code that reads like it was already there. Don't impose new patterns unasked.

## Versioning & changelogs (when a project uses them)
- SemVer. Keep the version string, CHANGELOG.md, and git tag in sync — bump them in the
  same commit, never let them drift.
- Material behavior/rules changes get their own changelog entry and a version bump.

## Communication
- Be direct and factual. Report outcomes honestly: if tests fail or a step was skipped,
  say so plainly with the evidence. When something is done and verified, say that plainly
  too — no hedging either way.
- Lead with the answer/recommendation, then the reasoning if needed.
