#!/usr/bin/env node
// @ts-check
'use strict';
// release-checks.js — deterministic release-hygiene checks valid for any public repo.
// Feeds /release-progress as the "generic" source of done. Each check is pass|fail|skip
// with evidence. Configurable via config `release_checks.disable: [ids]`.
const path = require('path');
const { parseArgs, repoRoot, todayISO, walkFiles, readFileSafe, exists, git, writeJSON, outDir } = require('./lib/util');
const { loadConfig } = require('./lib/config');

function findFile(root, files, re) { return files.find((f) => re.test(f)) || null; }

function checkLicense(root, files) {
  const f = findFile(root, files, /^LICENSE(\.\w+)?$|^LICENCE(\.\w+)?$/i);
  return f ? { status: 'pass', evidence: [{ path: f }] } : { status: 'fail', detail: 'no LICENSE file at repo root' };
}

function checkReadmeSections(root, files) {
  const f = findFile(root, files, /^readme\.md$/i) || findFile(root, files, /readme\.md$/i);
  if (!f) return { status: 'fail', detail: 'no README.md' };
  const text = (readFileSafe(path.join(root, f)) || '').toLowerCase();
  const hasInstall = /(^|\n)#+\s*(install|installation|setup|getting started)/i.test(text);
  const hasQuick = /(^|\n)#+\s*(quick\s?start|usage|getting started|example)/i.test(text);
  if (hasInstall && hasQuick) return { status: 'pass', evidence: [{ path: f }] };
  const missing = [!hasInstall && 'install', !hasQuick && 'quickstart/usage'].filter(Boolean);
  return { status: 'fail', evidence: [{ path: f }], detail: 'README missing section(s): ' + missing.join(', ') };
}

// A "cheaply runnable" test entrypoint the CI would exercise — detected from declared
// config only, never executed (running arbitrary tests would be neither cheap nor
// deterministic, violating NFR8). This is the "last test run if cheaply runnable" hook:
// we surface *what* CI runs so the consuming brief can attribute a red build.
function detectTestCommand(root, files) {
  const pkgText = readFileSafe(path.join(root, 'package.json'));
  if (pkgText) {
    try {
      const scripts = JSON.parse(pkgText).scripts;
      const t = scripts && scripts.test;
      if (typeof t === 'string' && t.trim() && !/no test specified/i.test(t)) return 'npm test';
    } catch { /* unparsable package.json — fall through */ }
  }
  const mkRel = files.find((f) => /^(Makefile|makefile|GNUmakefile)$/.test(f));
  if (mkRel && /^test\s*:/m.test(readFileSafe(path.join(root, mkRel)) || '')) return 'make test';
  if (files.some((f) => /^(pytest\.ini|tox\.ini|noxfile\.py)$/.test(f))) return 'pytest';
  return null;
}

function checkCI(root, files) {
  const ci = files.find((f) => /^\.github\/workflows\/.+\.ya?ml$/i.test(f) || /^\.gitlab-ci\.yml$/i.test(f) || /^\.circleci\/config\.yml$/i.test(f) || /(^|\/)azure-pipelines\.yml$/i.test(f));
  const testCmd = detectTestCommand(root, files);
  if (!ci) {
    return { status: 'fail', detail: 'no CI config found' + (testCmd ? ` (runnable test entrypoint "${testCmd}" exists but is not wired to CI)` : '') };
  }
  const detail = testCmd ? `CI config present; test entrypoint: ${testCmd}` : 'CI config present; no local test entrypoint detected';
  return { status: 'pass', evidence: [{ path: ci }], detail, test_command: testCmd };
}

function checkChangelog(root, files) {
  const f = findFile(root, files, /^CHANGELOG(\.md)?$/i);
  return f ? { status: 'pass', evidence: [{ path: f }] } : { status: 'fail', detail: 'no CHANGELOG' };
}

const SECRET_PATTERNS = [
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'generic assigned secret', re: /(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*['"][A-Za-z0-9+/_\-]{16,}['"]/i },
  { name: 'Slack token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
];
const TEXT_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rb|rs|java|json|ya?ml|toml|env|ini|sh|md|txt|cfg|properties)$/i;
function checkSecrets(root, files) {
  const hits = [];
  for (const rel of files) {
    if (!TEXT_EXT.test(rel) || /(^|\/)(test|tests|fixtures?|examples?)\//i.test(rel)) continue;
    const text = readFileSafe(path.join(root, rel));
    if (text == null || text.length > 2 * 1024 * 1024) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const p of SECRET_PATTERNS) if (p.re.test(lines[i])) { hits.push({ path: rel, line: i + 1 }); break; }
    }
    if (hits.length >= 20) break;
  }
  return hits.length ? { status: 'fail', evidence: hits.slice(0, 20), detail: `${hits.length} possible committed-secret pattern(s)` } : { status: 'pass' };
}

function checkTodos(root, files, threshold) {
  let count = 0; const evidence = [];
  for (const rel of files) {
    if (!TEXT_EXT.test(rel)) continue;
    const text = readFileSafe(path.join(root, rel));
    if (text == null) continue;
    const m = text.match(/\b(TODO|FIXME|XXX|HACK)\b/g);
    if (m) { count += m.length; if (evidence.length < 10) evidence.push({ path: rel }); }
  }
  return count <= threshold ? { status: 'pass', detail: `${count} TODO/FIXME (<= ${threshold})` }
    : { status: 'fail', evidence, detail: `${count} TODO/FIXME markers exceed threshold ${threshold}` };
}

function checkVersionTag(root, files) {
  const pkgText = readFileSafe(path.join(root, 'package.json'));
  let version = null;
  if (pkgText) { try { version = JSON.parse(pkgText).version || null; } catch { /* */ } }
  if (!version) return { status: 'skip', detail: 'no package.json version to compare against tags' };
  const tag = (git(root, ['describe', '--tags', '--abbrev=0']) || '').trim();
  if (!tag) return { status: 'skip', detail: `version ${version} present but no git tags yet` };
  const norm = (t) => t.replace(/^v/, '');
  return norm(tag) === norm(version)
    ? { status: 'pass', detail: `version ${version} matches latest tag ${tag}` }
    : { status: 'fail', detail: `package.json version ${version} != latest tag ${tag}` };
}

const CHECKS = {
  license: checkLicense,
  readme_sections: checkReadmeSections,
  ci_present: checkCI,
  changelog: checkChangelog,
  no_secrets: checkSecrets,
  todo_threshold: (root, files, cfg) => checkTodos(root, files, (cfg && cfg.todo_threshold) || 40),
  version_tag: checkVersionTag,
};

function releaseChecks(root) {
  const { config } = loadConfig(root);
  const disabled = new Set((config.release_checks && config.release_checks.disable) || []);
  const files = walkFiles(root, config.ignore);
  const results = [];
  for (const id of Object.keys(CHECKS)) {
    if (disabled.has(id)) { results.push({ id, status: 'skip', detail: 'disabled in config' }); continue; }
    const r = CHECKS[id](root, files, config.release_checks || {});
    results.push({ id, ...r });
  }
  const summary = { pass: 0, fail: 0, skip: 0 };
  for (const r of results) summary[r.status]++;
  return { checks: results, summary };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const out = releaseChecks(root);
  writeJSON(path.join(outDir(root), `release-checks-${date}.json`), { job: 'release-checks', date, ...out });
  process.stdout.write(JSON.stringify(out.summary, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { releaseChecks };
