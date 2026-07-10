// @ts-check
'use strict';
// init.js (lib) — the deterministic core of `/nightwatch init` daytime setup (§6, FR33/NFR4).
//
// The interview itself is agent-driven and specified in commands/nightwatch.md (init is the ONE
// mode that may ask questions). Everything that must be mechanical and testable lives here:
//   - instantiate the shipped declaration templates (templates/STATE.md, templates/config.yaml)
//     into a repo ONLY when absent — init is setup, never overwrite, so an existing declaration
//     is never clobbered;
//   - register `.nightwatch/out/` in the repo's `.gitignore` (the transient per-run artifact dir);
//   - a LOCAL-ONLY probe of every extractor adapter (§2.6) that returns, per adapter,
//     {detected, available, installHint}. The install hint is populated only for a
//     detected-but-unavailable tool — init is the single moment a tool install is ever suggested.
//
// It spends no tokens, touches no network, and installs nothing. The human's interview answers are
// plain inputs, so the whole module is unit-testable without any interactive input.
const fs = require('fs');
const path = require('path');
const { exists, readFileSafe, ensureDir, git, makeIgnore, walkFiles } = require('./util');
const { DEFAULT_DEV_TOOLING, analysisExcludeGlobs } = require('./scope');
const { loadConfig } = require('./config');
const { loadAdapters } = require('../extract-signals');

// Top-level directories that are almost always product surface, so init never proposes them as
// dev-tooling even when nothing imports them (entry-point dirs, docs, tests). The human can still
// add them by hand — this list only keeps the *suggestions* honest.
const PRODUCT_DIR_ALLOWLIST = new Set([
  'src', 'lib', 'app', 'scripts', 'bin', 'cmd', 'pkg', 'internal',
  'test', 'tests', 'spec', 'specs', 'docs', 'doc', 'examples', 'example',
]);
const SRC_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|rb|java)$/;

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');
const OUT_IGNORE = '.nightwatch/out/';

// Shipped declaration templates init instantiates: source template -> repo-relative (POSIX) dest.
// Each declaration's canonical `dest` sits under .nightwatch/. `legacy` is a pre-consolidation
// root location that still counts as "already present" (FR48) — so re-running init on an existing
// root-`STATE.md` install never creates a shadowing `.nightwatch/STATE.md` (the config reader
// prefers the nested copy). Relocating a legacy file is Story 7.2's confirmed migration, not init.
const DECLARATIONS = [
  { key: 'state', template: 'STATE.md', dest: '.nightwatch/STATE.md', legacy: 'STATE.md' },
  { key: 'config', template: 'config.yaml', dest: '.nightwatch/config.yaml' },
];

/** Read a shipped template's text; a missing template is a packaging bug, so throw. */
function readTemplate(name) {
  const t = readFileSafe(path.join(TEMPLATES_DIR, name));
  if (t == null) throw new Error(`shipped template not found: templates/${name}`);
  return t;
}

/**
 * Instantiate the shipped declaration templates into `root`, but ONLY where absent — init is
 * setup, not overwrite, so an existing STATE.md / config.yaml is never clobbered. Content is the
 * template verbatim (the human then edits it, or re-runs init). Deterministic; no network.
 * @param {string} root
 * @param {{ config?: boolean }} [opts]  also write .nightwatch/config.yaml (default true).
 * @returns {{ file: string, dest: string, written: boolean, reason: string }[]}
 */
function writeDeclarations(root, opts = {}) {
  const writeConfig = opts.config !== false;
  const report = [];
  for (const d of DECLARATIONS) {
    if (d.key === 'config' && !writeConfig) continue;
    const abs = path.join(root, ...d.dest.split('/'));
    const legacyAbs = d.legacy ? path.join(root, ...d.legacy.split('/')) : null;
    if (exists(abs) || (legacyAbs && exists(legacyAbs))) {
      // Present at the nested dest OR a legacy root location → never clobber, never shadow.
      report.push({ file: d.key, dest: d.dest, written: false, reason: 'exists' });
      continue;
    }
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, readTemplate(d.template));
    report.push({ file: d.key, dest: d.dest, written: true, reason: 'created' });
  }
  return report;
}

/**
 * Ensure `.nightwatch/out/` is git-ignored — the transient per-run artifact dir must never be
 * committed. Idempotent: appends the entry only when absent, creating `.gitignore` if needed.
 * @param {string} root
 * @returns {{ changed: boolean }}
 */
