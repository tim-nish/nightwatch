'use strict';
// Story 4.1 — orchestrator core: cadence-driven due plan (FR28), per-night idempotency (FR31),
// legible state.json cursors, and the declared write surface (NFR3/NFR4). Pure-planner ACs hit
// scripts/lib/schedule.js directly; the run-level ACs drive scripts/orchestrate.js end-to-end.
const assert = require('assert');
const path = require('path');
const { tmpRepo, write, readFile, readJSON, git, gitInit, commit, runScript } = require('./helpers');
const {
  planRun, reconcileState, jobDue, nextDue, defaultState, ORDERED_MEMBERS, DATE_RE,
} = require('../scripts/lib/schedule');
const { DEFAULTS } = require('../scripts/lib/config');

const DATE = '2026-07-09';
const YESTERDAY = '2026-07-08';
const TWO_AGO = '2026-07-07';
const SEVEN_AGO = '2026-07-02';

/** Build a state.json object with explicit cursors for the given last_run map. */
function mkState(lastRuns, extra) {
  const st = defaultState(DEFAULTS);
  for (const [job, last_run] of Object.entries(lastRuns || {})) {
    st.jobs[job].last_run = last_run;
    if (last_run) { st.jobs[job].runs = 1; st.jobs[job].next_due = nextDue(st.jobs[job], last_run); }
  }
  return Object.assign(st, extra);
}

/** Run orchestrate.js against a repo and parse its JSON status object. */
function orch(root, extraArgs = []) {
  const { stdout } = runScript('orchestrate.js', root, { date: DATE, extraArgs });
  return JSON.parse(stdout);
}

