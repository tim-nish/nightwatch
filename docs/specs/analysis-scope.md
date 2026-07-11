# Spec: Product-vs-development analysis scope

- **Status:** accepted 2026-07-10 — folded into `nightwatch.md` §2.2, §6 (init), and §7
  (config template); FR42–FR43 in the epics requirements inventory. P4 is realized as
  P2's `!pattern` negation semantics rather than a separate `analyze:` key.
  Implementation pending (Epic 6). **Superseded in part 2026-07-11 by
  [content-repo-scoping](content-repo-scoping.md):** P2's shipped-default list and
  extension semantics (q_a/** dropped; negation pinned match-based, fulfilling P4's
  "one line of config" intent) and P3's init detection/confirmation (substrate-aware
  candidates; declining a convention candidate writes its negation). The two-tier
  vocabulary, visible-declaration principle, and P5 scope statement remain in force.
- **Motivated by:** dogfooding finding
  [0002 — Analysis scope includes development-only tooling](../dogfooding/0002-analysis-scope-dev-tooling.md)
- **Scope:** what the member jobs analyze. Config schema, defaults, `init` interview, and
  brief reporting. No change to how any job analyzes what is in scope.

## Problem

The shipped ignore default — `["dist/**", "vendor/**", "node_modules/**", ".git/**"]` —
expresses "build outputs and dependencies." It does not express the category the first
dogfooding run needed: repo-resident tooling used to *develop* the project (BMAD artifacts,
agent skill directories, planning workspaces, scratch folders). Those files were fully
analyzed; adversarial verification absorbed the false positives at full token cost.

## Design constraints

1. **Never guess silently.** Scoping decisions must be visible: what was excluded and why is
   stated once in the brief, matching the existing "degradation is always stated" principle.
2. **Declarations over inference.** Ambiguous directories are resolved by the human at `init`
   time — the one interactive moment — not inferred nightly.
3. **Config stays optional.** An absent `config.yaml` must still yield sensible scoping via
   shipped defaults. Every new key is optional.
4. **Backwards compatible.** Existing `ignore:` lists keep working unchanged.

## Proposals

### P1 — Two-tier scoping model

Split "not analyzed" into two named tiers, because they answer different questions:

- **`ignore`** (exists today) — never look at this: build outputs, dependencies, caches.
- **`dev_tooling`** (new, optional) — this is real repo content, but it is tooling for
  developing the product, not the product. Excluded from all three member jobs' analysis by
  default; individual entries can be re-included explicitly (P4).

The distinction matters for reporting: `ignore` needs no mention; `dev_tooling` exclusions
are summarized in one brief line (P5) so the user can catch a misclassification.

### P2 — Expanded shipped defaults

Extend the built-in defaults (in `scripts/lib/config.js` and `templates/config.yaml`) to
cover well-known non-product artifacts out of the box:

```yaml
ignore:
  - "dist/**"
  - "build/**"
  - "out/**"
  - "vendor/**"
  - "node_modules/**"
  - ".git/**"
  - "coverage/**"
  - "**/*.lock"          # lockfiles are read by extractor detection, not analyzed as product
  - ".nightwatch/**"     # Nightwatch never analyzes its own outputs
dev_tooling:
  - "_bmad/**"
  - "_bmad-output/**"
  - ".claude/**"
  - ".cursor/**"
  - ".github/prompts/**"
  - "q_a/**"
```

- The exact list is illustrative; the criterion for inclusion is "recognizable, widely used
  development-workspace convention with near-zero chance of being product surface."
- User-supplied `ignore:`/`dev_tooling:` lists **extend** the defaults rather than replace
  them, with a `!pattern` negation syntax (or an explicit `defaults: false` key) to opt out —
  today a user setting any `ignore:` silently loses the shipped defaults, which is its own
  footgun.

### P3 — `init` detects and confirms dev-tooling directories

`/nightwatch init` (the interview) gains one step: `init.js` scans the repo root for
directories matching known dev-tooling conventions plus heuristic candidates (top-level dirs
that are git-tracked but referenced by no product import, e.g. `_*/`), and presents the list
for confirmation:

```
Likely development-only tooling (will be excluded from analysis):
  _bmad/  _bmad-output/  .claude/  q_a/
Confirm, or name any that are actually product surface.
```

Confirmed entries are written into `.nightwatch/config.yaml` under `dev_tooling:` — making
the scoping a *declaration*, visible and versioned, rather than a hidden default.

### P4 — Inclusion is explicit

Re-including a default-excluded path requires an affirmative config entry (negation pattern
or explicit listing under a new `analyze:` allowlist key). Accidental analysis of a known
dev-tooling directory should be impossible; deliberate analysis should be one line of config.

### P5 — Scoping is stated, never silent

Each brief includes at most one line summarizing scope, e.g.:

```
Scope: 214 files analyzed; excluded 4 dev-tooling dirs (_bmad, _bmad-output, .claude, q_a) — edit .nightwatch/config.yaml to change.
```

This is the safety valve for misclassification: a user whose real product lives in an
excluded directory finds out on day one, from the brief, with the fix named.

## Non-goals

- No per-job scoping (one scope shared by all three members keeps the model simple).
- No content-based classification of individual files at run time — scoping is path-based
  and declared; heuristics run only where a human confirms them (at `init`, and — for loose
  untracked files by name pattern only — at the first-run confirmation screen, see
  [first-run-ux](first-run-ux.md) P7.4). Never content-based, never silent, never nightly.
- No change to extractor adapters' own exclusion behavior beyond passing the merged globs.

## Acceptance criteria

1. A fresh run on a repo containing `_bmad/**` and `.claude/**` with **no** config file spends
   zero extraction, judgment, or verification tokens on those trees.
2. A user-supplied `ignore:` list no longer silently discards the shipped defaults.
3. `init` proposes detected dev-tooling directories, and the confirmed set lands in
   `.nightwatch/config.yaml` under `dev_tooling:`.
4. Re-including an excluded path takes exactly one config entry, and the next brief's scope
   line reflects it.
5. Every brief states its exclusions in at most one line; no exclusion is ever silent.
