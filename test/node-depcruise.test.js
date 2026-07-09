'use strict';
// Story 5.3 — node-depcruise adapter. The deterministic core (layers -> dependency-cruiser
// ruleset compilation) is golden-file tested. dependency-cruiser is NOT installed in this
// environment, so run()'s tool-invocation path cannot be integration-tested; instead we unit-test
// detect(), available() (false here), the golden compile, host-config selection logic, the
// "not configured" short-circuit, and the native-output -> signals parser with a synthetic result.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write } = require('./helpers');
const adapter = require('../scripts/extractors/node-depcruise');
const { KINDS, CONFIDENCE } = require('../scripts/lib/signals');

const GOLDEN = path.join(__dirname, 'fixtures', 'depcruise-ruleset.golden.json');

// The exact sample the golden fixture was frozen from. If compileRuleset's output changes, the
// golden comparison below fails — which is the whole point of a golden test.
const SAMPLE_LAYERS = [
  { name: 'ui', path: 'src/ui/**', may_depend_on: ['shared'] },
  { name: 'core', path: 'src/core/**', may_depend_on: ['shared'] },
  { name: 'shared', path: 'src/shared/**', may_depend_on: [] },
];

module.exports = {
  'node-depcruise: exports the full four-function adapter contract': () => {
    for (const fn of ['detect', 'available', 'run', 'explain']) {
      assert.strictEqual(typeof adapter[fn], 'function', `exports ${fn}()`);
    }
  },

  'node-depcruise: detect() is true iff package.json present at the repo root': () => {
    const r = tmpRepo();
    assert.strictEqual(adapter.detect(r), false, 'no package.json -> not applicable');
    write(r, 'package.json', '{"name":"x"}');
    assert.strictEqual(adapter.detect(r), true, 'package.json -> applicable');
  },

  'node-depcruise: available() is false when the tool is not installed locally (no network)': () => {
    const r = tmpRepo();
    write(r, 'package.json', '{"name":"x"}');
    // No node_modules/.bin/depcruise and (in CI) no PATH depcruise -> must be false, never fetched.
    assert.strictEqual(adapter.available(r), false);
  },

  'node-depcruise: available() resolves the LOCAL node_modules/.bin binary first': () => {
    const r = tmpRepo();
    write(r, 'node_modules/.bin/depcruise', '#!/bin/sh\n');
    fs.chmodSync(path.join(r, 'node_modules', '.bin', 'depcruise'), 0o755);
    assert.strictEqual(adapter.available(r), true, 'local .bin resolves');
    assert.strictEqual(adapter.resolveBin(r), path.join(r, 'node_modules', '.bin', 'depcruise'));
  },

  'node-depcruise: compileRuleset(sampleLayers) matches the golden ruleset (FR15)': () => {
    const produced = adapter.compileRuleset(SAMPLE_LAYERS);
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    assert.deepStrictEqual(produced, golden, 'compiled ruleset deep-equals the golden fixture');
    // Byte-for-byte too: the transient file the adapter writes must equal the checked-in golden.
    assert.strictEqual(
      JSON.stringify(produced, null, 2) + '\n',
      fs.readFileSync(GOLDEN, 'utf8'),
      'serialized ruleset is byte-identical to the golden fixture',
    );
  },

  'node-depcruise: compileRuleset is deterministic and independent of input layer order': () => {
    const a = adapter.compileRuleset(SAMPLE_LAYERS);
    const b = adapter.compileRuleset([...SAMPLE_LAYERS].reverse());
    assert.deepStrictEqual(a, b, 'layer input order does not change the compiled ruleset');
    // Every layer's forbidden targets are exactly the layers not in {itself} ∪ may_depend_on.
    assert.ok(a.forbidden.some((rl) => rl.name === 'layer-ui-not-to-core'), 'ui ↛ core enforced');
    assert.ok(!a.forbidden.some((rl) => rl.name === 'layer-ui-not-to-shared'), 'ui -> shared allowed');
    assert.ok(a.forbidden.some((rl) => rl.name === 'no-circular'), 'cycle rule always present');
    assert.ok(a.forbidden.some((rl) => rl.name === 'no-orphans'), 'orphan rule always present');
  },

  'node-depcruise: selectConfigSource prefers a host .dependency-cruiser config verbatim (FR15)': () => {
    const r = tmpRepo();
    write(r, '.dependency-cruiser.cjs', 'module.exports = { forbidden: [] };\n');
    const sel = adapter.selectConfigSource(r, SAMPLE_LAYERS);
    assert.strictEqual(sel.mode, 'host', 'host config wins even when layers are declared');
    assert.strictEqual(sel.hostConfig, path.join(r, '.dependency-cruiser.cjs'));
    assert.strictEqual(adapter.findHostConfig(r), path.join(r, '.dependency-cruiser.cjs'));
  },

  'node-depcruise: selectConfigSource compiles from layers when there is no host config': () => {
    const r = tmpRepo();
    const sel = adapter.selectConfigSource(r, SAMPLE_LAYERS);
    assert.strictEqual(sel.mode, 'compiled');
    assert.strictEqual(sel.hostConfig, null);
  },

  'node-depcruise: selectConfigSource is not-configured with no layers and no host config': () => {
    const r = tmpRepo();
    assert.strictEqual(adapter.selectConfigSource(r, []).mode, 'not-configured');
    assert.strictEqual(adapter.selectConfigSource(r, undefined).mode, 'not-configured');
    // Layers missing name/path do not count as configured.
    assert.strictEqual(adapter.selectConfigSource(r, [{ name: 'x' }]).mode, 'not-configured');
  },

  'node-depcruise: run() with no layers and no host config contributes nothing + a notice': () => {
    const r = tmpRepo();
    write(r, 'package.json', '{"name":"x"}');
    const res = adapter.run(r, { layers: [] });
    assert.deepStrictEqual(res.signals, [], 'no signals when not configured');
    assert.strictEqual(res.tool, undefined, 'no tool source when nothing ran');
    assert.strictEqual(res.mode, 'not-configured');
    assert.ok(res.degraded.some((d) => /not configured/.test(d)), 'emits a not-configured notice');
  },

  'node-depcruise: violationsToSignals maps native output to exact signals with both pointers': () => {
    // A synthetic `depcruise --output-type json` result covering all three violation kinds.
    const cruise = {
      summary: {
        violations: [
          { type: 'dependency', from: 'src/ui/table.js', to: 'src/core/db.js', rule: { name: 'layer-ui-not-to-core', severity: 'error' } },
          { type: 'cycle', from: 'src/a.js', to: 'src/b.js', rule: { name: 'no-circular', severity: 'error' }, cycle: ['src/b.js', 'src/a.js'] },
          { type: 'orphan', from: 'src/lonely.js', to: 'src/lonely.js', rule: { name: 'no-orphans', severity: 'warn' } },
        ],
      },
    };
    const signals = adapter.violationsToSignals(cruise);
    assert.ok(signals.every((s) => s.confidence === 'exact'), 'every signal is exact (analyzer-proved)');
    assert.ok(signals.every((s) => s.source === 'node-depcruise'), 'source is the adapter id');
    assert.ok(signals.every((s) => KINDS.includes(s.kind) && CONFIDENCE.includes(s.confidence)), 'schema-valid');

    const lv = signals.find((s) => s.kind === 'layering-violation');
    assert.ok(lv, 'layering-violation emitted');
    assert.deepStrictEqual(lv.evidence.map((e) => e.path), ['src/ui/table.js', 'src/core/db.js'], 'both file pointers');

    const cyc = signals.find((s) => s.kind === 'cycle');
    assert.ok(cyc && cyc.evidence.length >= 2, 'cycle carries the loop members');

    const orph = signals.find((s) => s.kind === 'orphan');
    assert.ok(orph && orph.evidence[0].path === 'src/lonely.js', 'orphan points at the module');
  },

  'node-depcruise: explain() gives id, tool, install hint, and a degraded-notice summary': () => {
    const info = adapter.explain();
    assert.strictEqual(info.name, 'node-depcruise');
    assert.strictEqual(info.tool, 'dependency-cruiser');
    assert.strictEqual(info.install, 'npm i -D dependency-cruiser');
    assert.ok(/dependency-cruiser not installed/.test(info.summary), 'summary usable as a degraded note');
  },
};
