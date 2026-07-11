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
const yaml = require('js-yaml');
const { exists, readFileSafe, ensureDir, git, makeIgnore, walkFiles } = require('./util');
const { DEFAULT_DEV_TOOLING, analysisExcludeGlobs, detectRepoClass } = require('./scope');
const { loadConfig } = require('./config');
const { draftMilestones } = require('./milestones');
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
// Disposable machine state is ignored via a NESTED .nightwatch/.gitignore (git honors nested ignore
// files), so Nightwatch never edits the project's root .gitignore (FR50). The boundary is the whole
// `runtime/` dir (spec runtime-layout P1) — cursors + per-run out/ — so committed memory (briefs,
// ledger) stays trackable. A legacy bare `out/` line from a pre-runtime install is harmless and is
// left in place (never removed).
const NESTED_GITIGNORE_ENTRY = 'runtime/';
// The pre-runtime bare `out/` line — tolerated by ensureGitignore, but dropped by a confirmed
// migration once out/'s contents have moved under runtime/ (spec runtime-layout P2).
const LEGACY_GITIGNORE_ENTRY = 'out/';

// Shipped declaration templates init instantiates: source template -> repo-relative (POSIX) dest.
// Each declaration's canonical `dest` sits under .nightwatch/. `legacy` is a pre-consolidation
// root location that still counts as "already present" (FR48) — so re-running init on an existing
// root-`STATE.md` install never creates a shadowing `.nightwatch/STATE.md` (the config reader
// prefers the nested copy). Relocating a legacy file is Story 7.2's confirmed migration, not init.
const DECLARATIONS = [
  { key: 'state', template: 'STATE.md', dest: '.nightwatch/STATE.md', legacy: 'STATE.md' },
  { key: 'config', template: 'config.yaml', dest: '.nightwatch/config.yaml' },
];

// Machine-owned orientation file (§2.4, FR65): the ~15-line three-tier layout map, instantiated
// to `.nightwatch/README.md` from the shipped template. Unlike the human DECLARATIONS (which are
// create-only and reported as "not updated" on a re-run), this is machine-owned and simply
// recreated whenever absent — but the write-if-absent mechanic is identical, so it never clobbers
// a version a user has edited. Only `init` writes it; no overnight code path touches it.
const README = { template: 'nightwatch-readme.md', dest: '.nightwatch/README.md' };

/** Read a shipped template's text; a missing template is a packaging bug, so throw. */
function readTemplate(name) {
  const t = readFileSafe(path.join(TEMPLATES_DIR, name));
  if (t == null) throw new Error(`shipped template not found: templates/${name}`);
  return t;
}

/** Human-facing filename for a declaration dest (e.g. `.nightwatch/STATE.md` → `STATE.md`). */
function declLabel(dest) { return dest.split('/').pop(); }

/**
 * Instantiate the shipped declaration templates into `root`, but ONLY where absent — init is
 * setup, not overwrite, so an existing STATE.md / config.yaml is never clobbered. Content is the
 * template verbatim (the human then edits it, or re-runs init). Deterministic; no network.
 *
 * init is CREATE-ONLY for declarations: it never refreshes an existing one. Each report entry
 * carries a human-readable `message` so re-running is honest about the boundary (FR51) — an
 * already-existing declaration is reported as "not updated; edit it directly or run
 * `/nightwatch init --update`" rather than a silent `reason: 'exists'`. `existing` names the path
 * that actually holds it (the nested dest, or a legacy root file), so the human edits the right one.
 * @param {string} root
 * @param {{ config?: boolean }} [opts]  also write .nightwatch/config.yaml (default true).
 * @returns {{ file: string, dest: string, written: boolean, reason: string, message: string, existing?: string }[]}
 */
function writeDeclarations(root, opts = {}) {
  const writeConfig = opts.config !== false;
  const report = [];
  for (const d of DECLARATIONS) {
    if (d.key === 'config' && !writeConfig) continue;
    const label = declLabel(d.dest);
    const abs = path.join(root, ...d.dest.split('/'));
    const legacyAbs = d.legacy ? path.join(root, ...d.legacy.split('/')) : null;
    // Present at the nested dest OR a legacy root location → never clobber, never shadow.
    const existing = exists(abs) ? d.dest : (legacyAbs && exists(legacyAbs) ? d.legacy : null);
    if (existing) {
      report.push({
        file: d.key, dest: d.dest, written: false, reason: 'exists', existing,
        message: `${label} already exists (${existing}) — not updated; edit it directly or run \`/nightwatch init --update\`.`,
      });
      continue;
    }
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, readTemplate(d.template));
    report.push({
      file: d.key, dest: d.dest, written: true, reason: 'created',
      message: `created ${d.dest} from the shipped template.`,
    });
  }
  return report;
}

