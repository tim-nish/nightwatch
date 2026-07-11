# Dogfooding finding 0026 — Development-phase selection during `nightwatch init` requires interpretation; the Hardening/Released distinction is ambiguous and no phase is suggested

- **Date:** 2026-07-11
- **Session:** dogfooding — running `nightwatch init` and reaching the development-phase
  selection screen.
- **Command:** `nightwatch init`, at the **phase** step of the interview.
- **Classification:** UX / onboarding — **not a bug**. The screen works and gathers the
  right declaration (`phase:`); the friction is that a first-time user has to stop and
  interpret which option matches their repository.
- **Status:** specced 2026-07-11 — findings 1–2 are
  [`first-run-ux.md`](../specs/first-run-ux.md) **P9 (accepted 2026-07-11)**; point 3 is a
  recurrence of finding [0012](0012-phase-selection-leaks-own-state.md), closed by P8
  conformance (implementation gap, no spec change). Triage:
  [0026–0034 record](../specs/DRAFT-findings-0026-0034-triage.md).
- **Priority:** Low.

## Observed behavior

The phase-selection screen functions correctly, but I had to pause and reason about which
option best described my repository. The distinction between **Hardening** and
**Released** is not immediately obvious to a first-time user, and nothing on the screen
suggests a likely answer even when the repository state would strongly imply one.

## Findings

1. **The Hardening vs. Released distinction should be clearer.** As written, the two are
   separable only after careful reading:
   - **Hardening** — stabilizing toward the next release while active improvements
     continue.
   - **Released** — maintenance mode, with minimal feature development.

   The difference is understandable on a close read, but could be communicated more
   explicitly so the user doesn't have to infer it.

2. **Nightwatch should suggest a recommended phase when it can infer one.** When it
   detects signals such as
   - an existing GitHub release,
   - a published package (PyPI / npm / etc.),
   - semantic versioning,

   it could display *"Suggested: Hardening"* while still letting the user choose a
   different option. The suggestion lowers the interpretation burden without removing the
   declaration's authority from the user.

3. **The "Building" description contains repository-specific wording** — *"Epics 9–11 just
   landed"* — which reads as an internal example rather than a generic definition. This is
   the same leak documented in finding [0012](0012-phase-selection-leaks-own-state.md)
   (there it was *"Epic 6 packaging just landed"*), recurring after Epics 9–11. Replace it
   with repository-agnostic wording, per that finding's stated principle: describe *the
   repository being configured*, never Nightwatch's own milestones.

## Why this matters

- A first-time user cannot pick confidently between adjacent phases (`hardening` vs.
  `released`) when the descriptions overlap, and a mis-declared `phase:` silently reweights
  ranking for every subsequent run.
- Inferring and suggesting a phase from observable repository signals turns a judgment call
  into a confirmation — the kind of onboarding polish that makes `init` feel finished.
- The Nightwatch-specific "Building" wording is a repeat of a boundary the design already
  committed to holding (finding 0012); left unfixed it will keep re-leaking as the project
  advances through epics.

## Impact

Minor UX friction during onboarding. No functional issue — the interview collects the
correct declaration — but reducing ambiguity would make `nightwatch init` feel more
polished and require less interpretation from first-time users.

## Suggested improvements

1. **Sharpen the phase descriptions** so `hardening` and `released` are distinguishable at
   a glance (e.g. contrast "still shipping improvements toward the next release" against
   "maintenance mode, minimal new features").
2. **Add an inferred `Suggested:` phase** driven by cheap, deterministic signals (existing
   release, published package, semantic versioning), shown non-bindingly above the choices.
3. **Replace the repository-specific "Building" example** with generic wording, closing the
   0012 recurrence and making the fix a stated presentation principle rather than a
   per-epic patch.
