# Dogfooding finding 0001 — First run gives no visibility before or during expensive work

- **Date:** 2026-07-10
- **Command:** `/nightwatch` (invoked as `/nightwatch:nightwatch`, plugin-namespaced), first run in a repo
- **Classification:** UX issue — not an implementation bug. Every step behaved as specified in
  `commands/nightwatch.md`; the problem is what the user could see while it happened.
- **Status:** documented; proposed improvements specced in
  [`docs/specs/first-run-ux.md`](../specs/first-run-ux.md). No changes implemented.

## Observed behavior

On the very first invocation of `/nightwatch` in a repository, the command immediately launched
long-running background subagents (the member jobs) with no user interaction and no explanation
of what was about to happen. The run continued for **more than 13 minutes** on a high-end model
budget. Throughout, there was no indication of:

- whether the command was still in initialization, mid-analysis, or stuck;
- which member job (reconcile / arch-review / release-progress) was currently running;
- how much work remained, or what it would cost.

The only way to learn what had happened was to wait for the run to finish and read the brief.

## Why this is confusing for first-time users

- **The first run is interactive by nature, but the command is designed for nobody watching.**
  Overnight mode is built for unattended scheduled execution — silence is fine at 3 a.m. But a
  first-time user almost always runs `/nightwatch` by hand, during the day, to see what it does.
  That user gets the unattended experience: expensive work starts instantly, silently.
- **No mental model yet.** A first-time user doesn't know the reconcile → arch-review →
  release-progress pipeline, the per-member budgets, or that a first night legitimately takes
  10+ minutes. Without a stated plan, 13 minutes of quiet subagent activity is
  indistinguishable from a hang.
- **The plan exists but is never shown.** `orchestrate.js --plan` already computes exactly what
  will run (`due`), what won't (`skipped`, with reasons), and in what order (`steps`) — and the
  config already declares each member's `budget_tokens`, `effort`, and `timeout_minutes`. All
  the information needed to set expectations is available before the first token is spent; it
  is simply consumed by the orchestrator instead of surfaced to the human.

## Risks

- **Unexpected token spend.** The default budgets total ~600k tokens across the three members,
  on a high-effort model. A user who just wanted to "see what the command does" commits to that
  spend with no warning and no consent moment.
- **Uncertainty about progress.** With no stage indication, the user cannot distinguish healthy
  long-running analysis from a stuck subagent, so they can't make an informed decision about
  waiting versus interrupting.
- **Interrupted runs.** The likely response to 13 opaque minutes is Ctrl-C / Escape. An
  interrupted first night leaves partial outputs, no brief, and a bad first impression — the
  user's takeaway is "it hung," when it was working as designed.
- **Trust erosion.** The project's own principle is "trust is the asset." An opaque, expensive
  first contact spends trust before the first brief has a chance to earn it.

## Suggested improvements (summarized; full spec in `docs/specs/first-run-ux.md`)

1. **Show the execution plan before launching agents.** Print the `--plan` output in human
   terms — which members will run, in what order, what's skipped and why — before spawning the
   first subagent.
2. **Show estimated cost and duration.** Derive per-member and total estimates from the
   config's `budget_tokens`, `effort`, and `timeout_minutes`; state them alongside the plan.
3. **Indicate the current stage while running.** One narrated line per lifecycle event
   (member started / finished / failed, brief assembly), so a watching user always knows what
   stage is live.
4. **Require confirmation before high-budget work on the first run only.** When
   `.nightwatch/state.json` does not yet exist and a human is present, ask once before
   launching the members. Scheduled/unattended runs remain promptless — this must not break
   the "prompts are impossible" contract of overnight mode.
5. **Offer a lightweight first-contact mode.** A plan-only / signals-only invocation (no
   judgment subagents, near-zero token cost) that lets a new user see what Nightwatch *would*
   do before committing a full night's budget.
