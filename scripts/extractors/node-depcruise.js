// @ts-check
'use strict';
// node-depcruise.js — the Node/TypeScript tool adapter (§2.6, FR12/FR15). It wraps the
// host-provided `dependency-cruiser` analyzer and turns its native JSON output into the shared
// signals schema (lib/signals.js): `layering-violation`, `cycle`, `orphan`. Nightwatch never
// bundles, installs, or downloads the tool — it is used only when it resolves locally.
//
// The one deterministic, testable core here is COMPILATION: the user declares `layers:` once
// (config.layers) and `compileRuleset()` turns that declaration into dependency-cruiser's native
// ruleset format (golden-file tested). run() then invokes the local binary and maps violations
// back to signals; that tool-invocation path is exercised only where the tool is present.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { exists, outDir, ensureDir, readJSONSafe, globToRegExp } = require('../lib/util');
const { loadConfig } = require('../lib/config');
const { makeSignal } = require('../lib/signals');

/** @typedef {import('../lib/types').LayerRule} LayerRule */
/** @typedef {import('../lib/types').Signal} Signal */

const SOURCE = 'node-depcruise';

// dependency-cruiser config file names it recognizes in a repo root. If any is present the host
// has declared its own rules — principle 5 says we honor that declaration verbatim (FR15).
const HOST_CONFIG_NAMES = [
  '.dependency-cruiser.cjs', '.dependency-cruiser.js', '.dependency-cruiser.mjs',
  '.dependency-cruiser.json', '.dependency-cruiser.json5',
  '.dependency-cruiserrc.cjs', '.dependency-cruiserrc.js', '.dependency-cruiserrc.json',
];

// ---- contract: detect -------------------------------------------------------------------------

/** Does the Node ecosystem apply? A `package.json` at the repo root is the manifest heuristic. */
function detect(repo) {
  return exists(path.join(repo, 'package.json'));
}

// ---- contract: available (local-only, never network) ------------------------------------------

/**
 * Resolve the `depcruise` binary WITHOUT touching the network: the host repo's
 * `node_modules/.bin` first, then `PATH`. Returns the absolute path or null. Never npx-fetches
 * or installs — an unresolved tool simply means the adapter degrades (§2.6, §6 no-network rule).
 */
function resolveBin(repo) {
  const localNames = ['depcruise', 'depcruise.cmd', 'depcruise.CMD'];
  for (const n of localNames) {
    const p = path.join(repo, 'node_modules', '.bin', n);
    if (exists(p)) return p;
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const n of localNames) {
      const p = path.join(d, n);
      if (exists(p)) return p;
    }
  }
  return null;
}

/** Can the tool run locally? (boolean; resolution is local-only — see resolveBin). */
function available(repo) {
  return resolveBin(repo) != null;
}

// ---- deterministic core: layers -> dependency-cruiser ruleset (golden-file tested) ------------

/** A layer glob compiled to a dependency-cruiser `path` regex string (anchored full-match). */
function layerPathRegex(glob) {
  return globToRegExp(glob || '').source;
}

/**
 * Compile a declared `layers:` list into a dependency-cruiser ruleset (its native `forbidden`
 * rule format). PURE and deterministic — no I/O, stable ordering — so it is golden-file tested.
 * One `layers:` declaration, N enforcers, zero custom graph code (§2.6).
 *
 * For each layer, every OTHER layer it does not list in `may_depend_on` (and is not itself)
 * becomes a forbidden `from -> to` rule. Two always-present global rules make dependency-cruiser
 * also report cycles and orphans, which map to `cycle` / `orphan` signals.
 * @param {LayerRule[]} layers
 * @returns {{ forbidden: any[], options: any }}
 */
