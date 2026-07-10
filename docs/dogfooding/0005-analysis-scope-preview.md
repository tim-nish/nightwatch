# Dogfooding finding 0005 — No preview of analysis scope before expensive jobs launch

- **Date:** 2026-07-10
- **Command:** `/nightwatch` first run (see also findings
  [0001](0001-first-run-visibility.md) and [0002](0002-analysis-scope-dev-tooling.md))
- **Classification:** UX issue — scoping happens invisibly, so a wrong scope is only
  discoverable after the budget is spent.
- **Status:** documented; proposed improvement specced as **P6** in
  [`docs/specs/first-run-ux.md`](../specs/first-run-ux.md) (cross-referencing
  [`docs/specs/analysis-scope.md`](../specs/analysis-scope.md)). No changes implemented.

## Observed behavior

Nightwatch launched its member jobs without ever showing which parts of the repository they
would analyze. On the dogfooding run, development-only trees (`_bmad/`, `_bmad-output/`,
`.claude/`, `q_a/`) were swept up in extraction, judgment, and verification before the
adversarial pass rejected the resulting false positives — extra time and tokens spent on
files that were never going to yield a real finding, with no moment at which a watching user
could have noticed and stopped it.

The information needed for a preview already exists before any subagent launches: the merged
ignore globs are resolved by `scripts/lib/config.js`, and the file walk they apply to is
deterministic. Scope is decided up front; it is just never shown.

## Why this matters

- **Scope errors are cheap to catch before the run and expensive to catch after.** A user
  glancing at "will analyze: `_bmad/` (312 files)" spots the problem in seconds. Without the
  preview, the same error costs a full night's budget and surfaces — if at all — as noise
  the verification layer had to absorb (finding 0002).
- **The preview is the feedback loop for scope configuration.** Findings 0002's proposed
  `dev_tooling` defaults and `init`-time confirmation reduce misscoping, but defaults will
  never be perfect for every repo. A pre-run preview is how a user learns their `ignore:` /
  `dev_tooling:` config is wrong *before* paying for it — in both directions: unexpected
  inclusions (dev tooling analyzed) and unexpected exclusions (real product surface silently
  skipped by an over-broad glob).
- **It completes the plan display.** Finding 0001's execution plan answers *what will run,
  for how long, at what cost*; the scope preview answers *on what input*. Cost estimates are
  not credible without the input size that drives them.

## Risks

- Tokens and wall time spent analyzing directories the user never wanted in scope, on every
  run until the user happens to inspect the config.
- The inverse failure staying invisible: an over-aggressive glob excluding real product
  code, with nothing surfacing the gap at launch time.
- Users unable to connect an unexpectedly long or expensive run to its actual cause (input
  scope) — misdiagnosing it as the model being slow or the tool being stuck.

## Suggested improvement (specced as P6 in `docs/specs/first-run-ux.md`)

Extend the pre-run plan display with a compact scope preview, shown before any subagent
launches:

```
Scope: 214 files across scripts/ commands/ templates/ docs/ test/
Excluded: _bmad/ (312) _bmad-output/ (41) .claude/ (58) q_a/ (6) node_modules/ .git/
```

- Top-level directories with file counts — a handful of lines, not a file listing.
- Derived from the already-resolved config globs; no new scoping logic and no extra token
  cost (a deterministic script walk).
- **Unattended execution is preserved:** on scheduled runs the preview is not a prompt — the
  same scope summary is written into the run record and the brief's scope line (analysis-
  scope spec, P5), so the information is never lost but never blocks. Interactively, it
  appears with the plan and, on first runs, ahead of the confirmation gate — making an
  unexpected inclusion visible at the one moment the user can still say no.
