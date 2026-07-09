#!/usr/bin/env node
// @ts-check
'use strict';
// surface-inventory.js — extract the repo's *claimable surface*: CLI subcommands & flags,
// exported symbols, command/skill files, config keys read by code, file-tree shape.
// Per-ecosystem extractor (Node/TS first) + a universal fallback that works everywhere
// (file tree + command files + README code blocks + flag tokens). Writes out/surface-<date>.json.
const path = require('path');
const { parseArgs, repoRoot, todayISO, walkFiles, readFileSafe, exists, readJSONSafe, topSegment, writeJSON, outDir } = require('./lib/util');
const { loadConfig } = require('./lib/config');

function detectEcosystem(root) {
  if (exists(path.join(root, 'package.json'))) return 'node';
  if (exists(path.join(root, 'pyproject.toml')) || exists(path.join(root, 'setup.py')) || exists(path.join(root, 'requirements.txt'))) return 'python';
  return 'unknown';
}

const SRC_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|rb|java)$/;
function isSource(rel) { return SRC_EXT.test(rel) && !/\.(test|spec)\./.test(rel); }
function isDoc(rel) { return /\.md$/i.test(rel); }

function uniqSorted(arr) { return [...new Set(arr)].sort(); }

/** Universal signals present in every repo. */
function universal(root, files) {
  // File-tree shape: top-level dir -> file count.
  const topCounts = new Map();
  for (const f of files) { const t = topSegment(f); topCounts.set(t, (topCounts.get(t) || 0) + 1); }
  const top_dirs = [...topCounts.entries()].map(([name, files_]) => ({ name, files: files_ }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  // Command/skill files: markdown under commands/ or .claude/commands/ or skills/.
  const command_files = files.filter((f) => /(^|\/)(commands|\.claude\/commands|skills)\/[^/]+\.md$/i.test(f));

  // README code blocks + shell command lines + flag tokens.
  const readmePath = files.find((f) => /^readme\.md$/i.test(f)) || files.find((f) => /readme\.md$/i.test(f));
  const readme_code_blocks = [];
  const readme_flag_tokens = new Set();
  if (readmePath) {
    const text = readFileSafe(path.join(root, readmePath)) || '';
    const lines = text.split('\n');
    let inFence = false, fenceLang = '', fenceStart = 0, buf = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^```(\w*)/);
      if (m) {
        if (!inFence) { inFence = true; fenceLang = m[1] || ''; fenceStart = i + 1; buf = []; }
        else { readme_code_blocks.push({ lang: fenceLang, line: fenceStart, first_line: (buf[0] || '').slice(0, 120) }); inFence = false; }
        continue;
      }
      if (inFence) buf.push(lines[i]);
    }
    for (const tok of text.matchAll(/(?<![\w-])--([a-zA-Z][\w-]+)/g)) readme_flag_tokens.add('--' + tok[1]);
  }

  return { file_tree: { total_files: files.length, top_dirs }, command_files, readme_path: readmePath || null,
    readme_code_blocks, readme_flag_tokens: uniqSorted([...readme_flag_tokens]) };
}

/** Node/TS extractor: exports, bins, commander/yargs subcommands, flags, env config keys. */
function nodeExtractor(root, files) {
  const exportsFound = [];
  const flags = new Set();
  const subcommands = new Set();
  const config_keys = new Set();
  const bins = [];

  const pkg = readJSONSafe(path.join(root, 'package.json'));
  if (pkg) {
    if (typeof pkg.bin === 'string') bins.push(pkg.name || path.basename(pkg.bin));
    else if (pkg.bin && typeof pkg.bin === 'object') for (const k of Object.keys(pkg.bin)) bins.push(k);
    if (pkg.scripts) for (const k of Object.keys(pkg.scripts)) subcommands.add('npm:' + k);
  }

  for (const rel of files) {
    if (!isSource(rel) || !/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(rel)) continue;
    const text = readFileSafe(path.join(root, rel));
    if (text == null) continue;
    // exports
    for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([A-Za-z_$][\w$]*)/g)) exportsFound.push({ path: rel, name: m[1] });
    for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of m[1].split(',')) { const nm = n.trim().split(/\s+as\s+/)[0].trim(); if (nm) exportsFound.push({ path: rel, name: nm }); }
    for (const m of text.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) exportsFound.push({ path: rel, name: m[1] });
    // flags
    for (const m of text.matchAll(/(?<![\w-])--([a-zA-Z][\w-]+)/g)) flags.add('--' + m[1]);
    // commander / yargs subcommands
    for (const m of text.matchAll(/\.command\(\s*['"`]([a-zA-Z][\w:-]*)/g)) subcommands.add(m[1]);
    // env-based config keys
    for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) config_keys.add(m[1]);
  }

  return {
    bins: uniqSorted(bins),
    exports: exportsFound.slice(0, 500),
    cli: { subcommands: uniqSorted([...subcommands]), flags: uniqSorted([...flags]) },
    config_keys: uniqSorted([...config_keys]),
  };
}

