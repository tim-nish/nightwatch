# Spec: Runtime layout — one disposable `runtime/` boundary, a commit-policy probe, and layout upgrades that reach existing installs

- **Status:** accepted 2026-07-11 — **folded into `nightwatch.md`** §2.4, §6, §7,
  refining [file-layout](file-layout.md) (0008) and
  [output-file-taxonomy](output-file-taxonomy.md) (0017; its P6 rename-deferral is now
  exercised). **FR assignment deferred.** Layout depth chosen by the maintainer
  2026-07-11: **minimal split — `runtime/` only**.
- **Motivated by:** dogfooding finding
  [0024 — runtime vs user files](../dogfooding/0024-runtime-vs-user-files.md), including
  its forensic discovery: a host repo's blanket `.nightwatch/*` gitignore silently
  discarded the ledger and briefs — Nightwatch's memory — with no detection.
- **Scope:** where disposable state lives, how deletion/commit semantics become
  structural, one probe, one nudge, and the orientation README's content. No change to
  which files exist conceptually, the tracker/ledger formats, or the write-surface
  rules beyond the paths named here.

## Problem

`.nightwatch/` is flat: human declarations, committed machine memory, and disposable
runtime state sit side by side, with opposite answers to "may I edit / delete / commit
this?" carried only in prose the user may never see (0024). Concretely: `state.json`
read as possibly-important, possibly-disposable; and the commit-policy ambiguity had
already inverted the design silently (the entire directory gitignored, memory lost).

## P1 — `.nightwatch/runtime/`: the disposable unit

```
.nightwatch/
  README.md            # orientation (P5)
  MORNING.md           # read (morning)
  STATE.md  config.yaml  RELEASE.md     # edit (daytime)
  briefs/  ledger.jsonl                 # machine memory — committed, never edited
  .gitignore           # nested; now ignores runtime/
  runtime/             # DISPOSABLE — gitignored as a unit, safe to delete entirely
    cursors.json       # cadence cursors + last-run dates (was state.json)
    out/               # per-run JSON + patch files (unchanged content)
```

- **The boundary is the contract:** everything under `runtime/` is machine-owned,
  never committed, and safe to delete; nothing outside it is disposable. One directory
  answers "delete?" and "commit?" structurally.
- `state.json` → `runtime/cursors.json` — 0017's deferred rename lands as part of the
  move (the machine's cursor no longer name-collides with the human's `STATE.md`).
- The nested `.nightwatch/.gitignore` entry becomes `runtime/`; a legacy `out/` line is
  left in place, harmless.
- **Deleting `runtime/` must not re-trigger the first-run gate:** the gate condition
  (FR40) changes from "`state.json` absent" to "cursors absent **and** ledger absent" —
  a repo with a ledger is an existing install whose cursors were merely reset; the gate
  is for genuinely first runs. Deletion's only effects: cadence cursors reset (all jobs
  due) and same-night idempotency forgotten — stated in the orientation README.

## P2 — Migration and resolution (same discipline as 0008)

- **Readers resolve with fallback:** cursors at `runtime/cursors.json` → legacy
  `state.json`; per-run output at `runtime/out/` → legacy `out/`. All through the
  existing single path-resolution helpers; the resolved choice is recordable for
  reporting.
- **Writers:** new runs write to the `runtime/` paths; a legacy layout keeps working
  read-only until migrated.
- **`init` / `init --update`** offers the one-time, confirmed, content-preserving move
  (`state.json` → `runtime/cursors.json`; existing `out/` contents → `runtime/out/`)
  and rewrites the nested `.gitignore`; declining leaves everything functional via
  fallbacks. Overnight runs never migrate (unchanged rule).

## P3 — Commit-policy probe (would have caught 0024's damage)

At orchestrated-run start, one deterministic check: `git check-ignore` on the ledger
path and the briefs directory. Either ignored → one `setup` finding, stable id, exact
wording contract: names the file, the consequence, and the fix — *"`.gitignore` ignores
`.nightwatch/ledger.jsonl` — Nightwatch's memory (feedback, recurrence, demotion) will
not survive a clone; narrow the ignore to `.nightwatch/runtime/`."* Zero tokens, zero
network; no auto-editing of the user's `.gitignore` (NFR3 unchanged).

