#!/usr/bin/env node
// @ts-check
'use strict';
// review-feedback.js — the deterministic writer behind `/nightwatch review` (FR44). Two modes:
//
//   --list [--brief <date>]        print the brief's findings in order (id, box, marked) — the walk
//                                  queue the interactive command steps through. Read-only.
//   --id <id> --mark acted-on|dismissed [--brief <date>]
//                                  record ONE decision: rewrite the finding's checkbox in MORNING.md
//                                  and the dated brief, and append a single feedback row via the
//                                  tracking store's recordFeedback() (the sole sanctioned ledger
//                                  writer), dated to the brief under review.
//
// Idempotent: an already-recorded (id, verdict, date) is a stated no-op, so review composes with
// the morning backfill and with manual checkbox edits in any order without double-counting.
// Writes only inside `.nightwatch/**`; spends no tokens; no network.
const path = require('path');
const { parseArgs, guardCli, repoRoot, nwDir, readFileSafe } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { openTracker } = require('./lib/tracker');
const { applyReview, listFindings } = require('./lib/review');

function main() {
  const args = guardCli('review-feedback.js', process.argv.slice(2), ['date', 'list', 'id', 'mark']);
  const root = repoRoot(args);
  const briefDate = typeof args.brief === 'string' ? args.brief : undefined;

  // --list: surface the walk queue for the interactive command; writes nothing.
  if (args.list) {
    const src = briefDate
      ? readFileSafe(path.join(nwDir(root), 'briefs', `${briefDate}.md`))
      : readFileSafe(path.join(nwDir(root), 'MORNING.md'));
    const findings = listFindings(src || '');
    process.stdout.write(JSON.stringify({ status: 'ok', findings, unmarked: findings.filter((f) => !f.marked).length }, null, 2) + '\n');
    return;
  }

  const id = typeof args.id === 'string' ? args.id : null;
  const mark = args.mark === 'acted-on' || args.mark === 'dismissed' ? args.mark : null;
  if (!id || !mark) {
    process.stdout.write(JSON.stringify({ status: 'error', reason: 'require --id <finding-id> --mark acted-on|dismissed (or --list)' }, null, 2) + '\n');
    process.exit(1);
    return;
  }

  const { config } = loadConfig(root);
  const store = openTracker(root, config);
  const res = applyReview(root, id, mark, store, { briefDate });
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { main };
