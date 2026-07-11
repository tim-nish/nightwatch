# Dogfooding finding 0028 — Scoping model inverts on agent-native content repos: the product classifies as dev-tooling and the implementation (`.claude/commands/`) is structurally out of scope

- **Date:** 2026-07-11
- **Session:** dogfooding against `~/work/product-lab` — a Claude-Code-operated markdown
  idea-pipeline + Q&A knowledge repo. No conventional source code: the "implementation"
  is `.claude/commands/*.md`, the "product" is markdown content directories
  (`ideas/`, `q_a/`, `lessons/`, `graveyard/`, `postmortems/`, `templates/`).
- **Command:** `nightwatch init` (dev-tooling classification) and the overnight
  `repo-reconcile` run that inherited the resulting scope.
- **Classification:** use-case fit / correctness — the scoping *model*, not one screen.
  README names AI-assisted spec-driven repos as the primary audience; this repo class is
  exactly that, and the scoping defaults invert on it.
- **Status:** specced 2026-07-11 —
  [`content-repo-scoping.md`](../specs/content-repo-scoping.md) **(accepted 2026-07-11)**, per
  maintainer Decision 1 (product-by-default without an import substrate). Related:
  [0027](0027-init-dev-tooling-directory-defaults.md) (subsumed into the same spec),
  [0025](0025-repo-context-ambiguity.md). Triage:
  [0026–0034 record](../specs/DRAFT-findings-0026-0034-triage.md).
- **Priority:** High.

## Observed behavior

1. **The heuristic proposed the product as tooling.** `init.js --detect-dev-tooling`
   tagged `ideas/`, `graveyard/`, `lessons/`, `postmortems/`, `templates/`, `product-lab/`
   as candidates — reason: *"top-level tracked directory referenced by no product
   import."* In a markdown repo nothing is referenced by imports, so **every** content
   directory looks like tooling. A user accepting the recommendations excludes their own
   product from analysis.

2. **The shipped default `q_a/**` excluded the repo's largest product directory.**
   `scope.js` `DEFAULT_DEV_TOOLING` hardcodes `q_a/**` — the Nightwatch/BMAD authors' own
   workflow convention. In product-lab, `q_a/` is 43 tracked files and the subject of its
   current epics (the Q&A gateway). It was default-excluded, labeled *"matches a shipped
   dev-tooling convention."*

3. **Declining a convention candidate has no effect.** The init interview asks the human
   to "confirm which are development-only tooling," but convention-sourced candidates
   (`q_a`, `.claude`, `_bmad`) are *already* in the shipped defaults — not confirming them
   writes nothing and they stay excluded. The only re-include path is hand-editing
   `!q_a/**` into `config.yaml`, documented in one template comment
   (`templates/config.yaml:15`); the init flow never offers or writes negations.

4. **Negation is exact-match only — subpath re-include is impossible.**
   `extendGlobs` (`scripts/lib/scope.js:47`) implements `!p` as
   `positives.delete(p)` on exact strings. `!.claude/commands/**` verifiably does nothing
   (scope preview unchanged, `.claude` still fully excluded). So the repo's actual
   implementation — 10 tracked command files under `.claude/commands/`, referenced by its
   specs and by the declared definition of done — cannot be brought into scope without
   re-including all of `.claude/**` (245 files on disk, mostly untracked skills).

5. **The blind spot produced a false-clean deterministic layer.** With `.claude/**`
   excluded, `surface-inventory` reported `command_files: []` and the deterministic
   reconcile layer reported 0 findings on a repo where the judgment layer then found 6
   real, verified inconsistencies — several of them *about* the excluded commands. The
   exclusion appeared in no `degraded` list (the config comment promises exclusions are
   stated "never silently"; the scope one-liner names the dirs but nothing connects
   "`.claude` excluded" to "command claims were not checked"). The member job added the
   degraded line by hand.

6. **`PRODUCT_DIR_ALLOWLIST` nags every content directory, circularly.**
   The allowlist (`scope.js:22`) is pure code-repo convention (`src`, `lib`, `app`,
   `scripts`, `bin`, …). Every product-lab content dir is therefore "unclassified": the
   brief's Machine notes carried **seven** permanent lines of the form *"new top-level
   directory `ideas/` is unclassified; run `/nightwatch init --update`…"* — including
   `q_a/`, which had been explicitly re-included via `!q_a/**`. Following the advice is
   circular: `init --update` would propose adding these dirs to `dev_tooling` again.

## Why this matters

- The README's declared audience — AI-assisted, spec-driven development — is precisely
  where the product is markdown and the behavior lives in `CLAUDE.md` +
  `.claude/commands/`. On that repo class the current model classifies the product as
  tooling and the implementation as untouchable, then reports a clean deterministic pass.
- A false-clean is worse than a degraded notice: it converts a scoping decision into a
  wrong verdict.
- Seven permanent Machine-note nags on a "quiet brief" product contradict the capped-
  attention principle, and the suggested remedy re-proposes the wrong classification.

## Suggested improvements

1. **Detect the repo class.** If no import graph exists (no extractor substrate), invert
   the heuristic's burden: treat tracked top-level content directories as product by
   default and require opt-out, not opt-in.
2. **Make the interview honest for convention candidates:** declining one should write
   the `!glob` negation; init should surface that a shipped default is excluding a
   directory the human just called product.
3. **Support subpath re-includes** in `extendGlobs` (match semantics, not string
   equality), or ship a narrower default (`.claude/settings*`, `.claude/skills/**`) that
   leaves `commands/` in scope.
4. **Drop `q_a/**` from shipped defaults** — it is a maintainer-workflow leak, not a
   recognizable ecosystem convention.
5. **State the consequence, not just the exclusion:** when an excluded tree would have
   fed a signal class (command files, specs), emit a degraded notice naming the class.
6. **Classify content dirs once:** let STATE.md authority declarations (or a
   `product:` list) satisfy "classified" so the unclassified-dir nag can actually be
   silenced for docs-as-product repos.
