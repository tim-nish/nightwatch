#!/usr/bin/env node
// @ts-check
'use strict';
// orchestrate.js — the deterministic core of /nightwatch (story 4.1, FR28/FR31, NFR3/NFR4).
//
// The command prompt (commands/nightwatch.md) drives the actual member subagents; this script
// owns the parts that must be mechanical and testable: precondition + idempotency gates, the
// cadence-driven run plan (which members are due, in dependency order), and the read/write of the
// human-inspectable cadence cursors in `.nightwatch/state.json`. It spends no tokens, touches no
// network, and writes nothing outside `.nightwatch/**` — the declared write surface (§6).
//
// Modes:
//   (default)  run bookkeeping: precondition → idempotency gate → plan → record cursors → write
//              state.json. A second same-night run is a no-op (writes nothing); `--force` repeats.
//   --plan     print the plan only and exit; performs no writes (used before running subagents).
const { parseArgs, repoRoot, todayISO, isGitRepo } = require('./lib/util');
const {
  readState, writeState, reconcileState, planRun, alreadyRanTonight, recordRun, markBriefed,
} = require('./lib/schedule');
const { loadConfig } = require('./lib/config');

/**
 * Deterministic orchestration bookkeeping for one night. Never runs member jobs — it decides and
 * records what a run consists of. Returns a status object; only mutates `.nightwatch/state.json`,
 * and only when a run is actually recorded (not on a no-op or a plan-only call).
 * @param {string} root @param {string} date
 * @param {{ force?: boolean, planOnly?: boolean }} [opts]
 */
function orchestrate(root, date, { force = false, planOnly = false } = {}) {
  // 1. Precondition: unattended review only makes sense inside a git checkout (§6 failure handling).
  if (!isGitRepo(root)) {
    return { status: 'abort', reason: 'not-a-git-checkout', due: [], skipped: [], steps: [] };
  }

  const { config } = loadConfig(root);
  const onDisk = readState(root);

  // 2. Idempotency gate. A completed run tonight (state.last_brief_date or the dated brief) means a
  //    re-invocation must exit WITHOUT spending tokens or changing files — unless --force overrides.
  if (!force && alreadyRanTonight(onDisk, root, date)) {
    return { status: 'noop', reason: 'already-ran-tonight', due: [], skipped: [], steps: [] };
  }

  // 3. Plan: reconcile state against config cadence, then decide the due members in fixed order.
  const state = reconcileState(onDisk, config);
  const plan = planRun({ state, config, date, force });

  // 4. Record cursors for the members this run covers and stamp the night, then persist. This is
  //    the only write, and it lands squarely inside `.nightwatch/**`.
  for (const job of plan.due) recordRun(state, job, date);
  markBriefed(state, date);

  if (planOnly) {
    return { status: 'plan', due: plan.due, skipped: plan.skipped, steps: plan.steps };
  }

  writeState(root, state);
  return { status: force ? 'forced' : 'ran', due: plan.due, skipped: plan.skipped, steps: plan.steps };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const res = orchestrate(root, date, { force: !!args.force, planOnly: !!args.plan });
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { orchestrate };
