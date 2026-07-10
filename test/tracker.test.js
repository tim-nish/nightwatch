'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write, readFile } = require('./helpers');
const { openTracker, itemId, parseRelease, seedFromRelease } = require('../scripts/lib/tracker');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'templates', 'RELEASE.md'), 'utf8');

const METHODS = ['listItems', 'upsertItem', 'completeItem', 'appendStatus', 'recordFindings', 'recordFeedback', 'recordRun', 'query', 'flush'];

// A finding-shaped object for recordFindings (id is what dedupe/ledger key on).
function finding(id, over) {
  return Object.assign({ id, kind: 'drift', severity: 2, title: 't', evidence: [], action: 'none', verified: false }, over);
}

// ---- Behavioral conformance: identical assertions against both backends -----------------

function behavioral(backend) {
  const open = () => openTracker(tmpRepo(), { tracking: { backend } });
  const prefix = `tracker[${backend}]`;
  return {
    [`${prefix}: exposes the full store interface`]: () => {
      const t = open();
      for (const m of METHODS) assert.strictEqual(typeof t[m], 'function', `missing ${m}`);
    },

    [`${prefix}: upsertItem is stable by key and listable`]: () => {
      const t = open();
      const a = t.upsertItem({ key: 'work/A', title: 'do A', section: 'implementation' });
      const again = t.upsertItem({ key: 'work/A', title: 'do A (reworded)', section: 'implementation' });
      assert.strictEqual(a.id, again.id, 'same key → same id');
      assert.strictEqual(a.id, itemId('work/A'));
      const open1 = t.listItems({ status: 'open' });
      assert.strictEqual(open1.length, 1, 'one item, not duplicated');
      assert.strictEqual(open1[0].title, 'do A (reworded)', 'upsert updates title');
    },

    [`${prefix}: completeItem moves to done, never deletes`]: () => {
      const t = open();
      const a = t.upsertItem({ key: 'work/A', title: 'do A', section: 'implementation' });
      t.completeItem(a.id);
      assert.strictEqual(t.listItems({ status: 'open' }).length, 0);
      const done = t.query({ status: 'done' });
      assert.strictEqual(done.length, 1, 'still present, under done');
      assert.strictEqual(done[0].id, a.id);
    },

    [`${prefix}: appendStatus is latest-first and capped at 10`]: () => {
      const t = open();
      for (let i = 1; i <= 12; i++) t.appendStatus(`update ${i}`, `2000-01-${String(i).padStart(2, '0')}`);
      const lines = t.statusLines;
      assert.ok(lines.length <= 10, `capped, got ${lines.length}`);
      assert.strictEqual(lines[0].text, 'update 12', 'latest first');
    },

    [`${prefix}: recordFindings dedupes by id; recordFeedback appends`]: () => {
      const t = open();
      const kept = t.recordFindings([finding('RC-aaa'), finding('RC-aaa'), finding('RC-bbb')], { date: '2000-01-01', job: 'repo-reconcile' });
      assert.strictEqual(kept.length, 2, 'duplicate id collapsed before append');
      t.recordFeedback({ id: 'RC-aaa', verdict: 'acted', date: '2000-01-02' });
      const rows = t.readLedger();
      const findingRows = rows.filter((r) => r.type === 'finding');
      assert.strictEqual(findingRows.filter((r) => r.id === 'RC-aaa').length, 1, 'one RC-aaa finding row');
      assert.strictEqual(rows.filter((r) => r.type === 'feedback' && r.id === 'RC-aaa').length, 1);
    },

    [`${prefix}: recordRun appends a typed per-run ledger line`]: () => {
      const t = open();
      const row = t.recordRun({ date: '2000-01-03', job: 'collect-brief', findings: 4, degraded: 1, tokens: 900 });
      assert.strictEqual(row.type, 'run', 'stamped type:run');
      const runs = t.readLedger().filter((r) => r.type === 'run' && r.job === 'collect-brief');
      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0].findings, 4);
      assert.strictEqual(runs[0].tokens, 900);
    },
  };
}

// ---- Markdown-only guarantees -----------------------------------------------------------

