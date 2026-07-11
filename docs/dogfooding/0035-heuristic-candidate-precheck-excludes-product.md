# Dogfooding finding 0035 — In a code-class repo, pre-checking heuristic dev-tooling candidates re-creates the exclude-product risk one layer down (`spaces/`)

- **Date:** 2026-07-11
- **Session:** pre-implementation design dry-run of the accepted content-repo-scoping
  model against two real repos — `QuantScenarioBench` (code class: `pyproject.toml`
  detected) and `writing-assistant` (content class: no import substrate). No code
  changes; the detection primitives (`init.js --probe`, `--detect-dev-tooling`,
  `orchestrate.js --plan`) were run and the new-model rules applied by hand.
- **Command:** `nightwatch init` — the dev-tooling classification interview
  ([content-repo-scoping](../specs/content-repo-scoping.md) P5), in a **code-class** repo.
- **Classification:** design gap in an accepted-but-unimplemented spec — caught before
  implementation. Not a runtime bug (the code doesn't exist yet).
- **Status:** specced 2026-07-11 — resolved by tightening
  [`content-repo-scoping.md`](../specs/content-repo-scoping.md) P5.2 and FR102 / Story
  12.4 (maintainer decision: heuristic candidates default **unchecked unless
  dot-prefixed**). Related: [0028](0028-content-repo-scope-inversion.md) (the same
  exclude-product risk, one layer up), [0027](0027-init-dev-tooling-directory-defaults.md).
- **Priority:** Medium (bounded, single interview default; no correctness bug ships
  because it was caught pre-implementation).

## Observed behavior

The substrate-aware model (FR100) disables the *"referenced by no product import"*
heuristic only in **no-substrate (content-class)** repos. In a **code-class** repo the
heuristic still fires and proposes candidates. Against `QuantScenarioBench`,
`--detect-dev-tooling` flagged `spaces/` as a heuristic candidate
(*"top-level tracked directory referenced by no product import"*) — but `spaces/` is
`spaces/leaderboard/app.py` + `requirements.txt`, a deployable HuggingFace Space that is
**shipped product**, merely not imported by the core `quantscenariobench/` package.

The gap is the interview's default checkbox state. As accepted, P5.2 said heuristic
candidates *"arrive per current recommendation"* — and the current recommendation is
*exclude* — so they arrive **pre-checked for exclusion**. FR102 mandated pre-checking
only for *convention* matches and was silent on heuristic candidates. A user taking
*"the common path is one confirmation"* would therefore exclude `spaces/` — silently
dropping a product component from all analysis. That is exactly the 0028 false-clean
failure mode, re-created one layer down, in code-class repos.

## Why it's a tradeoff, not a clear bug

Pre-checking a heuristic candidate is *right* for `.github/` and `.devcontainer/`
(genuinely tooling) and *wrong* for `spaces/` (genuinely product). The heuristic cannot
distinguish them. So the question is which default is the safer error. Per this round's
thesis — silently excluding product is worse than analyzing a little tooling (which
merely costs a slice of budget and is visible in the scope line) — the safe default for
a **weak** (heuristic) signal is *include*; pre-check should be reserved for **strong**
(convention) matches.

## Resolution (maintainer decision 2026-07-11)

**Heuristic candidates default unchecked unless dot-prefixed.** Concretely, in the
code-class interview:

- **Convention matches** → pre-checked (exclude). Unchanged.
- **Dot-prefixed heuristic dirs** (`.github/`, `.devcontainer/`, …) → pre-checked
  (exclude): a dot-prefixed top-level dir is conventionally tooling/config.
- **Non-dot heuristic dirs** (`spaces/`, `examples/`, …) → **unchecked** (product): a
  non-dot top-level dir is far more likely to be shipped product, so its safe default is
  include, and excluding it requires an explicit human check.
- **Content-class repos** are unaffected — the heuristic is disabled there entirely
  (FR100), so every non-convention dir is already product-by-default (unchecked).

## What else the dry-run validated (no action)

- Substrate detection keys on the manifest, not tool availability: `QuantScenarioBench`
  is code-class from `pyproject.toml` even with import-linter not installed;
  `writing-assistant` (shell + markdown, no manifest) is correctly content-class.
- The 0028 fix reproduces: `writing-assistant`'s `skills/` (product markdown) is
  heuristic-flagged by the old detector but product-by-default under content-class.
- `!.claude/commands/**` (FR101) is a correct no-op where no commands dir exists — both
  repos keep `.claude/**` fully excluded.

## Minor nits (pre-existing, non-blocking, not part of this round)

- `--detect-dev-tooling` proposes `.nightwatch/` as a candidate although `.nightwatch/**`
  is already in `DEFAULT_IGNORE` — cosmetic interview noise; the ignore tier excludes it
  regardless.
- `QuantScenarioBench`'s scope preview analyzes `.pytest_cache/` — arguably a
  default-ignore entry.
