# Spec: First-run and interactive-run UX for `/nightwatch`

- **Status:** accepted 2026-07-10 — folded into `nightwatch.md` §6 (FR37–FR41 in the
  epics requirements inventory). Exception: the signals-only `--dry-run` tier in P5 is
  **deferred**, not accepted. Implementation pending (Epic 6).
- **Motivated by:** dogfooding findings
  [0001 — First run gives no visibility](../dogfooding/0001-first-run-visibility.md) and
  [0005 — No preview of analysis scope](../dogfooding/0005-analysis-scope-preview.md)
- **Scope:** presentation and consent around the overnight flow in `commands/nightwatch.md`.
  No change to what the jobs analyze, what they write, or the deterministic scheduler.

## Problem

`/nightwatch` is designed for unattended scheduled execution, so it launches its member
subagents immediately and silently. A first-time user, however, runs it interactively — and
experiences 10+ minutes of opaque, high-budget background work with no plan, no cost estimate,
no stage indication, and no consent moment. See finding 0001 for the observed run and risks.

## Design constraints (invariants this spec must not break)

1. **Unattended runs stay promptless.** Overnight mode runs "under a permission profile where
   prompts are impossible" (`commands/nightwatch.md`). Any confirmation gate must apply only
   when a human is plausibly present, and must never block or fail a scheduled run.
2. **The scheduler stays deterministic.** All new UX is presentation of decisions the scripts
   already make (`orchestrate.js --plan`, config values) — never new improvised judgment in
   the command prompt.
3. **Read-mostly write surface is unchanged.** Nothing here writes outside `.nightwatch/**`.
4. **An unread report is negative value.** New output must be short: a plan is a handful of
   lines, a stage update is one line.

## Proposals

### P1 — Surface the execution plan before launching agents

The orchestrator already runs `node ${NW_ROOT}/scripts/orchestrate.js --repo . --plan` and gets
`{ status, due, skipped, steps }`. Today that JSON is consumed silently. Instead, the command
renders it to the user *before spawning the first subagent*:

```
Nightwatch plan for 2026-07-10 (first run in this repo)
  1. repo-reconcile     nightly   budget 200k tokens, effort medium, timeout 30m
  2. arch-review        weekly    budget 300k tokens, effort high,   timeout 30m
  3. release-progress   nightly   budget 100k tokens, effort medium, timeout 30m
  then: assemble brief → .nightwatch/MORNING.md
  skipped: none
```

- Data sources: `due`/`skipped`/`steps` from the plan; `budget_tokens`, `effort`,
  `timeout_minutes` from `.nightwatch/config.yaml` (or the documented defaults).
- Applies to every interactive run, not just the first — it is cheap and already computed.
- `skipped` members are listed with their `next_due` date, so "why didn't arch-review run?"
  is answered before it is asked.

### P2 — State estimated cost and duration up front

Alongside the plan, one summary line:

```
Estimated spend: up to ~600k tokens across 3 jobs; typical wall time 5–15 minutes,
hard ceiling 30 minutes per job (timeout_minutes).
```

- Token figure = sum of the due members' `budget_tokens` — a ceiling, not a promise, and
  labeled as such.
- Duration is bounded honestly: budgets and `timeout_minutes` give a hard ceiling; a typical
  range can be stated once real run data exists (run durations are already recordable in
  `.nightwatch/out/run-status-<date>.json`; a later refinement may quote the previous run's
  actual wall time and tokens).

### P3 — Narrate the current stage

One line per lifecycle event during the run, so a watching user can always answer "what is it
doing right now?":

```
[1/3] repo-reconcile — running (budget 200k, timeout 30m)…
[1/3] repo-reconcile — done in 4m 12s (findings: 6)
[2/3] arch-review — running…
```

- Events: member started, member finished (with outcome from the run-status contract:
  `ok | crashed | timeout | skipped`), brief assembly started/finished.
- Exactly one line per event — no streaming, no progress bars. The per-member outcomes are
  already recorded to `.nightwatch/out/run-status-<date>.json`; this narration is the same
  facts, shown live instead of only persisted.

### P4 — First-run confirmation gate (interactive only)

When **both** of the following hold, pause after showing the plan (P1) and estimate (P2) and
ask a single yes/no before launching members:

