'use strict';
// Test helpers: build throwaway fixture repos in the OS temp dir and run the plugin
// scripts against them. No third-party test framework — Node's assert + a tiny runner
// (test/run.js) only, matching the plugin's js-yaml-only dependency budget.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');

let seq = 0;
/** Create a fresh empty temp directory; auto-removed at process exit. */
function tmpRepo(prefix = 'nw-fix-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix + (seq++) + '-'));
  cleanups.push(dir);
  return dir;
}

const cleanups = [];
process.on('exit', () => {
  for (const d of cleanups) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
});

/** Write a file, creating parent dirs. `rel` is repo-relative (POSIX ok). */
function write(root, rel, content) {
  const abs = path.join(root, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function readFile(root, rel) {
  try { return fs.readFileSync(path.join(root, rel.split('/').join(path.sep)), 'utf8'); }
  catch { return null; }
}

function readJSON(root, rel) {
  const t = readFile(root, rel);
  return t == null ? null : JSON.parse(t);
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
}

/** Initialize a git repo with deterministic identity. */
function gitInit(root) {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'T']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'commit.gpgsign', 'false']);
}

/** Stage everything and commit with a message. */
function commit(root, msg) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', msg]);
}

/** Run a plugin script; returns { stdout, doc } where doc is the parsed out/<name>-<date>.json. */
function runScript(name, root, { date = '2000-01-01', extraArgs = [] } = {}) {
  const stdout = execFileSync('node', [path.join(SCRIPTS, name), '--repo', root, '--date', date, ...extraArgs], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { stdout };
}

module.exports = { ROOT, SCRIPTS, tmpRepo, write, readFile, readJSON, git, gitInit, commit, runScript };
