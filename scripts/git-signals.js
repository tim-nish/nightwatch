#!/usr/bin/env node
// @ts-check
'use strict';
// git-signals.js — universal signals from git history alone (no language awareness):
// churn, co-change coupling across module boundaries, hotspots. Always available in any
// git repo. Usable as a CLI (--repo . writes out/git-signals-<date>.json) or as a module.
const { parseArgs, repoRoot, todayISO, git, isGitRepo, commitCount, topSegment, makeIgnore, walkFiles, readFileSafe, writeJSON, outDir } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { makeSignal, writeSignals } = require('./lib/signals');
const path = require('path');

/**
 * Compute git signals over the last `window` commits.
 * Returns { degraded, commits_scanned, churn, hotspots, coupling }.
 */
function gitSignals(root, { window = 400, ignoreGlobs = [], couplingMinCommits = 5 } = {}) {
  const degraded = [];
  if (!isGitRepo(root)) return { degraded: ['not a git repository'], commits_scanned: 0, churn: [], hotspots: [], coupling: [] };

  const total = commitCount(root);
  if (total < 20) degraded.push(`shallow history (${total} commits) — coupling checks skipped`);

  const ignore = makeIgnore(ignoreGlobs);
  // Per-commit file lists: `--name-only` with a record separator we can split on.
  const raw = git(root, ['log', `-n${window}`, '--no-merges', '--name-only', '--pretty=format:%x1ecommit%x1e']);
  const churn = new Map(); // file -> commits touching it
  const commits = []; // arrays of files per commit
  if (raw != null) {
    for (const block of raw.split('\x1ecommit\x1e')) {
      const files = block.split('\n').map((s) => s.trim()).filter((s) => s && !ignore(s));
      if (!files.length) continue;
      commits.push(files);
      for (const f of files) churn.set(f, (churn.get(f) || 0) + 1);
    }
  }

  const churnArr = [...churn.entries()].map(([path_, count]) => ({ path: path_, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  const hotspots = churnArr.slice(0, 15);

  // Co-change coupling across module boundaries.
  const coupling = [];
  if (total >= 20) {
    const pairCounts = new Map();
    for (const files of commits) {
      if (files.length < 2 || files.length > 50) continue; // huge commits are noise
      const uniq = [...new Set(files)].sort();
      for (let i = 0; i < uniq.length; i++) {
        for (let j = i + 1; j < uniq.length; j++) {
          if (topSegment(uniq[i]) === topSegment(uniq[j])) continue; // cross-boundary only
          const key = uniq[i] + '' + uniq[j];
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }
    for (const [key, count] of pairCounts) {
      if (count < couplingMinCommits) continue;
      const [a, b] = key.split('');
      coupling.push({ a, b, commits: count, module_a: topSegment(a), module_b: topSegment(b) });
    }
    coupling.sort((x, y) => y.commits - x.commits || x.a.localeCompare(y.a));
  }

  return { degraded, commits_scanned: commits.length, churn: churnArr, hotspots, coupling };
}

/**
 * Net line growth per file over the window (added − deleted, from `--numstat`). Binary files
 * (`-` counts) and rename lines are ignored. Deterministic: sorted by net desc then path.
 * @param {string} root
 * @param {{ window?: number, ignore?: (p: string) => boolean }} [opts]
 */
function growthTrend(root, { window = 400, ignore = () => false } = {}) {
  const raw = git(root, ['log', `-n${window}`, '--no-merges', '--numstat', '--pretty=format:%x1ecommit%x1e']);
  const net = new Map();
  if (raw != null) {
    for (const line of raw.split('\n')) {
      const m = line.match(/^(\d+)\t(\d+)\t(.+)$/);
      if (!m) continue;
      const file = m[3].trim();
      if (!file || file.includes('=>') || ignore(file)) continue; // skip renames + ignored
      net.set(file, (net.get(file) || 0) + (parseInt(m[1], 10) - parseInt(m[2], 10)));
    }
  }
  return [...net.entries()].map(([p, lines]) => ({ path: p, net: lines }))
    .filter((x) => x.net > 0)
    .sort((a, b) => b.net - a.net || a.path.localeCompare(b.path));
}

const TODO_TEXT_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rb|rs|java|md|txt|sh|ya?ml|json|toml)$/i;

/**
 * The `universal-git` extractor as a normalized signals producer (FR11): every observation is
 * a validated Signal behind the shared schema (lib/signals.js), so the judgment layer never
 * sees git-specific shapes. Emits churn hotspots, cross-boundary hidden coupling, growth-trend
 * (all git-derived), plus universal file-tree / README / TODO-density signals that need no
 * language awareness. Returns `{ sources, degraded, signals, raw }` — `raw` is the underlying
 * gitSignals() metrics for back-compat consumers.
 */
function universalGitSignals(root, opts = {}) {
  const window = opts.window || 400;
  const ignoreGlobs = opts.ignoreGlobs || [];
  const ignore = makeIgnore(ignoreGlobs);
  const SOURCE = 'universal-git';
  const degraded = [];
  const signals = [];

  const gs = gitSignals(root, { window, ignoreGlobs, couplingMinCommits: opts.couplingMinCommits || 5 });
  for (const d of gs.degraded) degraded.push(d);

  // Churn hotspots — the fact (N commits) is exact, its significance is a heuristic.
  for (const h of gs.hotspots.slice(0, 10)) {
    signals.push(makeSignal({ kind: 'hotspot', confidence: 'heuristic', source: SOURCE,
      evidence: [{ path: h.path }],
      detail: `high churn: touched in ${h.count} of the last ${gs.commits_scanned} commits` }));
  }

  // Hidden coupling — cross-module co-change implies an undeclared dependency (heuristic).
  for (const c of gs.coupling) {
    signals.push(makeSignal({ kind: 'hidden-coupling', confidence: 'heuristic', source: SOURCE,
      evidence: [{ path: c.a }, { path: c.b }],
      detail: `${c.module_a} and ${c.module_b} co-change across a module boundary in ${c.commits} commits` }));
  }

  // Growth trend — where net lines accrete fastest is where design pressure lands (heuristic).
  if (isGitRepo(root)) {
    const growers = growthTrend(root, { window, ignore }).slice(0, 5);
    if (growers.length) {
      signals.push(makeSignal({ kind: 'growth-trend', confidence: 'heuristic', source: SOURCE,
        evidence: growers.map((g) => ({ path: g.path })),
        detail: 'fastest-growing files by net added lines: ' + growers.map((g) => `${g.path} (+${g.net})`).join(', ') }));
    }
  }

  // ---- Universal file signals (no language awareness; present on any repo) ----
  const files = walkFiles(root, ignoreGlobs);

  // File-tree shape — an exact snapshot of where the code lives.
  const topCounts = new Map();
  for (const f of files) { const t = topSegment(f); topCounts.set(t, (topCounts.get(t) || 0) + 1); }
  const topDirs = [...topCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  signals.push(makeSignal({ kind: 'file-tree', confidence: 'exact', source: SOURCE, evidence: [],
    detail: `${files.length} files across ${topCounts.size} top-level entries: ` + topDirs.map(([n, c]) => `${n} (${c})`).join(', ') }));

  // README presence — exact.
  const readme = files.find((f) => /^readme\.md$/i.test(f)) || files.find((f) => /readme\.md$/i.test(f));
  signals.push(makeSignal({ kind: 'readme', confidence: 'exact', source: SOURCE,
    evidence: readme ? [{ path: readme }] : [],
    detail: readme ? `README present at ${readme}` : 'no README found at repo root' }));

  // TODO/FIXME density — count is exact but "too much unfinished work" is a heuristic.
  let markers = 0, filesWithMarkers = 0;
  const todoEvidence = [];
  for (const rel of files) {
    if (!TODO_TEXT_EXT.test(rel)) continue;
    const text = readFileSafe(path.join(root, rel));
    if (text == null) continue;
    const m = text.match(/\b(TODO|FIXME|XXX|HACK)\b/g);
    if (m) { markers += m.length; filesWithMarkers++; if (todoEvidence.length < 10) todoEvidence.push({ path: rel }); }
  }
  signals.push(makeSignal({ kind: 'todo-density', confidence: 'heuristic', source: SOURCE, evidence: todoEvidence,
    detail: `${markers} TODO/FIXME/XXX/HACK marker(s) across ${filesWithMarkers} file(s)` }));

  return { sources: [{ name: SOURCE, signals: signals.length }], degraded, signals, raw: gs };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const window = args.window ? parseInt(args.window, 10) : 400;
  const { config } = loadConfig(root);
  const norm = universalGitSignals(root, { window, ignoreGlobs: config.ignore });
  // Primary output: the normalized signals document the judgment layer consumes (FR8).
  writeSignals(root, date, norm);
  // Back-compat: the raw git-signals metrics doc (unchanged shape for pre-schema consumers).
  writeJSON(path.join(outDir(root), `git-signals-${date}.json`), { job: 'git-signals', date, ...norm.raw });
  process.stdout.write(JSON.stringify({ signals: norm.signals.length, sources: norm.sources, degraded: norm.degraded }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { gitSignals, universalGitSignals, growthTrend };
