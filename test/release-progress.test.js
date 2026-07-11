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

/** Write a foreign job's findings doc where release-progress reads it (`.nightwatch/runtime/out/…`). */
function writeForeign(root, job, date, findings) {
  const doc = { schema: 1, job, date, degraded: [], findings };
  write(root, `.nightwatch/runtime/out/${job}-${date}.json`, JSON.stringify(doc, null, 2) + '\n');
}

module.exports = {
  // AC1 — fresh repo: valid RELEASE.md instantiated via the store, generic items only, notice set.
  'release-progress: fresh repo instantiates RELEASE.md with generic items + notice': () => {
    const r = tmpRepo();
    write(r, 'a.js', 'const x = 1;');
    const res = releaseProgress(r, { date: '2026-01-01' });
    const doc = readFile(r, '.nightwatch/RELEASE.md');
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
    const d1 = readFile(r, '.nightwatch/RELEASE.md');
    const fm = frontmatter(d1);
    assert.strictEqual(fm.target, 'My Target v9', 'target read from STATE');
    assert.ok(fm.notice == null, 'notice dropped once release: is declared');
    assert.ok(d1.includes('All commands have specs and the reconciler reports 0 drift'), 'non-generic DoD item added');
    assert.ok(!d1.includes('Provide a LICENSE'), 'DoD line folded onto the generic LICENSE item (no duplicate)');
    // Second night, nothing changed → ids of existing items are unchanged.
    releaseProgress(r, { date: '2026-01-02' });
    const d2 = readFile(r, '.nightwatch/RELEASE.md');
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
    const doc = readFile(r, '.nightwatch/RELEASE.md');
    assert.match(doc, /- \[x\] Ship a LICENSE file — evidence: LICENSE/, 'completed with closing evidence');
    assert.match(doc, /2026-01-02 — Done: Ship a LICENSE file/, 'dated status line records completion');
    const next = section(doc, 'Next actions (top 3)');
    assert.match(next, / → /, 'next actions point at a specific file/spec');
    assert.ok(res2.brief.length <= 12, 'brief is <= 12 lines');
  },

  // AC3 (cont.) — status history is capped at 10 by the store.
  'release-progress: status history is capped at 10 entries': () => {
    const r = tmpRepo();
    const tenLines = Array.from({ length: 10 }, (_, i) => `- 2025-01-${String(i + 1).padStart(2, '0')} — seeded ${i + 1}`).join('\n');
    const seeded = TEMPLATE.replace('- 1970-01-01 — tracker initialized from template', tenLines);
    write(r, '.nightwatch/RELEASE.md', seeded);
    write(r, 'LICENSE', 'MIT');
    releaseProgress(r, { date: '2026-05-02' });
    const doc = readFile(r, '.nightwatch/RELEASE.md');
    const body = section(doc, 'What changed lately (latest first, capped at 10 entries)');
    const count = (body.match(/^- \d{4}-\d{2}-\d{2} —/gm) || []).length;
    assert.ok(count <= 10, `capped at 10, got ${count}`);
    assert.match(body, /2026-05-02 — Done/, 'newest completion retained');
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
    write(r, '.nightwatch/RELEASE.md', doc0);

    const outs = [];
    for (let i = 0; i < 5; i++) { releaseProgress(r, { date: '2026-02-02' }); outs.push(readFile(r, '.nightwatch/RELEASE.md')); }
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
    const a = readFile(r, '.nightwatch/RELEASE.md');
    const res = releaseProgress(r, { date: '2026-03-02' });
    const b = readFile(r, '.nightwatch/RELEASE.md');
    assert.ok(res.noChange, 'flagged as a no-change night');
    assert.notStrictEqual(a, b);
    const bFixed = b.replace('updated: 2026-03-02', 'updated: 2026-03-01').replace('- 2026-03-02 — No forward movement; nothing needs you.\n', '');
    assert.strictEqual(bFixed, a, 'only updated: and one no-change status line changed');
    assert.ok(res.brief.length <= 12, 'brief <= 12 lines');
  },

  // AC (2.3) — a severity-1 finding is promoted under "Release blockers" and a human-decision
  // finding under "Human decisions needed", each cross-referenced by its source finding id.
  'release-progress: promotes severity-1 → Release blockers and human-decision → Human decisions, by id': () => {
    const r = tmpRepo();
    write(r, 'a.js', '1');
    writeForeign(r, 'repo-reconcile', '2026-06-01', [
      { id: 'RC-b10c1a', kind: 'blocker', severity: 1, title: 'Quickstart command errors on a fresh clone', evidence: [{ path: 'README.md', line: 12 }], action: 'none', verified: true },
    ]);
    writeForeign(r, 'arch-review', '2026-06-01', [
      { id: 'AR-dec151', kind: 'decision', severity: 3, title: 'Pick a single auth model before release', evidence: [{ path: 'src/auth.js' }], action: 'human-decision', verified: true },
    ]);
    const res = releaseProgress(r, { date: '2026-06-01' });
    const doc = readFile(r, '.nightwatch/RELEASE.md');
    const blockers = section(doc, 'Release blockers');
    const decisions = section(doc, 'Human decisions needed');
    assert.match(blockers, /Quickstart command errors on a fresh clone \(RC-b10c1a\)/, 'blocker promoted with id cross-reference');
    assert.match(decisions, /Pick a single auth model before release \(AR-dec151\)/, 'decision promoted with id cross-reference');
    assert.ok(res.brief.join('\n').includes('RC-b10c1a'), 'new blocker id surfaced in brief');
    assert.ok(res.brief.join('\n').includes('AR-dec151'), 'new decision id surfaced in brief');
  },

  // AC (2.3, main gap) — a promoted item whose source finding no longer appears the next night
  // clears automatically: it moves to Done with closing evidence, its id stays stable, and a dated
  // status line records the completion. A human-added blocker with no id is never auto-cleared.
  'release-progress: promoted blocker clears to Done when its source finding disappears': () => {
    const r = tmpRepo();
    write(r, 'a.js', '1');
    // A human-added blocker (no source id) must survive the auto-clear pass untouched.
    const humanBlocker = '- [ ] Legal review of third-party licensing <!-- nw:IT-cccccc -->';
    // Night 1: reconcile reports the blocker → it lands under Release blockers.
    writeForeign(r, 'repo-reconcile', '2026-06-01', [
      { id: 'RC-b10c1a', kind: 'blocker', severity: 1, title: 'Quickstart command errors', evidence: [{ path: 'README.md', line: 12 }], action: 'none', verified: true },
    ]);
    releaseProgress(r, { date: '2026-06-01' });
    let doc = readFile(r, '.nightwatch/RELEASE.md');
    // Hand-add the human blocker into the same section after night 1.
    doc = doc.replace('## Release blockers\n', `## Release blockers\n${humanBlocker}\n`);
    write(r, '.nightwatch/RELEASE.md', doc);
    // Read the promoted blocker's id from the Release blockers section specifically: in the canonical
    // reader-side order (FR63) the Next actions section leads and echoes the blocker's title, so a
    // whole-doc scan would pick up the next-action slot's id instead of the blocker's.
    const promotedId = nwIdOf(section(doc, 'Release blockers'), 'Quickstart command errors');
    assert.ok(promotedId, 'promoted blocker has an id');
    const blockers1 = section(doc, 'Release blockers');
    assert.match(blockers1, /- \[ \] Quickstart command errors \(RC-b10c1a\)/, 'open under Release blockers night 1');

    // Night 2: reconcile reran (doc present) and no longer reports the finding → auto-clear.
    writeForeign(r, 'repo-reconcile', '2026-06-02', []);
    const res2 = releaseProgress(r, { date: '2026-06-02' });
    const doc2 = readFile(r, '.nightwatch/RELEASE.md');
    const done = section(doc2, 'Done');
    assert.match(done, /- \[x\] Quickstart command errors \(RC-b10c1a\) — evidence: \.nightwatch\/out\/repo-reconcile-2026-06-02\.json/, 'cleared to Done with closing evidence');
    assert.strictEqual(nwIdOf(done, 'Quickstart command errors'), promotedId, 'promoted item id stable across the clear');
    assert.match(doc2, /2026-06-02 — Done: Quickstart command errors \(RC-b10c1a\)/, 'dated status line records the clear');
    // The human blocker is never auto-completed.
    assert.ok(doc2.includes(humanBlocker), 'human-added blocker survives the auto-clear untouched');
    assert.ok(!res2.noChange, 'clearing is a material change');
  },

  // AC (2.3) — when the emitting job did NOT rerun (no findings doc tonight) we cannot tell resolved
  // from not-run, so the promoted item is left in place rather than falsely cleared.
  'release-progress: promoted blocker is NOT cleared when its emitting job did not run': () => {
    const r = tmpRepo();
    write(r, 'a.js', '1');
    writeForeign(r, 'repo-reconcile', '2026-07-01', [
      { id: 'RC-b10c1a', kind: 'blocker', severity: 1, title: 'Quickstart command errors', evidence: [{ path: 'README.md', line: 12 }], action: 'none', verified: true },
    ]);
    releaseProgress(r, { date: '2026-07-01' });
    // Night 2: no reconcile doc at all → job did not run → keep the blocker open.
    releaseProgress(r, { date: '2026-07-02' });
    const doc2 = readFile(r, '.nightwatch/RELEASE.md');
    const blockers = section(doc2, 'Release blockers');
    assert.match(blockers, /- \[ \] Quickstart command errors \(RC-b10c1a\)/, 'blocker still open when its job did not rerun');
    assert.ok(!/- \[x\] Quickstart command errors/.test(doc2), 'not moved to Done');
  },

  // AC (2.3) — a malformed RELEASE.md writes nothing, emits a setup finding, and returns a brief
  // carrying last night's snapshot (progress/updated) with an explicit staleness notice.
  'release-progress: malformed RELEASE.md → nothing written, setup finding, stale-snapshot brief': () => {
    const r = tmpRepo();
    write(r, 'a.js', '1');
    // Frontmatter fence broken by a hand-edit (closing --- gone), but progress/updated still present.
    const malformed = [
      '---',
      'phase: hardening',
      'target: "v1"',
      'progress: 42',
      'updated: 2026-01-05',
      '# Release progress',
      '## Notes',
      'oops I deleted the closing fence',
      '',
    ].join('\n');
    write(r, '.nightwatch/RELEASE.md', malformed);
    const res = releaseProgress(r, { date: '2026-01-06' });
    assert.strictEqual(res.wrote, false, 'nothing written');
    assert.strictEqual(res.malformed, true);
    assert.strictEqual(readFile(r, '.nightwatch/RELEASE.md'), malformed, 'RELEASE.md left byte-identical');
    const setup = res.findings.find((f) => f.kind === 'setup');
    assert.ok(setup, 'a setup finding is emitted');
    assert.match(setup.title, /frontmatter/i, 'setup finding points at the parse error');
    assert.ok(res.brief.length && res.brief.length <= 12, 'brief present and <= 12 lines');
    const briefText = res.brief.join('\n');
    assert.match(briefText, /stale/i, 'brief carries an explicit staleness notice');
    assert.match(briefText, /42%/, "brief carries last night's progress snapshot");
    assert.match(briefText, /2026-01-05/, "brief carries last night's updated date");
  },

  // AC6 — standalone functional and never redefines the release target.
  'release-progress: runs standalone and never rewrites the release target or STATE.md': () => {
    const r = tmpRepo();
    write(r, 'STATE.md', STATE_WITH_RELEASE);
    write(r, 'a.js', '1');
    const stateBefore = readFile(r, 'STATE.md');
    releaseProgress(r, { date: '2026-04-01' });
    assert.strictEqual(readFile(r, 'STATE.md'), stateBefore, 'STATE.md is never written by the job');
    const doc = readFile(r, '.nightwatch/RELEASE.md');
    assert.strictEqual(frontmatter(doc).target, 'My Target v9', 'target mirrors STATE, not invented');
    // No .nightwatch/out job docs were required for the run to succeed (standalone).
    assert.ok(doc.includes('## Next actions'));
  },
};