function ensureGitignore(root) {
  const gi = path.join(root, '.gitignore');
  const cur = readFileSafe(gi);
  const bare = OUT_IGNORE.replace(/\/$/, '');
  const has = (cur || '').split('\n').some((l) => { const t = l.trim(); return t === OUT_IGNORE || t === bare; });
  if (has) return { changed: false };
  const sep = !cur ? '' : (cur.endsWith('\n') ? '' : '\n');
  fs.writeFileSync(gi, (cur || '') + sep + OUT_IGNORE + '\n');
  return { changed: true };
}

/**
 * LOCAL-ONLY probe of every extractor adapter (§2.6, FR33 AC2). For each adapter it runs only the
 * contract's detect()/available()/explain() — never run(), never install, never network — and
 * returns a deterministic (name-sorted) report. `installHint` is populated ONLY for a
 * detected-but-unavailable tool: init is the single moment a tool install is ever suggested.
 * @param {string} root
 * @param {any[]} [adapters]  injectable for tests; defaults to the discovered adapters.
 * @returns {{ name: string, tool: string|null, detected: boolean, available: boolean, installHint: string|null, summary: string|null }[]}
 */
function probeAdapters(root, adapters) {
  const list = adapters || loadAdapters();
  const rows = [];
  for (const adapter of list) {
    let info; try { info = adapter.explain() || {}; } catch { info = {}; }
    const name = info.name || 'adapter';
    let detected = false; let available = false;
    try { detected = !!adapter.detect(root); } catch { detected = false; }
    if (detected) { try { available = !!adapter.available(root); } catch { available = false; } }
    rows.push({
      name,
      tool: info.tool || null,
      detected,
      available,
      // Only actionable — and only offered — when the ecosystem applies but the tool is missing.
      installHint: detected && !available ? (info.install || null) : null,
      summary: info.summary || null,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Import specifiers (relative + bare) in a source file — enough to see what product code references. */
function importSpecs(text) {
  const out = [];
  for (const m of text.matchAll(/import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  for (const m of text.matchAll(/^\s*from\s+([.\w]+)\s+import\s/gm)) out.push(m[1]);
  return out;
}

/** Top-level directory names present in the repo root on disk (excluding `.git`), sorted. */
function rootDirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '.git')
      .map((e) => e.name).sort();
  } catch { return []; }
}

/**
 * Top-level directory names actually tracked by git (a dir = a tracked path with a slash).
 * @param {string} root @param {(root:string, args:string[], opts?:any)=>(string|null)} [gitFn]
 */
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

/** Top-level segments that some product file imports (relative resolved to its top dir, or a bare pkg). */
function referencedTopSegments(root, productFiles) {
  const refs = new Set();
  for (const rel of productFiles) {
    if (!SRC_EXT.test(rel)) continue;
    const text = readFileSafe(path.join(root, rel));
    if (text == null) continue;
    for (const spec of importSpecs(text)) {
      if (spec.startsWith('.')) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel.split(path.sep).join('/')), spec));
        const seg = resolved.split('/')[0];
        if (seg && seg !== '..' && seg !== '.') refs.add(seg);
      } else {
        refs.add(spec.split('/')[0]);
      }
    }
  }
  return refs;
}

/**
 * Detect candidate dev-tooling directories for `init` to confirm with the human (FR43). Two
 * sources, each tagged, so the human sees *why* a directory is proposed — nothing is written until
 * they confirm:
 *   - `convention` : a top-level dir present in the repo root matching a shipped dev-tooling
 *                    default (`_bmad/**`, …) — a repo-root scan, so it surfaces even when the dir is
 *                    git-ignored (as agent workspaces often are).
 *   - `heuristic`  : a git-tracked top-level dir referenced by NO product import and not on the
 *                    product allowlist — i.e. it lives in the repo but no product code depends on it.
 * A convention match wins over a heuristic one. Deterministic (sorted). Injectables (`gitFn`,
 * `files`, `config`, `diskDirs`) keep it unit-testable.
 * @param {string} root
 * @param {{ gitFn?: (root:string, args:string[], opts?:any)=>(string|null), files?: string[], config?: any, diskDirs?: string[] }} [opts]
 * @returns {{ dir:string, glob:string, source:'convention'|'heuristic', reason:string }[]}
 */
