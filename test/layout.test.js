'use strict';
// Story 7.1 — Consolidated layout & backward-compatible reads (FR48/FR49). Pins the location
// resolution the other modules now share:
//   - loadConfig reads STATE.md from .nightwatch/ with a legacy-root fallback, preferring the
//     nested copy when both exist, and records which path was read in `sources`;
//   - the tracker resolves RELEASE.md from `release_path` (default under .nightwatch/), adopts a
//     legacy root RELEASE.md byte-for-byte when the resolved path is absent, writes to the
//     resolved path with the atomic temp beside it, and honors a root opt-in;
//   - a fresh install leaves zero Nightwatch-owned files in the repo root.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write, readFile, gitInit, commit, runScript } = require('./helpers');
const { loadConfig, DEFAULTS } = require('../scripts/lib/config');
const { openTracker, releaseReadPath, releaseWritePath } = require('../scripts/lib/tracker');
const { statePath, legacyStatePath, readStateResolved } = require('../scripts/lib/schedule');
const { outDir, legacyOutDir, outReadPath } = require('../scripts/lib/util');
const { readFindings, writeFindings } = require('../scripts/lib/findings');
const { ensureGitignore } = require('../scripts/lib/init');

const STATE = (phase) => `# state\n\`\`\`yaml\nphase: ${phase}\n\`\`\`\n`;

