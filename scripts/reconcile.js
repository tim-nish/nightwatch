#!/usr/bin/env node
// @ts-check
'use strict';
// reconcile.js — the deterministic layer of /repo-reconcile (story 3.2, FR19/FR20). It extracts
// testable claims from README + docs, verifies each against the surface inventory, and assigns a
// verdict: `holds` | `drifted` | `unverifiable-statically`. It never guesses — anything it can't
// check statically is listed for a daytime run, not resolved. Direction-of-fix and patch emission
// are the judgment layer's job (story 3.3). The adversarial verification pass (story 3.4) then
// challenges each `drifted` verdict: survivors are stamped `verified:true` and only they reach the
// brief; refuted verdicts are dropped. Its refutation is agent judgment; this file is the harness.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseArgs, repoRoot, todayISO, exists, readFileSafe, walkFiles, writeJSON, outDir, globToRegExp, ensureDir, git, isGitRepo } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { analysisExcludeGlobs } = require('./lib/scope');
const { inventory } = require('./surface-inventory');
const { makeFinding, recurrenceCounts, readLedger, appendLedger, SCHEMA_VERSION } = require('./lib/findings');

/**
 * Find the declared authority entry whose `artifact` glob matches a claim's source path.
 * Deterministic (keys visited in sorted order; first match wins). Returns null when the
 * artifact has no declared authority — the caller keeps 3.2's undeclared behavior.
 */
function authorityFor(authority, srcPath) {
  if (!authority) return null;
  for (const key of Object.keys(authority).sort()) {
    const e = authority[key];
    if (e && typeof e.artifact === 'string' && globToRegExp(e.artifact).test(srcPath)) {
      return { key, artifact: e.artifact, role: e.role };
    }
  }
  return null;
}

/**
 * Build a `git apply` / `patch -p1` compatible unified diff that DELETES the given 1-based
 * line numbers from `text`. Returns '' when there is nothing to delete. Deterministic, with
 * 3 lines of surrounding context; nearby deletions coalesce into one hunk. This is the only
 * mechanism by which reconcile proposes a fix — it never edits the file in place (FR20).
 */
