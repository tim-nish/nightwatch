# Spec: Finding lifecycle — open findings never vanish silently; `--force` never destroys evidence

- **Status:** accepted 2026-07-11 — **folded into `nightwatch.md`** §2.5, §3, §6.
  **FR assignment deferred.** **P7 (run-relative open set & staged run rows)** is a
  second-round addition from findings 0032 and 0034 item 5 — **accepted 2026-07-11 and
  folded into `nightwatch.md` §2.5 (lifecycle contract)**; implementation pending (see
  the [0026–0034 triage record](DRAFT-findings-0026-0034-triage.md)).
- **Motivated by:** dogfooding finding
  [0019 — finding disappearance](../dogfooding/0019-finding-disappearance.md) (the
  RC-615fba forensics: unfixed drift vanished from the brief, its staged patch was
  destroyed by a forced re-run, and the ledger recorded nothing); P7 by
  [0032 — first-run lifecycle mislabels](../dogfooding/0032-first-run-lifecycle-mislabels.md)
  and [0034 — contract drift](../dogfooding/0034-member-command-contract-drift.md)
  (item 5). Re-verification depth chosen by the maintainer 2026-07-11: **deterministic
  floor + budgeted judgment recheck**.
- **Scope:** the lifecycle of a finding after its first appearance — carry-forward,
  per-run classification, re-verification, proposal-artifact preservation, and
  forced-re-run ledger semantics. Finding ids, dedupe, verification-before-brief, and
  the feedback loop are unchanged.

## Problem

Stable ids (FR7) support dedupe *when a finding recurs*, but nothing obliges a run to
re-examine an open finding: claim discovery is judgment-layer and varies run to run, so
an unfixed severity-2 finding can simply not be looked at again — and today that means
it silently exits the brief, its patch is deleted by the same-date `out/` rewrite, and
the forced re-run leaves no ledger trace (0019's three gaps, all observed).

## P1 — Open-finding carry-forward and per-run classification

**Open finding** := recorded in the ledger, with no resolution row and no dismissed
feedback row. Every orchestrated run starts by loading the open set (through the
tracking store) and ends by classifying each open finding, exactly once:

| Classification | Meaning | Ledger row |
|---|---|---|
| `re-observed` | tonight's run found it again (same id) | finding row (dedupes as today) |
| `resolved` | evidence shows the underlying issue is gone | **new** `resolution` row (id, date, evidence clause) |
| `still-open` | evidence still present; not fully re-judged | `recheck` row (id, date, method: `deterministic` \| `judgment`) |
| `not-re-examined` | budget/scope did not reach it | `recheck` row (method: `skipped`) |

User dismissal (`[-]`) remains the existing feedback path and closes the finding as
today. The brief renders the open set with these freshness states
([brief-roadmap-composition](brief-roadmap-composition.md) P4); a `resolved` finding
appears once under "Since yesterday" and leaves the action list.

## P2 — Deterministic re-verification floor (always runs, zero tokens)

A script pass over every open finding's structured evidence (`{path, line}` plus the
recorded claim text where the finding carries one):

- cited path missing, or cited text no longer present at/near the cited line →
  **resolution candidate**: classified `resolved` when the finding's kind makes absence
  conclusive (a `drift` finding whose drifted text is gone), else escalated to P3.
- evidence still present → `still-open (deterministic)` — the state that would have
  caught RC-615fba: *"the drifted line is still in the file"* is checkable for free.
- path/line unresolvable either way → escalated to P3.

## P3 — Budgeted judgment recheck (bounded, oldest-first)

Findings the floor escalates get judgment-layer re-examination inside a reserved slice
of the owning job's `budget_tokens` (config: `recheck_budget` fraction, default `0.15`),
processed oldest-first; whatever the slice doesn't reach is classified `not-re-examined`.
Judgment rechecks use the same adversarial standard as new findings. The reserve is
taken *before* new-claim discovery so old open findings cannot be starved by a chatty
night.

## P4 — Disappearance is always reported

The brief never shows "0 findings" while the open set is non-empty. Open findings render
in the action sections with a freshness suffix (P1 states); additionally, one Machine-
notes line summarizes the night's lifecycle arithmetic ("N open: k re-observed, m
resolved, j still-open, i not-re-examined"), byte-deterministic. This is the structural
fix for 0019 gap 1: *fixed*, *missed*, and *refuted* are now distinguishable states, in
the reader's document.

## P5 — Proposal artifacts survive while their finding is open

