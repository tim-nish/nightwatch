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

  // Story 12.6 / FR104 — honest emptiness for git signals.
  'git-signals: threshold above max observed churn → unreachable degraded line stating both numbers (FR104)': () => {
    const r = tmpRepo();
    gitInit(r);
    // 24 single-file commits round-robin over 6 files → each file churns exactly 4 times,
    // below the default coupling threshold of 5, so no pair can ever reach it.
    for (let i = 0; i < 24; i++) { write(r, `f${i % 6}.txt`, 'v' + i); commit(r, 'c' + i); }
    const sig = gitSignals(r, { couplingMinCommits: 5 });
    assert.strictEqual(sig.coupling.length, 0, 'unreachable threshold yields no coupling');
    const line = sig.degraded.find((d) => /unreachable/.test(d));
    assert.ok(line, 'an unreachable-threshold degraded line is present');
    assert.match(line, /threshold 5/, 'states the threshold');
    assert.match(line, /max observed churn 4/, 'states the observed maximum');
  },

  'git-signals: placeholder files (.gitkeep/.gitignore) excluded from hotspots (FR104)': () => {
    const r = tmpRepo();
    gitInit(r);
    // .gitignore is touched every commit but is not a design surface — it must not be a hotspot.
    for (let i = 0; i < 6; i++) { write(r, '.gitignore', 'v' + i); write(r, 'src/a.js', '// ' + i); commit(r, 'c' + i); }
    const sig = gitSignals(r);
    assert.ok(!sig.hotspots.some((h) => /\.gitignore$/.test(h.path)), '.gitignore is excluded from hotspots');
    assert.ok(!sig.churn.some((c) => /\.gitignore$/.test(c.path)), '.gitignore is excluded from churn');
    assert.ok(sig.hotspots.some((h) => h.path === 'src/a.js'), 'a real source file remains a hotspot');
  },

  'git-signals: deterministic under repeated runs': () => {
    const r = coupledRepo(8);
    const a = JSON.stringify(gitSignals(r).coupling);
    const b = JSON.stringify(gitSignals(r).coupling);
    assert.strictEqual(a, b);
  },
};
