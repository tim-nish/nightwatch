// @ts-check
'use strict';
// lints.js — the deterministic collector half of the writing harness (spec writing-harness P4.2/P5).
// Mechanical style rules are checked at assembly time with NO model call and NO network: a prose
// field that fails a lint falls back to its mechanical rendering (title) — never broken output,
// never a crash — and every cited PR/commit number is verified against the target repo's own git
// history. The judgment half (authoring prose, the reader-question refutation) lives in the prose
// jobs; this file only detects and degrades. The contract vocabulary comes from writing.js.
const { git } = require('./util');

// W2 (spec P3): a self-evident reference is title-first with the number parenthesized — "(PR #78)",
// "(#78)" — or repo-prefixed — "writing-assistant#78". A BARE `#78` (e.g. "see #78") is the failure.
// Detection strips the two accepted forms, then flags any `#\d+` that remains.
const PARENS_REF_RE = /\([^()]*#\d+[^()]*\)/g;   // any #N inside parentheses → accepted
const ATTACHED_REF_RE = /[\w-]#\d+/g;             // repo#N / writing-assistant#78 → accepted
const BARE_REF_RE = /#\d+/;                        // anything left is bare
// W5 (spec P3): one work vocabulary — blocker / remaining work / waivable gate / later milestone.
// A conservative deterministic denylist of common off-vocabulary work nouns; any of these in a
// status/road line is flagged (the mechanism is mandatory, the list extensible).
const OFF_VOCAB_WORK_NOUNS = ['task', 'tasks', 'item', 'items', 'todo', 'todos', 'chore', 'chores', 'ticket', 'tickets'];

/**
 * Lint one authored prose field (spec P4.2). Returns the sorted list of violated rule ids
 * (`['W1','W2','W5']` subset) — empty means clean. Pure and deterministic; no model, no I/O.
 *   - W1 hard wrap: the field contains an internal newline (one bullet = one source line).
 *   - W2 bare `#N`: a `#\d+` in neither the parenthesized nor the repo-prefixed accepted form.
 *   - W5 off-vocabulary work noun: only checked for status/road context.
 * @param {string} text @param {{context?: 'prose'|'status'|'road'}} [opts]
 * @returns {string[]}
 */
function lintProse(text, opts = {}) {
  const s = String(text == null ? '' : text);
  const out = [];
  if (/\r?\n/.test(s)) out.push('W1');
  const stripped = s.replace(PARENS_REF_RE, '').replace(ATTACHED_REF_RE, '');
  if (BARE_REF_RE.test(stripped)) out.push('W2');
  if (opts.context === 'status' || opts.context === 'road') {
    const words = new Set((s.toLowerCase().match(/[a-z]+/g) || []));
    if (OFF_VOCAB_WORK_NOUNS.some((w) => words.has(w))) out.push('W5');
  }
  return out;
}

/** True when `text` is clean prose for the given context (no lint violations). */
function isClean(text, opts) { return lintProse(text, opts).length === 0; }

/**
 * The set of PR numbers the target repo's git history actually contains (spec P5): parsed from
 * `Merge pull request #N` merge-commit subjects, no network. Returns a Set of integers; an empty set
 * on a non-git repo or a repo with no merge commits (then every cited number is unverifiable).
 * @param {string} root @returns {Set<number>}
 */
function knownPRNumbers(root) {
  const out = new Set();
  const raw = git(root, ['log', '--all', '--pretty=%s']);
  if (!raw) return out;
  for (const m of raw.matchAll(/Merge pull request #(\d+)/g)) out.add(Number(m[1]));
  return out;
}

/**
 * Deterministic citation check (spec P5): every `#N` a document cites must match a known PR number
 * of THIS repo. Returns the sorted unique invalid numbers and the text with each invalid `#N` stripped
 * of its number (rendered `#?` — flagged, never silently trusted). No network. `known` is injectable
 * for tests; it defaults to the repo's real merge-commit history.
 * @param {string} root @param {string} text @param {{known?: Set<number>}} [opts]
 * @returns {{ invalid: number[], text: string }}
 */
function checkCitations(root, text, opts = {}) {
  const known = opts.known || knownPRNumbers(root);
  const s = String(text == null ? '' : text);
  const invalid = new Set();
  for (const m of s.matchAll(/#(\d+)/g)) { const n = Number(m[1]); if (!known.has(n)) invalid.add(n); }
  const cleaned = s.replace(/#(\d+)/g, (whole, n) => (known.has(Number(n)) ? whole : '#?'));
  return { invalid: [...invalid].sort((a, b) => a - b), text: cleaned };
}

/**
 * Adversarial reader-question harness (spec P4.3): each authored field is challenged with the
 * question it must answer; a field the refuter says does not answer its question is refuted, exactly
 * like the existing truth check. The refutation is agent judgment (`refute`), injected so this stays
 * unit-testable; the deterministic default refutes nothing. Also refutes a field carrying a citation
 * that `checkCitations`-style logic (via `unlocatable`) cannot find under the target repo.
 * @param {Array<{id?:string, text:string, question:string}>} fields
 * @param {(f:{text:string, question:string})=>(boolean|{refuted?:boolean, reason?:string})} [refute]
 * @returns {{ verified: any[], refuted: Array<{id?:string, reason:string}> }}
 */
function verifyReaderQuestions(fields, refute) {
  const verified = [];
  const refuted = [];
  for (const f of fields || []) {
    /** @type {boolean | {refuted?: boolean, reason?: string}} */
    let r = false;
    try { r = refute ? refute({ text: f.text, question: f.question }) : false; } catch { r = false; }
    const obj = (r && typeof r === 'object') ? r : null;
    const isRef = r === true || (obj != null && obj.refuted === true);
    if (isRef) refuted.push({ id: f.id, reason: (obj && obj.reason) || 'does not answer its reader question' });
    else verified.push(f);
  }
  return { verified, refuted };
}

module.exports = {
  lintProse, isClean, knownPRNumbers, checkCitations, verifyReaderQuestions,
  OFF_VOCAB_WORK_NOUNS,
};
