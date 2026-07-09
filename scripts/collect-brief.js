#!/usr/bin/env node
// @ts-check
'use strict';
// collect-brief.js — deterministic brief assembly (truncation must be mechanical; ranking
// *within* jobs is the jobs' judgment). Reads every out/<job>-<date>.json, enforces the
// global cap by interleave priority, writes briefs/<date>.md + MORNING.md, appends ledger
// lines, and computes the demotion rule (a job with zero acted-on findings two runs running).
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { parseArgs, repoRoot, todayISO, nwDir, outDir, ensureDir, readFileSafe, readJSONSafe, exists } = require('./lib/util');
const { readAllFindings } = require('./lib/findings');
const { openTracker } = require('./lib/tracker');
const { loadConfig } = require('./lib/config');

const MEMBER_JOBS = ['repo-reconcile', 'arch-review', 'release-progress'];

// Priority classes (lower rank = higher priority). Setup floats near the top so a fresh,
// unconfigured repo surfaces its declarations first (spec acceptance).
function classify(f) {
  if (f.severity === 1 || f.kind === 'blocker') return { rank: 0, label: 'blocker' };
  if (f.kind === 'setup') return { rank: 1, label: 'setup' };
  if (f.action === 'human-decision' || f.kind === 'decision') return { rank: 2, label: 'decision' };
  if (f.kind === 'drift') return { rank: 3, label: 'drift' };
  if (f.kind === 'arch') return { rank: 4, label: 'arch' };
  return { rank: 5, label: 'info' };
}

function briefEligible(f) { return f.verified === true || f.kind === 'setup'; }

function evStr(ev) {
  if (!Array.isArray(ev) || !ev.length) return '';
  return ev.map((e) => e.line != null ? `${e.path}:${e.line}` : e.path).join(', ');
}

function renderItem(f) {
  const ev = evStr(f.evidence);
  const act = f.action && f.action !== 'none' ? `  _[${f.action}]_` : '';
  return `- [ ] \`${f.id}\` (sev${f.severity}) ${f.title}` + (ev ? ` — evidence: ${ev}` : '') + act;
}

function readReleaseHeader(root) {
  const text = readFileSafe(path.join(root, 'RELEASE.md'));
  if (!text) return null;
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  let fm = {};
  if (m) { try { fm = yaml.load(m[1]) || {}; } catch { /* */ } }
  const statusLine = (text.match(/^-\s+\d{4}-\d{2}-\d{2}\s+—.*$/m) || [])[0] || null;
  return { fm, statusLine };
}

// Demotion (spec principle 3): a member job with zero acted-on findings for the two most
// recent runs in which it produced findings is flagged for retirement/redesign. Ledger reads go
// through the tracking store — the sole sanctioned reader/writer of ledger.jsonl (§2.7); an
// already-open store is threaded in by collect(), otherwise a read-only markdown store is opened.
function computeDemotions(root, store) {
  const rows = (store || openTracker(root)).readLedger();
  // Acted-on reaches the ledger two ways: stamped directly on a finding row (`acted_on:true`), or —
  // the normal morning-feedback path — as a `type:"feedback"` row backfilled from a checked brief box
  // (backfill-feedback.js → recordFeedback, verdict `acted-on`). Fold the feedback marks in by id so
  // the demotion query counts a finding as acted-on whichever way the mark was recorded (FR35).
  const actedIds = new Set();
  for (const r of rows) if (r.type === 'feedback' && /^acted/.test(String(r.verdict))) actedIds.add(r.id);
  const flags = [];
  for (const job of MEMBER_JOBS) {
    const byDate = new Map();
    for (const r of rows) {
      if (r.type !== 'finding' || r.job !== job) continue;
      const d = byDate.get(r.date) || { total: 0, acted: 0 };
      d.total++; if (r.acted_on === true || actedIds.has(r.id)) d.acted++;
      byDate.set(r.date, d);
    }
    const dates = [...byDate.keys()].sort().slice(-2);
    if (dates.length === 2 && dates.every((d) => byDate.get(d).total > 0 && byDate.get(d).acted === 0)) {
      flags.push(job);
    }
  }
  return flags;
}

