'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpRepo, write, readFile } = require('./helpers');
const { openTracker, itemId } = require('../scripts/lib/tracker');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'templates', 'RELEASE.md'), 'utf8');

const METHODS = ['listItems', 'upsertItem', 'completeItem', 'appendStatus', 'recordFindings', 'recordFeedback', 'query', 'flush'];

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
  };
}

// ---- Markdown-only guarantees -----------------------------------------------------------

const markdownOnly = {
  'tracker[markdown]: parse → serialize is byte-identical on the shipped template': () => {
    const r = tmpRepo();
    const t = openTracker(r, { tracking: { backend: 'markdown' } }); // no RELEASE.md → template
    t.flush();
    assert.strictEqual(readFile(r, 'RELEASE.md'), TEMPLATE, 'no-op flush reproduces template bytes');
  },

  'tracker[markdown]: Notes section and human-edited item text are byte-preserved': () => {
    const r = tmpRepo();
    const humanLine = '- [ ] Human wrote this EXACT text, do not touch <!-- nw:IT-abc123 -->';
    const notes = '## Notes (human-owned — never machine-edited)\n<!-- guard -->\nMy private release plan.\nLine two.\n';
    const doc = TEMPLATE
      .replace('## Remaining — implementation\n', `## Remaining — implementation\n${humanLine}\n`)
      .replace(/## Notes \(human-owned — never machine-edited\)[\s\S]*$/, notes);
    write(r, 'RELEASE.md', doc);

    const t = openTracker(r, { tracking: { backend: 'markdown' } });
    t.upsertItem({ key: 'new/thing', title: 'a machine-added item', section: 'implementation' });
    t.appendStatus('did a thing', '2000-02-02');
    t.flush();

    const out = readFile(r, 'RELEASE.md');
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
    const out = readFile(r, 'RELEASE.md');
    const doneIdx = out.indexOf('## Done');
    const implIdx = out.indexOf('## Remaining — implementation');
    const itemIdx = out.indexOf('finish A');
    assert.ok(itemIdx > doneIdx && itemIdx < implIdx, 'item sits in the Done section');
    assert.ok(/- \[x\] finish A/.test(out), 'rendered checked');
  },

  'tracker: unknown backend → setup finding, markdown fallback, no partial writes': () => {
    const r = tmpRepo();
    const t = openTracker(r, { tracking: { backend: 'sqlite' } });
    assert.strictEqual(t.backend, 'markdown', 'fell back to markdown');
    assert.strictEqual(t.setupFindings.length, 1);
    assert.strictEqual(t.setupFindings[0].kind, 'setup');
    assert.strictEqual(fs.existsSync(path.join(r, 'RELEASE.md')), false, 'no write happened on open (no migration)');
  },
};

module.exports = Object.assign({}, behavioral('markdown'), behavioral('memory'), markdownOnly);
