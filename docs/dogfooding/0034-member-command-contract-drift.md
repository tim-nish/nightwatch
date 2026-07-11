# Dogfooding finding 0034 — Member command docs have drifted from the scripts: stale output paths in all four command files, a CLI that runs (and writes) on `--help`, and three smaller contract gaps

- **Date:** 2026-07-11
- **Session:** dogfooding against `~/work/product-lab`; all three member jobs executed by
  agents following the command files literally.
- **Command:** `commands/*.md` vs `scripts/*` — the prompt↔script contract.
- **Classification:** mixed — one **safety bug**, one **doc-drift cluster**, three spec
  gaps. Grouped because they were all hit the same night by agents doing exactly what the
  docs say.
- **Status:** triaged 2026-07-11, split by item (complete disposition in the
  [0026–0034 triage record](../specs/DRAFT-findings-0026-0034-triage.md)): item 1 →
  **Amendment N3** (applied to `nightwatch.md` §6 2026-07-11) + direct story; item 2 →
  direct story (conformance to
  [runtime-layout](../specs/runtime-layout.md)); item 3 → direct story; item 4 →
  [`reconcile-patch-workflow.md`](../specs/reconcile-patch-workflow.md) **P3** per
  maintainer Decision 2 (delete-only stays); item 5 →
  [`finding-lifecycle.md`](../specs/finding-lifecycle.md) **P7** (with 0032). Related:
  [0024](0024-runtime-vs-user-files.md) (the runtime/ move these docs weren't updated
  for).
- **Priority:** High for items 1–2; Medium for the rest.

## Findings

1. **SAFETY: `reconcile.js` has no usage guard — any invocation runs fully and writes.**
   `--help` (or any unknown flag) is silently ignored by `parseArgs`
   (`scripts/reconcile.js:455`) and the tool executes against **cwd**, creating
   `.nightwatch/` wherever you stand. During the run, an exploratory `--help` from inside
   the plugin checkout created `scripts/.nightwatch/` **in the Nightwatch repo itself**
   — a breach of "the entire write surface is the target repo's `.nightwatch/**`"
   (detected via `git status`, removed). Overnight-agent CLIs get probed by agents;
   `--help`/`-h`/unknown-flag must print usage and exit without writing. Presumably the
   same applies to the other job CLIs.

2. **Stale output paths in every command file.** The runtime-layout change
   ([0024](0024-runtime-vs-user-files.md)) moved job outputs to `.nightwatch/runtime/out/`,
   but the command docs still direct members to `.nightwatch/out/`:
   `commands/arch-review.md:48,86`, `commands/release-progress.md:29,37,66`,
   `commands/repo-reconcile.md:30,54,64` (and `commands/nightwatch.md:29,228` in the
   safety-contract/run-status prose). Every member agent tonight first looked in the
   wrong directory; a stricter one would have reported the signals file missing and
   crashed the job. This is Nightwatch's own disease — spec says X, implementation does Y
   — in its own commands.

3. **Script-root rule contradicts orchestrated execution.** Each member doc demands
   `CLAUDE_PLUGIN_ROOT`/`NIGHTWATCH_ROOT` and says otherwise "stop immediately and
   report" — but the orchestrator launches members as subagents whose prompt supplies the
   resolved NW_ROOT directly; neither env var is necessarily set in the subagent's
   environment. A literal member refuses to run on a perfectly healthy night. The docs
   should accept an orchestrator-supplied root as satisfying resolution.

4. **The patch harness can only emit delete patches.** `repo-reconcile.md:54` calls patch
   files "the default and only mechanism," but the only shipped helper is
   `unifiedDiffDelete` — tonight's real derived-doc drift needed an **additive** README
   patch, which the member had to hand-assemble (and separately, judgment-layer findings
   have no CLI entry path into the findings JSON/ledger at all; the member used
   undocumented lib exports). Either ship additive/modify diff helpers and a
   findings-append entry point, or the docs should state the mechanical-fix surface is
   delete-only.

5. **Ledger double-count on judged runs.** The reconcile CLI auto-appends its run row
   (`findings: 0`) before the judgment layer produces the night's real findings; the
   corrected row then needs `forced: true`, leaving two same-date run rows. Recording
   should be staged (CLI writes signals; one sanctioned post-judgment append records the
   run), or the collector must be defined to take the last row per date.

## Why this matters

- These are exactly the failure modes Nightwatch hunts in other repos: derived docs
  (command prose) trailing the code they describe, and a safety contract the tooling
  itself can violate on a stray flag.
- Member jobs are executed by *fresh* agents every night; they have no memory of "what
  the docs really mean." The prompt↔script contract is the product's API and currently
  requires improvisation on every divergence.

## Suggested improvements

1. Add a usage guard to all job CLIs: unknown flag / `--help` → print usage, exit 0,
   write nothing; refuse to run when cwd isn't a git checkout **and** `--repo` wasn't
   given explicitly.
2. Sweep `commands/*.md` for `.nightwatch/out/` → `.nightwatch/runtime/out/` (and add a
   test greping command docs for paths that `lib/util.outDir` no longer produces).
3. Reword script-root resolution: "resolve from `CLAUDE_PLUGIN_ROOT`, `NIGHTWATCH_ROOT`,
   or the root the orchestrator handed you; stop only if none is available."
4. Ship `unifiedDiffAdd`/`unifiedDiffModify` (or generate diffs via `git diff --no-index`)
   and a sanctioned `record-findings` CLI entry for judgment output.
5. Define run-row semantics for judged runs (staged append or last-row-wins).
