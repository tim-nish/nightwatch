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
//   --update           daytime, interactive non-destructive reconfigure (FR52): with no other
//                      write flag, PRINT the proposed diffs (read-only); with `--dev-tooling a,b`,
//                      APPLY the confirmed dev-tooling additions (unioned with the current set,
//                      config.yaml otherwise byte-preserved). Never invoked on a scheduled run.
const { parseArgs, repoRoot, isGitRepo } = require('./lib/util');
const { runInit, detectDevToolingCandidates, planMigration, planRuntimeMigration, planUpdate, applyUpdate } = require('./lib/init');

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
  // Migration detection is likewise read-only: show what a confirmed --migrate would relocate — both
  // legacy root declarations (STATE.md/RELEASE.md) and legacy machine state into runtime/ (P2).
  if (args['detect-migration']) {
    const plan = planMigration(root);
    const runtime = planRuntimeMigration(root);
    process.stdout.write(JSON.stringify({ status: 'ok', moves: plan.moves, runtime_moves: runtime.moves }, null, 2) + '\n');
    return;
  }
  // Non-destructive reconfigure. Without a write flag it is read-only (print proposed diffs);
  // with a confirmed --dev-tooling set it applies only those, byte-preserving the rest (FR52).
  if (args.update) {
    const devTooling = parseDevTooling(args['dev-tooling']);
    if (devTooling === undefined) {
      process.stdout.write(JSON.stringify({ status: 'ok', mode: 'update-plan', ...planUpdate(root) }, null, 2) + '\n');
    } else {
      const applied = applyUpdate(root, { devTooling });
      process.stdout.write(JSON.stringify({ status: 'ok', mode: 'update-apply', ...applied }, null, 2) + '\n');
    }
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
