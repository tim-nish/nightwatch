'use strict';
const assert = require('assert');
const { tmpRepo, write } = require('./helpers');
const { archSignals } = require('../scripts/arch-signals');

module.exports = {
  'arch: interface with ≤1 implementer flagged; ≥2 implementers not': () => {
    const r = tmpRepo();
    write(r, 'core/a.ts', 'export interface Lonely {}\nexport interface Empty {}\ninterface Popular {}');
    write(r, 'core/b.ts', 'class C implements Lonely {}');
    write(r, 'core/c.ts', 'class D implements Popular {}\nclass E implements Popular {}');
    const sig = archSignals(r);
    const names = sig.speculation.map((s) => s.name);
    assert.ok(names.includes('Lonely'), 'one-implementer interface is a candidate');
    assert.ok(names.includes('Empty'), 'zero-implementer interface is a candidate');
    assert.ok(!names.includes('Popular'), 'two-implementer interface is not flagged');
  },

  'arch: same function name across modules → duplication': () => {
    const r = tmpRepo();
    write(r, 'core/x.js', 'function processData() {}');
    write(r, 'api/y.js', 'function processData() {}');
    const sig = archSignals(r);
    const dup = sig.duplication.find((d) => d.name === 'processData');
    assert.ok(dup, 'reports the cross-module duplicate');
    assert.deepStrictEqual(dup.modules.sort(), ['api', 'core']);
  },

  'arch: declared layering violated by one import → finding with both pointers': () => {
    const r = tmpRepo();
    write(r, '.nightwatch/config.yaml',
      'layers:\n  - {name: core, path: "core/**", may_depend_on: []}\n  - {name: api, path: "api/**", may_depend_on: [core]}\n');
    write(r, 'core/a.js', "const b = require('../api/b');");
    write(r, 'api/b.js', 'module.exports = {};');
    const sig = archSignals(r);
    assert.ok(sig.layering_configured);
    const v = sig.layering.find((l) => l.from_layer === 'core' && l.to_layer === 'api');
    assert.ok(v, 'core→api violation reported');
    const paths = v.evidence.map((e) => e.path);
    assert.ok(paths.includes('core/a.js') && paths.some((p) => /api\/b/.test(p)), 'both file pointers present');
  },

  'arch: no layers declared → no layering findings, not-configured notice': () => {
    const r = tmpRepo();
    write(r, 'core/a.js', "const b = require('../api/b');");
    write(r, 'api/b.js', 'module.exports = {};');
    const sig = archSignals(r);
    assert.strictEqual(sig.layering_configured, false);
    assert.strictEqual(sig.layering.length, 0);
    assert.ok(sig.degraded.some((d) => /layering/.test(d) && /not-configured/.test(d)));
  },

  // Story 12.6 / FR104 — honest emptiness: a vacuous class reads as degradation, not clean.
  'arch: no-substrate repo → duplication/import-overlap/speculation each vacuous + all_vacuous (FR104)': () => {
    const r = tmpRepo();
    write(r, 'docs/a.md', '# just markdown');
    write(r, 'docs/b.md', '# more markdown');
    const sig = archSignals(r);
    assert.strictEqual(sig.speculation.length, 0);
    assert.strictEqual(sig.duplication.length, 0);
    assert.strictEqual(sig.import_overlap.length, 0);
    assert.ok(sig.degraded.some((d) => /^speculation:.*vacuous/.test(d)), 'speculation named vacuous');
    assert.ok(sig.degraded.some((d) => /^duplication:.*vacuous/.test(d)), 'duplication named vacuous');
    assert.ok(sig.degraded.some((d) => /^import-overlap:.*vacuous/.test(d)), 'import-overlap named vacuous');
    assert.strictEqual(sig.all_vacuous, true, 'all classes vacuous → flagged');
    assert.ok(sig.degraded.some((d) => /all architecture signal classes are vacuous/.test(d)), 'summary line present');
  },

  'arch: code substrate present → not all_vacuous, no spurious duplication-vacuous line (FR104)': () => {
    const r = tmpRepo();
    write(r, 'core/x.js', 'function processData() {}');
    write(r, 'api/y.js', 'function processData() {}');
    const sig = archSignals(r);
    assert.notStrictEqual(sig.all_vacuous, true, 'a repo with code is never all-vacuous');
    assert.ok(!sig.degraded.some((d) => /^duplication:.*vacuous/.test(d)), 'duplication has substrate → not vacuous');
  },

  'arch: deterministic — signals identical across runs': () => {
    const r = tmpRepo();
    write(r, 'core/a.ts', 'export interface Foo {}');
    write(r, 'core/x.js', 'function helperThing() {}');
    write(r, 'api/y.js', 'function helperThing() {}');
    const a = JSON.stringify(archSignals(r).duplication);
    const b = JSON.stringify(archSignals(r).duplication);
    assert.strictEqual(a, b);
  },
};
