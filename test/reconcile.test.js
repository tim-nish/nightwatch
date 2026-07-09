'use strict';
const assert = require('assert');
const { tmpRepo, write } = require('./helpers');
const { reconcile } = require('../scripts/reconcile');

function byLocusKind(res) { return res; }

// A node repo whose README documents one real flag/command and one drifted one, plus an
// architecture assertion. `--tag` exists in code; `--bogus` does not. `npm test` exists;
// `npm deploy` does not.
function repoWithDrift({ state } = {}) {
  const r = tmpRepo();
  write(r, 'package.json', JSON.stringify({ name: 'demo', bin: { demo: 'cli.js' }, scripts: { test: 'node t.js' } }));
  write(r, 'cli.js', "if (args['--tag']) {}\nprogram.command('serve');\n");
  write(r, 'README.md', [
    '# Demo',
    'Use `--tag` to label and `--bogus` to explode.',
    '',
    '```sh',
    'npm test',
    '```',
    '',
    '```sh',
    'npm run deploy',
    '```',
    '',
    'The scanner `never` writes to `src/core`.',
  ].join('\n'));
  if (state) write(r, 'STATE.md', state);
  return r;
}

const AUTHORITY_STATE = '# State\n\n```yaml\nauthority:\n  readme:\n    role: derived\n    artifact: README.md\n```\n';

module.exports = {
  'reconcile: extracts flag, command, and architecture claims with evidence pointers (FR19)': () => {
    const res = reconcile(repoWithDrift({ state: AUTHORITY_STATE }));
    const kinds = new Set(res.claims.map((c) => c.kind));
    assert.ok(kinds.has('flag') && kinds.has('command') && kinds.has('architecture'), 'all three claim kinds captured');
    for (const c of res.claims) {
      assert.ok(c.source && typeof c.source.path === 'string' && typeof c.source.line === 'number', 'claim has an evidence pointer');
      assert.ok(['holds', 'drifted', 'unverifiable-statically'].includes(c.verdict));
    }
  },

  'reconcile: verdicts — real flag/command hold, fake ones drift, assertions unverifiable (FR19)': () => {
    const res = reconcile(repoWithDrift({ state: AUTHORITY_STATE }));
    const v = (locusFrag) => res.claims.find((c) => c.locus.includes(locusFrag));
    assert.strictEqual(v('flag:--tag').verdict, 'holds');
    assert.strictEqual(v('flag:--bogus').verdict, 'drifted');
    assert.strictEqual(v('command:npm:test').verdict, 'holds');
    assert.strictEqual(v('command:npm:deploy').verdict, 'drifted');
    assert.ok(res.unverifiable.some((u) => u.kind === 'architecture'), 'assertion listed for daytime, not guessed');
    // Drift becomes findings; holds do not.
    assert.ok(res.findings.some((f) => f.kind === 'drift' && /--bogus/.test(f.title)));
    assert.ok(!res.findings.some((f) => /--tag/.test(f.title)));
  },

  'reconcile: no STATE.md → detection-only, setup finding is #1, drift omits direction (FR20)': () => {
    const res = reconcile(repoWithDrift()); // no state
    assert.strictEqual(res.findings[0].kind, 'setup', 'setup finding ranked #1');
    assert.match(res.findings[0].title, /declare authority in STATE\.md/);
    for (const f of res.findings) {
      assert.ok(!('direction' in f), 'no direction-of-fix in detection-only mode');
    }
    assert.ok(res.degraded.some((d) => /detection-only/.test(d)));
  },

  'reconcile: absent docs/ → claims from README only, limitation noted in degraded (FR36)': () => {
    const res = reconcile(repoWithDrift({ state: AUTHORITY_STATE }));
    assert.ok(res.degraded.some((d) => /no docs\/ directory/.test(d)));
  },

  'reconcile: broken surface is finding #1 and stops deeper checks (FR20)': () => {
    const r = tmpRepo();
    write(r, 'package.json', '{ not valid json ');
    write(r, 'README.md', 'Use `--tag`.');
    const res = reconcile(r);
    assert.strictEqual(res.stopped, true);
    assert.strictEqual(res.findings.length, 1);
    assert.strictEqual(res.findings[0].kind, 'blocker');
    assert.strictEqual(res.claims.length, 0, 'no claim extraction after a broken surface');
  },

  'reconcile: clean repo (authority declared, no drift) → 0 findings': () => {
    const r = tmpRepo();
    write(r, 'package.json', JSON.stringify({ name: 'clean', scripts: { test: 'node t.js' } }));
    write(r, 'cli.js', "if (args['--tag']) {}");
    write(r, 'docs/guide.md', 'All good here.');
    write(r, 'README.md', '# Clean\nUse `--tag`.\n\n```sh\nnpm test\n```\n');
    write(r, 'STATE.md', AUTHORITY_STATE);
    const res = reconcile(r);
    assert.strictEqual(res.findings.length, 0, 'no drift, authority declared → nothing to report');
  },
};
