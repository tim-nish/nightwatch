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

There are two ways to install Nightwatch. Every command prompt resolves its own script root the
same way regardless of which one you use: it prefers `${CLAUDE_PLUGIN_ROOT}` (set by Claude Code
when a command runs as part of a registered plugin), falls back to `${NIGHTWATCH_ROOT}` (set by
you, below), and refuses to run — with a clear setup message — if neither is set. There are no
hardcoded paths.

### Option A — plugin registration

No public marketplace is required for any of these. Claude Code sets `${CLAUDE_PLUGIN_ROOT}` at
runtime for every command it runs, so no further setup is needed. Pick whichever fits:

- **Direct, no installation:** `claude --plugin-dir ~/tools/nightwatch` loads the plugin for the
  session; `/reload-plugins` picks up edits without restarting.
- **Local marketplace:** `/plugin marketplace add <path>` where `<path>` is any directory or repo
  containing `.claude-plugin/marketplace.json` — a folder on your machine qualifies.
- **Private git marketplace:** `/plugin marketplace add <git-url>` (HTTPS or SSH, optionally
  pinned with `#branch` or `#tag`). Nothing is published anywhere public.

### Option B — local symlink (no plugin registration)

Use this if you want the `/nightwatch`, `/repo-reconcile`, `/arch-review`, and
`/release-progress` commands available as local Claude Code slash commands without registering
Nightwatch as a plugin.

1. Clone or copy this repository somewhere stable, e.g. `~/tools/nightwatch`, and install its
   dependency:
   ```
   cd ~/tools/nightwatch
   npm install --omit=dev
   ```
2. Symlink (or copy) its `commands/` markdown files into your Claude Code commands directory so
   they're picked up as local slash commands:
   ```
   mkdir -p ~/.claude/commands
   ln -s ~/tools/nightwatch/commands/nightwatch.md ~/.claude/commands/nightwatch.md
   ln -s ~/tools/nightwatch/commands/repo-reconcile.md ~/.claude/commands/repo-reconcile.md
   ln -s ~/tools/nightwatch/commands/arch-review.md ~/.claude/commands/arch-review.md
   ln -s ~/tools/nightwatch/commands/release-progress.md ~/.claude/commands/release-progress.md
   ```
   (Use a project-local `.claude/commands/` instead of the `~/.claude/commands/` global directory
   if you only want these commands available in one repo.)
3. Set `NIGHTWATCH_ROOT` to the path from step 1, so the commands can find their scripts and
   templates. Add this to your shell profile so it's always set:
   ```
   export NIGHTWATCH_ROOT="$HOME/tools/nightwatch"
   ```
4. Start a new Claude Code session (so it picks up both the symlinked commands and the
   `NIGHTWATCH_ROOT` environment variable) and run `/nightwatch init` from inside the repo you
   want reviewed.

If neither `CLAUDE_PLUGIN_ROOT` nor `NIGHTWATCH_ROOT` is set when a command runs, it stops
immediately with a setup message instead of guessing a path.

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
