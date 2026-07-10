# Spec: `/nightwatch init` lifecycle — documented model + non-destructive `--update`

- **Status:** accepted 2026-07-10 — **folded into `nightwatch.md`** §6 (`init` mode, brief
  drift nudge; FR51–FR53 in the epics requirements inventory). Implementation pending
  (Epic 7 candidate). **Depends on** [file-layout](file-layout.md)
  (0008): `--update` reads and writes declarations at their resolved locations
  (`.nightwatch/STATE.md`, the configured `release_path`).
- **Motivated by:** dogfooding findings
  [0006 — `init` has no lifecycle](../dogfooding/0006-init-lifecycle-unclear.md) and
  [0013 — Config-drift nudge false positives](../dogfooding/0013-config-drift-false-positives.md)
  (P4 refinement)
- **Scope:** the lifecycle of `/nightwatch init` — what re-running does, how the user keeps
  declarations in sync as the repo evolves, and how drift is surfaced. No change to what the member
  jobs analyze or to the overnight write surface beyond one new brief line.

## Problem

`init` has no stated lifecycle, and its two write paths behave inconsistently
(`scripts/lib/init.js`):

- **Declaration files are create-if-absent.** `writeDeclarations` reports
  `{ written: false, reason: 'exists' }` for an existing `STATE.md` / `config.yaml` and never
  updates them. So authority, phase, release target / definition of done, and layers declared on
  day one are **frozen** — exactly the things that drift as a repo matures.
- **Dev-tooling classification rewrites `config.yaml` in place.** `writeDevTooling` replaces the
  `dev_tooling:` line. So one part of `init` is an in-place update while the rest is create-only,
  with no model tying them together.

The result: re-running `init` is neither a clean full reinitialization nor a clean incremental
update, and nothing tells a user *when* to re-run or *what will change*. See finding 0006.

## Design constraints

1. **Never overwrite a declaration without confirmation.** `--update` proposes diffs; the human
   confirms each before anything is written. Declarations stay byte-identical except for confirmed
   changes.
2. **Overnight never reclassifies or edits declarations.** Preserves FR43 / NFR4: the drift signal
   (P5) is detection + one brief line only — no writes, no reclassification, at night.
3. **Deterministic detection.** Reuse Story 6.5's dev-tooling detection and add module/declaration
   drift detection; heuristics run only where a human confirms them (`init` / `init --update`).
4. **`--update` is daytime and interactive** — like `init`, it is a mode that may ask questions;
   it is never invoked on a scheduled run.
5. **Backwards compatible.** Plain `init` on a configured repo behaves as today (create-only +
   dev-tooling-on-confirm); `--update` is additive.

## Proposals

### P1 — Document the lifecycle (and re-run honestly)

State the model explicitly in `commands/nightwatch.md` and the README: **`init` is create-only for
declarations** — it instantiates `STATE.md` / `config.yaml` only where absent and never refreshes
an existing one; re-running re-probes tools and can reclassify `dev_tooling`, but does **not** update
existing declarations. To change a declaration as the repo evolves, edit it directly or run
`init --update` (P3).

**Honest re-run reporting.** Surface the create-only outcome instead of a silent JSON
`reason: 'exists'`: when a declaration already exists, `init` prints one line — e.g. *"STATE.md
already exists — not updated; edit it directly or run `/nightwatch init --update`."* — so the user
learns the boundary the moment they hit it.

### P2 — `/nightwatch init --update`: non-destructive reconfigure

A new daytime, interactive mode that brings an existing config back in sync with how the repo has
changed, without clobbering anything:

1. **Re-run detection** — dev-tooling candidates (Story 6.5), plus new top-level modules and other
   inputs a declaration would normally cover (authority areas, layers, extractor tooling).
