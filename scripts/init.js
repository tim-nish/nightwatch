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
//   (default)   probe + write STATE.md and .nightwatch/config.yaml from templates (if absent).
//   --probe     probe the adapters only and print the report — writes nothing.
//   --no-config write STATE.md only (skip .nightwatch/config.yaml).
const { parseArgs, repoRoot, isGitRepo } = require('./lib/util');
const { runInit } = require('./lib/init');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  // init only makes sense inside a git checkout (same precondition as the overnight orchestrator).
  if (!isGitRepo(root)) {
    process.stdout.write(JSON.stringify({ status: 'abort', reason: 'not-a-git-checkout' }, null, 2) + '\n');
    process.exit(1);
    return;
  }
  const res = runInit(root, { probeOnly: !!args.probe, config: !args['no-config'] });
  process.stdout.write(JSON.stringify({ status: 'ok', ...res }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { main };
