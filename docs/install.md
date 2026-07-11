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

In this mode Claude Code namespaces the commands by plugin name: **`/nightwatch:nightwatch`**
(with init as `/nightwatch:nightwatch init`), **`/nightwatch:repo-reconcile`**,
**`/nightwatch:arch-review`**, **`/nightwatch:release-progress`**.

### Option B — local symlink (no plugin registration)

Use this if you want the commands available as local Claude Code slash commands without
registering Nightwatch as a plugin. In this mode they appear un-namespaced — `/nightwatch`,
`/repo-reconcile`, `/arch-review`, `/release-progress` — since they are plain local commands.

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

Commands provided (plugin-install name — Option B symlink installs get the un-namespaced form):

| Command | Role | Default cadence |
|---|---|---|
| `/nightwatch:repo-reconcile` | spec ↔ docs ↔ code consistency | nightly |
| `/nightwatch:arch-review` | architecture drift & overengineering | weekly |
| `/nightwatch:release-progress` | maintain `RELEASE.md` | nightly |
| `/nightwatch:nightwatch` | orchestrator: run what's due, emit one brief | nightly (scheduled entrypoint) |

## First run

1. `/nightwatch:nightwatch init` (Option B: `/nightwatch init`) — a daytime, interactive
   setup that drafts the two optional repo-local files with you present:
   - **`STATE.md`** (repo root) — declarations no tool can infer: source-of-truth authority per
     area, project phase, release target and definition of done, optional layering rules.
   - **`.nightwatch/config.yaml`** — operational config (budgets, caps, cadences, ignore globs).
     Every key is optional; an absent or empty file is valid.
2. Both files are optional. Every command runs with neither and **degrades gracefully**:
   undeclared inputs become one-line setup findings, never guesses.
3. Schedule `/nightwatch:nightwatch` (Option B: `/nightwatch`) nightly (e.g. via `/loop` or a
   cron routine). It runs what's due and writes tomorrow morning's brief to
   **`.nightwatch/MORNING.md`** — the one file to open.

## What lands in your repo

Everything lives under `.nightwatch/` (the single home — zero Nightwatch files in the repo root
by default). Each file answers four questions — **edit?** · **owner** · **safe to delete?** ·
**committed?** — grouped by when you'd open it. `init` writes a `.nightwatch/README.md` carrying this
same four-column map.

**Read (morning)**

| file | edit? | owner | safe to delete? | committed? |
|------|-------|-------|-----------------|------------|
| `MORNING.md` | no | machine | yes — rewritten next run | no |
| `runtime/out/*.patch` | no | machine | yes | no |

**Edit (daytime — overnight runs never rewrite your content)**

| file | edit? | owner | safe to delete? | committed? |
|------|-------|-------|-----------------|------------|
| `STATE.md` | yes | you | no — your declarations | yes |
| `config.yaml` | yes | you | no — your knobs | yes |
| `RELEASE.md` | yes — the Notes tail | shared | no | yes |

**Machine memory (never open)**

| file | edit? | owner | safe to delete? | committed? |
|------|-------|-------|-----------------|------------|
| `briefs/<date>.md` | no | machine | no — memory | yes |
| `ledger.jsonl` | no | machine | **no — destroys memory** | yes |
| `runtime/` (`cursors.json`, `out/*.json`) | no | machine | **yes — resets cadence only** | no |

Two deletion subtleties: everything under `runtime/` is disposable — safe to delete; deleting it
only resets cadence. `ledger.jsonl` is Nightwatch's memory — deleting it is not safe; it lives
outside `runtime/` for that reason. `STATE.md` is yours; `runtime/cursors.json` is the machine's
scheduling cursor — unrelated despite the old name. The nested `.gitignore` ignores `runtime/` for
you (`init` writes it). Commit the briefs and the ledger — they are the system's memory.

## Safety model

- Read-mostly. The entire write surface is `.nightwatch/**`, `RELEASE.md`, patch files under
  `.nightwatch/out/`, and opt-in `nightwatch/*` branches created in a temporary worktree. Your
  current branch and working tree are never touched.
- No network, no pushes, no PRs/issues, no external posts.
- Judgment findings pass an adversarial verify step before reaching the brief; a job whose
  findings you ignore two runs running is flagged for retirement.
