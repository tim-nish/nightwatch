'use strict';
// Story 6.1 — two-tier analysis scoping (FR42). Covers the pure resolution semantics
// (extend-not-replace + `!pattern` re-include), the union that every member walk uses, the
// zero-token guarantee (excluded trees never reach walkFiles), and the brief's one-line scope
// statement. Pure-resolution ACs hit scripts/lib/scope.js; the wiring ACs drive loadConfig +
// walkFiles + collect-brief end-to-end on a fixture repo.
const assert = require('assert');
const { tmpRepo, write } = require('./helpers');
const {
  DEFAULT_IGNORE, DEFAULT_DEV_TOOLING, extendGlobs, analysisExcludeGlobs, excludedTopDirs, scopePreview,
  detectRepoClass, productByDefaultDirs, unclassifiedTopDirs,
} = require('../scripts/lib/scope');
const { walkFiles, makeIgnore } = require('../scripts/lib/util');
const { loadConfig } = require('../scripts/lib/config');
const { collect } = require('../scripts/collect-brief');

module.exports = {
  // ---- Story 12.2 / FR100 — substrate probe & product-by-default ----------------------------

  'detectRepoClass: a manifest → code; no manifest → content; orphan lockfile flagged (FR100)': () => {
    const code = tmpRepo(); write(code, 'pyproject.toml', '[project]\n'); write(code, 'src/a.py', 'x');
    assert.deepStrictEqual(detectRepoClass(code), { klass: 'code', substrate: true, orphanLockfiles: [] });

    const content = tmpRepo(); write(content, 'ideas/x.md', '# idea');
    assert.strictEqual(detectRepoClass(content).klass, 'content', 'no manifest → content');

    const orphan = tmpRepo(); write(orphan, 'package-lock.json', '{}'); write(orphan, 'q_a/x.md', '# q');
    const rc = detectRepoClass(orphan);
    assert.strictEqual(rc.klass, 'content', 'a lockfile without package.json is not a substrate');
    assert.deepStrictEqual(rc.orphanLockfiles, ['package-lock.json'], 'the orphan is named');
  },

  'unclassifiedTopDirs: content-class returns [] (product-by-default, no "unclassified" nag) (FR100)': () => {
    assert.deepStrictEqual(unclassifiedTopDirs('/x', loadConfig(tmpRepo()).config, { trackedTop: ['ideas', 'lessons'], klass: 'content' }), []);
  },

  'unclassifiedTopDirs: code-class classifies a dir named by a confirmed re-include (FR100)': () => {
    const cfg = { ...loadConfig(tmpRepo()).config, dev_tooling: [...DEFAULT_DEV_TOOLING, '!spaces/**'] };
    const dirs = unclassifiedTopDirs('/x', cfg, { trackedTop: ['spaces', 'services'], klass: 'code' });
    assert.deepStrictEqual(dirs, ['services'], 'spaces/ is classified by its !spaces/** re-include; services/ is not');
  },

  'productByDefaultDirs: content-class lists analyzed non-allowlisted tracked dirs; empty for code (FR100)': () => {
    const cfg = loadConfig(tmpRepo()).config;
    assert.deepStrictEqual(productByDefaultDirs('/x', cfg, { klass: 'content', trackedTop: ['ideas', 'src', '_bmad'] }), ['ideas'],
      'ideas is product-by-default; src is allowlisted; _bmad is convention-excluded');
    assert.deepStrictEqual(productByDefaultDirs('/x', cfg, { klass: 'code', trackedTop: ['ideas'] }), [], 'code-class → no product-by-default list');
  },

  'scopePreview: states the repo class (FR100)': () => {
    const r = tmpRepo(); write(r, 'ideas/x.md', '# idea');
    const p = scopePreview(r, loadConfig(r).config);
    assert.strictEqual(p.repo_class, 'content');
    assert.strictEqual(p.substrate, false);
  },

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
    assert.ok(DEFAULT_DEV_TOOLING.includes('_bmad/**'), 'precondition: _bmad is a shipped dev-tooling default');
    const out = extendGlobs(DEFAULT_DEV_TOOLING, ['!_bmad/**']);
    assert.ok(!out.includes('_bmad/**'), 'exact negation removed the default');
    // other defaults are untouched by the single negation.
    for (const g of DEFAULT_DEV_TOOLING) if (g !== '_bmad/**') assert.ok(out.includes(g), `other default kept: ${g}`);
  },

  'extendGlobs: negation cancels a user positive too, and the result is deduped + sorted': () => {
    const out = extendGlobs(DEFAULT_IGNORE, ['tmp/**', 'tmp/**', '!tmp/**']);
    assert.ok(!out.includes('tmp/**'), 'a later !p cancels an earlier p');
    assert.deepStrictEqual(out, [...new Set(out)].sort(), 'deduped and stably sorted');
  },

  // ---- Story 12.3 / FR101 — shipped-default hygiene -----------------------------------------

  'defaults: q_a/** is NOT shipped dev-tooling; .claude/** ships a !.claude/commands/** re-include (FR101)': () => {
    assert.ok(!DEFAULT_DEV_TOOLING.includes('q_a/**'), 'q_a/** removed — not a universal convention');
    assert.ok(DEFAULT_DEV_TOOLING.includes('.claude/**'), '.claude/** still excluded by default');
    assert.ok(DEFAULT_DEV_TOOLING.includes('!.claude/commands/**'), 'agent commands re-included by a shipped default');
  },

  'defaults: with defaults only, q_a and .claude/commands are analyzed; the rest of .claude/_bmad excluded (FR101)': () => {
    // The product-lab regression shape: a content repo whose product is q_a + agent commands.
    const r = tmpRepo();
    write(r, 'q_a/2026/q.md', '# question');
    write(r, '.claude/commands/ask.md', '# /ask');
    write(r, '.claude/settings.json', '{}');
    write(r, '.claude/skills/x/SKILL.md', '# skill');
    write(r, '_bmad/agent.md', '# agent');
    const { config } = loadConfig(r); // defaults only, no config file
    const isExcluded = makeIgnore(analysisExcludeGlobs(config));
    assert.strictEqual(isExcluded('q_a/2026/q.md'), false, 'q_a is product now (not a shipped default)');
    assert.strictEqual(isExcluded('.claude/commands/ask.md'), false, 'agent commands analyzed via the shipped re-include');
    assert.strictEqual(isExcluded('.claude/settings.json'), true, 'the rest of .claude/** stays excluded');
    assert.strictEqual(isExcluded('.claude/skills/x/SKILL.md'), true, 'downloaded skills stay excluded');
    assert.strictEqual(isExcluded('_bmad/agent.md'), true, '_bmad/** stays excluded');
  },

  // ---- Story 12.1 / FR99 — match-based negation: subpath re-includes ------------------------

  'extendGlobs: a subpath negation with no exact positive is kept as a `!` entry (FR99)': () => {
    const out = extendGlobs(DEFAULT_DEV_TOOLING, ['!.claude/commands/**']);
    assert.ok(out.includes('.claude/**'), 'the broader parent stays excluded');
    assert.ok(out.includes('!.claude/commands/**'), 'the subpath re-include is preserved for the matcher');
  },

  'makeIgnore: `!.claude/commands/**` re-includes that subtree under an excluded `.claude/**` (FR99)': () => {
    const isExcluded = makeIgnore(extendGlobs(DEFAULT_DEV_TOOLING, ['!.claude/commands/**']));
    assert.strictEqual(isExcluded('.claude/settings.json'), true, 'the rest of .claude/** stays excluded');
    assert.strictEqual(isExcluded('.claude/commands/ask.md'), false, 'the re-included subtree is analyzed (most specific wins)');
    assert.strictEqual(isExcluded('.claude/commands/skills/x.md'), false, 're-include is inherited down the subtree');
  },

  'makeIgnore: an exact `!q_a/**` re-include resolves byte-identically to today (FR99, NFR8)': () => {
    const isExcluded = makeIgnore(extendGlobs(DEFAULT_DEV_TOOLING, ['!q_a/**']));
    assert.strictEqual(isExcluded('q_a/2026/q.md'), false, 'q_a re-included by the exact cancel');
    assert.strictEqual(isExcluded('_bmad/x.md'), true, 'other defaults still excluded');
  },

  'scopePreview: a re-included subpath appears under analyzed with its own count (FR99)': () => {
    const r = tmpRepo();
    write(r, '.claude/settings.json', '{}');
    write(r, '.claude/commands/ask.md', '# ask');
    write(r, '.claude/commands/triage.md', '# triage');
    write(r, 'src/app.js', '1');
    const cfg = { ignore: [], dev_tooling: extendGlobs(DEFAULT_DEV_TOOLING, ['!.claude/commands/**']) };
    const preview = scopePreview(r, cfg);
    const analyzed = Object.fromEntries(preview.analyzed.map((x) => [x.dir, x.files]));
    const excluded = Object.fromEntries(preview.excluded.map((x) => [x.dir, x.files]));
    assert.strictEqual(analyzed['.claude'], 2, 'the two command files are analyzed under .claude');
    assert.strictEqual(excluded['.claude'], 1, 'the rest of .claude (settings.json) stays excluded');
    assert.strictEqual(analyzed['src'], 1, 'ordinary product is analyzed');
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
    const scopeLines = brief.split('\n').filter((l) => /Scope: excluded/.test(l));
    assert.strictEqual(scopeLines.length, 1, 'exactly one scope line');
    assert.ok(/\.claude/.test(scopeLines[0]) && /_bmad/.test(scopeLines[0]), 'names the excluded trees');
    assert.ok(/config\.yaml/.test(scopeLines[0]), 'points at the config knob');
  },
};
