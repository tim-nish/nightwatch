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
const fs = require('fs');
const path = require('path');
const { makeIgnore, git } = require('./util');

// Top-level directories that are almost always product surface, so the drift nudge never flags them
// (entry-point dirs, docs, tests). Mirrors init.js's allowlist — both keep undeclared-dir signals
// honest; scope.js cannot import it (init.js requires scope.js — a cycle), so it is duplicated here.
const PRODUCT_DIR_ALLOWLIST = new Set([
  'src', 'lib', 'app', 'scripts', 'bin', 'cmd', 'pkg', 'internal',
  'test', 'tests', 'spec', 'specs', 'docs', 'doc', 'examples', 'example',
]);

// Shipped defaults. Criterion: a recognizable dev-workspace / build convention with a near-zero
// chance of being product surface. The spec (§7) left the exact lists to implementation — pinned
// here so config.yaml can EXTEND them.
const DEFAULT_IGNORE = Object.freeze([
  'dist/**', 'build/**', 'out/**', 'vendor/**', 'node_modules/**',
  '.git/**', 'coverage/**', '**/*.lock', '.nightwatch/**',
]);
// Each entry carries the criterion it passes (FR101): a recognizable dev-workspace convention with
// a near-zero chance of being product surface. `q_a/**` was REMOVED — it is the Nightwatch/BMAD
// authors' own workflow convention, not a universal one, and on the first outside repo (product-lab)
// it excluded the largest PRODUCT directory (finding 0028). `.claude/**` stays excluded but ships a
// `!.claude/commands/**` re-include so agent COMMANDS (behavior, the repo's implementation in a
// Claude-Code-native repo) are analyzed while settings/caches/downloaded skills stay out (needs the
// match-based subpath negation from Story 12.1).
const DEFAULT_DEV_TOOLING = Object.freeze([
  '_bmad/**',              // BMAD install tree — planning framework, not product
  '_bmad-output/**',       // BMAD-generated planning artifacts (epics, stories)
  '.claude/**',            // Claude Code workspace — settings, caches, downloaded skills
  '!.claude/commands/**',  // …EXCEPT agent commands: behavior/implementation, analyzed as product
  '.cursor/**',            // Cursor editor workspace
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
  const negations = [];
  if (Array.isArray(userList)) {
    for (const raw of userList) {
      if (typeof raw !== 'string') continue;
      const s = raw.trim();
      if (!s) continue;
      if (s[0] === '!') negations.push(s.slice(1).trim());
      else positives.add(s);
    }
  }
  // A negation that EXACTLY matches a positive cancels it — byte-identical to the pre-FR99 behavior.
  // A negation with no exact positive (a re-included SUBPATH of a broader glob, e.g.
  // `!.claude/commands/**` under `.claude/**`) is kept as a `!` entry and resolved by the matcher's
  // specificity precedence at match time (makeIgnore, FR99).
  const kept = [];
  for (const n of negations) {
    if (positives.has(n)) positives.delete(n);
    else kept.push('!' + n);
  }
  return [...positives, ...kept].sort();
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

/**
 * Deterministic scope preview (FR38): a filesystem walk — **zero model-token cost** — that
 * classifies every file as analyzed or excluded and tallies file counts per top-level directory.
 * This is the material an interactive run prints before spending anything, and it is written to
 * run-status on scheduled runs. `.git` is never descended (a shipped ignore default and always
 * huge). Once a directory is determined excluded, all descendants are excluded without re-matching
 * — glob exclusion is inherited, so the matcher runs only down to the first excluded ancestor.
 * @param {string} root @param {{ignore?: string[], dev_tooling?: string[]}} config
 * @returns {{ analyzed_files:number, excluded_files:number,
 *             analyzed:{dir:string,files:number}[], excluded:{dir:string,files:number}[] }}
 */
function scopePreview(root, config) {
  const globs = analysisExcludeGlobs(config);
  const isExcluded = makeIgnore(globs);
  // The "once excluded, all descendants excluded" optimization is only valid when no re-include can
  // resurface a subpath. With a `!` negation present (FR99), match every path so a re-included
  // subtree (e.g. `.claude/commands/**` under an excluded `.claude/**`) is correctly analyzed.
  const canInherit = !globs.some((g) => typeof g === 'string' && g[0] === '!');
  const analyzed = new Map();
  const excluded = new Map();
  const bump = (m, top) => m.set(top, (m.get(top) || 0) + 1);
  (function rec(dir, relDir, forced) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const top = rel.indexOf('/') === -1 ? rel : rel.slice(0, rel.indexOf('/'));
      // A file matches its own glob; a directory matches via a probe path so `node_modules/**`
      // catches `node_modules`. Exclusion is inherited once true — but only when no re-include exists.
      const excl = forced || isExcluded(rel) || isExcluded(`${rel}/__scope_probe__`);
      if (e.isDirectory()) rec(path.join(dir, e.name), rel, canInherit ? excl : false);
      else if (e.isFile()) bump(excl ? excluded : analyzed, top);
    }
  })(root, '', false);
  const toArr = (m) => [...m.entries()].map(([dir, files]) => ({ dir, files }))
    .sort((a, b) => b.files - a.files || a.dir.localeCompare(b.dir));
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  return { analyzed_files: sum(analyzed), excluded_files: sum(excluded), analyzed: toArr(analyzed), excluded: toArr(excluded) };
}

