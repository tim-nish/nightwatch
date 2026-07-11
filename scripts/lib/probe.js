// @ts-check
'use strict';
// probe.js — deterministic, zero-token run-start checks that turn a silently-damaging repo
// misconfiguration into a reported finding, and tell a pre-layout install that an upgrade exists
// (spec runtime-layout P3/P4). Both are pure reads: `git check-ignore` and a few `exists()` probes.
// Never edits the user's `.gitignore` (NFR3) and never spends tokens or touches the network (NFR4).
const path = require('path');
const { git, exists, nwDir, legacyOutDir } = require('./util');
const { makeFinding } = require('./findings');
const { statePath, legacyStatePath } = require('./schedule');

/**
 * Is `rel` (repo-relative) ignored by the repo's gitignore rules? `git check-ignore <path>` prints
 * the path and exits 0 when ignored, exits 1 (no output) when not — util.git returns null on the
 * non-zero exit, so a non-empty return means "ignored". Works whether or not the path exists on disk
 * (it checks the rules, not the file). Outside a git repo it resolves to `false`.
 * @param {string} root @param {string} rel @returns {boolean}
 */
function isIgnored(root, rel) {
  const out = git(root, ['check-ignore', rel]);
  return out != null && out.trim().length > 0;
}

// The two pieces of committed machine memory whose loss the 0024 forensics traced to a blanket
// `.nightwatch/*` ignore: the ledger (feedback/recurrence/demotion) and the briefs directory.
const MEMORY_TARGETS = [
  { rel: '.nightwatch/ledger.jsonl', label: '.nightwatch/ledger.jsonl' },
  { rel: '.nightwatch/briefs', label: '.nightwatch/briefs/' },
];

/**
 * Commit-policy probe (spec runtime-layout P3): if the repo's `.gitignore` ignores the ledger or the
 * briefs directory, return ONE `setup` finding naming the file(s), the consequence, and the fix —
 * else null. The id is stable across nights on an unchanged misconfiguration (its locus is the sorted
 * ignored paths), so it dedupes/recurs like any finding. Zero tokens, zero network; reports only.
 * @param {string} root @returns {import('./types').Finding | null}
 */
function commitPolicyProbe(root) {
  const ignored = MEMORY_TARGETS.filter((t) => isIgnored(root, t.rel));
  if (!ignored.length) return null;
  const names = ignored.map((t) => t.label);
  const namesPhrase = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return makeFinding('nightwatch', {
    kind: 'setup', severity: 2, action: 'daytime-task', verified: true,
    // Exact wording contract (spec P3): the file, the consequence, and the fix.
    title: `.gitignore ignores ${namesPhrase} — Nightwatch's memory (feedback, recurrence, demotion) will not survive a clone; narrow the ignore to \`.nightwatch/runtime/\`.`,
    locus: `commit-policy:${ignored.map((t) => t.rel).sort().join(',')}`,
    evidence: ignored.map((t) => ({ path: t.rel })), extra: undefined,
  });
}

/**
 * Does the install predate the current layout contract (spec runtime-layout P4)? True when machine
 * state is still on the legacy paths (`.nightwatch/state.json` while `runtime/cursors.json` is
 * absent, or a legacy `.nightwatch/out/` dir), or the orientation README is absent on a repo that
 * already has memory (a ledger). A fresh repo with no install yet is NOT outdated — it will run
 * `init`, not `init --update`. Pure `exists()` reads.
 * @param {string} root @returns {boolean}
 */
function layoutOutdated(root) {
  const legacyCursors = exists(legacyStatePath(root)) && !exists(statePath(root));
  const legacyOut = exists(legacyOutDir(root));
  const readmeAbsent = !exists(path.join(nwDir(root), 'README.md'));
  // "Inited" = a set-up install (has declarations) — a deterministic signal that does not change
  // during a run, unlike the ledger which a first run writes only at the end. A README-absent nudge
  // fires only for such an install (its README was deleted), never for a fresh, un-inited repo.
  const inited = exists(path.join(nwDir(root), 'config.yaml'))
    || exists(path.join(nwDir(root), 'STATE.md'))
    || exists(path.join(root, 'STATE.md'));
  return legacyCursors || legacyOut || (readmeAbsent && inited);
}

/**
 * Layout-upgrade nudge (spec runtime-layout P4): a single Machine-notes line pointing a pre-layout
 * install at `/nightwatch init --update`, or null for a current, correctly-configured install.
 * Detection and reporting only — no overnight writes, at most one line per run.
 * @param {string} root @returns {string | null}
 */
function layoutUpgradeNudge(root) {
  if (!layoutOutdated(root)) return null;
  return '- Nightwatch layout upgrade available — run `/nightwatch init --update` to move machine state under `.nightwatch/runtime/` and refresh the orientation README.';
}

module.exports = { commitPolicyProbe, layoutUpgradeNudge, isIgnored, layoutOutdated };
