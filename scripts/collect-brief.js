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
const { parseArgs, repoRoot, todayISO, nwDir, outDir, outReadPath, ensureDir, readFileSafe, readJSONSafe, exists, progressPercent, git } = require('./lib/util');
const { readAllFindings } = require('./lib/findings');
const { openTracker, releaseReadPath } = require('./lib/tracker');
const { classifyOpenFindings, newClassificationRows, floorClassifier, runOrdinal, gcPatches } = require('./lib/lifecycle');
const { loadConfig } = require('./lib/config');
const { excludedTopDirs, unclassifiedTopDirs } = require('./lib/scope');
const { commitPolicyProbe, layoutUpgradeNudge } = require('./lib/probe');
const { isClean, checkCitations } = require('./lib/lints');
const { deriveJourney } = require('./lib/milestones');

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

// The imperative summary a reader acts on: the judgment-authored `next_step.summary` when present
// AND lint-clean; otherwise the finding's own title (FR54 fallback). A summary that fails a
// deterministic style lint (mid-sentence hard wrap W1, bare `#N` W2) degrades to the mechanical
// title rather than rendering broken prose (spec writing-harness P4.2) — no model call, no crash. A
// human-decision finding with no usable summary renders as a decide-action (FR57).
function actionSummary(f) {
  const s = f.next_step && f.next_step.summary;
  if (s && isClean(s)) return s;
  if (f._cls && f._cls.label === 'decision') return `Decide: ${f.title}`;
  return f.title;
}

// Sort key for the effort tiebreak (FR57): fewer minutes first, an absent estimate sorts last.
function effortKey(f) {
  const e = f.next_step && f.next_step.effort_min;
  return typeof e === 'number' ? e : Infinity;
}

// Group the (already-sorted, already-capped) shown findings into action-line groups (FR59, spec P7):
// findings whose `next_step.command` is BYTE-IDENTICAL merge into one group; every other finding
// (distinct command, or no command at all) is its own singleton group. Exact string equality only —
// never a similarity judgment. A group takes the position of its FIRST (top-ranked) member, so the
// first action can itself be a bundle. First-occurrence order is preserved for determinism (NFR8):
// the group order, and the id order within a group, follow the input `shown` order verbatim.
function bundleGroups(shown) {
  const groups = [];
  const byCommand = new Map(); // command string → the open group collecting that exact command
  for (const f of shown) {
    const cmd = f.next_step && f.next_step.command;
    if (cmd) {
      const g = byCommand.get(cmd);
      if (g) { g.push(f); continue; }
      const ng = [f];
      byCommand.set(cmd, ng);
      groups.push(ng);
    } else {
      groups.push([f]); // no command → never bundles
    }
  }
  return groups;
}

