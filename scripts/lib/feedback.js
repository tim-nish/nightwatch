// @ts-check
'use strict';
// Morning feedback loop (FR35, spec §6). collect-brief renders each brief finding as a checkbox;
// a human checks `[x]` overnight to mark it acted-on (or `[-]`/`[~]` to dismiss it). On the NEXT
// run, BEFORE the member jobs run, we parse the previous MORNING.md and backfill those marks into
// .nightwatch/ledger.jsonl via the tracking store's recordFeedback() — the sole sanctioned ledger
// writer (§2.7). The demotion rule (principle 3) then reads these marks, so a job whose findings
// the user keeps ignoring two runs running proposes its own retirement.
const path = require('path');
const { nwDir, readFileSafe } = require('./util');

// Recognised checkbox states in a rendered brief item. `[x]`/`[X]` = acted-on; `[-]`/`[~]` =
// dismissed. The finding id is the backtick-wrapped token collect-brief renders right after the
// box (renderItem: `- [ ] \`${id}\` (sev…) …`), so identity survives freeform edits to the text.
const MARK_RE = /^\s*- \[([xX~-])\]\s+`([^`]+)`/;
const VERDICT = { x: 'acted-on', '~': 'dismissed', '-': 'dismissed' };

/** The brief header stamps the date whose findings these checkboxes refer to. */
function briefDate(text) {
  const m = (text || '').match(/morning brief \((\d{4}-\d{2}-\d{2})\)/);
  return m ? m[1] : '';
}

/**
 * Parse a rendered brief for checked / dismissed items → `[{id, verdict, date}]`, deduped by id
 * (first mark for an id wins). `date` is the brief's own date. Exposed for tests.
 * @param {string} text
 * @returns {Array<{id:string, verdict:string, date:string}>}
 */
function parseMarks(text) {
  const date = briefDate(text);
  const seen = new Set();
  const marks = [];
  for (const line of (text || '').split('\n')) {
    const m = line.match(MARK_RE);
    if (!m) continue;
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    marks.push({ id, verdict: VERDICT[m[1].toLowerCase()], date });
  }
  return marks;
}

/**
 * Backfill the previous brief's checkbox marks into the ledger via `recordFeedback()`. Reads
 * `.nightwatch/MORNING.md`, records one feedback row per marked finding id, and skips any mark
 * already present (same id+verdict+date) so a forced re-run never double-records. Returns only
 * the marks it actually appended. Writes solely inside `.nightwatch/**` (the ledger).
 * @param {string} root
 * @param {{ readLedger: () => any[], recordFeedback: (m: {id:string, verdict:string, date:string}) => any }} store
 * @returns {Array<{id:string, verdict:string, date:string}>}
 */
function backfillFeedback(root, store) {
  const text = readFileSafe(path.join(nwDir(root), 'MORNING.md'));
  if (!text) return [];
  const marks = parseMarks(text);
  if (!marks.length) return [];
  const existing = new Set();
  for (const r of store.readLedger()) {
    if (r && r.type === 'feedback') existing.add(`${r.id}|${r.verdict}|${r.date || ''}`);
  }
  const recorded = [];
  for (const mk of marks) {
    if (existing.has(`${mk.id}|${mk.verdict}|${mk.date}`)) continue;
    store.recordFeedback(mk);
    recorded.push(mk);
  }
  return recorded;
}

module.exports = { backfillFeedback, parseMarks, briefDate };