function compileRuleset(layers) {
  const list = Array.isArray(layers) ? layers.filter((l) => l && l.name && l.path) : [];
  // Deterministic layer ordering by name so the generated ruleset is byte-stable run to run.
  const sorted = [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const layeringRules = [];
  for (const layer of sorted) {
    const allowed = new Set([layer.name, ...(Array.isArray(layer.may_depend_on) ? layer.may_depend_on : [])]);
    for (const target of sorted) {
      if (allowed.has(target.name)) continue; // itself or an allowed dependency
      layeringRules.push({
        name: `layer-${layer.name}-not-to-${target.name}`,
        comment: `Layer "${layer.name}" may not depend on layer "${target.name}" (declared may_depend_on)`,
        severity: 'error',
        from: { path: layerPathRegex(layer.path) },
        to: { path: layerPathRegex(target.path) },
      });
    }
  }

  const forbidden = [
    ...layeringRules,
    {
      name: 'no-circular',
      comment: 'Circular dependency (import cycle)',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'Orphan module — imported by nothing and importing nothing',
      severity: 'warn',
      from: { orphan: true, pathNot: '(^|/)\\.[^/]+$' },
      to: {},
    },
  ];

  return {
    forbidden,
    options: {
      doNotFollow: { path: 'node_modules' },
      tsPreCompilationDeps: true,
    },
  };
}

// ---- config-source selection: host config verbatim vs. compiled from layers -------------------

/** First host dependency-cruiser config present at the repo root, or null. */
function findHostConfig(repo) {
  for (const n of HOST_CONFIG_NAMES) {
    const p = path.join(repo, n);
    if (exists(p)) return p;
  }
  return null;
}

/**
 * Decide which ruleset drives this run (§2.6, FR15). Pure selection logic (no tool invocation),
 * so it is unit-testable even where dependency-cruiser is absent:
 *   - host config present            -> mode:'host'         (honor the host declaration verbatim)
 *   - else layers declared           -> mode:'compiled'     (compile layers -> ruleset)
 *   - else nothing to enforce        -> mode:'not-configured'
 * @param {string} repo
 * @param {LayerRule[]} layers
 */
function selectConfigSource(repo, layers) {
  const hostConfig = findHostConfig(repo);
  if (hostConfig) return { mode: 'host', hostConfig, layers };
  if (Array.isArray(layers) && layers.some((l) => l && l.name && l.path)) {
    return { mode: 'compiled', hostConfig: null, layers };
  }
  return { mode: 'not-configured', hostConfig: null, layers: [] };
}

// ---- output parsing: dependency-cruiser violations -> normalized signals -----------------------

/** Map one dependency-cruiser violation to a signal kind. */
function classifyViolation(v) {
  const name = v && v.rule && v.rule.name;
  const type = v && v.type;
  if (name === 'no-circular' || type === 'cycle' || (v && Array.isArray(v.cycle) && v.cycle.length)) return 'cycle';
  if (name === 'no-orphans' || type === 'orphan') return 'orphan';
  return 'layering-violation';
}

/** A cycle member (string, or `{name}` object across dependency-cruiser versions) -> path. */
function cycleMemberPath(m) {
  if (typeof m === 'string') return m;
  if (m && typeof m.name === 'string') return m.name;
  return null;
}

/**
 * Turn a parsed `depcruise --output-type json` result into normalized signals. Every signal is
 * `confidence:'exact'` — dependency-cruiser proved the fact — carries both file pointers in
 * evidence, and is `source:'node-depcruise'`. Deterministic: violations are sorted first.
 * @param {any} cruise
 * @returns {Signal[]}
 */
function violationsToSignals(cruise) {
  const violations = cruise && cruise.summary && Array.isArray(cruise.summary.violations)
    ? cruise.summary.violations : [];
  const sorted = [...violations].sort((a, b) => {
    const ka = `${(a && a.rule && a.rule.name) || ''}|${(a && a.from) || ''}|${(a && a.to) || ''}`;
    const kb = `${(b && b.rule && b.rule.name) || ''}|${(b && b.from) || ''}|${(b && b.to) || ''}`;
    return ka.localeCompare(kb);
  });

  const signals = [];
  for (const v of sorted) {
    const kind = classifyViolation(v);
    const from = v && v.from;
    const to = v && v.to;
    if (kind === 'cycle') {
      const members = (v && Array.isArray(v.cycle) ? v.cycle.map(cycleMemberPath).filter(Boolean) : []);
      const chain = [from, ...members].filter((x) => typeof x === 'string');
      const evidence = (chain.length ? chain : [from, to]).filter((x) => typeof x === 'string').map((p) => ({ path: p }));
      signals.push(makeSignal({
        kind: 'cycle', confidence: 'exact', source: SOURCE, evidence,
        detail: `import cycle: ${chain.length ? chain.join(' -> ') : `${from} -> ${to}`}`,
      }));
      continue;
    }
    if (kind === 'orphan') {
      signals.push(makeSignal({
        kind: 'orphan', confidence: 'exact', source: SOURCE,
        evidence: [from].filter((x) => typeof x === 'string').map((p) => ({ path: p })),
        detail: `orphan module: ${from} is imported by nothing and imports nothing`,
      }));
      continue;
    }
    signals.push(makeSignal({
      kind: 'layering-violation', confidence: 'exact', source: SOURCE,
      evidence: [from, to].filter((x) => typeof x === 'string').map((p) => ({ path: p })),
      detail: `layering violation: ${from} -> ${to} breaks rule ${(v && v.rule && v.rule.name) || 'unknown'}`,
    }));
  }
  return signals;
}

// ---- contract: run ----------------------------------------------------------------------------

/** Read the locally installed dependency-cruiser version without invoking it, if possible. */
function localToolVersion(repo) {
  const pkg = readJSONSafe(path.join(repo, 'node_modules', 'dependency-cruiser', 'package.json'));
  return pkg && typeof pkg.version === 'string' ? pkg.version : 'unknown';
}

/** Scan targets to hand dependency-cruiser: the layer roots when compiling, else the repo. */
function scanTargets(repo, source) {
  if (source.mode === 'compiled') {
    const roots = new Set();
    for (const l of source.layers) {
      const g = String(l.path || '');
      const seg = g.split('/')[0];
      if (seg && !seg.includes('*')) roots.add(seg);
    }
    const list = [...roots].sort();
    if (list.length) return list;
  }
  // Host config (or a layer set with only globbed roots): let the config's own scope decide;
  // `src` is the conventional root, falling back to the repo when it is absent.
  return exists(path.join(repo, 'src')) ? ['src'] : ['.'];
}

/**
 * Invoke the local dependency-cruiser and return normalized signals (§2.6, FR12/FR15). Selection
 * of the driving ruleset:
 *   - host `.dependency-cruiser*` config  -> used verbatim; the fact is reported in `degraded`;
 *   - declared `layers:`                  -> compiled to a ruleset written transiently under out/;
 *   - neither                             -> contributes nothing + a "not configured" notice.
 * dependency-cruiser exits non-zero when it FINDS violations, so its JSON is read from stdout in
 * both the success and the "found violations" cases; a genuinely unreadable result throws so the
 * runner drops just this adapter.
 * @param {string} repo
 * @param {any} [config] merged config (config.layers); loaded if omitted.
 * @returns {{ signals: Signal[], tool?: string, degraded: string[], mode: string, hostConfig: string|null }}
 */
function run(repo, config) {
  const layers = config && Array.isArray(config.layers) ? config.layers : loadConfig(repo).layers;
  const source = selectConfigSource(repo, layers);

  if (source.mode === 'not-configured') {
    return {
      signals: [], tool: undefined, mode: source.mode, hostConfig: null,
      degraded: [`${SOURCE}: no layers declared and no host dependency-cruiser config — not configured`],
    };
  }

  const degraded = [];
  const out = outDir(repo);
  ensureDir(out);

  let configPath;
  let hostConfigRel = null;
  if (source.mode === 'host') {
    configPath = source.hostConfig;
    hostConfigRel = path.relative(repo, source.hostConfig);
    degraded.push(`${SOURCE}: host config ${hostConfigRel} present — using it verbatim (FR15)`);
  } else {
    const ruleset = compileRuleset(source.layers);
    configPath = path.join(out, 'depcruise-ruleset.cjs');
    fs.writeFileSync(configPath, `module.exports = ${JSON.stringify(ruleset, null, 2)};\n`);
  }

  const bin = resolveBin(repo);
  if (!bin) throw new Error('dependency-cruiser binary vanished between available() and run()');

  const cliArgs = ['--config', configPath, '--output-type', 'json', ...scanTargets(repo, source)];

  let stdout;
  try {
    stdout = execFileSync(bin, cliArgs, {
      cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // Non-zero exit is normal when violations are found; the JSON is still on stdout.
    stdout = e && e.stdout != null ? String(e.stdout) : '';
    if (!stdout.trim()) throw new Error(`dependency-cruiser failed: ${(e && e.message) || e}`);
  }

  let cruise;
  try { cruise = JSON.parse(stdout); }
  catch { throw new Error('dependency-cruiser produced unparsable JSON output'); }

  const signals = violationsToSignals(cruise);
  return {
    signals,
    tool: `dependency-cruiser@${localToolVersion(repo)}`,
    degraded,
    mode: source.mode,
    hostConfig: hostConfigRel,
  };
}

// ---- contract: explain ------------------------------------------------------------------------

/** Identity + install hint for degraded notices, the sources list, and /nightwatch init. */
function explain() {
  return {
    name: SOURCE,
    tool: 'dependency-cruiser',
    install: 'npm i -D dependency-cruiser',
    summary: 'dependency-cruiser not installed — layering/cycle/orphan signals unavailable; universal git signals used',
  };
}

module.exports = {
  detect, available, run, explain,
  // exported for tests / reuse:
  compileRuleset, selectConfigSource, findHostConfig, violationsToSignals,
  classifyViolation, resolveBin,
};
