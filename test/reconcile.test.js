'use strict';
const assert = require('assert');
const fs = require('fs');
const { tmpRepo, write, git, gitInit, commit } = require('./helpers');
const { reconcile } = require('../scripts/reconcile');

function byLocusKind(res) { return res; }

// A node repo whose README drift lives on its own lines, so a delete-patch is surgical: the real
// `--tag` flag / `npm test` command survive, only the drifted `--bogus` / `npm run deploy` go.
function repoWithSurgicalDrift(role) {
  const r = tmpRepo();
  gitInit(r);
  write(r, 'package.json', JSON.stringify({ name: 'demo', bin: { demo: 'cli.js' }, scripts: { test: 'node t.js' } }));
  write(r, 'cli.js', "if (args['--tag']) {}\nprogram.command('serve');\n");
  write(r, 'README.md', [
    '# Demo',
    'Use `--tag` to label a run.',
    'The `--bogus` flag is documented but the CLI lacks it.',
    '',
    '```sh',
    'npm test',
    '```',
    '',
    '```sh',
    'npm run deploy',
    '```',
    '',
  ].join('\n'));
  write(r, 'STATE.md', `# State\n\n\`\`\`yaml\nauthority:\n  readme:\n    role: ${role}\n    artifact: README.md\n\`\`\`\n`);
  commit(r, 'init');
  return r;
}

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

  'reconcile: derived artifact → patch-available + patch written; applying it fixes drift, re-run 0 (FR20)': () => {
    const r = repoWithSurgicalDrift('derived');
    const res = reconcile(r, { date: '2000-01-01' });
    const drift = res.findings.filter((f) => f.kind === 'drift');
    assert.ok(drift.length >= 2, 'drifted flag + command detected');
    for (const f of drift) {
      assert.strictEqual(f.action, 'patch-available', 'derived → mechanically fixable');
      assert.ok(f.evidence.length && typeof f.evidence[0].path === 'string', 'evidence pointer present');
      assert.strictEqual(f.direction, 'README.md', 'direction names the derived artifact');
    }
    // Patch file written under out/, and never anything edited in place.
    assert.ok(res.patchPath && fs.existsSync(res.patchPath), 'patch file written to .nightwatch/out');
    const patchText = fs.readFileSync(res.patchPath, 'utf8');
    assert.match(patchText, /^--- a\/README\.md/m);
    assert.match(patchText, /^\+\+\+ b\/README\.md/m);
    assert.match(patchText, /^-.*--bogus/m);
    assert.strictEqual(git(r, ['diff', '--name-only']).trim(), '', 'no tracked repo file edited in place');

    // Apply the patch and re-run: drift is gone.
    git(r, ['apply', res.patchPath]);
    const readme = fs.readFileSync(r + '/README.md', 'utf8');
    assert.ok(!/--bogus/.test(readme), 'drifted flag line removed by patch');
    assert.ok(/--tag/.test(readme), 'real flag documentation preserved');
    const res2 = reconcile(r, { date: '2000-01-02' });
    assert.strictEqual(res2.findings.filter((f) => f.kind === 'drift').length, 0, 're-run after apply → 0 drift findings');
    assert.strictEqual(res2.patch, null, 're-run drafts no patch');
  },

  'reconcile: authoritative artifact → human-decision, no patch drafted in either direction (FR20)': () => {
    const r = repoWithSurgicalDrift('authoritative');
    const res = reconcile(r, { date: '2000-01-01' });
    const drift = res.findings.filter((f) => f.kind === 'drift');
    assert.ok(drift.length >= 2, 'drift still detected');
    for (const f of drift) {
      assert.strictEqual(f.action, 'human-decision', 'authoritative conflict is a human decision');
      assert.ok(!('direction' in f), 'no direction-of-fix for an authoritative artifact');
    }
    assert.strictEqual(res.patch, null, 'no patch drafted');
    assert.ok(!fs.existsSync(r + '/.nightwatch/out/reconcile-2000-01-01.patch'), 'no patch file written');
    assert.ok(res.human_decisions.length >= 2 && res.human_decisions.every((id) => typeof id === 'string'),
      'human-decision findings exposed as a grouping');
  },

  'reconcile: authority glob matching nothing → setup finding names the dead pointer (FR36)': () => {
    const r = tmpRepo();
    write(r, 'package.json', JSON.stringify({ name: 'demo', scripts: { test: 'node t.js' } }));
    write(r, 'cli.js', "if (args['--tag']) {}");
    write(r, 'README.md', '# Demo\nUse `--tag` and `--bogus`.\n\n```sh\nnpm test\n```\n');
    write(r, 'STATE.md', '# State\n\n```yaml\nauthority:\n  guide:\n    role: derived\n    artifact: docs/guide.md\n```\n');
    const res = reconcile(r, { date: '2000-01-01' });
    const dead = res.findings.find((f) => f.kind === 'setup' && /docs\/guide\.md/.test(f.title));
    assert.ok(dead, 'setup finding names the dead authority pointer');
    assert.match(dead.title, /guide/);
    assert.ok(res.degraded.some((d) => /dead pointer/.test(d)), 'dead pointer noted in degraded');
    // README isn't covered by any authority entry → its drift stays a human decision (3.2 behavior).
    const bogus = res.findings.find((f) => f.kind === 'drift' && /--bogus/.test(f.title));
    assert.ok(bogus && bogus.action === 'human-decision' && !('direction' in bogus), 'undeclared artifact → human-decision, no direction');
    assert.strictEqual(res.patch, null, 'dead pointer alone drafts no patch');
  },

  // --- Story 3.5: opt-in patch branches via a temporary worktree (FR21) ---

  'reconcile: patch_branch true → nightwatch/reconcile/<date> holds exactly the patch commit, built in a temp worktree (FR21)': () => {
    const r = repoWithSurgicalDrift('derived');
    write(r, '.nightwatch/config.yaml', 'patch_branch: true\n');
    commit(r, 'enable patch_branch'); // start from a fully clean tree
    const branch = 'nightwatch/reconcile/2000-01-01';

    const res = reconcile(r, { date: '2000-01-01' });
    assert.strictEqual(res.patchBranch, branch, 'reconcile reports the created branch');

    // Branch exists and sits exactly ONE commit ahead of the base HEAD.
    assert.ok(/(^|\n).*nightwatch\/reconcile\/2000-01-01/.test(git(r, ['branch', '--list', branch])), 'branch exists');
    assert.strictEqual(git(r, ['rev-list', '--count', `HEAD..${branch}`]).trim(), '1', 'exactly one commit ahead of HEAD');
    assert.strictEqual(git(r, ['rev-parse', `${branch}~1`]).trim(), git(r, ['rev-parse', 'HEAD']).trim(), 'the one commit sits directly on HEAD');

    // That commit is the patch: --bogus gone from README on the branch, --tag kept.
    const branchReadme = git(r, ['show', `${branch}:README.md`]);
    assert.ok(!/--bogus/.test(branchReadme), 'drifted flag removed on the branch');
    assert.ok(/--tag/.test(branchReadme), 'real flag documentation preserved on the branch');
    assert.match(git(r, ['log', '-1', '--format=%s', branch]), /reconcile 2000-01-01/);

    // The transient worktree was removed and pruned — only the main worktree remains.
    assert.strictEqual(git(r, ['worktree', 'list']).trim().split('\n').length, 1, 'no leftover temporary worktree');
  },

  'reconcile: patch_branch true → the user checked-out branch and working tree are byte-identical after the run (FR21)': () => {
    const r = repoWithSurgicalDrift('derived');
    write(r, '.nightwatch/config.yaml', 'patch_branch: true\n');
    commit(r, 'enable patch_branch');

    // Snapshot the user's tree BEFORE the run.
    const beforeHead = git(r, ['rev-parse', 'HEAD']).trim();
    const beforeBranch = git(r, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const beforeStatus = git(r, ['status', '--porcelain', '--untracked-files=no']);
    const beforeReadme = fs.readFileSync(r + '/README.md', 'utf8');

    const res = reconcile(r, { date: '2000-01-01' });
    assert.ok(res.patchBranch, 'branch was created (precondition)');

    // AFTER: identical HEAD, identical checked-out branch, no tracked-file changes, byte-identical file.
    assert.strictEqual(git(r, ['rev-parse', 'HEAD']).trim(), beforeHead, 'HEAD unchanged');
    assert.strictEqual(git(r, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), beforeBranch, 'checked-out branch never switched');
    assert.strictEqual(git(r, ['status', '--porcelain', '--untracked-files=no']), beforeStatus, 'no tracked working-tree change');
    assert.strictEqual(fs.readFileSync(r + '/README.md', 'utf8'), beforeReadme, 'README.md byte-identical (never edited in place)');

    // Idempotent re-run: the branch still carries exactly the one patch commit.
    const res2 = reconcile(r, { date: '2000-01-01' });
    assert.strictEqual(res2.patchBranch, 'nightwatch/reconcile/2000-01-01');
    assert.strictEqual(git(r, ['rev-list', '--count', 'HEAD..nightwatch/reconcile/2000-01-01']).trim(), '1', 're-run keeps exactly one commit');
  },

  'reconcile: patch_branch false (default) → only the patch file is produced, no branch created (FR21)': () => {
    const r = repoWithSurgicalDrift('derived');
    const res = reconcile(r, { date: '2000-01-01' });
    // Patch still emitted under out/, exactly as before.
    assert.ok(res.patchPath && fs.existsSync(res.patchPath), 'patch file written under .nightwatch/out');
    assert.strictEqual(res.patchBranch, null, 'no branch reported by default');
    // No nightwatch/* branch anywhere.
    assert.strictEqual(git(r, ['branch', '--list', 'nightwatch/*']).trim(), '', 'no nightwatch/* branch created by default');
    assert.strictEqual(git(r, ['worktree', 'list']).trim().split('\n').length, 1, 'no temporary worktree created');
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
