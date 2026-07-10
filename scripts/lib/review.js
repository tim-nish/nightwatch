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

// A rendered brief action line carries its finding id(s) in an invisible manifest comment on the
// checkbox line — `- [ ] **summary** … <!-- ids: rc-1 -->` (collect-brief renderActionLine).
// Capture the box state and the manifest so identity survives freeform edits, and one bundled line
// resolves to every id it covers (spec §6, FR58/FR60). One id per line in 8.1; a list under 8.3.
const ITEM_RE = /^(\s*- \[)([ xX~-])(\].*?<!--\s*ids:\s*)([^>]*?)(\s*-->.*)$/;
// The three selections map to the two ledger verdicts; "skip for now" writes nothing at all.
const MARK_BOX = Object.freeze({ 'acted-on': 'x', dismissed: '-' });

/** The comma-separated ids carried in a matched action line's manifest. */
function lineIds(m) { return m[4].split(',').map((s) => s.trim()).filter(Boolean); }

// The full manifest ids of the action line that covers finding `id` (i.e. whose manifest includes
// it), or null when no line does. A bundled checkbox thereby resolves from any one of its ids to the
// whole set it covers, so review fans out to every finding the box stands for (FR60).
function lineIdsFor(text, id) {
  for (const line of (text || '').split('\n')) {
    const m = line.match(ITEM_RE);
    if (m && lineIds(m).includes(id)) return lineIds(m);
  }
  return null;
}

// One entry per action LINE in brief order (a bundle is one question, not N): its current box state
// (`marked` is false only for `[ ]`), a representative `.id` (the first covered id, so single-id
// callers keep working), and the full `.ids` array the line covers. For a single-id line `.ids` is
// `[.id]` and behaviour is unchanged.
function listFindings(text) {
  const out = [];
  for (const line of (text || '').split('\n')) {
    const m = line.match(ITEM_RE);
    if (!m) continue;
    const ids = lineIds(m);
    out.push({ id: ids[0], ids, box: m[2], marked: m[2] !== ' ' });
  }
  return out;
}

/** The walk queue: action lines whose box is still empty (`[ ]`), in brief order (a bundle is one). */
function listUnmarked(text) {
  return listFindings(text).filter((f) => !f.marked).map((f) => ({ id: f.id, ids: f.ids }));
}

/**
 * Rewrite the checkbox of the action line covering finding `id` to reflect `mark` (acted-on →
 * `[x]`, dismissed → `[-]`). Only the matching line changes; everything else — other findings,
 * prose, whitespace, the trailing newline — is byte-preserved. Returns `{text, changed}`; an absent
 * id leaves the text untouched.
 * @param {string} text @param {string} id @param {'acted-on'|'dismissed'} mark
 */
function rewriteCheckbox(text, id, mark) {
  const box = MARK_BOX[mark];
  if (!box) throw new Error(`unknown mark: ${mark} (expected acted-on|dismissed)`);
  let changed = false;
  const lines = (text || '').split('\n').map((line) => {
    const m = line.match(ITEM_RE);
    if (m && lineIds(m).includes(id)) { changed = true; return `${m[1]}${box}${m[3]}${m[4]}${m[5]}`; }
    return line;
  });
  return { text: lines.join('\n'), changed };
}

/**
 * Apply one review decision. Rewrites the checkbox of the action line covering finding `id` in
 * MORNING.md (when it is the brief under review) and in the dated brief, then records ONE feedback
 * row PER id the line covers via `store.recordFeedback()` dated to that brief — so marking a bundled
 * action fans out to every covered finding, exactly like the morning backfill (FR60). Each row is
 * written only if that (id, verdict, date) is not already in the ledger, so a re-mark, a later
 * backfill of the same box, or a hand edit never double-counts: `recorded` when at least one new row
 * was written, `noop` when every covered id was already recorded. Writes only inside `.nightwatch/**`.
 * @param {string} root
 * @param {string} id finding id (resolves to its whole action line for fan-out)
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
  /** @type {string[] | null} */
  let ids = null; // the full set of ids the marked line covers (fan-out targets)
  // MORNING.md — only when it is the brief under review (same date), so reviewing an older dated
  // brief never rewrites today's MORNING.md.
  if (morning != null && briefDate(morning) === date) {
    const rw = rewriteCheckbox(morning, id, mark);
    if (rw.changed) { fs.writeFileSync(morningPath, rw.text); changed = true; ids = lineIdsFor(morning, id); }
  }
  // The dated brief (the authoritative copy under review).
  const briefPath = path.join(nwDir(root), 'briefs', `${date}.md`);
  const dated = readFileSafe(briefPath);
  if (dated != null) {
    const rw = rewriteCheckbox(dated, id, mark);
    if (rw.changed) { fs.writeFileSync(briefPath, rw.text); changed = true; if (!ids) ids = lineIdsFor(dated, id); }
  }
  if (!changed) return { status: 'not-found', id, mark, date };

  const verdict = mark;
  const fanout = (ids && ids.length) ? ids : [id];
  // Fold existing feedback rows into a set so each covered id is recorded at most once (per-id
  // idempotency), and re-mark/backfill/hand-edit compose in any interleaving without double-counting.
  const seen = new Set();
  for (const r of store.readLedger()) {
    if (r && r.type === 'feedback') seen.add(`${r.id}|${r.verdict}|${r.date || ''}`);
  }
  let recorded = 0;
  for (const fid of fanout) {
    const key = `${fid}|${verdict}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    store.recordFeedback({ id: fid, verdict, date });
    recorded++;
  }
  if (recorded === 0) return { status: 'noop', id, verdict, date };
  return { status: 'recorded', id, verdict, date };
}

module.exports = { ITEM_RE, MARK_BOX, listFindings, listUnmarked, rewriteCheckbox, applyReview };
