---
description: Detect spec ↔ docs ↔ code inconsistencies (nightly). Reports disagreements and, only where authority is declared, the direction of fix. Never edits repo files in place.
argument-hint: "[--repo .] [--force]"
---

# /repo-reconcile

You detect inconsistencies between specs, README, documentation, and implementation. You
report disagreements, and the *direction* of fix **only** when the repo has declared
precedence in `STATE.md`. You **never infer authority**, and you **never edit any repo file in
place** — proposals are patch files or human-decision findings.

## Deterministic layer

Run the surface inventory (the repo's *claimable surface*):
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/surface-inventory.js --repo .
```
Read `.nightwatch/out/surface-<date>.json`: CLI subcommands/flags, exported symbols,
command/skill files, config keys, file-tree shape, README code blocks and flag tokens. If the
build is broken or the surface is unparsable, that is **finding #1** and it stops deeper checks —
a broken build outranks all drift.

## Judgment layer

1. Load the `authority` block from `STATE.md`. **Absent → emit a single `setup` finding**
   ("declare authority in STATE.md; run `/nightwatch init`") and continue in **detection-only
   mode**: conflicts are still reported, but every finding omits direction-of-fix.
2. Extract testable claims from README, docs, and specs: commands that should exist, flags,
   behaviors, architecture assertions ("X never writes to Y").
3. Verify each claim against the surface inventory plus targeted code reads. Verdict per claim:
   `holds` / `drifted` / `unverifiable-statically` (needs a live run — list it for a daytime
   check, never guess).
4. **Adversarial pass:** in a separate reasoning pass (ideally a subagent), attempt to *refute*
   each `drifted` verdict. Only survivors get `verified: true` and reach the brief.
5. Direction of fix, from the authority role of the artifact the claim lives in:
   - `role: derived` (e.g. README follows code) → mechanically fixable. Generate a unified-diff
     **patch file** at `.nightwatch/out/reconcile-<date>.patch`. Patch files are the default and
     only mechanism. If config `patch_branch: true`, *additionally* apply the patch on branch
     `nightwatch/reconcile/<date>` created in a **temporary git worktree** — the user's working
     tree and checked-out branch are never touched. Finding `action: patch-available`.
   - `role: authoritative` → a conflict is a bug or an unrecorded decision:
     `action: human-decision`, and **no patch is ever drafted in either direction**.
   - authority undeclared → `action: human-decision` with direction omitted.

## Output

Write `.nightwatch/out/repo-reconcile-<date>.json` using the schema in
`${CLAUDE_PLUGIN_ROOT}/scripts/lib/findings.js` (stable ids via `makeId(job, kind, locus)` where
`locus` names the claim independent of wording, e.g. `"README.md::flag:--tag"`). Cap the brief
section at `caps.reconcile` (default 10), ranked by user-facing severity — a documented-but-
nonexistent command outranks a stale internal comment. Include an explicit "Human decisions
required" subsection. Clean repo → a single "0 findings" line, nothing else.

## Safety rules (normative)

- Never edits any repo file in place.
- Patches only for artifacts declared `derived`.
- Never resolves an authoritative-vs-code conflict in either direction.
- A broken build / unparsable surface is finding #1 and stops deeper checks.
- Failure handling: an authority glob matching nothing → `setup` finding naming the dead pointer;
  a missing docs directory → claims sourced from README only, noted in `degraded`.
