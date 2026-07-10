'use strict';
// Story 6.6 — /nightwatch review, interactive morning review (FR44). The interactive walk lives in
// the command; the deterministic writer is tested here: listing the walk queue, byte-preserving
// checkbox rewrites in MORNING.md + the dated brief, one-row-per-decision recording via the store,
// and idempotency with the morning backfill and manual edits in either order.
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { tmpRepo, write, readFile, gitInit, commit } = require('./helpers');
const { listUnmarked, listFindings, rewriteCheckbox, applyReview } = require('../scripts/lib/review');
const { loadConfig } = require('../scripts/lib/config');
const { openTracker } = require('../scripts/lib/tracker');
const { backfillFeedback } = require('../scripts/lib/feedback');
const { collect } = require('../scripts/collect-brief');

const SCRIPTS = path.resolve(__dirname, '..', 'scripts');
const DATE = '2026-07-09';

// Hand-built in the NEW composition: each finding is an action line whose id lives only in the
// invisible `<!-- ids: <id> -->` manifest (never in the visible text), matching renderActionLine.
function brief(ids) {
  return [
    `# Nightwatch — ${DATE}`, '',
    '## Details',
    ...ids.map((id) => `- [ ] **title ${id}** → [details](#d-${id}) <!-- ids: ${id} -->`),
    '', '---', '_Review interactively with `/nightwatch review` — or mark boxes by hand._', '',
  ].join('\n');
}

// A brief whose single action line is a BUNDLE covering all `ids` (one checkbox, one manifest
// listing every id) — as collect-brief renders a group sharing one next_step.command (Story 8.3).
function bundledBrief(ids) {
  return [
    `# Nightwatch — ${DATE}`, '',
    '## Details',
    `- [ ] **bundle (${ids.length} items)** → [details](#d-${ids[0]}) <!-- ids: ${ids.join(', ')} -->`,
    '', '---', '_Review interactively with `/nightwatch review` — or mark boxes by hand._', '',
  ].join('\n');
}

/** A repo with a MORNING.md + matching dated brief holding the given brief text. */
function repoWithText(text) {
  const root = tmpRepo();
  gitInit(root);
  write(root, '.nightwatch/MORNING.md', text);
  write(root, `.nightwatch/briefs/${DATE}.md`, text);
  commit(root, 'init');
  return root;
}

/** A repo with a MORNING.md + matching dated brief holding the given finding ids. */
function repoWithBrief(ids) {
  const root = tmpRepo();
  gitInit(root);
  write(root, '.nightwatch/MORNING.md', brief(ids));
  write(root, `.nightwatch/briefs/${DATE}.md`, brief(ids));
  commit(root, 'init');
  return root;
}

/** A minimal fake tracking store (append-only feedback rows) for pure applyReview tests. */
function fakeStore() {
  const rows = [];
  return { rows, readLedger: () => rows, recordFeedback: (m) => rows.push({ type: 'feedback', ...m }) };
}

