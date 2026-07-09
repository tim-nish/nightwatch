'use strict';
const assert = require('assert');
const { tmpRepo, write, gitInit, commit, readJSON } = require('./helpers');
const { makeSignal, CONFIDENCE, KINDS, writeSignals, readSignals } = require('../scripts/lib/signals');
const { universalGitSignals } = require('../scripts/git-signals');

// A repo where core/a.js and api/b.js co-change across a module boundary in N commits, on top
// of 22 noise commits so coupling is not skipped for shallow history.
function coupledRepo(nCoChange) {
  const r = tmpRepo();
  gitInit(r);
  for (let i = 0; i < 22; i++) { write(r, 'noise.txt', 'v' + i); commit(r, 'noise ' + i); }
  for (let i = 0; i < nCoChange; i++) {
    write(r, 'core/a.js', '// core ' + i);
    write(r, 'api/b.js', '// api ' + i);
    commit(r, 'co-change ' + i);
  }
  return r;
}

module.exports = {
  'signals: makeSignal validates kind/confidence/source/detail and normalizes evidence': () => {
    const s = makeSignal({ kind: 'hotspot', confidence: 'heuristic', source: 'universal-git', evidence: ['a.js:12'], detail: 'churny' });
    assert.deepStrictEqual(s.evidence, [{ path: 'a.js', line: 12 }]);
    assert.strictEqual(s.source, 'universal-git');
    assert.throws(() => makeSignal({ kind: 'nope', confidence: 'exact', source: 's', detail: 'd' }), /bad signal kind/);
    assert.throws(() => makeSignal({ kind: 'hotspot', confidence: 'maybe', source: 's', detail: 'd' }), /bad confidence/);
    assert.throws(() => makeSignal({ kind: 'hotspot', confidence: 'exact', source: 's' }), /detail required/);
    assert.throws(() => makeSignal({ kind: 'hotspot', confidence: 'exact', detail: 'd' }), /source required/);
  },

  'signals: doc carries schema/sources/degraded and every signal has the full shape (FR8)': () => {
    const r = coupledRepo(8);
    const norm = universalGitSignals(r, { couplingMinCommits: 5 });
    const doc = writeSignals(r, '2000-01-01', norm);
    assert.strictEqual(doc.schema, 1);
    assert.ok(Array.isArray(doc.sources) && doc.sources[0].name === 'universal-git');
    assert.ok(Array.isArray(doc.degraded));
    assert.ok(doc.signals.length >= 1);
    for (const s of doc.signals) {
      assert.ok(KINDS.includes(s.kind), 'known kind: ' + s.kind);
      assert.ok(CONFIDENCE.includes(s.confidence), 'known confidence: ' + s.confidence);
      assert.ok(typeof s.detail === 'string' && s.detail, 'has detail');
      assert.strictEqual(s.source, 'universal-git');
      assert.ok(Array.isArray(s.evidence), 'evidence is an array');
    }
    // Round-trips through disk.
    const onDisk = readSignals(r, '2000-01-01');
    assert.strictEqual(onDisk.signals.length, doc.signals.length);
  },

  'signals: readSignals refuses a higher major schema rather than misreading it': () => {
    const r = tmpRepo();
    writeSignals(r, '2000-01-01', { sources: [], degraded: [], signals: [] });
    const p = require('../scripts/lib/signals').signalsPath(r, '2000-01-01');
    const raw = readJSON(r, require('path').relative(r, p));
    raw.schema = 2;
    write(r, require('path').relative(r, p), JSON.stringify(raw));
    assert.throws(() => readSignals(r, '2000-01-01'), /newer than supported/);
  },

  'signals: cross-boundary co-change surfaces a hidden-coupling signal from git alone (FR11)': () => {
    const r = coupledRepo(8);
    const norm = universalGitSignals(r, { couplingMinCommits: 5 });
    const hc = norm.signals.find((s) => s.kind === 'hidden-coupling');
    assert.ok(hc, 'hidden-coupling signal present');
    const paths = hc.evidence.map((e) => e.path);
    assert.ok(paths.includes('core/a.js') && paths.includes('api/b.js'), 'full paths: ' + paths.join(','));
    assert.strictEqual(hc.confidence, 'heuristic');
  },

  'signals: shallow history skips co-change with a notice and no coupling signal (FR11)': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, 'a.js', '1'); commit(r, 'one');
    const norm = universalGitSignals(r);
    assert.ok(norm.degraded.some((d) => /shallow history/.test(d)), 'shallow-history notice');
    assert.ok(!norm.signals.some((s) => s.kind === 'hidden-coupling'), 'no coupling signal on shallow history');
  },

  'signals: universal file-tree, README, and TODO-density signals are always emitted': () => {
    const r = tmpRepo();
    gitInit(r);
    write(r, 'README.md', '# demo');
    write(r, 'src/a.js', '// TODO wire this up\nconst x = 1;');
    commit(r, 'c');
    const norm = universalGitSignals(r);
    assert.ok(norm.signals.some((s) => s.kind === 'file-tree' && s.confidence === 'exact'));
    const rm = norm.signals.find((s) => s.kind === 'readme');
    assert.ok(rm && rm.evidence.some((e) => /README/i.test(e.path)), 'readme signal points at README');
    const td = norm.signals.find((s) => s.kind === 'todo-density');
    assert.ok(td && /1 TODO/.test(td.detail), 'todo-density counts the marker: ' + (td && td.detail));
  },

  'signals: identical JSON across repeated runs (NFR8)': () => {
    const r = coupledRepo(8);
    const a = JSON.stringify(universalGitSignals(r).signals);
    const b = JSON.stringify(universalGitSignals(r).signals);
    assert.strictEqual(a, b);
  },
};
