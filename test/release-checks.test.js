'use strict';
const assert = require('assert');
const { tmpRepo, write, gitInit, commit, git } = require('./helpers');
const { releaseChecks } = require('../scripts/release-checks');

function byId(res) { const m = {}; for (const c of res.checks) m[c.id] = c; return m; }

module.exports = {
  'release-checks: bare repo fails license/readme/ci/changelog': () => {
    const r = tmpRepo();
    write(r, 'a.js', 'const x = 1;');
    const c = byId(releaseChecks(r));
    assert.strictEqual(c.license.status, 'fail');
    assert.strictEqual(c.readme_sections.status, 'fail');
    assert.strictEqual(c.ci_present.status, 'fail');
    assert.strictEqual(c.changelog.status, 'fail');
  },

  'release-checks: complete repo passes hygiene checks': () => {
    const r = tmpRepo();
    write(r, 'LICENSE', 'MIT');
    write(r, 'README.md', '# Demo\n## Installation\nsteps\n## Quickstart\nrun it\n');
    write(r, '.github/workflows/ci.yml', 'name: ci');
    write(r, 'CHANGELOG.md', '# Changelog');
    const c = byId(releaseChecks(r));
    assert.strictEqual(c.license.status, 'pass');
    assert.strictEqual(c.readme_sections.status, 'pass');
    assert.strictEqual(c.ci_present.status, 'pass');
    assert.strictEqual(c.changelog.status, 'pass');
  },

  'release-checks: detects a committed AWS-key-shaped secret, with evidence': () => {
    const r = tmpRepo();
    write(r, 'config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";');
    const c = byId(releaseChecks(r));
    assert.strictEqual(c.no_secrets.status, 'fail');
    assert.ok(c.no_secrets.evidence.some((e) => e.path === 'config.js'));
  },

  'release-checks: secret patterns in fixtures/tests are ignored': () => {
    const r = tmpRepo();
    write(r, 'test/fixtures/sample.js', 'const key = "AKIAIOSFODNN7EXAMPLE";');
    const c = byId(releaseChecks(r));
    assert.strictEqual(c.no_secrets.status, 'pass', 'test/fixtures excluded from secret scan');
  },

  'release-checks: TODO threshold fails when exceeded': () => {
    const r = tmpRepo();
    const many = Array.from({ length: 45 }, (_, i) => `// TODO item ${i}`).join('\n');
    write(r, 'big.js', many);
    const c = byId(releaseChecks(r));
    assert.strictEqual(c.todo_threshold.status, 'fail');
  },

  'release-checks: disable list skips a check': () => {
    const r = tmpRepo();
    write(r, '.nightwatch/config.yaml', 'release_checks: {disable: [changelog]}\n');
    const c = byId(releaseChecks(r));
    assert.strictEqual(c.changelog.status, 'skip');
    assert.match(c.changelog.detail, /disabled/);
  },

  'release-checks: CI check surfaces the runnable test entrypoint (last-test-run hook)': () => {
    const r = tmpRepo();
    write(r, '.github/workflows/ci.yml', 'name: ci');
    write(r, 'package.json', JSON.stringify({ scripts: { test: 'node test/run.js' } }));
    const c = byId(releaseChecks(r));
    assert.strictEqual(c.ci_present.status, 'pass');
    assert.strictEqual(c.ci_present.test_command, 'npm test');
    assert.match(c.ci_present.detail, /npm test/);
  },

  'release-checks: version matching the latest tag passes': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, 'package.json', JSON.stringify({ version: '1.0.0' }));
    commit(r, 'init');
    git(r, ['tag', 'v1.0.0']);
    const c = byId(releaseChecks(r));
    assert.strictEqual(c.version_tag.status, 'pass');
  },

  'release-checks: version disagreeing with the latest tag fails': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, 'package.json', JSON.stringify({ version: '9.9.9' }));
    commit(r, 'init');
    git(r, ['tag', 'v1.0.0']);
    const c = byId(releaseChecks(r));
    assert.strictEqual(c.version_tag.status, 'fail');
    assert.match(c.version_tag.detail, /9\.9\.9/);
  },

  'release-checks: output is byte-identical across repeated runs (NFR8)': () => {
    const r = tmpRepo();
    write(r, 'LICENSE', 'MIT');
    write(r, 'README.md', '# Demo\n## Installation\nx\n## Usage\ny\n');
    write(r, '.github/workflows/ci.yml', 'name: ci');
    write(r, 'CHANGELOG.md', '# Changelog');
    assert.strictEqual(JSON.stringify(releaseChecks(r)), JSON.stringify(releaseChecks(r)));
  },
};
