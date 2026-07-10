'use strict';
// Story 6.2 — execution plan, scope preview, and `--plan` dry mode (FR37/FR38/FR41).
// The scope preview is a pure filesystem walk (scope.js); the enriched plan + zero-write `--plan`
// mode drive scripts/orchestrate.js end-to-end.
const assert = require('assert');
const { tmpRepo, write, readFile, readJSON, git, gitInit, commit, runScript } = require('./helpers');
const { scopePreview } = require('../scripts/lib/scope');
const { loadConfig } = require('../scripts/lib/config');

const DATE = '2026-07-09';

function orch(root, extraArgs = []) {
  const { stdout } = runScript('orchestrate.js', root, { date: DATE, extraArgs });
  return JSON.parse(stdout);
}

module.exports = {
  // ---- scope preview: deterministic, zero-model-token walk (FR38) ---------------------------
  'scopePreview: classifies files per top-dir as analyzed vs excluded': () => {
    const root = tmpRepo();
    write(root, 'src/a.js', 'x\n');
    write(root, 'src/b.js', 'x\n');
    write(root, '_bmad/plan.md', 'x\n');
    write(root, 'node_modules/dep/i.js', 'x\n');
    write(root, 'node_modules/dep/j.js', 'x\n');
    const { config } = loadConfig(root);
    const pv = scopePreview(root, config);
    assert.strictEqual(pv.analyzed_files, 2, 'two product files analyzed');
    assert.strictEqual(pv.excluded_files, 3, 'one _bmad + two node_modules excluded');
    const analyzedDirs = pv.analyzed.map((d) => d.dir);
    assert.ok(analyzedDirs.includes('src') && !analyzedDirs.includes('_bmad'), 'src analyzed, _bmad not');
    const nm = pv.excluded.find((d) => d.dir === 'node_modules');
    assert.strictEqual(nm.files, 2, 'node_modules excluded count');
  },

  'scopePreview: identical output across repeated runs (deterministic, NFR8)': () => {
    const root = tmpRepo();
    write(root, 'src/a.js', 'x\n'); write(root, '_bmad/p.md', 'x\n');
    const { config } = loadConfig(root);
    assert.deepStrictEqual(scopePreview(root, config), scopePreview(root, config));
  },

  // ---- FR37: the plan carries per-member budgets and a bounded estimate ----------------------
  'plan: due members carry budget_tokens/effort/timeout_minutes; estimate sums them': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    const res = orch(root, ['--plan']);
    assert.strictEqual(res.status, 'plan');
    // fresh repo → all three members due, in fixed order
    assert.deepStrictEqual(res.members.map((m) => m.job), ['repo-reconcile', 'arch-review', 'release-progress']);
    const rr = res.members.find((m) => m.job === 'repo-reconcile');
    assert.strictEqual(rr.budget_tokens, 200000);
    assert.strictEqual(rr.effort, 'medium');
    assert.strictEqual(rr.timeout_minutes, 30);
    assert.strictEqual(res.estimate.token_ceiling, 600000, 'ceiling = 200k+300k+100k');
    assert.strictEqual(res.estimate.duration_minutes, 90, 'duration = 3 × 30m (sequential bound)');
    assert.strictEqual(res.estimate.member_count, 3);
  },

  'plan: skipped members carry a next_due date': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    // arch-review ran recently (weekly) → skipped tonight with a legible next_due
    write(root, '.nightwatch/state.json', JSON.stringify({
      schema: 1, updated: '2026-07-08', last_brief_date: '2026-07-08',
      jobs: {
        'repo-reconcile': { cadence: 'nightly', last_run: '2026-07-08', runs: 1, next_due: '2026-07-09' },
        'arch-review': { cadence: 'weekly', last_run: '2026-07-08', runs: 1, next_due: '2026-07-15' },
        'release-progress': { cadence: 'nightly', last_run: '2026-07-08', runs: 1, next_due: '2026-07-09' },
      },
    }, null, 2) + '\n');
    const res = orch(root, ['--plan']);
    const arch = res.skipped.find((s) => s.job === 'arch-review');
    assert.ok(arch, 'arch-review skipped');
    assert.strictEqual(arch.next_due, '2026-07-15', 'skipped member carries next_due');
  },

  'plan: includes the scope preview': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'src/app.js', 'x\n'); write(root, '_bmad/p.md', 'x\n');
    commit(root, 'init');
    const res = orch(root, ['--plan']);
    assert.ok(res.scope && Array.isArray(res.scope.analyzed) && Array.isArray(res.scope.excluded), 'scope preview present');
    assert.ok(res.scope.analyzed.some((d) => d.dir === 'src'), 'src analyzed in the plan preview');
  },

  // ---- FR41: --plan is a hard dry path — zero writes, zero model tokens ----------------------
  'plan: --plan writes nothing (no state.json, no run-status, clean tree)': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'src/app.js', 'x\n');
    commit(root, 'init');
    const res = orch(root, ['--plan']);
    assert.strictEqual(res.status, 'plan');
    assert.strictEqual(readFile(root, '.nightwatch/state.json'), null, '--plan wrote no state.json');
    assert.strictEqual(readFile(root, `.nightwatch/out/run-status-${DATE}.json`), null, '--plan wrote no run-status');
    assert.strictEqual(git(root, ['status', '--porcelain']).trim(), '', 'working tree untouched by --plan');
  },

  // ---- FR38: a real run mirrors the scope preview into run-status ----------------------------
  'run: a scheduled (non --plan) run writes the scope + estimate into run-status': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'src/app.js', 'x\n'); write(root, '_bmad/p.md', 'x\n');
    commit(root, 'init');
    const res = orch(root);
    assert.strictEqual(res.status, 'ran');
    const rs = readJSON(root, `.nightwatch/out/run-status-${DATE}.json`);
    assert.ok(rs && rs.scope && rs.estimate, 'run-status carries scope + estimate');
    assert.strictEqual(rs.estimate.token_ceiling, 600000);
    assert.ok(Array.isArray(rs.jobs), 'jobs array preserved for the command to fill');
    assert.ok(rs.scope.analyzed.some((d) => d.dir === 'src'), 'scope preview recorded');
  },

  'run: writing the scope into run-status does not clobber existing member jobs': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'src/app.js', 'x\n');
    // a prior member flow already recorded per-job outcomes
    write(root, `.nightwatch/out/run-status-${DATE}.json`,
      JSON.stringify({ jobs: [{ job: 'repo-reconcile', status: 'ok', tokens: 1234 }] }) + '\n');
    commit(root, 'init');
    orch(root);
    const rs = readJSON(root, `.nightwatch/out/run-status-${DATE}.json`);
    assert.strictEqual(rs.jobs.length, 1, 'existing job preserved');
    assert.strictEqual(rs.jobs[0].tokens, 1234, 'job payload untouched');
    assert.ok(rs.scope, 'scope added alongside jobs');
  },
};
