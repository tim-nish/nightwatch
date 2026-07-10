'use strict';
// Story 4.5 — /nightwatch init: interactive daytime setup (FR33/NFR4). The interview is
// agent-driven (commands/nightwatch.md); these ACs pin the deterministic helper:
//   (a) init instantiates STATE.md + .nightwatch/config.yaml from the shipped templates when
//       absent, and NEVER clobbers an existing declaration;
//   (b) the adapter probe reports detect/available + an install hint for a detected-but-
//       unavailable tool (the one moment a tool install is ever suggested);
//   (c) an overnight (non-init) orchestrate run never writes STATE.md or config.yaml.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT, tmpRepo, write, readFile, git, gitInit, commit, runScript } = require('./helpers');
const { runInit, writeDeclarations, ensureGitignore, probeAdapters } = require('../scripts/lib/init');

/** The exact bytes of a shipped template — the provenance oracle for AC (a). */
function shippedTemplate(name) {
  return fs.readFileSync(path.join(ROOT, 'templates', name), 'utf8');
}

/** A conforming fake adapter whose detect/available/explain each test dials in (matches §2.6). */
function fakeAdapter({ name, detect = true, available = true, tool = 'faketool', install = 'npm i -D faketool' } = {}) {
  return {
    detect: () => detect,
    available: () => available,
    run: () => ({ tool, signals: [] }),
    explain: () => ({ name, tool, install, summary: `${tool} not available` }),
  };
}

