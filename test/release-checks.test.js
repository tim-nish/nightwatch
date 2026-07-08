'use strict';
const assert = require('assert');
const { tmpRepo, write } = require('./helpers');
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
};
