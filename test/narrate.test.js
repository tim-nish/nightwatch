'use strict';
// Story 6.3 — live lifecycle narration (FR39). One line per event, sourced from the same
// {job,status,tokens,note} recorded to run-status, so narration and the record agree. The pure
// formatters drive scripts/lib/narrate.js; the CLI re-renders from the persisted record.
const assert = require('assert');
const { tmpRepo, write, git, gitInit, commit } = require('./helpers');
const { memberStartLine, memberDoneLine, briefLine, narrateRunStatus } = require('../scripts/lib/narrate');
const { execFileSync } = require('child_process');
const path = require('path');

const SCRIPTS = path.resolve(__dirname, '..', 'scripts');

module.exports = {
  // ---- one line per event, carrying the recorded facts --------------------------------------
  'narrate: a finished member renders exactly one line with status + tokens + note': () => {
    const ok = memberDoneLine({ job: 'repo-reconcile', status: 'ok', tokens: 1234 });
    assert.strictEqual(ok, '✓ repo-reconcile ok (1234 tokens)');
    assert.ok(!ok.includes('\n'), 'exactly one line');

    const crashed = memberDoneLine({ job: 'arch-review', status: 'crashed', note: 'OOM' });
    assert.strictEqual(crashed, '✗ arch-review crashed — OOM');

    assert.strictEqual(memberDoneLine({ job: 'release-progress', status: 'timeout' }), '⏱ release-progress timeout');
    assert.strictEqual(memberDoneLine({ job: 'arch-review', status: 'skipped', note: 'weekly: next due 2026-07-15' }),
      '– arch-review skipped — weekly: next due 2026-07-15');
  },

  'narrate: member-started and brief lines are each a single line': () => {
    assert.strictEqual(memberStartLine({ job: 'repo-reconcile', budget_tokens: 200000, effort: 'medium' }),
      '▶ repo-reconcile started (budget 200000, effort medium)');
    assert.strictEqual(briefLine({ shown: 20, total: 42 }), '▤ brief assembled (20/42 findings shown)');
    assert.strictEqual(briefLine(), '▤ brief assembled');
  },

  // ---- narration is reconstructable from run-status → the two agree by construction ----------
  'narrate: narrateRunStatus reproduces one line per recorded event, in order': () => {
    const rs = {
      jobs: [
        { job: 'repo-reconcile', status: 'ok', tokens: 1000 },
        { job: 'arch-review', status: 'timeout', note: 'exceeded 30m' },
        { job: 'release-progress', status: 'ok', tokens: 500 },
      ],
      brief: { shown: 12, total: 30 },
    };
    const lines = narrateRunStatus(rs);
    assert.strictEqual(lines.length, rs.jobs.length + 1, 'exactly one line per job + one brief line');
    // every line carries the recorded facts for its event
    assert.ok(lines[0].includes('repo-reconcile') && lines[0].includes('ok') && lines[0].includes('1000'));
    assert.ok(lines[1].includes('arch-review') && lines[1].includes('timeout') && lines[1].includes('exceeded 30m'));
    assert.ok(lines[3].includes('brief assembled') && lines[3].includes('12/30'));
    // no event line ever spans more than one line
    for (const l of lines) assert.ok(!l.includes('\n'), 'single line per event');
  },

  'narrate: a run with no brief record narrates only the member lines': () => {
    const lines = narrateRunStatus({ jobs: [{ job: 'repo-reconcile', status: 'ok' }] });
    assert.deepStrictEqual(lines, ['✓ repo-reconcile ok']);
  },

  // ---- CLI reconstructs the narration from the persisted run-status --------------------------
  'narrate CLI: prints the narration lines read from run-status-<date>.json': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, `.nightwatch/out/run-status-2026-07-09.json`, JSON.stringify({
      jobs: [{ job: 'repo-reconcile', status: 'ok', tokens: 42 }, { job: 'arch-review', status: 'crashed', note: 'boom' }],
      brief: { shown: 3, total: 3 },
    }) + '\n');
    commit(root, 'init');
    const out = execFileSync('node', [path.join(SCRIPTS, 'narrate.js'), '--repo', root, '--date', '2026-07-09'], { encoding: 'utf8' });
    const lines = out.trim().split('\n');
    assert.strictEqual(lines.length, 3, 'two members + brief');
    assert.ok(lines[0].startsWith('✓ repo-reconcile ok'));
    assert.ok(lines[1].startsWith('✗ arch-review crashed — boom'));
    assert.ok(lines[2].startsWith('▤ brief assembled (3/3'));
    // read-only: the CLI wrote nothing
    assert.strictEqual(git(root, ['status', '--porcelain']).trim(), '', 'narrate CLI wrote nothing');
  },
};