function unifiedDiffDelete(relPath, text, deleteLines1) {
  const hasNL = text.endsWith('\n');
  const lines = text.split('\n');
  if (hasNL) lines.pop();
  const N = lines.length;
  const delIdx = new Set([...new Set(deleteLines1)].map((n) => n - 1).filter((i) => i >= 0 && i < N));
  if (!delIdx.size) return '';
  const CTX = 3;
  const sorted = [...delIdx].sort((a, b) => a - b);
  // Coalesce deletions whose context windows touch/overlap into a single hunk.
  const groups = [];
  for (const d of sorted) {
    const last = groups[groups.length - 1];
    if (last && d - last.end <= 2 * CTX + 1) last.end = d;
    else groups.push({ start: d, end: d });
  }
  let body = '';
  let delSeen = 0; // deletions strictly before the current hunk (new-file line offset)
  for (const g of groups) {
    const hStart = Math.max(0, g.start - CTX);
    const hEnd = Math.min(N - 1, g.end + CTX);
    let oldCount = 0, newCount = 0, hunk = '';
    for (let i = hStart; i <= hEnd; i++) {
      const noNL = i === N - 1 && !hasNL;
      if (delIdx.has(i)) { hunk += '-' + lines[i] + '\n'; oldCount++; }
      else { hunk += ' ' + lines[i] + '\n'; oldCount++; newCount++; }
      if (noNL) hunk += '\\ No newline at end of file\n';
    }
    const oldStart = hStart + 1;
    const newStart = newCount === 0 ? oldStart - delSeen - 1 : oldStart - delSeen;
    body += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n` + hunk;
    for (let i = hStart; i <= hEnd; i++) if (delIdx.has(i)) delSeen++;
  }
  return `--- a/${relPath}\n+++ b/${relPath}\n` + body;
}

/** Flags the docs claim exist. Verdict from whether the code surface actually exposes them. */
function extractFlagClaims(docPath, text, codeFlags) {
  const claims = [];
  const seen = new Set();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/(?<![\w-])(--[a-zA-Z][\w-]+)/g)) {
      const flag = m[1];
      if (seen.has(flag)) continue;
      seen.add(flag);
      const verdict = codeFlags.has(flag) ? 'holds' : 'drifted';
      claims.push({
        kind: 'flag', text: flag, verdict, source: { path: docPath, line: i + 1 },
        locus: `${docPath}::flag:${flag}`,
        title: verdict === 'drifted' ? `README/docs document flag "${flag}" not found in the code surface` : `flag "${flag}" is documented and present`,
      });
    }
  }
  return claims;
}

/** Commands the README's code blocks invoke: npm scripts and `<bin> <subcommand>` forms. */
function extractCommandClaims(docPath, inv) {
  const claims = [];
  const subs = new Set(inv.cli.subcommands);
  const bins = new Set(inv.bins);
  for (const block of inv.readme_code_blocks || []) {
    const line = (block.first_line || '').trim();
    if (!line) continue;
    const toks = line.split(/\s+/);
    if (toks[0] === 'npm') {
      const script = toks[1] === 'run' ? toks[2] : toks[1];
      if (script && /^[\w:-]+$/.test(script)) {
        const verdict = subs.has('npm:' + script) ? 'holds' : 'drifted';
        claims.push({ kind: 'command', text: `npm ${script}`, verdict, source: { path: docPath, line: block.line },
          locus: `${docPath}::command:npm:${script}`,
          title: verdict === 'drifted' ? `README shows "npm ${script}" but no such npm script exists` : `npm script "${script}" is documented and present` });
      }
    } else if (bins.has(toks[0]) && toks[1] && /^[a-zA-Z][\w:-]*$/.test(toks[1])) {
      const sub = toks[1];
      const verdict = subs.has(sub) ? 'holds' : 'drifted';
      claims.push({ kind: 'command', text: `${toks[0]} ${sub}`, verdict, source: { path: docPath, line: block.line },
        locus: `${docPath}::command:${sub}`,
        title: verdict === 'drifted' ? `README shows "${toks[0]} ${sub}" but subcommand "${sub}" was not found` : `command "${toks[0]} ${sub}" is documented and present` });
    }
  }
  return claims;
}

/** Behavior/architecture assertions ("X never writes to Y") — not statically checkable here. */
function extractAssertionClaims(docPath, text) {
  const claims = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/\b(never|always|automatically|guarantee[sd]?)\b/i.test(l) && /`[^`]+`/.test(l)) {
      const m = l.match(/`([^`]+)`/);
      claims.push({ kind: 'architecture', text: l.trim().slice(0, 140), verdict: 'unverifiable-statically',
        source: { path: docPath, line: i + 1 }, locus: `${docPath}::assertion:${i + 1}`,
        title: `architecture assertion needs a live/deep check: "${(m && m[1]) || l.trim().slice(0, 60)}"` });
    }
  }
  return claims;
}

/**
 * Opt-in patch branch (FR21). Applies the already-emitted patch on branch
 * `nightwatch/reconcile/<date>`, built entirely inside a TEMPORARY git worktree so the user's
 * checked-out branch and working tree are never touched. The branch ends up holding EXACTLY the
 * one patch commit on top of the current HEAD. Idempotent: an existing branch of the same name is
 * hard-reset (via `checkout -B`) to that single commit. On any failure nothing half-built is left
 * behind — the temp worktree is removed and a freshly-created branch is deleted — and a note is
 * returned for `degraded` rather than thrown. Never mutates a repo file in place (normative safety).
 * @param {string} root repo root
 * @param {string} patchAbsPath absolute path to the emitted patch file
 * @param {string} branch e.g. `nightwatch/reconcile/2000-01-01`
 * @param {string} message commit message for the single patch commit
 * @returns {{ ok: boolean, note: string|null }}
 */
function buildPatchBranch(root, patchAbsPath, branch, message) {
  if (!isGitRepo(root)) return { ok: false, note: `patch_branch: ${root} is not a git repository — branch ${branch} not created` };
  if (git(root, ['rev-parse', 'HEAD']) == null) return { ok: false, note: `patch_branch: no commits yet — branch ${branch} not created` };
  // A fresh, non-existent path under the OS tmp (NOT inside the user's tree) for `worktree add`.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-reconcile-'));
  const wt = path.join(parent, 'wt');
  let wtCreated = false, branchCreated = false, ok = false, note = null;
  try {
    if (git(root, ['worktree', 'add', '--detach', wt, 'HEAD']) == null) {
      note = `patch_branch: could not create temporary worktree — branch ${branch} not created`;
      return { ok, note };
    }
    wtCreated = true;
    // Create or hard-reset the branch to HEAD *inside the temp worktree* (never the user's tree).
    if (git(wt, ['checkout', '-B', branch]) == null) {
      note = `patch_branch: could not create branch ${branch} in the temporary worktree`;
      return { ok, note };
    }
    branchCreated = true;
    if (git(wt, ['apply', patchAbsPath]) == null) {
      note = `patch_branch: patch did not apply cleanly — branch ${branch} not created`;
      return { ok, note };
    }
    if (git(wt, ['add', '-A']) == null || git(wt, ['commit', '-m', message]) == null) {
      note = `patch_branch: could not commit the patch on branch ${branch}`;
      return { ok, note };
    }
    ok = true;
    return { ok, note };
  } finally {
    // Tear the transient worktree down first (a branch checked out in a worktree can't be deleted).
    if (wtCreated) { git(root, ['worktree', 'remove', '--force', wt]); git(root, ['worktree', 'prune']); }
    if (!ok && branchCreated) git(root, ['branch', '-D', branch]);
    try { fs.rmSync(parent, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Adversarial verification pass over the `drifted` verdicts (FR22) — the deterministic HARNESS
 * that mirrors arch-review's refute pass. A second, *refuting* reviewer attempts to knock down
 * each drift finding; the refutation itself is agent judgment (commands/repo-reconcile.md),
 * supplied here as `refute`. This harness only DRIVES the pass and applies the survivor/drop rule:
 * survivors are stamped `verified: true` and are the only drift that reaches the brief; refuted
 * verdicts are dropped and recorded so the record shows they were considered and eliminated.
 *
 * The deterministic default (no agent) refutes nothing — reconcile's drift is detected mechanically
 * (a flag/command literally absent from the surface), so absent a refutation it stands verified.
 *
 * @param {any[]} driftFindings drift findings (each `verified:false`) to challenge
 * @param {((finding:any)=>(boolean|{refuted?:boolean, reason?:string}))} [refute]
 *        return truthy / `{refuted:true}` to ELIMINATE a drifted verdict as a false positive.
 * @returns {{ verified: any[], refuted: Array<{id:string, title:string, reason:string}> }}
 */
function adversarialPass(driftFindings, refute) {
  const decide = typeof refute === 'function' ? refute : () => false;
  const verified = [];
  const refuted = [];
  for (const f of driftFindings) {
    const r = decide(f);
    const isRefuted = r === true || (!!r && typeof r === 'object' && r.refuted === true);
    if (isRefuted) {
      const reason = (r && typeof r === 'object' && typeof r.reason === 'string' && r.reason) || 'refuted by adversarial pass';
      refuted.push({ id: f.id, title: f.title, reason });
    } else {
      verified.push(Object.assign({}, f, { verified: true }));
    }
  }
  return { verified, refuted };
}

/**
 * Append this run's findings to the append-only ledger for recurrence counting (FR7), guarded
 * against double-append on a same-date re-run so a re-run never inflates counts. Mirrors the
 * ledger recording arch-review performs. `findings` are the ones that reached the brief.
 */
function recordLedger(root, date, findings, refutedCount) {
  const already = readLedger(root).some((r) => r.type === 'run' && r.job === 'repo-reconcile' && r.date === date);
  if (already) return;
  /** @type {any[]} */
  const rows = [{ type: 'run', date, job: 'repo-reconcile', findings: findings.length, refuted: refutedCount }];
  for (const f of findings) rows.push({ type: 'finding', date, job: 'repo-reconcile', id: f.id, kind: f.kind, severity: f.severity });
  appendLedger(root, rows);
}

/**
 * Extract-and-verify plus the judgment layer (authority → direction-of-fix + patch emission) and
 * the adversarial verification pass (FR22). The judgment layer assigns direction-of-fix and emits
 * derived-doc patches (opt-in patch branch via a temporary worktree, FR21); the adversarial pass
 * then challenges each `drifted` verdict so only survivors reach the brief. Findings that reach the
 * brief are stamped `verified: true` and recorded in the ledger for recurrence (FR7).
 * @param {string} root
 * @param {{date?: string, refute?: ((finding:any)=>(boolean|{refuted?:boolean, reason?:string}))}} [opts]
 * @returns {{ degraded: string[], findings: any[], claims: any[], unverifiable: any[], stopped: boolean, patch: string|null, patchPath: string|null, patchBranch: string|null, human_decisions: string[], refuted: Array<{id:string, title:string, reason:string}> }}
 */
function reconcile(root, opts = {}) {
  const date = opts.date || todayISO();
  const { authority, config } = loadConfig(root);
  const inv = inventory(root);
  const degraded = [...(inv.degraded || [])];
  const findings = [];
  const claims = [];
  const unverifiable = [];

  // A broken build / unparsable surface outranks all drift: finding #1, stop deeper checks (FR20).
  // A blocker is a mechanical fact, not a drifted verdict — it bypasses the adversarial pass and is
  // stamped verified so the brief-wide "only verified findings enter the brief" invariant holds.
  if (inv.blocking && inv.blocking.length) {
    const b = inv.blocking[0];
    const f = makeFinding('repo-reconcile', { kind: 'blocker', severity: 5, action: 'human-decision', verified: true,
      title: b.reason, locus: 'surface:blocking', evidence: b.evidence || [], extra: undefined });
    f.recurrence = recurrenceCounts(root).get(f.id) || 0;
    findings.push(f);
    recordLedger(root, date, findings, 0);
    return { degraded, findings, claims, unverifiable, stopped: true, patch: null, patchPath: null, patchBranch: null, human_decisions: findings.map((x) => x.id), refuted: [] };
  }

  // No declared authority → detection-only mode: conflicts still reported, but the setup finding
  // is #1 and every drift finding omits direction-of-fix (FR20).
  const detectionOnly = !authority;

  // Collect claims from README (always) and docs/ (when present).
  const codeFlags = new Set(inv.cli.flags);
  const readmePath = inv.readme_path;
  if (readmePath) {
    const text = readFileSafe(path.join(root, readmePath)) || '';
    claims.push(...extractFlagClaims(readmePath, text, codeFlags));
    claims.push(...extractCommandClaims(readmePath, inv));
    claims.push(...extractAssertionClaims(readmePath, text));
  } else {
    degraded.push('no README found — no documentation claims to verify');
  }

  if (exists(path.join(root, 'docs'))) {
    for (const rel of walkFiles(root, []).filter((f) => /^docs\/.*\.md$/i.test(f))) {
      const text = readFileSafe(path.join(root, rel)) || '';
      claims.push(...extractFlagClaims(rel, text, codeFlags));
      claims.push(...extractAssertionClaims(rel, text));
    }
  } else {
    degraded.push('no docs/ directory — claims sourced from README only');
  }

  claims.sort((a, b) => a.locus.localeCompare(b.locus));

  // Drifted claims become findings; unverifiable ones are listed for a daytime check, never guessed.
  // The authority role of the artifact a claim lives in decides direction-of-fix (FR20):
  //   role: derived       → mechanically fixable → action `patch-available` + a patch line
  //   role: authoritative → a bug or unrecorded decision → `human-decision`, NEVER a patch
  //   undeclared artifact → `human-decision`, direction omitted (3.2 behavior, preserved)
  const patchFile = `.nightwatch/runtime/out/reconcile-${date}.patch`;
  const pendingPatch = new Map(); // finding.id -> { path, line } — a delete to draft IF it survives
  const drift = [];
  for (const c of claims) {
    if (c.verdict === 'drifted') {
      const severity = c.kind === 'command' ? 4 : c.kind === 'flag' ? 3 : 2;
      const auth = authorityFor(authority, c.source.path);
      let action = 'human-decision';
      let extra;
      let patchLoc = null;
      if (auth && auth.role === 'derived') {
        action = 'patch-available';
        // The command claim's evidence points at the code-fence line; the offending command
        // itself is the next line. Flag claims already point at the exact documented line.
        const delLine = c.kind === 'command' ? c.source.line + 1 : c.source.line;
        patchLoc = { path: c.source.path, line: delLine };
        extra = { direction: c.source.path, patch_file: patchFile };
      }
      // Carry the drifted claim text so the deterministic re-verification floor (spec
      // finding-lifecycle P2) can, on a later run, check whether it is still present at the cited
      // line — the free check that distinguishes a still-drifted finding from a resolved one.
      if (c.text) extra = Object.assign({ text: c.text }, extra);
      const f = makeFinding('repo-reconcile', { kind: 'drift', severity, action, verified: false,
        title: c.title, locus: c.locus, evidence: [c.source], extra });
      if (patchLoc) pendingPatch.set(f.id, patchLoc);
      drift.push(f);
    } else if (c.verdict === 'unverifiable-statically') {
      unverifiable.push({ kind: c.kind, text: c.text, source: c.source, reason: 'needs a live run / deeper analysis' });
    }
  }
  drift.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));

  // Adversarial verification pass (FR22): a refuting reviewer challenges each drifted verdict.
  // Only survivors — stamped verified:true — reach the brief; refuted verdicts are dropped and
  // recorded. The refutation is agent judgment (opts.refute); the deterministic default refutes
  // nothing, so mechanically-detected drift stands verified.
  const { verified: verifiedDrift, refuted } = adversarialPass(drift, opts.refute);

  // Only SURVIVING derived-artifact drift is patched — a refuted (dropped) verdict is never patched.
  const patchDeletes = new Map(); // POSIX path -> Set of 1-based line numbers to delete
  for (const f of verifiedDrift) {
    const loc = pendingPatch.get(f.id);
    if (!loc) continue;
    if (!patchDeletes.has(loc.path)) patchDeletes.set(loc.path, new Set());
    patchDeletes.get(loc.path).add(loc.line);
  }

  // Setup findings rank ahead of drift. Detection-only keeps the "declare authority" finding
  // as #1 (3.2). With authority declared, an authority glob that matches no repo file is a dead
  // pointer the maintainer must fix (FR36).
  // Setup findings are mechanical facts, not drifted verdicts — they skip the adversarial pass and
  // are stamped verified so everything in the brief carries verified:true.
  const setupFindings = [];
  if (detectionOnly) {
    setupFindings.push(makeFinding('repo-reconcile', { kind: 'setup', severity: 4, action: 'daytime-task', verified: true,
      title: 'declare authority in STATE.md; run `/nightwatch init`', locus: 'authority:undeclared', evidence: [], extra: undefined }));
    degraded.push('authority undeclared — detection-only mode; findings omit direction-of-fix');
  } else {
    const allFiles = walkFiles(root, analysisExcludeGlobs(config));
    for (const key of Object.keys(authority).sort()) {
      const e = authority[key];
      const glob = e && e.artifact;
      if (typeof glob !== 'string') continue;
      const re = globToRegExp(glob);
      if (!allFiles.some((f) => re.test(f))) {
        setupFindings.push(makeFinding('repo-reconcile', { kind: 'setup', severity: 3, action: 'daytime-task', verified: true,
          title: `authority pointer "${key}" targets "${glob}" but no file in the repo matches it`,
          locus: `authority:dead:${key}`, evidence: [], extra: undefined }));
        degraded.push(`authority pointer "${key}" (${glob}) matches no file — dead pointer`);
      }
    }
    setupFindings.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
  }

  // Draft the patch (derived artifacts only). NEVER touches a repo file in place — the patch is
  // written under .nightwatch/out and is the sole fix mechanism (FR20, normative safety rule).
  let patch = '';
  for (const p of [...patchDeletes.keys()].sort()) {
    const text = readFileSafe(path.join(root, p)) || '';
    patch += unifiedDiffDelete(p, text, [...patchDeletes.get(p)]);
  }
  let patchPath = null;
  let patchBranch = null;
  if (patch) {
    patchPath = path.join(outDir(root), `reconcile-${date}.patch`);
    ensureDir(path.dirname(patchPath));
    fs.writeFileSync(patchPath, patch);
    // Opt-in only (default false): additionally land the patch on nightwatch/reconcile/<date>,
    // built in a throwaway worktree so the user's branch/working tree stay byte-identical (FR21).
    if (config.patch_branch === true) {
      const branch = `nightwatch/reconcile/${date}`;
      const res = buildPatchBranch(root, patchPath, branch, `nightwatch: reconcile ${date} — apply derived-doc patch`);
      if (res.ok) patchBranch = branch;
      else if (res.note) degraded.push(res.note);
    }
  }

  // Cap the brief section by user-facing severity (default 10), setup ahead of verified drift.
  const cap = (config.caps && Number.isFinite(config.caps.reconcile)) ? config.caps.reconcile : 10;
  const ordered = [...setupFindings, ...verifiedDrift].slice(0, cap);

  // Recurrence via the append-only ledger (FR7): a survivor that recurs on an unchanged repo keeps
  // its (date-independent) id and is counted here, not re-reported as new. Read counts BEFORE this
  // run's rows are appended, then record the brief findings.
  const recur = recurrenceCounts(root);
  for (const f of ordered) f.recurrence = recur.get(f.id) || 0;
  recordLedger(root, date, ordered, refuted.length);

  findings.push(...ordered);
  const human_decisions = ordered.filter((f) => f.action === 'human-decision').map((f) => f.id);

  return { degraded, findings, claims, unverifiable, stopped: false, patch: patch || null, patchPath, patchBranch, human_decisions, refuted };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const res = reconcile(root, { date });
  const patch_path = res.patchPath ? `.nightwatch/runtime/out/reconcile-${date}.patch` : null;
  const doc = { schema: SCHEMA_VERSION, job: 'repo-reconcile', date, degraded: res.degraded, findings: res.findings,
    human_decisions: res.human_decisions, patch_path, patch_branch: res.patchBranch, claims: res.claims, unverifiable: res.unverifiable, refuted: res.refuted, stopped: res.stopped };
  writeJSON(path.join(outDir(root), `repo-reconcile-${date}.json`), doc);
  const drifted = res.findings.filter((f) => f.kind === 'drift').length;
  if (res.findings.length === 0) process.stdout.write('0 findings\n');
  else process.stdout.write(JSON.stringify({ findings: res.findings.length, drifted, patch_available: res.findings.filter((f) => f.action === 'patch-available').length, human_decisions: res.human_decisions.length, unverifiable: res.unverifiable.length, degraded: res.degraded, stopped: res.stopped }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { reconcile, adversarialPass };
