# Nightwatch

Portable [Claude Code](https://claude.com/claude-code) plugin for unattended overnight
repository review. While you sleep, it runs three read-mostly jobs on a schedule —
**consistency reconciliation**, **architecture review**, and **release-progress tracking** —
and compresses their output into one capped, ranked morning brief:
**`.nightwatch/MORNING.md`**, the one file to open.

**It never writes code, never pushes, and never publishes.** Its deliverables are findings,
patches-as-proposals, and a maintained `RELEASE.md`.

The operating principle: the bottleneck is your morning attention, not tokens. The brief is
capped (25 entries by default), ranked, and every judgment finding must survive an adversarial
verification pass before it earns a line. A job whose findings you ignore two runs in a row is
flagged for retirement.

## Who it's for

Nightwatch is for the maintainer of an actively developed repository — especially AI-assisted,
spec-driven development, where code, specs, and docs drift apart faster than anyone re-reads
them — who has a few minutes of morning attention to spend on a capped brief, and who already
has CI and tests covering correctness. It is **not** a linter, a security scanner, or a
PR-review bot: it reviews the repository's consistency and trajectory overnight, not your
diffs on push.

## Quickstart

Prerequisites: Node.js ≥ 18, Claude Code, and a git repository to review.

```bash
# 1. Get Nightwatch and install its one dependency (js-yaml)
git clone <this-repo> ~/tools/nightwatch
cd ~/tools/nightwatch && npm install --omit=dev

# 2. Load the plugin into a Claude Code session, from the repo you want reviewed
cd ~/your/project
claude --plugin-dir ~/tools/nightwatch
```

Then, inside that session (plugin commands are namespaced — see [Commands](#commands)):

```text
# 3. One-time daytime setup — interactive; see "What init does" below
/nightwatch:nightwatch init

# 4. Run the watch (or schedule it — see below)
/nightwatch:nightwatch
```

The first run is the expensive one: with no prior state, every job is due and every signal is
computed from scratch to establish the repository baseline, so expect it to take several
minutes. Later runs are cheaper — the cadence skips jobs that aren't due, and the ledger
carries memory forward.

Next morning, open **`.nightwatch/MORNING.md`**. Mark entries `[x]` (acted-on) or `[-]`
(dismissed) — the next run reads your marks back into its ledger and adjusts what it shows you.

Schedule `/nightwatch:nightwatch` to run nightly, e.g. with Claude Code's `/loop` or a cron
routine. Runs are idempotent per date: a second run the same night is a no-op unless you pass
`--force`.

For permanent installation (plugin marketplace registration or a symlink-based setup with
`NIGHTWATCH_ROOT`), see **[docs/install.md](docs/install.md)**.

## Commands

Installed as a plugin (Quickstart, or install.md Option A), Claude Code namespaces the
commands by plugin name:

| Command | Role | Default cadence |
|---|---|---|
| `/nightwatch:nightwatch` | Orchestrator: run what's due, emit one brief — the scheduled entrypoint | nightly |
| `/nightwatch:nightwatch init` | Interactive daytime setup; the only mode that asks questions | on demand |
| `/nightwatch:repo-reconcile` | spec ↔ docs ↔ code consistency; reports disagreements and, where authority is declared, the fix direction | nightly |
| `/nightwatch:arch-review` | architecture drift, overengineering, hidden coupling, layering violations | weekly |
| `/nightwatch:release-progress` | maintains `RELEASE.md`, the path-to-release tracker | nightly |

With the symlink install ([install.md](docs/install.md) Option B), the same commands appear
un-namespaced: `/nightwatch`, `/repo-reconcile`, `/arch-review`, `/release-progress`.

All commands accept `[--repo .] [--force]`.

### What `init` does

`/nightwatch:nightwatch init` is a daytime, interactive, safe-to-re-run setup. Concretely, it:

1. **Probes extractor adapters** (read-only) and, for detected-but-missing tools, hands you
   the install command — the only moment Nightwatch ever suggests installing anything.
2. **Interviews you** for the declarations no tool can infer: source-of-truth authority per
   area, project phase, release target and definition of done, optional layering rules.
3. **Writes `.nightwatch/STATE.md` and `.nightwatch/config.yaml`** from templates — only where
   absent; existing files (including a legacy root `STATE.md`) are never clobbered — and ignores
   `.nightwatch/out/`. Nightwatch keeps its files under `.nightwatch/` and writes zero files to the
   repo root by default (the only opt-in root artifact is `RELEASE.md`, via `release_path`).
4. **Dry-runs the jobs once** and shows you your first brief while you're there to review it.

Init is optional but not cosmetic. **Without it, Nightwatch runs in a degraded,
detection-only mode:** with no declared authority it can report *that* spec, docs, and code
disagree, but not which side is wrong or the fix direction; with no declared release
definition, `RELEASE.md` tracking is generic; and each undeclared input takes a brief slot as
a one-line setup finding. Init is what unlocks fix directions, release tracking against your
own definition of done, and a quieter brief.

## How a night runs

1. **Precondition** — must be a git checkout; otherwise a one-line stub brief explains why
   nothing ran. You wake to an explanation, never silence.
2. **Plan** — the orchestrator decides which jobs are due per their cadence. Independent jobs
   may run **concurrently** as separate subagents (seeing several background agents at once is
   normal); only `release-progress` is order-constrained — it always runs last, because it
   consumes the night's findings.
3. **Signals** — each job's deterministic script gathers evidence, delegating language-aware
   analysis to mature extractors ([dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
   for Node, [import-linter](https://import-linter.readthedocs.io/) for Python) when available,
   and falling back to universal git-history and file-tree signals when not. Degradation is
   always stated in the brief, never silent.
4. **Judgment + adversarial verify** — a Claude subagent interprets the signals; a second
   subagent tries to refute each finding. Only survivors are marked `verified` and enter the
   brief.
5. **Brief assembly** — deterministic, capped, ranked. Overflow goes to an appendix, not your
   attention.

## Configuration

Two optional repo-local files, both drafted for you by `init` (see
[What `init` does](#what-init-does)). Every command runs with neither, in the degraded
detection-only mode described above — undeclared inputs become one-line setup findings, never
guesses.

- **`.nightwatch/STATE.md`** — human declarations no tool can infer: which artifact is the
  source of truth per area, project phase, release target and definition of done, optional
  layering rules. A legacy root `STATE.md` is still read (the nested copy wins when both exist).
  Template: [`templates/STATE.md`](templates/STATE.md).
- **`.nightwatch/config.yaml`** — operational config: cadences, token budgets, brief caps,
  ignore globs, extractor selection. Every key is optional.
  Template with defaults: [`templates/config.yaml`](templates/config.yaml).

## What lands in your repo

Everything lives under `.nightwatch/` (the single home — zero Nightwatch files in the repo root
by default). Each file answers four questions — **edit?** · **owner** · **safe to delete?** ·
**committed?** — grouped by when you'd open it. `init` writes a `.nightwatch/README.md` with this
same four-column map, so the directory explains itself.

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

Two deletion subtleties, the same the directory README states:

- Everything under `runtime/` is disposable — safe to delete; deleting it only resets cadence.
- `ledger.jsonl` is Nightwatch's memory — deleting it is not safe; it lives outside `runtime/` for
  that reason.

`MORNING.md` is a byte-identical copy of the newest file in `briefs/` — open `MORNING.md`, commit
`briefs/`, never read both. `STATE.md` is yours; `runtime/cursors.json` is the machine's scheduling
cursor — unrelated despite the old name. Commit the briefs and the ledger (the system's memory); the
nested `.gitignore` ignores `runtime/` for you (`/nightwatch init` writes it).

`RELEASE.md` can be relocated to the repo root (or elsewhere, e.g. `docs/`) via `release_path` for
projects that want it as a public deliverable — the one opt-in exception to the single home.

## Safety model

- **Read-mostly.** The entire write surface is `.nightwatch/**`, `RELEASE.md`, patch files
  under `.nightwatch/out/`, and — only if you opt in with `patch_branch: true` — `nightwatch/*`
  branches created in a temporary worktree. Your current branch and working tree are never
  touched; mechanical fixes are emitted as patch files, proposals you apply yourself.
- **No network.** No pushes, no PRs or issues, no external posts, no API keys required.
- **Trust is the asset.** Adversarial verification before the brief; the two-strikes demotion
  rule after it.

## Development

```bash
npm test           # typecheck (tsc --noEmit) + run test/run.js
npm run typecheck  # typecheck only
```

The scripts are single-file Node CLIs (CommonJS, `// @ts-check` JSDoc types, no build step).
The test runner is dependency-free: each `test/*.test.js` exports `{name: fn}`; a throw is a
failure.

## Documentation

- [docs/install.md](docs/install.md) — installation options and first run, in detail
- [nightwatch.md](nightwatch.md) — the full implementation spec: design principles,
  architecture, command specs, file formats, acceptance criteria
- [scripts/extractors/README.md](scripts/extractors/README.md) — the extractor adapter contract

## License

[MIT](LICENSE)
