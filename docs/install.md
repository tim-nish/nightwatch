# Installing Nightwatch

Nightwatch is a portable Claude Code plugin for unattended overnight repository review. It
runs three read-mostly jobs on a schedule — consistency reconciliation, architecture review,
and release-progress tracking — and compresses their output into one capped, ranked morning
brief. **It never writes code, never pushes, and never publishes.**

## Requirements

- Node.js ≥ 18 (the scripts are single-file Node CLIs).
- `js-yaml` — the plugin's only dependency. Install once inside the plugin directory:
  ```
  npm install --omit=dev
  ```
- A git repository to run against (the jobs abort cleanly on a non-git directory).

## Install the plugin

Add the plugin directory to Claude Code as a plugin (via your plugin marketplace/config, or a
local path). Claude Code exposes `${CLAUDE_PLUGIN_ROOT}` at runtime; every script is invoked as
`node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.js --repo .`, so there are no hardcoded paths.

Commands provided:

| Command | Role | Default cadence |
|---|---|---|
| `/repo-reconcile` | spec ↔ docs ↔ code consistency | nightly |
| `/arch-review` | architecture drift & overengineering | weekly |
| `/release-progress` | maintain `RELEASE.md` | nightly |
| `/nightwatch` | orchestrator: run what's due, emit one brief | nightly (scheduled entrypoint) |

## First run

1. `/nightwatch init` — a daytime, interactive setup that drafts the two optional repo-local
   files with you present:
   - **`STATE.md`** (repo root) — declarations no tool can infer: source-of-truth authority per
     area, project phase, release target and definition of done, optional layering rules.
   - **`.nightwatch/config.yaml`** — operational config (budgets, caps, cadences, ignore globs).
     Every key is optional; an absent or empty file is valid.
2. Both files are optional. Every command runs with neither and **degrades gracefully**:
   undeclared inputs become one-line setup findings, never guesses.
3. Schedule `/nightwatch` nightly (e.g. via `/loop` or a cron routine). It runs what's due and
   writes tomorrow morning's brief to **`.nightwatch/MORNING.md`** — the one file to open.

## What lands in your repo

```
STATE.md              # human declarations (drafted by /nightwatch init)
RELEASE.md            # maintained by /release-progress
.nightwatch/
  config.yaml         # optional operational config
  MORNING.md          # latest brief — open this
  briefs/<date>.md    # dated briefs (committed — they're memory)
  ledger.jsonl        # every finding ever, with acted-on/dismissed marks
  state.json          # cadence cursors, last-run dates
  out/                # transient per-run JSON + patch files (gitignore this)
```

Add `.nightwatch/out/` to your `.gitignore`. Commit the briefs and the ledger — they are the
system's memory.

## Safety model

- Read-mostly. The entire write surface is `.nightwatch/**`, `RELEASE.md`, patch files under
  `.nightwatch/out/`, and opt-in `nightwatch/*` branches created in a temporary worktree. Your
  current branch and working tree are never touched.
- No network, no pushes, no PRs/issues, no external posts.
- Judgment findings pass an adversarial verify step before reaching the brief; a job whose
  findings you ignore two runs running is flagged for retirement.
