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
const { parseArgs, repoRoot, todayISO, nwDir, outDir, ensureDir, readFileSafe, readJSONSafe, exists, progressPercent } = require('./lib/util');
const { readAllFindings } = require('./lib/findings');
const { openTracker, releaseReadPath } = require('./lib/tracker');
const { loadConfig } = require('./lib/config');
const { excludedTopDirs, unclassifiedTopDirs } = require('./lib/scope');

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

// A deterministic, collision-resistant Details anchor for a finding. Stable ids in → stable
// anchors out, so the action line's `→ [details](#…)` link and the Details heading always agree
// and the brief stays byte-deterministic (NFR8).
function detailsAnchor(f) { return `d-${f.id}`; }

// The imperative summary a reader acts on: the judgment-authored `next_step.summary` when present;
// otherwise the finding's own title (FR54 fallback). A human-decision finding with no authored
// summary renders as a decide-action so "the first action" reads as a decision to make (FR57).
function actionSummary(f) {
  if (f.next_step && f.next_step.summary) return f.next_step.summary;
  if (f._cls && f._cls.label === 'decision') return `Decide: ${f.title}`;
  return f.title;
}

// Sort key for the effort tiebreak (FR57): fewer minutes first, an absent estimate sorts last.
function effortKey(f) {
  const e = f.next_step && f.next_step.effort_min;
  return typeof e === 'number' ? e : Infinity;
}

// One action line, rendered mechanically from `next_step` (spec §6). Checkbox first (the feedback
// touch-point), bold verb-first summary, `~N min` when estimated, the copy-pasteable command block
// when present, and an anchor link into Details. When a `next_step.summary` stands in for the
// title, the title becomes the one-sentence "why". Evidence and the human-visible id live only in
// Details — the reader meets the action here, never the code. (Richer grammar/bundling: Story 8.3.)
function renderActionLine(f, lines) {
  const ns = f.next_step || {};
  const effort = typeof ns.effort_min === 'number' ? ` — ~${ns.effort_min} min` : '';
  const anchor = `→ [details](#${detailsAnchor(f)})`;
  const why = (ns.summary && f.title && f.title !== ns.summary) ? ` ${f.title.replace(/\s+$/, '')}.` : '';
  // The id manifest is invisible in rendered Markdown but is how backfill/review map a checked box
  // back to its finding (feedback.js) — one id per line here, a list once bundling lands (8.3).
  const ids = `<!-- ids: ${f.id} -->`;
  if (ns.command) {
    lines.push(`- [ ] **${actionSummary(f)}**${effort}: ${ids}`, '', `      ${ns.command}`, '', `  ${why ? why.trim() + ' ' : ''}${anchor}`);
  } else {
    lines.push(`- [ ] **${actionSummary(f)}**${effort}.${why} ${anchor} ${ids}`);
  }
}

// One Details block per shown finding: the evidence, severity, human-visible id, and action tag
// the action line deliberately omitted. Anchored so the action line links straight to it.
function renderDetails(f, lines) {
  const ev = evStr(f.evidence);
  lines.push(`### ${actionSummary(f)} <a id="${detailsAnchor(f)}"></a>`);
  if (ev) lines.push(`- evidence: ${ev}`);
  const act = f.action && f.action !== 'none' ? ` · ${f.action}` : '';
  lines.push(`- severity ${f.severity} · id \`${f.id}\`${act}`, '');
}

function readReleaseHeader(root, config) {
  const text = readFileSafe(releaseReadPath(root, config));
  if (!text) return null;
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  let fm = {};
  if (m) { try { fm = yaml.load(m[1]) || {}; } catch { /* */ } }
  const statusLine = (text.match(/^-\s+\d{4}-\d{2}-\d{2}\s+—.*$/m) || [])[0] || null;
  return { fm, statusLine };
}