/**
 * Ensure the disposable `runtime/` dir is git-ignored via a NESTED `.nightwatch/.gitignore` (FR50,
 * spec runtime-layout P1) — machine state must never be committed, but the project's root
 * `.gitignore` is never touched. Idempotent: appends `runtime/` only when absent, creating the
 * nested file if needed. A legacy bare `out/` line is left in place (harmless once runtime/out/ is
 * the write path).
 * @param {string} root
 * @returns {{ changed: boolean, path: string }}
 */
function ensureGitignore(root) {
  const rel = '.nightwatch/.gitignore';
  const gi = path.join(root, '.nightwatch', '.gitignore');
  const cur = readFileSafe(gi);
  const has = (cur || '').split('\n').some((l) => l.trim() === NESTED_GITIGNORE_ENTRY);
  if (has) return { changed: false, path: rel };
  ensureDir(path.dirname(gi));
  const sep = !cur ? '' : (cur.endsWith('\n') ? '' : '\n');
  fs.writeFileSync(gi, (cur || '') + sep + NESTED_GITIGNORE_ENTRY + '\n');
  return { changed: true, path: rel };
}

/**
 * Write the machine-owned orientation README (`.nightwatch/README.md`, FR65) from the shipped
 * template — write-if-absent, so a fresh init creates it and a deleted one is recreated on the next
 * init, but an existing (possibly user-edited) copy is left byte-for-byte untouched. Only `init`
 * calls this; overnight runs never do. Deterministic; no network.
 * @param {string} root
 * @returns {{ dest: string, written: boolean, reason: string }}
 */
function writeReadme(root) {
  const abs = path.join(root, ...README.dest.split('/'));
  if (exists(abs)) return { dest: README.dest, written: false, reason: 'exists' };
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, readTemplate(README.template));
  return { dest: README.dest, written: true, reason: 'created' };
}

/**
 * Plan the one-time relocation of legacy root artifacts into `.nightwatch/` (FR50). A move is
 * proposed only when the legacy file exists AND its consolidated destination is absent (so a repo
 * that already migrated, or opted RELEASE.md back to the root via `release_path`, proposes nothing).
 * Read-only: computes the plan the interview presents; nothing is written until the human confirms.
 * @param {string} root
 * @param {{ release_path?: string }} [config]  resolved config (defaults loaded when omitted).
 * @param {(root:string, args:string[], opts?:any)=>(string|null)} [gitFn]
 * @returns {{ moves: { key:string, from:string, to:string, tracked:boolean }[] }}
 */
function planMigration(root, config, gitFn = git) {
  const cfg = config || loadConfig(root).config;
  const releaseTo = (cfg.release_path || '.nightwatch/RELEASE.md').split('/').join('/');
  const candidates = [
    { key: 'state', from: 'STATE.md', to: '.nightwatch/STATE.md' },
    { key: 'release', from: 'RELEASE.md', to: releaseTo },
  ];
  const moves = [];
  for (const c of candidates) {
    if (c.from === c.to) continue; // release_path opts the file back to its legacy location → no move
    if (!exists(path.join(root, ...c.from.split('/')))) continue; // no legacy file
    if (exists(path.join(root, ...c.to.split('/')))) continue; // already at destination → idempotent
    const tracked = gitFn(root, ['ls-files', '--error-unmatch', c.from]) != null;
    moves.push({ key: c.key, from: c.from, to: c.to, tracked });
  }
  return { moves };
}