module.exports = {
  // ---- listing + checkbox rewrite are pure and byte-preserving -------------------------------
  'review: listUnmarked returns empty-box findings in brief order': () => {
    const text = brief(['rc-1', 'rc-2', 'rc-3']);
    assert.deepStrictEqual(listUnmarked(text).map((f) => f.id), ['rc-1', 'rc-2', 'rc-3']);
    const marked = rewriteCheckbox(text, 'rc-2', 'acted-on').text;
    assert.deepStrictEqual(listUnmarked(marked).map((f) => f.id), ['rc-1', 'rc-3'], 'a marked finding leaves the queue');
    assert.strictEqual(listFindings(marked).find((f) => f.id === 'rc-2').box, 'x');
  },

  'review: rewriteCheckbox changes only the target line': () => {
    const text = brief(['rc-1', 'rc-2']);
    const { text: out, changed } = rewriteCheckbox(text, 'rc-1', 'dismissed');
    assert.ok(changed);
    assert.ok(/- \[-\].*<!-- ids: rc-1 -->/.test(out), 'rc-1 dismissed');
    assert.ok(/- \[ \].*<!-- ids: rc-2 -->/.test(out), 'rc-2 untouched');
    // everything except the one box char is identical
    assert.strictEqual(out.replace('- [-]', '- [ ]'), text, 'byte-preserved except the target box');
    assert.strictEqual(rewriteCheckbox(text, 'nope', 'acted-on').changed, false, 'absent id → no change');
  },

  // ---- applyReview: rewrites both files + records exactly one row, idempotently --------------
  'review: a decision updates MORNING.md + dated brief and records one feedback row': () => {
    const root = repoWithBrief(['rc-1', 'rc-2']);
    const store = fakeStore();
    const res = applyReview(root, 'rc-1', 'acted-on', store);
    assert.strictEqual(res.status, 'recorded');
    assert.deepStrictEqual(res, { status: 'recorded', id: 'rc-1', verdict: 'acted-on', date: DATE });
    assert.ok(/- \[x\].*<!-- ids: rc-1 -->/.test(readFile(root, '.nightwatch/MORNING.md')), 'MORNING.md checkbox set');
    assert.ok(/- \[x\].*<!-- ids: rc-1 -->/.test(readFile(root, `.nightwatch/briefs/${DATE}.md`)), 'dated brief checkbox set');
    assert.strictEqual(store.rows.length, 1, 'exactly one feedback row');
    assert.deepStrictEqual(store.rows[0], { type: 'feedback', id: 'rc-1', verdict: 'acted-on', date: DATE });
  },

  'review: re-marking the same id is a stated no-op (no double-count)': () => {
    const root = repoWithBrief(['rc-1']);
    const store = fakeStore();
    assert.strictEqual(applyReview(root, 'rc-1', 'acted-on', store).status, 'recorded');
    const second = applyReview(root, 'rc-1', 'acted-on', store);
    assert.strictEqual(second.status, 'noop', 'already recorded → no-op');
    assert.strictEqual(store.rows.length, 1, 'no second row appended');
  },

  'review: an unknown id is reported not-found and records nothing': () => {
    const root = repoWithBrief(['rc-1']);
    const store = fakeStore();
    const res = applyReview(root, 'ghost', 'dismissed', store);
    assert.strictEqual(res.status, 'not-found');
    assert.strictEqual(store.rows.length, 0);
  },

  // ---- composes with the morning backfill in either order, no double-count -------------------
  'review then backfill: the backfill sees the review row and records nothing new': () => {
    const root = repoWithBrief(['rc-1', 'rc-2']);
    const { config } = loadConfig(root);
    const store = openTracker(root, config);
    applyReview(root, 'rc-1', 'acted-on', store); // review marks + records
    const recorded = backfillFeedback(root, store); // reads MORNING.md (now [x] rc-1)
    assert.strictEqual(recorded.length, 0, 'backfill double-counts nothing already recorded by review');
  },

  'backfill then review: review of a hand-marked box is a no-op': () => {
    const root = tmpRepo();
    gitInit(root);
    // Human hand-marked rc-2 acted-on before any review.
    const text = brief(['rc-1', 'rc-2']).replace('- [ ] **title rc-2**', '- [x] **title rc-2**');
    write(root, '.nightwatch/MORNING.md', text);
    write(root, `.nightwatch/briefs/${DATE}.md`, text);
    commit(root, 'init');
    const { config } = loadConfig(root);
    const store = openTracker(root, config);
    const recorded = backfillFeedback(root, store); // picks up the hand mark
    assert.strictEqual(recorded.length, 1, 'backfill recorded the hand-marked box');
    const res = applyReview(root, 'rc-2', 'acted-on', store); // now review the same finding
    assert.strictEqual(res.status, 'noop', 'review of an already-backfilled box is a no-op');
  },

  // ---- bundle fan-out: one checkbox, one row per covered id, idempotent both orders ----------
  'review: marking one id of a bundled line fans out to every covered id and flips the single box (FR60)': () => {
    const root = repoWithText(bundledBrief(['rc-1', 'rc-2', 'rc-3']));
    const store = fakeStore();
    // Mark via ANY covered id — it resolves to the whole line.
    const res = applyReview(root, 'rc-2', 'acted-on', store);
    assert.deepStrictEqual(res, { status: 'recorded', id: 'rc-2', verdict: 'acted-on', date: DATE }, 'reports the passed id');
    // One row per covered id, in manifest (first-occurrence) order.
    assert.deepStrictEqual(store.rows.map((x) => x.id), ['rc-1', 'rc-2', 'rc-3'], 'fan-out: one row per covered id');
    // The single line's box flipped in BOTH files.
    assert.ok(/- \[x\].*<!-- ids: rc-1, rc-2, rc-3 -->/.test(readFile(root, '.nightwatch/MORNING.md')), 'MORNING.md box set');
    assert.ok(/- \[x\].*<!-- ids: rc-1, rc-2, rc-3 -->/.test(readFile(root, `.nightwatch/briefs/${DATE}.md`)), 'dated brief box set');
    // Re-applying (via any covered id) is a stated no-op — no duplicate rows.
    assert.strictEqual(applyReview(root, 'rc-1', 'acted-on', store).status, 'noop', 're-mark is a no-op');
    assert.strictEqual(store.rows.length, 3, 'no duplicate rows');
    // listFindings/listUnmarked present the bundle as ONE entry carrying every id.
    const listed = listFindings(readFile(root, '.nightwatch/MORNING.md'));
    assert.strictEqual(listed.length, 1, 'a bundle is one question');
    assert.deepStrictEqual(listed[0].ids, ['rc-1', 'rc-2', 'rc-3'], 'entry carries every covered id');
    assert.strictEqual(listed[0].id, 'rc-1', 'representative id is the first covered id');
  },

  'review of a bundle then backfill records no duplicates (fan-out composes; both orders) (FR60)': () => {
    // review → backfill
    const a = repoWithText(bundledBrief(['rc-1', 'rc-2', 'rc-3']));
    let store = openTracker(a, loadConfig(a).config);
    assert.strictEqual(applyReview(a, 'rc-1', 'dismissed', store).status, 'recorded');
    assert.strictEqual(store.readLedger().filter((r) => r.type === 'feedback').length, 3, 'three fanned-out rows');
    assert.strictEqual(backfillFeedback(a, store).length, 0, 'backfill after review adds nothing');

    // backfill (hand-marked) → review
    const b = repoWithText(bundledBrief(['rc-4', 'rc-5', 'rc-6']).replace('- [ ] **bundle', '- [x] **bundle'));
    store = openTracker(b, loadConfig(b).config);
    assert.strictEqual(backfillFeedback(b, store).length, 3, 'backfill of a hand-marked bundle records three');
    assert.strictEqual(applyReview(b, 'rc-5', 'acted-on', store).status, 'noop', 'review of an already-backfilled bundle is a no-op');
  },

  // ---- CLI: --list is read-only; --id/--mark records ----------------------------------------
  'review CLI: --list prints the queue; --mark records a decision': () => {
    const root = repoWithBrief(['rc-1', 'rc-2']);
    const list = JSON.parse(execFileSync('node', [path.join(SCRIPTS, 'review-feedback.js'), '--repo', root, '--list'], { encoding: 'utf8' }));
    assert.strictEqual(list.unmarked, 2, 'two unmarked findings in the queue');

    const rec = JSON.parse(execFileSync('node', [path.join(SCRIPTS, 'review-feedback.js'), '--repo', root, '--id', 'rc-2', '--mark', 'dismissed'], { encoding: 'utf8' }));
    assert.strictEqual(rec.status, 'recorded');
    assert.ok(/- \[-\].*<!-- ids: rc-2 -->/.test(readFile(root, '.nightwatch/MORNING.md')), 'CLI rewrote the checkbox');
  },

  // ---- the brief footer names BOTH feedback methods -----------------------------------------
  'brief footer names both feedback methods (review + manual)': () => {
    const root = tmpRepo();
    gitInit(root);
    write(root, 'src/app.js', 'x\n');
    commit(root, 'init');
    collect(root, DATE);
    const footer = readFile(root, '.nightwatch/MORNING.md').split('\n').find((l) => l.startsWith('_Review'));
    assert.ok(footer, 'footer present');
    assert.ok(/\/nightwatch review/.test(footer), 'names the interactive review command');
    assert.ok(/by hand/.test(footer), 'names manual checkbox editing');
  },
};