const markdownOnly = {
  'tracker[markdown]: parse → serialize is byte-identical on the shipped template': () => {
    const r = tmpRepo();
    const t = openTracker(r, { tracking: { backend: 'markdown' } }); // no RELEASE.md → template
    t.flush();
    assert.strictEqual(readFile(r, '.nightwatch/RELEASE.md'), TEMPLATE, 'no-op flush reproduces template bytes');
  },

  'tracker[markdown]: Notes section and human-edited item text are byte-preserved': () => {
    const r = tmpRepo();
    const humanLine = '- [ ] Human wrote this EXACT text, do not touch <!-- nw:IT-abc123 -->';
    const notes = '## Notes (human-owned — never machine-edited)\n<!-- guard -->\nMy private release plan.\nLine two.\n';
    const doc = TEMPLATE
      .replace('## Remaining — implementation\n', `## Remaining — implementation\n${humanLine}\n`)
      .replace(/## Notes \(human-owned — never machine-edited\)[\s\S]*$/, notes);
    write(r, '.nightwatch/RELEASE.md', doc);

    const t = openTracker(r, { tracking: { backend: 'markdown' } });
    t.upsertItem({ key: 'new/thing', title: 'a machine-added item', section: 'implementation' });
    t.appendStatus('did a thing', '2000-02-02');
    t.flush();

    const out = readFile(r, '.nightwatch/RELEASE.md');
    assert.ok(out.includes(humanLine), 'human item line preserved verbatim');
    assert.ok(out.includes('My private release plan.\nLine two.'), 'Notes body preserved verbatim');
    assert.ok(out.includes('a machine-added item'), 'new item rendered');
  },

  'tracker[markdown]: completed items render under Done': () => {
    const r = tmpRepo();
    const t = openTracker(r, { tracking: { backend: 'markdown' } });
    const a = t.upsertItem({ key: 'work/A', title: 'finish A', section: 'implementation' });
    t.completeItem(a.id);
    t.flush();
    const out = readFile(r, '.nightwatch/RELEASE.md');
    // Canonical reader-side order (FR63): Done sits between Nice to have and Status update, so bound
    // the completed item by ## Done and the section that follows it.
    const doneIdx = out.indexOf('## Done');
    const afterDoneIdx = out.indexOf('## Status update');
    const itemIdx = out.indexOf('finish A');
    assert.ok(itemIdx > doneIdx && itemIdx < afterDoneIdx, 'item sits in the Done section');
    assert.ok(/- \[x\] finish A/.test(out), 'rendered checked');
  },

  // Story 8.4 / FR63 — a dirtied document in the LEGACY (pre-reorder) section order re-serializes
  // into the canonical reader-side order; the Notes body and a human-authored item's raw text are
  // byte-preserved, and machine-rendered item ids trail their line.
  'tracker[markdown]: legacy-order doc re-serializes into canonical order; Notes + human raw byte-preserved; ids trail': () => {
    const r = tmpRepo();
    const humanLine = '- [ ] Human owns this EXACT text, do not touch <!-- nw:IT-abc123 -->';
    // RELEASE.md in the OLD (pre-8.4) section order (history first, next actions last).
    const legacy = [
      '---', 'phase: prototype', 'target: "v0.1"', 'progress: 0', 'updated: 1970-01-01', '---',
      '# Release progress', '',
      '## Status update (latest first, capped at 10 entries)', '- 1970-01-01 — seeded', '',
      '## Phase', '_Mirrors STATE.md `phase`._', '',
      '## Done', '<!-- completed work -->', '',
      '## Remaining — implementation', humanLine, '',
      '## Remaining — documentation', '',
      '## Release blockers', '',
      '## Human decisions needed', '',
      '## Nice to have', '',
      '## Next actions (top 3)', '',
      '## Notes (human-owned — never machine-edited)', '<!-- guard -->', 'My private plan.', 'Line two.', '',
    ].join('\n');
    write(r, '.nightwatch/RELEASE.md', legacy);

    const t = openTracker(r, { tracking: { backend: 'markdown' } });
    t.upsertItem({ key: 'new/thing', title: 'a machine-added item', section: 'implementation' });
    t.flush();

    const out = readFile(r, '.nightwatch/RELEASE.md');
    // Canonical reader-side order: Next → Blockers → Decisions → impl → docs → Nice → Done → Status → Phase → Notes.
    const order = [
      '## Next actions (top 3)', '## Release blockers', '## Human decisions needed',
      '## Remaining — implementation', '## Remaining — documentation', '## Nice to have',
      '## Done', '## Status update', '## Phase', '## Notes',
    ].map((h) => out.indexOf(h));
    assert.ok(order.every((i) => i >= 0), 'every canonical section present');
    for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `section ${i} follows ${i - 1} in canonical order`);
    // Byte-preservation: the human item's raw line and the Notes body survive verbatim.
    assert.ok(out.includes(humanLine), 'human item raw line preserved verbatim');
    assert.ok(out.includes('My private plan.\nLine two.'), 'Notes body byte-preserved');
    // The machine-added item's id trails the line (id marker at the END).
    const mLine = out.split('\n').find((l) => l.includes('a machine-added item'));
    assert.match(mLine, /<!-- nw:IT-[0-9a-f]{6} -->\s*$/, 'machine item id trails the line');
  },

  // Story 8.4 / FR63 — a legacy leading-id item line parses to the same {id,title,done} as the
  // canonical trailing-id form (so a pre-reorder file still reads correctly).
  'tracker[markdown]: a legacy leading-id item parses to the same item as the trailing-id form': () => {
    const mk = (itemLine) => [
      '---', 'progress: 0', '---', '# Release progress', '',
      '## Remaining — implementation', itemLine, '',
      '## Notes (human-owned — never machine-edited)', '',
    ].join('\n');
    const leading = seedFromRelease(parseRelease(mk('- [ ] IT-abc123 — Do the thing'))).items;
    const trailing = seedFromRelease(parseRelease(mk('- [ ] Do the thing <!-- nw:IT-abc123 -->'))).items;
    assert.strictEqual(leading.length, 1, 'leading form parses one item');
    assert.strictEqual(trailing.length, 1, 'trailing form parses one item');
    assert.strictEqual(leading[0].id, trailing[0].id, 'same id');
    assert.strictEqual(leading[0].title, trailing[0].title, 'same title');
    assert.strictEqual(leading[0].status, trailing[0].status, 'same status');
  },

  // Story 8.4 / NFR8 — a re-serialized tracker renders byte-identically across two runs.
  'tracker[markdown]: a re-serialized tracker is byte-identical across two runs (determinism)': () => {
    const r = tmpRepo();
    const t1 = openTracker(r, { tracking: { backend: 'markdown' } });
    t1.upsertItem({ key: 'work/A', title: 'do A', section: 'implementation' });
    t1.appendStatus('did a thing', '2000-01-01');
    t1.flush();
    const first = readFile(r, '.nightwatch/RELEASE.md');
    // Re-open (seeds from the just-written file), dirty it identically, and re-serialize.
    const t2 = openTracker(r, { tracking: { backend: 'markdown' } });
    t2.upsertItem({ key: 'work/A', title: 'do A', section: 'implementation' });
    t2.flush();
    assert.strictEqual(readFile(r, '.nightwatch/RELEASE.md'), first, 're-serialize is byte-identical');
  },

  'tracker: unknown backend → setup finding, markdown fallback, no partial writes': () => {
    const r = tmpRepo();
    const t = openTracker(r, { tracking: { backend: 'sqlite' } });
    assert.strictEqual(t.backend, 'markdown', 'fell back to markdown');
    assert.strictEqual(t.setupFindings.length, 1);
    assert.strictEqual(t.setupFindings[0].kind, 'setup');
    assert.match(t.setupFindings[0].title, /Unknown tracking backend "sqlite"/);
    assert.strictEqual(fs.existsSync(path.join(r, '.nightwatch', 'RELEASE.md')), false, 'no write happened on open (no migration)');
  },

  // AC — `tracking.backend: beads` with no `bd` on PATH → setup finding naming the missing tool,
  // markdown fallback, no crash, no partial write. PATH is emptied to make the probe deterministic.
  'tracker: recognized backend beads with no bd on PATH → setup finding names bd, markdown fallback': () => {
    const r = tmpRepo();
    const savedPath = process.env.PATH;
    process.env.PATH = ''; // local-only probe resolves nothing → bd unavailable, deterministically
    let t;
    try { t = openTracker(r, { tracking: { backend: 'beads' } }); }
    finally { process.env.PATH = savedPath; }
    assert.strictEqual(t.backend, 'markdown', 'fell back to markdown');
    assert.strictEqual(t.setupFindings.length, 1);
    assert.strictEqual(t.setupFindings[0].kind, 'setup');
    assert.match(t.setupFindings[0].title, /"bd" on PATH/, 'names the missing tool');
    assert.strictEqual(fs.existsSync(path.join(r, '.nightwatch', 'RELEASE.md')), false, 'no partial write on open (no migration)');
    // A no-op flush after fallback still just serializes the markdown template — no crash.
    t.flush();
    assert.strictEqual(readFile(r, '.nightwatch/RELEASE.md'), TEMPLATE, 'fallback backend writes clean markdown');
  },

  // backlogmd is likewise recognized and probes for `backlog`.
  'tracker: recognized backend backlogmd with no backlog on PATH → setup finding names backlog': () => {
    const r = tmpRepo();
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    let t;
    try { t = openTracker(r, { tracking: { backend: 'backlogmd' } }); }
    finally { process.env.PATH = savedPath; }
    assert.strictEqual(t.backend, 'markdown');
    assert.match(t.setupFindings[0].title, /"backlog" on PATH/);
    assert.strictEqual(fs.existsSync(path.join(r, '.nightwatch', 'RELEASE.md')), false, 'no partial write');
  },
};

module.exports = Object.assign({}, behavioral('markdown'), behavioral('memory'), markdownOnly);