module.exports = {
  // ---- AC (a): the planner returns the correct due jobs, in the correct order ---------------
  'plan: due jobs come back in fixed dependency order, arch-review skipped when not due': () => {
    // reconcile ran last night (nightly → due again), arch ran 2 days ago (weekly → NOT due),
    // release ran last night (nightly → due).
    const state = mkState({ 'repo-reconcile': YESTERDAY, 'arch-review': TWO_AGO, 'release-progress': YESTERDAY });
    const plan = planRun({ state, config: DEFAULTS, date: DATE });
    assert.deepStrictEqual(plan.due, ['repo-reconcile', 'release-progress'], 'arch-review dropped; order preserved');
    assert.deepStrictEqual(plan.steps, ['repo-reconcile', 'release-progress', 'collect-brief'], 'collect-brief always last');
    const skippedJobs = plan.skipped.map((s) => s.job);
    assert.deepStrictEqual(skippedJobs, ['arch-review']);
    assert.ok(/weekly/.test(plan.skipped[0].reason), 'skip reason names the cadence');
  },

  'plan: arch-review IS due once its weekly window has elapsed': () => {
    const state = mkState({ 'repo-reconcile': YESTERDAY, 'arch-review': SEVEN_AGO, 'release-progress': YESTERDAY });
    const plan = planRun({ state, config: DEFAULTS, date: DATE });
    assert.deepStrictEqual(plan.due, ORDERED_MEMBERS.slice(), 'all three due — arch is 7 days out');
  },

  'plan: a fresh (never-run) state makes every member due, in order': () => {
    const plan = planRun({ state: null, config: DEFAULTS, date: DATE });
    assert.deepStrictEqual(plan.due, ['repo-reconcile', 'arch-review', 'release-progress']);
  },

  'plan: is a deterministic pure function (no mutation, stable output)': () => {
    const state = mkState({ 'repo-reconcile': YESTERDAY, 'arch-review': TWO_AGO, 'release-progress': YESTERDAY });
    const before = JSON.stringify(state);
    const a = planRun({ state, config: DEFAULTS, date: DATE });
    const b = planRun({ state, config: DEFAULTS, date: DATE });
    assert.deepStrictEqual(a, b, 'same inputs → same plan');
    assert.strictEqual(JSON.stringify(state), before, 'planRun does not mutate state');
  },

  'jobDue: cadence math — nightly always, weekly on the 7th day': () => {
    assert.strictEqual(jobDue({ cadence: 'nightly', last_run: YESTERDAY }, DATE), true);
    assert.strictEqual(jobDue({ cadence: 'weekly', last_run: TWO_AGO }, DATE), false);
    assert.strictEqual(jobDue({ cadence: 'weekly', last_run: SEVEN_AGO }, DATE), true);
    assert.strictEqual(jobDue({ cadence: 'nightly', last_run: null }, DATE), true, 'never-run is due');
    assert.strictEqual(jobDue({ cadence: 'nightly', last_run: DATE }, DATE), false, 'already ran tonight → not due');
    assert.strictEqual(jobDue({ cadence: 'nightly', last_run: DATE }, DATE, true), true, '--force repeats tonight');
  },

  // ---- AC (b): a not-due job is skipped and its cursor stays legible in state.json ----------
  'state.json: a skipped member keeps a legible, un-advanced cursor': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    // Seed a state.json where arch-review ran 2 days ago (weekly → skipped tonight).
    write(root, '.nightwatch/runtime/cursors.json', JSON.stringify(
      mkState({ 'repo-reconcile': YESTERDAY, 'arch-review': TWO_AGO, 'release-progress': YESTERDAY }), null, 2) + '\n');

    const res = orch(root);
    assert.strictEqual(res.status, 'ran');
    assert.deepStrictEqual(res.due, ['repo-reconcile', 'release-progress']);
    assert.deepStrictEqual(res.skipped.map((s) => s.job), ['arch-review']);

    const st = readJSON(root, '.nightwatch/runtime/cursors.json');
    const arch = st.jobs['arch-review'];
    // Cursor is human-inspectable and did NOT advance (the job never ran tonight).
    assert.strictEqual(arch.cadence, 'weekly');
    assert.strictEqual(arch.last_run, TWO_AGO, 'skipped job cursor unchanged');
    assert.ok(DATE_RE.test(arch.next_due), 'next_due is a legible ISO date');
    assert.strictEqual(arch.next_due, '2026-07-14', 'weekly next_due = last_run + 7d');
    // A member that DID run advanced its cursor to tonight.
    assert.strictEqual(st.jobs['repo-reconcile'].last_run, DATE);
    assert.strictEqual(st.jobs['repo-reconcile'].next_due, '2026-07-10', 'nightly next_due = +1d');
    assert.strictEqual(st.last_brief_date, DATE, 'idempotency sentinel stamped');
  },

  // ---- AC (c): second same-night run is a no-op; --force overrides -------------------------
  'idempotency: a second same-night run changes nothing; --force overrides': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');

    const first = orch(root);
    assert.strictEqual(first.status, 'ran');
    assert.deepStrictEqual(first.due, ['repo-reconcile', 'arch-review', 'release-progress'], 'fresh night runs all');
    const afterFirst = readFile(root, '.nightwatch/runtime/cursors.json');
    const listAfterFirst = git(root, ['status', '--porcelain']);

    const second = orch(root);
    assert.strictEqual(second.status, 'noop', 'second same-night invocation is a no-op');
    assert.deepStrictEqual(second.due, [], 'no jobs planned → no tokens spent');
    assert.strictEqual(readFile(root, '.nightwatch/runtime/cursors.json'), afterFirst, 'state.json byte-identical (no writes)');
    assert.strictEqual(git(root, ['status', '--porcelain']), listAfterFirst, 'no file changes on the no-op run');

    const forced = orch(root, ['--force']);
    assert.strictEqual(forced.status, 'forced', '--force overrides the no-op gate');
    assert.deepStrictEqual(forced.due, ['repo-reconcile', 'arch-review', 'release-progress'], 'forced run repeats tonight');
  },

  // ---- FR92: the state-advance call is immune to the brief its own night wrote --------------
  // The documented night writes tonight's brief (collect-brief) BEFORE the state-advancing
  // orchestrate call. The idempotency gate must key on last_brief_date only — a brief-file check
  // would no-op that call, so the cadence cursors would never be written and weekly cadence would
  // never engage.
  'idempotency: a pre-existing dated brief does NOT block the state advance (FR92)': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    write(root, `.nightwatch/briefs/${DATE}.md`, '# tonight\n'); // collect-brief already ran
    const res = orch(root);
    assert.strictEqual(res.status, 'ran', 'state advance proceeds despite tonight\'s brief on disk');
    const st = readJSON(root, '.nightwatch/runtime/cursors.json');
    assert.strictEqual(st.last_brief_date, DATE, 'cursors written and sentinel stamped');
    assert.strictEqual(st.jobs['arch-review'].next_due, '2026-07-16', 'weekly cadence engaged (last_run + 7d)');
    assert.strictEqual(orch(root).status, 'noop', 'a genuine second same-night run still no-ops via last_brief_date');
  },

  'idempotency: --plan is read-only and never writes state.json': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    const res = orch(root, ['--plan']);
    assert.strictEqual(res.status, 'plan');
    assert.deepStrictEqual(res.due, ['repo-reconcile', 'arch-review', 'release-progress']);
    assert.strictEqual(readFile(root, '.nightwatch/runtime/cursors.json'), null, '--plan wrote nothing');
    assert.strictEqual(git(root, ['status', '--porcelain']).trim(), '', 'working tree untouched by --plan');
  },

  'precondition: a non-git directory aborts without writing': () => {
    const root = tmpRepo(); // no gitInit
    const res = orch(root);
    assert.strictEqual(res.status, 'abort');
    assert.strictEqual(res.reason, 'not-a-git-checkout');
    assert.strictEqual(readFile(root, '.nightwatch/runtime/cursors.json'), null, 'abort writes no scheduler state');
  },

  // Story 4.3 / FR32 AC4 — a directory that is NOT a git checkout aborts, but the human still wakes
  // to a one-line stub brief naming the failure (no scheduler state, no tokens spent).
  'failure/AC4: a non-git directory aborts with a one-line stub brief': () => {
    const root = tmpRepo(); // no gitInit
    const res = orch(root);
    assert.strictEqual(res.status, 'abort');
    assert.strictEqual(res.reason, 'not-a-git-checkout');

    const brief = readFile(root, '.nightwatch/MORNING.md');
    assert.ok(brief != null, 'a stub brief was written on abort');
    assert.ok(/not a git checkout/i.test(brief), 'stub names the failure');
    assert.strictEqual(readFile(root, `.nightwatch/briefs/${DATE}.md`), brief, 'dated stub brief written too');
    // One failure line, no member sections — the run never got past the precondition.
    const failLines = brief.split('\n').filter((l) => l.startsWith('- '));
    assert.strictEqual(failLines.length, 1, 'exactly one line in the stub');
    // The abort still writes nothing but the stub brief inside `.nightwatch/**`.
    assert.strictEqual(readFile(root, '.nightwatch/runtime/cursors.json'), null, 'no scheduler state on abort');
  },

  // ---- AC (d): a completed run writes ONLY within the declared write surface ---------------
  'write surface: a run touches only .nightwatch/**, never source or the working tree': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'src/app.js', 'module.exports = 1;\n');
    write(root, 'README.md', '# app\n');
    commit(root, 'init');

    orch(root);

    const porcelain = git(root, ['status', '--porcelain']).split('\n').map((l) => l.trim()).filter(Boolean);
    // Every change/untracked path must live under .nightwatch/ — no source edits, no new branches.
    for (const line of porcelain) {
      const p = line.replace(/^\S+\s+/, '');
      assert.ok(p.startsWith('.nightwatch/'), `write outside surface: ${line}`);
    }
    assert.ok(readFile(root, '.nightwatch/runtime/cursors.json') != null, 'state.json was written');
    // Source files are byte-unchanged (no modification, no refactor).
    assert.strictEqual(readFile(root, 'src/app.js'), 'module.exports = 1;\n');
    assert.strictEqual(readFile(root, 'README.md'), '# app\n');
    // No opt-in nightwatch/* branch was created off its own bat.
    const branches = git(root, ['branch', '--list', 'nightwatch/*']).trim();
    assert.strictEqual(branches, '', 'no nightwatch/* branch created');
  },
};
