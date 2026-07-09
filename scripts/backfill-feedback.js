#!/usr/bin/env node
// @ts-check
'use strict';
// backfill-feedback.js — the morning feedback loop step of /nightwatch (FR35, spec §6). Run this
// BEFORE the member jobs: it parses the previous MORNING.md's checkbox marks (`[x]` acted-on,
// `[-]`/`[~]` dismissed) and backfills them into .nightwatch/ledger.jsonl through the tracking
// store's recordFeedback(), the sole sanctioned ledger writer. The demotion rule that
// collect-brief.js computes later then sees these marks. Deterministic; writes only .nightwatch/**.
const { parseArgs, repoRoot } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { openTracker } = require('./lib/tracker');
const { backfillFeedback } = require('./lib/feedback');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const { config } = loadConfig(root);
  const store = openTracker(root, config);
  const recorded = backfillFeedback(root, store);
  process.stdout.write(JSON.stringify({ recorded: recorded.length, marks: recorded }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { main };