/**
 * Apply a confirmed migration plan: move each legacy file into `.nightwatch/`, byte-for-byte —
 * `git mv` when the file is tracked (so history follows), a content-preserving copy+unlink when
 * not. Never clobbers an already-relocated destination (idempotent). Human confirmation happens in
 * the interview; this executes only what was confirmed.
 * @param {string} root @param {{ moves: {key,from,to,tracked}[] }} plan
 * @param {(root:string, args:string[], opts?:any)=>(string|null)} [gitFn]
 * @returns {{ key:string, from:string, to:string, moved:boolean, method:(string|null), reason:string }[]}
 */
function applyMigration(root, plan, gitFn = git) {
  const report = [];
  for (const m of (plan.moves || [])) {
    const fromAbs = path.join(root, ...m.from.split('/'));
    const toAbs = path.join(root, ...m.to.split('/'));
    if (!exists(fromAbs)) { report.push({ ...m, moved: false, method: null, reason: 'source-absent' }); continue; }
    if (exists(toAbs)) { report.push({ ...m, moved: false, method: null, reason: 'destination-exists' }); continue; }
    ensureDir(path.dirname(toAbs));
    if (m.tracked && gitFn(root, ['mv', m.from, m.to]) != null) {
      report.push({ ...m, moved: true, method: 'git-mv', reason: 'moved (history preserved)' });
    } else {
      // Untracked, or git mv unavailable: preserve bytes exactly, then remove the source.
      const buf = fs.readFileSync(fromAbs);
      fs.writeFileSync(toAbs, buf);
      fs.unlinkSync(fromAbs);
      report.push({ ...m, moved: true, method: 'fs', reason: 'moved (content-preserved)' });
    }
  }
  return report;
}

/**
 * Plan the one-time migration of legacy machine state into the disposable `runtime/` boundary (spec
 * runtime-layout P2): `.nightwatch/state.json` → `runtime/cursors.json`, and each file in
 * `.nightwatch/out/` → `runtime/out/`. Read-only; a move is proposed only when the legacy path
 * exists AND its runtime destination is absent, so a repo that already migrated proposes nothing
 * (idempotent). `out/` is treated file-by-file so a partial prior migration completes cleanly.
 * @param {string} root @param {(root:string, args:string[], opts?:any)=>(string|null)} [gitFn]
 * @returns {{ moves: { key:string, from:string, to:string, tracked:boolean }[] }}
 */
