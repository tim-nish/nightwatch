#!/usr/bin/env node
// @ts-check
'use strict';
// narrate.js (CLI) — print the lifecycle narration for a date's run, reconstructed from
// out/run-status-<date>.json (FR39). Read-only: it writes nothing and spends no tokens. The
// command narrates live as each event happens; this renders the same lines from the record, so a
// human can re-read them after the fact and so tests can assert live narration and the persisted
// facts agree. One line per lifecycle event.
const path = require('path');
const { parseArgs, repoRoot, todayISO, outDir, readJSONSafe } = require('./lib/util');
const { narrateRunStatus } = require('./lib/narrate');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const rs = readJSONSafe(path.join(outDir(root), `run-status-${date}.json`)) || { jobs: [] };
  const lines = narrateRunStatus(rs);
  process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
}

if (require.main === module) main();
module.exports = { main };
