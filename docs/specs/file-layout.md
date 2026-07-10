# Spec: Repository file layout — consolidate under `.nightwatch/`

- **Status:** accepted 2026-07-10 — **folded into `nightwatch.md`** §2.2, §2.4, §2.7, §5, §6
  (safety rules), and §7 (FR48–FR50 in the epics requirements inventory). Implementation
  pending (Epic 7 candidate).
- **Motivated by:** dogfooding finding
  [0008 — Root-artifact footprint](../dogfooding/0008-root-artifact-footprint.md)
- **Scope:** *where* Nightwatch writes its artifacts, and a backward-compatible migration to a
  consolidated layout. No change to the *content* or *format* of any artifact (`STATE.md`'s
  single-fenced-yaml-block contract, `RELEASE.md`'s human-editable byte-preserved format, the
  tracker's single-writer rule) — only their location, plus the config key and migration that
  make the move safe.

## Problem

Nightwatch scatters artifacts across the repository root: `STATE.md` (init), `RELEASE.md` (the
tracking store), an edit to the project's root `.gitignore` (init adds `.nightwatch/out/`), and a
transient `RELEASE.md.tmp-<pid>` during each atomic write — while `config.yaml` and everything else
Nightwatch owns already live under `.nightwatch/`. The split is inconsistent (two declarations,
`STATE.md` and `config.yaml`, live in different places), makes the repo look untidy, and makes
cleanup a scavenger hunt instead of `rm -rf .nightwatch/`. See finding 0008 for the full survey and
per-artifact evaluation.

## Design constraints (invariants this spec must not break)

1. **Backwards compatible.** Existing installs have `STATE.md`/`RELEASE.md` at the root and a
   `.nightwatch/out/` line in the root `.gitignore`. They must keep working with **no** required
   action: readers fall back to the legacy root paths.
2. **Never move or destructively edit user files without consent.** Relocating an existing
   `STATE.md`/`RELEASE.md` happens only at `init`, only after a human confirms. The user's root
   `.gitignore` is never rewritten to *remove* a legacy line.
3. **Content and formats are unchanged.** Only locations move; `STATE.md`'s yaml block and
   `RELEASE.md`'s human-edited content are byte-preserved through any migration.
4. **Config stays optional.** An absent `config.yaml` still yields sensible defaults — release
   report under `.nightwatch/`, zero Nightwatch-owned root files.
5. **Single-writer contract preserved.** `RELEASE.md` continues to be written only through the
   tracking store; this spec changes the *path* the store resolves, not who writes it.

## Target layout (the invariant)

- **Repo root:** the `.nightwatch/` directory, and **zero** Nightwatch-owned files by default. The
  **only** permitted root artifact is an opt-in `RELEASE.md` (P3) — "at most one," on purpose.
- **`.nightwatch/`:** `config.yaml`, `STATE.md`, `state.json`, `MORNING.md`, `RELEASE.md` (default
  location), `briefs/`, `out/`, `ledger.jsonl`, `.gitignore`, `extractor-setup.json`.

## Proposals

### P1 — `STATE.md` moves to `.nightwatch/STATE.md`, with backward-compatible reads

- **Write:** `init` writes the declaration to `.nightwatch/STATE.md` (change `DECLARATIONS` in
  `scripts/lib/init.js` from `dest: 'STATE.md'` to `dest: '.nightwatch/STATE.md'`). Sits beside
  `config.yaml`, its sibling declaration.
- **Read:** `loadConfig` (`scripts/lib/config.js`) resolves `STATE.md` with precedence
  **`.nightwatch/STATE.md` → root `STATE.md`** (legacy fallback). The first that exists is parsed;
  the resolved path is recorded in the loaded config's `sources` for reporting.
- **Tracked, not ignored:** `.nightwatch/STATE.md` stays git-tracked — only `.nightwatch/out/` is
  ignored (P4) — so the declaration remains versioned exactly as today.

### P2 — Configurable `release_path`, defaulting under `.nightwatch/`

- New optional config key **`release_path`** (repo-relative), default **`.nightwatch/RELEASE.md`**.
  Set it to `RELEASE.md` (root) or e.g. `docs/RELEASE.md` for projects that want the conventional
  public deliverable.
- The tracking store resolves its write/read target from `release_path` instead of the hardcoded
  `path.join(repo, 'RELEASE.md')` (`scripts/lib/tracker.js`); `release-progress.js` and
  `collect-brief.js` read through the same resolved path.
- **Backward-compatible read/adopt:** if the resolved `release_path` file is absent **and** a legacy
  root `RELEASE.md` exists, the store reads/adopts the legacy file (so an existing install keeps its
  history) until migration (P5) relocates it.
- The atomic-write temp (`writeAtomic`: `file + '.tmp-<pid>'`) is created beside the *resolved*
  target, so it stops appearing in the root once the default path is under `.nightwatch/`.

### P3 — Nested `.nightwatch/.gitignore` instead of editing the root `.gitignore`

- Ship/create **`.nightwatch/.gitignore`** containing `out/` (git honors nested ignore files), so
  the transient per-run artifact dir is ignored **without touching the project's root
  `.gitignore`**. `init`'s `ensureGitignore` writes the nested file instead of appending to root.
- **Non-destructive back-compat:** a legacy `.nightwatch/out/` line already in a root `.gitignore`
  is harmless and is **left in place** (never auto-removed).

### P4 — One-time, human-confirmed migration during `init`

- `init` detects legacy root artifacts (`STATE.md`, `RELEASE.md`, a `.nightwatch/out/` line in root
  `.gitignore`) and, when present, **offers a single confirmed migration**: move `STATE.md` →
  `.nightwatch/STATE.md` and `RELEASE.md` → the resolved `release_path`, byte-for-byte (prefer
  `git mv` when the file is tracked so history follows; fall back to content-preserving move).
- **Confirmation required.** Declining leaves the files in place; the P1/P2 fallback reads keep the
  install fully functional, so migration is a convenience, never a lock.
- Deterministic and idempotent: re-running after migration finds nothing to move and never clobbers
  an already-relocated file.

### P5 — Write-surface and documentation updates

- Update the normative write surface in `commands/nightwatch.md` (safety rules): from
  "`.nightwatch/**`, `RELEASE.md`, patch files under `.nightwatch/out/`, …" to
  "**`.nightwatch/**`** (now holding `STATE.md`, `RELEASE.md` by default, config, briefs, ledger,
  state), the configured **`release_path`** when set outside `.nightwatch/`, and opt-in
  `nightwatch/*` branches." `init` remains the only writer of the declaration files.
