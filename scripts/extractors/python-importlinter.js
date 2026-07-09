// @ts-check
'use strict';
// python-importlinter.js — tool adapter (§2.6) wrapping import-linter for Python repos.
//
// One declaration, N enforcers: the user declares `layers:` once in .nightwatch/config.yaml
// (name + path glob + may_depend_on allow-list). This adapter COMPILES that declaration into
// import-linter's native contract config and lets import-linter prove the violations, mapping
// them back to normalized `layering-violation` signals. Zero custom import-graph code.
//
// Native format chosen: import-linter's INI config (the `[importlinter]` / `[importlinter:
// contract:N]` form accepted in `.importlinter` / `.ini` / `setup.cfg`). Picked over the
// pyproject `[tool.importlinter]` TOML form because it is import-linter's canonical standalone
// config and emits as plain text with no TOML dependency (js-yaml is our only runtime dep).
//
// Compilation strategy: each declared layer becomes a Python module derived from its path glob;
// `may_depend_on` is compiled into one `forbidden` contract per layer, forbidding imports to
// every sibling layer NOT in that layer's allow-list. This represents the may_depend_on DAG
// faithfully (a violation is "an import into a layer not in may_depend_on" — the same rule the
// universal arch-signals built-in applies), which import-linter's linear `layers` contract type
// cannot express. Everything is sorted, so the output is deterministic (NFR8).
//
// LOCAL-ONLY, NO NETWORK (FR10, §6): the `lint-imports` binary is resolved from <repo>/.venv/bin,
// then <repo>/venv/bin, then PATH — never installed, never fetched. When absent, run() is not
// called; the runner degrades with explain().install as the hint.
const path = require('path');
const { execFileSync } = require('child_process');
const { exists, outDir, ensureDir } = require('../lib/util');
const { loadConfig } = require('../lib/config');
const { makeSignal } = require('../lib/signals');

const BIN = 'lint-imports';
const GLOB_META = /[*?[\]{}!]/;

/** Does this ecosystem apply? Python manifest heuristics. */
function detect(repo) {
  return exists(path.join(repo, 'pyproject.toml'))
    || exists(path.join(repo, 'setup.py'))
    || exists(path.join(repo, 'requirements.txt'));
}

/** Resolve the lint-imports binary LOCAL-ONLY: repo venvs first, then PATH. Returns path|null. */
function resolveBin(repo) {
  const local = [path.join(repo, '.venv', 'bin', BIN), path.join(repo, 'venv', 'bin', BIN)];
  for (const p of local) if (exists(p)) return p;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, BIN);
    if (exists(p)) return p;
  }
  return null;
}

/** Can the tool run locally? Never installs, never hits the network. */
function available(repo) {
  return resolveBin(repo) != null;
}

/** Derive a dotted Python module from a layer's path glob (leading non-glob segments). */
function globToModule(glob) {
  const kept = [];
  for (const seg of String(glob || '').split('/')) {
    if (!seg || GLOB_META.test(seg)) break;
    kept.push(seg.replace(/\.py$/, ''));
  }
  return kept.join('.');
}

/**
 * Compile declared `layers:` into an import-linter INI config (the deterministic, testable core).
 * @param {Array<{name:string, path?:string, may_depend_on?:string[]}>} layers
 * @param {{ rootPackages?: string[] }} [opts]
 * @returns {string} import-linter native INI config text
 */
function compileContracts(layers, opts = {}) {
  const list = (Array.isArray(layers) ? layers : []).filter((l) => l && l.name);
  const moduleByName = new Map();
  for (const l of list) moduleByName.set(l.name, globToModule(l.path) || l.name);

  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  const roots = (opts.rootPackages && opts.rootPackages.length
    ? [...opts.rootPackages]
    : [...new Set([...moduleByName.values()].map((m) => m.split('.')[0]).filter(Boolean))]
  ).sort((a, b) => a.localeCompare(b));

  const lines = ['[importlinter]', 'root_packages ='];
  for (const r of roots) lines.push('    ' + r);

  let idx = 0;
  for (const l of sorted) {
    const allow = new Set(l.may_depend_on || []);
    const forbidden = sorted.filter((o) => o.name !== l.name && !allow.has(o.name));
    if (!forbidden.length) continue;
    idx += 1;
    const fNames = forbidden.map((o) => o.name); // already sorted by name
    const fMods = forbidden.map((o) => moduleByName.get(o.name)).sort((a, b) => a.localeCompare(b));
    lines.push('');
    lines.push(`[importlinter:contract:${idx}]`);
    lines.push(`name = ${l.name} may not import ${fNames.join(', ')}`);
    lines.push('type = forbidden');
    lines.push('source_modules =');
    lines.push('    ' + moduleByName.get(l.name));
    lines.push('forbidden_modules =');
    for (const m of fMods) lines.push('    ' + m);
  }
  return lines.join('\n') + '\n';
}

/** Best-effort dotted-module → file-path guess for evidence pointers. */
function moduleToPath(mod) {
  return String(mod).split('.').join('/') + '.py';
}

/** Parse import-linter output into {from, fromLine, to} violation records. */
function parseViolations(output) {
  const out = [];
  const re = /^-?\s*([\w.]+)\s*->\s*([\w.]+)\s*\(l\.(\d+)\)/;
  for (const raw of String(output || '').split('\n')) {
    const m = raw.trim().match(re);
    if (m) out.push({ from: m[1], to: m[2], line: Number(m[3]) });
  }
  return out;
}

/** Best-effort version probe (unit-tested path only; tool absent in CI). */
function toolVersion(bin) {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8' });
    const m = String(out).match(/\d+\.\d+(?:\.\d+)?/);
    if (m) return m[0];
  } catch { /* no --version support / not runnable */ }
  return 'unknown';
}

/**
 * Compile contracts, run import-linter, map violations to layering-violation signals.
 * @param {string} repo
 * @param {any} [config]
 * @returns {{ signals: any[], tool: string }}
 */
function run(repo, config) {
  const layers = (config && Array.isArray(config.layers)) ? config.layers : loadConfig(repo).layers;
  const ini = compileContracts(layers);
  ensureDir(outDir(repo));
  const iniPath = path.join(outDir(repo), 'importlinter.ini'); // transient, under out/
  require('fs').writeFileSync(iniPath, ini);

  const bin = resolveBin(repo);
  if (!bin) throw new Error('lint-imports not resolved locally');

  // import-linter exits non-zero when contracts are broken; capture stdout from the error too.
  let output = '';
  try {
    output = execFileSync(bin, ['--config', iniPath], { cwd: repo, encoding: 'utf8' });
  } catch (e) {
    const err = /** @type {any} */ (e);
    output = String((err && err.stdout) || '') + String((err && err.stderr) || '');
  }

  const signals = parseViolations(output).map((v) => makeSignal({
    kind: 'layering-violation',
    confidence: 'exact',
    detail: `${v.from} → ${v.to} import violates declared layer rule`,
    source: 'python-importlinter',
    evidence: [{ path: moduleToPath(v.from), line: v.line }, { path: moduleToPath(v.to) }],
  }));

  return { signals, tool: `import-linter@${toolVersion(bin)}` };
}

/** Identity + install hint for degraded notices and /nightwatch init. */
function explain() {
  return {
    name: 'python-importlinter',
    tool: 'import-linter',
    install: 'pip install import-linter',
    summary: 'import-linter not installed — layering signals unavailable; universal git signals used',
  };
}

module.exports = { detect, available, run, explain, compileContracts, resolveBin, parseViolations };
