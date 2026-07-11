'use strict';
// Story 7.5 — overnight config-drift nudge (FR53). A run that meets a new top-level directory no
// declaration classifies (neither product-declared, nor in ignore/dev_tooling) adds exactly one
// brief line naming it and pointing at `/nightwatch init --update`; a fully-classified repo adds
// none; detection is read-only (writes no declarations) and byte-deterministic.
const assert = require('assert');
const { tmpRepo, write, readFile, gitInit, commit } = require('./helpers');
const { unclassifiedTopDirs } = require('../scripts/lib/scope');
const { loadConfig } = require('../scripts/lib/config');
const { collect } = require('../scripts/collect-brief');

const DEFAULT_CFG = loadConfig(tmpRepo()).config; // resolved defaults (ignore + dev_tooling)

module.exports = {
  // ---- pure detection (scope.js) ------------------------------------------------------------
  'drift: flags a tracked, analyzed, non-allowlisted, undeclared top-level dir': () => {
    const dirs = unclassifiedTopDirs('/x', DEFAULT_CFG, { trackedTop: ['services', 'src', 'docs'], klass: 'code' });
    assert.deepStrictEqual(dirs, ['services'], 'services/ is unclassified; src/ & docs/ are allowlisted');
  },

  'drift: an ignore/dev_tooling-excluded dir is never flagged': () => {
    const dirs = unclassifiedTopDirs('/x', DEFAULT_CFG, { trackedTop: ['_bmad', 'node_modules', 'services'], klass: 'code' });
    assert.deepStrictEqual(dirs, ['services'], 'excluded trees are classified, not drift');
  },

  'drift: a dir named by an authority declaration is classified': () => {
    const authority = { behavior: { artifact: 'proto/*.md', role: 'authoritative' } };
    const dirs = unclassifiedTopDirs('/x', DEFAULT_CFG, { trackedTop: ['proto', 'services'], authority, klass: 'code' });
    assert.deepStrictEqual(dirs, ['services'], 'proto/ is declared via authority, so not drift');
  },

  'drift: a user dev_tooling extension classifies its dir': () => {
    const cfg = loadConfig(tmpRepo()).config;
    const withExt = { ...cfg, dev_tooling: [...cfg.dev_tooling, 'agents/**'] };
    const dirs = unclassifiedTopDirs('/x', withExt, { trackedTop: ['agents', 'services'], klass: 'code' });
    assert.deepStrictEqual(dirs, ['services'], 'agents/ now excluded by the extended dev_tooling');
  },

  'drift: deterministic — multiple undeclared dirs come back sorted': () => {
    const dirs = unclassifiedTopDirs('/x', DEFAULT_CFG, { trackedTop: ['zeta', 'alpha', 'mid'], klass: 'code' });
    assert.deepStrictEqual(dirs, ['alpha', 'mid', 'zeta']);
  },

  // ---- brief wiring (collect-brief.js) ------------------------------------------------------
  'drift: overnight brief emits exactly one line per undeclared dir, pointing at init --update': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, 'package.json', '{"name":"demo"}');
    write(r, 'src/app.js', 'module.exports = 1;\n'); // allowlisted product
    write(r, 'services/svc.js', 'module.exports = 2;\n'); // undeclared → drift
    commit(r, 'repo');
    collect(r, '2026-07-10');
    const brief = readFile(r, '.nightwatch/MORNING.md');
    const section = brief.split('## Machine notes — nothing to act on')[1];
    const lines = section.split('\n').filter((l) => /new top-level directory/.test(l));
    assert.strictEqual(lines.length, 1, 'exactly one drift line');
    assert.match(lines[0], /new top-level directory `services\/` is unclassified; run `\/nightwatch init --update`/);
    assert.ok(!/`src\//.test(section), 'allowlisted product dir is not nudged');
  },

  'drift: a fully-classified repo emits no drift line': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, 'package.json', '{"name":"demo"}');
    write(r, 'src/app.js', 'module.exports = 1;\n');
    write(r, 'docs/readme.md', '# docs\n');
    commit(r, 'repo');
    collect(r, '2026-07-10');
    const brief = readFile(r, '.nightwatch/MORNING.md');
    const section = brief.split('## Machine notes — nothing to act on')[1];
    assert.ok(!/new top-level directory/.test(section), 'no directory is named');
    assert.ok(!/unclassified/.test(section), 'no drift line emitted');
  },

  'drift: identical inputs → byte-identical drift lines': () => {
    const mk = () => {
      const r = tmpRepo();
      gitInit(r);
      write(r, 'src/a.js', '1\n');
      write(r, 'services/s.js', '2\n');
      write(r, 'workers/w.js', '3\n');
      commit(r, 'repo');
      collect(r, '2026-07-10');
      const brief = readFile(r, '.nightwatch/MORNING.md');
      return brief.split('\n').filter((l) => /new top-level directory/.test(l)).join('\n');
    };
    assert.strictEqual(mk(), mk(), 'drift lines byte-identical across identical repos');
  },

  // ---- Story 12.2 / FR100 — content-class product-by-default (not "unclassified") -------------
  'FR100: content repo — class line, orphan-lockfile notice, product-by-default notice once': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, 'package-lock.json', '{}');  // a lockfile with no package.json → content + orphan notice
    write(r, 'ideas/x.md', '# idea');      // tracked product dir → product by default
    commit(r, 'repo');
    // Night 1: class line + orphan notice + a one-time product-by-default notice; never "unclassified".
    collect(r, '2026-07-10');
    const m1 = readFile(r, '.nightwatch/MORNING.md').split('## Machine notes — nothing to act on')[1];
    assert.match(m1, /Repo class: content \(no import substrate\)/, 'class line rendered');
    assert.match(m1, /`package-lock\.json` present without its manifest/, 'orphan lockfile named');
    assert.match(m1, /new top-level directory `ideas\/` analyzed as product \(default/, 'product-by-default notice');
    assert.ok(!/unclassified/.test(m1), 'the "unclassified" vocabulary does not apply to a content repo');
    // Night 2: ideas/ is in the ledger seen set → the notice does NOT repeat; the class line still shows.
    collect(r, '2026-07-11');
    const m2 = readFile(r, '.nightwatch/MORNING.md').split('## Machine notes — nothing to act on')[1];
    assert.ok(!/`ideas\/` analyzed as product/.test(m2), 'the product-by-default notice fires exactly once');
    assert.match(m2, /Repo class: content/, 'the class line renders every night');
  },
};
