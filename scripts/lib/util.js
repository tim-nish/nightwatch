// @ts-check
'use strict';
// Shared helpers for Nightwatch scripts. No third-party deps here (js-yaml lives in config.js).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Parse `--key value` / `--flag` style argv (after `node script.js`).
 * @param {string[]} argv
 * @returns {import('./types').Args}
 */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else { out._.push(a); }
  }
  return out;
}

/** Resolve the repo root from --repo (default "."), absolute-ized. */
function repoRoot(args) {
  return path.resolve(args.repo || '.');
}

function todayISO(args) {
  if (args && typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) return args.date;
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function readFileSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function readJSONSafe(p) { const t = readFileSafe(p); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } }

function writeJSON(p, obj) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function nwDir(root) { return path.join(root, '.nightwatch'); }
// The disposable machine-state boundary (spec runtime-layout P1): everything under
// `.nightwatch/runtime/` is machine-owned, gitignored as a unit, and safe to delete. Cadence
// cursors and per-run output live here; committed memory (briefs, ledger) and human declarations
// (STATE.md, config.yaml, RELEASE.md) stay OUTSIDE it.
function runtimeDir(root) { return path.join(nwDir(root), 'runtime'); }
/** Nightwatch per-run output directory (transient artifacts), now under the disposable `runtime/`. */
function outDir(root) { return path.join(runtimeDir(root), 'out'); }
/** Legacy per-run output location, read as a fallback until `init --update` migrates it (Story 9.5). */
function legacyOutDir(root) { return path.join(nwDir(root), 'out'); }

/** Run git in the repo; returns stdout string, or null on failure. */
function git(root, gitArgs, opts) {
  try {
    return execFileSync('git', ['-C', root, ...gitArgs], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], ...opts,
    });
  } catch { return null; }
}

function isGitRepo(root) {
  const r = git(root, ['rev-parse', '--is-inside-work-tree']);
  return r != null && r.trim() === 'true';
}

function commitCount(root) {
  const r = git(root, ['rev-list', '--count', 'HEAD']);
  const n = r == null ? 0 : parseInt(r.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Convert a simple glob (supporting **, *, ?) to a RegExp anchored full-match. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

function makeIgnore(globs) {
  const res = (globs || []).map(globToRegExp);
  return (relPath) => {
    const p = relPath.split(path.sep).join('/');
    return res.some((r) => r.test(p)) ;
  };
}

/**
 * Walk a repo returning repo-relative POSIX paths of files, skipping .git and
 * ignore-matched paths. Deterministic (sorted).
 */
function walkFiles(root, ignoreGlobs) {
  const ignore = makeIgnore(ignoreGlobs);
  const results = [];
  (function rec(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name === '.git') continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (ignore(rel)) continue;
      if (e.isDirectory()) rec(abs);
      else if (e.isFile()) results.push(rel);
    }
  })(root);
  return results.sort();
}

/** Top-level module/dir a repo-relative path belongs to (for coupling/layering). */
function topSegment(rel) {
  const i = rel.indexOf('/');
  return i === -1 ? rel : rel.slice(0, i);
}

// Release-progress representation contract: internally, `progress` is a **0–1 fraction** (0.38 =
// "38% done"). It is stored as a fraction in RELEASE.md frontmatter and rendered as a percent only
// at the display boundary — the morning brief and the release-progress section. Keeping the render
// conversion in one pair of helpers is what stops "0.38" from ever printing as "0.38%".

/** Normalize a stored/read progress value to the 0–1 fraction contract. A legacy value already in
 * percent (> 1, e.g. a pre-fix `progress: 64`) is divided down; a fraction passes through; a
 * non-number becomes 0. So 0.38 → 0.38, 64 → 0.64, 1 → 1, "" → 0. */
function toFraction(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

/** Render a progress value as an integer percent for display. Defensive against a legacy percent
 * value (> 1) so both representations show the same number. Returns null for a non-number.
 * 0.38 → 38, 0 → 0, 1 → 100, legacy 64 → 64. */
function progressPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? Math.round(n) : Math.round(n * 100);
}

module.exports = {
  parseArgs, repoRoot, todayISO, ensureDir, readFileSafe, exists, readJSONSafe,
  writeJSON, outDir, legacyOutDir, runtimeDir, nwDir, git, isGitRepo, commitCount, globToRegExp, makeIgnore,
  walkFiles, topSegment, toFraction, progressPercent,
};
