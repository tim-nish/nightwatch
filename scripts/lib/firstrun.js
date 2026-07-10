// @ts-check
'use strict';
// firstrun.js — the mechanical, testable core of the first-run confirmation SCREEN (FR45–FR47).
// The screen itself (plain-language labels, the yes/no gate) is agent-driven in
// commands/nightwatch.md; what must be deterministic and content-judgment-free lives here:
//   - classifyUntracked: a light, path/NAME-based heuristic (never a run-time content judgment,
//     per the analysis-scope non-goal) that splits the untracked files the scope preview would
//     otherwise analyze into two INDEPENDENTLY-acceptable groups — likely temporary/crash
//     artifacts vs ordinary untracked documents the human should review (FR47);
//   - renderIgnorePreview: the exact `ignore:` block a "exclude these" choice would append to
//     .nightwatch/config.yaml — shown BEFORE it is written (FR46), because config.yaml is a
//     versioned declaration and a helpful write is still a write.

// Temporary / crash-artifact name patterns. Deliberately conservative: only things almost never a
// document a human wants analyzed. Matched on the BASENAME (plus a few full-name specials), never
// on file contents — the classification is a name heuristic a present human confirms.
const TEMP_PATTERNS = [
  /\.stackdump$/i, /\.tmp$/i, /\.temp$/i, /\.log$/i, /\.bak$/i, /\.orig$/i, /\.rej$/i,
  /\.swp$/i, /\.swo$/i, /~$/, /^\.#/, /^#.*#$/,                 // editor swap / backup files
  /^core$/, /^core\.\d+$/, /^hs_err_pid.*\.log$/i, /\.crashdump$/i, /\.dmp$/i,
  /^\.DS_Store$/, /^Thumbs\.db$/i, /\.pyc$/i, /\.class$/i,
];

/** True when a repo-relative path's basename matches a temporary/crash-artifact pattern. */
function isTempName(rel) {
  const base = String(rel).split('/').pop() || String(rel);
  return TEMP_PATTERNS.some((re) => re.test(base));
}

/**
 * Split untracked paths into two independently-acceptable groups by a NAME heuristic (FR47), so a
 * user can ignore the obvious junk without deciding about a real document (or vice versa).
 * @param {string[]} paths repo-relative untracked file paths
 * @returns {{ temp: string[], documents: string[] }} each sorted; `temp` = likely crash/temp
 *   artifacts, `documents` = ordinary untracked documents to review.
 */
function classifyUntracked(paths) {
  const temp = [];
  const documents = [];
  for (const p of (paths || [])) {
    if (typeof p !== 'string' || !p.trim()) continue;
    (isTempName(p) ? temp : documents).push(p);
  }
  return { temp: temp.sort(), documents: documents.sort() };
}

/**
 * The exact `ignore:` block that adding `paths` to `.nightwatch/config.yaml` would write (FR46) —
 * shown to the human BEFORE writing so a config edit is never applied sight-unseen. Deterministic
 * (deduped + sorted). Empty input → null (nothing to preview or write).
 * @param {string[]} paths @returns {string|null}
 */
function renderIgnorePreview(paths) {
  const list = [...new Set((paths || []).filter((p) => typeof p === 'string' && p.trim()))].sort();
  if (!list.length) return null;
  return ['# will be added to .nightwatch/config.yaml', 'ignore:', ...list.map((p) => `  - ${p}`)].join('\n') + '\n';
}

module.exports = { classifyUntracked, renderIgnorePreview, isTempName, TEMP_PATTERNS };
