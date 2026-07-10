'use strict';
// Story 6.5 — init dev-tooling classification (FR43). Detection (convention + heuristic) and the
// deterministic config.yaml writer are pure/testable; the interview that confirms them lives in
// commands/nightwatch.md. Also pins the "overnight never reclassifies" guarantee: reclassification
// only happens through init's explicit devTooling write path.
const assert = require('assert');
const { tmpRepo, write, readFile, git, gitInit, commit } = require('./helpers');
const {
  detectDevToolingCandidates, writeDevTooling, runInit,
} = require('../scripts/lib/init');
const { loadConfig } = require('../scripts/lib/config');

/** A fixture repo: product code in src/ + lib/, a convention dir, a heuristic dir, allowlisted dirs. */
function fixture() {
  const root = tmpRepo();
  gitInit(root);
  write(root, 'src/app.js', "const u = require('./util');\nconst x = require('../lib/x');\n");
  write(root, 'src/util.js', 'module.exports = 1;\n');
  write(root, 'lib/x.js', 'module.exports = 2;\n');
  write(root, 'docs/readme.md', '# docs\n');            // allowlisted product content
  write(root, '_bmad/agent.md', '# planning\n');         // shipped convention
  write(root, 'q_a/notes.md', '# qa\n');                 // shipped convention
  write(root, 'agents/prompt.md', '# prompt library\n'); // heuristic: nothing imports it
  commit(root, 'init');
  return root;
}

module.exports = {
  // ---- detection: conventions + heuristics, each tagged --------------------------------------
  'detect: flags shipped conventions and unreferenced dirs, tagged by source': () => {
    const root = fixture();
    const cands = detectDevToolingCandidates(root);
    const byDir = Object.fromEntries(cands.map((c) => [c.dir, c.source]));
    assert.strictEqual(byDir['_bmad'], 'convention', '_bmad flagged as a convention');
    assert.strictEqual(byDir['q_a'], 'convention', 'q_a flagged as a convention');
    assert.strictEqual(byDir['agents'], 'heuristic', 'agents flagged heuristically (no product import)');
    assert.ok(!('lib' in byDir), 'lib is imported by src → not a candidate');
    assert.ok(!('src' in byDir), 'src is product (allowlist + self-referenced) → not a candidate');
    assert.ok(!('docs' in byDir), 'docs is allowlisted product content → not a candidate');
    // deterministic order
    assert.deepStrictEqual(cands.map((c) => c.dir), ['_bmad', 'agents', 'q_a']);
  },

  'detect: is read-only — the working tree is untouched': () => {
    const root = fixture();
    const before = git(root, ['status', '--porcelain']);
    detectDevToolingCandidates(root);
    assert.strictEqual(git(root, ['status', '--porcelain']), before, 'detection wrote nothing');
  },

  // ---- writeDevTooling: a visible, versioned declaration in config.yaml ----------------------
  'write: persists the confirmed set into config.yaml dev_tooling (extends defaults, keeps comments)': () => {
    const root = fixture();
    runInit(root, {}); // instantiate the template config.yaml first
    const before = readFile(root, '.nightwatch/config.yaml');
    assert.ok(/# defaults: _bmad/.test(before), 'template comment present before');

    const res = writeDevTooling(root, ['agents', '_bmad/**']);
    assert.deepStrictEqual(res.dev_tooling, ['_bmad/**', 'agents/**'], 'normalized to globs, sorted');

    const after = readFile(root, '.nightwatch/config.yaml');
    assert.ok(/^dev_tooling: \["_bmad\/\*\*", "agents\/\*\*"\]/m.test(after), 'dev_tooling line rewritten');
    assert.ok(/# defaults: _bmad/.test(after), 'surrounding comment lines preserved');

    // loadConfig sees the confirmed set, extending (not replacing) the shipped defaults.
    const { config } = loadConfig(root);
    assert.ok(config.dev_tooling.includes('agents/**'), 'confirmed heuristic dir is now in scope');
    assert.ok(config.dev_tooling.includes('.claude/**'), 'shipped default still present (extend, not replace)');
  },

  'write: idempotent — re-writing the same confirmed set yields the same file': () => {
    const root = fixture();
    runInit(root, {});
    writeDevTooling(root, ['agents']);
    const first = readFile(root, '.nightwatch/config.yaml');
    writeDevTooling(root, ['agents']);
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), first, 're-write is a no-op');
  },

  // ---- runInit wiring + the "overnight never reclassifies" guarantee -------------------------
  'runInit: writes dev_tooling only when a confirmed set is passed': () => {
    const root = fixture();
    const withSet = runInit(root, { devTooling: ['agents'] });
    assert.ok(withSet.dev_tooling && withSet.dev_tooling.written, 'dev_tooling written when confirmed');
    assert.ok(readFile(root, '.nightwatch/config.yaml').includes('agents/**'));
  },

  'runInit: with no devTooling arg, scope is NOT reclassified (template default kept)': () => {
    const root = fixture();
    const res = runInit(root, {}); // no confirmed set → no reclassification
    assert.strictEqual(res.dev_tooling, null, 'no dev_tooling write reported');
    const cfg = readFile(root, '.nightwatch/config.yaml');
    assert.ok(/^dev_tooling: \[\]/m.test(cfg), 'config.yaml keeps the template default dev_tooling: []');
  },

  'runInit: probeOnly writes nothing at all (dev_tooling null)': () => {
    const root = fixture();
    const before = git(root, ['status', '--porcelain']);
    const res = runInit(root, { probeOnly: true, devTooling: ['agents'] });
    assert.strictEqual(res.dev_tooling, null, 'probeOnly never writes dev_tooling');
    assert.strictEqual(git(root, ['status', '--porcelain']), before, 'probeOnly wrote nothing');
  },
};
