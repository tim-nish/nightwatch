#!/usr/bin/env node
// @ts-check
'use strict';
// git-signals.js — universal signals from git history alone (no language awareness):
// churn, co-change coupling across module boundaries, hotspots. Always available in any
// git repo. Usable as a CLI (--repo . writes out/git-signals-<date>.json) or as a module.
const { parseArgs, repoRoot, todayISO, git, isGitRepo, commitCount, topSegment, makeIgnore, writeJSON, outDir } = require('./lib/util');
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const window = args.window ? parseInt(args.window, 10) : 400;
  const sig = gitSignals(root, { window });
  const doc = { job: 'git-signals', date, ...sig };
  writeJSON(path.join(outDir(root), `git-signals-${date}.json`), doc);
  process.stdout.write(JSON.stringify({ commits_scanned: sig.commits_scanned, hotspots: sig.hotspots.length, coupling: sig.coupling.length, degraded: sig.degraded }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { gitSignals };