function collect(root, date, { force = false } = {}) {
  const { config } = loadConfig(root);
  const cap = (config.caps && config.caps.brief_total) || 25;
  const store = openTracker(root, config);

  const docs = readAllFindings(root, date, MEMBER_JOBS);
  const runStatus = readJSONSafe(path.join(outDir(root), `run-status-${date}.json`)) || { jobs: [] };

  // Gather eligible findings tagged with source job + class.
  const all = [];
  const degradedNotices = [];
  for (const doc of docs) {
    for (const n of doc.degraded || []) degradedNotices.push({ job: doc.job, note: n });
    for (const f of doc.findings || []) if (briefEligible(f)) all.push({ ...f, job: doc.job, _cls: classify(f) });
  }
  // Global ranking for the cap.
  all.sort((a, b) => a._cls.rank - b._cls.rank || a.severity - b.severity || a.id.localeCompare(b.id));
  const included = new Set(all.slice(0, cap).map((f) => f.id));
  const overflow = all.slice(cap);

  const inc = (pred) => all.filter((f) => included.has(f.id) && pred(f));

  // ---- Assemble sections in fixed order ----
  const L = [];
  L.push(`# Nightwatch — morning brief (${date})`, '');

  // 1. Release-progress delta
  const rel = readReleaseHeader(root);
  L.push('## Release progress');
  if (rel && rel.fm && rel.fm.progress != null) {
    L.push(`- Progress: **${rel.fm.progress}%** toward ${rel.fm.target || 'release'} (phase: ${rel.fm.phase || 'unset'})`);
    if (rel.statusLine) L.push(`  ${rel.statusLine.trim()}`);
  } else {
    L.push('- No RELEASE.md yet — run `/release-progress` (or `/nightwatch`) to create it.');
  }
  L.push('');

  // 2. Human decisions (merged across jobs)
  const decisions = inc((f) => f._cls.label === 'decision');
  L.push('## Human decisions required');
  if (decisions.length) for (const f of decisions) L.push(renderItem(f)); else L.push('- none');
  L.push('');

  // 3. Reconcile findings (blockers + drift + setup from repo-reconcile)
  const rc = inc((f) => f.job === 'repo-reconcile' && f._cls.label !== 'decision');
  L.push('## Consistency (repo-reconcile)');
  if (rc.length) for (const f of rc) L.push(renderItem(f)); else L.push('- 0 findings');
  L.push('');

  // 4. Arch candidates
  const ar = inc((f) => f.job === 'arch-review' && f._cls.label !== 'decision');
  L.push('## Architecture (arch-review)');
  if (ar.length) for (const f of ar) L.push(renderItem(f)); else L.push('- 0 findings');
  L.push('');

  // 5. Failures & degraded notices
  L.push('## Failures & degraded notices');
  const failLines = [];
  for (const j of runStatus.jobs || []) if (j.status && j.status !== 'ok') failLines.push(`- ${j.job}: **${j.status}**${j.note ? ' — ' + j.note : ''}`);
  for (const d of degradedNotices) failLines.push(`- ${d.job}: degraded — ${d.note}`);
  const demotions = computeDemotions(root, store);
  for (const job of demotions) failLines.push(`- ${job}: **demotion candidate** — zero acted-on findings two runs running; retire or redesign.`);
  if (failLines.length) L.push(...failLines); else L.push('- none');
  L.push('');

  // 6. Appendix pointer
  L.push('## Appendix (overflow — ids only)');
  if (overflow.length) L.push('- ' + overflow.map((f) => `\`${f.id}\``).join(', ')); else L.push('- none');
  L.push('');
  L.push('---', `_Check a box (\`[x]\`) to mark acted-on, or \`[-]\` to dismiss; the next run backfills the ledger. Total findings: ${all.length}, shown: ${included.size}, cap: ${cap}._`);

  const briefText = L.join('\n') + '\n';

  // ---- Write brief + MORNING.md ----
  const briefsDir = path.join(nwDir(root), 'briefs');
  ensureDir(briefsDir);
  fs.writeFileSync(path.join(briefsDir, `${date}.md`), briefText);
  fs.writeFileSync(path.join(nwDir(root), 'MORNING.md'), briefText);

  // ---- Ledger append THROUGH THE TRACKING STORE (§2.7: the store is the sole sanctioned
  // ledger writer). Guard against a double-append on a same-date re-run so re-runs don't inflate
  // recurrence/demotion counts. Per-job lines carry date/job/tokens/findings count/degraded flags;
  // finding rows go through recordFindings so they dedupe by id like every other ledger writer. ----
  const already = store.readLedger().some((r) => r.type === 'run' && r.job === 'collect-brief' && r.date === date);
  if (!already || force) {
    for (const doc of docs) {
      const js = (runStatus.jobs || []).find((j) => j.job === doc.job) || {};
      store.recordRun({ date, job: doc.job, findings: (doc.findings || []).length, degraded: (doc.degraded || []).length, tokens: js.tokens || null });
      store.recordFindings(doc.findings || [], { date, job: doc.job });
    }
    store.recordRun({ date, job: 'collect-brief', shown: included.size, total: all.length, cap });
  }

  return { total: all.length, shown: included.size, overflow: overflow.length, demotions };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  const res = collect(root, date, { force: !!args.force });
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { collect, computeDemotions };
