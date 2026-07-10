'use strict';
// Story 6.4 — first-run confirmation gate (FR40). The prompt itself is the command's job
// (orchestrate runs under a no-prompt profile); the MECHANICAL contract tested here is what the
// command keys the prompt off: `first_run` / `gate.required` in the plan, the fact that the gate
// fires exactly once, that --force/--yes clear it, and that the pre-gate --plan step writes nothing
// so a decline leaves the tree untouched. Non-interactive behavior stays byte-identical.
const assert = require('assert');
const { tmpRepo, write, readFile, git, gitInit, commit, runScript } = require('./helpers');

const DATE = '2026-07-09';

function orch(root, extraArgs = []) {
  const { stdout } = runScript('orchestrate.js', root, { date: DATE, extraArgs });
  return JSON.parse(stdout);
}

module.exports = {
  // ---- gate.required is set only on the first interactive run -------------------------------
  'gate: a fresh repo (no state.json) reports first_run and gate.required': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    const res = orch(root, ['--plan']);
    assert.strictEqual(res.first_run, true, 'no state.json → first run');
    assert.strictEqual(res.gate.required, true, 'gate required on first interactive run');
    assert.strictEqual(res.gate.reason, 'first-run');
  },

  'gate: --force and --yes both clear the gate': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    assert.strictEqual(orch(root, ['--plan', '--yes']).gate.required, false, '--yes skips the gate');
    assert.strictEqual(orch(root, ['--plan', '--force']).gate.required, false, '--force skips the gate');
    // ...but the run is still recognized as a first run either way (informational).
    assert.strictEqual(orch(root, ['--plan', '--yes']).first_run, true);
  },

  // ---- the gate fires exactly once: after a real run, state.json exists → no gate ------------
  'gate: no gate from the second run onward (state.json now exists)': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    // First real run creates state.json.
    const first = orch(root);
    assert.strictEqual(first.status, 'ran');
    assert.strictEqual(first.first_run, true, 'the first real run is a first run');
    assert.ok(readFile(root, '.nightwatch/state.json') != null, 'state.json created');
    // A later night (force past the idempotency no-op) is NOT a first run and has no gate.
    const later = orch(root, ['--plan', '--force']);
    assert.strictEqual(later.first_run, false, 'state.json exists → not a first run');
    assert.strictEqual(later.gate.required, false, 'no gate from the second run onward');
  },

  // ---- decline writes nothing: the pre-gate step is --plan, which is a hard dry path ---------
  'gate: the pre-gate --plan step leaves the tree byte-identical (a decline writes nothing)': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    const before = git(root, ['status', '--porcelain']);
    const res = orch(root, ['--plan']);
    assert.strictEqual(res.gate.required, true);
    // Declining means the command simply stops here — and --plan itself wrote nothing.
    assert.strictEqual(readFile(root, '.nightwatch/state.json'), null, 'no state.json written pre-gate');
    assert.strictEqual(readFile(root, `.nightwatch/out/run-status-${DATE}.json`), null, 'no run-status written pre-gate');
    assert.strictEqual(git(root, ['status', '--porcelain']), before, 'working tree unchanged pre-gate');
  },

  // ---- non-interactive/scheduled runs are unaffected: same files as before the gate existed --
  'gate: a scheduled run still writes exactly state.json + run-status (byte-identical behavior)': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'src/app.js', 'x\n');
    commit(root, 'init');
    const res = orch(root); // no --plan, no prompt possible under the scheduler
    assert.strictEqual(res.status, 'ran');
    // Only .nightwatch/** changed — the gate added no new write path and blocked nothing.
    const porcelain = git(root, ['status', '--porcelain']).split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of porcelain) {
      const p = line.replace(/^\S+\s+/, '');
      assert.ok(p.startsWith('.nightwatch/'), `write outside surface: ${line}`);
    }
    assert.ok(readFile(root, '.nightwatch/state.json') != null, 'state.json written on a scheduled run');
  },
};
