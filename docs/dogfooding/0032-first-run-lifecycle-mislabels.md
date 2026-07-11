# Dogfooding finding 0032 — Every finding on the very first brief was labeled "_(seen again tonight)_" and counted as re-observed

- **Date:** 2026-07-11
- **Session:** dogfooding against `~/work/product-lab`; first run ever — no prior brief,
  no prior ledger.
- **Command:** brief assembly (`collect-brief.js`), finding-lifecycle classification.
- **Classification:** **bug** — lifecycle labels are wrong on first observation.
- **Status:** specced 2026-07-11 —
  [`finding-lifecycle.md`](../specs/finding-lifecycle.md) **P7 (accepted 2026-07-11)**, together
  with [0034](0034-member-command-contract-drift.md) item 5 (staged run rows — one ledger
  contract, one home). Related: [0019](0019-finding-disappearance.md) (the lifecycle spec
  these labels come from). Triage:
  [0026–0034 record](../specs/DRAFT-findings-0026-0034-triage.md).
- **Priority:** Medium.

## Observed behavior

All 8 findings on the first brief carried the freshness suffix **"_(seen again
tonight)_"**, and the Machine notes summarized **"Open findings: 8 — 8 re-observed, 0
resolved, 0 still-open, 0 not re-examined."** Nothing had ever been observed before.

## Root cause (probable)

Member jobs append their finding rows to `ledger.jsonl` during the night (recurrence
bookkeeping), *before* `collect-brief.js` runs. The collector then builds the incoming
open set from the ledger and classifies anything present there as carried-forward:
`freshnessSuffix()` (`scripts/collect-brief.js:66-73`) only returns an empty suffix for
findings *"not in the open set coming in"* — but tonight's own rows, dated tonight, are
already in that set. First-seen findings are therefore indistinguishable from
re-observations. The open-set construction needs to exclude rows written by the current
run (same date/run id), or members should record findings through a staged path the
collector folds in after classification.

## Why this matters

- The lifecycle vocabulary exists to make the brief trustworthy about what is new versus
  what is being held open (spec finding-lifecycle / 0019). If day one says "seen again,"
  the label carries no information on any later day either.
- "Re-observed with zero acted-on" is also the demotion rule's input — first-night
  findings mislabeled as recurrences start the two-strikes clock a night early.

## Suggested improvements

1. Exclude same-run ledger rows when building the incoming open set (key on run id, not
   just date, so `--force` re-runs stay correct).
2. First brief special case: with no prior brief on disk, no finding can be carried
   forward — assert the open set is empty and label everything new.
3. Add a first-run fixture test asserting the counts line reads "8 new, 0 re-observed."
