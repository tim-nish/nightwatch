# Spec: Product-scope determination — how Nightwatch decides what is product, with tracked content as product by default when no import substrate exists

- **Status:** accepted 2026-07-11 — **folded into `nightwatch.md`** §2.2 (substrate-aware
  scope, match-based negation, consequence-stated exclusions), §4 (honest emptiness,
  zero-candidate path), §6 (init classification interview, substrate-aware drift nudge),
  §7 (default lists). **FR assignment deferred** to the BMAD planning update. P8
  (docs-repo architecture mode) remains **deferred**, not accepted. Supersedes **in
  part** [analysis-scope](analysis-scope.md) P2 (shipped
  defaults & extension semantics) and P3 (init detection/confirmation) — the two-tier
  `ignore`/`dev_tooling` model, visible-declaration principle, and brief scope statement
  remain in force. Scoping default chosen by the maintainer 2026-07-11: **product by
  default without an import substrate; narrow convention exclusions; re-includable
  subpaths** (Decision 1,
  [triage record](DRAFT-findings-0026-0034-triage.md)).
- **Motivated by:** dogfooding findings
  [0028 — content-repo scope inversion](../dogfooding/0028-content-repo-scope-inversion.md)
  (primary),
  [0027 — dev-tooling directory defaults](../dogfooding/0027-init-dev-tooling-directory-defaults.md)
  (subsumed — its interview asks are P5),
  [0035 — heuristic-candidate pre-check excludes product](../dogfooding/0035-heuristic-candidate-precheck-excludes-product.md)
  (the P5.2 default-by-signal-strength rule, from the pre-implementation dry-run), and
  [0029 — arch-review no-substrate](../dogfooding/0029-arch-review-no-substrate-on-markdown-repos.md)
  (items 1, 2, 5 — P7/P8). Evidence repo: `product-lab`, a Claude-Code-operated markdown
  idea-pipeline whose implementation is `.claude/commands/*.md` and whose largest product
  directory (`q_a/`, 43 tracked files) was default-excluded.
- **Scope:** how analysis scope is *derived and declared* — repo-class detection, shipped
  defaults, negation semantics, the init classification interview, exclusion-consequence
  reporting, and what "empty" means per signal class. No change to the two-tier
  `ignore`/`dev_tooling` vocabulary, the scope-preview display
  ([first-run-ux](first-run-ux.md) P6), member budgets, or any judgment behavior on
  in-scope files.

## Problem

Nightwatch's scoping assumes a code repo. On a repo whose product is markdown and whose
behavior lives in `CLAUDE.md` + `.claude/commands/` — the README's own primary audience,
AI-assisted spec-driven development, taken to its endpoint — every layer inverts (0028):

