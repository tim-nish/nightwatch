'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write } = require('./helpers');
const adapter = require('../scripts/extractors/python-importlinter');
const { KINDS, CONFIDENCE } = require('../scripts/lib/signals');

// The layer declaration the golden contract is compiled from. A three-tier stack where the
// allow-lists (may_depend_on) form a chain ui -> core -> data.
const sampleLayers = [
  { name: 'ui', path: 'src/ui/**', may_depend_on: ['core'] },
  { name: 'core', path: 'src/core/**', may_depend_on: ['data'] },
  { name: 'data', path: 'src/data/**', may_depend_on: [] },
];

module.exports = {
  'python-importlinter: is a conforming adapter (four-function contract)': () => {
    for (const fn of ['detect', 'available', 'run', 'explain']) {
      assert.strictEqual(typeof adapter[fn], 'function', `missing ${fn}()`);
    }
  },

  'python-importlinter: detect() true when a Python manifest is present, false otherwise': () => {
    const r = tmpRepo();
    assert.strictEqual(adapter.detect(r), false, 'empty repo does not apply');
    write(r, 'requirements.txt', 'requests\n');
    assert.strictEqual(adapter.detect(r), true, 'requirements.txt applies');

    const r2 = tmpRepo();
    write(r2, 'pyproject.toml', '[project]\nname="x"\n');
    assert.strictEqual(adapter.detect(r2), true, 'pyproject.toml applies');

    const r3 = tmpRepo();
    write(r3, 'setup.py', 'from setuptools import setup\n');
    assert.strictEqual(adapter.detect(r3), true, 'setup.py applies');
  },

  'python-importlinter: available() is false here — import-linter is not installed (FR10)': () => {
    const r = tmpRepo();
    write(r, 'pyproject.toml', '[project]\nname="x"\n');
    // No .venv/venv lint-imports and (assumed) none on PATH in CI: local-only resolution fails.
    assert.strictEqual(adapter.available(r), false);
    assert.strictEqual(adapter.resolveBin(r), null);
  },

  'python-importlinter: tool-absent degrade contract — explain() carries the pip install hint': () => {
    const info = adapter.explain();
    assert.strictEqual(info.name, 'python-importlinter');
    assert.strictEqual(info.tool, 'import-linter');
    assert.strictEqual(info.install, 'pip install import-linter');
    assert.ok(/import-linter not installed/.test(info.summary), 'summary explains the degrade');
    assert.ok(/universal git signals used/.test(info.summary), 'summary names the fallback');
  },

  'python-importlinter: compileContracts(sampleLayers) matches the golden file (FR15)': () => {
    const golden = fs.readFileSync(path.join(__dirname, 'fixtures', 'importlinter-contracts.golden.ini'), 'utf8');
    const compiled = adapter.compileContracts(sampleLayers);
    assert.strictEqual(compiled, golden, 'compiled import-linter contracts must equal the golden file');
  },

  'python-importlinter: compilation is deterministic and order-independent': () => {
    const shuffled = [sampleLayers[2], sampleLayers[0], sampleLayers[1]];
    assert.strictEqual(adapter.compileContracts(shuffled), adapter.compileContracts(sampleLayers));
  },

  'python-importlinter: no layers → a valid empty import-linter config (no contracts)': () => {
    const out = adapter.compileContracts([]);
    assert.ok(out.startsWith('[importlinter]'), 'still emits the root section');
    assert.ok(!/contract:/.test(out), 'no contracts without declared layers');
  },

  'python-importlinter: parseViolations() maps import-linter output to violation records (run() unit path)': () => {
    // run()'s tool-invocation path is unit-tested only (import-linter absent in CI). This exercises
    // the pure output parser that feeds the layering-violation signals.
    const output = [
      'Broken contracts',
      '----------------',
      '',
      'core may not import ui',
      '',
      '- src.core.service -> src.ui.widget (l.5)',
      '- src.core.db -> src.ui.table (l.12)',
    ].join('\n');
    const records = adapter.parseViolations(output);
    assert.strictEqual(records.length, 2);
    assert.deepStrictEqual(records[0], { from: 'src.core.service', to: 'src.ui.widget', line: 5 });
    // The same records must produce schema-valid layering-violation signals.
    const { makeSignal } = require('../scripts/lib/signals');
    const sig = makeSignal({
      kind: 'layering-violation', confidence: 'exact', source: 'python-importlinter',
      detail: `${records[0].from} → ${records[0].to} import violates declared layer rule`,
      evidence: [{ path: 'src/core/service.py', line: 5 }, { path: 'src/ui/widget.py' }],
    });
    assert.ok(KINDS.includes(sig.kind) && CONFIDENCE.includes(sig.confidence));
    assert.strictEqual(sig.evidence.length, 2, 'both file pointers present');
  },
};
