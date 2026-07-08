'use strict';
const assert = require('assert');
const path = require('path');
const { tmpRepo, write } = require('./helpers');
const { loadConfig, parseStateBlock, deepMerge, DEFAULTS } = require('../scripts/lib/config');
const { makeId, makeFinding, appendLedger, recurrenceCounts } = require('../scripts/lib/findings');

module.exports = {
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
