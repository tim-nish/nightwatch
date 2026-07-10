'use strict';
// Story 7.4 — /nightwatch init --update: non-destructive reconfigure (FR52). The interview
// confirms each proposed diff; these ACs pin the deterministic detection and the byte-preserving,
// confirmed-only apply:
//   - planUpdate re-runs detection and proposes only what changed (new dev-tooling dirs, new
//     unclassified modules); a repo unchanged since init proposes nothing (idempotent);
//   - applyUpdate applies ONLY confirmed proposals, unioning dev-tooling with the current set and
//     byte-preserving the rest of the file; declined proposals write nothing;
//   - both the dev_tooling and declaration-field write paths flow through the one apply gate.
const assert = require('assert');
const { tmpRepo, write, readFile, git, gitInit, commit } = require('./helpers');
const {
  runInit, planUpdate, applyUpdate, setDeclarationField, currentUserDevTooling,
} = require('../scripts/lib/init');

/** A configured repo: init has run (declarations + nested gitignore under .nightwatch/). */
function configuredRepo() {
  const root = tmpRepo();
  gitInit(root);
  write(root, 'src/app.js', 'module.exports = 1;\n');
  commit(root, 'init repo');
  runInit(root, { adapters: [] });
  git(root, ['add', '-A']); // stage init output so trackedTopDirs sees the repo
  return root;
}

module.exports = {
  'update: a repo unchanged since init proposes nothing (idempotent)': () => {
    const root = configuredRepo();
    commit(root, 'configured');
    assert.deepStrictEqual(planUpdate(root).proposals, [], 'no drift → no proposals');
  },

  'update: proposes new unclassified top-level directories': () => {
    const root = configuredRepo();
    write(root, 'agents/agent.md', '# an agent workspace\n');
    write(root, 'services/svc.js', 'module.exports = 2;\n');
    commit(root, 'add agents/ and services/');

    const ids = planUpdate(root).proposals.map((p) => p.dir).sort();
    assert.ok(ids.includes('agents'), 'agents/ surfaced');
    assert.ok(ids.includes('services'), 'services/ surfaced');
    assert.ok(!ids.includes('src'), 'a product-allowlist dir is never proposed');
  },

  'update: applies only confirmed dev-tooling, byte-preserving the rest of config.yaml': () => {
    const root = configuredRepo();
    write(root, 'agents/a.md', 'x\n');
    write(root, 'vendored/v.js', 'y\n');
    commit(root, 'two new dirs');
    const before = readFile(root, '.nightwatch/config.yaml');

    // Confirm only `agents`, skip `vendored`.
    const res = applyUpdate(root, { devTooling: ['agents'] });
    assert.deepStrictEqual(res.dev_tooling.dev_tooling, ['agents/**'], 'only the confirmed glob written');
    assert.deepStrictEqual(currentUserDevTooling(root), ['agents/**'], 'config carries only the confirmed add');

    // The rest of config.yaml (every non-dev_tooling line) is byte-identical.
    const after = readFile(root, '.nightwatch/config.yaml');
    const strip = (t) => t.split('\n').filter((l) => !/^dev_tooling\s*:/.test(l)).join('\n');
    assert.strictEqual(strip(after), strip(before), 'non-dev_tooling lines byte-preserved');

    // The skipped dir is still proposed; the confirmed one no longer is (now covered).
    const dirs = planUpdate(root).proposals.map((p) => p.dir);
    assert.ok(dirs.includes('vendored'), 'skipped dir still proposed');
    assert.ok(!dirs.includes('agents'), 'confirmed dir no longer proposed');
  },

  'update: re-applying the same confirmed set is idempotent (byte-identical)': () => {
    const root = configuredRepo();
    write(root, 'agents/a.md', 'x\n');
    commit(root, 'new dir');
    applyUpdate(root, { devTooling: ['agents'] });
    const once = readFile(root, '.nightwatch/config.yaml');
    applyUpdate(root, { devTooling: ['agents'] });
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), once, 'second apply changes nothing');
  },

  'update: declining every proposal writes nothing': () => {
    const root = configuredRepo();
    write(root, 'agents/a.md', 'x\n');
    commit(root, 'new dir');
    const before = readFile(root, '.nightwatch/config.yaml');
    const res = applyUpdate(root, {}); // nothing confirmed
    assert.strictEqual(res.dev_tooling, null, 'no dev_tooling write');
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), before, 'config.yaml untouched');
  },

  // Unified gate: a confirmed declaration-FIELD edit flows through the same apply path and
  // byte-preserves the rest of the file.
  'update: a confirmed STATE.md field edit is byte-preserving (unified gate)': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, '.nightwatch/STATE.md', '# state\nprose line\n```yaml\nphase: prototype\nnote: keep me\n```\ntrailing prose\n');
    const res = applyUpdate(root, { fields: [{ file: '.nightwatch/STATE.md', key: 'phase', value: 'hardening' }] });
    assert.strictEqual(res.fields[0].result.changed, true);
    const out = readFile(root, '.nightwatch/STATE.md');
    assert.ok(/^phase: hardening$/m.test(out), 'phase updated');
    assert.ok(out.includes('note: keep me') && out.includes('prose line') && out.includes('trailing prose'), 'every other line preserved');
  },

  'update: setDeclarationField only rewrites an existing key (never invents one)': () => {
    const root = tmpRepo();
    write(root, '.nightwatch/config.yaml', 'timeout_minutes: 30\n');
    const miss = setDeclarationField(root, '.nightwatch/config.yaml', 'phase', 'x');
    assert.strictEqual(miss.changed, false, 'absent key is not added');
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), 'timeout_minutes: 30\n', 'file untouched');
    const hit = setDeclarationField(root, '.nightwatch/config.yaml', 'timeout_minutes', '45');
    assert.strictEqual(hit.changed, true);
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), 'timeout_minutes: 45\n');
  },
};