1. `.nightwatch/state.json` does not exist (this is the repo's first run — the file is
   created on first completed run, so its absence is a reliable, zero-cost signal); and
2. the session is interactive (a human is present to answer).

Rules:

- **Scheduled/unattended runs never prompt.** If the environment cannot prompt, proceed
  without asking — the promptless contract of overnight mode wins. The gate is a courtesy for
  a present human, not a lock.
- `--force` (or an explicit `--yes`) skips the gate.
- Declining stops before any subagent launch and before any write, and prints the one-line
  pointer to the lightweight mode (P5).
- From the second run onward there is no gate: the user has seen a full night, the cost is no
  longer a surprise, and prompting a cron-adjacent command every night would be noise.

### P5 — Lightweight first-contact mode

A way to see what Nightwatch would do at near-zero cost, separate from full orchestration:

- **`/nightwatch --plan`** — print P1 + P2 and exit. No subagents, no writes (matches
  `orchestrate.js --plan`, which already performs no writes).
- Optionally, a **signals-only** tier (`--dry-run`): run the deterministic scripts (signal
  gathering, surface inventory) and show raw counts — "reconcile found 41 claimable surface
  items, 3 candidate disagreements" — without launching any judgment/verification subagents.
  Cost: script execution only, no model budget.
- `/nightwatch init` step 5 (the post-setup dry run) should present the same P1/P2 plan and
  the P4 confirmation before its full `--force` night, since that is where most first-time
  users actually pay the first full budget.

### P6 — Analysis scope preview in the plan

Motivated by finding [0005](../dogfooding/0005-analysis-scope-preview.md): scope is resolved
deterministically before any subagent launches (merged ignore globs from
`scripts/lib/config.js` applied to the file walk), but never shown — so a misscoped run
(e.g. `_bmad/**` analyzed, finding 0002) is only discoverable after the budget is spent.

Extend the P1 plan display with a compact scope summary:

```
Scope: 214 files across scripts/ commands/ templates/ docs/ test/
Excluded: _bmad/ (312) _bmad-output/ (41) .claude/ (58) q_a/ (6) node_modules/ .git/
```

- Top-level directories with file counts only — a handful of lines, never a file listing.
- Computed by a deterministic script walk using the already-resolved globs; zero model-token
  cost and no new scoping logic (the `dev_tooling` tier, if adopted, comes from
  [`analysis-scope.md`](analysis-scope.md) — P6 only *displays* whatever scoping is in
  effect).
- Makes both failure directions visible at launch: unexpected inclusions (dev tooling in
  scope) and unexpected exclusions (product surface swallowed by an over-broad glob).
- Interactive runs: shown with the plan, ahead of the P4 confirmation gate, so an unexpected
  inclusion is visible at the one moment the user can still decline.
- Scheduled runs: never a prompt (constraint 1). The same summary is written to the run
  record (`.nightwatch/out/run-status-<date>.json`) and surfaces as the brief's one-line
  scope statement (analysis-scope spec, P5), so the information is preserved without
  blocking unattended execution.

## Non-goals

- No change to cadence, budgets, member order, brief assembly, or the ledger.
- No persistent progress UI or background polling infrastructure.
- No confirmation prompts on scheduled runs, ever.
- No cost *accounting* (billing integration); estimates come only from config ceilings and
  recorded prior runs.

## Acceptance criteria

1. An interactive `/nightwatch` run prints the plan (members, order, skips with reasons) and
   the cost/duration estimate before any subagent is launched.
2. On a repo with no `.nightwatch/state.json`, an interactive run asks for confirmation once;
   declining launches nothing and writes nothing.
3. A scheduled (non-interactive) run behaves byte-identically to today: no prompt, no
   blocking, same outputs.
4. During a run, each member start/finish/failure and brief assembly is announced in exactly
   one line each.
5. `/nightwatch --plan` exits after the plan with zero model-token spend and zero writes.
6. All new text is derived from `orchestrate.js --plan` output and config values — removing
   the UX layer must not change any scheduling decision.
7. The plan includes a scope summary (analyzed top-level dirs with file counts, excluded
   dirs with counts) computed before any subagent launches, at zero model-token cost; on
   scheduled runs it lands in the run record and the brief's scope line instead of the
   terminal, and never prompts.
