#!/usr/bin/env node
// @ts-check
'use strict';
// first-run.js — surface the untracked files the first-run confirmation screen would offer to
// exclude (FR45–FR47): the classified groups (temporary/crash artifacts vs ordinary documents) and
// the EXACT `.nightwatch/config.yaml` ignore block each choice would write, previewed before any
// write. Read-only — writes nothing. The screen's labels and the yes/no gate live in
// commands/nightwatch.md; this script is the deterministic data it renders.
const { parseArgs, guardCli, repoRoot, isGitRepo, git } = require('./lib/util');
const { classifyUntracked, renderIgnorePreview } = require('./lib/firstrun');

/** Untracked, non-git-ignored files (repo-relative), sorted — the ones a run would otherwise analyze. */
function untrackedFiles(root) {
  const out = git(root, ['ls-files', '--others', '--exclude-standard']);
  if (out == null) return [];
  return out.split('\n').map((s) => s.trim()).filter(Boolean).sort();
}

function main() {
  const args = guardCli('first-run.js', process.argv.slice(2), ['date']);
  const root = repoRoot(args);
  if (!isGitRepo(root)) {
    process.stdout.write(JSON.stringify({ status: 'abort', reason: 'not-a-git-checkout' }, null, 2) + '\n');
    process.exit(1);
    return;
  }
  const groups = classifyUntracked(untrackedFiles(root));
  process.stdout.write(JSON.stringify({
    status: 'ok',
    groups,
    // Two independently-acceptable previews: ignore just the crash/temp artifacts, or everything.
    ignore_preview: {
      temp: renderIgnorePreview(groups.temp),
      all: renderIgnorePreview([...groups.temp, ...groups.documents]),
    },
  }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { main, untrackedFiles };