2. **Compute proposed diffs** against the *existing* declarations — additions and changes only,
   each shown as a concrete before/after (e.g. "`dev_tooling:` + `agents/**`", "`phase:` prototype
   → released?", "new top-level `services/` — declare authority?").
3. **Confirm per change** — the human accepts, edits, or skips each proposed diff. Nothing is
   written for a skipped item.
4. **Apply only confirmed changes**, byte-preserving the rest of each file (same
   single-line/section-targeted rewrite discipline as `writeDevTooling`).

`--update` never re-interviews from scratch by default — it proposes only what *changed*. A full
re-interview remains available (e.g. `init --update --all`) for a deliberate redo.

### P3 — Unify the two write paths under one confirm gate

`dev_tooling` reclassification and declaration edits both flow through the same **propose-diff →
confirm → apply** path in `--update`, so nothing about `init` is create-only in one place and
silent-overwrite in another (finding 0006's sharpest edge). Plain `init` keeps its create-only
declaration behavior; its `dev_tooling` write is presented as a confirmed diff too, for consistency.

### P4 — Config-drift nudge in the brief

Overnight runs already emit one-line *setup findings* for undeclared inputs. Extend that: when a run
sees a **new top-level directory no declaration classifies** (neither product-declared nor in
`ignore`/`dev_tooling`), add one brief line — *"new directory `services/` is unclassified; run
`/nightwatch init --update` or add it to `config.yaml`."* — so the user learns *when* re-running is
warranted instead of guessing. Detection + reporting only; the overnight run writes no declarations
(constraint 2).

**P4.1 — Refinement: distinguish implicit product from unknown, and don't nag (finding 0013).** As
shipped (FR53 / Story 7.5), the nudge fires for *every* tracked top-level directory that is not on
the small generic product allowlist (`src`, `lib`, `test`, `docs`, …) and not authority-declared —
so a repo whose product directories are named otherwise (`.claude-plugin/`, `config/`, `skills/`,
`packages/`, `apps/`, …) is nagged **every night** about directories that are already being analyzed
as product and are correct as-is. That is recurring, non-actionable noise, and it trains the user to
ignore the section that was meant to catch a genuinely new directory. The refinement:

- **A directory analyzed-as-product-by-default with no signal of being misclassified is _implicit
  product_, not drift.** "Not explicitly declared" is not the same as "unclassified" — the correct
  steady state for such a directory is exactly to be analyzed as product, so it must not be flagged.
- **Narrow the trigger to actionable cases.** Prefer firing only for a directory that looks
  *dev-tooling-shaped but is undeclared* (reuse `init --update`'s existing `dev_tooling`-candidate
  detection: referenced-by-no-product-import / convention match), or one that is genuinely new —
  rather than every non-allowlisted product directory.
- **Don't recur.** Surface a given directory at most once (or only while it is genuinely new); a
  persistent nightly line with no new information is noise, not a signal. Where analyze-as-product is
  the intended default, leave genuine reclassification to `init --update`'s interactive, on-demand
  detection rather than an overnight nag.

Detection + reporting only, as before; the overnight run still writes no declarations.

## Non-goals

- No automatic or unattended reclassification / declaration editing — `--update` is human-confirmed
  and daytime only.
- No content rewriting beyond confirmed diffs; no reformatting of hand-edited declaration text.
- No re-interview by default (only proposed changes); the full redo is opt-in.
- No change to cadence, budgets, member order, brief assembly, or the ledger.
- No recurring, non-actionable drift nags — the nudge must not repeat a directory that is correct as
  implicit product, night after night (P4.1, finding 0013).

## Acceptance criteria

1. Re-running plain `init` on a configured repo does not modify existing `STATE.md` / `config.yaml`
   declaration fields, and reports each already-existing declaration in one human-readable line.
2. `/nightwatch init --update` proposes diffs (new dev-tooling dirs, new modules, changed
   declaration fields) and applies **only** confirmed ones; skipped items are not written; unchanged
   content is byte-preserved.
3. `--update` never overwrites a declaration without confirmation, and is idempotent — a second run
   with no repo change proposes nothing.
4. A scheduled/overnight run performs no reclassification and writes no declaration files (FR43 /
   NFR4 unchanged).
5. An overnight run that encounters a new unclassified top-level directory emits exactly one brief
   line naming it and pointing at `init --update`; a fully-classified repo emits no such line.
6. The drift nudge does **not** flag a directory that is already analyzed as product by default and
   shows no signal of being misclassified (implicit product), and it does not repeat the same
   directory night after night with no new information (P4.1, finding 0013).

## Tests

- **create-only lifecycle:** re-run `init` on a repo with existing declarations → declaration fields
  unchanged; report lists each as `exists`/"not updated"; the `dev_tooling` diff still offered.
- **`--update` diffs:** fixture with a new top-level module and a new dev-tooling dir → proposed
  diffs listed; confirming one and skipping another writes only the confirmed change; other file
  content byte-identical; second `--update` run proposes nothing (idempotent).
- **non-destructive:** `--update` with all diffs declined writes nothing.
- **overnight invariants:** a scheduled run reclassifies nothing and writes no `STATE.md`/`config.yaml`.
- **drift nudge:** overnight run on a repo with an unclassified new top-level dir emits one brief
  line naming it + `init --update`; none when everything is classified.
