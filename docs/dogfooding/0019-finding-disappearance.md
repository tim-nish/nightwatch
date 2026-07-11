# Dogfooding finding 0019 — An open finding vanished silently: `--force` re-runs neither re-verify nor explain previously-open findings

- **Date:** 2026-07-11
- **Session:** dogfooding — *writing-assistant*. First run 2026-07-10 18:38–19:03 reported
  `RC-615fba` (README asset-paths drift, severity 2, patch staged). A `--force` re-run
   2026-07-11 01:46–01:54 (same brief date) reported **0 reconcile findings**. The user
  could not tell why the finding disappeared.
- **Command:** `/nightwatch --force` (same-date forced re-run); subject is `repo-reconcile`'s
  re-discovery behavior plus the orchestrator's `--force` overwrite semantics.
- **Classification:** trust / explainability. Not a crash — every job exited `ok` — but the
  system's core asset (principle 3: trust) leaked through three separate gaps at once.
- **Status:** documented, with full forensics below. No spec updated yet; next step at end.

## The question asked

> Was the underlying problem actually fixed, or simply not rediscovered? If not
> rediscovered, why not? Is this expected behavior or a weakness?

## Forensic answer (all verified in the repo)

**The problem was NOT fixed.** `README.md:154–155` still attributes bundled `scripts/` to
`${CLAUDE_SKILL_DIR}`; no commit has touched `README.md` since 07-10 10:40 (before the
*first* run) and the working tree is clean — the staged patch was never applied.

**The finding was NOT rediscovered — and it was never refuted either.** The forced re-run's
`repo-reconcile-2026-07-10.json` shows the run extracted only **two claims** in total (a
`--plugin-dir` flag claim, correctly refuted as a false positive of the unknown-ecosystem
probe, and one `unverifiable-statically` architecture assertion). The asset-paths claim was
simply **never re-extracted**, so the drift was never re-examined. Between the runs the
repo also changed (10+ commits merged, `skills/*/SKILL.md` grew substantially), and the
re-run spent fewer tokens on reconcile (72,512 vs 99,754) — different repo, different
sampling, different claim set.

**Why:** claim extraction is the judgment layer — an agent reading README/docs under a
token budget, here in degraded universal-fallback mode (ecosystem "unknown", no extractor).
Determinism is guaranteed only for brief *assembly* (NFR8); claim *discovery* is
explicitly judgment (principle 4) and varies run to run. Nothing in the spec carries
previously-open findings forward for re-verification: stable finding ids (FR7) support
dedupe and recurrence-counting *when a finding recurs*, but there is no obligation to
re-check one that doesn't.

**Verdict: expected per the letter of the spec — and a real weakness against its own trust
principle.** Three distinct gaps compounded:

1. **Silent disappearance.** The brief said `repo-reconcile: 0 verified findings` with no
   line acknowledging that yesterday's severity-2, patch-ready finding was not re-observed.
   The reader cannot distinguish *fixed* / *missed* / *refuted* — and here the truth was
   "missed."
2. **`--force` destroyed the proposal artifact.** The same-date re-run rewrote `out/`,
   deleting `reconcile-2026-07-10.patch` (`patch_path: null` in the new JSON) while the
   drift it fixed is still physically present. Yesterday's brief's First action now points
   at a file that no longer exists; clearing RC-615fba now requires a manual edit.
3. **No ledger trace of the re-run.** `ledger.jsonl` was last written 07-10 19:02 — the
   forced re-run appended nothing (the collect-brief same-date idempotency guard swallowed
   the re-run's rows). The system's memory still reads "RC-615fba found 2026-07-10" with no
   record that a later run saw 0 findings; brief and ledger now disagree invisibly.

**What worked — worth preserving:** the tracking store's persistence did exactly its job.
`release-progress` never deletes items (FR25), so `RELEASE.md` still carries the RC-615fba
item, *noticed the contradiction*, and documented it precisely: "drift still physically
present (now README.md:155)… the patch previously staged is no longer on disk… a manual
one-line edit is now required," updating Next actions #1 accordingly. The system's memory
layer caught what its reporting layer dropped — the answer existed, but in the file below
the fold of the product's attention model, and only because the tracker happens to
cross-reference this finding through DoD-3.

## Why this matters

- This is the trust principle failing in miniature: a user who watches a real finding
  vanish unexplained starts doubting every "0 findings" line (finding 0016's "what else
  here is noise?" in a sharper form: *what else here is silence?*).
- `--force` is the recommended recovery/repair gesture; it must never make the repo's
  recorded state *worse* (destroyed patch, orphaned ledger).

## What this suggests (observations, not yet design)

- **Not-re-observed reconciliation:** a run that starts with open findings from the ledger
  should end by classifying each — *re-observed* / *resolved (evidence: the claim now
  holds)* / *not re-examined* — and the brief should carry one line for anything in the
  third bucket. Cheap deterministic floor: for a `drift` finding, re-checking whether the
  cited evidence text still exists is script work, no judgment needed.
- **`--force` preserves or regenerates proposals:** never delete a `*.patch` whose finding
  is still open; either regenerate it or leave it in place.
- **Every run leaves a ledger trace:** the same-date guard must not swallow a forced
  re-run's rows (record with a re-run marker rather than skipping).

## Next step

Scope a spec (candidate: `docs/specs/finding-lifecycle.md`) covering the three gaps —
not-re-observed reconciliation, force-safe proposal artifacts, forced-re-run ledger
semantics — motivated by this finding; triage alongside the roadmap-first feedback
([0018](0018-roadmap-first-brief.md)).