Patch files are named per finding — `out/reconcile-<date>-<id>.patch` — and a run
(forced or not) **must not delete a patch whose finding id is still open**: it either
regenerates the patch (re-observed, still `derived`, still drifted) or preserves the
existing file and re-points the brief at it. A patch whose finding is `resolved` or
dismissed is garbage-collected with one Machine-notes line. (`out/` remains transient
overall — [runtime-layout](runtime-layout.md) — but open-finding patches are the
carve-out that survives a same-date rewrite.)

## P6 — Forced re-runs leave a ledger trace

`--force` propagates to every ledger writer: run rows for a forced same-date re-run are
appended with `forced: true` (never swallowed by the same-date guard), finding rows
still dedupe by id, and P1's classification rows are written exactly once per (id,
date, run-ordinal). The 0019 case — a re-run the ledger never heard about — becomes
structurally impossible; brief and ledger cannot disagree silently.

## P7 — Run-relative open set & staged run rows *(proposed 2026-07-11)*

P1's classification is defined **relative to the runs that came before tonight**, and the
first observed violation (0032) showed the boundary must be explicit: member jobs append
finding rows during the night, so a collector that builds the incoming open set from the
whole ledger classifies tonight's brand-new findings as `re-observed` — every finding on
product-lab's *first brief ever* rendered "_(seen again tonight)_" with a lifecycle line
of "8 re-observed."

**P7.1 — The incoming open set excludes the current run's rows.** Open-set construction
keys on run identity, not date alone (so `--force` re-runs — P6 — stay correct): rows
written by tonight's run ordinal are *outputs* of the night, never *inputs* to its
classification. Corollary, stated as its own invariant: **on a repo's first run the
incoming open set is empty and every finding classifies as new** — no freshness suffix,
lifecycle arithmetic "N new, 0 re-observed."

**P7.2 — One run row per (job, date, ordinal), recorded after judgment.** The observed
double-append (0034.5: the CLI auto-records `findings: 0` before the judgment layer
produces the night's findings, and the corrected row then needs `forced: true`) is
resolved by staging: the deterministic CLI records signals but **not** the run row; the
sole sanctioned run-row append happens once, after the owning job's judgment completes,
carrying the real findings count. Until implemented, consumers treat the **last** row per
(job, date, ordinal) as authoritative — but the staged write is the contract.

## Non-goals

- No change to finding ids, the findings JSON schema beyond the new lifecycle rows'
  producer, adversarial verification of *new* findings, caps, or the demotion rule's
  computation (it gains better-fed inputs, not new logic).
- No automatic closing of a finding on any signal weaker than P2's conclusive-absence
  rule or a judgment recheck — when in doubt, `still-open`.
- No retroactive rewriting of historical ledger rows.

## Acceptance criteria

1. A drift finding whose cited text is removed from the repo → classified `resolved`
   with a resolution row naming the evidence; it exits the brief's actions and appears
   once under "Since yesterday".
2. A drift finding whose cited text is still present, on a night whose run never
   re-extracts the claim (the RC-615fba fixture) → renders in the brief as
   `still-open`, with the Machine-notes lifecycle line — never "0 findings".
3. With `recheck_budget` exhausted by fixture sizing, remaining open findings are
   classified `not-re-examined` (rows written, brief suffix rendered); the reserve is
   consumed before new-claim discovery.
4. A forced same-date re-run preserves (or regenerates) the patch of a still-open
   finding — the brief's apply command always points at an existing file; a resolved
   finding's patch is collected with one Machine-notes line.
5. A forced re-run appends `forced: true` run rows and classification rows exactly once;
   re-running unforced the same night appends nothing (idempotency preserved).
6. Lifecycle output is byte-deterministic for identical inputs (NFR8).
7. *(P7, proposed)* A repo's first brief renders every finding with no freshness suffix
   and the lifecycle line "N new, 0 re-observed"; a same-night forced re-run still
   classifies against the pre-tonight open set; the ledger holds exactly one
   authoritative run row per (job, date, ordinal), written after judgment.

## Tests

- Evidence-recheck matrix: text gone / text present / path gone / line drifted /
  unresolvable — per finding kind.
- Budget accounting: reserve carved out first; oldest-first ordering; skipped rows.
- Patch preservation: forced rewrite with open finding (kept), with resolved finding
  (collected), regeneration path.
- Ledger: forced-rerun rows, dedupe, exactly-once classification per (id, date, ordinal).
- End-to-end 0019 replay fixture: night 1 finds + patches; night 2 forced, claim not
  re-extracted → still-open rendering, patch intact, ledger trace present.
