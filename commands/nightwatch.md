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

Run this when the user types `/nightwatch init`. The interview is yours to conduct; the file
writing, the adapter probe, and the template instantiation are **deterministic** and delegated
to `${NW_ROOT}/scripts/init.js` so setup is reproducible and never improvised.

1. **Precondition.** Verify this is a git checkout (`init.js` aborts with `not-a-git-checkout`
   otherwise). `init.js` also detects whether `STATE.md` / `.nightwatch/config.yaml` already exist
   — it will **never clobber** an existing declaration, so this mode is safe to re-run.

2. **Probe the extractor adapters** (read-only, writes nothing):
   ```
   node ${NW_ROOT}/scripts/init.js --repo . --probe
   ```
   This runs each adapter's `detect`/`available` **locally only** (host repo's `node_modules/.bin`
   or a venv, then `PATH` — never install, never network) and prints a per-adapter report
   `{ name, tool, detected, available, installHint }`. For every **detected-but-unavailable** tool,
   offer the human its `installHint` — **this is the ONLY moment tool installation is ever
   suggested.** Do not run the install yourself; hand the human the command.

3. **Interview the human** (you may ask questions here — the one mode that may): authority per area,
   phase, release target and definition of done, optional layering rules.

4. **Write the declarations from templates.** Run:
   ```
   node ${NW_ROOT}/scripts/init.js --repo .
   ```
   This instantiates `STATE.md` from `${NW_ROOT}/templates/STATE.md` and
   `.nightwatch/config.yaml` from `${NW_ROOT}/templates/config.yaml` **only where absent** (an
   existing declaration is preserved byte-for-byte), and adds `.nightwatch/out/` to the repo's
   `.gitignore`. Pass `--no-config` to write `STATE.md` only. Then help the human fill the freshly
   written declarations from the interview answers (authority, phase, release, layers).

5. **Dry-run and show the first brief.** Run each job once and assemble the first brief (the
   overnight flow below with `--force`). Stop and let the human review.

Overnight mode never creates or edits `STATE.md` or `config.yaml`, and never installs anything —
`init` is the sole write path for the declaration files and the sole place installs are suggested.

---

## Overnight flow (no argument)

The precondition, idempotency, cadence, and cursor decisions below are **not yours to improvise** —
they are computed deterministically by the scheduler so every night is reproducible. Get the plan
first, then execute exactly the members it lists:

```
node ${NW_ROOT}/scripts/orchestrate.js --repo . --plan
```

This prints `{ status, due, skipped, steps, members, estimate, scope }` and performs **zero writes
and spends zero model tokens** (FR41). `status` is `abort` (not a git checkout — emit the one-line
stub brief and stop), `noop` (a completed run already exists tonight and `--force` was not passed —
read `state.json` + the dated brief and exit **without spending tokens or changing files**), or
`plan` (proceed). `due` is the ordered member list to run; `skipped` explains each member left out
(with its `next_due` date); `steps` is `due…` followed by `collect-brief`.

**Interactive runs: show the plan before launching anything (FR37/FR38).** When this run is
interactive, render the enriched plan to the human *before* the first member subagent launches —
everything below is already in the `--plan` JSON, so this is presentation only and changes no
scheduling decision:

- **Due members, in order** — from `members`: each `job` with its `budget_tokens`, `effort`, and
  `timeout_minutes`.
- **Skipped members** — from `skipped`: each `job` with its `next_due`.
- **Estimate** — from `estimate`: the total `token_ceiling` (a hard budget ceiling, not a forecast)
  and the bounded `duration_minutes`.
- **Scope preview** — from `scope`: `analyzed` top-level directories with file counts and `excluded`
  directories with counts, plus the `analyzed_files` / `excluded_files` totals. Computed by a
  deterministic filesystem walk at zero model-token cost; a surprising split here means the scope is
  wrong — fix `.nightwatch/config.yaml` before spending the budget.

On **scheduled (non-interactive)** runs, print nothing: the same `scope` and `estimate` are written
to `.nightwatch/out/run-status-<date>.json` by the non-`--plan` scheduler call, and the exclusions
surface as the brief's one-line scope statement instead.

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

Partial nights degrade cleanly — one member failing never blocks the others, and the human always
wakes to a brief (FR32):

- **Not a git checkout** → `orchestrate.js --plan` returns `status:"abort"` and writes a one-line
  stub `MORNING.md` (and dated brief) naming the failure. Stop; run no members.
- **A member crashes or exceeds `timeout_minutes`** → kill that subagent, then record its outcome
  in `.nightwatch/out/run-status-<date>.json` — `{"job", "status":"timeout"|"crashed", "note",
  "tokens"}` — and proceed to the next job. A member cadence left out records `"status":"skipped"`.
  `collect-brief.js` renders every non-`ok` status as exactly **one line** in the "Failures &
  degraded notices" section, so the surviving jobs' sections are untouched and the run still exits
  success.
- **`collect-brief.js` itself fails** → the raw findings JSON is left untouched in
  `.nightwatch/out/`, and the collector still writes a stub `MORNING.md` (and dated brief) naming
  the failure. **No brief at all is itself a signal — the collector always attempts a stub.**