// The brief's status line: one bold sentence answering "is anything on fire?" before anything else
// (spec §6, FR56). Derived purely from counts, so it is byte-deterministic. Tier order: blockers →
// decisions → quiet-with-a-waiting-clause → nothing. A crashed or timed-out member is named in the
// status line itself (not only in Machine notes) so a failed night can't hide below the fold.
function deriveStatusLine(shown, runStatus) {
  const failed = (runStatus.jobs || []).filter((j) => j.status === 'crashed' || j.status === 'timeout');
  const failSuffix = failed.length
    ? ` — ${failed.length === 1 ? `${failed[0].job} ${failed[0].status}` : `${failed.length} jobs failed`}, see Machine notes.`
    : '';
  const blockers = shown.filter((f) => f._cls.label === 'blocker').length;
  const decisions = shown.filter((f) => f._cls.label === 'decision').length;
  if (blockers) return `**${blockers} release blocker${blockers > 1 ? 's' : ''}.** Start below.${failSuffix}`;
  if (decisions) return `**${decisions} decision${decisions > 1 ? 's' : ''} ${decisions > 1 ? 'need' : 'needs'} you.** Nothing else is blocking.${failSuffix}`;
  if (shown.length) {
    const fixes = shown.filter((f) => f.action === 'patch-available').length;
    const clause = fixes
      ? `${fixes === 1 ? 'One ready-made fix is' : `${fixes} ready-made fixes are`} waiting for you.`
      : `${shown.length} thing${shown.length > 1 ? 's' : ''} waiting below.`;
    return `**Quiet night.** Nothing is blocking, no decisions needed. ${clause}${failSuffix}`;
  }
  return `**Quiet night.** Nothing needs you today.${failSuffix}`;
}

// The "Where you stand" release-position block (spec §6): the progress toward the target and a
// pointer to the tracker — never the tracker's full status-entry text, so MORNING.md and RELEASE.md
// no longer duplicate it. (Ratio + remaining-criterion titles: Story 8.4.)
function renderWhereYouStand(rel, lines) {
  if (rel && rel.fm && rel.fm.progress != null) {
    lines.push(`- **${progressPercent(rel.fm.progress)}%** toward ${rel.fm.target || 'release'} (phase: ${rel.fm.phase || 'unset'}). Full tracker: \`.nightwatch/RELEASE.md\`.`);
  } else {
    lines.push('- No RELEASE.md yet — run `/release-progress` (or `/nightwatch`) to create it.');
  }
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
  const { config, authority } = loadConfig(root);
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
  // Global ranking for the cap and first-action selection (FR57): priority class → severity →
  // lowest effort (absent last) → id. Fully deterministic (NFR8).
  all.sort((a, b) => a._cls.rank - b._cls.rank || a.severity - b.severity || effortKey(a) - effortKey(b) || a.id.localeCompare(b.id));
  const shown = all.slice(0, cap);
  const overflow = all.slice(cap);

  // ---- Compose for a 30-second read (spec §6): status, ONE first action, and the release
  // position all land ABOVE the fold; evidence, ids, and degraded notices below it. ----
  const L = [];
  L.push(`# Nightwatch — ${date}`, '');

  // Status line — one bold sentence answering "is anything on fire?" before anything else.
  L.push(deriveStatusLine(shown, runStatus), '');

  // ▶ First action — exactly one (the top-ranked shown finding), fully renderable without reading on.
  const first = shown[0] || null;
  L.push('## ▶ First action');
  if (first) renderActionLine(first, L); else L.push('- Nothing needs you today.');
  L.push('');

  // If you have energy after that — the remaining shown findings as action lines, same grammar.
  const rest = shown.slice(1);
  L.push('## If you have energy after that');
  if (rest.length) for (const f of rest) renderActionLine(f, L); else L.push('- Nothing else right now.');
  L.push('');

  // Where you stand — release position, then a pointer to the tracker (never its status-entry text).
  const rel = readReleaseHeader(root, config);
  L.push('## Where you stand');
  renderWhereYouStand(rel, L);
  L.push('');

  // ---- Fold: everything below is supporting detail. ----
  L.push('---', '*Everything below is supporting detail. You can stop reading here.*', '');

  // Details — one block per shown finding (evidence, severity, human-visible id), plus the
  // ids-only overflow appendix.
  L.push('## Details', '');
  if (shown.length) for (const f of shown) renderDetails(f, L); else L.push('- No findings today.', '');
  L.push('**Appendix (overflow — ids only):** ' + (overflow.length ? overflow.map((f) => `\`${f.id}\``).join(', ') : 'none'), '');

  // Machine notes — nothing to act on: degraded notices, failed/timed-out members, demotion
  // candidates, zero-finding member jobs, config drift, and the scope line.
  L.push('## Machine notes — nothing to act on');
  const notes = [];
  for (const j of runStatus.jobs || []) if (j.status && j.status !== 'ok') notes.push(`- ${j.job}: **${j.status}**${j.note ? ' — ' + j.note : ''}`);
  for (const d of degradedNotices) notes.push(`- ${d.job}: degraded — ${d.note}`);
  const demotions = computeDemotions(root, store);
  for (const job of demotions) notes.push(`- ${job}: **demotion candidate** — zero acted-on findings two runs running; retire or redesign.`);
  // Zero-finding member jobs render here, never as an empty section above the fold.
  const shownJobs = new Set(shown.map((f) => f.job));
  for (const doc of docs) if (!shownJobs.has(doc.job) && !(doc.findings || []).some(briefEligible)) {
    notes.push(`- ${doc.job}: 0 verified findings.`);
  }
  // Config drift (FR53): name each new top-level directory no declaration classifies (neither
  // product-declared, nor in ignore/dev_tooling) and point at `init --update`. Detection + reporting
  // only — the overnight run writes no declarations; the lines are byte-deterministic (sorted).
  const driftDirs = unclassifiedTopDirs(root, config, { authority });
  for (const d of driftDirs) {
    notes.push(`- new top-level directory \`${d}/\` is unclassified; run \`/nightwatch init --update\` or add it to \`.nightwatch/config.yaml\`.`);
  }
  // Scope statement (FR42): name the excluded top-level trees so a wrong scope is visible, never
  // silent. `ignore` (never look) and `dev_tooling` (not the product) are unioned.
  const excluded = excludedTopDirs(root, config);
  notes.push(excluded.length
    ? `- Scope: excluded ${excluded.join(', ')} (ignore + dev_tooling) — edit \`.nightwatch/config.yaml\` to change.`
    : '- Scope: no top-level directories excluded — edit `.nightwatch/config.yaml` to change.');
  L.push(...notes, '');

  // Footer names BOTH feedback methods (FR44): the interactive review command and hand-editing the
  // checkboxes — either records the same ledger feedback.
  L.push('---', `_Review interactively with \`/nightwatch review\` — or mark boxes by hand (\`[x]\` acted-on, \`[-]\` dismiss); the next run backfills the ledger. Total findings: ${all.length}, shown: ${shown.length}, cap: ${cap}._`);

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
    store.recordRun({ date, job: 'collect-brief', shown: shown.length, total: all.length, cap });
  }

  return { total: all.length, shown: shown.length, overflow: overflow.length, demotions };
}