module.exports = {
  // ---- AC (a): templates instantiated when absent; an existing declaration is never clobbered ---
  'init: writes STATE.md and config.yaml from the shipped templates when absent': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');

    const rep = writeDeclarations(root);
    // Both declarations were created...
    assert.deepStrictEqual(rep.map((r) => [r.file, r.written, r.reason]),
      [['state', true, 'created'], ['config', true, 'created']]);
    // ...and their bytes came verbatim from the shipped templates (provenance).
    assert.strictEqual(readFile(root, '.nightwatch/STATE.md'), shippedTemplate('STATE.md'), 'STATE.md is the template');
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), shippedTemplate('config.yaml'), 'config.yaml is the template');
  },

  'init: never clobbers an EXISTING declaration (setup, not overwrite)': () => {
    const root = tmpRepo();
    gitInit(root);
    const mine = '# my hand-written STATE\n```yaml\nphase: hardening\n```\n';
    write(root, 'STATE.md', mine);
    commit(root, 'init');

    const rep = writeDeclarations(root);
    const state = rep.find((r) => r.file === 'state');
    assert.strictEqual(state.written, false, 'existing STATE.md not written');
    assert.strictEqual(state.reason, 'exists');
    assert.strictEqual(readFile(root, 'STATE.md'), mine, 'existing declaration is byte-preserved');
    // The absent one is still created — init fills only the gaps.
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), shippedTemplate('config.yaml'));
  },

  'init: registers .nightwatch/out/ in .gitignore, idempotently': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');

    const first = ensureGitignore(root);
    assert.strictEqual(first.changed, true, 'first call adds the ignore');
    assert.ok(/^\.nightwatch\/out\/$/m.test(readFile(root, '.gitignore')), '.nightwatch/out/ present');

    const second = ensureGitignore(root);
    assert.strictEqual(second.changed, false, 'idempotent — no duplicate entry');
    const occurrences = readFile(root, '.gitignore').split('\n').filter((l) => l.trim() === '.nightwatch/out/').length;
    assert.strictEqual(occurrences, 1, 'exactly one out/ ignore line');
  },

  'init: CLI end-to-end writes both declarations and reports status ok': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    const { stdout } = runScript('init.js', root);
    const res = JSON.parse(stdout);
    assert.strictEqual(res.status, 'ok');
    assert.ok(res.declarations.every((d) => d.written), 'both declarations created');
    assert.strictEqual(readFile(root, '.nightwatch/STATE.md'), shippedTemplate('STATE.md'));
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), shippedTemplate('config.yaml'));
    assert.ok(Array.isArray(res.probe), 'probe report present in CLI output');
  },

  // ---- AC (b): the adapter probe reports detect/available + install hint for detected-unavailable
  'init: probe offers an install hint ONLY for a detected-but-unavailable tool': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    const rows = probeAdapters(root, [
      fakeAdapter({ name: 'missing', detect: true, available: false, tool: 'toolX', install: 'pip install toolX' }),
      fakeAdapter({ name: 'present', detect: true, available: true, tool: 'toolY' }),
      fakeAdapter({ name: 'na', detect: false, tool: 'toolZ' }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));

    // Detected + unavailable → the one moment an install is suggested.
    assert.strictEqual(by.missing.detected, true);
    assert.strictEqual(by.missing.available, false);
    assert.strictEqual(by.missing.installHint, 'pip install toolX', 'install hint offered');

    // Detected + available → nothing to install.
    assert.strictEqual(by.present.detected, true);
    assert.strictEqual(by.present.available, true);
    assert.strictEqual(by.present.installHint, null, 'available tool needs no install hint');

    // Not applicable → never probed for availability, never an install hint.
    assert.strictEqual(by.na.detected, false);
    assert.strictEqual(by.na.available, false);
    assert.strictEqual(by.na.installHint, null, 'a non-applicable ecosystem is never a setup task');

    // Deterministic (name-sorted).
    assert.deepStrictEqual(rows.map((r) => r.name), ['missing', 'na', 'present']);
  },

  'init: probe against real adapters detects the Node ecosystem, offers depcruise install when absent': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'package.json', '{"name":"demo"}\n'); // Node manifest → node-depcruise.detect() true
    commit(root, 'init');
    // Real adapters, discovered from scripts/extractors/. No dependency-cruiser in this fixture's
    // node_modules/.bin (and none on PATH), so it must probe detected-but-unavailable.
    const rows = probeAdapters(root);
    const node = rows.find((r) => r.name === 'node-depcruise');
    assert.ok(node, 'node-depcruise adapter discovered');
    assert.strictEqual(node.detected, true, 'package.json makes the Node ecosystem apply');
    if (!node.available) {
      assert.strictEqual(node.installHint, 'npm i -D dependency-cruiser', 'install hint from adapter.explain()');
    }
  },

  'init: --probe writes nothing (probe is read-only)': () => {
    const root = tmpRepo();
    gitInit(root); commit(root, 'init');
    const res = runInit(root, { probeOnly: true, adapters: [fakeAdapter({ name: 'x' })] });
    assert.deepStrictEqual(res.declarations, [], 'no declarations written on a probe-only pass');
    assert.strictEqual(readFile(root, '.nightwatch/STATE.md'), null, 'STATE.md not created');
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), null, 'config.yaml not created');
  },

  // ---- AC (c): an overnight (non-init) run never creates or edits the declaration files ---------
  'overnight: orchestrate never writes STATE.md or config.yaml (write-surface guard)': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'src/app.js', 'module.exports = 1;\n');
    commit(root, 'init');

    runScript('orchestrate.js', root, { date: '2026-07-09' });

    assert.strictEqual(readFile(root, '.nightwatch/STATE.md'), null, 'overnight run created no STATE.md');
    assert.strictEqual(readFile(root, '.nightwatch/config.yaml'), null, 'overnight run created no config.yaml');
    // Every change stays under .nightwatch/ and none is a declaration file.
    const changed = git(root, ['status', '--porcelain']).split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => l.replace(/^\S+\s+/, ''));
    for (const p of changed) {
      assert.ok(p.startsWith('.nightwatch/'), `overnight wrote outside surface: ${p}`);
      assert.ok(p !== '.nightwatch/STATE.md' && p !== '.nightwatch/config.yaml', `overnight touched a declaration: ${p}`);
    }
  },
};
