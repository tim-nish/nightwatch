# Dogfooding finding 0030 — Severity convention contradicts itself between spec and types: the brief's headline claimed "2 release blockers" that don't exist and ranked the most trivial finding as First action

- **Date:** 2026-07-11
- **Session:** dogfooding against `~/work/product-lab`; first overnight run, 8 findings.
- **Command:** brief assembly (`collect-brief.js`) consuming member-job findings JSON.
- **Classification:** **bug** — a correctness contradiction inside Nightwatch's own
  artifacts (exactly the class of drift Nightwatch exists to catch).
- **Status:** accepted 2026-07-11 — **Amendment N1** from the
  [0026–0034 triage record](../specs/DRAFT-findings-0026-0034-triage.md) is applied to
  `nightwatch.md` §2.5/§5/§6 (1=worst pinned; blocker classification keyed on `kind`,
  not the scale endpoint; headline sanity check); conformance story pending
  (`types.js` JSDoc, `collect-brief.js`, `commands/release-progress.md`).
  Additional touchpoint found in triage:
  [release-journey](../specs/release-journey.md) P2's "severity-1 findings" blocker line.
- **Priority:** High.

## Observed behavior

Tonight's brief opened with **"2 release blockers. Start below."** while its own road
section said **"Blocking the release: nothing"** — no blocker-grade finding existed. The
"▶ First action" slot went to the *least* important finding of the night (severity-1
stray nested `.obsidian/` dir), while the most important one (severity-4 "recall surfaces
missing — the q_a gateway commands cannot execute as written") was ranked **last** under
"If you have energy after that."

## Root cause

The two ends of the severity scale are defined in opposite directions in shipped
artifacts:

- `nightwatch.md:249` — *"`severity`: 1 blocker … 5 nice-to-have"* (**1 = worst**), and
  `commands/release-progress.md:53` promotes *"severity-1 findings into Release
  blockers"*.
- `scripts/lib/types.js:24-25` — *"Finding severity, 1 (lowest) .. 5 (highest)"*
  (**5 = worst**).

The member jobs followed the types convention (worst finding tonight = severity 4;
trivia = severity 1). The collector follows the spec convention:

- `classify()` (`scripts/collect-brief.js:26`): `severity === 1 → {rank: 0, label:
  'blocker'}` — the night's two most trivial findings were classed as blockers, which
  `deriveStatusLine()` (`collect-brief.js:159-160`) then counted into the headline.
- The global sort (`collect-brief.js:388`) orders `a.severity - b.severity` ascending —
  with 5=worst inputs, that is exactly inverted.

So one convention mismatch produced three visible failures: a false alarming headline, an
inverted First-action pick, and the real top finding demoted to the bottom.

## Why this matters

- The morning brief's whole value proposition is trusted ranking of capped attention;
  an inverted ranking with a false "release blockers" alarm is the worst possible
  first-run impression.
- The contradiction is *inside Nightwatch's own spec/code surface* — the tool would flag
  this in any repo it watched. `repo-reconcile` pointed at itself.
- Any independently-implemented member (subagents follow the command prose) can pick
  either convention; the ambiguity is load-bearing, not cosmetic.

## Suggested improvements

1. **Pin one convention** in `types.js` (the machine contract) and make `nightwatch.md`
   §finding-schema and `commands/release-progress.md` conform. Given `classify()` and the
   ascending sort, 1=worst is the smaller change — but either direction is fine as long
   as there is exactly one.
2. **Stop keying "blocker" on a scale endpoint.** `kind === 'blocker'` already exists in
   `classify()`; making that the only blocker path removes the endpoint ambiguity from
   the headline entirely.
3. **Add a collector-side sanity check:** if the headline claims blockers while the road
   says "Blocking the release: nothing," degrade to the decisions-tier headline and note
   the disagreement in Machine notes — the two lines are computed from the same night and
   should never diverge.
