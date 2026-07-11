'use strict';
// Story 10.2 — collector style lints, reader-question verification & citation integrity (spec
// writing-harness P4.2/P4.3/P5). Mechanical rules are deterministic with no model call and no
// network: a lint-failing field degrades to its title, and a cited number absent from the repo's
// git history is flagged and stripped. The reader-question refutation harness mirrors the drift
// adversarial pass (injectable refuter; deterministic default refutes nothing).
const assert = require('assert');
const { tmpRepo, write, readFile, gitInit, commit, git } = require('./helpers');
const { lintProse, isClean, knownPRNumbers, checkCitations, verifyReaderQuestions } = require('../scripts/lib/lints');
const { collect } = require('../scripts/collect-brief');
const { writeFindings } = require('../scripts/lib/findings');

module.exports = {
  // ---- P4.2: deterministic style lints ------------------------------------------------------
  'lint: flags a mid-sentence hard wrap (W1)': () => {
    assert.deepStrictEqual(lintProse('one line, no wrap'), []);
    assert.deepStrictEqual(lintProse('wrapped\nmid sentence'), ['W1']);
  },

  'lint: flags a bare #N (W2) but accepts parenthesized and repo-prefixed forms': () => {
    assert.deepStrictEqual(lintProse('see #78 for context'), ['W2'], 'bare #N flagged');
    assert.deepStrictEqual(lintProse('Story 7.4: stage-0 validation (PR #78)'), [], 'parenthesized accepted');
    assert.deepStrictEqual(lintProse('landed in writing-assistant#78'), [], 'repo-prefixed accepted');
    assert.deepStrictEqual(lintProse('closed (#78) yesterday'), [], 'bare-in-parens accepted');
  },

  'lint: flags an off-vocabulary work noun only in a status/road line (W5)': () => {
    assert.deepStrictEqual(lintProse('finish the remaining work', { context: 'status' }), [], 'in-vocab noun clean');
    assert.deepStrictEqual(lintProse('three tasks left', { context: 'road' }), ['W5'], 'off-vocab noun flagged in road');
    assert.deepStrictEqual(lintProse('three tasks left', { context: 'prose' }), [], 'W5 not checked outside status/road');
    assert.strictEqual(isClean('a clean sentence'), true);
  },

  // ---- P5: deterministic citation check (no network) ----------------------------------------
  'citation: known PR numbers come from Merge-pull-request commits; unknown are flagged and stripped': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'a.txt', '1\n'); commit(r, 'Merge pull request #5 from x/y');
    const known = knownPRNumbers(r);
    assert.ok(known.has(5) && !known.has(999));
    const res = checkCitations(r, 'landed (PR #5); also (PR #999) and bare #999', { known });
    assert.deepStrictEqual(res.invalid, [999], 'only the unknown number is invalid (deduped)');
    assert.ok(res.text.includes('(PR #5)'), 'valid citation kept');
    assert.ok(!res.text.includes('#999'), 'invalid number stripped');
    assert.ok(res.text.includes('#?'), 'stripped to #?');
  },

  // ---- P4.3: adversarial reader-question harness --------------------------------------------
  'reader-question: the harness refutes fields the refuter says do not answer their question': () => {
    const fields = [
      { id: 'a', text: 'Apply the README patch', question: 'what do I do?' },
      { id: 'b', text: 'the tool ran three jobs', question: 'what do I do?' },
    ];
    const refute = (f) => /the tool ran/.test(f.text) ? { refuted: true, reason: 'narrates the run' } : false;
    const { verified, refuted } = verifyReaderQuestions(fields, refute);
    assert.deepStrictEqual(verified.map((f) => f.id), ['a']);
    assert.deepStrictEqual(refuted.map((f) => f.id), ['b']);
    // Deterministic default refutes nothing (mechanical runs keep every field).
    assert.strictEqual(verifyReaderQuestions(fields).refuted.length, 0);
  },

  // ---- e2e via collect-brief ----------------------------------------------------------------
  'e2e: a lint-failing summary degrades to the title; the brief never renders broken prose': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'a.js', '1\n'); commit(r, 'repo');
    writeFindings(r, 'repo-reconcile', '2026-07-10', [], [
      { id: 'RC-w', kind: 'drift', severity: 2, title: 'Remove the stale --bogus flag from the README', evidence: [], action: 'none', verified: true,
        next_step: { summary: 'fix\nthis wrapped summary' } }, // W1 hard wrap → degrade to title
    ]);
    collect(r, '2026-07-10');
    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.ok(brief.includes('Remove the stale --bogus flag from the README'), 'title used as the mechanical fallback');
    assert.ok(!/fix\nthis wrapped/.test(brief), 'the broken wrapped summary never renders');
  },

  'e2e: a brief citing an unknown PR flags it in Machine notes and strips its number': () => {
    const r = tmpRepo();
    gitInit(r); write(r, 'a.js', '1\n'); commit(r, 'Merge pull request #3 from x/y');
    writeFindings(r, 'repo-reconcile', '2026-07-10', [], [
      { id: 'RC-c', kind: 'drift', severity: 2, title: 'Align the docs with the merge (PR #999)', evidence: [], action: 'none', verified: true },
    ]);
    collect(r, '2026-07-10');
    const brief = readFile(r, '.nightwatch/MORNING.md');
    assert.match(brief, /Citation check: PR 999 cite no PR\/commit in this repo/, 'flagged in Machine notes');
    assert.ok(!brief.includes('#999'), 'invalid number stripped from the brief');
    assert.ok(brief.includes('#?'), 'rendered without its number');
  },
};
