# Dogfooding finding 0007 — First-run confirmation screen: unclear labels, no config-change preview, untracked files lumped together

- **Date:** 2026-07-10
- **Session:** second dogfooding round — running Nightwatch on a *different* repository, on the
  first-run confirmation screen shipped by Epic 6 (the FR40 gate + scope preview).
- **Command:** `/nightwatch` (first interactive run), at the confirmation screen shown before any
  member subagent launches.
- **Classification:** UX / wording & presentation issue — not an implementation bug. The gate,
  scoping, and setup paths all behave as specified; the confirmation screen's option labels,
  grouping, and lack of a change preview leave a first-time user guessing.
- **Status:** documented; proposed refinements folded into
  [`docs/specs/first-run-ux.md`](../specs/first-run-ux.md) (P7). No code changes implemented.

## Observed behavior

The first-run confirmation screen worked as designed — it showed the plan and scope preview and
paused for consent before spending the budget (finding 0001's fix, now shipped). But at the moment
of choosing, the options and the information around them were harder to read than they needed to be:

- The choices included **"Ignore strays, then run"** and **"Setup only, don't run"**, whose exact
  effects were not obvious from the labels.
- The run had detected untracked files that would otherwise be analyzed — `answer.md`,
  `question.md`, and `bash.exe.stackdump` — and offered to add them to `ignore`, but **listed them
  all together** with no distinction between a crash artifact and an ordinary document.
- Choosing to ignore the strays would **write to `.nightwatch/config.yaml`**, but the exact change
  was never shown before it was applied.

## Where it's unclear

1. **"Ignore strays, then run" uses jargon.** "Strays" is not immediately obvious to a first-time
   user — it's Nightwatch-internal shorthand for "untracked files that aren't part of the product."
   The label should say what it does in plain terms.
2. **The config change is applied sight-unseen.** The option edits `config.yaml`, but the user
   never sees the resulting `ignore:` block before committing to it. A write to a versioned config
   file should be previewable — the user should know exactly what lands.
3. **"Setup only, don't run" doesn't say what "setup" is.** It isn't clear that this option
   *writes `STATE.md` and `config.yaml`* (the declaration files) and that `/nightwatch` can simply
   be run later — so it reads as an ambiguous escape hatch rather than a legitimate "configure now,
   analyze later" path.
4. **Untracked files are lumped into one list.** `bash.exe.stackdump` (a crash dump — almost
   certainly disposable) is presented next to `answer.md` and `question.md` (ordinary documents the
   user might well want analyzed, or might want to keep out). Grouping unlike things together forces
   one coarse decision where two clearer ones would do.

## Why this matters

- **This screen is the first real consent moment.** It's where a present human decides whether to
  spend a full budget and what to exclude. Ambiguous labels and an unpreviewed config write spend
  trust at exactly the point the design set aside to *earn* it (finding 0001's premise).
- **The write is to a versioned declaration.** `config.yaml` is a contract the user maintains;
  editing it silently, even helpfully, undercuts the "declarations are visible and versioned"
  principle the scoping design rests on ([analysis-scope](../specs/analysis-scope.md), P3/P5).
- **Coarse grouping produces coarse decisions.** A user who'd happily ignore a crash dump but wants
  `question.md` analyzed can't express that cleanly when both are one bucket — so they either
  over-exclude (losing product surface) or under-exclude (paying to analyze junk).

## Risks

- Users pick the wrong option because the label didn't say what it did, then either over-scope or
  abandon the run.
- An unpreviewed `ignore:` write excludes something the user actually wanted analyzed, discovered
  only later from the brief's scope line.
- `bash.exe.stackdump`-style crash artifacts get analyzed (or a document gets excluded) because the
  single lumped choice pushed the user toward the coarse answer.

## Suggested improvements (folded into `docs/specs/first-run-ux.md`, P7)

1. **Rename the run-with-exclusions option in plain language**, e.g. **"Ignore untracked temporary
   files and run"** instead of "Ignore strays, then run."
2. **Preview the exact config change before applying it.** Show the literal block that will be
   written, e.g.:
   ```yaml
   ignore:
     - answer.md
     - question.md
     - bash.exe.stackdump
   ```
   so the user knows precisely what lands in `config.yaml` before confirming.
3. **Spell out "Setup only, don't run":** state that it writes `STATE.md` and `.nightwatch/config.yaml`
   and that `/nightwatch` can be run later — e.g. **"Write STATE.md and config.yaml only — run
   /nightwatch later."**
4. **Classify untracked files into groups, not one list.** Separate likely temporary / crash
   artifacts (e.g. `bash.exe.stackdump`, `*.stackdump`, `core.*`, `*.tmp`) from ordinary untracked
   documents (`answer.md`, `question.md`), so the user can accept the obvious exclusions and decide
   the genuine documents deliberately.
