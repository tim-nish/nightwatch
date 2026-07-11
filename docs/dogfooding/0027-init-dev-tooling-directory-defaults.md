# Dogfooding finding 0027 — Dev-tooling directory classification during `nightwatch init` describes each directory but doesn't pre-select recommended defaults or explain the choice in analysis-scope terms

- **Date:** 2026-07-11
- **Session:** dogfooding — running `nightwatch init` and reaching the dev-tooling
  directory classification step.
- **Command:** `nightwatch init`, at the **directory classification** step of the
  interview.
- **Classification:** UX / onboarding — **not a bug**. The step behaves correctly and
  collects the right classification; the friction is that the user must interpret each
  directory manually when Nightwatch already has enough context to recommend stronger
  defaults and explain them.
- **Status:** subsumed 2026-07-11 by
  [`content-repo-scoping.md`](../specs/content-repo-scoping.md) **P5 (accepted 2026-07-11)** — the
  triage pass found these asks depend on [0028](0028-content-repo-scope-inversion.md)'s
  model fix (pre-selecting the *current* heuristic's recommendations would exclude the
  product on content repos), so they are specced with it, not in first-run-ux. Related to
  [0026](0026-init-phase-selection-clarity.md) — same theme of turning an interview
  judgment call into a confirmation. Triage:
  [0026–0034 record](../specs/DRAFT-findings-0026-0034-triage.md).
- **Priority:** Low.

## Observed behavior

The directory classification step is useful, but it still requires the user to read and
interpret each directory manually. Every entry is described and labeled *"Recommend"*, so
the screen leans on text the user must parse rather than on defaults they can simply
confirm. Nightwatch already knows enough about these directories to make stronger
recommendations and justify them.

## Findings

1. **Pre-select recommended directories instead of only describing them.** For example:
   - `.github/` → selected by default
   - `.devcontainer/` → selected by default
   - `spaces/` → left unselected by default

   The user can still override the defaults, but the common path collapses to a single
   confirmation instead of per-directory decisions.

2. **Explain the decision in terms of analysis scope, not implementation details.** Frame
   each directory by what it means for what Nightwatch analyzes:
   - *".github contains repository automation and CI configuration."*
   - *".devcontainer contains development environment configuration."*
   - *"spaces is part of the shipped product and should normally remain included in
     analysis."*

3. **Distinguish defaults visually instead of labeling every item "Recommend."** When each
   entry carries the same "Recommend" tag, the label stops conveying anything. Pre-select
   recommended entries (finding 1) or mark them `(default)`, reducing the text the user
   must read to act.

## Why this matters

- Every directory becomes a separate judgment call, when most have an obvious default
  Nightwatch could pick — decision fatigue at exactly the point the user just wants to get
  running.
- Justifying inclusion/exclusion in analysis-scope terms tells the user what the choice
  *does* (what Nightwatch will look at), rather than restating what the directory is.
- A "Recommend" tag on every row carries no signal; distinguishing defaults visually lets
  the user skim and confirm rather than read every line.

## Impact

Minor onboarding friction. The current behavior is correct, but stronger defaults and
clearer, scope-oriented explanations would reduce decision fatigue during initialization.

## Suggested improvements

1. **Pre-select recommended directories** (`.github/`, `.devcontainer/` in, `spaces/` out
   as examples) so the common case is a single confirmation.
2. **Reword descriptions in analysis-scope terms** — what including or excluding the
   directory means for what Nightwatch analyzes — instead of implementation detail.
3. **Replace the uniform "Recommend" labels** with visual distinction of defaults
   (pre-selection or a `(default)` marker) to cut the reading load.
