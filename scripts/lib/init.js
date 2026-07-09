// @ts-check
'use strict';
// init.js (lib) — the deterministic core of `/nightwatch init` daytime setup (§6, FR33/NFR4).
//
// The interview itself is agent-driven and specified in commands/nightwatch.md (init is the ONE
// mode that may ask questions). Everything that must be mechanical and testable lives here:
//   - instantiate the shipped declaration templates (templates/STATE.md, templates/config.yaml)
//     into a repo ONLY when absent — init is setup, never overwrite, so an existing declaration
//     is never clobbered;
//   - register `.nightwatch/out/` in the repo's `.gitignore` (the transient per-run artifact dir);
//   - a LOCAL-ONLY probe of every extractor adapter (§2.6) that returns, per adapter,
//     {detected, available, installHint}. The install hint is populated only for a
//     detected-but-unavailable tool — init is the single moment a tool install is ever suggested.
//
// It spends no tokens, touches no network, and installs nothing. The human's interview answers are
// plain inputs, so the whole module is unit-testable without any interactive input.
const fs = require('fs');
const path = require('path');
const { exists, readFileSafe, ensureDir } = require('./util');
const { loadAdapters } = require('../extract-signals');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');
const OUT_IGNORE = '.nightwatch/out/';

// Shipped declaration templates init instantiates: source template -> repo-relative (POSIX) dest.
const DECLARATIONS = [
  { key: 'state', template: 'STATE.md', dest: 'STATE.md' },
  { key: 'config', template: 'config.yaml', dest: '.nightwatch/config.yaml' },
];

/** Read a shipped template's text; a missing template is a packaging bug, so throw. */
function readTemplate(name) {
  const t = readFileSafe(path.join(TEMPLATES_DIR, name));
  if (t == null) throw new Error(`shipped template not found: templates/${name}`);
  return t;
}

/**
 * Instantiate the shipped declaration templates into `root`, but ONLY where absent — init is
 * setup, not overwrite, so an existing STATE.md / config.yaml is never clobbered. Content is the
 * template verbatim (the human then edits it, or re-runs init). Deterministic; no network.
 * @param {string} root
 * @param {{ config?: boolean }} [opts]  also write .nightwatch/config.yaml (default true).
 * @returns {{ file: string, dest: string, written: boolean, reason: string }[]}
 */
function writeDeclarations(root, opts = {}) {
  const writeConfig = opts.config !== false;
  const report = [];
  for (const d of DECLARATIONS) {
    if (d.key === 'config' && !writeConfig) continue;
    const abs = path.join(root, ...d.dest.split('/'));
    if (exists(abs)) {
      report.push({ file: d.key, dest: d.dest, written: false, reason: 'exists' });
      continue; // never clobber an existing declaration
    }
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, readTemplate(d.template));
    report.push({ file: d.key, dest: d.dest, written: true, reason: 'created' });
  }
  return report;
}

/**
 * Ensure `.nightwatch/out/` is git-ignored — the transient per-run artifact dir must never be
 * committed. Idempotent: appends the entry only when absent, creating `.gitignore` if needed.
 * @param {string} root
 * @returns {{ changed: boolean }}
 */
function ensureGitignore(root) {
  const gi = path.join(root, '.gitignore');
  const cur = readFileSafe(gi);
  const bare = OUT_IGNORE.replace(/\/$/, '');
  const has = (cur || '').split('\n').some((l) => { const t = l.trim(); return t === OUT_IGNORE || t === bare; });
  if (has) return { changed: false };
  const sep = !cur ? '' : (cur.endsWith('\n') ? '' : '\n');
  fs.writeFileSync(gi, (cur || '') + sep + OUT_IGNORE + '\n');
  return { changed: true };
}

/**
 * LOCAL-ONLY probe of every extractor adapter (§2.6, FR33 AC2). For each adapter it runs only the
 * contract's detect()/available()/explain() — never run(), never install, never network — and
 * returns a deterministic (name-sorted) report. `installHint` is populated ONLY for a
 * detected-but-unavailable tool: init is the single moment a tool install is ever suggested.
 * @param {string} root
 * @param {any[]} [adapters]  injectable for tests; defaults to the discovered adapters.
 * @returns {{ name: string, tool: string|null, detected: boolean, available: boolean, installHint: string|null, summary: string|null }[]}
 */
function probeAdapters(root, adapters) {
  const list = adapters || loadAdapters();
  const rows = [];
  for (const adapter of list) {
    let info; try { info = adapter.explain() || {}; } catch { info = {}; }
    const name = info.name || 'adapter';
    let detected = false; let available = false;
    try { detected = !!adapter.detect(root); } catch { detected = false; }
    if (detected) { try { available = !!adapter.available(root); } catch { available = false; } }
    rows.push({
      name,
      tool: info.tool || null,
      detected,
      available,
      // Only actionable — and only offered — when the ecosystem applies but the tool is missing.
      installHint: detected && !available ? (info.install || null) : null,
      summary: info.summary || null,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One deterministic init pass: probe the adapters, then (unless `probeOnly`) instantiate the
 * missing declaration files and register the out/ ignore. Returns the structured report the
 * command prompt reads back to the human. With `probeOnly`, writes nothing.
 * @param {string} root
 * @param {{ probeOnly?: boolean, config?: boolean, adapters?: any[] }} [opts]
 */
function runInit(root, opts = {}) {
  const probe = probeAdapters(root, opts.adapters);
  if (opts.probeOnly) return { probe, declarations: [], gitignore: null };
  const declarations = writeDeclarations(root, { config: opts.config });
  const gitignore = ensureGitignore(root);
  return { probe, declarations, gitignore };
}

module.exports = { runInit, writeDeclarations, ensureGitignore, probeAdapters, readTemplate, TEMPLATES_DIR };
