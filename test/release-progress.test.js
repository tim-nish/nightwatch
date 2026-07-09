'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { tmpRepo, write, readFile } = require('./helpers');
const { releaseProgress } = require('../scripts/release-progress');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'templates', 'RELEASE.md'), 'utf8');

const STATE_WITH_RELEASE = [
  '# Project state',
  '',
  '```yaml',
  'release:',
  '  target: "My Target v9"',
  '  definition_of_done:',
  '    - "Provide a LICENSE for the project"',
  '    - "All commands have specs and the reconciler reports 0 drift"',
  '```',
  '',
].join('\n');

function frontmatter(doc) {
  const m = doc.match(/^---\n([\s\S]*?)\n---/);
  return m ? yaml.load(m[1]) : {};
}

function section(doc, heading) {
  const after = doc.split(`## ${heading}`)[1];
  if (after == null) return '';
  return after.split('\n## ')[0];
}

function nwIdOf(doc, needle) {
  const line = doc.split('\n').find((l) => l.includes(needle));
  const m = line && line.match(/nw:(IT-[0-9a-f]{6})/);
  return m ? m[1] : null;
}

module.exports = {
  // AC1 — fresh repo: valid RELEASE.md instantiated via the store, generic items only, notice set.
  'release-progress: fresh repo instantiates RELEASE.md with generic items + notice': () => {
    const r = tmpRepo();
    write(r, 'a.js', 'const x = 1;');
    const res = releaseProgress(r, { date: '2026-01-01' });
    const doc = readFile(r, 'RELEASE.md');
    assert.ok(doc, 'RELEASE.md created');
    const fm = frontmatter(doc);
    assert.match(String(fm.notice), /generic criteria — declare `release:` in STATE\.md/);
    assert.match(doc, /^updated: 2026-01-01$/m, 'updated stamped');
    assert.ok(doc.includes('Ship a LICENSE file'), 'generic license item populated');
    assert.ok(doc.includes('README covers install and quickstart'), 'generic readme item populated');
    assert.strictEqual(res.wrote, true);
    // Target is never invented by the job — it is whatever the template declared.
    assert.match(doc, /target: "v0\.1 public release"/);
  },

  // AC2 — declared DoD merges without duplicating a generic criterion; ids stay stable across runs.
  'release-progress: STATE release block merges DoD without duplicating a generic item': () => {
    const r = tmpRepo();
    write(r, 'STATE.md', STATE_WITH_RELEASE);
    write(r, 'a.js', '1');
    releaseProgress(r, { date: '2026-01-01' });
    const d1 = readFile(r, 'RELEASE.md');
    const fm = frontmatter(d1);
    assert.strictEqual(fm.target, 'My Target v9', 'target read from STATE');
    assert.ok(fm.notice == null, 'notice dropped once release: is declared');
    assert.ok(d1.includes('All commands have specs and the reconciler reports 0 drift'), 'non-generic DoD item added');
    assert.ok(!d1.includes('Provide a LICENSE'), 'DoD line folded onto the generic LICENSE item (no duplicate)');
    // Second night, nothing changed → ids of existing items are unchanged.
    releaseProgress(r, { date: '2026-01-02' });
    const d2 = readFile(r, 'RELEASE.md');
    const id1 = nwIdOf(d1, 'All commands have specs');
    const id2 = nwIdOf(d2, 'All commands have specs');
    assert.ok(id1 && id1 === id2, `DoD item id stable across runs (${id1} vs ${id2})`);
  },

  // AC3 — an item whose evidence now exists is completed with evidence; progress rises; a dated
  // status line records it; Next actions each point at a concrete file/spec.
  'release-progress: completes an item whose evidence appears, raising progress': () => {
    const r = tmpRepo();
    write(r, 'a.js', '1');
    const res1 = releaseProgress(r, { date: '2026-01-01' });
    write(r, 'LICENSE', 'MIT');
    const res2 = releaseProgress(r, { date: '2026-01-02' });
    assert.ok(res2.progress > res1.progress, `progress increased ${res1.progress} -> ${res2.progress}`);
    const doc = readFile(r, 'RELEASE.md');
    assert.match(doc, /- \[x\] Ship a LICENSE file — evidence: LICENSE/, 'completed with closing evidence');
    assert.match(doc, /2026-01-02 — completed: Ship a LICENSE file/, 'dated status line records completion');
    const next = section(doc, 'Next actions (top 3)');
    assert.match(next, / → /, 'next actions point at a specific file/spec');
    assert.ok(res2.brief.length <= 12, 'brief is <= 12 lines');
  },

  // AC3 (cont.) — status history is capped at 10 by the store.
  'release-progress: status history is capped at 10 entries': () => {
    const r = tmpRepo();
    const tenLines = Array.from({ length: 10 }, (_, i) => `- 2025-01-${String(i + 1).padStart(2, '0')} — seeded ${i + 1}`).join('\n');
    const seeded = TEMPLATE.replace('- 1970-01-01 — tracker initialized from template', tenLines);
    write(r, 'RELEASE.md', seeded);
    write(r, 'LICENSE', 'MIT');
    releaseProgress(r, { date: '2026-05-02' });
    const doc = readFile(r, 'RELEASE.md');
    const body = section(doc, 'Status update (latest first, capped at 10 entries)');
    const count = (body.match(/^- \d{4}-\d{2}-\d{2} —/gm) || []).length;
    assert.ok(count <= 10, `capped at 10, got ${count}`);
    assert.match(body, /2026-05-02 — completed/, 'newest completion retained');
  },

  // AC4 — human items + a Notes paragraph survive byte-identical; an obsolete human item is
  // tagged rather than deleted.
  'release-progress: human items and Notes are byte-preserved; obsolete human item tagged stale': () => {
    const r = tmpRepo();
    write(r, 'good.txt', 'present');
    const humanGood = '- [ ] Keep good.txt in sync <!-- nw:IT-aaaaaa -->';
    const humanStale = '- [ ] Wire up legacy src/old/gone.js <!-- nw:IT-bbbbbb -->';
    const notes = '## Notes (human-owned — never machine-edited)\n<!-- keep -->\nMy secret release plan.\nSecond line.\n';
    const doc0 = TEMPLATE
      .replace('## Remaining — implementation\n', `## Remaining — implementation\n${humanGood}\n${humanStale}\n`)
      .replace(/## Notes \(human-owned — never machine-edited\)[\s\S]*$/, notes);
    write(r, 'RELEASE.md', doc0);

    const outs = [];
    for (let i = 0; i < 5; i++) { releaseProgress(r, { date: '2026-02-02' }); outs.push(readFile(r, 'RELEASE.md')); }
    for (let i = 1; i < 5; i++) assert.strictEqual(outs[i], outs[0], `run ${i + 1} byte-identical to run 1`);

    const out = outs[0];
    assert.ok(out.includes(humanGood), 'live human item preserved byte-identical');
    assert.ok(out.includes('My secret release plan.\nSecond line.'), 'Notes paragraph preserved');
    assert.ok(out.includes('Wire up legacy src/old/gone.js (stale? — confirm)'), 'obsolete human item tagged stale');
    assert.ok(out.includes('gone.js'), 'stale item is tagged, not deleted');
    assert.ok(!/Keep good\.txt in sync \(stale/.test(out), 'live item is not falsely tagged');
  },

  // AC5 — no-change night: only `updated:` and one "no change" status line differ.
  'release-progress: no-change night differs only in updated + one no-change status line': () => {
    const r = tmpRepo();
    write(r, 'x.js', '1');
    releaseProgress(r, { date: '2026-03-01' });
    const a = readFile(r, 'RELEASE.md');
    const res = releaseProgress(r, { date: '2026-03-02' });
    const b = readFile(r, 'RELEASE.md');
    assert.ok(res.noChange, 'flagged as a no-change night');
    assert.notStrictEqual(a, b);
    const bFixed = b.replace('updated: 2026-03-02', 'updated: 2026-03-01').replace('- 2026-03-02 — no change\n', '');
    assert.strictEqual(bFixed, a, 'only updated: and one no-change status line changed');
    assert.ok(res.brief.length <= 12, 'brief <= 12 lines');
  },

  // AC6 — standalone functional and never redefines the release target.
  'release-progress: runs standalone and never rewrites the release target or STATE.md': () => {
    const r = tmpRepo();
    write(r, 'STATE.md', STATE_WITH_RELEASE);
    write(r, 'a.js', '1');
    const stateBefore = readFile(r, 'STATE.md');
    releaseProgress(r, { date: '2026-04-01' });
    assert.strictEqual(readFile(r, 'STATE.md'), stateBefore, 'STATE.md is never written by the job');
    const doc = readFile(r, 'RELEASE.md');
    assert.strictEqual(frontmatter(doc).target, 'My Target v9', 'target mirrors STATE, not invented');
    // No .nightwatch/out job docs were required for the run to succeed (standalone).
    assert.ok(doc.includes('## Next actions'));
  },
};
