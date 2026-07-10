'use strict';
// Story 7.2 — init layout writes: nested .gitignore & one-time confirmed migration (FR50).
// The interview confirms; these ACs pin the mechanical relocation and its invariants:
//   - migration moves legacy root STATE.md/RELEASE.md into .nightwatch/, byte-for-byte, using
//     git mv for tracked files (history follows) and a content-preserving move otherwise;
//   - declining (plain init) leaves the files and every read still succeeds via the 7.1 fallback;
//   - a migrated repo proposes nothing and never clobbers (idempotent);
//   - init never edits the project's root .gitignore.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write, readFile, git, gitInit, commit } = require('./helpers');
const { runInit, planMigration, applyMigration } = require('../scripts/lib/init');
const { loadConfig } = require('../scripts/lib/config');
const { openTracker, releaseReadPath } = require('../scripts/lib/tracker');

const LEGACY_STATE = '# mine\n```yaml\nphase: hardening\n```\n';
const LEGACY_RELEASE = '---\nprogress: 0.4\nupdated: 2026-01-01\n---\n# Release progress\n\n## Notes (human-owned — never machine-edited)\nkeep me\n';

module.exports = {
  'migration: confirmed init relocates tracked legacy root files into .nightwatch/ (git mv, byte-identical)': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'STATE.md', LEGACY_STATE);
    write(root, 'RELEASE.md', LEGACY_RELEASE);
    commit(root, 'legacy install');

    const res = runInit(root, { migrate: true, adapters: [] });
    const byKey = Object.fromEntries(res.migration.map((m) => [m.key, m]));
    assert.strictEqual(byKey.state.moved, true);
    assert.strictEqual(byKey.state.method, 'git-mv', 'tracked → git mv so history follows');
    assert.strictEqual(byKey.release.method, 'git-mv');

    // Files now live under .nightwatch/, byte-for-byte; the root is clean.
    assert.strictEqual(readFile(root, '.nightwatch/STATE.md'), LEGACY_STATE, 'STATE content preserved');
    assert.strictEqual(readFile(root, '.nightwatch/RELEASE.md'), LEGACY_RELEASE, 'RELEASE content preserved');
    assert.strictEqual(readFile(root, 'STATE.md'), null, 'legacy root STATE.md gone');
    assert.strictEqual(readFile(root, 'RELEASE.md'), null, 'legacy root RELEASE.md gone');

    // git mv staged a rename (history-preserving), not a delete+add.
    const status = git(root, ['status', '--porcelain']);
    assert.ok(/^R.*STATE\.md -> \.nightwatch\/STATE\.md/m.test(status), 'STATE.md is a staged rename');
  },

  'migration: untracked legacy files move via content-preserving fs move': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'empty');
    write(root, 'STATE.md', LEGACY_STATE); // never committed → untracked
    const report = applyMigration(root, planMigration(root));
    const state = report.find((m) => m.key === 'state');
    assert.strictEqual(state.moved, true);
    assert.strictEqual(state.method, 'fs', 'untracked → fs move');
    assert.strictEqual(readFile(root, '.nightwatch/STATE.md'), LEGACY_STATE);
    assert.strictEqual(readFile(root, 'STATE.md'), null);
  },

  'migration: declined (plain init) leaves legacy files in place and all reads still succeed': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'STATE.md', LEGACY_STATE);
    write(root, 'RELEASE.md', LEGACY_RELEASE);
    commit(root, 'legacy install');

    const res = runInit(root, { adapters: [] }); // no migrate flag → decline
    assert.strictEqual(res.migration, null, 'nothing migrated when not confirmed');
    assert.strictEqual(readFile(root, 'STATE.md'), LEGACY_STATE, 'legacy STATE untouched');
    assert.strictEqual(readFile(root, 'RELEASE.md'), LEGACY_RELEASE, 'legacy RELEASE untouched');
    // init did NOT create shadowing declarations (7.1 legacy-aware create-only).
    assert.strictEqual(res.declarations.find((d) => d.file === 'state').written, false);

    // Reads still succeed via the 7.1 fallback.
    assert.strictEqual(loadConfig(root).phase, 'hardening', 'legacy STATE still read');
    assert.strictEqual(releaseReadPath(root, loadConfig(root).config), path.resolve(root, 'RELEASE.md'), 'legacy RELEASE adopted for read');
  },

  'migration: is idempotent — a migrated repo proposes nothing and never clobbers': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'STATE.md', LEGACY_STATE);
    commit(root, 'legacy');
    applyMigration(root, planMigration(root)); // first migration

    assert.deepStrictEqual(planMigration(root).moves, [], 'nothing left to move');
    // A destination that already exists is never clobbered even if a stray legacy file reappears.
    write(root, 'STATE.md', 'DIFFERENT\n');
    const report = applyMigration(root, { moves: [{ key: 'state', from: 'STATE.md', to: '.nightwatch/STATE.md', tracked: false }] });
    assert.strictEqual(report[0].moved, false);
    assert.strictEqual(report[0].reason, 'destination-exists');
    assert.strictEqual(readFile(root, '.nightwatch/STATE.md'), LEGACY_STATE, 'destination preserved');
  },

  'migration: release_path opting RELEASE.md back to the root proposes no release move': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'RELEASE.md', LEGACY_RELEASE);
    write(root, '.nightwatch/config.yaml', 'release_path: RELEASE.md\n');
    commit(root, 'root deliverable');
    const moves = planMigration(root).moves;
    assert.ok(!moves.some((m) => m.key === 'release'), 'root-opt-in RELEASE.md is not relocated');
  },

  'migration: init writes the nested .gitignore and leaves a legacy root .gitignore untouched': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, '.gitignore', 'node_modules/\n.nightwatch/out/\n'); // pre-existing legacy line
    commit(root, 'legacy gitignore');
    runInit(root, { adapters: [] });
    assert.ok(/^out\/$/m.test(readFile(root, '.nightwatch/.gitignore')), 'nested ignore written');
    assert.strictEqual(readFile(root, '.gitignore'), 'node_modules/\n.nightwatch/out/\n', 'root .gitignore byte-identical (legacy line left in place)');
  },
};