/** Git-tracked top-level directory names (a dir = a tracked path with a slash), sorted. */
function trackedTopDirs(root, gitFn = git) {
  const out = gitFn(root, ['ls-files']);
  if (out == null) return [];
  const dirs = new Set();
  for (const line of out.split('\n')) {
    const p = line.trim(); if (!p) continue;
    const i = p.indexOf('/');
    if (i > 0) dirs.add(p.slice(0, i));
  }
  return [...dirs].sort();
}

/** Top-level path segments named by declared authority artifacts (so a declared area is classified). */
function authorityTopSegments(authority) {
  const set = new Set();
  if (authority && typeof authority === 'object') {
    for (const k of Object.keys(authority)) {
      const art = authority[k] && authority[k].artifact;
      if (typeof art === 'string' && art.includes('/')) set.add(art.split('/')[0]);
    }
  }
  return set;
}

/**
 * Config-drift signal (FR53): git-tracked top-level directories that NO declaration classifies —
 * not excluded by the resolved `ignore`/`dev_tooling`, not on the product allowlist, and not named
 * by an authority declaration. These are the new/undeclared inputs the overnight brief nudges the
 * user to classify with `/nightwatch init --update`. Deterministic (sorted); read-only — computes a
 * signal, writes nothing. Injectables (`trackedTop`, `gitFn`) keep it unit-testable.
 * @param {string} root
 * @param {{ignore?: string[], dev_tooling?: string[]}} config  resolved config (extended lists)
 * @param {{ authority?: any, gitFn?: any, trackedTop?: string[] }} [opts]
 * @returns {string[]}
 */
function unclassifiedTopDirs(root, config, opts = {}) {
  const excluded = makeIgnore(analysisExcludeGlobs(config));
  const authTops = authorityTopSegments(opts.authority);
  const dirs = opts.trackedTop || trackedTopDirs(root, opts.gitFn);
  return dirs.filter((d) =>
    !excluded(`${d}/__scope_probe__`)
    && !PRODUCT_DIR_ALLOWLIST.has(d)
    && !authTops.has(d)
  ).sort();
}

module.exports = {
  DEFAULT_IGNORE, DEFAULT_DEV_TOOLING, PRODUCT_DIR_ALLOWLIST,
  extendGlobs, analysisExcludeGlobs, excludedTopDirs, scopePreview,
  trackedTopDirs, authorityTopSegments, unclassifiedTopDirs,
};