module.exports = {
  // ---- config: STATE.md precedence + provenance (FR48) --------------------------------------
  'layout: loadConfig reads .nightwatch/STATE.md and records its path': () => {
    const r = tmpRepo();
    write(r, '.nightwatch/STATE.md', STATE('nested'));
    const lc = loadConfig(r);
    assert.strictEqual(lc.phase, 'nested', 'nested STATE.md parsed');
    assert.strictEqual(lc.sources.state_md, true);
    assert.strictEqual(lc.sources.state_md_path, '.nightwatch/STATE.md', 'provenance recorded');
  },

  'layout: loadConfig falls back to a legacy root STATE.md': () => {
    const r = tmpRepo();
    write(r, 'STATE.md', STATE('legacy'));
    const lc = loadConfig(r);
    assert.strictEqual(lc.phase, 'legacy', 'legacy root STATE.md read as fallback');
    assert.strictEqual(lc.sources.state_md_path, 'STATE.md');
  },

  'layout: .nightwatch/STATE.md wins when both exist': () => {
    const r = tmpRepo();
    write(r, 'STATE.md', STATE('legacy'));
    write(r, '.nightwatch/STATE.md', STATE('nested'));
    const lc = loadConfig(r);
    assert.strictEqual(lc.phase, 'nested', 'nested copy takes precedence');
    assert.strictEqual(lc.sources.state_md_path, '.nightwatch/STATE.md');
  },

  'layout: no STATE.md anywhere → state_md false, path null, defaults intact': () => {
    const r = tmpRepo();
    const lc = loadConfig(r);
    assert.strictEqual(lc.sources.state_md, false);
    assert.strictEqual(lc.sources.state_md_path, null);
    assert.strictEqual(lc.config.release_path, DEFAULTS.release_path);
  },

  // ---- tracker: release_path resolution + legacy adoption (FR49) ----------------------------
  'layout: release_path defaults under .nightwatch/; write lands there, not the root': () => {
    const r = tmpRepo();
    assert.strictEqual(releaseWritePath(r), path.resolve(r, '.nightwatch/RELEASE.md'));
    const t = openTracker(r, DEFAULTS);
    t.upsertItem({ key: 'x', title: 'a thing', section: 'implementation' });
    const res = t.flush();
    assert.strictEqual(res.path, path.resolve(r, '.nightwatch/RELEASE.md'));
    assert.ok(readFile(r, '.nightwatch/RELEASE.md'), 'written under .nightwatch/');
    assert.strictEqual(fs.existsSync(path.join(r, 'RELEASE.md')), false, 'nothing at the repo root');
  },

  'layout: a legacy root RELEASE.md is adopted (read byte-for-byte) when the resolved path is absent': () => {
    const r = tmpRepo();
    const legacy = '---\nprogress: 0.4\nupdated: 2026-01-01\n---\n# Release progress\n\n## Notes (human-owned — never machine-edited)\nkeep me\n';
    write(r, 'RELEASE.md', legacy);
    // Read resolution points at the legacy file, and an untouched round-trip is byte-identical.
    assert.strictEqual(releaseReadPath(r, DEFAULTS), path.resolve(r, 'RELEASE.md'));
    const t = openTracker(r, DEFAULTS);
    t.flush(); // no mutation → renderRelease returns original bytes; but the write goes to the resolved path
    assert.strictEqual(readFile(r, 'RELEASE.md'), legacy, 'legacy content untouched (never rewritten in place)');
    assert.strictEqual(readFile(r, '.nightwatch/RELEASE.md'), legacy, 'adopted content written byte-identically to the resolved path');
  },

  'layout: release_path can opt back into a root RELEASE.md': () => {
    const r = tmpRepo();
    const cfg = { ...DEFAULTS, release_path: 'RELEASE.md' };
    assert.strictEqual(releaseWritePath(r, cfg), path.resolve(r, 'RELEASE.md'));
    const t = openTracker(r, cfg);
    t.upsertItem({ key: 'x', title: 'root item', section: 'implementation' });
    t.flush();
    assert.ok(readFile(r, 'RELEASE.md'), 'opt-in root deliverable written at the root');
    assert.strictEqual(fs.existsSync(path.join(r, '.nightwatch', 'RELEASE.md')), false, 'nothing under .nightwatch/');
  },

  'layout: the atomic temp file lands beside the resolved target, never in the repo root': () => {
    const r = tmpRepo();
    const t = openTracker(r, DEFAULTS);
    t.upsertItem({ key: 'x', title: 'a thing', section: 'implementation' });
    t.flush();
    const rootStray = fs.readdirSync(r).filter((n) => n.startsWith('RELEASE.md.tmp-'));
    assert.deepStrictEqual(rootStray, [], 'no temp file leaked to the repo root');
  },

  // ---- runtime/ boundary (Story 9.4, spec runtime-layout P1) --------------------------------
  'runtime: cursors and per-run output resolve under .nightwatch/runtime/ (legacy paths recorded)': () => {
    const r = tmpRepo();
    assert.strictEqual(statePath(r), path.join(r, '.nightwatch', 'runtime', 'cursors.json'), 'cursors under runtime/');
    assert.strictEqual(legacyStatePath(r), path.join(r, '.nightwatch', 'state.json'), 'legacy state.json path retained');
    assert.strictEqual(outDir(r), path.join(r, '.nightwatch', 'runtime', 'out'), 'per-run output under runtime/');
    assert.strictEqual(legacyOutDir(r), path.join(r, '.nightwatch', 'out'), 'legacy out/ path retained');
  },

  'runtime: nested .gitignore ignores runtime/ (legacy out/ line tolerated)': () => {
    const r = tmpRepo();
    // A pre-runtime install already has a bare `out/` line: it is left in place, `runtime/` added.
    write(r, '.nightwatch/.gitignore', 'out/\n');
    const res = ensureGitignore(r);
    assert.strictEqual(res.changed, true, 'runtime/ appended');
    const gi = readFile(r, '.nightwatch/.gitignore');
    assert.ok(/^runtime\/$/m.test(gi), 'runtime/ ignored');
    assert.ok(/^out\/$/m.test(gi), 'legacy out/ line left in place');
  },

  'runtime: a real run writes cursors + out under runtime/; briefs/ledger stay trackable': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'src/app.js', 'x\n'); commit(r, 'init');
    runScript('orchestrate.js', r, { date: '2026-07-10' });
    // Cadence cursors land under runtime/, not at the legacy root of .nightwatch/.
    assert.ok(readFile(r, '.nightwatch/runtime/cursors.json') != null, 'cursors under runtime/');
    assert.strictEqual(readFile(r, '.nightwatch/state.json'), null, 'nothing at the legacy state.json path');
    assert.ok(readFile(r, `.nightwatch/runtime/out/run-status-2026-07-10.json`) != null, 'per-run output under runtime/out/');
    assert.strictEqual(fs.existsSync(path.join(r, '.nightwatch', 'out')), false, 'no legacy .nightwatch/out/');
  },

  // ---- Story 9.5 — legacy fallback reads (spec runtime-layout P2) ----------------------------
  'fallback: readState resolves runtime/cursors.json, then falls back to legacy state.json': () => {
    const r = tmpRepo();
    // Legacy-only install: only .nightwatch/state.json exists.
    write(r, '.nightwatch/state.json', JSON.stringify({ schema: 1, last_brief_date: '2026-07-09', jobs: {} }));
    let res = readStateResolved(r);
    assert.strictEqual(res.source, 'legacy', 'reads the legacy cursors');
    assert.strictEqual(res.state.last_brief_date, '2026-07-09');
    // Once the runtime file exists it wins (new runs write there; the legacy file is ignored).
    write(r, '.nightwatch/runtime/cursors.json', JSON.stringify({ schema: 1, last_brief_date: '2026-07-10', jobs: {} }));
    res = readStateResolved(r);
    assert.strictEqual(res.source, 'runtime', 'runtime cursors take precedence');
    assert.strictEqual(res.state.last_brief_date, '2026-07-10');
  },

  'fallback: outReadPath and readFindings fall back to legacy out/ until a runtime file exists': () => {
    const r = tmpRepo();
    // A legacy per-run doc only under .nightwatch/out/.
    write(r, '.nightwatch/out/repo-reconcile-2026-07-09.json', JSON.stringify({ schema: 1, job: 'repo-reconcile', date: '2026-07-09', findings: [] }));
    assert.strictEqual(outReadPath(r, 'repo-reconcile-2026-07-09.json'), path.join(legacyOutDir(r), 'repo-reconcile-2026-07-09.json'), 'resolves to legacy when only legacy exists');
    assert.ok(readFindings(r, 'repo-reconcile', '2026-07-09') != null, 'readFindings falls back to legacy out/');
    // Writing to the runtime path makes it win.
    writeFindings(r, 'repo-reconcile', '2026-07-09', [], []);
    assert.strictEqual(outReadPath(r, 'repo-reconcile-2026-07-09.json'), path.join(outDir(r), 'repo-reconcile-2026-07-09.json'), 'runtime path wins once written');
  },

  // ---- layout invariant: fresh install writes zero root Nightwatch files --------------------
  'layout: a fresh tracker flush leaves zero Nightwatch-owned files in the repo root': () => {
    const r = tmpRepo();
    const t = openTracker(r, DEFAULTS);
    t.appendStatus('first', '2026-01-01');
    t.flush();
    const rootEntries = fs.readdirSync(r).sort();
    assert.deepStrictEqual(rootEntries, ['.nightwatch'], 'only the .nightwatch/ directory at the root');
  },
};