- Update `README.md`, `docs/install.md`, and `templates/config.yaml` (document `release_path`) to
  describe the consolidated layout and the "zero root files by default" invariant.

## Non-goals

- No change to `STATE.md`/`RELEASE.md` content formats, the yaml-block contract, or the tracker's
  single-writer rule — only location and resolution.
- No moving of the user's own (non-Nightwatch) files, ever.
- No automatic removal of a legacy `.nightwatch/out/` line from a user's root `.gitignore`.
- No relocation without explicit `init`-time confirmation.

## Acceptance criteria

1. A fresh `init` + overnight run on a clean repo leaves **zero** Nightwatch-owned files in the
   repo root (only the `.nightwatch/` directory); with `release_path: RELEASE.md` set, exactly one
   (`RELEASE.md`).
2. `loadConfig` reads declarations from `.nightwatch/STATE.md` when present, falls back to a legacy
   root `STATE.md`, and prefers the `.nightwatch/` copy when both exist.
3. The tracking store writes and reads `RELEASE.md` at the resolved `release_path` (default
   `.nightwatch/RELEASE.md`); an existing root `RELEASE.md` is still read until migrated, and its
   content is byte-preserved.
4. `init` creates `.nightwatch/.gitignore` (ignoring `out/`) and does **not** modify the project's
   root `.gitignore`.
5. On a repo with legacy root `STATE.md`/`RELEASE.md`, `init` offers a confirmed migration; on
   confirm the files move (history preserved for tracked files) and their content is unchanged; on
   decline nothing moves and all reads still succeed.
6. The atomic-write temp file for `RELEASE.md` appears beside the resolved target, never in the
   root when the target is under `.nightwatch/`.
7. An existing install (root `STATE.md`/`RELEASE.md`, root `.gitignore` line) continues to work with
   no migration and no behavior change.

## Tests

- **config:** `.nightwatch/STATE.md` parsed; legacy root `STATE.md` fallback; `.nightwatch/` wins
  when both exist; `sources` records which was read.
- **tracker:** resolves `release_path` (default under `.nightwatch/`); root opt-in via config;
  adopts a legacy root `RELEASE.md` when the resolved path is absent; content byte-preserved across
  a parse→serialize round trip after relocation; temp file lands beside the resolved target.
- **init:** writes `STATE.md` under `.nightwatch/`; creates `.nightwatch/.gitignore`; leaves the
  root `.gitignore` untouched; migration moves legacy root files on confirm (byte-identical) and
  leaves them on decline; migration is idempotent.
- **layout invariant:** fresh install → zero root Nightwatch files (directory-only); `release_path:
  RELEASE.md` → exactly one.
- **back-compat:** a fixture mirroring a pre-change install runs unchanged with no migration.