## P4 — Layout upgrades reach existing installs (the 0024 delivery gap)

When an orchestrated run detects an install predating the current layout contract —
orientation README absent, or legacy `state.json`/`out/` in use — it emits **one**
Machine-notes line pointing at `/nightwatch init --update` (config-drift style:
detection and reporting only, no overnight writes, at most one line per run). This is
the general mechanism for any future layout change, not a special case.

## P5 — Orientation README v2: the four-column map

`templates/nightwatch-readme.md` (FR65 mechanics unchanged: written by `init`,
recreated if deleted, never written overnight) is restructured around the four
questions from 0024 — per file: **edit? / owner / safe to delete? / committed?** — with
the three-tier when-to-open framing retained as grouping. It states the two deletion
subtleties explicitly (deleting `runtime/` resets cadence only; deleting `ledger.jsonl`
destroys memory) and carries the `STATE.md`/`cursors.json` disarming line updated for
the new name. Plugin `README.md` and `docs/install.md` layout blocks follow the same
structure (grep-guard tests as in 8.5).

## Supersession map

| Prior rule | Disposition |
|---|---|
| `state.json` at `.nightwatch/state.json` (FR31/§2.4) | superseded by P1 (`runtime/cursors.json`, legacy fallback read) |
| `out/` at `.nightwatch/out/` (§2.4, FR48-era layout) | superseded by P1 (`runtime/out/`, legacy fallback read) |
| nested `.gitignore` ignores `out/` (FR50) | superseded by P1 (ignores `runtime/`; legacy line tolerated) |
| first-run gate keyed on `state.json` absence (FR40) | amended by P1 (cursors **and** ledger absent) |
| output-file-taxonomy P6 (rename deferred) | exercised — rename lands with the move |
| FR65 orientation README (three-tier content) | content superseded by P5; write mechanics unchanged |

## Non-goals

- No `memory/` subdirectory — briefs and ledger stay at the top level (the chosen
  minimal split); revisit only if the four-column README fails dogfooding.
- No change to `MORNING.md`/`briefs/` copy semantics, `release_path`, `STATE.md`
  location, or the tracker/ledger formats.
- Never auto-edit the user's root `.gitignore`; the probe reports, the human fixes.

## Acceptance criteria

1. Fresh install: cursors and per-run output land under `runtime/`; the nested
   `.gitignore` ignores `runtime/`; `git status` shows briefs/ledger trackable and
   nothing under `runtime/`.
2. Legacy install (root-of-`.nightwatch` `state.json` + `out/`): every read succeeds via
   fallback with zero behavior change; `init --update` offers the confirmed move,
   content-preserved; declining stays fully functional; migration is idempotent.
3. Deleting `runtime/` on an install with a ledger: next run re-creates it, treats all
   jobs as due, and does **not** prompt the first-run gate; on a repo with no ledger the
   gate still fires.
4. With the ledger (or briefs dir) gitignored, the run emits exactly one setup finding
   with the P3 wording; a correctly-configured repo emits none.
5. An install missing the orientation README (or on legacy paths) gets exactly one
   Machine-notes nudge line pointing at `init --update`; a current install gets none.
6. The orientation README, plugin README, and install.md render the four-column map;
   grep-guards assert the column headings, the `runtime/`-is-disposable sentence, and
   the ledger-is-memory sentence.

## Tests

- Path resolution: new/legacy/mixed layouts for cursors and out; single-resolver
  behavior recorded.
- Migration: confirm/decline/idempotent re-run; content byte-preserved.
- Gate matrix: cursors×ledger presence (4 cases) → prompt/no-prompt.
- Probe: ignored-ledger, ignored-briefs, clean; stable finding id across nights.
- Nudge: README absent / legacy paths / current install.
- Docs grep-guards (as in 8.5, extended to the four columns).
