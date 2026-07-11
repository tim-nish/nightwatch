'use strict';
// Story 12.4 / FR102 — classification interview honesty. The interview rendering is agent-driven
// (commands/nightwatch.md); these ACs pin the deterministic core: candidate pre-selection follows
// finding 0035 (a weak signal never pre-excludes product), every candidate carries an analysis-scope
// description, and the human's checked-state translates into visible, versioned declarations —
// a decline is never a placebo. A re-run then proposes nothing new for a recorded decline.
const assert = require('assert');
const { tmpRepo, write, gitInit, commit } = require('./helpers');
const {
  detectDevToolingCandidates, resolveDevToolingWrites, writeDevTooling, runInit, planUpdate,
} = require('../scripts/lib/init');

/** A code-class repo: a product package, a non-dot heuristic dir, dot-prefixed heuristics, a convention. */
function fixture0035() {
  const root = tmpRepo();
  gitInit(root);
  write(root, 'pyproject.toml', '[project]\nname = "demo"\nversion = "0.1.0"\n'); // substrate → code-class
  write(root, 'demo/__init__.py', 'x = 1\n');            // product package
  write(root, 'spaces/a.md', '# a space');               // NON-dot heuristic, unreferenced
  write(root, '.github/workflows/ci.yml', 'name: ci\n'); // dot-prefixed heuristic
  write(root, '.devcontainer/devcontainer.json', '{}\n');// dot-prefixed heuristic
  write(root, '_bmad/agent.md', '# planning\n');         // shipped convention
  commit(root, 'init');
  return root;
}

module.exports = {
  // AC1 + AC2 (finding 0035): pre-selection honesty + analysis-scope descriptions.
  'classify: non-dot heuristic unchecked, dot heuristics + conventions pre-checked (FR102, finding 0035)': () => {
    const root = fixture0035();
    const by = Object.fromEntries(detectDevToolingCandidates(root).map((c) => [c.dir, c]));

    // A non-dot heuristic beside a product package stays product (unchecked) — a weak signal never
    // pre-excludes product.
    assert.strictEqual(by['spaces'].source, 'heuristic');
    assert.strictEqual(by['spaces'].dot, false);
    assert.strictEqual(by['spaces'].checked, false, 'non-dot heuristic arrives unchecked');
    assert.match(by['spaces'].description, /analyzed as product/, 'described in analysis-scope terms');

    // Dot-prefixed heuristics arrive pre-checked (near-certain tooling).
    assert.strictEqual(by['.github'].source, 'heuristic');
    assert.strictEqual(by['.github'].checked, true, '.github pre-checked');
    assert.strictEqual(by['.devcontainer'].checked, true, '.devcontainer pre-checked');
    assert.match(by['.github'].description, /excluded from analysis/, 'excluded entry described in scope terms');

    // Convention matches stay pre-checked.
    assert.strictEqual(by['_bmad'].source, 'convention');
    assert.strictEqual(by['_bmad'].checked, true, 'convention pre-checked');
  },

  // AC3: the checked-state translates into declarations — a decline writes its negation.
  'classify: unchecking a pre-checked default writes its `!glob`; a checked heuristic writes its exclusion (FR102)': () => {
    const cands = [
      { dir: '.claude', glob: '.claude/**', source: 'convention', checked: true },
      { dir: '.github', glob: '.github/**', source: 'heuristic', checked: true },
      { dir: 'agents', glob: 'agents/**', source: 'heuristic', checked: false },
    ];
    // Human declines .claude (unchecks the pre-checked convention), keeps .github checked, and
    // additionally excludes the non-dot heuristic `agents`.
    assert.deepStrictEqual(
      resolveDevToolingWrites(cands, ['.github', 'agents']),
      ['!.claude/**', '.github/**', 'agents/**'],
      'declined default → !glob; checked entries → their exclusion globs',
    );
    // Common path: leave everything at its pre-selection → only the pre-checked heuristic writes an
    // explicit exclusion; the convention is a shipped default (nothing) and the non-dot heuristic
    // stays product (nothing).
    assert.deepStrictEqual(
      resolveDevToolingWrites(cands, ['.claude', '.github']),
      ['.github/**'],
      'a still-checked convention and a still-unchecked non-dot heuristic write nothing',
    );
  },

  // AC3: a decline is durable — a re-run proposes nothing new for it.
  'classify: a declined convention (`!_bmad/**`) is not re-proposed on a later update (FR102)': () => {
    const root = fixture0035();
    runInit(root, {}); // instantiate config.yaml
    // The human declined the _bmad convention → its re-include is written as a declaration.
    writeDevTooling(root, ['!_bmad/**']);
    const ids = planUpdate(root).proposals.map((p) => p.id);
    assert.ok(!ids.includes('dev_tooling:_bmad'), '_bmad is not re-proposed as dev_tooling after a decline');
    assert.ok(!ids.includes('module:_bmad'), '_bmad is not re-proposed as an unclassified module either');
  },

  // AC4 + FR100: a content-class repo proposes only conventions, never a content dir as tooling.
  'classify: content-class repo shows only conventions, all pre-checked (FR102, FR100)': () => {
    const root = tmpRepo();
    gitInit(root);                                  // NO manifest → content-class
    write(root, 'ideas/x.md', '# idea');            // content product
    write(root, '_bmad/agent.md', '# planning');    // shipped convention
    write(root, 'spaces/a.md', '# would be a heuristic in a code repo');
    commit(root, 'init');
    const cands = detectDevToolingCandidates(root);
    assert.ok(cands.every((c) => c.source === 'convention'), 'only conventions in a content-class repo');
    assert.ok(cands.every((c) => c.checked === true), 'conventions are pre-checked');
    assert.ok(!cands.some((c) => c.dir === 'ideas' || c.dir === 'spaces'), 'content dirs are never proposed as tooling');
  },
};
