---
description: Detect spec ↔ docs ↔ code inconsistencies (nightly). Reports disagreements and, only where authority is declared, the direction of fix. Never edits repo files in place.
argument-hint: "[--repo .] [--force]"
---

# /repo-reconcile

You detect inconsistencies between specs, README, documentation, and implementation. You
report disagreements, and the *direction* of fix **only** when the repo has declared
precedence in `STATE.md`. You **never infer authority**, and you **never edit any repo file in
place** — proposals are patch files or human-decision findings.

## Script root resolution

Every script and template path below is relative to the Nightwatch root. Resolve it once,
before running anything, and call the result `${NW_ROOT}` for the rest of this file:

1. If `${CLAUDE_PLUGIN_ROOT}` is set, use it (official plugin install).
2. Else if `${NIGHTWATCH_ROOT}` is set, use it (local/symlink install — see `docs/install.md`).
3. Else if the orchestrator launched you and supplied a Nightwatch root in your prompt, use that
   (a scheduled `/nightwatch` run resolves the root once and hands it to each member job) — this is
   the normal overnight path, and neither env var need be set in the subagent's environment.
4. Else stop and report: "Nightwatch root not found — set `NIGHTWATCH_ROOT` to the plugin directory
   (see docs/install.md) or install Nightwatch as a Claude Code plugin." Do not guess a path.

## Deterministic layer

Run the surface inventory (the repo's *claimable surface*):
```
node ${NW_ROOT}/scripts/surface-inventory.js --repo .
```
Read `.nightwatch/runtime/out/surface-<date>.json`: CLI subcommands/flags, exported symbols,
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
4. **Adversarial verification pass (normative):** dispatch a **second subagent** whose sole job is
   to *refute* each `drifted` verdict — argue the flag/command/behavior actually exists, the claim
   was misread, or the surface probe missed it. A verdict is set `verified: true` **only if it
   survives** that refutation. **Only verified findings enter the brief;** refuted verdicts are
   dropped (kept in the findings doc's `refuted` list for the record, never shown as a proposal and
   never patched). The deterministic harness (`${NW_ROOT}/scripts/reconcile.js`) drives the pass
   and applies the survivor/drop rule; the refutation itself is your judgment.
5. Direction of fix, from the authority role of the artifact the claim lives in:
   - `role: derived` (e.g. README follows code) **and the fix is a pure deletion** (stale text
     whose source is gone) → mechanically fixable. Generate a unified-diff **patch file** at
     `.nightwatch/runtime/out/reconcile-<date>.patch`. **The mechanical patch surface is delete-only by
     design** (spec `docs/specs/reconcile-patch-workflow.md` P3, FR97): patch files are the
     default and only mechanism *for deletion drift*, no other patch-authoring path exists, and
     you never hand-assemble a diff for any other change. If config `patch_branch: true`,
     *additionally* apply the patch on branch `nightwatch/reconcile/<date>` created in a
     **temporary git worktree** — the user's working tree and checked-out branch are never
     touched. Finding `action: patch-available`.
   - `role: derived` with **additive or modifying** drift (e.g. a command file the derived README
     never documents) → `action: human-decision`. The finding carries the proposed text as
     proposal content in its body (`proposal` field) for the human to apply themselves — **no
     patch file is ever written for an addition or modification** (FR97).
   - `role: authoritative` → a conflict is a bug or an unrecorded decision:
     `action: human-decision`, and **no patch is ever drafted in either direction**.
   - authority undeclared → `action: human-decision` with direction omitted.

## Output

Write `.nightwatch/runtime/out/repo-reconcile-<date>.json` using the schema in
`${NW_ROOT}/scripts/lib/findings.js` (stable ids via `makeId(job, kind, locus)` where
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
