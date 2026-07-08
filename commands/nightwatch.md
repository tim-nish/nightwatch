---
description: Orchestrator — run what's due (reconcile → arch-review → release-progress) and emit one capped, ranked morning brief. `init` runs interactive daytime setup. The scheduled entrypoint.
argument-hint: "[init] [--repo .] [--force]"
---

# /nightwatch

The single scheduled entrypoint for unattended overnight review. You run the member jobs that
are due, in dependency order, then assemble one capped, ranked morning brief. You survive any
member job failing. With the argument `init`, you instead run interactive daytime setup.

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
3. Write `STATE.md` from `${CLAUDE_PLUGIN_ROOT}/templates/STATE.md` and, if the user wants
   operational overrides, `.nightwatch/config.yaml` from the template. Add `.nightwatch/out/` to
   the repo's `.gitignore`.
4. Run each job once in dry-run and show the first brief (see the overnight flow below with
   `--force`). Stop and let the human review.

Overnight mode never creates or edits `STATE.md` or `config.yaml`.

---

## Overnight flow (no argument)

1. **Preconditions.** If the repo is not a git checkout → abort with a one-line stub brief and
   exit. If `.nightwatch/briefs/<date>.md` already exists and `--force` was not passed → this is
   a same-night re-invocation: read `state.json` + the dated brief and exit **without spending
   tokens or changing files**.

2. **Cadence.** Read `.nightwatch/state.json` (cadence cursors, last-run dates) and config
   `cadence`. Decide which members are due tonight: `repo-reconcile` (nightly),
   `arch-review` (weekly), `release-progress` (nightly). Create `state.json` on first run.

3. **Run members in dependency order**, each as an independent subagent with its
   `budget_tokens`, `effort`, and `timeout_minutes` from config:
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
   node ${CLAUDE_PLUGIN_ROOT}/scripts/collect-brief.js --repo .
   ```
   This writes `.nightwatch/briefs/<date>.md`, overwrites `.nightwatch/MORNING.md`, appends
   per-job ledger lines, and computes the demotion rule. Fixed section order and the global cap
   `caps.brief_total` (default 25) with interleave priority (blockers > human decisions > drift >
   arch > nice-to-have) are enforced by the script, not by you.

5. **Morning feedback loop.** Before running the jobs, backfill last brief's checkbox marks:
   read the previous `MORNING.md`, and for each item the user checked (`[x]`), set `acted_on:
   true` on the matching `type:"finding"` row for that id in `ledger.jsonl` (append a correction
   row). The demotion rule (a member with zero acted-on findings two runs running) is then
   computed by `collect-brief.js` and surfaced in the next brief — the system proposes pruning
   itself.

6. **Update `state.json`** cadence cursors and last-run dates.

## Failure handling

- Not a git checkout → one-line stub brief, exit.
- A member exceeds `timeout_minutes` → kill it, note it, proceed to the next job.
- `collect-brief.js` itself fails → the raw findings JSON remains in `.nightwatch/out/`; write a
  stub `MORNING.md` naming the failure. **No brief at all is itself a signal — always attempt a
  stub.**
