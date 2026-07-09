#!/usr/bin/env node
// @ts-check
'use strict';
// reconcile.js — the deterministic layer of /repo-reconcile (story 3.2, FR19/FR20). It extracts
// testable claims from README + docs, verifies each against the surface inventory, and assigns a
// verdict: `holds` | `drifted` | `unverifiable-statically`. It never guesses — anything it can't
// check statically is listed for a daytime run, not resolved. Direction-of-fix and patch emission
// are the judgment layer's job (story 3.3); the adversarial refute pass is 3.4.
const path = require('path');
const { parseArgs, repoRoot, todayISO, exists, readFileSafe, walkFiles, writeJSON, outDir } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { inventory } = require('./surface-inventory');
const { makeFinding, SCHEMA_VERSION } = require('./lib/findings');

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
 * Extract-and-verify the deterministic reconcile layer.
 * @returns {{ degraded: string[], findings: any[], claims: any[], unverifiable: any[], stopped: boolean }}
 */
function reconcile(root) {
  const { authority } = loadConfig(root);
  const inv = inventory(root);
  const degraded = [...(inv.degraded || [])];
  const findings = [];
  const claims = [];
  const unverifiable = [];

  // A broken build / unparsable surface outranks all drift: finding #1, stop deeper checks (FR20).
  if (inv.blocking && inv.blocking.length) {
    const b = inv.blocking[0];
    findings.push(makeFinding('repo-reconcile', { kind: 'blocker', severity: 5, action: 'human-decision', verified: false,
      title: b.reason, locus: 'surface:blocking', evidence: b.evidence || [], extra: undefined }));
    return { degraded, findings, claims, unverifiable, stopped: true };
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
  const drift = [];
  for (const c of claims) {
    if (c.verdict === 'drifted') {
      const severity = c.kind === 'command' ? 4 : c.kind === 'flag' ? 3 : 2;
      drift.push(makeFinding('repo-reconcile', { kind: 'drift', severity, action: 'human-decision', verified: false,
        title: c.title, locus: c.locus, evidence: [c.source], extra: undefined }));
    } else if (c.verdict === 'unverifiable-statically') {
      unverifiable.push({ kind: c.kind, text: c.text, source: c.source, reason: 'needs a live run / deeper analysis' });
    }
  }
  drift.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));

  // Ordering invariant: the setup finding (declare authority) is #1 in detection-only mode.
  if (detectionOnly) {
    findings.push(makeFinding('repo-reconcile', { kind: 'setup', severity: 4, action: 'daytime-task', verified: false,
      title: 'declare authority in STATE.md; run `/nightwatch init`', locus: 'authority:undeclared', evidence: [], extra: undefined }));
    degraded.push('authority undeclared — detection-only mode; findings omit direction-of-fix');
  }
  findings.push(...drift);

  return { degraded, findings, claims, unverifiable, stopped: false };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const res = reconcile(root);
  const doc = { schema: SCHEMA_VERSION, job: 'repo-reconcile', date, degraded: res.degraded, findings: res.findings, claims: res.claims, unverifiable: res.unverifiable, stopped: res.stopped };
  writeJSON(path.join(outDir(root), `repo-reconcile-${date}.json`), doc);
  const drifted = res.findings.filter((f) => f.kind === 'drift').length;
  if (res.findings.length === 0) process.stdout.write('0 findings\n');
  else process.stdout.write(JSON.stringify({ findings: res.findings.length, drifted, unverifiable: res.unverifiable.length, degraded: res.degraded, stopped: res.stopped }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { reconcile };
