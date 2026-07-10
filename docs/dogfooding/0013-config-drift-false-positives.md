# Dogfooding finding 0013 — Config-drift nudge flags implicit-product directories as "unclassified": recurring, non-actionable noise

- **Date:** 2026-07-10
- **Session:** dogfooding — third run on the *writing-assistant* repository.
- **Command:** `/nightwatch` overnight flow → the morning brief's **Config drift** section
  (FR53 / Story 7.5, `scope.unclassifiedTopDirs` → `collect-brief.js`).
- **Classification:** behavior / UX — the drift signal is too broad. Not a crash; it manufactures
  recurring, non-actionable noise, so it is a refinement of the shipped drift nudge, not a bug.
- **Status:** documented; refinement folded into
  [`docs/specs/init-lifecycle.md`](../specs/init-lifecycle.md) (P4). No code changes implemented.

## Observed behavior

Every overnight run's **Config drift** section repeatedly listed `.claude-plugin/`, `config/`, and
`skills/` as *"unclassified; run `/nightwatch init --update`."* — night after night, with no change.
These directories are **analyzed as product by default** (nothing in `ignore`/`dev_tooling` excludes
them), which is the intended behavior for this repository. So the nudge has **no actionable
outcome**: the user is not going to declare them as dev-tooling or ignore them, and they are already
being analyzed correctly as product.

## Why this matters

1. **The check conflates "not explicitly declared" with "unclassified/unknown."** A directory that
   is analyzed-as-product-by-default is **implicitly classified as product** and working as intended
   — it is not drift. The drift heuristic
   ([Story 7.5](../specs/init-lifecycle.md)) fires for *every* tracked top-level directory that is
   not on the small, generic product allowlist (`src`, `lib`, `test`, `docs`, …) and not
   authority-declared. Any repo whose product dirs are named otherwise (`.claude-plugin`, `config`,
   `skills`, `packages`, `apps`, …) gets nagged **forever**.
2. **Recurring, non-actionable warnings are negative value.** The first-run-ux principle that "an
   unread report is negative value" applies here: a nightly nag the user can do nothing useful about
   trains them to ignore the whole section — which then **hides a genuinely new or ambiguous
   directory** (the `services/` case the nudge was designed for) when one actually appears.
3. **The signal is stable, not new.** Drift is meaningful when something *changed*. Re-reporting the
   same long-standing directories every night carries no new information.

## Risks

- **Alert fatigue:** the user stops reading the Config drift section, so a real new directory slips
  by unnoticed — defeating the feature's purpose.
- **Over-declaration:** users add noise directories to `config.yaml` purely to silence the nag,
  polluting a versioned declaration with entries that encode nothing meaningful.
- **Eroded trust in the brief** as a whole, because its most repetitive line is the least useful.

## Suggested improvements (folded into `docs/specs/init-lifecycle.md`, P4)

1. **Distinguish implicit product from unknown/unclassified.** A tracked top-level directory that is
   analyzed as product and carries **no signal of being misclassified** is *implicit product*, not
   drift. Only nudge when there is a concrete reason to think a directory is mis-scoped or genuinely
   unknown.
2. **Narrow the trigger to actionable cases.** Prefer firing only for directories that look
   *dev-tooling-shaped but are undeclared* — reusing `init --update`'s existing `dev_tooling`
   candidate detection (referenced-by-no-product-import, convention matches) — rather than every
   non-allowlisted product directory.
3. **Make the nudge non-recurring / acknowledgeable.** Surface a given directory at most once (or
   only while it is genuinely new); a persistent nightly nag with no new information should not
   repeat.
4. **Or suppress it when analyze-as-product is the intended default.** If a directory is already
   being analyzed as product and nothing suggests it should not be, that is the correct steady
   state — leave genuine reclassification to `init --update`'s interactive, on-demand detection
   rather than an overnight nag.
