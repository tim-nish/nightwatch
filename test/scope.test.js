'use strict';
// Story 6.1 — two-tier analysis scoping (FR42). Covers the pure resolution semantics
// (extend-not-replace + `!pattern` re-include), the union that every member walk uses, the
// zero-token guarantee (excluded trees never reach walkFiles), and the brief's one-line scope
// statement. Pure-resolution ACs hit scripts/lib/scope.js; the wiring ACs drive loadConfig +
// walkFiles + collect-brief end-to-end on a fixture repo.
const assert = require('assert');
const { tmpRepo, write } = require('./helpers');
const {
  DEFAULT_IGNORE, DEFAULT_DEV_TOOLING, extendGlobs, analysisExcludeGlobs, excludedTopDirs,
} = require('../scripts/lib/scope');
const { walkFiles } = require('../scripts/lib/util');
const { loadConfig } = require('../scripts/lib/config');
const { collect } = require('../scripts/collect-brief');

module.exports = {
  // ---- extend-not-replace + negation --------------------------------------------------------
  'extendGlobs: an absent user list yields the shipped defaults verbatim': () => {
    assert.deepStrictEqual(extendGlobs(DEFAULT_IGNORE, undefined), [...DEFAULT_IGNORE].sort());
    assert.deepStrictEqual(extendGlobs(DEFAULT_DEV_TOOLING, null), [...DEFAULT_DEV_TOOLING].sort());
  },

  'extendGlobs: a user entry EXTENDS the defaults rather than replacing them': () => {
    const out = extendGlobs(DEFAULT_IGNORE, ['tmp/**']);
    // every shipped default survives...
    for (const g of DEFAULT_IGNORE) assert.ok(out.includes(g), `default kept: ${g}`);
    // ...and the user entry is added.
    assert.ok(out.includes('tmp/**'), 'user entry added');
  },

  'extendGlobs: a `!pattern` entry re-includes a default-excluded path with one config entry': () => {
    assert.ok(DEFAULT_DEV_TOOLING.includes('q_a/**'), 'precondition: q_a is a shipped dev-tooling default');
    const out = extendGlobs(DEFAULT_DEV_TOOLING, ['!q_a/**']);
    assert.ok(!out.includes('q_a/**'), 'negation removed the default');
    // other defaults are untouched by the single negation.
    for (const g of DEFAULT_DEV_TOOLING) if (g !== 'q_a/**') assert.ok(out.includes(g), `other default kept: ${g}`);
  },

  'extendGlobs: negation cancels a user positive too, and the result is deduped + sorted': () => {
    const out = extendGlobs(DEFAULT_IGNORE, ['tmp/**', 'tmp/**', '!tmp/**']);
    assert.ok(!out.includes('tmp/**'), 'a later !p cancels an earlier p');
    assert.deepStrictEqual(out, [...new Set(out)].sort(), 'deduped and stably sorted');
  },

  'analysisExcludeGlobs: unions both resolved tiers (deduped, sorted)': () => {
    const combined = analysisExcludeGlobs({ ignore: ['a/**', 'x/**'], dev_tooling: ['b/**', 'x/**'] });
    assert.deepStrictEqual(combined, ['a/**', 'b/**', 'x/**'], 'union with the shared glob deduped');
  },

  // ---- loadConfig resolves both tiers with extend semantics ---------------------------------
  'loadConfig: no config file → both tiers are the shipped defaults': () => {
    const root = tmpRepo();
    const { config } = loadConfig(root);
    assert.deepStrictEqual(config.ignore, [...DEFAULT_IGNORE].sort());
    assert.deepStrictEqual(config.dev_tooling, [...DEFAULT_DEV_TOOLING].sort());
  },

  'loadConfig: config.yaml lists EXTEND defaults; `!pattern` re-includes': () => {
    const root = tmpRepo();
    write(root, '.nightwatch/config.yaml',
      'ignore: ["mydist/**"]\ndev_tooling: ["tools/**", "!q_a/**"]\n');
    const { config } = loadConfig(root);
    // ignore extended, not replaced
    assert.ok(config.ignore.includes('mydist/**'), 'user ignore added');
    assert.ok(config.ignore.includes('node_modules/**'), 'shipped ignore default still present');
    // dev_tooling extended, and q_a re-included via one negation entry
    assert.ok(config.dev_tooling.includes('tools/**'), 'user dev_tooling added');
    assert.ok(config.dev_tooling.includes('_bmad/**'), 'shipped dev_tooling default still present');
    assert.ok(!config.dev_tooling.includes('q_a/**'), '!q_a/** re-included the default-excluded path');
  },

  // ---- zero-token guarantee: excluded trees never reach a member walk -----------------------
  'walk: a fixture repo with _bmad/** and .claude/** yields ZERO analyzed files in those trees': () => {
    const root = tmpRepo();
    write(root, 'src/app.js', 'module.exports = 1;\n');
    write(root, '_bmad/agent.md', '# planning agent\n');
    write(root, '_bmad-output/plan.md', '# plan\n');
    write(root, '.claude/skills/x.md', '# skill\n');
    write(root, 'node_modules/dep/index.js', 'module.exports = 2;\n');
    const { config } = loadConfig(root); // no config file → shipped defaults
    const files = walkFiles(root, analysisExcludeGlobs(config));
    assert.ok(files.includes('src/app.js'), 'product file analyzed');
    for (const excluded of files.filter((f) =>
      /^(_bmad|_bmad-output|\.claude|node_modules)\//.test(f))) {
      assert.fail(`dev-tooling/ignored path reached the walk: ${excluded}`);
    }
  },

  'excludedTopDirs: names the excluded top-level trees actually present, sorted': () => {
    const root = tmpRepo();
    write(root, 'src/app.js', 'x\n');
    write(root, '_bmad/a.md', 'x\n');
    write(root, '.claude/c.md', 'x\n');
    write(root, 'node_modules/d/i.js', 'x\n');
    const { config } = loadConfig(root);
    const dirs = excludedTopDirs(root, config);
    assert.deepStrictEqual(dirs, ['.claude', '_bmad', 'node_modules'].sort());
    assert.ok(!dirs.includes('src'), 'product dir not listed as excluded');
  },

  // ---- brief carries the one-line scope statement -------------------------------------------
  'brief: carries a single scope line naming the excluded trees (FR42)': () => {
    const root = tmpRepo();
    write(root, 'src/app.js', 'x\n');
    write(root, '_bmad/a.md', 'x\n');
    write(root, '.claude/c.md', 'x\n');
    collect(root, '2026-07-10');
    const brief = require('fs').readFileSync(root + '/.nightwatch/MORNING.md', 'utf8');
    const scopeLines = brief.split('\n').filter((l) => l.startsWith('Scope:'));
    assert.strictEqual(scopeLines.length, 1, 'exactly one scope line');
    assert.ok(/\.claude/.test(scopeLines[0]) && /_bmad/.test(scopeLines[0]), 'names the excluded trees');
    assert.ok(/config\.yaml/.test(scopeLines[0]), 'points at the config knob');
  },
};
