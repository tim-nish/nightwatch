'use strict';
// Story 9.1 — open-finding carry-forward & per-run classification (spec finding-lifecycle P1).
// An open finding (a `finding` row with no `resolution` and no `dismissed` feedback) is carried
// into every run and classified exactly once: re-observed / resolved / still-open / not-re-examined.
// Byte-deterministic; no historical ledger row is rewritten (a forced re-run adds no duplicates).
const assert = require('assert');
const { tmpRepo, write, gitInit, commit } = require('./helpers');
const {
  openFindings, classifyOpenFindings, newClassificationRows, lifecycleCounts,
} = require('../scripts/lib/lifecycle');
const { openTracker } = require('../scripts/lib/tracker');
const { collect } = require('../scripts/collect-brief');

function fRow(id, over) { return Object.assign({ type: 'finding', id, kind: 'drift', severity: 2, date: '2026-07-09' }, over); }

module.exports = {
  // ---- open-set computation (pure) ----------------------------------------------------------
  'lifecycle: a finding with no resolution and no dismissal is open': () => {
    const open = openFindings([fRow('RC-aaa')]);
    assert.strictEqual(open.length, 1);
    assert.strictEqual(open[0].id, 'RC-aaa');
    assert.strictEqual(open[0].kind, 'drift');
  },

  'lifecycle: a resolution row closes a finding': () => {
    const open = openFindings([fRow('RC-aaa'), { type: 'resolution', id: 'RC-aaa', date: '2026-07-10', evidence: 'gone' }]);
    assert.deepStrictEqual(open.map((o) => o.id), []);
  },

  'lifecycle: a dismissed feedback row closes; acted-on does NOT': () => {
    const dismissed = openFindings([fRow('RC-aaa'), { type: 'feedback', id: 'RC-aaa', verdict: 'dismissed', date: '2026-07-10' }]);
    assert.deepStrictEqual(dismissed.map((o) => o.id), [], 'dismissed closes');
    const acted = openFindings([fRow('RC-bbb'), { type: 'feedback', id: 'RC-bbb', verdict: 'acted-on', date: '2026-07-10' }]);
    assert.deepStrictEqual(acted.map((o) => o.id), ['RC-bbb'], 'acted-on stays open (only evidence-gone resolves)');
  },

  'lifecycle: open set is oldest-first by first-seen date then id': () => {
    const rows = [
      fRow('RC-late', { date: '2026-07-11' }),
      fRow('RC-early', { date: '2026-07-05' }),
      fRow('RC-mid-b', { date: '2026-07-08' }),
      fRow('RC-mid-a', { date: '2026-07-08' }),
    ];
    assert.deepStrictEqual(openFindings(rows).map((o) => o.id), ['RC-early', 'RC-mid-a', 'RC-mid-b', 'RC-late']);
  },

  // ---- classification (pure) ----------------------------------------------------------------
  'lifecycle: re-observed ids get no row; the rest are not-re-examined by default': () => {
    const open = openFindings([fRow('RC-aaa'), fRow('RC-bbb')]);
    const results = classifyOpenFindings({ open, reobserved: new Set(['RC-aaa']), date: '2026-07-10' });
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.strictEqual(byId['RC-aaa'].classification, 're-observed');
    assert.strictEqual(byId['RC-aaa'].row, null, 're-observed writes no extra row');
    assert.strictEqual(byId['RC-bbb'].classification, 'not-re-examined');
    assert.deepStrictEqual(byId['RC-bbb'].row, { type: 'recheck', id: 'RC-bbb', date: '2026-07-10', method: 'skipped' });
  },

  'lifecycle: a classifier can resolve (resolution row) or hold still-open (recheck row)': () => {
    const open = openFindings([fRow('RC-res'), fRow('RC-hold')]);
    const classifier = (f) => f.id === 'RC-res'
      ? { classification: 'resolved', evidence: 'cited line removed' }
      : { classification: 'still-open', method: 'deterministic' };
    const results = classifyOpenFindings({ open, reobserved: [], date: '2026-07-10', classifier });
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    assert.deepStrictEqual(byId['RC-res'].row, { type: 'resolution', id: 'RC-res', date: '2026-07-10', evidence: 'cited line removed' });
    assert.deepStrictEqual(byId['RC-hold'].row, { type: 'recheck', id: 'RC-hold', date: '2026-07-10', method: 'deterministic' });
  },

  'lifecycle: newClassificationRows drops rows already in the ledger (exactly-once)': () => {
    const results = classifyOpenFindings({ open: openFindings([fRow('RC-aaa')]), reobserved: [], date: '2026-07-10' });
    const first = newClassificationRows(results, []);
    assert.strictEqual(first.length, 1, 'first run appends the row');
    const second = newClassificationRows(results, first);
    assert.strictEqual(second.length, 0, 're-run appends nothing — no historical rewrite');
  },

  'lifecycle: counts summarize the night deterministically': () => {
    const open = openFindings([fRow('RC-a'), fRow('RC-b'), fRow('RC-c')]);
    const results = classifyOpenFindings({ open, reobserved: new Set(['RC-a']), date: '2026-07-10' });
    assert.deepStrictEqual(lifecycleCounts(results), { open: 3, 're-observed': 1, resolved: 0, 'still-open': 0, 'not-re-examined': 2 });
  },

  // ---- store methods (both backends) --------------------------------------------------------
  'lifecycle: store.openFindings reflects recorded findings/resolutions (memory + markdown)': () => {
    for (const backend of ['memory', 'markdown']) {
      const t = openTracker(tmpRepo(), { tracking: { backend } });
      t.recordFindings([{ id: 'RC-aaa', kind: 'drift', severity: 2 }], { date: '2026-07-09', job: 'repo-reconcile' });
      assert.deepStrictEqual(t.openFindings().map((o) => o.id), ['RC-aaa'], `${backend}: open after finding`);
      t.recordResolution({ id: 'RC-aaa', date: '2026-07-10', evidence: 'gone' });
      assert.deepStrictEqual(t.openFindings().map((o) => o.id), [], `${backend}: closed after resolution`);
      const rows = t.readLedger();
      assert.ok(rows.some((r) => r.type === 'resolution' && r.id === 'RC-aaa' && r.evidence === 'gone'), `${backend}: resolution row shape`);
      const rc = t.recordRecheck({ id: 'RC-bbb', date: '2026-07-10', method: 'skipped' });
      assert.strictEqual(rc.type, 'recheck');
      assert.strictEqual(rc.method, 'skipped');
    }
  },

  // ---- end-to-end via collect-brief (the run-end job) ---------------------------------------
  'lifecycle: a carried-forward finding not re-observed gets one recheck skipped row; re-run adds none': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'src/a.js', '1\n'); commit(r, 'repo');
    const store = openTracker(r, { tracking: { backend: 'markdown' } });
    store.recordFindings([{ id: 'RC-old', kind: 'drift', severity: 2 }], { date: '2026-07-09', job: 'repo-reconcile' });

    collect(r, '2026-07-10'); // no docs re-observe RC-old
    const after = openTracker(r).readLedger().filter((x) => x.type === 'recheck' && x.id === 'RC-old');
    assert.strictEqual(after.length, 1, 'exactly one recheck row for the carried-forward finding');
    assert.strictEqual(after[0].method, 'skipped');
    assert.strictEqual(after[0].date, '2026-07-10');

    collect(r, '2026-07-10', { force: true }); // forced re-run must not duplicate the classification row
    const dup = openTracker(r).readLedger().filter((x) => x.type === 'recheck' && x.id === 'RC-old');
    assert.strictEqual(dup.length, 1, 'forced re-run appends no duplicate classification row');
  },
};
