'use strict';
// Story 4.4 — morning feedback loop + demotion rule, end to end (FR30/FR35).
const assert = require('assert');
const { tmpRepo, readFile, write } = require('./helpers');
const { collect, computeDemotions } = require('../scripts/collect-brief');
const { backfillFeedback, parseMarks } = require('../scripts/lib/feedback');
const { writeFindings, recurrenceCounts, appendLedger } = require('../scripts/lib/findings');
const { openTracker } = require('../scripts/lib/tracker');

/** A brief-eligible finding (verified so it reaches the brief and renders as a checkbox). */
function finding(id, over) {
  return Object.assign({ id, kind: 'drift', severity: 2, title: `t ${id}`, evidence: [], action: 'none', verified: true }, over);
}

/** Simulate the human ticking a box in the current MORNING.md: `[ ]` → `[x]`/`[-]` for one id. */
function markBox(root, id, box = 'x') {
  const text = readFile(root, '.nightwatch/MORNING.md');
  const marked = text.replace(new RegExp(`- \\[ \\] (\`${id}\`)`), `- [${box}] $1`);
  assert.notStrictEqual(marked, text, `box for ${id} was present to mark`);
  write(root, '.nightwatch/MORNING.md', marked);
}

module.exports = {
  // ---- AC1: checkbox marks in the previous brief are backfilled via recordFeedback ----
  'feedback: parseMarks reads acted-on/dismissed boxes and ignores unchecked': () => {
    const brief = [
      '# Nightwatch — morning brief (2001-01-01)',
      '- [x] `RC-aaaaaa` (sev2) acted on this',
      '- [ ] `RC-bbbbbb` (sev2) left unchecked',
      '- [-] `AR-cccccc` (sev3) dismissed this',
      '- [~] `AR-dddddd` (sev3) also dismissed',
    ].join('\n');
    const marks = parseMarks(brief);
    assert.deepStrictEqual(marks, [
      { id: 'RC-aaaaaa', verdict: 'acted-on', date: '2001-01-01' },
      { id: 'AR-cccccc', verdict: 'dismissed', date: '2001-01-01' },
      { id: 'AR-dddddd', verdict: 'dismissed', date: '2001-01-01' },
    ], 'only checked/dismissed rows, dated to the brief');
  },

  'feedback: backfill records feedback rows from a marked MORNING.md and is idempotent': () => {
    const r = tmpRepo();
    const date = '2001-02-01';
    writeFindings(r, 'repo-reconcile', date, [], [finding('RC-aaaaaa'), finding('RC-bbbbbb')]);
    collect(r, date);
    markBox(r, 'RC-aaaaaa', 'x');
    markBox(r, 'RC-bbbbbb', '-');

    const first = backfillFeedback(r, openTracker(r));
    assert.strictEqual(first.length, 2, 'both marks recorded once');
    const fb = openTracker(r).readLedger().filter((x) => x.type === 'feedback');
    assert.strictEqual(fb.length, 2);
    assert.deepStrictEqual(
      fb.find((x) => x.id === 'RC-aaaaaa'),
      { type: 'feedback', id: 'RC-aaaaaa', verdict: 'acted-on', date },
      'acted-on feedback row shape/date',
    );
    assert.strictEqual(fb.find((x) => x.id === 'RC-bbbbbb').verdict, 'dismissed');

    // Re-running the backfill against the same brief must not double-record (append-only + guard).
    const second = backfillFeedback(r, openTracker(r));
    assert.strictEqual(second.length, 0, 'no new marks on re-run');
    assert.strictEqual(openTracker(r).readLedger().filter((x) => x.type === 'feedback').length, 2);
  },

  'feedback: no previous MORNING.md → backfill is a clean no-op': () => {
    const r = tmpRepo();
    assert.deepStrictEqual(backfillFeedback(r, openTracker(r)), []);
  },

  // ---- AC2: append-only ledger deduped by stable id → recurrence is counted, not re-reported ----
  'recurrence: the same finding across runs is counted, deduped per run': () => {
    const r = tmpRepo();
    for (const date of ['2001-03-01', '2001-03-02', '2001-03-03']) {
      // Same stable id every night, plus a same-id duplicate within the night to prove dedupe.
      writeFindings(r, 'repo-reconcile', date, [], [finding('RC-zzzzzz'), finding('RC-zzzzzz')]);
      collect(r, date);
    }
    // Recurrence = one finding row per run (deduped inside the run), counted across 3 runs.
    assert.strictEqual(recurrenceCounts(r).get('RC-zzzzzz'), 3, 'counted once per night, three nights');
    const rows = openTracker(r).readLedger().filter((x) => x.type === 'finding' && x.id === 'RC-zzzzzz');
    assert.strictEqual(rows.length, 3, 'no re-report explosion — exactly one row per date');
    assert.strictEqual(new Set(rows.map((x) => x.date)).size, 3, 'one per distinct date');
  },

  // ---- AC3: three simulated nights → the demotion query answers mechanically ----
  'demotion: 3 nights, one job ignored two runs running → flagged; an acted-on job is spared': () => {
    const r = tmpRepo();
    const nights = ['2001-04-01', '2001-04-02', '2001-04-03'];
    const results = [];
    for (let n = 0; n < nights.length; n++) {
      const date = nights[n];
      // Morning feedback loop: BEFORE the jobs, the user acts on repo-reconcile's finding on
      // night 2 only (checking the box in night 1's brief), never on arch-review's.
      if (n === 1) markBox(r, 'RC-keep', 'x');
      backfillFeedback(r, openTracker(r));

      // Jobs run: both members re-surface the same stable finding every night.
      writeFindings(r, 'arch-review', date, [], [finding('AR-drop', { kind: 'arch' })]);
      writeFindings(r, 'repo-reconcile', date, [], [finding('RC-keep')]);
      results.push(collect(r, date));
    }

    // collect() computes the demotion from findings recorded on PRIOR nights (the current night's
    // rows are appended after the brief is assembled), so the flag surfaces in the brief that
    // FOLLOWS two ignored runs — principle 3's "flagged in the next brief".
    assert.deepStrictEqual(results[0].demotions, [], 'no demotion after one recorded night');
    assert.deepStrictEqual(results[1].demotions, [], 'still only one prior run of findings');
    // Night 3: arch-review has zero acted-on findings across the two prior runs → flagged.
    // repo-reconcile was acted on (feedback backfilled), so its acted count is non-zero → spared.
    assert.ok(results[2].demotions.includes('arch-review'), 'arch-review flagged after two ignored runs');
    assert.ok(!results[2].demotions.includes('repo-reconcile'), 'repo-reconcile spared by the acted-on mark');

    // The flag is surfaced in the brief the user reads next.
    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.ok(/arch-review: \*\*demotion candidate\*\*/.test(brief), 'demotion line rendered in the brief');

    // And the query answers the same whether recomputed from the ledger directly.
    assert.deepStrictEqual(computeDemotions(r), ['arch-review']);
  },

  // computeDemotions must still honour acted_on stamped directly on a finding row (back-compat with
  // the ledger shape story 4.2's demotion test relies on), independent of the feedback path.
  'demotion: acted_on stamped on a finding row still counts (no feedback row needed)': () => {
    const r = tmpRepo();
    appendLedger(r, [
      { type: 'finding', date: '2001-05-01', job: 'arch-review', id: 'AR-1', acted_on: true },
      { type: 'finding', date: '2001-05-02', job: 'arch-review', id: 'AR-1', acted_on: null },
    ]);
    assert.ok(!computeDemotions(r).includes('arch-review'), 'acted once → not a candidate');
  },
};
