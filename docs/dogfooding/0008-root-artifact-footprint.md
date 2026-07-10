# Dogfooding finding 0008 — Nightwatch scatters files in the repo root; consolidate under `.nightwatch/`

- **Date:** 2026-07-10
- **Session:** second dogfooding round — running Nightwatch on a *different* repository, observing
  what it leaves in the repo root.
- **Command:** `/nightwatch init` and the overnight flow (`release-progress`).
- **Classification:** design / file-layout issue — everything behaves as specified; the concern is
  *where* Nightwatch's artifacts land and how tidy (and cleanly removable) they are.
- **Status:** documented, with an evaluation and recommendation below. No changes implemented.

## Observed behavior

Nightwatch writes and edits several things directly in the **repository root**, alongside the
user's own project files:

- **`STATE.md`** — created by `init` (`scripts/lib/init.js`, `DECLARATIONS` → `dest: 'STATE.md'`).
  A Nightwatch-owned declaration (authority, phase, release target, layers).
- **`RELEASE.md`** — created and maintained by the tracking store
  (`scripts/lib/tracker.js` → `writeAtomic(path.join(repo, 'RELEASE.md'))`). The living
  distance-to-release deliverable.
- **`.gitignore`** — *edited* by `init` (`ensureGitignore`) to add `.nightwatch/out/`, creating the
  file if the repo has none.
- **`RELEASE.md.tmp-<pid>`** — a transient temp file that appears in the root for the duration of
  each atomic `RELEASE.md` write (`writeAtomic` writes `file + '.tmp-<pid>'` next to the target).

Everything else Nightwatch owns already lives under **`.nightwatch/`**: `config.yaml`, `state.json`,
`MORNING.md`, `briefs/`, `out/` (findings, signals, run-status, emitted patches, transient extractor
configs), `ledger.jsonl`, and `extractor-setup.json`.

## Why this matters

- **Repository tidiness.** A tool that reviews *other people's* repos should keep its own footprint
  minimal. Two extra top-level files plus a `.gitignore` edit is more root clutter than the design's
  "read-mostly, unobtrusive" ethos implies.
- **Cleanup should be trivial.** The promise of a dedicated `.nightwatch/` directory is that
  removing Nightwatch is `rm -rf .nightwatch/`. Today that leaves `STATE.md`, `RELEASE.md`, and a
  `.gitignore` line behind — cleanup is a scavenger hunt instead of one delete.
- **Clear separation of ownership.** Operational data (state, config, briefs, ledger) is Nightwatch's;
  it should sit visibly apart from the project's own artifacts, not interleaved in the root.
- **The layout is already inconsistent.** `config.yaml` — also a Nightwatch-owned declaration — lives
  at `.nightwatch/config.yaml`, but its sibling declaration `STATE.md` sits in the root. There's no
  principled reason the two declarations live in different places.

## Preference

At most **one** Nightwatch-owned file in the repository root — ideally **none** — with all state,
reports, configuration, and metadata under a single `.nightwatch/` directory (the `.nightwatch/`
directory itself being the one acceptable top-level entry). This keeps repos tidy, makes cleanup a
single delete, and cleanly separates project artifacts from Nightwatch's operational data.

## Evaluation — should the file layout be revised?

**Yes.** Per-artifact assessment:

- **`STATE.md` → move to `.nightwatch/STATE.md`.** It's currently at root "deliberately: it's a
  contract with humans too" (`nightwatch.md` §2.7). But being human-editable and versioned does not
  require being in the root — `config.yaml`, an equally human-facing declaration, already lives under
  `.nightwatch/` and is edited there without issue. Moving `STATE.md` beside it is **low cost** (only
  loss: a little root-level discoverability, recovered by `init` printing its path and the README
  pointing to it) and it stays git-tracked (only `.nightwatch/out/` is ignored). This is the single
  biggest reduction in root footprint.
- **`.gitignore` edit → replace with a nested `.nightwatch/.gitignore`.** Git honors nested ignore
  files, so `.nightwatch/.gitignore` containing `out/` achieves the same result **without ever
  touching the project's root `.gitignore`.** Eliminates an edit to a project-owned file outright.
- **`RELEASE.md` → make its path configurable; default it under `.nightwatch/`.** This is the one
  genuine tension: `RELEASE.md` is conventionally a **root-level project deliverable** (like
  `CHANGELOG.md`/`README.md`) that humans browsing the repo expect to find, so hiding it reduces its
  value as a public "distance to release" doc. Resolve it with a `release_path` config key
  (default `.nightwatch/RELEASE.md` → **zero** root files out of the box; set to `RELEASE.md` or
  `docs/RELEASE.md` to keep the conventional deliverable). The transient `RELEASE.md.tmp-<pid>`
  follows the target's directory, so it stops appearing in the root automatically.

**Resulting target layout:**

- Root: the `.nightwatch/` directory, and **zero** Nightwatch-owned files by default — with
  `RELEASE.md` at root as the single **opt-in** exception for projects that want it as a public
  deliverable ("at most one," on purpose).
- `.nightwatch/`: `config.yaml`, `STATE.md`, `state.json`, `MORNING.md`, `RELEASE.md` (default),
  `briefs/`, `out/`, `ledger.jsonl`, `.gitignore`, `extractor-setup.json`.

**Cost / migration (why this needs a spec, not a quick patch):**

- **Back-compat.** Existing installs have `STATE.md`/`RELEASE.md` at root. Config loading and the
  tracker must read from the new location **and** fall back to the legacy root path (precedence:
  `.nightwatch/STATE.md` then root `STATE.md`), and `init` should offer a one-time, human-confirmed
  move of any root-level `STATE.md`/`RELEASE.md` into `.nightwatch/`.
- **Documented write surface.** `commands/nightwatch.md`'s safety rules list `RELEASE.md` explicitly;
  that becomes `.nightwatch/**` plus the optionally-configured `release_path`.
- **Precedent to preserve.** Keep `STATE.md`'s single-fenced-yaml-block contract and `RELEASE.md`'s
  human-editable, byte-preserved format unchanged — only the location moves.

## Risks (of leaving it as-is)

- Users perceive Nightwatch as messy on first contact — the opposite of the trust the design courts.
- Incomplete cleanup: uninstalling leaves orphan root files and a stray `.gitignore` line.
- The config.yaml-vs-STATE.md split confuses users about where declarations live and what to edit.

## Suggested improvements

1. Move `STATE.md` to `.nightwatch/STATE.md` (with legacy-root fallback + `init` migration).
2. Replace the root `.gitignore` edit with a shipped `.nightwatch/.gitignore`.
3. Add a `release_path` config key; default `RELEASE.md` under `.nightwatch/`, opt-in to root.
4. State the target as an invariant: **zero Nightwatch-owned root files by default; `.nightwatch/`
   is the single dedicated location; the only permitted root artifact is an opt-in `RELEASE.md`.**
