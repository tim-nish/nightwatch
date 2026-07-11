'use strict';
// Story 12.7 / FR105 — phase-selection clarity: the non-binding phase suggestion is driven only by
// cheap, deterministic, read-only signals (release/tag, published-package manifest, semver), keys on
// the substrate probe, and never reads STATE.md. The sharpened descriptions and the "Suggested:"
// rendering are agent-driven (commands/nightwatch.md); here we pin the deterministic helper.
const assert = require('assert');
const { tmpRepo, write, gitInit, git, commit } = require('./helpers');
const { suggestPhase } = require('../scripts/lib/init');

module.exports = {
  'phase-suggest: a published 1.x manifest → released, signals named (FR105)': () => {
    const r = tmpRepo();
    write(r, 'package.json', JSON.stringify({ name: 'demo', version: '1.4.2' }));
    const s = suggestPhase(r);
    assert.strictEqual(s.suggested, 'released', 'a 1.0+ version suggests released');
    assert.ok(s.signals.includes('versioned-manifest'), 'names the manifest signal');
    assert.ok(s.signals.includes('semver'), 'names the semver signal');
  },

  'phase-suggest: a pre-1.0 manifest → hardening (has a package, still pre-release) (FR105)': () => {
    const r = tmpRepo();
    write(r, 'pyproject.toml', '[project]\nname = "demo"\nversion = "0.3.0"\n');
    const s = suggestPhase(r);
    assert.strictEqual(s.suggested, 'hardening', 'pre-1.0 published manifest suggests hardening');
    assert.ok(s.signals.includes('versioned-manifest'));
  },

  'phase-suggest: a semver release tag on a code repo → released for 1.0+ (FR105)': () => {
    const r = tmpRepo();
    write(r, 'package.json', JSON.stringify({ name: 'demo' })); // substrate, but no version field
    gitInit(r);
    commit(r, 'seed');
    git(r, ['tag', 'v2.0.0']);
    const s = suggestPhase(r);
    assert.strictEqual(s.suggested, 'released', 'a v2.0.0 tag suggests released');
    assert.ok(s.signals.includes('release-tag'), 'names the release-tag signal');
  },

  'phase-suggest: code repo with no release/version signals → no suggestion (FR105)': () => {
    const r = tmpRepo();
    write(r, 'package.json', JSON.stringify({ name: 'demo' })); // substrate present, but no version/tag
    gitInit(r);
    commit(r, 'seed');
    const s = suggestPhase(r);
    assert.strictEqual(s.suggested, null, 'no signals → no suggestion');
    assert.deepStrictEqual(s.signals, []);
  },

  'phase-suggest: no-substrate (content) repo → never inferred, even with a tag (FR105)': () => {
    const r = tmpRepo();
    write(r, 'docs/a.md', '# content repo, no import substrate');
    gitInit(r);
    commit(r, 'seed');
    git(r, ['tag', 'v1.0.0']); // weaker evidence on a content repo must not manufacture a suggestion
    const s = suggestPhase(r);
    assert.strictEqual(s.suggested, null, 'no-substrate repo renders no suggestion');
    assert.deepStrictEqual(s.signals, []);
  },

  'phase-suggest: an operational STATE.md target never feeds the suggestion (FR105)': () => {
    const r = tmpRepo();
    // A declared phase/release target in STATE.md must NOT drive the deterministic suggestion.
    write(r, '.nightwatch/STATE.md', '```yaml\nphase: released\nrelease:\n  target: "v9 ship it"\n```\n');
    write(r, 'docs/a.md', '# prose'); // no import substrate
    const s = suggestPhase(r);
    assert.strictEqual(s.suggested, null, 'STATE.md is never a signal source');
    assert.deepStrictEqual(s.signals, []);
  },
};
