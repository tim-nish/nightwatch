#!/usr/bin/env node
// @ts-check
'use strict';
// arch-signals.js — deterministic architecture signals for /arch-review. Emits candidates
// the judgment layer then argues both sides of; it never decides. Classes: speculation,
// duplication, hidden coupling (via git-signals), layering (only when declared), growth.
// Writes out/arch-signals-<date>.json.
const path = require('path');
const { parseArgs, guardCli, repoRoot, todayISO, walkFiles, readFileSafe, topSegment, globToRegExp, writeJSON, outDir } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { analysisExcludeGlobs } = require('./lib/scope');
const { gitSignals } = require('./git-signals');

const CODE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py)$/;
function isCode(rel) { return CODE_EXT.test(rel) && !/\.(test|spec)\./.test(rel) && !/\/(tests?|__tests__)\//.test(rel); }

/** Extract import targets (raw module strings) from a source file. */
function imports(text) {
  const out = [];
  for (const m of text.matchAll(/import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  for (const m of text.matchAll(/^\s*from\s+([.\w]+)\s+import\s/gm)) out.push(m[1]);
  for (const m of text.matchAll(/^\s*import\s+([.\w]+)/gm)) out.push(m[1]);
  return out;
}

/** Resolve a relative import to a repo-relative path (best-effort, extension-stripped). */
function resolveRel(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const dir = path.posix.dirname(fromRel);
  let p = path.posix.normalize(path.posix.join(dir, spec));
  return p.replace(/\\/g, '/');
}

function archSignals(root) {
  const { config, layers, authority } = loadConfig(root);
  const degraded = [];
  const files = walkFiles(root, analysisExcludeGlobs(config));
  const codeFiles = files.filter(isCode);

  // ---- Speculation: TS/JS interfaces with exactly one implementer ----
  const speculation = [];
  const ifaceDecl = new Map(); // name -> {path, line}
  const implementsCount = new Map();
  for (const rel of codeFiles) {
    const text = readFileSafe(path.join(root, rel));
    if (text == null) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const d = lines[i].match(/(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/);
      if (d && !ifaceDecl.has(d[1])) ifaceDecl.set(d[1], { path: rel, line: i + 1 });
      for (const m of lines[i].matchAll(/implements\s+([A-Za-z_$][\w$,\s]*)/g)) {
        for (const nm of m[1].split(',').map((s) => s.trim()).filter(Boolean)) implementsCount.set(nm, (implementsCount.get(nm) || 0) + 1);
      }
      // Python ABCs
      const pd = lines[i].match(/class\s+([A-Za-z_]\w*)\s*\(\s*(?:ABC|Protocol)\s*\)/);
      if (pd && !ifaceDecl.has(pd[1])) ifaceDecl.set(pd[1], { path: rel, line: i + 1 });
    }
  }
  const anyTs = codeFiles.some((f) => /\.(ts|tsx)$/.test(f));
  // Honest emptiness (FR104): speculation's substrate is a typed language. No typed source →
  // the class is vacuous ("nothing to check"), reported as degradation — never a clean empty.
  if (!anyTs && !codeFiles.some((f) => /\.py$/.test(f))) degraded.push('speculation: no typed language detected — interface check vacuous');
  for (const [name, loc] of ifaceDecl) {
    const n = implementsCount.get(name) || 0;
    if (n <= 1) speculation.push({ name, path: loc.path, line: loc.line, implementers: n,
      note: n === 0 ? 'declared interface/protocol with no implementers found' : 'interface/protocol with exactly one implementer' });
  }
  speculation.sort((a, b) => a.implementers - b.implementers || a.name.localeCompare(b.name));

  // ---- Duplication: same function/def name defined in >1 module ----
  const nameLoci = new Map(); // name -> [{path, module}]
  for (const rel of codeFiles) {
    const text = readFileSafe(path.join(root, rel));
    if (text == null) continue;
    for (const m of text.matchAll(/(?:function|def)\s+([A-Za-z_$][\w$]*)/g)) {
      if (m[1].length < 4) continue;
      const arr = nameLoci.get(m[1]) || []; arr.push({ path: rel, module: topSegment(rel) }); nameLoci.set(m[1], arr);
    }
  }
  const duplication = [];
  for (const [name, loci] of nameLoci) {
    const modules = [...new Set(loci.map((l) => l.module))];
    if (modules.length > 1) duplication.push({ name, modules, evidence: loci.slice(0, 6).map((l) => ({ path: l.path })) });
  }
  duplication.sort((a, b) => b.modules.length - a.modules.length || a.name.localeCompare(b.name));
  // Vacuous when there are no source defs to compare across modules (FR104): a markdown/no-code
  // repo yields no duplication because there is nothing to duplicate, not because it is clean.
  if (!duplication.length && nameLoci.size === 0) degraded.push('duplication: no source functions/defs found — check vacuous');

  // ---- Import graph (for coupling-overlap and layering) ----
  const fileImports = new Map(); // rel -> resolved targets (repo-relative or bare)
  const moduleImports = new Map(); // module -> Set of imported bare specs
  for (const rel of codeFiles) {
    const text = readFileSafe(path.join(root, rel));
    if (text == null) continue;
    const specs = imports(text);
    fileImports.set(rel, specs);
    const bareSet = moduleImports.get(topSegment(rel)) || new Set();
    for (const s of specs) if (!s.startsWith('.')) bareSet.add(s.split('/')[0]);
    moduleImports.set(topSegment(rel), bareSet);
  }
  // Heavy import-set overlap between modules (Jaccard >= 0.6, >= 3 shared).
  const import_overlap = [];
  const mods = [...moduleImports.keys()];
  for (let i = 0; i < mods.length; i++) for (let j = i + 1; j < mods.length; j++) {
    const A = moduleImports.get(mods[i]), B = moduleImports.get(mods[j]);
    if (A.size < 3 || B.size < 3) continue;
    let shared = 0; for (const x of A) if (B.has(x)) shared++;
    const jac = shared / (A.size + B.size - shared);
    if (shared >= 3 && jac >= 0.6) import_overlap.push({ module_a: mods[i], module_b: mods[j], shared, jaccard: Number(jac.toFixed(2)) });
  }
  import_overlap.sort((a, b) => b.jaccard - a.jaccard);
  // Vacuous when fewer than two modules carry enough imports to compare (FR104): with no import
  // substrate the overlap check has nothing to weigh, which is degradation, not a clean result.
  const comparableModules = mods.filter((m) => moduleImports.get(m).size >= 3).length;
  if (!import_overlap.length && comparableModules < 2) degraded.push('import-overlap: fewer than two modules with enough imports to compare — check vacuous');

  // ---- Layering violations (only when declared) ----
  let layering = [];
  let layering_configured = Array.isArray(layers) && layers.length > 0;
  if (!layering_configured) {
    degraded.push('layering: no `layers:` declared in config — layering checks skipped (not-configured)');
  } else {
    const compiled = layers.map((l) => ({ name: l.name, re: globToRegExp(l.path || '**'), may: new Set(l.may_depend_on || []) }));
    const layerOf = (rel) => { for (const l of compiled) if (l.re.test(rel)) return l; return null; };
    for (const [rel, specs] of fileImports) {
      const from = layerOf(rel); if (!from) continue;
      for (const s of specs) {
        const target = resolveRel(rel, s); if (!target) continue;
        // try target with common code extensions / index files
        const cands = [target, target + '.ts', target + '.js', target + '.py', target + '/index.ts', target + '/index.js'];
        let toLayer = null, hit = null;
        for (const c of cands) { const l = layerOf(c); if (l) { toLayer = l; hit = c; break; } }
        if (!toLayer || toLayer.name === from.name) continue;
        if (!from.may.has(toLayer.name)) layering.push({ from_layer: from.name, to_layer: toLayer.name, evidence: [{ path: rel }, { path: hit }] });
      }
    }
  }

  // ---- Hidden coupling + growth (git) ----
  const gs = gitSignals(root, { ignoreGlobs: analysisExcludeGlobs(config) });
  for (const d of gs.degraded) degraded.push('coupling: ' + d);
  const hidden_coupling = gs.coupling;

  // Growth: hotspots not mentioned in the declared architecture doc (only if declared).
  let growth = { hotspots: gs.hotspots, unmentioned_hotspots: [], arch_doc: null };
  const archDoc = authority && authority.architecture && authority.architecture.artifact;
  if (archDoc) {
    const docText = (readFileSafe(path.join(root, archDoc)) || '').toLowerCase();
    growth.arch_doc = archDoc;
    if (docText) {
      for (const h of gs.hotspots.slice(0, 10)) {
        const base = path.posix.basename(h.path).toLowerCase();
        const mod = topSegment(h.path).toLowerCase();
        if (!docText.includes(base) && !docText.includes(mod)) growth.unmentioned_hotspots.push(h);
      }
    } else degraded.push(`growth: architecture doc "${archDoc}" not found/empty`);
  }

  // Zero-candidate path (FR104): when there is no code substrate at all and every candidate
  // class came back empty, the whole deterministic layer is vacuous. Emit one summary degraded
  // line and flag it so the judgment layer skips the adversarial refute pass over an empty set
  // (commands/arch-review.md) rather than reading the silence as a clean pass.
  const all_vacuous = codeFiles.length === 0
    && !speculation.length && !duplication.length && !import_overlap.length
    && !layering.length && !hidden_coupling.length
    && !((growth.unmentioned_hotspots || []).length);
  if (all_vacuous) degraded.push('all architecture signal classes are vacuous — no candidates to judge (zero-candidate path)');

  return {
    degraded,
    all_vacuous,
    layering_configured,
    speculation: speculation.slice(0, 40),
    duplication: duplication.slice(0, 40),
    import_overlap: import_overlap.slice(0, 20),
    layering: layering.slice(0, 40),
    hidden_coupling,
    growth,
  };
}

function main() {
  const args = guardCli('arch-signals.js', process.argv.slice(2), ['date']);
  const root = repoRoot(args);
  const date = todayISO(args);
  const sig = archSignals(root);
  writeJSON(path.join(outDir(root), `arch-signals-${date}.json`), { job: 'arch-signals', date, ...sig });
  process.stdout.write(JSON.stringify({ speculation: sig.speculation.length, duplication: sig.duplication.length, import_overlap: sig.import_overlap.length, layering: sig.layering.length, hidden_coupling: sig.hidden_coupling.length, degraded: sig.degraded }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { archSignals };