// Write a one-line stub brief that names a failure, WITHOUT touching any out/*.json. "No brief at
// all is itself a signal; the collector always attempts a stub" (§6 failure handling, FR32 AC3/AC4)
// — so whenever full assembly can't run (a non-git abort upstream, or assembly throwing here) the
// human still finds a MORNING.md (and dated brief) that says what went wrong and where the raw
// findings are. Writes land only inside `.nightwatch/**`, the declared write surface.
function writeStubBrief(root, date, reason) {
  const text = [
    `# Nightwatch — morning brief (${date})`,
    '',
    '## Failures & degraded notices',
    `- **brief incomplete** — ${reason}`,
    '',
    '---',
    '_Stub brief: no full brief could be assembled. Any raw findings remain under `.nightwatch/out/`'
      + ' for triage — no brief at all is itself a signal._',
    '',
  ].join('\n');
  const briefsDir = path.join(nwDir(root), 'briefs');
  ensureDir(briefsDir);
  fs.writeFileSync(path.join(briefsDir, `${date}.md`), text);
  fs.writeFileSync(path.join(nwDir(root), 'MORNING.md'), text);
  return text;
}

// Top-level guard (§6 AC3): assemble the brief, but never leave the human with nothing. If assembly
// throws (a corrupt/too-new findings doc, a store error, …) fall back to a stub that names the
// failure while leaving the raw out/*.json untouched for triage. Returns collect()'s result on
// success, or `{ status: 'stub', reason }` on fallback. The collector never deletes out/*.json.
function collectOrStub(root, date, opts = {}) {
  try {
    return collect(root, date, opts);
  } catch (err) {
    const reason = `collect-brief could not assemble: ${(err && err.message) || String(err)}`;
    writeStubBrief(root, date, reason);
    return { status: 'stub', reason };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot(args);
  const date = todayISO(args);
  // Always emit at least a stub — a failed assembly must not exit with no brief written.
  const res = collectOrStub(root, date, { force: !!args.force });
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { collect, collectOrStub, writeStubBrief, computeDemotions };
