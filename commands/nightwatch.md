---
description: Orchestrator — run what's due (reconcile → arch-review → release-progress) and emit one capped, ranked morning brief. `init` runs interactive daytime setup. The scheduled entrypoint.
argument-hint: "[init] [--repo .] [--force]"
---

# /nightwatch

The single scheduled entrypoint for unattended overnight review. You run the member jobs that
are due, in dependency order, then assemble one capped, ranked morning brief. You survive any
member job failing. With the argument `init`, you instead run interactive daytime setup.

## Script root resolution

Every script and template path below is relative to the Nightwatch root. Resolve it once,
before running anything, and call the result `${NW_ROOT}` for the rest of this file:

1. If `${CLAUDE_PLUGIN_ROOT}` is set, use it (official plugin install).
2. Else if `${NIGHTWATCH_ROOT}` is set, use it (local/symlink install — see `docs/install.md`).
3. Else stop immediately and report: "Nightwatch root not found — set `NIGHTWATCH_ROOT` to the
   plugin directory (see docs/install.md) or install Nightwatch as a Claude Code plugin." Do
   not guess a path.

**These safety rules bind every member job and you enforce them by contract:**

- Never implement features, never refactor, never modify source code.
- Write surface, exhaustively: `.nightwatch/**`, `RELEASE.md`, patch files under
  `.nightwatch/out/`, and (opt-in) `nightwatch/*` branches via a **temporary worktree**. Nothing
  else, ever — never the user's current branch or working tree.
- Never push, never open PRs or issues, never post externally. No network.
- Idempotent per date; runs under a permission profile where prompts are impossible.

---

## `init` mode (daytime, interactive — the ONLY mode that may ask questions)

Run this when the user types `/nightwatch init`.

1. Verify this is a git checkout. Detect whether `STATE.md` and `.nightwatch/config.yaml` exist.
2. Interview the human (you may ask questions here): authority per area, phase, release target
   and definition of done, optional layering rules.
3. Write `STATE.md` from `${NW_ROOT}/templates/STATE.md` and, if the user wants
   operational overrides, `.nightwatch/config.yaml` from the template. Add `.nightwatch/out/` to
   the repo's `.gitignore`.
4. Run each job once in dry-run and show the first brief (see the overnight flow below with
   `--force`). Stop and let the human review.

Overnight mode never creates or edits `STATE.md` or `config.yaml`.

---

## Overnight flow (no argument)

The precondition, idempotency, cadence, and cursor decisions below are **not yours to improvise** —
they are computed deterministically by the scheduler so every night is reproducible. Get the plan
first, then execute exactly the members it lists:

```
node ${NW_ROOT}/scripts/orchestrate.js --repo . --plan
```

This prints `{ status, due, skipped, steps }`. `status` is `abort` (not a git checkout — emit the
one-line stub brief and stop), `noop` (a completed run already exists tonight and `--force` was not
passed — read `state.json` + the dated brief and exit **without spending tokens or changing
files**), or `plan` (proceed). `due` is the ordered member list to run; `skipped` explains each
member left out (with its `next_due` date); `steps` is `due…` followed by `collect-brief`.

1. **Preconditions & idempotency.** Handled by the `abort` / `noop` statuses above. `orchestrate.js
   --plan` performs **no writes** — it only reads `.nightwatch/state.json` and config.

2. **Cadence.** `.nightwatch/state.json` holds one **human-inspectable cursor per member** —
   `{cadence, last_run, runs, next_due}` — plus `last_brief_date` (the idempotency sentinel).
   Cadence is config-owned (`repo-reconcile` nightly, `arch-review` weekly, `release-progress`
   nightly); a member whose cursor is not due tonight appears in `skipped`, so `arch-review` runs
   at most weekly. The file is created on first run.

3. **Run members in dependency order** — exactly the jobs in `due`, each as an independent subagent
   with its `budget_tokens`, `effort`, and `timeout_minutes` from config:
   1. `/repo-reconcile` (if due)
   2. `/arch-review` (if due)
   3. `/release-progress` (last, so it consumes tonight's findings JSON)

   A crash, timeout, or budget exhaustion of one member is recorded as **one line** and **never
   blocks the remaining jobs** — the findings-file contract means `release-progress` runs on
   whatever JSON exists, so a partial night degrades cleanly. Record per-member outcomes to
   `.nightwatch/out/run-status-<date>.json` as
   `{ "jobs": [ {"job","status":"ok|crashed|timeout|skipped","note","tokens"} ] }`.

4. **Assemble the brief** (deterministic — truncation must be mechanical):
   ```
   node ${NW_ROOT}/scripts/collect-brief.js --repo .
   ```
   This writes `.nightwatch/briefs/<date>.md`, overwrites `.nightwatch/MORNING.md`, appends
   per-job ledger lines, and computes the demotion rule. Fixed section order and the global cap
   `caps.brief_total` (default 25) with interleave priority (blockers > human decisions > drift >
   arch > nice-to-have) are enforced by the script, not by you.

5. **Morning feedback loop.** **Before running the jobs**, backfill last brief's checkbox marks:
   ```
   node ${NW_ROOT}/scripts/backfill-feedback.js --repo .
   ```
   This reads the previous `.nightwatch/MORNING.md` and, for each rendered finding whose box the
   user checked (`[x]` → acted-on; `[-]`/`[~]` → dismissed), appends one `type:"feedback"`
   correction row for that finding id to `ledger.jsonl` **through the tracking store's
   `recordFeedback()`** (the sole sanctioned ledger writer) — dated to the brief being marked, and
   skipping marks already recorded so a re-run never double-counts. The demotion rule (a member
   with zero acted-on findings two runs running) then folds these marks in when `collect-brief.js`
   computes it, surfacing the flag in the next brief — the system proposes pruning itself.

6. **Update `state.json`.** Run the scheduler once more without `--plan` to advance the cadence
   cursors (`last_run`, `runs`, `next_due`) for the members that ran and stamp `last_brief_date`:
   ```
   node ${NW_ROOT}/scripts/orchestrate.js --repo .
   ```
   This is the only step that writes `state.json`, and it writes nowhere else — the sole scheduler
   write lands inside `.nightwatch/**`. A subsequent same-night invocation now returns `noop`.

## Failure handling

- Not a git checkout → one-line stub brief, exit.
- A member exceeds `timeout_minutes` → kill it, note it, proceed to the next job.
- `collect-brief.js` itself fails → the raw findings JSON remains in `.nightwatch/out/`; write a
  stub `MORNING.md` naming the failure. **No brief at all is itself a signal — always attempt a
  stub.**
