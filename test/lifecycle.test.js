'use strict';
// Story 9.1 — open-finding carry-forward & per-run classification (spec finding-lifecycle P1).
// An open finding (a `finding` row with no `resolution` and no `dismissed` feedback) is carried
// into every run and classified exactly once: re-observed / resolved / still-open / not-re-examined.
// Byte-deterministic; no historical ledger row is rewritten (a forced re-run adds no duplicates).
const assert = require('assert');
const { tmpRepo, write, readFile, gitInit, commit } = require('./helpers');
const {
  openFindings, classifyOpenFindings, newClassificationRows, lifecycleCounts,
  deterministicFloor, floorClassifier, carveRecheckBudget, planRecheck,
  runOrdinal, gcPatches,
} = require('../scripts/lib/lifecycle');
const { openTracker } = require('../scripts/lib/tracker');
const { collect } = require('../scripts/collect-brief');

function fRow(id, over) { return Object.assign({ type: 'finding', id, kind: 'drift', severity: 2, date: '2026-07-09' }, over); }
function drift(id, evidence, text) { return { id, kind: 'drift', evidence, text }; }

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

  // ---- P2: deterministic re-verification floor ----------------------------------------------
  'floor: a drift finding whose cited path is gone → resolved (absence conclusive)': () => {
    const r = tmpRepo();
    const v = deterministicFloor(drift('RC-a', [{ path: 'gone.md', line: 3 }], 'the claim'), r);
    assert.strictEqual(v.classification, 'resolved');
    assert.match(v.evidence, /gone\.md no longer exists/);
  },

  'floor: a drift finding whose cited text is removed → resolved naming the locus': () => {
    const r = tmpRepo();
    write(r, 'README.md', 'line 1\nline 2\nunrelated\nline 4\n');
    const v = deterministicFloor(drift('RC-a', [{ path: 'README.md', line: 2 }], 'the drifted claim'), r);
    assert.strictEqual(v.classification, 'resolved');
    assert.match(v.evidence, /cited text no longer present at README\.md:2/);
  },

  'floor: cited text still present at/near the cited line → still-open deterministic (the RC-615fba check)': () => {
    const r = tmpRepo();
    write(r, 'README.md', 'a\nb\n--flag still documented here\nd\n');
    const v = deterministicFloor(drift('RC-a', [{ path: 'README.md', line: 3 }], '--flag still documented'), r);
    assert.deepStrictEqual(v, { classification: 'still-open', method: 'deterministic' });
  },

  'floor: a non-drift kind with a missing path escalates (absence inconclusive)': () => {
    const r = tmpRepo();
    const v = deterministicFloor({ id: 'AR-a', kind: 'arch', evidence: [{ path: 'gone.js' }], text: 'x' }, r);
    assert.strictEqual(v.classification, 'escalate');
  },

  'floor: no checkable locus → escalate': () => {
    assert.strictEqual(deterministicFloor({ id: 'X', kind: 'drift', evidence: [] }, tmpRepo()).classification, 'escalate');
  },

  'floor: path present but no recorded cited text → still-open (conservative)': () => {
    const r = tmpRepo();
    write(r, 'a.js', 'still here\n');
    const v = deterministicFloor({ id: 'RC-a', kind: 'drift', evidence: [{ path: 'a.js' }] }, r);
    assert.strictEqual(v.classification, 'still-open');
  },

  'floor: floorClassifier maps escalate → not-re-examined unless a judgment verdict is supplied': () => {
    const r = tmpRepo();
    const f = { id: 'AR-a', kind: 'arch', evidence: [{ path: 'gone.js' }], text: 'x' };
    assert.strictEqual(floorClassifier(r)(f).classification, 'not-re-examined');
    const judged = { 'AR-a': { classification: 'still-open', method: 'judgment' } };
    assert.deepStrictEqual(floorClassifier(r, { judged })(f), { classification: 'still-open', method: 'judgment' });
  },

  // ---- P3: budget carve + oldest-first recheck planning -------------------------------------
  'budget: recheck reserve is carved off the top before discovery': () => {
    assert.deepStrictEqual(carveRecheckBudget(200000, 0.15), { reserve: 30000, discovery: 170000 });
    assert.deepStrictEqual(carveRecheckBudget(100000, 0), { reserve: 0, discovery: 100000 });
    assert.deepStrictEqual(carveRecheckBudget(0, 0.15), { reserve: 0, discovery: 0 });
    assert.deepStrictEqual(carveRecheckBudget(100, 5), { reserve: 100, discovery: 0 }, 'fraction clamped to 1');
  },

  'budget: planRecheck reaches oldest-first until the reserve is spent; the rest skip': () => {
    const escalated = ['a', 'b', 'c', 'd'].map((id) => ({ id })); // oldest-first
    const { reached, skipped } = planRecheck(escalated, { reserve: 25, costPer: 10 });
    assert.deepStrictEqual(reached.map((f) => f.id), ['a', 'b'], 'two fit into 25 at cost 10');
    assert.deepStrictEqual(skipped.map((f) => f.id), ['c', 'd'], 'the rest are not-re-examined');
  },

  // ---- evidence persistence: the floor can re-check from the ledger alone --------------------
  'lifecycle: recordFindings persists evidence + cited text so openFindings carries them': () => {
    const t = openTracker(tmpRepo(), { tracking: { backend: 'markdown' } });
    t.recordFindings([{ id: 'RC-a', kind: 'drift', severity: 2, evidence: [{ path: 'README.md', line: 4 }], text: 'cited' }], { date: '2026-07-09', job: 'repo-reconcile' });
    const open = t.openFindings();
    assert.strictEqual(open.length, 1);
    assert.deepStrictEqual(open[0].evidence, [{ path: 'README.md', line: 4 }]);
    assert.strictEqual(open[0].text, 'cited');
  },

  // ---- end-to-end via collect-brief (the run-end job) ---------------------------------------
  'floor e2e: a carried-forward drift finding whose cited path vanished is resolved by collect-brief': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'keep.js', '1\n'); commit(r, 'repo');
    const store = openTracker(r, { tracking: { backend: 'markdown' } });
    // Recorded on a prior date, citing a path that does not exist this run → deterministic resolved.
    store.recordFindings([{ id: 'RC-gone', kind: 'drift', severity: 2, evidence: [{ path: 'deleted.md', line: 1 }], text: 'old claim' }], { date: '2026-07-09', job: 'repo-reconcile' });
    collect(r, '2026-07-10');
    const rows = openTracker(r).readLedger();
    assert.ok(rows.some((x) => x.type === 'resolution' && x.id === 'RC-gone'), 'a resolution row was written');
    assert.deepStrictEqual(openTracker(r).openFindings().map((o) => o.id), [], 'the finding left the open set');
  },

  'lifecycle: a carried-forward finding not re-observed gets one recheck skipped row; an unforced re-run adds none': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'src/a.js', '1\n'); commit(r, 'repo');
    const store = openTracker(r, { tracking: { backend: 'markdown' } });
    store.recordFindings([{ id: 'RC-old', kind: 'drift', severity: 2 }], { date: '2026-07-09', job: 'repo-reconcile' });

    collect(r, '2026-07-10'); // no docs re-observe RC-old
    const after = openTracker(r).readLedger().filter((x) => x.type === 'recheck' && x.id === 'RC-old');
    assert.strictEqual(after.length, 1, 'exactly one recheck row for the carried-forward finding');
    assert.strictEqual(after[0].method, 'skipped');
    assert.strictEqual(after[0].date, '2026-07-10');

    collect(r, '2026-07-10'); // unforced same-night re-run is a no-op (guard blocks the append)
    const dup = openTracker(r).readLedger().filter((x) => x.type === 'recheck' && x.id === 'RC-old');
    assert.strictEqual(dup.length, 1, 'unforced re-run appends nothing');
  },

  // ---- P5/P6: run-ordinal, forced-run ledger traces, patch preservation & GC ---------------
  'p6: run-ordinal counts completed collect-brief runs for a date': () => {
    const rows = [
      { type: 'run', job: 'collect-brief', date: '2026-07-10' },
      { type: 'run', job: 'repo-reconcile', date: '2026-07-10' },
      { type: 'run', job: 'collect-brief', date: '2026-07-11' },
    ];
    assert.strictEqual(runOrdinal(rows, '2026-07-10'), 1);
    assert.strictEqual(runOrdinal(rows, '2026-07-09'), 0);
  },

  'p6: newClassificationRows keys on run-ordinal — a forced re-run writes a distinct row': () => {
    const results = classifyOpenFindings({ open: openFindings([fRow('RC-a')]), reobserved: [], date: '2026-07-10' });
    const first = newClassificationRows(results, [], 0);
    assert.strictEqual(first.length, 1);
    assert.strictEqual(first[0].run_ordinal, undefined, 'ordinal 0 stays unstamped (byte-identical to 9.1)');
    const forced = newClassificationRows(results, first, 1);
    assert.strictEqual(forced.length, 1, 'a forced re-run (ordinal 1) writes a distinct row');
    assert.strictEqual(forced[0].run_ordinal, 1);
    assert.strictEqual(newClassificationRows(results, [...first, ...forced], 1).length, 0, 'the same ordinal never duplicates');
  },

  'p6: a forced re-run appends forced:true run rows and a distinct classification row': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'src/a.js', '1\n'); commit(r, 'repo');
    openTracker(r, { tracking: { backend: 'markdown' } })
      .recordFindings([{ id: 'RC-old', kind: 'drift', severity: 2 }], { date: '2026-07-09', job: 'repo-reconcile' });
    collect(r, '2026-07-10');
    collect(r, '2026-07-10', { force: true });
    const rows = openTracker(r).readLedger();
    const cbRuns = rows.filter((x) => x.type === 'run' && x.job === 'collect-brief' && x.date === '2026-07-10');
    assert.strictEqual(cbRuns.length, 2, 'two collect-brief run rows (first + forced)');
    assert.ok(cbRuns.some((x) => x.forced === true && x.run_ordinal === 1), 'forced re-run row stamped forced:true, ordinal 1');
    const rechecks = rows.filter((x) => x.type === 'recheck' && x.id === 'RC-old');
    assert.strictEqual(rechecks.length, 2, 'one recheck per (id,date,ordinal): ordinals 0 and 1');
  },

  'p5: gcPatches removes only the closed patch files, preserving open ones (sorted)': () => {
    const r = tmpRepo();
    write(r, '.nightwatch/runtime/out/reconcile-2026-07-10-RC-open.patch', 'x');
    write(r, '.nightwatch/runtime/out/reconcile-2026-07-10-RC-done.patch', 'y');
    write(r, '.nightwatch/runtime/out/reconcile-2026-07-09-RC-done.patch', 'z'); // older date, same closed id
    const removed = gcPatches(r, new Set(['RC-done']));
    assert.deepStrictEqual(removed, [
      '.nightwatch/runtime/out/reconcile-2026-07-09-RC-done.patch',
      '.nightwatch/runtime/out/reconcile-2026-07-10-RC-done.patch',
    ], 'both dates of the closed finding removed, sorted');
    assert.ok(readFile(r, '.nightwatch/runtime/out/reconcile-2026-07-10-RC-open.patch') != null, 'the open finding patch is preserved');
  },

  'p5 e2e: collect-brief GCs a resolved finding\'s patch and names it in Machine notes': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'keep.js', '1\n'); commit(r, 'repo');
    const store = openTracker(r, { tracking: { backend: 'markdown' } });
    // An open drift finding citing a now-missing path (→ deterministic resolved this run), with a
    // staged per-finding patch on disk.
    store.recordFindings([{ id: 'RC-gone', kind: 'drift', severity: 2, evidence: [{ path: 'deleted.md', line: 1 }], text: 'old' }], { date: '2026-07-09', job: 'repo-reconcile' });
    write(r, '.nightwatch/runtime/out/reconcile-2026-07-09-RC-gone.patch', 'stale patch');
    collect(r, '2026-07-10');
    assert.strictEqual(readFile(r, '.nightwatch/runtime/out/reconcile-2026-07-09-RC-gone.patch'), null, 'the resolved finding patch was collected');
    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.match(brief, /Collected 1 stale patch \(finding resolved\/dismissed\): `\.nightwatch\/runtime\/out\/reconcile-2026-07-09-RC-gone\.patch`/, 'one Machine-notes GC line');
  },
};
