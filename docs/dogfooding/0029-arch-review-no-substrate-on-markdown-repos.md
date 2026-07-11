# Dogfooding finding 0029 — On a markdown-only repo, arch-review structurally cannot fire, and its empty signal classes read as "clean" instead of "no substrate"

- **Date:** 2026-07-11
- **Session:** dogfooding against `~/work/product-lab` (markdown idea-pipeline repo; no
  imports, no modules, no dependency graph).
- **Command:** `/arch-review` (overnight member job; effort high, budget 300k).
- **Classification:** use-case fit — the job ran cleanly and emitted zero findings; the
  problem is what "zero" means here and that the job's one universal signal is
  unreachable on this repo class.
- **Status:** partially specced 2026-07-11 — items 1, 2, 5 are
  [`content-repo-scoping.md`](../specs/content-repo-scoping.md) **P7 (accepted
  2026-07-11), P8 (deferred)**;
  items 3–4 (placeholder churn, zero-candidate wording) are direct stories, no spec
  change. Related: [0028](0028-content-repo-scope-inversion.md) (same target, scoping
  layer), [0002](0002-analysis-scope-dev-tooling.md). Triage:
  [0026–0034 record](../specs/DRAFT-findings-0026-0034-triage.md).
- **Priority:** Medium.

## Observed behavior

1. **Every code-shaped signal class was structurally empty:** speculation (no typed
   language), duplication / import-overlap (no imports or signatures), layering (none
   declared, nothing to infer). The two skipped classes got explicit `degraded` notices
   — good — but duplication, import-overlap, and co-change coupling returned bare empty
   results, indistinguishable from "checked and clean."

2. **The one always-available signal can never fire here.** Git co-change coupling uses
   `couplingMinCommits = 5` (`scripts/git-signals.js:17`); the repo's maximum per-file
   churn is 4 across 27 non-merge commits. The check was live but unreachable, and
   nothing said so. Net effect: on this repo class, `/arch-review` burns a weekly slot
   and a 300k budget ceiling to produce a guaranteed-empty section.

3. **Growth hotspots counted `.gitignore` and three `.gitkeep` placeholders** as churn,
   and — with `authority.architecture` undeclared — `unmentioned_hotspots` was skipped
   with no degraded notice, so the growth signal was computed, serialized, and fed
   nothing.

4. **The zero-candidate path is unspecified.** The command file's judgment layer is
   written entirely as "for each candidate," including the normative adversarial refute
   subagent. With zero candidates the member had to improvise (skip the refute pass,
   emit an empty brief). A literal reader might spawn a refuter with nothing to refute or
   conclude the run failed.

5. **The repo does have an architecture — just not in code.** STATE.md declares exactly
   the derivation rules an architecture review of *this* repo would want to check
   (INDEX.md derived from `ideas/` frontmatter; README derived from CLAUDE.md; spec →
   command mapping), but arch-review consumes only `authority.architecture` and has no
   way to use them.

## Why this matters

- "0 verified findings" and "nothing was inspectable" are different verdicts; presenting
  the second as the first is the same false-clean failure mode as 0028, one layer up.
- A job that provably cannot produce a finding on a repo class should say so once (or
  propose its own demotion — the two-strikes machinery exists) rather than run weekly.

## Suggested improvements

1. **Distinguish vacuous-empty from clean:** when a signal class had no substrate (no
   imports, threshold above max observed churn), emit a degraded notice naming it —
   e.g. *"no source modules found — duplication checks vacuous"*, *"coupling threshold 5
   exceeds max per-file churn 4 — signal unreachable."*
2. **Scale or state the coupling threshold** relative to repo history depth.
3. **Exclude placeholder files** (`.gitkeep`, `.gitignore`) from hotspot churn.
4. **Specify the zero-candidate path** in `commands/arch-review.md`: "if zero candidates:
   skip the refute pass, emit an empty brief with degradations, stop."
5. **Consider a docs-repo mode:** treat declared derivation relationships
   (`role: derived` authorities) as the layering rules to check — that is this repo
   class's real architecture, and the declarations already exist in STATE.md.
6. **Let structural emptiness feed the demotion rule:** an arch-review that is vacuous N
   runs running should flag itself for cadence reduction/retirement on this repo.
