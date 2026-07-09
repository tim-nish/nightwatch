'use strict';
const assert = require('assert');
const path = require('path');
const { tmpRepo, write, readFile, runScript } = require('./helpers');
const { collect, collectOrStub, computeDemotions } = require('../scripts/collect-brief');
const { writeFindings, appendLedger, readLedger } = require('../scripts/lib/findings');
const { openTracker } = require('../scripts/lib/tracker');
const { writeJSON, outDir } = require('../scripts/lib/util');

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

  // AC1 — the fixed section order is a contract, so assert it by byte position.
  'brief: sections render in the fixed spec order': () => {
    const r = tmpRepo();
    const date = '2000-03-01';
    writeFindings(r, 'repo-reconcile', date, [], [
      ...mkFindings('repo-reconcile', 1, { kind: 'drift', severity: 2 }),
      { id: 'RC-dec', kind: 'decision', severity: 2, title: 'pick a name', evidence: [], action: 'human-decision', verified: true },
    ]);
    writeFindings(r, 'arch-review', date, [], mkFindings('arch-review', 1, { kind: 'arch', severity: 3 }));
    collect(r, date);
    const brief = readFile(r, '.nightwatch/MORNING.md');
    const order = [
      '## Release progress',
      '## Human decisions required',
      '## Consistency (repo-reconcile)',
      '## Architecture (arch-review)',
      '## Failures & degraded notices',
      '## Appendix',
    ].map((h) => brief.indexOf(h));
    assert.ok(order.every((i) => i >= 0), 'every section present');
    for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `section ${i} follows ${i - 1}`);
  },

  // AC1 — the failures section must name the extractor adapters that ran / were skipped / crashed.
  'brief: degraded notices name the extractor adapters': () => {
    const r = tmpRepo();
    const date = '2000-03-02';
    writeFindings(r, 'repo-reconcile', date, ['node-depcruise: detect() failed (spawn) — skipped'], []);
    writeFindings(r, 'arch-review', date, ['python-importlinter: adapter crashed — dropped'], []);
    collect(r, date);
    const brief = readFile(r, '.nightwatch/MORNING.md');
    const fail = brief.split('## Failures & degraded notices')[1].split('## Appendix')[0];
    assert.ok(/node-depcruise: detect\(\) failed .* — skipped/.test(fail), 'skipped adapter named');
    assert.ok(/python-importlinter: adapter crashed — dropped/.test(fail), 'crashed adapter named');
  },

  // AC2 — 60 findings across jobs, explicit caps.brief_total:25 → exactly 25 interleaved by
  // priority (blockers > human decisions > drift > arch > nice-to-have); remainder ids in appendix.
  'brief: 60 findings, cap 25 → exactly 25 by priority interleave, rest in appendix': () => {
    const r = tmpRepo();
    const date = '2000-03-03';
    write(r, '.nightwatch/config.yaml', 'caps:\n  brief_total: 25\n');
    writeFindings(r, 'repo-reconcile', date, [], [
      ...mkFindings('repo-reconcile', 10, { kind: 'blocker', severity: 1 }),
      ...mkFindings('repo-reconcile', 10, { kind: 'drift', severity: 3 }),
      ...mkFindings('repo-reconcile', 5, { kind: 'decision', severity: 2, action: 'human-decision' }),
    ]);
    writeFindings(r, 'arch-review', date, [], [
      ...mkFindings('arch-review', 10, { kind: 'arch', severity: 3 }),
      ...mkFindings('arch-review', 5, { kind: 'decision', severity: 2, action: 'human-decision' }),
      ...mkFindings('arch-review', 20, { kind: 'info', severity: 5 }),
    ]);
    const res = collect(r, date);
    assert.strictEqual(res.total, 60, 'all 60 eligible');
    assert.strictEqual(res.shown, 25, 'cap honoured exactly');
    assert.strictEqual(res.overflow, 35);

    const brief = readFile(r, '.nightwatch/MORNING.md');
    const [body, appendix] = brief.split('## Appendix');
    // Shown by interleave: 10 blockers + 10 human decisions + top 5 drift = 25.
    for (let i = 0; i < 10; i++) assert.ok(body.includes(`RE-blocker${i}`), `blocker${i} shown`);
    for (let i = 0; i < 5; i++) assert.ok(body.includes(`RE-decision${i}`) && body.includes(`AR-decision${i}`), 'decisions merged across jobs, shown');
    for (let i = 0; i < 5; i++) assert.ok(body.includes(`RE-drift${i}`), `drift${i} shown`);
    // Overflow ids in the appendix: drift5..9, all arch, all info — and NOT in the body.
    for (let i = 5; i < 10; i++) { assert.ok(appendix.includes(`RE-drift${i}`), `drift${i} overflowed`); assert.ok(!body.includes(`RE-drift${i}`)); }
    for (let i = 0; i < 10; i++) assert.ok(appendix.includes(`AR-arch${i}`) && !body.includes(`AR-arch${i}`), `arch${i} overflowed`);
    for (let i = 0; i < 20; i++) assert.ok(appendix.includes(`AR-info${i}`), `info${i} overflowed`);
  },

  // AC3 — completion writes briefs/<date>.md + MORNING.md and appends per-job ledger lines
  // (date, job, tokens, findings count, degraded flags) THROUGH THE TRACKING STORE.
  'brief: per-job ledger lines go through the tracking store with tokens/counts/degraded': () => {
    const r = tmpRepo();
    const date = '2000-03-04';
    writeFindings(r, 'repo-reconcile', date, ['no STATE.md authority block'],
      mkFindings('repo-reconcile', 3, { kind: 'drift', severity: 2 }));
    writeJSON(path.join(outDir(r), `run-status-${date}.json`), { jobs: [{ job: 'repo-reconcile', status: 'ok', tokens: 1234 }] });
    collect(r, date);

    // Both artifacts exist at their stable paths.
    assert.ok(readFile(r, `.nightwatch/briefs/${date}.md`).length > 0, 'briefs/<date>.md created');
    assert.ok(readFile(r, '.nightwatch/MORNING.md').length > 0, 'MORNING.md overwritten');

    // Rows are readable back THROUGH THE STORE (the sole sanctioned ledger reader/writer).
    const rows = openTracker(r).readLedger();
    const jobRun = rows.find((x) => x.type === 'run' && x.job === 'repo-reconcile' && x.date === date);
    assert.ok(jobRun, 'per-job run row present');
    assert.strictEqual(jobRun.findings, 3, 'findings count recorded');
    assert.strictEqual(jobRun.degraded, 1, 'degraded flag count recorded');
    assert.strictEqual(jobRun.tokens, 1234, 'tokens carried from run-status');
    const cbRun = rows.find((x) => x.type === 'run' && x.job === 'collect-brief' && x.date === date);
    assert.ok(cbRun && cbRun.shown === 3 && cbRun.total === 3, 'collect-brief run row present');
    // recordFindings routed the finding rows: shape carries kind/severity/date/job.
    const findingRows = rows.filter((x) => x.type === 'finding' && x.job === 'repo-reconcile' && x.date === date);
    assert.strictEqual(findingRows.length, 3, 'three finding rows through recordFindings');
    assert.ok(findingRows.every((x) => x.kind === 'drift' && x.severity === 2), 'finding row shape preserved');
  },

  // AC4 — identical input run twice must be byte-deterministic (truncation + ordering).
  'brief: identical input twice → byte-identical brief': () => {
    const r = tmpRepo();
    const date = '2000-03-05';
    writeFindings(r, 'repo-reconcile', date, [], [
      ...mkFindings('repo-reconcile', 30, { kind: 'drift', severity: 3 }),
      ...mkFindings('repo-reconcile', 10, { kind: 'blocker', severity: 1 }),
    ]);
    writeFindings(r, 'arch-review', date, [], mkFindings('arch-review', 20, { kind: 'arch', severity: 4 }));
    collect(r, date);
    const first = readFile(r, '.nightwatch/MORNING.md');
    const firstDated = readFile(r, `.nightwatch/briefs/${date}.md`);
    collect(r, date);
    assert.strictEqual(readFile(r, '.nightwatch/MORNING.md'), first, 'MORNING.md byte-identical');
    assert.strictEqual(readFile(r, `.nightwatch/briefs/${date}.md`), firstDated, 'dated brief byte-identical');
  },

  // Story 4.3 / FR32 AC1 — one member crashes: the brief keeps the OTHER jobs' sections and the
  // crash collapses to exactly one failure line; the collector exits SUCCESS (partial night).
  'failure/AC1: a crashed member degrades to one line; other jobs\' sections survive; success exit': () => {
    const r = tmpRepo();
    const date = '2000-04-01';
    // repo-reconcile "crashed" (no findings file at all); arch-review ran fine and produced findings.
    writeFindings(r, 'arch-review', date, [], mkFindings('arch-review', 2, { kind: 'arch', severity: 3 }));
    writeJSON(path.join(outDir(r), `run-status-${date}.json`), { jobs: [
      { job: 'repo-reconcile', status: 'crashed', note: 'subagent exited non-zero', tokens: 0 },
      { job: 'arch-review', status: 'ok', tokens: 500 },
    ] });

    // Success exit: collect-brief.js runs to completion (execFileSync throws on a non-zero exit).
    runScript('collect-brief.js', r, { date });
    const brief = readFile(r, '.nightwatch/MORNING.md');

    // The surviving job's section is fully rendered with its findings.
    assert.ok(/## Architecture \(arch-review\)/.test(brief), 'arch section present');
    assert.ok(/AR-arch0/.test(brief) && /AR-arch1/.test(brief), 'arch findings shown');
    // The crashed member did NOT take out the reconcile section (it renders "0 findings").
    assert.ok(/## Consistency \(repo-reconcile\)/.test(brief), 'reconcile section still present');

    // Exactly one failure line for the crashed member, carrying its status + note.
    const fail = brief.split('## Failures & degraded notices')[1].split('## Appendix')[0];
    const crashLines = fail.split('\n').filter((l) => /repo-reconcile/.test(l));
    assert.strictEqual(crashLines.length, 1, 'crashed member is exactly one line');
    assert.ok(/repo-reconcile: \*\*crashed\*\* — subagent exited non-zero/.test(fail), 'status + note rendered');
  },

  // Story 4.3 / FR32 AC2 — a member killed at `timeout_minutes` records status "timeout"; the
  // deterministic/testable part is that a timeout renders as one line and blocks nothing.
  'failure/AC2: a timeout status renders as one line and does not block the brief': () => {
    const r = tmpRepo();
    const date = '2000-04-02';
    writeFindings(r, 'repo-reconcile', date, [], mkFindings('repo-reconcile', 1, { kind: 'drift', severity: 2 }));
    writeJSON(path.join(outDir(r), `run-status-${date}.json`), { jobs: [
      { job: 'repo-reconcile', status: 'ok', tokens: 300 },
      { job: 'arch-review', status: 'timeout', note: 'killed at timeout_minutes=15', tokens: 15000 },
    ] });
    const res = collect(r, date);
    // The job that DID finish is fully present — the timeout did not block assembly.
    assert.strictEqual(res.total, 1, 'the surviving job\'s finding is in the brief');
    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.ok(/RE-drift0/.test(brief), 'reconcile finding shown despite arch timeout');
    const fail = brief.split('## Failures & degraded notices')[1].split('## Appendix')[0];
    const toLines = fail.split('\n').filter((l) => /arch-review/.test(l));
    assert.strictEqual(toLines.length, 1, 'timeout is exactly one line');
    assert.ok(/arch-review: \*\*timeout\*\* — killed at timeout_minutes=15/.test(fail), 'kill noted');
  },

  // Story 4.3 / FR32 AC3 — the collector itself fails: it still writes a stub brief naming the
  // failure, and the raw findings JSON is left intact in out/ for triage.
  'failure/AC3: collector failure writes a stub brief; raw out/*.json survives': () => {
    const r = tmpRepo();
    const date = '2000-04-03';
    // A findings doc from a too-new schema makes assembly throw (readAllFindings refuses it, FR6).
    writeJSON(path.join(outDir(r), `repo-reconcile-${date}.json`),
      { schema: 999, job: 'repo-reconcile', date, degraded: [], findings: [] });
    const rawBefore = readFile(r, `.nightwatch/out/repo-reconcile-${date}.json`);

    const res = collectOrStub(r, date);
    assert.strictEqual(res.status, 'stub', 'assembly fell back to a stub');
    assert.ok(/schema v999/.test(res.reason), 'reason names the failure');

    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.ok(/brief incomplete/.test(brief), 'stub brief written');
    assert.ok(/schema v999/.test(brief), 'stub names the failure');
    assert.ok(readFile(r, `.nightwatch/briefs/${date}.md`) === brief, 'dated stub brief written too');
    // The raw findings JSON is untouched — the collector never deletes out/*.json.
    assert.strictEqual(readFile(r, `.nightwatch/out/repo-reconcile-${date}.json`), rawBefore, 'raw out/*.json intact');
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
