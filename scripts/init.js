#!/usr/bin/env node
// @ts-check
'use strict';
// init.js — CLI entry for the deterministic half of `/nightwatch init` daytime setup (§6, FR33).
//
// The interactive interview (authority per area, phase, release target + definition of done,
// optional layers) is driven by commands/nightwatch.md — the ONE mode that may ask questions.
// This script owns the mechanical, no-network, install-nothing steps: probing the extractor
// adapters (offering install hints for detected-but-unavailable tools — the only place a tool
// install is ever suggested) and instantiating the shipped declaration templates where absent
// (never clobbering an existing declaration), plus adding `.nightwatch/out/` to `.gitignore`.
//
// Flags:
//   (default)          probe + write STATE.md and .nightwatch/config.yaml from templates (if absent).
//   --probe            probe the adapters only and print the report — writes nothing.
//   --no-config        write STATE.md only (skip .nightwatch/config.yaml).
//   --detect-dev-tooling  print candidate dev-tooling directories for the human to confirm —
//                      writes nothing (FR43 detection half).
//   --dev-tooling a,b  after writing declarations, persist the confirmed dev-tooling set (dir
//                      names or globs, comma-separated) into config.yaml's `dev_tooling:` (FR43).
//   --detect-migration print the legacy root artifacts that would move into .nightwatch/ — writes
//                      nothing (FR50 detection half; the interview confirms before --migrate).
//   --migrate          relocate the confirmed legacy root artifacts into .nightwatch/ (byte-for-
//                      byte, `git mv` when tracked) before instantiating declarations (FR50).
const { parseArgs, repoRoot, isGitRepo } = require('./lib/util');
const { runInit, detectDevToolingCandidates, planMigration } = require('./lib/init');

/** Split a comma-separated `--dev-tooling` value into trimmed entries; a bare `--dev-tooling` = []. */
function parseDevTooling(val) {
  if (val === true) return [];
  if (typeof val !== 'string') return undefined;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  // init only makes sense inside a git checkout (same precondition as the overnight orchestrator).
  if (!isGitRepo(root)) {
    process.stdout.write(JSON.stringify({ status: 'abort', reason: 'not-a-git-checkout' }, null, 2) + '\n');
    process.exit(1);
    return;
  }
  // Detection is read-only, like --probe: surface candidates for the interview, write nothing.
  if (args['detect-dev-tooling']) {
    const candidates = detectDevToolingCandidates(root);
    process.stdout.write(JSON.stringify({ status: 'ok', candidates }, null, 2) + '\n');
    return;
  }
  // Migration detection is likewise read-only: show what a confirmed --migrate would relocate.
  if (args['detect-migration']) {
    const plan = planMigration(root);
    process.stdout.write(JSON.stringify({ status: 'ok', ...plan }, null, 2) + '\n');
    return;
  }
  const res = runInit(root, {
    probeOnly: !!args.probe,
    config: !args['no-config'],
    devTooling: parseDevTooling(args['dev-tooling']),
    migrate: !!args.migrate,
  });
  process.stdout.write(JSON.stringify({ status: 'ok', ...res }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { main };
