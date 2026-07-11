'use strict';
const assert = require('assert');
const { tmpRepo, write, gitInit, commit, readJSON } = require('./helpers');
const { extractSignals, isAdapter } = require('../scripts/extract-signals');
const { KINDS, CONFIDENCE } = require('../scripts/lib/signals');

// Minimal git repo so the universal-git built-in always contributes a floor of signals.
function baseRepo() {
  const r = tmpRepo();
  gitInit(r);
  write(r, 'README.md', '# demo');
  write(r, 'src/a.js', 'const x = 1;');
  commit(r, 'init');
  return r;
}

// A conforming fake adapter whose behavior each test dials in.
function fakeAdapter({ name = 'fake', detect = true, available = true, run, tool = 'faketool@1.0.0', install = 'npm i -D faketool' } = {}) {
  return {
    detect: () => detect,
    available: () => available,
    run: run || (() => ({ tool, signals: [{ kind: 'cycle', confidence: 'exact', evidence: [{ path: 'src/a.js' }], detail: 'a → b → a cycle', source: name }] })),
    explain: () => ({ name, tool, install, summary: `${tool} not available` }),
  };
}

module.exports = {
  'extract-signals: isAdapter requires all four contract functions': () => {
    assert.ok(isAdapter(fakeAdapter()));
    assert.ok(!isAdapter({ detect() {}, available() {}, run() {} })); // missing explain
    assert.ok(!isAdapter(null));
  },

  'extract-signals: universal built-in always contributes, even with no adapters (FR14)': () => {
    const r = baseRepo();
    const res = extractSignals(r, { adapters: [], config: { ignore: [] } });
    assert.ok(res.sources.some((s) => s.extractor === 'universal-git'));
    assert.ok(res.signals.length >= 1, 'floor signals present');
    assert.ok(res.signals.every((s) => KINDS.includes(s.kind) && CONFIDENCE.includes(s.confidence)));
  },

  'extract-signals: available adapter merges into the signal set with a tool source (FR14)': () => {
    const r = baseRepo();
    const res = extractSignals(r, { adapters: [fakeAdapter()], config: { ignore: [] } });
    assert.ok(res.signals.some((s) => s.kind === 'cycle' && s.source === 'fake'));
    const src = res.sources.find((s) => s.extractor === 'fake');
    assert.ok(src && src.tool === 'faketool@1.0.0', 'source records tool@version');
    assert.ok(!res.degraded.some((d) => /^fake:/.test(d)), 'a healthy adapter adds no degraded note');
  },

  'extract-signals: detected-but-unavailable → degraded + one setup finding, once per repo (FR10)': () => {
    const r = baseRepo();
    const adapters = [fakeAdapter({ available: false })];
    const first = extractSignals(r, { adapters, config: { ignore: [] } });
    assert.ok(first.degraded.some((d) => /faketool/.test(d) && /install/.test(d)), 'degraded names tool + install hint');
    assert.strictEqual(first.findings.filter((f) => f.kind === 'setup').length, 1, 'one setup finding first run');
    // Second run on the same repo: still degraded, but no repeat setup finding.
    const second = extractSignals(r, { adapters, config: { ignore: [] } });
    assert.ok(second.degraded.some((d) => /faketool/.test(d)), 'still degraded');
    assert.strictEqual(second.findings.length, 0, 'setup finding is once per repo');
  },

  'extract-signals: a crashing adapter is dropped with a notice; others proceed (FR14)': () => {
    const r = baseRepo();
    const boom = fakeAdapter({ name: 'boom', run: () => { throw new Error('kaboom'); } });
    const ok = fakeAdapter({ name: 'ok' });
    const res = extractSignals(r, { adapters: [boom, ok], config: { ignore: [] } });
    assert.ok(res.degraded.some((d) => /boom/.test(d) && /kaboom/.test(d)), 'crash noticed');
    assert.ok(res.signals.some((s) => s.source === 'ok'), 'other adapter still contributed');
    assert.ok(!res.sources.some((s) => s.extractor === 'boom'), 'crashed adapter is not a source');
  },

  'extract-signals: unparsable adapter output is dropped signal-by-signal, run proceeds (FR14)': () => {
    const r = baseRepo();
    const junk = fakeAdapter({ name: 'junk', run: () => ({ tool: 'junk@1', signals: [{ kind: 'not-a-real-kind', detail: 'x' }, { kind: 'cycle', confidence: 'exact', detail: 'real', evidence: [], source: 'junk' }] }) });
    const res = extractSignals(r, { adapters: [junk], config: { ignore: [] } });
    assert.ok(res.degraded.some((d) => /junk/.test(d) && /malformed/.test(d)), 'malformed signal noticed');
    assert.ok(res.signals.some((s) => s.source === 'junk' && s.kind === 'cycle'), 'valid signal kept');
    assert.ok(!res.signals.some((s) => s.kind === 'not-a-real-kind'), 'invalid signal dropped');
  },

  'extract-signals: non-applicable adapter (detect=false) contributes nothing, silently': () => {
    const r = baseRepo();
    const res = extractSignals(r, { adapters: [fakeAdapter({ name: 'na', detect: false })], config: { ignore: [] } });
    assert.ok(!res.sources.some((s) => s.extractor === 'na'));
    assert.ok(!res.degraded.some((d) => /^na:/.test(d)), 'no degradation for an ecosystem that simply does not apply');
  },

  'extract-signals: CLI writes a valid merged signals-<date>.json': () => {
    const r = baseRepo();
    const res = extractSignals(r, { adapters: [fakeAdapter()], config: { ignore: [] } });
    const { writeSignals } = require('../scripts/lib/signals');
    writeSignals(r, '2000-01-01', res);
    const doc = readJSON(r, '.nightwatch/runtime/out/signals-2000-01-01.json');
    assert.strictEqual(doc.schema, 1);
    assert.ok(doc.sources.some((s) => s.extractor === 'universal-git'));
    assert.ok(doc.signals.length >= 2);
  },
};
