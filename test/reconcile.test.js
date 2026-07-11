'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write, git, gitInit, commit } = require('./helpers');
const { reconcile } = require('../scripts/reconcile');
const { recurrenceCounts, readLedger } = require('../scripts/lib/findings');

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

  // Story 9.3 — patches are named per finding (spec finding-lifecycle P5): each derived-drift
  // finding carries a `patch_file` at runtime/out/reconcile-<date>-<id>.patch, and that file exists.
  'reconcile: each derived-drift finding gets its own per-id patch file (FR76)': () => {
    const r = repoWithSurgicalDrift('derived');
    const res = reconcile(r, { date: '2000-01-01' });
    const drift = res.findings.filter((f) => f.kind === 'drift');
    assert.ok(drift.length >= 2, 'multiple drifted claims');
    for (const f of drift) {
      assert.strictEqual(f.patch_file, `.nightwatch/runtime/out/reconcile-2000-01-01-${f.id}.patch`, 'per-finding patch path');
      assert.ok(fs.existsSync(path.join(r, ...f.patch_file.split('/'))), 'the per-finding patch file exists');
    }
    assert.strictEqual(res.patches.length, drift.length, 'one patch entry per derived-drift finding');
    // A same-date forced re-run keeps every still-open finding's patch file present (preservation).
    reconcile(r, { date: '2000-01-01', force: true });
    for (const f of drift) assert.ok(fs.existsSync(path.join(r, ...f.patch_file.split('/'))), 'patch preserved across a forced re-run');
  },

  // Story 9.3 — a forced same-date re-run appends a `forced: true` run row (never swallowed by the
  // same-date guard); an unforced re-run appends nothing (FR77).
  'reconcile: a forced re-run traces in the ledger; an unforced re-run is a no-op (FR77)': () => {
    const r = repoWithSurgicalDrift('derived');
    reconcile(r, { date: '2000-01-01' });
    reconcile(r, { date: '2000-01-01' }); // unforced same-date → no new run row
    let runs = readLedger(r).filter((x) => x.type === 'run' && x.job === 'repo-reconcile' && x.date === '2000-01-01');
    assert.strictEqual(runs.length, 1, 'unforced re-run appends no run row');
    reconcile(r, { date: '2000-01-01', force: true });
    runs = readLedger(r).filter((x) => x.type === 'run' && x.job === 'repo-reconcile' && x.date === '2000-01-01');
    assert.strictEqual(runs.length, 2, 'forced re-run appends a second run row');
    assert.ok(runs.some((x) => x.forced === true), 'the forced run row is stamped forced:true');
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
    assert.ok(!fs.existsSync(r + '/.nightwatch/runtime/out/reconcile-2000-01-01.patch'), 'no patch file written');
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

  // ---- Story 3.4: adversarial verification pass (FR22) ----

  'reconcile: adversarial pass — a drifted verdict survives (verified) while a refutable one is eliminated (FR22)': () => {
    const r = repoWithDrift({ state: AUTHORITY_STATE }); // README drifts on `--bogus` flag AND `npm deploy`
    // The refuting reviewer (stand-in for the second subagent): eliminate the `npm deploy` command
    // verdict as a false positive, but fail to refute the `--bogus` flag verdict.
    const refute = (f) => (/npm deploy/.test(f.title) ? { refuted: true, reason: 'deploy is a valid alias verified by a code read' } : false);
    const res = reconcile(r, { date: '2000-01-01', refute });

    // The known-good drift survives, stamped verified, and reaches the brief.
    const bogus = res.findings.find((f) => f.kind === 'drift' && /--bogus/.test(f.title));
    assert.ok(bogus, 'known-good drifted verdict survives the adversarial pass');
    assert.strictEqual(bogus.verified, true, 'survivor is stamped verified:true');

    // The refuted verdict is dropped from the brief entirely and recorded as refuted.
    assert.ok(!res.findings.some((f) => /npm deploy/.test(f.title)), 'refuted verdict dropped from the brief');
    assert.ok(res.refuted.some((x) => /npm deploy/.test(x.title) && /deploy is a valid alias/.test(x.reason)),
      'refuted verdict recorded with its refutation reason');

    // Brief-wide invariant: only verified findings enter the brief.
    assert.ok(res.findings.length > 0 && res.findings.every((f) => f.verified === true), 'every brief finding is verified');
    // The dropped verdict is never patched (its README line stays in the drafted patch's scope out).
    if (res.patch) assert.ok(!/deploy/.test(res.patch), 'a refuted verdict is never patched');
  },

  'reconcile: default (no refuter) eliminates nothing — every drift verdict survives verified (FR22)': () => {
    const res = reconcile(repoWithDrift({ state: AUTHORITY_STATE }), { date: '2000-01-01' });
    const drift = res.findings.filter((f) => f.kind === 'drift');
    assert.ok(drift.length >= 2, 'both drifted verdicts detected');
    assert.ok(drift.every((f) => f.verified === true), 'the deterministic default refutes nothing → all survive verified');
    assert.deepStrictEqual(res.refuted, [], 'nothing recorded as refuted');
  },

  'reconcile: survivor id is stable across nights and recurrence is counted, not re-reported as new (FR7)': () => {
    const r = repoWithDrift({ state: AUTHORITY_STATE });
    const night1 = reconcile(r, { date: '2000-01-01' });
    const night2 = reconcile(r, { date: '2000-01-02' });
    const driftIds = (res) => res.findings.filter((f) => f.kind === 'drift').map((f) => f.id).sort();

    // Same repo, same verdicts → byte-identical ids both nights (id is a content hash of kind|locus).
    assert.deepStrictEqual(driftIds(night1), driftIds(night2), 'a surviving finding has an identical id both nights');

    // Recurrence via the ledger: night 1 the finding is new (0); night 2 it recurs (>=1), not re-reported.
    const bogus1 = night1.findings.find((f) => f.kind === 'drift' && /--bogus/.test(f.title));
    const bogus2 = night2.findings.find((f) => f.kind === 'drift' && /--bogus/.test(f.title));
    assert.strictEqual(bogus1.id, bogus2.id, 'same locus → same id across runs');
    assert.strictEqual(bogus1.recurrence, 0, 'first night the finding is new');
    assert.ok(bogus2.recurrence >= 1, 'second night the recurrence is counted, not re-reported as new');
    // The append-only ledger records both appearances under the one stable id.
    assert.ok(recurrenceCounts(r).get(bogus2.id) >= 2, 'ledger counts both nights under the same id');
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