// One action line, rendered mechanically from a GROUP of findings sharing a `next_step.command`
// (spec §6/P5, P7). The representative (first, top-ranked) member supplies the summary, effort,
// command block, and Details anchor; a bundle of N>1 makes its size visible with a ` (N items)`
// suffix on the bold summary and lists every covered id in its manifest. Checkbox first (the
// feedback touch-point), bold verb-first summary, `~N min` when estimated, the copy-pasteable
// command block when present, and an anchor link into Details. When a `next_step.summary` stands in
// for the title, the title becomes the one-sentence "why". Evidence and the human-visible ids live
// only in Details — the reader meets the action here, never the code. A group of one renders exactly
// as a lone finding did (byte-identical), so the count suffix is empty and the manifest holds one id.
function renderActionLine(group, lines) {
  const f = group[0];
  const ns = f.next_step || {};
  const effort = typeof ns.effort_min === 'number' ? ` — ~${ns.effort_min} min` : '';
  const anchor = `→ [details](#${detailsAnchor(f)})`;
  const why = (ns.summary && f.title && f.title !== ns.summary) ? ` ${f.title.replace(/\s+$/, '')}.` : '';
  const count = group.length > 1 ? ` (${group.length} items)` : '';
  const summary = `${actionSummary(f)}${count}`;
  // The id manifest is invisible in rendered Markdown but is how backfill/review map a checked box
  // back to its finding(s) (feedback.js) — a comma-separated list, in first-occurrence order, so one
  // bundled checkbox fans out to every covered id (FR60).
  const ids = `<!-- ids: ${group.map((g) => g.id).join(', ')} -->`;
  if (ns.command) {
    lines.push(`- [ ] **${summary}**${effort}: ${ids}`, '', `      ${ns.command}`, '', `  ${why ? why.trim() + ' ' : ''}${anchor}`);
  } else {
    lines.push(`- [ ] **${summary}**${effort}.${why} ${anchor} ${ids}`);
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

// The "Where you stand" release-position block (spec §6, brief-composition P6): the progress toward
// the target, the doneCount/total ratio it is derived from (release-progress-display P1), the titles
// of the remaining open criteria, and a pointer to the tracker — never the tracker's full
// status-entry text, so MORNING.md and RELEASE.md no longer duplicate it (Story 8.4 / FR61).
// `ratio` is `{ done, total, remainingTitles }` counted from the tracker store (see collect()).
function renderWhereYouStand(rel, ratio, lines) {
  if (!(rel && rel.fm && rel.fm.progress != null)) {
    lines.push('- No RELEASE.md yet — run `/release-progress` (or `/nightwatch`) to create it.');
    return;
  }
  const target = rel.fm.target || 'release';
  const phase = rel.fm.phase || 'unset';
  // Show the ratio only when something is tracked; a zero denominator keeps the coarse percentage
  // messaging and never renders "0/0" (release-progress-display AC3).
  const hasRatio = ratio && ratio.total > 0;
  const ratioText = hasRatio ? ` (${ratio.done}/${ratio.total} criteria)` : '';
  lines.push(`- **${progressPercent(rel.fm.progress)}%**${ratioText} toward ${target} (phase: ${phase}). Full tracker: \`.nightwatch/RELEASE.md\`.`);
  if (hasRatio && ratio.remainingTitles.length) {
    lines.push(`- Remaining: ${ratio.remainingTitles.join('; ')}.`);
  }
}

const TRACKED_SECTIONS = ['implementation', 'documentation', 'blockers'];
const STALE_TAG = '(stale? — confirm)';

// The date of the most recent brief STRICTLY BEFORE `date` (the "yesterday" boundary for Since
// yesterday). Read from the dated briefs directory so it is deterministic and needs no clock.
function previousBriefDate(root, date) {
  let names = [];
  try { names = fs.readdirSync(path.join(nwDir(root), 'briefs')); } catch { return null; }
  const dates = names.map((n) => (n.match(/^(\d{4}-\d{2}-\d{2})\.md$/) || [])[1]).filter((d) => d && d < date).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

// `## Since yesterday` (spec brief-roadmap-composition P2, maintainer-perspective W10): merges on the
// default branch and findings resolved since the previous brief. Deterministic; a no-change night
// renders exactly one line. Git reads are read-only and tolerate a non-git repo (no merges then).
function renderSinceYesterday(root, store, prevDate, lines) {
  const items = [];
  // Merges since the previous brief (title-first per W2: branch name, PR number parenthesized).
  // Match the merge-commit subject in the log directly (no --merges filter, so a squash/rebase repo
  // whose PR merges are ordinary commits still surfaces them).
  const sinceArg = prevDate ? [`--since=${prevDate} 00:00:00`] : ['-n', '20'];
  const raw = git(root, ['log', '--pretty=%s', ...sinceArg]) || '';
  for (const line of raw.split('\n')) {
    const m = line.match(/Merge pull request #(\d+) from \S+?\/(\S+)/);
    if (m) items.push(`- Merged ${m[2]} (PR #${m[1]}).`);
  }
  // Findings resolved since the previous brief (finding lifecycle resolution rows).
  for (const r of store.readLedger()) {
    if (r && r.type === 'resolution' && r.id && (!prevDate || (r.date || '') > prevDate)) {
      items.push(`- Resolved ${r.id}${r.evidence ? `: ${r.evidence}` : ''}.`);
    }
  }
  if (!items.length) { lines.push('- Nothing new since the last brief.'); return; }
  for (const l of items.sort()) lines.push(l);
}

// `## The road to release` (spec brief-roadmap-composition P3): the declared journey rendered
// compactly, or the fallback matrix. `isDone(criterion)` reports tracker completion.
function renderRoadToRelease(release, rel, ratio, isDone, lines) {
  const hasMilestones = release && Array.isArray(release.milestones) && release.milestones.length > 0;
  if (!hasMilestones) {
    // No tracker at all → the single hint line; a tracker without milestones → the flat ratio + a nudge.
    renderWhereYouStand(rel, ratio, lines);
    if (rel && rel.fm && rel.fm.progress != null) lines.push('- Declare `milestones:` in STATE.md for a release roadmap.');
    return;
  }
  const goal = (rel && rel.fm && rel.fm.target) || (release && release.target) || 'release';
  const j = deriveJourney(release, isDone);
  lines.push(`- **Your goal — STATE.md:** ${goal}`);
  for (let i = 0; i < j.milestones.length; i++) {
    const m = j.milestones[i];
    const here = i === j.currentIndex ? ' — *you are here*' : '';
    lines.push(`- ${m.mark} **${m.name}**${here}`);
  }
  lines.push('- ○ Hygiene gate before tagging *(waivable gate — generic release checks)*');
  lines.push('- 🏁 Tag the release.');
  const blockers = ratio && ratio.blockers && ratio.blockers.length ? ratio.blockers.join(', ') : 'nothing';
  lines.push(`- **Blocking the release:** ${blockers}`);
}
// The number of remaining-criterion titles the "Where you stand" block lists (a short, deterministic
// preview — the full list lives in the tracker).
const REMAINING_TITLE_CAP = 3;

// Count the doneCount/total ratio the release percentage is derived from, straight off the tracker
// store collect() already opened — the same tracked set release-progress.js computes `progress` over
// (definition-of-done items + blockers, excluding stale). Open-item titles feed the remaining preview;
// a rendered `— evidence: …` tail is stripped so the reader sees the criterion, not the pointer.
function releaseRatio(store) {
  const items = store.listItems();
  const tracked = items.filter((it) => TRACKED_SECTIONS.includes(it.section) && !it.title.includes(STALE_TAG));
  const done = tracked.filter((it) => it.status === 'done').length;
  const remainingTitles = tracked
    .filter((it) => it.status === 'open')
    .map((it) => it.title.replace(/\s+—\s+evidence:.*$/, ''))
    .slice(0, REMAINING_TITLE_CAP);
  // Open blockers feed the road's "Blocking the release:" line (spec brief-roadmap-composition P3).
  const blockers = items.filter((it) => it.section === 'blockers' && it.status === 'open')
    .map((it) => it.title.replace(/\s+—\s+evidence:.*$/, ''));
  return { done, total: tracked.length, remainingTitles, blockers };
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

// The budgeted judgment recheck (spec finding-lifecycle P3) is the owning job's work and records its
// verdicts through the store out-of-band; here we read back this run's `judgment`-method recheck
// rows so the run-end classification can honor them instead of falling to `not-re-examined`. A
// judgment `resolution` already removes the finding from the open set, so only rechecks matter.
function collectJudgmentVerdicts(rows, date) {
  const judged = {};
  for (const r of rows || []) {
    if (r && r.type === 'recheck' && r.date === date && r.method === 'judgment' && r.id) {
      judged[r.id] = { classification: 'still-open', method: 'judgment' };
    }
  }
  return judged;
}

function collect(root, date, { force = false } = {}) {
  const { config, authority, release } = loadConfig(root);
  const cap = (config.caps && config.caps.brief_total) || 25;
  const store = openTracker(root, config);

  const docs = readAllFindings(root, date, MEMBER_JOBS);
  const runStatus = readJSONSafe(outReadPath(root, `run-status-${date}.json`)) || { jobs: [] };

  // ---- Finding lifecycle (spec finding-lifecycle P1/P2/P5): classify the carried-forward open set
  // and identify closed findings whose staged patches to garbage-collect. Computed here (pure reads)
  // so the Machine-notes GC line can render; the actual ledger writes + patch deletion happen in the
  // guarded append block below, once, keyed by run-ordinal so a forced re-run traces distinctly. ----
  const ledgerBefore = store.readLedger();
  const openBefore = store.openFindings(); // snapshot BEFORE tonight's finding rows are appended
  // Commit-policy probe (spec runtime-layout P3): a deterministic, zero-token `git check-ignore`
  // check — computed up front so its finding both enters the brief and counts as re-observed in the
  // lifecycle classification. Null when the ledger/briefs are correctly trackable.
  const probeFinding = commitPolicyProbe(root);
  const reobserved = new Set();
  for (const doc of docs) for (const f of doc.findings || []) reobserved.add(f.id);
  if (probeFinding) reobserved.add(probeFinding.id);
  const judged = collectJudgmentVerdicts(ledgerBefore, date);
  const lifecycleResults = classifyOpenFindings({ open: openBefore, reobserved, date, classifier: floorClassifier(root, { judged }) });
  // A finding is closed (its patch may be collected) when it is resolved this run or already
  // dismissed via feedback. Its patch files (any date) are GC'd with one Machine-notes line (P5).
  const closedIds = new Set(lifecycleResults.filter((r) => r.classification === 'resolved').map((r) => r.id));
  for (const r of ledgerBefore) if (r && r.type === 'feedback' && String(r.verdict) === 'dismissed' && r.id) closedIds.add(r.id);
  const gcCandidates = gcPatches(root, closedIds, { remove: false }); // read-only preview for the note

  // Gather eligible findings tagged with source job + class.
  const all = [];
  const degradedNotices = [];
  for (const doc of docs) {
    for (const n of doc.degraded || []) degradedNotices.push({ job: doc.job, note: n });
    for (const f of doc.findings || []) if (briefEligible(f)) all.push({ ...f, job: doc.job, _cls: classify(f) });
  }
  // The commit-policy probe finding (computed above) enters the brief like any other — setup ranks
  // near the top, and it is recorded in the ledger with a stable id so it recurs rather than re-reports.
  if (probeFinding) all.push({ ...probeFinding, job: 'nightwatch', _cls: classify(probeFinding) });
  // Global ranking for the cap and first-action selection (FR57): priority class → severity →
  // lowest effort (absent last) → id. Fully deterministic (NFR8).
  all.sort((a, b) => a._cls.rank - b._cls.rank || a.severity - b.severity || effortKey(a) - effortKey(b) || a.id.localeCompare(b.id));
  const shown = all.slice(0, cap);
  const overflow = all.slice(cap);

  // Citation integrity (spec writing-harness P5): every `#N` the brief's authored prose cites must
  // match a PR in THIS repo's git history. Deterministic, no network — invalid numbers are flagged
  // in Machine notes (as "PR N" so the note itself survives) and stripped to `#?` in the rendered
  // brief, never silently trusted. Scanned from the shown findings' authored fields.
  const authoredCorpus = shown
    .map((f) => `${actionSummary(f)} ${f.title || ''} ${(f.next_step && f.next_step.command) || ''}`)
    .join('\n');
  const citeCheck = checkCitations(root, authoredCorpus);

  // ---- Compose for a 30-second read (spec §6): status, ONE first action, and the release
  // position all land ABOVE the fold; evidence, ids, and degraded notices below it. ----
  const L = [];
  L.push(`# Nightwatch — ${date}`, '');

  // Status line — one bold sentence answering "is anything on fire?" before anything else.
  L.push(deriveStatusLine(shown, runStatus), '');

  // Roadmap-first order (spec brief-roadmap-composition P1, Story 10.5): orient before triage —
  // Since yesterday and The road to release both land ABOVE the fold, before the single First action.

  // ## Since yesterday — what did I just finish? (merges + resolved findings since the last brief).
  L.push('## Since yesterday');
  renderSinceYesterday(root, store, previousBriefDate(root, date), L);
  L.push('');

  // ## The road to release — what's the goal, where am I, what's next? The declared journey, or the
  // fallback matrix (no tracker → hint; tracker but no milestones → the flat ratio + a nudge).
  const rel = readReleaseHeader(root, config);
  const ratio = releaseRatio(store);
  const doneTitles = new Set(store.listItems().filter((it) => it.status === 'done').map((it) => it.title));
  L.push('## The road to release');
  renderRoadToRelease(release, rel, ratio, (crit) => doneTitles.has(crit), L);
  L.push('');

  // Bundle same-remedy findings into action-line groups AFTER the cap (bundling is a rendering step;
  // the cap already counted the underlying findings). A group takes its first member's rank, so the
  // top-ranked group is the First action and the rest keep interleave-priority order.
  const groups = bundleGroups(shown);

  // ## ▶ First action — exactly one action line (the top-ranked group, which may be a bundle).
  const first = groups[0] || null;
  L.push('## ▶ First action');
  if (first) renderActionLine(first, L); else L.push('- Nothing needs you today.');
  L.push('');

  // ## If you have energy after that — the remaining action-line groups, same grammar.
  const rest = groups.slice(1);
  L.push('## If you have energy after that');
  if (rest.length) for (const g of rest) renderActionLine(g, L); else L.push('- Nothing else right now.');
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
  // Collected staged patches (spec finding-lifecycle P5): one line naming the patch files GC'd
  // because their finding is resolved or dismissed. Byte-deterministic (gcPatches returns sorted).
  if (gcCandidates.length) {
    notes.push(`- Collected ${gcCandidates.length} stale patch${gcCandidates.length === 1 ? '' : 'es'} (finding resolved/dismissed): ${gcCandidates.map((p) => `\`${p}\``).join(', ')}.`);
  }
  // Citation integrity (spec writing-harness P5): name every cited number that matches no PR in this
  // repo's git history; those numbers are stripped to `#?` in the brief below. Byte-deterministic.
  if (citeCheck.invalid.length) {
    notes.push(`- Citation check: ${citeCheck.invalid.map((n) => `PR ${n}`).join(', ')} cite no PR/commit in this repo — rendered without their number.`);
  }
  // Layout-upgrade nudge (spec runtime-layout P4): exactly one line pointing a pre-layout install
  // (legacy paths in use, or the orientation README missing on a repo with memory) at
  // `init --update`. Detection and reporting only — no overnight writes; a current install gets none.
  const nudge = layoutUpgradeNudge(root);
  if (nudge) notes.push(nudge);
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

  let briefText = L.join('\n') + '\n';
  // Strip any invalid citation's number to `#?` (spec P5) — the Machine-notes line above named them
  // as "PR N" (no `#`), so it is untouched; every other bad `#N` in the visible prose is neutralized.
  if (citeCheck.invalid.length) {
    const bad = new Set(citeCheck.invalid);
    briefText = briefText.replace(/#(\d+)/g, (whole, n) => (bad.has(Number(n)) ? '#?' : whole));
  }

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
    // Run-ordinal for this date (spec finding-lifecycle P6): 0 for the first run, ≥1 for a forced
    // same-date re-run. A forced re-run stamps `forced:true` + the ordinal on its run rows (never
    // swallowed by the same-date guard) and writes its classification rows once per ordinal; an
    // unforced same-night re-run is blocked by the guard above and appends nothing.
    const ordinal = runOrdinal(store.readLedger(), date);
    const runMeta = force ? { forced: true, run_ordinal: ordinal } : (ordinal ? { run_ordinal: ordinal } : {});
    for (const doc of docs) {
      const js = (runStatus.jobs || []).find((j) => j.job === doc.job) || {};
      store.recordRun({ date, job: doc.job, findings: (doc.findings || []).length, degraded: (doc.degraded || []).length, tokens: js.tokens || null, ...runMeta });
      store.recordFindings(doc.findings || [], { date, job: doc.job });
    }
    // Record the commit-policy probe finding (P3) with its stable id so it dedupes/recurs like any
    // finding — the probe re-detects it each night, but the ledger counts one recurring finding.
    if (probeFinding) store.recordFindings([probeFinding], { date, job: 'nightwatch' });
    store.recordRun({ date, job: 'collect-brief', shown: shown.length, total: all.length, cap, ...runMeta });
    // Per-run classification of the carried-forward open set (spec P1/P2): an id tonight's docs
    // re-surfaced is `re-observed` (its finding row already dedupes); every other open finding runs
    // through the deterministic floor (free, zero tokens) — cited path/text gone → `resolved`,
    // still present → `still-open (deterministic)`, unresolvable → escalated. An escalated finding
    // is `not-re-examined` unless the owning job recorded a budgeted judgment verdict this run.
    // Rows are keyed (type,id,date,run-ordinal) so an unforced re-run never duplicates them and a
    // forced re-run traces distinctly; no historical row is rewritten. So nothing silently vanishes.
    for (const row of newClassificationRows(lifecycleResults, store.readLedger(), ordinal)) {
      if (row.type === 'resolution') store.recordResolution(row); else store.recordRecheck(row);
    }
    // Garbage-collect the staged patches of resolved/dismissed findings (P5) — the same set the
    // Machine-notes line named above. Deleting is idempotent; on a later run the preview finds none.
    gcPatches(root, closedIds, { remove: true });
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
