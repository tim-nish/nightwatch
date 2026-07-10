// @ts-check
'use strict';
// review.js — deterministic core of `/nightwatch review` (FR44). The interactive walk (offering
// acted-on / dismissed / skip-for-now per finding, strictly selection-based) lives in
// commands/nightwatch.md; the mechanical, testable half is here:
//   - list the brief's findings in brief order (and which remain unmarked) — the walk queue;
//   - rewrite one finding's checkbox in both MORNING.md and the dated brief, byte-preserving the
//     rest, so file state and ledger state never disagree;
//   - record the decision via the tracking store's recordFeedback() — the sole sanctioned ledger
//     writer — dated to the brief under review, and idempotently: an already-recorded
//     (id, verdict, date) is a stated no-op, so review composes with the morning backfill and with
//     manual checkbox edits in any interleaving without ever double-counting.
const fs = require('fs');
const path = require('path');
const { nwDir, readFileSafe } = require('./util');
const { briefDate } = require('./feedback');

// A rendered brief item: `- [ ] \`<id>\` (sev…) …` (collect-brief renderItem). Capture the box
// state and the id so identity survives freeform edits to the surrounding text.
const ITEM_RE = /^(\s*- \[)([ xX~-])(\]\s+`)([^`]+)(`.*)$/;
// The three selections map to the two ledger verdicts; "skip for now" writes nothing at all.
const MARK_BOX = Object.freeze({ 'acted-on': 'x', dismissed: '-' });

/** Every finding in brief order with its current box state — `marked` is false only for `[ ]`. */
function listFindings(text) {
  const out = [];
  for (const line of (text || '').split('\n')) {
    const m = line.match(ITEM_RE);
    if (m) out.push({ id: m[4], box: m[2], marked: m[2] !== ' ' });
  }
  return out;
}

/** The walk queue: findings whose box is still empty (`[ ]`), in brief order. */
function listUnmarked(text) {
  return listFindings(text).filter((f) => !f.marked).map((f) => ({ id: f.id }));
}

/**
 * Rewrite the checkbox of finding `id` to reflect `mark` (acted-on → `[x]`, dismissed → `[-]`).
 * Only the matching line changes; everything else — other findings, prose, whitespace, the trailing
 * newline — is byte-preserved. Returns `{text, changed}`; an absent id leaves the text untouched.
 * @param {string} text @param {string} id @param {'acted-on'|'dismissed'} mark
 */
function rewriteCheckbox(text, id, mark) {
  const box = MARK_BOX[mark];
  if (!box) throw new Error(`unknown mark: ${mark} (expected acted-on|dismissed)`);
  let changed = false;
  const lines = (text || '').split('\n').map((line) => {
    const m = line.match(ITEM_RE);
    if (m && m[4] === id) { changed = true; return `${m[1]}${box}${m[3]}${m[4]}${m[5]}`; }
    return line;
  });
  return { text: lines.join('\n'), changed };
}

/**
 * Apply one review decision. Rewrites the finding's checkbox in MORNING.md (when it is the brief
 * under review) and in the dated brief, then records a single feedback row via
 * `store.recordFeedback()` dated to that brief — but only if that (id, verdict, date) is not
 * already in the ledger, so a re-mark, a later backfill of the same box, or a hand edit never
 * double-counts. Writes only inside `.nightwatch/**`.
 * @param {string} root
 * @param {string} id finding id
 * @param {'acted-on'|'dismissed'} mark
 * @param {{ readLedger:()=>any[], recordFeedback:(m:{id:string,verdict:string,date:string})=>any }} store
 * @param {{ briefDate?: string }} [opts]  review a specific dated brief instead of the current one.
 * @returns {{ status:string, id:string, verdict?:string, date?:string, mark?:string }}
 */
function applyReview(root, id, mark, store, opts = {}) {
  if (!MARK_BOX[mark]) throw new Error(`unknown mark: ${mark} (expected acted-on|dismissed)`);
  const morningPath = path.join(nwDir(root), 'MORNING.md');
  const morning = readFileSafe(morningPath);
  const date = opts.briefDate || (morning != null ? briefDate(morning) : '');
  if (!date) return { status: 'no-brief', id, mark };

  let changed = false;
  // MORNING.md — only when it is the brief under review (same date), so reviewing an older dated
  // brief never rewrites today's MORNING.md.
  if (morning != null && briefDate(morning) === date) {
    const rw = rewriteCheckbox(morning, id, mark);
    if (rw.changed) { fs.writeFileSync(morningPath, rw.text); changed = true; }
  }
  // The dated brief (the authoritative copy under review).
  const briefPath = path.join(nwDir(root), 'briefs', `${date}.md`);
  const dated = readFileSafe(briefPath);
  if (dated != null) {
    const rw = rewriteCheckbox(dated, id, mark);
    if (rw.changed) { fs.writeFileSync(briefPath, rw.text); changed = true; }
  }
  if (!changed) return { status: 'not-found', id, mark, date };

  const verdict = mark;
  const already = store.readLedger().some((r) =>
    r && r.type === 'feedback' && r.id === id && r.verdict === verdict && (r.date || '') === date);
  if (already) return { status: 'noop', id, verdict, date };
  store.recordFeedback({ id, verdict, date });
  return { status: 'recorded', id, verdict, date };
}

module.exports = { ITEM_RE, MARK_BOX, listFindings, listUnmarked, rewriteCheckbox, applyReview };
