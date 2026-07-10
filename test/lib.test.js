'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write } = require('./helpers');
const { loadConfig, parseStateBlock, deepMerge, DEFAULTS } = require('../scripts/lib/config');
const {
  makeId, makeFinding, appendLedger, recurrenceCounts,
  writeFindings, readFindings, dedupeFindings, SCHEMA_VERSION,
} = require('../scripts/lib/findings');
const { writeJSON, outDir, toFraction, progressPercent } = require('../scripts/lib/util');

module.exports = {
  // Progress representation contract: internal 0–1 fraction, rendered ×100 at the boundary.
  'progress: toFraction normalizes to 0–1; progressPercent renders an integer percent': () => {
    // the reported bug: a 0.38 fraction must render as 38, never 0.38
    assert.strictEqual(progressPercent(0.38), 38, '0.38 → 38%');
    assert.strictEqual(progressPercent(0), 0);
    assert.strictEqual(progressPercent(1), 100, '1.0 fraction → 100%');
    assert.strictEqual(progressPercent(0.335), 34, 'rounds to the nearest percent');
    // defensive: a legacy value already in percent (> 1) is shown as-is, not ×100 again
    assert.strictEqual(progressPercent(64), 64, 'legacy percent 64 → 64%');
    assert.strictEqual(progressPercent('x'), null, 'non-number → null');
    // toFraction: legacy percent → fraction; fraction passes through
    assert.strictEqual(toFraction(64), 0.64, 'legacy 64 → 0.64');
    assert.strictEqual(toFraction(0.38), 0.38);
    assert.strictEqual(toFraction(1), 1);
    assert.strictEqual(toFraction(''), 0, 'non-number → 0');
  },

  'config: absent files → shipped defaults': () => {
    const r = tmpRepo();
    const { config, authority, phase, release, degraded } = loadConfig(r);
    assert.deepStrictEqual(config.caps, DEFAULTS.caps);
    assert.strictEqual(authority, null);
    assert.strictEqual(phase, null);
    assert.strictEqual(release, null);
    assert.deepStrictEqual(degraded, []);
  },

  'config: precedence defaults ← config.yaml ← STATE.md yaml block': () => {
    const r = tmpRepo();
    write(r, '.nightwatch/config.yaml', 'caps: {brief_total: 30}\ntimeout_minutes: 45\n');
    write(r, 'STATE.md', 'prose\n\n```yaml\ncaps: {brief_total: 99}\nphase: hardening\n```\n');
    const { config, phase } = loadConfig(r);
    assert.strictEqual(config.caps.brief_total, 99, 'STATE.md overrides config.yaml');
    assert.strictEqual(config.caps.reconcile, DEFAULTS.caps.reconcile, 'unspecified keys keep defaults');
    assert.strictEqual(config.timeout_minutes, 45, 'config.yaml overrides default');
    assert.strictEqual(phase, 'hardening');
  },

  'config: tracking.backend defaults to markdown, overridable via config.yaml': () => {
    const r = tmpRepo();
    assert.strictEqual(loadConfig(r).config.tracking.backend, 'markdown', 'shipped default');
    write(r, '.nightwatch/config.yaml', 'tracking: {backend: sqlite}\n');
    assert.strictEqual(loadConfig(r).config.tracking.backend, 'sqlite', 'config.yaml overrides');
  },

  'config: shipped config.yaml template parses and yields the documented defaults': () => {
    const r = tmpRepo();
    const tmpl = fs.readFileSync(path.join(__dirname, '..', 'templates', 'config.yaml'), 'utf8');
    write(r, '.nightwatch/config.yaml', tmpl);
    const { config, degraded } = loadConfig(r);
    assert.deepStrictEqual(degraded, [], 'template parses cleanly');
    assert.deepStrictEqual(config.tracking, DEFAULTS.tracking);
    assert.deepStrictEqual(config.caps, DEFAULTS.caps);
    assert.strictEqual(config.timeout_minutes, DEFAULTS.timeout_minutes);
  },

  'config: unparseable config.yaml is degraded, not fatal': () => {
    const r = tmpRepo();
    write(r, '.nightwatch/config.yaml', ':\n  - broken: [unterminated\n');
    const { degraded, config } = loadConfig(r);
    assert.ok(degraded.some((d) => /config\.yaml/.test(d)), 'reports the parse failure');
    assert.deepStrictEqual(config.caps, DEFAULTS.caps, 'falls back to defaults');
  },

  'parseStateBlock: no yaml block → null, no error': () => {
    const { data, error } = parseStateBlock('# just prose, no fence');
    assert.strictEqual(data, null);
    assert.strictEqual(error, null);
  },

  'parseStateBlock: malformed yaml → error surfaced': () => {
    const { data, error } = parseStateBlock('```yaml\nfoo: [1, 2\n```');
    assert.strictEqual(data, null);
    assert.ok(error, 'error message present');
  },

  'deepMerge: arrays replace, objects merge': () => {
    const dst = { a: { x: 1, y: 2 }, list: [1, 2, 3] };
    deepMerge(dst, { a: { y: 9 }, list: [7] });
    assert.deepStrictEqual(dst, { a: { x: 1, y: 9 }, list: [7] });
  },

  'findings: makeId stable across runs, sensitive to locus/kind': () => {
    const a1 = makeId('repo-reconcile', 'drift', 'README.md::flag:--tag');
    const a2 = makeId('repo-reconcile', 'drift', 'README.md::flag:--tag');
    assert.strictEqual(a1, a2, 'same inputs → same id');
    assert.match(a1, /^RC-[0-9a-f]{6}$/);
    assert.notStrictEqual(a1, makeId('repo-reconcile', 'drift', 'README.md::flag:--other'));
    assert.notStrictEqual(a1, makeId('repo-reconcile', 'setup', 'README.md::flag:--tag'));
  },

  'findings: id independent of title (survives retitling)': () => {
    const f1 = makeFinding('arch-review', { kind: 'arch', severity: 3, title: 'Old title', locus: 'iface:Foo' });
    const f2 = makeFinding('arch-review', { kind: 'arch', severity: 3, title: 'Completely new wording', locus: 'iface:Foo' });
    assert.strictEqual(f1.id, f2.id);
  },

  'findings: schema validation rejects bad inputs': () => {
    assert.throws(() => makeFinding('nightwatch', { kind: 'bogus', severity: 1, title: 't' }));
    assert.throws(() => makeFinding('nightwatch', { kind: 'drift', severity: 9, title: 't' }));
    assert.throws(() => makeFinding('nightwatch', { kind: 'drift', severity: 1 }));
  },

  'findings: makeFinding normalizes evidence to structured {path, line} objects': () => {
    const f = makeFinding('repo-reconcile', {
      kind: 'drift', severity: 2, title: 't', locus: 'x',
      evidence: ['README.md', 'src/a.js:41', { path: 'src/b.js', line: 7 }],
    });
    assert.deepStrictEqual(f.evidence, [
      { path: 'README.md' },
      { path: 'src/a.js', line: 41 },
      { path: 'src/b.js', line: 7 },
    ]);
  },

  'findings: written doc carries schema:1, job, date, degraded, findings': () => {
    const r = tmpRepo();
    const doc = writeFindings(r, 'repo-reconcile', '2000-01-01', ['note'], [
      makeFinding('repo-reconcile', { kind: 'drift', severity: 2, title: 't', locus: 'x' }),
    ]);
    assert.strictEqual(doc.schema, SCHEMA_VERSION);
    assert.strictEqual(doc.schema, 1);
    assert.strictEqual(doc.job, 'repo-reconcile');
    assert.strictEqual(doc.date, '2000-01-01');
    assert.deepStrictEqual(doc.degraded, ['note']);
    assert.strictEqual(doc.findings.length, 1);
    // round-trips back through readFindings
    assert.deepStrictEqual(readFindings(r, 'repo-reconcile', '2000-01-01'), doc);
  },

  'findings: readFindings rejects a higher major schema rather than misreading it': () => {
    const r = tmpRepo();
    writeJSON(path.join(outDir(r), 'repo-reconcile-2000-01-02.json'),
      { schema: 2, job: 'repo-reconcile', date: '2000-01-02', degraded: [], findings: [] });
    assert.throws(() => readFindings(r, 'repo-reconcile', '2000-01-02'), /schema v2 is newer/);
    // a missing schema is treated as v1 and still reads
    writeJSON(path.join(outDir(r), 'repo-reconcile-2000-01-03.json'),
      { job: 'repo-reconcile', date: '2000-01-03', degraded: [], findings: [] });
    assert.ok(readFindings(r, 'repo-reconcile', '2000-01-03'));
  },

  'findings: dedupeFindings keeps one survivor per id and counts recurrence': () => {
    const mk = (locus, title) => makeFinding('repo-reconcile', { kind: 'drift', severity: 2, title, locus });
    const a1 = mk('L1', 'first'); const a2 = mk('L1', 'retitled'); const b = mk('L2', 'other');
    assert.strictEqual(a1.id, a2.id, 'same locus → same id');
    const { findings, counts } = dedupeFindings([a1, a2, b]);
    assert.strictEqual(findings.length, 2, 'one survivor per id');
    assert.strictEqual(findings[0], a1, 'first occurrence survives');
    assert.strictEqual(counts.get(a1.id), 2);
    assert.strictEqual(counts.get(b.id), 1);
  },

  'ledger: recurrence counts prior appearances by id': () => {
    const r = tmpRepo();
    appendLedger(r, [
      { type: 'finding', date: '2000-01-01', id: 'RC-aaa', job: 'repo-reconcile' },
      { type: 'run', date: '2000-01-01', job: 'repo-reconcile' },
      { type: 'finding', date: '2000-01-02', id: 'RC-aaa', job: 'repo-reconcile' },
      { type: 'finding', date: '2000-01-02', id: 'RC-bbb', job: 'repo-reconcile' },
    ]);
    const counts = recurrenceCounts(r);
    assert.strictEqual(counts.get('RC-aaa'), 2);
    assert.strictEqual(counts.get('RC-bbb'), 1);
  },
};