/** Python extractor (light): top-level defs/classes as exports, argparse flags, env keys. */
function pythonExtractor(root, files) {
  const exportsFound = [];
  const flags = new Set();
  const config_keys = new Set();
  const subcommands = new Set();
  for (const rel of files) {
    if (!/\.py$/.test(rel) || /\/(tests?|test)\//.test(rel)) continue;
    const text = readFileSafe(path.join(root, rel));
    if (text == null) continue;
    for (const m of text.matchAll(/^(?:def|class)\s+([A-Za-z_][\w]*)/gm)) if (!m[1].startsWith('_')) exportsFound.push({ path: rel, name: m[1] });
    for (const m of text.matchAll(/add_argument\(\s*['"](--[a-zA-Z][\w-]+)/g)) flags.add(m[1]);
    for (const m of text.matchAll(/add_parser\(\s*['"]([a-zA-Z][\w-]+)/g)) subcommands.add(m[1]);
    for (const m of text.matchAll(/os\.environ(?:\.get\()?\[?['"]([A-Z0-9_]+)['"]/g)) config_keys.add(m[1]);
  }
  return { bins: [], exports: exportsFound.slice(0, 500), cli: { subcommands: uniqSorted([...subcommands]), flags: uniqSorted([...flags]) }, config_keys: uniqSorted([...config_keys]) };
}

function inventory(root) {
  const { config } = loadConfig(root);
  const files = walkFiles(root, config.ignore);
  const eco = detectEcosystem(root);
  const degraded = [];
  // FR36: a broken build / unparsable surface is captured here as a `blocking` failure — a
  // non-empty `blocking` tells the consuming job to rank it finding #1 and stop deeper
  // checks — while we still emit a valid (universal-only) surface document.
  const blocking = [];
  const base = universal(root, files);
  let ext = { bins: [], exports: [], cli: { subcommands: [], flags: [] }, config_keys: [] };

  // A present-but-unparsable primary manifest is the static analog of "the build is broken":
  // the declared surface can't be trusted, so flag it rather than silently under-reporting.
  if (eco === 'node' && readFileSafe(path.join(root, 'package.json')) != null && readJSONSafe(path.join(root, 'package.json')) == null) {
    blocking.push({ reason: 'package.json is present but not valid JSON — Node surface cannot be extracted', evidence: [{ path: 'package.json' }] });
  }

  try {
    if (eco === 'node') ext = nodeExtractor(root, files);
    else if (eco === 'python') ext = pythonExtractor(root, files);
    else degraded.push(`no extractor for ecosystem "${eco}" — universal fallback only (file tree, command files, README claims)`);
  } catch (e) {
    // A probe that throws leaves the surface unparsable — capture and degrade to universal.
    blocking.push({ reason: `${eco} surface probe failed (${(e && e.message) || e}) — universal signals only`, evidence: [] });
  }

  return { ecosystem: eco, blocking, degraded, ...base, ...ext };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const inv = inventory(root);
  const doc = { job: 'surface-inventory', date, ...inv };
  writeJSON(path.join(outDir(root), `surface-${date}.json`), doc);
  process.stdout.write(JSON.stringify({ ecosystem: inv.ecosystem, exports: inv.exports.length, flags: inv.cli.flags.length, subcommands: inv.cli.subcommands.length, command_files: inv.command_files.length, blocking: inv.blocking.length, degraded: inv.degraded }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { inventory, detectEcosystem };