1. The dev-tooling heuristic ("top-level tracked directory referenced by no product
   import") classifies **every** content directory as tooling, because nothing in a
   markdown repo is referenced by imports. Accepting init's recommendations excludes the
   product.
2. The shipped default `q_a/**` is a maintainer-workflow leak, not an ecosystem
   convention; on product-lab it excluded the largest product directory.
3. Declining a convention-sourced candidate in the interview writes nothing — the glob is
   already in the shipped defaults, so the "confirmation" is a placebo.
4. `extendGlobs` negation is exact-string-only: `!.claude/commands/**` cannot re-include
   a subpath of an excluded parent, so the repo's implementation is structurally
   unanalyzable.
5. The resulting blind spot produced a **false-clean**: `surface-inventory` reported
   `command_files: []` and the deterministic reconcile layer reported 0 findings, with no
   degraded notice connecting the exclusion to the vacuous verdict.
6. `PRODUCT_DIR_ALLOWLIST` (`src`, `lib`, `app`, …) leaves every content directory
   permanently "unclassified" — seven Machine-notes nags whose suggested remedy
   (`init --update`) re-proposes the wrong classification.

The same inversion has a job-level analogue (0029): on a repo with no import substrate,
every code-shaped arch-review signal class is empty and renders indistinguishably from
"checked and clean," while the one universal signal (co-change coupling) sits behind a
threshold the repo's history cannot reach.

## The model

This spec defines **one product-scope determination pipeline for every repository**, not
a special mode for markdown repos:

```
substrate probe (P1) → default profile (P2/P3) → human declarations (P5)
  → negations resolved match-based (P4) → resolved scope
  → consequences stated (P6) and emptiness qualified (P7)
```

The pipeline, the declaration vocabulary (`ignore`/`dev_tooling`/`!re-include`), the
interview, and the reporting rules are identical everywhere. The repo class detected in
P1 changes exactly two things: **which default profile applies** before declarations
(product-by-default vs heuristic candidates) and **how the interview words its
proposals**. Declarations always win over either profile, and a mixed repo (code plus
content products) is served by the same machinery: the substrate makes it `code`-class,
and P2's declaration-satisfiable classification plus P4's re-includes cover its content
directories. "Content class" is shorthand for *no import substrate detected* — markdown
knowledge bases, agent-command repos, documentation sites, infrastructure/config repos
alike.

## Design constraints (invariants this spec must not break)

1. **Declarations over inference.** Repo-class detection tunes *defaults and
   presentation*; the human-confirmed declaration in `config.yaml` remains the only
   authority, and overnight runs never reclassify.
2. **Exclusions are stated, never silent** — now with teeth: stating the *consequence*
   (which signal class went vacuous), not only the glob (P6).
3. **Config stays optional and backwards compatible.** Absent config still yields
   sensible scoping; existing `ignore`/`dev_tooling` lists keep working; existing
   exact-match negations keep working (match-based semantics strictly widen them).
4. **Deterministic and cheap.** Class detection and scope resolution are script-side,
   zero model tokens.

## P1 — Repo-class detection: the import-substrate probe

A repo has an **import substrate** iff at least one extractor adapter detects its
ecosystem (the existing `detect` probes: manifest present — `package.json`,
`pyproject.toml`/`setup.cfg`, …). Detection is deterministic, computed by `init` and by
every plan, and **never stored as truth** — it selects defaults and wording only.

- **`code` class** — substrate present: current behavior (heuristic candidates, current
  interview) is unchanged except as amended by P3–P6.
- **`content` class** — no substrate: the "referenced by no product import" heuristic is
  **disabled** (it is vacuous, not weak), and P2 applies.
- A stray lockfile without its manifest (product-lab's orphaned `package-lock.json`) does
  **not** create a substrate; it is reported as a one-line hygiene notice instead.
- The scope preview states the class in one line: *"No import substrate detected —
  tracked content is analyzed as product by default (content-repo scoping)."*

## P2 — Product by default in content-class repos (Decision 1)

In a `content`-class repo, **every tracked top-level directory is product unless matched
by a narrow convention exclusion** (P3). Consequences:

- Init's classification step presents only the convention matches as proposed
  *exclusions* (opt-out), never proposes content directories as tooling, and states the
  default: everything else is analyzed.
- The "unclassified top-level directory" vocabulary is retired for content-class repos:
  a directory is *product (default)*, *excluded (convention)*, or *excluded (declared)*.
  A directory that appears after init produces **one** notice — *"new top-level `X/`
  analyzed as product (default); declare it in `dev_tooling`/`ignore` to exclude"* — and
  never repeats once seen, instead of nagging "unclassified" every night.
- In `code`-class repos, `PRODUCT_DIR_ALLOWLIST` membership is additionally satisfiable
  by declaration: any directory named in a STATE.md authority artifact path or covered by
  a confirmed re-include counts as classified, so the nag is silenceable there too.

## P3 — Shipped-default hygiene

- **Drop `q_a/**` from `DEFAULT_DEV_TOOLING`** (`scripts/lib/scope.js:35`). It is the
  Nightwatch/BMAD authors' own convention, not a recognizable ecosystem one (criterion
  stated at the definition site: "near-zero chance of being product surface" — `q_a/`
  failed it on the first outside repo).
- **`.claude/**` stays excluded by convention, with a shipped subpath re-include
  `!.claude/commands/**`** — agent commands are behavior, not workspace; settings,
  caches, and downloaded skills stay out. (`_bmad/**`, `_bmad-output/**`, `.cursor/**`
  are unchanged.)
- Every shipped default records a one-line rationale next to its glob at the definition
  site, so the next leak candidate has to argue past the criterion in review.

## P4 — Match-based negation: subpath re-includes work

`extendGlobs` resolution becomes match-based (gitignore-style precedence), replacing
exact-string set deletion:

- A path is excluded iff the **most specific** matching pattern is a positive; a negation
  (`!p`) re-includes every path it matches, even under a broader positive glob.
  Specificity: longest literal prefix wins; a tie goes to the negation.
- `!q_a/**` (exact cancel) behaves exactly as today — existing configs are unaffected.
- `!.claude/commands/**` under `.claude/**` re-includes the subtree (the P3 shipped
  default depends on this).
- The resolved include/exclude decision per top-level dir is what the scope preview
  already shows; a re-included subpath appears in `analyzed` with its own count so the
  declaration is visibly in effect.

## P5 — The classification interview: honest, pre-selected, scope-termed (absorbs 0027)

1. **Declining a convention candidate writes the negation.** The interview presents
   shipped-convention exclusions as pre-checked entries; unchecking one writes `!<glob>`
   to `dev_tooling` — a visible, versioned declaration. The current placebo (declining
   writes nothing and the default still excludes) is forbidden.
2. **Pre-select recommended state instead of describing it** (0027.1/0027.3), with a
   default-checked rule keyed on signal strength (finding 0035): a **weak** signal never
   pre-excludes product.
   - **Convention matches** → pre-checked (exclude).
   - **Heuristic candidates** (code class only — the heuristic is disabled in
     no-substrate repos, P2): **pre-checked iff dot-prefixed.** A dot-prefixed top-level
     dir (`.github/`, `.devcontainer/`) is conventionally tooling → pre-checked; a
     **non-dot** heuristic dir (`spaces/`, `examples/`) is far more likely to be shipped
     product → **arrives unchecked**, so excluding it requires an explicit human check.
     The concrete case: `QuantScenarioBench`'s `spaces/leaderboard/app.py` is a deployed
     product component the "no product import" heuristic flags; pre-checking it would
     silently exclude product (the 0028 failure mode one layer down).
   - **Content directories** (content class, product-by-default) → unchecked (product).

   No uniform "Recommend" label; defaults are visually distinct, and the common path is
   one confirmation. Leaving a heuristic candidate unchecked keeps it product (no
   negation is written — it was never a default exclusion); the write-the-negation rule
   (P5.1) applies to *unchecking a pre-checked convention or dot-heuristic entry*.
3. **Describe every entry in analysis-scope terms** (0027.2): what including/excluding
   means for what Nightwatch analyzes — *"`.claude/commands/` contains the repo's agent
   commands; excluded, spec ↔ command drift cannot be checked"* — never implementation
   detail.

## P6 — Exclusion consequences are stated, not just exclusions

When a resolved exclusion empties a named signal source that a member job consumes
(command files, spec files, doc claims, import graph), the job's `degraded` list gains
one line naming both: *"`dev_tooling` excludes `.claude/**` → surface inventory has no
command files; command claims not deterministically checked."* The existing config
promise ("exclusions are stated … never silently") becomes checkable: a signal-source
count of zero caused by scope **must** carry its degraded line. This is the structural
fix for the product-lab false-clean (0028 item 5).

## P7 — Honest emptiness: vacuous-empty is degraded, not clean (0029 items 1–2)

Per signal class, the deterministic layer reports substrate alongside results:

- **empty with substrate** → clean (renders as today);
- **empty without substrate** (no imports for duplication/import-overlap, no typed
  language for speculation, scope-emptied source per P6) → one degraded line naming the
  class: *"duplication: no source modules found — check vacuous."*
- **live but unreachable thresholds**: when a threshold provably exceeds the observable
  maximum (coupling `min_commits: 5` vs max per-file churn 4), state it once:
  *"co-change coupling: threshold 5 exceeds max observed churn 4 — signal unreachable on
  this history."* No auto-tuning — thresholds stay config-owned; this is reporting only.
- A member whose classes are **all** vacuous emits a single summary degraded line, and
  its zero-candidate judgment path is explicit: skip the adversarial refute pass, emit an
  empty findings file with the degradations, stop. (The `commands/arch-review.md` wording
  lands with the conformance stories — triage 0029 items 3–4.)

## P8 — Deferred: docs-repo architecture mode

On content-class repos, arch-review's meaningful substrate is the *declared derivation
graph*: STATE.md `role: derived` relationships (INDEX.md ← `ideas/` frontmatter,
README ← CLAUDE.md), directory contracts, spec ↔ command mappings. A future mode would
check those as layering rules (stale derived artifacts, undeclared derivation, cycles).
**Deferred, not accepted** — needs its own dogfooding evidence; recorded here so the
repo-class concept has one home when it returns.

## Supersession map

| Prior rule | Disposition |
|---|---|
| analysis-scope P2 shipped defaults (`q_a/**` in `DEFAULT_DEV_TOOLING`) | superseded by P3 (dropped; `.claude/**` gains shipped `!.claude/commands/**`) |
| analysis-scope P2/P4 `!pattern` re-include (semantics left to implementation, realized as exact-match cancel) | pinned by P4 as match-based — fulfilling analysis-scope P4's stated intent ("deliberate analysis should be one line of config"); exact cancels resolve unchanged |
| analysis-scope P3 init detection/confirmation | refined by P1/P2/P5 (class-aware candidates; declining writes negations; pre-selection) |
| `PRODUCT_DIR_ALLOWLIST` / "unclassified top-level directory" nag | replaced by P2's classification vocabulary (content class); satisfiable by declaration (code class) |
| finding 0027's three interview asks | absorbed into P5 |
| "degradation is always stated" (core principle) | given teeth by P6/P7 (consequences and vacuousness, not only globs and skips) |

## Non-goals

- No content-based classification at run time (heuristics run only where a human
  confirms — analysis-scope's standing non-goal).
- No overnight reclassification; `init`/`init --update` remain the sole write paths for
  scoping declarations.
- No threshold auto-tuning (P7 reports unreachability; it never adjusts).
- No new analysis of previously excluded trees beyond what re-includes declare.
- P8 ships nothing.

## Acceptance criteria

1. **Content class, defaults only:** on any repo with no import substrate and no
   `dev_tooling` config beyond defaults, the scope preview analyzes **every tracked
   top-level directory** except narrow convention exclusions, includes shipped re-included
   subpaths (agent command files appear in the surface inventory), and carries the P1
   class line. *(Regression fixture: product-lab — `ideas/`, `q_a/`, `lessons/`,
   `graveyard/`, `postmortems/`, `templates/`, and `.claude/commands/` with 10 command
   files analyzed; the rest of `.claude/**` and `_bmad*/**` excluded.)*
2. Unchecking the `.claude/**` convention exclusion in the init interview writes
   `!.claude/**` (or the narrower confirmed glob) into `config.yaml`; re-running init
   proposes nothing new (idempotent).
2a. **Heuristic default by signal strength (P5.2, finding 0035):** in a code-class repo,
   a non-dot heuristic candidate (fixture: `spaces/` beside a product package) arrives
   **unchecked** and is analyzed as product when the human confirms the common path,
   while a dot-prefixed heuristic candidate (`.github/`, `.devcontainer/`) arrives
   pre-checked (excluded); convention matches remain pre-checked. Accepting the interview
   without toggling anything never excludes the non-dot heuristic dir.
3. `!.claude/commands/**` under excluded `.claude/**` re-includes exactly that subtree
   (P4), verified via scope preview counts; existing exact-match negations resolve
   byte-identically to today on the current test fixtures.
4. On a content-class repo, no "unclassified top-level directory" line renders for any
   pre-existing product directory; adding a new top-level dir after init produces exactly
   one product-by-default notice on the next brief and none after. On a code-class repo,
   a directory named by a STATE.md authority path or confirmed re-include is classified
   (no nag) without allowlist membership. *(Regression fixture: product-lab's seven
   Machine-notes nags reduce to zero.)*
5. Emptying a signal source via scope produces the paired P6 degraded line (the
   `command_files: []` false-clean fixture); removing the exclusion removes the line.
6. On a no-substrate fixture, duplication/import-overlap/speculation report
   vacuous-degraded (not clean), and an unreachable coupling threshold is stated with
   both numbers (P7).
7. A `code`-class repo with the same config resolves scope byte-identically to today
   except where P3's default changes apply (no `q_a/**` exclusion; `.claude/commands/**`
   analyzed).

## Tests

- Class detection matrix: manifest present / absent / lockfile-orphan; per adapter.
- `extendGlobs` match-based resolution: exact cancel, subpath re-include, specificity
  ties, interaction with `ignore` tier, legacy-config byte-compat corpus.
- Interview write-path: decline-convention → negation written; accept → no write;
  pre-selection state per class.
- Scope preview: re-included subpath rendered with own count; class line; P2 notice
  fires once (ledger-backed seen-set).
- Degradation pairing: scope-emptied source ↔ degraded line (P6); vacuous classes and
  unreachable thresholds (P7); all-vacuous member summary + zero-candidate path.
