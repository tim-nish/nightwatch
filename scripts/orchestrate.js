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
//              state.json (and the scope preview into run-status). A second same-night run is a
//              no-op (writes nothing); `--force` repeats.
//   --plan     print the plan only and exit; performs no writes (used before running subagents).
//
// The plan it returns is presentation material only (FR37/FR38/FR41): the enriched member list
// (per-member budget_tokens/effort/timeout_minutes), the skipped members with next_due, a token
// ceiling + bounded duration estimate, and a deterministic zero-model-token scope preview. Adding
// or removing any of it changes no scheduling decision — those come from schedule.js alone.
const path = require('path');
const { parseArgs, repoRoot, todayISO, isGitRepo, outDir, exists, readJSONSafe, writeJSON } = require('./lib/util');
const { ledgerPath } = require('./lib/findings');
const {
  readState, writeState, reconcileState, planRun, alreadyRanTonight, recordRun, markBriefed,
} = require('./lib/schedule');
const { loadConfig } = require('./lib/config');
const { scopePreview } = require('./lib/scope');
const { carveRecheckBudget } = require('./lib/lifecycle');
const { writeStubBrief } = require('./collect-brief');

/** Per-member execution parameters, read straight from config (presentation only). */
function memberDetail(job, config) {
  const bt = config.budget_tokens && config.budget_tokens[job];
  const ef = config.effort && config.effort[job];
  const tm = config.timeout_minutes && typeof config.timeout_minutes === 'object'
    ? config.timeout_minutes[job]
    : config.timeout_minutes;
  // Reserve a slice of the member's budget for re-verifying carried-forward open findings (spec
  // finding-lifecycle P3). Carved off the top so `discovery_budget` — what new-claim discovery may
  // spend — is what's left AFTER the reserve, making "old findings can't be starved" mechanical.
  const budget = Number.isFinite(bt) ? bt : null;
  const fraction = Number.isFinite(config.recheck_budget) ? config.recheck_budget : 0;
  const { reserve, discovery } = budget != null
    ? carveRecheckBudget(budget, fraction)
    : { reserve: null, discovery: null };
  return {
    job,
    budget_tokens: budget,
    recheck_reserve: reserve,
    discovery_budget: discovery,
    effort: typeof ef === 'string' ? ef : null,
    timeout_minutes: Number.isFinite(tm) ? tm : null,
  };
}

/**
 * Enrich a bare schedule plan into the presentation plan an interactive run prints before
 * launching members (FR37/FR38). The token ceiling and bounded duration are the sums over due
 * members — members run sequentially, so the duration is a real upper bound. Pure; no I/O beyond
 * the scope preview's filesystem walk (zero model tokens).
 */
function buildPlan(root, config, plan) {
  const members = plan.due.map((j) => memberDetail(j, config));
  const token_ceiling = members.reduce((s, m) => s + (m.budget_tokens || 0), 0);
  const duration_minutes = members.reduce((s, m) => s + (m.timeout_minutes || 0), 0);
  return {
    members,
    estimate: { member_count: members.length, token_ceiling, duration_minutes },
    scope: scopePreview(root, config),
  };
}

/**
 * Deterministic orchestration bookkeeping for one night. Never runs member jobs — it decides and
 * records what a run consists of. Returns a status object; only mutates `.nightwatch/state.json`,
 * and only when a run is actually recorded (not on a no-op or a plan-only call).
 * @param {string} root @param {string} date
 * @param {{ force?: boolean, planOnly?: boolean, yes?: boolean }} [opts]
 */
function orchestrate(root, date, { force = false, planOnly = false, yes = false } = {}) {
  // 1. Precondition: unattended review only makes sense inside a git checkout (§6 failure handling,
  //    FR32 AC4). Abort, but still emit a one-line stub brief so the human wakes to an explanation
  //    rather than silence — the write lands inside `.nightwatch/**` and never spends tokens.
  if (!isGitRepo(root)) {
    writeStubBrief(root, date, 'not a git checkout — `/nightwatch` needs a git repository to review.');
    return { status: 'abort', reason: 'not-a-git-checkout', due: [], skipped: [], steps: [] };
  }

  const { config } = loadConfig(root);
  const onDisk = readState(root);
  // First run ⟺ cursors absent AND ledger absent (spec runtime-layout P1). Keying the gate on the
  // ledger too means deleting the disposable `runtime/` dir (which resets cursors) on an install
  // that already has a ledger is treated as an existing install — cadence resets, but the
  // interactive first-run confirmation gate (FR40) does NOT re-fire. A genuinely fresh repo (no
  // cursors, no ledger) still gates.
  const firstRun = onDisk == null && !exists(ledgerPath(root));

  // 2. Idempotency gate. A completed run tonight (state.last_brief_date or the dated brief) means a
  //    re-invocation must exit WITHOUT spending tokens or changing files — unless --force overrides.
  if (!force && alreadyRanTonight(onDisk, root, date)) {
    return { status: 'noop', reason: 'already-ran-tonight', due: [], skipped: [], steps: [] };
  }

  // 3. Plan: reconcile state against config cadence, then decide the due members in fixed order.
  const state = reconcileState(onDisk, config);
  const plan = planRun({ state, config, date, force });
  // Presentation enrichment (FR37/FR38/FR41): member budgets, estimate, and scope preview. Never
  // influences the scheduling decision above — it is derived from it.
  const { members, estimate, scope } = buildPlan(root, config, plan);
  // First-run confirmation gate (FR40). The prompt itself is the command's job — orchestrate runs
  // under a no-prompt permission profile — so this only DECLARES whether an interactive run should
  // confirm before launching members. `--force`/`--yes` clear it; scheduled runs ignore it (they
  // never prompt), so behavior stays byte-identical to the ungated orchestrator.
  const gate = { required: firstRun && !force && !yes, reason: firstRun ? 'first-run' : null };
  const base = { due: plan.due, skipped: plan.skipped, steps: plan.steps, members, estimate, scope, first_run: firstRun, gate };

  // --plan is a hard dry path (FR41): return the full plan, print nothing to disk. Zero writes.
  if (planOnly) return { status: 'plan', ...base };

  // 4. Record cursors for the members this run covers and stamp the night, then persist. state.json
  //    is the scheduler write; the scope preview is mirrored into run-status so a scheduled run
  //    (which prints nothing) still records it for the brief (FR38). Both land in `.nightwatch/**`.
  for (const job of plan.due) recordRun(state, job, date);
  markBriefed(state, date);
  writeState(root, state);
  writeRunStatusScope(root, date, { scope, estimate });

  return { status: force ? 'forced' : 'ran', ...base };
}

/**
 * Mirror the scope preview + estimate into `.nightwatch/out/run-status-<date>.json` without
 * clobbering the per-member `jobs` the command records there (FR38). Read-modify-write; creates
 * the file with an empty `jobs` array if absent. Writes only inside the declared surface.
 */
function writeRunStatusScope(root, date, { scope, estimate }) {
  const p = path.join(outDir(root), `run-status-${date}.json`);
  const cur = readJSONSafe(p);
  const doc = cur && typeof cur === 'object' ? cur : { jobs: [] };
  if (!Array.isArray(doc.jobs)) doc.jobs = [];
  doc.scope = scope;
  doc.estimate = estimate;
  writeJSON(p, doc);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const res = orchestrate(root, date, { force: !!args.force, planOnly: !!args.plan, yes: !!args.yes });
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { orchestrate };
