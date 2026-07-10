// @ts-check
'use strict';
// scope.js — two-tier analysis scoping (FR42, §2.2). Nightwatch confines analysis to *product*
// files through two tiers of exclusion:
//   - `ignore`      : paths no job should ever look at — build outputs, dependencies, caches,
//                     `.nightwatch/**`.
//   - `dev_tooling` : real repo content that DEVELOPS the product but is not the product itself —
//                     agent workspaces, planning artifacts, prompt/skill directories.
// Both tiers EXTEND their shipped defaults rather than replacing them, and a `!pattern` entry
// re-includes a default-excluded path deliberately. The two tiers are unioned into one
// analysis-exclude set applied at the file-walk boundary (util.walkFiles), so excluded trees are
// never handed to a member job — they cost zero extraction, judgment, and verification tokens.
// The exclusion is architectural, not an output filter. collect-brief states the exclusions in one
// line so a wrong scope is visible, never silent.
const { makeIgnore } = require('./util');

// Shipped defaults. Criterion: a recognizable dev-workspace / build convention with a near-zero
// chance of being product surface. The spec (§7) left the exact lists to implementation — pinned
// here so config.yaml can EXTEND them.
const DEFAULT_IGNORE = Object.freeze([
  'dist/**', 'build/**', 'out/**', 'vendor/**', 'node_modules/**',
  '.git/**', 'coverage/**', '**/*.lock', '.nightwatch/**',
]);
const DEFAULT_DEV_TOOLING = Object.freeze([
  '_bmad/**', '_bmad-output/**', '.claude/**', '.cursor/**', 'q_a/**',
]);

/**
 * Extend a shipped default list with a user list (FR42 extend-not-replace semantics):
 *  - user list absent (not an array) → the defaults verbatim (an absent key means shipped defaults).
 *  - a plain entry `p`               → added to the exclude set (extends; never replaces defaults).
 *  - a negation entry `!p`           → re-includes `p` by removing it from the exclude set.
 * A single `!p` cancels `p` whether it came from the defaults or the user's own positives. The
 * result is deduped and stably sorted, so resolution is deterministic and order-independent.
 * @param {readonly string[]} defaults @param {unknown} userList @returns {string[]}
 */
function extendGlobs(defaults, userList) {
  const positives = new Set(defaults);
  if (Array.isArray(userList)) {
    const negations = [];
    for (const raw of userList) {
      if (typeof raw !== 'string') continue;
      const s = raw.trim();
      if (!s) continue;
      if (s[0] === '!') negations.push(s.slice(1).trim());
      else positives.add(s);
    }
    for (const n of negations) positives.delete(n);
  }
  return [...positives].sort();
}

/**
 * The combined analysis-exclude glob set — the union of both resolved tiers, deduped and sorted.
 * Every member job's file walk uses this so both "never look" and "not the product" trees are
 * dropped before any token is spent. Expects `config.ignore` / `config.dev_tooling` to already be
 * the extended lists (loadConfig resolves them).
 * @param {{ignore?: string[], dev_tooling?: string[]}} config @returns {string[]}
 */
function analysisExcludeGlobs(config) {
  const ignore = Array.isArray(config && config.ignore) ? config.ignore : [];
  const dev = Array.isArray(config && config.dev_tooling) ? config.dev_tooling : [];
  return [...new Set([...ignore, ...dev])].sort();
}

/**
 * Top-level entries of `root` that the analysis-exclude set drops entirely — the material for the
 * brief's one-line scope statement. Deterministic (sorted). A directory is "excluded" when a probe
 * path under it matches an exclude glob (so `node_modules/**` counts `node_modules`). Only entries
 * actually present in the repo are returned, so the line names real excluded trees, not defaults
 * that don't exist here.
 * @param {string} root @param {{ignore?: string[], dev_tooling?: string[]}} config
 * @param {(dir:string)=>string[]} [listTop]  injectable dir lister for tests.
 * @returns {string[]}
 */
function excludedTopDirs(root, config, listTop) {
  const isExcluded = makeIgnore(analysisExcludeGlobs(config));
  let names;
  if (listTop) names = listTop(root);
  else {
    const fs = require('fs');
    try {
      names = fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== '.git')
        .map((e) => e.name);
    } catch { names = []; }
  }
  return names.filter((n) => isExcluded(`${n}/__scope_probe__`)).sort();
}

module.exports = {
  DEFAULT_IGNORE, DEFAULT_DEV_TOOLING,
  extendGlobs, analysisExcludeGlobs, excludedTopDirs,
};