function planRuntimeMigration(root, gitFn = git) {
  const moves = [];
  const propose = (key, from, to) => {
    if (!exists(path.join(root, ...from.split('/')))) return;
    if (exists(path.join(root, ...to.split('/')))) return;
    const tracked = gitFn(root, ['ls-files', '--error-unmatch', from]) != null;
    moves.push({ key, from, to, tracked });
  };
  propose('cursors', '.nightwatch/state.json', '.nightwatch/runtime/cursors.json');
  const legacyOut = path.join(root, '.nightwatch', 'out');
  if (exists(legacyOut)) {
    let names = [];
    try { names = fs.readdirSync(legacyOut, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort(); } catch { names = []; }
    for (const name of names) propose('out', `.nightwatch/out/${name}`, `.nightwatch/runtime/out/${name}`);
  }
  return { moves };
}

/**
 * Rewrite the nested `.nightwatch/.gitignore` for the runtime layout (spec runtime-layout P2): ensure
 * `runtime/` is ignored and drop a now-stale bare `out/` line (its contents have moved under
 * `runtime/`). Only called on a confirmed migration — the ungated {@link ensureGitignore} still
 * tolerates a legacy `out/` line. Idempotent; creates the file if absent.
 * @param {string} root @returns {{ changed: boolean, path: string }}
 */
function rewriteNestedGitignoreForRuntime(root) {
  const rel = '.nightwatch/.gitignore';
  const gi = path.join(root, '.nightwatch', '.gitignore');
  const cur = readFileSafe(gi) || '';
  const kept = cur.split('\n').filter((l) => l.trim() !== LEGACY_GITIGNORE_ENTRY);
  if (!kept.some((l) => l.trim() === NESTED_GITIGNORE_ENTRY)) {
    // Insert runtime/ where the file has content, keeping a trailing newline.
    while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    kept.push(NESTED_GITIGNORE_ENTRY);
  }
  const next = kept.join('\n').replace(/\n*$/, '') + '\n';
  if (next === cur) return { changed: false, path: rel };
  ensureDir(path.dirname(gi));
  fs.writeFileSync(gi, next);
  return { changed: true, path: rel };
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
 * @param {{ gitFn?: (root:string, args:string[], opts?:any)=>(string|null), files?: string[], config?: any, diskDirs?: string[], klass?: 'code'|'content' }} [opts]
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
  // Heuristics: git-tracked top-level dirs no product import references. DISABLED for a content-class
  // repo (FR100) — with no import substrate the "referenced by no product import" test is vacuous
  // (nothing is imported), so it would flag the whole product as tooling. Only convention candidates
  // are proposed there; every other tracked dir stays product by default.
  const klass = opts.klass || detectRepoClass(root).klass;
  if (klass === 'code') {
    for (const dir of trackedTopDirs(root, gitFn)) {
      if (seen.has(dir)) continue;
      if (!refs.has(dir) && !PRODUCT_DIR_ALLOWLIST.has(dir)) {
        candidates.push({ dir, glob: `${dir}/**`, source: 'heuristic', reason: 'top-level tracked directory referenced by no product import' });
        seen.add(dir);
      }
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

// ---- `/nightwatch init --update`: non-destructive reconfigure (FR52) ---------------------------

/** The user's OWN `dev_tooling:` entries from config.yaml (raw list that EXTENDS the defaults —
 * not the resolved set). Absent/unparseable → []. Used to union confirmed additions without ever
 * baking the shipped defaults into the file. */
function currentUserDevTooling(root) {
  const text = readFileSafe(path.join(root, '.nightwatch', 'config.yaml'));
  if (text == null) return [];
  try {
    const y = yaml.load(text);
    const dt = y && y.dev_tooling;
    return Array.isArray(dt) ? dt.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

/** Top-level path segments named by declared authority artifacts — so a dir a declaration already
 * covers is not re-proposed as "unclassified". */
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
 * Plan a non-destructive `init --update` (FR52): re-run detection against the CURRENT repo and
 * propose only what CHANGED — additions, never rewrites. Read-only; the interview confirms each
 * proposal before {@link applyUpdate} writes anything. Two proposal kinds, both deterministic:
 *   - `dev_tooling`: a detected dev-tooling candidate (Story 6.5) not already covered by the
 *     resolved `ignore`/`dev_tooling` — proposes adding its glob.
 *   - `module`: a git-tracked top-level dir that is analyzed (not excluded), not on the product
 *     allowlist, and not named by any authority declaration — a new module to classify (declare
 *     as product, or add to dev_tooling/ignore).
 * Idempotent: a repo unchanged since the last init/update proposes nothing.
 * @param {string} root @param {{ config?: any, gitFn?: any }} [opts]
 * @returns {{ proposals: { id:string, kind:string, dir?:string, glob?:string, block?:string, summary:string }[] }}
 */
function planUpdate(root, opts = {}) {
  const lc = loadConfig(root);
  const config = opts.config || lc.config;
  const gitFn = opts.gitFn || git;
  const excluded = makeIgnore(analysisExcludeGlobs(config));
  const authTops = authorityTopSegments(lc.authority);
  const proposals = [];
  const seen = new Set();
  // dev-tooling candidates not yet covered by the resolved exclude set.
  for (const c of detectDevToolingCandidates(root, { config, gitFn })) {
    if (excluded(`${c.dir}/__scope_probe__`)) continue; // already classified as dev_tooling/ignore
    proposals.push({ id: `dev_tooling:${c.dir}`, kind: 'dev_tooling', dir: c.dir, glob: c.glob, summary: `add \`${c.glob}\` to dev_tooling — ${c.reason}` });
    seen.add(c.dir);
  }
  // Unclassified modules: tracked, analyzed, not allowlisted, not authority-declared, not already
  // surfaced as a dev-tooling candidate above.
  for (const dir of trackedTopDirs(root, gitFn)) {
    if (seen.has(dir)) continue;
    if (excluded(`${dir}/__scope_probe__`)) continue;
    if (PRODUCT_DIR_ALLOWLIST.has(dir)) continue;
    if (authTops.has(dir)) continue;
    proposals.push({ id: `module:${dir}`, kind: 'module', dir, summary: `new top-level \`${dir}/\` is unclassified — declare it as product (authority) or add it to dev_tooling/ignore` });
  }
  // Milestone declaration draft (spec release-journey P1): a `release:` block with a definition of
  // done but no `milestones:` → offer to draft an ordered milestones block from the DoD list. The
  // road stays the maintainer's judgment; the draft is applied only on confirmation.
  const hasMilestones = lc.release && Array.isArray(lc.release.milestones) && lc.release.milestones.length > 0;
  const draft = draftMilestones(lc.release);
  if (draft && !hasMilestones) {
    proposals.push({ id: 'milestones:draft', kind: 'milestones', block: draft, summary: 'draft an ordered `milestones:` block from your definition of done (declares the release road)' });
  }
  return { proposals: proposals.sort((a, b) => a.id.localeCompare(b.id)) };
}

/**
 * Byte-preserving single-key rewrite of a declaration field (FR52) — the confirmed-declaration-edit
 * half of the unified update gate. Rewrites `key: <value>` in place: for `.nightwatch/STATE.md` the
 * line inside its fenced yaml block, for `.nightwatch/config.yaml` a top-level key. Every other line
 * of the file is preserved verbatim. Returns `{ changed }` — false when the key is absent (update
 * proposes only changes to fields that exist) or already equal.
 * @param {string} root @param {string} fileRel  repo-relative declaration path @param {string} key @param {string} value
 */
function setDeclarationField(root, fileRel, key, value) {
  const abs = path.join(root, ...fileRel.split('/'));
  const text = readFileSafe(abs);
  if (text == null) return { changed: false, reason: 'file-absent' };
  const lines = text.split('\n');
  // For STATE.md, confine the rewrite to inside the ```yaml fenced block.
  let lo = 0, hi = lines.length;
  if (/STATE\.md$/.test(fileRel)) {
    const open = lines.findIndex((l) => /^```ya?ml\s*$/i.test(l));
    if (open === -1) return { changed: false, reason: 'no-yaml-block' };
    const close = lines.findIndex((l, i) => i > open && /^```\s*$/.test(l));
    lo = open + 1; hi = close === -1 ? lines.length : close;
  }
  const re = new RegExp(`^(\\s*)${key}\\s*:`);
  for (let i = lo; i < hi; i++) {
    const m = lines[i].match(re);
    if (m) {
      const next = `${m[1]}${key}: ${value}`;
      if (lines[i] === next) return { changed: false, reason: 'already-equal' };
      lines[i] = next;
      fs.writeFileSync(abs, lines.join('\n'));
      return { changed: true };
    }
  }
  return { changed: false, reason: 'key-absent' };
}

/**
 * Apply ONLY the human-confirmed proposals of an `init --update` (FR52), byte-preserving every
 * unconfirmed part of each declaration. Both write kinds flow through this one gate so nothing is
 * create-only in one place and silent-overwrite in another:
 *   - `dev_tooling` proposals (and confirmed `module`s the human classified as tooling): their
 *     globs are UNIONED with the user's current `dev_tooling` and rewritten via {@link writeDevTooling}
 *     (single-line replace; rest of config.yaml preserved).
 *   - `field` edits (a confirmed declaration-field change proposed in the interview): applied via
 *     {@link setDeclarationField}.
 * Only confirmed items are written; skipped ones leave the file untouched. Idempotent.
 * @param {string} root
 * @param {{ devTooling?: string[], fields?: { file:string, key:string, value:string }[] }} confirmed
 * @returns {{ dev_tooling: any, fields: any[] }}
 */
/**
 * Insert a drafted `milestones:` block under STATE.md's `release:` key (spec release-journey P1),
 * byte-preserving every other line. Idempotent: a repo that already declares `milestones:` under
 * release is left untouched. The draft (from milestones.draftMilestones, at 0-indent) is re-indented
 * to release's child level and inserted at the end of the release sub-block, inside the yaml fence.
 * Returns `{ changed, reason? }`.
 * @param {string} root @param {string} block  the draft block ("milestones:\n  - name: …")
 */
function applyMilestonesDraft(root, block) {
  const rel = exists(path.join(root, '.nightwatch', 'STATE.md')) ? '.nightwatch/STATE.md' : 'STATE.md';
  const abs = path.join(root, ...rel.split('/'));
  const text = readFileSafe(abs);
  if (text == null) return { changed: false, reason: 'file-absent' };
  const lines = text.split('\n');
  const open = lines.findIndex((l) => /^```ya?ml\s*$/i.test(l));
  if (open === -1) return { changed: false, reason: 'no-yaml-block' };
  const close = lines.findIndex((l, i) => i > open && /^```\s*$/.test(l));
  const fenceEnd = close === -1 ? lines.length : close;
  const relIdx = lines.findIndex((l, i) => i > open && i < fenceEnd && /^release:\s*$/.test(l));
  if (relIdx === -1) return { changed: false, reason: 'no-release-block' };
  // The release sub-block ends at the next line indented to column 0 (a new top-level key), else the fence.
  let end = fenceEnd;
  for (let i = relIdx + 1; i < fenceEnd; i++) {
    if (lines[i].trim() === '') continue;
    if (/^\S/.test(lines[i])) { end = i; break; }
    if (/^\s+milestones:\s*$/.test(lines[i])) return { changed: false, reason: 'already-declared' };
  }
  const indented = block.replace(/\n$/, '').split('\n').map((l) => (l === '' ? '' : '  ' + l));
  lines.splice(end, 0, ...indented);
  fs.writeFileSync(abs, lines.join('\n'));
  return { changed: true };
}

function applyUpdate(root, confirmed = {}) {
  let devToolingResult = null;
  const adds = (confirmed.devTooling || []).map(toGlob).filter(Boolean);
  if (adds.length) {
    const union = [...new Set([...currentUserDevTooling(root), ...adds])];
    devToolingResult = writeDevTooling(root, union);
  }
  const fields = [];
  for (const f of (confirmed.fields || [])) {
    fields.push({ ...f, result: setDeclarationField(root, f.file, f.key, f.value) });
  }
  // Confirmed milestones draft (spec release-journey P1): insert the block under STATE.md's release:.
  const milestones = confirmed.milestones ? applyMilestonesDraft(root, confirmed.milestones) : null;
  return { dev_tooling: devToolingResult, fields, milestones };
}

/**
 * One deterministic init pass: probe the adapters, then (unless `probeOnly`) instantiate the
 * missing declaration files and register the out/ ignore. When `devTooling` is provided (the
 * human-confirmed classification), persist it into config.yaml AFTER the template is instantiated
 * so the declaration lands in a real file. Returns the structured report the command prompt reads
 * back to the human. With `probeOnly`, writes nothing.
 * When `migrate` is true (the human confirmed the relocation of legacy root artifacts), the move
 * runs FIRST — before declarations are instantiated — so a just-relocated `.nightwatch/STATE.md`
 * is seen as present and never re-created from the template.
 * @param {string} root
 * @param {{ probeOnly?: boolean, config?: boolean, adapters?: any[], devTooling?: string[], migrate?: boolean }} [opts]
 */
function runInit(root, opts = {}) {
  const probe = probeAdapters(root, opts.adapters);
  if (opts.probeOnly) return { probe, declarations: [], readme: null, gitignore: null, dev_tooling: null, migration: null, runtime_migration: null };
  const migration = opts.migrate ? applyMigration(root, planMigration(root)) : null;
  // Confirmed runtime-layout migration (spec runtime-layout P2): relocate legacy machine state under
  // runtime/ and rewrite the nested .gitignore. Content byte-preserved; idempotent; only on confirm.
  const runtime_migration = opts.migrate ? applyMigration(root, planRuntimeMigration(root)) : null;
  if (opts.migrate) rewriteNestedGitignoreForRuntime(root);
  const declarations = writeDeclarations(root, { config: opts.config });
  const readme = writeReadme(root);
  const gitignore = ensureGitignore(root);
  const dev_tooling = Array.isArray(opts.devTooling) ? writeDevTooling(root, opts.devTooling) : null;
  return { probe, declarations, readme, gitignore, dev_tooling, migration, runtime_migration };
}

module.exports = {
  runInit, writeDeclarations, writeReadme, ensureGitignore, probeAdapters, readTemplate, TEMPLATES_DIR,
  detectDevToolingCandidates, writeDevTooling, trackedTopDirs, planMigration, applyMigration,
  planRuntimeMigration, rewriteNestedGitignoreForRuntime,
  planUpdate, applyUpdate, applyMilestonesDraft, setDeclarationField, currentUserDevTooling,
};
