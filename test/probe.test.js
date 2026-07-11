'use strict';
// Story 9.6 — commit-policy probe & layout-upgrade nudge (spec runtime-layout P3/P4). A repo whose
// .gitignore discards Nightwatch's memory gets exactly one setup finding (stable id, exact wording,
// zero tokens/network, never an auto-edit); a pre-layout install gets exactly one init --update
// nudge line. A correctly-configured current install gets neither.
const assert = require('assert');
const { tmpRepo, write, readFile, gitInit, commit } = require('./helpers');
const { commitPolicyProbe, layoutUpgradeNudge, isIgnored, layoutOutdated } = require('../scripts/lib/probe');
const { collect } = require('../scripts/collect-brief');

module.exports = {
  // ---- P3: commit-policy probe --------------------------------------------------------------
  'probe: a .gitignore ignoring the ledger yields one setup finding naming file/consequence/fix': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, '.gitignore', '.nightwatch/\n'); // the blanket ignore that discarded memory in 0024
    commit(r, 'blanket ignore');
    const f = commitPolicyProbe(r);
    assert.ok(f, 'a finding is emitted');
    assert.strictEqual(f.kind, 'setup');
    assert.match(f.title, /\.gitignore ignores .*ledger\.jsonl/, 'names the file');
    assert.match(f.title, /will not survive a clone/, 'states the consequence');
    assert.match(f.title, /narrow the ignore to `\.nightwatch\/runtime\/`/, 'states the fix');
  },

  'probe: a correctly-configured repo emits no finding; the id is stable across nights': () => {
    const clean = tmpRepo();
    gitInit(clean); write(clean, 'src/a.js', '1\n'); commit(clean, 'repo');
    assert.strictEqual(commitPolicyProbe(clean), null, 'nothing ignored → no finding');

    // Stable id on an unchanged misconfiguration (NFR8): two probes of the same repo agree.
    const bad = tmpRepo();
    gitInit(bad); write(bad, '.gitignore', '.nightwatch/\n'); commit(bad, 'ignore');
    assert.strictEqual(commitPolicyProbe(bad).id, commitPolicyProbe(bad).id, 'id stable across runs');
  },

  'probe: isIgnored is read-only and never edits the .gitignore': () => {
    const r = tmpRepo();
    gitInit(r); write(r, '.gitignore', '.nightwatch/ledger.jsonl\n'); commit(r, 'ignore ledger');
    const before = readFile(r, '.gitignore');
    assert.strictEqual(isIgnored(r, '.nightwatch/ledger.jsonl'), true);
    assert.strictEqual(isIgnored(r, '.nightwatch/briefs'), false, 'only the ledger is ignored here');
    assert.strictEqual(readFile(r, '.gitignore'), before, '.gitignore untouched by the probe');
  },

  // ---- P4: layout-upgrade nudge -------------------------------------------------------------
  'nudge: a legacy install (state.json in use) gets exactly one init --update line': () => {
    const r = tmpRepo();
    write(r, '.nightwatch/state.json', '{"schema":1,"jobs":{}}'); // legacy cursors, no runtime/
    assert.strictEqual(layoutOutdated(r), true);
    const line = layoutUpgradeNudge(r);
    assert.match(line, /run `\/nightwatch init --update`/, 'points at init --update');
  },

  'nudge: a current install (runtime cursors + README) gets none; a fresh un-inited repo gets none': () => {
    const current = tmpRepo();
    write(current, '.nightwatch/runtime/cursors.json', '{"schema":1,"jobs":{}}');
    write(current, '.nightwatch/README.md', '# orientation\n');
    write(current, '.nightwatch/config.yaml', 'caps: {}\n');
    assert.strictEqual(layoutUpgradeNudge(current), null, 'a current install is not nudged');
    // A brand-new repo that never ran init (no declarations) is not "predating the layout".
    assert.strictEqual(layoutUpgradeNudge(tmpRepo()), null, 'a fresh un-inited repo is not nudged');
  },

  // ---- e2e via collect-brief ----------------------------------------------------------------
  'probe e2e: an ignored-ledger repo surfaces the setup finding in the brief; a clean repo does not': () => {
    const r = tmpRepo();
    gitInit(r); write(r, '.gitignore', '.nightwatch/\n'); write(r, 'src/a.js', '1\n'); commit(r, 'repo');
    collect(r, '2026-07-10');
    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.match(brief, /will not survive a clone/, 'the commit-policy setup finding is in the brief');

    const clean = tmpRepo();
    gitInit(clean); write(clean, 'src/a.js', '1\n'); commit(clean, 'repo');
    collect(clean, '2026-07-10');
    assert.ok(!/will not survive a clone/.test(readFile(clean, '.nightwatch/MORNING.md')), 'a clean repo has no probe finding');
  },
};
