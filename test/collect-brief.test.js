'use strict';
const assert = require('assert');
const { tmpRepo, readFile } = require('./helpers');
const { collect, computeDemotions } = require('../scripts/collect-brief');
const { writeFindings, appendLedger, readLedger } = require('../scripts/lib/findings');

function mkFindings(job, n, { kind, severity, verified = true, action = 'none' }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `${job.slice(0, 2).toUpperCase()}-${kind}${i}`, kind, severity, title: `${kind} ${i}`, evidence: [], action, verified });
  }
  return out;
}

module.exports = {
  'brief: global cap enforced, overflow to appendix by priority class': () => {
    const r = tmpRepo();
    const date = '2000-02-01';
    writeFindings(r, 'repo-reconcile', date, [], [
      ...mkFindings('repo-reconcile', 20, { kind: 'blocker', severity: 1 }),
      ...mkFindings('repo-reconcile', 20, { kind: 'drift', severity: 3 }),
    ]);
    writeFindings(r, 'arch-review', date, [], mkFindings('arch-review', 20, { kind: 'arch', severity: 3 }));
    const res = collect(r, date);
    assert.strictEqual(res.total, 60);
    assert.strictEqual(res.shown, 25, 'default brief_total cap');
    assert.strictEqual(res.overflow, 35);
    const brief = readFile(r, '.nightwatch/MORNING.md');
    // 20 blockers (rank 0) + top 5 drift (rank 3) fill the cap; arch (rank 4) overflows.
    assert.ok(/AR-arch/.test(brief.split('## Appendix')[1]), 'arch ids land in the appendix');
    assert.ok(!/AR-arch0\b/.test(brief.split('## Appendix')[0]), 'no arch shown above cap');
  },

  'brief: only verified (or setup) findings enter the brief': () => {
    const r = tmpRepo();
    const date = '2000-02-02';
    writeFindings(r, 'repo-reconcile', date, [], [
      { id: 'RC-unverified', kind: 'drift', severity: 2, title: 'unverified', evidence: [], action: 'none', verified: false },
      { id: 'RC-setup1', kind: 'setup', severity: 3, title: 'declare authority', evidence: [], action: 'human-decision', verified: false },
    ]);
    const res = collect(r, date);
    assert.strictEqual(res.total, 1, 'setup counts, unverified drops');
    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.ok(/RC-setup1/.test(brief));
    assert.ok(!/RC-unverified/.test(brief));
  },

  'brief: no member findings → valid brief, RELEASE.md hint': () => {
    const r = tmpRepo();
    const res = collect(r, '2000-02-03');
    assert.strictEqual(res.total, 0);
    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.ok(/No RELEASE\.md yet/.test(brief));
    assert.ok(/0 findings/.test(brief));
  },

  'brief: idempotent ledger — second same-date run does not double-append': () => {
    const r = tmpRepo();
    const date = '2000-02-04';
    writeFindings(r, 'repo-reconcile', date, [], mkFindings('repo-reconcile', 2, { kind: 'drift', severity: 2 }));
    collect(r, date);
    collect(r, date);
    const runs = readLedger(r).filter((x) => x.type === 'run' && x.job === 'collect-brief' && x.date === date);
    assert.strictEqual(runs.length, 1, 'collect-brief run row appended exactly once');
  },

  'demotion: job with zero acted-on findings two runs running is flagged': () => {
    const r = tmpRepo();
    appendLedger(r, [
      { type: 'finding', date: '2000-01-01', job: 'arch-review', id: 'AR-1', acted_on: null },
      { type: 'finding', date: '2000-01-02', job: 'arch-review', id: 'AR-1', acted_on: null },
      { type: 'finding', date: '2000-01-01', job: 'repo-reconcile', id: 'RC-1', acted_on: true },
      { type: 'finding', date: '2000-01-02', job: 'repo-reconcile', id: 'RC-1', acted_on: null },
    ]);
    const flags = computeDemotions(r);
    assert.ok(flags.includes('arch-review'), 'arch-review flagged (never acted on)');
    assert.ok(!flags.includes('repo-reconcile'), 'repo-reconcile not flagged (acted on once)');
  },
};