function detectDevToolingCandidates(root, opts = {}) {
  const config = opts.config || loadConfig(root).config;
  const gitFn = opts.gitFn || git;
  const productFiles = opts.files || walkFiles(root, analysisExcludeGlobs(config));
  const isConvention = makeIgnore(DEFAULT_DEV_TOOLING);
  const refs = referencedTopSegments(root, productFiles);
  const diskDirs = opts.diskDirs || rootDirs(root);
  /** @type {{ dir:string, glob:string, source:'convention'|'heuristic', reason:string }[]} */
  const candidates = [];
  const seen = new Set();
  // conventions: repo-root scan (present on disk, even if git-ignored).
  for (const dir of diskDirs) {
    if (isConvention(`${dir}/__probe__`)) {
      candidates.push({ dir, glob: `${dir}/**`, source: 'convention', reason: 'matches a shipped dev-tooling convention' });
      seen.add(dir);
    }
  }
  // heuristics: git-tracked top-level dirs no product import references.
  for (const dir of trackedTopDirs(root, gitFn)) {
    if (seen.has(dir)) continue;
    if (!refs.has(dir) && !PRODUCT_DIR_ALLOWLIST.has(dir)) {
      candidates.push({ dir, glob: `${dir}/**`, source: 'heuristic', reason: 'top-level tracked directory referenced by no product import' });
      seen.add(dir);
    }
  }
  return candidates.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** Normalize a confirmed entry to a glob: a bare directory name → `name/**`; a glob is kept as-is. */
function toGlob(entry) {
  const s = String(entry).trim();
  if (!s) return null;
  if (s.includes('*') || s.includes('/')) return s;
  return `${s}/**`;
}

/**
 * Persist the human-confirmed dev-tooling set into `.nightwatch/config.yaml` under `dev_tooling:`
 * (FR43) — a visible, versioned declaration, not a hidden default. Replaces the single
 * `dev_tooling:` line (preserving the surrounding comments and every other key) or inserts one
 * after `ignore:`; creates a minimal file if config.yaml is somehow absent. Idempotent: re-writing
 * the same confirmed set yields the same line. Deterministic (globs deduped + sorted).
 * @param {string} root @param {string[]} confirmed  dir names or globs
 */
function writeDevTooling(root, confirmed) {
  const list = [...new Set((confirmed || []).map(toGlob).filter(Boolean))].sort();
  const rendered = `dev_tooling: [${list.map((g) => JSON.stringify(g)).join(', ')}]`;
  const comment = '  # confirmed by /nightwatch init — extends shipped defaults';
  const p = path.join(root, '.nightwatch', 'config.yaml');
  const cur = readFileSafe(p);
  if (cur == null) {
    ensureDir(path.dirname(p));
    fs.writeFileSync(p, rendered + comment + '\n');
    return { written: true, created: true, dev_tooling: list };
  }
  const lines = cur.split('\n');
  const idx = lines.findIndex((l) => /^dev_tooling\s*:/.test(l));
  if (idx >= 0) {
    lines[idx] = rendered + comment;
  } else {
    const ins = lines.findIndex((l) => /^ignore\s*:/.test(l));
    if (ins >= 0) lines.splice(ins + 1, 0, rendered + comment);
    else lines.push(rendered + comment);
  }
  fs.writeFileSync(p, lines.join('\n'));
  return { written: true, created: false, dev_tooling: list };
}

/**
 * One deterministic init pass: probe the adapters, then (unless `probeOnly`) instantiate the
 * missing declaration files and register the out/ ignore. When `devTooling` is provided (the
 * human-confirmed classification), persist it into config.yaml AFTER the template is instantiated
 * so the declaration lands in a real file. Returns the structured report the command prompt reads
 * back to the human. With `probeOnly`, writes nothing.
 * @param {string} root
 * @param {{ probeOnly?: boolean, config?: boolean, adapters?: any[], devTooling?: string[] }} [opts]
 */
function runInit(root, opts = {}) {
  const probe = probeAdapters(root, opts.adapters);
  if (opts.probeOnly) return { probe, declarations: [], gitignore: null, dev_tooling: null };
  const declarations = writeDeclarations(root, { config: opts.config });
  const gitignore = ensureGitignore(root);
  const dev_tooling = Array.isArray(opts.devTooling) ? writeDevTooling(root, opts.devTooling) : null;
  return { probe, declarations, gitignore, dev_tooling };
}

module.exports = {
  runInit, writeDeclarations, ensureGitignore, probeAdapters, readTemplate, TEMPLATES_DIR,
  detectDevToolingCandidates, writeDevTooling, trackedTopDirs,
};
