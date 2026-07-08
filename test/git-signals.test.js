'use strict';
const assert = require('assert');
const { tmpRepo, write, gitInit, commit } = require('./helpers');
const { gitSignals } = require('../scripts/git-signals');

// Build a repo where core/a.js and api/b.js co-change across a module boundary in N commits,
// plus a within-module pair that must NOT be reported as cross-boundary coupling.
function coupledRepo(nCoChange) {
  const r = tmpRepo();
  gitInit(r);
  // 20+ commits so coupling is not skipped for shallow history.
  for (let i = 0; i < 22; i++) { write(r, 'noise.txt', 'v' + i); commit(r, 'noise ' + i); }
  for (let i = 0; i < nCoChange; i++) {
    write(r, 'core/a.js', '// core ' + i);
    write(r, 'api/b.js', '// api ' + i);
    commit(r, 'co-change ' + i);
  }
  return r;
}

module.exports = {
  'git-signals: cross-boundary co-change → coupling with full paths (validates key sep)': () => {
    const r = coupledRepo(8);
    const sig = gitSignals(r, { couplingMinCommits: 5 });
    const pair = sig.coupling.find((c) => c.module_a === 'api' && c.module_b === 'core'
      || c.module_a === 'core' && c.module_b === 'api');
    assert.ok(pair, 'reports the cross-module coupling');
    assert.ok(pair.commits >= 8, 'counts the co-change commits: ' + pair.commits);
    // Regression guard for the \x01 key: a/b must be full repo paths, not single chars.
    assert.ok([pair.a, pair.b].includes('core/a.js'), 'full path a: ' + pair.a);
    assert.ok([pair.a, pair.b].includes('api/b.js'), 'full path b: ' + pair.b);
  },

  'git-signals: below-threshold co-change → no coupling': () => {
    const r = coupledRepo(3);
    const sig = gitSignals(r, { couplingMinCommits: 5 });
    assert.strictEqual(sig.coupling.length, 0, 'under threshold is not reported');
  },

  'git-signals: shallow history → coupling skipped, degraded notice': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, 'a.js', '1'); commit(r, 'one');
    const sig = gitSignals(r);
    assert.deepStrictEqual(sig.coupling, []);
    assert.ok(sig.degraded.some((d) => /shallow history/.test(d)));
  },

  'git-signals: non-git dir → degraded, no throw': () => {
    const r = tmpRepo();
    const sig = gitSignals(r);
    assert.ok(sig.degraded.some((d) => /not a git repository/.test(d)));
  },

  'git-signals: deterministic under repeated runs': () => {
    const r = coupledRepo(8);
    const a = JSON.stringify(gitSignals(r).coupling);
    const b = JSON.stringify(gitSignals(r).coupling);
    assert.strictEqual(a, b);
  },
};
