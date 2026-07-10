#!/usr/bin/env node
// @ts-check
'use strict';
// extract-signals.js — the signals runner (§2.6, FR9/FR10/FR14). It runs the universal-git
// built-in plus every applicable *tool adapter* under scripts/extractors/, and merges all of
// their normalized signals into one out/signals-<date>.json. Failure degrades, never aborts:
//   - an adapter that detects but whose tool is unavailable → a `degraded` note (with the
//     adapter's install hint) and, once per repo, a `setup`-kind finding for the daytime install;
//   - an adapter that crashes or emits unparsable output → its signals are dropped with a
//     notice and every other extractor still contributes.
const fs = require('fs');
const path = require('path');
const { parseArgs, repoRoot, todayISO, nwDir, ensureDir, readJSONSafe, writeJSON } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { analysisExcludeGlobs } = require('./lib/scope');
const { makeSignal, writeSignals } = require('./lib/signals');
const { makeFinding } = require('./lib/findings');
const { universalGitSignals } = require('./git-signals');

const EXTRACTORS_DIR = path.join(__dirname, 'extractors');

/** An adapter is any module exporting the four contract functions (§2.6). */
function isAdapter(m) {
  return !!m && ['detect', 'available', 'run', 'explain'].every((fn) => typeof m[fn] === 'function');
}

/** Discover adapter modules under scripts/extractors/. Missing dir / non-adapters are skipped. */
function loadAdapters(dir = EXTRACTORS_DIR) {
  let names;
  try { names = fs.readdirSync(dir).sort(); } catch { return []; }
  const adapters = [];
  for (const name of names) {
    if (!name.endsWith('.js') || name.startsWith('_')) continue;
    let mod;
    try { mod = require(path.join(dir, name)); } catch { continue; }
    if (isAdapter(mod)) adapters.push(mod);
  }
  return adapters;
}

// ---- once-per-repo setup-finding bookkeeping (persists across runs) ----
function setupMarkerPath(root) { return path.join(nwDir(root), 'extractor-setup.json'); }
function readNotified(root) {
  const j = readJSONSafe(setupMarkerPath(root));
  return new Set(j && Array.isArray(j.notified) ? j.notified : []);
}
function recordNotified(root, names) {
  ensureDir(nwDir(root));
  writeJSON(setupMarkerPath(root), { notified: [...names].sort() });
}

/** Re-validate an adapter's returned signals through the schema, dropping (not throwing on)
 *  malformed ones so one bad signal can't poison the merged document. */
function coerceSignals(raw, extractor, degraded) {
  const out = [];
  if (!Array.isArray(raw)) {
    degraded.push(`${extractor}: adapter returned non-array signals — dropped`);
    return out;
  }
  for (const s of raw) {
    try {
      out.push(makeSignal({ kind: s && s.kind, confidence: s && s.confidence, evidence: s && s.evidence, detail: s && s.detail, source: (s && s.source) || extractor }));
    } catch (e) {
      degraded.push(`${extractor}: dropped a malformed signal (${(e && e.message) || e})`);
    }
  }
  return out;
}

/**
 * Run the universal built-in plus all applicable adapters and merge into one signals set.
 * @param {string} root
 * @param {{ date?: string, config?: any, adapters?: any[], window?: number }} [opts]
 * @returns {{ sources: any[], degraded: string[], signals: any[], findings: any[] }}
 */
function extractSignals(root, opts = {}) {
  const config = opts.config || loadConfig(root).config;
  const adapters = opts.adapters || loadAdapters();
  const sources = [];
  const degraded = [];
  const signals = [];
  const findings = [];

  // 1) Universal built-in — always runs, always the floor (§2.6, story 5.1).
  const ug = universalGitSignals(root, { window: opts.window, ignoreGlobs: analysisExcludeGlobs(config) });
  signals.push(...ug.signals);
  for (const d of ug.degraded) degraded.push(d);
  sources.push(...ug.sources);

  // 2) Tool adapters — detect → available → run, each failure degrading independently.
  const alreadyNotified = readNotified(root);
  const notifiedNow = new Set(alreadyNotified);
  for (const adapter of adapters) {
    let info;
    try { info = adapter.explain() || {}; } catch { info = {}; }
    const name = info.name || 'adapter';
    let detected = false;
    try { detected = !!adapter.detect(root); } catch (e) { degraded.push(`${name}: detect() failed (${(e && e.message) || e}) — skipped`); continue; }
    if (!detected) continue; // ecosystem doesn't apply — silent, not an error

    let avail = false;
    try { avail = !!adapter.available(root); } catch (e) { degraded.push(`${name}: available() failed (${(e && e.message) || e}) — skipped`); continue; }
    if (!avail) {
      // Detected but tool absent (FR10): degrade every run; setup finding only the first time.
      degraded.push(`${name}: ${info.summary || 'tool unavailable'}${info.install ? ` — install: ${info.install}` : ''}`);
      if (!alreadyNotified.has(name)) {
        findings.push(makeFinding('arch-review', {
          kind: 'setup', severity: 2, action: 'daytime-task', verified: false,
          title: `Install ${info.tool || name} to enable ${name} signals`,
          locus: `extractor:${name}:missing-tool`,
          evidence: [], extra: info.install ? { install: info.install } : undefined,
        }));
        notifiedNow.add(name);
      }
      continue;
    }

    // Available: run and merge (FR14). A crash or bad output drops just this adapter.
    let result;
    try { result = adapter.run(root, config); } catch (e) { degraded.push(`${name}: adapter crashed (${(e && e.message) || e}) — signals dropped`); continue; }
    const raw = result && result.signals;
    const valid = coerceSignals(raw, name, degraded);
    signals.push(...valid);
    sources.push({ extractor: name, tool: (result && result.tool) || info.tool || undefined });
  }

  if (notifiedNow.size !== alreadyNotified.size) recordNotified(root, notifiedNow);
  return { sources, degraded, signals, findings };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const window = args.window ? parseInt(args.window, 10) : undefined;
  const res = extractSignals(root, { date, window });
  writeSignals(root, date, res); // out/signals-<date>.json (sources/degraded/signals)
  process.stdout.write(JSON.stringify({ sources: res.sources, signals: res.signals.length, degraded: res.degraded, setup_findings: res.findings.length }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { extractSignals, loadAdapters, isAdapter };
