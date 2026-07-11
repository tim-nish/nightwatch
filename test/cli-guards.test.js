'use strict';
// Story 11.4 / FR95 — job-CLI usage guards. Every job CLI prints usage and writes NOTHING on
// `--help` / `-h` / an unrecognized flag, and refuses (exit 2, no writes) when cwd is not a git
// checkout and no `--repo` was given. This is the structural fix for the finding-0034 breach: an
// exploratory invocation must never create `.nightwatch/` where the caller happens to stand.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..', 'scripts');

// Every CLI entrypoint (each ends with `if (require.main === module) main()`).
const CLIS = [
  'arch-review.js', 'arch-signals.js', 'backfill-feedback.js', 'collect-brief.js',
  'extract-signals.js', 'first-run.js', 'git-signals.js', 'init.js', 'narrate.js',
  'orchestrate.js', 'reconcile.js', 'release-checks.js', 'release-progress.js',
  'review-feedback.js', 'surface-inventory.js',
];

function run(name, args, cwd) {
  // spawnSync captures BOTH stdout and stderr regardless of exit code (the guard writes usage to
  // stdout on --help but the unknown-flag/refusal messages to stderr).
  const r = spawnSync('node', [path.join(SCRIPTS, name), ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nw-guard-')); }

module.exports = {
  'cli-guard: every CLI prints usage and writes nothing on --help (FR95)': () => {
    for (const name of CLIS) {
      const d = freshDir();
      const r = run(name, ['--help'], d);
      assert.strictEqual(r.code, 0, `${name} --help exits 0 (got ${r.code}): ${r.stderr}`);
      assert.match(r.stdout, /^usage: /m, `${name} --help prints usage`);
      assert.deepStrictEqual(fs.readdirSync(d), [], `${name} --help wrote nothing (the 0034 breach fixture)`);
    }
  },

  'cli-guard: -h behaves like --help — usage, exit 0, no writes (FR95)': () => {
    for (const name of CLIS) {
      const d = freshDir();
      const r = run(name, ['-h'], d);
      assert.strictEqual(r.code, 0, `${name} -h exits 0`);
      assert.match(r.stdout, /^usage: /m, `${name} -h prints usage`);
      assert.deepStrictEqual(fs.readdirSync(d), [], `${name} -h wrote nothing`);
    }
  },

  'cli-guard: an unrecognized flag prints usage and writes nothing (FR95)': () => {
    for (const name of CLIS) {
      const d = freshDir();
      // --repo is supplied so the git-checkout guard cannot fire — the unknown flag is what stops it.
      const r = run(name, ['--repo', d, '--totally-unknown-flag'], d);
      assert.strictEqual(r.code, 0, `${name} unknown-flag exits 0`);
      assert.match(r.stderr + r.stdout, /unknown option: --totally-unknown-flag/, `${name} names the unknown flag`);
      assert.ok(!fs.existsSync(path.join(d, '.nightwatch')), `${name} unknown-flag created no .nightwatch/`);
    }
  },

  'cli-guard: refuses in a non-git cwd with no --repo, writing nothing (FR95, NFR3)': () => {
    for (const name of CLIS) {
      const d = freshDir(); // a plain directory, not a git checkout
      const r = run(name, [], d); // no --repo → resolves to cwd, which is not git
      assert.strictEqual(r.code, 2, `${name} refuses with exit 2 (got ${r.code})`);
      assert.match(r.stderr, /not a git checkout and no --repo/, `${name} explains the refusal`);
      assert.deepStrictEqual(fs.readdirSync(d), [], `${name} refused without writing`);
    }
  },
};
